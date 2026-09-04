/*
 * Local PDF page importer/copier for Party Document Mode.
 *
 * This intentionally handles the ordinary PDF 1.x object model used by
 * scanned documents. It copies page dictionaries, resource objects and
 * content streams without rendering source pages through JPEG. Unsupported,
 * encrypted or malformed PDFs fail closed so no output can silently lose a
 * page.
 */
(() => {
  'use strict';

  const decoder = new TextDecoder('iso-8859-1');
  const textEncoder = new TextEncoder();
  const PREVIEW_SOURCE_MAX_EDGE = 640;
  const PREVIEW_CACHE_LIMIT = 16;
  const MAX_IMAGE_DIMENSION = 10000;
  const MAX_DECODED_BYTES = 64 * 1024 * 1024;
  const LOCALLY_DECODABLE_FILTERS = new Set(['FlateDecode', 'Fl', 'DCTDecode', 'DCT']);

  function latin1Encode(value) {
    const out = new Uint8Array(value.length);
    for (let i = 0; i < value.length; i++) out[i] = value.charCodeAt(i) & 255;
    return out;
  }

  function concat(parts) {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    parts.forEach(part => { out.set(part, offset); offset += part.length; });
    return out;
  }

  function bytesFor(value) { return textEncoder.encode(value); }

  function isPdfWhitespace(value) {
    return value === '\x00' || value === '\t' || value === '\n' || value === '\f' || value === '\r' || value === ' ';
  }

  function hasTokenBoundary(text, start, token) {
    const before = start === 0 ? '' : text[start - 1];
    const after = text[start + token.length] || '';
    return (!before || isPdfWhitespace(before) || /[()[\]{}<>/%]/.test(before)) &&
      (!after || isPdfWhitespace(after) || /[()[\]{}<>/%]/.test(after));
  }

  function findToken(text, token, start) {
    let index = text.indexOf(token, start);
    while (index >= 0) {
      if (hasTokenBoundary(text, index, token)) return index;
      index = text.indexOf(token, index + token.length);
    }
    return -1;
  }

  function streamMarker(text, start) {
    let index = text.indexOf('stream', start);
    while (index >= 0) {
      const after = text[index + 6];
      const prefix = text.slice(start, index).replace(/[\x00\t\n\f\r ]+$/, '');
      if (hasTokenBoundary(text, index, 'stream') && (after === '\r' || after === '\n') && prefix.endsWith('>>')) return index;
      index = text.indexOf('stream', index + 6);
    }
    return -1;
  }

  function buildObjectIndex(text) {
    const index = new Map();
    const pattern = /(\d+)\s+(\d+)\s+obj\b/g;
    let match;
    while ((match = pattern.exec(text))) {
      if (match.index > 0 && !isPdfWhitespace(text[match.index - 1])) continue;
      const id = Number(match[1]);
      const entry = {
        id,
        generation: Number(match[2]),
        headerStart: match.index,
        bodyStart: pattern.lastIndex
      };
      const list = index.get(id);
      if (list) list.push(entry);
      else index.set(id, [entry]);
    }
    return index;
  }

  function resolveIndirectLength(text, objectIndex, refId, refGen, currentObjId, cache, visited, compressedObjects) {
    if (refId === currentObjId) {
      throw new Error(`PDF stream tham chiếu /Length object ${refId} bị lặp chính nó (self reference).`);
    }
    if (visited.has(refId)) {
      throw new Error(`PDF stream tham chiếu /Length object ${refId} bị vòng lặp (reference cycle).`);
    }
    if (cache.has(refId)) return cache.get(refId);

    const candidates = objectIndex.get(refId);
    if (!candidates || !candidates.length) {
      if (compressedObjects && compressedObjects.has(refId)) {
        const comp = compressedObjects.get(refId);
        const cleaned = comp.text.replace(/%[^\r\n]*[\r\n]?/g, '').trim();
        if (!/^[+-]?\d+$/.test(cleaned)) {
          throw new Error(`PDF stream tham chiếu /Length object ${refId} nhưng không đọc được giá trị hợp lệ.`);
        }
        const val = Number(cleaned);
        if (!Number.isSafeInteger(val) || val < 0) {
          throw new Error(`PDF stream tham chiếu /Length object ${refId} có giá trị âm hoặc không hợp lệ.`);
        }
        if (val > text.length) {
          throw new Error(`PDF stream tham chiếu /Length object ${refId} vượt quá kích thước tệp.`);
        }
        cache.set(refId, val);
        return val;
      }
      throw new Error(`PDF stream tham chiếu /Length object ${refId} nhưng không tìm thấy object.`);
    }

    visited.add(refId);

    let resolvedValue = null;
    for (const candidate of candidates) {
      if (candidate.generation !== refGen) continue;
      const endObj = findToken(text, 'endobj', candidate.bodyStart);
      if (endObj < 0) continue;
      const raw = text.slice(candidate.bodyStart, endObj);
      const cleaned = raw.replace(/%[^\r\n]*[\r\n]?/g, '').trim();
      if (!/^[+-]?\d+$/.test(cleaned)) continue;
      const val = Number(cleaned);
      if (!Number.isSafeInteger(val) || val < 0) continue;
      if (val > text.length) {
        throw new Error(`PDF stream tham chiếu /Length object ${refId} vượt quá kích thước tệp.`);
      }
      resolvedValue = val;
      break;
    }

    if (resolvedValue === null) {
      throw new Error(`PDF stream tham chiếu /Length object ${refId} nhưng không đọc được giá trị hợp lệ.`);
    }

    cache.set(refId, resolvedValue);
    return resolvedValue;
  }

  function matchEndStreamAtDeclaredEnd(text, declaredEnd) {
    for (const offset of [declaredEnd, declaredEnd + 1, declaredEnd + 2]) {
      if (offset + 9 <= text.length && text.slice(offset, offset + 9) === 'endstream') {
        const gap = text.slice(declaredEnd, offset);
        if (gap === '' || gap === '\n' || gap === '\r' || gap === '\r\n') {
          const after = text[offset + 9] || '';
          if (!after || isPdfWhitespace(after) || /[()[\]{}<>/%]/.test(after)) {
            return offset;
          }
        }
      }
    }
    return -1;
  }

  function resolveStreamLength(text, bodyStart, streamIndex, objectIndex, currentObjId, lengthCache, compressedObjects) {
    const dictionary = text.slice(bodyStart, streamIndex);
    const directM = dictionary.match(/\/Length\s+([+-]?\d+)\b(?!\s+\d+\s+R)/);
    if (directM) {
      const val = Number(directM[1]);
      if (!Number.isSafeInteger(val) || val < 0) {
        throw new Error(`PDF stream có /Length direct không hợp lệ: ${directM[1]}.`);
      }
      return val;
    }
    const indirectM = dictionary.match(/\/Length\s+(\d+)\s+(\d+)\s+R\b/);
    if (indirectM) {
      const refId = Number(indirectM[1]);
      const refGen = Number(indirectM[2]);
      return resolveIndirectLength(text, objectIndex, refId, refGen, currentObjId, lengthCache, new Set([currentObjId]), compressedObjects);
    }
    return null;
  }

  function findObjectEnd(text, bodyStart, objectIndex, currentObjId, lengthCache, compressedObjects) {
    const firstEndObj = findToken(text, 'endobj', bodyStart);
    const streamIndex = streamMarker(text, bodyStart);
    if (firstEndObj >= 0 && (streamIndex < 0 || firstEndObj < streamIndex)) {
      return { end: firstEndObj, streamInfo: null };
    }
    if (streamIndex >= 0) {
      let dataStart = streamIndex + 6;
      if (text[dataStart] === '\r' && text[dataStart + 1] === '\n') dataStart += 2;
      else if (text[dataStart] === '\n' || text[dataStart] === '\r') dataStart += 1;

      const length = resolveStreamLength(text, bodyStart, streamIndex, objectIndex, currentObjId, lengthCache, compressedObjects);
      let endStream = -1;
      let streamDataEnd = -1;
      if (length !== null) {
        const declaredEnd = dataStart + length;
        if (declaredEnd > text.length) {
          throw new Error('PDF stream có /Length vượt quá kích thước tệp.');
        }
        endStream = matchEndStreamAtDeclaredEnd(text, declaredEnd);
        if (endStream < 0) {
          throw new Error('PDF stream không tìm thấy endstream sau declared length.');
        }
        streamDataEnd = declaredEnd;
      } else {
        endStream = findToken(text, 'endstream', dataStart);
        if (endStream < 0) return { end: -1, streamInfo: null };
        streamDataEnd = endStream;
      }
      const endObj = findToken(text, 'endobj', endStream + 9);
      if (endObj < 0) return { end: -1, streamInfo: null };
      return {
        end: endObj,
        streamInfo: {
          streamIndex: streamIndex - bodyStart,
          streamDataStart: dataStart - bodyStart,
          streamDataEnd: streamDataEnd - bodyStart,
          endStreamOffset: endStream - bodyStart
        }
      };
    }
    return { end: findToken(text, 'endobj', bodyStart), streamInfo: null };
  }

  function inflateSync(data, maxBytes = MAX_DECODED_BYTES) {
    if (typeof process !== 'undefined' && typeof require === 'function') {
      try {
        const res = require('zlib').inflateSync(data, { maxOutputLength: maxBytes });
        if (res.length > maxBytes) throw new Error('Kích thước giải nén vượt quá giới hạn tối đa.');
        return new Uint8Array(res);
      } catch (zlibErr) {
        if (zlibErr?.code === 'ERR_BUFFER_TOO_LARGE' || /maxOutputLength/i.test(zlibErr?.message || '')) {
          throw new Error('Kích thước giải nén vượt quá giới hạn tối đa.');
        }
      }
    }
    let pos = 0;
    if (data.length >= 2 && (data[0] & 0x0f) === 8 && ((data[0] << 8) | data[1]) % 31 === 0) {
      pos = 2;
    }
    let bitBuf = 0, bitCnt = 0;
    function needBits(n) {
      while (bitCnt < n) {
        if (pos >= data.length) throw new Error('Dữ liệu PDF nén bị cắt ngắn (unexpected EOF).');
        bitBuf |= data[pos++] << bitCnt;
        bitCnt += 8;
      }
    }
    function getBits(n) {
      needBits(n);
      const val = bitBuf & ((1 << n) - 1);
      bitBuf >>>= n;
      bitCnt -= n;
      return val;
    }
    function dropToByte() { bitBuf = 0; bitCnt = 0; }

    function buildHuffman(lengths) {
      const maxLen = Math.max(...lengths);
      if (maxLen === 0) return { maxLen: 0, map: new Map() };
      const blCount = new Uint16Array(maxLen + 1);
      for (let i = 0; i < lengths.length; i++) blCount[lengths[i]]++;
      blCount[0] = 0;
      const nextCode = new Uint32Array(maxLen + 1);
      let codeVal = 0;
      for (let i = 1; i <= maxLen; i++) {
        codeVal = (codeVal + blCount[i - 1]) << 1;
        nextCode[i] = codeVal;
      }
      const map = new Map();
      for (let i = 0; i < lengths.length; i++) {
        const len = lengths[i];
        if (len === 0) continue;
        const c = nextCode[len]++;
        map.set((len << 16) | c, i);
      }
      return { maxLen, map };
    }

    function decodeSymbol(huff) {
      if (!huff || huff.maxLen === 0) throw new Error('Mã Huffman PDF không hợp lệ.');
      let codeVal = 0;
      for (let len = 1; len <= huff.maxLen; len++) {
        codeVal = (codeVal << 1) | getBits(1);
        const sym = huff.map.get((len << 16) | codeVal);
        if (sym !== undefined) return sym;
      }
      throw new Error('Mã Huffman PDF không hợp lệ.');
    }

    const fixedLitLens = new Uint8Array(288);
    for (let i = 0; i <= 143; i++) fixedLitLens[i] = 8;
    for (let i = 144; i <= 255; i++) fixedLitLens[i] = 9;
    for (let i = 256; i <= 279; i++) fixedLitLens[i] = 7;
    for (let i = 280; i <= 287; i++) fixedLitLens[i] = 8;
    const fixedLitTree = buildHuffman(fixedLitLens);
    const fixedDistLens = new Uint8Array(32); fixedDistLens.fill(5);
    const fixedDistTree = buildHuffman(fixedDistLens);

    const LENS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
    const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
    const DISTS = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
    const DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
    const CLEN_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

    let out = new Uint8Array(Math.min(Math.max(data.length * 3 + 1024, 1024), maxBytes));
    let outLen = 0;
    function ensureCapacity(need) {
      if (outLen + need > maxBytes) throw new Error('Kích thước giải nén vượt quá giới hạn tối đa.');
      if (outLen + need > out.length) {
        let newSize = Math.max(out.length * 2, outLen + need);
        if (newSize > maxBytes) newSize = maxBytes;
        const next = new Uint8Array(newSize);
        next.set(out.subarray(0, outLen));
        out = next;
      }
    }

    let isFinal = 0;
    while (!isFinal) {
      isFinal = getBits(1);
      const btype = getBits(2);
      if (btype === 0) {
        dropToByte();
        if (pos + 4 > data.length) throw new Error('Block uncompressed không hợp lệ.');
        const len = data[pos] | (data[pos + 1] << 8);
        const nlen = data[pos + 2] | (data[pos + 3] << 8);
        pos += 4;
        if ((len ^ 0xffff) !== nlen) throw new Error('Checksum uncompressed block sai.');
        if (pos + len > data.length) throw new Error('Uncompressed block vượt quá kích thước.');
        ensureCapacity(len);
        out.set(data.subarray(pos, pos + len), outLen);
        outLen += len;
        pos += len;
      } else if (btype === 1 || btype === 2) {
        let litTree, distTree;
        if (btype === 1) {
          litTree = fixedLitTree; distTree = fixedDistTree;
        } else {
          const hlit = getBits(5) + 257;
          const hdist = getBits(5) + 1;
          const hclen = getBits(4) + 4;
          const clenTable = new Uint8Array(19);
          for (let i = 0; i < hclen; i++) clenTable[CLEN_ORDER[i]] = getBits(3);
          const clenTree = buildHuffman(clenTable);
          const totalCodes = hlit + hdist;
          const codeLens = new Uint8Array(totalCodes);
          let codeIdx = 0;
          while (codeIdx < totalCodes) {
            const sym = decodeSymbol(clenTree);
            if (sym < 16) {
              codeLens[codeIdx++] = sym;
            } else if (sym === 16) {
              if (codeIdx === 0) throw new Error('Mã lặp độ dài Huffman không hợp lệ tại vị trí đầu.');
              const repeat = getBits(2) + 3;
              const prev = codeLens[codeIdx - 1];
              if (codeIdx + repeat > totalCodes) throw new Error('Bảng độ dài Huffman vượt quá số lượng mã.');
              for (let r = 0; r < repeat; r++) codeLens[codeIdx++] = prev;
            } else if (sym === 17) {
              const repeat = getBits(3) + 3;
              if (codeIdx + repeat > totalCodes) throw new Error('Bảng độ dài Huffman vượt quá số lượng mã.');
              for (let r = 0; r < repeat; r++) codeLens[codeIdx++] = 0;
            } else if (sym === 18) {
              const repeat = getBits(7) + 11;
              if (codeIdx + repeat > totalCodes) throw new Error('Bảng độ dài Huffman vượt quá số lượng mã.');
              for (let r = 0; r < repeat; r++) codeLens[codeIdx++] = 0;
            }
          }
          litTree = buildHuffman(codeLens.subarray(0, hlit));
          distTree = buildHuffman(codeLens.subarray(hlit));
        }
        while (true) {
          const sym = decodeSymbol(litTree);
          if (sym < 256) {
            ensureCapacity(1);
            out[outLen++] = sym;
          } else if (sym === 256) {
            break;
          } else {
            const lenIdx = sym - 257;
            let matchLen = LENS[lenIdx];
            const ext = LEXT[lenIdx];
            if (ext > 0) matchLen += getBits(ext);
            const distSym = decodeSymbol(distTree);
            if (distSym >= DISTS.length) throw new Error('Mã khoảng cách Huffman PDF không hợp lệ.');
            let dist = DISTS[distSym];
            const dext = DEXT[distSym];
            if (dext > 0) dist += getBits(dext);
            if (dist <= 0 || dist > outLen) throw new Error('Khoảng cách tham chiếu vượt quá dữ liệu đã giải nén.');
            ensureCapacity(matchLen);
            let from = outLen - dist;
            for (let m = 0; m < matchLen; m++) out[outLen++] = out[from++];
          }
        }
      } else {
        throw new Error('Block type PDF Deflate không hợp lệ: ' + btype);
      }
    }
    return out.subarray(0, outLen);
  }

  function parseObjectStreams(bytes, text, objectIndex) {
    const compressedObjects = new Map();
    const pattern = /(\d+)\s+(\d+)\s+obj\b/g;
    let match;
    while ((match = pattern.exec(text))) {
      if (match.index > 0 && !isPdfWhitespace(text[match.index - 1])) continue;
      const id = Number(match[1]);
      const bodyStart = pattern.lastIndex;
      const streamIdx = streamMarker(text, bodyStart);
      if (streamIdx < 0) continue;
      const dictText = text.slice(bodyStart, streamIdx);
      if (!/\/Type\s*\/ObjStm\b/.test(dictText)) continue;

      const nM = dictText.match(/\/N\s+(\d+)\b/);
      const firstM = dictText.match(/\/First\s+(\d+)\b/);
      if (!nM || !firstM) throw new Error(`PDF ObjStm ${id} thiếu /N hoặc /First.`);
      const N = Number(nM[1]);
      const first = Number(firstM[1]);
      if (!Number.isSafeInteger(N) || N <= 0 || !Number.isSafeInteger(first) || first < 0) {
        throw new Error(`PDF ObjStm ${id} có /N hoặc /First không hợp lệ.`);
      }

      let dataStart = streamIdx + 6;
      if (text[dataStart] === '\r' && text[dataStart + 1] === '\n') dataStart += 2;
      else if (text[dataStart] === '\n' || text[dataStart] === '\r') dataStart += 1;

      const directLenM = dictText.match(/\/Length\s+(\d+)\b(?!\s+\d+\s+R)/);
      let streamBytes;
      if (directLenM) {
        const len = Number(directLenM[1]);
        if (!Number.isSafeInteger(len) || len < 0 || dataStart + len > bytes.length) {
          throw new Error(`PDF ObjStm ${id} có /Length không hợp lệ.`);
        }
        streamBytes = bytes.subarray(dataStart, dataStart + len);
      } else {
        const endStream = findToken(text, 'endstream', dataStart);
        if (endStream < 0) throw new Error(`PDF ObjStm ${id} không tìm thấy endstream.`);
        streamBytes = bytes.subarray(dataStart, endStream);
      }

      const filterMatch = dictText.match(/\/Filter\s*\/([A-Za-z0-9]+)\b/);
      const filter = filterMatch ? filterMatch[1] : null;
      let decodedBytes;
      if (!filter) {
        decodedBytes = streamBytes;
      } else if (filter === 'FlateDecode' || filter === 'Fl') {
        decodedBytes = inflateSync(streamBytes);
      } else {
        throw new Error(`PDF ObjStm ${id} có bộ lọc chưa hỗ trợ: ${filter}.`);
      }

      const decodedText = decoder.decode(decodedBytes);
      if (first > decodedBytes.length) {
        throw new Error(`PDF ObjStm ${id} có /First vượt quá kích thước stream.`);
      }
      const headerText = decodedText.slice(0, first).trim();
      const headerTokens = headerText ? headerText.split(/\s+/) : [];
      if (headerTokens.length < 2 * N || headerTokens.some(t => !/^\d+$/.test(t))) {
        throw new Error(`PDF ObjStm ${id} header không hợp lệ hoặc không đủ ${N} cặp số.`);
      }

      let lastOffset = -1;
      for (let k = 0; k < N; k++) {
        const compId = Number(headerTokens[2 * k]);
        const offset = Number(headerTokens[2 * k + 1]);
        const nextOffset = (k < N - 1) ? Number(headerTokens[2 * (k + 1) + 1]) : (decodedBytes.length - first);
        if (!Number.isSafeInteger(compId) || compId <= 0) {
          throw new Error(`PDF ObjStm ${id} chứa object id không hợp lệ: ${compId}.`);
        }
        if (offset < 0 || offset < lastOffset || offset > nextOffset || (first + nextOffset) > decodedBytes.length) {
          throw new Error(`PDF ObjStm ${id} chứa object offset không hợp lệ.`);
        }
        if (compressedObjects.has(compId)) {
          throw new Error(`PDF ObjStm chứa duplicate object id ${compId}.`);
        }
        lastOffset = offset;
        const compBodyText = decodedText.slice(first + offset, first + nextOffset).trim();
        compressedObjects.set(compId, {
          id: compId,
          generation: 0,
          text: compBodyText,
          bytes: latin1Encode(compBodyText),
          isCompressed: true
        });
      }
    }
    return compressedObjects;
  }

  function parseObjects(bytes) {
    const text = decoder.decode(bytes);
    const objectIndex = buildObjectIndex(text);
    const compressedObjects = parseObjectStreams(bytes, text, objectIndex);
    const lengthCache = new Map();
    const objects = new Map();
    const pattern = /(\d+)\s+(\d+)\s+obj\b/g;
    let match;
    while ((match = pattern.exec(text))) {
      if (match.index > 0 && !isPdfWhitespace(text[match.index - 1])) continue;
      const id = Number(match[1]);
      const bodyStart = pattern.lastIndex;
      const result = findObjectEnd(text, bodyStart, objectIndex, id, lengthCache, compressedObjects);
      const end = result.end;
      if (end < 0) throw new Error('PDF không hợp lệ: thiếu endobj.');
      const objRecord = {
        id,
        generation: Number(match[2]),
        text: text.slice(bodyStart, end),
        bytes: bytes.slice(bodyStart, end)
      };
      if (result.streamInfo) {
        objRecord.streamIndex = result.streamInfo.streamIndex;
        objRecord.streamDataStart = result.streamInfo.streamDataStart;
        objRecord.streamDataEnd = result.streamInfo.streamDataEnd;
        objRecord.endStreamOffset = result.streamInfo.endStreamOffset;
      }
      objects.set(id, objRecord);
      pattern.lastIndex = end + 6;
    }

    for (const [compId, compRecord] of compressedObjects) {
      if (!objects.has(compId)) {
        objects.set(compId, compRecord);
      }
    }

    if (!objects.size) throw new Error('PDF không có object hợp lệ.');
    return objects;
  }


  function refsIn(text) {
    const refs = [];
    const pattern = /(\d+)\s+(\d+)\s+R\b/g;
    let match;
    while ((match = pattern.exec(text))) refs.push(Number(match[1]));
    return refs;
  }

  function findPageObjects(objects) {
    return Array.from(objects.values())
      .filter(object => {
        const stream = streamMarker(object.text, 0);
        const dictionary = stream < 0 ? object.text : object.text.slice(0, stream);
        return /\/Type\s*\/Page(?!s)\b/.test(dictionary);
      })
      .map(object => object.id);
  }

  function skipPdfSpace(text, index) {
    while (index < text.length) {
      if (/\s/.test(text[index])) { index++; continue; }
      if (text[index] === '%') { while (index < text.length && text[index] !== '\r' && text[index] !== '\n') index++; continue; }
      break;
    }
    return index;
  }

  function balancedPdfValueEnd(text, index, open) {
    const stack = [open];
    let i = index + (open === '<<' ? 2 : 1);
    while (i < text.length && stack.length > 0) {
      if (text[i] === '%') {
        while (i < text.length && text[i] !== '\r' && text[i] !== '\n') i++;
        continue;
      }
      if (text[i] === '(') {
        let stringDepth = 1;
        while (++i < text.length && stringDepth > 0) {
          if (text[i] === '\\') { i++; continue; }
          if (text[i] === '(') stringDepth++;
          else if (text[i] === ')') stringDepth--;
        }
        continue;
      }
      if (text[i] === '<') {
        if (text[i + 1] === '<') {
          stack.push('<<');
          i += 2;
          continue;
        }
        // hex string
        while (++i < text.length && text[i] !== '>') {}
        if (i < text.length) i++;
        continue;
      }
      if (text[i] === '>' && text[i + 1] === '>') {
        if (stack[stack.length - 1] === '<<') {
          stack.pop();
          if (stack.length === 0) return i + 2;
          i += 2;
          continue;
        }
      }
      if (text[i] === '[') {
        stack.push('[');
        i++;
        continue;
      }
      if (text[i] === ']') {
        if (stack[stack.length - 1] === '[') {
          stack.pop();
          if (stack.length === 0) return i + 1;
          i++;
          continue;
        }
      }
      i++;
    }
    return -1;
  }

  function pdfValueEnd(text, index) {
    index = skipPdfSpace(text, index);
    if (text.slice(index, index + 2) === '<<') return balancedPdfValueEnd(text, index, '<<');
    if (text[index] === '[') return balancedPdfValueEnd(text, index, '[');
    if (text[index] === '/') { let end = index + 1; while (end < text.length && !/\s|[\[\]()<>/]/.test(text[end])) end++; return end; }
    if (text[index] === '(') {
      let depth = 1;
      for (let i = index + 1; i < text.length; i++) {
        if (text[i] === '\\') { i++; continue; }
        if (text[i] === '(') depth++;
        else if (text[i] === ')' && --depth === 0) return i + 1;
      }
      return -1;
    }
    if (text[index] === '<' && text[index + 1] !== '<') {
      let end = index + 1;
      while (end < text.length && text[end] !== '>') end++;
      return end < text.length ? end + 1 : -1;
    }
    let end = index;
    while (end < text.length && !/\s|[\[\]()<>/]/.test(text[end])) end++;
    if (end === index) return -1;
    const first = text.slice(index, end);
    const secondStart = skipPdfSpace(text, end);
    let secondEnd = secondStart;
    while (secondEnd < text.length && !/\s|[\[\]()<>/]/.test(text[secondEnd])) secondEnd++;
    const thirdStart = skipPdfSpace(text, secondEnd);
    if (/^-?\d+(?:\.\d+)?$/.test(first) && /^-?\d+(?:\.\d+)?$/.test(text.slice(secondStart, secondEnd)) && text[thirdStart] === 'R') return thirdStart + 1;
    return end;
  }

  function valueForKey(text, key) {
    const source = String(text || '');
    const start = source.indexOf('<<');
    const end = start < 0 ? -1 : balancedPdfValueEnd(source, start, '<<');
    if (end < 0) return null;
    for (let index = start + 2; index < end;) {
      index = skipPdfSpace(source, index);
      if (source[index] !== '/') { index++; continue; }
      const keyStart = ++index;
      while (index < end && !/\s|[\[\]()<>/]/.test(source[index])) index++;
      const foundKey = source.slice(keyStart, index);
      const valueStart = skipPdfSpace(source, index);
      const valueEnd = pdfValueEnd(source, valueStart);
      if (valueEnd < 0 || valueEnd > end) return null;
      if (foundKey === key) return source.slice(valueStart, valueEnd);
      index = valueEnd;
    }
    return null;
  }

  function inheritedPageText(objects, pageId) {
    const page = objects.get(pageId);
    if (!page) throw new Error(`PDF thiếu page object ${pageId}.`);
    let text = page.text.replace(/\/Parent\s+\d+\s+\d+\s+R\b/g, '');
    let parentId = Number((page.text.match(/\/Parent\s+(\d+)\s+\d+\s+R\b/) || [])[1] || 0);
    const inherited = ['Resources', 'MediaBox', 'CropBox', 'Rotate', 'UserUnit'];
    const seen = new Set([pageId]);
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      const parent = objects.get(parentId);
      if (!parent) break;
      inherited.forEach(key => {
        if (!valueForKey(text, key)) {
          const value = valueForKey(parent.text, key);
          if (value) text = text.replace(/>>\s*$/, ` /${key} ${value} >>`);
        }
      });
      parentId = Number((parent.text.match(/\/Parent\s+(\d+)\s+\d+\s+R\b/) || [])[1] || 0);
    }
    if (!/\/Type\s*\/Page(?!s)\b/.test(text)) throw new Error('PDF page thiếu /Type /Page.');
    return text;
  }

  function parse(bytes) {
    if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
    const header = decoder.decode(bytes.slice(0, 12));
    if (!header.startsWith('%PDF-')) throw new Error('Tệp không phải PDF.');
    const objects = parseObjects(bytes);
    const pageIds = findPageObjects(objects);
    if (!pageIds.length) throw new Error('PDF không có trang đọc được.');
    if (/\/Encrypt\b/.test(decoder.decode(bytes))) throw new Error('PDF có mật khẩu/mã hóa chưa được hỗ trợ.');
    return { bytes, objects, pageIds };
  }

  function sourceFromBuffer(buffer, name = 'PDF') {
    const parsed = parse(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer));
    return {
      id: `${name}-${Math.random().toString(36).slice(2)}`,
      name,
      bytes: parsed.bytes,
      objects: parsed.objects,
      pageIds: parsed.pageIds,
      pageCount: parsed.pageIds.length,
      page(index) {
        if (!Number.isInteger(index) || index < 0 || index >= this.pageIds.length) throw new Error('Vị trí trang PDF không hợp lệ.');
        return { source: this, index, objectId: this.pageIds[index] };
      }
    };
  }

  function numberArray(value) {
    return String(value || '').match(/-?(?:\d+\.?\d*|\.\d+)/g)?.map(Number) || [];
  }

  function pageInfo(source, index) {
    const ref = source.page(index);
    const body = inheritedPageText(source.objects, ref.objectId);
    const box = numberArray(valueForKey(body, 'CropBox') || valueForKey(body, 'MediaBox'));
    if (box.length < 4 || !(box[2] > box[0]) || !(box[3] > box[1])) throw new Error('PDF page thiếu MediaBox/CropBox hợp lệ.');
    const rotation = ((Number(valueForKey(body, 'Rotate')) || 0) % 360 + 360) % 360;
    const rawWidth = box[2] - box[0], rawHeight = box[3] - box[1];
    return { ref, body, box, rotation, rawWidth, rawHeight,
      width: rotation % 180 ? rawHeight : rawWidth,
      height: rotation % 180 ? rawWidth : rawHeight };
  }

  function streamFor(source, objectId) {
    const object = source.objects.get(objectId);
    if (!object) throw new Error(`PDF thiếu object ${objectId}.`);
    const stream = streamMarker(object.text, 0);
    if (stream < 0) throw new Error(`PDF object ${objectId} không có stream.`);
    const dict = object.text.slice(0, stream);
    if (object.streamDataStart !== undefined && object.streamDataEnd !== undefined) {
      return { dict, bytes: object.bytes.slice(object.streamDataStart, object.streamDataEnd) };
    }
    let dataStart = stream + 6;
    if (object.text[dataStart] === '\r' && object.text[dataStart + 1] === '\n') dataStart += 2;
    else if (object.text[dataStart] === '\n' || object.text[dataStart] === '\r') dataStart += 1;
    if (dataStart < 0 || dataStart > object.bytes.length) throw new Error(`PDF object ${objectId} có stream offset không hợp lệ.`);
    const directLength = Number((dict.match(/\/Length\s+(\d+)\b(?!\s+\d+\s+R)/) || [])[1]);
    const lengthRef = Number((dict.match(/\/Length\s+(\d+)\s+\d+\s+R\b/) || [])[1]);
    const referencedLength = lengthRef ? Number((source.objects.get(lengthRef)?.text.match(/-?\d+/) || [])[0]) : NaN;
    const declaredLength = Number.isSafeInteger(directLength) ? directLength : referencedLength;
    if (Number.isSafeInteger(declaredLength) && declaredLength >= 0 && dataStart + declaredLength <= object.bytes.length) {
      return { dict, bytes: object.bytes.slice(dataStart, dataStart + declaredLength) };
    }
    const endStream = object.text.indexOf('endstream', dataStart);
    if (endStream < dataStart || endStream > object.bytes.length) throw new Error(`PDF object ${objectId} có stream bounds không hợp lệ.`);
    let dataEnd = endStream;
    if (object.text[dataEnd - 1] === '\n') { dataEnd--; if (object.text[dataEnd - 1] === '\r') dataEnd--; }
    else if (object.text[dataEnd - 1] === '\r') dataEnd--;
    return { dict, bytes: object.bytes.slice(dataStart, dataEnd) };
  }

  function refsAfter(text, key) { return refsIn(valueForKey(text, key) || ''); }

  function directResourceDict(source, pageBody) {
    const resourceValue = valueForKey(pageBody, 'Resources');
    if (!resourceValue) return '';
    const ref = resourceValue.match(/^(\d+)\s+\d+\s+R$/);
    return ref ? source.objects.get(Number(ref[1]))?.text || '' : resourceValue;
  }

  function xObjectRefs(source, pageBody) {
    const resources = directResourceDict(source, pageBody);
    const value = valueForKey(resources, 'XObject');
    if (!value) return new Map();
    const ref = value.match(/^(\d+)\s+\d+\s+R$/);
    const dict = ref ? source.objects.get(Number(ref[1]))?.text || '' : value;
    const result = new Map();
    const pattern = /\/([A-Za-z][A-Za-z0-9_]*)\s+(\d+)\s+\d+\s+R/g;
    let match;
    while ((match = pattern.exec(dict))) result.set(match[1], Number(match[2]));
    return result;
  }

  function streamFilters(dict) {
    const value = valueForKey(dict, 'Filter');
    return value ? Array.from(value.matchAll(/\/([A-Za-z0-9]+)/g), item => item[1]) : [];
  }

  async function inflate(bytes, maxBytes = MAX_DECODED_BYTES) {
    if (typeof DecompressionStream === 'undefined') throw new Error('Trình duyệt không hỗ trợ giải nén PDF FlateDecode.');
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
    const reader = stream.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      total += item.value.byteLength;
      if (total > maxBytes) { await reader.cancel(); throw new Error('Ảnh PDF vượt giới hạn bộ nhớ preview.'); }
      chunks.push(item.value);
    }
    return concat(chunks);
  }

  async function decodeStream(source, objectId, maxDecodedBytes = MAX_DECODED_BYTES) {
    const stream = streamFor(source, objectId);
    let bytes = stream.bytes;
    for (const filter of streamFilters(stream.dict)) {
      if (filter === 'FlateDecode' || filter === 'Fl') bytes = await inflate(bytes, maxDecodedBytes);
      else if (filter === 'DCTDecode' || filter === 'DCT') break;
      else if (filter === 'ASCII85Decode' || filter === 'A85') throw new Error('Ảnh PDF ASCII85 chưa được hỗ trợ.');
      else throw new Error(`Bộ lọc PDF chưa hỗ trợ: ${filter}.`);
    }
    return { bytes, dict: stream.dict };
  }

  function decodePredictor(bytes, width, components, predictor) {
    if (!predictor || predictor <= 1) return bytes;
    const rowSize = width * components;
    const out = new Uint8Array(Math.floor(bytes.length / (rowSize + 1)) * rowSize);
    let sourceOffset = 0, targetOffset = 0;
    for (; sourceOffset + rowSize < bytes.length && targetOffset < out.length;) {
      const filter = bytes[sourceOffset++];
      const prior = targetOffset - rowSize;
      for (let x = 0; x < rowSize; x++) {
        const left = x >= components ? out[targetOffset - components] : 0;
        const up = prior >= 0 ? out[prior + x] : 0;
        const upLeft = prior >= 0 && x >= components ? out[prior + x - components] : 0;
        const raw = bytes[sourceOffset++];
        let value = raw;
        if (filter === 1) value = raw + left;
        else if (filter === 2) value = raw + up;
        else if (filter === 3) value = raw + Math.floor((left + up) / 2);
        else if (filter === 4) {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft);
          value = raw + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
        }
        out[targetOffset++] = value & 255;
      }
    }
    return out;
  }

  function releasePreviewValue(value) {
    if (value?.image && typeof value.image.close === 'function') value.image.close();
  }

  function cachePreview(source, objectId, promise) {
    if (!source.previewImages) source.previewImages = new Map();
    const entry = { promise, value: null, released: false };
    source.previewImages.set(objectId, entry);
    promise.then(value => {
      entry.value = value;
      if (entry.released) releasePreviewValue(value);
      while (!entry.released && source.previewImages.size > PREVIEW_CACHE_LIMIT) {
        const oldest = source.previewImages.entries().next().value;
        if (!oldest) break;
        const [oldestId, oldestEntry] = oldest;
        source.previewImages.delete(oldestId);
        oldestEntry.released = true;
        if (oldestEntry.value) releasePreviewValue(oldestEntry.value);
        else oldestEntry.promise.then(releasePreviewValue).catch(() => {});
      }
    }).catch(() => {});
    return promise;
  }

  function releasePreviewCache(source) {
    const cache = source?.previewImages;
    if (cache) {
      for (const entry of cache.values()) {
        entry.released = true;
        if (entry.value) releasePreviewValue(entry.value);
        else entry.promise.then(releasePreviewValue).catch(() => {});
      }
      cache.clear();
    }
    const loadingTask = source?.previewPdfLoadingTask;
    if (source) {
      source.previewPdfLoadingTask = null;
      source.previewPdfDocument = null;
    }
    if (loadingTask?.destroy) Promise.resolve(loadingTask.destroy()).catch(() => {});
  }

  function previewCacheStats(source) {
    return { size: source?.previewImages?.size || 0, limit: PREVIEW_CACHE_LIMIT };
  }

  async function imageFor(source, objectId) {
    if (!source.previewImages) source.previewImages = new Map();
    const cached = source.previewImages.get(objectId);
    if (cached) {
      source.previewImages.delete(objectId);
      source.previewImages.set(objectId, cached);
      return cached.promise;
    }
    const promise = (async () => {
      const rawStream = streamFor(source, objectId);
      const width = Number((rawStream.dict.match(/\/Width\s+(\d+)/) || [])[1]);
      const height = Number((rawStream.dict.match(/\/Height\s+(\d+)/) || [])[1]);
      if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 ||
          width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) throw new Error('Ảnh PDF có kích thước preview không hợp lệ.');
      const filters = streamFilters(rawStream.dict);
      const previewScale = Math.min(1, PREVIEW_SOURCE_MAX_EDGE / Math.max(width, height));
      const previewWidth = Math.max(1, Math.round(width * previewScale));
      const previewHeight = Math.max(1, Math.round(height * previewScale));
      if (filters.some(filter => filter === 'DCTDecode' || filter === 'DCT')) {
        if (width * height > MAX_DECODED_BYTES / 4) throw new Error('Ảnh JPEG PDF vượt giới hạn bộ nhớ preview.');
        const stream = await decodeStream(source, objectId);
        const blob = new Blob([stream.bytes], { type: 'image/jpeg' });
        let image;
        let objectUrl = '';
        try {
          if (typeof createImageBitmap === 'function') {
            image = await createImageBitmap(blob, { resizeWidth: previewWidth, resizeHeight: previewHeight, resizeQuality: 'low' });
            const temp = document.createElement('canvas'); temp.width = previewWidth; temp.height = previewHeight;
            const context = temp.getContext('2d', { alpha: false }); context.fillStyle = '#fff'; context.fillRect(0, 0, previewWidth, previewHeight); context.drawImage(image, 0, 0, previewWidth, previewHeight);
            const imageData = context.getImageData(0, 0, previewWidth, previewHeight);
            image.close(); image = null;
            return { kind: 'pixels', imageData, width: previewWidth, height: previewHeight };
          }
          const element = new Image();
          objectUrl = URL.createObjectURL(blob); element.src = objectUrl;
          await new Promise((resolve, reject) => { element.onload = resolve; element.onerror = () => reject(new Error('Không giải mã được ảnh JPEG trong PDF.')); });
          const temp = document.createElement('canvas'); temp.width = previewWidth; temp.height = previewHeight;
          const context = temp.getContext('2d', { alpha: false }); context.fillStyle = '#fff'; context.fillRect(0, 0, previewWidth, previewHeight); context.drawImage(element, 0, 0, previewWidth, previewHeight);
          return { kind: 'pixels', imageData: context.getImageData(0, 0, previewWidth, previewHeight), width: previewWidth, height: previewHeight };
        } finally {
          if (objectUrl) URL.revokeObjectURL(objectUrl);
          if (image) image.close();
        }
      }
      const bits = Number((rawStream.dict.match(/\/BitsPerComponent\s+(\d+)/) || [])[1] || 8);
      const colorSpace = rawStream.dict.match(/\/ColorSpace\s+\/(DeviceRGB|DeviceGray|DeviceCMYK)/)?.[1] || 'DeviceRGB';
      const components = colorSpace === 'DeviceGray' ? 1 : colorSpace === 'DeviceCMYK' ? 4 : 3;
      if (bits !== 8 && !(bits === 1 && (components === 1 || components === 3))) throw new Error('Ảnh PDF chỉ hỗ trợ 8-bit màu hoặc 1-bit grayscale/RGB.');
      const rowBytes = bits === 1 ? Math.ceil(width / 8) : width * components;
      const decodedLimit = rowBytes * height;
      if (!Number.isSafeInteger(decodedLimit) || decodedLimit <= 0 || decodedLimit > MAX_DECODED_BYTES) throw new Error('Ảnh PDF vượt giới hạn bộ nhớ preview.');
      const stream = await decodeStream(source, objectId, MAX_DECODED_BYTES);
      const predictor = Number((rawStream.dict.match(/\/Predictor\s+(\d+)/) || [])[1] || 1);
      if (bits === 1 && predictor > 1) throw new Error('Ảnh PDF 1-bit với predictor chưa được hỗ trợ.');
      const pixels = bits === 1 ? stream.bytes : decodePredictor(stream.bytes, width, components, predictor);
      if (pixels.length < decodedLimit) throw new Error('Ảnh PDF thiếu dữ liệu pixel.');
      const decode = rawStream.dict.match(/\/Decode\s+\[\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\]/)?.slice(1).map(Number);
      const invertBitonal = bits === 1 && decode?.[0] > decode?.[1];
      const rgba = new Uint8ClampedArray(previewWidth * previewHeight * 4);
      for (let y = 0; y < previewHeight; y++) {
        const sourceY = Math.min(height - 1, Math.floor(y * height / previewHeight));
        for (let x = 0; x < previewWidth; x++) {
          const sourceX = Math.min(width - 1, Math.floor(x * width / previewWidth));
          let p = (sourceY * width + sourceX) * components;
          let r, g, b;
          if (bits === 1) {
            const bitAt = component => (pixels[sourceY * rowBytes + Math.floor((sourceX * components + component) / 8)] >> (7 - (sourceX * components + component) % 8)) & 1;
            if (components === 1) { const bit = bitAt(0); r = g = b = (bit ^ Number(invertBitonal)) ? 255 : 0; }
            else { r = bitAt(0) ? 255 : 0; g = bitAt(1) ? 255 : 0; b = bitAt(2) ? 255 : 0; }
          }
          else if (components === 1) r = g = b = pixels[p++] ?? 255;
          else if (components === 4) {
            const c = (pixels[p++] ?? 0) / 255, m = (pixels[p++] ?? 0) / 255, yv = (pixels[p++] ?? 0) / 255, k = (pixels[p++] ?? 0) / 255;
            r = 255 * (1 - Math.min(1, c + k)); g = 255 * (1 - Math.min(1, m + k)); b = 255 * (1 - Math.min(1, yv + k));
          } else { r = pixels[p++] ?? 255; g = pixels[p++] ?? 255; b = pixels[p++] ?? 255; }
          const offset = (y * previewWidth + x) * 4;
          rgba[offset] = r; rgba[offset + 1] = g; rgba[offset + 2] = b; rgba[offset + 3] = 255;
        }
      }
      return { kind: 'pixels', imageData: new ImageData(rgba, previewWidth, previewHeight), width: previewWidth, height: previewHeight };
    })();
    return cachePreview(source, objectId, promise).catch(error => {
      const entry = source.previewImages?.get(objectId);
      if (entry?.promise === promise) source.previewImages.delete(objectId);
      throw error;
    });
  }
  function tokenizeContent(value) {
    const tokens = [];
    let i = 0;
    while (i < value.length) {
      if (/\s/.test(value[i])) { i++; continue; }
      if (value[i] === '%') { while (i < value.length && value[i] !== '\n' && value[i] !== '\r') i++; continue; }
      if (value[i] === '(') {
        let depth = 1, out = ''; i++;
        while (i < value.length && depth) {
          const char = value[i++];
          if (char === '\\' && i < value.length) { out += value[i++]; continue; }
          if (char === '(') depth++;
          else if (char === ')') depth--;
          if (depth) out += char;
        }
        tokens.push({ type: 'string', value: out }); continue;
      }
      if (value[i] === '/') { let start = ++i; while (i < value.length && !/[\s\[\]()<>]/.test(value[i])) i++; tokens.push({ type: 'name', value: value.slice(start, i) }); continue; }
      if (value[i] === '[' || value[i] === ']') { tokens.push(value[i++]); continue; }
      const match = value.slice(i).match(/^(?:[+-]?(?:\d+\.?\d*|\.\d+)|[A-Za-z*]+)/);
      if (match) { tokens.push(match[0]); i += match[0].length; continue; }
      i++;
    }
    return tokens;
  }

  async function paintContent(source, content, ctx, imageRefs) {
    const tokens = tokenizeContent(content);
    const stack = [];
    const graphics = [];
    let path = false;
    const number = value => typeof value === 'string' && /^[-+]?\d*\.?\d+$/.test(value) ? Number(value) : null;
    for (const token of tokens) {
      if (typeof token !== 'string' || number(token) !== null || token === '[' || token === ']') { stack.push(token); continue; }
      const take = count => stack.splice(Math.max(0, stack.length - count), count);
      try {
        if (token === 'q') { ctx.save(); graphics.push(true); }
        else if (token === 'Q') { if (graphics.pop()) ctx.restore(); }
        else if (token === 'cm') { const [a,b,c,d,e,f] = take(6).map(Number); ctx.transform(a,b,c,d,e,f); }
        else if (token === 'w') ctx.lineWidth = Math.max(.25, Number(take(1)[0]));
        else if (token === 'rg' || token === 'RG') { const [r,g,b] = take(3).map(Number); ctx[token === 'rg' ? 'fillStyle' : 'strokeStyle'] = `rgb(${r * 255},${g * 255},${b * 255})`; }
        else if (token === 'g' || token === 'G') { const [g] = take(1).map(Number); ctx[token === 'g' ? 'fillStyle' : 'strokeStyle'] = `rgb(${g * 255},${g * 255},${g * 255})`; }
        else if (token === 'm') { const [x,y] = take(2).map(Number); ctx.moveTo(x,y); path = true; }
        else if (token === 'l') { const [x,y] = take(2).map(Number); ctx.lineTo(x,y); path = true; }
        else if (token === 're') { const [x,y,w,h] = take(4).map(Number); ctx.rect(x,y,w,h); path = true; }
        else if (token === 'h') ctx.closePath();
        else if (token === 'S' || token === 's') { if (path) { if (token === 's') ctx.closePath(); ctx.stroke(); ctx.beginPath(); path = false; } }
        else if (token === 'f' || token === 'F' || token === 'f*') { if (path) { ctx.fill(token === 'f*' ? 'evenodd' : 'nonzero'); ctx.beginPath(); path = false; } }
        else if (token === 'Do') {
          const name = take(1)[0]?.value, objectId = imageRefs.get(name);
          if (!objectId) continue;
          const image = await imageFor(source, objectId);
          if (image.kind === 'pixels') {
            const temp = document.createElement('canvas'); temp.width = image.width; temp.height = image.height;
            temp.getContext('2d').putImageData(image.imageData, 0, 0); ctx.drawImage(temp, 0, 0, 1, 1);
          } else ctx.drawImage(image.image, 0, 0, 1, 1);
        }
        else if (token === 'Td' || token === 'TD') { const [x,y] = take(2).map(Number); ctx.translate(x,y); }
        else if (token === 'Tf') take(2);
        else if (token === 'Tj') { const text = take(1)[0]; if (text?.type === 'string') { ctx.font = '10px sans-serif'; ctx.fillText(text.value.slice(0, 80), 0, 0); } }
        else if (token === 'T*') ctx.translate(0, -12);
        else if (token === 'BT' || token === 'ET') continue;
        else stack.push(token);
      } catch (error) {
        throw error;
      }
    }
    while (graphics.length) { graphics.pop(); ctx.restore(); }
  }

  let pdfJsLibraryPromise = null;

  function pdfJsLibrary() {
    if (!pdfJsLibraryPromise) {
      pdfJsLibraryPromise = import('./assets/vendor/pdfjs/pdf.mjs').then(pdfjs => {
        pdfjs.GlobalWorkerOptions.workerSrc = new URL('./assets/vendor/pdfjs/pdf.worker.mjs', document.baseURI).href;
        return pdfjs;
      });
    }
    return pdfJsLibraryPromise;
  }

  async function pdfJsDocument(source) {
    if (!source.previewPdfDocument) {
      const pdfjs = await pdfJsLibrary();
      // Bitonal scans (CCITTFax/JBIG2) and JPEG 2000 scans decode inside these
      // wasm modules; without a local wasmUrl pdf.js paints the page white.
      const wasmUrl = new URL('./assets/vendor/pdfjs/wasm/', document.baseURI).href;
      const task = pdfjs.getDocument({ data: source.bytes.slice(), isEvalSupported: false, useWorkerFetch: false, wasmUrl });
      source.previewPdfLoadingTask = task;
      source.previewPdfDocument = task.promise;
    }
    return source.previewPdfDocument;
  }

  function hasContentPixels(canvas) {
    if (!canvas || !canvas.width || !canvas.height) return false;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let nonWhite = 0;
    const totalSamples = Math.floor(d.length / 16);
    for (let i = 0; i < d.length; i += 16) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      if (r < 245 || g < 245 || b < 245) nonWhite++;
    }
    return (nonWhite / totalSamples) > 0.0005;
  }

  async function sourceHasInk(ref) {
    try {
      const info = pageInfo(ref.source, ref.index);
      const xobjs = xObjectRefs(ref.source, info.body);
      if (!xobjs.size) {
        for (const objectId of refsAfter(info.body, 'Contents')) {
          const stream = await decodeStream(ref.source, objectId);
          const text = decoder.decode(stream.bytes);
          if (/\b0\s+0\s+0\s+(rg|RG|k|K)\b|\b[0-9.]+\s+[0-9.]+\s+[0-9.]+\s+(rg|RG)\b/.test(text)) {
            return true;
          }
        }
        return false;
      }
      for (const [, id] of xobjs) {
        const filters = streamFilters(streamFor(ref.source, id).dict);
        // Filters this build cannot decode locally (CCITTFaxDecode, JBIG2Decode,
        // JPXDecode...) make a blank canvas unverifiable, so treat the page as
        // inked rather than accepting a silently white preview.
        if (filters.some(filter => !LOCALLY_DECODABLE_FILTERS.has(filter))) return true;
        const stream = await decodeStream(ref.source, id);
        if (filters.includes('DCTDecode') || filters.includes('DCT')) {
          const blob = new Blob([stream.bytes], { type: 'image/jpeg' });
          const img = await createImageBitmap(blob);
          const c = document.createElement('canvas');
          c.width = Math.min(img.width, 120);
          c.height = Math.min(img.height, 120);
          const cx = c.getContext('2d');
          cx.drawImage(img, 0, 0, c.width, c.height);
          if (hasContentPixels(c)) return true;
        } else {
          const bytes = stream.bytes;
          let nonWhite = 0;
          const total = Math.floor(bytes.length / 16);
          for (let i = 0; i < bytes.length; i += 16) {
            if (bytes[i] < 245) nonWhite++;
          }
          if (nonWhite / Math.max(1, total) > 0.0005) return true;
        }
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  async function renderPdfJsThumbnail(ref, canvas, maxEdge, isCurrent, extraRotation) {
    const documentProxy = await pdfJsDocument(ref.source);
    if (!isCurrent()) return { stale: true };
    const page = await documentProxy.getPage(ref.index + 1);
    const rotation = ((Number(page.rotate || 0) + Number(extraRotation || 0)) % 360 + 360) % 360;
    let viewport = page.getViewport({ scale: 1, rotation });
    const scale = Math.min(1, maxEdge / Math.max(viewport.width, viewport.height));
    viewport = page.getViewport({ scale, rotation });
    const width = Math.max(1, Math.round(viewport.width));
    const height = Math.max(1, Math.round(viewport.height));
    const layer = document.createElement('canvas');
    layer.width = width; layer.height = height;
    const context = layer.getContext('2d', { alpha: false });
    context.fillStyle = '#fff'; context.fillRect(0, 0, width, height);
    try {
      await page.render({ canvasContext: context, viewport, background: '#fff' }).promise;
    } finally {
      page.cleanup();
    }
    if (!isCurrent()) return { stale: true };

    const hasContent = hasContentPixels(layer);
    if (!hasContent) {
      const hasSourceInk = await sourceHasInk(ref);
      if (hasSourceInk) {
        throw new Error('PDF.js dựng canvas trắng bất thường khi tài liệu nguồn có nội dung.');
      }
    }

    canvas.width = width; canvas.height = height;
    const output = canvas.getContext('2d', { alpha: false });
    output.fillStyle = '#fff'; output.fillRect(0, 0, width, height);
    output.drawImage(layer, 0, 0);
    return { width, height, rotation, renderer: 'pdfjs', layer, isBlank: !hasContent };
  }

  async function renderThumbnailFallback(ref, canvas, maxEdge = 320, isCurrent = () => true, extraRotation = 0) {
    if (!ref?.source || !canvas?.getContext) throw new Error('Thumbnail PDF không hợp lệ.');
    const info = pageInfo(ref.source, ref.index);
    const rotation = ((info.rotation + Number(extraRotation || 0)) % 360 + 360) % 360;
    const scale = Math.min(1, maxEdge / Math.max(info.width, info.height));
    const outputWidth = Math.max(1, Math.round((rotation % 180 ? info.height : info.width) * scale));
    const outputHeight = Math.max(1, Math.round((rotation % 180 ? info.width : info.height) * scale));
    const baseWidth = Math.max(1, Math.round(info.rawWidth * scale));
    const baseHeight = Math.max(1, Math.round(info.rawHeight * scale));
    const layer = document.createElement('canvas'); layer.width = baseWidth; layer.height = baseHeight;
    const layerCtx = layer.getContext('2d', { alpha: false }); layerCtx.fillStyle = '#fff'; layerCtx.fillRect(0, 0, baseWidth, baseHeight);
    layerCtx.setTransform(scale, 0, 0, -scale, -info.box[0] * scale, info.box[3] * scale);
    const imageRefs = xObjectRefs(ref.source, info.body);
    for (const objectId of refsAfter(info.body, 'Contents')) {
      if (!isCurrent()) return { stale: true };
      const stream = await decodeStream(ref.source, objectId);
      await paintContent(ref.source, decoder.decode(stream.bytes), layerCtx, imageRefs);
    }
    if (!isCurrent()) return { stale: true };

    const targetLayer = document.createElement('canvas');
    targetLayer.width = outputWidth; targetLayer.height = outputHeight;
    const targetCtx = targetLayer.getContext('2d', { alpha: false });
    targetCtx.fillStyle = '#fff'; targetCtx.fillRect(0, 0, outputWidth, outputHeight);
    targetCtx.save();
    if (rotation === 90) { targetCtx.translate(outputWidth, 0); targetCtx.rotate(Math.PI / 2); targetCtx.drawImage(layer, 0, 0, outputHeight, outputWidth); }
    else if (rotation === 180) { targetCtx.translate(outputWidth, outputHeight); targetCtx.rotate(Math.PI); targetCtx.drawImage(layer, 0, 0, outputWidth, outputHeight); }
    else if (rotation === 270) { targetCtx.translate(0, outputHeight); targetCtx.rotate(-Math.PI / 2); targetCtx.drawImage(layer, 0, 0, outputHeight, outputWidth); }
    else targetCtx.drawImage(layer, 0, 0, outputWidth, outputHeight);
    targetCtx.restore();

    const hasContent = hasContentPixels(targetLayer);
    if (!hasContent) {
      const hasSourceInk = await sourceHasInk(ref);
      if (hasSourceInk) {
        throw new Error('Fallback dựng canvas trắng bất thường khi tài liệu nguồn có nội dung.');
      }
    }

    canvas.width = outputWidth; canvas.height = outputHeight;
    const ctx = canvas.getContext('2d', { alpha: false }); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, outputWidth, outputHeight);
    ctx.drawImage(targetLayer, 0, 0);
    return { width: outputWidth, height: outputHeight, rotation, renderer: 'fallback', layer: targetLayer, isBlank: !hasContent };
  }

  async function renderThumbnail(ref, canvas, maxEdge = 320, isCurrent = () => true, extraRotation = 0) {
    if (!ref?.source || !canvas?.getContext) throw new Error('Thumbnail PDF không hợp lệ.');
    let pdfJsError = null;
    try {
      return await renderPdfJsThumbnail(ref, canvas, maxEdge, isCurrent, extraRotation);
    } catch (err) {
      pdfJsError = err;
      if (!isCurrent()) return { stale: true };
      console.warn(`[PartyPdf] PDF.js không dựng được trang ${ref.index + 1} (${ref.source.name || 'PDF'}): ${err?.message || err}. Thử fallback renderer.`);
    }

    let fallbackError = null;
    try {
      const result = await renderThumbnailFallback(ref, canvas, maxEdge, isCurrent, extraRotation);
      if (result && !result.stale) {
        console.info(`[PartyPdf] Fallback renderer dựng thành công trang ${ref.index + 1} (${ref.source.name || 'PDF'}).`);
      }
      return result;
    } catch (err) {
      fallbackError = err;
    }

    // Name the encoding when both renderers stopped at a filter neither can
    // decode, so the operator reads a cause instead of two stack messages.
    const unsupportedFilter = /chưa hỗ trợ: ([A-Za-z0-9]+)/.exec(fallbackError?.message || '')?.[1];
    const finalError = new Error(unsupportedFilter
      ? `Trang ${ref.index + 1} dùng ảnh nén ${unsupportedFilter}; bản PDF.js đóng gói trong ứng dụng không có bộ giải mã cho định dạng này nên chưa dựng được ảnh xem trước.`
      : `Không thể hiển thị xem trước trang ${ref.index + 1} (PDF.js: ${pdfJsError?.message || 'lỗi dựng hình'}, Fallback: ${fallbackError?.message || 'không hỗ trợ'})`);
    console.error('[PartyPdf Preview Failure]', {
      sourceFile: ref.source.name,
      sourcePage: ref.index + 1,
      renderer: 'error',
      pdfJsError: pdfJsError?.message || String(pdfJsError),
      fallbackError: fallbackError?.message || String(fallbackError)
    });
    throw finalError;
  }

  function rewriteRefs(text, map) {
    return text.replace(/(\d+)\s+(\d+)\s+R\b/g, (full, id, generation) => {
      const replacement = map.get(Number(id));
      return replacement ? `${replacement} 0 R` : `${id} ${generation} R`;
    });
  }

  function rewriteObjectBytes(object, map) {
    const text = object.text;
    const stream = streamMarker(text, 0);
    if (stream < 0) return latin1Encode(rewriteRefs(text, map));
    let dataStart;
    let endStream;
    if (object.streamDataStart !== undefined && object.endStreamOffset !== undefined) {
      dataStart = object.streamDataStart;
      endStream = object.endStreamOffset;
    } else {
      dataStart = stream + 6;
      if (text[dataStart] === '\r' && text[dataStart + 1] === '\n') dataStart += 2;
      else if (text[dataStart] === '\n' || text[dataStart] === '\r') dataStart += 1;
      endStream = text.indexOf('endstream', dataStart);
    }
    if (endStream < 0) throw new Error(`PDF object ${object.id} thiếu endstream.`);
    const prefix = latin1Encode(rewriteRefs(text.slice(0, dataStart), map));
    const streamBytes = object.bytes.slice(dataStart, endStream);
    const suffix = latin1Encode(rewriteRefs(text.slice(endStream), map));
    return concat([prefix, streamBytes, suffix]);
  }

  function replaceResourceDict(body, newResText) {
    const start = body.indexOf('/Resources');
    if (start < 0) return body;
    const valueStart = skipPdfSpace(body, start + 10);
    const valueEnd = pdfValueEnd(body, valueStart);
    if (valueEnd < 0) return body;
    return body.slice(0, valueStart) + newResText + body.slice(valueEnd);
  }

  function stripWatermarkFromContentStream(streamText, watermarkNames) {
    if (!streamText || !watermarkNames) return streamText || '';
    const names = Array.isArray(watermarkNames) || (watermarkNames instanceof Set)
      ? Array.from(watermarkNames)
      : [watermarkNames];
    let cleaned = streamText;
    for (const rawName of names) {
      const name = rawName.startsWith('/') ? rawName.slice(1) : rawName;
      const esc = name.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
      // 1. Standard pattern: q ... cm /ImX Do Q (với /Perceptual ri hoặc toán tử khác trước cm)
      const p1 = new RegExp(`q\\s*(?:\\/[A-Za-z0-9]+\\s+ri\\s*)?(?:[-+]?(?:\\d+\\.?\\d*|\\.\\d+)\\s+){6}cm\\s*\\/${esc}\\s+Do\\s*Q\\s*`, 'g');
      cleaned = cleaned.replace(p1, '');
      // 2. Fallback: khối q ... /ImX Do ... Q
      const p2 = new RegExp(`q\\s*[^qQ]*?\\/${esc}\\s+Do\\s*[^qQ]*?Q\\s*`, 'g');
      cleaned = cleaned.replace(p2, '');
      // 3. Fallback: lệnh đơn lẻ /ImX Do
      const p3 = new RegExp(`\\/${esc}\\s+Do\\b`, 'g');
      cleaned = cleaned.replace(p3, '');
    }
    return cleaned.trim();
  }

  function detectCamScannerWatermarks(source) {
    const watermarkPages = [];
    for (let index = 0; index < source.pageIds.length; index++) {
      const pageId = source.pageIds[index];
      const page = source.objects.get(pageId);
      if (!page) continue;
      let body;
      try {
        body = inheritedPageText(source.objects, pageId);
      } catch (_) {
        continue;
      }
      const xobjs = xObjectRefs(source, body);
      if (!xobjs || xobjs.size < 2) continue;

      let box = [0, 0, 595.28, 841.89];
      try {
        const boxVal = numberArray(valueForKey(body, 'CropBox') || valueForKey(body, 'MediaBox'));
        if (boxVal.length >= 4 && boxVal[2] > boxVal[0] && boxVal[3] > boxVal[1]) box = boxVal;
      } catch (_) {}
      const pageHeight = box[3] - box[1];

      // Tìm tất cả đối tượng ảnh XObject trên trang
      const images = [];
      for (const [name, objId] of xobjs) {
        const obj = source.objects.get(objId);
        if (!obj) continue;
        const stream = streamMarker(obj.text, 0);
        const dict = stream < 0 ? obj.text : obj.text.slice(0, stream);
        if (!/\/Subtype\s*\/Image\b/.test(dict)) continue;
        const w = Number((dict.match(/\/Width\s+(\d+)/) || [])[1]);
        const h = Number((dict.match(/\/Height\s+(\d+)/) || [])[1]);
        if (Number.isSafeInteger(w) && Number.isSafeInteger(h) && w > 0 && h > 0) {
          images.push({ name, objId, width: w, height: h, dict });
        }
      }

      // Phải tồn tại ít nhất 1 ảnh quét văn bản chính có độ phân giải lớn
      const hasMainImage = images.some(img => (img.width >= 500 && img.height >= 500) || (img.width * img.height >= 500000));
      if (!hasMainImage) continue;

      // Nhận diện ứng viên logo CamScanner theo đặc tả heuristic:
      // (w in [240, 166, 160, 200, 180]) hoặc (140 <= w <= 270 && 45 <= h <= 110)
      // Tỷ lệ w / h nằm trong khoảng 1.8 đến 4.0
      const candidates = images.filter(img => {
        const isCsCommonSize = (img.width === 240 && img.height === 90) ||
                               (img.width === 166 && img.height === 62) ||
                               (img.width === 160 && img.height === 60) ||
                               (img.width === 200 && img.height === 75) ||
                               (img.width === 180 && img.height === 68);
        const isSizeInRange = (img.width >= 140 && img.width <= 270 && img.height >= 45 && img.height <= 110);
        const ratio = img.width / img.height;
        const isRatioMatch = ratio >= 1.8 && ratio <= 4.0;
        return (isCsCommonSize || (isSizeInRange && isRatioMatch));
      });

      if (!candidates.length) continue;

      // Giải mã content stream của trang để kiểm tra vị trí vẽ
      const contentIds = refsAfter(body, 'Contents');
      let combinedContent = '';
      for (const cid of contentIds) {
        try {
          const stream = streamFor(source, cid);
          const filters = streamFilters(stream.dict);
          let rawBytes = stream.bytes;
          if (filters.some(f => f === 'FlateDecode' || f === 'Fl')) {
            rawBytes = inflateSync(rawBytes);
          }
          combinedContent += ' ' + decoder.decode(rawBytes);
        } catch (_) {}
      }

      for (const candidate of candidates) {
        const esc = candidate.name.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
        const doMatch = new RegExp(`(?:[-+]?(?:\\d+\\.?\\d*|\\.\\d+)\\s+){6}cm\\s*\\/${esc}\\s+Do\\b`).exec(combinedContent);
        let placement = null;
        let isBottomRegion = false;
        if (doMatch) {
          const nums = doMatch[0].match(/[-+]?(?:\d+\.?\d*|\.\d+)/g)?.map(Number);
          if (nums && nums.length >= 6) {
            const [a, b, c, d, e, f] = nums;
            placement = { a, b, c, d, x: e, y: f };
            if (f <= box[1] + pageHeight * 0.25) {
              isBottomRegion = true;
            }
          }
        } else if (new RegExp(`\\/${esc}\\s+Do\\b`).test(combinedContent)) {
          isBottomRegion = true;
        }

        if (isBottomRegion) {
          watermarkPages.push({
            pageIndex: index,
            pageId,
            watermarkName: candidate.name,
            xobjectId: candidate.objId,
            width: candidate.width,
            height: candidate.height,
            placement
          });
        }
      }
    }

    return {
      hasWatermarks: watermarkPages.length > 0,
      totalPages: source.pageCount,
      watermarkPages
    };
  }

  function copyPageObjects(pageRefs, imageItems = [], mixedItems = null, options = {}) {
    const records = new Map();
    const sourceMaps = new Map();
    let nextId = 3;

    function mapFor(source) {
      if (!sourceMaps.has(source.id)) sourceMaps.set(source.id, new Map());
      return sourceMaps.get(source.id);
    }

    function assignSourceObject(source, objectId) {
      const map = mapFor(source);
      if (map.has(objectId)) return map.get(objectId);
      const outputId = nextId++;
      map.set(objectId, outputId);
      const object = source.objects.get(objectId);
      if (!object) throw new Error(`PDF thiếu object ${objectId}.`);
      records.set(outputId, { kind: 'source', source, object });
      refsIn(object.text).forEach(ref => assignSourceObject(source, ref));
      return outputId;
    }

    const inputItems = mixedItems || [
      ...pageRefs.map(ref => ({ kind: 'pdf', ref })),
      ...imageItems.map(item => ({ kind: 'image', item }))
    ];

    // Nhận diện watermark nếu được yêu cầu bóc tách
    const stripWm = !!options.stripWatermarks;
    const pageWmMap = new Map();
    if (stripWm) {
      const checkedSources = new Set();
      inputItems.forEach(entry => {
        if (entry.kind === 'pdf' && entry.ref?.source && !checkedSources.has(entry.ref.source)) {
          checkedSources.add(entry.ref.source);
          const detected = detectCamScannerWatermarks(entry.ref.source);
          if (detected.hasWatermarks) {
            detected.watermarkPages.forEach(wp => {
              const key = `${entry.ref.source.id}:${wp.pageId}`;
              if (!pageWmMap.has(key)) pageWmMap.set(key, { wmNames: new Set(), wmObjIds: new Set() });
              const info = pageWmMap.get(key);
              info.wmNames.add(wp.watermarkName);
              info.wmObjIds.add(wp.xobjectId);
            });
          }
        }
      });
    }

    const pageRecords = [];
    inputItems.forEach(entry => {
      if (entry.kind === 'pdf') {
        const ref = entry.ref;
        if (!ref || !ref.source) throw new Error('Page reference không hợp lệ.');
        let body = inheritedPageText(ref.source.objects, ref.objectId);
        const wmKey = `${ref.source.id}:${ref.objectId}`;
        const wmInfo = pageWmMap.get(wmKey);

        if (wmInfo && wmInfo.wmNames.size > 0) {
          // Bóc tách đối tượng XObject watermark khỏi từ điển Resources
          const resText = directResourceDict(ref.source, body);
          let cleanResText = resText;
          wmInfo.wmNames.forEach(name => {
            const esc = name.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
            cleanResText = cleanResText.replace(new RegExp(`\\/${esc}\\s+\\d+\\s+\\d+\\s+R`, 'g'), '');
          });
          body = replaceResourceDict(body, cleanResText);

          // Bóc tách khối lệnh vẽ watermark khỏi luồng Content Stream
          const contentIds = refsAfter(body, 'Contents');
          contentIds.forEach(cId => {
            try {
              const stream = streamFor(ref.source, cId);
              const filters = streamFilters(stream.dict);
              let rawBytes = stream.bytes;
              if (filters.some(f => f === 'FlateDecode' || f === 'Fl')) {
                rawBytes = inflateSync(rawBytes);
              }
              const text = decoder.decode(rawBytes);
              const cleanedText = stripWatermarkFromContentStream(text, wmInfo.wmNames);
              const newContentBytes = bytesFor(cleanedText);
              const outputCid = nextId++;
              mapFor(ref.source).set(cId, outputCid);
              records.set(outputCid, {
                kind: 'text',
                text: `<< /Length ${newContentBytes.length} >>\nstream\n${cleanedText}\nendstream`
              });
            } catch (_) {}
          });
        }

        refsIn(body).forEach(id => assignSourceObject(ref.source, id));
        pageRecords.push({ kind: 'page', source: ref.source, body, rotation: Number(entry.rotation) || 0 });
        return;
      }
      const item = entry.item;
      if (!item?.bytes?.length || !item.width || !item.height) throw new Error('Trang ảnh không hợp lệ.');
      const imageId = nextId++;
      const contentId = nextId++;
      const pageId = nextId++;
      const imageName = `Im${imageId}`;
      records.set(imageId, { kind: 'image', id: imageId, item, imageName });
      const pw = item.pageMode === 'a4' ? (item.height >= item.width ? 595.28 : 841.89) : 595.28;
      const ph = item.pageMode === 'a4' ? (item.height >= item.width ? 841.89 : 595.28) : Math.max(240, Math.min(1200, pw * item.height / item.width));
      const pad = item.margin ? 18 : 0;
      const scale = Math.min((pw - 2 * pad) / item.width, (ph - 2 * pad) / item.height);
      const dw = item.width * scale, dh = item.height * scale;
      const dx = (pw - dw) / 2, dy = (ph - dh) / 2;
      const content = `q\n${dw.toFixed(2)} 0 0 ${dh.toFixed(2)} ${dx.toFixed(2)} ${dy.toFixed(2)} cm\n/${imageName} Do\nQ\n`;
      records.set(contentId, { kind: 'text', text: `<< /Length ${bytesFor(content).length} >>\nstream\n${content}endstream` });
      records.set(pageId, { kind: 'text', text: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw.toFixed(2)} ${ph.toFixed(2)}] /Resources << /XObject << /${imageName} ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>` });
      pageRecords.push({ kind: 'existing', id: pageId });
    });
    const pageIds = [];
    pageRecords.forEach(record => {
      if (record.kind === 'page') {
        const map = mapFor(record.source);
        const body = rewriteRefs(record.body, map).replace(/\/Parent\s+\d+\s+\d+\s+R\b/g, '');
        const inheritedRotation = Number(valueForKey(body, 'Rotate')) || 0;
        const rotation = ((inheritedRotation + record.rotation) % 360 + 360) % 360;
        const withoutRotation = body.replace(/\/Rotate\s+-?\d+(?:\.\d+)?\b/g, '');
        const normalized = withoutRotation.replace(/>>\s*$/, ` /Rotate ${rotation} /Parent 2 0 R >>`);
        const pageId = nextId++;
        records.set(pageId, { kind: 'text', text: normalized });
        pageIds.push(pageId);
      } else pageIds.push(record.id);
    });

    // Source objects may have been assigned before page wrapper IDs. Their IDs
    // are stable; page wrappers are appended now and remain valid references.
    const catalog = `<< /Type /Catalog /Pages 2 0 R >>`;
    const pages = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
    const ordered = [{ id: 1, kind: 'text', text: catalog }, { id: 2, kind: 'text', text: pages }];
    records.forEach((record, id) => ordered.push({ ...record, id }));
    ordered.sort((a, b) => a.id - b.id);

    const chunks = [bytesFor('%PDF-1.4\n%VigilLens-Party\n')];
    const offsets = [0];
    let position = chunks[0].length;
    ordered.forEach(record => {
      offsets[record.id] = position;
      const head = bytesFor(`${record.id} 0 obj\n`);
      chunks.push(head); position += head.length;
      let body;
      if (record.kind === 'source') body = rewriteObjectBytes(record.object, mapFor(record.source));
      else if (record.kind === 'image') {
        const item = record.item;
        const prefix = bytesFor(`<< /Type /XObject /Subtype /Image /Width ${item.width} /Height ${item.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${item.bytes.length} >>\nstream\n`);
        const suffix = bytesFor('\nendstream');
        body = concat([prefix, item.bytes, suffix]);
      } else body = bytesFor(record.text);
      chunks.push(body); position += body.length;
      const tail = bytesFor('\nendobj\n'); chunks.push(tail); position += tail.length;
    });
    const xrefPosition = position;
    let xref = `xref\n0 ${ordered.length + 1}\n0000000000 65535 f \n`;
    for (let id = 1; id <= ordered.length; id++) xref += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
    xref += `trailer\n<< /Size ${ordered.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPosition}\n%%EOF`;
    chunks.push(bytesFor(xref));
    return new Blob([concat(chunks)], { type: 'application/pdf' });
  }

  function buildPdf(pageRefs, imageItems = [], options = {}) {
    if (!pageRefs.length && !imageItems.length) throw new Error('Không có trang để xuất.');
    return copyPageObjects(pageRefs, imageItems, null, options);
  }

  function buildMixedPdf(items, options = {}) {
    if (!items?.length) throw new Error('Không có trang để xuất.');
    return copyPageObjects([], [], items, options);
  }

  function stripWatermarks(pdfBytes, options = {}) {
    const bytes = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
    const source = sourceFromBuffer(bytes, options.name || 'document.pdf');
    const detected = detectCamScannerWatermarks(source);
    if (!detected.hasWatermarks) {
      return {
        blob: new Blob([bytes], { type: 'application/pdf' }),
        bytes,
        totalPages: source.pageCount,
        removedCount: 0,
        removedPages: [],
        unmodified: true
      };
    }
    const pageRefs = source.pageIds.map((_, i) => source.page(i));
    const blob = copyPageObjects(pageRefs, [], null, { stripWatermarks: true });
    return {
      blob,
      totalPages: source.pageCount,
      removedCount: detected.watermarkPages.length,
      removedPages: detected.watermarkPages,
      unmodified: false
    };
  }

  window.PartyPdf = {
    parse,
    sourceFromBuffer,
    pageInfo,
    renderThumbnail,
    previewCacheStats,
    releasePreviewCache,
    buildPdf,
    buildMixedPdf,
    detectCamScannerWatermarks,
    stripWatermarkFromContentStream,
    stripWatermarks,
    _inflateSync: inflateSync
  };
})();


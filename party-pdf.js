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

  function parseObjects(bytes) {
    const text = decoder.decode(bytes);
    const objects = new Map();
    const pattern = /(?:^|\n)\s*(\d+)\s+(\d+)\s+obj\b/g;
    let match;
    while ((match = pattern.exec(text))) {
      const id = Number(match[1]);
      const bodyStart = pattern.lastIndex;
      const end = text.indexOf('endobj', bodyStart);
      if (end < 0) throw new Error('PDF không hợp lệ: thiếu endobj.');
      objects.set(id, {
        id,
        generation: Number(match[2]),
        text: text.slice(bodyStart, end),
        bytes: bytes.slice(bodyStart, end)
      });
      pattern.lastIndex = end + 6;
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
      .filter(object => /\/Type\s*\/Page(?!s)\b/.test(object.text))
      .map(object => object.id);
  }

  function valueForKey(text, key) {
    const match = text.match(new RegExp(`/${key}\\s+((?:\\[[\\s\\S]*?\\])|(?:<<[\\s\\S]*?>>)|(?:-?\\d+(?:\\.\\d+)?\\s+-?\\d+(?:\\.\\d+)?\\s+R)|(?:-?\\d+(?:\\.\\d+)?))`));
    return match ? match[1] : null;
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
    const stream = object.text.indexOf('stream');
    if (stream < 0) throw new Error(`PDF object ${objectId} không có stream.`);
    let dataStart = stream + 6;
    if (object.text[dataStart] === '\r' && object.text[dataStart + 1] === '\n') dataStart += 2;
    else if (object.text[dataStart] === '\n' || object.text[dataStart] === '\r') dataStart += 1;
    const endStream = object.text.indexOf('endstream', dataStart);
    if (endStream < 0) throw new Error(`PDF object ${objectId} thiếu endstream.`);
    return { dict: object.text.slice(0, stream), bytes: object.bytes.slice(dataStart, endStream) };
  }

  function refsAfter(text, key) {
    const match = String(text || '').match(new RegExp(`/${key}\\s+([\\s\\S]*?)(?=\\s/(?:[A-Za-z]+)\\s|>>|$)`));
    if (!match) return [];
    const refs = [];
    const pattern = /(\d+)\s+(\d+)\s+R\b/g;
    let item;
    while ((item = pattern.exec(match[1]))) refs.push(Number(item[1]));
    return refs;
  }

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
    const match = String(dict || '').match(/\/Filter\s+(\[[\s\S]*?\]|\/[A-Za-z0-9]+)/);
    if (!match) return [];
    return Array.from(match[1].matchAll(/\/([A-Za-z0-9]+)/g), item => item[1]);
  }

  async function inflate(bytes) {
    if (typeof DecompressionStream === 'undefined') throw new Error('Trình duyệt không hỗ trợ giải nén PDF FlateDecode.');
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function decodeStream(source, objectId) {
    const stream = streamFor(source, objectId);
    let bytes = stream.bytes;
    for (const filter of streamFilters(stream.dict)) {
      if (filter === 'FlateDecode' || filter === 'Fl') bytes = await inflate(bytes);
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

  async function imageFor(source, objectId) {
    if (!source.previewImages) source.previewImages = new Map();
    if (source.previewImages.has(objectId)) return source.previewImages.get(objectId);
    const promise = (async () => {
      const stream = await decodeStream(source, objectId);
      const width = Number((stream.dict.match(/\/Width\s+(\d+)/) || [])[1]);
      const height = Number((stream.dict.match(/\/Height\s+(\d+)/) || [])[1]);
      if (!width || !height) throw new Error('Ảnh PDF thiếu kích thước.');
      const filters = streamFilters(stream.dict);
      if (filters.some(filter => filter === 'DCTDecode' || filter === 'DCT')) {
        const blob = new Blob([stream.bytes], { type: 'image/jpeg' });
        if (typeof createImageBitmap === 'function') return { kind: 'bitmap', image: await createImageBitmap(blob), width, height };
        const image = new Image();
        image.src = URL.createObjectURL(blob);
        await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('Không giải mã được ảnh JPEG trong PDF.')); });
        return { kind: 'image', image, width, height };
      }
      const bits = Number((stream.dict.match(/\/BitsPerComponent\s+(\d+)/) || [])[1] || 8);
      if (bits !== 8) throw new Error('Ảnh PDF chỉ hỗ trợ 8 bits/component.');
      const colorSpace = stream.dict.match(/\/ColorSpace\s+\/(DeviceRGB|DeviceGray|DeviceCMYK)/)?.[1] || 'DeviceRGB';
      const components = colorSpace === 'DeviceGray' ? 1 : colorSpace === 'DeviceCMYK' ? 4 : 3;
      const predictor = Number((stream.dict.match(/\/Predictor\s+(\d+)/) || [])[1] || 1);
      const pixels = decodePredictor(stream.bytes, width, components, predictor);
      const rgba = new Uint8ClampedArray(width * height * 4);
      for (let i = 0, p = 0; i < width * height; i++) {
        let r, g, b;
        if (components === 1) r = g = b = pixels[p++] ?? 255;
        else if (components === 4) {
          const c = (pixels[p++] ?? 0) / 255, m = (pixels[p++] ?? 0) / 255, y = (pixels[p++] ?? 0) / 255, k = (pixels[p++] ?? 0) / 255;
          r = 255 * (1 - Math.min(1, c + k)); g = 255 * (1 - Math.min(1, m + k)); b = 255 * (1 - Math.min(1, y + k));
        } else { r = pixels[p++] ?? 255; g = pixels[p++] ?? 255; b = pixels[p++] ?? 255; }
        const o = i * 4; rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = 255;
      }
      return { kind: 'pixels', imageData: new ImageData(rgba, width, height), width, height };
    })();
    source.previewImages.set(objectId, promise);
    try { return await promise; } catch (error) { source.previewImages.delete(objectId); throw error; }
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
      } catch (_) {
        stack.length = 0;
      }
    }
    while (graphics.length) { graphics.pop(); ctx.restore(); }
  }

  async function renderThumbnail(ref, canvas, maxEdge = 320) {
    if (!ref?.source || !canvas?.getContext) throw new Error('Thumbnail PDF không hợp lệ.');
    const info = pageInfo(ref.source, ref.index);
    const scale = Math.min(1, maxEdge / Math.max(info.width, info.height));
    const outputWidth = Math.max(1, Math.round(info.width * scale));
    const outputHeight = Math.max(1, Math.round(info.height * scale));
    const baseWidth = Math.max(1, Math.round(info.rawWidth * scale));
    const baseHeight = Math.max(1, Math.round(info.rawHeight * scale));
    const layer = document.createElement('canvas'); layer.width = baseWidth; layer.height = baseHeight;
    const layerCtx = layer.getContext('2d', { alpha: false }); layerCtx.fillStyle = '#fff'; layerCtx.fillRect(0, 0, baseWidth, baseHeight);
    layerCtx.setTransform(scale, 0, 0, -scale, -info.box[0] * scale, info.box[3] * scale);
    const imageRefs = xObjectRefs(ref.source, info.body);
    for (const objectId of refsAfter(info.body, 'Contents')) {
      const stream = await decodeStream(ref.source, objectId);
      await paintContent(ref.source, decoder.decode(stream.bytes), layerCtx, imageRefs);
    }
    canvas.width = outputWidth; canvas.height = outputHeight;
    const ctx = canvas.getContext('2d', { alpha: false }); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, outputWidth, outputHeight);
    ctx.save();
    if (info.rotation === 90) { ctx.translate(outputWidth, 0); ctx.rotate(Math.PI / 2); ctx.drawImage(layer, 0, 0, outputHeight, outputWidth); }
    else if (info.rotation === 180) { ctx.translate(outputWidth, outputHeight); ctx.rotate(Math.PI); ctx.drawImage(layer, 0, 0, outputWidth, outputHeight); }
    else if (info.rotation === 270) { ctx.translate(0, outputHeight); ctx.rotate(-Math.PI / 2); ctx.drawImage(layer, 0, 0, outputHeight, outputWidth); }
    else ctx.drawImage(layer, 0, 0, outputWidth, outputHeight);
    ctx.restore();
    return { width: outputWidth, height: outputHeight, rotation: info.rotation };
  }

  function rewriteRefs(text, map) {
    return text.replace(/(\d+)\s+(\d+)\s+R\b/g, (full, id, generation) => {
      const replacement = map.get(Number(id));
      return replacement ? `${replacement} 0 R` : `${id} ${generation} R`;
    });
  }

  function rewriteObjectBytes(object, map) {
    const text = object.text;
    const stream = text.indexOf('stream');
    if (stream < 0) return latin1Encode(rewriteRefs(text, map));
    let dataStart = stream + 6;
    if (text[dataStart] === '\r' && text[dataStart + 1] === '\n') dataStart += 2;
    else if (text[dataStart] === '\n' || text[dataStart] === '\r') dataStart += 1;
    const endStream = text.indexOf('endstream', dataStart);
    if (endStream < 0) throw new Error(`PDF object ${object.id} thiếu endstream.`);
    const prefix = latin1Encode(rewriteRefs(text.slice(0, dataStart), map));
    const streamBytes = object.bytes.slice(dataStart, endStream);
    const suffix = latin1Encode(rewriteRefs(text.slice(endStream), map));
    return concat([prefix, streamBytes, suffix]);
  }

  function copyPageObjects(pageRefs, imageItems = [], mixedItems = null) {
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
    const pageRecords = [];
    inputItems.forEach(entry => {
      if (entry.kind === 'pdf') {
        const ref = entry.ref;
        if (!ref || !ref.source) throw new Error('Page reference không hợp lệ.');
        const body = inheritedPageText(ref.source.objects, ref.objectId);
        refsIn(body).forEach(id => assignSourceObject(ref.source, id));
        pageRecords.push({ kind: 'page', source: ref.source, body });
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
        const normalized = body.replace(/>>\s*$/, ' /Parent 2 0 R >>');
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

  function buildPdf(pageRefs, imageItems = []) {
    if (!pageRefs.length && !imageItems.length) throw new Error('Không có trang để xuất.');
    return copyPageObjects(pageRefs, imageItems);
  }

  function buildMixedPdf(items) {
    if (!items?.length) throw new Error('Không có trang để xuất.');
    return copyPageObjects([], [], items);
  }

  window.PartyPdf = { parse, sourceFromBuffer, pageInfo, renderThumbnail, buildPdf, buildMixedPdf };
})();

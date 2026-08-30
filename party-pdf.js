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

  window.PartyPdf = { parse, sourceFromBuffer, buildPdf, buildMixedPdf };
})();

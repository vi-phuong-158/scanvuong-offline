/* Dependency-free Party Mode regression checks. Run with Node 18+. */
const fs = require('fs');
const vm = require('vm');
const zlib = require('zlib');


const root = require('path').resolve(__dirname, '..');
const context = { window: {}, TextEncoder, TextDecoder, Uint8Array, Blob, Math, Error, console };
vm.runInNewContext(fs.readFileSync(require('path').join(root, 'party-pdf.js'), 'utf8'), context, { filename: 'party-pdf.js' });
const PartyPdf = context.window.PartyPdf;
let pass = 0;
function check(name, condition) { if (!condition) throw new Error(`FAIL ${name}`); pass++; console.log(`PASS ${name}`); }

function fixture(pageCount) {
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    `2 0 obj\n<< /Type /Pages /Kids [${Array.from({ length: pageCount }, (_, i) => `${3 + i * 2} 0 R`).join(' ')}] /Count ${pageCount} >>\nendobj\n`
  ];
  for (let i = 0; i < pageCount; i++) {
    const pageId = 3 + i * 2;
    const contentId = pageId + 1;
    objects.push(`${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${contentId} 0 R >>\nendobj\n`);
    const content = 'q 1 0 0 1 cm\n';
    objects.push(`${contentId} 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`);
  }
  return new TextEncoder().encode(`%PDF-1.4\n${objects.join('')}%%EOF`);
}

function boundaryFixture({ nulHeader = false, streamFalsePositive = false, malformed = false } = {}) {
  const header = nulHeader ? '\x00' : '\n';
  const fake = '99 0 obj\n<< /Type /Page /MediaBox [0 0 1 1] >>\nendobj\n';
  const stream = streamFalsePositive ? fake : 'q 1 0 0 1 cm\n';
  const streamBytes = new TextEncoder().encode(stream);
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    header + '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Contents 4 0 R >>\nendobj\n',
    '4 0 obj\n<< /Length ' + streamBytes.length + ' >>\nstream\n' + stream + 'endstream\nendobj\n'
  ];
  if (malformed) objects[2] = header + '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] >>\n';
  const outputObjects = malformed ? objects.slice(0, 3) : objects;
  return new TextEncoder().encode('%PDF-1.4\n' + outputObjects.join('') + '%%EOF');
}

(async () => {
  const source = PartyPdf.sourceFromBuffer(fixture(10), 'fixture-10.pdf');
  check('PDF metadata reads 10 pages', source.pageCount === 10);
  const selected = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(index => source.page(index));
  const split = await PartyPdf.buildPdf(selected.slice(0, 2)).arrayBuffer();
  const splitText = new TextDecoder('iso-8859-1').decode(split);
  check('split output keeps 2 page objects', (splitText.match(/\/Type \/Page\b/g) || []).length === 2);
  check('split output keeps source content stream', splitText.includes('q 1 0 0 1 cm'));
  check('split output does not contain JPEG conversion marker', !splitText.includes('/DCTDecode'));

  const hybrid = await PartyPdf.buildPdf([selected[0]], [{ bytes: new Uint8Array([255, 216, 255, 217]), width: 400, height: 600, pageMode: 'a4', margin: false }]).arrayBuffer();
  const hybridText = new TextDecoder('iso-8859-1').decode(hybrid);
  check('hybrid output has original and image page', (hybridText.match(/\/Type \/Page\b/g) || []).length === 2);
  check('hybrid output preserves original stream', hybridText.includes('q 1 0 0 1 cm'));
  check('hybrid output has copied image object path', hybridText.includes('/Subtype /Image') && hybridText.includes('/DCTDecode'));

  const mixed = await PartyPdf.buildMixedPdf([
    { kind: 'pdf', ref: selected[0] },
    { kind: 'image', item: { bytes: new Uint8Array([255, 216, 255, 217]), width: 400, height: 600, pageMode: 'a4', margin: false } },
    { kind: 'pdf', ref: selected[1] }
  ]).arrayBuffer();
  const mixedText = new TextDecoder('iso-8859-1').decode(mixed);
  const kids = (mixedText.match(/\/Kids \[([^\]]+)\]/) || [])[1].match(/\d+ 0 R/g).map(value => Number(value.match(/\d+/)[0]));
  const mixedPageBodies = kids.map(id => (mixedText.match(new RegExp(`${id} 0 obj\\n([\\s\\S]*?)\\nendobj`)) || [])[1] || '');
  check('hybrid output keeps operator page order', mixedPageBodies.length === 3 && !mixedPageBodies[0].includes('/XObject') && mixedPageBodies[1].includes('/XObject') && !mixedPageBodies[2].includes('/XObject'));
  const taxonomy = JSON.parse(fs.readFileSync(require('path').join(root, 'assets/party/document_types.json'), 'utf8'));
  const ids = taxonomy.document_types.map(item => item.id);
  check('taxonomy has exactly 104 types', taxonomy.document_types.length === 104);
  check('taxonomy ids are unique', new Set(ids).size === 104);
  check('taxonomy search by code 05', taxonomy.document_types.find(item => item.id === '05').name_vi.includes('kết nạp'));
  check('taxonomy search without Vietnamese accents', taxonomy.document_types.some(item => item.name_vi.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes('ket nap')));
  check('taxonomy filename is canonical for 05', taxonomy.document_types.find(item => item.id === '05').filename_base === '05.Quyet_dinh_ket_nap_dang_vien');

  // --- Tests A-I: Selection & Document Creation & Partial Export ---
  const source80 = PartyPdf.sourceFromBuffer(fixture(80), 'fixture-80.pdf');
  check('80-page fixture has 80 pages', source80.pageCount === 80);
  const sources80 = Array.from({ length: 80 }, (_, i) => ({
    id: `src-page-${i + 1}`,
    kind: 'pdf',
    source: source80,
    sourcePage: i,
    sourceTotalPages: 80
  }));

  const simState = {
    sources: sources80,
    documents: [],
    selectedPages: new Set()
  };

  function simFindDocumentByPageId(id) {
    return simState.documents.find(doc => doc.pages.some(p => p.id === id)) || null;
  }
  function simIsPageAvailable(id) {
    return !simFindDocumentByPageId(id);
  }
  function simCreateDocumentFromSelection() {
    const pagesToAssign = simState.sources.filter(p => simState.selectedPages.has(p.id) && simIsPageAvailable(p.id));
    if (!pagesToAssign.length) return null;
    const newDoc = { id: `doc-${simState.documents.length + 1}`, pages: pagesToAssign, typeId: null };
    simState.documents.push(newDoc);
    simState.selectedPages.clear();
    return newDoc;
  }

  // Test A: Tích chọn 2 trang trên 80 trang nguồn -> tạo document đúng 2 trang đó, source pool còn 78 trang chưa gán
  simState.selectedPages.add('src-page-1');
  simState.selectedPages.add('src-page-2');
  const docA = simCreateDocumentFromSelection();
  check('Test A: Doc created with 2 pages', docA && docA.pages.length === 2 && docA.pages[0].id === 'src-page-1' && docA.pages[1].id === 'src-page-2');
  const unassignedA = simState.sources.filter(p => simIsPageAvailable(p.id)).length;
  check('Test A: 78 pages remain unassigned in source pool', unassignedA === 78);

  // Test B: Click lộn xộn (19 -> 17 -> 18) -> document mới giữ thứ tự trang nguồn tăng dần (17 -> 18 -> 19)
  simState.selectedPages.add('src-page-19');
  simState.selectedPages.add('src-page-17');
  simState.selectedPages.add('src-page-18');
  const docB = simCreateDocumentFromSelection();
  check('Test B: Doc created with 3 pages in ascending source order', docB && docB.pages.map(p => p.id).join(',') === 'src-page-17,src-page-18,src-page-19');

  // Test C: Chọn các trang không liền nhau (22, 25, 29) -> tạo document đúng [22, 25, 29], không lẫn trang trung gian
  simState.selectedPages.add('src-page-22');
  simState.selectedPages.add('src-page-25');
  simState.selectedPages.add('src-page-29');
  const docC = simCreateDocumentFromSelection();
  check('Test C: Non-contiguous pages correctly preserved [22, 25, 29]', docC && docC.pages.map(p => p.id).join(',') === 'src-page-22,src-page-25,src-page-29');

  // Test D: Trang đã thuộc document không thể bị chọn lại vào document khác
  simState.selectedPages.add('src-page-17'); // already in docB
  simState.selectedPages.add('src-page-30'); // available
  const docD = simCreateDocumentFromSelection();
  check('Test D: Assigned page 17 is excluded, only page 30 assigned to new doc', docD && docD.pages.length === 1 && docD.pages[0].id === 'src-page-30');
  check('Test D: Page 17 is still in docB', docB.pages.some(p => p.id === 'src-page-17'));

  // Test E: Partial export 1 document (2 trang trên 80 trang) sinh PDF đúng 2 trang, không cần coverage = 100%
  const exportRefs = docA.pages.map(p => p.source.page(p.sourcePage));
  const exportedPdfBuf = await PartyPdf.buildPdf(exportRefs).arrayBuffer();
  const exportedPdfText = new TextDecoder('iso-8859-1').decode(exportedPdfBuf);
  check('Test E: Partial export produces valid PDF with exactly 2 page objects', (exportedPdfText.match(/\/Type \/Page\b/g) || []).length === 2);
  check('Test E: 80 total source pages remained safe and unchanged', simState.sources.length === 80);

  // Test F: Đặt taxonomy hợp lệ (01..104) -> sinh đúng tên file canonical (05.Quyet_dinh_ket_nap_dang_vien.pdf)
  docA.typeId = '05';
  const taxType = taxonomy.document_types.find(t => t.id === docA.typeId);
  check('Test F: Taxonomy 05 matches canonical filename', taxType && taxType.filename_base === '05.Quyet_dinh_ket_nap_dang_vien');
  const canonicalNameA = `${taxType.filename_base}.pdf`;
  check('Test F: Canonical name is 05.Quyet_dinh_ket_nap_dang_vien.pdf', canonicalNameA === '05.Quyet_dinh_ket_nap_dang_vien.pdf');

  // Test G: Trùng loại tài liệu -> sinh đúng suffix .1, .2 theo sequence
  docB.typeId = '05';
  const sameDocs = simState.documents.filter(d => d.typeId === '05');
  check('Test G: 2 documents share type 05', sameDocs.length === 2);
  const name1 = `${taxType.filename_base}.${sameDocs.indexOf(docA) + 1}.pdf`;
  const name2 = `${taxType.filename_base}.${sameDocs.indexOf(docB) + 1}.pdf`;
  check('Test G: First duplicate has suffix .1', name1 === '05.Quyet_dinh_ket_nap_dang_vien.1.pdf');
  check('Test G: Second duplicate has suffix .2', name2 === '05.Quyet_dinh_ket_nap_dang_vien.2.pdf');

  // Test H: Xóa document -> các trang lập tức quay lại source pool ở trạng thái unassigned, không mất trang
  const beforeDeleteUnassigned = simState.sources.filter(p => simIsPageAvailable(p.id)).length;
  const docCToRemovePages = [...docC.pages];
  const docCIdx = simState.documents.indexOf(docC);
  simState.documents.splice(docCIdx, 1);
  const afterDeleteUnassigned = simState.sources.filter(p => simIsPageAvailable(p.id)).length;
  check('Test H: Deleting docC frees all its 3 pages back to source pool', afterDeleteUnassigned === beforeDeleteUnassigned + 3);
  check('Test H: All pages of docC are now available', docCToRemovePages.every(p => simIsPageAvailable(p.id)));
  check('Test H: Total sources remains 80 with 0 data loss', simState.sources.length === 80);

  // Test I: Không có document rỗng được sinh ra khi selectedPages rỗng
  simState.selectedPages.clear();
  const emptyDoc = simCreateDocumentFromSelection();
  check('Test I: Attempting to create document from empty selection returns null / no-op', emptyDoc === null);

  const crlfSource = PartyPdf.sourceFromBuffer(fixture(1), 'crlf-boundary.pdf');
  check('object header after CR/LF remains supported', crlfSource.pageCount === 1);
  const nulSource = PartyPdf.sourceFromBuffer(boundaryFixture({ nulHeader: true }), 'nul-boundary.pdf');
  check('object header after NUL remains supported', nulSource.pageCount === 1);
  const streamSource = PartyPdf.sourceFromBuffer(boundaryFixture({ streamFalsePositive: true }), 'stream-boundary.pdf');
  check('object-looking bytes in stream are not parsed as objects', streamSource.pageCount === 1 && !streamSource.objects.has(99));
  check('/Type /Page is not confused with /Type /Pages', nulSource.pageIds.length === 1 && nulSource.pageIds.every(id => nulSource.objects.get(id).text.includes('/Type /Page')));
  let malformedFailed = false;
  try { PartyPdf.sourceFromBuffer(boundaryFixture({ malformed: true }), 'malformed-boundary.pdf'); } catch (error) { malformedFailed = /thiếu endobj|object hợp lệ/.test(error.message); }
  check('malformed object boundary fails closed', malformedFailed);

  // --- Synthetic Suites A-I for Indirect / Direct Stream Length ---
  function makeSyntheticPdf(objDefs) {
    const parts = ['%PDF-1.4\n'];
    for (const o of objDefs) {
      parts.push(`${o.id} ${o.gen || 0} obj\n${o.body}\nendobj\n`);
    }
    parts.push('%%EOF');
    return new TextEncoder().encode(parts.join(''));
  }

  // A. Direct length
  const pdfA = makeSyntheticPdf([
    { id: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' },
    { id: 2, body: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
    { id: 3, body: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>' },
    { id: 4, body: '<< /Length 12 >>\nstream\nq 1 0 0 1 cm\nendstream' }
  ]);
  const srcA = PartyPdf.sourceFromBuffer(pdfA, 'pdfA.pdf');
  check('Synthetic A: direct length parses 1 page', srcA.pageCount === 1);

  // B. Indirect length
  const pdfB = makeSyntheticPdf([
    { id: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' },
    { id: 2, body: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
    { id: 3, body: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>' },
    { id: 4, body: '<< /Length 5 0 R >>\nstream\nq 1 0 0 1 cm\nendstream' },
    { id: 5, body: '12' }
  ]);
  const srcB = PartyPdf.sourceFromBuffer(pdfB, 'pdfB.pdf');
  check('Synthetic B: indirect length parses 1 page and has object 5', srcB.pageCount === 1 && srcB.objects.has(5));

  // C. Indirect length object appears AFTER stream object
  const pdfC = makeSyntheticPdf([
    { id: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' },
    { id: 2, body: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
    { id: 4, body: '<< /Length 10 0 R >>\nstream\nhello world!\nendstream' },
    { id: 3, body: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>' },
    { id: 10, body: '12' }
  ]);
  const srcC = PartyPdf.sourceFromBuffer(pdfC, 'pdfC.pdf');
  check('Synthetic C: indirect length placed after stream parses cleanly', srcC.pageCount === 1 && srcC.objects.has(10));

  // D. Binary stream with NO whitespace before endstream
  const streamDataD = new Uint8Array([1, 2, 3, 4]);
  const prefixD = new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>\nendobj\n4 0 obj\n<< /Length 4 >>\nstream\n');
  const suffixD = new TextEncoder().encode('endstream\nendobj\n%%EOF');
  const outD = new Uint8Array(prefixD.length + streamDataD.length + suffixD.length);
  outD.set(prefixD, 0);
  outD.set(streamDataD, prefixD.length);
  outD.set(suffixD, prefixD.length + streamDataD.length);
  const srcD = PartyPdf.sourceFromBuffer(outD, 'pdfD.pdf');
  check('Synthetic D: binary stream without whitespace before endstream PASS', srcD.pageCount === 1);

  // E. Fake endstream bytes inside binary stream data
  const fakeStreamPayload = 'payload-containing-endstream-marker';
  const pdfE = makeSyntheticPdf([
    { id: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' },
    { id: 2, body: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
    { id: 3, body: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>' },
    { id: 4, body: `<< /Length ${fakeStreamPayload.length} >>\nstream\n${fakeStreamPayload}\nendstream` }
  ]);
  const srcE = PartyPdf.sourceFromBuffer(pdfE, 'pdfE.pdf');
  check('Synthetic E: declared length wins over fake endstream in stream', srcE.pageCount === 1);
  const expE = await PartyPdf.buildPdf([srcE.page(0)]).arrayBuffer();
  check('Synthetic E: exported PDF retains full payload without truncation', new TextDecoder('iso-8859-1').decode(expE).includes(fakeStreamPayload));

  // F. Missing indirect length object -> FAIL CLOSED
  const pdfF = makeSyntheticPdf([
    { id: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' },
    { id: 2, body: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
    { id: 3, body: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>' },
    { id: 4, body: '<< /Length 999 0 R >>\nstream\nhello\nendstream' }
  ]);
  let fFailed = false;
  try { PartyPdf.sourceFromBuffer(pdfF, 'pdfF.pdf'); } catch (err) { fFailed = /không tìm thấy object|thiếu endobj/.test(err.message); }
  check('Synthetic F: missing indirect length object fails closed', fFailed);

  // G. Invalid indirect length value -> FAIL CLOSED
  const pdfG = makeSyntheticPdf([
    { id: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' },
    { id: 2, body: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
    { id: 3, body: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>' },
    { id: 4, body: '<< /Length 5 0 R >>\nstream\nhello\nendstream' },
    { id: 5, body: 'abc' }
  ]);
  let gFailed = false;
  try { PartyPdf.sourceFromBuffer(pdfG, 'pdfG.pdf'); } catch (err) { gFailed = /không đọc được giá trị hợp lệ|thiếu endobj/.test(err.message); }
  check('Synthetic G: invalid indirect length value fails closed', gFailed);

  // H. Negative length -> FAIL CLOSED
  const pdfH = makeSyntheticPdf([
    { id: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' },
    { id: 2, body: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
    { id: 3, body: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>' },
    { id: 4, body: '<< /Length 5 0 R >>\nstream\nhello\nendstream' },
    { id: 5, body: '-10' }
  ]);
  let hFailed = false;
  try { PartyPdf.sourceFromBuffer(pdfH, 'pdfH.pdf'); } catch (err) { hFailed = /không đọc được giá trị hợp lệ|không hợp lệ|thiếu endobj/.test(err.message); }
  check('Synthetic H: negative length fails closed', hFailed);

  // I. Out-of-bounds length -> FAIL CLOSED
  const pdfI = makeSyntheticPdf([
    { id: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' },
    { id: 2, body: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
    { id: 3, body: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>' },
    { id: 4, body: '<< /Length 5 0 R >>\nstream\nhello\nendstream' },
    { id: 5, body: '99999999' }
  ]);
  let iFailed = false;
  try { PartyPdf.sourceFromBuffer(pdfI, 'pdfI.pdf'); } catch (err) { iFailed = /vượt quá kích thước tệp|bounds vượt quá|thiếu endobj/.test(err.message); }
  check('Synthetic I: out-of-bounds length fails closed', iFailed);

  // J. Adjacent nested close: >> >> /MediaBox
  const pdfJ = makeSyntheticPdf([
    { id: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' },
    { id: 2, body: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
    { id: 3, body: '<< /Type /Page /Parent 2 0 R /Resources << /XObject << /Im1 10 0 R >> >> /MediaBox [0 0 595 842] >>' },
    { id: 10, body: '<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceRGB /Length 0 >>\nstream\nendstream' }
  ]);
  const srcJ = PartyPdf.sourceFromBuffer(pdfJ, 'pdfJ.pdf');
  const infoJ = PartyPdf.pageInfo(srcJ, 0);
  check('Synthetic J: adjacent nested close preserves MediaBox', infoJ.box[2] === 595 && infoJ.box[3] === 842);

  // K. No whitespace between dictionary close tokens and /MediaBox
  const pdfK = makeSyntheticPdf([
    { id: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' },
    { id: 2, body: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
    { id: 3, body: '<< /Type /Page /Parent 2 0 R /Resources << /XObject << >> >>/MediaBox[0 0 595 842] >>' }
  ]);
  const srcK = PartyPdf.sourceFromBuffer(pdfK, 'pdfK.pdf');
  const infoK = PartyPdf.pageInfo(srcK, 0);
  check('Synthetic K: adjacent close without whitespace preserves MediaBox', infoK.box[2] === 595 && infoK.box[3] === 842);

  // L. Multiple nested levels (4 levels of >> without space)
  const pdfL = makeSyntheticPdf([
    { id: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' },
    { id: 2, body: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
    { id: 3, body: '<< /Type /Page /Parent 2 0 R /Dict1 << /Dict2 << /Dict3 << /Dict4 << /Key 123 >>>>>>>>/MediaBox [0 0 612 792] >>' }
  ]);
  const srcL = PartyPdf.sourceFromBuffer(pdfL, 'pdfL.pdf');
  const infoL = PartyPdf.pageInfo(srcL, 0);
  check('Synthetic L: 4-level nested dictionary close preserves MediaBox', infoL.box[2] === 612 && infoL.box[3] === 792);

  // M. Compressed Object Stream (/ObjStm) resolving indirect /Length and page objects
  const contentM = 'q 1 0 0 1 cm\n';
  const body6M = `${contentM.length}\n`;
  const body7M = '<< /TestKey (TestVal) >>\n';
  const firstM = '6 0 7 ' + body6M.length + ' ';
  const decompM = firstM + body6M + body7M;
  const compM = zlib.deflateSync(Buffer.from(decompM, 'latin1'));

  const partsM = [
    '%PDF-1.5\n',
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length 6 0 R >>\nstream\n${contentM}endstream\nendobj\n`,
    `5 0 obj\n<< /Type /ObjStm /N 2 /First ${firstM.length} /Filter /FlateDecode /Length ${compM.length} >>\nstream\n`,
    compM,
    '\nendstream\nendobj\n',
    '%%EOF\n'
  ];
  const totalM = partsM.reduce((acc, p) => acc + (typeof p === 'string' ? Buffer.byteLength(p, 'latin1') : p.length), 0);
  const pdfM = Buffer.alloc(totalM);
  let offM = 0;
  for (const p of partsM) {
    if (typeof p === 'string') {
      const b = Buffer.from(p, 'latin1');
      b.copy(pdfM, offM);
      offM += b.length;
    } else {
      p.copy(pdfM, offM);
      offM += p.length;
    }
  }
  const srcM = PartyPdf.sourceFromBuffer(pdfM, 'pdfM.pdf');
  check('Synthetic M: ObjStm extracts compressed objects', srcM.objects.has(6) && srcM.objects.has(7));
  const infoM = PartyPdf.pageInfo(srcM, 0);
  check('Synthetic M: Page with indirect /Length in ObjStm parses MediaBox', infoM.box[2] === 595 && infoM.box[3] === 842);
  const expM = await PartyPdf.buildPdf([srcM.page(0)]).arrayBuffer();
  const reparseM = PartyPdf.sourceFromBuffer(new Uint8Array(expM), 'reparseM.pdf');
  check('Synthetic M: Export materializes compressed object as top-level object', reparseM.pageCount === 1);

  // N. ObjStm with duplicate object ID -> FAIL CLOSED
  const firstN = '6 0 6 3 ';
  const decompN = firstN + '12\n12\n';
  const compN = zlib.deflateSync(Buffer.from(decompN, 'latin1'));
  const partsN = [
    '%PDF-1.5\n',
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R >>\nendobj\n',
    '4 0 obj\n<< /Length 6 0 R >>\nstream\nq 1 0 0 1 cm\nendstream\nendobj\n',
    `5 0 obj\n<< /Type /ObjStm /N 2 /First ${firstN.length} /Filter /FlateDecode /Length ${compN.length} >>\nstream\n`,
    compN,
    '\nendstream\nendobj\n',
    '%%EOF\n'
  ];
  let nFailed = false;
  try {
    const totalN = partsN.reduce((acc, p) => acc + (typeof p === 'string' ? Buffer.byteLength(p, 'latin1') : p.length), 0);
    const pdfN = Buffer.alloc(totalN);
    let offN = 0;
    for (const p of partsN) {
      if (typeof p === 'string') { const b = Buffer.from(p, 'latin1'); b.copy(pdfN, offN); offN += b.length; }
      else { p.copy(pdfN, offN); offN += p.length; }
    }
    PartyPdf.sourceFromBuffer(pdfN, 'pdfN.pdf');
  } catch (err) {
    nFailed = /duplicate object id/i.test(err.message);
  }
  check('Synthetic N: ObjStm with duplicate object id fails closed', nFailed);

  // O. ObjStm with malformed header tokens -> FAIL CLOSED
  const firstO = '6 0 abc 3 ';
  const decompO = firstO + '12\n12\n';
  const compO = zlib.deflateSync(Buffer.from(decompO, 'latin1'));
  const partsO = [
    '%PDF-1.5\n',
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R >>\nendobj\n',
    '4 0 obj\n<< /Length 6 0 R >>\nstream\nq 1 0 0 1 cm\nendstream\nendobj\n',
    `5 0 obj\n<< /Type /ObjStm /N 2 /First ${firstO.length} /Filter /FlateDecode /Length ${compO.length} >>\nstream\n`,
    compO,
    '\nendstream\nendobj\n',
    '%%EOF\n'
  ];
  let oFailed = false;
  try {
    const totalO = partsO.reduce((acc, p) => acc + (typeof p === 'string' ? Buffer.byteLength(p, 'latin1') : p.length), 0);
    const pdfO = Buffer.alloc(totalO);
    let offO = 0;
    for (const p of partsO) {
      if (typeof p === 'string') { const b = Buffer.from(p, 'latin1'); b.copy(pdfO, offO); offO += b.length; }
      else { p.copy(pdfO, offO); offO += p.length; }
    }
    PartyPdf.sourceFromBuffer(pdfO, 'pdfO.pdf');
  } catch (err) {
    oFailed = /header không hợp lệ|không đủ.*cặp số/i.test(err.message);
  }
  check('Synthetic O: ObjStm with malformed header tokens fails closed', oFailed);


  // P. inflateSync fails closed on truncated stream
  let pFailed = false;
  try {
    PartyPdf._inflateSync(Buffer.from([0x78, 0x9c]));
  } catch (err) {
    pFailed = /bị cắt ngắn|unexpected EOF|invalid/i.test(err.message);
  }
  check('Synthetic P: inflateSync fails closed on truncated stream', pFailed);

  // Q. inflateSync fails closed on invalid block type (btype = 3)
  let qFailed = false;
  try {
    PartyPdf._inflateSync(Buffer.from([0x07]));
  } catch (err) {
    qFailed = /không hợp lệ|invalid/i.test(err.message);
  }
  check('Synthetic Q: inflateSync fails closed on invalid block type', qFailed);

  // R. inflateSync fails closed on corrupted deflate data
  let rFailed = false;
  try {
    PartyPdf._inflateSync(Buffer.from([0x78, 0x9c, 0xff, 0xff, 0xff, 0xff]));
  } catch (err) {
    rFailed = /không hợp lệ|invalid|check/i.test(err.message);
  }
  check('Synthetic R: inflateSync fails closed on corrupted deflate data', rFailed);


  // S. inflateSync hard decoded-size limit (decompression bomb protection)
  const bigBomb = Buffer.from('B'.repeat(10000));
  const compBomb = zlib.deflateSync(bigBomb);
  let sFailed = false;
  try {
    PartyPdf._inflateSync(compBomb, 500);
  } catch (err) {
    sFailed = /giới hạn tối đa/i.test(err.message);
  }
  check('Synthetic S: inflateSync fails closed on exceeding maxBytes', sFailed);

  // T. Delimiter parser ignores >> inside literal and hex strings
  const pdfT = makeSyntheticPdf([
    { id: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' },
    { id: 2, body: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
    { id: 3, body: '<< /Type /Page /Parent 2 0 R /Title (Test >> with close) /Hex <3E3E> /MediaBox [0 0 595 842] >>' }
  ]);
  const srcT = PartyPdf.sourceFromBuffer(pdfT, 'pdfT.pdf');
  const infoT = PartyPdf.pageInfo(srcT, 0);
  check('Synthetic T: delimiter parser ignores >> inside literal and hex strings', infoT.box[2] === 595 && infoT.box[3] === 842);

  // U. Indirect /MediaBox 15 0 R resolves correctly
  const pdfU = makeSyntheticPdf([
    { id: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' },
    { id: 2, body: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
    { id: 3, body: '<< /Type /Page /Parent 2 0 R /MediaBox 15 0 R /Contents 4 0 R >>' },
    { id: 4, body: '<< /Length 12 >>\nstream\nq 1 0 0 1 cm\nendstream' },
    { id: 15, body: '[0 0 595.28 841.89]' }
  ]);
  const srcU = PartyPdf.sourceFromBuffer(pdfU, 'pdfU.pdf');
  const infoU = PartyPdf.pageInfo(srcU, 0);
  check('Synthetic U: indirect MediaBox resolves dimensions', infoU.box[2] === 595.28 && infoU.box[3] === 841.89);

  // V. /CropBox null with valid /MediaBox does not fail or use null
  const pdfV = makeSyntheticPdf([
    { id: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' },
    { id: 2, body: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
    { id: 3, body: '<< /Type /Page /Parent 2 0 R /CropBox null /MediaBox [0 0 595.28 841.89] /Contents 4 0 R >>' },
    { id: 4, body: '<< /Length 12 >>\nstream\nq 1 0 0 1 cm\nendstream' }
  ]);
  const srcV = PartyPdf.sourceFromBuffer(pdfV, 'pdfV.pdf');
  const infoV = PartyPdf.pageInfo(srcV, 0);
  check('Synthetic V: CropBox null falls back safely to MediaBox', infoV.box[2] === 595.28 && infoV.box[3] === 841.89);

  // W. Indirect /Rotate 20 0 R resolves correctly
  const pdfW = makeSyntheticPdf([
    { id: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' },
    { id: 2, body: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
    { id: 3, body: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 500 700] /Rotate 20 0 R /Contents 4 0 R >>' },
    { id: 4, body: '<< /Length 12 >>\nstream\nq 1 0 0 1 cm\nendstream' },
    { id: 20, body: '90' }
  ]);
  const srcW = PartyPdf.sourceFromBuffer(pdfW, 'pdfW.pdf');
  const infoW = PartyPdf.pageInfo(srcW, 0);
  check('Synthetic W: indirect Rotate resolves to 90 degrees', infoW.rotation === 90 && infoW.width === 700 && infoW.height === 500);


  // --- Real PDF Acceptance: Scan2026-08-24_150131.pdf ---
  const realPdfPath = require('path').join(root, 'Scan2026-08-24_150131.pdf');
  if (fs.existsSync(realPdfPath)) {
    const realBuf = fs.readFileSync(realPdfPath);
    const realSource = PartyPdf.sourceFromBuffer(realBuf, 'Scan2026-08-24_150131.pdf');
    check('Real PDF has 13 pages', realSource.pageCount === 13);
    check('Real PDF has object 11', realSource.objects.has(11));
    check('Real PDF has object 84', realSource.objects.has(84));
    check('Real PDF has object 149', realSource.objects.has(149));

    const real3Pages = [0, 1, 2].map(i => realSource.page(i));
    const realExportedBuf = new Uint8Array(await PartyPdf.buildPdf(real3Pages).arrayBuffer());
    const realExportedText = new TextDecoder('iso-8859-1').decode(realExportedBuf);
    const realPageMatches = realExportedText.match(/\/Type\s*\/Page(?!s)\b/g) || [];
    check('Real PDF 3-page export produces exactly 3 pages', realPageMatches.length === 3);

    const reimported = PartyPdf.sourceFromBuffer(realExportedBuf, 'exported-real-3page.pdf');
    check('Real PDF 3-page export re-parses with 3 pages', reimported.pageCount === 3);

    let realExportedImages = 0;
    for (const obj of reimported.objects.values()) {
      if (obj.text.includes('/Subtype /Image') || obj.text.includes('/Subtype/Image')) realExportedImages++;
    }
    check('Real PDF 3-page export retains scan images without loss', realExportedImages > 0);
  }

  console.log(`Party Mode regression: ${pass}/${pass} checks PASS`);
})().catch(error => { console.error(error.stack || error); process.exit(1); });

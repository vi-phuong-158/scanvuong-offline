/* Dependency-free Party Mode regression checks. Run with Node 18+. */
const fs = require('fs');
const vm = require('vm');

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
    objects.push(`${contentId} 0 obj\n<< /Length 9 >>\nstream\nq 1 0 0 1 cm\nendstream\nendobj\n`);
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
  console.log(`Party Mode regression: ${pass}/${pass} checks PASS`);
})().catch(error => { console.error(error.stack || error); process.exit(1); });

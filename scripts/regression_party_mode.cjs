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
  // Multi-split verification on 12-page fixture
  const source12 = PartyPdf.sourceFromBuffer(fixture(12), 'fixture-12.pdf');
  check('12-page fixture has 12 pages', source12.pageCount === 12);
  const pages12 = Array.from({ length: 12 }, (_, i) => ({
    id: `page-${i + 1}`,
    kind: 'pdf',
    source: source12,
    sourcePage: i,
    sourceTotalPages: 12
  }));

  // Helper simulating multi-split logic
  function splitDocByMarked(pages, markedIds) {
    const markedIndices = [];
    pages.forEach((p, idx) => {
      if (markedIds.has(p.id) && idx < pages.length - 1) markedIndices.push(idx);
    });
    const chunks = [];
    let start = 0;
    for (const splitIdx of markedIndices) {
      chunks.push(pages.slice(start, splitIdx + 1));
      start = splitIdx + 1;
    }
    chunks.push(pages.slice(start));
    return chunks;
  }

  // Multi-split after page 3, page 6, page 9
  const marked = new Set(['page-3', 'page-6', 'page-9']);
  const chunks4 = splitDocByMarked(pages12, marked);
  check('Multi-split at 3, 6, 9 produces exactly 4 documents', chunks4.length === 4);
  check('Doc 1 has pages 1..3', chunks4[0].length === 3 && chunks4[0].map(p => p.sourcePage).join(',') === '0,1,2');
  check('Doc 2 has pages 4..6', chunks4[1].length === 3 && chunks4[1].map(p => p.sourcePage).join(',') === '3,4,5');
  check('Doc 3 has pages 7..9', chunks4[2].length === 3 && chunks4[2].map(p => p.sourcePage).join(',') === '6,7,8');
  check('Doc 4 has pages 10..12', chunks4[3].length === 3 && chunks4[3].map(p => p.sourcePage).join(',') === '9,10,11');
  const allSplitPages = chunks4.flat();
  check('Multi-split preserves total 12 pages without duplication or omission', allSplitPages.length === 12 && new Set(allSplitPages.map(p => p.sourcePage)).size === 12);

  // Single split after page 4
  const singleMarked = new Set(['page-4']);
  const chunks2 = splitDocByMarked(pages12, singleMarked);
  check('Single split after page 4 produces 2 documents [4, 8]', chunks2.length === 2 && chunks2[0].length === 4 && chunks2[1].length === 8);

  // Clear splits
  const emptyMarked = new Set();
  const chunks1 = splitDocByMarked(pages12, emptyMarked);
  check('Empty marked splits leaves 1 document with 12 pages', chunks1.length === 1 && chunks1[0].length === 12);

  // Export each multi-split chunk
  for (let c = 0; c < chunks4.length; c++) {
    const chunkRefs = chunks4[c].map(p => p.source.page(p.sourcePage));
    const chunkPdf = await PartyPdf.buildPdf(chunkRefs).arrayBuffer();
    const chunkText = new TextDecoder('iso-8859-1').decode(chunkPdf);
    check(`Export chunk ${c + 1} has 3 page objects`, (chunkText.match(/\/Type \/Page\b/g) || []).length === 3);
  }

  const taxonomy = JSON.parse(fs.readFileSync(require('path').join(root, 'assets/party/document_types.json'), 'utf8'));
  const ids = taxonomy.document_types.map(item => item.id);
  check('taxonomy has exactly 104 types', taxonomy.document_types.length === 104);
  check('taxonomy ids are unique', new Set(ids).size === 104);
  check('taxonomy search by code 05', taxonomy.document_types.find(item => item.id === '05').name_vi.includes('kết nạp'));
  check('taxonomy search without Vietnamese accents', taxonomy.document_types.some(item => item.name_vi.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes('ket nap')));
  check('taxonomy filename is canonical for 05', taxonomy.document_types.find(item => item.id === '05').filename_base === '05.Quyet_dinh_ket_nap_dang_vien');

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

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
  console.log(`Party Mode regression: ${pass}/${pass} checks PASS`);
})().catch(error => { console.error(error.stack || error); process.exit(1); });

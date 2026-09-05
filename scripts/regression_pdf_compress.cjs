/* Dependency-free regression test for pdf-compress.js (PdfCompress engine).
   Node has no Canvas/pdf.js, so this covers everything that does NOT need a
   real render: constants, round-table shape/floor invariants, the PDF
   assembly step (buildCompressedPdf, reusing PartyPdf.buildPdf), and
   page-count/order/no-mutation guarantees. The full adaptive-retry pipeline
   (render → encode → package → verify target) is covered by the real
   Chromium run in scripts/acceptance_pdf_compress.cjs. Run with Node 18+. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
// A minimal `document` so renderCompressionPage()'s `document.createElement('canvas')`
// doesn't throw a ReferenceError before reaching the renderer stub in the
// fail-closed test below — nothing here needs real Canvas 2D behavior.
const context = { window: {}, document: { createElement: () => ({}) }, TextEncoder, TextDecoder, Uint8Array, Blob, Math, Error, console, URL };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, 'party-pdf.js'), 'utf8'), context, { filename: 'party-pdf.js' });
vm.runInContext(fs.readFileSync(path.join(root, 'pdf-compress.js'), 'utf8'), context, { filename: 'pdf-compress.js' });
const PartyPdf = context.window.PartyPdf;
const PdfCompress = context.window.PdfCompress;

let pass = 0;
function check(name, condition) {
  if (!condition) throw new Error('FAIL ' + name);
  pass++;
  console.log('PASS ' + name);
}

// ---- Target constants ----
check('target is defined and positive', PdfCompress.PDF_COMPRESSION_TARGET_BYTES > 0);
check('target is decimal 19,000,000 bytes (documented, not MiB)', PdfCompress.PDF_COMPRESSION_TARGET_BYTES === 19 * 1000 * 1000);
check('display limit is decimal 20,000,000 bytes', PdfCompress.PDF_COMPRESSION_DISPLAY_LIMIT_BYTES === 20 * 1000 * 1000);
check('target stays under the display limit with a real safety margin', PdfCompress.PDF_COMPRESSION_DISPLAY_LIMIT_BYTES - PdfCompress.PDF_COMPRESSION_TARGET_BYTES >= 500 * 1000);
check('target also stays under a MiB-based 20MB reading of the limit', PdfCompress.PDF_COMPRESSION_TARGET_BYTES < 20 * 1024 * 1024);

// ---- verifyTarget ----
check('verifyTarget: at target passes', PdfCompress.verifyTarget(PdfCompress.PDF_COMPRESSION_TARGET_BYTES, PdfCompress.PDF_COMPRESSION_TARGET_BYTES) === true);
check('verifyTarget: one byte over target fails', PdfCompress.verifyTarget(PdfCompress.PDF_COMPRESSION_TARGET_BYTES + 1, PdfCompress.PDF_COMPRESSION_TARGET_BYTES) === false);
check('verifyTarget: well under target passes', PdfCompress.verifyTarget(1000, PdfCompress.PDF_COMPRESSION_TARGET_BYTES) === true);

// ---- ROUNDS: adaptive, color-kept, monotonic, ends at a safety floor ----
const rounds = PdfCompress.ROUNDS;
check('ROUNDS is a non-trivial adaptive ladder (>= 3 rounds)', rounds.length >= 3);
check('ROUNDS maxEdge strictly decreases round over round', rounds.every((r, i) => i === 0 || r.maxEdge < rounds[i - 1].maxEdge));
check('ROUNDS jpeg quality strictly decreases round over round', rounds.every((r, i) => i === 0 || r.jpeg < rounds[i - 1].jpeg));
check('ROUNDS never encodes below a safe quality floor (>= 0.4)', rounds.every(r => r.jpeg >= 0.4));
check('ROUNDS never has quality >= 1 (always lossy JPEG re-encode, never a no-op)', rounds.every(r => r.jpeg < 1));
check('ROUNDS has no colorMode/grayscale field — color is kept, not optional', rounds.every(r => !('colorMode' in r) && !('grayscale' in r)));

const floor = rounds[rounds.length - 1];
const beyond = PdfCompress.BEYOND_FLOOR_ROUNDS;
check('BEYOND_FLOOR_ROUNDS exists for the explicit "Nén mạnh hơn" action', Array.isArray(beyond) && beyond.length >= 1);
check('BEYOND_FLOOR_ROUNDS is strictly past the floor (lower maxEdge)', beyond.every(r => r.maxEdge < floor.maxEdge));
check('BEYOND_FLOOR_ROUNDS is strictly past the floor (lower jpeg quality)', beyond.every(r => r.jpeg < floor.jpeg));

// ---- resolveRounds: floor is never crossed without an explicit opt-in ----
check('resolveRounds({}) never includes BEYOND_FLOOR_ROUNDS by default', PdfCompress.resolveRounds({}).length === rounds.length);
check('resolveRounds({}) defaults to exactly ROUNDS', JSON.stringify(PdfCompress.resolveRounds({})) === JSON.stringify(rounds));
check('resolveRounds requires allowBeyondFloor:true to reach past the floor', PdfCompress.resolveRounds({ allowBeyondFloor: true }).length === rounds.length + beyond.length);
check('resolveRounds accepts an explicit rounds override verbatim (Party Mode "Nén mạnh hơn")', PdfCompress.resolveRounds({ rounds: beyond }) === beyond);

// ---- buildCompressedPdf: page count / order / no source mutation ----
function makeItem(w, h, fillByte) {
  return { bytes: new Uint8Array(64).fill(fillByte), width: w, height: h };
}
const items = [makeItem(1000, 1400, 10), makeItem(2000, 1000, 20), makeItem(600, 900, 30)];
const itemsSnapshot = items.map(i => ({ bytes: Uint8Array.from(i.bytes), width: i.width, height: i.height }));
const blob = PdfCompress.buildCompressedPdf(items);
check('buildCompressedPdf returns a Blob', blob instanceof Blob);

(async () => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const source = PartyPdf.sourceFromBuffer(bytes, 'test.pdf');
  check('output PDF has exactly one page per input item (page count preserved)', source.pageCount === items.length);
  for (let i = 0; i < items.length; i++) {
    const info = PartyPdf.pageInfo(source, i);
    const expectedPortrait = items[i].height >= items[i].width;
    const actualPortrait = info.height >= info.width;
    check(`page ${i + 1} keeps the source page's orientation (portrait vs landscape)`, expectedPortrait === actualPortrait);
  }
  check('buildCompressedPdf did not mutate the input items array', items.length === itemsSnapshot.length);
  check('buildCompressedPdf did not mutate any item byte buffer', items.every((item, i) => item.bytes.length === itemsSnapshot[i].bytes.length && item.bytes.every((b, j) => b === itemsSnapshot[i].bytes[j])));
  check('buildCompressedPdf did not resize any item', items.every((item, i) => item.width === itemsSnapshot[i].width && item.height === itemsSnapshot[i].height));

  // ---- inspectPdf/compressPdf reject non-PDF input before writing anything ----
  let inspectThrew = false;
  try {
    await PdfCompress.inspectPdf({ arrayBuffer: async () => new TextEncoder().encode('not a pdf').buffer });
  } catch (err) {
    inspectThrew = true;
  }
  check('inspectPdf fails closed on a non-PDF buffer (no pdf.js import ever needed to reject)', inspectThrew);

  // ---- Peak-memory guard (docs/brain/03-decisions.md "Compress mode memory audit") ----
  const risk20 = PdfCompress.estimateMemoryRisk(20 * 1000 * 1000);
  const risk80 = PdfCompress.estimateMemoryRisk(80 * 1000 * 1000);
  const risk120 = PdfCompress.estimateMemoryRisk(120 * 1000 * 1000);
  check('estimateMemoryRisk: 20MB (bottom of the requested range) is not flagged too large', risk20.tooLarge === false);
  check('estimateMemoryRisk: 80MB (top of the requested range) is not flagged too large', risk80.tooLarge === false);
  check('estimateMemoryRisk: 120MB (clearly excessive) is flagged too large', risk120.tooLarge === true);
  check('estimateMemoryRisk: the estimate grows with input size (not a flat constant)', risk80.estimatedPeakBytes > risk20.estimatedPeakBytes);

  // inspectPdf() must check the size guard BEFORE parsing too — proven the
  // same way: garbage (non-PDF) bytes at an oversized length must come back
  // as a graceful "too large" result, not a "not a PDF" parse error, which
  // would mean the expensive/risky parse ran anyway just to populate an
  // info screen this file is about to be refused on.
  const oversizedGarbageForInspect = new Uint8Array(120 * 1000 * 1000);
  const inspected = await PdfCompress.inspectPdf({ arrayBuffer: async () => oversizedGarbageForInspect.buffer });
  check('inspectPdf checks the size guard before parsing (oversized garbage does not throw a parse error)', inspected.memoryRisk.tooLarge === true && inspected.pageCount === null);

  // compressPdf() must refuse an oversized input BEFORE ever parsing it —
  // proven by feeding bytes that are NOT a valid PDF (garbage) at a size
  // past the guard: if the size guard didn't fire first, this would fail
  // with a "not a PDF" parse error instead of the memory-risk message.
  const oversizedGarbage = new Uint8Array(120 * 1000 * 1000); // zero-filled, not a PDF
  let oversizedError = null;
  try {
    await PdfCompress.compressPdf({ arrayBuffer: async () => oversizedGarbage.buffer });
  } catch (err) {
    oversizedError = err;
  }
  check('compressPdf rejects an oversized input with the graceful message, before attempting to parse it', oversizedError?.message === PdfCompress.MEMORY_RISK_MESSAGE);

  // ---- Render-failure fail-closed (task: "Compression là destructive/lossy
  // export... phải fail closed nếu renderer báo lỗi rõ ràng") ----
  const singlePageBlob = PdfCompress.buildCompressedPdf([items[0]]);
  const singlePageBytes = new Uint8Array(await singlePageBlob.arrayBuffer());
  const originalRenderThumbnail = PartyPdf.renderThumbnail;
  const originalReleasePreviewCache = PartyPdf.releasePreviewCache;
  let releaseCalledOnFailure = false;
  PartyPdf.renderThumbnail = async () => {
    throw new Error('Không thể hiển thị xem trước trang 1 (PDF.js: giả lập lỗi, Fallback: giả lập lỗi)');
  };
  PartyPdf.releasePreviewCache = source => { releaseCalledOnFailure = true; return originalReleasePreviewCache(source); };
  let renderFailurePropagated = false;
  try {
    await PdfCompress.compressPdf({ arrayBuffer: async () => singlePageBytes.buffer });
  } catch (err) {
    renderFailurePropagated = /Không thể hiển thị xem trước/.test(err.message);
  } finally {
    PartyPdf.renderThumbnail = originalRenderThumbnail;
    PartyPdf.releasePreviewCache = originalReleasePreviewCache;
  }
  check('compressPdf propagates a renderer failure instead of silently packaging a blank/partial page', renderFailurePropagated);
  check('compressPdf still releases the preview cache (finally block) even when rendering fails', releaseCalledOnFailure);

  console.log(`\n${pass}/${pass} checks passed.`);
  console.log('PdfCompress engine regression: PASS');
})().catch(err => {
  console.error('FAIL', err.message);
  process.exit(1);
});

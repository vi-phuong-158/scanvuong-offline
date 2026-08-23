#!/usr/bin/env node
'use strict';
// Dependency-free regression harness for the Scan ID (front/back → single A4
// page) feature. Same technique as regression_export_busy.js: loads the REAL
// app.js (unmodified on disk) into a minimal fake-DOM sandbox via Node's vm
// module and drives it through the actual DOM event handlers.
//
// Canvas 2D/WebGL contexts here are pure stubs (drawImage/putImageData are
// no-ops, getImageData returns a zero buffer) — exactly like
// regression_export_busy.js — so this harness cannot verify actual pixel
// content (no mirror/flip check, no "same card scale on paper" check; those
// need a real browser and are covered by the manual rehearsal in
// docs/brain/05-testing-and-deploy.md). What IS real and exercised here: the
// mode/step state machine, the busy-lock guards, the export snapshot
// (state.idScan is read exactly once, before setBusy(true)), missing-side
// rejection, and Object URL revocation on replace/mode-switch.
//
// Proves:
//   Case 1 — front/back captured through the real event handlers land in
//            state.idScan.front/back (not state.pages — no cross-mode mix).
//   Case 2 — idConfirmBtn is disabled until the current side has a captured
//            file, and the front→back→preview step machine advances/rewinds
//            correctly ("Sửa mặt trước/sau" jumps back without losing data).
//   Case 3 — exportIdPdf() refuses (no PDF, no state.busy stuck true) when
//            either side is missing, even if triggered directly.
//   Case 4 — while state.busy is true, every Scan ID handler (capture,
//            confirm, back-step, edit-front/back, export, switch-mode) is a
//            guarded no-op.
//   Case 5 — export snapshot immunity: nulling state.idScan.front/back
//            immediately after clicking Export (before the awaited render
//            chain resolves) does not crash and does not stop the PDF from
//            completing — proving exportIdPdf() never re-reads state.idScan
//            after its initial synchronous snapshot.
//   Case 6 — replacing a captured side, and switching mode away from Scan ID,
//            revokes the Object URL(s) of whatever they replace (privacy:
//            ID photos must not outlive their use).

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const APP_JS_PATH = path.join(ROOT, 'app.js');

let failures = 0;
let checks = 0;
function assert(cond, msg) {
  checks++;
  if (!cond) {
    failures++;
    console.error(`  ✗ ${msg}`);
  } else {
    console.log(`  ✓ ${msg}`);
  }
}

// ---------- Minimal fake DOM (same shape as regression_export_busy.js) ----------

function makeEl() {
  const listeners = {};
  const classes = new Set();
  return {
    tagName: '',
    _text: '', _html: '',
    style: {}, dataset: {}, disabled: false, value: '', checked: false,
    draggable: false, children: [], parentElement: null,
    clientWidth: 800, clientHeight: 600,
    get textContent() { return this._text; }, set textContent(v) { this._text = v; },
    get innerHTML() { return this._html; }, set innerHTML(v) { this._html = v; this.children = []; },
    classList: {
      add: (...c) => c.forEach(x => classes.add(x)),
      remove: (...c) => c.forEach(x => classes.delete(x)),
      toggle: (c, force) => { const on = force === undefined ? !classes.has(c) : force; on ? classes.add(c) : classes.delete(c); return on; },
      contains: (c) => classes.has(c),
    },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener() {},
    appendChild(child) { this.children.push(child); return child; },
    insertBefore(child, ref) {
      const idx = this.children.indexOf(ref);
      if (idx === -1) this.children.push(child); else this.children.splice(idx, 0, child);
      return child;
    },
    remove() {},
    click() { return this.dispatch('click'); },
    getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; },
    setPointerCapture() {},
    dispatch(type, extra = {}) {
      const event = Object.assign({ type, target: this, preventDefault() {}, stopPropagation() {} }, extra);
      const fns = (listeners[type] || []).slice();
      return Promise.all(fns.map(fn => fn(event)));
    },
  };
}

function make2dContext(canvas) {
  return {
    imageSmoothingEnabled: true, imageSmoothingQuality: 'high',
    fillStyle: '', strokeStyle: '', lineWidth: 1,
    get filter() { return canvas.__filter || 'none'; }, set filter(v) { canvas.__filter = v; },
    save() {}, restore() {}, translate() {}, rotate() {}, scale() {}, setTransform() {},
    clearRect() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {}, stroke() {}, arc() {},
    drawImage() {},
    getImageData(x, y, w, h) { return { data: new Uint8ClampedArray(Math.max(0, w * h * 4)), width: w, height: h }; },
    putImageData() {},
  };
}

function makeCanvasEl() {
  const el = makeEl();
  el.tagName = 'CANVAS';
  el.width = 0; el.height = 0;
  el.getContext = (type) => {
    if (type === 'webgl') return null; // force the deterministic warpCpu() fallback
    if (type === '2d') { if (!el.__ctx2d) el.__ctx2d = make2dContext(el); return el.__ctx2d; }
    return null;
  };
  el.toBlob = (cb, type) => { setTimeout(() => cb(new TestBlob(['x'], { type: type || 'image/jpeg' })), 0); };
  return el;
}

class TestBlob {
  constructor(parts = [], opts = {}) {
    const chunks = (parts || []).map(p => {
      if (typeof p === 'string') return Buffer.from(p, 'utf8');
      if (ArrayBuffer.isView(p)) return Buffer.from(p.buffer, p.byteOffset, p.byteLength);
      return Buffer.alloc(0);
    });
    this._buf = Buffer.concat(chunks);
    this.type = (opts && opts.type) || '';
    this.size = this._buf.length;
  }
  arrayBuffer() {
    return Promise.resolve(this._buf.buffer.slice(this._buf.byteOffset, this._buf.byteOffset + this._buf.byteLength));
  }
}

class FakeFile extends TestBlob {
  constructor(name, width, height) {
    super([]);
    this.name = name;
    this.type = 'image/jpeg';
    this._width = width;
    this._height = height;
  }
}

let blobCounter = 0;
const blobRegistry = new Map();

class FakeImage {
  constructor() { this._src = null; this.width = 0; this.height = 0; }
  set src(v) {
    this._src = v;
    const blob = blobRegistry.get(v);
    if (blob) { this.width = blob._width; this.height = blob._height; }
  }
  get src() { return this._src; }
  decode() { return Promise.resolve(); }
}

class FakeImageData {
  constructor(w, h) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); }
}

const ELEMENT_IDS = [
  'emptyState', 'workspace', 'dropZone', 'chooseBtn', 'cameraBtn', 'addBtn', 'fileInput', 'cameraInput',
  'pageCount', 'reviewCount', 'thumbList', 'editorCanvas', 'processingOverlay', 'processingText',
  'confidenceDot', 'confidenceText', 'detectBtn', 'resetCropBtn', 'rotateBtn', 'moveUpBtn', 'moveDownBtn',
  'deleteBtn', 'autoAllBtn', 'clearBtn', 'fileName', 'pageSize', 'quality', 'marginToggle', 'exportBtn',
  'exportProgress', 'progressBar', 'progressLabel', 'exportSummary', 'exportNotice', 'toast', 'installBtn',
  'offlineBadge',
  'modeSelect', 'modeDocBtn', 'modeIdBtn', 'switchModeBtn',
  'idWorkspace', 'idStepBadge', 'idStepHint', 'idChooseBtn', 'idCameraBtn', 'idFileInput', 'idCameraInput',
  'idBackStepBtn', 'idConfirmBtn', 'idEditorSlot', 'idPreviewSection', 'idPreviewCanvas',
  'idEditFrontBtn', 'idEditBackBtn', 'idExportBtn', 'idExportProgress', 'idProgressBar', 'idProgressLabel', 'idExportNotice',
];

function buildSandbox() {
  const elementsById = {};
  const CANVAS_IDS = new Set(['editorCanvas', 'idPreviewCanvas']);
  for (const id of ELEMENT_IDS) elementsById[id] = CANVAS_IDS.has(id) ? makeCanvasEl() : makeEl();
  elementsById.editorCanvas.parentElement = makeEl();
  elementsById.idPreviewCanvas.parentElement = makeEl();
  elementsById.fileInput.files = [];
  elementsById.cameraInput.files = [];
  elementsById.idFileInput.files = [];
  elementsById.idCameraInput.files = [];
  elementsById.fileName.value = 'ScanVuong';
  elementsById.pageSize.value = 'a4';
  elementsById.quality.value = 'standard';
  elementsById.marginToggle.checked = false;
  const editorStub = makeEl();
  const exportPanelStub = makeEl();

  const filterChips = ['auto', 'document', 'bw', 'original'].map((f, i) => {
    const el = makeEl();
    el.tagName = 'BUTTON';
    el.classList.add('filter-chip');
    if (i === 0) el.classList.add('active');
    el.dataset.filter = f;
    return el;
  });

  let lastAnchor = null;
  const body = makeEl();
  let confirmAnswer = true;

  const document_ = {
    querySelector(sel) {
      if (sel.startsWith('#')) return elementsById[sel.slice(1)] || null;
      if (sel === '.filter-chip') return filterChips[0];
      if (sel === '.editor') return editorStub;
      if (sel === '.export-panel') return exportPanelStub;
      return null;
    },
    querySelectorAll(sel) { return sel === '.filter-chip' ? filterChips.slice() : []; },
    createElement(tag) {
      if (tag === 'canvas') return makeCanvasEl();
      const el = makeEl();
      el.tagName = tag.toUpperCase();
      if (tag === 'a') lastAnchor = el;
      return el;
    },
    body,
  };

  const sandbox = {
    console,
    setTimeout, clearTimeout,
    TextEncoder,
    Blob: TestBlob,
    Image: FakeImage,
    ImageData: FakeImageData,
    URL: {
      createObjectURL(blob) { const id = `blob:fake-${blobCounter++}`; blobRegistry.set(id, blob); return id; },
      revokeObjectURL(id) { blobRegistry.delete(id); },
    },
    navigator: { onLine: true },
    location: { protocol: 'http:' },
    confirm: () => confirmAnswer,
    requestAnimationFrame: (cb) => setTimeout(cb, 0),
    cancelAnimationFrame: clearTimeout,
    addEventListener() {},
    document: document_,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  return {
    sandbox, elementsById, filterChips, getLastAnchor: () => lastAnchor,
    setConfirmAnswer: (v) => { confirmAnswer = v; },
  };
}

function loadApp() {
  const src = fs.readFileSync(APP_JS_PATH, 'utf8');
  const hookLine = "\n  globalThis.__TEST_HOOK__ && globalThis.__TEST_HOOK__({ state, exportIdPdf, exportPdf, setBusy, calculateIdA4Layout, composeIdA4 });\n";
  const marker = /\n\}\)\(\);\s*$/;
  if (!marker.test(src)) throw new Error('Could not find IIFE close `})();` at end of app.js to attach test hook');
  const patched = src.replace(marker, `${hookLine}})();\n`);

  const { sandbox, elementsById, filterChips, getLastAnchor, setConfirmAnswer } = buildSandbox();
  let testApi = null;
  sandbox.__TEST_HOOK__ = (api) => { testApi = api; };

  vm.createContext(sandbox);
  vm.runInContext(patched, sandbox, { filename: 'app.js (in-memory, test hook appended)' });

  if (!testApi) throw new Error('app.js did not run to completion / test hook not invoked');
  return { testApi, elementsById, filterChips, getLastAnchor, setConfirmAnswer };
}

// ---------- PDF page-count / MediaBox extraction (read-only, no deps) ----------
function parsePdfPageSizes(buf) {
  const text = buf.toString('latin1');
  const pagesMatch = text.match(/\/Type\s*\/Pages[\s\S]*?\/Kids\s*\[([^\]]*)\]/);
  if (!pagesMatch) throw new Error('Pages object not found in PDF');
  const kids = [...pagesMatch[1].matchAll(/(\d+)\s+0\s+R/g)].map(m => +m[1]);
  return kids.map(pageNum => {
    const objMatch = text.match(new RegExp(`(?:^|\\n)${pageNum} 0 obj\\n([\\s\\S]*?)\\nendobj`));
    if (!objMatch) throw new Error(`page object ${pageNum} not found`);
    const body = objMatch[1];
    const mediaBox = body.match(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/);
    return {
      mediaW: mediaBox ? +mediaBox[3] - +mediaBox[1] : null,
      mediaH: mediaBox ? +mediaBox[4] - +mediaBox[2] : null,
    };
  });
}

async function main() {
  const { testApi, elementsById, getLastAnchor, setConfirmAnswer } = loadApp();
  const { state, calculateIdA4Layout } = testApi;

  console.log('Setup: entering Scan ID mode');
  await elementsById.modeIdBtn.dispatch('click');
  assert(state.mode === 'id', 'setup: modeIdBtn click enters id mode');
  assert(state.idScan.step === 'front', 'setup: id wizard starts on the front step');
  assert(elementsById.idConfirmBtn.disabled === true, 'Case 2: confirm disabled before any file is captured');

  console.log('\nCase 1/2: capturing front then back, front/back land in state.idScan (not state.pages)');
  elementsById.idFileInput.files = [new FakeFile('front.jpg', 800, 500)];
  await elementsById.idFileInput.dispatch('change');
  assert(!!state.idScan.front, 'Case 1: front captured into state.idScan.front');
  assert(state.idScan.front.name === 'front.jpg', 'Case 1: front side has the right file');
  assert(state.pages.length === 0, 'Case 1: capturing an ID side never touches state.pages (document mode untouched)');
  assert(state.idScan.front.filter === 'auto', 'Case 1: ID sides default to the auto-enhance filter, not B&W');
  assert(elementsById.idConfirmBtn.disabled === false, 'Case 2: confirm enabled once the front file is captured');

  await elementsById.idConfirmBtn.dispatch('click');
  assert(state.idScan.step === 'back', 'Case 2: confirming front advances the wizard to the back step');
  assert(elementsById.idBackStepBtn.classList.contains('hidden') === false, 'Case 2: "quay lại" is visible on the back step');
  assert(elementsById.idConfirmBtn.disabled === true, 'Case 2: confirm disabled again on back step until back is captured');

  const frontUrlBeforeBackStep = state.idScan.front.url;
  await elementsById.idBackStepBtn.dispatch('click');
  assert(state.idScan.step === 'front', 'Case 2: "quay lại" rewinds from back to front');
  assert(state.idScan.front && state.idScan.front.url === frontUrlBeforeBackStep, 'Case 2: rewinding does not lose the already-captured front side');
  await elementsById.idConfirmBtn.dispatch('click'); // back to 'back' step for the rest of the flow
  assert(state.idScan.step === 'back', 'Case 2: re-confirming front returns to the back step');

  console.log('\nCase 3: exporting with a missing side is rejected');
  const anchorBeforeRejectedExport = getLastAnchor();
  await elementsById.idExportBtn.dispatch('click');
  assert(getLastAnchor() === anchorBeforeRejectedExport, 'Case 3: no PDF/download produced when back is still missing');
  assert(state.busy === false, 'Case 3: busy is not left stuck true after the missing-side rejection');

  elementsById.idCameraInput.files = [new FakeFile('back.jpg', 4000, 2500)];
  await elementsById.idCameraInput.dispatch('change');
  assert(!!state.idScan.back, 'Case 1: back captured into state.idScan.back (camera input path)');
  assert(state.idScan.back.name === 'back.jpg', 'Case 1: back side has the right file');

  await elementsById.idConfirmBtn.dispatch('click');
  assert(state.idScan.step === 'preview', 'Case 2: confirming back advances the wizard to the A4 preview step');
  // Reaching 'preview' fires renderIdPreview() fire-and-forget (its own
  // setBusy(true/false) brackets the async render, same as everywhere else
  // in the app) — drain it before simulating an unrelated busy state below.
  await new Promise(resolve => setTimeout(resolve, 30));

  console.log('\nCase 4: every Scan ID handler is a no-op while busy');
  testApi.setBusy(true);
  const stepBeforeBusy = state.idScan.step;
  await elementsById.idEditFrontBtn.dispatch('click');
  assert(state.idScan.step === stepBeforeBusy, 'Case 4: "Sửa mặt trước" blocked while busy');
  await elementsById.idChooseBtn.dispatch('click');
  await elementsById.idFileInput.dispatch('change');
  assert(state.idScan.front.name === 'front.jpg', 'Case 4: capturing a new front file blocked while busy');
  await elementsById.modeDocBtn.dispatch('click');
  assert(state.mode === 'id', 'Case 4: switching to document mode blocked while busy');
  await elementsById.switchModeBtn.dispatch('click');
  assert(state.mode === 'id', 'Case 4: "Đổi chế độ" blocked while busy');
  testApi.setBusy(false);

  console.log('\nCase 5: export snapshot immunity — nulling state.idScan mid-export must not crash or block the PDF');
  const exportPromise = elementsById.idExportBtn.dispatch('click');
  assert(state.busy === true, 'export sets state.busy = true synchronously before any await');
  state.idScan.front = null;
  state.idScan.back = null;
  console.log('Directly nulled state.idScan.front/back synchronously right after the export snapshot was taken.');
  await exportPromise;
  assert(state.busy === false, 'busy returns to false after export completes');

  const pdfBlob = blobRegistry.get(getLastAnchor().href);
  assert(!!pdfBlob, 'Case 5: export produced a downloadable PDF blob despite state.idScan being nulled mid-flight');
  assert(getLastAnchor().download === 'ScanVuong-ID.pdf', `Case 5: default filename is ScanVuong-ID.pdf (got "${getLastAnchor() && getLastAnchor().download}")`);
  const pdfBytes = Buffer.from(await pdfBlob.arrayBuffer());
  const pages = parsePdfPageSizes(pdfBytes);
  assert(pages.length === 1, `Case 11: exported PDF has exactly 1 page (got ${pages.length})`);
  assert(
    pages.length === 1 && Math.abs(pages[0].mediaW - 595.28) < 0.01 && Math.abs(pages[0].mediaH - 841.89) < 0.01,
    `Case 11: the single page is A4 portrait (got ${pages[0] && pages[0].mediaW}x${pages[0] && pages[0].mediaH})`
  );

  console.log('\nCase 6: Object URL revocation on replace / mode switch');
  assert(state.idScan.front === null && state.idScan.back === null, 'setup: idScan is clear after the prior export nulled it');
  await elementsById.idEditFrontBtn.dispatch('click');
  assert(state.idScan.step === 'front', 'setup: "Sửa mặt trước" returns to the front step for Case 6 setup');
  elementsById.idFileInput.files = [new FakeFile('side-a.jpg', 400, 252)];
  await elementsById.idFileInput.dispatch('change');
  const firstFrontUrl = state.idScan.front.url;
  assert(blobRegistry.has(firstFrontUrl), 'setup: first front capture registers an Object URL');
  elementsById.idFileInput.files = [new FakeFile('side-b.jpg', 400, 252)];
  await elementsById.idFileInput.dispatch('change');
  assert(!blobRegistry.has(firstFrontUrl), 'Case 6: replacing a captured side revokes the old Object URL');
  assert(state.idScan.front.name === 'side-b.jpg', 'Case 6: the replacement file becomes the active front side');

  const secondFrontUrl = state.idScan.front.url;
  setConfirmAnswer(true);
  await elementsById.switchModeBtn.dispatch('click');
  assert(state.mode === null, 'Case 6: switching mode away from Scan ID returns to the mode-select screen');
  assert(!blobRegistry.has(secondFrontUrl), 'Case 6: leaving Scan ID revokes the in-progress side\'s Object URL');
  assert(state.idScan.front === null && state.idScan.back === null, 'Case 6: idScan is reset after leaving the mode');

  console.log('\nCase 7-10: Layout geometry & invariant verification');
  // Pure geometry testing: input resolutions 800×500 and 4000×2500 (5x resolution difference)
  const layout = calculateIdA4Layout(800, 500, 4000, 2500);
  const expectedTargetW = Math.round(layout.pageW * 0.65);
  const expectedGapPx = Math.round(layout.pageW / 210 * 28); // 28 mm physical gap

  assert(layout.front.width === layout.back.width, `Case 7: front and back have identical rendered width on A4 (got ${layout.front.width} vs ${layout.back.width})`);
  assert(layout.front.width === expectedTargetW, `Case 7: target width is ~65% of A4 width (got ${layout.front.width}/${layout.pageW} = ${(layout.front.width / layout.pageW * 100).toFixed(1)}%)`);

  const frontAspectError = Math.abs((layout.front.width / layout.front.height) - (800 / 500));
  const backAspectError = Math.abs((layout.back.width / layout.back.height) - (4000 / 2500));
  assert(frontAspectError < 0.01, `Case 8: front aspect ratio preserved without stretch (error: ${frontAspectError.toFixed(4)})`);
  assert(backAspectError < 0.01, `Case 8: back aspect ratio preserved without stretch (error: ${backAspectError.toFixed(4)})`);

  assert(layout.front.y + layout.front.height < layout.back.y, `Case 9: front is positioned strictly above back (front bottom ${layout.front.y + layout.front.height} < back top ${layout.back.y})`);
  const interCardGap = layout.back.y - (layout.front.y + layout.front.height);
  assert(Math.abs(interCardGap - expectedGapPx) <= 2, `Case 9: separation gap between cards is ~28 mm (expected ~${expectedGapPx}px, got ${interCardGap}px)`);

  const topWhitespace = layout.front.y;
  const bottomWhitespace = layout.pageH - (layout.back.y + layout.back.height);
  const verticalDelta = Math.abs(topWhitespace - bottomWhitespace);
  assert(verticalDelta <= 2, `Case 9: two-card block is centered vertically on A4 (top: ${topWhitespace}px, bottom: ${bottomWhitespace}px, delta: ${verticalDelta}px)`);

  const insidePage = (
    layout.front.x >= 0 && layout.back.x >= 0 &&
    layout.front.y >= 0 && layout.back.y >= 0 &&
    layout.front.x + layout.front.width <= layout.pageW &&
    layout.back.x + layout.back.width <= layout.pageW &&
    layout.front.y + layout.front.height <= layout.pageH &&
    layout.back.y + layout.back.height <= layout.pageH
  );
  assert(insidePage, 'Case 10: both cards stay strictly within A4 page boundaries');

  const frontCentered = Math.abs(layout.front.x - Math.round((layout.pageW - layout.front.width) / 2)) <= 1;
  const backCentered = Math.abs(layout.back.x - Math.round((layout.pageW - layout.back.width) / 2)) <= 1;
  assert(frontCentered && backCentered, `Case 10: both front and back are centered horizontally on A4 (x: ${layout.front.x}, ${layout.back.x})`);

  console.log('\nCase Fallback: odd-aspect / portrait orientation containment');
  // Card rotated or cropped portrait: 500w × 800h vs normal landscape 4000×2500
  const portraitLayout = calculateIdA4Layout(500, 800, 4000, 2500);
  const maxAllowableH = portraitLayout.pageH - portraitLayout.gap - 100;
  assert(portraitLayout.front.height <= maxAllowableH, `Fallback: portrait-ish side fits within available height (got height ${portraitLayout.front.height} <= ${maxAllowableH})`);
  const portraitAspectError = Math.abs((portraitLayout.front.width / portraitLayout.front.height) - (500 / 800));
  assert(portraitAspectError < 0.01, `Fallback: portrait-ish aspect ratio preserved without distortion (error: ${portraitAspectError.toFixed(4)})`);
  assert(portraitLayout.back.width === expectedTargetW, `Fallback: normal side still receives standard ~65% target width (got ${portraitLayout.back.width})`);
  assert(portraitLayout.front.y + portraitLayout.front.height < portraitLayout.back.y, 'Fallback: front remains above back even with odd aspect ratio');

  const pTop = portraitLayout.front.y;
  const pBottom = portraitLayout.pageH - (portraitLayout.back.y + portraitLayout.back.height);
  const pDelta = Math.abs(pTop - pBottom);
  assert(pDelta <= 2, `Fallback: whole block remains centered vertically with odd aspect ratio (top: ${pTop}px, bottom: ${pBottom}px, delta: ${pDelta}px)`);

  // Degenerate inputs (0x0 or invalid) handled safely
  const degenLayout = calculateIdA4Layout(0, 0, 0, 0);
  assert(Number.isFinite(degenLayout.front.width) && Number.isFinite(degenLayout.back.height), 'Fallback: degenerate input dimensions handled safely without NaN');

  console.log(`\n${checks - failures}/${checks} checks passed.`);
  if (failures > 0) {
    console.error(`${failures} check(s) FAILED.`);
    process.exit(1);
  }
  console.log('All Scan ID regression checks PASSED.');
}

main().catch(err => {
  console.error('Regression harness crashed:', err);
  process.exit(1);
});

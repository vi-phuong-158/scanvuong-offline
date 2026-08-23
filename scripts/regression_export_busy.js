#!/usr/bin/env node
'use strict';
// Dependency-free regression harness for the export-snapshot / busy-lock fix.
//
// Loads the REAL app.js (unmodified on disk) into a minimal fake-DOM sandbox
// via Node's vm module, drives it through the actual DOM event handlers
// (fileInput 'change', thumbnail drag/drop, button clicks, exportBtn click),
// and inspects a small debug hook appended only to the in-memory copy of the
// source (never written back to app.js) to reach the closured `state` for
// assertions that can't be observed through the DOM alone.
//
// Proves:
//   Case 1 — reordering state.pages while export is running does not change
//            the page order in the produced PDF.
//   Case 2 — changing a page's filter after the export snapshot was taken
//            does not affect the exported page.
//   Case 3 — changing a page's corners/rotation after the snapshot was taken
//            does not affect the exported page.
//   Case 4 — while state.busy is true, the guarded mutation handlers (add,
//            camera, drop import, thumb reorder, move up/down, rotate,
//            delete, clear all, reset crop, detect, filter change) refuse to
//            change page count / order / filter / crop.
//   Case 5 — changing pageSize / margin / fileName (or quality) after the
//            export job snapshot was taken does not affect the exported PDF,
//            and those controls are disabled while busy.

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

// ---------- Minimal fake DOM ----------

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
    // Pixel content is irrelevant to this regression (it only checks
    // order/filter/rotation bookkeeping), so a correctly-sized zero buffer
    // is enough for the real detectDocument()/warpCpu() math to run without
    // throwing.
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
  el.toBlob = (cb, type) => { setTimeout(() => cb(new sandboxBlobClass(['x'], { type: type || 'image/jpeg' })), 0); };
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
const sandboxBlobClass = TestBlob;

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

// ---------- ids referenced by app.js's `els` map ----------
const ELEMENT_IDS = [
  'emptyState', 'workspace', 'dropZone', 'chooseBtn', 'cameraBtn', 'addBtn', 'fileInput', 'cameraInput',
  'pageCount', 'reviewCount', 'thumbList', 'editorCanvas', 'processingOverlay', 'processingText',
  'confidenceDot', 'confidenceText', 'detectBtn', 'resetCropBtn', 'rotateBtn', 'moveUpBtn', 'moveDownBtn',
  'deleteBtn', 'autoAllBtn', 'clearBtn', 'fileName', 'pageSize', 'quality', 'marginToggle', 'exportBtn',
  'exportProgress', 'progressBar', 'progressLabel', 'exportSummary', 'exportNotice', 'toast', 'installBtn',
  'offlineBadge',
  // Mode select + Scan ID (present so app.js's `els` map resolves; this
  // harness only drives the document-mode flow, see regression_scan_id.js
  // for the Scan ID-specific harness).
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
  elementsById.fileName.value = 'VigilLens';
  elementsById.pageSize.value = 'a4';
  elementsById.quality.value = 'standard';
  elementsById.marginToggle.checked = false;
  const editorStub = makeEl();
  const exportPanelStub = makeEl();

  const filterChips = ['document', 'bw', 'original'].map((f, i) => {
    const el = makeEl();
    el.tagName = 'BUTTON';
    el.classList.add('filter-chip');
    if (i === 0) el.classList.add('active');
    el.dataset.filter = f;
    return el;
  });

  let lastAnchor = null;
  const body = makeEl();

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
    confirm: () => true,
    requestAnimationFrame: (cb) => setTimeout(cb, 0),
    cancelAnimationFrame: clearTimeout,
    addEventListener() {},
    document: document_,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  return { sandbox, elementsById, filterChips, getLastAnchor: () => lastAnchor };
}

// ---------- load the real app.js with a debug hook appended in-memory only ----------
function loadApp() {
  const src = fs.readFileSync(APP_JS_PATH, 'utf8');
  const hookLine = "\n  globalThis.__TEST_HOOK__ && globalThis.__TEST_HOOK__({ state, exportPdf, makeJpegs, snapshotPagesForExport, snapshotExportJob, setBusy });\n";
  const marker = /\n\}\)\(\);\s*$/;
  if (!marker.test(src)) throw new Error('Could not find IIFE close `})();` at end of app.js to attach test hook');
  const patched = src.replace(marker, `${hookLine}})();\n`);

  const { sandbox, elementsById, filterChips, getLastAnchor } = buildSandbox();
  let testApi = null;
  sandbox.__TEST_HOOK__ = (api) => { testApi = api; };

  vm.createContext(sandbox);
  vm.runInContext(patched, sandbox, { filename: 'app.js (in-memory, test hook appended)' });

  if (!testApi) throw new Error('app.js did not run to completion / test hook not invoked');
  return { testApi, elementsById, filterChips, getLastAnchor };
}

// ---------- PDF page-size extraction (buildPdf's format, read-only, no deps) ----------
function parsePdfPageSizes(buf) {
  const text = buf.toString('latin1');
  const pagesMatch = text.match(/\/Type\s*\/Pages[\s\S]*?\/Kids\s*\[([^\]]*)\]/);
  if (!pagesMatch) throw new Error('Pages object not found in PDF');
  const kids = [...pagesMatch[1].matchAll(/(\d+)\s+0\s+R/g)].map(m => +m[1]);
  return kids.map(pageNum => {
    const objMatch = text.match(new RegExp(`(?:^|\\n)${pageNum} 0 obj\\n([\\s\\S]*?)\\nendobj`));
    if (!objMatch) throw new Error(`page object ${pageNum} not found`);
    const body = objMatch[1];
    const imgRef = body.match(/\/XObject\s*<<\s*\/Im\d+\s+(\d+)\s+0\s+R/);
    if (!imgRef) throw new Error(`image XObject ref not found for page ${pageNum}`);
    const imgNum = +imgRef[1];
    const headerIdx = text.indexOf(`${imgNum} 0 obj\n`);
    const streamIdx = text.indexOf('stream\n', headerIdx);
    const dictText = text.slice(headerIdx, streamIdx);
    const mediaBox = body.match(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/);
    const contentRef = body.match(/\/Contents\s+(\d+)\s+0\s+R/);
    const contentNum = contentRef ? +contentRef[1] : null;
    let cm = null;
    if (contentNum) {
      const cHeaderIdx = text.indexOf(`${contentNum} 0 obj\n`);
      const cStreamIdx = text.indexOf('stream\n', cHeaderIdx) + 'stream\n'.length;
      const cEndIdx = text.indexOf('\nendstream', cStreamIdx);
      const contentText = text.slice(cStreamIdx, cEndIdx);
      const cmMatch = contentText.match(/([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm/);
      if (cmMatch) cm = { dw: +cmMatch[1], dh: +cmMatch[2], dx: +cmMatch[3], dy: +cmMatch[4] };
    }
    return {
      width: +dictText.match(/\/Width\s+(\d+)/)[1],
      height: +dictText.match(/\/Height\s+(\d+)/)[1],
      mediaW: mediaBox ? +mediaBox[3] - +mediaBox[1] : null,
      mediaH: mediaBox ? +mediaBox[4] - +mediaBox[2] : null,
      cm,
    };
  });
}

async function main() {
  const { testApi, elementsById, filterChips, getLastAnchor } = loadApp();
  const { state } = testApi;

  console.log('Setup: entering document mode (fileInput/cameraInput/dropZone are guarded to no-op outside it)');
  await elementsById.modeDocBtn.dispatch('click');
  assert(state.mode === 'document', 'setup: modeDocBtn click enters document mode');

  console.log('Setup: adding 3 synthetic pages (A, B, C — distinct sizes so PDF page order is verifiable)');
  elementsById.fileInput.files = [
    new FakeFile('A.jpg', 300, 400),
    new FakeFile('B.jpg', 600, 800),
    new FakeFile('C.jpg', 900, 1200),
  ];
  await elementsById.fileInput.dispatch('change');
  assert(state.pages.length === 3, 'setup: 3 pages added');
  assert(state.pages.map(p => p.name).join(',') === 'A.jpg,B.jpg,C.jpg', 'setup: pages in A,B,C order');
  assert(state.busy === false, 'setup: busy is false once import finishes');

  console.log('\nStarting export, then attempting every guarded mutation mid-flight...');
  const thumbBtnsAtStart = elementsById.thumbList.children.slice();
  const exportPromise = elementsById.exportBtn.dispatch('click');
  assert(state.busy === true, 'export sets state.busy = true synchronously before any await');

  // --- Cases 2 & 3: prove the SNAPSHOT itself is immune, independent of the
  // guards below — mutate a live page object directly (bypassing all UI),
  // simulating a bug that let a change slip through the guards. This must
  // happen synchronously, in the same tick as the click above and before any
  // `await`, so it lands before the export pipeline's first microtask
  // (loadImage's decode) has a chance to run — otherwise the assertion would
  // be timing-dependent instead of a real "changed after snapshot" case.
  // Page B (index 1) is used rather than the selected page (A, index 0) so
  // this doesn't interfere with the Case 4 checks below, which all act on
  // whichever page is currently selected (A).
  state.pages[1].filter = 'bw';
  state.pages[1].rotation = 90;
  state.pages[1].corners = [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }, { x: 0.8, y: 0.8 }, { x: 0.2, y: 0.8 }];
  // Case 1 (direct form): flip state.pages to C,B,A, bypassing the reorder
  // guard entirely, the same way the task describes ("state UI đổi sang
  // C/B/A" while export runs) — the snapshot must already hold A,B,C.
  state.pages.reverse();
  const orderAfterDirectMutation = state.pages.map(p => p.name).join(',');
  const findPage = (name) => state.pages.find(p => p.name === name);
  const pageAOriginal = { rotation: findPage('A.jpg').rotation, corners: JSON.parse(JSON.stringify(findPage('A.jpg').corners)), filter: findPage('A.jpg').filter };
  console.log('Directly mutated state.pages (reversed order + page B filter/rotation/corners) synchronously right after the export snapshot was taken.');

  // --- Case 5: export-job settings (pageSize/margin/fileName/quality) must
  // also be frozen at click time, not re-read after the render loop. These
  // controls have no dedicated change handler to "bypass" — setting them
  // directly is the equivalent of a user interacting with a control that is
  // visually disabled but not physically unable to receive a programmatic
  // value change, so this checks the snapshot itself, same spirit as Cases 2 & 3.
  assert(elementsById.pageSize.disabled === true, 'Case 5: pageSize control disabled while busy');
  assert(elementsById.quality.disabled === true, 'Case 5: quality control disabled while busy');
  assert(elementsById.marginToggle.disabled === true, 'Case 5: marginToggle control disabled while busy');
  assert(elementsById.fileName.disabled === true, 'Case 5: fileName control disabled while busy');
  elementsById.pageSize.value = 'fit';
  elementsById.marginToggle.checked = true;
  elementsById.fileName.value = 'Hacked';
  elementsById.quality.value = 'high';
  console.log('Directly mutated pageSize/margin/fileName/quality synchronously right after the export job snapshot was taken.');

  // --- Case 4: busy=true must block every mutating handler ---
  // (checks below compare against `orderAfterDirectMutation`/`pageAOriginal`
  // — the state as of just above, not the pre-export state — since the
  // direct mutation above intentionally bypassed the guards; what Case 4
  // actually proves is that the *guarded* handlers add no further changes
  // on top of that.)
  await thumbBtnsAtStart[0].dispatch('dragstart', { target: thumbBtnsAtStart[0] });
  await thumbBtnsAtStart[2].dispatch('drop', { target: thumbBtnsAtStart[2] });
  assert(state.pages.map(p => p.name).join(',') === orderAfterDirectMutation, 'Case 4: thumb drag/drop reorder blocked while busy');

  await elementsById.moveDownBtn.dispatch('click');
  await elementsById.moveUpBtn.dispatch('click');
  assert(state.pages.map(p => p.name).join(',') === orderAfterDirectMutation, 'Case 4: move up/down blocked while busy');

  await elementsById.deleteBtn.dispatch('click');
  assert(state.pages.length === 3, 'Case 4: delete page blocked while busy');

  await elementsById.clearBtn.dispatch('click');
  assert(state.pages.length === 3, 'Case 4: clear all blocked while busy');

  await elementsById.rotateBtn.dispatch('click');
  assert(findPage('A.jpg').rotation === pageAOriginal.rotation, 'Case 4: rotate blocked while busy');

  await elementsById.resetCropBtn.dispatch('click');
  assert(JSON.stringify(findPage('A.jpg').corners) === JSON.stringify(pageAOriginal.corners), 'Case 4: reset crop blocked while busy');

  await elementsById.detectBtn.dispatch('click');
  assert(JSON.stringify(findPage('A.jpg').corners) === JSON.stringify(pageAOriginal.corners), 'Case 4: re-detect blocked while busy');

  await filterChips[1].dispatch('click');
  assert(findPage('A.jpg').filter === pageAOriginal.filter, 'Case 4: filter change blocked while busy');

  elementsById.fileInput.files = [new FakeFile('D.jpg', 100, 100)];
  await elementsById.fileInput.dispatch('change');
  assert(state.pages.length === 3, 'Case 4: adding a new file blocked while busy');

  await elementsById.dropZone.dispatch('drop', { dataTransfer: { files: [new FakeFile('E.jpg', 100, 100)] } });
  assert(state.pages.length === 3, 'Case 4: drag/drop import blocked while busy');

  const secondExport = elementsById.exportBtn.dispatch('click');
  assert(state.busy === true, 'Case 4: starting a second export while busy is a no-op (guarded)');

  await exportPromise;
  await secondExport;

  assert(getLastAnchor().download === 'VigilLens.pdf', `Case 5: downloaded filename uses the frozen fileName, not the mid-export edit (got "${getLastAnchor().download}")`);

  const pdfBlob = blobRegistry.get(getLastAnchor().href);
  assert(!!pdfBlob, 'export produced a downloadable PDF blob');
  const pdfBytes = Buffer.from(await pdfBlob.arrayBuffer());
  const pages = parsePdfPageSizes(pdfBytes);

  assert(pages.length === 3, `Case 1: exported PDF has 3 pages (got ${pages.length})`);
  // A/B/C were given strictly increasing intrinsic sizes (300<600<900 wide),
  // so strictly increasing output widths, in order, is direct evidence the
  // PDF page order matches the snapshot order rather than any order state
  // .pages was in when the (blocked) reorder attempts happened.
  assert(
    pages.length === 3 && pages[0].width < pages[1].width && pages[1].width < pages[2].width,
    `Case 1: PDF pages are in original A,B,C order by output width (${pages.map(p => p.width).join(',')})`
  );
  // Page B (snapshot index 1): snapshot took rotation=0 → portrait (h>w). If
  // export had used live state (rotation mutated to 90 after the snapshot),
  // this would flip to landscape.
  assert(pages.length === 3 && pages[1].height > pages[1].width, 'Case 3: page B stays portrait — export used the frozen (pre-mutation) rotation, not the live one');

  // pageSize was snapshotted as 'a4' (portrait, since our test images are all
  // portrait-ish); if the live 'fit' edit had leaked in, the MediaBox height
  // would track the image aspect ratio instead of the fixed A4 point size.
  assert(
    pages.every(p => Math.abs(p.mediaW - 595.28) < 0.01 && Math.abs(p.mediaH - 841.89) < 0.01),
    `Case 5: PDF pages use the frozen 'a4' page size, not the mid-export 'fit' edit (got ${pages.map(p => `${p.mediaW}x${p.mediaH}`).join(', ')})`
  );
  // margin was snapshotted as false (no padding); if the live margin=true edit
  // had leaked in, the image would be scaled down and inset from the page
  // edges. With no margin the scaled image should span almost the full
  // MediaBox on at least one axis.
  assert(
    pages.every(p => p.cm && (Math.abs(p.cm.dw - p.mediaW) < 1 || Math.abs(p.cm.dh - p.mediaH) < 1)),
    'Case 5: PDF pages use the frozen margin=false layout, not the mid-export margin=true edit'
  );

  console.log('\nExport finished; busy state restored:');
  assert(state.busy === false, 'busy returns to false after export completes');
  assert(elementsById.exportBtn.disabled === false, 'exportBtn re-enabled after export completes');

  console.log(`\n${checks - failures}/${checks} checks passed.`);
  if (failures > 0) {
    console.error(`${failures} check(s) FAILED.`);
    process.exit(1);
  }
  console.log('All export-snapshot / busy-lock regression checks PASSED.');
}

main().catch(err => {
  console.error('Regression harness crashed:', err);
  process.exit(1);
});

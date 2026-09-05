#!/usr/bin/env node
'use strict';
// Dependency-free regression harness proving detectPage() keeps two failure
// domains separate: loadImage() (real image decode) vs. the corner-detection
// block (canvas draw of a working thumbnail + ML/classical edge detection).
//
// Root cause this covers: before this fix, detectPage()'s corner-detection
// block ran with NO catch of its own, inside the same try as the decode call.
// Any exception there — a WASM/ONNX crash, a canvas edge case, a bug in
// detectDocument() — propagated out of detectPage() exactly like a genuine
// decode failure would, and both addFiles() and addIdFile() only had one
// catch clause: they could not tell the two apart, so a perfectly decodable
// photo whose EDGE DETECTOR merely crashed was discarded and reported to the
// operator as "Không đọc được ảnh này" (cannot decode the image) — false.
//
// Proves:
//   Case 1 — Document mode: DocumentDetector.detect() throws on an otherwise
//            decodable photo. The page must be KEPT (not dropped), tagged
//            detectorSource 'DETECTION_ERROR_FALLBACK', given the full-frame
//            default crop, flagged for manual review (confidence < 0.58), and
//            the toast must NOT be the decode-failure message.
//   Case 2 — Scan ID: same DocumentDetector crash while capturing the front
//            side. The side must be KEPT (idConfirmBtn enabled), NOT dropped
//            like a real decode failure would be, and the toast must not be
//            the decode-failure message either.
//   Case 3 — Canvas-stage failure (detectDocument()'s getImageData throws,
//            e.g. a real SecurityError) hits the exact same fallback —
//            proving the isolation covers the whole detection block, not
//            just the ML call.
//   Case 4 — Baseline unchanged: when the file is genuinely undecodable (every
//            createImageBitmap/<img> rung fails), the page/side is still
//            correctly dropped and the operator still sees the decode-failure
//            message — this fix must not blunt real decode-failure handling.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const APP_JS_PATH = path.join(ROOT, 'app.js');

let failures = 0;
let checks = 0;
function assert(cond, msg) {
  checks++;
  if (!cond) { failures++; console.error(`  ✗ ${msg}`); }
  else console.log(`  ✓ ${msg}`);
}

// ---------- Minimal fake DOM (same shape as regression_scan_id.js) ----------

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

// canvasFailurePolicy simulates a canvas-stage failure (e.g. a real
// SecurityError/InvalidStateError from getImageData) INSIDE the classical CV
// fallback (detectDocument()), without touching the unrelated live preview
// refresh that also happens to run in the background during addFiles()/
// addIdFile() (app.js fires that preview render-and-forget from
// updateShell()/updateIdShell(), so it is not something a test controls).
// detectDocument()'s working canvas has a deterministic, distinctive size for
// a given source: for the 1200x1600 fixture used below with a 560px detection
// cap, it is exactly 420x560 — the live preview's own working canvas (built
// against the ~800x600 stage size in this fake DOM) lands at a different size
// (~431x574), so keying the failure on canvas dimensions hits only the
// detection path under test, with no dependency on Promise scheduling order.
const canvasFailurePolicy = { getImageDataThrowsForSize: null };

function make2dContext(canvas) {
  return {
    imageSmoothingEnabled: true, imageSmoothingQuality: 'high',
    fillStyle: '', strokeStyle: '', lineWidth: 1,
    get filter() { return canvas.__filter || 'none'; }, set filter(v) { canvas.__filter = v; },
    save() {}, restore() {}, translate() {}, rotate() {}, scale() {}, setTransform() {},
    clearRect() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {}, stroke() {}, arc() {},
    drawImage() {},
    getImageData(x, y, w, h) {
      const poison = canvasFailurePolicy.getImageDataThrowsForSize;
      if (poison && w === poison.w && h === poison.h) throw new Error('simulated canvas getImageData failure (e.g. SecurityError)');
      return { data: new Uint8ClampedArray(Math.max(0, w * h * 4)), width: w, height: h };
    },
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

function makeDialogEl() {
  const el = makeEl();
  el.tagName = 'DIALOG';
  el.open = false;
  el.showModal = function () { this.open = true; };
  el.close = function () { this.open = false; };
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

// decodePolicy controls whether the fake decoders succeed. When
// bitmapAvailable/elementDecodes are both false, this simulates a file that is
// genuinely undecodable (Case 4's baseline check).
const decodePolicy = { bitmapAvailable: true, elementDecodes: true };

function makeCreateImageBitmap() {
  return function createImageBitmap(blob) {
    if (!decodePolicy.bitmapAvailable) return Promise.reject(new Error('unavailable'));
    return Promise.resolve({ width: blob._width || 1200, height: blob._height || 1600, closed: false, close() { this.closed = true; } });
  };
}

class FakeImage {
  constructor() { this._src = null; this.width = 0; this.height = 0; this.onload = null; this.onerror = null; }
  set src(v) {
    this._src = v;
    const blob = blobRegistry.get(v);
    setTimeout(() => {
      if (decodePolicy.elementDecodes && blob) {
        this.width = blob._width || 1200; this.height = blob._height || 1600;
        if (this.onload) this.onload();
      } else if (this.onerror) this.onerror();
    }, 0);
  }
  get src() { return this._src; }
  decode() { return decodePolicy.elementDecodes ? Promise.resolve() : Promise.reject(new Error('decode failed')); }
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
  'idEditFrontBtn', 'idEditBackBtn', 'idExportBtn', 'idExportProgress', 'idProgressBar', 'idProgressLabel', 'idExportNotice',,
  // Global Help (cross-application, see docs/brain/03-decisions.md)
  'helpBtn', 'helpDialog', 'helpClose', 'partyHelpLinkEmpty', 'partyHelpLinkToolbar', 'helpGotoDocBtn', 'helpGotoIdBtn', 'helpGotoPartyBtn', 'helpGotoWatermarkBtn'
];

function buildSandbox(documentDetectorStub) {
  const elementsById = {};
  const CANVAS_IDS = new Set(['editorCanvas', 'idPreviewCanvas']);
  const DIALOG_IDS = new Set(['helpDialog']);
  for (const id of ELEMENT_IDS) elementsById[id] = CANVAS_IDS.has(id) ? makeCanvasEl() : DIALOG_IDS.has(id) ? makeDialogEl() : makeEl();
  elementsById.editorCanvas.parentElement = makeEl();
  elementsById.idPreviewCanvas.parentElement = makeEl();
  elementsById.fileInput.files = [];
  elementsById.cameraInput.files = [];
  elementsById.idFileInput.files = [];
  elementsById.idCameraInput.files = [];
  elementsById.fileName.value = 'VigilLens';
  elementsById.pageSize.value = 'a4';
  elementsById.quality.value = 'standard';
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
    createImageBitmap: makeCreateImageBitmap(),
    DocumentDetector: documentDetectorStub,
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
  return { sandbox, elementsById };
}

function loadApp(documentDetectorStub) {
  const src = fs.readFileSync(APP_JS_PATH, 'utf8');
  const hookLine = "\n  globalThis.__TEST_HOOK__ && globalThis.__TEST_HOOK__({ state, detectPage, DECODE_HELP, ImageDecodeError });\n";
  const marker = /\n\}\)\(\);\s*$/;
  if (!marker.test(src)) throw new Error('Could not find IIFE close `})();` at end of app.js to attach test hook');
  const patched = src.replace(marker, `${hookLine}})();\n`);

  const { sandbox, elementsById } = buildSandbox(documentDetectorStub);
  let testApi = null;
  sandbox.__TEST_HOOK__ = (api) => { testApi = api; };
  vm.createContext(sandbox);
  vm.runInContext(patched, sandbox, { filename: 'app.js (in-memory, test hook appended)' });
  if (!testApi) throw new Error('app.js did not run to completion / test hook not invoked');
  return { testApi, elementsById };
}

async function main() {
  // ---------- Case 1: Document mode, DocumentDetector throws ----------
  {
    console.log('Case 1: Document mode — DocumentDetector.detect() throws on a decodable photo');
    decodePolicy.bitmapAvailable = true; decodePolicy.elementDecodes = true;
    canvasFailurePolicy.getImageDataThrowsForSize = null;
    const throwingDetector = { detect: async () => { throw new Error('simulated ML/WASM crash'); } };
    const { testApi, elementsById } = loadApp(throwingDetector);
    const { state } = testApi;

    await elementsById.modeDocBtn.dispatch('click');
    const file = new FakeFile('IMG_20260905_photo.jpg', 1200, 1600);
    elementsById.fileInput.files = [file];
    await elementsById.fileInput.dispatch('change');

    assert(state.pages.length === 1, `the decodable page is KEPT despite the detector crashing (got ${state.pages.length} page(s))`);
    if (state.pages.length === 1) {
      const page = state.pages[0];
      assert(page.detectorSource === 'DETECTION_ERROR_FALLBACK', `page is tagged DETECTION_ERROR_FALLBACK (got ${page.detectorSource})`);
      assert(Array.isArray(page.corners) && page.corners.length === 4, 'page still has a usable 4-point crop (full-frame default)');
      assert(page.confidence < 0.58, `page is flagged for manual review (confidence ${page.confidence} < 0.58)`);
      assert(page.width > 0 && page.height > 0, `page width/height are still populated without the working canvas (${page.width}x${page.height})`);
    }
    assert(!elementsById.toast.textContent.includes('Không đọc được ảnh'), `toast does NOT claim the image could not be decoded (got "${elementsById.toast.textContent}")`);
  }

  // ---------- Case 2: Scan ID, DocumentDetector throws ----------
  {
    console.log('\nCase 2: Scan ID — DocumentDetector.detect() throws while capturing the front side');
    decodePolicy.bitmapAvailable = true; decodePolicy.elementDecodes = true;
    canvasFailurePolicy.getImageDataThrowsForSize = null;
    const throwingDetector = { detect: async () => { throw new Error('simulated ML/WASM crash'); } };
    const { testApi, elementsById } = loadApp(throwingDetector);
    const { state, DECODE_HELP } = testApi;

    await elementsById.modeIdBtn.dispatch('click');
    const file = new FakeFile('front.jpg', 1200, 1600);
    elementsById.idFileInput.files = [file];
    await elementsById.idFileInput.dispatch('change');

    assert(state.idScan.front !== null, 'the front side is KEPT despite the detector crashing (not dropped like a real decode failure)');
    if (state.idScan.front) {
      assert(state.idScan.front.detectorSource === 'DETECTION_ERROR_FALLBACK', `front side is tagged DETECTION_ERROR_FALLBACK (got ${state.idScan.front.detectorSource})`);
    }
    assert(elementsById.idConfirmBtn.disabled === false, 'idConfirmBtn is enabled — the wizard can proceed past a detector crash');
    assert(elementsById.toast.textContent !== DECODE_HELP, `toast is not the decode-failure message (got "${elementsById.toast.textContent}")`);
  }

  // ---------- Case 3: canvas-stage failure (not the ML call) ----------
  {
    console.log('\nCase 3: Canvas render failure (detectDocument()\'s getImageData) hits the same fallback, not just ML crashes');
    decodePolicy.bitmapAvailable = true; decodePolicy.elementDecodes = true;
    canvasFailurePolicy.getImageDataThrowsForSize = { w: 420, h: 560 };
    const { testApi, elementsById } = loadApp(undefined); // DocumentDetector undefined -> detectPage() calls detectDocument() directly, which is what throws
    const { state } = testApi;

    await elementsById.modeDocBtn.dispatch('click');
    const file = new FakeFile('IMG_canvas_fail.jpg', 1200, 1600);
    elementsById.fileInput.files = [file];
    await elementsById.fileInput.dispatch('change');

    assert(state.pages.length === 1, `the decodable page is KEPT despite the canvas draw crashing (got ${state.pages.length} page(s))`);
    if (state.pages.length === 1) {
      assert(state.pages[0].detectorSource === 'DETECTION_ERROR_FALLBACK', `page is tagged DETECTION_ERROR_FALLBACK (got ${state.pages[0].detectorSource})`);
    }
    assert(!elementsById.toast.textContent.includes('Không đọc được ảnh'), `toast does NOT claim the image could not be decoded (got "${elementsById.toast.textContent}")`);
    canvasFailurePolicy.getImageDataThrowsForSize = null;
  }

  // ---------- Case 4: baseline unchanged — a genuinely undecodable file still fails as a decode failure ----------
  {
    console.log('\nCase 4: baseline unchanged — a genuinely undecodable file is still correctly dropped as a decode failure');
    decodePolicy.bitmapAvailable = false; decodePolicy.elementDecodes = false;
    canvasFailurePolicy.getImageDataThrowsForSize = null;
    const { testApi, elementsById } = loadApp(undefined);
    const { state, DECODE_HELP } = testApi;

    await elementsById.modeDocBtn.dispatch('click');
    const file = new FakeFile('IMG_truly_broken.jpg', 1200, 1600);
    elementsById.fileInput.files = [file];
    await elementsById.fileInput.dispatch('change');
    assert(state.pages.length === 0, `an undecodable page is still dropped (got ${state.pages.length} page(s))`);
    assert(elementsById.toast.textContent === DECODE_HELP, `toast is still the decode-failure message for a real decode failure (got "${elementsById.toast.textContent}")`);

    await elementsById.switchModeBtn.dispatch('click');
    await elementsById.modeIdBtn.dispatch('click');
    const front = new FakeFile('front_broken.jpg', 1200, 1600);
    elementsById.idFileInput.files = [front];
    await elementsById.idFileInput.dispatch('change');
    assert(state.idScan.front === null, 'an undecodable Scan ID side is still dropped');
    assert(elementsById.idConfirmBtn.disabled === true, 'idConfirmBtn is still disabled after a real decode failure');
    decodePolicy.bitmapAvailable = true; decodePolicy.elementDecodes = true;
  }

  console.log(`\n${checks - failures}/${checks} checks passed.`);
  if (failures) { console.error('Detection/decode isolation regression FAILED.'); process.exit(1); }
  console.log('All detection/decode isolation regression checks PASSED.');
}

main().catch(err => { console.error('Regression harness crashed:', err); process.exit(1); });

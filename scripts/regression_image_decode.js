#!/usr/bin/env node
'use strict';
// Dependency-free regression harness for the image decode ladder in app.js
// (loadImage / releaseImage / sniffImageSize). Same technique as
// regression_scan_id.js: the REAL app.js is loaded unmodified from disk into a
// minimal fake-DOM sandbox via Node's vm module, with a controllable
// createImageBitmap and <img> so each decode failure mode a phone photo hits
// on a real device can be reproduced deterministically here.
//
// Reproduces the reported defect: a photo taken with a phone reached the Scan
// ID export with an undecodable file, so the only feedback the operator got
// was a blank A4 preview and the browser's raw English DOMException
// ("The source image cannot be decoded.") at 5% of the export.
//
// Proves:
//   Case 1 — sniffImageSize() reads JPEG/PNG/WEBP dimensions from the header.
//   Case 2 — an oversized camera photo is decoded downscaled (resizeWidth
//            <= MAX_DECODE_EDGE) instead of being expanded at full resolution.
//   Case 3 — a full-resolution decode that fails still succeeds through the
//            downscale retries, so the export is not lost.
//   Case 4 — when every createImageBitmap shape fails, the <img> fallback
//            runs and its Object URL stays alive until releaseImage(), never
//            revoked while the decoded image is still in use.
//   Case 5 — when nothing can decode the file, loadImage throws
//            ImageDecodeError carrying the Vietnamese guidance, not the raw
//            browser DOMException.
//   Case 6 — a File whose bytes are no longer readable (Android content://
//            that went away) still reaches the <img> fallback.
//   Case 7 — capturing an undecodable photo in Scan ID drops the side and
//            keeps the wizard on that step: the operator can never reach the
//            A4 preview / Export with a side that cannot be rendered.

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

// ---------- Header fixtures (real byte layouts, not mocks) ----------

function jpegHeader(width, height) {
  const app0 = [0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const sof = [0xFF, 0xC0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xFF, height & 0xFF, (width >> 8) & 0xFF, width & 0xFF,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01];
  return Uint8Array.from([0xFF, 0xD8, ...app0, ...sof, 0xFF, 0xDA, 0x00, 0x0C]);
}

function pngHeader(width, height) {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], 0);
  new DataView(b.buffer).setUint32(8, 13);
  b.set([0x49, 0x48, 0x44, 0x52], 12);
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  return b;
}

function webpLosslessHeader(width, height) {
  const b = new Uint8Array(30);
  b.set([0x52, 0x49, 0x46, 0x46], 0);
  b.set([0x57, 0x45, 0x42, 0x50], 8);
  b.set([0x56, 0x50, 0x38, 0x4C], 12);
  b[20] = 0x2F;
  const bits = (((height - 1) & 0x3FFF) * 16384 + ((width - 1) & 0x3FFF)) >>> 0;
  b[21] = bits & 0xFF; b[22] = (bits >>> 8) & 0xFF; b[23] = (bits >>> 16) & 0xFF; b[24] = (bits >>> 24) & 0xFF;
  return b;
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
      if (p instanceof ArrayBuffer) return Buffer.from(p);
      return Buffer.alloc(0);
    });
    this._buf = Buffer.concat(chunks);
    this.type = (opts && opts.type) || '';
    this.size = this._buf.length;
  }
  arrayBuffer() {
    if (this._unreadable) return Promise.reject(new Error('NotReadableError: The requested file could not be read'));
    return Promise.resolve(this._buf.buffer.slice(this._buf.byteOffset, this._buf.byteOffset + this._buf.byteLength));
  }
}

// A picked photo: real header bytes, plus knobs for the failure modes.
class FakeFile extends TestBlob {
  constructor(name, bytes, opts = {}) {
    super([bytes], { type: opts.type === undefined ? 'image/jpeg' : opts.type });
    this.name = name;
    this._unreadable = !!opts.unreadable;
  }
}

let blobCounter = 0;
const blobRegistry = new Map();
const liveObjectUrls = new Set();

// Decode policy shared by the createImageBitmap and <img> stubs, reset per case.
const decodePolicy = {
  bitmapMaxEdge: Infinity,   // full-res decode fails above this (mobile OOM)
  bitmapAvailable: true,
  elementDecodes: true,
  calls: [],
};

function makeCreateImageBitmap() {
  return function createImageBitmap(blob, options) {
    decodePolicy.calls.push({ resizeWidth: options && options.resizeWidth, options: options || null });
    const w = options && options.resizeWidth ? options.resizeWidth : (blob._width || 0);
    if (!decodePolicy.bitmapAvailable) return Promise.reject(new Error('unavailable'));
    if (w > decodePolicy.bitmapMaxEdge || w === 0) {
      const err = new Error('The source image cannot be decoded.');
      err.name = 'InvalidStateError';
      return Promise.reject(err);
    }
    return Promise.resolve({ width: w, height: Math.round(w * 0.75), closed: false, close() { this.closed = true; } });
  };
}

class FakeImage {
  constructor() { this._src = null; this.width = 0; this.height = 0; this.onload = null; this.onerror = null; }
  set src(v) {
    this._src = v;
    setTimeout(() => {
      if (decodePolicy.elementDecodes && liveObjectUrls.has(v)) {
        this.width = 1200; this.height = 900;
        if (this.onload) this.onload();
      } else if (this.onerror) this.onerror();
    }, 0);
  }
  get src() { return this._src; }
  // Mirrors Android builds where decode() rejects but the element still loads.
  decode() { return Promise.reject(new Error('EncodingError: The source image cannot be decoded.')); }
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

function buildSandbox() {
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
    URL: {
      createObjectURL(blob) {
        const id = `blob:fake-${blobCounter++}`;
        blobRegistry.set(id, blob); liveObjectUrls.add(id);
        return id;
      },
      revokeObjectURL(id) { blobRegistry.delete(id); liveObjectUrls.delete(id); },
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

function loadApp() {
  const src = fs.readFileSync(APP_JS_PATH, 'utf8');
  const hookLine = "\n  globalThis.__TEST_HOOK__ && globalThis.__TEST_HOOK__({ state, loadImage, releaseImage, sniffImageSize, sniffImageMime, ImageDecodeError, DECODE_HELP, MAX_DECODE_EDGE });\n";
  const marker = /\n\}\)\(\);\s*$/;
  if (!marker.test(src)) throw new Error('Could not find IIFE close `})();` at end of app.js to attach test hook');
  const patched = src.replace(marker, `${hookLine}})();\n`);

  const { sandbox, elementsById } = buildSandbox();
  let testApi = null;
  sandbox.__TEST_HOOK__ = (api) => { testApi = api; };
  vm.createContext(sandbox);
  vm.runInContext(patched, sandbox, { filename: 'app.js (in-memory, test hook appended)' });
  if (!testApi) throw new Error('app.js did not run to completion / test hook not invoked');
  return { testApi, elementsById, sandbox };
}

function resetPolicy(over = {}) {
  decodePolicy.bitmapMaxEdge = over.bitmapMaxEdge === undefined ? Infinity : over.bitmapMaxEdge;
  decodePolicy.bitmapAvailable = over.bitmapAvailable === undefined ? true : over.bitmapAvailable;
  decodePolicy.elementDecodes = over.elementDecodes === undefined ? true : over.elementDecodes;
  decodePolicy.calls = [];
}

async function main() {
  const { testApi, elementsById } = loadApp();
  const { loadImage, releaseImage, sniffImageSize, sniffImageMime, ImageDecodeError, DECODE_HELP, MAX_DECODE_EDGE, state } = testApi;

  console.log('Case 1: header sniffing reads real dimensions without decoding');
  const jpg = sniffImageSize(jpegHeader(4080, 3060).buffer);
  assert(jpg && jpg.width === 4080 && jpg.height === 3060, `Case 1: JPEG SOF0 dimensions (got ${jpg && jpg.width}x${jpg && jpg.height})`);
  const big = sniffImageSize(jpegHeader(12000, 9000).buffer);
  assert(big && big.width === 12000 && big.height === 9000, `Case 1: 108 MP JPEG dimensions (got ${big && big.width}x${big && big.height})`);
  const png = sniffImageSize(pngHeader(1024, 768).buffer);
  assert(png && png.width === 1024 && png.height === 768, `Case 1: PNG IHDR dimensions (got ${png && png.width}x${png && png.height})`);
  const webp = sniffImageSize(webpLosslessHeader(800, 600).buffer);
  assert(webp && webp.width === 800 && webp.height === 600, `Case 1: WEBP lossless dimensions (got ${webp && webp.width}x${webp && webp.height})`);
  assert(sniffImageSize(new Uint8Array([1, 2, 3]).buffer) === null, 'Case 1: garbage bytes sniff to null instead of throwing');
  assert(sniffImageMime(jpegHeader(10, 10).buffer) === 'image/jpeg', 'Case 1: JPEG magic bytes map to image/jpeg');
  assert(sniffImageMime(pngHeader(10, 10).buffer) === 'image/png', 'Case 1: PNG magic bytes map to image/png');
  assert(sniffImageMime(webpLosslessHeader(10, 10).buffer) === 'image/webp', 'Case 1: WEBP magic bytes map to image/webp');

  console.log('\nCase 2: an oversized camera photo is decoded downscaled, never at full resolution');
  resetPolicy();
  const huge = new FakeFile('IMG_20260905.jpg', jpegHeader(12000, 9000));
  const bmp = await loadImage(huge);
  const firstCall = decodePolicy.calls[0];
  assert(!!firstCall.resizeWidth, 'Case 2: the very first decode attempt asks for a downscale');
  assert(firstCall.resizeWidth <= MAX_DECODE_EDGE, `Case 2: requested width stays within MAX_DECODE_EDGE (got ${firstCall.resizeWidth} <= ${MAX_DECODE_EDGE})`);
  assert(firstCall.resizeWidth === MAX_DECODE_EDGE, `Case 2: long edge is scaled exactly to the cap (got ${firstCall.resizeWidth})`);
  assert(!!bmp && bmp.width === MAX_DECODE_EDGE, 'Case 2: loadImage resolves with the downscaled bitmap');
  releaseImage(bmp);
  assert(bmp.closed === true, 'Case 2: releaseImage closes the ImageBitmap');

  console.log('\nCase 3: a decode the device refuses still succeeds through the downscale retries');
  resetPolicy({ bitmapMaxEdge: 1500 });
  const stubborn = new FakeFile('IMG_stubborn.jpg', jpegHeader(4080, 3060));
  const retried = await loadImage(stubborn);
  assert(!!retried, 'Case 3: loadImage recovers instead of failing the export');
  assert(retried.width <= 1500, `Case 3: it recovered at a reduced width (got ${retried.width})`);
  assert(decodePolicy.calls.length > 1, `Case 3: earlier full-size attempts were actually tried first (${decodePolicy.calls.length} attempts)`);

  console.log('\nCase 4: <img> fallback keeps its Object URL alive until releaseImage()');
  resetPolicy({ bitmapAvailable: false, elementDecodes: true });
  const viaEl = await loadImage(new FakeFile('IMG_fallback.jpg', jpegHeader(1200, 900)));
  assert(viaEl && viaEl.width === 1200, 'Case 4: the <img> fallback produced a usable image');
  assert(liveObjectUrls.has(viaEl.src), 'Case 4: its Object URL is still live after loadImage returns (not revoked mid-use)');
  const usedUrl = viaEl.src;
  releaseImage(viaEl);
  assert(!liveObjectUrls.has(usedUrl), 'Case 4: releaseImage revokes it exactly once the image is done');

  console.log('\nCase 5: when nothing can decode the file the operator gets guidance, not a DOMException');
  resetPolicy({ bitmapAvailable: false, elementDecodes: false });
  let thrown = null;
  try { await loadImage(new FakeFile('IMG_heic.jpg', jpegHeader(1200, 900))); }
  catch (err) { thrown = err; }
  assert(thrown instanceof ImageDecodeError, 'Case 5: loadImage throws ImageDecodeError');
  assert(thrown.message === DECODE_HELP, 'Case 5: the message is the Vietnamese guidance, not "The source image cannot be decoded."');
  assert(!/cannot be decoded\.$/.test(thrown.message), 'Case 5: the raw browser wording never reaches the notice');
  assert(liveObjectUrls.size === 0, 'Case 5: the failed attempt leaks no Object URL');

  console.log('\nCase 6: a File whose bytes went unreadable still reaches the <img> fallback');
  resetPolicy({ bitmapAvailable: false, elementDecodes: true });
  const gone = new FakeFile('IMG_cloud.jpg', jpegHeader(1200, 900), { unreadable: true });
  const recovered = await loadImage(gone);
  assert(!!recovered && recovered.width === 1200, 'Case 6: unreadable arrayBuffer() does not abort the load');
  releaseImage(recovered);

  console.log('\nCase 7: Scan ID refuses an undecodable photo at capture, not at export');
  resetPolicy({ bitmapAvailable: false, elementDecodes: false });
  await elementsById.modeIdBtn.dispatch('click');
  assert(state.mode === 'id', 'setup: entered Scan ID mode');
  assert(state.idScan.step === 'front', 'setup: wizard starts on the front step');
  elementsById.idFileInput.files = [new FakeFile('IMG_bad.jpg', jpegHeader(4080, 3060))];
  await elementsById.idFileInput.dispatch('change');
  assert(state.idScan.front === null, 'Case 7: the undecodable side is dropped instead of being kept');
  assert(state.idScan.step === 'front', 'Case 7: the wizard stays on the front step');
  assert(elementsById.idConfirmBtn.disabled === true, 'Case 7: confirm stays disabled, so preview/Export is unreachable');
  assert(elementsById.toast.textContent === DECODE_HELP, 'Case 7: the operator is told why, at capture time');
  assert(state.busy === false, 'Case 7: the busy lock is released after the failure');
  assert(liveObjectUrls.size === 0, 'Case 7: the dropped side leaks no Object URL');

  console.log(`\n${checks - failures}/${checks} checks passed.`);
  if (failures) { console.error('Image decode regression FAILED.'); process.exit(1); }
  console.log('All image decode regression checks PASSED.');
}

main().catch(err => { console.error('Regression harness crashed:', err); process.exit(1); });

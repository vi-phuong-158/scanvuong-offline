#!/usr/bin/env node
'use strict';
// Dependency-free regression harness for the "Hướng dẫn" (Help) information
// architecture. Same technique as regression_scan_id.js: loads the REAL
// app.js (unmodified on disk) into a minimal fake-DOM sandbox via Node's vm
// module and drives it through the actual DOM event handlers.
//
// Context: Help used to exist ONLY inside Scan hồ sơ Đảng (Party mode) — a
// <dialog id="partyHelpDialog"> opened by party-mode.js's own [data-party-help]
// wiring, unreachable without entering Party mode first. This refactor makes
// Help a cross-application surface: a single global #helpDialog owned and
// wired by app.js, opened from a topbar button visible in every screen, with
// Party mode reduced to a plain shortcut link into that same dialog. See
// docs/brain/03-decisions.md ("Hướng dẫn là cross-application support
// surface, không thuộc riêng Scan hồ sơ Đảng").
//
// Proves:
//   Case 1 — the global Help entry (#helpBtn) is visible on the mode-select
//            screen AND stays visible after entering any mode (Document,
//            Scan ID) — it is not gated behind Party mode or any mode at all.
//   Case 2 — clicking #helpBtn from the mode-select screen opens #helpDialog
//            without touching state.mode (still null) — Help does not
//            require entering Party mode, or any mode, to open.
//   Case 3 — Party's two "Xem hướng dẫn" links open the SAME global dialog
//            (not a Party-owned one) and deep-link straight to
//            #helpSectionParty (expanded + scrolled into view).
//   Case 4 — opening Help while a Document-mode scan session has pages
//            loaded does not touch state.pages/state.mode at all; closing
//            Help (via the Đóng button, and via a backdrop click) restores
//            exactly the same session, page count and selection untouched.
//   Case 5 — the Quick-start shortcuts inside Help share the exact same
//            "don't silently drop an in-progress scan" guard as the topbar's
//            "Đổi chế độ" button: from an empty mode-select screen a
//            shortcut switches mode instantly; from a Document session with
//            pages loaded, declining the confirm leaves the session
//            untouched, and accepting it clears it before entering the new
//            mode — i.e. Help never bypasses that guard.

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
    scrollIntoView() {},
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
    if (type === 'webgl') return null;
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

// <details>-like element: has a real, observable `open` boolean so
// openHelp()'s `if ('open' in target) target.open = true` is testable —
// proving the deep-link actually expands the target section.
function makeDetailsEl() {
  const el = makeEl();
  el.tagName = 'DETAILS';
  el.open = false;
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
  'modeSelect', 'modeDocBtn', 'modeIdBtn', 'modePartyBtn', 'modeWatermarkBtn', 'switchModeBtn',
  'idWorkspace', 'idStepBadge', 'idStepHint', 'idChooseBtn', 'idCameraBtn', 'idFileInput', 'idCameraInput',
  'idBackStepBtn', 'idConfirmBtn', 'idEditorSlot', 'idPreviewSection', 'idPreviewCanvas',
  'idEditFrontBtn', 'idEditBackBtn', 'idExportBtn', 'idExportProgress', 'idProgressBar', 'idProgressLabel', 'idExportNotice',
  'updateBanner', 'updateBtn', 'updateDismiss',
  // Global Help
  'helpBtn', 'helpDialog', 'helpClose', 'partyHelpLinkEmpty', 'partyHelpLinkToolbar',
  'helpGotoDocBtn', 'helpGotoIdBtn', 'helpGotoPartyBtn', 'helpGotoWatermarkBtn',
  'helpSectionDoc', 'helpSectionParty', 'helpSectionId', 'helpSectionWatermark', 'helpSectionTips',
];

function buildSandbox() {
  const elementsById = {};
  const CANVAS_IDS = new Set(['editorCanvas', 'idPreviewCanvas']);
  const DIALOG_IDS = new Set(['helpDialog']);
  const DETAILS_IDS = new Set(['helpSectionDoc', 'helpSectionParty', 'helpSectionId', 'helpSectionWatermark', 'helpSectionTips']);
  for (const id of ELEMENT_IDS) {
    elementsById[id] = CANVAS_IDS.has(id) ? makeCanvasEl() : DIALOG_IDS.has(id) ? makeDialogEl() : DETAILS_IDS.has(id) ? makeDetailsEl() : makeEl();
  }
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
    createImageBitmap: (blob) => Promise.resolve({ width: blob._width || 1200, height: blob._height || 1600, closed: false, close() { this.closed = true; } }),
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
  return { sandbox, elementsById, setConfirmAnswer: (v) => { confirmAnswer = v; } };
}

function loadApp() {
  const src = fs.readFileSync(APP_JS_PATH, 'utf8');
  const hookLine = "\n  globalThis.__TEST_HOOK__ && globalThis.__TEST_HOOK__({ state });\n";
  const marker = /\n\}\)\(\);\s*$/;
  if (!marker.test(src)) throw new Error('Could not find IIFE close `})();` at end of app.js to attach test hook');
  const patched = src.replace(marker, `${hookLine}})();\n`);

  const { sandbox, elementsById, setConfirmAnswer } = buildSandbox();
  let testApi = null;
  sandbox.__TEST_HOOK__ = (api) => { testApi = api; };
  vm.createContext(sandbox);
  vm.runInContext(patched, sandbox, { filename: 'app.js (in-memory, test hook appended)' });
  if (!testApi) throw new Error('app.js did not run to completion / test hook not invoked');
  return { testApi, elementsById, setConfirmAnswer };
}

async function main() {
  // ---------- Case 1: global entry always visible, not mode-gated ----------
  {
    console.log('Case 1: #helpBtn is a global entry, visible on mode-select and inside every mode');
    const { elementsById } = loadApp();
    assert(!elementsById.helpBtn.classList.contains('hidden'), 'helpBtn is visible on the mode-select screen (no "hidden" class)');
    await elementsById.modeDocBtn.dispatch('click');
    assert(!elementsById.helpBtn.classList.contains('hidden'), 'helpBtn stays visible after entering Document mode');
    await elementsById.switchModeBtn.dispatch('click');
    await elementsById.modeIdBtn.dispatch('click');
    assert(!elementsById.helpBtn.classList.contains('hidden'), 'helpBtn stays visible after entering Scan ID mode');
  }

  // ---------- Case 2: opens independently of any mode ----------
  {
    console.log('\nCase 2: Help opens directly from mode-select — no mode entered, state.mode untouched');
    const { testApi, elementsById } = loadApp();
    const { state } = testApi;
    assert(state.mode === null, 'setup: starts on the mode-select screen (state.mode === null)');
    await elementsById.helpBtn.dispatch('click');
    assert(elementsById.helpDialog.open === true, 'helpDialog opened');
    assert(state.mode === null, 'state.mode is still null — opening Help did not enter any mode');
    await elementsById.helpClose.dispatch('click');
    assert(elementsById.helpDialog.open === false, 'helpDialog closed via the Đóng button');
  }

  // ---------- Case 3: Party's shortcuts open the SAME global dialog, deep-linked ----------
  {
    console.log('\nCase 3: "Xem hướng dẫn Scan hồ sơ Đảng" opens the global dialog at #helpSectionParty');
    const { elementsById } = loadApp();
    assert(elementsById.helpSectionParty.open === false, 'setup: Party help section starts collapsed');
    await elementsById.partyHelpLinkEmpty.dispatch('click');
    assert(elementsById.helpDialog.open === true, 'the SAME global #helpDialog opened (not a Party-owned dialog)');
    assert(elementsById.helpSectionParty.open === true, 'the Party section was expanded (deep link)');
    await elementsById.helpClose.dispatch('click');

    elementsById.helpSectionParty.open = false;
    await elementsById.partyHelpLinkToolbar.dispatch('click');
    assert(elementsById.helpDialog.open === true, 'the toolbar shortcut also opens the same global dialog');
    assert(elementsById.helpSectionParty.open === true, 'the toolbar shortcut also deep-links to the Party section');
  }

  // ---------- Case 4: opening/closing Help never touches an in-progress session ----------
  {
    console.log('\nCase 4: opening Help during an in-progress Document scan does not touch state.pages/state.mode');
    const { testApi, elementsById } = loadApp();
    const { state } = testApi;

    await elementsById.modeDocBtn.dispatch('click');
    const file = new FakeFile('IMG_help_test.jpg', 1200, 1600);
    elementsById.fileInput.files = [file];
    await elementsById.fileInput.dispatch('change');
    assert(state.pages.length === 1, 'setup: one page loaded in Document mode');
    const pageIdBefore = state.selectedId;

    await elementsById.helpBtn.dispatch('click');
    assert(elementsById.helpDialog.open === true, 'Help opened on top of the in-progress session');
    assert(state.mode === 'document', 'state.mode is unchanged while Help is open');
    assert(state.pages.length === 1, 'state.pages is untouched while Help is open');

    await elementsById.helpClose.dispatch('click');
    assert(elementsById.helpDialog.open === false, 'Help closed via the Đóng button');
    assert(state.mode === 'document', 'back in Document mode after closing Help');
    assert(state.pages.length === 1 && state.selectedId === pageIdBefore, 'the exact same page/selection survived opening and closing Help');

    // Backdrop click also closes, and is equally non-destructive.
    await elementsById.helpBtn.dispatch('click');
    await elementsById.helpDialog.dispatch('click', { target: elementsById.helpDialog });
    assert(elementsById.helpDialog.open === false, 'clicking the dialog backdrop also closes Help');
    assert(state.pages.length === 1, 'state.pages still untouched after a backdrop-close');
  }

  // ---------- Case 5: Quick-start shortcuts share the same "don't lose work" guard ----------
  {
    console.log('\nCase 5: Help quick-start shortcuts reuse the exact same confirm-before-switch guard as "Đổi chế độ"');
    const { testApi, elementsById, setConfirmAnswer } = loadApp();
    const { state } = testApi;

    // From an empty mode-select screen, no work to lose -> switches instantly, no confirm needed.
    await elementsById.helpBtn.dispatch('click');
    await elementsById.helpGotoIdBtn.dispatch('click');
    assert(elementsById.helpDialog.open === false, 'Help closes when a quick-start shortcut is used');
    assert(state.mode === 'id', 'quick-start shortcut entered Scan ID mode from an empty mode-select screen');

    // Leave Scan ID back to mode-select for the next part of this case.
    await elementsById.switchModeBtn.dispatch('click');
    await elementsById.modeDocBtn.dispatch('click');
    const file = new FakeFile('IMG_guard_test.jpg', 1200, 1600);
    elementsById.fileInput.files = [file];
    await elementsById.fileInput.dispatch('change');
    assert(state.pages.length === 1, 'setup: Document mode has one in-progress page');

    setConfirmAnswer(false);
    await elementsById.helpBtn.dispatch('click');
    await elementsById.helpGotoPartyBtn.dispatch('click');
    assert(state.mode === 'document' && state.pages.length === 1, 'declining the confirm leaves the in-progress Document session untouched');

    setConfirmAnswer(true);
    await elementsById.helpBtn.dispatch('click');
    await elementsById.helpGotoPartyBtn.dispatch('click');
    assert(state.mode === 'party', 'accepting the confirm proceeds into the requested mode, exactly like "Đổi chế độ" already did');
  }

  console.log(`\n${checks - failures}/${checks} checks passed.`);
  if (failures) { console.error('Help information-architecture regression FAILED.'); process.exit(1); }
  console.log('All Help information-architecture regression checks PASSED.');
}

main().catch(err => { console.error('Regression harness crashed:', err); process.exit(1); });

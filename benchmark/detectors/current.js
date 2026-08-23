const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createCanvas } = require('canvas');
const { validateAndNormalizeCorners } = require('../geometry');

const ROOT = path.join(__dirname, '..', '..');
const APP_JS_PATH = path.join(ROOT, 'app.js');

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
    removeChild(child) {
      const idx = this.children.indexOf(child);
      if (idx !== -1) this.children.splice(idx, 1);
      return child;
    },
    querySelector: () => makeEl(),
    querySelectorAll: () => [],
    getContext: (type) => {
      if (type === '2d') {
        const c = createCanvas(100, 100);
        return c.getContext('2d');
      }
      return null;
    }
  };
}

function createProductionPipelineContext() {
  const appJsSource = fs.readFileSync(APP_JS_PATH, 'utf8');

  const sandbox = {
    console,
    Math,
    Uint8Array,
    Uint16Array,
    Uint32Array,
    Int32Array,
    Float32Array,
    Array,
    Object,
    Number,
    String,
    Boolean,
    Date,
    performance,
    TextEncoder,
    TextDecoder,
    location: { protocol: 'file:' },
    addEventListener: () => {},
    removeEventListener: () => {},
    setTimeout: () => {},
    clearTimeout: () => {},
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL: () => {} },
    document: {
      createElement: (tag) => {
        if (tag === 'canvas') return createCanvas(100, 100);
        return makeEl();
      },
      getElementById: () => makeEl(),
      querySelector: () => makeEl(),
      querySelectorAll: () => []
    },
    navigator: { serviceWorker: { register: () => Promise.resolve() } },
    Image: class Image {
      constructor() {
        this.naturalWidth = 0;
        this.naturalHeight = 0;
      }
    }
  };

  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  // Append hook directly inside IIFE
  const hookCode = `
    globalThis.__scanvuong_internals__ = {
      DEFAULT_CORNERS,
      detectDocument,
      drawRotatedToCanvas,
      rotatedDimensions,
      orderCorners,
      polygonArea,
      otsuThreshold,
      componentQuad,
      edgeQuad,
      applyIdAspectHint
    };
  })();
  `;
  const sourceWithHook = appJsSource.replace(/\}\)\s*\(\s*\)\s*;?\s*$/, hookCode);

  const context = vm.createContext(sandbox);
  vm.runInContext(sourceWithHook, context);
  return sandbox.__scanvuong_internals__;
}

const internals = createProductionPipelineContext();

/**
 * Executes the EXACT production detection pipeline:
 * 1. Takes source image/canvas.
 * 2. Applies rotation and downscales to maxEdge = 560 via production `drawRotatedToCanvas`.
 * 3. Runs production `detectDocument`.
 * 4. Normalizes corners and measures timing.
 */
async function detect(source, options = {}) {
  const rotation = options.rotation || 0;
  const isIdMode = options.mode === 'id';
  const t0 = performance.now();

  try {
    const tPre0 = performance.now();
    // Production downscale to 560 max edge
    const rotatedCanvas = internals.drawRotatedToCanvas(source, rotation, 560);
    const preMs = performance.now() - tPre0;

    const tInfer0 = performance.now();
    const detection = internals.detectDocument(rotatedCanvas);
    if (isIdMode) {
      internals.applyIdAspectHint(detection, rotatedCanvas.width, rotatedCanvas.height);
    }
    const inferMs = performance.now() - tInfer0;
    const totalMs = performance.now() - t0;

    const val = validateAndNormalizeCorners(detection.corners);

    return {
      detector: 'CURRENT',
      corners: val.corners || detection.corners,
      confidence: detection.confidence !== undefined ? Number(detection.confidence.toFixed(4)) : null,
      durationMs: Number(totalMs.toFixed(2)),
      preMs: Number(preMs.toFixed(2)),
      inferMs: Number(inferMs.toFixed(2)),
      geometryValid: val.valid,
      areaRatio: Number(val.areaRatio.toFixed(4)),
      error: val.error
    };
  } catch (err) {
    const totalMs = performance.now() - t0;
    return {
      detector: 'CURRENT',
      corners: null,
      confidence: null,
      durationMs: Number(totalMs.toFixed(2)),
      preMs: 0,
      inferMs: 0,
      geometryValid: false,
      areaRatio: 0,
      error: err.message
    };
  }
}

module.exports = {
  name: 'CURRENT',
  version: 'ScanVuong Production Pipeline (drawRotatedToCanvas 560 + detectDocument)',
  license: 'MIT',
  model: 'Otsu + Connected Component + Sobel Quad',
  runtime: 'Pure JS Canvas 2D (VM loaded)',
  modelSize: '0 MB',
  internals,
  detect
};

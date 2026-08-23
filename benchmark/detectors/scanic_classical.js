const { createCanvas } = require('canvas');
const { validateAndNormalizeCorners } = require('../geometry');

// Minimal polyfill for Scanic's browser expectations in Node
if (typeof document === 'undefined') {
  global.document = {
    createElement: (tag) => {
      if (tag === 'canvas') return createCanvas(100, 100);
      return {};
    }
  };
}
if (typeof HTMLCanvasElement === 'undefined') {
  global.HTMLCanvasElement = createCanvas(1, 1).constructor;
}
if (typeof HTMLImageElement === 'undefined') {
  global.HTMLImageElement = class {};
}
if (typeof ImageData === 'undefined') {
  global.ImageData = class ImageData {
    constructor(data, width, height) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  };
}

const scanic = require('scanic');

async function detect(canvas, options = {}) {
  const t0 = performance.now();
  try {
    const res = await scanic.scanDocument(canvas, { mode: 'detect', detector: 'classical' });
    const durationMs = performance.now() - t0;

    if (!res || !res.corners) {
      return {
        detector: 'SCANIC_CLASSICAL',
        corners: null,
        confidence: 0,
        durationMs: Number(durationMs.toFixed(2)),
        geometryValid: false,
        areaRatio: 0,
        error: 'No corners detected'
      };
    }

    const { width: w, height: h } = canvas;
    const c = res.corners;
    const rawCorners = [
      { x: c.topLeft.x / w, y: c.topLeft.y / h },
      { x: c.topRight.x / w, y: c.topRight.y / h },
      { x: c.bottomRight.x / w, y: c.bottomRight.y / h },
      { x: c.bottomLeft.x / w, y: c.bottomLeft.y / h }
    ];

    const val = validateAndNormalizeCorners(rawCorners);

    return {
      detector: 'SCANIC_CLASSICAL',
      corners: val.corners || rawCorners,
      confidence: res.success ? 0.70 : 0.30,
      durationMs: Number(durationMs.toFixed(2)),
      geometryValid: val.valid,
      areaRatio: Number(val.areaRatio.toFixed(4)),
      error: val.error
    };
  } catch (err) {
    const durationMs = performance.now() - t0;
    return {
      detector: 'SCANIC_CLASSICAL',
      corners: null,
      confidence: null,
      durationMs: Number(durationMs.toFixed(2)),
      geometryValid: false,
      areaRatio: 0,
      error: err.message
    };
  }
}

module.exports = {
  name: 'SCANIC_CLASSICAL',
  version: 'scanic 1.6.0 (Classical WASM)',
  license: 'MIT',
  model: 'Rust/WASM Canny + Contour Finder',
  runtime: 'WebAssembly (inlined in scanic.umd.cjs)',
  modelSize: '<100 KB WASM',
  detect
};

const path = require('path');
const { createCanvas } = require('canvas');
const ort = require('onnxruntime-node');
const { validateAndNormalizeCorners } = require('../geometry');

let sessionPromise = null;

async function getSession() {
  if (!sessionPromise) {
    const modelPath = path.join(__dirname, '..', 'node_modules', 'scanic-ml', 'dist', 'doccornernet_lean.ort');
    sessionPromise = ort.InferenceSession.create(modelPath, {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all'
    });
  }
  return sessionPromise;
}

async function detect(canvas, options = {}) {
  const t0 = performance.now();
  try {
    const session = await getSession();
    const inputSize = 224;
    const inCanvas = createCanvas(inputSize, inputSize);
    const ctx = inCanvas.getContext('2d');
    ctx.drawImage(canvas, 0, 0, inputSize, inputSize);
    const imgData = ctx.getImageData(0, 0, inputSize, inputSize).data;

    // Scanic NHWC [1, 224, 224, 3] float32 with ImageNet normalization
    const mean = [0.485, 0.456, 0.406];
    const std = [0.229, 0.224, 0.225];
    const floatArr = new Float32Array(1 * inputSize * inputSize * 3);

    for (let i = 0, l = 0; i < imgData.length; i += 4, l += 3) {
      floatArr[l] = (imgData[i] / 255.0 - mean[0]) / std[0];
      floatArr[l + 1] = (imgData[i + 1] / 255.0 - mean[1]) / std[1];
      floatArr[l + 2] = (imgData[i + 2] / 255.0 - mean[2]) / std[2];
    }

    const tensor = new ort.Tensor('float32', floatArr, [1, inputSize, inputSize, 3]);
    const results = await session.run({ [session.inputNames[0]]: tensor });
    const durationMs = performance.now() - t0;

    let coords = null;
    let rawScore = null;
    for (const k in results) {
      const d = results[k].data;
      if (d.length === 8) coords = d;
      else if (d.length === 1) rawScore = d[0];
    }

    if (!coords) {
      return {
        detector: 'SCANIC_ML',
        corners: null,
        confidence: 0,
        durationMs: Number(durationMs.toFixed(2)),
        geometryValid: false,
        areaRatio: 0,
        error: 'Model did not produce 8 coordinates'
      };
    }

    const rawCorners = [
      { x: coords[0], y: coords[1] }, // TL
      { x: coords[2], y: coords[3] }, // TR
      { x: coords[4], y: coords[5] }, // BR
      { x: coords[6], y: coords[7] }  // BL
    ];

    const confidence = rawScore !== null ? 1 / (1 + Math.exp(-rawScore)) : 0.85;
    const val = validateAndNormalizeCorners(rawCorners);

    return {
      detector: 'SCANIC_ML',
      corners: val.corners || rawCorners,
      confidence: Number(confidence.toFixed(4)),
      durationMs: Number(durationMs.toFixed(2)),
      geometryValid: val.valid,
      areaRatio: Number(val.areaRatio.toFixed(4)),
      error: val.error
    };
  } catch (err) {
    const durationMs = performance.now() - t0;
    return {
      detector: 'SCANIC_ML',
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
  name: 'SCANIC_ML',
  version: 'scanic 1.6.0 / scanic-ml 0.2.0',
  license: 'MIT',
  model: 'DocCornerNet Lean (SimCC regression)',
  runtime: 'ONNX Runtime (WASM/CPU)',
  modelSize: '1.93 MB (doccornernet_lean.ort) + 1.52 MB WASM runtime',
  detect
};

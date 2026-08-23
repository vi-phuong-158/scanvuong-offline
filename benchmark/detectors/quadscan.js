const path = require('path');
const { createCanvas } = require('canvas');
const ort = require('onnxruntime-node');
const { validateAndNormalizeCorners } = require('../geometry');

let sessionPromise = null;

async function getSession() {
  if (!sessionPromise) {
    const modelPath = path.join(__dirname, '..', 'node_modules', 'quadscan', 'models', 'lcnet100_h_e_bifpn_256_fp32.onnx');
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
    const inputSize = 256;
    const inCanvas = createCanvas(inputSize, inputSize);
    const ctx = inCanvas.getContext('2d');
    ctx.drawImage(canvas, 0, 0, inputSize, inputSize);
    const imgData = ctx.getImageData(0, 0, inputSize, inputSize).data;

    // DocAligner LCNet NCHW [1, 3, 256, 256] float32 with ImageNet normalization
    const mean = [0.485, 0.456, 0.406];
    const std = [0.229, 0.224, 0.225];
    const floatArr = new Float32Array(3 * inputSize * inputSize);
    const planeSize = inputSize * inputSize;

    for (let i = 0, p = 0; i < imgData.length; i += 4, p++) {
      floatArr[p] = (imgData[i] / 255.0 - mean[0]) / std[0];
      floatArr[planeSize + p] = (imgData[i + 1] / 255.0 - mean[1]) / std[1];
      floatArr[2 * planeSize + p] = (imgData[i + 2] / 255.0 - mean[2]) / std[2];
    }

    const tensor = new ort.Tensor('float32', floatArr, [1, 3, inputSize, inputSize]);
    const results = await session.run({ [session.inputNames[0]]: tensor });
    const durationMs = performance.now() - t0;

    const heatmap = results.heatmap || results[Object.keys(results)[0]];
    const data = heatmap.data;
    const rawCorners = [];
    let confSum = 0;

    // 4 corners: 0=TL, 1=TR, 2=BR, 3=BL on 128x128 heatmap grid
    for (let l = 0; l < 4; l++) {
      const offset = l * 128 * 128;
      let maxVal = -Infinity, maxIdx = 0;
      for (let u = 0; u < 128 * 128; u++) {
        const v = data[offset + u];
        if (v > maxVal) { maxVal = v; maxIdx = u; }
      }
      const mx = maxIdx % 128, my = Math.floor(maxIdx / 128);

      // Subpixel center of gravity around peak
      let sumW = 0, sumX = 0, sumY = 0;
      const thresh = 0.3 * maxVal;
      for (let dy = Math.max(0, my - 4); dy <= Math.min(127, my + 4); dy++) {
        for (let dx = Math.max(0, mx - 4); dx <= Math.min(127, mx + 4); dx++) {
          const val = data[offset + dy * 128 + dx];
          if (val >= thresh) {
            sumW += val; sumX += val * dx; sumY += val * dy;
          }
        }
      }
      const rx = sumW > 0 ? (sumX / sumW) / 128 : mx / 128;
      const ry = sumW > 0 ? (sumY / sumW) / 128 : my / 128;
      rawCorners.push({ x: rx, y: ry });
      confSum += Math.max(0, Math.min(1, maxVal));
    }

    const confidence = confSum / 4;
    const val = validateAndNormalizeCorners(rawCorners);

    return {
      detector: 'QUADSCAN',
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
      detector: 'QUADSCAN',
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
  name: 'QUADSCAN',
  version: 'quadscan 1.0.0',
  license: 'MIT',
  model: 'DocAligner LCNet100 BiFPN 256 (Heatmap regression)',
  runtime: 'ONNX Runtime (WebGPU/WASM/CPU)',
  modelSize: '4.77 MB (lcnet100_h_e_bifpn_256_fp32.onnx)',
  detect
};

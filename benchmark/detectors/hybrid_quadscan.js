const quadscan = require('./quadscan');
const current = require('./current');

async function detect(canvas, options = {}) {
  const t0 = performance.now();
  const mlRes = await quadscan.detect(canvas, options);

  // Acceptance criteria for ML
  const minConfidence = options.minConfidence !== undefined ? options.minConfidence : 0.45;
  const minArea = options.minArea !== undefined ? options.minArea : 0.10;

  if (mlRes.geometryValid && mlRes.confidence >= minConfidence && mlRes.areaRatio >= minArea) {
    const totalDuration = performance.now() - t0;
    return {
      detector: 'HYBRID_QUADSCAN',
      source: 'QUADSCAN_ML',
      corners: mlRes.corners,
      confidence: mlRes.confidence,
      durationMs: Number(totalDuration.toFixed(2)),
      geometryValid: true,
      areaRatio: mlRes.areaRatio,
      error: null
    };
  }

  // Fallback to ScanVuong classical CV
  const fallbackRes = await current.detect(canvas, options);
  const totalDuration = performance.now() - t0;

  return {
    detector: 'HYBRID_QUADSCAN',
    source: 'CURRENT_FALLBACK',
    corners: fallbackRes.corners,
    confidence: fallbackRes.confidence ? Number((fallbackRes.confidence * 0.9).toFixed(4)) : 0.35,
    durationMs: Number(totalDuration.toFixed(2)),
    geometryValid: fallbackRes.geometryValid,
    areaRatio: fallbackRes.areaRatio,
    error: fallbackRes.error ? `ML rejected (${mlRes.error || 'low conf'}), fallback: ${fallbackRes.error}` : null
  };
}

module.exports = {
  name: 'HYBRID_QUADSCAN',
  version: 'QUADSCAN + ScanVuong Classical Fallback',
  license: 'MIT',
  model: 'DocAligner LCNet + Classical CV Fallback',
  runtime: 'WASM ONNX + Canvas 2D',
  modelSize: '4.77 MB Model',
  detect
};

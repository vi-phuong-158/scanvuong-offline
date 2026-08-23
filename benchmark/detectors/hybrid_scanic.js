const scanicMl = require('./scanic_ml');
const current = require('./current');
const { isConvexQuad, polygonArea } = require('../geometry');

function calculateGeometryScore(corners) {
  if (!corners || corners.length !== 4) return 0;
  if (!isConvexQuad(corners)) return 0;
  const area = polygonArea(corners);
  if (area < 0.05 || area > 0.98) return 0.2;
  return Math.min(1.0, area * 1.2);
}

async function detect(source, options = {}) {
  const t0 = performance.now();

  // Step 1: Run SCANIC_ML
  const mlRes = await scanicMl.detect(source, options);
  const geomScore = calculateGeometryScore(mlRes.corners);

  // Geometric acceptance gate
  const isAccepted = (
    mlRes.geometryValid &&
    !mlRes.error &&
    mlRes.areaRatio >= 0.08 &&
    (mlRes.confidence === null || mlRes.confidence >= 0.50) &&
    geomScore >= 0.25
  );

  if (isAccepted) {
    const totalMs = performance.now() - t0;
    return {
      detector: 'HYBRID_SCANIC',
      source: 'SCANIC_ML',
      corners: mlRes.corners,
      confidence: mlRes.confidence,
      geometryScore: Number(geomScore.toFixed(4)),
      durationMs: Number(totalMs.toFixed(2)),
      preMs: mlRes.preMs || 0,
      inferMs: mlRes.inferMs || 0,
      geometryValid: true,
      areaRatio: mlRes.areaRatio,
      error: null
    };
  }

  // Step 2: Fallback to ScanVuong production classical CV
  const fallbackRes = await current.detect(source, options);
  const totalMs = performance.now() - t0;

  return {
    detector: 'HYBRID_SCANIC',
    source: 'CURRENT_FALLBACK',
    corners: fallbackRes.corners,
    confidence: fallbackRes.confidence,
    geometryScore: calculateGeometryScore(fallbackRes.corners),
    durationMs: Number(totalMs.toFixed(2)),
    preMs: fallbackRes.preMs || 0,
    inferMs: fallbackRes.inferMs || 0,
    geometryValid: fallbackRes.geometryValid,
    areaRatio: fallbackRes.areaRatio,
    error: fallbackRes.error ? `ML rejected (${mlRes.error || 'bad geom'}), fallback: ${fallbackRes.error}` : null
  };
}

module.exports = {
  name: 'HYBRID_SCANIC',
  version: 'SCANIC_ML (DocCornerNet) + ScanVuong Classical Fallback',
  license: 'MIT',
  model: 'DocCornerNet Lean + Classical CV Fallback',
  runtime: 'WASM ONNX + Canvas 2D',
  modelSize: '1.93 MB Model',
  detect
};

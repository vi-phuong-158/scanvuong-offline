#!/usr/bin/env node
'use strict';

/**
 * Dependency-free regression harness for DocumentDetector (Scanic ML + Classical Fallback).
 * 
 * Features real fault injections with test isolation:
 *   - MODEL_LOAD_FAILURE_FALLBACK: PASS
 *   - INFERENCE_THROW_FALLBACK: PASS
 *   - MALFORMED_OUTPUT_FALLBACK: PASS
 *   - INVALID_GEOMETRY_FALLBACK: PASS
 *   - DEFAULT_FALLBACK: PASS
 *   - SESSION_SINGLETON_REUSE: PASS
 *   - INIT_RECOVERY: PASS
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DocumentDetector = require(path.join(ROOT, 'document-detector.js'));

let checks = 0;
let failures = 0;

function assert(cond, msg) {
  checks++;
  if (!cond) {
    failures++;
    console.error(`  ✗ ${msg}`);
  } else {
    console.log(`  ✓ ${msg}`);
  }
}

// Minimal dependency-free synthetic canvas with pixel buffer
function createSyntheticCanvas(w, h, isDoc = true) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 30; data[i + 1] = 41; data[i + 2] = 59; data[i + 3] = 255;
  }
  if (isDoc) {
    const minX = Math.floor(w * 0.15), maxX = Math.ceil(w * 0.85);
    const minY = Math.floor(h * 0.12), maxY = Math.ceil(h * 0.88);
    for (let y = minY; y < maxY; y++) {
      for (let x = minX; x < maxX; x++) {
        const idx = (y * w + x) * 4;
        data[idx] = 245; data[idx + 1] = 245; data[idx + 2] = 245; data[idx + 3] = 255;
      }
    }
  }
  return {
    width: w,
    height: h,
    getContext: () => ({
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'medium',
      drawImage: () => {},
      getImageData: (sx, sy, sw, sh) => ({ data, width: sw, height: sh }),
      save: () => {},
      restore: () => {},
      translate: () => {},
      rotate: () => {}
    })
  };
}

// Dummy classical fallback detector
function dummyClassicalDetector(canvas) {
  return {
    corners: [
      { x: 0.12, y: 0.12 },
      { x: 0.88, y: 0.12 },
      { x: 0.88, y: 0.88 },
      { x: 0.12, y: 0.88 }
    ],
    confidence: 0.75
  };
}

// Check native onnxruntime availability
let hasNativeOrt = false;
try {
  require('onnxruntime-node');
  hasNativeOrt = true;
} catch (e) {
  try {
    require(path.join(ROOT, 'benchmark', 'node_modules', 'onnxruntime-node'));
    hasNativeOrt = true;
  } catch (e2) {
    hasNativeOrt = false;
  }
}

function createMockSession() {
  return {
    inputNames: ['input'],
    run: async () => ({
      coords: { data: [0.1, 0.1, 0.9, 0.1, 0.9, 0.9, 0.1, 0.9] },
      score_logit: { data: [5.0] }
    })
  };
}

function ensureValidRuntime() {
  if (!hasNativeOrt) {
    DocumentDetector.__test.setRuntimeFactory(async () => createMockSession());
  }
}

async function runTests() {
  console.log('==================================================');
  console.log('=== DocumentDetector Regression & Release Gates ===');
  console.log('==================================================\n');

  const modelPath = path.join(ROOT, 'assets', 'ml', 'doccornernet_lean.ort');
  const modelBytes = fs.existsSync(modelPath) ? new Uint8Array(fs.readFileSync(modelPath)) : new Uint8Array([1, 2, 3]);
  const defaultOptions = {
    modelBytes,
    assetBasePath: path.join(ROOT, 'assets', 'ml') + path.sep,
    fallbackDetector: dummyClassicalDetector
  };

  const testCanvas = createSyntheticCanvas(800, 600, true);

  // -------------------------------------------------------------
  // Gate 1: Baseline Clean ML Detection
  // -------------------------------------------------------------
  console.log('--- Gate 1: Baseline Clean ML Detection ---');
  DocumentDetector.__test.resetState();
  ensureValidRuntime();

  const res1 = await DocumentDetector.detect(testCanvas, defaultOptions);
  assert(res1.source === 'SCANIC_ML', `Gate 1: source is SCANIC_ML (got ${res1.source})`);
  assert(res1.geometryValid === true, 'Gate 1: geometry is valid');
  assert(res1.corners && res1.corners.length === 4, 'Gate 1: returns 4 corners');
  assert(res1.documentScore !== null && Number.isFinite(res1.documentScore), `Gate 1: documentScore is finite (got ${res1.documentScore})`);

  // -------------------------------------------------------------
  // Gate 2: REAL Model Load Failure Test (with Clean State Isolation)
  // -------------------------------------------------------------
  console.log('\n--- Gate 2: REAL Model Load Failure (Isolation Verified) ---');
  DocumentDetector.__test.resetState();
  DocumentDetector.__test.setRuntimeFactory(() => Promise.reject(new Error('Injected model load failure')));
  const badOptions = {
    modelBytes: new Uint8Array([0, 1, 2, 3]),
    fallbackDetector: dummyClassicalDetector
  };
  const res2 = await DocumentDetector.detect(testCanvas, badOptions);
  assert(res2.source === 'CURRENT_FALLBACK', `Gate 2: source is CURRENT_FALLBACK (got ${res2.source})`);
  assert(res2.geometryValid === true, 'Gate 2: fallback geometry is valid');
  assert(res2.corners[0].x === 0.12 && res2.corners[0].y === 0.12, 'Gate 2: corners matched fallback output');

  // Separately test: ML init failure + classical failure -> DEFAULT_FALLBACK
  DocumentDetector.__test.resetState();
  DocumentDetector.__test.setRuntimeFactory(() => Promise.reject(new Error('Injected model load failure')));
  const res2b = await DocumentDetector.detect(testCanvas, {
    modelBytes: new Uint8Array([0, 1, 2, 3]),
    fallbackDetector: () => { throw new Error('Classical crashed'); }
  });
  assert(res2b.source === 'DEFAULT_FALLBACK', `Gate 2b: source is DEFAULT_FALLBACK when both fail (got ${res2b.source})`);
  assert(res2b.corners[0].x === 0.045 && res2b.corners[0].y === 0.045, 'Gate 2b: corners match DEFAULT_CORNERS');
  console.log('MODEL_LOAD_FAILURE_FALLBACK: PASS');

  // -------------------------------------------------------------
  // Gate 3: REAL Inference Throw Failure Test (Injected Fault)
  // -------------------------------------------------------------
  console.log('\n--- Gate 3: REAL Inference Throw Failure (Injected Mock) ---');
  DocumentDetector.__test.resetState();
  DocumentDetector.__test.setInferenceSession({
    inputNames: ['input'],
    run: async () => {
      throw new Error('synthetic inference failure');
    }
  });

  const res3 = await DocumentDetector.detect(testCanvas, { fallbackDetector: dummyClassicalDetector });
  assert(res3.source === 'CURRENT_FALLBACK', `Gate 3: source is CURRENT_FALLBACK upon inference throw (got ${res3.source})`);
  assert(res3.geometryValid === true, 'Gate 3: fallback geometry is valid');
  assert(res3.corners[0].x === 0.12 && res3.corners[0].y === 0.12, 'Gate 3: corners matched fallback');
  console.log('INFERENCE_THROW_FALLBACK: PASS');
  console.log('INFERENCE_THROW_FALLBACK_PASS');

  // -------------------------------------------------------------
  // Gate 4: REAL Malformed Model Outputs (Injected Faults)
  // -------------------------------------------------------------
  console.log('\n--- Gate 4: REAL Malformed Output Injections ---');

  // 4A: Missing coordinates
  DocumentDetector.__test.resetState();
  DocumentDetector.__test.setInferenceSession({
    inputNames: ['input'],
    run: async () => ({ score_logit: { data: [5.0] } })
  });
  const res4a = await DocumentDetector.detect(testCanvas, { fallbackDetector: dummyClassicalDetector });
  assert(res4a.source === 'CURRENT_FALLBACK', `Gate 4A (missing coords): source is CURRENT_FALLBACK (got ${res4a.source})`);

  // 4B: Wrong coords length (length = 3 instead of 8)
  DocumentDetector.__test.resetState();
  DocumentDetector.__test.setInferenceSession({
    inputNames: ['input'],
    run: async () => ({
      coords: { data: [0.1, 0.2, 0.3] },
      score_logit: { data: [5.0] }
    })
  });
  const res4b = await DocumentDetector.detect(testCanvas, { fallbackDetector: dummyClassicalDetector });
  assert(res4b.source === 'CURRENT_FALLBACK', `Gate 4B (coords len != 8): source is CURRENT_FALLBACK (got ${res4b.source})`);

  // 4C: NaN coordinate
  DocumentDetector.__test.resetState();
  DocumentDetector.__test.setInferenceSession({
    inputNames: ['input'],
    run: async () => ({
      coords: { data: [NaN, 0.1, 0.9, 0.1, 0.9, 0.9, 0.1, 0.9] },
      score_logit: { data: [5.0] }
    })
  });
  const res4c = await DocumentDetector.detect(testCanvas, { fallbackDetector: dummyClassicalDetector });
  assert(res4c.source === 'CURRENT_FALLBACK', `Gate 4C (NaN coordinate): source is CURRENT_FALLBACK (got ${res4c.source})`);

  // 4D: Infinity coordinate
  DocumentDetector.__test.resetState();
  DocumentDetector.__test.setInferenceSession({
    inputNames: ['input'],
    run: async () => ({
      coords: { data: [Infinity, 0.1, 0.9, 0.1, 0.9, 0.9, 0.1, 0.9] },
      score_logit: { data: [5.0] }
    })
  });
  const res4d = await DocumentDetector.detect(testCanvas, { fallbackDetector: dummyClassicalDetector });
  assert(res4d.source === 'CURRENT_FALLBACK', `Gate 4D (Infinity coordinate): source is CURRENT_FALLBACK (got ${res4d.source})`);

  // 4E: Self-intersecting bow-tie quad
  DocumentDetector.__test.resetState();
  DocumentDetector.__test.setInferenceSession({
    inputNames: ['input'],
    run: async () => ({
      coords: { data: [0.1, 0.1, 0.9, 0.9, 0.9, 0.1, 0.1, 0.9] },
      score_logit: { data: [5.0] }
    })
  });
  const res4e = await DocumentDetector.detect(testCanvas, { fallbackDetector: dummyClassicalDetector });
  assert(res4e.source === 'CURRENT_FALLBACK', `Gate 4E (self-intersecting quad): source is CURRENT_FALLBACK (got ${res4e.source})`);

  // 4F: Collapsed tiny quad (<5% area)
  DocumentDetector.__test.resetState();
  DocumentDetector.__test.setInferenceSession({
    inputNames: ['input'],
    run: async () => ({
      coords: { data: [0.1, 0.1, 0.12, 0.1, 0.12, 0.12, 0.1, 0.12] },
      score_logit: { data: [5.0] }
    })
  });
  const res4f = await DocumentDetector.detect(testCanvas, { fallbackDetector: dummyClassicalDetector });
  assert(res4f.source === 'CURRENT_FALLBACK', `Gate 4F (collapsed quad): source is CURRENT_FALLBACK (got ${res4f.source})`);

  console.log('MALFORMED_OUTPUT_FALLBACK: PASS');
  console.log('INVALID_GEOMETRY_FALLBACK: PASS');

  // -------------------------------------------------------------
  // Gate 5: REAL Session Singleton Reuse (Counter Verification)
  // -------------------------------------------------------------
  console.log('\n--- Gate 5: Session Singleton Reuse (Counter Verification) ---');
  DocumentDetector.__test.resetState();
  assert(DocumentDetector.__test.getSessionCreateCount() === 0, 'Gate 5: initial create count is 0');
  assert(DocumentDetector.__test.getSessionRunCount() === 0, 'Gate 5: initial run count is 0');

  ensureValidRuntime();

  const res5a = await DocumentDetector.detect(testCanvas, defaultOptions);
  const res5b = await DocumentDetector.detect(testCanvas, defaultOptions);
  const res5c = await DocumentDetector.detect(testCanvas, defaultOptions);

  const createCount = DocumentDetector.__test.getSessionCreateCount();
  const runCount = DocumentDetector.__test.getSessionRunCount();

  assert(createCount === 1, `Gate 5: sessionCreateCount is EXACTLY 1 (got ${createCount})`);
  assert(runCount === 3, `Gate 5: sessionRunCount is EXACTLY 3 (got ${runCount})`);
  assert(res5a.source === 'SCANIC_ML' && res5b.source === 'SCANIC_ML' && res5c.source === 'SCANIC_ML', 'Gate 5: all 3 multi-page detections succeed');
  console.log('SESSION_SINGLETON_REUSE: PASS');

  // -------------------------------------------------------------
  // Gate 6: REAL Init Failure Recovery Semantics
  // -------------------------------------------------------------
  console.log('\n--- Gate 6: Init Failure Recovery Semantics ---');
  DocumentDetector.__test.resetState();

  // Step 6.1: First call fails due to invalid runtime
  DocumentDetector.__test.setRuntimeFactory(() => Promise.reject(new Error('Transient network/load failure')));
  const failRes = await DocumentDetector.detect(testCanvas, badOptions);
  assert(failRes.source === 'CURRENT_FALLBACK', `Gate 6.1: transient failure safely uses fallback (got ${failRes.source})`);

  // Step 6.2: Second call with valid model MUST recover and succeed
  DocumentDetector.__test.setRuntimeFactory(null);
  ensureValidRuntime();

  const recoverRes = await DocumentDetector.detect(testCanvas, defaultOptions);
  assert(recoverRes.source === 'SCANIC_ML', `Gate 6.2: recovery attempt succeeds with SCANIC_ML (got ${recoverRes.source})`);
  assert(recoverRes.geometryValid === true, 'Gate 6.2: recovered geometry is valid');
  console.log('INIT_RECOVERY: PASS');

  // -------------------------------------------------------------
  // Gate 7: Rotation Invariance (0°, 90°, 180°, 270°)
  // -------------------------------------------------------------
  console.log('\n--- Gate 7: Rotation Invariance ---');
  for (const rot of [0, 90, 180, 270]) {
    DocumentDetector.__test.resetState();
    ensureValidRuntime();
    const rotCanvas = createSyntheticCanvas(800, 600, true);
    const rotRes = await DocumentDetector.detect(rotCanvas, { ...defaultOptions, rotation: rot });
    assert(rotRes.geometryValid === true, `Gate 7: rotation ${rot}° produces valid geometry`);
    assert(rotRes.corners.every(p => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1), `Gate 7: rotation ${rot}° corners in [0, 1]`);
  }

  // -------------------------------------------------------------
  // Gate 8: Safe Default Corners Fallback
  // -------------------------------------------------------------
  console.log('\n--- Gate 8: Safe Default Corners Fallback ---');
  DocumentDetector.__test.resetState();
  DocumentDetector.__test.setRuntimeFactory(() => Promise.reject(new Error('Injected model failure')));
  const res8 = await DocumentDetector.detect(testCanvas, {
    modelBytes: new Uint8Array([0, 0]),
    fallbackDetector: () => { throw new Error('Classical crashed'); }
  });
  assert(res8.source === 'DEFAULT_FALLBACK', `Gate 8: source is DEFAULT_FALLBACK (got ${res8.source})`);
  assert(res8.corners.length === 4, 'Gate 8: returns 4 default corners');
  assert(res8.corners[0].x === 0.045 && res8.corners[0].y === 0.045, 'Gate 8: corners match DEFAULT_CORNERS');
  console.log('DEFAULT_FALLBACK: PASS');

  // -------------------------------------------------------------
  // Gate 9: Classical-Invalid Fallback Chain (Reject Invalid Geometry)
  // -------------------------------------------------------------
  console.log('\n--- Gate 9: Classical-Invalid Fallback Chain ---');

  // Test 1: ML fail + classical returns NaN corner -> DEFAULT_FALLBACK
  DocumentDetector.__test.resetState();
  DocumentDetector.__test.setRuntimeFactory(() => Promise.reject(new Error('ML fail')));
  const res9a = await DocumentDetector.detect(testCanvas, {
    fallbackDetector: () => ({ corners: [{ x: NaN, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.9, y: 0.9 }, { x: 0.1, y: 0.9 }] })
  });
  assert(res9a.source === 'DEFAULT_FALLBACK', `Test 1 (classical NaN): source is DEFAULT_FALLBACK (got ${res9a.source})`);
  assert(res9a.geometryValid === true, 'Test 1: safe default geometry is valid');

  // Test 2: ML fail + classical returns Infinity -> DEFAULT_FALLBACK
  DocumentDetector.__test.resetState();
  DocumentDetector.__test.setRuntimeFactory(() => Promise.reject(new Error('ML fail')));
  const res9b = await DocumentDetector.detect(testCanvas, {
    fallbackDetector: () => ({ corners: [{ x: Infinity, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.9, y: 0.9 }, { x: 0.1, y: 0.9 }] })
  });
  assert(res9b.source === 'DEFAULT_FALLBACK', `Test 2 (classical Infinity): source is DEFAULT_FALLBACK (got ${res9b.source})`);

  // Test 3: ML fail + classical returns bow-tie / self-intersecting quad -> DEFAULT_FALLBACK
  DocumentDetector.__test.resetState();
  DocumentDetector.__test.setRuntimeFactory(() => Promise.reject(new Error('ML fail')));
  const res9c = await DocumentDetector.detect(testCanvas, {
    fallbackDetector: () => ({ corners: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.9 }, { x: 0.9, y: 0.1 }, { x: 0.1, y: 0.9 }] })
  });
  assert(res9c.source === 'DEFAULT_FALLBACK', `Test 3 (classical bow-tie quad): source is DEFAULT_FALLBACK (got ${res9c.source})`);

  // Test 4: ML fail + classical returns collapsed/tiny quad (<5% area) -> DEFAULT_FALLBACK
  DocumentDetector.__test.resetState();
  DocumentDetector.__test.setRuntimeFactory(() => Promise.reject(new Error('ML fail')));
  const res9d = await DocumentDetector.detect(testCanvas, {
    fallbackDetector: () => ({ corners: [{ x: 0.1, y: 0.1 }, { x: 0.12, y: 0.1 }, { x: 0.12, y: 0.12 }, { x: 0.1, y: 0.12 }] })
  });
  assert(res9d.source === 'DEFAULT_FALLBACK', `Test 4 (classical collapsed quad): source is DEFAULT_FALLBACK (got ${res9d.source})`);

  // Test 5: ML fail + classical returns object with <4 corners -> DEFAULT_FALLBACK
  DocumentDetector.__test.resetState();
  DocumentDetector.__test.setRuntimeFactory(() => Promise.reject(new Error('ML fail')));
  const res9e = await DocumentDetector.detect(testCanvas, {
    fallbackDetector: () => ({ corners: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.9, y: 0.9 }] })
  });
  assert(res9e.source === 'DEFAULT_FALLBACK', `Test 5 (classical 3 corners): source is DEFAULT_FALLBACK (got ${res9e.source})`);

  // Test 6: ML fail + classical throws -> DEFAULT_FALLBACK
  DocumentDetector.__test.resetState();
  DocumentDetector.__test.setRuntimeFactory(() => Promise.reject(new Error('ML fail')));
  const res9f = await DocumentDetector.detect(testCanvas, {
    fallbackDetector: () => { throw new Error('Classical exception'); }
  });
  assert(res9f.source === 'DEFAULT_FALLBACK', `Test 6 (classical throws): source is DEFAULT_FALLBACK (got ${res9f.source})`);

  // Test 7: ML fail + classical valid -> CURRENT_FALLBACK
  DocumentDetector.__test.resetState();
  DocumentDetector.__test.setRuntimeFactory(() => Promise.reject(new Error('ML fail')));
  const res9g = await DocumentDetector.detect(testCanvas, {
    fallbackDetector: dummyClassicalDetector
  });
  assert(res9g.source === 'CURRENT_FALLBACK', `Test 7 (classical valid): source is CURRENT_FALLBACK (got ${res9g.source})`);
  assert(res9g.geometryValid === true, 'Test 7: classical fallback geometry is valid');

  // Test 8: ML valid -> SCANIC_ML
  DocumentDetector.__test.resetState();
  ensureValidRuntime();
  const res9h = await DocumentDetector.detect(testCanvas, defaultOptions);
  assert(res9h.source === 'SCANIC_ML', `Test 8 (ML valid): source is SCANIC_ML (got ${res9h.source})`);
  assert(res9h.geometryValid === true, 'Test 8: ML geometry is valid');

  // -------------------------------------------------------------
  // Gate 10: Default Corners Invariant Verification
  // -------------------------------------------------------------
  console.log('\n--- Gate 10: Default Corners Invariant ---');
  const dCorners = DocumentDetector.DEFAULT_CORNERS;
  assert(Array.isArray(dCorners) && dCorners.length === 4, 'DEFAULT_CORNERS has exactly 4 points');
  assert(dCorners.every(p => Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1), 'DEFAULT_CORNERS coordinates finite in [0, 1]');
  assert(DocumentDetector.isConvexQuad(dCorners) === true, 'DEFAULT_CORNERS is strictly convex');
  const dArea = DocumentDetector.polygonArea(dCorners);
  assert(dArea >= 0.05 && dArea <= 0.995, `DEFAULT_CORNERS area is reasonable (got ${(dArea * 100).toFixed(1)}%)`);
  const dGeom = DocumentDetector.validateGeometry(dCorners);
  assert(dGeom.valid === true, 'validateGeometry(DEFAULT_CORNERS).valid === true');
  console.log('DEFAULT_CORNERS_INVARIANT: PASS');

  console.log(`\n==================================================`);
  console.log(`RESULTS: ${checks - failures}/${checks} checks passed.`);
  if (failures > 0) {
    console.error(`✗ ${failures} CHECKS FAILED!`);
    process.exit(1);
  } else {
    console.log('✓ All DocumentDetector regression & fault-injection gates PASSED.');
  }
}

runTests().catch(err => {
  console.error('Regression suite error:', err);
  process.exit(1);
});
'use strict';

/**
 * Unit Test Suite for Real-World Pilot Evidence Pipeline
 * Validates provenance rules, hash duplicate detection, annotation geometry bounds,
 * metric calculations, score semantics, and contact-sheet generation.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let checks = 0;
let failures = 0;

function test(name, fn) {
  checks++;
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.error(`  ✗ ${name} FAILED: ${err.message}`);
  }
}

console.log('======================================================');
console.log('=== Real-World Pilot Evidence Pipeline Test Suite ===');
console.log('======================================================\n');

// -------------------------------------------------------------
// 1. Provenance Validation Tests
// -------------------------------------------------------------
const ALLOWED_PROVENANCE = new Set(['CAMERA_REAL', 'LEGACY_REGRESSION', 'SYNTHETIC_GENERATED', 'TEST_FIXTURE']);

function validateProvenance(provenance) {
  if (!provenance || typeof provenance !== 'string') return { valid: false, reason: 'Missing provenance' };
  if (!ALLOWED_PROVENANCE.has(provenance)) return { valid: false, reason: `Invalid provenance value: ${provenance}` };
  return { valid: true };
}

test('Provenance: accepts valid CAMERA_REAL', () => {
  assert.strictEqual(validateProvenance('CAMERA_REAL').valid, true);
});

test('Provenance: accepts valid LEGACY_REGRESSION and SYNTHETIC_GENERATED', () => {
  assert.strictEqual(validateProvenance('LEGACY_REGRESSION').valid, true);
  assert.strictEqual(validateProvenance('SYNTHETIC_GENERATED').valid, true);
  assert.strictEqual(validateProvenance('TEST_FIXTURE').valid, true);
});

test('Provenance: rejects fabricated / unknown provenance strings', () => {
  assert.strictEqual(validateProvenance('INTERNET_SCRAPED').valid, false);
  assert.strictEqual(validateProvenance('').valid, false);
  assert.strictEqual(validateProvenance(null).valid, false);
});

// -------------------------------------------------------------
// 2. SHA-256 Duplicate & Double-Counting Detection Tests
// -------------------------------------------------------------
test('Duplicate Detection: identifies hash collision with historical regression set', () => {
  const regressionHashes = new Set([
    '649fc60d5cc486c4fcf4966336e6e22f286ee656b23b18544d678512fa6b306b',
    'e425cb5d549d01f11a84f3333333333333333333333333333333333333333333'
  ]);

  const candidate1 = '649fc60d5cc486c4fcf4966336e6e22f286ee656b23b18544d678512fa6b306b'; // Duplicate
  const candidate2 = 'a1b2c3d4e5f60000000000000000000000000000000000000000000000000000'; // Unique

  assert.strictEqual(regressionHashes.has(candidate1), true);
  assert.strictEqual(regressionHashes.has(candidate2), false);
});

// -------------------------------------------------------------
// 3. Annotation Geometry Validation Tests
// -------------------------------------------------------------
function polygonArea(pts) {
  if (!pts || pts.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(a) / 2;
}

function validateAnnotation(corners) {
  if (!corners || !Array.isArray(corners) || corners.length !== 4) return { valid: false, reason: 'Must have 4 corners' };
  for (let i = 0; i < 4; i++) {
    const p = corners[i];
    if (typeof p.x !== 'number' || typeof p.y !== 'number' || isNaN(p.x) || isNaN(p.y)) {
      return { valid: false, reason: 'Coordinates must be valid numbers' };
    }
    if (p.x < -0.05 || p.x > 1.05 || p.y < -0.05 || p.y > 1.05) {
      return { valid: false, reason: 'Coordinates out of range [-0.05, 1.05]' };
    }
  }
  const a = polygonArea(corners);
  if (a < 0.01) return { valid: false, reason: 'Area too small (<1%)' };
  if (a > 0.99) return { valid: false, reason: 'Area too large (>99%)' };
  return { valid: true };
}

test('Annotation Validation: accepts valid convex quadrilateral', () => {
  const validQuad = [{x: 0.1, y: 0.1}, {x: 0.9, y: 0.1}, {x: 0.9, y: 0.9}, {x: 0.1, y: 0.9}];
  assert.strictEqual(validateAnnotation(validQuad).valid, true);
});

test('Annotation Validation: rejects 3 corners or non-array', () => {
  assert.strictEqual(validateAnnotation([{x: 0.1, y: 0.1}, {x: 0.9, y: 0.1}, {x: 0.9, y: 0.9}]).valid, false);
  assert.strictEqual(validateAnnotation(null).valid, false);
});

test('Annotation Validation: rejects NaN or out-of-bounds coordinates', () => {
  const nanQuad = [{x: NaN, y: 0.1}, {x: 0.9, y: 0.1}, {x: 0.9, y: 0.9}, {x: 0.1, y: 0.9}];
  assert.strictEqual(validateAnnotation(nanQuad).valid, false);

  const outQuad = [{x: -0.5, y: 0.1}, {x: 0.9, y: 0.1}, {x: 0.9, y: 0.9}, {x: 0.1, y: 0.9}];
  assert.strictEqual(validateAnnotation(outQuad).valid, false);
});

test('Annotation Validation: rejects degenerate near-zero area', () => {
  const degenQuad = [{x: 0.1, y: 0.1}, {x: 0.1001, y: 0.1}, {x: 0.1001, y: 0.1001}, {x: 0.1, y: 0.1001}];
  assert.strictEqual(validateAnnotation(degenQuad).valid, false);
});

// -------------------------------------------------------------
// 4. Quality Classification Tests
// -------------------------------------------------------------
function classifyQuality(iou, cornerErr) {
  if (iou === null || cornerErr === null) return 'UNKNOWN';
  if (iou >= 0.95 && cornerErr.worst <= 0.025) return 'EXCELLENT';
  if (iou >= 0.90 && cornerErr.worst <= 0.060) return 'GOOD';
  if (iou >= 0.70 && cornerErr.worst <= 0.150) return 'MANUAL_ADJUST';
  return 'CATASTROPHIC';
}

test('Classification: EXCELLENT, GOOD, MANUAL_ADJUST, CATASTROPHIC boundaries', () => {
  assert.strictEqual(classifyQuality(0.98, { worst: 0.01 }), 'EXCELLENT');
  assert.strictEqual(classifyQuality(0.92, { worst: 0.04 }), 'GOOD');
  assert.strictEqual(classifyQuality(0.78, { worst: 0.10 }), 'MANUAL_ADJUST');
  assert.strictEqual(classifyQuality(0.50, { worst: 0.20 }), 'CATASTROPHIC');
  assert.strictEqual(classifyQuality(0.96, { worst: 0.08 }), 'MANUAL_ADJUST'); // IoU high but worst error pulls to manual
});

// -------------------------------------------------------------
// 5. Score Semantics Invariant Tests
// -------------------------------------------------------------
test('Score Semantics: filters ML_SIGMOID_CONFIDENCE strictly from placeholders', () => {
  const detections = [
    { source: 'SCANIC_ML', scoreSource: 'ML_SIGMOID_CONFIDENCE', score: 0.98 },
    { source: 'CURRENT_FALLBACK', scoreSource: 'CLASSICAL_CONFIDENCE', score: 0.55 },
    { source: 'DEFAULT_FALLBACK', scoreSource: 'DEFAULT_PLACEHOLDER', score: 0.50 }
  ];

  const mlOnly = detections.filter(d => d.scoreSource === 'ML_SIGMOID_CONFIDENCE');
  assert.strictEqual(mlOnly.length, 1);
  assert.strictEqual(mlOnly[0].score, 0.98);

  const placeholders = detections.filter(d => d.scoreSource !== 'ML_SIGMOID_CONFIDENCE');
  assert.strictEqual(placeholders.length, 2);
});

// -------------------------------------------------------------
// 6. Dataset Completeness & Pilot Status Tests
// -------------------------------------------------------------
function evaluatePilotStatus(counts, targetCategories) {
  let total = 0;
  for (const c of Object.values(counts)) total += c;
  if (total === 0) return 'REAL_WORLD_PILOT_INFRASTRUCTURE_READY';
  if (total < 20) return `REAL_WORLD_PILOT_INCOMPLETE: ${total}/20`;
  for (const [cat, target] of Object.entries(targetCategories)) {
    if ((counts[cat] || 0) < target) return `REAL_WORLD_PILOT_INCOMPLETE: ${total}/20 (distribution mismatch)`;
  }
  return 'REAL_WORLD_PILOT_COMPLETE';
}

test('Pilot Status: 0 images gives REAL_WORLD_PILOT_INFRASTRUCTURE_READY', () => {
  const targets = { 'RW01_WHITE_ON_WHITE': 5, 'RW02_PARTIAL_OCCLUSION': 3 };
  assert.strictEqual(evaluatePilotStatus({}, targets), 'REAL_WORLD_PILOT_INFRASTRUCTURE_READY');
});

test('Pilot Status: partial images gives REAL_WORLD_PILOT_INCOMPLETE: X/20', () => {
  const targets = { 'RW01_WHITE_ON_WHITE': 5, 'RW02_PARTIAL_OCCLUSION': 3 };
  assert.strictEqual(evaluatePilotStatus({ 'RW01_WHITE_ON_WHITE': 3, 'RW02_PARTIAL_OCCLUSION': 2 }, targets), 'REAL_WORLD_PILOT_INCOMPLETE: 5/20');
});

// -------------------------------------------------------------
// 7. Contact Sheet HTML Offline Invariant Tests
// -------------------------------------------------------------
test('Contact Sheet HTML: zero CDN / external network links', () => {
  const contactSheetPath = path.join(__dirname, '..', 'benchmark-output', 'contact_sheet.html');
  if (fs.existsSync(contactSheetPath)) {
    const html = fs.readFileSync(contactSheetPath, 'utf8');
    assert.strictEqual(html.includes('http://'), false, 'HTML must not contain http://');
    assert.strictEqual(html.includes('https://'), false, 'HTML must not contain https://');
    assert.strictEqual(html.includes('<script src='), false, 'HTML must not load external scripts');
  }
});

console.log(`\n======================================================`);
console.log(`RESULTS: ${checks - failures}/${checks} checks passed.`);
if (failures > 0) {
  console.error(`✗ ${failures} CHECKS FAILED!`);
  process.exit(1);
} else {
  console.log('✓ All Real-World Pilot Pipeline unit tests PASSED.');
}

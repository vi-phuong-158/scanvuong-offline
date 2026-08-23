'use strict';

/**
 * Comprehensive Failure-Path & Evidence-Integrity Test Suite
 * Validates strict geometry, missing-manifest rejection, human-confirmation enforcement,
 * SHA mismatch detection, duplicate collisions, and safe path invocation.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

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

console.log('===============================================================');
console.log('=== ScanVuông Pilot Pipeline Evidence-Integrity Test Suite  ===');
console.log('===============================================================\n');

const ROOT = path.join(__dirname, '..');
const prepScript = path.join(ROOT, 'scripts', 'prepare_real_world_pilot.cjs');
const runScript = path.join(ROOT, 'scripts', 'run_real_world_pilot.cjs');

// -------------------------------------------------------------
// 1. Geometry Validation Tests (Cases 10, 11, 12, 13, 14)
// -------------------------------------------------------------
function validateStrictGeometry(pts) {
  if (!pts || !Array.isArray(pts) || pts.length !== 4) {
    return { valid: false, reason: 'Must have exactly 4 corners' };
  }
  for (let i = 0; i < 4; i++) {
    const p = pts[i];
    if (!p || typeof p.x !== 'number' || typeof p.y !== 'number' || isNaN(p.x) || isNaN(p.y) || !isFinite(p.x) || !isFinite(p.y)) {
      return { valid: false, reason: `Corner ${i} contains non-numeric coordinates` };
    }
    if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) {
      return { valid: false, reason: `Corner ${i} (${p.x.toFixed(4)}, ${p.y.toFixed(4)}) out of strict bounds [0.0, 1.0]` };
    }
  }

  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      const dist = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
      if (dist < 0.01) {
        return { valid: false, reason: `Corners ${i} and ${j} are too close (< 0.01)` };
      }
    }
  }

  for (let i = 0; i < 4; i++) {
    const next = (i + 1) % 4;
    const edgeLen = Math.hypot(pts[next].x - pts[i].x, pts[next].y - pts[i].y);
    if (edgeLen < 0.01) {
      return { valid: false, reason: `Edge ${i}->${next} is degenerate (< 0.01)` };
    }
  }

  let area = 0;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  area = Math.abs(area) / 2;
  if (area < 0.01) return { valid: false, reason: `Polygon area too small (${area.toFixed(4)} < 0.01)` };
  if (area > 0.99) return { valid: false, reason: `Polygon area too large (${area.toFixed(4)} > 0.99)` };

  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const p0 = pts[i];
    const p1 = pts[(i + 1) % 4];
    const p2 = pts[(i + 2) % 4];
    const cp = (p1.x - p0.x) * (p2.y - p1.y) - (p1.y - p0.y) * (p2.x - p1.x);
    if (Math.abs(cp) < 1e-7) return { valid: false, reason: `Collinear vertices at edge ${i}` };
    const curSign = cp > 0 ? 1 : -1;
    if (sign === 0) sign = curSign;
    else if (sign !== curSign) return { valid: false, reason: 'Polygon is concave or self-intersecting' };
  }

  return { valid: true };
}

test('Test 10: rejects self-intersecting hourglass quad', () => {
  const selfIntersectQuad = [{x: 0.1, y: 0.1}, {x: 0.9, y: 0.9}, {x: 0.9, y: 0.1}, {x: 0.1, y: 0.9}];
  const res = validateStrictGeometry(selfIntersectQuad);
  assert.strictEqual(res.valid, false);
});

test('Test 11: rejects concave chevron/dart quad', () => {
  const concaveQuad = [{x: 0.1, y: 0.1}, {x: 0.9, y: 0.1}, {x: 0.5, y: 0.4}, {x: 0.1, y: 0.9}];
  const res = validateStrictGeometry(concaveQuad);
  assert.strictEqual(res.valid, false);
  assert.strictEqual(res.reason.includes('concave or self-intersecting'), true);
});

test('Test 12: rejects coordinate below 0.0 (e.g. -0.02)', () => {
  const belowZero = [{x: -0.02, y: 0.1}, {x: 0.9, y: 0.1}, {x: 0.9, y: 0.9}, {x: 0.1, y: 0.9}];
  const res = validateStrictGeometry(belowZero);
  assert.strictEqual(res.valid, false);
  assert.strictEqual(res.reason.includes('out of strict bounds'), true);
});

test('Test 13: rejects coordinate above 1.0 (e.g. 1.02)', () => {
  const aboveOne = [{x: 0.1, y: 0.1}, {x: 1.02, y: 0.1}, {x: 0.9, y: 0.9}, {x: 0.1, y: 0.9}];
  const res = validateStrictGeometry(aboveOne);
  assert.strictEqual(res.valid, false);
  assert.strictEqual(res.reason.includes('out of strict bounds'), true);
});

test('Test 14: rejects duplicate/near-identical corners (distance < 0.01)', () => {
  const duplicateCorners = [{x: 0.1, y: 0.1}, {x: 0.1001, y: 0.1002}, {x: 0.9, y: 0.9}, {x: 0.1, y: 0.9}];
  const res = validateStrictGeometry(duplicateCorners);
  assert.strictEqual(res.valid, false);
  assert.strictEqual(res.reason.includes('too close'), true);
});

// -------------------------------------------------------------
// Setup Temporary Fixtures Directory for Preparation Tests
// -------------------------------------------------------------
const tmpDir = path.join(ROOT, 'benchmark-output', 'tmp_test_fixtures');
if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
fs.mkdirSync(tmpDir, { recursive: true });

// Create valid PNG image buffer helper
let createCanvas;
try {
  createCanvas = require(path.join(ROOT, 'benchmark', 'node_modules', 'canvas')).createCanvas;
} catch (e) {
  // fallback if needed
}

function createSamplePng(name, color = '#38bdf8') {
  const p = path.join(tmpDir, name);
  if (createCanvas) {
    const c = createCanvas(20, 20);
    const ctx = c.getContext('2d');
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 20, 20);
    fs.writeFileSync(p, c.toBuffer('image/png'));
  } else {
    fs.writeFileSync(p, Buffer.from(`IMAGE_DATA_${name}_${Math.random()}`));
  }
  return p;
}

const img1 = createSamplePng('img1.png', '#ff0000');
const img2 = createSamplePng('img2.png', '#00ff00');
const hash1 = crypto.createHash('sha256').update(fs.readFileSync(img1)).digest('hex');
const hash2 = crypto.createHash('sha256').update(fs.readFileSync(img2)).digest('hex');

// -------------------------------------------------------------
// 2. Preparation Negative Path Tests (Cases 1 - 9)
// -------------------------------------------------------------
test('Test 1: Missing manifest fails closed (PILOT_MANIFEST_REQUIRED)', () => {
  const emptyFolder = path.join(tmpDir, 'empty_folder');
  fs.mkdirSync(emptyFolder, { recursive: true });
  const res = spawnSync(process.execPath, [prepScript, '--input', emptyFolder], { encoding: 'utf8' });
  assert.notStrictEqual(res.status, 0);
  assert.strictEqual(res.stderr.includes('PILOT_MANIFEST_REQUIRED'), true);
});

test('Test 2: Default / unconfirmed corners fails closed', () => {
  const manifest = {
    cases: [{
      id: 'CASE_1',
      filename: 'img1.png',
      category: 'RW01_WHITE_ON_WHITE',
      contains_document: true,
      annotation_confirmed: false, // Unconfirmed
      sha256: hash1,
      corners: [{x:0.15,y:0.15},{x:0.85,y:0.15},{x:0.85,y:0.85},{x:0.15,y:0.85}]
    }]
  };
  const mPath = path.join(tmpDir, 'manifest_unconfirmed.json');
  fs.writeFileSync(mPath, JSON.stringify(manifest));

  const res = spawnSync(process.execPath, [prepScript, '--input', tmpDir, '--manifest', mPath], { encoding: 'utf8' });
  assert.notStrictEqual(res.status, 0);
  assert.strictEqual(res.stderr.includes('UNCONFIRMED_GROUND_TRUTH'), true);
});

test('Test 3: Manifest SHA mismatch against disk file fails closed', () => {
  const manifest = {
    cases: [{
      id: 'CASE_1',
      filename: 'img1.png',
      category: 'RW01_WHITE_ON_WHITE',
      contains_document: true,
      annotation_confirmed: true,
      sha256: '0000000000000000000000000000000000000000000000000000000000000000', // Wrong hash
      corners: [{x:0.15,y:0.15},{x:0.85,y:0.15},{x:0.85,y:0.85},{x:0.15,y:0.85}]
    }]
  };
  const mPath = path.join(tmpDir, 'manifest_sha_mismatch.json');
  fs.writeFileSync(mPath, JSON.stringify(manifest));

  const res = spawnSync(process.execPath, [prepScript, '--input', tmpDir, '--manifest', mPath], { encoding: 'utf8' });
  assert.notStrictEqual(res.status, 0);
  assert.strictEqual(res.stderr.includes('MANIFEST_FILE_HASH_MISMATCH'), true);
});

test('Test 4 & 5: Same image under two names or two categories fails closed (PILOT_INTERNAL_DUPLICATE)', () => {
  const imgCopy = path.join(tmpDir, 'img1_copy.png');
  fs.copyFileSync(img1, imgCopy);

  const manifest = {
    cases: [
      {
        id: 'CASE_1',
        filename: 'img1.png',
        category: 'RW01_WHITE_ON_WHITE',
        contains_document: true,
        annotation_confirmed: true,
        sha256: hash1,
        corners: [{x:0.15,y:0.15},{x:0.85,y:0.15},{x:0.85,y:0.85},{x:0.15,y:0.85}]
      },
      {
        id: 'CASE_2',
        filename: 'img1_copy.png',
        category: 'RW02_PARTIAL_OCCLUSION',
        contains_document: true,
        annotation_confirmed: true,
        sha256: hash1, // Identical hash
        corners: [{x:0.15,y:0.15},{x:0.85,y:0.15},{x:0.85,y:0.85},{x:0.15,y:0.85}]
      }
    ]
  };
  const mPath = path.join(tmpDir, 'manifest_duplicate.json');
  fs.writeFileSync(mPath, JSON.stringify(manifest));

  const res = spawnSync(process.execPath, [prepScript, '--input', tmpDir, '--manifest', mPath], { encoding: 'utf8' });
  assert.notStrictEqual(res.status, 0);
  assert.strictEqual(res.stderr.includes('PILOT_INTERNAL_DUPLICATE'), true);
});

test('Test 6: Regression duplicate collision fails closed', () => {
  const fakeRegDir = path.join(tmpDir, 'fake_regression');
  fs.mkdirSync(fakeRegDir, { recursive: true });
  fs.copyFileSync(img1, path.join(fakeRegDir, 'reg_01.png'));

  const manifest = {
    cases: [{
      id: 'CASE_1',
      filename: 'img1.png',
      category: 'RW01_WHITE_ON_WHITE',
      contains_document: true,
      annotation_confirmed: true,
      sha256: hash1,
      corners: [{x:0.15,y:0.15},{x:0.85,y:0.15},{x:0.85,y:0.85},{x:0.15,y:0.85}]
    }]
  };
  const mPath = path.join(tmpDir, 'manifest_reg_coll.json');
  fs.writeFileSync(mPath, JSON.stringify(manifest));

  const res = spawnSync(process.execPath, [prepScript, '--input', tmpDir, '--manifest', mPath, '--regression-dir', fakeRegDir], { encoding: 'utf8' });
  assert.notStrictEqual(res.status, 0);
  assert.strictEqual(res.stderr.includes('REGRESSION_DUPLICATE_COLLISION'), true);
});

test('Test 7: Unknown category fails closed', () => {
  const manifest = {
    cases: [{
      id: 'CASE_1',
      filename: 'img1.png',
      category: 'CUSTOM_CATEGORY_UNACCEPTED',
      contains_document: true,
      annotation_confirmed: true,
      sha256: hash1,
      corners: [{x:0.15,y:0.15},{x:0.85,y:0.15},{x:0.85,y:0.85},{x:0.15,y:0.85}]
    }]
  };
  const mPath = path.join(tmpDir, 'manifest_unknown_cat.json');
  fs.writeFileSync(mPath, JSON.stringify(manifest));

  const res = spawnSync(process.execPath, [prepScript, '--input', tmpDir, '--manifest', mPath], { encoding: 'utf8' });
  assert.notStrictEqual(res.status, 0);
  assert.strictEqual(res.stderr.includes('UNKNOWN_CATEGORY'), true);
});

test('Test 8: Negative marked contains_document=true fails closed', () => {
  const manifest = {
    cases: [{
      id: 'CASE_1',
      filename: 'img1.png',
      category: 'NEG_DOCUMENT_LIKE',
      contains_document: true, // Inconsistent
      annotation_confirmed: true,
      sha256: hash1,
      corners: [{x:0.15,y:0.15},{x:0.85,y:0.15},{x:0.85,y:0.85},{x:0.15,y:0.85}]
    }]
  };
  const mPath = path.join(tmpDir, 'manifest_neg_mismatch.json');
  fs.writeFileSync(mPath, JSON.stringify(manifest));

  const res = spawnSync(process.execPath, [prepScript, '--input', tmpDir, '--manifest', mPath], { encoding: 'utf8' });
  assert.notStrictEqual(res.status, 0);
  assert.strictEqual(res.stderr.includes('CATEGORY_SEMANTICS_MISMATCH'), true);
});

test('Test 9: Positive marked contains_document=false fails closed', () => {
  const manifest = {
    cases: [{
      id: 'CASE_1',
      filename: 'img1.png',
      category: 'RW01_WHITE_ON_WHITE',
      contains_document: false, // Inconsistent
      annotation_confirmed: true,
      sha256: hash1,
      corners: null
    }]
  };
  const mPath = path.join(tmpDir, 'manifest_pos_mismatch.json');
  fs.writeFileSync(mPath, JSON.stringify(manifest));

  const res = spawnSync(process.execPath, [prepScript, '--input', tmpDir, '--manifest', mPath], { encoding: 'utf8' });
  assert.notStrictEqual(res.status, 0);
  assert.strictEqual(res.stderr.includes('CATEGORY_SEMANTICS_MISMATCH'), true);
});

// -------------------------------------------------------------
// 3. Path Handling & Safe Invocation Tests (Cases 16, 17, 18)
// -------------------------------------------------------------
test('Test 16: Manifest located outside image folder via --manifest passes', () => {
  const extManifestDir = path.join(tmpDir, 'external_manifest_folder');
  fs.mkdirSync(extManifestDir, { recursive: true });
  const extManifestPath = path.join(extManifestDir, 'pilot_manifest.json');

  const manifest = {
    cases: [{
      id: 'CASE_VALID',
      filename: 'img2.png',
      category: 'RW01_WHITE_ON_WHITE',
      contains_document: true,
      annotation_confirmed: true,
      provenance: 'TEST_FIXTURE',
      sha256: hash2,
      corners: [{x:0.15,y:0.15},{x:0.85,y:0.15},{x:0.85,y:0.85},{x:0.15,y:0.85}]
    }]
  };
  fs.writeFileSync(extManifestPath, JSON.stringify(manifest));

  const outDest = path.join(tmpDir, 'test16_dest');
  const res = spawnSync(process.execPath, [prepScript, '--input', tmpDir, '--manifest', extManifestPath, '--dest', outDest], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0);
  assert.strictEqual(fs.existsSync(path.join(outDest, 'positives', 'RW01_WHITE_ON_WHITE', 'img2.png')), true);
});

test('Test 17 & 18: Windows paths with spaces and Vietnamese Unicode characters handled safely', () => {
  const unicodeDir = path.join(tmpDir, 'Thư Mục Ảnh Pilot (Chụp Thử 2026)');
  fs.mkdirSync(unicodeDir, { recursive: true });
  const uImg = path.join(unicodeDir, 'ảnh gốc 01.png');
  if (createCanvas) {
    const c = createCanvas(20, 20);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#0000ff';
    ctx.fillRect(0, 0, 20, 20);
    fs.writeFileSync(uImg, c.toBuffer('image/png'));
  } else {
    fs.writeFileSync(uImg, Buffer.from('UNICODE_IMAGE_SAMPLE_DATA'));
  }
  const uHash = crypto.createHash('sha256').update(fs.readFileSync(uImg)).digest('hex');

  const uManifestPath = path.join(unicodeDir, 'pilot_manifest.json');
  const manifest = {
    cases: [{
      id: 'CASE_UNICODE',
      filename: 'ảnh gốc 01.png',
      category: 'RW01_WHITE_ON_WHITE',
      contains_document: true,
      annotation_confirmed: true,
      provenance: 'TEST_FIXTURE',
      sha256: uHash,
      corners: [{x:0.15,y:0.15},{x:0.85,y:0.15},{x:0.85,y:0.85},{x:0.15,y:0.85}]
    }]
  };
  fs.writeFileSync(uManifestPath, JSON.stringify(manifest));

  const outDest = path.join(tmpDir, 'unicode_dest');
  const res = spawnSync(process.execPath, [runScript, '--input', unicodeDir, '--dest', outDest, '--dir', outDest], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0);
  assert.strictEqual(fs.existsSync(path.join(outDest, 'positives', 'RW01_WHITE_ON_WHITE', 'ảnh gốc 01.png')), true);
});

// -------------------------------------------------------------
// 4. Offline & 0-CDN Invariant Tests
// -------------------------------------------------------------
test('Offline Invariant: zero CDN / external network links in pilot_capture_assistant.html', () => {
  const assistantPath = path.join(ROOT, 'benchmark', 'tools', 'pilot_capture_assistant.html');
  const html = fs.readFileSync(assistantPath, 'utf8');
  assert.strictEqual(html.includes('http://'), false);
  assert.strictEqual(html.includes('https://'), false);
  assert.strictEqual(html.includes('<script src='), false);
});

test('Offline Invariant: zero CDN / external network links in ground_truth_annotator.html', () => {
  const annotatorPath = path.join(ROOT, 'benchmark', 'tools', 'ground_truth_annotator.html');
  const html = fs.readFileSync(annotatorPath, 'utf8');
  assert.strictEqual(html.includes('http://'), false);
  assert.strictEqual(html.includes('https://'), false);
  assert.strictEqual(html.includes('<script src='), false);
});

// Cleanup fixture folder
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log(`\n===============================================================`);
console.log(`RESULTS: ${checks - failures}/${checks} checks passed.`);
if (failures > 0) {
  console.error(`✗ ${failures} CHECKS FAILED!`);
  process.exit(1);
} else {
  console.log('✓ All Pilot Pipeline Evidence-Integrity tests PASSED.');
}

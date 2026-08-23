'use strict';

/**
 * Unit test suite for Benchmark Engine & Metric Math.
 * Tests Polygon IoU, Sutherland-Hodgman clipping, Corner Error, and Quality Classification.
 */

const assert = require('assert');
const path = require('path');

// -------------------------------------------------------------
// Core functions under test
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

function isInside(p, cp1, cp2) {
  return (cp2.x - cp1.x) * (p.y - cp1.y) >= (cp2.y - cp1.y) * (p.x - cp1.x) - 1e-9;
}

function lineIntersection(cp1, cp2, s, e) {
  const dc = { x: cp1.x - cp2.x, y: cp1.y - cp2.y };
  const dp = { x: s.x - e.x, y: s.y - e.y };
  const n1 = cp1.x * cp2.y - cp1.y * cp2.x;
  const n2 = s.x * e.y - s.y * e.x;
  const det = dc.x * dp.y - dc.y * dp.x;
  if (Math.abs(det) < 1e-9) return { x: s.x, y: s.y };
  const invDet = 1.0 / det;
  return { x: (n1 * dp.x - n2 * dc.x) * invDet, y: (n1 * dp.y - n2 * dc.y) * invDet };
}

function clipPolygon(subjectPoly, clipPoly) {
  let outputList = subjectPoly;
  for (let j = 0; j < clipPoly.length; j++) {
    const cp1 = clipPoly[j];
    const cp2 = clipPoly[(j + 1) % clipPoly.length];
    const inputList = outputList;
    outputList = [];
    if (inputList.length === 0) break;
    let s = inputList[inputList.length - 1];
    for (let i = 0; i < inputList.length; i++) {
      const e = inputList[i];
      if (isInside(e, cp1, cp2)) {
        if (!isInside(s, cp1, cp2)) {
          outputList.push(lineIntersection(cp1, cp2, s, e));
        }
        outputList.push(e);
      } else if (isInside(s, cp1, cp2)) {
        outputList.push(lineIntersection(cp1, cp2, s, e));
      }
      s = e;
    }
  }
  return outputList;
}

function ensureCCW(pts) {
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    sum += (pts[j].x - pts[i].x) * (pts[j].y + pts[i].y);
  }
  return sum > 0 ? pts.slice().reverse() : pts.slice();
}

function polygonIoU(polyA, polyB) {
  if (!polyA || !polyB || polyA.length < 3 || polyB.length < 3) return 0;
  const areaA = polygonArea(polyA);
  const areaB = polygonArea(polyB);
  if (areaA === 0 || areaB === 0) return 0;

  const ccwA = ensureCCW(polyA);
  const ccwB = ensureCCW(polyB);
  const interPoly = clipPolygon(ccwA, ccwB);
  const interArea = polygonArea(interPoly);
  const unionArea = areaA + areaB - interArea;
  return unionArea > 0 ? interArea / unionArea : 0;
}

function orderCornersClockwise(pts) {
  if (!pts || pts.length !== 4) return pts;
  const cx = (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4;
  const cy = (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4;
  const ring = pts.slice().sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  let start = 0, bestSum = Infinity;
  ring.forEach((p, i) => {
    const sum = p.x + p.y;
    if (sum < bestSum) {
      bestSum = sum;
      start = i;
    }
  });
  return [ring[start], ring[(start + 1) % 4], ring[(start + 2) % 4], ring[(start + 3) % 4]];
}

function computeCornerError(predCorners, gtCorners) {
  if (!predCorners || !gtCorners || predCorners.length !== 4 || gtCorners.length !== 4) {
    return { mean: 1.0, worst: 1.0, deltas: [1.0, 1.0, 1.0, 1.0] };
  }
  const pred = orderCornersClockwise(predCorners);
  const gt = orderCornersClockwise(gtCorners);

  const deltas = [];
  for (let i = 0; i < 4; i++) {
    const d = Math.hypot(pred[i].x - gt[i].x, pred[i].y - gt[i].y);
    deltas.push(d);
  }
  const mean = deltas.reduce((a, b) => a + b, 0) / 4;
  const worst = Math.max(...deltas);
  return { mean, worst, deltas };
}

function classifyQuality(iou, cornerErr) {
  if (iou === null || cornerErr === null) return 'UNKNOWN';
  if (iou >= 0.95 && cornerErr.worst <= 0.025) return 'EXCELLENT';
  if (iou >= 0.90 && cornerErr.worst <= 0.060) return 'GOOD';
  if (iou >= 0.70 && cornerErr.worst <= 0.150) return 'MANUAL_ADJUST';
  return 'CATASTROPHIC';
}

// -------------------------------------------------------------
// Test Execution
// -------------------------------------------------------------
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

console.log('==================================================');
console.log('=== Benchmark Engine & Metric Math Unit Tests ===');
console.log('==================================================\n');

// 1. Polygon Area
test('polygonArea: unit square area is 1.0', () => {
  const sq = [{x:0, y:0}, {x:1, y:0}, {x:1, y:1}, {x:0, y:1}];
  assert.strictEqual(polygonArea(sq), 1.0);
});

test('polygonArea: degenerate <3 points returns 0', () => {
  assert.strictEqual(polygonArea([{x:0, y:0}, {x:1, y:1}]), 0);
});

// 2. Polygon IoU
test('polygonIoU: identical unit square gives 1.0', () => {
  const q1 = [{x:0, y:0}, {x:1, y:0}, {x:1, y:1}, {x:0, y:1}];
  const q2 = [{x:0, y:0}, {x:1, y:0}, {x:1, y:1}, {x:0, y:1}];
  assert.strictEqual(polygonIoU(q1, q2), 1.0);
});

test('polygonIoU: non-overlapping disjoint polygons give 0.0', () => {
  const q1 = [{x:0, y:0}, {x:1, y:0}, {x:1, y:1}, {x:0, y:1}];
  const q2 = [{x:2, y:2}, {x:3, y:2}, {x:3, y:3}, {x:2, y:3}];
  assert.strictEqual(polygonIoU(q1, q2), 0.0);
});

test('polygonIoU: known 50% shift gives exactly 1/3 (0.333333)', () => {
  const q1 = [{x:0, y:0}, {x:1, y:0}, {x:1, y:1}, {x:0, y:1}];
  const q2 = [{x:0.5, y:0}, {x:1.5, y:0}, {x:1.5, y:1}, {x:0.5, y:1}];
  const iou = polygonIoU(q1, q2);
  assert(Math.abs(iou - 1/3) < 1e-6, `Expected 0.333333, got ${iou}`);
});

test('polygonIoU: winding order invariance (CW vs CCW gives identical 1.0)', () => {
  const cw = [{x:0, y:0}, {x:1, y:0}, {x:1, y:1}, {x:0, y:1}];
  const ccw = [{x:0, y:0}, {x:0, y:1}, {x:1, y:1}, {x:1, y:0}];
  assert.strictEqual(polygonIoU(cw, ccw), 1.0);
});

// 3. Corner Error
test('computeCornerError: identical quad gives 0.0 mean and worst', () => {
  const q = [{x:0.1, y:0.1}, {x:0.9, y:0.1}, {x:0.9, y:0.9}, {x:0.1, y:0.9}];
  const err = computeCornerError(q, q);
  assert.strictEqual(err.mean, 0.0);
  assert.strictEqual(err.worst, 0.0);
});

test('computeCornerError: known corner shift gives exact delta', () => {
  const q1 = [{x:0.1, y:0.1}, {x:0.9, y:0.1}, {x:0.9, y:0.9}, {x:0.1, y:0.9}];
  const q2 = [{x:0.13, y:0.14}, {x:0.9, y:0.1}, {x:0.9, y:0.9}, {x:0.1, y:0.9}];
  const err = computeCornerError(q1, q2);
  // hypot(0.03, 0.04) = 0.05
  assert(Math.abs(err.worst - 0.05) < 1e-6, `Expected worst 0.05, got ${err.worst}`);
  assert(Math.abs(err.mean - 0.0125) < 1e-6, `Expected mean 0.0125, got ${err.mean}`);
});

// 4. Quality Classification
test('classifyQuality: EXCELLENT (IoU=0.98, Err=0.01)', () => {
  assert.strictEqual(classifyQuality(0.98, { worst: 0.01 }), 'EXCELLENT');
});

test('classifyQuality: GOOD (IoU=0.92, Err=0.04)', () => {
  assert.strictEqual(classifyQuality(0.92, { worst: 0.04 }), 'GOOD');
});

test('classifyQuality: MANUAL_ADJUST (IoU=0.75, Err=0.10)', () => {
  assert.strictEqual(classifyQuality(0.75, { worst: 0.10 }), 'MANUAL_ADJUST');
});

test('classifyQuality: CATASTROPHIC (IoU=0.60, Err=0.25)', () => {
  assert.strictEqual(classifyQuality(0.60, { worst: 0.25 }), 'CATASTROPHIC');
});

console.log(`\n==================================================`);
console.log(`RESULTS: ${checks - failures}/${checks} checks passed.`);
if (failures > 0) {
  console.error(`✗ ${failures} CHECKS FAILED!`);
  process.exit(1);
} else {
  console.log('✓ All benchmark engine unit tests PASSED.');
}

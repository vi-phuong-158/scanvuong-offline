const assert = require('assert');
const {
  polygonArea,
  isConvexQuad,
  orderCornersClockwise,
  validateAndNormalizeCorners
} = require('./geometry');

console.log('Running Geometry & Normalization Unit Tests...');

// 1. Clockwise Ordering Test
const unordered = [
  { x: 0.9, y: 0.9 }, // BR
  { x: 0.1, y: 0.1 }, // TL
  { x: 0.9, y: 0.1 }, // TR
  { x: 0.1, y: 0.9 }  // BL
];
const ordered = orderCornersClockwise(unordered);
assert.strictEqual(ordered.length, 4);
assert(Math.abs(ordered[0].x - 0.1) < 1e-4 && Math.abs(ordered[0].y - 0.1) < 1e-4, 'Ordered 0 must be TL');
assert(Math.abs(ordered[1].x - 0.9) < 1e-4 && Math.abs(ordered[1].y - 0.1) < 1e-4, 'Ordered 1 must be TR');
assert(Math.abs(ordered[2].x - 0.9) < 1e-4 && Math.abs(ordered[2].y - 0.9) < 1e-4, 'Ordered 2 must be BR');
assert(Math.abs(ordered[3].x - 0.1) < 1e-4 && Math.abs(ordered[3].y - 0.9) < 1e-4, 'Ordered 3 must be BL');
console.log('✓ Corner clockwise ordering from Top-Left passed');

// 2. Convexity Test
const convexQuad = [
  { x: 0.1, y: 0.1 },
  { x: 0.9, y: 0.15 },
  { x: 0.85, y: 0.9 },
  { x: 0.15, y: 0.85 }
];
assert.strictEqual(isConvexQuad(convexQuad), true, 'Regular quad must be convex');

// Concave / "arrowhead" quad
const concaveQuad = [
  { x: 0.1, y: 0.1 },
  { x: 0.9, y: 0.1 },
  { x: 0.5, y: 0.5 }, // pushed inside
  { x: 0.1, y: 0.9 }
];
assert.strictEqual(isConvexQuad(concaveQuad), false, 'Concave quad must be rejected');

// Self-intersecting / bow-tie quad
const selfIntersecting = [
  { x: 0.1, y: 0.1 },
  { x: 0.9, y: 0.9 }, // crossed
  { x: 0.9, y: 0.1 },
  { x: 0.1, y: 0.9 }
];
assert.strictEqual(isConvexQuad(selfIntersecting), false, 'Self-intersecting quad must be rejected');
console.log('✓ Convexity & self-intersection checks passed');

// 3. Normalization & Bounds Test
const slightlyOutOfBounds = [
  { x: -0.02, y: -0.01 },
  { x: 1.03, y: 0.02 },
  { x: 0.99, y: 1.02 },
  { x: 0.01, y: 0.98 }
];
const normRes = validateAndNormalizeCorners(slightlyOutOfBounds);
assert.strictEqual(normRes.valid, true);
assert(normRes.corners.every(p => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1), 'Clamped corners must be in [0, 1]');
console.log('✓ Coordinate clamping & normalization passed');

// 4. Degenerate Inputs Rejection Test
const nonFinite = [
  { x: NaN, y: 0.1 },
  { x: 0.9, y: 0.1 },
  { x: 0.9, y: 0.9 },
  { x: 0.1, y: 0.9 }
];
assert.strictEqual(validateAndNormalizeCorners(nonFinite).valid, false);

const tinyArea = [
  { x: 0.1, y: 0.1 },
  { x: 0.105, y: 0.1 },
  { x: 0.105, y: 0.105 },
  { x: 0.1, y: 0.105 }
];
assert.strictEqual(validateAndNormalizeCorners(tinyArea).valid, false);
console.log('✓ Non-finite and tiny area inputs properly rejected');

console.log('\nALL 4 Geometry unit test suites PASSED.');

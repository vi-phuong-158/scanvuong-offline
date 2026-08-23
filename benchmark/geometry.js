/**
 * Geometric utilities and validators for corner detection benchmark.
 */

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function crossProduct2D(a, b, c) {
  // Vector AB x Vector BC
  return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
}

function polygonArea(pts) {
  if (!pts || pts.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(a) / 2;
}

function isConvexQuad(pts) {
  if (!pts || pts.length !== 4) return false;
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const p1 = pts[i];
    const p2 = pts[(i + 1) % 4];
    const p3 = pts[(i + 2) % 4];
    const cp = crossProduct2D(p1, p2, p3);
    if (Math.abs(cp) < 1e-7) return false; // collinear
    if (sign === 0) {
      sign = cp > 0 ? 1 : -1;
    } else if ((cp > 0 ? 1 : -1) !== sign) {
      return false; // non-convex or self-intersecting
    }
  }
  return true;
}

function orderCornersClockwise(pts) {
  if (!pts || pts.length !== 4) return pts;
  const cx = (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4;
  const cy = (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4;
  // y grows downwards: ascending atan2 walks clockwise on screen
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

function validateAndNormalizeCorners(rawCorners, minArea = 0.03) {
  if (!rawCorners || rawCorners.length !== 4) {
    return { valid: false, corners: null, areaRatio: 0, error: 'Expected exactly 4 corners' };
  }

  const corners = rawCorners.map(p => ({
    x: Number(p.x),
    y: Number(p.y)
  }));

  for (let i = 0; i < 4; i++) {
    const p = corners[i];
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      return { valid: false, corners: null, areaRatio: 0, error: `Corner ${i} has non-finite coordinates` };
    }
    // Reject corners that are ridiculously out of frame (e.g. < -0.2 or > 1.2)
    if (p.x < -0.25 || p.x > 1.25 || p.y < -0.25 || p.y > 1.25) {
      return { valid: false, corners: null, areaRatio: 0, error: `Corner ${i} (${p.x.toFixed(2)}, ${p.y.toFixed(2)}) is far outside image boundary` };
    }
  }

  // Clamp slight out-of-bounds to [0, 1]
  const clamped = corners.map(p => ({
    x: Math.max(0, Math.min(1, p.x)),
    y: Math.max(0, Math.min(1, p.y))
  }));

  const ordered = orderCornersClockwise(clamped);
  const convex = isConvexQuad(ordered);
  const area = polygonArea(ordered);

  if (!convex) {
    return { valid: false, corners: ordered, areaRatio: area, error: 'Quadrilateral is non-convex or self-intersecting' };
  }

  if (area < minArea) {
    return { valid: false, corners: ordered, areaRatio: area, error: `Quadrilateral area ${area.toFixed(4)} is below minimum threshold ${minArea}` };
  }

  return {
    valid: true,
    corners: ordered,
    areaRatio: area,
    error: null
  };
}

module.exports = {
  dist,
  polygonArea,
  isConvexQuad,
  orderCornersClockwise,
  validateAndNormalizeCorners
};

'use strict';

/**
 * Deterministic generator for Hard-Case Benchmark Suite (HC01 - HC12).
 * Generates synthetic and composite challenge cases with mathematical ground truth.
 */

const fs = require('fs');
const path = require('path');
const { createCanvas } = require(path.join(__dirname, '..', 'node_modules', 'canvas'));

const OUT_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const cases = [];

function addCase(meta) {
  cases.push(meta);
}

// -------------------------------------------------------------
// Helper: Draw synthetic document with text lines and header
// -------------------------------------------------------------
function drawDocumentText(ctx, x, y, w, h) {
  ctx.fillStyle = '#1e293b';
  // Title
  ctx.fillRect(x + w * 0.1, y + h * 0.08, w * 0.5, h * 0.04);
  // Paragraph lines
  const numLines = 14;
  for (let i = 0; i < numLines; i++) {
    const ly = y + h * 0.18 + (i * h * 0.05);
    const lw = (i % 4 === 3) ? w * 0.45 : w * 0.8;
    ctx.fillRect(x + w * 0.1, ly, lw, Math.max(1, h * 0.015));
  }
  // Footer / Seal
  ctx.fillStyle = '#dc2626';
  ctx.beginPath();
  ctx.arc(x + w * 0.75, y + h * 0.85, Math.min(w, h) * 0.08, 0, Math.PI * 2);
  ctx.fill();
}

// -------------------------------------------------------------
// HC01: Perspective (Strong trapezoidal warp)
// -------------------------------------------------------------
function genPerspectiveCases() {
  const configs = [
    { id: 'HC01_001', name: 'perspective_steep_left', corners: [{x:0.12, y:0.20}, {x:0.82, y:0.08}, {x:0.92, y:0.88}, {x:0.28, y:0.94}], bg: '#334155' },
    { id: 'HC01_002', name: 'perspective_steep_right', corners: [{x:0.18, y:0.08}, {x:0.88, y:0.20}, {x:0.72, y:0.94}, {x:0.08, y:0.88}], bg: '#1e293b' },
    { id: 'HC01_003', name: 'perspective_low_angle', corners: [{x:0.25, y:0.15}, {x:0.75, y:0.15}, {x:0.90, y:0.92}, {x:0.10, y:0.92}], bg: '#475569' }
  ];

  for (const c of configs) {
    const canvas = createCanvas(800, 600);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = c.bg;
    ctx.fillRect(0, 0, 800, 600);

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(c.corners[0].x * 800, c.corners[0].y * 600);
    for (let i = 1; i < 4; i++) ctx.lineTo(c.corners[i].x * 800, c.corners[i].y * 600);
    ctx.closePath();
    ctx.fill();

    ctx.save();
    ctx.clip();
    drawDocumentText(ctx, c.corners[0].x * 800, c.corners[0].y * 600, 400, 450);
    ctx.restore();

    const filePath = path.join(OUT_DIR, `${c.id}.png`);
    fs.writeFileSync(filePath, canvas.toBuffer('image/png'));

    addCase({
      id: c.id,
      category: 'HC01_PERSPECTIVE',
      filename: `${c.id}.png`,
      contains_document: true,
      difficulty: 'hard',
      ground_truth: c.corners
    });
  }
}

// -------------------------------------------------------------
// HC02: Rotation
// -------------------------------------------------------------
function genRotationCases() {
  const configs = [
    { id: 'HC02_001', name: 'rot_90', corners: [{x:0.15, y:0.12}, {x:0.85, y:0.12}, {x:0.85, y:0.88}, {x:0.15, y:0.88}], rot: 90 },
    { id: 'HC02_002', name: 'rot_180', corners: [{x:0.18, y:0.15}, {x:0.82, y:0.15}, {x:0.82, y:0.85}, {x:0.18, y:0.85}], rot: 180 },
    { id: 'HC02_003', name: 'rot_tilt_25', corners: [{x:0.25, y:0.10}, {x:0.88, y:0.28}, {x:0.75, y:0.90}, {x:0.12, y:0.72}], rot: 25 }
  ];

  for (const c of configs) {
    const canvas = createCanvas(800, 600);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, 800, 600);

    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.moveTo(c.corners[0].x * 800, c.corners[0].y * 600);
    for (let i = 1; i < 4; i++) ctx.lineTo(c.corners[i].x * 800, c.corners[i].y * 600);
    ctx.closePath();
    ctx.fill();

    const filePath = path.join(OUT_DIR, `${c.id}.png`);
    fs.writeFileSync(filePath, canvas.toBuffer('image/png'));

    addCase({
      id: c.id,
      category: 'HC02_ROTATION',
      filename: `${c.id}.png`,
      contains_document: true,
      difficulty: 'medium',
      ground_truth: c.corners
    });
  }
}

// -------------------------------------------------------------
// HC03: Background Similarity (White on White / Low Contrast)
// -------------------------------------------------------------
function genBgSimilarityCases() {
  const configs = [
    { id: 'HC03_001', name: 'white_on_light_gray', bg: '#f1f5f9', paper: '#ffffff', corners: [{x:0.12, y:0.10}, {x:0.88, y:0.10}, {x:0.88, y:0.90}, {x:0.12, y:0.90}] },
    { id: 'HC03_002', name: 'cream_on_beige', bg: '#fef3c7', paper: '#fffbeb', corners: [{x:0.15, y:0.12}, {x:0.85, y:0.12}, {x:0.85, y:0.88}, {x:0.15, y:0.88}] },
    { id: 'HC03_003', name: 'very_low_contrast', bg: '#f8fafc', paper: '#ffffff', corners: [{x:0.14, y:0.11}, {x:0.86, y:0.11}, {x:0.86, y:0.89}, {x:0.14, y:0.89}] }
  ];

  for (const c of configs) {
    const canvas = createCanvas(800, 600);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = c.bg;
    ctx.fillRect(0, 0, 800, 600);

    ctx.fillStyle = c.paper;
    ctx.beginPath();
    ctx.moveTo(c.corners[0].x * 800, c.corners[0].y * 600);
    for (let i = 1; i < 4; i++) ctx.lineTo(c.corners[i].x * 800, c.corners[i].y * 600);
    ctx.closePath();
    ctx.fill();

    drawDocumentText(ctx, c.corners[0].x * 800, c.corners[0].y * 600, 480, 420);

    const filePath = path.join(OUT_DIR, `${c.id}.png`);
    fs.writeFileSync(filePath, canvas.toBuffer('image/png'));

    addCase({
      id: c.id,
      category: 'HC03_BACKGROUND_SIMILARITY',
      filename: `${c.id}.png`,
      contains_document: true,
      difficulty: 'hard',
      ground_truth: c.corners
    });
  }
}

// -------------------------------------------------------------
// HC05: Shadows
// -------------------------------------------------------------
function genShadowCases() {
  const configs = [
    { id: 'HC05_001', name: 'phone_shadow_diagonal', corners: [{x:0.15, y:0.12}, {x:0.85, y:0.12}, {x:0.85, y:0.88}, {x:0.15, y:0.88}] },
    { id: 'HC05_002', name: 'corner_heavy_shadow', corners: [{x:0.12, y:0.10}, {x:0.88, y:0.10}, {x:0.88, y:0.90}, {x:0.12, y:0.90}] }
  ];

  for (const c of configs) {
    const canvas = createCanvas(800, 600);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 0, 800, 600);

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(c.corners[0].x * 800, c.corners[0].y * 600);
    for (let i = 1; i < 4; i++) ctx.lineTo(c.corners[i].x * 800, c.corners[i].y * 600);
    ctx.closePath();
    ctx.fill();

    drawDocumentText(ctx, c.corners[0].x * 800, c.corners[0].y * 600, 480, 420);

    // Cast strong diagonal shadow
    const grad = ctx.createLinearGradient(0, 0, 800, 600);
    grad.addColorStop(0, 'rgba(0,0,0,0.65)');
    grad.addColorStop(0.5, 'rgba(0,0,0,0.3)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 800, 600);

    const filePath = path.join(OUT_DIR, `${c.id}.png`);
    fs.writeFileSync(filePath, canvas.toBuffer('image/png'));

    addCase({
      id: c.id,
      category: 'HC05_SHADOW',
      filename: `${c.id}.png`,
      contains_document: true,
      difficulty: 'hard',
      ground_truth: c.corners
    });
  }
}

// -------------------------------------------------------------
// HC06: Partial Occlusion (Finger holding corner)
// -------------------------------------------------------------
function genOcclusionCases() {
  const configs = [
    { id: 'HC06_001', name: 'thumb_on_bottom_left', corners: [{x:0.15, y:0.12}, {x:0.85, y:0.12}, {x:0.85, y:0.88}, {x:0.15, y:0.88}] },
    { id: 'HC06_002', name: 'clip_on_top_corner', corners: [{x:0.12, y:0.10}, {x:0.88, y:0.10}, {x:0.88, y:0.90}, {x:0.12, y:0.90}] }
  ];

  for (const c of configs) {
    const canvas = createCanvas(800, 600);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, 800, 600);

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(c.corners[0].x * 800, c.corners[0].y * 600);
    for (let i = 1; i < 4; i++) ctx.lineTo(c.corners[i].x * 800, c.corners[i].y * 600);
    ctx.closePath();
    ctx.fill();

    drawDocumentText(ctx, c.corners[0].x * 800, c.corners[0].y * 600, 480, 420);

    // Draw occluding thumb / clip
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.arc(c.corners[3].x * 800 + 20, c.corners[3].y * 600 - 20, 45, 0, Math.PI * 2);
    ctx.fill();

    const filePath = path.join(OUT_DIR, `${c.id}.png`);
    fs.writeFileSync(filePath, canvas.toBuffer('image/png'));

    addCase({
      id: c.id,
      category: 'HC06_PARTIAL_OCCLUSION',
      filename: `${c.id}.png`,
      contains_document: true,
      difficulty: 'hard',
      ground_truth: c.corners
    });
  }
}

// -------------------------------------------------------------
// HC07: Cropped Document (Very close to border)
// -------------------------------------------------------------
function genCroppedCases() {
  const configs = [
    { id: 'HC07_001', name: 'near_border_96pct', corners: [{x:0.02, y:0.02}, {x:0.98, y:0.02}, {x:0.98, y:0.98}, {x:0.02, y:0.98}] }
  ];

  for (const c of configs) {
    const canvas = createCanvas(800, 600);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 0, 800, 600);

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(c.corners[0].x * 800, c.corners[0].y * 600);
    for (let i = 1; i < 4; i++) ctx.lineTo(c.corners[i].x * 800, c.corners[i].y * 600);
    ctx.closePath();
    ctx.fill();

    drawDocumentText(ctx, c.corners[0].x * 800, c.corners[0].y * 600, 750, 550);

    const filePath = path.join(OUT_DIR, `${c.id}.png`);
    fs.writeFileSync(filePath, canvas.toBuffer('image/png'));

    addCase({
      id: c.id,
      category: 'HC07_CROPPED_DOCUMENT',
      filename: `${c.id}.png`,
      contains_document: true,
      difficulty: 'hard',
      ground_truth: c.corners
    });
  }
}

// -------------------------------------------------------------
// HC08: Small Document (Receipt / Card 12% area)
// -------------------------------------------------------------
function genSmallDocCases() {
  const configs = [
    { id: 'HC08_001', name: 'small_receipt', corners: [{x:0.35, y:0.25}, {x:0.65, y:0.25}, {x:0.65, y:0.75}, {x:0.35, y:0.75}] }
  ];

  for (const c of configs) {
    const canvas = createCanvas(800, 600);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, 800, 600);

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(c.corners[0].x * 800, c.corners[0].y * 600);
    for (let i = 1; i < 4; i++) ctx.lineTo(c.corners[i].x * 800, c.corners[i].y * 600);
    ctx.closePath();
    ctx.fill();

    drawDocumentText(ctx, c.corners[0].x * 800, c.corners[0].y * 600, 240, 300);

    const filePath = path.join(OUT_DIR, `${c.id}.png`);
    fs.writeFileSync(filePath, canvas.toBuffer('image/png'));

    addCase({
      id: c.id,
      category: 'HC08_SMALL_DOCUMENT',
      filename: `${c.id}.png`,
      contains_document: true,
      difficulty: 'medium',
      ground_truth: c.corners
    });
  }
}

// -------------------------------------------------------------
// HC09: Multiple Documents
// -------------------------------------------------------------
function genMultipleDocCases() {
  const configs = [
    {
      id: 'HC09_001',
      name: 'two_overlapping_sheets',
      primaryCorners: [{x:0.25, y:0.15}, {x:0.85, y:0.15}, {x:0.85, y:0.85}, {x:0.25, y:0.85}],
      secondaryCorners: [{x:0.10, y:0.30}, {x:0.40, y:0.30}, {x:0.40, y:0.70}, {x:0.10, y:0.70}]
    }
  ];

  for (const c of configs) {
    const canvas = createCanvas(800, 600);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 0, 800, 600);

    // Secondary sheet (behind)
    ctx.fillStyle = '#fde68a';
    ctx.fillRect(c.secondaryCorners[0].x * 800, c.secondaryCorners[0].y * 600, 240, 240);

    // Primary sheet
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(c.primaryCorners[0].x * 800, c.primaryCorners[0].y * 600);
    for (let i = 1; i < 4; i++) ctx.lineTo(c.primaryCorners[i].x * 800, c.primaryCorners[i].y * 600);
    ctx.closePath();
    ctx.fill();

    drawDocumentText(ctx, c.primaryCorners[0].x * 800, c.primaryCorners[0].y * 600, 480, 420);

    const filePath = path.join(OUT_DIR, `${c.id}.png`);
    fs.writeFileSync(filePath, canvas.toBuffer('image/png'));

    addCase({
      id: c.id,
      category: 'HC09_MULTIPLE_DOCUMENTS',
      filename: `${c.id}.png`,
      contains_document: true,
      difficulty: 'hard',
      ground_truth: c.primaryCorners
    });
  }
}

// -------------------------------------------------------------
// HC10: Non-Document Negatives (0 documents)
// -------------------------------------------------------------
function genNegativeCases() {
  const configs = [
    { id: 'HC10_001', name: 'empty_desk_texture', type: 'desk' },
    { id: 'HC10_002', name: 'wall_and_window', type: 'wall' },
    { id: 'HC10_003', name: 'keyboard_landscape', type: 'keyboard' },
    { id: 'HC10_004', name: 'abstract_gradient', type: 'gradient' },
    { id: 'HC10_005', name: 'outdoor_nature_scene', type: 'landscape' }
  ];

  for (const c of configs) {
    const canvas = createCanvas(800, 600);
    const ctx = canvas.getContext('2d');

    if (c.type === 'desk') {
      ctx.fillStyle = '#78350f';
      ctx.fillRect(0, 0, 800, 600);
      ctx.strokeStyle = '#92400e';
      for (let i = 0; i < 600; i += 20) {
        ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(800, i + 5); ctx.stroke();
      }
    } else if (c.type === 'keyboard') {
      ctx.fillStyle = '#18181b';
      ctx.fillRect(0, 0, 800, 600);
      ctx.fillStyle = '#27272a';
      for (let r = 0; r < 5; r++) {
        for (let k = 0; k < 12; k++) {
          ctx.fillRect(100 + k * 50, 150 + r * 60, 40, 45);
        }
      }
    } else if (c.type === 'gradient') {
      const grad = ctx.createRadialGradient(400, 300, 50, 400, 300, 400);
      grad.addColorStop(0, '#06b6d4');
      grad.addColorStop(1, '#3b82f6');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 800, 600);
    } else {
      ctx.fillStyle = '#64748b';
      ctx.fillRect(0, 0, 800, 600);
    }

    const filePath = path.join(OUT_DIR, `${c.id}.png`);
    fs.writeFileSync(filePath, canvas.toBuffer('image/png'));

    addCase({
      id: c.id,
      category: 'HC10_NON_DOCUMENT_NEGATIVES',
      filename: `${c.id}.png`,
      contains_document: false,
      difficulty: 'hard',
      ground_truth: null
    });
  }
}

// -------------------------------------------------------------
// HC11: Document-Like Objects (Laptop / Box / Tablet)
// -------------------------------------------------------------
function genDocLikeCases() {
  const configs = [
    { id: 'HC11_001', name: 'laptop_open_screen', rect: {x: 150, y: 100, w: 500, h: 320}, bg: '#1e293b', body: '#0284c7' },
    { id: 'HC11_002', name: 'rectangular_shipping_box', rect: {x: 200, y: 150, w: 400, h: 280}, bg: '#0f172a', body: '#b45309' },
    { id: 'HC11_003', name: 'tablet_device', rect: {x: 220, y: 120, w: 360, h: 380}, bg: '#334155', body: '#000000' }
  ];

  for (const c of configs) {
    const canvas = createCanvas(800, 600);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = c.bg;
    ctx.fillRect(0, 0, 800, 600);

    ctx.fillStyle = c.body;
    ctx.fillRect(c.rect.x, c.rect.y, c.rect.w, c.rect.h);
    ctx.fillStyle = '#e0f2fe';
    ctx.fillRect(c.rect.x + 20, c.rect.y + 20, c.rect.w - 40, c.rect.h - 40);

    const filePath = path.join(OUT_DIR, `${c.id}.png`);
    fs.writeFileSync(filePath, canvas.toBuffer('image/png'));

    addCase({
      id: c.id,
      category: 'HC11_DOCUMENT_LIKE_OBJECTS',
      filename: `${c.id}.png`,
      contains_document: false,
      is_document_like: true,
      difficulty: 'hard',
      ground_truth: null
    });
  }
}

function generateAll() {
  genPerspectiveCases();
  genRotationCases();
  genBgSimilarityCases();
  genShadowCases();
  genOcclusionCases();
  genCroppedCases();
  genSmallDocCases();
  genMultipleDocCases();
  genNegativeCases();
  genDocLikeCases();

  const manifestPath = path.join(__dirname, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify({ version: '1.0.0', total_cases: cases.length, cases }, null, 2), 'utf8');
  console.log(`Generated ${cases.length} hard-case benchmark challenge cases in ${OUT_DIR}`);
}

generateAll();

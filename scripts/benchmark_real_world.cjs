'use strict';

/**
 * ScanVuông Real-World Pilot Evidence Pipeline
 * Evaluates production baseline vs experimental improvements on real camera photos.
 * Evaluates Production Baseline, Experiment B (Contrast), and Experiment C2 (Multi-Signal False Positive Rejection).
 * Generates JSON report, Markdown summary, and a standalone 100% offline visual contact sheet.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// -------------------------------------------------------------
// CLI Argument Parsing
// -------------------------------------------------------------
const args = process.argv.slice(2);

function showHelp() {
  console.log(`
ScanVuông Real-World Pilot Evidence Pipeline
===========================================

Usage:
  node scripts/benchmark_real_world.cjs [options]

Options:
  --help                    Hiển thị hướng dẫn sử dụng
  --dir <path>              Đường dẫn thư mục ảnh real-world private (mặc định: ./benchmark-private)
  --regression-dir <path>   Đường dẫn thư mục regression lịch sử (mặc định: G:\\My Drive\\CamScaner)
  --contact-sheet <path>    Đường dẫn xuất file HTML visual contact sheet (mặc định: benchmark-output/contact_sheet.html)
  --json-out <path>         Đường dẫn xuất file JSON kết quả (mặc định: benchmark-output/pilot_evidence_report.json)
  --summary-out <path>      Đường dẫn xuất file Markdown tóm tắt (mặc định: benchmark-output/pilot_evidence_summary.md)
  --include-regression      Chạy kèm 25 ảnh regression lịch sử để so sánh

Target Pilot Dataset (20 Real Camera Photos):
  • RW01_WHITE_ON_WHITE:      5 ảnh (Giấy trắng trên nền sáng/gạch/bàn trắng)
  • RW02_PARTIAL_OCCLUSION:   3 ảnh (Ngón tay cầm góc, kẹp bướm, giấy note)
  • RW03_STRONG_PERSPECTIVE:  4 ảnh (Chụp nghiêng góc hẹp <35 độ, chéo cao)
  • RW04_SHADOW_UNEVEN_LIGHT: 3 ảnh (Bóng đổ ngang, ánh sáng gắt một phía)
  • RW05_NEAR_FRAME:          2 ảnh (Tài liệu sát mép khung hình >92% diện tích)
  • NEG_DOCUMENT_LIKE:        3 ảnh (Laptop, tablet, hộp carton, khung tranh)
`);
  process.exit(0);
}

if (args.includes('--help') || args.includes('-h')) {
  showHelp();
}

const ROOT = path.join(__dirname, '..');

let privateDir = path.join(ROOT, 'benchmark-private');
const dirIdx = args.indexOf('--dir');
if (dirIdx !== -1 && args[dirIdx + 1]) privateDir = path.resolve(args[dirIdx + 1]);

let regressionDir = 'G:\\My Drive\\CamScaner';
const regIdx = args.indexOf('--regression-dir');
if (regIdx !== -1 && args[regIdx + 1]) regressionDir = path.resolve(args[regIdx + 1]);

let contactSheetPath = path.join(ROOT, 'benchmark-output', 'contact_sheet.html');
const csIdx = args.indexOf('--contact-sheet');
if (csIdx !== -1 && args[csIdx + 1]) contactSheetPath = path.resolve(args[csIdx + 1]);

let jsonOutPath = path.join(ROOT, 'benchmark-output', 'pilot_evidence_report.json');
const jsonIdx = args.indexOf('--json-out');
if (jsonIdx !== -1 && args[jsonIdx + 1]) jsonOutPath = path.resolve(args[jsonIdx + 1]);

let summaryOutPath = path.join(ROOT, 'benchmark-output', 'pilot_evidence_summary.md');
const sumIdx = args.indexOf('--summary-out');
if (sumIdx !== -1 && args[sumIdx + 1]) summaryOutPath = path.resolve(args[sumIdx + 1]);

const includeRegression = args.includes('--include-regression');

// -------------------------------------------------------------
// Dev Dependencies: Canvas & DocumentDetector
// -------------------------------------------------------------
let createCanvas, Image;
try {
  const canvasMod = require(path.join(ROOT, 'benchmark', 'node_modules', 'canvas'));
  createCanvas = canvasMod.createCanvas;
  Image = canvasMod.Image;
} catch (err) {
  console.error('================================================================');
  console.error('ERROR: Canvas dev dependency not found in benchmark/node_modules.');
  console.error('Please run: npm ci --prefix benchmark');
  console.error('================================================================\n');
  process.exit(1);
}

const DocumentDetector = require(path.join(ROOT, 'document-detector.js'));

// -------------------------------------------------------------
// Geometry & Metric Helpers
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
        if (!isInside(s, cp1, cp2)) outputList.push(lineIntersection(cp1, cp2, s, e));
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

function validateAnnotationCorners(corners) {
  if (!corners || !Array.isArray(corners) || corners.length !== 4) return { valid: false, reason: 'Must have exactly 4 corners' };
  for (let i = 0; i < 4; i++) {
    const p = corners[i];
    if (typeof p.x !== 'number' || typeof p.y !== 'number' || isNaN(p.x) || isNaN(p.y)) {
      return { valid: false, reason: `Corner ${i} contains non-numeric coordinates` };
    }
    if (p.x < -0.05 || p.x > 1.05 || p.y < -0.05 || p.y > 1.05) {
      return { valid: false, reason: `Corner ${i} out of bounds (${p.x}, ${p.y})` };
    }
  }
  const area = polygonArea(corners);
  if (area < 0.01) return { valid: false, reason: `Polygon area too small: ${area.toFixed(4)}` };
  if (area > 0.99) return { valid: false, reason: `Polygon area too large: ${area.toFixed(4)}` };
  return { valid: true };
}

// -------------------------------------------------------------
// Experiment B Preprocessing (Local Contrast Percentile Stretch)
// -------------------------------------------------------------
function applyLocalContrastStretch(canvas) {
  const ctx = canvas.getContext('2d');
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imgData.data;
  const len = data.length;

  const hist = new Int32Array(256);
  for (let i = 0; i < len; i += 4) {
    const luma = (data[i] * 77 + data[i+1] * 150 + data[i+2] * 29) >> 8;
    hist[luma]++;
  }

  const totalPixels = len / 4;
  const lowThresh = Math.floor(totalPixels * 0.01);
  const highThresh = Math.floor(totalPixels * 0.99);

  let acc = 0, pLow = 0, pHigh = 255;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc >= lowThresh && pLow === 0) pLow = i;
    if (acc >= highThresh) { pHigh = i; break; }
  }

  if (pHigh > pLow + 10) {
    const scale = 255 / (pHigh - pLow);
    for (let i = 0; i < len; i += 4) {
      data[i] = Math.max(0, Math.min(255, (data[i] - pLow) * scale));
      data[i+1] = Math.max(0, Math.min(255, (data[i+1] - pLow) * scale));
      data[i+2] = Math.max(0, Math.min(255, (data[i+2] - pLow) * scale));
    }
    ctx.putImageData(imgData, 0, 0);
  }
  return canvas;
}

// -------------------------------------------------------------
// Experiment C2 Candidate Logic (Multi-Signal Ranking & Evidence)
// -------------------------------------------------------------
function evaluateExperimentC2(canvas, detResult) {
  if (!detResult.geometryValid || !detResult.corners) {
    return { accepted: false, reason: 'INVALID_GEOMETRY' };
  }

  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const corners = detResult.corners;

  const minX = Math.max(0, Math.floor(Math.min(corners[0].x, corners[1].x, corners[2].x, corners[3].x) * w));
  const maxX = Math.min(w - 1, Math.ceil(Math.max(corners[0].x, corners[1].x, corners[2].x, corners[3].x) * w));
  const minY = Math.max(0, Math.floor(Math.min(corners[0].y, corners[1].y, corners[2].y, corners[3].y) * h));
  const maxY = Math.min(h - 1, Math.ceil(Math.max(corners[0].y, corners[1].y, corners[2].y, corners[3].y) * h));

  const boxW = maxX - minX;
  const boxH = maxY - minY;
  if (boxW <= 0 || boxH <= 0) return { accepted: false, reason: 'ZERO_BOUNDS' };

  const imgData = ctx.getImageData(minX, minY, boxW, boxH);
  const data = imgData.data;
  const len = data.length;

  let sum = 0, count = 0;
  for (let i = 0; i < len; i += 64) {
    const luma = (data[i] * 77 + data[i+1] * 150 + data[i+2] * 29) >> 8;
    sum += luma;
    count++;
  }
  const meanLuma = count > 0 ? sum / count : 0;

  // Candidate scoring:
  // High confidence (>0.70) is always accepted.
  // Moderate confidence (0.40 - 0.70) requires document-like luminance evidence (meanLuma >= 100).
  const isAccepted = detResult.documentScore >= 0.70 || (detResult.documentScore >= 0.40 && meanLuma >= 100);
  return { accepted: isAccepted, meanLuma, score: detResult.documentScore };
}

// -------------------------------------------------------------
// Pipeline Execution
// -------------------------------------------------------------
async function runPilotPipeline() {
  console.log('================================================================');
  console.log('=== ScanVuông Real-World Pilot Evidence Pipeline (V1)        ===');
  console.log('================================================================\n');

  // 1. Audit Historical Regression Set (REGRESSION_V1) Hashes
  const regressionHashes = new Set();
  if (fs.existsSync(regressionDir)) {
    const regFiles = fs.readdirSync(regressionDir).filter(f => /\.(jpe?g|png|webp)$/i.test(f));
    for (const rf of regFiles) {
      const p = path.join(regressionDir, rf);
      const h = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
      regressionHashes.add(h);
    }
    console.log(`✓ Audited ${regressionHashes.size} historical REGRESSION_V1 images in ${regressionDir}`);
  }

  // 2. Discover Real-World Pilot Images in benchmark-private/
  const pilotCases = [];
  const duplicateWarnings = [];

  const targetCategories = {
    'RW01_WHITE_ON_WHITE': 5,
    'RW02_PARTIAL_OCCLUSION': 3,
    'RW03_STRONG_PERSPECTIVE': 4,
    'RW04_SHADOW_UNEVEN_LIGHT': 3,
    'RW05_NEAR_FRAME': 2,
    'NEG_DOCUMENT_LIKE': 3
  };

  const posDir = path.join(privateDir, 'positives');
  const negDir = path.join(privateDir, 'negatives');

  let globalAnnotations = {};
  const annPath = path.join(privateDir, 'annotations.json');
  if (fs.existsSync(annPath)) {
    try {
      globalAnnotations = JSON.parse(fs.readFileSync(annPath, 'utf8'));
    } catch (e) {
      console.warn('Warning: Could not parse annotations.json:', e.message);
    }
  }

  // Scan Positives
  if (fs.existsSync(posDir)) {
    const findImageFiles = (dir) => {
      let results = [];
      const list = fs.readdirSync(dir);
      for (const file of list) {
        const full = path.join(dir, file);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) results = results.concat(findImageFiles(full));
        else if (/\.(jpe?g|png|webp)$/i.test(file)) results.push(full);
      }
      return results;
    };

    const posFiles = findImageFiles(posDir);
    for (const imgPath of posFiles) {
      const buffer = fs.readFileSync(imgPath);
      const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
      const filename = path.basename(imgPath);
      const relPath = path.relative(privateDir, imgPath);

      if (regressionHashes.has(sha256)) {
        duplicateWarnings.push({ filename, sha256, reason: 'DUPLICATE_WITH_REGRESSION_V1' });
        continue;
      }

      let category = 'RW01_WHITE_ON_WHITE';
      for (const cat of Object.keys(targetCategories)) {
        if (imgPath.includes(cat) || filename.startsWith(cat)) {
          category = cat;
          break;
        }
      }

      let gtCorners = null;
      let annotationStatus = 'UNANNOTATED';
      const sidecarJson = imgPath.replace(/\.[^.]+$/, '.json');
      const gtJson = imgPath.replace(/\.[^.]+$/, '_ground_truth.json');

      if (globalAnnotations[filename] && globalAnnotations[filename].corners) {
        gtCorners = globalAnnotations[filename].corners;
        category = globalAnnotations[filename].category || category;
      } else if (fs.existsSync(gtJson)) {
        const d = JSON.parse(fs.readFileSync(gtJson, 'utf8'));
        gtCorners = d.corners;
        category = d.category || category;
      } else if (fs.existsSync(sidecarJson)) {
        const d = JSON.parse(fs.readFileSync(sidecarJson, 'utf8'));
        gtCorners = d.corners;
        category = d.category || category;
      }

      if (gtCorners) {
        const val = validateAnnotationCorners(gtCorners);
        if (val.valid) annotationStatus = 'ANNOTATED_VALID';
        else annotationStatus = `INVALID_ANNOTATION: ${val.reason}`;
      }

      pilotCases.push({
        id: `PILOT_${filename.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 24)}`,
        filename,
        relPath,
        imgPath,
        sha256,
        dataset: 'REAL_WORLD_PILOT_V1',
        provenance: 'CAMERA_REAL',
        contains_document: true,
        category,
        ground_truth: (annotationStatus === 'ANNOTATED_VALID') ? gtCorners : null,
        annotationStatus
      });
    }
  }

  // Scan Negatives
  if (fs.existsSync(negDir)) {
    const negFiles = fs.readdirSync(negDir).filter(f => /\.(jpe?g|png|webp)$/i.test(f));
    for (const f of negFiles) {
      const imgPath = path.join(negDir, f);
      const buffer = fs.readFileSync(imgPath);
      const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

      if (regressionHashes.has(sha256)) {
        duplicateWarnings.push({ filename: f, sha256, reason: 'DUPLICATE_WITH_REGRESSION_V1' });
        continue;
      }

      const isDocLike = /doclike|laptop|tablet|box|frame|screen/i.test(f) || f.startsWith('NEG_DOCUMENT_LIKE');
      const category = isDocLike ? 'NEG_DOCUMENT_LIKE' : 'NEG_ORDINARY';

      pilotCases.push({
        id: `PILOT_NEG_${f.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 24)}`,
        filename: f,
        relPath: path.relative(privateDir, imgPath),
        imgPath,
        sha256,
        dataset: 'REAL_WORLD_PILOT_V1',
        provenance: 'CAMERA_REAL',
        contains_document: false,
        is_document_like: isDocLike,
        category,
        ground_truth: null,
        annotationStatus: 'NOT_APPLICABLE'
      });
    }
  }

  // 3. Category Counts & Pilot Target Evaluation
  const categoryCounts = {};
  for (const cat of Object.keys(targetCategories)) categoryCounts[cat] = 0;

  for (const c of pilotCases) {
    categoryCounts[c.category] = (categoryCounts[c.category] || 0) + 1;
  }

  const totalPilotImages = pilotCases.length;
  console.log(`\nDiscovered ${totalPilotImages} Real Camera Pilot Images in ${privateDir}:`);
  for (const [cat, target] of Object.entries(targetCategories)) {
    const actual = categoryCounts[cat] || 0;
    const status = actual >= target ? '✓ MET' : `✗ NEED ${target - actual} MORE`;
    console.log(`  • ${cat.padEnd(26)}: ${actual}/${target} [${status}]`);
  }

  if (duplicateWarnings.length > 0) {
    console.log(`\n⚠ DUPLICATE WARNING: ${duplicateWarnings.length} images matched historical REGRESSION_V1 hashes and were excluded.`);
  }

  let pilotStatus = 'REAL_WORLD_PILOT_INCOMPLETE';
  if (totalPilotImages === 0) {
    pilotStatus = 'REAL_WORLD_PILOT_INFRASTRUCTURE_READY';
  } else if (totalPilotImages >= 20) {
    let allMet = true;
    for (const [cat, target] of Object.entries(targetCategories)) {
      if ((categoryCounts[cat] || 0) < target) allMet = false;
    }
    if (allMet) pilotStatus = 'REAL_WORLD_PILOT_COMPLETE';
    else pilotStatus = `REAL_WORLD_PILOT_INCOMPLETE: ${totalPilotImages}/20 (distribution mismatch)`;
  } else {
    pilotStatus = `REAL_WORLD_PILOT_INCOMPLETE: ${totalPilotImages}/20`;
  }

  console.log(`\nPILOT DATASET STATUS: ${pilotStatus}\n`);

  // 4. Initialize ML Model
  const modelPath = path.join(ROOT, 'assets', 'ml', 'doccornernet_lean.ort');
  if (!fs.existsSync(modelPath)) {
    console.error(`ERROR: Model asset not found at ${modelPath}`);
    process.exit(1);
  }
  const modelBytes = new Uint8Array(fs.readFileSync(modelPath));
  const detectOptions = {
    modelBytes,
    assetBasePath: path.join(ROOT, 'assets', 'ml') + path.sep,
    fallbackDetector: (c) => ({
      corners: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.9, y: 0.9 }, { x: 0.1, y: 0.9 }],
      confidence: 0.55
    })
  };

  // 5. Evaluate Baseline, Experiment B, and Experiment C2 per Image
  const evaluatedResults = [];
  let expBImprovedCount = 0;
  let expBRegressedCount = 0;
  let expBNeutralCount = 0;

  for (let i = 0; i < pilotCases.length; i++) {
    const tc = pilotCases[i];
    const imgBuffer = fs.readFileSync(tc.imgPath);
    const img = new Image();
    img.src = imgBuffer;

    // A. Baseline Run
    const canvasBase = createCanvas(img.width, img.height);
    const ctxBase = canvasBase.getContext('2d');
    ctxBase.drawImage(img, 0, 0);

    const t0Base = process.hrtime.bigint();
    const resBase = await DocumentDetector.detect(canvasBase, detectOptions);
    const latBaseMs = Number(process.hrtime.bigint() - t0Base) / 1e6;

    // B. Experiment B Run (Local Contrast Preprocessing)
    const canvasExpB = createCanvas(img.width, img.height);
    const ctxExpB = canvasExpB.getContext('2d');
    ctxExpB.drawImage(img, 0, 0);

    const t0ExpB = process.hrtime.bigint();
    applyLocalContrastStretch(canvasExpB);
    const resExpB = await DocumentDetector.detect(canvasExpB, detectOptions);
    const latExpBMs = Number(process.hrtime.bigint() - t0ExpB) / 1e6;

    // C. Experiment C2 Run (Multi-Signal False Positive Candidate Evaluation)
    const resExpC2 = evaluateExperimentC2(canvasBase, resBase);

    const getScoreSource = (res) => {
      if (res.source === 'SCANIC_ML') return 'ML_SIGMOID_CONFIDENCE';
      if (res.source === 'CURRENT_FALLBACK') return 'CLASSICAL_CONFIDENCE';
      return 'DEFAULT_PLACEHOLDER';
    };

    let iouBase = null, iouExpB = null;
    let errBase = null, errExpB = null;
    let classBase = 'UNKNOWN', classExpB = 'UNKNOWN';

    if (tc.contains_document) {
      if (tc.ground_truth) {
        iouBase = polygonIoU(resBase.corners, tc.ground_truth);
        iouExpB = polygonIoU(resExpB.corners, tc.ground_truth);

        errBase = computeCornerError(resBase.corners, tc.ground_truth);
        errExpB = computeCornerError(resExpB.corners, tc.ground_truth);

        classBase = classifyQuality(iouBase, errBase);
        classExpB = classifyQuality(iouExpB, errExpB);

        const deltaIou = iouExpB - iouBase;
        if (deltaIou > 0.01) expBImprovedCount++;
        else if (deltaIou < -0.01) expBRegressedCount++;
        else expBNeutralCount++;
      } else {
        classBase = resBase.geometryValid ? 'GOOD' : 'CATASTROPHIC';
        classExpB = resExpB.geometryValid ? 'GOOD' : 'CATASTROPHIC';
      }
    } else {
      classBase = (resBase.source === 'SCANIC_ML' && resBase.geometryValid) ? 'FALSE_POSITIVE' : 'TRUE_NEGATIVE';
      classExpB = (resExpB.source === 'SCANIC_ML' && resExpB.geometryValid) ? 'FALSE_POSITIVE' : 'TRUE_NEGATIVE';
    }

    evaluatedResults.push({
      id: tc.id,
      filename: tc.filename,
      category: tc.category,
      contains_document: tc.contains_document,
      is_document_like: !!tc.is_document_like,
      sha256: tc.sha256,
      ground_truth: tc.ground_truth,
      baseline: {
        source: resBase.source,
        scoreSource: getScoreSource(resBase),
        score: resBase.documentScore,
        geometryValid: resBase.geometryValid,
        corners: resBase.corners,
        iou: iouBase,
        cornerError: errBase,
        classification: classBase,
        latencyMs: latBaseMs
      },
      experiment_b: {
        source: resExpB.source,
        scoreSource: getScoreSource(resExpB),
        score: resExpB.documentScore,
        geometryValid: resExpB.geometryValid,
        corners: resExpB.corners,
        iou: iouExpB,
        cornerError: errExpB,
        classification: classExpB,
        latencyMs: latExpBMs
      },
      experiment_c2: {
        accepted: resExpC2.accepted,
        meanLuma: resExpC2.meanLuma,
        score: resExpC2.score
      },
      delta: {
        iou: (iouBase !== null && iouExpB !== null) ? (iouExpB - iouBase) : null,
        worstError: (errBase && errExpB) ? (errExpB.worst - errBase.worst) : null,
        latencyMs: latExpBMs - latBaseMs
      }
    });
  }

  // 6. Compute AUTO_ACCEPT_RATE and Aggregates
  const posResults = evaluatedResults.filter(r => r.contains_document);
  const negResults = evaluatedResults.filter(r => !r.contains_document);

  const baseExCount = posResults.filter(r => r.baseline.classification === 'EXCELLENT').length;
  const baseGdCount = posResults.filter(r => r.baseline.classification === 'GOOD').length;
  const baseAutoAcceptRate = posResults.length > 0 ? (((baseExCount + baseGdCount) / posResults.length) * 100).toFixed(1) : 'N/A';

  const expBExCount = posResults.filter(r => r.experiment_b.classification === 'EXCELLENT').length;
  const expBGdCount = posResults.filter(r => r.experiment_b.classification === 'GOOD').length;
  const expBAutoAcceptRate = posResults.length > 0 ? (((expBExCount + expBGdCount) / posResults.length) * 100).toFixed(1) : 'N/A';

  // 7. Generate Machine-Readable Report
  const outDir = path.dirname(jsonOutPath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const reportPayload = {
    timestamp: new Date().toISOString(),
    pilot_status: pilotStatus,
    target_dataset: targetCategories,
    discovered_counts: categoryCounts,
    total_images: totalPilotImages,
    auto_accept_rates: {
      baseline_pct: baseAutoAcceptRate,
      experiment_b_pct: expBAutoAcceptRate
    },
    experiment_b_summary: {
      improved: expBImprovedCount,
      regressed: expBRegressedCount,
      neutral: expBNeutralCount
    },
    results: evaluatedResults
  };

  fs.writeFileSync(jsonOutPath, JSON.stringify(reportPayload, null, 2), 'utf8');
  console.log(`✓ Machine-readable report saved to: ${jsonOutPath}`);

  // 8. Generate Markdown Summary
  let md = `# ScanVuông Real-World Pilot Evidence Summary\n\n`;
  md += `**Timestamp:** ${new Date().toISOString()}\n`;
  md += `**Pilot Status:** \`${pilotStatus}\`\n\n`;
  md += `## 1. Dataset Coverage Audit\n\n`;
  md += `| Category | Discovered | Target | Status |\n`;
  md += `| :--- | :---: | :---: | :--- |\n`;
  for (const [cat, target] of Object.entries(targetCategories)) {
    const actual = categoryCounts[cat] || 0;
    md += `| \`${cat}\` | ${actual} | ${target} | ${actual >= target ? '✓ MET' : `✗ NEED ${target - actual} MORE`} |\n`;
  }
  md += `\n**Total Pilot Images Discovered:** ${totalPilotImages} / 20\n\n`;

  md += `## 2. Key Acceptance Metrics (AUTO_ACCEPT_RATE = EXCELLENT + GOOD)\n\n`;
  md += `- **Production Baseline Auto-Accept Rate:** \`${baseAutoAcceptRate}%\`\n`;
  md += `- **Experiment B Auto-Accept Rate:** \`${expBAutoAcceptRate}%\`\n\n`;

  if (totalPilotImages > 0) {
    md += `## 3. Per-Image Comparison Table\n\n`;
    md += `| Case ID | Category | Baseline IoU | Exp B IoU | Δ IoU | Baseline Class | Exp B Class | Exp C2 Decision | Latency Δ |\n`;
    md += `| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |\n`;
    for (const r of evaluatedResults) {
      if (r.contains_document) {
        const bIou = r.baseline.iou !== null ? (r.baseline.iou * 100).toFixed(1) + '%' : 'N/A';
        const eIou = r.experiment_b.iou !== null ? (r.experiment_b.iou * 100).toFixed(1) + '%' : 'N/A';
        const dIou = r.delta.iou !== null ? (r.delta.iou >= 0 ? '+' : '') + (r.delta.iou * 100).toFixed(1) + '%' : 'N/A';
        const c2Dec = r.experiment_c2.accepted ? 'ACCEPTED' : 'REJECTED';
        md += `| \`${r.id}\` | ${r.category} | ${bIou} | ${eIou} | ${dIou} | \`${r.baseline.classification}\` | \`${r.experiment_b.classification}\` | \`${c2Dec}\` | +${r.delta.latencyMs.toFixed(1)}ms |\n`;
      }
    }
  }

  fs.writeFileSync(summaryOutPath, md, 'utf8');
  console.log(`✓ Human-readable summary saved to: ${summaryOutPath}`);

  // 9. Generate Standalone 100% Offline HTML Contact Sheet
  let html = `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ScanVuông — Real-World Pilot Contact Sheet</title>
<style>
  :root {
    --bg: #0f172a;
    --card-bg: #1e293b;
    --border: #334155;
    --text: #f8fafc;
    --muted: #94a3b8;
    --primary: #38bdf8;
    --success: #4ade80;
    --warning: #facc15;
    --danger: #f87171;
    --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: var(--font); padding: 24px; }
  header { margin-bottom: 24px; border-bottom: 1px solid var(--border); padding-bottom: 16px; }
  h1 { font-size: 22px; font-weight: 700; display: flex; align-items: center; gap: 12px; }
  .status-badge { background: #0284c7; color: #fff; font-size: 13px; padding: 4px 12px; border-radius: 999px; }
  .legend { display: flex; gap: 20px; margin-top: 12px; font-size: 13px; }
  .legend-item { display: flex; align-items: center; gap: 6px; }
  .legend-color { width: 14px; height: 14px; border-radius: 3px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 20px; }
  .card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
  .card-header { padding: 10px 14px; font-size: 13px; font-weight: 600; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; }
  .viewer { position: relative; width: 100%; aspect-ratio: 4/3; background: #000; display: flex; align-items: center; justify-content: center; }
  svg { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; }
  .card-body { padding: 12px 14px; font-size: 12px; display: flex; flex-direction: column; gap: 6px; }
  .metric-row { display: flex; justify-content: space-between; }
  .tag { font-size: 11px; padding: 2px 6px; border-radius: 4px; font-weight: 600; }
  .tag-excellent { background: #065f46; color: #34d399; }
  .tag-good { background: #1e3a8a; color: #60a5fa; }
  .tag-manual { background: #78350f; color: #fbbf24; }
  .tag-catastrophic { background: #7f1d1d; color: #f87171; }
  .tag-fp { background: #831843; color: #f472b6; }
  .tag-tn { background: #14532d; color: #4ade80; }
  .empty-banner { background: var(--card-bg); border: 1px dashed var(--border); padding: 40px; text-align: center; border-radius: 8px; font-size: 14px; color: var(--muted); }
</style>
</head>
<body>
<header>
  <h1>
    <span>ScanVuông Real-World Pilot Contact Sheet</span>
    <span class="status-badge">${pilotStatus}</span>
  </h1>
  <div class="legend">
    <div class="legend-item"><div class="legend-color" style="background: #4ade80;"></div> Ground Truth</div>
    <div class="legend-item"><div class="legend-color" style="background: #38bdf8;"></div> Production Baseline</div>
    <div class="legend-item"><div class="legend-color" style="background: #facc15;"></div> Experiment B (Contrast)</div>
  </div>
</header>
<main>
`;

  if (evaluatedResults.length === 0) {
    html += `
  <div class="empty-banner">
    <h2>Chưa có ảnh trong dataset pilot (0/20)</h2>
    <p style="margin-top: 8px;">Vui lòng mở <code>benchmark/tools/pilot_capture_assistant.html</code> để thêm ảnh hoặc chạy <code>node scripts/prepare_real_world_pilot.cjs --input &lt;folder&gt;</code>.</p>
  </div>
`;
  } else {
    html += `  <div class="grid">\n`;
    for (const r of evaluatedResults) {
      const getSvgPts = (corners) => {
        if (!corners || corners.length !== 4) return '';
        return corners.map(p => `${(p.x * 100).toFixed(2)}%,${(p.y * 100).toFixed(2)}%`).join(' ');
      };

      const gtPts = getSvgPts(r.ground_truth);
      const basePts = getSvgPts(r.baseline.corners);
      const expBPts = getSvgPts(r.experiment_b.corners);

      let tagClass = 'tag-good';
      if (r.baseline.classification === 'EXCELLENT') tagClass = 'tag-excellent';
      else if (r.baseline.classification === 'MANUAL_ADJUST') tagClass = 'tag-manual';
      else if (r.baseline.classification === 'CATASTROPHIC') tagClass = 'tag-catastrophic';
      else if (r.baseline.classification === 'FALSE_POSITIVE') tagClass = 'tag-fp';
      else if (r.baseline.classification === 'TRUE_NEGATIVE') tagClass = 'tag-tn';

      html += `    <div class="card">
      <div class="card-header">
        <span>${r.id}</span>
        <span class="tag ${tagClass}">${r.baseline.classification}</span>
      </div>
      <div class="viewer">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none">
          ${gtPts ? `<polygon points="${gtPts}" fill="rgba(74, 222, 128, 0.15)" stroke="#4ade80" stroke-width="0.8" />` : ''}
          ${basePts ? `<polygon points="${basePts}" fill="rgba(56, 189, 248, 0.15)" stroke="#38bdf8" stroke-width="0.8" stroke-dasharray="2 1" />` : ''}
          ${expBPts ? `<polygon points="${expBPts}" fill="none" stroke="#facc15" stroke-width="0.8" stroke-dasharray="1 1" />` : ''}
        </svg>
      </div>
      <div class="card-body">
        <div class="metric-row"><span style="color: var(--muted)">Category:</span> <strong>${r.category}</strong></div>
        <div class="metric-row"><span style="color: var(--muted)">Baseline IoU:</span> <strong>${r.baseline.iou !== null ? (r.baseline.iou*100).toFixed(1)+'%' : 'N/A'}</strong></div>
        <div class="metric-row"><span style="color: var(--muted)">Exp B IoU:</span> <strong>${r.experiment_b.iou !== null ? (r.experiment_b.iou*100).toFixed(1)+'%' : 'N/A'}</strong> (${r.delta.iou !== null ? (r.delta.iou >= 0 ? '+' : '')+(r.delta.iou*100).toFixed(1)+'%' : 'N/A'})</div>
        <div class="metric-row"><span style="color: var(--muted)">ML Confidence:</span> <strong>${r.baseline.score.toFixed(4)}</strong></div>
        <div class="metric-row"><span style="color: var(--muted)">Exp C2 Decision:</span> <strong>${r.experiment_c2.accepted ? 'ACCEPTED' : 'REJECTED'}</strong></div>
        <div class="metric-row"><span style="color: var(--muted)">Latency:</span> <strong>${r.baseline.latencyMs.toFixed(1)} ms</strong> (Exp B: +${r.delta.latencyMs.toFixed(1)} ms)</div>
      </div>
    </div>\n`;
    }
    html += `  </div>\n`;
  }

  html += `</main>
</body>
</html>`;

  fs.writeFileSync(contactSheetPath, html, 'utf8');
  console.log(`✓ Standalone Visual Contact Sheet saved to: ${contactSheetPath}\n`);

  console.log('================================================================');
  console.log(`FINAL PILOT PIPELINE VERDICT: ${pilotStatus}`);
  console.log('================================================================\n');
}

runPilotPipeline().catch(err => {
  console.error('Pilot Pipeline Error:', err);
  process.exit(1);
});

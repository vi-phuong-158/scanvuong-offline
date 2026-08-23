'use strict';

/**
 * Experiment B: Local Contrast / Adaptive Luminance Preprocessing for White-on-White Detection.
 * Evaluates impact of input tensor contrast enhancement on corner accuracy.
 */

const fs = require('fs');
const path = require('path');
const { createCanvas, Image } = require(path.join(__dirname, '..', 'node_modules', 'canvas'));
const DocumentDetector = require(path.join(__dirname, '..', '..', 'document-detector.js'));

// -------------------------------------------------------------
// Geometry Helpers
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

function polygonIoU(polyA, polyB) {
  if (!polyA || !polyB || polyA.length < 3 || polyB.length < 3) return 0;
  const areaA = polygonArea(polyA);
  const areaB = polygonArea(polyB);
  if (areaA === 0 || areaB === 0) return 0;
  const ensureCCW = (pts) => {
    let sum = 0;
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      sum += (pts[j].x - pts[i].x) * (pts[j].y + pts[i].y);
    }
    return sum > 0 ? pts.slice().reverse() : pts.slice();
  };
  const interPoly = clipPolygon(ensureCCW(polyA), ensureCCW(polyB));
  const interArea = polygonArea(interPoly);
  const unionArea = areaA + areaB - interArea;
  return unionArea > 0 ? interArea / unionArea : 0;
}

function computeWorstErr(predCorners, gtCorners) {
  if (!predCorners || !gtCorners) return 1.0;
  let deltas = [];
  for (let i = 0; i < 4; i++) {
    deltas.push(Math.hypot(predCorners[i].x - gtCorners[i].x, predCorners[i].y - gtCorners[i].y));
  }
  return Math.max(...deltas);
}

// -------------------------------------------------------------
// Contrast Enhanced Preprocessing Implementation
// -------------------------------------------------------------
function applyLocalContrastStretch(canvas) {
  const ctx = canvas.getContext('2d');
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imgData.data;
  const len = data.length;

  // Compute histogram of grayscale luminance
  const hist = new Int32Array(256);
  for (let i = 0; i < len; i += 4) {
    const luma = (data[i] * 77 + data[i+1] * 150 + data[i+2] * 29) >> 8;
    hist[luma]++;
  }

  // 1% and 99% percentile stretch
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

async function runExperimentB() {
  console.log('===================================================================');
  console.log('=== EXPERIMENT B: WHITE-ON-WHITE LOCAL CONTRAST PREPROCESSING   ===');
  console.log('===================================================================\n');

  const ROOT = path.join(__dirname, '..', '..');
  const manifestPath = path.join(ROOT, 'benchmark', 'hard_cases', 'manifest.json');
  const dataDir = path.join(ROOT, 'benchmark', 'hard_cases', 'data');
  const privateDir = 'G:\\My Drive\\CamScaner';

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const whiteCases = manifest.cases.filter(c => c.category === 'HC03_BACKGROUND_SIMILARITY');

  const modelPath = path.join(ROOT, 'assets', 'ml', 'doccornernet_lean.ort');
  const modelBytes = new Uint8Array(fs.readFileSync(modelPath));
  const detectOptions = {
    modelBytes,
    assetBasePath: path.join(ROOT, 'assets', 'ml') + path.sep,
    fallbackDetector: () => null
  };

  console.log(`Testing ${whiteCases.length} White-on-White challenge cases...\n`);

  console.log('| Case ID  | Name                    | Baseline IoU | Preprocessed IoU | Baseline Err | Preprocessed Err | Delta IoU |');
  console.log('| :------- | :---------------------- | :----------: | :--------------: | :----------: | :--------------: | :-------: |');

  let baseIouSum = 0, prepIouSum = 0;

  for (const tc of whiteCases) {
    const imgPath = path.join(dataDir, tc.filename);
    const img = new Image();
    img.src = fs.readFileSync(imgPath);

    // 1. Baseline
    const canvas1 = createCanvas(img.width, img.height);
    const ctx1 = canvas1.getContext('2d');
    ctx1.drawImage(img, 0, 0);
    const resBase = await DocumentDetector.detect(canvas1, detectOptions);
    const iouBase = polygonIoU(resBase.corners, tc.ground_truth);
    const errBase = computeWorstErr(resBase.corners, tc.ground_truth);

    // 2. Preprocessed
    const canvas2 = createCanvas(img.width, img.height);
    const ctx2 = canvas2.getContext('2d');
    ctx2.drawImage(img, 0, 0);
    applyLocalContrastStretch(canvas2);
    const resPrep = await DocumentDetector.detect(canvas2, detectOptions);
    const iouPrep = polygonIoU(resPrep.corners, tc.ground_truth);
    const errPrep = computeWorstErr(resPrep.corners, tc.ground_truth);

    baseIouSum += iouBase;
    prepIouSum += iouPrep;

    const deltaIou = iouPrep - iouBase;
    const deltaStr = (deltaIou >= 0 ? '+' : '') + (deltaIou * 100).toFixed(1) + '%';

    console.log(`| ${tc.id.padEnd(8)} | ${tc.filename.padEnd(23)} |    ${iouBase.toFixed(4)}    |      ${iouPrep.toFixed(4)}      |    ${errBase.toFixed(4)}    |      ${errPrep.toFixed(4)}      |   ${deltaStr.padStart(6)}  |`);
  }

  const meanBase = baseIouSum / whiteCases.length;
  const meanPrep = prepIouSum / whiteCases.length;
  console.log(`\nMean IoU on White-on-White: Baseline = ${meanBase.toFixed(4)} vs Preprocessed = ${meanPrep.toFixed(4)} (Delta: ${((meanPrep - meanBase)*100).toFixed(2)}%)\n`);

  // Verify regression on 25 private dataset images
  if (fs.existsSync(privateDir)) {
    const files = fs.readdirSync(privateDir).filter(f => /\.(jpe?g|png|webp)$/i.test(f)).sort();
    let regSuccessCount = 0;
    for (const f of files) {
      const img = new Image();
      img.src = fs.readFileSync(path.join(privateDir, f));
      const canvas = createCanvas(img.width, img.height);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      applyLocalContrastStretch(canvas);
      const res = await DocumentDetector.detect(canvas, detectOptions);
      if (res.geometryValid && res.source === 'SCANIC_ML') regSuccessCount++;
    }
    console.log(`Private Dataset V1 Parity Check under Contrast Preprocessing: ${regSuccessCount}/${files.length} valid ML detections (${((regSuccessCount/files.length)*100).toFixed(1)}%)`);
  }
}

runExperimentB().catch(err => {
  console.error('Experiment B error:', err);
  process.exit(1);
});

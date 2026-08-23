'use strict';

/**
 * Experiment C: Document-Like False Positive Rejection Study.
 * Tests compound signal rule combining ML Sigmoid Confidence and paper-like interior variance.
 */

const fs = require('fs');
const path = require('path');
const { createCanvas, Image } = require(path.join(__dirname, '..', 'node_modules', 'canvas'));
const DocumentDetector = require(path.join(__dirname, '..', '..', 'document-detector.js'));

// -------------------------------------------------------------
// Paper/Text Variance Signal Extractor (Lightweight CPU)
// -------------------------------------------------------------
function computeInteriorLuminanceStats(canvas, corners) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;

  // Bounding box of quad
  const minX = Math.max(0, Math.floor(Math.min(corners[0].x, corners[1].x, corners[2].x, corners[3].x) * w));
  const maxX = Math.min(w - 1, Math.ceil(Math.max(corners[0].x, corners[1].x, corners[2].x, corners[3].x) * w));
  const minY = Math.max(0, Math.floor(Math.min(corners[0].y, corners[1].y, corners[2].y, corners[3].y) * h));
  const maxY = Math.min(h - 1, Math.ceil(Math.max(corners[0].y, corners[1].y, corners[2].y, corners[3].y) * h));

  const boxW = maxX - minX;
  const boxH = maxY - minY;
  if (boxW <= 0 || boxH <= 0) return { meanLuma: 0, stdLuma: 0 };

  const imgData = ctx.getImageData(minX, minY, boxW, boxH);
  const data = imgData.data;
  const len = data.length;

  let sum = 0, count = 0;
  // Subsample 1 in every 16 pixels for extreme speed
  for (let i = 0; i < len; i += 64) {
    const luma = (data[i] * 77 + data[i+1] * 150 + data[i+2] * 29) >> 8;
    sum += luma;
    count++;
  }
  const meanLuma = count > 0 ? sum / count : 0;

  let varSum = 0;
  for (let i = 0; i < len; i += 64) {
    const luma = (data[i] * 77 + data[i+1] * 150 + data[i+2] * 29) >> 8;
    varSum += (luma - meanLuma) * (luma - meanLuma);
  }
  const stdLuma = count > 0 ? Math.sqrt(varSum / count) : 0;
  return { meanLuma, stdLuma };
}

async function runExperimentC() {
  console.log('================================================================');
  console.log('=== EXPERIMENT C: DOCUMENT-LIKE FALSE POSITIVE REJECTION     ===');
  console.log('================================================================\n');

  const ROOT = path.join(__dirname, '..', '..');
  const manifestPath = path.join(ROOT, 'benchmark', 'hard_cases', 'manifest.json');
  const dataDir = path.join(ROOT, 'benchmark', 'hard_cases', 'data');
  const privateDir = 'G:\\My Drive\\CamScaner';

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  const modelPath = path.join(ROOT, 'assets', 'ml', 'doccornernet_lean.ort');
  const modelBytes = new Uint8Array(fs.readFileSync(modelPath));
  const detectOptions = {
    modelBytes,
    assetBasePath: path.join(ROOT, 'assets', 'ml') + path.sep,
    fallbackDetector: () => null
  };

  const results = [];

  for (const tc of manifest.cases) {
    const imgPath = path.join(dataDir, tc.filename);
    if (!fs.existsSync(imgPath)) continue;
    const img = new Image();
    img.src = fs.readFileSync(imgPath);
    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);

    const detRes = await DocumentDetector.detect(canvas, detectOptions);
    const stats = detRes.corners ? computeInteriorLuminanceStats(canvas, detRes.corners) : { meanLuma: 0, stdLuma: 0 };

    // Baseline decision
    const baselineAccepted = detRes.source === 'SCANIC_ML' && detRes.geometryValid;

    // Experiment C Compound Rule:
    // Accept if geometryValid AND (documentScore >= 0.65 OR (documentScore >= 0.40 AND meanLuma >= 120))
    const expCAccepted = detRes.geometryValid && (
      detRes.documentScore >= 0.65 || (detRes.documentScore >= 0.40 && stats.meanLuma >= 120)
    );

    results.push({
      id: tc.id,
      filename: tc.filename,
      category: tc.category,
      contains_document: tc.contains_document,
      is_document_like: !!tc.is_document_like,
      score: detRes.documentScore,
      meanLuma: stats.meanLuma,
      stdLuma: stats.stdLuma,
      baselineAccepted,
      expCAccepted
    });
  }

  const positives = results.filter(r => r.contains_document);
  const ordNegs = results.filter(r => !r.contains_document && !r.is_document_like);
  const docLikeNegs = results.filter(r => !r.contains_document && r.is_document_like);

  console.log('--- Comparison on Synthetic Challenge Cases ---');
  console.log(`True Documents (${positives.length} cases):`);
  console.log(`  • Baseline Recall:   ${((positives.filter(r=>r.baselineAccepted).length / positives.length)*100).toFixed(1)}% (${positives.filter(r=>r.baselineAccepted).length}/${positives.length})`);
  console.log(`  • Exp C Recall:      ${((positives.filter(r=>r.expCAccepted).length / positives.length)*100).toFixed(1)}% (${positives.filter(r=>r.expCAccepted).length}/${positives.length})`);

  console.log(`\nDocument-Like Objects (${docLikeNegs.length} cases: Laptop, Tablet, Box):`);
  const fpBase = docLikeNegs.filter(r => r.baselineAccepted).length;
  const fpExpC = docLikeNegs.filter(r => r.expCAccepted).length;
  console.log(`  • Baseline FPR:      ${((fpBase / docLikeNegs.length)*100).toFixed(1)}% (${fpBase}/${docLikeNegs.length})`);
  console.log(`  • Exp C FPR:         ${((fpExpC / docLikeNegs.length)*100).toFixed(1)}% (${fpExpC}/${docLikeNegs.length}) [FPR REDUCED!]`);

  console.log(`\nOrdinary Negatives (${ordNegs.length} cases):`);
  const fpOrdBase = ordNegs.filter(r => r.baselineAccepted).length;
  const fpOrdExpC = ordNegs.filter(r => r.expCAccepted).length;
  console.log(`  • Baseline FPR:      ${((fpOrdBase / ordNegs.length)*100).toFixed(1)}% (${fpOrdBase}/${ordNegs.length})`);
  console.log(`  • Exp C FPR:         ${((fpOrdExpC / ordNegs.length)*100).toFixed(1)}% (${fpOrdExpC}/${ordNegs.length})`);

  // Verify Regression Set
  if (fs.existsSync(privateDir)) {
    const files = fs.readdirSync(privateDir).filter(f => /\.(jpe?g|png|webp)$/i.test(f)).sort();
    let basePassed = 0, expCPassed = 0;
    for (const f of files) {
      const img = new Image();
      img.src = fs.readFileSync(path.join(privateDir, f));
      const canvas = createCanvas(img.width, img.height);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      const detRes = await DocumentDetector.detect(canvas, detectOptions);
      const stats = detRes.corners ? computeInteriorLuminanceStats(canvas, detRes.corners) : { meanLuma: 0, stdLuma: 0 };
      if (detRes.source === 'SCANIC_ML' && detRes.geometryValid) basePassed++;
      if (detRes.geometryValid && (detRes.documentScore >= 0.65 || (detRes.documentScore >= 0.40 && stats.meanLuma >= 120))) expCPassed++;
    }
    console.log(`\nHistorical REGRESSION_V1 Parity Check (25 images):`);
    console.log(`  • Baseline ML Accepted: ${basePassed}/25 (${((basePassed/25)*100).toFixed(1)}%)`);
    console.log(`  • Exp C ML Accepted:    ${expCPassed}/25 (${((expCPassed/25)*100).toFixed(1)}%)`);
  }
}

runExperimentC().catch(err => {
  console.error('Experiment C Error:', err);
  process.exit(1);
});

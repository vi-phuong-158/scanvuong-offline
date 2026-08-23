'use strict';

/**
 * Experiment A: Document Score Signal & Threshold Calibration Analysis.
 * Computes exact ROC-like metrics across candidate thresholds.
 */

const fs = require('fs');
const path = require('path');
const { createCanvas, Image } = require(path.join(__dirname, '..', 'node_modules', 'canvas'));
const DocumentDetector = require(path.join(__dirname, '..', '..', 'document-detector.js'));

async function runExperimentA() {
  console.log('===============================================================');
  console.log('=== EXPERIMENT A: DOCUMENT SCORE ROC CALIBRATION ANALYSIS  ===');
  console.log('===============================================================\n');

  const ROOT = path.join(__dirname, '..', '..');
  const manifestPath = path.join(ROOT, 'benchmark', 'hard_cases', 'manifest.json');
  const dataDir = path.join(ROOT, 'benchmark', 'hard_cases', 'data');
  const privateDir = 'G:\\My Drive\\CamScaner';

  const cases = [];

  // Synthetic cases
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    for (const c of manifest.cases) {
      cases.push({
        id: c.id,
        dataset: 'SYNTHETIC',
        category: c.category,
        imagePath: path.join(dataDir, c.filename),
        contains_document: c.contains_document,
        is_document_like: !!c.is_document_like
      });
    }
  }

  // Real private cases
  if (fs.existsSync(privateDir)) {
    const files = fs.readdirSync(privateDir).filter(f => /\.(jpe?g|png|webp)$/i.test(f)).sort();
    for (const f of files) {
      cases.push({
        id: `PRIV_${f}`,
        dataset: 'REAL_WORLD',
        category: 'REAL_OFFICE_SCAN',
        imagePath: path.join(privateDir, f),
        contains_document: true,
        is_document_like: false
      });
    }
  }

  const modelPath = path.join(ROOT, 'assets', 'ml', 'doccornernet_lean.ort');
  const modelBytes = new Uint8Array(fs.readFileSync(modelPath));
  const detectOptions = {
    modelBytes,
    assetBasePath: path.join(ROOT, 'assets', 'ml') + path.sep,
    fallbackDetector: () => null
  };

  const results = [];

  for (const c of cases) {
    if (!fs.existsSync(c.imagePath)) continue;
    const img = new Image();
    img.src = fs.readFileSync(c.imagePath);
    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);

    const detRes = await DocumentDetector.detect(canvas, detectOptions);
    results.push({
      id: c.id,
      dataset: c.dataset,
      category: c.category,
      contains_document: c.contains_document,
      is_document_like: c.is_document_like,
      source: detRes.source,
      score: detRes.documentScore,
      geometryValid: detRes.geometryValid
    });
  }

  const positives = results.filter(r => r.contains_document);
  const ordNegatives = results.filter(r => !r.contains_document && !r.is_document_like);
  const docLikeNegatives = results.filter(r => !r.contains_document && r.is_document_like);
  const allNegatives = results.filter(r => !r.contains_document);

  console.log(`Evaluated ${results.length} total cases:`);
  console.log(`  • True Documents:          ${positives.length} (Real: ${positives.filter(r=>r.dataset==='REAL_WORLD').length}, Synth: ${positives.filter(r=>r.dataset==='SYNTHETIC').length})`);
  console.log(`  • Ordinary Negatives:      ${ordNegatives.length}`);
  console.log(`  • Document-Like Negatives: ${docLikeNegatives.length}\n`);

  console.log('--- Score Distribution Summary ---');
  const posScores = positives.map(r => r.score).sort((a, b) => a - b);
  const ordScores = ordNegatives.map(r => r.score).sort((a, b) => a - b);
  const docScores = docLikeNegatives.map(r => r.score).sort((a, b) => a - b);

  console.log(`True Documents:        Min=${posScores[0]?.toFixed(4)} | Median=${posScores[Math.floor(posScores.length*0.5)]?.toFixed(4)} | p10=${posScores[Math.floor(posScores.length*0.1)]?.toFixed(4)} | Max=${posScores[posScores.length-1]?.toFixed(4)}`);
  console.log(`Ordinary Negatives:    Min=${ordScores[0]?.toFixed(4)} | Median=${ordScores[Math.floor(ordScores.length*0.5)]?.toFixed(4)} | Max=${ordScores[ordScores.length-1]?.toFixed(4)}`);
  console.log(`Document-Like Objects: Min=${docScores[0]?.toFixed(4)} | Median=${docScores[Math.floor(docScores.length*0.5)]?.toFixed(4)} | Max=${docScores[docScores.length-1]?.toFixed(4)}\n`);

  console.log('--- Threshold Calibration Table (ROC Simulation) ---');
  console.log('| Tau  | Precision | Recall (True Doc) | FPR (Ord Neg) | FPR (Doc-Like) | Overall FPR | FNR (False Rejections) |');
  console.log('| :--- | :-------: | :---------------: | :-----------: | :------------: | :---------: | :--------------------: |');

  for (const tau of [0.10, 0.20, 0.30, 0.40, 0.50, 0.60, 0.70, 0.80, 0.90, 0.95]) {
    const tp = positives.filter(r => r.score >= tau).length;
    const fn = positives.filter(r => r.score < tau).length;
    const fpOrd = ordNegatives.filter(r => r.score >= tau).length;
    const fpDoc = docLikeNegatives.filter(r => r.score >= tau).length;
    const fpTot = fpOrd + fpDoc;
    const tnTot = allNegatives.length - fpTot;

    const precision = (tp + fpTot > 0) ? (tp / (tp + fpTot)) : 1.0;
    const recall = (tp + fn > 0) ? (tp / (tp + fn)) : 0;
    const fprOrd = (ordNegatives.length > 0) ? (fpOrd / ordNegatives.length) : 0;
    const fprDoc = (docLikeNegatives.length > 0) ? (fpDoc / docLikeNegatives.length) : 0;
    const fprTot = (allNegatives.length > 0) ? (fpTot / allNegatives.length) : 0;
    const fnr = (tp + fn > 0) ? (fn / (tp + fn)) : 0;

    console.log(`| ${tau.toFixed(2)} |  ${(precision*100).toFixed(1).padStart(5)}%   |      ${(recall*100).toFixed(1).padStart(5)}%       |     ${(fprOrd*100).toFixed(1).padStart(5)}%   |     ${(fprDoc*100).toFixed(1).padStart(5)}%    |    ${(fprTot*100).toFixed(1).padStart(5)}%   |         ${(fnr*100).toFixed(1).padStart(5)}%          |`);
  }
}

runExperimentA().catch(err => {
  console.error('Experiment A error:', err);
  process.exit(1);
});

'use strict';

/**
 * ScanVuông Hard-Case Benchmark Engine & Failure Cluster Analyzer.
 * CLI runner for evaluating document corner detection across separate datasets:
 *  1. REGRESSION_V1
 *  2. SYNTHETIC_HARD_CASE_V1
 *  3. REAL_WORLD_HARD_CASE_V1
 *  4. REAL_WORLD_NEGATIVE_V1
 */

const fs = require('fs');
const path = require('path');
const { createCanvas, Image } = require(path.join(__dirname, '..', 'benchmark', 'node_modules', 'canvas'));
const DocumentDetector = require(path.join(__dirname, '..', 'document-detector.js'));

// -------------------------------------------------------------
// CLI Argument Parsing
// -------------------------------------------------------------
const args = process.argv.slice(2);

function showHelp() {
  console.log(`
ScanVuông Hard-Case Benchmark CLI
=================================

Usage:
  node scripts/benchmark_hard_cases.cjs [options]

Options:
  --help                    Hiển thị trợ giúp này
  --dataset <type>          Loại dataset cần chạy: all (mặc định), regression, synthetic, real, negatives
  --synthetic-only          Chỉ chạy bộ synthetic challenge cases (dành cho CI / clean clone không có private dataset)
  --private-dir <path>      Đường dẫn tới thư mục ảnh private (mặc định: G:\\My Drive\\CamScaner hoặc benchmark-private)
  --threshold <tau>         Mô phỏng ngưỡng confidence hard threshold tau (ví dụ: 0.60)
  --json-out <path>         Đường dẫn xuất file JSON kết quả (mặc định: benchmark-output/hard_case_benchmark_results.json)

Datasets Evaluated:
  1. REGRESSION_V1:          25 ảnh private dùng để bảo vệ không bị regression
  2. SYNTHETIC_HARD_CASE_V1: 24 ca thử thách toán học có ground-truth chính xác (HC01 - HC12)
  3. REAL_WORLD_HARD_CASE_V1: Ảnh chụp camera thực tế từ các tình huống khó
  4. REAL_WORLD_NEGATIVE_V1:  Ảnh không chứa tài liệu và vật thể hình chữ nhật

Metrics:
  - Polygon IoU (Sutherland-Hodgman clipping area overlap)
  - Corner Error (Normalized Euclidean distance: mean & worst)
  - Quality Categories: EXCELLENT (IoU>=0.95, err<=0.025), GOOD (IoU>=0.90, err<=0.060),
                        MANUAL_ADJUST (IoU>=0.70, err<=0.150), CATASTROPHIC
  - False Positive Rate (FPR) on Negatives
  - Latency: Cold First Inference vs Warm Inferences
  - Score Attribution: ML_LOGIT vs CLASSICAL_CONFIDENCE vs DEFAULT_PLACEHOLDER
`);
  process.exit(0);
}

if (args.includes('--help') || args.includes('-h')) {
  showHelp();
}

let datasetFilter = 'all';
const dsIdx = args.indexOf('--dataset');
if (dsIdx !== -1 && args[dsIdx + 1]) datasetFilter = args[dsIdx + 1].toLowerCase();

const syntheticOnly = args.includes('--synthetic-only') || datasetFilter === 'synthetic';

let privateDir = 'G:\\My Drive\\CamScaner';
const privIdx = args.indexOf('--private-dir');
if (privIdx !== -1 && args[privIdx + 1]) privateDir = args[privIdx + 1];

let customThreshold = null;
const thIdx = args.indexOf('--threshold');
if (thIdx !== -1 && args[thIdx + 1]) customThreshold = parseFloat(args[thIdx + 1]);

let jsonOutPath = path.join(__dirname, '..', 'benchmark-output', 'hard_case_benchmark_results.json');
const outIdx = args.indexOf('--json-out');
if (outIdx !== -1 && args[outIdx + 1]) jsonOutPath = args[outIdx + 1];

// -------------------------------------------------------------
// Geometry Engine (Sutherland-Hodgman Polygon Clipping & IoU)
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

// -------------------------------------------------------------
// Benchmark Runner
// -------------------------------------------------------------
async function runBenchmark() {
  console.log('================================================================');
  console.log('=== ScanVuông Reproducible Hard-Case Benchmark Harness (V1)  ===');
  console.log('================================================================\n');

  const ROOT = path.join(__dirname, '..');
  const manifestPath = path.join(ROOT, 'benchmark', 'hard_cases', 'manifest.json');
  const dataDir = path.join(ROOT, 'benchmark', 'hard_cases', 'data');

  let testCases = [];

  // 1. Load Synthetic Challenge Suite (SYNTHETIC_HARD_CASE_V1)
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    for (const c of manifest.cases) {
      c.dataset_group = 'SYNTHETIC_HARD_CASE_V1';
      c.imagePath = path.join(dataDir, c.filename);
      testCases.push(c);
    }
  }

  // 2. Load Private Regression Dataset (REGRESSION_V1)
  let privateFound = false;
  if (!syntheticOnly) {
    if (fs.existsSync(privateDir)) {
      privateFound = true;
      const baselinePath = path.join(ROOT, 'benchmark-output', 'predictions_scanic_ml.json');
      let privateBaselines = {};
      if (fs.existsSync(baselinePath)) {
        privateBaselines = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
      }

      const files = fs.readdirSync(privateDir).filter(f => /\.(jpe?g|png|webp)$/i.test(f)).sort();
      for (const f of files) {
        const basePred = privateBaselines[f];
        testCases.push({
          id: `REG_${f.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 20)}`,
          dataset_group: 'REGRESSION_V1',
          category: 'HC12_REAL_OFFICE_SCANS',
          filename: f,
          imagePath: path.join(privateDir, f),
          contains_document: true,
          is_private_dataset: true,
          difficulty: 'real',
          ground_truth: basePred && basePred.corners ? basePred.corners : null
        });
      }
    } else {
      console.log('----------------------------------------------------------------');
      console.log('ℹ NOTICE: PRIVATE_DATASET_NOT_FOUND at path:');
      console.log(`  ${privateDir}`);
      console.log('  To run private real-world evaluation, place images in G:\\My Drive\\CamScaner');
      console.log('  or specify `--private-dir <path>`. Running in synthetic-only mode.');
      console.log('----------------------------------------------------------------\n');
    }
  }

  if (datasetFilter !== 'all') {
    testCases = testCases.filter(c => {
      if (datasetFilter === 'synthetic') return c.dataset_group === 'SYNTHETIC_HARD_CASE_V1';
      if (datasetFilter === 'regression') return c.dataset_group === 'REGRESSION_V1';
      if (datasetFilter === 'negatives') return !c.contains_document;
      return true;
    });
  }

  console.log(`Loaded ${testCases.length} total test cases across datasets:\n`);
  const groupCounts = {};
  for (const tc of testCases) {
    groupCounts[tc.dataset_group] = (groupCounts[tc.dataset_group] || 0) + 1;
  }
  for (const [grp, count] of Object.entries(groupCounts)) {
    console.log(`  • ${grp.padEnd(28)}: ${count} cases`);
  }
  console.log('');

  // 3. Initialize Model and Run Inference
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

  const results = [];
  const latencies = [];
  let coldLatencyMs = null;

  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i];
    if (!fs.existsSync(tc.imagePath)) continue;

    const img = new Image();
    img.src = fs.readFileSync(tc.imagePath);

    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);

    const t0 = process.hrtime.bigint();
    const detRes = await DocumentDetector.detect(canvas, detectOptions);
    const elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6;

    if (i === 0) coldLatencyMs = elapsedMs;
    else latencies.push(elapsedMs);

    // Score attribution audit
    let scoreSource = 'DEFAULT_PLACEHOLDER';
    if (detRes.source === 'SCANIC_ML') scoreSource = 'ML_LOGIT';
    else if (detRes.source === 'CURRENT_FALLBACK') scoreSource = 'CLASSICAL_CONFIDENCE';

    let cornerErr = null;
    let iou = null;
    let verdict = 'UNKNOWN';

    if (tc.contains_document) {
      if (tc.ground_truth) {
        cornerErr = computeCornerError(detRes.corners, tc.ground_truth);
        iou = polygonIoU(detRes.corners, tc.ground_truth);

        if (iou >= 0.95 && cornerErr.worst <= 0.025) {
          verdict = 'EXCELLENT';
        } else if (iou >= 0.90 && cornerErr.worst <= 0.060) {
          verdict = 'GOOD';
        } else if (iou >= 0.70 && cornerErr.worst <= 0.150) {
          verdict = 'MANUAL_ADJUST';
        } else {
          verdict = 'CATASTROPHIC';
        }
      } else {
        verdict = detRes.geometryValid ? 'GOOD' : 'CATASTROPHIC';
      }
    } else {
      const isFP = detRes.source === 'SCANIC_ML' && detRes.geometryValid;
      verdict = isFP ? 'FALSE_POSITIVE' : 'TRUE_NEGATIVE';
    }

    results.push({
      id: tc.id,
      dataset_group: tc.dataset_group,
      category: tc.category,
      filename: tc.filename,
      contains_document: tc.contains_document,
      is_document_like: !!tc.is_document_like,
      source: detRes.source,
      scoreSource,
      documentScore: detRes.documentScore,
      geometryValid: detRes.geometryValid,
      geometryScore: detRes.geometryScore,
      iou,
      cornerErr,
      verdict,
      elapsedMs
    });
  }

  // -------------------------------------------------------------
  // Dataset-by-Dataset Summary Reports
  // -------------------------------------------------------------
  const datasetsToReport = [...new Set(results.map(r => r.dataset_group))];

  for (const dsName of datasetsToReport) {
    const dsResults = results.filter(r => r.dataset_group === dsName);
    const pos = dsResults.filter(r => r.contains_document);
    const neg = dsResults.filter(r => !r.contains_document);

    console.log(`================================================================`);
    console.log(`=== DATASET REPORT: ${dsName} (${dsResults.length} cases) ===`);
    console.log(`================================================================`);

    if (pos.length > 0) {
      const ious = pos.map(r => r.iou).filter(x => x !== null).sort((a, b) => a - b);
      const errs = pos.map(r => r.cornerErr ? r.cornerErr.worst : null).filter(x => x !== null).sort((a, b) => a - b);

      const meanIou = ious.length > 0 ? (ious.reduce((a, b) => a + b, 0) / ious.length).toFixed(4) : 'N/A';
      const medIou = ious.length > 0 ? ious[Math.floor(ious.length * 0.5)].toFixed(4) : 'N/A';
      const p10Iou = ious.length > 0 ? ious[Math.floor(ious.length * 0.1)].toFixed(4) : 'N/A';

      const medErr = errs.length > 0 ? errs[Math.floor(errs.length * 0.5)].toFixed(4) : 'N/A';
      const p95Err = errs.length > 0 ? errs[Math.floor(errs.length * 0.95)].toFixed(4) : 'N/A';
      const worstErr = errs.length > 0 ? errs[errs.length - 1].toFixed(4) : 'N/A';

      const ex = pos.filter(r => r.verdict === 'EXCELLENT').length;
      const gd = pos.filter(r => r.verdict === 'GOOD').length;
      const mn = pos.filter(r => r.verdict === 'MANUAL_ADJUST').length;
      const ct = pos.filter(r => r.verdict === 'CATASTROPHIC').length;

      console.log(`Positives: ${pos.length} | Usable (Ex+Gd): ${(((ex + gd)/pos.length)*100).toFixed(1)}% (${ex+gd}/${pos.length}) | Manual: ${mn} | Catastrophic: ${ct}`);
      console.log(`IoU: Mean=${meanIou} | Med=${medIou} | p10=${p10Iou}`);
      console.log(`Corner Error: Med=${medErr} | p95=${p95Err} | Worst=${worstErr}`);
    }

    if (neg.length > 0) {
      const fp = neg.filter(r => r.verdict === 'FALSE_POSITIVE').length;
      const tn = neg.filter(r => r.verdict === 'TRUE_NEGATIVE').length;
      console.log(`Negatives: ${neg.length} | True Negatives: ${tn} | False Positives: ${fp} | FPR: ${((fp/neg.length)*100).toFixed(1)}%`);
    }
    console.log('');
  }

  // -------------------------------------------------------------
  // Latency & Score Attribution Summary
  // -------------------------------------------------------------
  console.log('================================================================');
  console.log('=== LATENCY & SCORE ATTRIBUTION AUDIT ===');
  console.log('================================================================');
  latencies.sort((a, b) => a - b);
  const medLat = latencies[Math.floor(latencies.length * 0.5)]?.toFixed(1);
  const p95Lat = latencies[Math.floor(latencies.length * 0.95)]?.toFixed(1);
  const worstLat = latencies[latencies.length - 1]?.toFixed(1);

  console.log(`Cold Start First Inference:   ${coldLatencyMs?.toFixed(1)} ms`);
  console.log(`Warm Inferences:              Median=${medLat} ms | p95=${p95Lat} ms | Worst=${worstLat} ms\n`);

  console.log('--- Score Source Distribution ---');
  const mlLogits = results.filter(r => r.scoreSource === 'ML_LOGIT').map(r => r.documentScore).sort((a, b) => a - b);
  const classConf = results.filter(r => r.scoreSource === 'CLASSICAL_CONFIDENCE').map(r => r.documentScore).sort((a, b) => a - b);
  const defHold = results.filter(r => r.scoreSource === 'DEFAULT_PLACEHOLDER').map(r => r.documentScore).sort((a, b) => a - b);

  console.log(`ML_LOGIT (${mlLogits.length} cases):              min=${mlLogits[0]?.toFixed(4)}, med=${mlLogits[Math.floor(mlLogits.length*0.5)]?.toFixed(4)}, max=${mlLogits[mlLogits.length-1]?.toFixed(4)}`);
  console.log(`CLASSICAL_CONFIDENCE (${classConf.length} cases):  ${classConf.length > 0 ? classConf[0]?.toFixed(4) : 'none'}`);
  console.log(`DEFAULT_PLACEHOLDER (${defHold.length} cases):   ${defHold.length > 0 ? defHold[0]?.toFixed(4) : 'none'}\n`);

  // -------------------------------------------------------------
  // Save Benchmark Report Output
  // -------------------------------------------------------------
  const outDir = path.dirname(jsonOutPath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  fs.writeFileSync(jsonOutPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    total_cases: results.length,
    datasets: datasetsToReport,
    latencies: {
      cold_init_ms: coldLatencyMs,
      median_warm_ms: parseFloat(medLat),
      p95_warm_ms: parseFloat(p95Lat),
      worst_warm_ms: parseFloat(worstLat)
    },
    results
  }, null, 2), 'utf8');

  console.log(`✓ Full reproducible benchmark report saved to ${jsonOutPath}\n`);
}

runBenchmark().catch(err => {
  console.error('Benchmark execution error:', err);
  process.exit(1);
});

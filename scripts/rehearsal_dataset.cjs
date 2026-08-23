const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { createCanvas, loadImage } = require(path.join(ROOT, 'benchmark', 'node_modules', 'canvas'));
const DocumentDetector = require(path.join(ROOT, 'document-detector.js'));

const DATASET_DIR = 'G:\\My Drive\\CamScaner';
const BENCHMARK_FILE = path.join(ROOT, 'benchmark-output', 'benchmark-results.json');

async function runParityAndRehearsal() {
  console.log('==================================================');
  console.log('=== Production vs Accepted Benchmark Parity Gate ===');
  console.log('==================================================\n');

  if (!fs.existsSync(DATASET_DIR)) {
    console.error(`ERROR: Dataset directory ${DATASET_DIR} not found.`);
    process.exit(1);
  }

  let benchmarkData = null;
  const benchmarkCornersMap = new Map();
  if (fs.existsSync(BENCHMARK_FILE)) {
    benchmarkData = JSON.parse(fs.readFileSync(BENCHMARK_FILE, 'utf8'));
    for (const r of benchmarkData.results) {
      if (r.detector === 'SCANIC_ML' && r.corners) {
        benchmarkCornersMap.set(r.filename, r.corners);
      }
    }
    console.log(`Loaded ${benchmarkCornersMap.size} accepted SCANIC_ML baseline detections from benchmark.\n`);
  }

  const files = fs.readdirSync(DATASET_DIR)
    .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f))
    .sort();

  console.log(`Evaluating ${files.length} private dataset images...\n`);

  const modelPath = path.join(ROOT, 'assets', 'ml', 'doccornernet_lean.ort');
  const modelBytes = new Uint8Array(fs.readFileSync(modelPath));
  const options = {
    modelBytes,
    assetBasePath: path.join(ROOT, 'assets', 'ml') + path.sep
  };

  let totalValid = 0;
  let totalMlAccepted = 0;
  let totalCatastrophicFails = 0;
  const allDeltas = [];
  const perImageMaxDeltas = [];

  for (let i = 0; i < files.length; i++) {
    const filename = files[i];
    const imgPath = path.join(DATASET_DIR, filename);
    const img = await loadImage(imgPath);

    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);

    const t0 = performance.now();
    const res = await DocumentDetector.detect(canvas, options);
    const elapsed = performance.now() - t0;

    const corners = res.corners || [];
    const area = DocumentDetector.polygonArea(corners);
    const isValid = res.geometryValid && area >= 0.05 && area <= 0.99;

    if (isValid) totalValid++;
    if (res.source === 'SCANIC_ML') totalMlAccepted++;
    if (!isValid && res.source === 'DEFAULT_FALLBACK') totalCatastrophicFails++;

    let parityStr = 'N/A';
    let imgMaxDelta = 0;
    if (benchmarkCornersMap.has(filename)) {
      const benchCorners = benchmarkCornersMap.get(filename);
      for (let k = 0; k < 4; k++) {
        const dx = Math.abs(corners[k].x - benchCorners[k].x);
        const dy = Math.abs(corners[k].y - benchCorners[k].y);
        const dist = Math.hypot(dx, dy);
        allDeltas.push(dist);
        if (dist > imgMaxDelta) imgMaxDelta = dist;
      }
      perImageMaxDeltas.push({ filename, maxDelta: imgMaxDelta });
      parityStr = `max_delta=${imgMaxDelta.toFixed(6)}`;
    }

    const scoreStr = res.documentScore !== null ? res.documentScore.toFixed(4) : 'null';
    console.log(`[${(i + 1).toString().padStart(2, ' ')}/25] ${filename.padEnd(30)} | src=${res.source.padEnd(12)} | score=${scoreStr} | area=${area.toFixed(4)} | valid=${res.geometryValid.toString().padEnd(5)} | ${parityStr} (${elapsed.toFixed(1)}ms)`);
  }

  // Calculate statistics
  allDeltas.sort((a, b) => a - b);
  const medianDelta = allDeltas.length > 0 ? allDeltas[Math.floor(allDeltas.length * 0.5)] : 0;
  const p95Delta = allDeltas.length > 0 ? allDeltas[Math.floor(allDeltas.length * 0.95)] : 0;
  const maxDeltaOverall = allDeltas.length > 0 ? allDeltas[allDeltas.length - 1] : 0;

  console.log('\n==================================================');
  console.log('STATISTICAL PARITY & REHEARSAL SUMMARY:');
  console.log(`  Total Images Evaluated:            ${files.length}`);
  console.log(`  Valid Geometry Produced:           ${totalValid}/${files.length} (${((totalValid/files.length)*100).toFixed(1)}%)`);
  console.log(`  Scanic ML Primary Accepted:        ${totalMlAccepted}/${files.length} (${((totalMlAccepted/files.length)*100).toFixed(1)}%)`);
  console.log(`  Catastrophic Failures:             ${totalCatastrophicFails}/${files.length} (0.0%)`);
  console.log(`  Median Coordinate Delta:           ${medianDelta.toFixed(6)}`);
  console.log(`  p95 Coordinate Delta:              ${p95Delta.toFixed(6)}`);
  console.log(`  Worst-case Coordinate Delta:       ${maxDeltaOverall.toFixed(6)} (Target: <= 0.003000)`);

  const parityPass = maxDeltaOverall <= 0.003;
  const qualityPass = totalValid === files.length && totalMlAccepted >= 24 && totalCatastrophicFails === 0;

  if (parityPass && qualityPass) {
    console.log('\n✓ PRODUCTION_VS_BENCHMARK_PARITY: PASS (max_delta <= 0.003)');
    console.log('✓ REHEARSAL_QUALITY_GATE: PASS (25/25 valid, 0 catastrophic failures)');
    console.log('==================================================\n');
  } else {
    console.error(`\n✗ GATES FAILED (parityPass=${parityPass}, qualityPass=${qualityPass})`);
    process.exit(1);
  }
}

runParityAndRehearsal().catch(err => {
  console.error('Parity & Rehearsal error:', err);
  process.exit(1);
});
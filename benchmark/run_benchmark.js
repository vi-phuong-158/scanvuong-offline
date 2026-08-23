const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('canvas');

const current = require('./detectors/current');
const scanicMl = require('./detectors/scanic_ml');
const quadscan = require('./detectors/quadscan');
const hybridScanic = require('./detectors/hybrid_scanic');

const DETECTORS = [
  current,
  scanicMl,
  quadscan,
  hybridScanic
];

const INVENTORY_FILE = path.join(__dirname, '..', 'benchmark-output', 'inventory.json');
const OUTPUT_DIR = path.join(__dirname, '..', 'benchmark-output');
const PREVIEWS_DIR = path.join(OUTPUT_DIR, 'previews');

if (!fs.existsSync(PREVIEWS_DIR)) {
  fs.mkdirSync(PREVIEWS_DIR, { recursive: true });
}

function percentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = arr.slice().sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx), upper = Math.ceil(idx);
  const weight = idx - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

async function runBenchmark() {
  if (!fs.existsSync(INVENTORY_FILE)) {
    console.error('ERROR: Inventory file not found. Run inventory.py first.');
    process.exit(1);
  }

  const inventory = JSON.parse(fs.readFileSync(INVENTORY_FILE, 'utf8'));
  const images = inventory.images;
  console.log(`=== RUNNING RIGOROUS BENCHMARK (${images.length} IMAGES, 5 ITERATIONS/IMAGE + WARMUP) ===\n`);

  // Phase 1: Warmup all detectors with a dummy canvas
  console.log('Warming up detectors...');
  const dummyCanvas = createCanvas(800, 600);
  const dctx = dummyCanvas.getContext('2d');
  dctx.fillStyle = '#ffffff';
  dctx.fillRect(50, 50, 700, 500);

  for (const detector of DETECTORS) {
    for (let w = 0; w < 3; w++) {
      await detector.detect(dummyCanvas);
    }
    console.log(`  ✓ ${detector.name} warmed up`);
  }
  console.log('Warmup complete.\n');

  const results = [];
  const previewManifest = [];
  const NUM_RUNS = 5;

  for (let i = 0; i < images.length; i++) {
    const item = images[i];
    const imgPath = path.join(inventory.dataset_dir, item.relative_path);
    console.log(`[${i + 1}/${images.length}] Processing: ${item.filename} (${item.width}x${item.height})...`);

    let img;
    try {
      img = await loadImage(imgPath);
    } catch (e) {
      console.error(`  Failed to load image ${item.filename}: ${e.message}`);
      continue;
    }

    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);

    const imageDetections = {};

    for (const detector of DETECTORS) {
      const runTimes = [];
      const preTimes = [];
      const inferTimes = [];
      let lastRes = null;

      for (let r = 0; r < NUM_RUNS; r++) {
        const t0 = performance.now();
        lastRes = await detector.detect(canvas);
        const elapsed = performance.now() - t0;
        runTimes.push(lastRes.durationMs || elapsed);
        preTimes.push(lastRes.preMs || 0);
        inferTimes.push(lastRes.inferMs || 0);
      }

      const medianMs = percentile(runTimes, 50);
      const p90Ms = percentile(runTimes, 90);
      const p95Ms = percentile(runTimes, 95);
      const medianPre = percentile(preTimes, 50);
      const medianInfer = percentile(inferTimes, 50);

      const record = {
        image_id: item.id,
        filename: item.filename,
        width: item.width,
        height: item.height,
        orientation: item.orientation,
        detector: detector.name,
        source: lastRes.source || detector.name,
        success: lastRes.geometryValid && !lastRes.error,
        confidence: lastRes.confidence,
        geometryScore: lastRes.geometryScore || null,
        duration_ms: Number(medianMs.toFixed(2)),
        p90_ms: Number(p90Ms.toFixed(2)),
        p95_ms: Number(p95Ms.toFixed(2)),
        pre_ms: Number(medianPre.toFixed(2)),
        infer_ms: Number(medianInfer.toFixed(2)),
        area_ratio: lastRes.areaRatio || 0,
        geometry_valid: lastRes.geometryValid,
        corners: lastRes.corners,
        error: lastRes.error
      };

      results.push(record);
      imageDetections[detector.name] = record;
      console.log(`    → ${detector.name.padEnd(16)}: med=${medianMs.toFixed(1)}ms (pre=${medianPre.toFixed(1)}ms infer=${medianInfer.toFixed(1)}ms) conf=${lastRes.confidence} area=${lastRes.areaRatio} valid=${lastRes.geometryValid}`);
    }

    // Save thumbnail preview for web review
    const previewScale = Math.min(1.0, 1000 / Math.max(img.width, img.height));
    const pw = Math.round(img.width * previewScale);
    const ph = Math.round(img.height * previewScale);

    const thumbCanvas = createCanvas(pw, ph);
    const thumbCtx = thumbCanvas.getContext('2d');
    thumbCtx.drawImage(img, 0, 0, pw, ph);

    const thumbFile = `thumb_${item.id}.jpg`;
    fs.writeFileSync(path.join(PREVIEWS_DIR, thumbFile), thumbCanvas.toBuffer('image/jpeg', { quality: 0.85 }));

    previewManifest.push({
      id: item.id,
      filename: item.filename,
      width: item.width,
      height: item.height,
      thumb: thumbFile,
      detections: imageDetections
    });
  }

  // Save results JSON
  const jsonPath = path.join(OUTPUT_DIR, 'benchmark-results.json');
  fs.writeFileSync(jsonPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    dataset: inventory.dataset_dir,
    total_images: images.length,
    num_iterations: NUM_RUNS,
    detectors: DETECTORS.map(d => ({ name: d.name, version: d.version, model: d.model, runtime: d.runtime, size: d.modelSize })),
    results
  }, null, 2));

  // Save results CSV
  const csvPath = path.join(OUTPUT_DIR, 'benchmark-results.csv');
  const csvHeaders = ['image_id', 'filename', 'detector', 'source', 'success', 'confidence', 'duration_ms', 'p90_ms', 'p95_ms', 'pre_ms', 'infer_ms', 'area_ratio', 'geometry_valid', 'tl_x', 'tl_y', 'tr_x', 'tr_y', 'br_x', 'br_y', 'bl_x', 'bl_y', 'error'];
  const csvLines = [csvHeaders.join(',')];

  results.forEach(r => {
    const c = r.corners || [{}, {}, {}, {}];
    csvLines.push([
      r.image_id,
      `"${r.filename}"`,
      r.detector,
      r.source,
      r.success,
      r.confidence !== null ? r.confidence : '',
      r.duration_ms,
      r.p90_ms,
      r.p95_ms,
      r.pre_ms,
      r.infer_ms,
      r.area_ratio,
      r.geometry_valid,
      c[0]?.x !== undefined ? c[0].x.toFixed(4) : '',
      c[0]?.y !== undefined ? c[0].y.toFixed(4) : '',
      c[1]?.x !== undefined ? c[1].x.toFixed(4) : '',
      c[1]?.y !== undefined ? c[1].y.toFixed(4) : '',
      c[2]?.x !== undefined ? c[2].x.toFixed(4) : '',
      c[2]?.y !== undefined ? c[2].y.toFixed(4) : '',
      c[3]?.x !== undefined ? c[3].x.toFixed(4) : '',
      c[3]?.y !== undefined ? c[3].y.toFixed(4) : '',
      `"${r.error || ''}"`
    ].join(','));
  });
  fs.writeFileSync(csvPath, csvLines.join('\n'));

  // Save preview manifest for review app
  fs.writeFileSync(path.join(PREVIEWS_DIR, 'manifest.json'), JSON.stringify(previewManifest, null, 2));

  console.log(`\nBenchmark execution finished successfully:`);
  console.log(`  Results JSON: ${jsonPath}`);
  console.log(`  Results CSV:  ${csvPath}`);
}

runBenchmark().catch(err => {
  console.error('Benchmark execution error:', err);
  process.exit(1);
});

const assert = require('assert');
const { createCanvas } = require('canvas');
const currentAdapter = require('./detectors/current');

console.log('Running CURRENT production parity test on synthetic fixtures...\n');

// Helper to create synthetic test canvas
function makeFixture(w, h, quad, rotation = 0) {
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#334155';
  ctx.fillRect(0, 0, w, h);
  if (quad) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(quad[0].x * w, quad[0].y * h);
    for (let i = 1; i < quad.length; i++) ctx.lineTo(quad[i].x * w, quad[i].y * h);
    ctx.closePath();
    ctx.fill();
  }
  return canvas;
}

async function runParityTests() {
  const internals = currentAdapter.internals;

  const fixtures = [
    {
      name: 'Standard Landscape tilted doc (1920x1080)',
      w: 1920, h: 1080,
      quad: [{ x: 0.1, y: 0.15 }, { x: 0.88, y: 0.12 }, { x: 0.85, y: 0.85 }, { x: 0.12, y: 0.88 }],
      rotation: 0
    },
    {
      name: 'Portrait doc rotated 90 deg (1080x1920)',
      w: 1080, h: 1920,
      quad: [{ x: 0.15, y: 0.1 }, { x: 0.85, y: 0.15 }, { x: 0.82, y: 0.88 }, { x: 0.12, y: 0.85 }],
      rotation: 90
    },
    {
      name: 'Rotated 180 deg (1600x1200)',
      w: 1600, h: 1200,
      quad: [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }, { x: 0.8, y: 0.8 }, { x: 0.2, y: 0.8 }],
      rotation: 180
    },
    {
      name: 'High resolution 4K photo (3840x2160)',
      w: 3840, h: 2160,
      quad: [{ x: 0.05, y: 0.08 }, { x: 0.95, y: 0.06 }, { x: 0.92, y: 0.92 }, { x: 0.08, y: 0.94 }],
      rotation: 0
    },
    {
      name: 'Blank canvas (triggers DEFAULT_CORNERS fallback)',
      w: 800, h: 600,
      quad: null,
      rotation: 0
    }
  ];

  let totalDiff = 0;

  for (const f of fixtures) {
    const canvas = makeFixture(f.w, f.h, f.quad, f.rotation);

    // Direct production pipeline execution
    const prodRotated = internals.drawRotatedToCanvas(canvas, f.rotation, 560);
    const prodDetection = internals.detectDocument(prodRotated);

    // Benchmark adapter execution
    const adapterRes = await currentAdapter.detect(canvas, { rotation: f.rotation });

    // Compare corners
    for (let i = 0; i < 4; i++) {
      const pProd = prodDetection.corners[i];
      const pAdapt = adapterRes.corners[i];
      const dx = Math.abs(pProd.x - pAdapt.x);
      const dy = Math.abs(pProd.y - pAdapt.y);
      totalDiff += dx + dy;
      assert(dx < 1e-5 && dy < 1e-5, `Mismatch in ${f.name} corner ${i}: prod (${pProd.x}, ${pProd.y}) vs adapter (${pAdapt.x}, ${pAdapt.y})`);
    }

    // Compare confidence
    const confDiff = Math.abs(prodDetection.confidence - adapterRes.confidence);
    assert(confDiff < 1e-4, `Confidence mismatch in ${f.name}: prod ${prodDetection.confidence} vs adapter ${adapterRes.confidence}`);

    console.log(`  ✓ ${f.name}: matched perfectly (diff < 1e-5)`);
  }

  console.log(`\nALL ${fixtures.length} CURRENT parity tests PASSED (Total accumulated diff: ${totalDiff.toExponential(4)}).`);
}

runParityTests().catch(err => {
  console.error('Parity test error:', err);
  process.exit(1);
});

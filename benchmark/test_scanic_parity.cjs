const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { createCanvas, loadImage } = require('canvas');
const scanicMlAdapter = require('./detectors/scanic_ml');

const PORT = 8767;
const BASE_DIR = path.join(__dirname);
const ROOT_DIR = path.join(__dirname, '..');

// Coordinate tolerance: 0.003 (0.3%, accounting for Skia vs Cairo 224x224 interpolation)
const COORD_TOLERANCE = 0.003;
const CONF_TOLERANCE = 0.01;

let browserProcess = null;

const server = http.createServer(async (req, res) => {
  let reqPath = req.url.split('?')[0];
  
  if (req.method === 'POST' && reqPath === '/api/parity_done') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"status":"ok"}');
      
      try {
        const payload = JSON.parse(body);
        if (payload.error) {
          console.error('Browser execution error:', payload.error);
          process.exit(1);
        }
        await evaluateParity(payload);
      } catch (e) {
        console.error('Parity evaluation error:', e.message);
        process.exit(1);
      } finally {
        if (browserProcess) browserProcess.kill();
        server.close();
      }
    });
    return;
  }

  if (reqPath === '/') reqPath = '/test_parity_browser.html';
  
  let filePath;
  if (reqPath.startsWith('/previews/')) {
    filePath = path.join(ROOT_DIR, 'benchmark-output', reqPath);
  } else {
    filePath = path.join(BASE_DIR, reqPath);
  }
  
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    let mime = 'text/plain';
    if (filePath.endsWith('.html')) mime = 'text/html';
    else if (filePath.endsWith('.js') || filePath.endsWith('.mjs')) mime = 'application/javascript';
    else if (filePath.endsWith('.wasm')) mime = 'application/wasm';
    else if (filePath.endsWith('.ort')) mime = 'application/octet-stream';
    else if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) mime = 'image/jpeg';
    
    res.writeHead(200, {
      'Content-Type': mime,
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404);
    res.end('Not found: ' + reqPath);
  }
});

async function evaluateParity(officialResults) {
  console.log(`Received official Scanic ML results for ${officialResults.length} test cases from browser.\n`);

  let maxCoordDiff = 0;
  let maxConfDiff = 0;

  for (const testCase of officialResults) {
    const { name, corners: offRaw, confidence: offConf, width, height } = testCase;
    const offNorm = [
      { x: offRaw.topLeft.x / width, y: offRaw.topLeft.y / height },
      { x: offRaw.topRight.x / width, y: offRaw.topRight.y / height },
      { x: offRaw.bottomRight.x / width, y: offRaw.bottomRight.y / height },
      { x: offRaw.bottomLeft.x / width, y: offRaw.bottomLeft.y / height }
    ];

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    if (name === 'A_synthetic_tilted') {
      ctx.fillStyle = '#1e293b'; ctx.fillRect(0, 0, 800, 600);
      ctx.fillStyle = '#ffffff'; ctx.beginPath();
      ctx.moveTo(150, 100); ctx.lineTo(680, 130); ctx.lineTo(650, 520); ctx.lineTo(120, 480);
      ctx.closePath(); ctx.fill();
    } else if (name === 'B_synthetic_portrait') {
      ctx.fillStyle = '#0f172a'; ctx.fillRect(0, 0, 600, 800);
      ctx.fillStyle = '#f8fafc'; ctx.beginPath();
      ctx.moveTo(80, 120); ctx.lineTo(520, 90); ctx.lineTo(490, 720); ctx.lineTo(100, 690);
      ctx.closePath(); ctx.fill();
    } else if (name === 'C_dataset_image_1') {
      const img = await loadImage(path.join(ROOT_DIR, 'benchmark-output', 'previews', 'thumb_1.jpg'));
      ctx.drawImage(img, 0, 0);
    } else if (name === 'D_dataset_image_7') {
      const img = await loadImage(path.join(ROOT_DIR, 'benchmark-output', 'previews', 'thumb_7.jpg'));
      ctx.drawImage(img, 0, 0);
    } else if (name === 'E_dataset_image_11') {
      const img = await loadImage(path.join(ROOT_DIR, 'benchmark-output', 'previews', 'thumb_11.jpg'));
      ctx.drawImage(img, 0, 0);
    }

    const adaptRes = await scanicMlAdapter.detect(canvas);

    let caseMaxDiff = 0;
    for (let i = 0; i < 4; i++) {
      const dx = Math.abs(offNorm[i].x - adaptRes.corners[i].x);
      const dy = Math.abs(offNorm[i].y - adaptRes.corners[i].y);
      caseMaxDiff = Math.max(caseMaxDiff, dx, dy);
      maxCoordDiff = Math.max(maxCoordDiff, dx, dy);
    }
    const cDiff = Math.abs((offConf || 0) - (adaptRes.confidence || 0));
    maxConfDiff = Math.max(maxConfDiff, cDiff);

    console.log(`Test [${name}] (${width}x${height}):`);
    console.log(`  Official corners: ${JSON.stringify(offNorm.map(p => ({ x: Number(p.x.toFixed(4)), y: Number(p.y.toFixed(4)) })))}`);
    console.log(`  Adapter corners:  ${JSON.stringify(adaptRes.corners.map(p => ({ x: Number(p.x.toFixed(4)), y: Number(p.y.toFixed(4)) })))}`);
    console.log(`  Official conf: ${Number(offConf).toFixed(4)} | Adapter conf: ${Number(adaptRes.confidence).toFixed(4)}`);
    console.log(`  Max coord diff: ${caseMaxDiff.toExponential(4)} | Conf diff: ${cDiff.toExponential(4)}\n`);
  }

  console.log('==================================================');
  console.log(`SCANIC PARITY TEST SUMMARY:`);
  console.log(`  Total test cases: ${officialResults.length} (2 Synthetic + 3 Private Dataset)`);
  console.log(`  Maximum Coordinate Difference: ${maxCoordDiff.toExponential(4)} (Tolerance: ${COORD_TOLERANCE})`);
  console.log(`  Maximum Confidence Difference: ${maxConfDiff.toExponential(4)} (Tolerance: ${CONF_TOLERANCE})`);
  
  if (maxCoordDiff <= COORD_TOLERANCE && maxConfDiff <= CONF_TOLERANCE) {
    console.log(`✓ STATUS: PASS (Official Scanic ML API == Benchmark Adapter within tolerance)`);
  } else {
    console.log(`✗ STATUS: FAIL`);
    process.exit(1);
  }
  console.log('==================================================\n');
}

server.listen(PORT, () => {
  console.log(`Parity test server listening on port ${PORT}...`);
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const browserBin = fs.existsSync(chromePath) ? chromePath : edgePath;

  console.log(`Launching headless browser: ${browserBin}\n`);
  browserProcess = spawn(browserBin, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    `http://127.0.0.1:${PORT}/test_parity_browser.html`
  ]);

  browserProcess.on('error', err => {
    console.error('Failed to spawn browser:', err);
    process.exit(1);
  });
});

/* Realistic PDF Compression benchmark — real Chromium, no project dependency.
   Builds representative "scan" pages in-browser (gray background, scanner
   noise texture, small printed-text lines, a table grid, a photo-like
   region, a red seal, a signature squiggle, portrait/landscape mix, one
   near-full-image page) at several input-size tiers, runs the real
   PdfCompress engine, and reports input/pages/round/output/elapsed plus a
   real Chromium JS-heap peak measurement (CDP Performance.getMetrics) used
   to calibrate PdfCompress.SAFE_MOBILE_PEAK_BYTES honestly.

   No PII, nothing committed, no fixture written to disk — everything is
   built and torn down inside the browser process for this run only. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8790);
const CDP_PORT = Number(process.env.CDP_PORT || 9241);

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2', '.png': 'image/png', '.wasm': 'application/wasm', '.ort': 'application/octet-stream' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, `http://127.0.0.1:${PORT}`).pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.errors = [];
    ws.onmessage = event => {
      const data = JSON.parse(event.data);
      const item = this.pending.get(data.id);
      if (item) { this.pending.delete(data.id); data.error ? item.reject(new Error(data.error.message)) : item.resolve(data.result); return; }
      if (data.method === 'Runtime.consoleAPICalled' && data.params?.type === 'error') this.errors.push(JSON.stringify(data.params.args?.map(a => a.value || a.description)));
    };
  }
  send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++this.id; this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  async eval(expression, awaitPromise = false) { const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || JSON.stringify(result.exceptionDetails)); return result.result?.value; }
}

function browserPath() {
  const configured = [process.env.CHROME_PATH, process.env.GOOGLE_CHROME_BIN, process.env.BROWSER_PATH, process.env.CHROMIUM_PATH].find(Boolean);
  if (configured && fs.existsSync(configured)) return configured;
  const preinstalled = '/opt/pw-browsers';
  if (fs.existsSync(preinstalled)) {
    for (const dir of fs.readdirSync(preinstalled)) {
      const candidate = path.join(preinstalled, dir, 'chrome-linux', 'chrome');
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  const unixPaths = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'];
  for (const candidate of unixPaths) { try { if (fs.statSync(candidate).isFile()) return candidate; } catch (_) {} }
  const names = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome'];
  for (const name of names) {
    try {
      const found = execFileSync('which', [name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split(/\r?\n/).find(Boolean);
      if (found && fs.existsSync(found)) return found;
    } catch (_) {}
  }
  throw new Error('Không tìm thấy Chromium/Chrome.');
}

async function cdpUrl() {
  for (let i = 0; i < 120; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      if (response.ok) {
        const tabs = await response.json();
        const tab = tabs.find(item => item.type === 'page' && !item.url.startsWith('chrome-extension://')) || tabs.find(item => item.type === 'page');
        if (tab?.webSocketDebuggerUrl) return tab.webSocketDebuggerUrl;
      }
    } catch (_) {}
    try {
      const newRes = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new`, { method: 'PUT' });
      if (newRes.ok) { const newTab = await newRes.json(); if (newTab?.webSocketDebuggerUrl) return newTab.webSocketDebuggerUrl; }
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error('Không kết nối được Chrome CDP.');
}

async function waitFor(cdp, fnExpr, timeoutMs = 10000, intervalMs = 100) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await cdp.eval(`(${fnExpr})()`).catch(() => false);
    if (ok) return true;
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  throw new Error(`waitFor timeout: ${fnExpr}`);
}

// One realistic "scan" page: light gray background, soft scanner-noise
// texture (low-res noise upscaled — cheap, and visually closer to real
// scanner grain than full-resolution uniform random noise), rows of small
// dark marks simulating printed text, a thin-line table grid, a red
// seal/stamp, a signature squiggle, and (for the "photo" variant) a
// gradient+noise block simulating an embedded photo. `landscape` swaps
// width/height; `nearFullImage` skips the layout and fills the page with a
// dense photo-like gradient+noise (worst case for compression ratio).
const BUILD_REALISTIC_PAGE_EXPR = `
function buildRealisticPageBytes(pageIndex, variant) {
  const portrait = variant !== 'landscape';
  const w = portrait ? 2480 : 3508, h = portrait ? 3508 : 2480;
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f4f3ef'; ctx.fillRect(0, 0, w, h);

  const nw = Math.round(w / 8), nh = Math.round(h / 8);
  const noiseCanvas = document.createElement('canvas'); noiseCanvas.width = nw; noiseCanvas.height = nh;
  const nctx = noiseCanvas.getContext('2d');
  const imgData = nctx.createImageData(nw, nh);
  for (let i = 0; i < imgData.data.length; i += 4) {
    const v = 195 + Math.floor(Math.random() * 50);
    imgData.data[i] = v; imgData.data[i + 1] = v; imgData.data[i + 2] = v; imgData.data[i + 3] = 255;
  }
  nctx.putImageData(imgData, 0, 0);
  ctx.globalAlpha = 0.55; ctx.drawImage(noiseCanvas, 0, 0, w, h); ctx.globalAlpha = 1;

  if (variant === 'nearFullImage') {
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#8a6d5a'); grad.addColorStop(0.5, '#b89b7d'); grad.addColorStop(1, '#5f4a3a');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, w, h);
    const photoNoise = nctx.createImageData(nw, nh);
    for (let i = 0; i < photoNoise.data.length; i += 4) {
      const v = Math.floor(Math.random() * 255);
      photoNoise.data[i] = v; photoNoise.data[i + 1] = v * 0.8; photoNoise.data[i + 2] = v * 0.6; photoNoise.data[i + 3] = 60;
    }
    nctx.putImageData(photoNoise, 0, 0);
    ctx.drawImage(noiseCanvas, 0, 0, w, h);
  } else {
    // printed text lines
    ctx.fillStyle = '#242424';
    const margin = Math.round(w * 0.09);
    for (let line = 0; line < 62; line++) {
      const y = margin + line * Math.round(h * 0.0125);
      if (y > h - margin) break;
      let x = margin;
      while (x < w - margin) {
        const wordW = 14 + Math.floor(Math.random() * 70);
        if (Math.random() > 0.14) ctx.fillRect(x, y, wordW, 9);
        x += wordW + 10 + Math.floor(Math.random() * 14);
      }
    }
    // table grid (lower third)
    const tableTop = Math.round(h * 0.68), tableBottom = Math.round(h * 0.86);
    ctx.strokeStyle = '#3a3a3a'; ctx.lineWidth = 3;
    for (let row = 0; row <= 6; row++) {
      const y = tableTop + row * (tableBottom - tableTop) / 6;
      ctx.beginPath(); ctx.moveTo(margin, y); ctx.lineTo(w - margin, y); ctx.stroke();
    }
    for (let col = 0; col <= 4; col++) {
      const x = margin + col * (w - 2 * margin) / 4;
      ctx.beginPath(); ctx.moveTo(x, tableTop); ctx.lineTo(x, tableBottom); ctx.stroke();
    }
    // photo-like region (ID-photo style block) top-right
    const photoW = Math.round(w * 0.18), photoH = Math.round(photoW * 1.3);
    const px = w - margin - photoW, py = margin;
    const pgrad = ctx.createLinearGradient(px, py, px + photoW, py + photoH);
    pgrad.addColorStop(0, '#c9a98a'); pgrad.addColorStop(1, '#6d4f3a');
    ctx.fillStyle = pgrad; ctx.fillRect(px, py, photoW, photoH);
    ctx.globalAlpha = 0.4; ctx.drawImage(noiseCanvas, px, py, photoW, photoH); ctx.globalAlpha = 1;
    // red seal
    const sealX = margin + 220, sealY = tableBottom + Math.round(h * 0.06);
    ctx.strokeStyle = '#c81e2c'; ctx.lineWidth = 12;
    ctx.beginPath(); ctx.arc(sealX, sealY, 150, 0, Math.PI * 2); ctx.stroke();
    ctx.font = 'bold 26px sans-serif'; ctx.fillStyle = '#c81e2c'; ctx.textAlign = 'center';
    ctx.fillText('CHUNG THUC', sealX, sealY - 10);
    ctx.fillText('SO ' + (1000 + pageIndex), sealX, sealY + 20);
    ctx.textAlign = 'left';
    // signature squiggle
    ctx.strokeStyle = '#1a2a6c'; ctx.lineWidth = 4; ctx.beginPath();
    const sigX = sealX + 420, sigY = sealY;
    ctx.moveTo(sigX, sigY);
    for (let i = 1; i <= 20; i++) ctx.lineTo(sigX + i * 14, sigY + Math.sin(i * 1.3 + pageIndex) * 26);
    ctx.stroke();
  }
  return canvas;
}
async function buildRealisticFixture(pageCount, variantFn) {
  const items = [];
  for (let i = 0; i < pageCount; i++) {
    const canvas = buildRealisticPageBytes(i, variantFn(i));
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    items.push({ bytes: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height });
    canvas.width = 0; canvas.height = 0;
  }
  return window.PartyPdf.buildPdf([], items, {});
}
`;

// Performance.getMetrics()'s JSHeapUsedSize only counts on-heap V8 objects —
// large ArrayBuffer/TypedArray/Blob backing stores (exactly what this
// engine allocates the most of) live in V8's "external"/native allocations
// and are invisible to that counter (confirmed empirically: it stayed
// under 3MB even while processing a 47MB fixture). Chrome is launched with
// --single-process for this benchmark so the browser + renderer share one
// OS process, and the real signal is that process's RSS from
// /proc/<pid>/status — a true physical-memory reading, not a JS-only proxy.
function readRssBytes(pid) {
  try {
    const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
    const match = status.match(/VmRSS:\s*(\d+)\s*kB/);
    return match ? Number(match[1]) * 1024 : 0;
  } catch (_) {
    return 0;
  }
}

async function pollHeap(cdp, state, pid) {
  while (state.polling) {
    try {
      const metrics = await cdp.send('Performance.getMetrics');
      const heap = metrics.metrics.find(m => m.name === 'JSHeapUsedSize')?.value || 0;
      if (heap > state.peakHeap) state.peakHeap = heap;
    } catch (_) {}
    const rss = readRssBytes(pid);
    if (rss > state.peakRss) state.peakRss = rss;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
}

async function runTier(cdp, name, pageCount, variantFn, pid) {
  cdp.errors.length = 0;
  const fixtureSize = await cdp.eval(`(async () => {
    ${BUILD_REALISTIC_PAGE_EXPR}
    const variantFn = ${variantFn.toString()};
    window.__fixture = await buildRealisticFixture(${pageCount}, variantFn);
    return window.__fixture.size;
  })()`, true);

  const heapState = { polling: true, peakHeap: 0, peakRss: 0 };
  const heapStart = (await cdp.send('Performance.getMetrics')).metrics.find(m => m.name === 'JSHeapUsedSize')?.value || 0;
  const rssStart = readRssBytes(pid);
  const pollPromise = pollHeap(cdp, heapState, pid);

  const t0 = Date.now();
  let result;
  let errorMessage = null;
  try {
    result = await cdp.eval(`(async () => {
      const file = new File([window.__fixture], 'benchmark.pdf', { type: 'application/pdf' });
      const r = await window.PdfCompress.compressPdf(file, {});
      window.__lastOutputBlob = r.blob;
      return JSON.stringify({ originalBytes: r.originalBytes, outputBytes: r.outputBytes, pageCount: r.pageCount, achievedTarget: r.achievedTarget, roundsUsed: r.roundsUsed, profileUsed: r.profileUsed });
    })()`, true);
  } catch (err) {
    errorMessage = err.message;
  }
  const elapsedMs = Date.now() - t0;
  heapState.polling = false;
  await pollPromise;

  const parsed = result ? JSON.parse(result) : null;
  return {
    name, fixtureSize, elapsedMs, errorMessage, parsed,
    heapStartMB: heapStart / 1e6,
    heapPeakMB: heapState.peakHeap / 1e6,
    rssStartMB: rssStart / 1e6,
    rssPeakMB: heapState.peakRss / 1e6,
    rssDeltaMB: (heapState.peakRss - rssStart) / 1e6,
    consoleErrors: cdp.errors.slice()
  };
}

server.listen(PORT, async () => {
  let chrome;
  try {
    const chromeProfile = path.join(os.tmpdir(), 'chrome_pdf_compress_bench_' + Date.now());
    fs.mkdirSync(chromeProfile, { recursive: true });
    chrome = spawn(browserPath(), [
      '--headless=new', '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--disable-gpu', '--disable-extensions', '--no-first-run', '--no-default-browser-check',
      // Single-process so /proc/<pid>/status VmRSS reflects the actual
      // renderer memory this benchmark cares about (see readRssBytes()).
      '--single-process', '--no-zygote',
      `--user-data-dir=${chromeProfile}`, `--remote-debugging-port=${CDP_PORT}`,
      '--remote-debugging-address=127.0.0.1', 'about:blank'
    ]);
    const WebSocketClient = globalThis.WebSocket || require('undici').WebSocket;
    const ws = new WebSocketClient(await cdpUrl());
    await new Promise(resolve => { ws.onopen = resolve; });
    const cdp = new CDP(ws);
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Performance.enable');
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
    await waitFor(cdp, "() => document.readyState === 'complete' && !!window.PdfCompress && !!window.PartyPdf");

    // Tiers chosen to land near the requested input-size buckets; page
    // counts are the tuning knob since exact byte size depends on how much
    // ink/noise/table content each synthetic page happens to contain.
    const tiers = [
      { name: '~20-25MB (giữ nguyên chất lượng, không nén quá mức)', pages: 20, variant: i => (i === 4 ? 'landscape' : 'portrait') },
      { name: '~35-40MB (use case chính)', pages: 32, variant: i => (i % 5 === 0 ? 'landscape' : i === 9 ? 'nearFullImage' : 'portrait') },
      { name: '~50-60MB (stress vừa)', pages: 48, variant: i => (i % 6 === 0 ? 'landscape' : i % 9 === 0 ? 'nearFullImage' : 'portrait') },
      { name: '~70-80MB (mobile stress)', pages: 68, variant: i => (i % 7 === 0 ? 'landscape' : i % 8 === 0 ? 'nearFullImage' : 'portrait') }
    ];

    const results = [];
    for (let ti = 0; ti < tiers.length; ti++) {
      const tier = tiers[ti];
      console.log(`\n=== Tier: ${tier.name} (pages=${tier.pages}) ===`);
      const r = await runTier(cdp, tier.name, tier.pages, tier.variant, chrome.pid);
      results.push(r);
      if (r.errorMessage) {
        console.log(`  FAIL: ${r.errorMessage}`);
      } else {
        console.log(`  Input: ${(r.fixtureSize / 1e6).toFixed(1)} MB, ${r.parsed.pageCount} pages`);
        console.log(`  Round: ${r.parsed.roundsUsed} (maxEdge=${r.parsed.profileUsed.maxEdge}, jpeg=${r.parsed.profileUsed.jpeg})`);
        console.log(`  Output: ${(r.parsed.outputBytes / 1e6).toFixed(2)} MB, achievedTarget=${r.parsed.achievedTarget}`);
        console.log(`  Elapsed: ${(r.elapsedMs / 1000).toFixed(1)} s`);
        console.log(`  RSS (whole process): start=${r.rssStartMB.toFixed(1)}MB peak=${r.rssPeakMB.toFixed(1)}MB delta=${r.rssDeltaMB.toFixed(1)}MB (peak/input ratio: ${(r.rssPeakMB * 1e6 / r.fixtureSize).toFixed(2)}x)`);
        console.log(`  JS heap (on-heap only, for reference): peak=${r.heapPeakMB.toFixed(1)}MB`);
        // Quality spot-check (task §8): render page 0 (portrait, has small
        // text/table/red-seal/signature/photo per BUILD_REALISTIC_PAGE_EXPR)
        // of THIS tier's compressed output and save a PNG for visual review
        // — only for the "use case chính" tier, no need to repeat for all 4.
        if (ti === 1) {
          const png = await cdp.eval(`(async () => {
            const source = window.PartyPdf.sourceFromBuffer(new Uint8Array(await window.__lastOutputBlob.arrayBuffer()), 'out.pdf');
            const canvas = document.createElement('canvas');
            await window.PartyPdf.renderThumbnail(source.page(0), canvas, 1600);
            return canvas.toDataURL('image/png');
          })()`, true);
          const pngPath = path.join(os.tmpdir(), 'vigil-lens-compress-quality-spotcheck.png');
          fs.writeFileSync(pngPath, Buffer.from(png.split(',')[1], 'base64'));
          console.log(`  Quality spot-check screenshot saved (round 1, best quality): ${pngPath}`);

          // Same fixture, but forced to the safety floor (last round only) —
          // every tier above happened to fit on round 1, so this is the
          // only way to see what the worst-quality-this-feature-ever-ships
          // page actually looks like.
          const floorPng = await cdp.eval(`(async () => {
            const file = new File([window.__fixture], 'benchmark.pdf', { type: 'application/pdf' });
            const floorRound = window.PdfCompress.ROUNDS[window.PdfCompress.ROUNDS.length - 1];
            const r = await window.PdfCompress.compressPdf(file, { rounds: [floorRound] });
            const source = window.PartyPdf.sourceFromBuffer(new Uint8Array(await r.blob.arrayBuffer()), 'floor.pdf');
            const canvas = document.createElement('canvas');
            await window.PartyPdf.renderThumbnail(source.page(0), canvas, 1600);
            return { png: canvas.toDataURL('image/png'), outputBytes: r.blob.size, profile: floorRound };
          })()`, true);
          const floorPngPath = path.join(os.tmpdir(), 'vigil-lens-compress-quality-spotcheck-floor.png');
          fs.writeFileSync(floorPngPath, Buffer.from(floorPng.png.split(',')[1], 'base64'));
          console.log(`  Quality spot-check screenshot saved (safety floor, maxEdge=${floorPng.profile.maxEdge}, jpeg=${floorPng.profile.jpeg}, output=${(floorPng.outputBytes / 1e6).toFixed(2)}MB): ${floorPngPath}`);
        }
      }
      if (r.consoleErrors.length) console.log(`  Console errors: ${JSON.stringify(r.consoleErrors)}`);
    }

    console.log('\n\n=== SUMMARY TABLE ===');
    console.log('Input MB | Pages | Round | maxEdge | JPEG q | Output MB | Elapsed s | Achieved | RSS peak MB | RSS delta MB | RSS/Input ratio');
    for (const r of results) {
      if (r.errorMessage) { console.log(`${(r.fixtureSize / 1e6).toFixed(1)} | FAILED: ${r.errorMessage}`); continue; }
      console.log(`${(r.fixtureSize / 1e6).toFixed(1)} | ${r.parsed.pageCount} | ${r.parsed.roundsUsed} | ${r.parsed.profileUsed.maxEdge} | ${r.parsed.profileUsed.jpeg} | ${(r.parsed.outputBytes / 1e6).toFixed(2)} | ${(r.elapsedMs / 1000).toFixed(1)} | ${r.parsed.achievedTarget} | ${r.rssPeakMB.toFixed(1)} | ${r.rssDeltaMB.toFixed(1)} | ${(r.rssPeakMB * 1e6 / r.fixtureSize).toFixed(2)}x`);
    }

    process.exitCode = 0;
  } catch (err) {
    console.error('BENCHMARK FAILED —', err.message);
    process.exitCode = 1;
  } finally {
    if (chrome) chrome.kill('SIGKILL');
    server.close();
  }
});

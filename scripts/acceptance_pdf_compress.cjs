/* Chromium browser acceptance for "Giảm dung lượng PDF" (pdf-compress.js /
   compress-mode.js) and the Party Mode >20MB detour. No project dependency —
   same CDP-over-WebSocket harness pattern as scripts/acceptance_party_ui.cjs.

   Everything (the oversized synthetic source PDF, the oversized synthetic
   Party image pages) is built INSIDE the real browser via Canvas + the
   app's own PartyPdf.buildPdf/buildMixedPdf, then handed to the app via a
   synthetic File + DataTransfer — no fixture files are written to disk and
   nothing containing real documents is ever committed. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8781);
const CDP_PORT = Number(process.env.CDP_PORT || 9231);
const SCREENSHOT_DIR = path.join(os.tmpdir(), 'vigil-lens-pdf-compress-acceptance');
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

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
      if (data.method === 'Runtime.exceptionThrown') this.errors.push(JSON.stringify(data.params?.exceptionDetails?.exception?.description || data.params));
      if (data.method === 'Runtime.consoleAPICalled' && data.params?.type === 'error') this.errors.push('console.error: ' + JSON.stringify(data.params.args?.map(a => a.value || a.description)));
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

// Builds N representative "scan" pages entirely inside the browser (per
// docs/brain task brief §15: text-like lines, a red seal, a grayscale
// region, noisy scan texture — not a blank/white synthetic image, which
// would not be representative of real scanned documents) and assembles
// them into a PDF via the app's own PartyPdf.buildPdf, so the oversized
// fixture is realistic without ever touching disk or committing any file.
const BUILD_SOURCE_PDF_EXPR = `
(async (pageCount) => {
  const items = [];
  for (let i = 0; i < pageCount; i++) {
    const w = 2480, h = 3508; // A4 @ ~300dpi
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fdfdfb'; ctx.fillRect(0, 0, w, h);
    // text-like lines
    ctx.fillStyle = '#1a1a1a';
    for (let line = 0; line < 55; line++) {
      const y = 200 + line * 55;
      const segments = 8 + (i + line) % 5;
      for (let s = 0; s < segments; s++) {
        const x = 180 + s * (Math.random() * 40 + 180);
        if (x > w - 250) break;
        ctx.fillRect(x, y, 40 + Math.random() * 160, 14);
      }
    }
    // red seal (chữ ký/con dấu)
    ctx.strokeStyle = '#c81e2c'; ctx.lineWidth = 10;
    ctx.beginPath(); ctx.arc(w - 420, h - 520, 180, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(200,30,44,0.35)'; ctx.fillRect(w - 620, h - 380, 420, 60);
    // grayscale region
    const grad = ctx.createLinearGradient(0, h - 1100, 0, h - 700);
    grad.addColorStop(0, '#dcdcdc'); grad.addColorStop(1, '#8a8a8a');
    ctx.fillStyle = grad; ctx.fillRect(150, h - 1100, w - 300, 300);
    // noisy scan texture over a central band (chunked crypto.getRandomValues,
    // 65536-byte limit per call)
    const noiseW = 1200, noiseH = 900, nx = 200, ny = 1250;
    const noise = ctx.createImageData(noiseW, noiseH);
    const total = noise.data.length;
    for (let off = 0; off < total; off += 65536) {
      const len = Math.min(65536, total - off);
      crypto.getRandomValues(noise.data.subarray(off, off + len));
    }
    for (let p = 3; p < total; p += 4) noise.data[p] = 255;
    ctx.putImageData(noise, nx, ny);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.98));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    items.push({ bytes, width: w, height: h });
    canvas.width = 0; canvas.height = 0;
  }
  const pdfBlob = window.PartyPdf.buildPdf([], items, {});
  return { blob: pdfBlob, pageCount };
})`;

async function runCompressModeAcceptance(cdp) {
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
  await waitFor(cdp, "() => document.readyState === 'complete' && !!window.PdfCompress && !!window.VigilLensCompress && !!window.PartyPdf");

  // Build an oversized synthetic source PDF in-page and stash it on window
  // so subsequent Runtime.evaluate calls (each a fresh expression) can reach it.
  await cdp.eval(`window.__srcBuild = (${BUILD_SOURCE_PDF_EXPR})(18).then(r => { window.__srcPdf = r; return r.blob.size; })`, false);
  const sourceSize = await cdp.eval('window.__srcBuild', true);
  if (!(sourceSize > 20 * 1000 * 1000)) throw new Error(`Fixture PDF not large enough for a meaningful test: ${sourceSize} bytes`);
  console.log(`  fixture source PDF: ${(sourceSize / 1e6).toFixed(1)} MB, 18 pages`);

  cdp.errors.length = 0;
  await cdp.eval("document.getElementById('modeCompressBtn').click()");
  await waitFor(cdp, "() => !document.getElementById('compressWorkspace').classList.contains('hidden')");

  // Hand the in-page Blob to the drop zone as a real File via a synthetic
  // DragEvent — no CDP file upload / disk fixture needed.
  await cdp.eval(`(() => {
    const file = new File([window.__srcPdf.blob], 'ho_so_dang_vien.pdf', { type: 'application/pdf' });
    const dt = new DataTransfer(); dt.items.add(file);
    const zone = document.getElementById('compressDropZone');
    zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  })()`);

  await waitFor(cdp, "() => !document.getElementById('compressInfo').classList.contains('hidden')", 15000);
  const info = JSON.parse(await cdp.eval("JSON.stringify({name:document.getElementById('compressMetaName').textContent, pages:document.getElementById('compressMetaPages').textContent, size:document.getElementById('compressMetaSize').textContent, alreadySmallHidden: document.getElementById('compressAlreadySmallNotice').classList.contains('hidden')})"));
  if (!info.pages.includes('18') || !info.alreadySmallHidden) throw new Error('Compress info screen wrong: ' + JSON.stringify(info));
  console.log(`  PASS info screen: ${JSON.stringify(info)}`);

  // Intercept the eventual download <a>.click() to read the output Blob back
  // (blob: URLs stay valid until the 5s revoke timeout in compress-mode.js).
  await cdp.eval("window.__downloads = []; HTMLAnchorElement.prototype.click = function(){ if (this.download && String(this.href).startsWith('blob:')) window.__downloads.push({ href: this.href, download: this.download }); };");

  await cdp.eval("document.getElementById('compressStartBtn').click()");
  try {
    await waitFor(cdp, "() => !document.getElementById('compressResult').classList.contains('hidden')", 240000, 1000);
  } catch (err) {
    const debug = await cdp.eval("JSON.stringify({label: document.getElementById('compressProgressLabel')?.textContent, toast: document.getElementById('toast')?.textContent, resultHidden: document.getElementById('compressResult').classList.contains('hidden')})").catch(() => '(eval failed)');
    console.error('  DEBUG at timeout:', debug, 'console errors:', cdp.errors);
    throw err;
  }

  const result = JSON.parse(await cdp.eval("JSON.stringify({sizes:document.getElementById('compressResultSizes').textContent, checksHtml:document.getElementById('compressResultChecks').innerHTML, noticeHidden:document.getElementById('compressResultNotice').classList.contains('hidden')})"));
  console.log(`  result: ${result.sizes}`);
  if (!/text-success">.*trang/.test(result.checksHtml)) throw new Error('Page-count check row missing/failed: ' + result.checksHtml);

  await cdp.eval("document.getElementById('compressDownloadBtn').click()");
  await waitFor(cdp, "() => window.__downloads && window.__downloads.length === 1", 5000);
  const verified = JSON.parse(await cdp.eval(`(async () => {
    const item = window.__downloads[0];
    const bytes = new Uint8Array(await (await fetch(item.href)).arrayBuffer());
    const source = window.PartyPdf.sourceFromBuffer(bytes, item.download);
    const pageCount = source.pageCount;
    let allPagesReadable = true;
    for (let i = 0; i < pageCount; i++) { try { window.PartyPdf.pageInfo(source, i); } catch (e) { allPagesReadable = false; } }
    return JSON.stringify({ pageCount, bytes: bytes.length, allPagesReadable, startsWithHeader: bytes[0] === 0x25 && bytes[1] === 0x50 });
  })()`, true));
  console.log(`  downloaded PDF: ${JSON.stringify(verified)}`);
  if (verified.pageCount !== 18) throw new Error(`Output page count changed: expected 18, got ${verified.pageCount}`);
  if (!verified.allPagesReadable) throw new Error('Output PDF has a page with unreadable MediaBox/structure');
  if (!verified.startsWithHeader) throw new Error('Output is not a valid PDF (missing %PDF header)');
  if (verified.bytes >= sourceSize) throw new Error(`Output (${verified.bytes}) is not smaller than source (${sourceSize})`);

  if (cdp.errors.length) throw new Error('Console errors during Compress mode run: ' + cdp.errors.join(' | '));
  console.log('PASS Compress mode: >20MB source → compressed, 18/18 pages, no console errors');
}

// Party Mode's default export re-encodes every image page at a fixed
// maxEdge=2200/quality=0.9 (see party-mode.js exportDocument) — unlike the
// Compress mode fixture above, a small noise band survives that re-encode
// as only a few KB, nowhere near 20MB. To actually exercise the ">20MB"
// warning honestly, most of each page here is incompressible noise so the
// *default lossless-image* export itself lands over the threshold.
const BUILD_PARTY_IMAGES_EXPR = `
(async (count) => {
  const files = [];
  for (let i = 0; i < count; i++) {
    const w = 2200, h = 3000;
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    const noise = ctx.createImageData(w, h);
    const total = noise.data.length;
    for (let off = 0; off < total; off += 65536) { const len = Math.min(65536, total - off); crypto.getRandomValues(noise.data.subarray(off, off + len)); }
    for (let p = 3; p < total; p += 4) noise.data[p] = 255;
    ctx.putImageData(noise, 0, 0);
    ctx.strokeStyle = '#c81e2c'; ctx.lineWidth = 14;
    ctx.beginPath(); ctx.arc(w - 380, h - 480, 160, 0, Math.PI * 2); ctx.stroke();
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.95));
    files.push(new File([blob], 'trang-' + (i + 1) + '.jpg', { type: 'image/jpeg' }));
    canvas.width = 0; canvas.height = 0;
  }
  window.__partyFiles = files;
  return files.reduce((sum, f) => sum + f.size, 0);
})`;

async function runPartyLargeFileAcceptance(cdp) {
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
  await waitFor(cdp, "() => document.readyState === 'complete' && !!window.VigilLensParty && !!window.PdfCompress");
  cdp.errors.length = 0;
  await cdp.eval("document.getElementById('modePartyBtn').click()");
  await waitFor(cdp, "() => !document.getElementById('partyEmptyState').classList.contains('hidden')");

  // 10 oversized "photo" pages, mostly incompressible noise so Party's own
  // default (fixed quality 0.9, maxEdge 2200) export lands over 20MB. Fed through Party Mode's own image file input, so its
  // *default lossless* image→JPEG export path (unchanged by this task) is
  // what produces the oversized output — not a copied PDF.
  const sourceTotal = await cdp.eval(`(${BUILD_PARTY_IMAGES_EXPR})(10)`, true);
  console.log(`  party fixture: 10 images, ${(sourceTotal / 1e6).toFixed(1)} MB combined`);

  await cdp.eval(`(() => {
    const dt = new DataTransfer(); window.__partyFiles.forEach(f => dt.items.add(f));
    const input = document.getElementById('partyFileInput');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await waitFor(cdp, "() => document.querySelectorAll('.party-source-pool .party-page').length === 10", 20000);

  await cdp.eval("document.getElementById('partySelectAllBtn').click(); document.getElementById('partyCreateDocBtn').click();");
  await waitFor(cdp, "() => document.querySelectorAll('.party-document').length === 1", 5000);
  const docId = await cdp.eval("document.querySelector('.party-document').dataset.documentId");
  await cdp.eval(`(() => { const input = document.querySelector('[data-type-input="${docId}"]'); input.value = '05'; input.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await new Promise(resolve => setTimeout(resolve, 150));

  await cdp.eval("window.__downloads = []; HTMLAnchorElement.prototype.click = function(){ if (this.download && String(this.href).startsWith('blob:')) window.__downloads.push({ href: this.href, download: this.download }); };");

  await cdp.eval(`document.querySelector('.party-export-doc-btn[data-doc-export="${docId}"]').click()`);
  await waitFor(cdp, "() => document.getElementById('partyLargeFileDialog')?.open === true", 20000);
  console.log('  PASS: >20MB export shows the warning dialog instead of auto-downloading');

  // "Tải bản gốc" — must stay byte-identical to the normal lossless export.
  await cdp.eval("document.getElementById('partyLargeOriginalBtn').click()");
  await waitFor(cdp, "() => window.__downloads.length === 1", 5000);
  const originalDownload = JSON.parse(await cdp.eval(`(async () => {
    const item = window.__downloads[0];
    const bytes = await (await fetch(item.href)).arrayBuffer();
    return JSON.stringify({ size: bytes.byteLength, dialogClosed: document.getElementById('partyLargeFileDialog').open === false });
  })()`, true));
  if (!(originalDownload.size > 20 * 1000 * 1000)) throw new Error('"Tải bản gốc" changed the output — expected the same >20MB lossless blob: ' + JSON.stringify(originalDownload));
  if (!originalDownload.dialogClosed) throw new Error('Dialog did not close after "Tải bản gốc"');
  console.log(`  PASS "Tải bản gốc": ${(originalDownload.size / 1e6).toFixed(1)} MB, unchanged lossless export`);

  // Re-open the dialog and this time take the explicit compress action.
  await cdp.eval(`document.querySelector('.party-export-doc-btn[data-doc-export="${docId}"]').click()`);
  await waitFor(cdp, "() => document.getElementById('partyLargeFileDialog')?.open === true", 20000);
  await cdp.eval("document.getElementById('partyLargeCompressBtn').click()");
  await waitFor(cdp, "() => window.__downloads.length === 2", 180000, 500);
  const compressedDownload = JSON.parse(await cdp.eval(`(async () => {
    const item = window.__downloads[1];
    const bytes = new Uint8Array(await (await fetch(item.href)).arrayBuffer());
    const source = window.PartyPdf.sourceFromBuffer(bytes, item.download);
    return JSON.stringify({ size: bytes.length, pageCount: source.pageCount, dialogClosed: document.getElementById('partyLargeFileDialog').open === false, filename: item.download });
  })()`, true));
  console.log(`  compressed download: ${JSON.stringify(compressedDownload)}`);
  if (compressedDownload.pageCount !== 10) throw new Error(`"Tạo bản dưới 20MB" changed page count: expected 10, got ${compressedDownload.pageCount}`);
  if (compressedDownload.size >= originalDownload.size) throw new Error('"Tạo bản dưới 20MB" did not reduce size');
  if (!compressedDownload.dialogClosed) throw new Error('Dialog did not close after "Tạo bản dưới 20MB"');
  if (!/_duoi-20MB\.pdf$/.test(compressedDownload.filename)) throw new Error('Compressed filename missing the expected suffix: ' + compressedDownload.filename);

  if (cdp.errors.length) throw new Error('Console errors during Party >20MB run: ' + cdp.errors.join(' | '));
  console.log('PASS Party Mode: >20MB warning · "Tải bản gốc" unchanged · "Tạo bản dưới 20MB" via shared PdfCompress engine, 10/10 pages');
}

server.listen(PORT, async () => {
  let chrome;
  try {
    const chromeProfile = path.join(os.tmpdir(), 'chrome_pdf_compress_profile_' + Date.now());
    fs.mkdirSync(chromeProfile, { recursive: true });
    chrome = spawn(browserPath(), [
      '--headless=new', '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--disable-gpu', '--disable-extensions', '--no-first-run', '--no-default-browser-check',
      `--user-data-dir=${chromeProfile}`, `--remote-debugging-port=${CDP_PORT}`,
      '--remote-debugging-address=127.0.0.1', 'about:blank'
    ]);
    const WebSocketClient = globalThis.WebSocket || require('undici').WebSocket;
    const ws = new WebSocketClient(await cdpUrl());
    await new Promise(resolve => { ws.onopen = resolve; });
    const cdp = new CDP(ws);
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });

    await runCompressModeAcceptance(cdp);
    await runPartyLargeFileAcceptance(cdp);

    console.log('\nPDF_COMPRESSION_BROWSER_ACCEPTANCE: PASS (Compress mode + Party Mode >20MB detour)');
    process.exitCode = 0;
  } catch (err) {
    console.error('PDF_COMPRESSION_BROWSER_ACCEPTANCE: FAIL —', err.message);
    process.exitCode = 1;
  } finally {
    if (chrome) chrome.kill('SIGKILL');
    server.close();
  }
});

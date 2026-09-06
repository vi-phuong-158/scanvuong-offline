/* Chromium browser acceptance for the PDF compatibility fallback in
   pdf-compress.js / party-pdf.js (DEV MODE task: "Giảm dung lượng PDF"
   currently hard-fails on a real scan PDF whose content-stream /Length is
   declared a few bytes short of the actual data — root cause identified on
   02.Ly_lich_dang_vien.pdf, error "PDF stream không tìm thấy endstream sau
   declared length"). Same CDP-over-WebSocket harness pattern as
   scripts/acceptance_pdf_compress.cjs — no project dependency.

   The real proprietary scan file is not available to this session/CI, so
   per the task's own instruction (acceptance test C) this builds a
   SYNTHETIC malformed fixture entirely inside the browser: a normal valid
   PDF assembled via the app's own PartyPdf.buildPdf(), then every image
   stream's declared /Length is shortened by exactly 3 bytes (matching the
   reported bug precisely — declared length shorter than actual, real
   stream bytes untouched). This is a faithful repro of the error CLASS
   (findObjectEnd()'s stream-bounds check in party-pdf.js is identical for
   any stream object, image or content stream) even though the concrete
   object here is a DCTDecode image stream rather than a tiny content
   stream — the parser code path does not distinguish between them.

   IMPORTANT — what this script does NOT prove: it cannot substitute for
   running the real 02.Ly_lich_dang_vien.pdf end-to-end (that file was never
   provided to this session). See the final work report for the explicit
   caveat; do not read a PASS here as a PASS on the real file. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8783);
const CDP_PORT = Number(process.env.CDP_PORT || 9233);

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
    if (ok) return;
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timeout waiting for: ${fnExpr}`);
}

// Builds N representative "scan" pages (text-like lines, a red seal, a
// grayscale region, noisy texture) and assembles them into a valid PDF via
// the app's own PartyPdf.buildPdf — same technique as
// scripts/acceptance_pdf_compress.cjs, smaller page count since this test
// targets the compatibility path, not the >20MB threshold.
const BUILD_SOURCE_PDF_EXPR = `
(async (pageCount) => {
  const items = [];
  for (let i = 0; i < pageCount; i++) {
    const w = 1240, h = 1754; // A4 @ ~150dpi — smaller than the >20MB fixture, faster to render
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fdfdfb'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#1a1a1a';
    for (let line = 0; line < 30; line++) {
      const y = 120 + line * 45;
      const segments = 6 + (i + line) % 4;
      for (let s = 0; s < segments; s++) {
        const x = 90 + s * (Math.random() * 30 + 90);
        if (x > w - 120) break;
        ctx.fillRect(x, y, 20 + Math.random() * 80, 10);
      }
    }
    ctx.strokeStyle = '#c81e2c'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(w - 210, h - 260, 90, 0, Math.PI * 2); ctx.stroke();
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    items.push({ bytes, width: w, height: h });
    canvas.width = 0; canvas.height = 0;
  }
  const pdfBlob = window.PartyPdf.buildPdf([], items, {});
  return { blob: pdfBlob, pageCount };
})`;

// Reproduces the exact reported bug: every DCTDecode image stream's
// declared /Length shortened by 3 bytes, real stream bytes untouched. Text
// round-trips through ISO-8859-1 (same decoder party-pdf.js itself uses),
// which is a lossless 1:1 byte<->codepoint mapping, so this only rewrites
// the ASCII digits in each "/Length N" — nothing else in the file changes.
const CORRUPT_DECLARED_LENGTH_EXPR = `
(async (blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const text = new TextDecoder('iso-8859-1').decode(bytes);
  let shortenedCount = 0;
  const corrupted = text.replace(/(\\/Filter \\/DCTDecode \\/Length )(\\d+)( >>\\r?\\nstream\\r?\\n)/g, (full, pre, len, post) => {
    shortenedCount++;
    return pre + (Number(len) - 3) + post;
  });
  const corruptedBytes = Uint8Array.from(corrupted, c => c.charCodeAt(0));
  return { blob: new Blob([corruptedBytes], { type: 'application/pdf' }), shortenedCount };
})`;

async function runCompatFallbackAcceptance(cdp) {
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
  await waitFor(cdp, "() => document.readyState === 'complete' && !!window.PdfCompress && !!window.VigilLensCompress && !!window.PartyPdf");

  const PAGE_COUNT = 10;
  await cdp.eval(`window.__build = (${BUILD_SOURCE_PDF_EXPR})(${PAGE_COUNT}).then(r => { window.__srcPdf = r; return r.blob.size; })`, false);
  const validSize = await cdp.eval('window.__build', true);
  console.log(`  fixture (valid) PDF: ${validSize} bytes, ${PAGE_COUNT} pages`);

  await cdp.eval(`window.__corrupt = (${CORRUPT_DECLARED_LENGTH_EXPR})(window.__srcPdf.blob).then(r => { window.__malformedPdf = r; return r.shortenedCount; })`, false);
  const shortenedCount = await cdp.eval('window.__corrupt', true);
  if (shortenedCount !== PAGE_COUNT) throw new Error(`Expected to shorten ${PAGE_COUNT} stream declarations, shortened ${shortenedCount}`);
  console.log(`  PASS fixture corrupted: ${shortenedCount}/${PAGE_COUNT} stream /Length fields shortened by 3 bytes`);

  // C (part 1): classical parser must still fail closed on this input —
  // proves the fixture reproduces the reported error class AND that the
  // strict classical parser (party-pdf.js) is unmodified/unregressed
  // (Party Mode's lossless page export depends on that strictness).
  const preFixErrorReal = await cdp.eval(`(async () => {
    const bytes = new Uint8Array(await window.__malformedPdf.blob.arrayBuffer());
    try { window.PartyPdf.sourceFromBuffer(bytes, 'x'); return null; }
    catch (err) { return err.message; }
  })()`, true);
  if (!/endstream sau declared length/.test(preFixErrorReal || '')) {
    throw new Error(`Expected classical parser to fail with the reported error, got: ${preFixErrorReal}`);
  }
  console.log(`  PASS pre-fix reproduction: classical parser throws "${preFixErrorReal}"`);

  cdp.errors.length = 0;
  await cdp.eval("document.getElementById('modeCompressBtn').click()");
  await waitFor(cdp, "() => !document.getElementById('compressWorkspace').classList.contains('hidden')");

  // Start polling the progress label BEFORE clicking Start, so the UX text
  // moments ("Đang sửa tương thích…" then "Đã sửa tương thích… Đang tối ưu
  // dung lượng…") are captured even though they appear only briefly.
  await cdp.eval("window.__progressLog = []; window.__progressPoll = setInterval(() => { const t = document.getElementById('compressProgressLabel')?.textContent; if (t) window.__progressLog.push(t); }, 80);");

  await cdp.eval(`(() => {
    const file = new File([window.__malformedPdf.blob], '02.Ly_lich_dang_vien.pdf', { type: 'application/pdf' });
    const dt = new DataTransfer(); dt.items.add(file);
    document.getElementById('compressDropZone').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  })()`);

  await waitFor(cdp, "() => !document.getElementById('compressInfo').classList.contains('hidden')", 15000);
  const info = JSON.parse(await cdp.eval("JSON.stringify({pages:document.getElementById('compressMetaPages').textContent, compatNoticeHidden: document.getElementById('compressCompatNotice')?.classList.contains('hidden')})"));
  console.log(`  info screen: ${JSON.stringify(info)}`);
  if (!info.pages.includes(String(PAGE_COUNT))) throw new Error(`inspectPdf() did not recover the correct page count via the compatibility peek: ${info.pages}`);
  if (info.compatNoticeHidden) throw new Error('Compat notice should be visible on the file-info screen for a malformed PDF (info.compatRequired should be true)');
  console.log('  PASS info screen: correct page count recovered without a full repair render, compat notice shown');

  await cdp.eval("document.getElementById('compressStartBtn').click()");
  try {
    await waitFor(cdp, "() => !document.getElementById('compressResult').classList.contains('hidden')", 120000, 500);
  } catch (err) {
    const debug = await cdp.eval("JSON.stringify({label: document.getElementById('compressProgressLabel')?.textContent, toast: document.getElementById('toast')?.textContent})").catch(() => '(eval failed)');
    console.error('  DEBUG at timeout:', debug, 'console errors:', cdp.errors);
    throw err;
  }
  await cdp.eval('clearInterval(window.__progressPoll)');

  const progressLog = await cdp.eval('JSON.stringify(window.__progressLog)').then(JSON.parse);
  const sawRepairing = progressLog.some(t => /sửa tương thích/i.test(t));
  const sawRepaired = progressLog.some(t => /Đã sửa tương thích/i.test(t) && /tối ưu dung lượng/i.test(t));
  const sawTechnicalJargon = progressLog.some(t => /endstream|declared length|xref|trailer/i.test(t));
  if (!sawRepairing) throw new Error('Never saw the "Đang sửa tương thích…" status while repairing — progress log: ' + JSON.stringify(progressLog.slice(0, 20)));
  if (!sawRepaired) throw new Error('Never saw the "Đã sửa tương thích PDF. Đang tối ưu dung lượng…" transition — progress log: ' + JSON.stringify(progressLog.slice(0, 20)));
  if (sawTechnicalJargon) throw new Error('User-facing progress text leaked technical jargon: ' + JSON.stringify(progressLog));
  console.log('  PASS UX status text: "Đang sửa tương thích…" then "Đã sửa tương thích PDF. Đang tối ưu dung lượng…", no technical jargon shown to the user');

  const result = JSON.parse(await cdp.eval("JSON.stringify({sizes:document.getElementById('compressResultSizes').textContent, checksHtml:document.getElementById('compressResultChecks').innerHTML})"));
  console.log(`  result: ${result.sizes}`);
  if (!new RegExp(`text-success">.*${PAGE_COUNT}/${PAGE_COUNT} trang`).test(result.checksHtml)) {
    throw new Error('Page-count check row missing/failed (page count/order not preserved through the repair): ' + result.checksHtml);
  }

  await cdp.eval("window.__downloads = []; HTMLAnchorElement.prototype.click = function(){ if (this.download && String(this.href).startsWith('blob:')) window.__downloads.push({ href: this.href, download: this.download }); };");
  await cdp.eval("document.getElementById('compressDownloadBtn').click()");
  await waitFor(cdp, "() => window.__downloads && window.__downloads.length === 1", 5000);
  const verified = JSON.parse(await cdp.eval(`(async () => {
    const item = window.__downloads[0];
    const bytes = new Uint8Array(await (await fetch(item.href)).arrayBuffer());
    const source = window.PartyPdf.sourceFromBuffer(bytes, item.download);
    const pageCount = source.pageCount;
    let allPagesReadable = true;
    for (let i = 0; i < pageCount; i++) { try { window.PartyPdf.pageInfo(source, i); } catch (e) { allPagesReadable = false; } }
    return JSON.stringify({ pageCount, allPagesReadable, startsWithHeader: bytes[0] === 0x25 && bytes[1] === 0x50 });
  })()`, true));
  console.log(`  downloaded PDF re-parsed by the app's own strict parser: ${JSON.stringify(verified)}`);
  if (verified.pageCount !== PAGE_COUNT) throw new Error(`Output page count changed: expected ${PAGE_COUNT}, got ${verified.pageCount}`);
  if (!verified.allPagesReadable) throw new Error('Output PDF has a page with unreadable MediaBox/structure');
  if (!verified.startsWithHeader) throw new Error('Output is not a valid PDF (missing %PDF header)');

  if (cdp.errors.length) throw new Error('Console errors during compatibility-fallback run: ' + cdp.errors.join(' | '));
  console.log(`PASS Compatibility fallback: malformed synthetic PDF (declared /Length short by 3 bytes on ${PAGE_COUNT}/${PAGE_COUNT} streams) → repaired → compressed → ${PAGE_COUNT}/${PAGE_COUNT} pages, output re-opens cleanly, no console errors`);
}

// Requirement B: a NORMAL (well-formed) PDF must still take the fast path
// unchanged — compatRepaired must be false, and it must not pay for a
// PDF.js repair render it doesn't need.
async function runNormalPathRegressionAcceptance(cdp) {
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
  await waitFor(cdp, "() => document.readyState === 'complete' && !!window.PdfCompress && !!window.PartyPdf");

  const outcome = JSON.parse(await cdp.eval(`(async () => {
    const built = await (${BUILD_SOURCE_PDF_EXPR})(3);
    const result = await window.PdfCompress.compressPdf(built.blob);
    return JSON.stringify({ compatRepaired: result.compatRepaired, pageCount: result.pageCount });
  })()`, true));
  console.log(`  normal PDF result: ${JSON.stringify(outcome)}`);
  if (outcome.compatRepaired !== false) throw new Error('A well-formed PDF incorrectly took the compatibility-repair path');
  if (outcome.pageCount !== 3) throw new Error(`Normal path page count wrong: expected 3, got ${outcome.pageCount}`);
  console.log('PASS Normal-path regression: well-formed PDF takes the unchanged fast path (compatRepaired:false), no unnecessary rasterize/rebuild');
}

// "Chỉ báo lỗi nếu cả normal parser và compatibility fallback đều không thể
// đọc/render tài liệu" — and the error shown must be a plain, non-technical
// message (no endstream/xref/declared-length jargon).
async function runBothFailAcceptance(cdp) {
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
  await waitFor(cdp, "() => document.readyState === 'complete' && !!window.PdfCompress");

  const outcome = JSON.parse(await cdp.eval(`(async () => {
    // A PDF header followed by nothing parseable as an object AND nothing
    // pdf.js can recover a page from either. Raced against a manual timeout
    // in-page (rather than relying on the CDP round-trip alone) in case
    // pdf.js's own recovery logic stalls on such minimal input.
    const bytes = new TextEncoder().encode('%PDF-1.4\\n%garbage, no objects, no xref, no pages\\n%%EOF');
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('__TIMEOUT__')), 15000));
    try {
      await Promise.race([window.PdfCompress.compressPdf({ arrayBuffer: async () => bytes.buffer }), timeout]);
      return JSON.stringify({ threw: false });
    } catch (err) {
      return JSON.stringify({ threw: true, message: err.message });
    }
  })()`, true));
  console.log(`  both-parsers-fail outcome: ${JSON.stringify(outcome)}`);
  if (!outcome.threw) throw new Error('Expected compressPdf() to fail closed when neither parser can read the file');
  if (outcome.message === '__TIMEOUT__') throw new Error('compressPdf() hung instead of failing closed on unreadable input (pdf.js repair path never settled)');
  if (/endstream|declared length|xref|trailer|obj\\b/i.test(outcome.message)) {
    throw new Error('User-facing error message leaked technical PDF jargon: ' + outcome.message);
  }
  console.log('PASS Both-parsers-fail: fails closed with a plain, non-technical message: "' + outcome.message + '"');
}

server.listen(PORT, async () => {
  let chrome;
  try {
    const chromeProfile = path.join(os.tmpdir(), 'chrome_pdf_compat_profile_' + Date.now());
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

    await runCompatFallbackAcceptance(cdp);
    await runNormalPathRegressionAcceptance(cdp);
    await runBothFailAcceptance(cdp);

    console.log('\nPDF_COMPAT_FALLBACK_BROWSER_ACCEPTANCE: PASS (synthetic malformed fixture only — see script header, real 02.Ly_lich_dang_vien.pdf not available to this session)');
    process.exitCode = 0;
  } catch (err) {
    console.error('PDF_COMPAT_FALLBACK_BROWSER_ACCEPTANCE: FAIL —', err.message);
    process.exitCode = 1;
  } finally {
    if (chrome) chrome.kill('SIGKILL');
    server.close();
  }
});

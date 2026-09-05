#!/usr/bin/env node
'use strict';
// Real-browser acceptance for the Scan ID flow driven with a PHONE-SIZED photo
// (long edge well past MAX_DECODE_EDGE), i.e. the input that produced
// "Không xuất được PDF: The source image cannot be decoded." with a blank A4
// preview. Same harness shape as acceptance_offline_pwa.cjs: a local static
// server injects a driver script into index.html, real headless Chromium runs
// the real app, and the page POSTs its findings back.
//
// Gates:
//   SCAN_ID_OVERSIZED_PREVIEW_PASS — the A4 preview actually renders both
//     sides (not the blank stage the defect produced).
//   SCAN_ID_OVERSIZED_EXPORT_PASS — Export produces a real PDF: exactly one
//     A4-portrait page, no error notice.
//   SCAN_ID_PAGE_ORDER_PASS — front is the TOP card and back the BOTTOM one,
//     and neither is flipped or mirrored (asymmetric markers land where they
//     were drawn: front's marker upper-left, back's lower-right).
//   NO_CONSOLE_ERROR_PASS — the flow raises no page error.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8771;
const PROFILE_DIR = path.join(os.tmpdir(), 'vigil_lens_scan_id_photo_' + Date.now());
fs.mkdirSync(PROFILE_DIR, { recursive: true });

function findBrowser() {
  const explicit = [process.env.CHROME_PATH, process.env.CHROMIUM_PATH].filter(Boolean);
  for (const p of explicit) if (fs.existsSync(p)) return p;
  const bundled = [
    '/opt/pw-browsers/chromium/chrome-linux/chrome',
    ...(fs.existsSync('/opt/pw-browsers')
      ? fs.readdirSync('/opt/pw-browsers')
          .filter(d => d.startsWith('chromium-'))
          .map(d => path.join('/opt/pw-browsers', d, 'chrome-linux', 'chrome'))
      : []),
  ];
  for (const p of bundled) if (fs.existsSync(p)) return p;
  for (const b of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    try {
      const res = execSync(`which ${b}`, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }).trim().split(/\r?\n/)[0];
      if (res && fs.existsSync(res)) return res;
    } catch (e) {}
  }
  throw new Error('No Chrome / Chromium binary found. Set CHROME_PATH.');
}

let reportResolve = null;
function handleReport(report) {
  if (reportResolve) { const r = reportResolve; reportResolve = null; r(report); }
}

const injectedScript = `
<script>
(function () {
  if (!new URLSearchParams(location.search).has('acceptance_scan_id_photo')) return;

  const results = { errors: [] };
  window.onerror = (m) => { results.errors.push(String(m)); };
  window.addEventListener('unhandledrejection', (e) => { results.errors.push('unhandledrejection: ' + (e.reason && e.reason.message || e.reason)); });

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const $ = (id) => document.getElementById(id);

  // A camera-sized card photo: the card fills the frame (so the result does not
  // depend on corner detection quality) and carries ONE asymmetric dark marker,
  // which is what makes a flip or a mirror visible.
  async function makePhoto(markerCorner) {
    const W = 6000, H = Math.round(6000 / 1.586);
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#b0b0b0'; ctx.lineWidth = 12; ctx.strokeRect(6, 6, W - 12, H - 12);
    const mw = Math.round(W * 0.15), mh = Math.round(H * 0.15);
    const mx = markerCorner === 'tl' ? Math.round(W * 0.10) : Math.round(W * 0.75);
    const my = markerCorner === 'tl' ? Math.round(H * 0.10) : Math.round(H * 0.75);
    ctx.fillStyle = '#000000'; ctx.fillRect(mx, my, mw, mh);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));
    return { blob, width: W, height: H };
  }

  function setFile(inputId, file) {
    const dt = new DataTransfer();
    dt.items.add(file);
    $(inputId).files = dt.files;
    $(inputId).dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function untilIdle(timeoutMs) {
    const t0 = performance.now();
    while (performance.now() - t0 < timeoutMs) {
      if (!$('processingOverlay').classList.contains('hidden')) { await sleep(120); continue; }
      return true;
    }
    return false;
  }

  // Centroid of the dark marker inside one half of the rendered A4 page, in
  // coordinates normalised to that half (0..1). Null when the half has no card.
  function markerCentroid(data, w, box, yFrom, yTo) {
    let sx = 0, sy = 0, n = 0, white = 0;
    for (let y = yFrom; y < yTo; y++) {
      for (let x = box.x0; x <= box.x1; x++) {
        const i = (y * w + x) * 4;
        const lum = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
        if (lum > 200) white++;
        if (lum < 70) { sx += x; sy += y; n++; }
      }
    }
    if (n < 50) return null;
    return {
      x: (sx / n - box.x0) / Math.max(1, box.x1 - box.x0),
      y: (sy / n - yFrom) / Math.max(1, yTo - yFrom),
      darkPixels: n, whitePixels: white,
    };
  }

  async function run() {
    try {
      const t0 = performance.now();
      while (typeof window.DocumentDetector === 'undefined' && performance.now() - t0 < 8000) await sleep(50);

      // Capture the exported PDF without touching app code.
      const realCreate = URL.createObjectURL.bind(URL);
      let pdfBlob = null;
      URL.createObjectURL = (blob) => { if (blob && blob.type === 'application/pdf') pdfBlob = blob; return realCreate(blob); };

      const front = await makePhoto('tl');
      const back = await makePhoto('br');
      results.sourcePixels = front.width + 'x' + front.height;

      $('modeIdBtn').click();
      await sleep(200);

      setFile('idFileInput', new File([front.blob], 'front.jpg', { type: 'image/jpeg' }));
      results.frontSettled = await untilIdle(30000);
      results.frontCaptured = !$('idConfirmBtn').disabled;
      $('idConfirmBtn').click();
      await sleep(300);

      setFile('idFileInput', new File([back.blob], 'back.jpg', { type: 'image/jpeg' }));
      results.backSettled = await untilIdle(30000);
      results.backCaptured = !$('idConfirmBtn').disabled;
      $('idConfirmBtn').click();
      await untilIdle(30000);
      await sleep(500);

      results.previewVisible = !$('idPreviewSection').classList.contains('hidden');
      results.noticeAfterPreview = $('idExportNotice').classList.contains('hidden') ? '' : $('idExportNotice').textContent;

      // --- Preview pixel analysis ---
      const pc = $('idPreviewCanvas');
      const pctx = pc.getContext('2d');
      const img = pctx.getImageData(0, 0, pc.width, pc.height);
      const d = img.data;
      let x0 = pc.width, x1 = -1, y0 = pc.height, y1 = -1;
      for (let y = 0; y < pc.height; y++) {
        for (let x = 0; x < pc.width; x++) {
          const i = (y * pc.width + x) * 4;
          const lum = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
          if (lum > 200) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        }
      }
      results.pageBox = { x0, x1, y0, y1 };
      results.pageFound = x1 > x0 && y1 > y0;
      if (results.pageFound) {
        const mid = Math.round((y0 + y1) / 2);
        results.topMarker = markerCentroid(d, pc.width, { x0, x1 }, y0, mid);
        results.bottomMarker = markerCentroid(d, pc.width, { x0, x1 }, mid, y1);
      }

      // --- Export ---
      $('idExportBtn').click();
      const tExport = performance.now();
      while (!pdfBlob && performance.now() - tExport < 40000) await sleep(150);
      results.exportNotice = $('idExportNotice').classList.contains('hidden') ? '' : $('idExportNotice').textContent;
      results.progressLabel = $('idProgressLabel').textContent;

      if (pdfBlob) {
        results.pdfSize = pdfBlob.size;
        const buf = new Uint8Array(await pdfBlob.arrayBuffer());
        let bin = '';
        for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
        results.pdfBase64 = btoa(bin);
      }
    } catch (err) {
      results.errors.push('driver: ' + (err && err.stack || err));
    }
    await fetch('/api/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(results) });
  }

  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', run);
  else run();
})();
</script>
`;

function createServer() {
  return http.createServer((req, res) => {
    const reqUrl = new URL(req.url, `http://127.0.0.1:${PORT}`);
    if (req.method === 'POST' && reqUrl.pathname === '/api/report') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
        handleReport(JSON.parse(body));
      });
      return;
    }
    const rel = reqUrl.pathname.replace(/^\/+/, '') || 'index.html';
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404); res.end('not found'); return;
    }
    let mime = 'text/plain';
    if (file.endsWith('.html')) mime = 'text/html; charset=utf-8';
    else if (file.endsWith('.js') || file.endsWith('.mjs') || file.endsWith('.cjs')) mime = 'application/javascript; charset=utf-8';
    else if (file.endsWith('.css')) mime = 'text/css; charset=utf-8';
    else if (file.endsWith('.json') || file.endsWith('.webmanifest')) mime = 'application/json; charset=utf-8';
    else if (file.endsWith('.wasm')) mime = 'application/wasm';
    else if (file.endsWith('.ort')) mime = 'application/octet-stream';
    else if (file.endsWith('.png')) mime = 'image/png';
    else if (file.endsWith('.woff2')) mime = 'font/woff2';
    res.writeHead(200, { 'Content-Type': mime, 'Service-Worker-Allowed': '/' });
    if (file.endsWith('.html')) {
      res.end(fs.readFileSync(file, 'utf8').replace('</body>', `${injectedScript}</body>`));
    } else {
      fs.createReadStream(file).pipe(res);
    }
  });
}

function parsePdfPages(buf) {
  const text = buf.toString('latin1');
  const pagesMatch = text.match(/\/Type\s*\/Pages[\s\S]*?\/Kids\s*\[([^\]]*)\]/);
  if (!pagesMatch) throw new Error('Pages object not found in PDF');
  const kids = [...pagesMatch[1].matchAll(/(\d+)\s+0\s+R/g)].map(m => +m[1]);
  return kids.map(pageNum => {
    const objMatch = text.match(new RegExp(`(?:^|\\n)${pageNum} 0 obj\\n([\\s\\S]*?)\\nendobj`));
    if (!objMatch) throw new Error(`page object ${pageNum} not found`);
    const mb = objMatch[1].match(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/);
    return { w: mb ? +mb[3] - +mb[1] : null, h: mb ? +mb[4] - +mb[2] : null };
  });
}

let checks = 0, failures = 0;
function assert(cond, msg) {
  checks++;
  if (!cond) { failures++; console.error(`  ✗ ${msg}`); } else console.log(`  ✓ ${msg}`);
}

async function main() {
  const browserBin = findBrowser();
  console.log(`Browser: ${browserBin}`);
  const server = createServer();
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));

  const reportPromise = new Promise(r => { reportResolve = r; });
  const proc = spawn(browserBin, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--no-default-browser-check', '--disable-dev-shm-usage',
    `--user-data-dir=${PROFILE_DIR}`,
    `http://127.0.0.1:${PORT}/?acceptance_scan_id_photo=1`,
  ], { stdio: 'ignore' });

  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('browser did not report within 150s')), 150000));
  let report;
  try { report = await Promise.race([reportPromise, timeout]); }
  finally {
    try { proc.kill('SIGKILL'); } catch (e) {}
    // The browser can leave a keep-alive socket behind; without dropping it the
    // server never finishes closing and the harness hangs after reporting.
    server.closeAllConnections?.();
    server.close();
  }

  console.log(`\nSource photo: ${report.sourcePixels} (long edge > MAX_DECODE_EDGE)\n`);

  console.log('SCAN_ID_OVERSIZED_PREVIEW_PASS');
  assert(report.frontCaptured === true, 'front side accepted from an oversized phone photo');
  assert(report.backCaptured === true, 'back side accepted from an oversized phone photo');
  assert(report.previewVisible === true, 'the A4 preview step is reached');
  assert(report.noticeAfterPreview === '', `no preview error notice (got "${report.noticeAfterPreview}")`);
  assert(report.pageFound === true, 'the A4 page is actually painted on the preview stage (not blank)');

  console.log('\nSCAN_ID_PAGE_ORDER_PASS');
  const top = report.topMarker, bottom = report.bottomMarker;
  assert(!!top, 'the top half of the page carries a rendered card');
  assert(!!bottom, 'the bottom half of the page carries a rendered card');
  if (top && bottom) {
    assert(top.x < 0.45, `front (top card) keeps its marker on the LEFT — no mirror (x=${top.x.toFixed(3)})`);
    assert(top.y < 0.55, `front (top card) keeps its marker in the UPPER part — no flip (y=${top.y.toFixed(3)})`);
    assert(bottom.x > 0.55, `back (bottom card) keeps its marker on the RIGHT — no mirror (x=${bottom.x.toFixed(3)})`);
    assert(bottom.y > 0.45, `back (bottom card) keeps its marker in the LOWER part — no flip (y=${bottom.y.toFixed(3)})`);
  }

  console.log('\nSCAN_ID_OVERSIZED_EXPORT_PASS');
  assert(report.exportNotice === '', `Export raised no error notice (got "${report.exportNotice}")`);
  assert(!!report.pdfBase64, 'Export produced a PDF blob');
  if (report.pdfBase64) {
    const buf = Buffer.from(report.pdfBase64, 'base64');
    assert(buf.slice(0, 5).toString('latin1') === '%PDF-', 'the blob is a real PDF');
    const pages = parsePdfPages(buf);
    assert(pages.length === 1, `exactly one page (got ${pages.length})`);
    if (pages.length === 1) {
      assert(Math.abs(pages[0].w - 595.28) < 1 && Math.abs(pages[0].h - 841.89) < 1,
        `the page is A4 portrait (got ${pages[0].w}x${pages[0].h})`);
    }
    console.log(`  · PDF size: ${(buf.length / 1024).toFixed(1)} KB · ${report.progressLabel}`);
  }

  console.log('\nNO_CONSOLE_ERROR_PASS');
  assert(report.errors.length === 0, `no page errors during the flow (${JSON.stringify(report.errors)})`);

  console.log(`\n${checks - failures}/${checks} checks passed.`);
  if (failures) { console.error('Scan ID oversized-photo acceptance FAILED.'); process.exit(1); }
  console.log('Scan ID oversized-photo acceptance PASSED.');
  process.exit(0);
}

main().catch(err => { console.error('Acceptance harness crashed:', err); process.exit(1); });

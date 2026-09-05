#!/usr/bin/env node
'use strict';
// Real-browser acceptance for the "Hướng dẫn" (Help) information
// architecture. Same harness shape as acceptance_scan_id_photo.cjs: a local
// static server injects a driver script into the real index.html, real
// headless Chromium runs the real app/CSS, and the page POSTs its findings
// back. The Node-only regression_help_ia.js proves the JS state machine;
// this proves the actual rendered layout — real CSS, real <dialog>/<details>
// browser behavior, real mobile viewport overflow — none of which a fake-DOM
// harness can see.
//
// Gates:
//   HELP_GLOBAL_ENTRY_PASS — #helpBtn is visible and clickable on the
//     mode-select screen without entering any mode, and opens #helpDialog.
//   HELP_NOT_PARTY_OWNED_PASS — #partyHelpDialog no longer exists in the DOM;
//     the old Party-internal dialog is gone, not just hidden.
//   HELP_PARTY_DEEPLINK_PASS — clicking "Xem hướng dẫn Scan hồ sơ Đảng" from
//     inside Party mode opens the SAME #helpDialog with #helpSectionParty
//     expanded and scrolled near the top of the visible content.
//   HELP_MOBILE_NO_OVERFLOW_PASS — at 360x800 and 390x844, neither the
//     topbar nor the open Help dialog causes horizontal page overflow.
//   HELP_SESSION_PRESERVED_PASS — opening and closing Help while a Document
//     scan session has a page loaded does not lose that page.
//   NO_CONSOLE_ERROR_PASS — the whole flow raises no page error.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8772;
const CDP_PORT = 9232;
const PROFILE_DIR = path.join(os.tmpdir(), 'vigil_lens_help_ui_' + Date.now());
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

// CDP with a precise Emulation.setDeviceMetricsOverride set BEFORE navigation
// is the only way this environment reports an accurate window.innerWidth for
// a narrow viewport — launching Chrome headless with --window-size alone was
// measured to land at ~500px real innerWidth regardless of the requested
// width (a headless quirk of this bundled Chromium), which would have made
// every overflow check here a false pass. Same technique already proven
// correct in scripts/acceptance_party_ui.cjs.
class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.onmessage = event => {
      const data = JSON.parse(event.data);
      const item = this.pending.get(data.id);
      if (item) { this.pending.delete(data.id); data.error ? item.reject(new Error(data.error.message)) : item.resolve(data.result); }
    };
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}
async function cdpUrl() {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      const list = await r.json();
      const page = list.find(t => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch (e) {}
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error('CDP endpoint did not come up');
}

const injectedScript = `
<script>
(function () {
  if (!new URLSearchParams(location.search).has('acceptance_help_ui')) return;

  const results = { errors: [] };
  window.onerror = (m) => { results.errors.push(String(m)); };
  window.addEventListener('unhandledrejection', (e) => { results.errors.push('unhandledrejection: ' + (e.reason && e.reason.message || e.reason)); });
  window.confirm = () => true;

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const $ = (id) => document.getElementById(id);
  const noOverflow = () => document.documentElement.scrollWidth <= window.innerWidth + 1;

  async function makePhoto() {
    const c = document.createElement('canvas');
    c.width = 1200; c.height = 1600;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 1200, 1600);
    ctx.strokeStyle = '#999'; ctx.lineWidth = 6; ctx.strokeRect(4, 4, 1192, 1592);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
    return new File([blob], 'help_ui_test.jpg', { type: 'image/jpeg' });
  }

  function setFile(inputId, file) {
    const dt = new DataTransfer();
    dt.items.add(file);
    $(inputId).files = dt.files;
    $(inputId).dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function run() {
    try {
      results.helpBtnExistsOnModeSelect = !!$('helpBtn') && !$('helpBtn').classList.contains('hidden');
      const helpBtnRect = $('helpBtn').getBoundingClientRect();
      results.helpBtnSize = { w: helpBtnRect.width, h: helpBtnRect.height };
      results.stateModeBeforeHelp = 'unknown';

      // --- HELP_GLOBAL_ENTRY_PASS: open from the mode-select screen ---
      $('helpBtn').click();
      await sleep(150);
      results.helpDialogOpenFromHome = $('helpDialog').open === true;
      results.modeSelectStillHidden = $('modeSelect').classList.contains('hidden');
      $('helpClose').click();
      await sleep(100);
      results.helpDialogClosedAfterClose = $('helpDialog').open === false;
      results.backOnModeSelect = !$('modeSelect').classList.contains('hidden');

      // --- HELP_NOT_PARTY_OWNED_PASS ---
      results.oldPartyDialogGone = !document.getElementById('partyHelpDialog');

      // --- HELP_PARTY_DEEPLINK_PASS: enter Party, use the toolbar shortcut ---
      $('modePartyBtn').click();
      await sleep(200);
      $('partyHelpLinkToolbar').click();
      await sleep(200);
      results.deeplinkOpenedGlobalDialog = $('helpDialog').open === true;
      results.deeplinkExpandedPartySection = $('helpSectionParty').open === true;
      const partyRect = $('helpSectionParty').getBoundingClientRect();
      results.deeplinkScrolledNearTop = partyRect.top >= -40 && partyRect.top <= 260;
      $('helpClose').click();
      await sleep(100);

      // Leave Party back to mode-select for the next checks.
      $('switchModeBtn').click();
      await sleep(150);

      // --- HELP_MOBILE_NO_OVERFLOW_PASS ---
      results.innerWidth = window.innerWidth;
      results.noOverflowClosed360 = noOverflow();
      $('helpBtn').click();
      await sleep(150);
      results.noOverflowOpen360 = noOverflow();
      $('helpClose').click();
      await sleep(100);

      // --- HELP_SESSION_PRESERVED_PASS ---
      $('modeDocBtn').click();
      await sleep(150);
      const file = await makePhoto();
      setFile('fileInput', file);
      const t0 = performance.now();
      while (!$('processingOverlay').classList.contains('hidden') && performance.now() - t0 < 15000) await sleep(100);
      await sleep(200);
      results.pageCountBefore = $('pageCount').textContent;
      $('helpBtn').click();
      await sleep(150);
      results.stillDocModeWhileHelpOpen = !$('workspace').classList.contains('hidden') || $('helpDialog').open === true;
      $('helpClose').click();
      await sleep(100);
      results.pageCountAfter = $('pageCount').textContent;
      results.workspaceStillVisible = !$('workspace').classList.contains('hidden');
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

let checks = 0, failures = 0;
function assert(cond, msg) {
  checks++;
  if (!cond) { failures++; console.error(`  ✗ ${msg}`); } else console.log(`  ✓ ${msg}`);
}

async function runAtViewport(cdp, width, height) {
  const reportPromise = new Promise(r => { reportResolve = r; });
  // Order matters: the metrics override must be set before Page.navigate so
  // the page's very first layout pass — and therefore window.innerWidth for
  // the whole run — reflects the requested viewport, not whatever size the
  // browser process started at.
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/?acceptance_help_ui=1` });
  return Promise.race([
    reportPromise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`browser did not report within 60s at ${width}x${height}`)), 60000)),
  ]);
}

async function main() {
  const browserBin = findBrowser();
  console.log(`Browser: ${browserBin}`);
  const server = createServer();
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));

  let report, report360;
  const proc = spawn(browserBin, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--no-default-browser-check', '--disable-dev-shm-usage', '--disable-extensions',
    `--remote-debugging-port=${CDP_PORT}`, '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${PROFILE_DIR}`,
    'about:blank',
  ], { stdio: 'ignore' });
  try {
    const ws = new WebSocket(await cdpUrl());
    await new Promise(r => { ws.onopen = r; });
    const cdp = new CDP(ws);
    await cdp.send('Page.enable');
    report = await runAtViewport(cdp, 390, 844);
    report360 = await runAtViewport(cdp, 360, 800);
  } finally {
    try { proc.kill('SIGKILL'); } catch (e) {}
    server.closeAllConnections?.();
    server.close();
  }

  console.log('\nHELP_GLOBAL_ENTRY_PASS');
  assert(report.helpBtnExistsOnModeSelect === true, 'helpBtn exists and is visible on the mode-select screen');
  assert(report.helpBtnSize.h >= 43.5, `helpBtn meets the 44px touch-target height (got ${report.helpBtnSize.h}px)`);
  assert(report.helpDialogOpenFromHome === true, 'clicking helpBtn from mode-select opens helpDialog');
  assert(report.modeSelectStillHidden === false, 'the mode-select screen is not hidden/replaced by opening Help');
  assert(report.helpDialogClosedAfterClose === true, 'helpDialog closes via the Đóng button');
  assert(report.backOnModeSelect === true, 'mode-select is visible again after closing Help');

  console.log('\nHELP_NOT_PARTY_OWNED_PASS');
  assert(report.oldPartyDialogGone === true, '#partyHelpDialog no longer exists in the DOM at all');

  console.log('\nHELP_PARTY_DEEPLINK_PASS');
  assert(report.deeplinkOpenedGlobalDialog === true, '"Xem hướng dẫn" from inside Party mode opens the SAME global #helpDialog');
  assert(report.deeplinkExpandedPartySection === true, 'the deep link expands #helpSectionParty (not left collapsed)');
  assert(report.deeplinkScrolledNearTop === true, `the expanded Party section actually scrolls into view (top=${report.deeplinkScrolledNearTop})`);

  console.log('\nHELP_MOBILE_NO_OVERFLOW_PASS (390x844)');
  assert(Math.abs(report.innerWidth - 390) <= 5, `the viewport really is ~390px wide, not a headless fallback size (got ${report.innerWidth}px)`);
  assert(report.noOverflowClosed360 === true, 'no horizontal page overflow with Help closed');
  assert(report.noOverflowOpen360 === true, 'no horizontal page overflow with Help open');

  console.log('\nHELP_MOBILE_NO_OVERFLOW_PASS (360x800)');
  assert(Math.abs(report360.innerWidth - 360) <= 5, `the viewport really is ~360px wide, not a headless fallback size (got ${report360.innerWidth}px)`);
  assert(report360.noOverflowClosed360 === true, 'no horizontal page overflow with Help closed');
  assert(report360.noOverflowOpen360 === true, 'no horizontal page overflow with Help open');
  assert(report360.errors.length === 0, `no page errors at 360x800 (${JSON.stringify(report360.errors)})`);

  console.log('\nHELP_SESSION_PRESERVED_PASS');
  assert(report.pageCountBefore && report.pageCountBefore !== '0 trang', `a page was loaded into Document mode before opening Help (got "${report.pageCountBefore}")`);
  assert(report.stillDocModeWhileHelpOpen === true, 'Document workspace/session is untouched while Help is open on top of it');
  assert(report.workspaceStillVisible === true, 'back on the Document workspace after closing Help');
  assert(report.pageCountAfter === report.pageCountBefore, `the page count is unchanged after opening and closing Help (before "${report.pageCountBefore}", after "${report.pageCountAfter}")`);

  console.log('\nNO_CONSOLE_ERROR_PASS');
  assert(report.errors.length === 0, `no page errors during the flow (${JSON.stringify(report.errors)})`);

  console.log(`\n${checks - failures}/${checks} checks passed.`);
  if (failures) { console.error('Help UI acceptance FAILED.'); process.exit(1); }
  console.log('Help UI acceptance PASSED.');
  process.exit(0);
}

main().catch(err => { console.error('Acceptance harness crashed:', err); process.exit(1); });

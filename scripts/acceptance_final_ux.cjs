'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'screenshots');
const PORT = 8781;
const CDP_PORT = 9235;
const PROFILE = path.join(os.tmpdir(), `vigil-lens-final-ux-${Date.now()}`);
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(PROFILE, { recursive: true });

function browserPath() {
  const explicit = process.env.CHROME_PATH;
  const candidates = [
    explicit,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);
  const found = candidates.find(p => fs.existsSync(p));
  if (found) return found;
  throw new Error('No local Chrome or Edge executable found.');
}

function syntheticPdf(pageCount = 2) {
  const objects = [];
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  const kids = Array.from({ length: pageCount }, (_, i) => `${3 + i * 2} 0 R`).join(' ');
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`);
  for (let i = 0; i < pageCount; i++) {
    const pageNo = 3 + i * 2;
    const contentNo = pageNo + 1;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${3 + pageCount * 2} 0 R >> >> /Contents ${contentNo} 0 R >>`);
    const text = `BT /F1 22 Tf 72 700 Td (Vigil Lens test page ${i + 1}) Tj 0 -36 Td 12 Tf (Synthetic local fixture - no personal data) Tj ET`;
    objects.push(`<< /Length ${text.length} >>\nstream\n${text}\nendstream`);
  }
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((body, i) => { offsets.push(Buffer.byteLength(pdf, 'latin1')); pdf += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return pdf;
}

const injected = `<script>
(async function () {
  const q = new URLSearchParams(location.search);
  const shot = q.get('shot');
  if (!shot) return;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const $ = id => document.getElementById(id);
  const waitFor = async (fn, timeout = 15000) => {
    const end = performance.now() + timeout;
    while (performance.now() < end) { if (fn()) return; await sleep(100); }
    throw new Error('Timed out waiting for ' + shot);
  };
  const setFile = (id, file) => {
    const dt = new DataTransfer(); dt.items.add(file); $(id).files = dt.files;
    $(id).dispatchEvent(new Event('change', { bubbles: true }));
  };
  const pdfBytes = ${JSON.stringify(Buffer.from(syntheticPdf(3), 'latin1').toString('base64'))};
  const fixture = () => new File([Uint8Array.from(atob(pdfBytes), c => c.charCodeAt(0))], 'vigil-lens-synthetic.pdf', { type: 'application/pdf' });
  try {
    await document.fonts.ready;
    if (shot === 'party-empty' || shot === 'party-preview') {
      $('modePartyBtn').click(); await sleep(300);
      if (shot === 'party-preview') {
        $('partyPdfBtn').click(); await sleep(100);
        setFile('partyPdfInput', fixture());
        await waitFor(() => document.querySelectorAll('#partySourceRail .party-page').length === 3);
        await sleep(500);
      }
    } else if (shot === 'footer') {
      $('modeWatermarkBtn').click(); await sleep(300);
      setFile('watermarkFileInput', fixture());
      await waitFor(() => !$('watermarkResult').classList.contains('hidden'), 20000);
      await sleep(300);
    } else if (shot === 'help') {
      $('helpBtn').click(); await waitFor(() => $('helpDialog').open === true);
    }
    window.__SHOT_READY = true;
  } catch (e) { window.__SHOT_ERROR = String(e && e.stack || e); window.__SHOT_READY = true; }
})();
</script>`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  let rel = decodeURIComponent(url.pathname.replace(/^\/+/, '') || 'index.html');
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('not found'); return; }
  const ext = path.extname(file).toLowerCase();
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/json', '.wasm': 'application/wasm', '.ort': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.woff2': 'font/woff2' }[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': mime, 'Service-Worker-Allowed': '/' });
  if (ext === '.html') res.end(fs.readFileSync(file, 'utf8').replace('</body>', injected + '</body>'));
  else fs.createReadStream(file).pipe(res);
});

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); ws.onmessage = e => { const m = JSON.parse(e.data); const p = this.pending.get(m.id); if (!p) return; this.pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }; }
  send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++this.id; this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  async eval(expression) { const r = await this.send('Runtime.evaluate', { expression, returnByValue: true }); return r.result && r.result.value; }
}

async function wsUrl() {
  for (let i = 0; i < 120; i++) { try { const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json(); const page = list.find(t => t.type === 'page'); if (page) return page.webSocketDebuggerUrl; } catch (_) {} await new Promise(r => setTimeout(r, 100)); }
  throw new Error('Chrome CDP endpoint did not start.');
}

async function main() {
  const browser = browserPath();
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const proc = spawn(browser, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check', '--disable-dev-shm-usage', `--remote-debugging-port=${CDP_PORT}`, '--remote-debugging-address=127.0.0.1', `--user-data-dir=${PROFILE}`, 'about:blank'], { stdio: 'ignore' });
  try {
    const ws = new WebSocket(await wsUrl()); await new Promise(r => { ws.onopen = r; });
    const cdp = new CDP(ws); await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
    const states = [
      ['home-desktop', 1440, 900, false],
      ['home-mobile', 390, 844, true],
      ['party-empty', 390, 844, true],
      ['party-preview', 1440, 900, false],
      ['footer', 1440, 900, false],
      ['help', 390, 844, true],
    ];
    for (const [name, width, height, mobile] of states) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
      await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/?shot=${name}` });
      for (let i = 0; i < 200; i++) { if (await cdp.eval('window.__SHOT_READY === true')) break; await new Promise(r => setTimeout(r, 100)); }
      const error = await cdp.eval('window.__SHOT_ERROR || ""'); if (error) throw new Error(`${name}: ${error}`);
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const out = path.join(OUT, `${name === 'party-empty' ? 'party-scan-empty' : name === 'party-preview' ? 'party-scan-preview' : name === 'footer' ? 'footer-cleaner' : name === 'help' ? 'help-mobile' : name}.png`);
      fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
      console.log(`${name}: ${width}x${height} -> ${out}`);
    }
  } finally {
    try { execSync(`taskkill /F /T /PID ${proc.pid}`, { stdio: 'ignore' }); } catch (_) { try { proc.kill(); } catch (_) {} }
    server.closeAllConnections?.(); server.close();
  }
}

main().catch(err => { console.error(err.stack || err); process.exitCode = 1; });

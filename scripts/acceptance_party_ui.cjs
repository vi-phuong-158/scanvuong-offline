/* Chromium smoke acceptance for Party Document Mode. No project dependency. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const os = require('os');
const ROOT = path.resolve(__dirname, '..');
const PORT = 8777;
const CDP_PORT = 9223;
const SCREENSHOT_DIR = path.join(os.tmpdir(), 'vigil-lens-party-hotfix');
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2', '.png': 'image/png', '.wasm': 'application/wasm', '.ort': 'application/octet-stream' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, `http://127.0.0.1:${PORT}`).pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.errors = []; ws.onmessage = event => { const data = JSON.parse(event.data); const item = this.pending.get(data.id); if (item) { this.pending.delete(data.id); data.error ? item.reject(new Error(data.error.message)) : item.resolve(data.result); return; } if (data.method === 'Runtime.exceptionThrown') this.errors.push('exception'); if (data.method === 'Runtime.consoleAPICalled' && data.params?.type === 'error') this.errors.push('console.error'); }; }
  send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++this.id; this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  async eval(expression) { const result = await this.send('Runtime.evaluate', { expression, returnByValue: true }); return result.result?.value; }
}
function browserPath() {
  const candidates = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe', 'google-chrome', 'chromium', 'msedge'];
  for (const candidate of candidates) { try { if (fs.existsSync(candidate)) return candidate; const found = execSync(`where ${candidate}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split(/\r?\n/)[0]; if (found) return found; } catch (_) {} }
  throw new Error('Không tìm thấy Chromium/Chrome/Edge.');
}
async function cdpUrl() { for (let i = 0; i < 30; i++) { try { const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`); const tabs = await response.json(); const tab = tabs.find(item => item.type === 'page'); if (tab?.webSocketDebuggerUrl) return tab.webSocketDebuggerUrl; } catch (_) {} await new Promise(resolve => setTimeout(resolve, 150)); } throw new Error('Không kết nối được Chrome CDP.'); }

server.listen(PORT, async () => {
  let chrome;
  try {
    chrome = spawn(browserPath(), ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${CDP_PORT}`, 'about:blank']);
    const ws = new WebSocket(await cdpUrl()); await new Promise(resolve => { ws.onopen = resolve; });
    const cdp = new CDP(ws); await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
    const viewports = [
      { width: 1792, height: 896, name: 'party_mode_select_1792x896' },
      { width: 1366, height: 768, name: 'party_mode_select_1366x768' },
      { width: 390, height: 844, name: 'party_mode_select_390x844' }
    ];
    for (const viewport of viewports) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.width < 721 });
      await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` }); await new Promise(resolve => setTimeout(resolve, 500));
      cdp.errors.length = 0;
      const selector = JSON.parse(await cdp.eval(`JSON.stringify((() => {
        const visible = id => { const el = document.getElementById(id); return !!el && !el.classList.contains('hidden') && getComputedStyle(el).display !== 'none'; };
        const cards = [...document.querySelectorAll('.mode-card')];
        const titles = [...document.querySelectorAll('.mode-card-content strong')];
        const rects = cards.map(card => { const r = card.getBoundingClientRect(); return { width: Math.round(r.width), top: Math.round(r.top), height: Math.round(r.height) }; });
        return { cardCount: cards.length, rects, titleFlow: titles.map(el => { const style = getComputedStyle(el); return { text: el.textContent.trim(), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, wordBreak: style.wordBreak, overflowWrap: style.overflowWrap }; }), headerTop: Math.round(document.querySelector('.mode-select-header').getBoundingClientRect().top), overflow: document.documentElement.scrollWidth > innerWidth || document.body.scrollWidth > innerWidth, modeVisible: visible('modeSelect'), errors: cdpErrorsPlaceholder };
      })())`.replace('cdpErrorsPlaceholder', String(cdp.errors.length))));
      const minCardWidth = viewport.width >= 1100 ? 280 : viewport.width >= 721 ? 240 : 300;
      const sameDesktopRow = viewport.width >= 1100 ? new Set(selector.rects.map(rect => rect.top)).size === 1 : true;
      const titlesReadable = selector.titleFlow.every(item => item.scrollWidth <= item.clientWidth + 1 && item.wordBreak !== 'break-all' && item.wordBreak !== 'break-word');
      if (selector.cardCount !== 3 || selector.overflow || selector.rects.some(rect => rect.width < minCardWidth) || !sameDesktopRow || !titlesReadable || selector.headerTop > viewport.height * .45) throw new Error(`Mode selector failed at ${viewport.width}: ${JSON.stringify(selector)}`);
      const initialShot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const initialPath = path.join(SCREENSHOT_DIR, `${viewport.name}.png`); fs.writeFileSync(initialPath, Buffer.from(initialShot.data, 'base64'));
      await cdp.eval("document.getElementById('modePartyBtn').click()"); await new Promise(resolve => setTimeout(resolve, 100));
      const entry = JSON.parse(await cdp.eval(`JSON.stringify((() => { const visible = id => { const el = document.getElementById(id); return !!el && !el.classList.contains('hidden') && getComputedStyle(el).display !== 'none'; }; return { modeHidden: document.getElementById('modeSelect').classList.contains('hidden'), partyEmpty: visible('partyEmptyState'), importActions: ['partyCameraBtn','partyChooseBtn','partyPdfBtn'].every(visible), partyApi: typeof window.VigilLensParty, switchVisible: visible('switchModeBtn') }; })())`));
      if (!entry.modeHidden || !entry.partyEmpty || !entry.importActions || entry.partyApi !== 'object' || !entry.switchVisible || cdp.errors.length) throw new Error(`Party entry failed at ${viewport.width}: ${JSON.stringify({ entry, errors: cdp.errors })}`);
      const partyShot = await cdp.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SCREENSHOT_DIR, `${viewport.name.replace('select', 'entry')}.png`), Buffer.from(partyShot.data, 'base64'));
      await cdp.eval("document.getElementById('switchModeBtn').click()"); await new Promise(resolve => setTimeout(resolve, 100));
      const back = JSON.parse(await cdp.eval("JSON.stringify({modeVisible:!document.getElementById('modeSelect').classList.contains('hidden'), partyHidden:document.getElementById('partyEmptyState').classList.contains('hidden') && document.getElementById('partyWorkspace').classList.contains('hidden')})"));
      if (!back.modeVisible || !back.partyHidden) throw new Error(`Party back navigation failed at ${viewport.width}: ${JSON.stringify(back)}`);
      await cdp.eval("document.getElementById('modePartyBtn').click()"); await new Promise(resolve => setTimeout(resolve, 100));
      const reentry = JSON.parse(await cdp.eval("JSON.stringify({modeHidden:document.getElementById('modeSelect').classList.contains('hidden'), partyEmpty:!document.getElementById('partyEmptyState').classList.contains('hidden')})"));
      if (!reentry.modeHidden || !reentry.partyEmpty || cdp.errors.length) throw new Error(`Party re-entry failed at ${viewport.width}: ${JSON.stringify({ reentry, errors: cdp.errors })}`);
      console.log(`PASS Party UI ${viewport.width}x${viewport.height} · screenshots ${SCREENSHOT_DIR}`);
    }
    console.log('PARTY_UI_BROWSER_ACCEPTANCE: PASS');
  } catch (error) { console.error('PARTY_UI_BROWSER_ACCEPTANCE: FAIL', error.stack || error); process.exitCode = 1; }
  finally { try { chrome?.kill(); } catch (_) {} server.close(); }
});
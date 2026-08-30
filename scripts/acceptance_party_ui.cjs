/* Chromium smoke acceptance for Party Document Mode. No project dependency. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const PORT = 8777;
const CDP_PORT = 9223;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2', '.png': 'image/png', '.wasm': 'application/wasm', '.ort': 'application/octet-stream' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, `http://127.0.0.1:${PORT}`).pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); ws.onmessage = event => { const data = JSON.parse(event.data); const item = this.pending.get(data.id); if (item) { this.pending.delete(data.id); data.error ? item.reject(new Error(data.error.message)) : item.resolve(data.result); } }; }
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
    for (const viewport of [{ width: 390, height: 844, mobile: true }, { width: 1366, height: 768, mobile: false }]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 1 });
      await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` }); await new Promise(resolve => setTimeout(resolve, 450));
      const result = await cdp.eval(`JSON.stringify({hasParty:!!document.getElementById('modePartyBtn'), hasFooter:document.body.innerText.includes('Thiết kế bởi Đại úy Vi Ngọc Phương - Phòng An ninh đối ngoại Công an tỉnh Phú Thọ'), overflow:document.documentElement.scrollWidth > innerWidth})`);
      const checks = JSON.parse(result); if (!checks.hasParty || !checks.hasFooter || checks.overflow) throw new Error(`UI smoke failed at ${viewport.width}: ${result}`);
      await cdp.eval("document.getElementById('modePartyBtn').click()"); await new Promise(resolve => setTimeout(resolve, 80));
      const party = await cdp.eval("JSON.stringify({empty:!document.getElementById('partyEmptyState').classList.contains('hidden'), title:document.body.innerText.includes('Nhập nguồn tài liệu'), noOverlay:!document.querySelector('.vite-error-overlay, [data-nextjs-dialog]'), partyApi:typeof window.VigilLensParty, mode:document.getElementById('modeSelect').className})");
      const partyChecks = JSON.parse(party); if (!partyChecks.empty || !partyChecks.title || !partyChecks.noOverlay) throw new Error(`Party mode failed at ${viewport.width}: ${party}`);
      console.log(`PASS Party UI ${viewport.width}x${viewport.height}`);
    }
    console.log('PARTY_UI_BROWSER_ACCEPTANCE: PASS');
  } catch (error) { console.error('PARTY_UI_BROWSER_ACCEPTANCE: FAIL', error.stack || error); process.exitCode = 1; }
  finally { try { chrome?.kill(); } catch (_) {} server.close(); }
});

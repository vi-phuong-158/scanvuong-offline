const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SCREENSHOT_DIR = path.join(ROOT, 'docs', 'screenshots');
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

const PORT = 8776;
const CDP_PORT = 9222;

const UI_DRIVER = `
<script>
async function makeDocImage(title, pageNum) {
  const c = document.createElement('canvas');
  c.width = 900; c.height = 1200;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1e293b'; ctx.fillRect(0, 0, 900, 1200);
  ctx.save();
  ctx.translate(450, 600);
  ctx.rotate(pageNum === 1 ? -0.015 : 0.02);
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 24;
  ctx.fillRect(-360, -500, 720, 1000);
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 30px sans-serif';
  ctx.fillText(title, -310, -420);
  ctx.font = '16px sans-serif';
  ctx.fillStyle = '#475569';
  ctx.fillText('CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM — Độc lập - Tự do - Hạnh phúc', -310, -375);
  ctx.strokeStyle = '#2563eb';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-310, -350); ctx.lineTo(310, -350);
  ctx.stroke();
  for (let i = 0; i < 18; i++) {
    ctx.fillStyle = i % 4 === 0 ? '#334155' : '#64748b';
    ctx.fillRect(-310, -310 + i * 40, (i % 3 === 0 ? 540 : 620), 12);
  }
  ctx.restore();
  return new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));
}

async function makeIdImage(isFront) {
  const c = document.createElement('canvas');
  c.width = 900; c.height = 650;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0f172a'; ctx.fillRect(0, 0, 900, 650);
  ctx.save();
  ctx.translate(450, 325);
  ctx.fillStyle = '#f8fafc';
  ctx.strokeStyle = '#2563eb';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(-350, -220, 700, 440, 24);
  ctx.fill(); ctx.stroke();
  if (isFront) {
    ctx.fillStyle = '#1e40af';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText('CĂN CƯỚC CÔNG DÂN / CITIZEN IDENTITY CARD', -310, -160);
    ctx.fillStyle = '#fef08a';
    ctx.strokeStyle = '#ca8a04';
    ctx.lineWidth = 2;
    ctx.fillRect(-300, -100, 90, 70);
    ctx.strokeRect(-300, -100, 90, 70);
    ctx.fillStyle = '#cbd5e1';
    ctx.fillRect(-300, 0, 120, 160);
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = '#334155';
      ctx.fillRect(-150, -80 + i * 50, 440 - i * 30, 16);
    }
  } else {
    ctx.fillStyle = '#1e40af';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText('ĐẶC ĐIỂM NHẬN DẠNG / PERSONAL IDENTIFICATION', -310, -160);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-300, -100, 120, 120);
    ctx.strokeStyle = '#334155';
    ctx.strokeRect(-300, -100, 120, 120);
    for (let i = 0; i < 35; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#000' : '#fff';
      ctx.fillRect(-150 + i * 12, -100, i % 3 === 0 ? 8 : 4, 100);
    }
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = '#475569';
      ctx.fillRect(-300, 60 + i * 45, 600, 14);
    }
  }
  ctx.restore();
  return new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));
}

async function runDriver() {
  const p = new URLSearchParams(window.location.search);
  const st = p.get('ui_state');
  if (!st) { window.__SCREENSHOT_READY = true; return; }
  await document.fonts.ready;

  if (st === 'mode_select') {
    window.__SCREENSHOT_READY = true;
    return;
  }
  if (st === 'empty_import') {
    document.getElementById('modeDocBtn').click();
    window.__SCREENSHOT_READY = true;
    return;
  }
  if (st === 'doc_editor' || st === 'export_panel') {
    document.getElementById('modeDocBtn').click();
    await new Promise(r => setTimeout(r, 60));
    const b1 = await makeDocImage('HỢP ĐỒNG DỊCH VỤ - TRANG 1', 1);
    const b2 = await makeDocImage('HỢP ĐỒNG DỊCH VỤ - TRANG 2', 2);
    const dt = new DataTransfer();
    dt.items.add(new File([b1], 'hop_dong_trang_1.jpg', { type: 'image/jpeg' }));
    dt.items.add(new File([b2], 'hop_dong_trang_2.jpg', { type: 'image/jpeg' }));
    const input = document.getElementById('fileInput');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 700));
    if (st === 'export_panel') {
      const exp = document.querySelector('.export-panel');
      if (exp) exp.scrollIntoView({ behavior: 'instant', block: 'start' });
      await new Promise(r => setTimeout(r, 100));
    }
    window.__SCREENSHOT_READY = true;
    return;
  }
  if (st === 'id_front') {
    document.getElementById('modeIdBtn').click();
    await new Promise(r => setTimeout(r, 60));
    const bFront = await makeIdImage(true);
    const dt = new DataTransfer();
    dt.items.add(new File([bFront], 'cccd_mat_truoc.jpg', { type: 'image/jpeg' }));
    const input = document.getElementById('idFileInput');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 500));
    window.__SCREENSHOT_READY = true;
    return;
  }
  if (st === 'id_back') {
    document.getElementById('modeIdBtn').click();
    await new Promise(r => setTimeout(r, 60));
    const bFront = await makeIdImage(true);
    const dt1 = new DataTransfer();
    dt1.items.add(new File([bFront], 'cccd_mat_truoc.jpg', { type: 'image/jpeg' }));
    const input = document.getElementById('idFileInput');
    input.files = dt1.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 400));
    document.getElementById('idConfirmBtn').click();
    await new Promise(r => setTimeout(r, 200));
    const bBack = await makeIdImage(false);
    const dt2 = new DataTransfer();
    dt2.items.add(new File([bBack], 'cccd_mat_sau.jpg', { type: 'image/jpeg' }));
    input.files = dt2.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 500));
    window.__SCREENSHOT_READY = true;
    return;
  }
  if (st === 'id_a4') {
    document.getElementById('modeIdBtn').click();
    await new Promise(r => setTimeout(r, 60));
    const bFront = await makeIdImage(true);
    const dt1 = new DataTransfer();
    dt1.items.add(new File([bFront], 'cccd_mat_truoc.jpg', { type: 'image/jpeg' }));
    const input = document.getElementById('idFileInput');
    input.files = dt1.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 350));
    document.getElementById('idConfirmBtn').click();
    await new Promise(r => setTimeout(r, 200));
    const bBack = await makeIdImage(false);
    const dt2 = new DataTransfer();
    dt2.items.add(new File([bBack], 'cccd_mat_sau.jpg', { type: 'image/jpeg' }));
    input.files = dt2.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 350));
    document.getElementById('idConfirmBtn').click();
    await new Promise(r => setTimeout(r, 700));
    window.__SCREENSHOT_READY = true;
    return;
  }
}
window.addEventListener('DOMContentLoaded', runDriver);
</script>
`;

const server = http.createServer((req, res) => {
  const parsed = new URL(req.url, `http://127.0.0.1:${PORT}`);
  let pathname = decodeURIComponent(parsed.pathname);
  if (pathname === '/') pathname = '/index.html';

  if (pathname === '/index.html') {
    const raw = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf-8');
    const injected = raw.replace('</body>', UI_DRIVER + '</body>');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(injected);
    return;
  }

  const filePath = path.join(ROOT, pathname.replace(/^\//, ''));
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    let mime = 'text/plain';
    if (filePath.endsWith('.html')) mime = 'text/html; charset=utf-8';
    else if (filePath.endsWith('.js') || filePath.endsWith('.mjs')) mime = 'application/javascript; charset=utf-8';
    else if (filePath.endsWith('.css')) mime = 'text/css; charset=utf-8';
    else if (filePath.endsWith('.woff2')) mime = 'font/woff2';
    else if (filePath.endsWith('.json') || filePath.endsWith('.webmanifest')) mime = 'application/json; charset=utf-8';
    else if (filePath.endsWith('.wasm')) mime = 'application/wasm';
    else if (filePath.endsWith('.ort')) mime = 'application/octet-stream';
    else if (filePath.endsWith('.png')) mime = 'image/png';
    else if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) mime = 'image/jpeg';
    res.writeHead(200, { 'Content-Type': mime });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

class CDPClient {
  constructor(ws) {
    this.ws = ws;
    this.id = 1;
    this.callbacks = new Map();
    this.ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data);
      if (data.id && this.callbacks.has(data.id)) {
        const { resolve, reject } = this.callbacks.get(data.id);
        this.callbacks.delete(data.id);
        if (data.error) reject(new Error(data.error.message));
        else resolve(data.result);
      }
    };
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const reqId = this.id++;
      this.callbacks.set(reqId, { resolve, reject });
      this.ws.send(JSON.stringify({ id: reqId, method, params }));
    });
  }

  async eval(expr) {
    const res = await this.send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true
    });
    return res.result?.value;
  }
}

async function getCDPUrl() {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      const tabs = await res.json();
      const pageTab = tabs?.find(t => t.type === 'page');
      if (pageTab && pageTab.webSocketDebuggerUrl) {
        return pageTab.webSocketDebuggerUrl;
      }
    } catch (e) {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('Could not connect to Chrome Remote Debugging port');
}

function findBrowser() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) {
    return process.env.CHROMIUM_PATH;
  }

  const winPaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ];
  for (const p of winPaths) {
    if (fs.existsSync(p)) return p;
  }

  const binaries = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'msedge'];
  const { execSync } = require('child_process');
  for (const b of binaries) {
    try {
      const isWin = process.platform === 'win32';
      const cmd = isWin ? `where ${b}` : `which ${b}`;
      const res = execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }).trim().split(/\r?\n/)[0];
      if (res && fs.existsSync(res)) return res;
    } catch (e) {}
  }

  throw new Error('No compatible Chrome / Chromium / Edge browser binary found on this system.');
}

server.listen(PORT, async () => {
  const browserBin = findBrowser();

  const chromeProc = spawn(browserBin, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${CDP_PORT}`,
    'about:blank'
  ]);

  try {
    const wsUrl = await getCDPUrl();
    const ws = new WebSocket(wsUrl);
    await new Promise(r => ws.onopen = r);
    const cdp = new CDPClient(ws);

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    const tasks = [
      { name: '01_mode_select_mobile_390x844', w: 390, h: 844, setup: 'mode_select' },
      { name: '02_empty_import_mobile_390x844', w: 390, h: 844, setup: 'empty_import' },
      { name: '03_document_editor_mobile_390x844', w: 390, h: 844, setup: 'doc_editor' },
      { name: '04_document_editor_360x800', w: 360, h: 800, setup: 'doc_editor' },
      { name: '05_document_editor_430x932', w: 430, h: 932, setup: 'doc_editor' },
      { name: '06_document_editor_landscape_844x390', w: 844, h: 390, setup: 'doc_editor' },
      { name: '07_document_editor_tablet_768x1024', w: 768, h: 1024, setup: 'doc_editor' },
      { name: '08_document_editor_desktop_1280x800', w: 1280, h: 800, setup: 'doc_editor' },
      { name: '09_export_mobile_390x844', w: 390, h: 844, setup: 'export_panel' },
      { name: '10_scan_id_front_mobile_390x844', w: 390, h: 844, setup: 'id_front' },
      { name: '11_scan_id_back_mobile_390x844', w: 390, h: 844, setup: 'id_back' },
      { name: '12_scan_id_a4_preview_mobile_390x844', w: 390, h: 844, setup: 'id_a4' },
      { name: '13_scan_id_desktop_1280x800', w: 1280, h: 800, setup: 'id_a4' }
    ];

    console.log('==================================================');
    console.log('=== Capturing 13 Deterministic Visual QA States ===');
    console.log('==================================================\n');

    for (const t of tasks) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: t.w,
        height: t.h,
        deviceScaleFactor: 1,
        mobile: (t.w <= 768 && t.h > 400)
      });

      await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html?ui_state=${t.setup}` });

      // Poll until window.__SCREENSHOT_READY === true
      for (let i = 0; i < 50; i++) {
        const ready = await cdp.eval('window.__SCREENSHOT_READY === true');
        if (ready) break;
        await new Promise(r => setTimeout(r, 100));
      }
      await new Promise(r => setTimeout(r, 200));

      const snapRes = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const buf = Buffer.from(snapRes.data, 'base64');
      const outPath = path.join(SCREENSHOT_DIR, `${t.name}.png`);
      fs.writeFileSync(outPath, buf);
      console.log(`[OK] Captured ${t.name} (${t.w}x${t.h}) -> ${buf.length} bytes`);
    }

    console.log('\n✓ ALL 13 VISUAL QA SCREENSHOTS CAPTURED DETERMINISTICALLY');
  } catch (err) {
    console.error('Visual QA capture error:', err);
    process.exit(1);
  } finally {
    try { chromeProc.kill(); } catch (e) {}
    server.close();
  }
});

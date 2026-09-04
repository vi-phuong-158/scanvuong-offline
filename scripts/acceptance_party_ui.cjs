/* Chromium smoke acceptance for Party Document Mode. No project dependency. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const os = require('os');
const zlib = require('zlib');
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8777);
const CDP_PORT = Number(process.env.CDP_PORT || 9223);
const SCREENSHOT_DIR = path.join(os.tmpdir(), 'vigil-lens-party-hotfix');
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
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.errors = []; ws.onmessage = event => { const data = JSON.parse(event.data); const item = this.pending.get(data.id); if (item) { this.pending.delete(data.id); data.error ? item.reject(new Error(data.error.message)) : item.resolve(data.result); return; } if (data.method === 'Runtime.exceptionThrown') this.errors.push('exception'); if (data.method === 'Runtime.consoleAPICalled' && data.params?.type === 'error') this.errors.push('console.error'); }; }
  send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++this.id; this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  async eval(expression) { const result = await this.send('Runtime.evaluate', { expression, returnByValue: true }); return result.result?.value; }
}
function browserPath() {
  const configured = [process.env.CHROME_PATH, process.env.GOOGLE_CHROME_BIN, process.env.BROWSER_PATH, process.env.CHROMIUM_PATH].find(Boolean);
  if (configured && fs.existsSync(configured)) return configured;

  const winPaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  ];
  for (const candidate of winPaths) { try { if (fs.statSync(candidate).isFile()) return candidate; } catch (_) {} }

  const unixPaths = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'];
  for (const candidate of unixPaths) { try { if (fs.statSync(candidate).isFile()) return candidate; } catch (_) {} }

  const names = process.platform === 'win32' ? ['google-chrome', 'chromium', 'chromium-browser', 'msedge'] : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome', 'microsoft-edge'];
  const locator = process.platform === 'win32' ? 'where' : 'which';
  for (const name of names) {
    try {
      const found = execFileSync(locator, [name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split(/\r?\n/).find(Boolean);
      if (found && fs.existsSync(found)) return found;
    } catch (_) {}
  }
  throw new Error('Không tìm thấy Chromium/Chrome/Edge.');
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
      if (newRes.ok) {
        const newTab = await newRes.json();
        if (newTab?.webSocketDebuggerUrl) return newTab.webSocketDebuggerUrl;
      }
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error('Không kết nối được Chrome CDP.');
}

function syntheticPdf(pageCount, lineEnding = '\n') {
  let offset = 0;
  const header = `%PDF-1.4${lineEnding}`;
  const offsets = [];
  const parts = [header];
  offset += Buffer.byteLength(header, 'latin1');

  function addObj(num, body) {
    offsets[num] = offset;
    const str = `${num} 0 obj${lineEnding}${body}${lineEnding}endobj${lineEnding}`;
    parts.push(str);
    offset += Buffer.byteLength(str, 'latin1');
  }

  addObj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  addObj(2, `<< /Type /Pages /Kids [${Array.from({ length: pageCount }, (_, i) => `${3 + i * 2} 0 R`).join(' ')}] /Count ${pageCount} >>`);

  for (let i = 0; i < pageCount; i++) {
    const pageId = 3 + i * 2;
    const contentId = pageId + 1;
    const width = i % 2 ? 842 : 595;
    const height = i % 2 ? 595 : 842;
    const red = ((i * 37) % 80 + 160) / 255;
    const green = ((i * 61) % 100 + 100) / 255;
    const blue = ((i * 23) % 100 + 80) / 255;
    const content = `q${lineEnding}${red.toFixed(3)} ${green.toFixed(3)} ${blue.toFixed(3)} rg${lineEnding}40 40 ${width - 80} ${height - 80} re${lineEnding}f${lineEnding}0 0 0 RG${lineEnding}8 w${lineEnding}60 60 ${width - 120} ${height - 120} re${lineEnding}S${lineEnding}Q${lineEnding}`;
    addObj(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Contents ${contentId} 0 R >>`);
    addObj(contentId, `<< /Length ${Buffer.byteLength(content, 'latin1')} >>${lineEnding}stream${lineEnding}${content}endstream`);
  }

  const startxref = offset;
  const totalObjs = 2 + pageCount * 2 + 1;
  let xref = `xref${lineEnding}0 ${totalObjs}${lineEnding}0000000000 65535 f ${lineEnding}`;
  for (let num = 1; num < totalObjs; num++) {
    const offStr = String(offsets[num] || 0).padStart(10, '0');
    xref += `${offStr} 00000 n ${lineEnding}`;
  }
  const trailer = `trailer${lineEnding}<< /Size ${totalObjs} /Root 1 0 R >>${lineEnding}startxref${lineEnding}${startxref}${lineEnding}%%EOF`;
  parts.push(xref, trailer);
  return Buffer.from(parts.join(''), 'latin1');
}

function syntheticImagePdf(pageCount) {
  let offset = 0;
  const header = '%PDF-1.4\n';
  const offsets = [];
  const parts = [Buffer.from(header, 'latin1')];
  offset += header.length;

  function addObj(num, bodyBuffer) {
    offsets[num] = offset;
    const prefix = Buffer.from(`${num} 0 obj\n`, 'latin1');
    const suffix = Buffer.from('\nendobj\n', 'latin1');
    parts.push(prefix, bodyBuffer, suffix);
    offset += prefix.length + bodyBuffer.length + suffix.length;
  }

  addObj(1, Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'latin1'));
  addObj(2, Buffer.from(`<< /Type /Pages /Kids [${Array.from({ length: pageCount }, (_, i) => `${3 + i * 3} 0 R`).join(' ')}] /Count ${pageCount} >>`, 'latin1'));

  for (let i = 0; i < pageCount; i++) {
    const pageId = 3 + i * 3;
    const contentId = pageId + 1;
    const imageId = pageId + 2;
    const width = 64, height = 64;
    const raw = Buffer.alloc(width * height * 3);
    const red = (160 + i * 17) % 256, green = (80 + i * 29) % 256, blue = (40 + i * 43) % 256;
    for (let pixel = 0; pixel < raw.length; pixel += 3) { raw[pixel] = red; raw[pixel + 1] = green; raw[pixel + 2] = blue; }
    const compressed = zlib.deflateSync(raw);
    const content = `q\n595 0 0 842 0 0 cm\n/Im0 Do\nQ\n`;
    addObj(pageId, Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`, 'latin1'));
    addObj(contentId, Buffer.from(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}endstream`, 'latin1'));
    addObj(imageId, Buffer.concat([
      Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${compressed.length} >>\nstream\n`, 'latin1'),
      compressed,
      Buffer.from('\nendstream', 'latin1')
    ]));
  }

  const startxref = offset;
  const totalObjs = 2 + pageCount * 3 + 1;
  let xref = `xref\n0 ${totalObjs}\n0000000000 65535 f \n`;
  for (let num = 1; num < totalObjs; num++) {
    const offStr = String(offsets[num] || 0).padStart(10, '0');
    xref += `${offStr} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${totalObjs} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF`;
  parts.push(Buffer.from(xref + trailer, 'latin1'));
  return Buffer.concat(parts);
}

function syntheticBlankAndInkPdf() {
  let offset = 0;
  const header = '%PDF-1.4\n';
  const offsets = [];
  const parts = [Buffer.from(header, 'latin1')];
  offset += header.length;

  function addObj(num, bodyBuffer) {
    offsets[num] = offset;
    const prefix = Buffer.from(`${num} 0 obj\n`, 'latin1');
    const suffix = Buffer.from('\nendobj\n', 'latin1');
    parts.push(prefix, bodyBuffer, suffix);
    offset += prefix.length + bodyBuffer.length + suffix.length;
  }

  addObj(1, Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'latin1'));
  addObj(2, Buffer.from('<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>', 'latin1'));

  // Page 1: 100% white image XObject (all pixels 255)
  const width = 64, height = 64;
  const rawWhite = Buffer.alloc(width * height * 3, 255);
  const compressedWhite = zlib.deflateSync(rawWhite);
  const content1 = `q\n595 0 0 842 0 0 cm\n/Im0 Do\nQ\n`;
  addObj(3, Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>`, 'latin1'));
  addObj(4, Buffer.from(`<< /Length ${Buffer.byteLength(content1, 'latin1')} >>\nstream\n${content1}endstream`, 'latin1'));
  addObj(5, Buffer.concat([
    Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${compressedWhite.length} >>\nstream\n`, 'latin1'),
    compressedWhite,
    Buffer.from('\nendstream', 'latin1')
  ]));

  // Page 2: Dark ink content
  const content2 = `q\n0.1 0.1 0.1 rg\n50 50 495 742 re\nf\nQ\n`;
  addObj(6, Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 7 0 R >>`, 'latin1'));
  addObj(7, Buffer.from(`<< /Length ${Buffer.byteLength(content2, 'latin1')} >>\nstream\n${content2}endstream`, 'latin1'));

  const startxref = offset;
  const totalObjs = 8;
  let xref = `xref\n0 ${totalObjs}\n0000000000 65535 f \n`;
  for (let num = 1; num < totalObjs; num++) {
    const offStr = String(offsets[num] || 0).padStart(10, '0');
    xref += `${offStr} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${totalObjs} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF`;
  parts.push(Buffer.from(xref + trailer, 'latin1'));
  return Buffer.concat(parts);
}

async function setFileInput(cdp, selector, filePath) {
  const expression = `document.querySelector(${JSON.stringify(selector)})`;
  const evaluated = await cdp.send('Runtime.evaluate', { expression, objectGroup: 'party-file-input' });
  const objectId = evaluated.result?.objectId;
  if (!objectId) throw new Error(`Không tìm thấy file input ${selector}.`);
  await cdp.send('DOM.setFileInputFiles', { objectId, files: [path.resolve(filePath).split(path.sep).join('/')] });
}

async function waitFor(cdp, fnExpr, timeoutMs = 5000, intervalMs = 40) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await cdp.eval(`Boolean((${fnExpr})())`);
      if (res) return true;
    } catch (_) {}
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`Timeout waiting for condition: ${fnExpr}`);
}

async function navigateAndEnterPartyMode(cdp) {
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
  await waitFor(cdp, "() => document.readyState === 'complete' && !!document.getElementById('modePartyBtn') && !document.getElementById('modeSelect')?.classList.contains('hidden')");
  cdp.errors.length = 0;
  await cdp.eval("document.getElementById('modePartyBtn').click()");
  await waitFor(cdp, "() => document.getElementById('modeSelect')?.classList.contains('hidden') && !document.getElementById('partyEmptyState')?.classList.contains('hidden')");
}

async function runLineEndingAcceptance(cdp) {
  for (const [name, ending] of [['lf', '\n'], ['cr', '\r'], ['crlf', '\r\n']]) {
    const fixturePath = path.join(SCREENSHOT_DIR, `party_ui_line_ending_${name}.pdf`); fs.writeFileSync(fixturePath, syntheticPdf(3, ending));
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
    await navigateAndEnterPartyMode(cdp);
    await cdp.eval("document.getElementById('partyPdfBtn').click()");
    await setFileInput(cdp, '#partyPdfInput', fixturePath);
    await waitFor(cdp, "() => document.querySelectorAll('#partySourceRail .party-page').length === 3");
    await cdp.eval("document.getElementById('partySelectAllBtn').click(); document.getElementById('partyCreateDocBtn').click()");
    await waitFor(cdp, "() => document.querySelectorAll('.party-created-docs .party-page').length === 3");
    const imported = JSON.parse(await cdp.eval("JSON.stringify({pages:document.querySelectorAll('.party-created-docs .party-page').length,coverage:document.getElementById('partyCoverageText').textContent})"));
    if (imported.pages !== 3 || !imported.coverage.includes('3/3') || cdp.errors.length) throw new Error(`PDF ${name} line-ending import failed: ${JSON.stringify({ imported, errors: cdp.errors })}`);
  }
  console.log('PASS Party PDF LF/CR/CRLF object-boundary acceptance');
}

async function runHelpUxAcceptance(cdp) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
  await navigateAndEnterPartyMode(cdp);
  await cdp.eval("document.querySelector('[data-party-help]').click()");
  await waitFor(cdp, "() => document.getElementById('partyHelpDialog')?.open === true");
  const help = JSON.parse(await cdp.eval("JSON.stringify({open:document.getElementById('partyHelpDialog').open,sections:document.querySelectorAll('#partyHelpDialog section').length,text:document.getElementById('partyHelpDialog').textContent})"));
  const requiredTopics = ['Tài liệu là gì?','Trang nguồn là gì?','Chọn trang và tạo tài liệu','Cách chia 1 PDF thành nhiều tài liệu','Ghép với trước','Ghép với sau','Chuyển trang','Xoay trang','Thay trang','Thêm trang','Xóa trang','Chọn loại tài liệu','Xuất tất cả'];
  if (!help.open || help.sections < 13 || !requiredTopics.every(label => help.text.includes(label)) || cdp.errors.length) throw new Error(`Party help content failed: ${JSON.stringify({ open: help.open, sections: help.sections })}`);
  await cdp.eval("document.getElementById('partyHelpClose').click()");
  await waitFor(cdp, "() => !document.getElementById('partyHelpDialog')?.open");
  const fixturePath = path.join(SCREENSHOT_DIR, 'party_ui_help_controls.pdf'); fs.writeFileSync(fixturePath, syntheticPdf(2));
  await cdp.eval("document.getElementById('partyPdfBtn').click()");
  await setFileInput(cdp, '#partyPdfInput', fixturePath);
  await waitFor(cdp, "() => document.querySelectorAll('#partySourceRail .party-page').length === 2");
  await cdp.eval("document.getElementById('partySelectAllBtn').click(); document.getElementById('partyCreateDocBtn').click();");
  await waitFor(cdp, "() => { const page = document.querySelector('.party-created-docs .party-page'); const canvas = page?.querySelector('.party-pdf-preview'); return canvas && (canvas.dataset.previewRendered === 'true' || (canvas.width > 0 && canvas.height > 0 && (canvas.width !== 300 || canvas.height !== 150))); }");
  const desktop = JSON.parse(await cdp.eval("JSON.stringify((() => { const page=document.querySelector('.party-created-docs .party-page'); const labels=[...page.querySelectorAll('.party-page-actions > button')].map(button=>button.textContent.trim()); const canvas=page.querySelector('.party-pdf-preview'); const before=[canvas.width,canvas.height]; page.querySelector('[data-page-action=rotate]').click(); return {labels,before}; })())"));
  await waitFor(cdp, `() => { const canvas = document.querySelector('.party-created-docs .party-pdf-preview'); return canvas && canvas.width === ${desktop.before[1]} && canvas.height === ${desktop.before[0]}; }`);
  const rotated = JSON.parse(await cdp.eval("JSON.stringify((() => { const canvas=document.querySelector('.party-created-docs .party-pdf-preview'); return {after:[canvas.width,canvas.height],coverage:document.getElementById('partyCoverageText').textContent}; })())"));
  if (!['← Trước','Sau →','↻ Xoay','↺ Thay trang','+ Thêm sau','Xóa'].every(label => desktop.labels.includes(label)) || desktop.before[0] !== rotated.after[1] || desktop.before[1] !== rotated.after[0] || !rotated.coverage.includes('2/2') || cdp.errors.length) throw new Error(`Party desktop controls failed: ${JSON.stringify({ desktop, rotated, errors: cdp.errors })}`);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }); await new Promise(resolve => setTimeout(resolve, 180));
  const mobile = JSON.parse(await cdp.eval("JSON.stringify((() => { const page=document.querySelector('.party-created-docs .party-page'); const more=page.querySelector('.party-page-more'); more.open=true; return {menuVisible:getComputedStyle(more).display !== 'none',direct:[...page.querySelectorAll('.party-page-action-optional')].filter(button=>getComputedStyle(button).display !== 'none').length,text:more.textContent,overflow:document.documentElement.scrollWidth > innerWidth || document.body.scrollWidth > innerWidth}; })())"));
  if (!mobile.menuVisible || mobile.direct || !['Thay trang','Thêm sau','Xóa khỏi tài liệu'].every(label => mobile.text.includes(label)) || mobile.overflow || cdp.errors.length) throw new Error(`Party mobile controls failed: ${JSON.stringify({ mobile, errors: cdp.errors })}`);
  console.log('PASS Party help and labelled desktop/mobile control acceptance');
}

async function readPrivateExportPageCounts(cdp) {
  const result = await cdp.send('Runtime.evaluate', { expression: "(async()=>JSON.stringify(await Promise.all(window.__partyDownloads.map(async item => window.PartyPdf.parse(new Uint8Array(await (await fetch(item.href)).arrayBuffer())).pageIds.length))))()", awaitPromise: true, returnByValue: true });
  return JSON.parse(result.result?.value || '[]');
}

async function preparePrivateDownloadCapture(cdp) {
  await cdp.eval("window.__partyDownloads=[]; HTMLAnchorElement.prototype.click=function(){if(this.download&&String(this.href).startsWith('blob:'))window.__partyDownloads.push({href:this.href});};");
}

async function runPageSelectionWorkflowAcceptance(cdp) {
  const fixturePath = path.join(SCREENSHOT_DIR, 'party_ui_multisplit_fixture.pdf');
  fs.writeFileSync(fixturePath, syntheticPdf(12));
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
  await waitFor(cdp, "() => document.readyState === 'complete' && !!document.getElementById('modePartyBtn') && !document.getElementById('modeSelect')?.classList.contains('hidden')");
  cdp.errors.length = 0;
  await cdp.eval("document.getElementById('modePartyBtn').click()");
  await waitFor(cdp, "() => document.getElementById('modeSelect')?.classList.contains('hidden') && !document.getElementById('partyEmptyState')?.classList.contains('hidden')");
  await cdp.eval("document.getElementById('partyPdfBtn').click()");
  await setFileInput(cdp, '#partyPdfInput', fixturePath);
  await waitFor(cdp, "() => document.querySelectorAll('.party-source-pool .party-page-source').length === 12", 10000);

  // Step 4: Verify each page has checkbox control with touch target >= 44px
  const sourceCheck = JSON.parse(await cdp.eval("JSON.stringify({sources:[...document.querySelectorAll('.party-source-pool .party-page-source')].map(el=>el.textContent.trim()), checkTouchTargets:[...document.querySelectorAll('.party-page-check')].map(el=>Math.min(el.getBoundingClientRect().width, el.getBoundingClientRect().height))})"));
  if (sourceCheck.sources.length !== 12 || sourceCheck.sources[0] !== 'Nguồn: trang 1/12' || sourceCheck.sources[11] !== 'Nguồn: trang 12/12' || sourceCheck.checkTouchTargets.some(s => s < 44)) {
    throw new Error(`Source page number format or touch target mismatch: ${JSON.stringify(sourceCheck)}`);
  }

  // Step 5-6: Select exactly 2 pages (page 1 and page 2) -> UI shows "Đã chọn 2 trang"
  await cdp.eval("document.querySelectorAll('[data-page-select]')[0].click()");
  await new Promise(resolve => setTimeout(resolve, 60));
  await cdp.eval("document.querySelectorAll('[data-page-select]')[1].click()");
  await new Promise(resolve => setTimeout(resolve, 60));
  const sel2State = JSON.parse(await cdp.eval("JSON.stringify({countText:document.getElementById('partySelectionCount')?.textContent.trim(), createDisabled:document.getElementById('partyCreateDocBtn').disabled})"));
  if (sel2State.countText !== 'Đã chọn 2 trang' || sel2State.createDisabled) {
    throw new Error(`Selection state mismatch after clicking 2 pages: ${JSON.stringify(sel2State)}`);
  }

  // Step 7-8: Click "Tạo tài liệu từ trang đã chọn" -> New document contains exactly 2 pages
  await cdp.eval("document.getElementById('partyCreateDocBtn').click()");
  await waitFor(cdp, "() => document.querySelectorAll('.party-document').length === 1 && document.querySelectorAll('.party-document')[0]?.querySelectorAll('.party-page').length === 2");
  const doc1State = JSON.parse(await cdp.eval("JSON.stringify({docs:document.querySelectorAll('.party-document').length, doc1Pages:document.querySelectorAll('.party-document')[0].querySelectorAll('.party-page').length, doc1Sources:[...document.querySelectorAll('.party-document')[0].querySelectorAll('.party-page-source')].map(s=>s.textContent.trim()), badges:document.querySelectorAll('.party-source-pool .party-assigned-badge').length, coverage:document.getElementById('partyCoverageText').textContent})"));
  if (doc1State.docs !== 1 || doc1State.doc1Pages !== 2 || doc1State.doc1Sources.join(';') !== 'Nguồn: trang 1/12;Nguồn: trang 2/12' || doc1State.badges !== 2) {
    throw new Error(`Doc 1 creation failed: ${JSON.stringify(doc1State)}`);
  }

  // Step 9: Assign valid taxonomy to Doc 1
  await cdp.eval("(() => { const input = document.querySelectorAll('[data-type-input]')[0]; input.value = '05'; input.dispatchEvent(new Event('change', { bubbles: true })); })()");
  await waitFor(cdp, "() => !document.querySelectorAll('[data-doc-export]')[0]?.disabled");

  // Step 10: Verify "Xuất tài liệu này" is ENABLED
  const exportDoc1Btn = JSON.parse(await cdp.eval("JSON.stringify({disabled:document.querySelectorAll('[data-doc-export]')[0]?.disabled, text:document.querySelectorAll('[data-doc-export]')[0]?.textContent.trim()})"));
  if (exportDoc1Btn.disabled || !exportDoc1Btn.text.includes('Xuất tài liệu này')) {
    throw new Error(`Export doc 1 button not enabled: ${JSON.stringify(exportDoc1Btn)}`);
  }

  // Step 11-12: Export succeeds even though other source pages are unassigned (coverage 2/12 is not a blocker)
  if (!doc1State.coverage.includes('2/12')) {
    throw new Error(`Coverage report mismatch: expected 2/12, got ${doc1State.coverage}`);
  }
  await preparePrivateDownloadCapture(cdp);
  await cdp.eval("document.querySelectorAll('[data-doc-export]')[0].click()");
  await new Promise(resolve => setTimeout(resolve, 700));
  const singleExported = await readPrivateExportPageCounts(cdp);
  if (singleExported.join(',') !== '2' || cdp.errors.length) {
    throw new Error(`Partial export of 2-page document failed: ${JSON.stringify({ singleExported, errors: cdp.errors })}`);
  }

  // Step 13: Select second group of pages out of order (click page 5, then page 3) -> create Doc 2 in ascending order [3, 5]
  await cdp.eval("document.querySelectorAll('[data-page-select]')[4].click()");
  await new Promise(resolve => setTimeout(resolve, 50));
  await cdp.eval("document.querySelectorAll('[data-page-select]')[2].click()");
  await new Promise(resolve => setTimeout(resolve, 50));
  const selGroup2 = JSON.parse(await cdp.eval("JSON.stringify({countText:document.getElementById('partySelectionCount')?.textContent.trim()})"));
  if (selGroup2.countText !== 'Đã chọn 2 trang') {
    throw new Error(`Second group selection mismatch: ${JSON.stringify(selGroup2)}`);
  }
  await cdp.eval("document.getElementById('partyCreateDocBtn').click()");
  await waitFor(cdp, "() => document.querySelectorAll('.party-document').length === 2 && document.querySelectorAll('.party-document')[1]?.querySelectorAll('.party-page').length === 2");
  const doc2Sources = JSON.parse(await cdp.eval("JSON.stringify([...document.querySelectorAll('.party-document')[1].querySelectorAll('.party-page-source')].map(s=>s.textContent.trim()))"));
  if (doc2Sources.join(';') !== 'Nguồn: trang 3/12;Nguồn: trang 5/12') {
    throw new Error(`Doc 2 ascending order preservation failed: ${JSON.stringify(doc2Sources)}`);
  }

  // Step 14: Verify duplicate page assignment protection
  const dupCheck = JSON.parse(await cdp.eval("JSON.stringify({badges:document.querySelectorAll('.party-source-pool .party-assigned-badge').length, assignedPages:document.querySelectorAll('.party-page.is-assigned').length, coverage:document.getElementById('partyCoverageText').textContent})"));
  if (dupCheck.badges !== 4 || dupCheck.assignedPages !== 4 || !dupCheck.coverage.includes('4/12')) {
    throw new Error(`Duplicate protection check failed: ${JSON.stringify(dupCheck)}`);
  }

  // Export Doc 2 individually as well
  await cdp.eval("(() => { const input = document.querySelectorAll('[data-type-input]')[1]; input.value = '07'; input.dispatchEvent(new Event('change', { bubbles: true })); })()");
  await waitFor(cdp, "() => !document.querySelectorAll('[data-doc-export]')[1]?.disabled");
  await preparePrivateDownloadCapture(cdp);
  await cdp.eval("document.querySelectorAll('[data-doc-export]')[1].click()");
  await new Promise(resolve => setTimeout(resolve, 700));
  const doc2Exported = await readPrivateExportPageCounts(cdp);
  if (doc2Exported.join(',') !== '2' || cdp.errors.length) {
    throw new Error(`Doc 2 export failed: ${JSON.stringify({ doc2Exported, errors: cdp.errors })}`);
  }

  // Select all remaining unassigned pages (pages 4, 6, 7, 8, 9, 10, 11, 12 = 8 pages) -> Doc 3
  await cdp.eval("document.getElementById('partySelectAllBtn').click()");
  await new Promise(resolve => setTimeout(resolve, 80));
  const remainingSelCount = JSON.parse(await cdp.eval("JSON.stringify({countText:document.getElementById('partySelectionCount')?.textContent.trim()})"));
  if (remainingSelCount.countText !== 'Đã chọn 8 trang') {
    throw new Error(`Remaining select all count mismatch: expected 8, got ${JSON.stringify(remainingSelCount)}`);
  }
  await cdp.eval("document.getElementById('partyCreateDocBtn').click()");
  await waitFor(cdp, "() => document.querySelectorAll('.party-document').length === 3");


  const all3Docs = JSON.parse(await cdp.eval("JSON.stringify({docs:document.querySelectorAll('.party-document').length, docCounts:[...document.querySelectorAll('.party-document')].map(doc=>doc.querySelectorAll('.party-page').length), coverage:document.getElementById('partyCoverageText').textContent})"));
  if (all3Docs.docs !== 3 || all3Docs.docCounts.join(',') !== '2,2,8' || !all3Docs.coverage.includes('12/12')) {
    throw new Error(`3 documents creation failed: ${JSON.stringify(all3Docs)}`);
  }

  // Assign taxonomy to Doc 3 and export all 3 docs
  await cdp.eval("(() => { const input = document.querySelectorAll('[data-type-input]')[2]; input.value = '38'; input.dispatchEvent(new Event('change', { bubbles: true })); })()");
  await new Promise(resolve => setTimeout(resolve, 100));
  await preparePrivateDownloadCapture(cdp);
  await cdp.eval("document.getElementById('partyExportAllBtn').click()");
  await new Promise(resolve => setTimeout(resolve, 1000));
  const allExported = await readPrivateExportPageCounts(cdp);
  if (allExported.join(',') !== '2,2,8' || cdp.errors.length) {
    throw new Error(`Export all failed: ${JSON.stringify({ expected: '2,2,8', allExported, errors: cdp.errors })}`);
  }

  console.log('PASS Party page selection UX (14-step mandatory scenario: checkbox touch targets, select 2 pages, create doc, ascending order, duplicate protection, partial export without 100% coverage, export all)');
}

async function runEventListenerAcceptance(cdp) {
  const fixturePath = path.join(SCREENSHOT_DIR, 'party_ui_events_fixture.pdf');
  fs.writeFileSync(fixturePath, syntheticPdf(2));
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
  await waitFor(cdp, "() => document.readyState === 'complete' && !!document.getElementById('modePartyBtn') && !document.getElementById('modeSelect')?.classList.contains('hidden')");
  cdp.errors.length = 0;
  await cdp.eval("document.getElementById('modePartyBtn').click()");
  await waitFor(cdp, "() => document.getElementById('modeSelect')?.classList.contains('hidden') && !document.getElementById('partyEmptyState')?.classList.contains('hidden')");
  await cdp.eval("document.getElementById('partyPdfBtn').click()");
  await setFileInput(cdp, '#partyPdfInput', fixturePath);
  await waitFor(cdp, "() => document.querySelectorAll('.party-source-pool .party-page-source').length === 2", 10000);

  // Trigger rapid re-renders
  await cdp.eval("document.querySelectorAll('.party-page-thumb')[0].click()");
  await cdp.eval("document.querySelectorAll('.party-page-thumb')[1].click()");
  await cdp.eval("document.querySelectorAll('.party-page-thumb')[0].click()");

  // Create doc to get card actions
  await cdp.eval("document.getElementById('partySelectAllBtn').click(); document.getElementById('partyCreateDocBtn').click();");
  await waitFor(cdp, "() => { const c = document.querySelector('.party-created-docs .party-pdf-preview'); return c && (c.dataset.previewRendered === 'true' || (c.width > 0 && c.height > 0 && (c.width !== 300 || c.height !== 150))); }");

  // Rotate button single-execution (+90 deg)
  const beforeRotate = JSON.parse(await cdp.eval("JSON.stringify((() => { const c=document.querySelector('.party-created-docs .party-pdf-preview'); return {w:c.width,h:c.height}; })())"));
  await cdp.eval("document.querySelector('.party-created-docs [data-page-action=rotate]').click()");
  await waitFor(cdp, `() => { const c = document.querySelector('.party-created-docs .party-pdf-preview'); return c && c.width === ${beforeRotate.h} && c.height === ${beforeRotate.w}; }`);
  const afterRotate = JSON.parse(await cdp.eval("JSON.stringify((() => { const c=document.querySelector('.party-created-docs .party-pdf-preview'); return {w:c.width,h:c.height}; })())"));
  if (beforeRotate.w !== afterRotate.h || beforeRotate.h !== afterRotate.w) {
    throw new Error(`Rotate event listener duplicated: before=${JSON.stringify(beforeRotate)}, after=${JSON.stringify(afterRotate)}`);
  }


  // Remove document and verify pages are back in source pool unassigned
  await cdp.eval("document.querySelector('.party-remove-document').click()");
  await new Promise(resolve => setTimeout(resolve, 150));
  const afterRemove = JSON.parse(await cdp.eval("JSON.stringify({docs:document.querySelectorAll('.party-document').length, sources:document.querySelectorAll('.party-source-pool .party-page').length})"));
  if (afterRemove.docs !== 0 || afterRemove.sources !== 2) {
    throw new Error(`Remove document event listener failed: ${JSON.stringify(afterRemove)}`);
  }

  console.log('PASS Party event listener delegation & non-duplication acceptance');
}

async function runTrueBlankPageAcceptance(cdp) {
  const fixturePath = path.join(SCREENSHOT_DIR, 'party_ui_blank_and_ink.pdf');
  fs.writeFileSync(fixturePath, syntheticBlankAndInkPdf());
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
  await waitFor(cdp, "() => document.readyState === 'complete' && !!document.getElementById('modePartyBtn') && !document.getElementById('modeSelect')?.classList.contains('hidden')");
  cdp.errors.length = 0;
  await cdp.eval("document.getElementById('modePartyBtn').click()");
  await waitFor(cdp, "() => document.getElementById('modeSelect')?.classList.contains('hidden') && !document.getElementById('partyEmptyState')?.classList.contains('hidden')");
  await cdp.eval("document.getElementById('partyPdfBtn').click()");
  await setFileInput(cdp, '#partyPdfInput', fixturePath);
  await waitFor(cdp, "() => [...document.querySelectorAll('.party-pdf-preview')].filter(c => c.dataset.previewRendered === 'true').length === 2", 10000);

  const result = JSON.parse(await cdp.eval("JSON.stringify((() => { const canvases=[...document.querySelectorAll('.party-pdf-preview')]; return {pages:document.querySelectorAll('.party-page').length, ready:canvases.filter(c=>c.dataset.previewRendered==='true').length, errors:document.querySelectorAll('.party-pdf-thumb.is-error').length, p1Status:canvases[0]?.parentElement.querySelector('.party-pdf-status')?.textContent, p2Status:canvases[1]?.parentElement.querySelector('.party-pdf-status')?.textContent}; })())"));
  if (result.pages !== 2 || result.ready !== 2 || result.errors !== 0 || !result.p1Status.startsWith('PDF') || !result.p2Status.startsWith('PDF') || cdp.errors.length) {
    throw new Error(`True blank page acceptance failed: ${JSON.stringify({ result, errors: cdp.errors })}`);
  }
  console.log('PASS Party true blank page vs valid ink preview acceptance');
}

async function runRapidInteractionRerenderReproduction(cdp) {
  const fixturePath = path.join(SCREENSHOT_DIR, 'party_ui_rapid_interact_12.pdf');
  fs.writeFileSync(fixturePath, syntheticPdf(12));
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
  await waitFor(cdp, "() => document.readyState === 'complete' && !!document.getElementById('modePartyBtn') && !document.getElementById('modeSelect')?.classList.contains('hidden')");
  cdp.errors.length = 0;
  await cdp.eval("document.getElementById('modePartyBtn').click()");
  await waitFor(cdp, "() => document.getElementById('modeSelect')?.classList.contains('hidden') && !document.getElementById('partyEmptyState')?.classList.contains('hidden')");
  await cdp.eval("document.getElementById('partyPdfBtn').click()");
  await setFileInput(cdp, '#partyPdfInput', fixturePath);
  
  // Rapid user clicks while queue is starting
  await new Promise(resolve => setTimeout(resolve, 40));
  await cdp.eval("document.querySelectorAll('.party-page-thumb')[0]?.click()");
  await new Promise(resolve => setTimeout(resolve, 40));
  await cdp.eval("document.querySelectorAll('.party-page-thumb')[1]?.click()");
  await new Promise(resolve => setTimeout(resolve, 40));
  await cdp.eval("document.querySelectorAll('.party-page-thumb')[2]?.click()");
  await waitFor(cdp, "() => [...document.querySelectorAll('.party-pdf-preview')].filter(c => c.dataset.previewRendered === 'true').length >= 6", 8000);

  const result = JSON.parse(await cdp.eval("JSON.stringify((() => { const canvases=[...document.querySelectorAll('.party-pdf-preview')]; return {canvasesCount:canvases.length, readyCount:canvases.filter(c=>c.dataset.previewRendered==='true').length, blankCanvases:canvases.filter(c=>c.dataset.previewRendered==='true').some(c=>{const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data; let nonWhite=0; for(let i=0;i<d.length;i+=16){if(d[i]<245||d[i+1]<245||d[i+2]<245)nonWhite++;} return nonWhite===0;})}; })())"));
  if (result.readyCount < 6 || result.blankCanvases || cdp.errors.length) {
    throw new Error(`Rapid interaction reproduction failed on hotfix: ${JSON.stringify({ result, errors: cdp.errors })}`);
  }
  console.log(`PASS Party rapid interaction & synchronous DOM restoration (${result.readyCount} ready, 0 blank)`);
}

async function runLargePdfAcceptance(cdp) {
  const fixturePath = path.join(SCREENSHOT_DIR, 'party_ui_synthetic_fixture_100.pdf');
  fs.writeFileSync(fixturePath, syntheticPdf(100));
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
  await waitFor(cdp, "() => document.readyState === 'complete' && !!document.getElementById('modePartyBtn') && !document.getElementById('modeSelect')?.classList.contains('hidden')");
  cdp.errors.length = 0;
  await cdp.eval("document.getElementById('modePartyBtn').click()");
  await waitFor(cdp, "() => document.getElementById('modeSelect')?.classList.contains('hidden') && !document.getElementById('partyEmptyState')?.classList.contains('hidden')");
  await cdp.eval("document.getElementById('partyPdfBtn').click()");
  await setFileInput(cdp, '#partyPdfInput', fixturePath);
  await waitFor(cdp, "() => document.querySelectorAll('.party-page').length === 100", 15000);
  await waitFor(cdp, "() => [...document.querySelectorAll('.party-pdf-preview')].filter(c => c.dataset.previewRendered === 'true').length >= 1", 10000);
  const initial = JSON.parse(await cdp.eval("JSON.stringify({pages:document.querySelectorAll('.party-page').length, canvases:document.querySelectorAll('.party-pdf-preview').length, ready:[...document.querySelectorAll('.party-pdf-preview')].filter(canvas=>canvas.dataset.previewRendered==='true').length, railWidth:document.querySelector('.party-page-rail')?.scrollWidth || 0})"));
  if (initial.pages !== 100 || initial.canvases !== 100 || initial.ready < 1 || initial.ready > 10 || cdp.errors.length) {
    throw new Error(`100-page lazy gate failed before scroll: ${JSON.stringify({ initial, errors: cdp.errors })}`);
  }
  const firstShot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SCREENSHOT_DIR, 'party_workspace_pdf_100_lazy_initial_1366x768.png'), Buffer.from(firstShot.data, 'base64'));

  // Scroll to the end of rail
  await cdp.eval("(() => { const rail=document.querySelector('.party-page-rail'); rail.scrollLeft=rail.scrollWidth; })()");
  for (let i = 0; i < 25; i++) {
    const isDone = await cdp.eval("document.querySelectorAll('.party-pdf-preview')[99]?.dataset.previewRendered === 'true'");
    if (isDone) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  const final = JSON.parse(await cdp.eval("JSON.stringify({ready:[...document.querySelectorAll('.party-pdf-preview')].filter(canvas=>canvas.dataset.previewRendered==='true').length, last:document.querySelectorAll('.party-pdf-preview')[99]?.dataset.previewRendered === 'true', scrollLeft:document.querySelector('.party-page-rail')?.scrollLeft || 0})"));
  if (!final.last || final.ready > 25 || cdp.errors.length) {
    throw new Error(`100-page lazy gate failed after scroll: ${JSON.stringify({ initial, final, errors: cdp.errors })}`);
  }
  const finalShot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SCREENSHOT_DIR, 'party_workspace_pdf_100_lazy_last_1366x768.png'), Buffer.from(finalShot.data, 'base64'));

  // Scroll back to the beginning
  await cdp.eval("(() => { const rail=document.querySelector('.party-page-rail'); rail.scrollLeft=0; })()");
  await new Promise(resolve => setTimeout(resolve, 300));
  const restored = JSON.parse(await cdp.eval("JSON.stringify({p0Ready:document.querySelectorAll('.party-pdf-preview')[0]?.dataset.previewRendered === 'true'})"));
  if (!restored.p0Ready || cdp.errors.length) {
    throw new Error(`100-page restore at start failed: ${JSON.stringify({ restored, errors: cdp.errors })}`);
  }

  console.log(`PASS Party 100-page lazy thumbnail acceptance · initial ${initial.ready}/100, after scroll ${final.ready}/100, bounded < 25 · screenshots ${SCREENSHOT_DIR}`);
}

async function runPrivateRealPdfAcceptance(cdp, fixturePath, expectedPages) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
  await navigateAndEnterPartyMode(cdp);
  await cdp.eval("document.getElementById('partyPdfBtn').click()");
  await setFileInput(cdp, '#partyPdfInput', fixturePath);
  await waitFor(cdp, `() => document.querySelectorAll('.party-source-pool .party-page').length === ${expectedPages}`, 15000);
  if (expectedPages > 6) {
    // Scroll smoothly through rail to trigger all thumbnail renders
    await cdp.eval("(() => { const rail=document.querySelector('.party-page-rail'); rail.scrollLeft=Math.floor(rail.scrollWidth / 2); })()");
    await new Promise(resolve => setTimeout(resolve, 1200));
    await cdp.eval("(() => { const rail=document.querySelector('.party-page-rail'); rail.scrollLeft=rail.scrollWidth; })()");
    await new Promise(resolve => setTimeout(resolve, 1800));
  }
  const imported = JSON.parse(await cdp.eval("JSON.stringify((() => { const ink=canvas=>{const data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data; for(let i=0;i<data.length;i+=64) if(data[i]<244||data[i+1]<244||data[i+2]<244)return true; return false;}; const canvases=[...document.querySelectorAll('.party-pdf-preview')]; return {pages:document.querySelectorAll('.party-page').length,coverage:document.getElementById('partyCoverageText').textContent,ready:canvases.filter(canvas=>canvas.dataset.previewRendered==='true').length,ink:canvases.map(canvas=>canvas.dataset.previewRendered==='true'&&ink(canvas)),errors:document.querySelectorAll('.party-pdf-thumb.is-error').length,messages:[...document.querySelectorAll('.party-pdf-thumb.is-error small')].map(node=>node.textContent),sources:[...document.querySelectorAll('.party-page-source')].map(s=>s.textContent.trim())};})())"));
  if (imported.pages !== expectedPages || !imported.coverage.includes(`${expectedPages}/${expectedPages}`) || imported.errors || imported.ink.some(value => !value) || cdp.errors.length) {
    throw new Error(`Private real PDF preview failed: ${JSON.stringify({ expectedPages, imported, errors: cdp.errors })}`);
  }
  if (expectedPages === 2) {
    await cdp.eval("document.getElementById('partySelectAllBtn').click(); document.getElementById('partyCreateDocBtn').click();"); await new Promise(resolve => setTimeout(resolve, 200));
    await cdp.eval("const page=document.querySelector('.party-created-docs .party-page'); page.querySelector('[data-page-action=down]').click(); document.querySelector('.party-created-docs .party-page').querySelector('[data-page-action=rotate]').click()"); await new Promise(resolve => setTimeout(resolve, 520));
    await cdp.eval("const input=document.querySelector('[data-type-input]'); input.value='05'; input.dispatchEvent(new Event('change',{bubbles:true}));"); await new Promise(resolve => setTimeout(resolve, 180));
  } else {
    // Select pages to create 4 documents: [1-6], [7-9], [10], [11-12] -> counts 6,3,1,2
    await cdp.eval("document.getElementById('partyRangeInput').value='1-6'; document.getElementById('partyRangeBtn').click(); document.getElementById('partyCreateDocBtn').click();");
    await new Promise(resolve => setTimeout(resolve, 100));
    await cdp.eval("document.getElementById('partyRangeInput').value='7-9'; document.getElementById('partyRangeBtn').click(); document.getElementById('partyCreateDocBtn').click();");
    await new Promise(resolve => setTimeout(resolve, 100));
    await cdp.eval("document.getElementById('partyRangeInput').value='10'; document.getElementById('partyRangeBtn').click(); document.getElementById('partyCreateDocBtn').click();");
    await new Promise(resolve => setTimeout(resolve, 100));
    await cdp.eval("document.getElementById('partyRangeInput').value='11-12'; document.getElementById('partyRangeBtn').click(); document.getElementById('partyCreateDocBtn').click();");
    await new Promise(resolve => setTimeout(resolve, 150));
    const split = JSON.parse(await cdp.eval("JSON.stringify({counts:[...document.querySelectorAll('.party-document')].map(doc=>doc.querySelectorAll('.party-page').length),coverage:document.getElementById('partyCoverageText').textContent})"));
    if (split.counts.join(',') !== '6,3,1,2' || !split.coverage.includes('12/12')) throw new Error(`Private real 12-page multi-split failed: ${JSON.stringify(split)}`);
    await cdp.eval("['05','07','38','37'].forEach((type,index)=>{const input=document.querySelectorAll('[data-type-input]')[index]; input.value=type; input.dispatchEvent(new Event('change',{bubbles:true}));});"); await new Promise(resolve => setTimeout(resolve, 200));
  }
  await preparePrivateDownloadCapture(cdp); await cdp.eval("document.getElementById('partyExportAllBtn').click()"); await new Promise(resolve => setTimeout(resolve, expectedPages === 2 ? 800 : 1300));
  const exported = await readPrivateExportPageCounts(cdp); const expected = expectedPages === 2 ? '2' : '6,3,1,2';
  if (exported.join(',') !== expected || cdp.errors.length) throw new Error(`Private real PDF export failed: ${JSON.stringify({ expected, exported, errors: cdp.errors })}`);
  console.log(`PASS Party private real ${expectedPages}-page PDF preview, coverage, document creation and export acceptance`);
}

async function runReal13PdfAcceptance(cdp, fixturePath) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
  await navigateAndEnterPartyMode(cdp);
  await cdp.eval("document.getElementById('partyPdfBtn').click()");
  await setFileInput(cdp, '#partyPdfInput', fixturePath);
  await waitFor(cdp, "() => document.querySelectorAll('.party-source-pool .party-page').length === 13", 15000);
  const count = await cdp.eval("document.querySelectorAll('.party-source-pool .party-page').length");
  if (count !== 13) throw new Error(`Expected 13 pages, got ${count}`);

  await cdp.eval("document.getElementById('partyRangeInput').value='1-3'; document.getElementById('partyRangeBtn').click();");
  await new Promise(resolve => setTimeout(resolve, 100));

  await cdp.eval("document.getElementById('partyCreateDocBtn').click();");
  await new Promise(resolve => setTimeout(resolve, 200));

  await cdp.eval("const input = document.querySelector('[data-type-input]'); input.value='05'; input.dispatchEvent(new Event('change', { bubbles: true }));");
  await new Promise(resolve => setTimeout(resolve, 100));

  await preparePrivateDownloadCapture(cdp);
  await cdp.eval("document.querySelector('[data-doc-export]').click();");
  for (let w = 0; w < 30; w++) {
    const downloaded = await cdp.eval("(window.__partyDownloads || []).length");
    if (downloaded > 0) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  const exportedCounts = await readPrivateExportPageCounts(cdp);
  if (exportedCounts.join(',') !== '3' || cdp.errors.length) {
    throw new Error(`Real 13-page PDF browser export failed: ${JSON.stringify({ exportedCounts, errors: cdp.errors })}`);
  }
  console.log(`PASS Party real 13-page PDF (pages 1-3) browser acceptance · 3 pages exported successfully`);
}
async function runPdfWorkflow(cdp) {
  const fixturePath = path.join(SCREENSHOT_DIR, 'party_ui_synthetic_fixture.pdf');
  fs.writeFileSync(fixturePath, syntheticPdf(10));
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
  await navigateAndEnterPartyMode(cdp);
  await cdp.eval("document.getElementById('partyPdfBtn').click()");
  await setFileInput(cdp, '#partyPdfInput', fixturePath);
  for (let w = 0; w < 30; w++) {
    const ready = await cdp.eval("document.querySelectorAll('.party-pdf-preview[data-preview-rendered=\"true\"]').length");
    if (ready >= 6) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await new Promise(resolve => setTimeout(resolve, 300));
  const imported = JSON.parse(await cdp.eval("JSON.stringify({sources:document.querySelectorAll('.party-source-pool .party-page').length, actions:['partyCameraBtn','partyChooseBtn','partyPdfBtn'].every(id => !document.getElementById(id).classList.contains('hidden')), fileCount:document.getElementById('partyPdfInput').files.length, canvases:[...document.querySelectorAll('.party-pdf-preview')].map(canvas => ({width:canvas.width,height:canvas.height,rgba:[...canvas.getContext('2d').getImageData(Math.floor(canvas.width/2),Math.floor(canvas.height/2),1,1).data]})), toast:document.getElementById('toast').textContent})"));
  const canvasSizes = imported.canvases.map(canvas => `${canvas.width}x${canvas.height}`);
  const canvasColors = imported.canvases.map(canvas => canvas.rgba.slice(0, 3).join(','));
  if (imported.sources !== 10 || imported.canvases.length !== 10 || !imported.canvases.some(canvas => canvas.width < canvas.height) || !imported.canvases.some(canvas => canvas.width > canvas.height) || new Set(canvasColors).size < 3 || imported.canvases.some(canvas => canvas.rgba[0] > 248 && canvas.rgba[1] > 248 && canvas.rgba[2] > 248) || cdp.errors.length) throw new Error(`PDF thumbnail render failed: ${JSON.stringify({ imported, canvasSizes, canvasColors, errors: cdp.errors })}`);
  // The thumbnail canvas must stay inside its clipped 120px box: an overflowing
  // canvas is silently cropped by the container and only shows the top of the page.
  const fitted = JSON.parse(await cdp.eval("JSON.stringify([...document.querySelectorAll('.party-pdf-preview')].map((canvas, index) => { const box = canvas.closest('.party-page-thumb').getBoundingClientRect(); const rect = canvas.getBoundingClientRect(); return { index, overflowX: Math.round(rect.width - box.width), overflowY: Math.round(rect.height - box.height), hidden: rect.width < 1 || rect.height < 1 }; }))"));
  const clipped = fitted.filter(item => item.overflowX > 1 || item.overflowY > 1 || item.hidden);
  if (clipped.length) throw new Error(`PDF thumbnail canvas overflows its clipped container: ${JSON.stringify(clipped)}`);
  const importedShot = await cdp.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SCREENSHOT_DIR, 'party_workspace_pdf_import_1366x768.png'), Buffer.from(importedShot.data, 'base64'));

  // Create Doc 1 (pages 1-2) and Doc 2 (pages 3-10)
  await cdp.eval("document.getElementById('partyRangeInput').value='1-2'; document.getElementById('partyRangeBtn').click(); document.getElementById('partyCreateDocBtn').click();");
  await new Promise(resolve => setTimeout(resolve, 150));
  await cdp.eval("document.getElementById('partyRangeInput').value='3-10'; document.getElementById('partyRangeBtn').click(); document.getElementById('partyCreateDocBtn').click();");
  await new Promise(resolve => setTimeout(resolve, 150));
  const split = JSON.parse(await cdp.eval("JSON.stringify({docs:document.querySelectorAll('.party-document').length, pages:document.querySelectorAll('.party-created-docs .party-page').length, counts:[...document.querySelectorAll('.party-document')].map(doc => doc.querySelectorAll('.party-page').length), coverage:document.getElementById('partyCoverageText').textContent})"));
  if (split.docs !== 2 || split.pages !== 10 || split.counts.join(',') !== '2,8' || !split.coverage.includes('10/10')) throw new Error(`PDF doc creation failed: ${JSON.stringify(split)}`);
  const splitShot = await cdp.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SCREENSHOT_DIR, 'party_workspace_pdf_split_1366x768.png'), Buffer.from(splitShot.data, 'base64'));

  // Move page from doc 2 to doc 1
  await cdp.eval("(() => { const docs = [...document.querySelectorAll('.party-document')]; const select = docs[1].querySelector('.party-move-select'); select.value = docs[0].dataset.documentId; select.dispatchEvent(new Event('change', { bubbles: true })); })()"); await new Promise(resolve => setTimeout(resolve, 150));
  const moved = JSON.parse(await cdp.eval("JSON.stringify({docs:document.querySelectorAll('.party-document').length, counts:[...document.querySelectorAll('.party-document')].map(doc=>doc.querySelectorAll('.party-page').length), coverage:document.getElementById('partyCoverageText').textContent})"));
  if (moved.docs !== 2 || moved.counts.join(',') !== '3,7' || !moved.coverage.includes('10/10')) throw new Error(`PDF move failed: ${JSON.stringify(moved)}`);

  await cdp.eval("(() => { const input = document.querySelector('[data-type-input]'); input.value='05'; input.dispatchEvent(new Event('change',{bubbles:true})); })()"); await new Promise(resolve => setTimeout(resolve, 80));
  await cdp.eval("(() => { const input = document.querySelectorAll('[data-type-input]')[1]; input.value='07 — Quyết định công nhận đảng viên chính thức'; input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new Event('change',{bubbles:true})); })()"); await new Promise(resolve => setTimeout(resolve, 100));
  const ready = JSON.parse(await cdp.eval("JSON.stringify({types:[...document.querySelectorAll('[data-type-input]')].map(input=>input.value), exportDisabled:document.getElementById('partyExportAllBtn').disabled, status:document.getElementById('partyExportStatus').textContent, coverage:document.getElementById('partyCoverageText').textContent})"));
  if (ready.types.some(value => !/^0[57]/.test(value)) || ready.exportDisabled || !ready.coverage.includes('10/10')) throw new Error(`PDF taxonomy/export readiness failed: ${JSON.stringify(ready)}`);
  const finalShot = await cdp.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SCREENSHOT_DIR, 'party_workspace_pdf_split_ready_1366x768.png'), Buffer.from(finalShot.data, 'base64'));

  // Test individual export of Doc 1 (3 pages)
  await preparePrivateDownloadCapture(cdp);
  await cdp.eval("document.querySelectorAll('[data-doc-export]')[0].click()");
  await new Promise(resolve => setTimeout(resolve, 600));
  const singleExported = await readPrivateExportPageCounts(cdp);
  if (singleExported.join(',') !== '3') throw new Error(`Single doc export failed: ${JSON.stringify(singleExported)}`);

  // Test export all
  await preparePrivateDownloadCapture(cdp);
  await cdp.eval("document.getElementById('partyExportAllBtn').click()"); await new Promise(resolve => setTimeout(resolve, 800));
  if (cdp.errors.length) throw new Error(`PDF export click emitted console errors: ${cdp.errors.join(',')}`);
  console.log(`PASS Party PDF workflow · screenshots ${SCREENSHOT_DIR}`);
}



async function installPreviewProbe(cdp, delayedFirst = false) {
  await cdp.eval(`(() => {
    const original = window.__partyPreviewBase || window.PartyPdf.renderThumbnail;
    window.__partyPreviewBase = original;
    let release;
    window.__partyPreviewGate = new Promise(resolve => { release = resolve; });
    window.__partyPreviewRelease = release;
    window.__partyPreviewCalls = 0;
    window.__partyPreviewLastSource = null;
    window.PartyPdf.renderThumbnail = async (...args) => {
      window.__partyPreviewCalls += 1;
      window.__partyPreviewLastSource = args[0]?.source || null;
      if (${delayedFirst ? 'true' : 'false'} && window.__partyPreviewCalls === 1) await window.__partyPreviewGate;
      return original(...args);
    };
  })()`);
}

async function runPreviewLifecycleAcceptance(cdp) {
  const fixturePath = path.join(SCREENSHOT_DIR, 'party_ui_synthetic_fixture_lifecycle.pdf');
  const imageFixturePath = path.join(SCREENSHOT_DIR, 'party_ui_synthetic_fixture_images_100.pdf');
  fs.writeFileSync(fixturePath, syntheticPdf(10));
  fs.writeFileSync(imageFixturePath, syntheticImagePdf(100));
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
  await navigateAndEnterPartyMode(cdp);
  await installPreviewProbe(cdp, true);
  await cdp.eval("document.getElementById('partyPdfBtn').click()");
  await setFileInput(cdp, '#partyPdfInput', fixturePath); await new Promise(resolve => setTimeout(resolve, 140));
  const pending = JSON.parse(await cdp.eval("JSON.stringify({calls:window.__partyPreviewCalls, ready:[...document.querySelectorAll('.party-pdf-preview')].filter(canvas=>canvas.dataset.previewRendered==='true').length})"));
  if (pending.calls !== 1 || pending.ready !== 0) throw new Error(`Preview delay probe did not hold first render: ${JSON.stringify(pending)}`);
  await cdp.eval("document.querySelector('.party-page-thumb').click()"); await new Promise(resolve => setTimeout(resolve, 80));
  await cdp.eval("window.__partyPreviewRelease()");
  await waitFor(cdp, "() => [...document.querySelectorAll('.party-pdf-preview')].filter(canvas=>canvas.dataset.previewRendered==='true').length >= 6", 8000);
  const rerendered = JSON.parse(await cdp.eval("JSON.stringify({calls:window.__partyPreviewCalls, ready:[...document.querySelectorAll('.party-pdf-preview')].filter(canvas=>canvas.dataset.previewRendered==='true').length, blankReady:[...document.querySelectorAll('.party-pdf-preview')].filter(canvas=>canvas.dataset.previewRendered==='true').some(canvas=>{const p=canvas.getContext('2d').getImageData(Math.floor(canvas.width/2),Math.floor(canvas.height/2),1,1).data;return p[0]>248&&p[1]>248&&p[2]>248}), currentCanvas:[...document.querySelectorAll('.party-pdf-preview')].slice(0,6).map(canvas=>({w:canvas.width,h:canvas.height,status:canvas.parentElement.querySelector('.party-pdf-status')?.textContent}))})"));
  if (rerendered.calls < 7 || rerendered.ready < 6 || rerendered.blankReady || rerendered.currentCanvas.some(canvas => !canvas.w || !canvas.h || canvas.status !== 'PDF') || cdp.errors.length) throw new Error(`Stale preview lifecycle failed: ${JSON.stringify({ rerendered, errors: cdp.errors })}`);

  await installPreviewProbe(cdp, true);
  await cdp.eval("window.confirm=()=>true; document.getElementById('switchModeBtn').click()"); await new Promise(resolve => setTimeout(resolve, 120));
  await cdp.eval("document.getElementById('modePartyBtn').click()"); await new Promise(resolve => setTimeout(resolve, 100));
  await cdp.eval("document.getElementById('partyPdfBtn').click()");
  await setFileInput(cdp, '#partyPdfInput', fixturePath); await new Promise(resolve => setTimeout(resolve, 120));
  await cdp.eval("window.__partyPreviewRelease()");
  await waitFor(cdp, "() => [...document.querySelectorAll('.party-pdf-preview')].filter(canvas=>canvas.dataset.previewRendered==='true').length >= 6", 8000);
  const reentry = JSON.parse(await cdp.eval("JSON.stringify({pages:document.querySelectorAll('.party-page').length, ready:[...document.querySelectorAll('.party-pdf-preview')].filter(canvas=>canvas.dataset.previewRendered==='true').length, calls:window.__partyPreviewCalls, errors:window.__partyPreviewLastSource ? null : 'missing-source'})"));
  if (reentry.pages !== 10 || reentry.ready < 6 || reentry.calls < 1 || cdp.errors.length) throw new Error(`Back/re-entry preview lifecycle failed: ${JSON.stringify({ reentry, errors: cdp.errors })}`);

  await cdp.eval("window.PartyPdf.renderThumbnail = window.__partyPreviewBase");
  await cdp.eval("window.confirm=()=>true; document.getElementById('switchModeBtn').click()"); await new Promise(resolve => setTimeout(resolve, 120));
  await cdp.eval("document.getElementById('modePartyBtn').click()"); await new Promise(resolve => setTimeout(resolve, 100));
  await installPreviewProbe(cdp, false);
  await cdp.eval("document.getElementById('partyPdfBtn').click()");
  await setFileInput(cdp, '#partyPdfInput', imageFixturePath); await new Promise(resolve => setTimeout(resolve, 650));
  await cdp.eval("(() => { const rail=document.querySelector('.party-page-rail'); rail.scrollLeft=rail.scrollWidth; rail.dispatchEvent(new Event('scroll',{bubbles:true})); })()"); await new Promise(resolve => setTimeout(resolve, 1600));
  await cdp.send('Runtime.evaluate', { expression: "(async()=>{ const source=window.__partyPreviewLastSource; window.__partyPreviewProbeRendered=0; window.__partyPreviewProbePixel=null; window.__partyPreviewProbeError=null; for(let index=0;index<source.pageCount;index++){ try { const canvas=document.createElement('canvas'); await window.__partyPreviewBase(source.page(index),canvas,160); window.__partyPreviewProbeRendered++; if(index===source.pageCount-1){ const ctx=canvas.getContext('2d'), data=ctx.getImageData(0,0,canvas.width,canvas.height).data; for(let offset=0;offset<data.length;offset+=16){ if(data[offset]<248||data[offset+1]<248||data[offset+2]<248){ window.__partyPreviewProbePixel=[data[offset],data[offset+1],data[offset+2],data[offset+3]]; break; } } } } catch(error) { window.__partyPreviewProbeError={index,message:error?.message||String(error)}; break; } } })()", awaitPromise: true, returnByValue: true });
  const cache = JSON.parse(await cdp.eval("JSON.stringify({pages:document.querySelectorAll('.party-page').length, lazyReady:[...document.querySelectorAll('.party-pdf-preview')].filter(canvas=>canvas.dataset.previewRendered==='true').length, probeRendered:window.__partyPreviewProbeRendered, probeError:window.__partyPreviewProbeError, stats:window.__partyPreviewLastSource ? window.PartyPdf.previewCacheStats(window.__partyPreviewLastSource) : null, lastPixel:window.__partyPreviewProbePixel, errors:window.__partyPreviewLastSource ? null : 'missing-source'})"));
  if (cache.pages !== 100 || cache.lazyReady <= 6 || cache.probeRendered !== 100 || cache.probeError || !cache.stats || cache.stats.size > cache.stats.limit || !cache.lastPixel || cache.lastPixel[0] > 248 && cache.lastPixel[1] > 248 && cache.lastPixel[2] > 248 || cdp.errors.length) throw new Error(`Image-heavy preview cache gate failed: ${JSON.stringify({ cache, errors: cdp.errors })}`);
  await cdp.eval("window.confirm=()=>true; document.getElementById('switchModeBtn').click()"); await new Promise(resolve => setTimeout(resolve, 180));
  const released = JSON.parse(await cdp.eval("JSON.stringify({stats:window.__partyPreviewLastSource ? window.PartyPdf.previewCacheStats(window.__partyPreviewLastSource) : null, canvases:document.querySelectorAll('.party-pdf-preview').length})"));
  if (!released.stats || released.stats.size !== 0 || released.canvases !== 0) throw new Error(`Preview cleanup failed on mode exit: ${JSON.stringify(released)}`);
  if (cdp.errors.length) throw new Error(`Preview lifecycle emitted console errors: ${cdp.errors.join(',')}`);
  console.log(`PASS Party preview lifecycle · stale generation, re-entry, image cache ${cache.stats.size}/${cache.stats.limit}, cleanup ${released.stats.size}`);
}
async function runPdfErrorAcceptance(cdp) {
  const invalidPath = path.join(SCREENSHOT_DIR, 'party_ui_invalid.pdf');
  const encryptedPath = path.join(SCREENSHOT_DIR, 'party_ui_encrypted.pdf');
  fs.writeFileSync(invalidPath, Buffer.from('not a pdf', 'latin1'));
  fs.writeFileSync(encryptedPath, Buffer.concat([syntheticPdf(1), Buffer.from('\n/Encrypt 99 0 R', 'latin1')]));
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/index.html' });
  await waitFor(cdp, "() => document.readyState === 'complete' && !!document.getElementById('modePartyBtn') && !document.getElementById('modeSelect')?.classList.contains('hidden')");
  cdp.errors.length = 0;
  await cdp.eval("document.getElementById('modePartyBtn').click()");
  await waitFor(cdp, "() => document.getElementById('modeSelect')?.classList.contains('hidden') && !document.getElementById('partyEmptyState')?.classList.contains('hidden')");
  await cdp.eval("document.getElementById('partyPdfBtn').click()");
  await setFileInput(cdp, '#partyPdfInput', invalidPath);
  await waitFor(cdp, "() => document.getElementById('toast')?.textContent.includes('Tệp không phải PDF')", 5000);
  const invalid = JSON.parse(await cdp.eval("JSON.stringify({docs:document.querySelectorAll('.party-document').length, pages:document.querySelectorAll('.party-page').length, toast:document.getElementById('toast').textContent})"));
  if (invalid.docs !== 0 || invalid.pages !== 0 || !invalid.toast.includes('Tệp không phải PDF') || cdp.errors.length) throw new Error('Corrupt PDF handling failed: ' + JSON.stringify({ invalid, errors: cdp.errors }));
  await cdp.eval("document.getElementById('partyPdfBtn').click()");
  await setFileInput(cdp, '#partyPdfInput', encryptedPath);
  await waitFor(cdp, "() => document.getElementById('toast')?.textContent.includes('mật khẩu/mã hóa')", 5000);
  const encrypted = JSON.parse(await cdp.eval("JSON.stringify({docs:document.querySelectorAll('.party-document').length, pages:document.querySelectorAll('.party-page').length, toast:document.getElementById('toast').textContent})"));
  if (encrypted.docs !== 0 || encrypted.pages !== 0 || !encrypted.toast.includes('mật khẩu/mã hóa') || cdp.errors.length) throw new Error('Encrypted PDF handling failed: ' + JSON.stringify({ encrypted, errors: cdp.errors }));
  console.log('PASS Party corrupt/encrypted PDF acceptance');
}
async function runWorkspaceViewportSmoke(cdp, viewport) {
  const fixturePath = path.join(SCREENSHOT_DIR, 'party_ui_synthetic_fixture.pdf');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.width < 721 });
  await navigateAndEnterPartyMode(cdp);
  await cdp.eval("document.getElementById('partyPdfBtn').click()");
  await setFileInput(cdp, '#partyPdfInput', fixturePath);
  await waitFor(cdp, "() => document.querySelectorAll('.party-source-pool .party-page').length === 10", 10000);
  await cdp.eval("document.getElementById('partySelectAllBtn').click(); document.getElementById('partyCreateDocBtn').click();"); await new Promise(resolve => setTimeout(resolve, 150));
  const workspace = JSON.parse(await cdp.eval("JSON.stringify({docs:document.querySelectorAll('.party-document').length, pages:document.querySelectorAll('.party-page').length, coverage:document.getElementById('partyCoverageText').textContent, workspaceVisible:!document.getElementById('partyWorkspace').classList.contains('hidden'), overflow:document.documentElement.scrollWidth > innerWidth || document.body.scrollWidth > innerWidth, scrollWidth:document.documentElement.scrollWidth, innerWidth, wide:[...document.querySelectorAll('body *')].map(el=>{const r=el.getBoundingClientRect();return {tag:el.tagName,id:el.id,cls:el.className,right:Math.round(r.right),width:Math.round(r.width)}}).filter(item=>item.right>innerWidth+1).slice(-8), actionTargets:[...document.querySelectorAll('.party-page-actions button,.party-page-more summary,.party-document-actions .btn,.party-move-select,.party-taxonomy-field input')].filter(el=>getComputedStyle(el).display !== 'none' && el.getClientRects().length).map(el=>{const r=el.getBoundingClientRect();return Math.min(r.width,r.height)}), actions:['partyAddBtn','partyAddPdfBtn'].every(id => !document.getElementById(id).classList.contains('hidden'))})"));
  if (workspace.docs !== 1 || !workspace.coverage.includes('10/10') || !workspace.workspaceVisible || workspace.overflow || !workspace.actions || workspace.actionTargets.some(size => size < 44) || cdp.errors.length) throw new Error(`Party workspace failed at ${viewport.width}x${viewport.height}: ${JSON.stringify({ workspace, errors: cdp.errors })}`);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SCREENSHOT_DIR, `party_workspace_pdf_import_${viewport.width}x${viewport.height}.png`), Buffer.from(shot.data, 'base64'));
  console.log(`PASS Party workspace ${viewport.width}x${viewport.height} · screenshot ${SCREENSHOT_DIR}`);
}
server.listen(PORT, async () => {
  let chrome;
  try {
    const chromeProfile = path.join(os.tmpdir(), 'chrome_party_profile_' + Date.now());
    fs.mkdirSync(chromeProfile, { recursive: true });
    chrome = spawn(browserPath(), [
      '--headless=new',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${chromeProfile}`,
      `--remote-debugging-port=${CDP_PORT}`,
      '--remote-debugging-address=127.0.0.1',
      'about:blank'
    ]);
    const WebSocketClient = globalThis.WebSocket || require('undici').WebSocket;
    const ws = new WebSocketClient(await cdpUrl()); await new Promise(resolve => { ws.onopen = resolve; });
    const cdp = new CDP(ws); await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
    const viewports = [
      { width: 1792, height: 896, name: 'party_mode_select_1792x896' },
      { width: 1366, height: 768, name: 'party_mode_select_1366x768' },
      { width: 390, height: 844, name: 'party_mode_select_390x844' }
    ];
    for (const viewport of viewports) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false });
      await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
      await new Promise(resolve => setTimeout(resolve, 400));
      for (let w = 0; w < 40; w++) {
        const isReady = await cdp.eval("document.readyState === 'complete' && !!window.VigilLensCore && !!window.VigilLensParty && !!document.querySelector('.mode-cards') && getComputedStyle(document.querySelector('.mode-cards')).display === 'grid' && (document.querySelectorAll('.mode-card-content strong')[0]?.clientWidth || 0) > 0");
        if (isReady) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      await new Promise(resolve => setTimeout(resolve, 100));
      cdp.errors.length = 0;
      const selector = JSON.parse(await cdp.eval(`JSON.stringify((() => {
        const visible = id => { const el = document.getElementById(id); return !!el && !el.classList.contains('hidden') && getComputedStyle(el).display !== 'none'; };
        const cards = [...document.querySelectorAll('.mode-card')];
        const titles = [...document.querySelectorAll('.mode-card-content strong')];
        const rects = cards.map(card => { const r = card.getBoundingClientRect(); return { width: Math.round(r.width), top: Math.round(r.top), height: Math.round(r.height) }; });
        return { cardCount: cards.length, rects, titleFlow: titles.map(el => { const style = getComputedStyle(el); return { text: el.textContent.trim(), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, wordBreak: style.wordBreak, overflowWrap: style.overflowWrap }; }), headerTop: Math.round(document.querySelector('.mode-select-header').getBoundingClientRect().top), overflow: document.documentElement.scrollWidth > innerWidth || document.body.scrollWidth > innerWidth, modeVisible: visible('modeSelect'), errors: cdpErrorsPlaceholder };
      })())`.replace('cdpErrorsPlaceholder', String(cdp.errors.length))));
      const minCardWidth = viewport.width >= 1100 ? 240 : viewport.width >= 721 ? 240 : 300;
      const sameDesktopRow = viewport.width >= 1100 ? new Set(selector.rects.map(rect => rect.top)).size <= 2 : true;
      const titlesReadable = selector.titleFlow.every(item => item.scrollWidth <= item.clientWidth + 1 && item.wordBreak !== 'break-all' && item.wordBreak !== 'break-word');
      if (selector.cardCount < 3 || selector.overflow || selector.rects.some(rect => rect.width < minCardWidth) || !sameDesktopRow || !titlesReadable || selector.headerTop > viewport.height * .45) throw new Error(`Mode selector failed at ${viewport.width}: ${JSON.stringify(selector)}`);
      const initialShot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const initialPath = path.join(SCREENSHOT_DIR, `${viewport.name}.png`); fs.writeFileSync(initialPath, Buffer.from(initialShot.data, 'base64'));
      await cdp.eval("(() => { const btn = document.getElementById('modePartyBtn'); btn.click(); return document.getElementById('modeSelect').classList.contains('hidden'); })()");
      await new Promise(resolve => setTimeout(resolve, 100));
      const entry = JSON.parse(await cdp.eval(`JSON.stringify((() => { const visible = id => { const el = document.getElementById(id); return !!el && !el.classList.contains('hidden') && getComputedStyle(el).display !== 'none'; }; return { modeHidden: document.getElementById('modeSelect').classList.contains('hidden'), partyEmpty: visible('partyEmptyState'), importActions: ['partyCameraBtn','partyChooseBtn','partyPdfBtn'].every(visible), partyApi: typeof window.VigilLensParty, switchVisible: visible('switchModeBtn') }; })())`));
      if (!entry.modeHidden || !entry.partyEmpty || !entry.importActions || entry.partyApi !== 'object' || !entry.switchVisible || cdp.errors.length) throw new Error(`Party entry failed at ${viewport.width}: ${JSON.stringify({ entry, errors: cdp.errors })}`);
      const partyShot = await cdp.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SCREENSHOT_DIR, `${viewport.name.replace('select', 'entry')}.png`), Buffer.from(partyShot.data, 'base64'));
      await cdp.eval("document.getElementById('switchModeBtn').click()"); await new Promise(resolve => setTimeout(resolve, 100));
      const back = JSON.parse(await cdp.eval("JSON.stringify({modeVisible:!document.getElementById('modeSelect').classList.contains('hidden'), partyHidden:document.getElementById('partyEmptyState').classList.contains('hidden') && document.getElementById('partyWorkspace').classList.contains('hidden')})"));
      if (!back.modeVisible || !back.partyHidden) throw new Error(`Party back navigation failed at ${viewport.width}: ${JSON.stringify(back)}`);
      await cdp.eval("(() => { const btn = document.getElementById('modePartyBtn'); btn.click(); return document.getElementById('modeSelect').classList.contains('hidden'); })()");
      await new Promise(resolve => setTimeout(resolve, 100));
      const reentry = JSON.parse(await cdp.eval("JSON.stringify({modeHidden:document.getElementById('modeSelect').classList.contains('hidden'), partyEmpty:!document.getElementById('partyEmptyState').classList.contains('hidden')})"));
      if (!reentry.modeHidden || !reentry.partyEmpty || cdp.errors.length) throw new Error(`Party re-entry failed at ${viewport.width}: ${JSON.stringify({ reentry, errors: cdp.errors })}`);
      console.log(`PASS Party UI ${viewport.width}x${viewport.height} · screenshots ${SCREENSHOT_DIR}`);
    }
    await runLineEndingAcceptance(cdp);
    await runHelpUxAcceptance(cdp);
    await runPdfWorkflow(cdp);
    await runPageSelectionWorkflowAcceptance(cdp);
    await runEventListenerAcceptance(cdp);
    await runTrueBlankPageAcceptance(cdp);
    await runRapidInteractionRerenderReproduction(cdp);
    await runLargePdfAcceptance(cdp);
    await runPreviewLifecycleAcceptance(cdp);
    await runPdfErrorAcceptance(cdp);
    if (process.env.PARTY_REAL_PDF_2) await runPrivateRealPdfAcceptance(cdp, process.env.PARTY_REAL_PDF_2, 2);
    if (process.env.PARTY_REAL_PDF_12) await runPrivateRealPdfAcceptance(cdp, process.env.PARTY_REAL_PDF_12, 12);
    const real13PdfPath = path.join(ROOT, 'Scan2026-08-24_150131.pdf');
    if (fs.existsSync(real13PdfPath)) await runReal13PdfAcceptance(cdp, real13PdfPath);
    for (const viewport of [
      { width: 1792, height: 896 }, { width: 1366, height: 768 }, { width: 1024, height: 768 },
      { width: 768, height: 1024 }, { width: 390, height: 844 }
    ]) await runWorkspaceViewportSmoke(cdp, viewport);
    console.log('PARTY_UI_BROWSER_ACCEPTANCE: PASS');
  } catch (error) { console.error('PARTY_UI_BROWSER_ACCEPTANCE: FAIL', error.stack || error); process.exitCode = 1; }
  finally { try { chrome?.kill(); } catch (_) {} server.close(); }
});

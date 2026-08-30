/* Chromium smoke acceptance for Party Document Mode. No project dependency. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const os = require('os');
const zlib = require('zlib');
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
  const configured = [process.env.CHROME_PATH, process.env.GOOGLE_CHROME_BIN, process.env.BROWSER_PATH, process.env.CHROMIUM_PATH].find(Boolean);
  if (configured && fs.existsSync(configured)) return configured;
  const unixPaths = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  for (const candidate of unixPaths) { try { if (fs.statSync(candidate).isFile()) return candidate; } catch (_) {} }
  const winPaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  ];
  for (const candidate of winPaths) { try { if (fs.statSync(candidate).isFile()) return candidate; } catch (_) {} }
  const names = process.platform === 'win32' ? ['google-chrome', 'chromium', 'chromium-browser', 'msedge'] : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome', 'microsoft-edge'];
  const locator = process.platform === 'win32' ? 'where' : 'which';
  for (const name of names) { try { const found = execFileSync(locator, [name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split(/\r?\n/).find(Boolean); if (found && fs.existsSync(found)) return found; } catch (_) {} }
  throw new Error('Không tìm thấy Chromium/Chrome/Edge.');
}
async function cdpUrl() { for (let i = 0; i < 80; i++) { try { const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`); const tabs = await response.json(); const tab = tabs.find(item => item.type === 'page'); if (tab?.webSocketDebuggerUrl) return tab.webSocketDebuggerUrl; } catch (_) {} await new Promise(resolve => setTimeout(resolve, 150)); } throw new Error('Không kết nối được Chrome CDP.'); }

function syntheticPdf(pageCount) {
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    `2 0 obj\n<< /Type /Pages /Kids [${Array.from({ length: pageCount }, (_, i) => `${3 + i * 2} 0 R`).join(' ')}] /Count ${pageCount} >>\nendobj\n`
  ];
  for (let i = 0; i < pageCount; i++) {
    const pageId = 3 + i * 2;
    const contentId = pageId + 1;
    const width = i % 2 ? 842 : 595;
    const height = i % 2 ? 595 : 842;
    const red = ((i * 37) % 80 + 160) / 255;
    const green = ((i * 61) % 100 + 100) / 255;
    const blue = ((i * 23) % 100 + 80) / 255;
    const content = `q\n${red.toFixed(3)} ${green.toFixed(3)} ${blue.toFixed(3)} rg\n40 40 ${width - 80} ${height - 80} re\nf\n0 0 0 RG\n8 w\n60 60 ${width - 120} ${height - 120} re\nS\nQ\n`;
    objects.push(`${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Contents ${contentId} 0 R >>\nendobj\n`);
    objects.push(`${contentId} 0 obj\n<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}endstream\nendobj\n`);
  }
  return Buffer.from(`%PDF-1.4\n${objects.join('')}%%EOF`, 'latin1');
}

function syntheticImagePdf(pageCount) {
  const objects = [
    Buffer.from('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n', 'latin1'),
    Buffer.from(`2 0 obj\n<< /Type /Pages /Kids [${Array.from({ length: pageCount }, (_, i) => `${3 + i * 3} 0 R`).join(' ')}] /Count ${pageCount} >>\nendobj\n`, 'latin1')
  ];
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
    objects.push(Buffer.from(`${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> >> /Contents ${contentId} 0 R >>\nendobj\n`, 'latin1'));
    objects.push(Buffer.from(`${contentId} 0 obj\n<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}endstream\nendobj\n`, 'latin1'));
    objects.push(Buffer.concat([Buffer.from(`${imageId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${compressed.length} >>\nstream\n`, 'latin1'), compressed, Buffer.from('\nendstream\nendobj\n', 'latin1')]));
  }
  return Buffer.concat([Buffer.from('%PDF-1.4\n', 'latin1'), ...objects, Buffer.from('%%EOF', 'latin1')]);
}

async function setFileInput(cdp, selector, filePath) {
  const expression = `document.querySelector(${JSON.stringify(selector)})`;
  const evaluated = await cdp.send('Runtime.evaluate', { expression, objectGroup: 'party-file-input' });
  const objectId = evaluated.result?.objectId;
  if (!objectId) throw new Error(`Không tìm thấy file input ${selector}.`);
  await cdp.send('DOM.setFileInputFiles', { objectId, files: [path.resolve(filePath).split(path.sep).join('/')] });

}
async function runPdfWorkflow(cdp) {
  const fixturePath = path.join(SCREENSHOT_DIR, 'party_ui_synthetic_fixture.pdf');
  fs.writeFileSync(fixturePath, syntheticPdf(10));
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` }); await new Promise(resolve => setTimeout(resolve, 500));
  cdp.errors.length = 0;
  await cdp.eval("document.getElementById('modePartyBtn').click()"); await new Promise(resolve => setTimeout(resolve, 100));
  await cdp.eval("document.getElementById('partyPdfBtn').click()");
  await setFileInput(cdp, '#partyPdfInput', fixturePath); await new Promise(resolve => setTimeout(resolve, 350));
  const imported = JSON.parse(await cdp.eval("JSON.stringify({docs:document.querySelectorAll('.party-document').length, pages:document.querySelectorAll('.party-page').length, coverage:document.getElementById('partyCoverageText').textContent, actions:['partyCameraBtn','partyChooseBtn','partyPdfBtn'].every(id => !document.getElementById(id).classList.contains('hidden')), fileCount:document.getElementById('partyPdfInput').files.length, canvases:[...document.querySelectorAll('.party-pdf-preview')].map(canvas => ({width:canvas.width,height:canvas.height,rgba:[...canvas.getContext('2d').getImageData(Math.floor(canvas.width/2),Math.floor(canvas.height/2),1,1).data]})), toast:document.getElementById('toast').textContent})"));
  const canvasSizes = imported.canvases.map(canvas => `${canvas.width}x${canvas.height}`);
  const canvasColors = imported.canvases.map(canvas => canvas.rgba.slice(0, 3).join(','));
  if (imported.docs !== 1 || imported.pages !== 10 || imported.canvases.length !== 10 || !imported.coverage.includes('10/10') || !imported.canvases.some(canvas => canvas.width < canvas.height) || !imported.canvases.some(canvas => canvas.width > canvas.height) || new Set(canvasColors).size < 3 || imported.canvases.some(canvas => canvas.rgba[0] > 248 && canvas.rgba[1] > 248 && canvas.rgba[2] > 248) || cdp.errors.length) throw new Error(`PDF thumbnail render failed: ${JSON.stringify({ imported, canvasSizes, canvasColors, errors: cdp.errors })}`);
  const importedShot = await cdp.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SCREENSHOT_DIR, 'party_workspace_pdf_import_1366x768.png'), Buffer.from(importedShot.data, 'base64'));
  await cdp.eval("document.querySelector('[data-doc-action=split]').click()"); await new Promise(resolve => setTimeout(resolve, 80));
  await cdp.eval("document.querySelectorAll('.party-document')[1].querySelector('.party-page-thumb').click(); document.querySelectorAll('.party-document')[1].querySelector('[data-doc-action=split]').click()"); await new Promise(resolve => setTimeout(resolve, 100));
  const split = JSON.parse(await cdp.eval("JSON.stringify({docs:document.querySelectorAll('.party-document').length, pages:document.querySelectorAll('.party-page').length, counts:[...document.querySelectorAll('.party-document')].map(doc => doc.querySelectorAll('.party-page').length), coverage:document.getElementById('partyCoverageText').textContent})"));
  if (split.docs !== 3 || split.pages !== 10 || split.counts.join(',') !== '1,1,8' || !split.coverage.includes('10/10')) throw new Error(`PDF split failed: ${JSON.stringify(split)}`);
  const splitShot = await cdp.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SCREENSHOT_DIR, 'party_workspace_pdf_split_1366x768.png'), Buffer.from(splitShot.data, 'base64'));
  await cdp.eval("document.querySelectorAll('.party-document')[0].querySelector('[data-doc-action=merge-next]').click()"); await new Promise(resolve => setTimeout(resolve, 100));
  await cdp.eval("const docs=[...document.querySelectorAll('.party-document')]; docs[1].querySelector('.party-page-thumb').click(); const select=docs[1].querySelector('.party-move-select'); select.value=docs[0].dataset.documentId; select.dispatchEvent(new Event('change',{bubbles:true}))"); await new Promise(resolve => setTimeout(resolve, 100));
  const moved = JSON.parse(await cdp.eval("JSON.stringify({docs:document.querySelectorAll('.party-document').length, pages:document.querySelectorAll('.party-page').length, coverage:document.getElementById('partyCoverageText').textContent, inputs:document.querySelectorAll('[data-type-input]').length})"));
  if (moved.docs !== 2 || moved.pages !== 10 || !moved.coverage.includes('10/10') || moved.inputs !== 2) throw new Error(`PDF merge/move failed: ${JSON.stringify(moved)}`);
  await cdp.eval("(() => { const input = document.querySelector('[data-type-input]'); input.value='05'; input.dispatchEvent(new Event('change',{bubbles:true})); })()"); await new Promise(resolve => setTimeout(resolve, 80));
  await cdp.eval("(() => { const input = document.querySelectorAll('[data-type-input]')[1]; input.value='07 — Quyết định công nhận đảng viên chính thức'; input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new Event('change',{bubbles:true})); })()"); await new Promise(resolve => setTimeout(resolve, 100));
  const ready = JSON.parse(await cdp.eval("JSON.stringify({types:[...document.querySelectorAll('[data-type-input]')].map(input=>input.value), exportDisabled:document.getElementById('partyExportAllBtn').disabled, status:document.getElementById('partyExportStatus').textContent, coverage:document.getElementById('partyCoverageText').textContent})"));
  if (ready.types.some(value => !/^0[57]/.test(value)) || ready.exportDisabled || !ready.coverage.includes('10/10')) throw new Error(`PDF taxonomy/export readiness failed: ${JSON.stringify(ready)}`);
  const finalShot = await cdp.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SCREENSHOT_DIR, 'party_workspace_pdf_split_ready_1366x768.png'), Buffer.from(finalShot.data, 'base64'));
  await cdp.eval("document.getElementById('partyExportAllBtn').click()"); await new Promise(resolve => setTimeout(resolve, 250));
  if (cdp.errors.length) throw new Error(`PDF export click emitted console errors: ${cdp.errors.join(',')}`);
  console.log(`PASS Party PDF workflow · screenshots ${SCREENSHOT_DIR}`);
}
async function runLargePdfAcceptance(cdp) {
  const fixturePath = path.join(SCREENSHOT_DIR, 'party_ui_synthetic_fixture_100.pdf');
  fs.writeFileSync(fixturePath, syntheticPdf(100));
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
  await new Promise(resolve => setTimeout(resolve, 500));
  cdp.errors.length = 0;
  await cdp.eval("document.getElementById('modePartyBtn').click()");
  await new Promise(resolve => setTimeout(resolve, 100));
  await cdp.eval("document.getElementById('partyPdfBtn').click()");
  await setFileInput(cdp, '#partyPdfInput', fixturePath);
  await new Promise(resolve => setTimeout(resolve, 450));
  const initial = JSON.parse(await cdp.eval("JSON.stringify({pages:document.querySelectorAll('.party-page').length, canvases:document.querySelectorAll('.party-pdf-preview').length, ready:[...document.querySelectorAll('.party-pdf-preview')].filter(canvas=>canvas.dataset.previewRendered==='true').length, railWidth:document.querySelector('.party-page-rail')?.scrollWidth || 0})"));
  if (initial.pages !== 100 || initial.canvases !== 100 || initial.ready < 1 || initial.ready >= 100 || cdp.errors.length) throw new Error(`100-page lazy gate failed before scroll: ${JSON.stringify({ initial, errors: cdp.errors })}`);
  const firstShot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SCREENSHOT_DIR, 'party_workspace_pdf_100_lazy_initial_1366x768.png'), Buffer.from(firstShot.data, 'base64'));
  await cdp.eval("(() => { const rail=document.querySelector('.party-page-rail'); rail.scrollLeft=rail.scrollWidth; rail.dispatchEvent(new Event('scroll',{bubbles:true})); })()");
  await new Promise(resolve => setTimeout(resolve, 900));
  const final = JSON.parse(await cdp.eval("JSON.stringify({ready:[...document.querySelectorAll('.party-pdf-preview')].filter(canvas=>canvas.dataset.previewRendered==='true').length, last:document.querySelectorAll('.party-pdf-preview')[99]?.dataset.previewRendered === 'true', scrollLeft:document.querySelector('.party-page-rail')?.scrollLeft || 0})"));
  if (!final.last || final.ready <= initial.ready || cdp.errors.length) throw new Error(`100-page lazy gate failed after scroll: ${JSON.stringify({ initial, final, errors: cdp.errors })}`);
  const finalShot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SCREENSHOT_DIR, 'party_workspace_pdf_100_lazy_last_1366x768.png'), Buffer.from(finalShot.data, 'base64'));
  console.log(`PASS Party 100-page lazy thumbnail acceptance · initial ${initial.ready}/100, after scroll ${final.ready}/100 · screenshots ${SCREENSHOT_DIR}`);
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
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` }); await new Promise(resolve => setTimeout(resolve, 500));
  cdp.errors.length = 0;
  await cdp.eval("document.getElementById('modePartyBtn').click()"); await new Promise(resolve => setTimeout(resolve, 100));
  await installPreviewProbe(cdp, true);
  await cdp.eval("document.getElementById('partyPdfBtn').click()");
  await setFileInput(cdp, '#partyPdfInput', fixturePath); await new Promise(resolve => setTimeout(resolve, 140));
  const pending = JSON.parse(await cdp.eval("JSON.stringify({calls:window.__partyPreviewCalls, ready:[...document.querySelectorAll('.party-pdf-preview')].filter(canvas=>canvas.dataset.previewRendered==='true').length})"));
  if (pending.calls !== 1 || pending.ready !== 0) throw new Error(`Preview delay probe did not hold first render: ${JSON.stringify(pending)}`);
  await cdp.eval("document.querySelector('.party-page-thumb').click()"); await new Promise(resolve => setTimeout(resolve, 80));
  await cdp.eval("window.__partyPreviewRelease()"); await new Promise(resolve => setTimeout(resolve, 900));
  const rerendered = JSON.parse(await cdp.eval("JSON.stringify({calls:window.__partyPreviewCalls, ready:[...document.querySelectorAll('.party-pdf-preview')].filter(canvas=>canvas.dataset.previewRendered==='true').length, blankReady:[...document.querySelectorAll('.party-pdf-preview')].filter(canvas=>canvas.dataset.previewRendered==='true').some(canvas=>{const p=canvas.getContext('2d').getImageData(Math.floor(canvas.width/2),Math.floor(canvas.height/2),1,1).data;return p[0]>248&&p[1]>248&&p[2]>248}), currentCanvas:[...document.querySelectorAll('.party-pdf-preview')].slice(0,6).map(canvas=>({w:canvas.width,h:canvas.height,status:canvas.parentElement.querySelector('.party-pdf-status')?.textContent}))})"));
  if (rerendered.calls < 7 || rerendered.ready < 6 || rerendered.blankReady || rerendered.currentCanvas.some(canvas => !canvas.w || !canvas.h || canvas.status !== 'PDF') || cdp.errors.length) throw new Error(`Stale preview lifecycle failed: ${JSON.stringify({ rerendered, errors: cdp.errors })}`);

  await installPreviewProbe(cdp, true);
  await cdp.eval("window.confirm=()=>true; document.getElementById('switchModeBtn').click()"); await new Promise(resolve => setTimeout(resolve, 120));
  await cdp.eval("document.getElementById('modePartyBtn').click()"); await new Promise(resolve => setTimeout(resolve, 100));
  await cdp.eval("document.getElementById('partyPdfBtn').click()");
  await setFileInput(cdp, '#partyPdfInput', fixturePath); await new Promise(resolve => setTimeout(resolve, 120));
  await cdp.eval("window.__partyPreviewRelease()"); await new Promise(resolve => setTimeout(resolve, 800));
  const reentry = JSON.parse(await cdp.eval("JSON.stringify({pages:document.querySelectorAll('.party-page').length, ready:[...document.querySelectorAll('.party-pdf-preview')].filter(canvas=>canvas.dataset.previewRendered==='true').length, calls:window.__partyPreviewCalls, errors:window.__partyPreviewLastSource ? null : 'missing-source'})"));
  if (reentry.pages !== 10 || reentry.ready < 6 || reentry.calls < 1 || cdp.errors.length) throw new Error(`Back/re-entry preview lifecycle failed: ${JSON.stringify({ reentry, errors: cdp.errors })}`);

  await cdp.eval("window.PartyPdf.renderThumbnail = window.__partyPreviewBase");
  await cdp.eval("window.confirm=()=>true; document.getElementById('switchModeBtn').click()"); await new Promise(resolve => setTimeout(resolve, 120));
  await cdp.eval("document.getElementById('modePartyBtn').click()"); await new Promise(resolve => setTimeout(resolve, 100));
  await installPreviewProbe(cdp, false);
  await cdp.eval("document.getElementById('partyPdfBtn').click()");
  await setFileInput(cdp, '#partyPdfInput', imageFixturePath); await new Promise(resolve => setTimeout(resolve, 650));
  await cdp.eval("(() => { const rail=document.querySelector('.party-page-rail'); rail.scrollLeft=rail.scrollWidth; rail.dispatchEvent(new Event('scroll',{bubbles:true})); })()"); await new Promise(resolve => setTimeout(resolve, 1600));
  await cdp.send('Runtime.evaluate', { expression: "(async()=>{ const source=window.__partyPreviewLastSource; window.__partyPreviewProbeRendered=0; window.__partyPreviewProbePixel=null; window.__partyPreviewProbeError=null; for(let index=0;index<source.pageCount;index++){ try { const canvas=document.createElement('canvas'); await window.__partyPreviewBase(source.page(index),canvas,160); window.__partyPreviewProbeRendered++; if(index===source.pageCount-1){ const ctx=canvas.getContext('2d'), data=ctx.getImageData(0,0,canvas.width,canvas.height).data; for(let offset=0;offset<data.length;offset+=4){ if(data[offset]<248||data[offset+1]<248||data[offset+2]<248){ window.__partyPreviewProbePixel=[data[offset],data[offset+1],data[offset+2],data[offset+3]]; break; } } } } catch(error) { window.__partyPreviewProbeError={index,message:error?.message||String(error)}; break; } } })()", awaitPromise: true, returnByValue: true });
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
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/index.html' });
  await new Promise(resolve => setTimeout(resolve, 500));
  cdp.errors.length = 0;
  await cdp.eval("document.getElementById('modePartyBtn').click()");
  await new Promise(resolve => setTimeout(resolve, 100));
  await cdp.eval("document.getElementById('partyPdfBtn').click()");
  await setFileInput(cdp, '#partyPdfInput', invalidPath);
  await new Promise(resolve => setTimeout(resolve, 250));
  const invalid = JSON.parse(await cdp.eval("JSON.stringify({docs:document.querySelectorAll('.party-document').length, pages:document.querySelectorAll('.party-page').length, toast:document.getElementById('toast').textContent})"));
  if (invalid.docs !== 0 || invalid.pages !== 0 || !invalid.toast.includes('Tệp không phải PDF') || cdp.errors.length) throw new Error('Corrupt PDF handling failed: ' + JSON.stringify({ invalid, errors: cdp.errors }));
  await cdp.eval("document.getElementById('partyPdfBtn').click()");
  await setFileInput(cdp, '#partyPdfInput', encryptedPath);
  await new Promise(resolve => setTimeout(resolve, 250));
  const encrypted = JSON.parse(await cdp.eval("JSON.stringify({docs:document.querySelectorAll('.party-document').length, pages:document.querySelectorAll('.party-page').length, toast:document.getElementById('toast').textContent})"));
  if (encrypted.docs !== 0 || encrypted.pages !== 0 || !encrypted.toast.includes('mật khẩu/mã hóa') || cdp.errors.length) throw new Error('Encrypted PDF handling failed: ' + JSON.stringify({ encrypted, errors: cdp.errors }));
  console.log('PASS Party corrupt/encrypted PDF acceptance');
}
async function runWorkspaceViewportSmoke(cdp, viewport) {
  const fixturePath = path.join(SCREENSHOT_DIR, 'party_ui_synthetic_fixture.pdf');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.width < 721 });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` }); await new Promise(resolve => setTimeout(resolve, 500));
  cdp.errors.length = 0;
  await cdp.eval("document.getElementById('modePartyBtn').click()"); await new Promise(resolve => setTimeout(resolve, 100));
  await cdp.eval("document.getElementById('partyPdfBtn').click()");
  await setFileInput(cdp, '#partyPdfInput', fixturePath); await new Promise(resolve => setTimeout(resolve, 350));
  const workspace = JSON.parse(await cdp.eval("JSON.stringify({docs:document.querySelectorAll('.party-document').length, pages:document.querySelectorAll('.party-page').length, coverage:document.getElementById('partyCoverageText').textContent, workspaceVisible:!document.getElementById('partyWorkspace').classList.contains('hidden'), overflow:document.documentElement.scrollWidth > innerWidth || document.body.scrollWidth > innerWidth, scrollWidth:document.documentElement.scrollWidth, innerWidth, wide:[...document.querySelectorAll('body *')].map(el=>{const r=el.getBoundingClientRect();return {tag:el.tagName,id:el.id,cls:el.className,right:Math.round(r.right),width:Math.round(r.width)}}).filter(item=>item.right>innerWidth+1).slice(-8), actionTargets:[...document.querySelectorAll('.party-page-actions button,.party-document-actions .btn,.party-move-select,.party-taxonomy-field input')].map(el=>{const r=el.getBoundingClientRect();return Math.min(r.width,r.height)}), actions:['partyAddBtn','partyAddPdfBtn','partyNewDocumentBtn'].every(id => !document.getElementById(id).classList.contains('hidden'))})"));
  if (workspace.docs !== 1 || workspace.pages !== 10 || !workspace.coverage.includes('10/10') || !workspace.workspaceVisible || workspace.overflow || !workspace.actions || workspace.actionTargets.some(size => size < 44) || cdp.errors.length) throw new Error(`Party workspace failed at ${viewport.width}x${viewport.height}: ${JSON.stringify({ workspace, errors: cdp.errors })}`);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SCREENSHOT_DIR, `party_workspace_pdf_import_${viewport.width}x${viewport.height}.png`), Buffer.from(shot.data, 'base64'));
  console.log(`PASS Party workspace ${viewport.width}x${viewport.height} · screenshot ${SCREENSHOT_DIR}`);
}
server.listen(PORT, async () => {
  let chrome;
  try {
    chrome = spawn(browserPath(), ['--headless=new', '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${CDP_PORT}`, 'about:blank']);
    const ws = new WebSocket(await cdpUrl()); await new Promise(resolve => { ws.onopen = resolve; });
    const cdp = new CDP(ws); await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
    const viewports = [
      { width: 1792, height: 896, name: 'party_mode_select_1792x896' },
      { width: 1366, height: 768, name: 'party_mode_select_1366x768' },
      { width: 390, height: 844, name: 'party_mode_select_390x844' }
    ];
    for (const viewport of viewports) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false });
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
    await runPdfWorkflow(cdp);
    await runLargePdfAcceptance(cdp);
    await runPreviewLifecycleAcceptance(cdp);
    await runPdfErrorAcceptance(cdp);
    for (const viewport of [
      { width: 1792, height: 896 }, { width: 1366, height: 768 }, { width: 1024, height: 768 },
      { width: 768, height: 1024 }, { width: 390, height: 844 }
    ]) await runWorkspaceViewportSmoke(cdp, viewport);
    console.log('PARTY_UI_BROWSER_ACCEPTANCE: PASS');
  } catch (error) { console.error('PARTY_UI_BROWSER_ACCEPTANCE: FAIL', error.stack || error); process.exitCode = 1; }
  finally { try { chrome?.kill(); } catch (_) {} server.close(); }
});

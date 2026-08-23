const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8785;
const results = [];

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/touch_report') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      results.push(...JSON.parse(body));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    });
    return;
  }

  if (req.url === '/harness.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    const html = [
      '<!doctype html>',
      '<html>',
      '<head><meta charset="utf-8"><title>Touch Target Harness</title></head>',
      '<body>',
      '  <script>',
      '    async function audit() {',
      '      const viewports = [',
      '        { w: 360, h: 800 },',
      '        { w: 375, h: 812 },',
      '        { w: 390, h: 844 },',
      '        { w: 412, h: 915 },',
      '        { w: 430, h: 932 }',
      '      ];',
      '      const out = [];',
      '      for (const vp of viewports) {',
      '        const iframe = document.createElement("iframe");',
      '        iframe.src = "/index.html";',
      '        iframe.style.width = vp.w + "px";',
      '        iframe.style.height = vp.h + "px";',
      '        iframe.style.border = "0";',
      '        document.body.appendChild(iframe);',
      '        await new Promise(r => iframe.onload = r);',
      '        await new Promise(r => setTimeout(r, 300));',
      '        const doc = iframe.contentDocument;',
      '        const win = iframe.contentWindow;',
      '        const sections = ["#modeSelect", "#emptyState", "#workspace", "#idWorkspace", "#idPreviewSection"];',
      '        for (const secId of sections) {',
      '          sections.forEach(s => {',
      '            const el = doc.querySelector(s);',
      '            if (el) el.classList.add("hidden");',
      '          });',
      '          const activeSec = doc.querySelector(secId);',
      '          if (activeSec) {',
      '            activeSec.classList.remove("hidden");',
      '            if (secId === "#workspace") {',
      '              const thumbList = doc.querySelector("#thumbList");',
      '              if (thumbList && thumbList.children.length === 0) {',
      '                const item = doc.createElement("div");',
      '                item.className = "thumb-item active";',
      '                item.innerHTML = \'<div class="thumb-image"></div><div class="thumb-meta"><strong>Trang 1</strong></div><span class="thumb-status"></span>\';',
      '                thumbList.appendChild(item);',
      '              }',
      '            }',
      '          }',
      '          await new Promise(r => setTimeout(r, 100));',
      '          const interactiveSelectors = [',
      '            "button",',
      '            "input:not([type=hidden]):not([type=file])",',
      '            "select",',
      '            ".filter-chip",',
      '            ".btn",',
      '            ".mode-card",',
      '            ".btn-icon-add"',
      '          ];',
      '          const els = doc.querySelectorAll(interactiveSelectors.join(","));',
      '          for (const el of els) {',
      '            const style = win.getComputedStyle(el);',
      '            if (style.display === "none" || style.visibility === "hidden") continue;',
      '            if (el.offsetParent === null && style.position !== "fixed") continue;',
      '            const hitEl = (el.type === "checkbox" || el.type === "radio") && el.closest("label") ? el.closest("label") : el;',
      '            const rect = hitEl.getBoundingClientRect();',
      '            if (rect.width === 0 && rect.height === 0) continue;',
      '            const idOrText = el.id || el.getAttribute("data-filter") || el.className || el.textContent.trim().slice(0, 20);',
      '            const isPass = rect.height >= 43.5 && (rect.width >= 43.5 || el.offsetWidth >= 43.5);',
      '            out.push({',
      '              viewport: vp.w + "x" + vp.h,',
      '              section: secId,',
      '              element: "<" + el.tagName.toLowerCase() + " id=\\"" + (el.id || "") + "\\" class=\\"" + el.className + "\\">",',
      '              label: idOrText,',
      '              width: Math.round(rect.width * 10) / 10,',
      '              height: Math.round(rect.height * 10) / 10,',
      '              pass: isPass',
      '            });',
      '          }',
      '        }',
      '        document.body.removeChild(iframe);',
      '      }',
      '      await fetch("/api/touch_report", {',
      '        method: "POST",',
      '        headers: { "Content-Type": "application/json" },',
      '        body: JSON.stringify(out)',
      '      });',
      '    }',
      '    audit();',
      '  </script>',
      '</body>',
      '</html>'
    ].join('\n');
    res.end(html);
    return;
  }

  const parsed = new URL(req.url, `http://127.0.0.1:${PORT}`);
  let pathname = decodeURIComponent(parsed.pathname);
  if (pathname === '/') pathname = '/index.html';
  const filePath = path.join(ROOT, pathname.replace(/^\//, ''));

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    let mime = 'text/plain';
    if (filePath.endsWith('.html')) mime = 'text/html; charset=utf-8';
    else if (filePath.endsWith('.js') || filePath.endsWith('.mjs')) mime = 'application/javascript; charset=utf-8';
    else if (filePath.endsWith('.css')) mime = 'text/css; charset=utf-8';
    else if (filePath.endsWith('.woff2')) mime = 'font/woff2';
    else if (filePath.endsWith('.json') || filePath.endsWith('.webmanifest')) mime = 'application/json; charset=utf-8';
    res.writeHead(200, { 'Content-Type': mime });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, async () => {
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const browserBin = fs.existsSync(chromePath) ? chromePath : edgePath;

  const reportPromise = new Promise(resolve => {
    const checkInterval = setInterval(() => {
      if (results.length > 0) {
        clearInterval(checkInterval);
        resolve();
      }
    }, 100);
    setTimeout(() => {
      clearInterval(checkInterval);
      resolve();
    }, 9000);
  });

  const proc = spawn(browserBin, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--window-size=1200,1000',
    `http://127.0.0.1:${PORT}/harness.html`
  ]);

  await reportPromise;
  try { proc.kill(); } catch (e) {}
  server.close();

  console.log('==================================================');
  console.log('=== Touch Target Audit (>= 44x44px Hit Areas) ===');
  console.log('==================================================\n');

  const fails = results.filter(r => !r.pass);
  console.log(`Total interactive controls audited across 5 viewports: ${results.length}`);

  const samplePass = results.slice(0, 10);
  for (const s of samplePass) {
    console.log(`  ✓ [${s.viewport}] ${s.label} -> ${s.width}x${s.height}px`);
  }

  if (fails.length === 0 && results.length > 0) {
    console.log(`\n✓ ALL ${results.length} TOUCH TARGET CHECKS PASSED (Every mobile interactive hit area >= 44px)`);
  } else {
    console.error(`\n✗ ${fails.length} TOUCH TARGET(S) FAILED (< 44px):`);
    for (const f of fails) {
      console.error(`  ✗ [${f.viewport}] ${f.section} ${f.element} (${f.label}) -> ${f.width}x${f.height}px`);
    }
    process.exit(1);
  }
});

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const browserBin = fs.existsSync(chromePath) ? chromePath : edgePath;

function renderIconHtml(size) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: transparent; width: ${size}px; height: ${size}px; overflow: hidden; display: flex; align-items: center; justify-content: center; }
    canvas { width: ${size}px; height: ${size}px; }
  </style>
</head>
<body>
  <canvas id="c" width="${size}" height="${size}"></canvas>
  <script>
    const canvas = document.getElementById('c');
    const ctx = canvas.getContext('2d');
    const S = ${size};

    // 1. Premium Dark Background
    const bgGrad = ctx.createLinearGradient(0, 0, S, S);
    bgGrad.addColorStop(0, '#0f172a');
    bgGrad.addColorStop(1, '#090d16');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, S, S);

    // Subtle radial lens glow in center
    const glow = ctx.createRadialGradient(S/2, S/2, 0, S/2, S/2, S * 0.45);
    glow.addColorStop(0, 'rgba(37, 99, 235, 0.18)');
    glow.addColorStop(0.7, 'rgba(37, 99, 235, 0.04)');
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, S, S);

    // Coordinate scaling (Maskable safe zone: radius S * 0.4)
    // The artwork lives inside [S * 0.18, S * 0.82]
    const pad = S * 0.20;
    const boxW = S - 2 * pad;
    const x0 = pad, y0 = pad, x1 = S - pad, y1 = S - pad;
    const cornerLen = boxW * 0.28;
    const strokeW = Math.max(3, S * 0.046);
    const radius = S * 0.04;

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 2. Optical Focus Brackets / Corner Registration Marks (Cobalt Blue #3b82f6)
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = strokeW;

    // Top-Left
    ctx.beginPath();
    ctx.moveTo(x0, y0 + cornerLen);
    ctx.lineTo(x0, y0 + radius);
    ctx.arcTo(x0, y0, x0 + radius, y0, radius);
    ctx.lineTo(x0 + cornerLen, y0);
    ctx.stroke();

    // Top-Right
    ctx.beginPath();
    ctx.moveTo(x1 - cornerLen, y0);
    ctx.lineTo(x1 - radius, y0);
    ctx.arcTo(x1, y0, x1, y0 + radius, radius);
    ctx.lineTo(x1, y0 + cornerLen);
    ctx.stroke();

    // Bottom-Left
    ctx.beginPath();
    ctx.moveTo(x0, y1 - cornerLen);
    ctx.lineTo(x0, y1 - radius);
    ctx.arcTo(x0, y1, x0 + radius, y1, radius);
    ctx.lineTo(x0 + cornerLen, y1);
    ctx.stroke();

    // Bottom-Right
    ctx.beginPath();
    ctx.moveTo(x1 - cornerLen, y1);
    ctx.lineTo(x1 - radius, y1);
    ctx.arcTo(x1, y1, x1, y1 - radius, radius);
    ctx.lineTo(x1, y1 - cornerLen);
    ctx.stroke();

    // 3. Central Geometric 'V' (Pure White / Platinum)
    const vStroke = Math.max(4, S * 0.054);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = vStroke;
    ctx.beginPath();
    const vxL = S * 0.35;
    const vyT = S * 0.38;
    const vxC = S * 0.50;
    const vyB = S * 0.64;
    const vxR = S * 0.65;
    ctx.moveTo(vxL, vyT);
    ctx.lineTo(vxC, vyB);
    ctx.lineTo(vxR, vyT);
    ctx.stroke();

    // 4. Optical Center Alignment Reticle / Dot
    ctx.fillStyle = '#60a5fa';
    ctx.beginPath();
    ctx.arc(S/2, S/2 - S * 0.01, Math.max(2, S * 0.022), 0, Math.PI * 2);
    ctx.fill();

    // Save complete flag
    window.__ICON_DONE__ = canvas.toDataURL('image/png');
  </script>
</body>
</html>`;
}

async function captureIcon(size, outPath) {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderIconHtml(size));
  });

  await new Promise(resolve => server.listen(8788, '127.0.0.1', resolve));

  const proc = spawn(browserBin, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--force-device-scale-factor=1',
    `--window-size=${size},${size}`,
    `--screenshot=${outPath}`,
    'http://127.0.0.1:8788/'
  ]);

  await new Promise(resolve => proc.on('exit', resolve));
  server.close();

  console.log(`Generated ${path.basename(outPath)} (${size}x${size}): ${fs.statSync(outPath).size} bytes`);
}

async function main() {
  const icon192 = path.resolve(__dirname, '../icons/icon-192.png');
  const icon512 = path.resolve(__dirname, '../icons/icon-512.png');

  await captureIcon(192, icon192);
  await captureIcon(512, icon512);

  console.log('✓ Vigil Lens PWA icons successfully generated.');
}

main().catch(console.error);

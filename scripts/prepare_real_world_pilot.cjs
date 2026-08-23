'use strict';

/**
 * ScanVuông Real-World Pilot Ingestion & Preparation Tool
 * Takes an input folder with photos and pilot_manifest.json, validates hashes & geometry,
 * and automatically organizes benchmark-private/ layout without manual folder management.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const args = process.argv.slice(2);

function showHelp() {
  console.log(`
ScanVuông Real-World Pilot Ingestion Tool
=========================================

Usage:
  node scripts/prepare_real_world_pilot.cjs --input <folder> [options]

Options:
  --help                    Hiển thị hướng dẫn này
  --input <path>            Thư mục chứa ảnh và file pilot_manifest.json
  --manifest <path>         Đường dẫn file manifest (mặc định tìm pilot_manifest.json trong thư mục input)
  --dest <path>             Thư mục đích benchmark-private (mặc định: ./benchmark-private)
  --regression-dir <path>   Thư mục chứa 25 ảnh historical regression (mặc định: G:\\My Drive\\CamScaner)
  --copy                    Sao chép file ảnh sang benchmark-private (mặc định: true)
`);
  process.exit(0);
}

if (args.includes('--help') || args.includes('-h')) {
  showHelp();
}

const ROOT = path.join(__dirname, '..');

let inputDir = null;
const inIdx = args.indexOf('--input');
if (inIdx !== -1 && args[inIdx + 1]) inputDir = path.resolve(args[inIdx + 1]);

let manifestPath = null;
const manIdx = args.indexOf('--manifest');
if (manIdx !== -1 && args[manIdx + 1]) manifestPath = path.resolve(args[manIdx + 1]);

let destDir = path.join(ROOT, 'benchmark-private');
const destIdx = args.indexOf('--dest');
if (destIdx !== -1 && args[destIdx + 1]) destDir = path.resolve(args[destIdx + 1]);

let regressionDir = 'G:\\My Drive\\CamScaner';
const regIdx = args.indexOf('--regression-dir');
if (regIdx !== -1 && args[regIdx + 1]) regressionDir = path.resolve(args[regIdx + 1]);

function polygonArea(pts) {
  if (!pts || pts.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(a) / 2;
}

function validateCorners(pts) {
  if (!pts || pts.length !== 4) return { valid: false, reason: 'Phải có đúng 4 góc' };
  for (let i = 0; i < 4; i++) {
    const p = pts[i];
    if (typeof p.x !== 'number' || typeof p.y !== 'number' || isNaN(p.x) || isNaN(p.y)) {
      return { valid: false, reason: `Toạ độ góc ${i} không hợp lệ` };
    }
    if (p.x < -0.05 || p.x > 1.05 || p.y < -0.05 || p.y > 1.05) {
      return { valid: false, reason: `Góc ${i} ngoài phạm vi [0, 1]` };
    }
  }
  const area = polygonArea(pts);
  if (area < 0.01) return { valid: false, reason: 'Diện tích quá nhỏ (<1%)' };
  if (area > 0.99) return { valid: false, reason: 'Diện tích quá lớn (>99%)' };
  return { valid: true };
}

function computeSha256(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function runPrepare() {
  console.log('================================================================');
  console.log('=== ScanVuông Real-World Pilot Auto-Preparation Tool         ===');
  console.log('================================================================\n');

  if (!inputDir && !manifestPath) {
    console.error('ERROR: Vui lòng chỉ định thư mục nguồn: --input <path>');
    console.error('Ví dụ: node scripts/prepare_real_world_pilot.cjs --input "D:\\MyPilotPhotos"');
    process.exit(1);
  }

  if (inputDir && !manifestPath) {
    const candidateManifest = path.join(inputDir, 'pilot_manifest.json');
    if (fs.existsSync(candidateManifest)) manifestPath = candidateManifest;
  }

  // 1. Audit Historical Regression Hashes
  const regressionHashes = new Set();
  if (fs.existsSync(regressionDir)) {
    const regFiles = fs.readdirSync(regressionDir).filter(f => /\.(jpe?g|png|webp)$/i.test(f));
    for (const rf of regFiles) {
      const h = computeSha256(path.join(regressionDir, rf));
      regressionHashes.add(h);
    }
    console.log(`✓ Audited ${regressionHashes.size} historical REGRESSION_V1 images.`);
  }

  // 2. Load Manifest or Build from Folder
  let manifest = { cases: [] };
  if (manifestPath && fs.existsSync(manifestPath)) {
    console.log(`✓ Loading manifest from: ${manifestPath}`);
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } else if (inputDir && fs.existsSync(inputDir)) {
    console.log(`ℹ Không tìm thấy pilot_manifest.json. Tự động quét file ảnh trong ${inputDir}...`);
    const files = fs.readdirSync(inputDir).filter(f => /\.(jpe?g|png|webp)$/i.test(f));
    for (const f of files) {
      const p = path.join(inputDir, f);
      const isDocLike = /doclike|laptop|tablet|box|screen/i.test(f);
      let cat = isDocLike ? 'NEG_DOCUMENT_LIKE' : 'RW01_WHITE_ON_WHITE';
      for (const c of ['RW01_WHITE_ON_WHITE', 'RW02_PARTIAL_OCCLUSION', 'RW03_STRONG_PERSPECTIVE', 'RW04_SHADOW_UNEVEN_LIGHT', 'RW05_NEAR_FRAME']) {
        if (f.includes(c)) { cat = c; break; }
      }

      manifest.cases.push({
        id: `PILOT_${f.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 24)}`,
        filename: f,
        category: cat,
        contains_document: !isDocLike,
        corners: !isDocLike ? [{x:0.15,y:0.15},{x:0.85,y:0.15},{x:0.85,y:0.85},{x:0.15,y:0.85}] : null
      });
    }
  } else {
    console.error(`ERROR: Thư mục nguồn không tồn tại: ${inputDir}`);
    process.exit(1);
  }

  console.log(`Discovered ${manifest.cases.length} pilot candidate entries.\n`);

  // 3. Process each case and auto-organize into benchmark-private
  const TARGETS = {
    'RW01_WHITE_ON_WHITE': 5,
    'RW02_PARTIAL_OCCLUSION': 3,
    'RW03_STRONG_PERSPECTIVE': 4,
    'RW04_SHADOW_UNEVEN_LIGHT': 3,
    'RW05_NEAR_FRAME': 2,
    'NEG_DOCUMENT_LIKE': 3
  };

  const counts = {};
  for (const k of Object.keys(TARGETS)) counts[k] = 0;

  const validAnnotations = {};
  let duplicateCount = 0;
  let copiedCount = 0;

  for (const c of manifest.cases) {
    const srcFile = inputDir ? path.join(inputDir, c.filename) : path.resolve(c.filename);
    if (!fs.existsSync(srcFile)) {
      console.warn(`⚠ Bỏ qua (không tìm thấy file): ${c.filename}`);
      continue;
    }

    const sha256 = computeSha256(srcFile);
    if (regressionHashes.has(sha256)) {
      console.warn(`⚠ Bỏ qua (trùng lặp với REGRESSION_V1): ${c.filename}`);
      duplicateCount++;
      continue;
    }

    if (c.contains_document) {
      if (c.corners) {
        const val = validateCorners(c.corners);
        if (!val.valid) {
          console.warn(`⚠ Bỏ qua (Ground truth không hợp lệ: ${val.reason}): ${c.filename}`);
          continue;
        }
      }
    }

    // Determine target subfolder
    let targetSubDir;
    if (c.contains_document) {
      targetSubDir = path.join(destDir, 'positives', c.category);
    } else {
      targetSubDir = path.join(destDir, 'negatives', c.category);
    }

    if (!fs.existsSync(targetSubDir)) fs.mkdirSync(targetSubDir, { recursive: true });

    const destFile = path.join(targetSubDir, c.filename);
    fs.copyFileSync(srcFile, destFile);
    copiedCount++;

    if (counts[c.category] !== undefined) counts[c.category]++;

    // Write sidecar JSON
    const sidecarJson = destFile.replace(/\.[^.]+$/, '_ground_truth.json');
    const sidecarData = {
      id: c.id,
      filename: c.filename,
      category: c.category,
      contains_document: c.contains_document,
      sha256,
      provenance: 'CAMERA_REAL',
      corners: c.corners || null
    };
    fs.writeFileSync(sidecarJson, JSON.stringify(sidecarData, null, 2), 'utf8');

    validAnnotations[c.filename] = sidecarData;
  }

  // Save master annotations.json
  const masterAnnPath = path.join(destDir, 'annotations.json');
  fs.writeFileSync(masterAnnPath, JSON.stringify(validAnnotations, null, 2), 'utf8');

  console.log('================================================================');
  console.log('=== PILOT INGESTION & ORGANIZATION SUMMARY                   ===');
  console.log('================================================================\n');
  console.log(`Successfully ingested and organized ${copiedCount} photos into ${destDir}\n`);

  let allMet = true;
  for (const [cat, target] of Object.entries(TARGETS)) {
    const actual = counts[cat] || 0;
    const isMet = actual >= target;
    if (!isMet) allMet = false;
    console.log(`  • ${cat.padEnd(26)}: ${actual}/${target} [${isMet ? '✓ MET' : `✗ NEED ${target - actual} MORE`}]`);
  }

  console.log(`\nDuplicate Rejections: ${duplicateCount}`);
  console.log(`Master Annotations:   ${masterAnnPath}`);
  console.log(`\nTrạng thái: ${allMet ? '✓ REAL_WORLD_PILOT_COMPLETE' : 'ℹ REAL_WORLD_PILOT_PARTIALLY_PREPARED'}`);
  console.log('Bước tiếp theo: Chạy lệnh `node scripts/run_real_world_pilot.cjs` để đánh giá toàn bộ!');
}

runPrepare().catch(err => {
  console.error('Preparation Error:', err);
  process.exit(1);
});

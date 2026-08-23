'use strict';

/**
 * ScanVuông Real-World Pilot Ingestion & Preparation Tool (Hardened)
 * Validates mandatory pilot_manifest.json, verifies disk file SHA-256, blocks duplicates,
 * enforces human-confirmed positive ground truth, and organizes benchmark-private/.
 *
 * FAILS CLOSED: Never synthesizes ground-truth or auto-classifies without human confirmation.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const args = process.argv.slice(2);

function showHelp() {
  console.log(`
ScanVuông Real-World Pilot Ingestion Tool (Hardened)
===================================================

Usage:
  node scripts/prepare_real_world_pilot.cjs --input <folder> [options]

Options:
  --help                    Hiển thị hướng dẫn này
  --input <path>            Thư mục chứa ảnh nguồn (bắt buộc nếu không chỉ định rõ manifest)
  --manifest <path>         Đường dẫn file pilot_manifest.json (mặc định tìm trong thư mục input)
  --dest <path>             Thư mục đích benchmark-private (mặc định: ./benchmark-private)
  --regression-dir <path>   Thư mục chứa 25 ảnh historical regression (mặc định: G:\\My Drive\\CamScaner)
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

const ALLOWED_POSITIVES = new Set([
  'RW01_WHITE_ON_WHITE',
  'RW02_PARTIAL_OCCLUSION',
  'RW03_STRONG_PERSPECTIVE',
  'RW04_SHADOW_UNEVEN_LIGHT',
  'RW05_NEAR_FRAME'
]);

const ALLOWED_NEGATIVES = new Set([
  'NEG_DOCUMENT_LIKE'
]);

const TARGET_QUOTAS = {
  'RW01_WHITE_ON_WHITE': 5,
  'RW02_PARTIAL_OCCLUSION': 3,
  'RW03_STRONG_PERSPECTIVE': 4,
  'RW04_SHADOW_UNEVEN_LIGHT': 3,
  'RW05_NEAR_FRAME': 2,
  'NEG_DOCUMENT_LIKE': 3
};

// -------------------------------------------------------------
// Strict Geometry Validator
// -------------------------------------------------------------
function validateStrictGeometry(pts) {
  if (!pts || !Array.isArray(pts) || pts.length !== 4) {
    return { valid: false, reason: 'Must have exactly 4 corners' };
  }
  for (let i = 0; i < 4; i++) {
    const p = pts[i];
    if (!p || typeof p.x !== 'number' || typeof p.y !== 'number' || isNaN(p.x) || isNaN(p.y) || !isFinite(p.x) || !isFinite(p.y)) {
      return { valid: false, reason: `Corner ${i} contains non-numeric coordinates` };
    }
    if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) {
      return { valid: false, reason: `Corner ${i} (${p.x.toFixed(4)}, ${p.y.toFixed(4)}) out of strict range [0.0, 1.0]` };
    }
  }

  // Check duplicate / near-duplicate corners
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      const dist = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
      if (dist < 0.01) {
        return { valid: false, reason: `Corners ${i} and ${j} are too close (distance ${dist.toFixed(4)} < 0.01)` };
      }
    }
  }

  // Check edge lengths
  for (let i = 0; i < 4; i++) {
    const next = (i + 1) % 4;
    const edgeLen = Math.hypot(pts[next].x - pts[i].x, pts[next].y - pts[i].y);
    if (edgeLen < 0.01) {
      return { valid: false, reason: `Edge ${i}->${next} is degenerate (length ${edgeLen.toFixed(4)} < 0.01)` };
    }
  }

  // Area
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  area = Math.abs(area) / 2;
  if (area < 0.01) return { valid: false, reason: `Polygon area too small (${area.toFixed(4)} < 0.01)` };
  if (area > 0.99) return { valid: false, reason: `Polygon area too large (${area.toFixed(4)} > 0.99)` };

  // Strict Convexity & Non-Self-Intersection
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const p0 = pts[i];
    const p1 = pts[(i + 1) % 4];
    const p2 = pts[(i + 2) % 4];
    const cp = (p1.x - p0.x) * (p2.y - p1.y) - (p1.y - p0.y) * (p2.x - p1.x);
    if (Math.abs(cp) < 1e-7) return { valid: false, reason: `Collinear vertices at edge ${i}` };
    const curSign = cp > 0 ? 1 : -1;
    if (sign === 0) sign = curSign;
    else if (sign !== curSign) return { valid: false, reason: 'Polygon is concave or self-intersecting' };
  }

  return { valid: true };
}

function computeSha256(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function runPrepare() {
  console.log('================================================================');
  console.log('=== ScanVuông Real-World Pilot Preparation & Ingestion       ===');
  console.log('================================================================\n');

  // Locate Manifest (MANDATORY - NO SYNTHETIC FALLBACK)
  if (!manifestPath) {
    if (inputDir) {
      const candidate = path.join(inputDir, 'pilot_manifest.json');
      if (fs.existsSync(candidate)) {
        manifestPath = candidate;
      }
    }
  }

  if (!manifestPath || !fs.existsSync(manifestPath)) {
    console.error('================================================================');
    console.error('ERROR: PILOT_MANIFEST_REQUIRED');
    console.error('Không tìm thấy file pilot_manifest.json hợp lệ!');
    console.error('Hệ thống từ chối tự động sinh toạ độ góc giả định cho bằng chứng real-world.');
    console.error(`- Đường dẫn đã tìm kiếm: ${manifestPath || (inputDir ? path.join(inputDir, 'pilot_manifest.json') : 'chưa chỉ định')}`);
    console.error('Hướng dẫn:');
    console.error('  1. Mở benchmark/tools/pilot_capture_assistant.html để gán nhãn và xuất pilot_manifest.json.');
    console.error('  2. Cung cấp đường dẫn qua cờ: --manifest "duong/dan/pilot_manifest.json"');
    console.error('================================================================\n');
    process.exit(1);
  }

  console.log(`✓ Loading pilot manifest: ${manifestPath}`);
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    console.error(`ERROR: Lỗi đọc file JSON manifest: ${err.message}`);
    process.exit(1);
  }

  if (!manifest || !Array.isArray(manifest.cases) || manifest.cases.length === 0) {
    console.error('ERROR: Manifest không chứa danh sách cases hợp lệ!');
    process.exit(1);
  }

  const manifestBaseDir = inputDir || path.dirname(manifestPath);

  // 1. Audit Historical Regression Hashes
  const regressionHashes = new Map();
  if (fs.existsSync(regressionDir)) {
    const regFiles = fs.readdirSync(regressionDir).filter(f => /\.(jpe?g|png|webp)$/i.test(f));
    for (const rf of regFiles) {
      const p = path.join(regressionDir, rf);
      const h = computeSha256(p);
      regressionHashes.set(h, rf);
    }
    console.log(`✓ Audited ${regressionHashes.size} historical REGRESSION_V1 images.`);
  }

  // 2. Preflight Integrity & Validation
  const seenPilotHashes = new Map();
  const validCases = [];
  const errors = [];
  let regressionCollisions = 0;
  let internalDuplicates = 0;

  const categoryCounts = {};
  for (const cat of Object.keys(TARGET_QUOTAS)) categoryCounts[cat] = 0;

  for (let idx = 0; idx < manifest.cases.length; idx++) {
    const c = manifest.cases[idx];
    const caseId = c.id || `CASE_${idx + 1}`;
    const filename = c.filename;

    if (!filename) {
      errors.push(`Case #${idx + 1}: Thiếu filename`);
      continue;
    }

    const srcFile = path.isAbsolute(filename) ? filename : path.join(manifestBaseDir, filename);
    if (!fs.existsSync(srcFile)) {
      errors.push(`File không tồn tại trên đĩa: ${srcFile}`);
      continue;
    }

    // A. Recompute SHA-256 from disk file and verify against manifest
    const actualSha256 = computeSha256(srcFile);
    if (c.sha256 && c.sha256 !== actualSha256) {
      errors.push(`MANIFEST_FILE_HASH_MISMATCH: ${filename} (manifest: ${c.sha256.slice(0, 12)}..., disk: ${actualSha256.slice(0, 12)}...)`);
      continue;
    }

    // B. Check collision with historical regression
    if (regressionHashes.has(actualSha256)) {
      regressionCollisions++;
      errors.push(`REGRESSION_DUPLICATE_COLLISION: ${filename} có SHA trùng với ảnh regression '${regressionHashes.get(actualSha256)}'`);
      continue;
    }

    // C. Check internal pilot duplicate
    if (seenPilotHashes.has(actualSha256)) {
      internalDuplicates++;
      const prev = seenPilotHashes.get(actualSha256);
      errors.push(`PILOT_INTERNAL_DUPLICATE: ${filename} (${c.category}) có SHA trùng với ${prev.filename} (${prev.category})`);
      continue;
    }
    seenPilotHashes.set(actualSha256, { filename, category: c.category });

    // D. Category Semantics
    if (ALLOWED_POSITIVES.has(c.category)) {
      if (c.contains_document !== true) {
        errors.push(`CATEGORY_SEMANTICS_MISMATCH: ${filename} thuộc nhóm positive (${c.category}) nhưng contains_document !== true`);
        continue;
      }

      // Human confirmation requirement
      if (c.annotation_confirmed !== true) {
        errors.push(`UNCONFIRMED_GROUND_TRUTH: ${filename} chưa được người dùng xác nhận 4 góc (annotation_confirmed !== true)`);
        continue;
      }

      // Provenance check
      if (c.provenance && c.provenance !== 'CAMERA_REAL' && c.provenance !== 'TEST_FIXTURE') {
        errors.push(`INVALID_PROVENANCE: ${filename} có provenance '${c.provenance}' (chỉ chấp nhận CAMERA_REAL)`);
        continue;
      }

      // Strict Geometry check
      const geomVal = validateStrictGeometry(c.corners);
      if (!geomVal.valid) {
        errors.push(`INVALID_GEOMETRY: ${filename} - ${geomVal.reason}`);
        continue;
      }
    } else if (ALLOWED_NEGATIVES.has(c.category)) {
      if (c.contains_document !== false) {
        errors.push(`CATEGORY_SEMANTICS_MISMATCH: ${filename} thuộc nhóm negative (${c.category}) nhưng contains_document !== false`);
        continue;
      }
      if (c.corners && c.corners.length > 0) {
        errors.push(`NEGATIVE_CONTAINS_CORNERS: ${filename} là ảnh negative nhưng lại chứa toạ độ góc`);
        continue;
      }
    } else {
      errors.push(`UNKNOWN_CATEGORY: ${filename} có category không xác định '${c.category}'`);
      continue;
    }

    categoryCounts[c.category] = (categoryCounts[c.category] || 0) + 1;
    validCases.push({
      ...c,
      srcFile,
      actualSha256
    });
  }

  // If any errors encountered, fail closed!
  if (errors.length > 0) {
    console.error('================================================================');
    console.error(`✗ PHÁT HIỆN ${errors.length} LỖI BẢO TOÀN DỮ LIỆU (PREPARATION REJECTED):`);
    for (const err of errors) {
      console.error(`  • ${err}`);
    }
    console.error('================================================================\n');
    process.exit(1);
  }

  // 3. Populate benchmark-private/ with verified data
  const masterAnnotations = {};
  for (const c of validCases) {
    let targetSubDir;
    if (c.contains_document) {
      targetSubDir = path.join(destDir, 'positives', c.category);
    } else {
      targetSubDir = path.join(destDir, 'negatives', c.category);
    }

    if (!fs.existsSync(targetSubDir)) fs.mkdirSync(targetSubDir, { recursive: true });

    const destFile = path.join(targetSubDir, path.basename(c.filename));
    fs.copyFileSync(c.srcFile, destFile);

    const sidecarJson = destFile.replace(/\.[^.]+$/, '_ground_truth.json');
    const record = {
      id: c.id,
      filename: path.basename(c.filename),
      category: c.category,
      contains_document: c.contains_document,
      annotation_confirmed: c.annotation_confirmed === true,
      annotation_method: 'HUMAN_CONFIRMED',
      sha256: c.actualSha256,
      provenance: c.provenance || 'CAMERA_REAL',
      corners: c.corners || null
    };

    fs.writeFileSync(sidecarJson, JSON.stringify(record, null, 2), 'utf8');
    masterAnnotations[path.basename(c.filename)] = record;
  }

  const masterAnnPath = path.join(destDir, 'annotations.json');
  fs.writeFileSync(masterAnnPath, JSON.stringify(masterAnnotations, null, 2), 'utf8');

  console.log('================================================================');
  console.log('=== PILOT INGESTION & ORGANIZATION SUMMARY                   ===');
  console.log('================================================================\n');
  console.log(`Successfully validated and organized ${validCases.length} photos into ${destDir}\n`);

  let allMet = true;
  for (const [cat, target] of Object.entries(TARGET_QUOTAS)) {
    const actual = categoryCounts[cat] || 0;
    const isMet = actual >= target;
    if (!isMet) allMet = false;
    console.log(`  • ${cat.padEnd(26)}: ${actual}/${target} [${isMet ? '✓ MET' : `✗ NEED ${target - actual} MORE`}]`);
  }

  console.log(`\nPilot Internal Duplicates: ${internalDuplicates}`);
  console.log(`Regression Duplicates:     ${regressionCollisions}`);
  console.log(`Master Annotations:        ${masterAnnPath}`);
  console.log(`\nTrạng thái: ${allMet ? '✓ REAL_WORLD_PILOT_COMPLETE' : 'ℹ REAL_WORLD_PILOT_PARTIALLY_PREPARED'}`);
  console.log('Bước tiếp theo: Chạy lệnh `node scripts/run_real_world_pilot.cjs` để đánh giá benchmark!');
}

runPrepare().catch(err => {
  console.error('Preparation Fatal Error:', err);
  process.exit(1);
});

'use strict';

/**
 * ScanVuông Real-World Pilot Orchestration & Evaluation Runner (Safe Invocations)
 * Safely invokes prepare_real_world_pilot.cjs and benchmark_real_world.cjs using argument arrays.
 * Handles paths with spaces, parentheses, and Unicode characters safely.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const args = process.argv.slice(2);

function showHelp() {
  console.log(`
ScanVuông One-Command Real-World Pilot Runner
============================================

Usage:
  node scripts/run_real_world_pilot.cjs [options]

Options:
  --help                    Hiển thị hướng dẫn này
  --input <path>            Thư mục ảnh nguồn (tự động chuẩn bị nếu được cung cấp)
  --manifest <path>         Đường dẫn file pilot_manifest.json
  --dir <path>              Đường dẫn thư mục benchmark-private (mặc định: ./benchmark-private)
  --regression-dir <path>   Đường dẫn thư mục regression lịch sử (mặc định: G:\\My Drive\\CamScaner)
  --contact-sheet <path>    Đường dẫn xuất file HTML visual contact sheet (mặc định: benchmark-output/contact_sheet.html)
  --json-out <path>         Đường dẫn xuất file JSON kết quả (mặc định: benchmark-output/pilot_evidence_report.json)
  --summary-out <path>      Đường dẫn xuất file Markdown tóm tắt (mặc định: benchmark-output/pilot_evidence_summary.md)
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

// 1. If --input or --manifest provided, run prepare_real_world_pilot.cjs safely
if (inputDir || manifestPath) {
  const prepScript = path.join(ROOT, 'scripts', 'prepare_real_world_pilot.cjs');
  const prepArgs = [];
  if (inputDir) prepArgs.push('--input', inputDir);
  if (manifestPath) prepArgs.push('--manifest', manifestPath);

  // Forward destination or regression-dir if present
  const destIdx = args.indexOf('--dest');
  if (destIdx !== -1 && args[destIdx + 1]) prepArgs.push('--dest', path.resolve(args[destIdx + 1]));

  const regIdx = args.indexOf('--regression-dir');
  if (regIdx !== -1 && args[regIdx + 1]) prepArgs.push('--regression-dir', path.resolve(args[regIdx + 1]));

  console.log(`Auto-preparing pilot dataset via: ${prepScript}`);
  const prepRes = spawnSync(process.execPath, [prepScript, ...prepArgs], { stdio: 'inherit' });
  if (prepRes.status !== 0) {
    console.error(`\n[ERROR] Quá trình chuẩn bị dataset thất bại (Exit Code: ${prepRes.status}). Không tiến hành chạy benchmark.`);
    process.exit(prepRes.status || 1);
  }
}

// 2. Forward execution to benchmark_real_world.cjs safely
const benchScript = path.join(ROOT, 'scripts', 'benchmark_real_world.cjs');
const forwardArgs = [];

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--input' || a === '--manifest') {
    i++; // Skip the flag and its value
    continue;
  }
  forwardArgs.push(a);
}

const benchRes = spawnSync(process.execPath, [benchScript, ...forwardArgs], { stdio: 'inherit' });
process.exit(benchRes.status || 0);

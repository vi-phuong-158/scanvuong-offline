'use strict';

/**
 * ScanVuông Real-World Pilot Orchestration & Evaluation Runner
 * One-command execution for evaluating Production Baseline, Experiment B, and Experiment C2.
 * Generates JSON report, Markdown summary, and Standalone 100% Offline Visual Contact Sheet.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const args = process.argv.slice(2);

function showHelp() {
  console.log(`
ScanVuông One-Command Real-World Pilot Runner
============================================

Usage:
  node scripts/run_real_world_pilot.cjs [options]

Options:
  --help                    Hiển thị hướng dẫn này
  --input <path>            Tự động chuẩn bị ảnh từ thư mục nguồn trước khi chạy
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

// Check if --input was provided -> auto-run prepare_real_world_pilot.cjs
const inIdx = args.indexOf('--input');
if (inIdx !== -1 && args[inIdx + 1]) {
  const inputDir = path.resolve(args[inIdx + 1]);
  console.log(`Auto-preparing pilot dataset from: ${inputDir}`);
  const prepScript = path.join(ROOT, 'scripts', 'prepare_real_world_pilot.cjs');
  execSync(`node "${prepScript}" --input "${inputDir}"`, { stdio: 'inherit' });
}

// Forward to benchmark_real_world.cjs
const benchScript = path.join(ROOT, 'scripts', 'benchmark_real_world.cjs');
const benchArgs = args.filter((a, i) => a !== '--input' && (i === 0 || args[i - 1] !== '--input'));
const cmd = `node "${benchScript}" ${benchArgs.join(' ')}`;
try {
  execSync(cmd, { stdio: 'inherit' });
} catch (err) {
  process.exit(err.status || 1);
}

/* Dependency-free Lossless Watermark Stripping regression test. Run with Node 18+. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const context = { window: {}, TextEncoder, TextDecoder, Uint8Array, Blob, Math, Error, console };
vm.runInNewContext(fs.readFileSync(path.join(root, 'party-pdf.js'), 'utf8'), context, { filename: 'party-pdf.js' });
const PartyPdf = context.window.PartyPdf;

let pass = 0;
function check(name, condition) {
  if (!condition) throw new Error('FAIL ' + name);
  pass++;
  console.log('PASS ' + name);
}

// 2000x3000 synthetic JPEG header
const docImg = Buffer.from([
  0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00,
  0xFF, 0xDB, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0A, 0x0C,
  0x14, 0x0D, 0x0C, 0x0B, 0x0B, 0x0C, 0x19, 0x12, 0x13, 0x0F, 0x14, 0x1D, 0x1A, 0x1F, 0x1E, 0x1D, 0x1A, 0x1C, 0x1C, 0x20,
  0x24, 0x2E, 0x27, 0x20, 0x22, 0x2C, 0x23, 0x1C, 0x1C, 0x28, 0x37, 0x29, 0x2C, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1F, 0x27,
  0x39, 0x3D, 0x38, 0x32, 0x3C, 0x2E, 0x33, 0x34, 0x32, 0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x0B, 0xB8, 0x07, 0xD0, 0x01, 0x01,
  0x11, 0x00, 0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00, 0x7F, 0xFF, 0xD9
]);
const docHash = crypto.createHash('sha256').update(docImg).digest('hex');

// 240x90 CamScanner logo synthetic JPEG header
const wmImg = Buffer.from([
  0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00,
  0xFF, 0xDB, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0A, 0x0C,
  0x14, 0x0D, 0x0C, 0x0B, 0x0B, 0x0C, 0x19, 0x12, 0x13, 0x0F, 0x14, 0x1D, 0x1A, 0x1F, 0x1E, 0x1D, 0x1A, 0x1C, 0x1C, 0x20,
  0x24, 0x2E, 0x27, 0x20, 0x22, 0x2C, 0x23, 0x1C, 0x1C, 0x28, 0x37, 0x29, 0x2C, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1F, 0x27,
  0x39, 0x3D, 0x38, 0x32, 0x3C, 0x2E, 0x33, 0x34, 0x32, 0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x5A, 0x00, 0xF0, 0x01, 0x01,
  0x11, 0x00, 0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00, 0x7F, 0xFF, 0xD9
]);

// 166x62 CamScanner logo synthetic JPEG header
const wmImg2 = Buffer.from([
  0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00,
  0xFF, 0xDB, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0A, 0x0C,
  0x14, 0x0D, 0x0C, 0x0B, 0x0B, 0x0C, 0x19, 0x12, 0x13, 0x0F, 0x14, 0x1D, 0x1A, 0x1F, 0x1E, 0x1D, 0x1A, 0x1C, 0x1C, 0x20,
  0x24, 0x2E, 0x27, 0x20, 0x22, 0x2C, 0x23, 0x1C, 0x1C, 0x28, 0x37, 0x29, 0x2C, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1F, 0x27,
  0x39, 0x3D, 0x38, 0x32, 0x3C, 0x2E, 0x33, 0x34, 0x32, 0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x3E, 0x00, 0xA6, 0x01, 0x01,
  0x11, 0x00, 0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00, 0x7F, 0xFF, 0xD9
]);

function buildCamScannerSyntheticPdf() {
  const content1 = 'q /Perceptual ri q 595.32 0 0 841.92 0 0 cm /Im1 Do Q q 80 0 0 30 500 10 cm /Im2 Do Q';
  const content1Deflated = zlib.deflateSync(Buffer.from(content1));

  const content2 = 'q /Perceptual ri q 595.32 0 0 841.92 0 0 cm /Im1 Do Q q 60 0 0 22 510 12 cm /Im3 Do Q';
  const content2Deflated = zlib.deflateSync(Buffer.from(content2));

  const content3 = 'q /Perceptual ri q 595.32 0 0 841.92 0 0 cm /Im1 Do Q';
  const content3Deflated = zlib.deflateSync(Buffer.from(content3));

  const parts = [
    '%PDF-1.4\n',
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>\nendobj\n',
    // Page 1: Im1 + Im2 (240x90)
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.32 841.92] /Resources << /XObject << /Im1 6 0 R /Im2 7 0 R >> >> /Contents 9 0 R >>\nendobj\n',
    // Page 2: Im1 + Im3 (166x62)
    '4 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.32 841.92] /Resources << /XObject << /Im1 6 0 R /Im3 8 0 R >> >> /Contents 10 0 R >>\nendobj\n',
    // Page 3: Im1 only (no watermark)
    '5 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.32 841.92] /Resources << /XObject << /Im1 6 0 R >> >> /Contents 11 0 R >>\nendobj\n',
    // Im1 (2000x3000)
    '6 0 obj\n<< /Type /XObject /Subtype /Image /Width 2000 /Height 3000 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + docImg.length + ' >>\nstream\n',
    docImg,
    '\nendstream\nendobj\n',
    // Im2 (240x90)
    '7 0 obj\n<< /Type /XObject /Subtype /Image /Width 240 /Height 90 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + wmImg.length + ' >>\nstream\n',
    wmImg,
    '\nendstream\nendobj\n',
    // Im3 (166x62)
    '8 0 obj\n<< /Type /XObject /Subtype /Image /Width 166 /Height 62 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + wmImg2.length + ' >>\nstream\n',
    wmImg2,
    '\nendstream\nendobj\n',
    // Contents 9 (Page 1)
    '9 0 obj\n<< /Length ' + content1Deflated.length + ' /Filter /FlateDecode >>\nstream\n',
    content1Deflated,
    '\nendstream\nendobj\n',
    // Contents 10 (Page 2)
    '10 0 obj\n<< /Length ' + content2Deflated.length + ' /Filter /FlateDecode >>\nstream\n',
    content2Deflated,
    '\nendstream\nendobj\n',
    // Contents 11 (Page 3)
    '11 0 obj\n<< /Length ' + content3Deflated.length + ' /Filter /FlateDecode >>\nstream\n',
    content3Deflated,
    '\nendstream\nendobj\n',
    'xref\n0 12\n0000000000 65535 f \n',
    'trailer\n<< /Size 12 /Root 1 0 R >>\nstartxref\n0\n%%EOF'
  ];

  return Buffer.concat(parts.map(p => typeof p === 'string' ? Buffer.from(p) : p));
}

(async () => {
  const pdfBuffer = buildCamScannerSyntheticPdf();
  const source = PartyPdf.sourceFromBuffer(new Uint8Array(pdfBuffer), 'camscanner-test.pdf');
  check('Synthetic PDF has 3 pages', source.pageCount === 3);

  // 1. Detection test
  const detected = PartyPdf.detectCamScannerWatermarks(source);
  check('Detection found watermarks', detected.hasWatermarks === true);
  check('Detection found exactly 2 watermarked pages', detected.watermarkPages.length === 2);
  check('Page 1 detected Im2 (240x90)', detected.watermarkPages[0].pageIndex === 0 && detected.watermarkPages[0].watermarkName === 'Im2' && detected.watermarkPages[0].width === 240);
  check('Page 2 detected Im3 (166x62)', detected.watermarkPages[1].pageIndex === 1 && detected.watermarkPages[1].watermarkName === 'Im3' && detected.watermarkPages[1].width === 166);

  // 2. Strip test
  const result = await PartyPdf.stripWatermarks(new Uint8Array(pdfBuffer));
  check('Strip returned blob and unmodified is false', !result.unmodified && !!result.blob);
  check('Strip reported 2 removed watermarks', result.removedCount === 2);

  const cleanBytes = new Uint8Array(await result.blob.arrayBuffer());
  const cleanSource = PartyPdf.sourceFromBuffer(cleanBytes, 'clean.pdf');
  check('Clean PDF parses with exactly 3 pages', cleanSource.pageCount === 3);

  // Re-detect on clean PDF: must be 0 watermarks!
  const reDetected = PartyPdf.detectCamScannerWatermarks(cleanSource);
  check('Clean PDF re-detection finds 0 watermarks', reDetected.hasWatermarks === false && reDetected.watermarkPages.length === 0);

  // 3. Lossless verification: Scan image Im1 MUST be bit-for-bit identical (SHA-256)
  const cleanText = new TextDecoder('iso-8859-1').decode(cleanBytes);
  check('Clean PDF does not reference Im2 or Im3', !cleanText.includes('/Im2') && !cleanText.includes('/Im3'));

  // Find image stream in clean PDF
  let foundDocImg = false;
  for (const [, obj] of cleanSource.objects) {
    if (obj.text.includes('/Subtype /Image') && obj.text.includes('/Width 2000')) {
      const streamData = obj.bytes.slice(obj.streamDataStart, obj.streamDataEnd);
      const hash = crypto.createHash('sha256').update(Buffer.from(streamData)).digest('hex');
      check('Scan image DCTDecode stream is bit-for-bit identical (SHA-256 match)', hash === docHash);
      foundDocImg = true;
      break;
    }
  }
  check('Original document image was found in output', foundDocImg);

  // 4. File size: output must be smaller than input
  check('Clean PDF size is smaller than input (watermark removed)', cleanBytes.length < pdfBuffer.length);

  // 5. Fail-safe test: PDF without watermark returns unmodified
  const cleanAgain = await PartyPdf.stripWatermarks(cleanBytes);
  check('PDF without watermark returns unmodified=true', cleanAgain.unmodified === true);
  check('PDF without watermark reports removedCount=0', cleanAgain.removedCount === 0);

  console.log('\nLossless Watermark Stripping regression: ' + pass + '/' + pass + ' checks PASS');
})();

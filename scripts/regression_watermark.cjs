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

function makeDummyJpeg(w, h) {
  const buf = Buffer.from(docImg);
  const sofIdx = buf.indexOf(Buffer.from([0xFF, 0xC0]));
  buf[sofIdx + 5] = (h >> 8) & 0xFF;
  buf[sofIdx + 6] = h & 0xFF;
  buf[sofIdx + 7] = (w >> 8) & 0xFF;
  buf[sofIdx + 8] = w & 0xFF;
  return buf;
}

// 240x90 CamScanner logo synthetic JPEG
const wmImg = makeDummyJpeg(240, 90);
// 166x62 CamScanner logo synthetic JPEG
const wmImg2 = makeDummyJpeg(166, 62);

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

function makeSinglePagePdf({ images = [], contentStream = '', mediaBox = [0, 0, 595.32, 841.92] } = {}) {
  const xobjEntries = images.map(img => `/${img.name} ${img.objId} 0 R`).join(' ');
  const contentBytes = zlib.deflateSync(Buffer.from(contentStream));
  const parts = [
    '%PDF-1.4\n',
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [${mediaBox.join(' ')}] /Resources << /XObject << ${xobjEntries} >> >> /Contents 4 0 R >>\nendobj\n`,
    `4 0 obj\n<< /Length ${contentBytes.length} /Filter /FlateDecode >>\nstream\n`,
    contentBytes,
    '\nendstream\nendobj\n'
  ];
  for (const img of images) {
    parts.push(
      `${img.objId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.data.length} >>\nstream\n`,
      img.data,
      '\nendstream\nendobj\n'
    );
  }
  parts.push('%%EOF');
  return Buffer.concat(parts.map(p => typeof p === 'string' ? Buffer.from(p) : p));
}

(async () => {
  // === PART 1: POSITIVE REGRESSION SUITE (CamScanner PDF) ===
  const pdfBuffer = buildCamScannerSyntheticPdf();
  const source = PartyPdf.sourceFromBuffer(new Uint8Array(pdfBuffer), 'camscanner-test.pdf');
  check('Positive: Synthetic PDF has 3 pages', source.pageCount === 3);

  // 1. Detection test
  const detected = PartyPdf.detectCamScannerWatermarks(source);
  check('Positive: Detection found watermarks', detected.hasWatermarks === true);
  check('Positive: Detection found exactly 2 watermarked pages', detected.watermarkPages.length === 2);
  check('Positive: Page 1 detected Im2 (240x90)', detected.watermarkPages[0].pageIndex === 0 && detected.watermarkPages[0].watermarkName === 'Im2' && detected.watermarkPages[0].width === 240);
  check('Positive: Page 2 detected Im3 (166x62)', detected.watermarkPages[1].pageIndex === 1 && detected.watermarkPages[1].watermarkName === 'Im3' && detected.watermarkPages[1].width === 166);

  // 2. Strip test
  const result = await PartyPdf.stripWatermarks(new Uint8Array(pdfBuffer));
  check('Positive: Strip returned blob and unmodified is false', !result.unmodified && !!result.blob);
  check('Positive: Strip reported 2 removed watermarks', result.removedCount === 2);

  const cleanBytes = new Uint8Array(await result.blob.arrayBuffer());
  const cleanSource = PartyPdf.sourceFromBuffer(cleanBytes, 'clean.pdf');
  check('Positive: Clean PDF parses with exactly 3 pages', cleanSource.pageCount === 3);

  // Re-detect on clean PDF: must be 0 watermarks!
  const reDetected = PartyPdf.detectCamScannerWatermarks(cleanSource);
  check('Positive: Clean PDF re-detection finds 0 watermarks', reDetected.hasWatermarks === false && reDetected.watermarkPages.length === 0);

  // 3. Lossless verification: Scan image Im1 MUST be bit-for-bit identical (SHA-256)
  const cleanText = new TextDecoder('iso-8859-1').decode(cleanBytes);
  check('Positive: Clean PDF does not reference Im2 or Im3', !cleanText.includes('/Im2') && !cleanText.includes('/Im3'));

  let foundDocImg = false;
  for (const [, obj] of cleanSource.objects) {
    if (obj.text.includes('/Subtype /Image') && obj.text.includes('/Width 2000')) {
      const streamData = obj.bytes.slice(obj.streamDataStart, obj.streamDataEnd);
      const hash = crypto.createHash('sha256').update(Buffer.from(streamData)).digest('hex');
      check('Positive: Scan image DCTDecode stream is bit-for-bit identical (SHA-256 match)', hash === docHash);
      check('Positive: Scan image dictionary width/height/colorSpace preserved',
        obj.text.includes('/Width 2000') && obj.text.includes('/Height 3000') &&
        obj.text.includes('/ColorSpace /DeviceRGB') && obj.text.includes('/BitsPerComponent 8') &&
        obj.text.includes('/Filter /DCTDecode'));
      foundDocImg = true;
      break;
    }
  }
  check('Positive: Original document image was found in output', foundDocImg);

  // 4. File size: output must be smaller than input
  check('Positive: Clean PDF size is smaller than input (watermark removed)', cleanBytes.length < pdfBuffer.length);

  // 5. Fail-safe test: PDF without watermark returns unmodified
  const cleanAgain = await PartyPdf.stripWatermarks(cleanBytes);
  check('Positive: Re-stripping clean PDF returns unmodified=true', cleanAgain.unmodified === true);
  check('Positive: Re-stripping clean PDF reports removedCount=0', cleanAgain.removedCount === 0);

  // === PART 2: 10 NEGATIVE REGRESSION TEST CASES ===

  // Neg 1: Clean PDF (only primary scan image, no watermark)
  const neg1Buf = makeSinglePagePdf({
    images: [{ name: 'Im1', objId: 5, width: 2000, height: 3000, data: docImg }],
    contentStream: 'q 595.32 0 0 841.92 0 0 cm /Im1 Do Q'
  });
  const neg1Src = PartyPdf.sourceFromBuffer(new Uint8Array(neg1Buf), 'neg1.pdf');
  const neg1Det = PartyPdf.detectCamScannerWatermarks(neg1Src);
  const neg1Strip = await PartyPdf.stripWatermarks(new Uint8Array(neg1Buf));
  check('Neg 1 (Clean PDF): hasWatermarks is false', neg1Det.hasWatermarks === false && neg1Strip.unmodified === true && neg1Strip.removedCount === 0);

  // Neg 2: Agency logo at top of page (y = 800 pt on 842 pt page)
  const neg2Buf = makeSinglePagePdf({
    images: [
      { name: 'Im1', objId: 5, width: 2000, height: 3000, data: docImg },
      { name: 'Logo', objId: 6, width: 240, height: 90, data: wmImg }
    ],
    contentStream: 'q 595.32 0 0 841.92 0 0 cm /Im1 Do Q q 80 0 0 30 200 800 cm /Logo Do Q'
  });
  const neg2Src = PartyPdf.sourceFromBuffer(new Uint8Array(neg2Buf), 'neg2.pdf');
  const neg2Det = PartyPdf.detectCamScannerWatermarks(neg2Src);
  const neg2Strip = await PartyPdf.stripWatermarks(new Uint8Array(neg2Buf));
  check('Neg 2 (Agency logo at top): not detected, strip untouched', neg2Det.hasWatermarks === false && neg2Strip.unmodified === true);

  // Neg 3: Official seal / stamp (square aspect ratio 1.0, 100x100)
  const neg3Buf = makeSinglePagePdf({
    images: [
      { name: 'Im1', objId: 5, width: 2000, height: 3000, data: docImg },
      { name: 'Seal', objId: 6, width: 100, height: 100, data: makeDummyJpeg(100, 100) }
    ],
    contentStream: 'q 595.32 0 0 841.92 0 0 cm /Im1 Do Q q 50 0 0 50 300 50 cm /Seal Do Q'
  });
  const neg3Src = PartyPdf.sourceFromBuffer(new Uint8Array(neg3Buf), 'neg3.pdf');
  const neg3Det = PartyPdf.detectCamScannerWatermarks(neg3Src);
  const neg3Strip = await PartyPdf.stripWatermarks(new Uint8Array(neg3Buf));
  check('Neg 3 (Square seal/stamp 100x100): aspect ratio rejected', neg3Det.hasWatermarks === false && neg3Strip.unmodified === true);

  // Neg 4: Signature image in document body (y = 400 pt)
  const neg4Buf = makeSinglePagePdf({
    images: [
      { name: 'Im1', objId: 5, width: 2000, height: 3000, data: docImg },
      { name: 'Sig', objId: 6, width: 180, height: 68, data: wmImg2 }
    ],
    contentStream: 'q 595.32 0 0 841.92 0 0 cm /Im1 Do Q q 80 0 0 30 350 400 cm /Sig Do Q'
  });
  const neg4Src = PartyPdf.sourceFromBuffer(new Uint8Array(neg4Buf), 'neg4.pdf');
  const neg4Det = PartyPdf.detectCamScannerWatermarks(neg4Src);
  const neg4Strip = await PartyPdf.stripWatermarks(new Uint8Array(neg4Buf));
  check('Neg 4 (Signature in body y=400): position rejected', neg4Det.hasWatermarks === false && neg4Strip.unmodified === true);

  // Neg 5: QR code (120x120, square aspect ratio 1.0 at bottom)
  const neg5Buf = makeSinglePagePdf({
    images: [
      { name: 'Im1', objId: 5, width: 2000, height: 3000, data: docImg },
      { name: 'Qr', objId: 6, width: 120, height: 120, data: makeDummyJpeg(120, 120) }
    ],
    contentStream: 'q 595.32 0 0 841.92 0 0 cm /Im1 Do Q q 40 0 0 40 500 20 cm /Qr Do Q'
  });
  const neg5Src = PartyPdf.sourceFromBuffer(new Uint8Array(neg5Buf), 'neg5.pdf');
  const neg5Det = PartyPdf.detectCamScannerWatermarks(neg5Src);
  const neg5Strip = await PartyPdf.stripWatermarks(new Uint8Array(neg5Buf));
  check('Neg 5 (QR code at bottom): aspect ratio rejected', neg5Det.hasWatermarks === false && neg5Strip.unmodified === true);

  // Neg 6: Footer banner spanning full page width (renderW = 500 pt > 220 pt)
  const neg6Buf = makeSinglePagePdf({
    images: [
      { name: 'Im1', objId: 5, width: 2000, height: 3000, data: docImg },
      { name: 'Banner', objId: 6, width: 240, height: 90, data: wmImg }
    ],
    contentStream: 'q 595.32 0 0 841.92 0 0 cm /Im1 Do Q q 500 0 0 30 50 20 cm /Banner Do Q'
  });
  const neg6Src = PartyPdf.sourceFromBuffer(new Uint8Array(neg6Buf), 'neg6.pdf');
  const neg6Det = PartyPdf.detectCamScannerWatermarks(neg6Src);
  const neg6Strip = await PartyPdf.stripWatermarks(new Uint8Array(neg6Buf));
  check('Neg 6 (Wide footer banner renderW=500): dimension rejected', neg6Det.hasWatermarks === false && neg6Strip.unmodified === true);

  // Neg 7: Inline diagram (600x400, ratio 1.5, in body)
  const neg7Buf = makeSinglePagePdf({
    images: [
      { name: 'Im1', objId: 5, width: 2000, height: 3000, data: docImg },
      { name: 'Diag', objId: 6, width: 600, height: 400, data: makeDummyJpeg(600, 400) }
    ],
    contentStream: 'q 595.32 0 0 841.92 0 0 cm /Im1 Do Q q 200 0 0 133 150 300 cm /Diag Do Q'
  });
  const neg7Src = PartyPdf.sourceFromBuffer(new Uint8Array(neg7Buf), 'neg7.pdf');
  const neg7Det = PartyPdf.detectCamScannerWatermarks(neg7Src);
  const neg7Strip = await PartyPdf.stripWatermarks(new Uint8Array(neg7Buf));
  check('Neg 7 (Inline diagram 600x400): ratio and area rejected', neg7Det.hasWatermarks === false && neg7Strip.unmodified === true);

  // Neg 8: Watermark-sized image placed in middle of page (y = 420 pt)
  const neg8Buf = makeSinglePagePdf({
    images: [
      { name: 'Im1', objId: 5, width: 2000, height: 3000, data: docImg },
      { name: 'Mid', objId: 6, width: 240, height: 90, data: wmImg }
    ],
    contentStream: 'q 595.32 0 0 841.92 0 0 cm /Im1 Do Q q 80 0 0 30 250 420 cm /Mid Do Q'
  });
  const neg8Src = PartyPdf.sourceFromBuffer(new Uint8Array(neg8Buf), 'neg8.pdf');
  const neg8Det = PartyPdf.detectCamScannerWatermarks(neg8Src);
  const neg8Strip = await PartyPdf.stripWatermarks(new Uint8Array(neg8Buf));
  check('Neg 8 (Candidate at y=420 middle): position rejected', neg8Det.hasWatermarks === false && neg8Strip.unmodified === true);

  // Neg 9: Small image at bottom, but NO primary scan image on page
  const neg9Buf = makeSinglePagePdf({
    images: [
      { name: 'Small', objId: 5, width: 240, height: 90, data: wmImg }
    ],
    contentStream: 'q 80 0 0 30 450 20 cm /Small Do Q'
  });
  const neg9Src = PartyPdf.sourceFromBuffer(new Uint8Array(neg9Buf), 'neg9.pdf');
  const neg9Det = PartyPdf.detectCamScannerWatermarks(neg9Src);
  const neg9Strip = await PartyPdf.stripWatermarks(new Uint8Array(neg9Buf));
  check('Neg 9 (No primary scan image): rejected (requires >=500k px main scan)', neg9Det.hasWatermarks === false && neg9Strip.unmodified === true);

  // Neg 10: Multiple small icons (32x32)
  const neg10Buf = makeSinglePagePdf({
    images: [
      { name: 'Im1', objId: 5, width: 2000, height: 3000, data: docImg },
      { name: 'Icon1', objId: 6, width: 32, height: 32, data: makeDummyJpeg(32, 32) },
      { name: 'Icon2', objId: 7, width: 32, height: 32, data: makeDummyJpeg(32, 32) }
    ],
    contentStream: 'q 595.32 0 0 841.92 0 0 cm /Im1 Do Q q 16 0 0 16 50 10 cm /Icon1 Do Q q 16 0 0 16 70 10 cm /Icon2 Do Q'
  });
  const neg10Src = PartyPdf.sourceFromBuffer(new Uint8Array(neg10Buf), 'neg10.pdf');
  const neg10Det = PartyPdf.detectCamScannerWatermarks(neg10Src);
  const neg10Strip = await PartyPdf.stripWatermarks(new Uint8Array(neg10Buf));
  check('Neg 10 (Multiple 32x32 icons): dimensions rejected', neg10Det.hasWatermarks === false && neg10Strip.unmodified === true);

  console.log('\nLossless Watermark Stripping regression: ' + pass + '/' + pass + ' checks PASS');
})().catch(err => { console.error(err.stack || err); process.exit(1); });

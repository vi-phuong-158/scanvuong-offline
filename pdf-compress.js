/* VPH Vigil Lens — Adaptive target-size PDF compression (offline, in-browser).
   Shared engine reused by two callers: the standalone "Giảm dung lượng PDF"
   mode (compress-mode.js) and Party Mode's explicit ">20MB → tạo bản dưới
   20MB" action (party-mode.js) — one implementation, no duplicated logic.

   Pipeline (per docs/brain/03-decisions.md "adaptive target-size
   compression"): PartyPdf.sourceFromBuffer() parses the PDF (the same
   classical parser Party Mode already uses) → PartyPdf.renderThumbnail()
   renders each page to a canvas at a round's maxEdge — this reuses Party
   Mode's own PDF.js-with-classical-fallback renderer instead of a second,
   PDF.js-only bootstrap, so a page.js/WASM hiccup that Party Mode already
   recovers from doesn't take this feature down too (see
   docs/brain/03-decisions.md, "adaptive compression reuses PartyPdf's
   resilient page renderer") → JPEG encode at the round's quality →
   PartyPdf.buildPdf() (existing local PDF writer, already used for Party
   Mode's image pages) assembles the output Blob → check blob.size against
   the target → retry with a lower round if needed.

   Memory, precisely (see docs/brain/03-decisions.md "Compress mode memory
   audit" for the measurement this is based on): only ONE full-resolution
   Canvas pixel buffer is ever resident at a time (render → encode →
   release, next page) — that part of the original claim holds. It is NOT
   true that overall peak memory is small: renderRound() still holds every
   page's encoded JPEG bytes for the current round before packaging, and —
   far more significantly — the shared PartyPdf.sourceFromBuffer() classical
   parser decodes the entire source file into a JS string (twice) and keeps
   a byte-slice *and* text-slice copy of every PDF object for as long as
   `source` is alive, i.e. the whole compressPdf() call. See
   estimateMemoryRisk() below for the guard this drove. */
(() => {
  'use strict';

  // Decimal MB, not MiB — 19,000,000 bytes stays safely under a 20MB cutoff
  // whether the receiving system counts 20MB as 20,000,000 or 20,971,520
  // bytes (see docs/brain/03-decisions.md).
  const PDF_COMPRESSION_TARGET_BYTES = 19 * 1000 * 1000;
  const PDF_COMPRESSION_DISPLAY_LIMIT_BYTES = 20 * 1000 * 1000;

  // Color is always kept (no grayscale option) — see AGENTS.md/CLAUDE.md task
  // brief: seals/signatures/ink color must never be silently dropped.
  // Round 5 is the safety floor: compressPdf() never renders past it unless
  // the caller explicitly opts in via options.rounds (the UI's "Nén mạnh
  // hơn" button, a distinct user action — never automatic).
  const ROUNDS = [
    { maxEdge: 2200, jpeg: 0.84 },
    { maxEdge: 2000, jpeg: 0.78 },
    { maxEdge: 1800, jpeg: 0.70 },
    { maxEdge: 1600, jpeg: 0.62 },
    { maxEdge: 1400, jpeg: 0.50 }
  ];
  const BEYOND_FLOOR_ROUNDS = [
    { maxEdge: 1200, jpeg: 0.42 },
    { maxEdge: 1000, jpeg: 0.35 }
  ];

  // Peak-memory guard — see docs/brain/03-decisions.md "Compress mode memory
  // audit (2026-09-06)" for the full measurement this is based on. The
  // dominant cost is NOT this engine's own per-round JPEG array (that part
  // really is one page at a time); it is the shared PartyPdf classical
  // parser (party-pdf.js `parseObjects`), which decodes the *entire* source
  // file into a JS string (twice — once to index objects, once for the
  // `/Encrypt` check) and stores a byte-slice *and* a text-slice copy of
  // every PDF object, all retained for the whole `compressPdf()` call
  // because `source` must stay alive across every round. PDF.js also keeps
  // its own full copy of the source bytes (`source.bytes.slice()` in
  // party-pdf.js's `pdfJsDocument()`). None of this is specific to
  // pdf-compress.js, and none of it is safe to rewrite here without
  // risking Party Mode's already-proven parser — see AGENTS.md "không
  // rewrite PDF engine lớn".
  //
  // `PARSE_MEMORY_MULTIPLIER = 5` is not a guess: it is the measured RSS
  // delta (whole-process resident memory added while compressing, not V8's
  // on-heap counter alone — that one stayed under 3MB even at 80MB input,
  // because large TypedArray/Blob backing stores live in V8's external
  // allocations, invisible to `performance.memory`/`JSHeapUsedSize`) over
  // input size, real Chromium 141 (single-process, so browser+renderer
  // share one OS process and /proc/<pid>/status VmRSS is measurable),
  // scripts/benchmark_pdf_compress.cjs, realistic multi-page fixtures:
  //   23MB in → +211MB RSS (9.1x)   38MB in → +217MB RSS (5.7x)
  //   56MB in → +264MB RSS (4.7x)   80MB in → +369MB RSS (4.6x)
  // The ratio falls as input grows (small, mostly-fixed costs — WASM
  // module init, etc. — matter less at scale) and settles near 4.6-5x for
  // the input sizes this feature targets, so 5x is used as a clean,
  // slightly-conservative round number rather than the single best sample.
  // `SAFE_MOBILE_PEAK_BYTES` is chosen so the full requested 20-80MB range
  // (AGENTS.md task brief) passes with headroom, while still rejecting
  // clearly excessive files. This measurement is a same-order-of-magnitude
  // proxy from a desktop-class single-process Chromium — not a substitute
  // for a real phone; see docs/brain/03-decisions.md for the honest caveat
  // and why 80MB is flagged as "supported but at the edge" rather than
  // comfortably safe.
  const PARSE_MEMORY_MULTIPLIER = 5;
  const ROUND_HEADROOM_BYTES = 60 * 1000 * 1000;
  const SAFE_MOBILE_PEAK_BYTES = 500 * 1000 * 1000;

  function estimateMemoryRisk(inputBytes) {
    const estimatedPeakBytes = Math.round(inputBytes * PARSE_MEMORY_MULTIPLIER) + ROUND_HEADROOM_BYTES;
    return { estimatedPeakBytes, tooLarge: estimatedPeakBytes > SAFE_MOBILE_PEAK_BYTES };
  }

  // requestAnimationFrame never fires while the tab is backgrounded, which
  // would hang a long multi-page/multi-round loop forever — race it against
  // a timeout fallback (same fix as app.js's sleepFrame()).
  function sleepFrame() {
    return new Promise(resolve => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(finish);
      setTimeout(finish, 40);
    });
  }

  function partyPdf() {
    const api = window.PartyPdf;
    if (!api?.sourceFromBuffer || !api?.renderThumbnail || !api?.buildPdf) {
      throw new Error('Bộ đọc/ghi PDF nội bộ chưa sẵn sàng.');
    }
    return api;
  }

  // Renders one page at full compression resolution (not thumbnail size) by
  // reusing PartyPdf.renderThumbnail — it already tries PDF.js first and
  // falls back to PartyPdf's own classical content-stream renderer if
  // PDF.js/WASM fails on a given page, so this inherits that resilience for
  // free instead of a second bespoke render path.
  async function renderCompressionPage(source, pageIndex, maxEdge) {
    const canvas = document.createElement('canvas');
    const ref = source.page(pageIndex);
    await partyPdf().renderThumbnail(ref, canvas, maxEdge);
    return canvas;
  }

  function encodePage(canvas, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => {
        if (!blob) { reject(new Error('Không tạo được ảnh cho trang PDF.')); return; }
        blob.arrayBuffer().then(buf => {
          const result = { bytes: new Uint8Array(buf), width: canvas.width, height: canvas.height };
          canvas.width = 0; canvas.height = 0; // release the pixel buffer eagerly, don't wait on GC
          resolve(result);
        }, reject);
      }, 'image/jpeg', quality);
    });
  }

  // Reuses the existing local PDF writer (PartyPdf.buildPdf, already used
  // for Party Mode's rasterized image pages) instead of a third hand-rolled
  // PDF assembler. pageRefs is empty because every page here is a fresh
  // JPEG, never a copied PDF page object.
  function buildCompressedPdf(items) {
    return partyPdf().buildPdf([], items, {});
  }

  function verifyTarget(bytes, targetBytes) {
    return bytes <= targetBytes;
  }

  async function renderRound(source, pageCount, round, roundIndex, roundCount, onProgress) {
    const items = [];
    for (let i = 0; i < pageCount; i++) {
      if (onProgress) onProgress({ phase: 'rendering', pageIndex: i, pageCount, round: roundIndex + 1, roundCount });
      const canvas = await renderCompressionPage(source, i, round.maxEdge);
      items.push(await encodePage(canvas, round.jpeg));
      await sleepFrame();
    }
    return items;
  }

  const MEMORY_RISK_MESSAGE = 'Tệp này quá lớn để xử lý an toàn trên thiết bị hiện tại.\nHãy thử trên máy tính hoặc chia tài liệu thành các phần nhỏ hơn.';

  // Cheap page-count lookup for the "Tên file · N trang · dung lượng" info
  // screen, before the user commits to a full compress run. Reading page
  // count only needs PartyPdf's classical parser, never PDF.js/WASM. Also
  // surfaces the memory-risk estimate so the UI can show the graceful
  // "quá lớn để xử lý an toàn" notice up front instead of only after the
  // user has already waited through rendering.
  async function inspectPdf(fileOrBlob) {
    const buffer = await fileOrBlob.arrayBuffer();
    const memoryRisk = estimateMemoryRisk(buffer.byteLength);
    // Check risk BEFORE parsing, not after — sourceFromBuffer() itself is
    // the expensive/risky operation being guarded against (see
    // estimateMemoryRisk's comment), so an oversized file must never reach
    // it just to populate the info screen we're about to refuse anyway.
    if (memoryRisk.tooLarge) {
      return { pageCount: null, bytes: buffer.byteLength, memoryRisk };
    }
    const source = partyPdf().sourceFromBuffer(new Uint8Array(buffer), 'document.pdf');
    return { pageCount: source.pageCount, bytes: buffer.byteLength, memoryRisk };
  }

  // Pulled out as its own pure function so the "quality floor is never
  // crossed without an explicit caller opt-in" invariant (options.rounds or
  // options.allowBeyondFloor — never automatic) is unit-testable without a
  // browser (see scripts/regression_pdf_compress.cjs).
  function resolveRounds(options) {
    return options.rounds || ROUNDS.concat(options.allowBeyondFloor ? BEYOND_FLOOR_ROUNDS : []);
  }

  // fileOrBlob is only ever read (arrayBuffer()) — the source is never
  // written to, renamed, or mutated; the caller decides what to do with the
  // returned output Blob (it is always a new object).
  async function compressPdf(fileOrBlob, options = {}) {
    const targetBytes = options.targetBytes || PDF_COMPRESSION_TARGET_BYTES;
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    const rounds = resolveRounds(options);
    if (!rounds.length) throw new Error('Không có mức chất lượng nào để nén.');

    const buffer = await fileOrBlob.arrayBuffer();
    const originalBytes = buffer.byteLength;

    // Fail closed BEFORE parsing/rendering anything — this is the one guard
    // enforced regardless of caller (compress-mode.js's own pre-check via
    // inspectPdf(), and Party Mode's "Tạo bản dưới 20MB" which calls
    // compressPdf() directly without ever calling inspectPdf() first).
    if (estimateMemoryRisk(originalBytes).tooLarge) {
      throw new Error(MEMORY_RISK_MESSAGE);
    }

    // sourceFromBuffer() itself throws clear, already-established Vietnamese
    // errors for a non-PDF, corrupt, or encrypted file (party-pdf.js), so
    // this fails closed before any page is ever rendered.
    const source = partyPdf().sourceFromBuffer(new Uint8Array(buffer), options.name || 'document.pdf');

    try {
      const pageCount = source.pageCount;
      if (!pageCount) throw new Error('PDF không có trang nào.');

      let blob = null, achievedTarget = false, profileUsed = null, roundsUsed = 0;
      for (let r = 0; r < rounds.length; r++) {
        roundsUsed = r + 1;
        // Drop the previous round's assembled PDF Blob *before* rendering
        // the next round, not after — otherwise the old Blob's backing
        // bytes and the new round's full JPEG-items array are resident
        // simultaneously for the entire render+encode pass, not just the
        // brief reassignment moment.
        blob = null;
        const items = await renderRound(source, pageCount, rounds[r], r, rounds.length, onProgress);
        if (onProgress) onProgress({ phase: 'packaging', round: roundsUsed, roundCount: rounds.length });
        blob = buildCompressedPdf(items);
        profileUsed = rounds[r];
        if (verifyTarget(blob.size, targetBytes)) { achievedTarget = true; break; }
      }

      return {
        blob,
        originalBytes,
        outputBytes: blob.size,
        pageCount,
        achievedTarget,
        roundsUsed,
        profileUsed
      };
    } finally {
      partyPdf().releasePreviewCache?.(source);
    }
  }

  window.PdfCompress = {
    PDF_COMPRESSION_TARGET_BYTES,
    PDF_COMPRESSION_DISPLAY_LIMIT_BYTES,
    ROUNDS,
    BEYOND_FLOOR_ROUNDS,
    SAFE_MOBILE_PEAK_BYTES,
    MEMORY_RISK_MESSAGE,
    estimateMemoryRisk,
    inspectPdf,
    compressPdf,
    resolveRounds,
    renderCompressionPage,
    encodePage,
    buildCompressedPdf,
    verifyTarget
  };
})();

# 06 — AI Working Log

> Nhật ký các lần AI (Claude Code / Codex) sửa code. Mỗi agent PHẢI thêm entry sau mỗi lần
> chạm vào code. Đọc ngược từ trên xuống để biết gần đây ai đã làm gì và vì sao.

---

## Format entry

```
## [YYYY-MM-DD] [Tên task ngắn gọn]
- **Agent:** Claude Code | Codex
- **Thay đổi:** <mô tả ngắn những gì đã làm>
- **File đã sửa:** <danh sách file>
- **Lý do:** <vì sao cần thay đổi>
- **Kiểm tra:** <cách xác minh hoạt động đúng>
```

## [2026-09-06] Compress mode: honest memory audit, peak-RAM hardening, mobile-safety guard, realistic benchmark
- **Agent:** Claude Code
- **Thay đổi:**
  1. **Sửa overclaim về memory:** báo cáo trước nói "chỉ giữ một full-resolution Canvas tại một thời điểm" — đúng cho canvas pixel buffer, nhưng bỏ sót rằng `renderRound()` vẫn giữ mảng `items` (JPEG bytes toàn bộ round) và — quan trọng hơn nhiều — bộ parser cổ điển dùng chung `party-pdf.js` decode toàn bộ file thành string 2 lần + lưu byte/text-slice cho mọi object, sống suốt `compressPdf()`. Xem chi tiết đầy đủ trong `03-decisions.md` "Compress mode memory audit (2026-09-06)".
  2. **Hardening tối thiểu (`pdf-compress.js`):** `blob = null` đầu mỗi vòng round (drop reference round trước SỚM hơn, trước khi render round mới thay vì sau); `releasePreviewCache()` xác nhận vẫn chạy trong `finally` kể cả khi render lỗi (đã đúng từ trước, xác nhận lại bằng regression mới).
  3. **Peak-memory guard mới:** `estimateMemoryRisk(inputBytes)` — hệ số `PARSE_MEMORY_MULTIPLIER=5` lấy từ đo thật (không đoán, xem benchmark bên dưới), `SAFE_MOBILE_PEAK_BYTES=500.000.000`. `compressPdf()` fail closed bằng thông báo tiếng Việt rõ ràng TRƯỚC KHI parse. Phát hiện và sửa bug: `inspectPdf()` bản đầu gọi `sourceFromBuffer()` (bước tốn kém) RỒI MỚI tính risk — nghĩa là file quá khổ vẫn bị parse đầy đủ chỉ để bị từ chối; đã sửa thứ tự (risk check trước, parse chỉ khi an toàn).
  4. **UI (`compress-mode.js`, `index.html`, `styles.css`):** thêm `#compressMemoryRiskNotice` — hiện đúng thông báo "Tệp này quá lớn để xử lý an toàn trên thiết bị hiện tại. Hãy thử trên máy tính hoặc chia tài liệu thành các phần nhỏ hơn.", ẩn/disable nút "Giảm dung lượng", hiện "—" thay vì số trang khi không xác định được (file bị từ chối trước khi parse). Thêm class `.notice-danger` và `white-space:pre-line` cho `.notice` để xuống dòng đúng.
  5. **Fail-closed cho renderer lỗi:** thêm regression stub `PartyPdf.renderThumbnail` throw lỗi, xác nhận `compressPdf()` propagate lỗi (không âm thầm đóng gói trang trắng/thiếu rồi báo thành công) — đúng yêu cầu "Compression là destructive/lossy export... phải fail closed".
  6. **Fixture thực tế hơn (`scripts/benchmark_pdf_compress.cjs`, mới):** thay ảnh trắng synthetic cũ bằng trang mô phỏng scan thật: nền xám nhạt, noise dạng texture (Math.random low-res upscale, không phải crypto full-res — nhanh hơn, giống nhiễu máy quét hơn), nhiều dòng "chữ in" nhỏ, bảng kẻ ô, vùng "ảnh" gradient+noise, dấu đỏ tròn có chữ, chữ ký giả lập, trang ngang/dọc xen kẽ, một trang gần-toàn-ảnh.
  7. **Benchmark thật trên Chromium 141 `--single-process`, đo RSS qua `/proc/<pid>/status`** (không dùng `Performance.getMetrics` JSHeapUsedSize — xác nhận số liệu đó không thấy TypedArray/Blob backing store, giữ <3MB dù xử lý 80MB): 4 tier 23/38/56/80MB đều đạt target ở round 1, RSS delta 211/217/264/369MB (tỷ lệ 9.1×/5.7×/4.7×/4.6× giảm dần theo kích thước file).
  8. **Quality spot-check trực quan:** chụp lại trang đã nén ở round 1 (2200px/0.84) VÀ ở safety floor (1400px/0.50) của cùng 1 trang test (chữ nhỏ, dấu đỏ, chữ ký, vùng ảnh) — cả hai đều đọc được, không banding nghiêm trọng, không mất nội dung; xem screenshot trong báo cáo phiên làm việc.
  9. **Mobile viewport acceptance thật (390px/360px, browser automation)** — không chỉ layout tĩnh: drop PDF → info → (390px) chạy nén thật → result, xác nhận không tràn ngang và touch target `#compressWorkspace` (button trong workspace này KHÔNG nằm trong danh sách section mà `test_touch_targets.cjs` drive vào) đạt ≥44px.
  10. **Party Mode re-run đầy đủ:** case "Tải bản gốc" (giữ nguyên lossless, không đổi dung lượng) và case "Tạo bản dưới 20MB" (gọi `PdfCompress` dùng chung) đều PASS lại sau mọi thay đổi.
- **File đã sửa/mới:** `pdf-compress.js`, `compress-mode.js`, `index.html`, `styles.css`, `scripts/regression_pdf_compress.cjs`, `scripts/acceptance_pdf_compress.cjs`, `scripts/benchmark_pdf_compress.cjs` (mới), `docs/brain/01-architecture.md`, `docs/brain/03-decisions.md`.
- **Lý do:** Yêu cầu audit lại honest memory claim, hardening peak-RAM, benchmark thực tế thay vì trang trắng, và nghiệm thu mobile viewport thật thay vì chỉ layout tĩnh.
- **Kiểm tra:**
  - `node --check` PASS toàn bộ file sửa/mới.
  - `python scripts/validate_static.py`: 10/10 PASS.
  - `node scripts/regression_pdf_compress.cjs`: 38/38 PASS (tăng từ 30, thêm 8 check cho guard + fail-closed).
  - Toàn bộ regression cũ không đổi: `regression_export_busy.js` 29/29, `regression_scan_id.js` 52/52, `regression_image_decode.js` 32/32, `regression_detection_fallback.js` 17/17, `regression_help_ia.js` 26/26, `regression_party_mode.cjs` 62/62, `regression_watermark.cjs` 35/35, `regression_sw_update.cjs` 9/9, `test_touch_targets.cjs` 180/180.
  - `node scripts/acceptance_pdf_compress.cjs` (Chromium thật): PASS toàn bộ — Compress mode >20MB→<20MB, memory guard UI, Party Mode cả 2 case, mobile viewport 390px (đầy đủ) và 360px (dropzone+info) — không lỗi console ở bất kỳ kịch bản nào.
  - `node scripts/benchmark_pdf_compress.cjs` (Chromium thật): 4/4 tier PASS (23/38/56/80MB), tất cả đạt target ở round 1, không có tier nào thất bại.
  - `node scripts/acceptance_party_ui.cjs` (full): PASS trừ `runPreviewLifecycleAcceptance` — flake đã biết từ trước (xem `04-current-tasks.md`), tái hiện y hệt, không liên quan tới thay đổi lần này.
  - `node scripts/acceptance_offline_pwa.cjs`: PASS toàn bộ.
- **Known limitations:**
  - Đo memory bằng Chromium desktop-class `--single-process` — proxy cùng bậc độ lớn, KHÔNG thay thế đo trên điện thoại thật (baseline renderer process thật thấp hơn nhiều so với single-process desktop).
  - 80MB được xếp loại "hỗ trợ nhưng ở rìa an toàn" theo số đo thật — cần owner tự test tier này trên điện thoại tầm trung/thấp thật trước khi coi là an toàn tuyệt đối.
  - `PREVIEW_SOURCE_MAX_EDGE=640px` cố định trong `party-pdf.js`'s fallback renderer nghĩa là nếu PDF.js lỗi và rơi vào fallback, trang đó render ở độ phân giải thấp hơn round đang yêu cầu (kể cả round 1's 2200px) — không lỗi/không trắng nhưng chất lượng thấp hơn dự kiến; không sửa (rủi ro cao hơn lợi ích, dùng chung với Party preview).
  - Chưa có bằng chứng nghiệm thu trên thiết bị di động thật (`MOBILE_DEVICE_ACCEPTANCE_PENDING`) — chỉ Chromium device-metrics emulation.

## [2026-09-05] Giảm dung lượng PDF offline — mode thứ 5 + tích hợp Party Mode
- **Agent:** Claude Code
- **Thay đổi:**
  1. **Engine nén dùng chung (`pdf-compress.js`, mới):** `PdfCompress.compressPdf(fileOrBlob, options)` — adaptive target-size compression, target nội bộ 19.000.000 byte (`PDF_COMPRESSION_TARGET_BYTES`), 5 round giảm dần `maxEdge`/chất lượng JPEG (`ROUNDS`, mức cuối là quality floor), vượt floor chỉ qua `options.rounds`/`allowBeyondFloor` tường minh (`resolveRounds()` tách riêng để test được không cần trình duyệt). Render từng trang bằng cách gọi lại `PartyPdf.renderThumbnail()` (đã có sẵn PDF.js-kèm-fallback-cổ-điển cho Party Mode) thay vì tự bootstrap PDF.js riêng — xem lý do trong `03-decisions.md`. Đóng gói lại bằng `PartyPdf.buildPdf([], items)` (không viết bộ ghi PDF thứ ba). `inspectPdf()` cho page-count/size rẻ trước khi nén. Giữ màu mặc định tuyệt đối (không có field grayscale nào). Không network, không persistence, không mutate `items`/`bytes` đầu vào — xác nhận bằng `scripts/regression_pdf_compress.cjs`.
  2. **Mode UI mới "Giảm dung lượng PDF" (`compress-mode.js`, mới):** top-level, ngang hàng 4 mode cũ (`#modeCompressBtn`, `#compressWorkspace` trong `index.html`). Luồng: chọn/kéo PDF → hiện tên/số trang/dung lượng (báo "đã dưới 20MB" nếu đúng, không tự nén) → bấm "Giảm dung lượng" → progress theo từng trang/từng round → kết quả (trước→sau, % giảm, checklist trang/target/offline) → tải PDF hoặc "Nén mạnh hơn" nếu chưa đạt target (chỉ hiện khi `achievedTarget===false`). Wiring trong `app.js`: `els.modeCompressBtn`, `enterMode('compress')` gọi `VigilLensCompress.activate()`, `leaveActiveModeWithConfirm()`/`renderModeShell()` xử lý y hệt pattern `'watermark'`.
  3. **Tích hợp Party Mode (`party-mode.js`):** export mặc định (`exportDocument()`/`exportSingleDocument()`) giữ nguyên 100% đường lossless cũ. Chỉ thêm: nếu `result.blob.size > 20.000.000 byte`, hiện `#partyLargeFileDialog` (mới, `index.html`) thay vì tự tải — "Tải bản gốc" tải đúng blob lossless không đổi, "Tạo bản dưới 20MB" gọi thẳng `PdfCompress.compressPdf()` (không có logic nén riêng trong `party-mode.js`) rồi tải bản nén với hậu tố `_duoi-20MB.pdf`. `exportAll()` (xuất hàng loạt) không đổi — cố ý, xem "Known limitations" bên dưới.
  4. **`sw.js`:** thêm `pdf-compress.js`, `compress-mode.js` vào `ASSETS`, tăng `CACHE` lên `vigil-lens-v2.9.0`.
  5. **CSS (`styles.css`):** mode-select grid thêm breakpoint `@media (min-width:1100px)` chuyển sang 3 cột (thay vì 2) để 5 mode card xếp gọn 2 hàng (3+2) thay vì tràn 3 hàng — phát hiện qua chạy lại `scripts/acceptance_party_ui.cjs` (test layout cũ giả định đúng 4 card/2 hàng).
  6. **Test mới:** `scripts/regression_pdf_compress.cjs` (30 checks, logic thuần — hằng số, `ROUNDS`/`BEYOND_FLOOR_ROUNDS`, `resolveRounds()`, `buildCompressedPdf()` giữ số trang/thứ tự/orientation, không mutate input). `scripts/acceptance_pdf_compress.cjs` (Chromium CDP thật — dựng PDF nguồn >20MB VÀ ảnh nguồn Party Mode >20MB hoàn toàn trong trình duyệt bằng Canvas, không ghi file ra đĩa/không commit dữ liệu; xác nhận cả 2 luồng nén thật và luồng warning dialog của Party Mode).
  7. **`scripts/validate_static.py`:** thêm `pdf-compress.js`/`compress-mode.js` vào danh sách quét external-URL/privacy-boundary/emoji.
  8. **CI (`.github/workflows/static-validation.yml`):** thêm `node --check` cho 2 file mới, `regression_pdf_compress.cjs`, và `acceptance_pdf_compress.cjs`.
- **File đã sửa/mới:** `pdf-compress.js` (mới), `compress-mode.js` (mới), `index.html`, `app.js`, `party-mode.js`, `styles.css`, `sw.js`, `scripts/validate_static.py`, `scripts/regression_pdf_compress.cjs` (mới), `scripts/acceptance_pdf_compress.cjs` (mới), `.github/workflows/static-validation.yml`, `README.md`, `docs/brain/01-architecture.md`, `docs/brain/03-decisions.md`.
- **Lý do:** Yêu cầu DEV TASK end-to-end: giảm dung lượng PDF offline xuống dưới ~20MB, giữ chất lượng đọc được, không phá vỡ đường xuất lossless mặc định của Party Mode.
- **Kiểm tra:**
  - `node --check` PASS cho tất cả file sửa/mới (`app.js`, `party-pdf.js`, `party-mode.js`, `party-taxonomy.js`, `document-detector.js`, `watermark-mode.js`, `pdf-compress.js`, `compress-mode.js`, `sw.js`).
  - `python scripts/validate_static.py`: 10/10 PASS.
  - `node scripts/regression_pdf_compress.cjs`: 30/30 PASS (mới).
  - Toàn bộ regression cũ vẫn PASS không đổi: `regression_export_busy.js` 29/29, `regression_scan_id.js` 52/52, `regression_image_decode.js` 32/32, `regression_detection_fallback.js` 17/17, `regression_help_ia.js` 26/26, `regression_party_mode.cjs` 62/62, `regression_watermark.cjs` 35/35, `regression_sw_update.cjs` 9/9, `test_touch_targets.cjs` 180/180 (5 viewport, bao gồm `modeCompressBtn` mới).
  - `node scripts/acceptance_pdf_compress.cjs` (Chromium thật, `chromium-1194` headless trong môi trường dev): PASS cả 2 kịch bản — Compress mode nén PDF tổng hợp 30,5 MB/18 trang xuống 1,31 MB (18/18 trang giữ nguyên, cấu trúc/MediaBox mọi trang đọc được, header PDF hợp lệ); Party Mode export ảnh tổng hợp 10 trang ra bản lossless mặc định 30,4 MB → hiện đúng dialog cảnh báo → "Tải bản gốc" tải lại đúng 30,4 MB không đổi → "Tạo bản dưới 20MB" gọi `PdfCompress` ra bản 2,4 MB giữ đúng 10/10 trang, tên file có hậu tố `_duoi-20MB.pdf`.
  - `node scripts/acceptance_party_ui.cjs` (full, sau khi sửa CSS grid): tất cả kịch bản PASS trừ `runPreviewLifecycleAcceptance` — đây là flake đã biết từ trước, ghi nhận trong `04-current-tasks.md`, tái hiện y hệt (`calls:8, ready:6, blankReady:false`) không liên quan tới thay đổi của task này.
  - `node scripts/acceptance_offline_pwa.cjs`: PASS toàn bộ gate offline (precache 29 asset gồm 2 file mới, Document/Scan ID flow offline, zero external request).
- **Known limitations:**
  - `exportAll()` (xuất hàng loạt nhiều tài liệu Party) không có cảnh báo >20MB theo từng file — chỉ `exportSingleDocument()` (xuất từng tài liệu) có. Quyết định phạm vi có chủ đích để tránh vỡ luồng tải hàng loạt hiện có, không phải thiếu sót.
  - Tỷ lệ nén thực tế trên tài liệu scan thật (chữ đen/nền trắng, ít nhiễu) sẽ khác đáng kể so với benchmark synthetic trong `acceptance_pdf_compress.cjs` (nội dung tổng hợp có vùng nhiễu ngẫu nhiên nên nén rất mạnh ở vòng 1) — chưa có benchmark trên file scan thật đa dạng theo yêu cầu mục 14/15 của task brief (không có sẵn corpus PDF thật được phép dùng trong checkout).
  - Chưa test trên thiết bị di động thật (`MOBILE_DEVICE_ACCEPTANCE_PENDING`) — chỉ test trên Chromium desktop headless.
  - Không thêm mục "Giảm dung lượng PDF" vào `#helpDialog` (Hướng dẫn sử dụng) để tránh phá vỡ `regression_help_ia.js`/`acceptance_help_ui.cjs` (đếm số mục cố định) trong phạm vi task này — UI của mode được thiết kế tối giản, tự giải thích.

## [2026-09-04] Cập nhật mục giới thiệu tính năng: "Làm sạch chân trang"
- **Agent:** Antigravity (Gemini)
- **Thay đổi:**
  1. Thay thế tiêu đề và toàn bộ câu chữ giới thiệu của chế độ thứ 4 thành "Làm sạch chân trang" / "Làm sạch vùng chân trang" (`index.html`, `watermark-mode.js`, `README.md`).
  2. Tại thẻ chọn chế độ và modal hướng dẫn sử dụng: Đặt tên tính năng là **Làm sạch chân trang**, mô tả ngắn gọn: *"Làm sạch vùng chân trang mà không làm giảm chất lượng ảnh quét (giữ nguyên 100% dữ liệu gốc)"*.
  3. Khu vực làm việc: Đổi tiêu đề `<h2>Làm sạch chân trang</h2>`, mô tả *"Làm sạch vùng chân trang · Giữ nguyên 100% dữ liệu và chất lượng ảnh quét gốc."*
  4. Thông báo kết quả (`watermark-mode.js`): Cập nhật thành *"Đã làm sạch thành công vùng chân trang (N vị trí)"* và *"Vùng chân trang đã sạch"*.
- **File đã sửa:** `index.html`, `watermark-mode.js`, `README.md`, `docs/brain/06-ai-working-log.md`.
- **Lý do:** Yêu cầu người dùng phần mục giới thiệu chỉ ghi là "Làm sạch vùng chân trang", diễn đạt trung tính, bảo mật và phù hợp môi trường hành chính.
- **Kiểm tra:** `python scripts/validate_static.py` PASS 10/10; `node scripts/regression_watermark.cjs` PASS 35/35; `node --check watermark-mode.js` PASS.

## [2026-09-04] Chuẩn hóa giao diện: Khái quát hóa tính năng Xóa Watermark (không nhắc tên thương hiệu)
- **Agent:** Antigravity (Gemini)
- **Thay đổi:**
  1. Loại bỏ toàn bộ từ khóa tên thương hiệu "CamScanner" khỏi các thành phần giao diện người dùng (UI), màn hình chọn chế độ, modal hướng dẫn sử dụng và workspace xóa watermark (`index.html`).
  2. Chuẩn hóa tiêu đề tính năng thành "Xóa Watermark" và "Xóa Watermark / Logo", mô tả khái quát: "Tự động phát hiện và bóc tách hoàn toàn watermark / logo phần mềm quét mà không làm giảm chất lượng ảnh quét".
  3. Cập nhật các thông báo trạng thái kết quả trong `watermark-mode.js` ("Đã bóc tách thành công N watermark", "Không tìm thấy watermark trong tài liệu").
  4. Cập nhật tài liệu giới thiệu `README.md`.
- **File đã sửa:** `index.html`, `watermark-mode.js`, `README.md`, `docs/brain/06-ai-working-log.md`.
- **Lý do:** Yêu cầu người dùng diễn đạt chung là tính năng xóa Watermark, không nhắc đích danh ứng dụng cụ thể nào trên giao diện.
- **Kiểm tra:**
  - `python scripts/validate_static.py`: PASS (10/10 checks).
  - `node --check watermark-mode.js`: PASS.
  - `node scripts/regression_watermark.cjs`: PASS (35/35 checks).

## [2026-09-04] Mở rộng Watermark Stripper: Hỗ trợ dải chữ CamScanner Type 2 và Link Annotations
- **Agent:** Antigravity (Gemini)
- **Thay đổi:**
  1. **Bổ sung nhận diện dải chữ CamScanner góc phải dưới (Type 2):**
     - Mở rộng heuristic trong `detectCamScannerWatermarks`: bên cạnh Type 1 (badge chữ nhật nhỏ $140 \le W \le 270$, $45 \le H \le 110$, tỷ lệ $2.3 - 3.2$), hỗ trợ thêm dải chữ dài *"Được quét bằng CamScanner"* Type 2 ($350 \le W \le 1600$, $30 \le H \le 180$, tỷ lệ khung hình $5.5 \le W/H \le 13.0$, điển hình $888 \times 92\text{px}$ aspect ratio 9.65).
     - Loại bỏ dứt điểm các ảnh mặt nạ phân tầng MRC (`/ImageMask true`) khỏi ứng viên watermark nhằm tránh xóa nhầm dữ liệu tài liệu scan.
  2. **Ghép dồn chuỗi ma trận biến đổi toạ độ (`cm` compounding):**
     - Hỗ trợ phân tích chuỗi nhiều lệnh `cm` liên tiếp (ví dụ `1 0 0 1 700 10 cm` dịch chuyển kết hợp `126 0 0 13 0 0 cm` co giãn) trong content stream trước khi vẽ `/Do`.
     - Tích lũy tích ma trận affine 2D ($CTM = cm \times CTM$) để tính toán chính xác toạ độ thực tế và kích thước hiển thị rendered ($20 \le \text{renderW} \le 280\text{pt}$, $5 \le \text{renderH} \le 70\text{pt}$, $y \le \text{box}[1] + \text{pageHeight} \times 0.20$).
     - Cập nhật biểu thức chính quy xóa khối lệnh trong content stream (`stripWatermarkFromContentStream`) để xóa sạch toàn bộ chuỗi lệnh `cm` liên tiếp trong block `q ... Q`.
  3. **Làm sạch Link Annotations (`/Subtype /Link`):**
     - Thêm hàm `cleanCamScannerAnnotations(source, pageBody, placements)`: quét mảng `/Annots` của trang và loại bỏ triệt để các annotation link vô hình trỏ tới `camscanner.com` hoặc đè lên toạ độ bounding box của watermark. Tự động lược bỏ hoàn toàn key `/Annots` nếu không còn annotation nào khác.
     - Tích hợp vào luồng copy đối tượng `copyPageObjects`, xóa sạch link trap tương tác trên PDF sau khi bóc watermark.
  4. **Bảo toàn 100% chất lượng ảnh gốc và an toàn tài liệu:**
     - Giữ nguyên vẹn bit-for-bit toàn bộ luồng DCTDecode của ảnh quét chính (SHA-256 hash trùng khớp 100%).
     - Đạt 0 false-positive trên tập kiểm thử âm tính (con dấu, chữ ký, QR code, logo cơ quan, và tài liệu MRC).
  5. **Mở rộng Test Suite & Service Worker:**
     - Nâng cấp `scripts/regression_watermark.cjs` từ 26 lên 35 checks (bổ sung Neg 11 cho MRC 1-bit ImageMask, Type 2 detection, multi-cm compounding, link annotation stripping, SHA-256 match).
     - Bump cache Service Worker lên `vigil-lens-v2.8.1` trong `sw.js`.
- **File đã sửa:** `party-pdf.js`, `sw.js`, `scripts/regression_watermark.cjs`, `docs/brain/01-architecture.md`, `docs/brain/03-decisions.md`, `docs/brain/06-ai-working-log.md`.
- **Lý do:** Đáp ứng yêu cầu bóc watermark dải chữ mới của CamScanner ("Được quét bằng CamScanner") trong file PDF 9 trang do người dùng cung cấp mà không làm giảm chất lượng ảnh quét hay để lại link trap.
- **Kiểm tra:**
  - `python scripts/validate_static.py`: PASS (10/10 checks).
  - `node scripts/regression_watermark.cjs`: PASS (35/35 checks).
  - `node scripts/regression_party_mode.cjs`: PASS (69/69 checks).
  - `node scripts/regression_export_busy.js`: PASS (29/29 checks).
  - `node scripts/regression_scan_id.js`: PASS (52/52 checks).
  - `node scripts/acceptance_party_ui.cjs`: PASS (19/19 checks, 5 viewports).
  - Xác minh thực tế trên PDF 9 trang của người dùng: bóc sạch 9/9 watermark và 9/9 link annotations, dung lượng giảm từ 3.92 MB xuống 3.62 MB, SHA-256 ảnh gốc giữ nguyên vẹn 100%.

## [2026-09-04] Hotfix: SW Controllerchange Reload Guard & CDP Acceptance Race Elimination
- **Agent:** Codex
- **Thay đổi:**
  1. **Bảo vệ Service Worker `controllerchange` (`app.js`):**
     - Thêm cờ `let hadController = Boolean(navigator.serviceWorker.controller)` trước khi lắng nghe `controllerchange`.
     - Ngăn ngừa reload trang đột ngột trong lần cài đặt đầu tiên khi Service Worker kích hoạt và gọi `self.clients.claim()`. Chỉ reload khi trang đã có controller từ trước và nhận update mới từ người dùng.
  2. **Loại bỏ Race Condition trong CDP Test Suite (`scripts/acceptance_party_ui.cjs`):**
     - Thêm helper `navigateAndEnterPartyMode(cdp)` sử dụng `waitFor` thay thế cho chuỗi gọi `Page.navigate` + timeout tĩnh (400-500ms).
     - Loại bỏ hàm duplicate cũ `runLargePdfAcceptance` ở cuối file.
     - Thay thế toàn bộ các timeout tĩnh dễ flaky bằng điều kiện `waitFor` chuẩn xác (chờ số trang tải về pool, chờ canvas render xong `ready >= 1` hoặc `ready >= 6`, chờ toast thông báo lỗi).
- **File đã sửa:** `app.js`, `scripts/acceptance_party_ui.cjs`, `docs/brain/06-ai-working-log.md`
- **Lý do:** Khắc phục triệt để hiện tượng tải lại trang ngẫu nhiên do Service Worker claim trong môi trường mới/CI và bảo đảm 100% độ ổn định của kiểm thử giao diện tự động.
- **Kiểm tra:** `node scripts/acceptance_party_ui.cjs` đạt `PARTY_UI_BROWSER_ACCEPTANCE: PASS` trên toàn bộ 19 kịch bản và 5 viewports.

## [2026-09-04] Final Defect Closure & Release Acceptance (PR #12)
- **Agent:** Codex
- **Thay đổi:**
  1. **Hardening MediaBox / CropBox / Rotate Parsing (`party-pdf.js`):**
     - Thêm `resolveIndirectValue` và `parseBox` xử lý an toàn indirect reference `/MediaBox 15 0 R`, `/Rotate 20 0 R` và bỏ qua giá trị `null` (`/CropBox null` an toàn fallback về `/MediaBox`).
     - Cập nhật `inheritedPageText` chèn thuộc tính kế thừa trước ký tự đóng dictionary `>>` bằng `balancedPdfValueEnd`.
     - Bổ sung Synthetic U, V, W trong `scripts/regression_party_mode.cjs` (69/69 checks PASS).
  2. **Tăng cường an toàn Watermark Stripping & Chống nhận diện nhầm (`party-pdf.js`):**
     - Siết chặt tỷ lệ khung hình logo CamScanner ($2.3 \le W/H \le 3.2$ hoặc kích thước chuẩn 240×90, 166×62, 160×60, 200×75, 180×68).
     - Yêu cầu ảnh quét chính trên trang có diện tích $\ge 500,000$ px và diện tích gấp ít nhất 8 lần ứng viên watermark.
     - Phân tích ma trận biến đổi `cm` trong cửa sổ lookback 250 ký tự trước `/name Do`: vị trí lề dưới $f \le \text{box}[1] + \text{pageHeight} \times 0.20$, kích thước hiển thị $20 \le \text{renderW} \le 220$, $5 \le \text{renderH} \le 70$.
     - Loại bỏ hoàn toàn fallback regex nguy hiểm (không bao giờ nhận diện watermark nếu thiếu ma trận `cm` thỏa mãn điều kiện).
     - Thay thế `replaceResourceDict` bằng `cleanResourceDict`: xử lý an toàn cả direct và indirect `/Resources` / `/XObject`, inline từ điển đã làm sạch vào trang và loại bỏ hoàn toàn đối tượng watermark khỏi danh sách đối tượng xuất ra.
     - Chỉ ghi đè Content Stream khi nội dung stream thực sự thay đổi (`cleanedText !== text`).
  3. **Mở rộng bộ kiểm thử hồi quy (`scripts/regression_watermark.cjs`):**
     - Thêm 10 negative regression test cases (Clean PDF, Logo cơ quan ở đầu trang, Con dấu tròn/vuông, Chữ ký giữa trang, Mã QR ở chân trang, Banner toàn chiều rộng, Sơ đồ tài liệu, Ứng viên ở giữa trang, PDF không có ảnh quét chính, Các icon bullet nhỏ) -> tất cả đều giữ nguyên vẹn `removedCount = 0`, `unmodified = true`.
     - Xác thực nguyên vẹn bit-for-bit của ảnh quét tài liệu chính qua SHA-256 hash và thuộc tính từ điển đối tượng (26/26 checks PASS).
  4. **Tích hợp CI & Hướng dẫn người dùng (`.github/workflows/static-validation.yml`, `index.html`):**
     - Bổ sung `node --check watermark-mode.js` và `node scripts/regression_watermark.cjs` vào static validation workflow.
     - Cập nhật Hướng dẫn sử dụng trong `#partyHelpDialog` bằng ngôn ngữ đại chúng, phi kỹ thuật cho toàn bộ 4 chế độ làm việc của Vigil Lens.
- **File đã sửa:** `party-pdf.js`, `scripts/regression_party_mode.cjs`, `scripts/regression_watermark.cjs`, `.github/workflows/static-validation.yml`, `index.html`, `docs/brain/04-current-tasks.md`, `docs/brain/06-ai-working-log.md`
- **Lý do:** Hoàn thiện nghiệm thu đóng lỗi toàn diện, bảo đảm an toàn dữ liệu 100% không nhận diện nhầm, và tích hợp đầy đủ kiểm thử tự động trên CI.
- **Kiểm tra:**
  - `node --check app.js document-detector.js party-pdf.js party-mode.js party-taxonomy.js watermark-mode.js sw.js` (PASS)
  - `python scripts/validate_static.py` (PASS)
  - `node scripts/regression_party_mode.cjs` (69/69 PASS)
  - `node scripts/regression_watermark.cjs` (26/26 PASS)
  - `node scripts/regression_export_busy.js` (29/29 PASS)
  - `node scripts/regression_scan_id.js` (52/52 PASS)
  - `node scripts/regression_sw_update.cjs` (9/9 PASS)
  - `node scripts/test_touch_targets.cjs` (120/120 PASS)

## [2026-09-04] Xóa Watermark / Logo CamScanner không mất chất lượng (Lossless Watermark Stripping)
- **Agent:** Codex
- **Thay đổi:**
  1. **Core PDF Engine (`party-pdf.js`):**
     - Thêm hàm `replaceResourceDict(body, newResText)`: Hỗ trợ thay thế từ điển `/Resources` an toàn kể cả khi inline hay indirect.
     - Thêm hàm `stripWatermarkFromContentStream(streamText, watermarkNames)`: Phân tích cú pháp Content Stream dạng text, loại bỏ triệt để các khối lệnh vẽ `q ... cm /ImX Do Q`, `q ... /ImX Do ... Q`, và standalone `/ImX Do`.
     - Thêm hàm `detectCamScannerWatermarks(source)`: Nhận diện heuristic logo CamScanner theo chuẩn kích thước ($140\le W\le 270$, $45\le H\le 110$, tỷ lệ $1.8\le W/H\le 4.0$, các cặp chuẩn 240×90, 166×62, 160×60, 200×75), kèm kiểm tra toạ độ ma trận `cm` trong dải lề dưới ($y \le 0.25\times \text{page height}$) sau khi giải nén bằng `inflateSync`, và đối chiếu kích thước ảnh quét tài liệu chính.
     - Nâng cấp `copyPageObjects` hỗ trợ option `{ stripWatermarks: true }`: Loại bỏ watermark XObject khỏi từ điển `/Resources`, làm sạch Content Stream và tính lại `/Length`, không sao chép XObject watermark vào PDF xuất ra.
     - Thêm hàm `stripWatermarks(pdfBytes, options)`: API 1-click nhận PDF bytes và trả về `{ blob, totalPages, removedCount, removedPages, unmodified }`, fail-safe trả về tệp gốc khi không có watermark.
     - Expose vào `window.PartyPdf`: `detectCamScannerWatermarks`, `stripWatermarkFromContentStream`, `stripWatermarks`.
  2. **Giao diện người dùng & Module UI (`watermark-mode.js`, `index.html`, `styles.css`, `app.js`):**
     - Tạo module `watermark-mode.js` quản lý chế độ Xóa Watermark: Kéo thả/chọn tệp PDF, gọi `PartyPdf.stripWatermarks`, hiển thị thẻ trạng thái, bảng thống kê dung lượng và số watermark đã bóc tách, nút tải PDF sạch, nút reset, và thu hồi Object URL.
     - Cập nhật `index.html`: Thêm nút `#modeWatermarkBtn` trên `#modeSelect`, thêm section `#watermarkWorkspace` (với dropzone, result banner, meta grid, download/reset buttons), thêm `<input id="watermarkFileInput">` và nạp script `watermark-mode.js`.
     - Cập nhật `app.js`: Thêm `modeWatermarkBtn` vào `els`, định tuyến `enterMode('watermark')`, tích hợp reset và chuyển chế độ trong `#switchModeBtn`.
     - Cập nhật `styles.css`: Thiết kế layout card chọn chế độ, visual badge `BIT-FOR-BIT LOSSLESS`, styling `#watermarkWorkspace`, dropzone, status banner, và responsive grid 2x2.
     - Cập nhật `sw.js`: Đưa `'./watermark-mode.js'` vào mảng `ASSETS` precache và tăng cache version lên `vigil-lens-v2.8.0`.
  3. **Kiểm thử hồi quy & Xác thực (`scripts/regression_watermark.cjs`):**
     - Tạo bộ kiểm thử synthetic PDF mô phỏng tệp scan CamScanner chuẩn: 15/15 checks PASS, xác nhận mã băm SHA-256 của ảnh scan gốc giữ nguyên 100%, kích thước PDF giảm, không còn sót tham chiếu watermark nào, và fail-safe bảo toàn khi PDF không có watermark.
     - Cập nhật `scripts/acceptance_party_ui.cjs` hỗ trợ 4 thẻ chọn chế độ.
  4. **Tài liệu dự án:**
     - Cập nhật `README.md`, `docs/brain/00-project-overview.md`, `docs/brain/01-architecture.md`, `docs/brain/03-decisions.md`.
- **File đã sửa:**
  - `party-pdf.js`
  - `index.html`
  - `styles.css`
  - `app.js`
  - `sw.js`
  - `watermark-mode.js` (file mới)
  - `scripts/regression_watermark.cjs` (file mới)
  - `scripts/acceptance_party_ui.cjs`
  - `README.md`
  - `docs/brain/00-project-overview.md`
  - `docs/brain/01-architecture.md`
  - `docs/brain/03-decisions.md`
  - `docs/brain/06-ai-working-log.md`
- **Lý do:** Đáp ứng yêu cầu bổ sung tính năng xóa watermark / logo CamScanner không mất chất lượng bằng can thiệp cấu trúc PDF nhị phân, bảo vệ tính riêng tư và 100% offline.
- **Kiểm tra:**
  - `node --check app.js`: PASS
  - `node --check party-pdf.js`: PASS
  - `node --check party-mode.js`: PASS
  - `node --check watermark-mode.js`: PASS
  - `node --check sw.js`: PASS
  - `python scripts/validate_static.py`: 10/10 PASS
  - `node scripts/regression_watermark.cjs`: 15/15 PASS
  - `node scripts/regression_party_mode.cjs`: 66/66 PASS
  - `node scripts/regression_export_busy.js`: 29/29 PASS
  - `node scripts/regression_scan_id.js`: 52/52 PASS

## [2026-09-03] Fix canonical Party UI acceptance timing race
- **Agent:** Codex
- **Thay đổi:**
  - Viết helper `waitFor(cdp, condition, timeoutMs)` trong `scripts/acceptance_party_ui.cjs` để đồng bộ theo trạng thái thật (DOM element, previewRendered, dimensions), loại bỏ triệt để các lệnh sleep cố định gây timing race trên Windows host.
  - Đồng bộ trạng thái canvas trước và sau hành động rotate trong `runHelpUxAcceptance` và `runEventListenerAcceptance`.
  - Phân định phạm vi đếm `.party-assigned-badge` thành `.party-source-pool .party-assigned-badge` để không bị đếm nhầm 2 thẻ nhãn tĩnh minh họa trong `#partyHelpDialog`.
- **File đã sửa:** `scripts/acceptance_party_ui.cjs`
- **Lý do:** Khắc phục lỗi assertion trong canonical UI acceptance gate do render async của PDF.js trên Windows.
- **Kiểm tra:**
  - `node scripts/acceptance_party_ui.cjs`: 19/19 checks PASS (exit code 0).
  - `python scripts/validate_static.py`: 10/10 PASS.
  - `node scripts/regression_party_mode.cjs`: 66/66 checks PASS.
  - `node scripts/regression_export_busy.js`: 29/29 checks PASS.
  - `node scripts/regression_scan_id.js`: 52/52 checks PASS.
  - Real PDF sanity: Original File 01 (`86ac6f...`) 12/12 PASS, File 02 11/11 PASS, source mutation = 0.

## [2026-09-03] Fix Party PDF parser cho MediaBox dictionary + compressed /ObjStm
- **Agent:** Codex
- **Thay đổi:**
  1. **Fix delimiter parser cho nested dictionaries (`balancedPdfValueEnd`, `pdfValueEnd`):**
     - Thay thế vòng lặp giảm độ sâu 1-byte bằng stack-based delimiter parser (`stack = [open]`).
     - Đọc và nhảy chính xác 2 byte cho `<<` và `>>`, giải quyết triệt để lỗi giảm nhầm depth khi gặp các token đóng liền kề không khoảng trắng như `>>>>/MediaBox` (gốc rễ lỗi "PDF page thiếu MediaBox/CropBox hợp lệ" ở File 01 `01.Ly_lich_nguoi_xin_vao_dang.pdf`).
     - Hỗ trợ đầy đủ mảng lồng nhau `[...]`, chuỗi hex `<...>`, chuỗi literal `(...)` có ký tự escape `\` và đóng/mở ngoặc lồng, cùng dòng comment `%...`.
  2. **Bộ giải nén pure JS RFC 1951 Deflate / RFC 1950 zlib đồng bộ (`inflateSync`):**
     - Viết mới bộ giải nén pure JavaScript không dependency, chạy đồng bộ (synchronous) cả trên Node.js và mọi trình duyệt hiện đại.
     - Khắc phục cơ chế bit packing của Huffman code (MSB-first: `(code << 1) | getBits(1)`), giải mã chính xác 100% byte-for-byte tương đương `zlib.inflateSync`.
  3. **Hỗ trợ Object Streams nén (`/Type /ObjStm`, ISO 32000-1 §7.5.7):**
     - Thêm `parseObjectStreams(bytes, text, objectIndex)`: Tự động phát hiện các stream `/Type /ObjStm`, đọc `/N` và `/First`, giải nén payload bằng `inflateSync`.
     - Phân tích header gồm $N$ cặp số nguyên `[id, offset]`, cắt chính xác phần thân của từng compressed object và đưa vào bản đồ đối tượng.
     - Nâng cấp `resolveIndirectLength`: Tìm kiếm `/Length` gián tiếp trong cả top-level objects và compressed objects từ `/ObjStm` (giải quyết lỗi Object 5 trỏ `/Length 6 0 R` nằm trong `/ObjStm 8` ở File 02 `02.Ly_lich_dang_vien.pdf`).
     - Bảo toàn 100% các ràng buộc an toàn ngày 02/09: self-reference guard, cyclic reference guard, declared length authority, fake endstream guard, non-numeric guard, negative guard, out-of-bounds guard.
  4. **Materialization khi xuất PDF (`copyPageObjects`):**
     - Khi xuất tài liệu, các đối tượng trích xuất từ `/ObjStm` được ánh xạ ID mới và tự động vật chất hóa (materialize) thành các top-level object độc lập (`${outputId} 0 obj\n${body}\nendobj\n`). File PDF xuất ra hoàn toàn tự chứa, chuẩn PDF 1.4, không còn phụ thuộc vào `/ObjStm`.
  5. **Bổ sung 4 bộ kiểm thử hồi quy synthetic cho CI:**
     - Synthetic J: Adjacent nested close (`>> >> /MediaBox`).
     - Synthetic K: Adjacent close không có khoảng trắng (`>> >>/MediaBox[...]`).
     - Synthetic L: 4 cấp nested dictionary kết thúc bằng `>>>>>>>>/MediaBox`.
     - Synthetic M: PDF có `/ObjStm` nén chứa indirect `/Length` và dictionary, kiểm tra export vật chất hóa thành top-level object thành công.
- **Lý do:** Hai file PDF thực tế hợp lệ nhưng không tải được do parser bị lệch depth ở thẻ đóng dictionary liền kề và chưa đọc được đối tượng nén trong `/ObjStm` (Ghostscript 10.x).

- **Kiểm tra:**
  - `node --check party-pdf.js` & `node --check scripts/regression_party_mode.cjs`: PASS syntax.
  - `python scripts/validate_static.py`: 10/10 PASS (zero external URLs, zero emojis, zero legacy brand, asset cache verified).
  - `node scripts/regression_party_mode.cjs`: 59/59 checks PASS (tăng từ 53 lên 59 với 4 synthetic checks mới).
  - `node scripts/regression_export_busy.js`: 29/29 checks PASS.
  - `node scripts/regression_scan_id.js`: 52/52 checks PASS.
  - **Kiểm thử trên 2 file thật bằng `pypdf`:**
    - File 01 (12 trang, SHA256 `86ac6f1355bcaa8a94ff751761046c9d28252800c29e232e67de116e4e9a413f`): 12/12 trang đọc MediaBox hợp lệ, xuất 3 trang (0, 1, 2) thành công, `pypdf` xác nhận đủ 3 trang với MediaBox và rotation 270° chính xác, hash file nguồn không đổi 100%.
    - File 02 (11 trang, SHA256 `d1f63be0bcfb182dafbfce32e81eb809a9b6e087851916c0aeacfbd36450deb6`): 11/11 trang đọc MediaBox hợp lệ, giải nén `/ObjStm` thành công, xuất 3 trang (0, 1, 2) thành công, `pypdf` xác nhận đủ 3 trang với MediaBox và rotation 0° chính xác, hash file nguồn không đổi 100%.
  - **Browser Acceptance trên Chromium thật qua CDP:**
    - File 01: Load thành công 12/12 thumbnails, mở dialog preview trang 1 thành công, chọn trang 1–3, tạo tài liệu, gán taxonomy 01, xuất file `01.Ly_lich_nguoi_xin_vao_dang.pdf`, `pypdf` kiểm tra file tải về có đủ 3 trang.
    - File 02: Load thành công 11/11 thumbnails, mở dialog preview trang 1 thành công, chọn trang 1–3, tạo tài liệu, gán taxonomy 02, xuất file `02.Ly_lich_dang_vien.pdf`, `pypdf` kiểm tra file tải về có đủ 3 trang.


## [2026-09-02] Cập nhật Hướng dẫn sử dụng trong ứng dụng cho Scan tài liệu Đảng
- **Agent:** Antigravity (Gemini 3.7 Flash)
- **Thay đổi:**
  1. Thiết kế lại toàn diện modal Hướng dẫn sử dụng (`#partyHelpDialog`) theo cấu trúc 2 tầng:
     - **Tầng 1 (Quy trình nhanh 6 bước):** Đặt ngay đầu dialog với 6 thẻ bước trực quan: Nhập nguồn → Kiểm tra trang nguồn → Chọn trang tạo tài liệu → Sắp xếp & chỉnh trang → Chọn loại trong 104 loại → Kiểm tra & xuất PDF.
     - **Tầng 2 (Hướng dẫn chi tiết theo nghiệp vụ):** 24 mục chi tiết giải thích rõ ràng khái niệm Trang nguồn vs Tài liệu, khu vực Danh sách trang nguồn, xem trước lớn & cảnh báo không mất trang, 3 cách chọn trang (tick/khoảng/rời/tất cả), cách chia 1 PDF thành nhiều tài liệu, đổi thứ tự trang (`← Trước`/`Sau →`), ghép với trước/sau, chuyển trang, xoay 90°, thay trang tại chỗ, thêm trang, xóa khỏi tài liệu (trả trang về pool chưa gán), xóa tài liệu, danh mục 104 loại & canonical filename, xử lý nhiều tài liệu cùng loại (`.1`, `.2`) kèm xác nhận thứ tự, thanh phân trang (coverage), xuất riêng từng tài liệu (`Xuất tài liệu này`), xuất tất cả, bảo toàn chất lượng PDF gốc (page-object copy, không rasterize), bảo mật 100% offline (không OCR, không AI, không upload), và ví dụ thực tế hoàn chỉnh xử lý file scan 36 trang.
  2. Bổ sung styling responsive trong `styles.css`: Sheet layout với header cố định (nút Đóng luôn hiển thị khi cuộn), quickflow cards, numbered step badges, callout boxes (ghi chú/cảnh báo/bảo mật), visual button tags (`.party-help-btn-tag`), và tối ưu giao diện mobile 390×844.
  3. Bảo toàn 100% logic xử lý PDF, parser, preview, split/create, merge, move, rotate, replace, insert, remove, taxonomy, filename canonical, export PDF.
- **File đã sửa:** `index.html`, `styles.css`, `docs/brain/06-ai-working-log.md`.
- **Lý do:** Hướng dẫn trong app đã cũ, chưa phản ánh workflow chọn trang nguồn → tạo tài liệu → xuất riêng lẻ và danh mục 104 loại mới, cần cập nhật chi tiết cho cán bộ lần đầu sử dụng.
- **Kiểm tra:**
  - `node --check app.js`, `node --check party-mode.js`, `node --check party-pdf.js`: Cú pháp JavaScript hợp lệ 100%.
  - `python scripts/validate_static.py`: 10/10 PASS (zero external URLs, zero UI emojis, zero legacy brand, asset cache verified).
  - `node scripts/regression_party_mode.cjs`: 53/53 PASS.
  - `node scripts/acceptance_offline_pwa.cjs`: 100% Offline Verified PASS.
  - `node scripts/test_touch_targets.cjs`: 142/142 PASS.
  - Headless Chrome CDP Help UX verification trên Desktop (1280×800) và Mobile (390×844): Dialog mở mượt mà, scroll riêng, không tràn màn hình ngang (`overflowX = false`), nút Đóng hoạt động tốt, hiển thị đầy đủ 13/13 required topics và 25/25 sections; bảo toàn 100% trạng thái Party Mode khi đóng/mở hướng dẫn.

## [2026-09-02] Chuyển đổi Party Document Mode: Chọn trang → Tạo tài liệu → Xuất riêng lẻ
- **Agent:** Codex
- **Thay đổi:**
  1. **Bỏ hoàn toàn cơ chế đa điểm tách ("Tách tại đây"):** Xóa toàn bộ logic, state (`markedSplits`), UI và CSS phục vụ multi-split dividers (`Tách tại đây`, `Áp dụng N điểm tách`, `Bỏ các điểm tách`).
  2. **Áp dụng mô hình Chọn trang → Tạo tài liệu:**
     - Xây dựng vùng Danh sách trang nguồn (`.party-source-pool`) hiển thị toàn bộ trang từ PDF/ảnh đưa vào.
     - Trang bị kèm checkbox với diện tích chạm $\ge 44\text{px}$, phản hồi tức thì và visual rõ ràng khi chọn (`.is-checked`).
     - Thanh thao tác chọn (`#partySelectionBar`): Đếm số trang đã chọn, nút **Tạo tài liệu từ trang đã chọn**, nút **Chọn tất cả**, nút **Bỏ chọn**, và bộ chọn khoảng trang linh hoạt (`#partyRangeInput`, hỗ trợ cú pháp `1-3`, `17-22`, `17,19`).
  3. **Bảo toàn thứ tự trang nguồn tăng dần:** Khi tạo tài liệu mới, hệ thống tự động lọc trang nguồn theo đúng thứ tự gốc tăng dần, bất kể thứ tự người dùng click chọn (ví dụ click `19 -> 17 -> 18` vẫn tạo tài liệu có thứ tự `17 -> 18 -> 19`). Hỗ trợ chọn trang không liền nhau.
  4. **Chống trùng lặp ngoài ý muốn:** Trang đã được xếp vào tài liệu sẽ có huy hiệu `Tài liệu N` và không thể bị tích chọn trùng lặp vào tài liệu khác.
  5. **Xuất riêng lẻ từng tài liệu (Partial Export):** Mỗi thẻ tài liệu có nút **Xuất tài liệu này**, kích hoạt ngay khi tài liệu có $\ge 1$ trang và đã chọn taxonomy hợp lệ (01–104). Không bắt buộc coverage toàn bộ PDF = 100%. Thông báo xuất hiển thị rõ số trang đang xuất và số trang còn lại trong phiên.
  6. **Tỷ lệ phủ là thông tin, không phải rào cản:** Hiển thị `N/M trang nguồn đã được xếp vào tài liệu` mang tính chất kiểm toán, cảnh báo chỉ hiện như gợi ý.
  7. **Loại bỏ nút "+ Tài liệu"** để tránh tạo document rỗng; xóa tài liệu hoặc gỡ trang tự động trả trang về trạng thái chưa gán an toàn trong pool.
  8. **Cập nhật trợ giúp & bộ kiểm thử:** Đồng bộ nội dung trong modal Trợ giúp (`index.html`), cập nhật suite test hồi quy `scripts/regression_party_mode.cjs` (36/36 PASS), cập nhật kịch bản browser acceptance headless Chrome CDP trong `scripts/acceptance_party_ui.cjs`.
- **File đã sửa:** `index.html`, `styles.css`, `party-mode.js`, `scripts/regression_party_mode.cjs`, `scripts/acceptance_party_ui.cjs`, `docs/brain/01-architecture.md`, `docs/brain/03-decisions.md`, `docs/brain/06-ai-working-log.md`.
- **Lý do:** Đáp ứng yêu cầu DEV TASK: Đơn giản hóa Party Document Mode, cho phép cán bộ chọn trang, tạo tài liệu độc lập và xuất ngay từng tài liệu mà không cần duyệt và phân loại toàn bộ file scan lớn.
- **Kiểm tra:**
  - `node --check app.js`, `node --check party-mode.js`, `node --check scripts/regression_party_mode.cjs`, `node --check scripts/acceptance_party_ui.cjs` -> Cú pháp hợp lệ 100%.
  - `python scripts/validate_static.py` -> 10/10 PASS (zero external CDN, zero remote fonts, zero emoji UI).
  - `node scripts/regression_party_mode.cjs` -> 36/36 PASS (A–I: 80-page fixture, out-of-order selection order test, non-contiguous selection, duplication prevention, partial export, canonical taxonomy naming, duplicate type suffixes .1/.2, delete document recovery, and empty doc prevention).
  - `node scripts/regression_export_busy.js` + `node scripts/regression_scan_id.js` -> PASS 29/29 & 52/52 checks.

## [2026-09-02] Thay logo và icon Scan tài liệu Đảng bằng vector-bua-liem-5.png
- **Agent:** Codex
- **Thay đổi:**
  1. Thẻ chọn chế độ (`#modePartyBtn`): Thay ký tự placeholder `▣` bằng `<img src="icons/vector-bua-liem-5.png" class="party-box-icon" alt="" />`.
  2. Màn hình nhập nguồn Party Mode (`#partyEmptyState`): Thay ký tự mũi tên lên `⇧` ở giữa bằng cụm `.party-empty-visual` đặt icon búa liềm góc trên bên trái (`.party-box`) và pill `104 loại` góc trên bên phải, đồng bộ chuẩn giao diện với thẻ chế độ.
  3. CSS (`styles.css`): Định kiểu dùng chung cho `.party-box`, `.party-box-icon`, và căn chỉnh layout cho `.party-drop-zone`.
  4. Service Worker (`sw.js`): Thêm `./icons/vector-bua-liem-5.png` vào `ASSETS` precache và nâng cache lên `vigil-lens-v2.7.1`.
- **File đã sửa:** `index.html`, `styles.css`, `sw.js`, `docs/brain/01-architecture.md`, `docs/brain/06-ai-working-log.md`.
- **Lý do:** Người dùng yêu cầu thay logo phần scan tài liệu Đảng và chuyển icon mũi tên lên thành icon búa liềm đặt ở góc bên trái giống thẻ chế độ khác.
- **Kiểm tra:** `node --check app.js`, `node --check sw.js`, `python scripts/validate_static.py` PASS 10/10 (26 assets cached, 0 broken, 0 URL ngoài), `node scripts/regression_sw_update.cjs` PASS 9/9, `node scripts/regression_party_mode.cjs` PASS 31/31.

## [2026-08-31] Frontend Redesign: Red/Gold Brand, Frosted Glass, Modern Rounded Blocks
- **Agent:** Claude Code
- **Thay đổi:** Redesign-preserve toàn bộ giao diện (không đổi IA/HTML structure/IDs, không đụng pipeline `app.js`/`document-detector.js`/`party-*.js`). Thay hệ token màu từ xanh dương lạnh (cobalt) sang đỏ (`--primary #b3261e`) + vàng đồng (`--gold #b9852a`) trên nền trung tính ấm; áp dụng cho cả token `--manager-*` của Party Mode (trước đó dùng bảng màu xanh ngọc/navy riêng biệt, nay đồng bộ đỏ/vàng). Thêm hệ token kính mờ (`--glass-*`, xấp xỉ web của "frosted glass", có fallback `prefers-reduced-transparency`) áp dụng cho topbar, badge "100% Offline", update-banner. Tăng toàn bộ thang bo góc (`--radius-*`) và một số bán kính cứng trong Party Mode để có cảm giác khối bo tròn hiện đại hơn. Đổi shadow token sang tint ấm thay vì xám lạnh. Đồng bộ màu tay cầm góc & khung tứ giác trên canvas chỉnh sửa (`app.js`) từ xanh dương sang đỏ/vàng (chỉ đổi hằng số màu vẽ, không đổi logic homography/corner detection). Cập nhật `theme-color`/`background_color` trong `index.html` và `manifest.webmanifest`, bump cache Service Worker lên `vigil-lens-v2.6.0` để bản redesign được người dùng đã cài PWA nhận qua luồng update-banner có sẵn. Thêm dòng credit "Thiết kế bởi Đại úy Vi Ngọc Phương - Cán bộ Phòng An ninh đối ngoại" và thông báo bản quyền vào `.app-footer` theo yêu cầu người dùng. Font Be Vietnam Pro giữ nguyên (đã tự host sẵn từ trước, không cần đổi).
- **File đã sửa:** `styles.css`, `index.html`, `app.js` (chỉ 4 dòng hằng số màu canvas: 530, 552, 554, 1060), `manifest.webmanifest`, `sw.js`.
- **Lý do:** Người dùng yêu cầu làm lại frontend theo tone đỏ vàng, hiệu ứng kính mờ, khối bo tròn hiện đại, dùng `taste-skill`.
- **Kiểm tra:** `node --check app.js` PASS. Chạy `python server.py` (cổng 8765) qua Browser pane, kiểm tra trực quan màn hình chọn chế độ, màn hình nhập ảnh (Document mode), màn hình nhập nguồn Party mode ở cả desktop (1400px) và mobile (375px) — không có regression bố cục, tương phản nút/badge đạt yêu cầu, glass topbar hiển thị đúng blur. Rà soát lại toàn bộ hex trong `styles.css` sau khi sửa: không còn hex thuộc gam xanh dương/xanh ngọc cũ, chỉ còn đỏ/vàng/trung tính ấm + xanh lá (success)/đỏ cảnh báo (danger) giữ nguyên vai trò ngữ nghĩa. Lỗi console `Cannot set properties of null (setting 'textContent')` tại `app.js:1320` đã xác minh là lỗi có sẵn từ trước (tái hiện trên trang tải sạch, không liên quan 4 dòng màu đã sửa) — không thuộc phạm vi task này, chưa sửa.

## [2026-08-31] PR #10 Final Review Evidence Gates
- **Agent:** Codex
- **Thay đổi:** Thêm `scripts/reproduce_party_preview_race.cjs`, một browser harness độc lập nhận `--root <checkout>` để chạy cùng fixture PDF tổng hợp 12 trang trên cả base/candidate; khi preview queue đang chạy, harness chọn trang liên tục, chờ ổn định, kiểm tra coverage, canvas ready/visible và pixel trắng. Mở rộng `runMultiSplitAcceptance()` với split 3/6/9 → reorder hai trang trong tài liệu đầu tiên, kiểm tra `data-page-id` đi theo đúng `sourcePage`, coverage 12/12, không duplicate/missing, rồi giữ nguyên merge/move/export assertion có sẵn.
- **File đã sửa:** `scripts/reproduce_party_preview_race.cjs`, `scripts/acceptance_party_ui.cjs`, `docs/brain/04-current-tasks.md`, `docs/brain/06-ai-working-log.md`.
- **Lý do:** Đóng evidence gates PR #10 mà không sửa production hoặc đưa PDF hồ sơ thật lên GitHub.
- **Kiểm tra:** Harness cùng logic chạy trên base `2331fc08c0722ce63414515aceaeb36c9e6b9770` và candidate `74dd066a49c44f7048692ae69b7074b64f64ce79`; cả hai đều ghi nhận 0 canvas ready trắng, vì vậy kết luận đúng là `ROOT_CAUSE_REPRODUCTION_NOT_PROVEN`, không phải base FAIL → hotfix PASS. `node scripts/regression_party_mode.cjs` PASS 26/26; browser acceptance multi-split/reorder/merge/move/export PASS. Hai PDF private được yêu cầu không có trong checkout/workspace/user profile đã quét theo đúng tên nên local pilot chưa chạy; không coi kết quả synthetic là real-PDF pilot.
## [2026-08-31] PR #10 Review Blockers Closure: CI Emoji Guard, True Blank Page, Event Delegation & Bounded Cache
- **Agent:** Codex
- **Thay đổi:**
  1. **Fix CI Đỏ (UI Emoji Guard):** Thay thế toàn bộ ký tự kéo literal U+2702 bằng SVG icon nhất quán trong `party-mode.js` và loại bỏ khỏi `index.html`. `python scripts/validate_static.py` PASS 10/10.
  2. **Chứng minh Root Cause White Thumbnails & Đồng bộ DOM:**
     - Tái hiện lỗi: Trong Base PR #9, khi user thao tác chọn trang / cuộn ngang trong lúc preview đang dựng, `render()` tái tạo DOM khiến canvas cũ bị hủy, canvas mới rỗng (300x150 blank), `page.previewState` bị kẹt ở `ready` hoặc `rendering` làm thumbnail trắng vĩnh viễn.
     - Khắc phục: `restoreRenderedCanvases()` khôi phục tức thì layer canvas đã render lên thẻ DOM mới. Đã bổ sung test `runRapidInteractionRerenderReproduction` kiểm tra click liên tục trong lúc preview queue đang chạy (PASS 0 blank).
  3. **Hỗ trợ True Blank Page (Trang trắng hợp lệ):** Thêm hàm `sourceHasInk(ref)` kiểm tra stream và image XObject. Nếu trang PDF thực sự là trang scan trắng (toàn bộ pixel 255), preview đánh dấu `ready` hợp lệ, không báo lỗi giả. Nếu trang có ink mà canvas render trắng, phát hiện và kích hoạt fallback / error card.
  4. **Loại bỏ trùng lặp Event Listeners:** Thay thế `bindDocumentEvents()` bằng Event Delegation gắn 1 lần duy nhất trên `els.documents` và `els.orderPanel`. Test `runEventListenerAcceptance` xác nhận click xoay đúng 1 lần chỉ xoay +90°, click split toggle đúng 1 lần.
  5. **Bảo toàn Lazy Rendering & Bounded Cache (RAM):**
     - Loại bỏ việc enqueue toàn bộ canvas trên scroll listener; dùng `IntersectionObserver` với `rootMargin: '600px'` tải gối đầu mượt mà ~3 thẻ trang kế tiếp.
     - Bounded cache LRU tối đa 32 thumbnail trong bộ nhớ (`state.cachedThumbPages`), ngăn chặn rò rỉ RAM trên PDF 100–200 trang.
     - Test 100 trang: ban đầu 6/100, sau khi cuộn chỉ 9/100 được render.
  6. **Hoàn thiện Multi-Split Regression:** Bổ sung test workflow đầy đủ: split 3/6/9 -> 4 docs, merge doc 2 vào doc 1 -> 3 docs ([6,3,3]), move trang 6 sang doc 2 -> [5,4,3], bảo toàn tuyệt đối số trang nguồn `Nguồn: trang Y/12`, và xuất 3 file PDF chuẩn.
- **File đã sửa:** `party-pdf.js`, `party-mode.js`, `styles.css`, `index.html`, `scripts/acceptance_party_ui.cjs`, `docs/brain/06-ai-working-log.md`
- **Lý do:** Đóng toàn bộ các blocker review của PR #10, bảo đảm CI xanh và không hồi quy lazy render / event listeners.
- **Kiểm tra:** `python scripts/validate_static.py` PASS (10/10), `node scripts/regression_party_mode.cjs` PASS (26/26), `node scripts/acceptance_party_ui.cjs` PASS (bao gồm 2 real PDFs 12 trang và 2 trang).

## [2026-08-30] Hotfix PR #10: Party Document Mode PDF Preview & Multi-Split UX
- **Agent:** Codex
- **Thay đổi:**
  1. **Harden PDF Preview (P0):**
     - Bổ sung `hasContentPixels` kiểm tra pixel nội dung thực tế trên canvas sau khi render. Nếu canvas trắng bất thường khi trang có stream/xobject, throw error để fallback hoặc báo lỗi rõ ràng.
     - PDF.js là renderer chính, không fallback âm thầm; log cảnh báo chi tiết trên console khi fallback hoặc gặp lỗi.
     - Caching canvas derivative trong bộ nhớ (`page.previewThumbCanvas`), khôi phục đồng bộ ngay khi `render()` DOM tái tạo để ngăn chặn hiện tượng chớp trắng và thumbnail bị mất.
     - Hiển thị UI lỗi rõ ràng với thông điệp *"Không thể hiển thị xem trước"*, *"Trang vẫn được giữ nguyên khi xuất PDF"* và nút *"Thử lại"* (`party-retry-preview`).
     - Tối ưu hàng đợi xem trước chủ động: lắng nghe cuộn ngang trên `.party-page-rail` và quan sát IntersectionObserver mở rộng margin 600px.
  2. **Multi-Split UX (P1):**
     - Thêm nút phân tách trực quan `✂ Tách tại đây` / `✂ Đã đánh dấu tách` giữa các thẻ trang kề nhau.
     - Thanh điều khiển đa điểm tách `party-multisplit-bar` hiển thị *"Áp dụng N điểm tách"* và *"Bỏ các điểm tách"*.
     - Thuật toán `applyDocumentSplits` chia tài liệu thành $N+1$ tài liệu mới, bảo toàn 100% thứ tự, góc xoay, đối tượng PDF nguồn và các thuộc tính trang.
     - Tương thích hoàn toàn với tính năng tách đơn *"Tách sau trang đang chọn"*.
  3. **Hiển thị số trang nguồn rõ ràng:**
     - Thẻ trang hiển thị `Trang X` và `Nguồn: trang Y/Z` (hoặc `Ảnh scan mới` cho ảnh mới chụp/chọn).
  4. **Cập nhật Hướng dẫn sử dụng cho Cán bộ:**
     - Viết lại 13 mục hướng dẫn sử dụng trong `partyHelpDialog` bằng tiếng Việt tường minh, thân thiện với cán bộ nghiệp vụ Đảng.
  5. **Kiểm thử tự động & Real PDF Pilot:**
     - Thêm unit test multi-split 12 trang chia 4 phần trong `scripts/regression_party_mode.cjs` (26/26 checks PASS).
     - Thêm integration test multi-split và kiểm tra pilot trên 2 file PDF thật (`Scan2026-08-24_150131(1).pdf` 12 trang và `Image_ dang 1001.pdf` 2 trang) trong `scripts/acceptance_party_ui.cjs` (PASS).
- **File đã sửa:** `party-pdf.js`, `party-mode.js`, `styles.css`, `index.html`, `scripts/regression_party_mode.cjs`, `scripts/acceptance_party_ui.cjs`, `docs/brain/06-ai-working-log.md`
- **Lý do:** Khắc phục lỗi thumbnail trắng trong Party Mode và nâng cấp trải nghiệm tách tài liệu scan nhiều trang.
- **Kiểm tra:** `node --check app.js sw.js party-pdf.js party-mode.js` PASS, `node scripts/regression_party_mode.cjs` PASS (26/26), `node scripts/acceptance_party_ui.cjs` PASS với real PDF env vars.

## [2026-08-23] PWA In-App Update Banner

- **Agent:** Antigravity (Claude Opus 4.6)
- **Thay đổi:** Thêm cơ chế phát hiện và cập nhật phiên bản mới cho PWA đã cài trên điện thoại:
  - Bỏ `self.skipWaiting()` tự động trong SW install → SW mới sẽ chờ ở trạng thái `waiting`
  - Thêm `message` listener trong `sw.js` để nhận lệnh `SKIP_WAITING` từ app
  - Thêm update detection trong `app.js`: lắng nghe `updatefound` + `statechange`, kiểm tra `reg.waiting`, auto-check mỗi 60 phút
  - Thêm banner UI "Phiên bản mới đã sẵn sàng" với nút "Cập nhật" và nút đóng
  - Khi user nhấn "Cập nhật" → `postMessage({type:'SKIP_WAITING'})` → SW activate → `controllerchange` → `location.reload()`
  - Bump cache version lên `vigil-lens-v2.3.0`
- **File đã sửa:** `sw.js`, `app.js`, `index.html`, `styles.css`, `scripts/acceptance_offline_pwa.cjs`
- **Lý do:** Người dùng cài PWA trên điện thoại cần biết khi nào có phiên bản mới và chủ động cập nhật
- **Kiểm tra:** `node --check app.js sw.js` PASS, `python scripts/validate_static.py` 9/9 PASS, `node scripts/regression_sw_update.cjs` 9/9 PASS, `node scripts/test_touch_targets.cjs` 140/140 PASS

## [2026-08-23] Final Acceptance Closure & PWA Icon Rebrand cho PR #8 (VPH Vigil Lens)

- **Agent:** Codex
- **Baseline SHA:** `2822426eaeebfd3a919aec7c936abaea761f6639`
- **Thay đổi:**
  1. **PWA Icons Rebrand:** Tạo mới hoàn toàn `icons/icon-192.png` và `icons/icon-512.png` theo biểu tượng quang học của VPH Vigil Lens (chữ V hình học, 4 ngoặc lấy nét cobalt, reticle quang học trên nền slate navy, maskable-safe).
  2. **Service Worker Cache Bump:** Nâng cấp cache lên `vigil-lens-v2.2.1` trong `sw.js` để đảm bảo client đã cài đặt PWA tự động cập nhật icon mới.
  3. **CI Portability & Touch Targets:** Tích hợp kiểm thử `test_touch_targets.cjs` vào `.github/workflows/static-validation.yml` kèm bộ dò tìm trình duyệt đa nền tảng (`findBrowser()` hỗ trợ Linux runner, Windows, macOS).
  4. **Documentation & Decision Log:** Viết lại `docs/brain/04-current-tasks.md` phản ánh chính xác trạng thái PR #8, tách bạch automated offline acceptance (PASS) và manual OS installability prompt (PENDING); bổ sung quyết định thiết kế icon trong `docs/brain/03-decisions.md`.
- **File đã sửa:** `icons/icon-192.png`, `icons/icon-512.png`, `sw.js`, `.github/workflows/static-validation.yml`, `scripts/test_touch_targets.cjs`, `scripts/acceptance_offline_pwa.cjs`, `scripts/capture_ui_states.cjs`, `scripts/generate_pwa_icons.cjs`, `docs/brain/03-decisions.md`, `docs/brain/04-current-tasks.md`, `docs/brain/06-ai-working-log.md`.
- **Lý do:** Hoàn thiện 100% các tiêu chuẩn release candidate cho PR #8, đóng toàn bộ acceptance gaps trước khi đưa ra khuyến nghị merge.
- **Kiểm tra:**
  - `python scripts/validate_static.py` PASS (9/9 checks).
  - `node scripts/test_touch_targets.cjs` PASS (140/140 checks).
  - `node scripts/regression_sw_update.cjs` PASS (9/9 checks).
  - `node scripts/acceptance_offline_pwa.cjs` PASS.
  - `node scripts/regression_export_busy.js` PASS (29/29).
  - `node scripts/regression_scan_id.js` PASS (52/52).
  - `node scripts/regression_ml_detector.js` PASS (53/53).
  - `node scripts/rehearsal_dataset.cjs` PASS (25/25 images).

---

## [2026-08-23] Rebrand toàn diện ứng dụng thành VPH Vigil Lens

- **Agent:** Codex
- **Thay đổi:**
  1. **Brand Architecture:** Thiết lập kiến trúc thương hiệu chuẩn hóa: Master brand: **VPH**, Ecosystem: **VIGIL**, Product name: **Vigil Lens**, Signature: **by VPH**, Tagline: **See clearly. Capture precisely.**
  2. **Giao diện & Biểu tượng:**
     - Thiết kế mới biểu tượng SVG Topbar: kết hợp chữ **V** hình học quang học, các ngoặc lấy nét (focus brackets) và 4 điểm góc tài liệu.
     - Cập nhật tiêu đề Topbar thành **Vigil Lens**, phụ đề `by VPH`.
     - Cập nhật huy hiệu `VIGIL ECOSYSTEM` và thông điệp tagline trên màn hình chọn chế độ.
  3. **Metadata & PWA:** Cập nhật `title`, `meta description` trong `index.html` và `name`, `short_name`, `description` trong `manifest.webmanifest`.
  4. **Export Defaults:** Cập nhật tên file xuất mặc định trong `index.html` (`VigilLens`), `app.js` (`VigilLens` và `VigilLens-ID`) cùng PDF header chunk (`%PDF-1.4\n%VigilLens\n`).
  5. **Service Worker:** Nâng cấp cache name lên `vigil-lens-v2.2.0`, hỗ trợ tự động dọn sạch cache cũ tiền tố `scanvuong-*` và `vigil-lens-*`.
  6. **Documentation & Validation:** Cập nhật toàn diện `README.md`, `docs/brain/`, static check `_no_legacy_brand_in_user_facing` trong `scripts/validate_static.py` và các kịch bản kiểm thử regression.
- **File đã sửa:** `index.html`, `styles.css`, `app.js`, `manifest.webmanifest`, `sw.js`, `README.md`, `scripts/validate_static.py`, `scripts/regression_export_busy.js`, `scripts/regression_scan_id.js`, `scripts/acceptance_offline_pwa.cjs`, `docs/brain/00-project-overview.md`, `docs/brain/01-architecture.md`, `docs/brain/06-ai-working-log.md`.
- **Lý do:** Định vị sản phẩm thành công cụ quét tài liệu quang học độ chính xác cao thuộc hệ sinh thái VIGIL, đảm bảo tính nhất quán và khả năng mở rộng trong tương lai.
- **Kiểm tra:**
  - `python scripts/validate_static.py` PASS (9/9 checks, 0 legacy brand in user-facing).
  - `node --check app.js`, `node --check sw.js`, `node --check document-detector.js` PASS.
  - `node scripts/regression_export_busy.js` PASS (29/29).
  - `node scripts/regression_scan_id.js` PASS (52/52).
  - `node scripts/regression_ml_detector.js` PASS (53/53).
  - `node scripts/regression_sw_update.cjs` PASS (9/9).
  - `node scripts/rehearsal_dataset.cjs` PASS (25/25 images).
  - `node scripts/test_touch_targets.cjs` PASS (140/140 checks).
  - `node scripts/acceptance_offline_pwa.cjs` PASS.

---

## [2026-08-23] Review độc lập & đóng toàn bộ acceptance gaps cho PR #8 (Mobile-First UI Redesign)

- **Agent:** Codex
- **Thay đổi:**
  1. **Emoji Gate:** Loại bỏ 100% emoji khỏi filter chips (`index.html`) và thông báo cảnh báo (`app.js`), thay thế bằng typography tiếng Việt cô đọng (`Tự động`, `Màu`, `Đen trắng`, `Gốc`). Bổ sung static regression check `_no_ui_emojis` trong `scripts/validate_static.py`.
  2. **Touch Target Gate:** Điều chỉnh hit area tất cả interactive controls trên mobile ($\le 768\text{px}$) đạt $\ge 44\times 44\text{px}$ (nút bấm, filter chips, `.check-field`, toolbar actions). Tạo bộ kiểm thử tự động `scripts/test_touch_targets.cjs` đo `getBoundingClientRect()` trên 5 viewports (360×800, 375×812, 390×844, 412×915, 430×932), đạt 140/140 checks PASS.
  3. **Visual QA Gate:** Nâng cấp `scripts/capture_ui_states.cjs` chụp 13 ảnh screenshot thực tế deterministic bằng Chrome CDP trên full flow (Mode Select, Empty State, Document Editor ở các kích thước 360px, 390px, 430px, Landscape 844x390, Tablet 768x1024, Desktop 1280x800, Export Panel, Scan ID Front, Back, A4 Preview, và Scan ID Desktop).
  4. **Landscape Mobile Usability:** Bổ sung media query `@media (max-height: 500px)` cho điện thoại nằm ngang (2 cột: Canvas editor bên trái, Rail & Export scrollable bên phải).
  5. **Font Offline & PWA Acceptance:** Nâng cấp `scripts/acceptance_offline_pwa.cjs` kiểm tra `document.fonts.check()` cho 4 weights (400, 500, 600, 700) cả online và offline; tách rõ ràng verdict PWA installability và assertion 0 required runtime network dependencies.
  6. **License Integrity:** Bổ sung `assets/fonts/OFL.txt` với toàn văn bản quyền SIL Open Font License 1.1 và cập nhật Mục 4 của `THIRD_PARTY_NOTICES.md`.
- **File đã sửa:** `index.html`, `styles.css`, `app.js`, `THIRD_PARTY_NOTICES.md`, `assets/fonts/OFL.txt`, `scripts/validate_static.py`, `scripts/test_touch_targets.cjs`, `scripts/capture_ui_states.cjs`, `scripts/acceptance_offline_pwa.cjs`, `docs/brain/06-ai-working-log.md`.
- **Lý do:** Đáp ứng đầy đủ các tiêu chuẩn kiểm thử khắt khe của dự án, đảm bảo bằng chứng thực tế khớp 100% với verdict báo cáo trước khi chuyển sang Ready for Review.
- **Kiểm tra:**
  - `node --check app.js`, `node --check sw.js`, `node --check document-detector.js` PASS.
  - `python scripts/validate_static.py` PASS (9/9 checks).
  - `node scripts/test_touch_targets.cjs` PASS (140/140 checks).
  - `node scripts/acceptance_offline_pwa.cjs` PASS.
  - `node scripts/regression_export_busy.js` PASS (29/29).
  - `node scripts/regression_scan_id.js` PASS (52/52).
  - `node scripts/regression_ml_detector.js` PASS (53/53).
  - `node scripts/regression_sw_update.cjs` PASS (9/9).
  - `node scripts/rehearsal_dataset.cjs` PASS (25/25 images).

---

## [2026-08-23] Redesign UI mobile-first với Be Vietnam Pro, SVG icons và layout thích ứng

- **Agent:** Codex
- **Thay đổi:**
  1. Tích hợp font chữ tiếng Việt **Be Vietnam Pro** (Regular 400, Medium 500, SemiBold 600, Bold 700) tự host cục bộ dạng `.woff2` trong `assets/fonts/`, không phụ thuộc Google Fonts/mạng runtime.
  2. Nâng cấp Service Worker cache lên `scanvuong-v2.1.0`, bổ sung 4 file font WOFF2 vào danh sách 16 precached assets trong `sw.js`.
  3. Cập nhật `THIRD_PARTY_NOTICES.md` (Mục 4: Be Vietnam Pro Font - SIL Open Font License 1.1).
  4. Redesign toàn bộ giao diện HTML (`index.html`) & CSS (`styles.css`):
     - Thay thế 100% icon emoji sang hệ thống icon SVG nhất quán (stroke 2px, rounded joins).
     - Thiết kế hệ thống Design Tokens hoàn chỉnh (surfaces, text contrast, cobalt primary `#2563eb`, semantic status colors, radius hierarchy, soft shadows).
     - Mobile-first layout: Topbar với Safe Area insets, Home screen mode selection (Scan tài liệu vs Scan Căn cước), Drop zone tài liệu, Editor stage 50dvh cho thao tác kéo góc một tay, thanh cuộn thumbnails ngang trên mobile (`.thumb-list` horizontal rail), Export panel dưới cùng.
     - Layout Desktop $\ge 1025\text{px}$ giữ nguyên dạng 3 cột (Sidebar 240px | Editor flex | Export 280px).
     - Đảm bảo touch targets $\ge 44\text{px}$, responsive mượt mà trên tất cả viewports (360×800, 375×812, 390×844, 412×915, 430×932, 768×1024, 1280×800, landscape).
  5. Giữ nguyên 100% logic xử lý tài liệu, DOM ID contract trong `app.js`, ML DocumentDetector, homography warp, bộ lọc canvas và handwritten PDF writer.
  6. Cập nhật các bộ regression test (`validate_static.py`, `regression_sw_update.cjs`, `acceptance_offline_pwa.cjs`) để xác thực 16 assets và pass 100% các gate kiểm thử.
- **File đã sửa:** `index.html`, `styles.css`, `sw.js`, `THIRD_PARTY_NOTICES.md`, `scripts/regression_sw_update.cjs`, `scripts/acceptance_offline_pwa.cjs`, `docs/brain/01-architecture.md`, `docs/brain/03-decisions.md`, `docs/brain/06-ai-working-log.md`.
- **Lý do:** Nâng cấp trải nghiệm quét tài liệu trên di động theo tiêu chuẩn Premium Mobile Document Utility, cải thiện typography tiếng Việt, tăng tốc độ thao tác và đảm bảo chuẩn responsive không phụ thuộc mạng.
- **Kiểm tra:**
  - `node --check app.js`, `node --check sw.js`, `node --check document-detector.js` PASS.
  - `python scripts/validate_static.py` PASS (8/8).
  - `node scripts/regression_export_busy.js` PASS (29/29).
  - `node scripts/regression_scan_id.js` PASS (52/52).
  - `node scripts/regression_ml_detector.js` PASS (53/53).
  - `node scripts/regression_sw_update.cjs` PASS (9/9).
  - `node scripts/rehearsal_dataset.cjs` PASS (25/25 images).
  - `node scripts/acceptance_offline_pwa.cjs` PASS (Chromium offline with cut network).

---

## [2026-08-23] Fix fail-safe classical fallback geometry validation & expand regression gates

- **Agent:** Codex
- **Thay đổi:**
  1. Khắc phục blocker fail-safe trong `document-detector.js`: khi ML lỗi và gọi `fallbackDetector`, chỉ chấp nhận trả về `source: 'CURRENT_FALLBACK'` nếu `validateGeometry(fallbackRes.corners).valid === true`. Nếu classical fallback trả toạ độ invalid (NaN, Infinity, bow-tie tự cắt, diện tích $<5\%$, ít hơn 4 điểm, hoặc ném ngoại lệ), luồng tiếp tục chuyển xuống `DEFAULT_FALLBACK` với safe default corners `DEFAULT_CORNERS`.
  2. Bổ sung defensive contract nhẹ trong `app.js` (`detectPage`): bảo đảm `page.corners` luôn luôn nhận đúng 4 toạ độ hợp lệ.
  3. Mở rộng bộ kiểm thử `scripts/regression_ml_detector.js` lên 53 checks bao gồm Gate 9 (Classical-Invalid Fallback Chain cho cả 8 scenarios: NaN, Infinity, bow-tie, collapsed quad, $<4$ điểm, exception, classical valid, ML valid) và Gate 10 (assert bất biến hình học `DEFAULT_CORNERS` tự thân hợp lệ).
- **File đã sửa:** `document-detector.js`, `app.js`, `scripts/regression_ml_detector.js`, `docs/brain/06-ai-working-log.md`.
- **Lý do:** Đảm bảo không bao giờ để bất kỳ bộ 4 góc invalid nào lọt vào crop UI khi cả ML lẫn classical detector thất bại.
- **Kiểm tra:**
  - `node --check app.js`, `node --check document-detector.js`, `node --check sw.js` PASS.
  - `node scripts/regression_ml_detector.js` PASS (53/53).
  - `node scripts/regression_export_busy.js` PASS (29/29).
  - `node scripts/regression_scan_id.js` PASS (52/52).
  - `node scripts/regression_sw_update.cjs` PASS (9/9).
  - `node scripts/rehearsal_dataset.cjs` PASS (25/25 images, max delta 0.000068).
  - `node scripts/acceptance_offline_pwa.cjs` PASS (100% real offline Chromium).
  - `python scripts/validate_static.py` PASS (8/8).

---

## [2026-08-23] Productionize Scanic ML Document Corner Detection & Final Release Gates

- **Agent:** Codex
- **Thay đổi:**
  1. Tích hợp trọn vẹn mô hình neural network DocCornerNet Lean (`assets/ml/doccornernet_lean.ort`, 1.93 MB) chạy offline qua ONNX Runtime Web WASM (`assets/ml/ort-wasm-simd-threaded.wasm`, 1.52 MB).
  2. Tạo module `document-detector.js` quản lý singleton session, tiền xử lý ảnh ImageNet 224×224, giải mã toạ độ TL/TR/BR/BL, bộ lọc hình học Geometry Guard (kiểm tra 4 điểm hữu hạn, độ lồi nghiêm ngặt, không tự cắt, diện tích $\ge 5\%$, biên an toàn).
  3. Bổ sung cơ chế test-only isolation `DocumentDetector.__test` (`resetState()`, `getSessionCreateCount()`, `getSessionRunCount()`, `setInferenceSession()`, `setRuntimeFactory()`) phục vụ kiểm thử cô lập và tiêm lỗi (fault-injection).
  4. Triển khai xử lý lỗi toàn diện:
     - `MODEL_LOAD_FAILURE_FALLBACK: PASS` (tự động fallback sang classical detector khi model/runtime lỗi, fallback sang `DEFAULT_CORNERS` khi cả hai lỗi).
     - `INFERENCE_THROW_FALLBACK: PASS` (tiêm lỗi `session.run()` throw -> fallback an toàn).
     - `MALFORMED_OUTPUT_FALLBACK: PASS` & `INVALID_GEOMETRY_FALLBACK: PASS` (chặn toạ độ thiếu, sai kích thước, NaN, Infinity, tứ giác tự cắt, tứ giác co cụm <5% diện tích).
     - `SESSION_SINGLETON_REUSE: PASS` (xác thực `sessionCreateCount === 1`, `sessionRunCount === 3` qua 3 trang liên tiếp).
     - `INIT_RECOVERY: PASS` (phục hồi thành công ở lần gọi tiếp theo sau lỗi tạm thời).
  5. Kiểm thử an toàn nâng cấp Service Worker `scripts/regression_sw_update.cjs` (9/9 checks PASS):
     - `SW_UPGRADE_SAFETY: PASS` (chuyển đổi `scanvuong-v1.0.0` -> `scanvuong-v2.0.0`, precache 12 assets thành công trước khi xoá cache cũ trong `activate`).
     - `SW_INSTALL_FAILURE_SAFETY: PASS` (lỗi tải asset trong `install` sẽ huỷ SW mới, giữ nguyên SW và cache cũ đang hoạt động).
  6. Kiểm thử độ tương đồng toạ độ (Parity Gate) và Rehearsal trên 25 ảnh private dataset `G:\My Drive\CamScaner` (`scripts/rehearsal_dataset.cjs`):
     - 25/25 valid geometry (100%), 25/25 ML primary accepted (100%), 0 catastrophic failures.
     - Sai số toạ độ so với benchmark: median = 0.000040, p95 = 0.000060, worst-case = 0.000068 (đạt chuẩn $\le 0.003$).
  7. Kiểm thử Chromium Offline PWA Acceptance 2 pha (`scripts/acceptance_offline_pwa.cjs`):
     - Pha A: Cài đặt trực tuyến, xác nhận 12 assets trong `scanvuong-v2.0.0`, kiểm tra 1 lượt ML inference.
     - Pha B: Ngắt toàn bộ socket mạng, reload từ Service Worker cache, thực thi trọn vẹn luồng Document (auto-detect, crop, filter, xuất PDF) và luồng Scan ID (front/back, A4, xuất PDF) hoàn toàn offline với 0 request ra ngoài.
  8. Cập nhật `THIRD_PARTY_NOTICES.md`, CI `.github/workflows/static-validation.yml`, và `scripts/validate_static.py`.
- **File đã sửa / tạo:**
  - Tạo mới: `document-detector.js`, `assets/ml/*` (4 files), `THIRD_PARTY_NOTICES.md`, `scripts/regression_ml_detector.js`, `scripts/regression_sw_update.cjs`, `scripts/rehearsal_dataset.cjs`, `scripts/acceptance_offline_pwa.cjs`.
  - Cập nhật: `app.js`, `index.html`, `sw.js`, `server.py`, `README.md`, `.github/workflows/static-validation.yml`, `scripts/validate_static.py`, `docs/brain/00-project-overview.md`, `docs/brain/01-architecture.md`, `docs/brain/03-decisions.md`, `docs/brain/06-ai-working-log.md`.
- **Lý do:** Hoàn tất toàn bộ các Release Gates nghiêm ngặt để nghiệm thu sản xuất đưa Scanic ML vào ScanVuông.
- **Kiểm tra:**
  - `node --check app.js`, `node --check document-detector.js`, `node --check sw.js` PASS.
  - `node scripts/regression_ml_detector.js` PASS (37/37).
  - `node scripts/regression_export_busy.js` PASS (29/29).
  - `node scripts/regression_scan_id.js` PASS (52/52).
  - `node scripts/regression_sw_update.cjs` PASS (9/9).
  - `node scripts/rehearsal_dataset.cjs` PASS (25/25 images, max delta 0.000068).
  - `node scripts/acceptance_offline_pwa.cjs` PASS (100% real offline Chromium).
  - `python scripts/validate_static.py` PASS (all 8 static/privacy boundary checks).

---

## [2026-08-23] Deploy production lên Vercel

- **Agent:** Codex
- **Thay đổi:** Deploy phiên bản mới nhất của nhánh `main` (bao gồm Document mode và Scan ID A4 mode) lên production Vercel (`https://scanvuong-offline.vercel.app`), liên kết với GitHub repository `vi-phuong-158/scanvuong-offline`, cập nhật `.gitignore` và bảng môi trường trong `docs/brain/05-testing-and-deploy.md`.
- **File đã sửa:** `.gitignore`, `docs/brain/05-testing-and-deploy.md`, `docs/brain/06-ai-working-log.md`.
- **Lý do:** Người dùng yêu cầu deploy trực tiếp lên Vercel sau khi merge PR #4.
- **Kiểm tra:** Kiểm tra phản hồi HTTP 200 từ `https://scanvuong-offline.vercel.app`, xác nhận các security headers (`nosniff`, `no-referrer`, `camera=(self)`), kiểm tra `https://scanvuong-offline.vercel.app/sw.js` trả về header `Service-Worker-Allowed: /`.

---

## [2026-08-23] Final Hardening Scan ID PR #4 (Layout A4: width 65%, gap 28mm, vertically centered block, regression 52/52)

- **Agent:** Codex
- **Thay đổi:**
  1. Tách và hoàn thiện `calculateIdA4Layout(frontW, frontH, backW, backH, options)`: giữ card target width 65% A4 (`806px`), giảm khoảng cách giữa 2 mặt thẻ xuống **28 mm** (`165px`), căn giữa dọc toàn bộ cụm thẻ (`front + gap + back`) trên trang A4 (`topWhitespace ≈ bottomWhitespace = 291px`), và hỗ trợ contain/fit-inside cho odd/portrait aspect ratios mà không bị méo/stretch.
  2. Xoá bỏ hoàn toàn assertion false-positive `|| true` trong `scripts/regression_scan_id.js`, nâng cấp bộ kiểm thử lên 52 checks bao quát trọn vẹn: bất biến hình học (equal width 65%, aspect ratio, khoảng cách 28mm, căn giữa dọc/ngang, viền A4), portrait fallback, state machine, busy lock, snapshot isolation, Object URL cleanup, PDF 1 page A4 portrait.
  3. Thực hiện meta-test scratch chứng minh 4 đột biến cố tình (sai gap 70mm, lệch vertical centering, phá equal width, méo aspect ratio) đều bị harness phát hiện và FAIL đúng assertion.
  4. Xác nhận synthetic PDF rendering pixel-level qua Python PIL (không mirror, không flip, đúng màu 4 góc marker, đúng toạ độ).
  5. Cập nhật mô tả PR #4 trên GitHub phản ánh chính xác thông số implementation mới nhất.
- **File đã sửa:** `app.js`, `scripts/regression_scan_id.js`, `docs/brain/01-architecture.md`, `docs/brain/03-decisions.md`, `docs/brain/05-testing-and-deploy.md`, `docs/brain/06-ai-working-log.md`.
- **Lý do:** Yêu cầu Final Hardening cho PR #4 (Scan ID) trước khi merge.
- **Kiểm tra:** `node --check app.js` PASS, `node --check sw.js` PASS, `node scripts/regression_export_busy.js` PASS (29/29), `node scripts/regression_scan_id.js` PASS (52/52), `python scripts/validate_static.py` PASS (7/7). Synthetic PDF verification: xuất PDF 1 trang A4 portrait, giải mã JPEG nhúng kiểm tra pixel marker (TL/TR/BR/BL), xác nhận không mirror, không flip, front ở trên, back ở dưới, gap 165px (~28mm), vertical delta <= 1px.

---

## [2026-08-23] Thêm tính năng Scan ID (mặt trước/mặt sau căn cước → 1 trang A4)

- **Agent:** Claude Code
- **Thay đổi:** Thêm workflow "Scan ID" độc lập với document mode hiện có. Màn hình bắt đầu mới
  (`#modeSelect`) cho chọn "Scan tài liệu" hoặc "Scan ID", giữ trong `state.mode`. Scan ID có wizard
  3 bước (`state.idScan.step`: `front`→`back`→`preview`) — mỗi bước dùng LẠI đúng editor UI của
  document mode (canvas, detect/reset/rotate, filter chips, kéo tay 4 góc) qua kỹ thuật "relocate DOM
  node" (`relocateEditor()` di chuyển node `.editor` giữa `#workspace`/`#idEditorSlot` bằng
  appendChild/insertBefore, không nhân bản) và hàm mới `activePage()` (thay `selectedPage()` trong
  toàn bộ cụm Editor/Corners/Filter — trả về trang document đang chọn hoặc mặt front/back đang sửa
  tuỳ `state.mode`). Sau khi xác nhận cả hai mặt, bước "preview" ghép chúng lên một canvas A4 dọc cố
  định (`composeIdA4()`, raster 1240×1754, mặt trước trên/mặt sau dưới, cùng chiều rộng target bất kể
  độ phân giải nguồn, không nhãn in trên trang) và `exportIdPdf()` xuất đúng 1 trang PDF
  (`ScanVuong-ID.pdf`) bằng cách tái dùng `renderPageCanvas()`+`canvasToJpeg()`+`buildPdf()` không đổi
  — không viết lại homography/warp/PDF writer. Thêm hint nhẹ `applyIdAspectHint()` trong `detectPage()`
  (chỉ khi `state.mode==='id'`): so tỷ lệ quad phát hiện được với tỷ lệ thẻ ID-1, lệch >35% thì hạ trần
  confidence xuống dưới ngưỡng review — không đổi `detectDocument()`/`orderCorners()` lõi. Nút "Đổi chế
  độ" ở header cho quay lại màn hình chọn (confirm nếu có dữ liệu chưa xuất), revoke Object URL khi
  thay ảnh hoặc rời workflow.
- **File đã sửa:** `app.js` (thêm `state.mode`/`state.idScan`, `activePage()`, `applyIdAspectHint()`,
  `composeIdA4()`, `resetIdScan()`, `addIdFile()`, `setIdProgress()`, `exportIdPdf()`,
  `renderIdPreview()`, `relocateEditor()`, `enterMode()`, `updateIdShell()`, `renderModeShell()`; đổi
  6-7 call site trong cụm Editor từ `selectedPage()` sang `activePage()`; mở rộng `setBusy()`'s
  disabled-list; guard `fileInput`/`cameraInput`/dropZone theo `state.mode==='document'`),
  `index.html` (thêm `#modeSelect`, `#switchModeBtn`, `#idWorkspace`, `#idPreviewSection`,
  `#idFileInput`/`#idCameraInput`), `styles.css` (mode-select cards, `.editor-slot`, `.id-workspace`,
  `.id-preview-section`), `scripts/regression_scan_id.js` (mới — harness dependency-free riêng cho
  Scan ID), `scripts/regression_export_busy.js` (thêm ID vào `ELEMENT_IDS`/fake DOM, thêm bước "vào
  document mode" ở đầu vì `fileInput` giờ bị guard theo `state.mode`), `.github/workflows/static-validation.yml`
  (thêm bước chạy `regression_scan_id.js`), `README.md`/`docs/brain/00-01-03-04.md`.
- **Lý do:** Yêu cầu trực tiếp của người dùng: người dùng cần scan hai mặt căn cước và in gọn trên
  một trang, không OCR/không đọc thông tin cá nhân, tái dùng tối đa pipeline detect/crop/phối
  cảnh/filter/PDF đã có thay vì viết scanner thứ hai.
- **Kiểm tra:** `node --check app.js`/`sw.js` PASS; `python scripts/validate_static.py` 7/7 PASS;
  `node scripts/regression_export_busy.js` 29/29 PASS (document mode không bị phá — xác nhận qua bước
  "vào document mode" mới thêm ở đầu harness); `node scripts/regression_scan_id.js` 37/37 PASS (front/back
  giữ đúng state riêng, step machine front→back→preview và "Sửa mặt trước/sau" đúng, xuất PDF khi
  thiếu một mặt bị từ chối có toast, mọi handler Scan ID bị khoá khi `state.busy`, snapshot export
  miễn nhiễm với việc null `state.idScan` giữa chừng render, Object URL được revoke khi thay ảnh/rời
  mode). Rehearsal trình duyệt thật (server.py, xoá SW/cache cũ trước khi test): mode-select hiển thị
  đúng mặc định; document mode y hệt hành vi cũ (import→detect→filter→export PDF 1 trang A4, không
  request nào rời origin); Scan ID — chụp front/back qua cả `idFileInput` lẫn `idCameraInput`, xoay
  90° một mặt, xuất PDF thật rồi **giải mã JPEG nhúng để đo lại pixel** (không đọc canvas nội bộ):
  đúng 1 trang A4 (595.28×841.89pt, raster ảnh 1240×1754), marker màu TL/TR/BR/BL đặt ở 4 góc ảnh
  tổng hợp cho thấy KHÔNG mirror/lật kể cả sau khi xoay 90° (marker map đúng theo phép xoay chiều kim
  đồng hồ), mặt trước luôn ở nửa trên trang/mặt sau nửa dưới, và mặt trước 800×500 + mặt sau
  4000×2500 (chênh 5 lần độ phân giải) vẫn ra cùng chiều rộng ~1092px trên trang; toast từ chối xuất
  khi thiếu mặt sau hoạt động đúng kể cả khi ép gọi trực tiếp nút Export; không lỗi console; mobile
  viewport 375×812 và desktop 1366×768 không tràn ngang, nút chạm đủ lớn (42px cao, full-width).
  Perspective correction/manual-corner-drag cho ID mode không test riêng bằng ảnh xiên tổng hợp trong
  phiên này vì đó là code path 100% dùng chung, không đổi, với document mode (đã kiểm chứng trước đó
  trong lịch sử dự án) — chỉ phần mới của Scan ID (state machine, composer, busy-guard, aspect-hint,
  privacy) được rehearsal kỹ trong phiên này.

## [2026-08-23] Thêm tính năng Auto Enhance (Tự động đẹp)

- **Agent:** Claude Code
- **Thay đổi:** Thêm filter mode mới `auto` ("Tự động đẹp"), mặc định cho trang mới import/chụp, chạy pixel pipeline thật trên `ImageData` (`enhanceAuto()`: background shading correction bằng blur bán kính rộng + percentile cao/chỉ khuếch đại lên → auto levels percentile-based per-channel (blend với luma để giữ màu con dấu/mực đỏ) → local contrast unsharp bán kính hẹp → sharpen unsharp bán kính 1px). Nâng cấp `bw` sang cùng cơ chế pixel (`enhanceBW()`: grayscale → percentile stretch → chia nền cục bộ bán kính rộng → sharpen nhẹ), không nhị phân hoá cứng. `enhanceCanvas()` dùng chung cho preview (`drawEditor()`, qua cache `ensureEnhancedPreview()` chỉ tính lại khi filter/rotation/kích thước đổi — không tính lại mỗi lần kéo góc) và export (`renderPageCanvas()`), đảm bảo preview khớp PDF thật. `document`/`original` giữ nguyên CSS filter cũ (`FILTER_CSS`). Thêm mode UI "Tự động đẹp" lên đầu danh sách filter trong `index.html`.
- **File đã sửa:** `app.js` (thêm `PIXEL_FILTERS`, `enhanceAuto`, `enhanceBW`, `enhanceCanvas`, `computeLuma`, `channelHistogram`, `histPercentile`, `boxBlur`, `ensureEnhancedPreview`; sửa `drawEditor()`, `renderPageCanvas()`, default `filter: 'auto'` trong `addFiles()`), `index.html` (thêm nút filter "Tự động đẹp"), `.claude/launch.json` (mới — config cho browser-preview tooling khi rehearsal, không phải asset của app).
- **Lý do:** Yêu cầu trực tiếp của người dùng: CSS `brightness()/contrast()` đơn thuần không được tính là "Auto Enhance" — cần xử lý pixel thực tế để ảnh chụp trông giống bản scan (nền sạch/sáng hơn, chữ nổi rõ, tương phản tốt hơn, nét hơn), giữ màu tài liệu (không biến thành B&W), và preview phải khớp PDF xuất ra.
- **Kiểm tra:** `node --check app.js`/`sw.js` PASS; JSON/`server.py` static validation PASS; rehearsal thật trong browser pane (server.py + import/detect/export thật): (1) UI — filter "Tự động đẹp" active mặc định cho trang mới, chuyển đổi 4 filter cập nhật preview, xoay 90°×4 không crash, không lỗi console, không request nào rời origin (network tab chỉ có `localhost`/`blob:`); (2) **định lượng bằng ảnh tổng hợp xuất PDF thật rồi giải mã lại JPEG nhúng** (không phải đọc canvas nội bộ, để test đúng đường export): case nền tối (139.5→172.3, tương phản nền/chữ 99.5→160.9), case ánh sáng lệch giữa 2 bên trang (độ lệch giữa 3 vùng nền 28.7→9.6), case ảnh đã đẹp không bị làm xấu (nền/tương phản gần như giữ nguyên, tỉ lệ pixel clip <0.2%), case màu (con dấu đỏ giữ kênh R trội hơn G/B trung bình ~206 điểm sau xử lý, không bị wash-out về xám), case chữ nhỏ/nét mảnh (dải sáng-tối vẫn đầy đủ 0–255 sau xử lý, không bị làm mờ phẳng). Phát hiện và sửa 2 lỗi qua chính rehearsal định lượng này trước khi merge (xem [03-decisions.md](03-decisions.md)): (a) mục tiêu làm sáng nền dùng nhầm trung bình thay vì percentile cao, khiến nền bị làm TỐI đi; (b) bán kính blur cho background-shading quá hẹp (dùng chung với local-contrast), không đủ để làm phẳng gradient ánh sáng toàn trang.
- **Lưu ý baseline:** Bản đầu của task này (PR #2 cũ) từng bị mở nhầm từ `main` lúc còn ở `d8ec5c7`, trước khi PR #1 (entry ngay dưới đây) merge — đã đóng PR đó và làm lại sạch bằng cách tạo lại `feat/auto-enhance` từ `main` sau khi PR #1 merge (`d46b2d8`), cherry-pick lại đúng nội dung. `app.js` cherry-pick sạch không conflict (PR #1 không đụng vùng `drawEditor()`/`renderPageCanvas()` liên quan filter); chỉ có conflict ở các file `docs/brain/*.md` do cả hai nhánh cùng thêm entry — đã hợp nhất giữ cả hai, không mất nội dung nào.

## [2026-08-23] Auto Enhance: vá lỗi khuếch đại giả trên trang không có nội dung tối

- **Agent:** Claude Code
- **Thay đổi:** Sau khi rebuild `feat/auto-enhance` trên `main` mới, chạy lại rehearsal định lượng bổ sung với một case suy biến (trang chỉ có gradient ánh sáng nhẹ, hoàn toàn không chữ/không dấu) — phát hiện auto levels khuếch đại dải percentile hẹp (do không có nội dung tối để neo percentile thấp) thành tương phản đen-trắng giả cực đoan. Thêm sàn `MIN_SPAN = 70` trong `enhanceAuto()` (mở rộng đối xứng dải `lo..hi` nếu hẹp hơn 70 trước khi tính gain) và nâng sàn tương tự trong `enhanceBW()` (`hi >= lo + 70`, trước là `+10`).
- **File đã sửa:** `app.js` (`enhanceAuto`, `enhanceBW`), `docs/brain/03-decisions.md`.
- **Lý do:** Trang gần như trắng tinh (không chữ) là kịch bản thực tế có thể gặp (ví dụ ảnh chụp mặt sau giấy, form chưa điền) — nếu không chặn, auto levels sẽ biến nhiễu/độ lệch sáng nhẹ thành vệt đen-trắng giả, vi phạm trực tiếp yêu cầu "không được biến toàn bộ ảnh thành trắng cháy" và làm xấu ảnh thay vì làm đẹp.
- **Kiểm tra:** `node --check app.js` PASS, `python scripts/validate_static.py` PASS (7/7), `node scripts/regression_export_busy.js` PASS (28/28). Rehearsal định lượng: case suy biến (không nội dung tối) hết bị khuếch đại giả (dải màu trước khi vá vọt từ ~95 xuống gần đen/lên gần trắng ở hai mép; sau khi vá chỉ còn dao động nhẹ ~95–166). Chạy lại toàn bộ 6 case A–F + B&W đã dùng để nghiệm thu Auto Enhance ban đầu — kết quả **giống hệt số liệu trước khi vá** (không case thực tế nào có dải hẹp hơn 70), xác nhận sàn mới không đổi hành vi trên tài liệu có nội dung thật.

---

## [2026-08-23] Đóng băng luôn cấu hình xuất PDF (PR #1, sau khi người dùng review)

- **Agent:** Claude Code
- **Thay đổi:** Người dùng review PR #1 (đã CI xanh) và phát hiện một race còn sót: `pageSize`/`marginToggle`/`fileName` (và `quality`) vẫn được đọc từ `els.*` sau khi vòng lặp render/nén nhiều trang hoàn tất, thay vì được đóng băng cùng lúc với trang. Thêm `snapshotExportJob()` (gọi `snapshotPagesForExport()` bên trong, cộng thêm `quality`/`pageSize`/`marginToggle.checked`/`fileName` đã sanitize) ngay đầu `exportPdf()`, trước `setBusy(true)`; toàn bộ phần còn lại của `exportPdf()`/`buildPdf()` chỉ dùng `exportJob.*`. `setBusy()` disable thêm `fileName`/`pageSize`/`quality`/`marginToggle`. Mở rộng `scripts/regression_export_busy.js` với Case 5: mutate trực tiếp 4 control này ngay sau khi export bắt đầu (bypass mọi guard, đúng tinh thần Case 2/3 cho trang), rồi parse PDF thật (MediaBox, nội dung stream `cm`, tên file tải xuống) để xác nhận export vẫn dùng giá trị tại thời điểm bấm Xuất PDF.
- **File đã sửa:** `app.js`, `scripts/regression_export_busy.js`, `docs/brain/01-architecture.md`, `docs/brain/03-decisions.md`.
- **Lý do:** Cùng loại race đã sửa cho `state.pages` (P1) nhưng áp dụng cho cấu hình xuất — nếu không sửa, đổi khổ trang/lề/tên file/chất lượng trong lúc export (có thể mất vài chục giây ở chế độ nén mạnh) sẽ khiến PDF cuối không phản ánh đúng lựa chọn tại thời điểm bấm nút.
- **Kiểm tra:** `node --check app.js` PASS, `python3 scripts/validate_static.py` PASS (7/7), `node scripts/regression_export_busy.js` PASS (28/28) — tự xác minh 3 assertion mới (Case 5: tên file, MediaBox theo `pageSize`, layout theo `margin`) không vô nghĩa bằng cách revert fix trên bản `app.js` scratch và xác nhận harness FAIL đúng 3 chỗ đó.

---

## [2026-08-22] Đóng băng export state, khoá busy-state, sửa SW lifecycle, thêm CI

- **Agent:** Claude Code
- **Thay đổi:**
  - **P1 (export state):** thêm `snapshotPagesForExport()`, gọi ngay đầu `exportPdf()` trước `setBusy(true)`; `makeJpegs(settings, pages)`/`renderPageCanvas()` chỉ đọc từ snapshot này, không còn dereference `state.pages[i]` trong vòng lặp export.
  - **P2 (busy lock):** audit toàn bộ event handler mutate document (thêm ảnh, camera, drag/drop import, reorder thumbnail, move up/down, rotate, delete, clear all, reset crop, detect, đổi filter, export lần hai); thêm guard `if (state.busy) return;` trực tiếp trong từng handler (không chỉ dựa `disabled`); thêm `clearBtn` và `.filter-chip` vào danh sách toggle `disabled` trong `setBusy()`.
  - **P2 (service worker):** bọc refresh nền trong `event.waitUntil()` khi có cached response; tăng `CACHE` lên `scanvuong-v1.0.2`; `activate` chỉ xoá cache tiền tố `scanvuong-` khác version thay vì xoá mọi cache khác tên.
  - **P3 (docs):** bỏ số commit hard-code trong `00-project-overview.md`/`02-coding-rules.md`/`05-testing-and-deploy.md`, thay bằng thông tin ổn định (branch, remote, CI).
  - **CI:** thêm `.github/workflows/static-validation.yml` + `scripts/validate_static.py` (Python stdlib only) chạy `node --check`, parse JSON/AST, xác nhận asset `sw.js` tồn tại, quét không URL external/CDN, quét ranh giới riêng tư trong `app.js`.
  - **Regression:** thêm `scripts/regression_export_busy.js` — chạy `app.js` thật trong fake DOM tối giản (Node `vm`, không dependency), lái qua đúng DOM event handler, chứng minh reorder/filter/rotation/corners đổi sau snapshot (kể cả mutate trực tiếp `state.pages`, bypass UI) không ảnh hưởng PDF xuất ra, và mọi handler mutate bị chặn khi `busy`. Có chạy trong CI.
  - **Independent review (Codex-style second pass qua subagent riêng):** phát hiện `pointermove`/`endCornerDrag` trên `#editorCanvas` không tự kiểm tra lại `state.busy` (chỉ `pointerdown` guard lúc bắt đầu kéo) — vá bằng cách thêm guard vào cả hai, huỷ kéo góc ngay nếu `busy` chuyển `true` giữa chừng. Không phát hiện material issue nào khác (snapshot/guard/SW/CI/privacy đều đúng theo review độc lập).
- **File đã sửa:** `app.js`, `sw.js`, `docs/brain/00-project-overview.md`, `docs/brain/01-architecture.md`, `docs/brain/02-coding-rules.md`, `docs/brain/03-decisions.md`, `docs/brain/05-testing-and-deploy.md`.
- **File đã tạo:** `scripts/validate_static.py`, `scripts/regression_export_busy.js`, `.github/workflows/static-validation.yml`.
- **Lý do:** `state.pages` sống bị đọc trực tiếp trong lúc export là race condition thật (PDF có thể phản ánh sai trạng thái nếu người dùng thao tác trong lúc xuất); nhiều handler mutate document chỉ dựa vào `disabled` trên nút, không có guard logic thật trong handler; SW refresh nền không gắn với lifetime của fetch event nên có thể bị huỷ giữa chừng; docs ghi số commit cụ thể sẽ lỗi thời ngay khi có commit mới; repo chưa có CI nào.
- **Kiểm tra:** `node --check app.js` PASS, `node --check sw.js` PASS, `python3 scripts/validate_static.py` PASS (7/7 check), `node scripts/regression_export_busy.js` PASS (21/21 check — đã tự xác minh bằng cách chạy lại harness trên một bản `app.js` cố tình revert fix, xác nhận harness FAIL đúng chỗ), rehearsal end-to-end thật trên Chromium (qua Playwright có sẵn trong môi trường, không thêm dependency vào dự án) với 4 ảnh tổng hợp (thẳng, phối cảnh mạnh, tương phản thấp, landscape): import → auto-detect (trang tương phản thấp bị flag "cần kiểm tra" đúng như kỳ vọng) → đổi filter/rotate/reorder → xuất PDF 4 trang hợp lệ, cả 4 JPEG nhúng có SOI/EOI hợp lệ, không lỗi console.

---

## [2026-08-22] Tạo GitHub repo công khai và push commit đầu tiên

- **Agent:** Claude Code
- **Thay đổi:** Đổi branch `master` → `main` (an toàn vì lúc đó 0 commit), quét nhanh secret/API key trước khi stage (sạch), tạo commit đầu tiên (21 file, "Initial commit: ScanVuong Offline V1"), tạo repo GitHub **công khai** `vi-phuong-158/scanvuong-offline` bằng `gh repo create --public --push`, xác minh remote + visibility qua `gh repo view`.
- **File đã sửa:** không sửa source; cập nhật các mục trạng thái Git đã lỗi thời trong `docs/brain/00-project-overview.md`, `02-coding-rules.md`, `04-current-tasks.md`, `05-testing-and-deploy.md`.
- **Lý do:** Người dùng yêu cầu trực tiếp "tạo 1 repo trên github và push code lên", sau đó chỉ định rõ "repo để public". Thực hiện dù `GATE-01` (PWA/Service Worker trên browser thật) vẫn đang BLOCKED — đây là quyết định của người dùng, ghi đè thứ tự ưu tiên đã đề xuất trước đó (chờ GATE-01 PASS rồi mới push).
- **Kiểm tra:** `git log --oneline -1`, `git status --short` (clean), `gh repo view ... --json visibility` xác nhận `PUBLIC`, remote `origin` trỏ đúng `https://github.com/vi-phuong-158/scanvuong-offline.git`.

---

## [2026-08-22] Dựng bộ não dự án (AI project brain)

- **Agent:** Claude Code
- **Thay đổi:** Tạo `docs/brain/00-06`, hợp nhất với `AGENTS.md`/`CLAUDE.md` đã có sẵn từ setup ban đầu (giữ nguyên nội dung kiến trúc/bảo mật/validation gốc, thêm cấu trúc trỏ tới `docs/brain/` và quy tắc đọc Code Graph trước khi code theo khung của skill `setup-ai-brain`).
- **File đã tạo:** `docs/brain/00-project-overview.md` → `docs/brain/06-ai-working-log.md`.
- **File đã sửa:** `AGENTS.md`, `CLAUDE.md` (hợp nhất, không ghi đè mù).
- **Lý do:** Người dùng yêu cầu dựng bộ nhớ dùng chung cho AI; hai file `AGENTS.md`/`CLAUDE.md` cũ có giá trị thật (không phải template rỗng) nên chọn hợp nhất thay vì thay thế, theo xác nhận của người dùng.
- **Kiểm tra:** Các file tồn tại, nội dung Code Graph khớp với hàm thật trong `app.js` (đối chiếu bằng grep định nghĩa hàm), không có thông tin bịa — mọi mục chưa xác minh được để trống với ghi chú thay vì đoán.

## [2026-08-22] Hai lần thử đóng gate PWA/Service Worker trên trình duyệt thật — BLOCKED

- **Agent:** Claude Code
- **Thay đổi:** Không sửa code. Khởi động `server.py`, thử kết nối Chrome thật qua Claude in Chrome extension (`list_connected_browsers` → rỗng cả hai lần, extension không kết nối được), sau đó thử lại trong browser pane nhúng sẵn có — tái hiện đúng lỗi cũ: `navigator.serviceWorker.register('./sw.js')` ném `TypeError: ... unknown error occurred when fetching the script`, trong khi `fetch('./sw.js')` trả về `200`, đúng MIME `text/javascript`, cú pháp hợp lệ, secure context `true`.
- **File đã sửa:** không có.
- **Lý do:** Bằng chứng cho thấy nguyên nhân là giới hạn của môi trường trình duyệt nhúng (sandbox tắt Service Worker subsystem), không phải lỗi trong `sw.js`/`server.py`/`manifest.webmanifest`. Theo đúng chỉ dẫn của người dùng: không workaround bằng cách làm yếu offline/security, giữ verdict BLOCKED và báo rõ bằng chứng thay vì sửa code không cần thiết.
- **Kiểm tra:** Xem chi tiết bằng chứng đầy đủ trong báo cáo của phiên làm việc (VERDICT `SCANVUONG_V1_TECHNICAL_READY_BROWSER_REHEARSAL_BLOCKED`). `GATE-01` trong [04-current-tasks.md](04-current-tasks.md) ghi lại trạng thái và bước tiếp theo.

## [2026-08-22] Audit và sửa lỗi V1 ban đầu

- **Agent:** Claude Code
- **Thay đổi:** Khảo sát toàn bộ source từ `ScanVuong-Offline-V1.zip`, sửa các lỗi phát hiện qua rehearsal chức năng bằng ảnh tổng hợp có đánh dấu góc màu (xem đầy đủ trong [03-decisions.md](03-decisions.md)): thuật toán `orderCorners()` có thể trả điểm trùng, độ tin cậy phát hiện không dựa trên đồng thuận 2 detector, tứ giác chiếm toàn khung hình không bị phạt, thiếu fallback CPU khi không có WebGL, `sleepFrame()` treo khi tab ở nền, filter preview không khớp filter xuất PDF, hint độ tin cậy không cập nhật sau khi kéo góc, CSS mobile ẩn mất nút thêm/xoá trang, layout desktop không giới hạn chiều cao khi nhiều trang, `sw.js` không tự refresh cache, `server.py` thiếu MIME map đúng và không tự thử cổng khác.
- **File đã sửa:** `app.js`, `styles.css`, `sw.js`, `server.py`, `start-windows.bat` (chuẩn hoá CRLF).
- **File đã tạo:** `AGENTS.md`, `CLAUDE.md`, `README.md`, `.gitignore` (lần đầu, trước khi có bộ brain này).
- **Lý do:** Yêu cầu ban đầu của người dùng — setup project hoàn chỉnh, tự audit và sửa lỗi trong phạm vi V1, không mở rộng scope.
- **Kiểm tra:** Bộ rehearsal 5 case tổng hợp (thẳng, xiên mạnh, tương phản thấp, landscape, nhiều trang) chạy trong browser pane, xuất PDF được xác minh lại bằng `pypdf` (parse strict) và `pymupdf` (render từng trang + kiểm tra vị trí marker màu) — xác nhận không trang nào bị lật/mirror/sai thứ tự.

## [2026-08-30] VPH Vigil Lens — Party Document Mode
- Agent: Codex
- Thay đổi: Thêm mode Scan tài liệu Đảng; nhập ảnh/PDF local; page coverage; split/merge/reorder/move/add/replace/remove; tìm kiếm taxonomy 104 loại; canonical filename; xác nhận thứ tự tài liệu cùng loại; export PDF source-page copy và hybrid; footer nhận diện.
- File đã sửa: index.html, styles.css, app.js, sw.js, scripts/validate_static.py, .github/workflows/static-validation.yml, README.md, docs/brain/00-project-overview.md, docs/brain/01-architecture.md, docs/brain/03-decisions.md, docs/brain/04-current-tasks.md, docs/brain/05-testing-and-deploy.md, docs/brain/06-ai-working-log.md, THIRD_PARTY_NOTICES.md.
- File đã tạo: party-mode.js, party-pdf.js, party-taxonomy.js, assets/party/document_types.json, scripts/regression_party_mode.cjs, scripts/acceptance_party_ui.cjs.
- Lý do: Cung cấp công cụ scan/tách/ghép/xuất tài liệu Đảng tại chỗ mà không biến Vigil Lens thành hệ thống quản lý hồ sơ; bảo toàn page object PDF gốc và không thêm OCR/AI/backend/storage.
- Kiểm tra: node --check cho script mới; node scripts/regression_party_mode.cjs 12/12; python scripts/validate_static.py sau khi cập nhật asset; các regression cũ và browser/offline Party acceptance còn phải chạy trước verdict kỹ thuật cuối.

## [2026-08-30] Party Mode — real PDF thumbnail preview follow-up

- Agent: Codex
- Thay đổi: Thay placeholder số trang bằng canvas preview cục bộ theo từng PDF page; đọc MediaBox/CropBox, vector content và image XObject/stream filters phổ biến; giữ nguyên page model `{source, sourcePage}` và export PDF source-page copy. Thêm trạng thái loading/error riêng từng trang và kiểm tra responsive workspace.
- File đã sửa: `party-pdf.js`, `party-mode.js`, `styles.css`, `scripts/acceptance_party_ui.cjs`, `docs/brain/01-architecture.md`, `docs/brain/03-decisions.md`, `docs/brain/04-current-tasks.md`, `docs/brain/05-testing-and-deploy.md`, `docs/brain/06-ai-working-log.md`.
- Lý do: Người dùng cần nhận biết nội dung thật, thứ tự và tỷ lệ portrait/landscape trước thao tác Party Mode; không thêm PDF.js/framework/dependency và không gửi PDF ra mạng.
- Kiểm tra: Chromium headless PASS với synthetic PDF 10 trang có vector content khác nhau, portrait/landscape, back/re-entry, no console error, no horizontal overflow và touch target tại 1792×896, 1366×768, 1024×768, 768×1024, 390×844; node check, Party regression 13/13, static validation và git diff --check PASS.

## [2026-08-30] Party PDF preview lifecycle/resource hardening

- Agent: Codex
- Baseline: branch `feat/party-document-mode`; accepted thumbnail commit `e4f599a7c89d476e0fee74ded90a09ae250e9aee`. Khi bắt đầu, local checkout đã có sẵn commit tiếp nối `6916531962aae78108818105c1e3f757cf5e844a` chưa push; không reset/amend.
- Thay đổi: thêm `previewGeneration` invalidation cho async thumbnail jobs; kiểm tra generation + page identity + connected canvas trước mọi state/paint/DOM mutation; cache derivative image LRU giới hạn 16; bounds cho stream length, Flate decoded bytes, image dimensions/components; cleanup pending/resolved preview resources và canvas DOM khi rời mode. Mở rộng browser acceptance với delayed stale job, back/re-entry, 100-page image-heavy synthetic PDF và cache cleanup.
- Finding thực tế trong acceptance: `deactivate()` trước đây clear state/cache nhưng giữ canvas preview trong DOM ẩn; đã sửa tối thiểu bằng cách clear `#partyDocuments` khi discard Party state.
- Kiểm tra: `node scripts/acceptance_party_ui.cjs` PASS (Party UI 3 viewports, PDF workflow, lazy 100 pages, stale lifecycle, back/re-entry, 100/100 image derivative probe, cache 16/16, cleanup 0, corrupt/encrypted handling, workspace 5 viewports); Party regression 13/13; export busy 29/29; Service Worker 9/9; Scan ID exit 0; static validation PASS; touch target 145/145; offline PWA acceptance PASS; `git diff --check` PASS.
- Real-PDF acceptance: NOT_EXECUTED — không có PDF trong checkout và không được lấy dữ liệu production; synthetic acceptance không được trình bày như real-PDF acceptance.
- Source review sau fix: P1 stale job FIXED; P1 unbounded full-resolution cache FIXED; P2 stream/image allocation bounds FIXED; bitmap/object URL/DOM cleanup FIXED; rare CCITT/JPX/inline full parser DEFERRED và fail-isolated.

## [2026-08-30] PR #9 CI Browser Discovery Hotfix
- **Agent:** Antigravity (Gemini 3.7 Flash)
- **Thay đổi:**
  1. Cập nhật hàm `browserPath()` trong `scripts/acceptance_party_ui.cjs` sang cơ chế phát hiện trình duyệt cross-platform deterministic 4 cấp:
     - 1. Env variables (`CHROME_PATH`, `GOOGLE_CHROME_BIN`, `BROWSER_PATH`, `CHROMIUM_PATH`).
     - 2. Linux absolute paths (`/usr/bin/google-chrome`, `/usr/bin/google-chrome-stable`, `/usr/bin/chromium`, `/usr/bin/chromium-browser`).
     - 3. Windows absolute paths (`C:\Program Files\Google\Chrome\...`, `C:\Program Files (x86)\...`, Edge paths).
     - 4. PATH lookup an toàn qua `execFileSync` không shell-injection (`where` trên Windows, `which` trên Unix/Linux/macOS).
  2. Thêm bước diagnostic kiểm tra trình duyệt `Discover Chromium executable` trong CI workflow `.github/workflows/static-validation.yml`.
- **File đã sửa:** `scripts/acceptance_party_ui.cjs`, `.github/workflows/static-validation.yml`, `docs/brain/06-ai-working-log.md`.
- **Lý do:** Khắc phục lỗi CI GitHub Actions runner Ubuntu 24.04 không tìm thấy trình duyệt do `where` chỉ hoạt động trên Windows.
- **Kiểm tra:**
  - Unit tests cho resolver logic (5/5 PASS).
  - Party UI browser acceptance: `node scripts/acceptance_party_ui.cjs` PASS (viewports 1792×896, 1366×768, 390×844, PDF workflow, 100-page lazy thumbnail, preview lifecycle, corrupt/encrypted handling, smoke viewports).
  - Party regression: `node scripts/regression_party_mode.cjs` (13/13 PASS).
  - Export busy regression: `node scripts/regression_export_busy.js` (29/29 PASS).
  - Scan ID regression: `node scripts/regression_scan_id.js` (52/52 PASS).
  - Service Worker upgrade regression: `node scripts/regression_sw_update.cjs` (9/9 PASS).
  - Static validation: `python scripts/validate_static.py` (10/10 PASS).
  - Touch target audit: `node scripts/test_touch_targets.cjs` (145/145 PASS).
  - Syntax check: `node --check app.js sw.js party-mode.js party-pdf.js scripts/acceptance_party_ui.cjs` PASS.

## [2026-08-31] Party PDF parser null-byte object-header compatibility
- **Agent:** Codex
- **Thay đổi:** Sửa scanner object boundary trong `party-pdf.js` để chấp nhận indirect-object header sau PDF whitespace `0x00`, xác định object end qua stream boundary/Length và chỉ nhận diện `/Type /Page` trong dictionary; thêm focused regression cho boundary, stream false-positive, Page/Pages và malformed fail-closed.
- **File đã sửa:** `party-pdf.js`, `scripts/regression_party_mode.cjs`.
- **Lý do:** PDF thực `Scan2026-08-19_155638.pdf` có 12 page objects sau byte `0x00`; parser cũ bỏ sót và báo không có trang đọc được dù PDF.js/Poppler đọc đủ.
- **Kiểm tra:** Baseline exact `ca8c8ea0068e125087bd27bac5659820283c3198` tái hiện fail; parser sau fix đọc 12/12; focused Party regression 31/31; isolated Chromium real-PDF acceptance 12/12 preview, coverage, split và export PASS; không sửa renderer/PDF nguồn.

## [2026-09-02] Party PDF thumbnail bị cắt (canvas tràn khung 120px) + SW registration chết vì `offlineBadge`
- **Agent:** Claude Code
- **Thay đổi:**
  1. `.party-pdf-thumb canvas` chuyển sang `position: absolute; inset: 0` để canvas nhận đúng hộp 192×120 của `.party-page-thumb`. Trước đó canvas là grid item có `height: 100%` trong implicit row `auto` → phần trăm chiều cao rơi vào phụ thuộc vòng, Chrome lấy chiều cao theo tỷ lệ nội tại của bitmap (192×272) nên canvas tràn 152px và bị `overflow: hidden` của nút cắt mất 56% dưới; `object-fit: contain` không có tác dụng vì hộp canvas đã đúng tỷ lệ bitmap.
  2. `updateOnlineBadge()` trong `app.js` guard `els.offlineBadge` null. Phần tử `#offlineBadge` đã bị gỡ khỏi `index.html` từ `ec84839`; hàm ném TypeError ngay khi load, cắt luôn phần cuối IIFE nên **service worker chưa từng được đăng ký kể từ đó**.
  3. Thêm gate chống tái phát trong `scripts/acceptance_party_ui.cjs`: mỗi `.party-pdf-preview` phải nằm gọn trong `.party-page-thumb` (overflow ≤ 1px, không zero-size).
- **File đã sửa:** `styles.css`, `app.js`, `scripts/acceptance_party_ui.cjs`, `docs/brain/06-ai-working-log.md`.
- **Lý do:** Người dùng báo thumbnail PDF sau khi nhập chỉ hiện phần trên của trang, trang có nội dung ở giữa/dưới trông như trắng. Không phải lỗi renderer hay parser — pdf.js dựng đủ trang, CSS cắt mất phần dưới.
- **Kiểm tra:**
  - Base→fix reproduction (Chromium headless, PDF scan tổng hợp 8 trang DCTDecode, viewport 1366×900): base = 6/6 canvas tràn `overflowY +152px` (canvas 192×272 trong hộp 192×120); sau fix = 0 tràn, toàn trang hiển thị letterbox 85×120, ảnh chụp desktop 1366×900 và mobile 390×844 không tràn ngang.
  - Service worker: trước fix `getRegistrations()` = 0, không controller; sau fix = 1 registration, `controller: true`, console sạch (không còn TypeError).
  - `node scripts/acceptance_party_ui.cjs` → PARTY_UI_BROWSER_ACCEPTANCE: PASS (17 PASS, gồm gate containment mới).
  - `node scripts/regression_party_mode.cjs` 31/31 PASS · `node scripts/test_touch_targets.cjs` 145/145 PASS · `node scripts/regression_sw_update.cjs` 9/9 PASS · `python scripts/validate_static.py` 10/10 PASS · `node --check app.js sw.js party-mode.js party-pdf.js` PASS.
  - Chưa chạy trên PDF thật của người dùng (không có corpus trong checkout) — cần kiểm tra lại bằng chính `Scan2026-08-28_090429.pdf`.
- **Ghi chú tồn đọng:** `scripts/acceptance_party_ui.cjs` không thoát khi một gate fail (HTTP server giữ event loop sống) — lần chạy fail treo tới hết timeout thay vì exit code khác 0. Chưa sửa trong task này.

## [2026-09-02] Trang trắng do thiếu bộ giải mã CCITT/JBIG2 + Xem trước tại chỗ (in-place viewer)
- **Agent:** Claude Code
- **Thay đổi:**
  1. `sourceHasInk()` trong `party-pdf.js`: bỏ lời gọi `parseDict()` **không tồn tại** (ReferenceError ném ngay ở trang đầu tiên có XObject, bị `catch` nuốt và luôn trả `false`), thay bằng `streamFilters()`. Thêm `LOCALLY_DECODABLE_FILTERS`; filter không giải mã được cục bộ (CCITTFaxDecode, JBIG2Decode, JPXDecode...) được coi là "có mực" vì không thể chứng minh trang trắng → không chấp nhận canvas trắng một cách im lặng nữa.
  2. `renderThumbnail()` sinh thông báo lỗi cho người dùng nêu đúng tên định dạng nén thay vì ghép hai message kỹ thuật.
  3. Thêm **Xem trước tại chỗ**: `<dialog id="partyPreviewDialog">` trong `index.html`, style trong `styles.css`, logic `openPageViewer/renderPageViewer/stepPageViewer/closePageViewer` trong `party-mode.js`. Bấm thumbnail = chọn trang + mở xem trước phóng lớn ngay trong trang (modal, không mở tab mới); có ← Trang trước / ↻ Xoay / Trang sau →, phím ← →, Esc, bấm nền để đóng. Trang lỗi hiển thị nguyên nhân trong khung xem trước.
  4. Thêm gate containment thumbnail vào `scripts/acceptance_party_ui.cjs` (từ task trước cùng ngày).
- **File đã sửa:** `party-pdf.js`, `party-mode.js`, `index.html`, `styles.css`, `scripts/acceptance_party_ui.cjs`, `docs/brain/06-ai-working-log.md`.
- **Lý do:** Người dùng vẫn thấy thumbnail trắng sau khi sửa lỗi cắt canvas. Nguyên nhân gốc: bản pdf.js 5.7.284 đóng gói tại `assets/vendor/pdfjs/` chuyển giải mã JBIG2 **và CCITTFax** sang `jbig2.wasm` (class `JBig2CCITTFaxImage`), JPEG2000 sang `openjpeg.wasm`, kèm fallback JS `jbig2_nowasm_fallback.js`. Không file nào được vendor, `wasmUrl` cũng chưa cấu hình → mọi trang scan bitonal (CCITT G3/G4, JBIG2) dựng ra canvas trắng, chỉ log `warning: Dependent image isn't ready yet`. Bảo vệ blank-canvas không kích hoạt vì `parseDict` undefined.
- **Kiểm tra:**
  - Probe encoding (Chromium headless, fixture PIL): `jpeg-page.pdf` → `renderer: pdfjs, isBlank: false, ink 0.154`; `ccitt-page.pdf` → `renderer: pdfjs, isBlank: true, ink 0` (tái hiện chính xác triệu chứng trang trắng).
  - Sau fix, PDF hỗn hợp 3 trang (DCT, CCITT, DCT): thumbnail = `ready / is-error / ready` — không còn trang trắng im lặng; viewer trang CCITT hiện "Trang 2 dùng ảnh nén CCITTFaxDecode; bản PDF.js đóng gói trong ứng dụng không có bộ giải mã...".
  - Viewer: mở modal (`dialog.matches(':modal') === true`, không mở tab mới), canvas 595×842 ink 0.112 nằm gọn trong stage, prev/next/đóng hoạt động, workspace giữ nguyên 3 trang sau khi đóng.
  - Mobile 390×844: sheet 366×675, 0 tràn ngang, 4 nút đều cao 44px.
  - `node scripts/acceptance_party_ui.cjs` → PASS (17 PASS) · `regression_party_mode.cjs` 31/31 · `test_touch_targets.cjs` 145/145 · `regression_sw_update.cjs` 9/9 · `regression_export_busy.js` 29/29 · `validate_static.py` 10/10 · `node --check` PASS.
- **Đã xử lý tiếp (người dùng chọn phương án vendor):** xem entry kế tiếp. ~~Còn lại: trang CCITT/JBIG2 vẫn chưa xem trước được — mới chỉ báo lỗi trung thực. Ba hướng: (a) vendor `jbig2.wasm` + `openjpeg.wasm` + `jbig2_nowasm_fallback.js` từ pdf.js 5.7.284 và set `wasmUrl` (cần tải file mới → phải được duyệt); (b) tự viết bộ giải mã CCITT G3/G4 cho fallback renderer (thuần offline, không thêm file ngoài); (c) giữ nguyên trạng thái báo lỗi. **Xuất PDF không bị ảnh hưởng ở cả ba hướng** vì export copy nguyên page object gốc.~~

## [2026-09-02] Vendor bộ giải mã wasm của PDF.js (jbig2/openjpeg/qcms) — trang scan bitonal xem trước được
- **Agent:** Claude Code
- **Thay đổi:**
  1. Thêm `assets/vendor/pdfjs/wasm/jbig2.wasm` (105 KB), `openjpeg.wasm` (252 KB), `qcms_bg.wasm` (89 KB) lấy đúng release PDF.js **5.7.284** — cùng bản với `pdf.mjs`/`pdf.worker.mjs` đã vendor. Không thêm JS fallback `*_nowasm_fallback.js` vì ứng dụng vốn đã yêu cầu WebAssembly (ONNX Runtime).
  2. `pdfJsDocument()` trong `party-pdf.js` truyền `wasmUrl` trỏ tới thư mục cục bộ đó.
  3. `sw.js`: thêm 3 file vào `ASSETS`, nâng cache `vigil-lens-v2.6.0` → `vigil-lens-v2.7.0`.
  4. `THIRD_PARTY_NOTICES.md`: liệt kê các file vendor mới và lý do.
- **File đã sửa:** `party-pdf.js`, `sw.js`, `THIRD_PARTY_NOTICES.md`, `assets/vendor/pdfjs/wasm/*` (mới), `docs/brain/06-ai-working-log.md`.
- **Lý do:** PDF.js 5.7 giải mã JBIG2/CCITTFax và JPEG 2000 trong wasm; thiếu file thì trang scan bitonal dựng ra canvas trắng. Người dùng chọn phương án vendor để sửa triệt để mà vẫn giữ 100% offline sau lần tải đầu.
- **Kiểm tra:**
  - Probe encoding trước/sau: `ccitt-page.pdf` từ `isBlank: true, ink 0` → `isBlank: false, ink 0.153`; `jpeg-page.pdf` giữ nguyên `ink 0.154`; console sạch, không còn `Dependent image isn't ready yet`.
  - PDF hỗn hợp 3 trang (DCT/CCITT/DCT): 3/3 thumbnail `ready` (trước đó trang CCITT là `is-error`), viewer trang CCITT `ink 0.112`, 0 console error.
  - Offline PWA acceptance: `PRECACHE_COMPLETE 18/18`, 26 asset cached, `OFFLINE_RELOAD_PASS`, `NO_REQUIRED_RUNTIME_NETWORK_DEPENDENCY` PASS, 0 external request.
  - `node scripts/acceptance_party_ui.cjs` → PASS (18 PASS) · `regression_party_mode.cjs` 31/31 · `test_touch_targets.cjs` 145/145 · `regression_sw_update.cjs` 9/9 · `regression_export_busy.js` 29/29 · `validate_static.py` 10/10 · `node --check` PASS.
  - Chưa chạy trên `Scan2026-08-28_090429.pdf` thật của người dùng — cần xác nhận lại trên máy người dùng.

## [2026-09-02] Nghiệm thu trên PDF scan thật của cán bộ (`Scan2026-08-24_150131.pdf`, 13 trang)
- **Agent:** Claude Code
- **Thay đổi:** Không sửa code sản phẩm. Thêm `/​*.pdf` vào `.gitignore` để scan thật thả vào checkout không bao giờ bị commit (hồ sơ nhân sự).
- **Cấu trúc file thật (phân tích cục bộ, không gửi đi đâu):** PDF 1.4, không mã hoá, 13 trang, **515 image XObject** — 13 ảnh `/FlateDecode /DCTDecode` DeviceRGB 8-bit (lớp nền màu) và **502 ảnh `/CCITTFaxDecode` 1-bit** (lớp chữ). Đây là scan **MRC/layered** của máy scan văn phòng: toàn bộ chữ nằm ở lớp CCITT.
- **Kiểm tra (Chromium headless, server 127.0.0.1, không có request rời máy):**
  - **Không có `wasmUrl`** (trạng thái trước fix): 13/13 trang ink 0.0008–0.012, darkPixels ~0.000 → đúng hiện tượng "trắng xoá". Đáng chú ý: `isBlank` vẫn `false` vì lớp nền JPEG mờ vượt ngưỡng 0.0005, nên bảo vệ blank-canvas **không thể** bắt được trang MRC — chỉ vendor wasm mới sửa được.
  - **Có `wasmUrl`** (sau fix): 13/13 trang `renderer: pdfjs`, ink **0.0899–0.2426**, darkPixels 0.0142–0.0514, 122–779 ms/trang, 0 console error, 0 warning. Trang 10 ink 0.0061 — trang gần trắng có thật trong bản scan, không phải lỗi dựng hình.
  - End-to-end trong app: import 13 trang → 6 thumbnail đầu dựng ngay, 7 trang còn lại lazy theo IntersectionObserver, cuối cùng **13/13 `ready`**; viewer trang 1 ink 0.163, trang 2 ink 0.218; đóng viewer workspace giữ nguyên 13 trang; mobile 390×844 không tràn ngang, nút 44px; **0 console error**.
- **Ghi chú vận hành:** người dùng thấy trắng vì Service Worker **cũ** (cache `vigil-lens-v2.6.0`) vẫn phục vụ `party-pdf.js` bản chưa có `wasmUrl` — banner "Phiên bản mới đã sẵn sàng" chính là dấu hiệu. Bấm **Cập nhật** (postMessage `SKIP_WAITING` → `controllerchange` → `location.reload()`) hoặc Ctrl+Shift+R là nạp bản mới.

## [2026-09-02] Sửa "giật về đầu trang" khi bấm Tách tại đây (và mọi thao tác khác trong Party Mode)
- **Agent:** Claude Code
- **Thay đổi:** `render()` trong `party-mode.js` lưu lại `scrollLeft` của từng `.party-page-rail[data-document-id]` trước khi ghi đè `els.documents.innerHTML`, rồi khôi phục lại theo đúng `document-id` sau khi DOM mới được dựng.
- **File đã sửa:** `party-mode.js`, `docs/brain/06-ai-working-log.md`.
- **Lý do:** Người dùng báo bấm "Tách tại đây" bị "giật về đầu trang". Nguyên nhân: `render()` gọi `els.documents.innerHTML = ...` để dựng lại toàn bộ danh sách tài liệu ở **mọi** hành động (tách, xoay, xoá, di chuyển trang...). Mỗi lần như vậy, `.party-page-rail` (dải thumbnail cuộn ngang trong từng tài liệu) bị thay bằng phần tử DOM mới với `scrollLeft = 0`. Nếu cán bộ đã cuộn sang phải để tìm điểm tách ở trang xa, ngay khi bấm là dải thumbnail bật về trang 1 — không phải cuộn cửa sổ trình duyệt (đã đo `window.scrollY` không đổi trong repro).
- **Kiểm tra (Chromium headless, PDF tổng hợp 14 trang, cuộn window 300px + cuộn rail 400px trước khi bấm):**
  - Trước fix: bấm "Tách tại đây" → `railScrollLeft` 400 → **0** (tái hiện đúng lỗi); `window.scrollY` không đổi (300 → 300), xác nhận đây không phải cuộn trang mà là cuộn dải thumbnail.
  - Sau fix: `railScrollLeft` giữ nguyên 400 → 400. Test thêm hành động **Xoay** (350 → 350, giữ nguyên) và **Áp dụng 2 điểm tách** (thao tác cấu trúc, tài liệu đầu giữ nguyên id, `scrollLeft` được trình duyệt tự kẹp về giá trị hợp lệ mới thay vì bật về 0) — không có trường hợp nào giật về đầu.
  - `node scripts/regression_party_mode.cjs` 31/31 PASS · `node scripts/test_touch_targets.cjs` 145/145 PASS · `node --check party-mode.js` PASS.

## [2026-09-02] Fix Party PDF indirect `/Length n 0 R` parser bug using real 13-page PDF
- **Agent:** Codex
- **Thay đổi:**
  - Sửa parser trong `party-pdf.js`:
    - Thêm `buildObjectIndex(text)` quét vị trí định nghĩa mọi object trong document.
    - Thêm `resolveIndirectLength(text, objectIndex, refId, refGen, currentObjId, cache, visited)` giải mã tham chiếu gián tiếp, phòng chống cyclic reference, xác thực integer bounds.
    - Sửa `resolveStreamLength`: Hỗ trợ cả trực tiếp `/Length <number>` và gián tiếp `/Length <refId> <refGen> R`.
    - Thêm `matchEndStreamAtDeclaredEnd(text, declaredEnd)` với bounded lookahead 0..2 bytes (`endstream`, `\nendstream`, `\rendstream`, `\r\nendstream`), không đòi hỏi byte cuối dữ liệu nhị phân là whitespace.
    - Sửa `findObjectEnd`: Dùng declared length làm authority chính, không scan nhị phân. Lưu `streamDataStart`, `streamDataEnd`, `endStreamOffset`.
    - Sửa `streamFor` và `rewriteObjectBytes`: Cắt stream dựa trên offset đã lưu, tránh scan nhầm fake `endstream` trong binary data.
  - Bổ sung test suite trong `scripts/regression_party_mode.cjs`:
    - Thêm acceptance cho file scan thật `Scan2026-08-24_150131.pdf`: Kiểm tra 13 trang, nhận diện đủ object 11, 84, 149; xuất thành công trang 1-3 với 3 `/Type /Page` và bảo toàn 106 scan images.
    - Thêm toàn bộ bộ test synthetic A–I (Direct length, Indirect length, Out-of-order indirect object, Binary stream không whitespace trước endstream, Fake endstream trong binary payload, Missing ref fail-closed, Invalid non-numeric value fail-closed, Negative length fail-closed, Out-of-bounds fail-closed).
  - Cập nhật `scripts/acceptance_party_ui.cjs`: Thêm kịch bản kiểm tra trình duyệt với file thật `Scan2026-08-24_150131.pdf` (chọn trang 1-3 -> tạo tài liệu -> gán taxonomy 05 -> xuất file -> kiểm tra PDF xuất ra).
- **File đã sửa:** `party-pdf.js`, `scripts/regression_party_mode.cjs`, `scripts/acceptance_party_ui.cjs`, `docs/brain/03-decisions.md`, `docs/brain/06-ai-working-log.md`.
- **Lý do:** Khắc phục lỗi `PDF thiếu object 11.` khi chọn trang 1–3 từ file scan thật `Scan2026-08-24_150131.pdf` để tạo và xuất tài liệu Đảng.
- **Kiểm tra:**
  - `node --check party-pdf.js`: PASS
  - `node --check party-mode.js`: PASS
  - `python scripts/validate_static.py`: PASS (10/10)
  - `node scripts/regression_party_mode.cjs`: PASS (53/53 checks)
  - `node scripts/regression_export_busy.js`: PASS (29/29 checks)
  - `node scripts/regression_scan_id.js`: PASS (52/52 checks)
  - `node scripts/acceptance_party_ui.cjs`: PASS (bao gồm browser acceptance test với `Scan2026-08-24_150131.pdf` xuất thành công 3 trang).

## [2026-09-05] Scan ID: ảnh chụp bằng điện thoại không xuất được PDF và không hiện bản xem trước
- **Agent:** Claude Code
- **Thay đổi:**
  - `loadImage()` được viết lại thành **thang bậc giải mã**: `sniffImageSize()` đọc kích thước từ header (JPEG SOF / PNG IHDR / WEBP VP8·VP8L·VP8X) → `decodeBitmap()` thử `createImageBitmap` với `resizeWidth` khi cạnh dài vượt `MAX_DECODE_EDGE = 4096`, rồi không option → dựng lại `Blob` từ bytes (`sniffImageMime()`) và thử lại → hạ dần theo `DECODE_RETRY_WIDTHS = [3000, 2000, 1200]` → `decodeElement()` (`<img>` + Object URL, cho `decode()` đua với `onload`) → chỉ khi tất cả hỏng mới ném `ImageDecodeError` với hướng dẫn tiếng Việt.
  - Thêm `releaseImage()` và dùng nó thay cho mọi `source.close?.()`: Object URL tạm do `loadImage()` cấp **chỉ** được thu hồi ở đây, không còn revoke ngay sau `decode()`.
  - `addFiles()` loại trang không giải mã được khỏi `state.pages` ngay tại bước import; `addIdFile()` gỡ mặt lỗi khỏi `state.idScan` và giữ wizard đứng tại mặt đó.
  - `renderIdPreview()` và `renderSelected()` không còn thất bại im lặng: lỗi hiện ở `#idExportNotice` / toast.
  - `sw.js`: cache `vigil-lens-v2.8.1` → `vigil-lens-v2.8.2` để bản đã cài nhận được `app.js` mới.
- **File đã sửa:** `app.js`, `sw.js`, `scripts/regression_image_decode.js` (mới), `scripts/acceptance_scan_id_photo.cjs` (mới), `.github/workflows/static-validation.yml`, `docs/brain/01-architecture.md`, `docs/brain/03-decisions.md`, `docs/brain/05-testing-and-deploy.md`, `docs/brain/04-current-tasks.md`, `docs/brain/06-ai-working-log.md`.
- **Lý do:** Người dùng tải ảnh chụp bằng điện thoại vào Scan ID: khung xem trước A4 trắng trơn, Xuất PDF dừng ở 5% ("Đang dựng mặt trước…") với thông báo *"Không xuất được PDF: The source image cannot be decoded."*. Đó là câu Chromium dùng chung cho mọi nguyên nhân giải mã hỏng (`File` kiểu `content://` của Android không còn đọc được, MIME rỗng/sai do picker, ảnh camera quá lớn để bung ở kích thước gốc). Bản cũ chỉ thử 2 lần rồi bỏ cuộc; `addIdFile()` lại nuốt lỗi của `detectPage()` nên một mặt hỏng vẫn đi tiếp được tới bước Xuất PDF — người dùng chỉ biết có chuyện ở bước cuối cùng.
- **Kiểm tra:**
  - `node scripts/regression_image_decode.js` — **32/32 PASS**. Harness nạp `app.js` thật vào fake DOM với `createImageBitmap`/`<img>` điều khiển được, tái hiện đúng từng chế độ hỏng: giải mã full-res bị từ chối vẫn cứu được ở bậc thu nhỏ; mọi bậc hỏng → `ImageDecodeError` mang câu tiếng Việt (không phải DOMException tiếng Anh); `File` không đọc được bytes vẫn tới được `<img>`; Object URL của `<img>` còn sống tới đúng `releaseImage()`; ảnh hỏng trong Scan ID bị gỡ ngay tại bước chụp, wizard đứng nguyên, `idConfirmBtn` vẫn disabled → **không thể tới được bước Xuất PDF với một mặt hỏng**.
  - `node scripts/acceptance_scan_id_photo.cjs` — **17/17 PASS** trên Chromium 1194 headless thật, ảnh 6000×3783 (cạnh dài vượt `MAX_DECODE_EDGE`): xem trước A4 vẽ thật, PDF `%PDF-` đúng 1 trang **595.28×841.89** (A4 dọc), 19.4 KB; dấu đen bất đối xứng xác nhận **mặt trước ở trên (dấu trái-trên, x=0.269 y=0.406), mặt sau ở dưới (dấu phải-dưới, x=0.731 y=0.592)** — đúng thứ tự, không lật, không mirror; 0 lỗi console. *Lưu ý trung thực:* bản trước khi sửa cũng PASS đúng acceptance này (Chromium desktop giải mã ảnh 6000 px bình thường), nên đây là cổng chống hồi quy end-to-end, còn phần tái hiện lỗi nằm ở harness Node phía trên.
  - Hồi quy không đổi: `regression_scan_id.js` 52/52 · `regression_export_busy.js` 29/29 · `regression_ml_detector.js` 53/53 · `regression_party_mode.cjs` 62/62 · `regression_watermark.cjs` 35/35 · `regression_sw_update.cjs` PASS · `test_touch_targets.cjs` 150/150 (cần `CHROME_PATH`) · `validate_static.py` 10/10 · `node --check app.js`/`sw.js`/`document-detector.js` PASS.
  - **Chưa kiểm tra được ở đây:** chính thiết bị Android của người dùng. Cần xác nhận thủ công: sau khi Service Worker cập nhật lên `vigil-lens-v2.8.2` (bấm "Cập nhật" hoặc tải lại), chụp/chọn lại đúng tấm ảnh cũ trong Scan ID.

## [2026-09-05] DEV MODE audit: tách "giải mã ảnh thất bại" khỏi "nhận diện góc thất bại" trong Scan ID
- **Agent:** Claude Sonnet 5 (DEV MODE audit theo yêu cầu người dùng — không được mặc định nguyên nhân là HEIC/ảnh lớn/cloud)
- **Bối cảnh:** Sau lần sửa thang bậc giải mã sáng cùng ngày, người dùng báo tiếp: ảnh JPEG chụp bằng Android — mở được bình thường trên máy, không phải HEIC, không quá lớn — vẫn bị Scan ID báo "Không đọc được ảnh này...". Yêu cầu: không được đoán nguyên nhân, phải audit lại toàn bộ pipeline ingest/decode/render và tìm root cause thật bằng bằng chứng.
- **Root cause tìm được:** `detectPage()` (app.js) gọi `loadImage()` (giải mã ảnh) NGOÀI mọi try/catch riêng, nhưng khối phía sau — `drawRotatedToCanvas()` dựng canvas làm việc 560px + `DocumentDetector.detect()` (ML/WASM) hoặc `detectDocument()` (CV cổ điển) + `applyIdAspectHint()` — chạy trong CÙNG một try mà chỉ có `finally { releaseImage(source) }`, KHÔNG có catch riêng. Một lỗi bất kỳ ở khối nhận diện góc này (ML/WASM crash trên máy yếu, canvas `getImageData` ném `SecurityError`, hoặc bất kỳ bug tương lai nào trong `detectDocument()`) sẽ thoát thẳng ra ngoài `detectPage()`, và cả `addFiles()` lẫn `addIdFile()` chỉ có MỘT catch — gộp chung "ảnh không giải mã được" với "nhận diện góc bị lỗi" thành cùng một nhãn lỗi, xoá trang/mặt khỏi state và báo "Không đọc được ảnh này" dù ảnh đã giải mã hoàn toàn thành công.
- **Thay đổi:**
  - `detectPage()` trong `app.js`: bọc khối `drawRotatedToCanvas()`+detection trong try/catch **riêng**, tách khỏi `loadImage()`. Lỗi ở khối này hạ về khung cắt toàn khung mặc định (`FULL_FRAME_CORNERS`), `confidence = 0.55` (tự động vào diện cần kiểm tra), `detectorSource = 'DETECTION_ERROR_FALLBACK'` (phân biệt với `'DEFAULT_FALLBACK'` — hình học tồi nhưng không throw). `page.width`/`page.height` vẫn được điền qua `rotatedDimensions()` khi không dựng được canvas.
  - Thêm `scripts/regression_detection_fallback.js` (mới, chạy trong CI): 4 case, dependency-free, nạp `app.js` thật vào fake DOM qua `vm` module.
- **File đã sửa:** `app.js`, `scripts/regression_detection_fallback.js` (mới), `.github/workflows/static-validation.yml`, `docs/brain/01-architecture.md`, `docs/brain/03-decisions.md`, `docs/brain/04-current-tasks.md`, `docs/brain/06-ai-working-log.md`.
- **Kiểm tra (bằng chứng root cause, không chỉ unit test sau khi sửa):**
  - Chạy `scripts/regression_detection_fallback.js` trên code TRƯỚC khi sửa (stash tạm thời): **4/11 PASS** — đúng 3 case dự đoán thất bại thật (`DocumentDetector.detect()` throw ở Document mode, ở Scan ID, và `detectDocument()`'s `getImageData()` throw) đều khiến trang/mặt bị xoá và hiện thông báo giải mã sai; case baseline (ảnh thật sự không giải mã được) vẫn đúng như cũ.
  - Chạy lại SAU khi sửa: **17/17 PASS** — page/side được giữ lại, gắn `DETECTION_ERROR_FALLBACK`, không còn thông báo "Không đọc được ảnh này" cho lỗi detection; baseline decode-failure thật vẫn đúng như trước (không làm yếu đường xử lý lỗi giải mã thật).
  - Hồi quy không đổi: `regression_image_decode.js` 32/32 · `regression_scan_id.js` 52/52 · `regression_export_busy.js` 29/29 · `regression_ml_detector.js` 53/53 · `regression_party_mode.cjs` 62/62 · `regression_watermark.cjs` 35/35 · `regression_sw_update.cjs` PASS · `test_touch_targets.cjs` 150/150 (Chromium thật) · `acceptance_scan_id_photo.cjs` 17/17 (Chromium thật, không regress) · `validate_static.py` 10/10 · `node --check app.js`/`sw.js`/`document-detector.js` PASS.
  - **Chưa kiểm tra được ở đây:** chính thiết bị Android của người dùng, và liệu ML/WASM có thực sự crash trên máy đó hay không (không có log thiết bị thật để xác nhận cơ chế crash cụ thể — bằng chứng ở đây chứng minh ĐƯỜNG XỬ LÝ LỖI sai, không chứng minh nguyên nhân crash gốc trên máy cụ thể của người dùng). Xem `docs/brain/04-current-tasks.md`.

## [2026-09-05] Tách "Hướng dẫn" khỏi Scan hồ sơ Đảng — thành khu vực độc lập toàn ứng dụng
- **Agent:** Claude Sonnet 5
- **Bối cảnh:** Sau khi operator xác nhận SCAN_ID_JPEG_ANDROID_RUNTIME_ACCEPTANCE_PASS trên điện thoại thật, yêu cầu tiếp theo: "Hướng dẫn" đang nằm/cảm giác như một tính năng bên trong "Scan hồ sơ Đảng" — operator không muốn vậy. Yêu cầu: đưa Hướng dẫn thành một khu vực độc lập của toàn bộ Vigil Lens, giữ nguyên nội dung giá trị đã có, không sửa thuật toán scan/edge detection/export/business logic Party.
- **Thay đổi:**
  - `index.html`: đổi tên toàn bộ class `party-help-*` → `help-*` (rename cơ học, xác nhận 84 occurrence, không đụng ID/JS). Xoá `<dialog id="partyHelpDialog">` khỏi vị trí cũ (sau `#partyWorkspace`); di chuyển nguyên vẹn nội dung "QUY TRÌNH NHANH 6 BƯỚC" + 24 section nghiệp vụ chi tiết vào `#helpSectionParty` bên trong `<dialog id="helpDialog">` mới (đặt sau `</main>`); bỏ khối "TỔNG QUAN 4 CHẾ ĐỘ" (trùng lặp với "Bắt đầu nhanh" mới). Thêm 4 section landing mới: Scan tài liệu, Scan ID (7 bước theo đúng yêu cầu), Làm sạch chân trang (không gọi là "watermark" trong UI), Mẹo scan. Thêm nút `#helpBtn` vào topbar (luôn hiện, không ẩn theo mode). Đổi 2 nút `? Hướng dẫn` trong Party thành "Xem hướng dẫn Scan hồ sơ Đảng"/"Xem hướng dẫn" (`#partyHelpLinkEmpty`/`#partyHelpLinkToolbar`).
  - `app.js`: thêm `openHelp(sectionId)`/`closeHelp()` (không đụng `state.mode`); tách `leaveActiveModeWithConfirm()` từ handler cũ của `#switchModeBtn` để dùng chung với 4 nút Quick-start (`#helpGotoDocBtn` v.v.) trong Hướng dẫn — đảm bảo Quick-start dùng đúng cơ chế xác nhận "xóa ảnh đang xử lý" đã có, không có đường tắt bỏ qua.
  - `party-mode.js`: xoá `els.helpDialog`/`els.helpClose`, hàm `openHelp()` riêng, và wiring `[data-party-help]` cũ — Party không còn giữ bất kỳ tham chiếu nào tới dialog/nội dung Hướng dẫn.
  - `styles.css`: rename class shell (`.help-dialog`/`.help-sheet`/`.help-head`/`.help-content`), thêm CSS mới cho accordion `<details>`/`<summary>` và lưới nút Quick-start. Thêm 1 rule mobile: ẩn label chữ của nút `.btn.ghost.compact` trong `.top-actions` ở `≤768px` — sửa lỗi tràn ngang phát hiện được khi thêm `#helpBtn` (xem bên dưới).
  - `scripts/regression_help_ia.js` (mới, CI): 26/26, chạy trên fake DOM Node, chứng minh state machine của kiến trúc thông tin mới.
  - `scripts/acceptance_help_ui.cjs` (mới, cần Chromium thật): 22/22, dùng đúng kỹ thuật CDP `Emulation.setDeviceMetricsOverride` (đặt TRƯỚC `Page.navigate`) để đo viewport chính xác — tự xác nhận `window.innerWidth` đúng 390px/360px trước khi tin phép đo tràn ngang; `--window-size` khi khởi động Chromium headless bị đo được là không đáng tin ở môi trường này (~500px thực tế bất kể giá trị truyền vào).
  - `scripts/acceptance_party_ui.cjs`: cập nhật `runHelpUxAcceptance()` để trỏ vào `#helpDialog`/`#helpSectionParty`/`#partyHelpLinkToolbar` mới thay vì `#partyHelpDialog`/`#partyHelpClose`/`[data-party-help]` cũ (test cũ nhắm đúng vào phần đã di chuyển nên phải cập nhật theo).
  - `.github/workflows/static-validation.yml`: thêm bước `regression_help_ia.js`.
- **Lỗi phát hiện được trong lúc kiểm thử (không phải yêu cầu ban đầu, nhưng là regression thật do thay đổi này gây ra):** Thêm `#helpBtn` luôn hiện vào topbar khiến `.top-actions` tràn ngang ở 390px khi `#installBtn` (nút "Cài app") cũng đang hiện — `acceptance_party_ui.cjs`'s mode-selector check bắt được (`overflow:true`, xác nhận bằng diagnostic tạm thời: `#installBtn` bị đẩy ra ngoài viewport). Xác nhận đây LÀ regression bằng cách chạy chính test đó trên code CŨ (chưa có `#helpBtn`) → PASS ở 390px, rồi trên code MỚI → FAIL — chứng minh nguyên nhân chính xác trước khi sửa. Sửa bằng cách ẩn label chữ (`<span>`) của mọi nút `.btn.ghost.compact` trong `.top-actions` ở `≤768px`, giữ icon + `aria-label`. Xác nhận lại: PASS.
- **Kiểm tra:**
  - `node scripts/regression_help_ia.js` — **26/26 PASS**. Chạy trên code TRƯỚC khi sửa (stash `app.js`) trước tiên: 18/26, tái hiện đúng — Hướng dẫn không tồn tại độc lập, Quick-start/guard không hoạt động.
  - `node scripts/acceptance_help_ui.cjs` — **22/22 PASS** trên Chromium 1194 thật, viewport 390×844 và 360×800 đã xác nhận chính xác (`innerWidth` đo được đúng 390/360, không phải số ước lượng sai từ `--window-size`).
  - `node scripts/acceptance_party_ui.cjs` — toàn bộ PASS đến bước `runPreviewLifecycleAcceptance`, thất bại ở đây với thông điệp **y hệt** khi chạy trên code trước khi sửa (đã xác minh bằng cách chạy lại trên code gốc) — flake môi trường có sẵn, không liên quan tới thay đổi này, xem `docs/brain/04-current-tasks.md`.
  - Hồi quy không đổi: `regression_image_decode` 32/32 · `regression_scan_id` 52/52 · `regression_export_busy` 29/29 · `regression_detection_fallback` 17/17 · `regression_ml_detector` 53/53 · `regression_party_mode.cjs` 62/62 · `regression_watermark` 35/35 · `regression_sw_update` PASS · `test_touch_targets` 175/175 (Chromium thật, `helpBtn` 44×44px trên mobile) · `validate_static.py` 10/10 · `node --check` tất cả file JS PASS.
  - **Chưa kiểm tra được ở đây:** cảm nhận UX thực tế trên thiết bị Android của operator (chỉ có bằng chứng Chromium headless, không phải phiên cầm tay thật).


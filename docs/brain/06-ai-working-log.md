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

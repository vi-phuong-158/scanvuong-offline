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

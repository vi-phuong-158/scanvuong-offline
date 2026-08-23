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

## [2026-08-23] Thêm tính năng Auto Enhance (Tự động đẹp)

- **Agent:** Claude Code
- **Thay đổi:** Thêm filter mode mới `auto` ("Tự động đẹp"), mặc định cho trang mới import/chụp, chạy pixel pipeline thật trên `ImageData` (`enhanceAuto()`: background shading correction bằng blur bán kính rộng + percentile cao/chỉ khuếch đại lên → auto levels percentile-based per-channel (blend với luma để giữ màu con dấu/mực đỏ) → local contrast unsharp bán kính hẹp → sharpen unsharp bán kính 1px). Nâng cấp `bw` sang cùng cơ chế pixel (`enhanceBW()`: grayscale → percentile stretch → chia nền cục bộ bán kính rộng → sharpen nhẹ), không nhị phân hoá cứng. `enhanceCanvas()` dùng chung cho preview (`drawEditor()`, qua cache `ensureEnhancedPreview()` chỉ tính lại khi filter/rotation/kích thước đổi — không tính lại mỗi lần kéo góc) và export (`renderPageCanvas()`), đảm bảo preview khớp PDF thật. `document`/`original` giữ nguyên CSS filter cũ (`FILTER_CSS`). Thêm mode UI "Tự động đẹp" lên đầu danh sách filter trong `index.html`.
- **File đã sửa:** `app.js` (thêm `PIXEL_FILTERS`, `enhanceAuto`, `enhanceBW`, `enhanceCanvas`, `computeLuma`, `channelHistogram`, `histPercentile`, `boxBlur`, `ensureEnhancedPreview`; sửa `drawEditor()`, `renderPageCanvas()`, default `filter: 'auto'` trong `addFiles()`), `index.html` (thêm nút filter "Tự động đẹp"), `.claude/launch.json` (mới — config cho browser-preview tooling khi rehearsal, không phải asset của app).
- **Lý do:** Yêu cầu trực tiếp của người dùng: CSS `brightness()/contrast()` đơn thuần không được tính là "Auto Enhance" — cần xử lý pixel thực tế để ảnh chụp trông giống bản scan (nền sạch/sáng hơn, chữ nổi rõ, tương phản tốt hơn, nét hơn), giữ màu tài liệu (không biến thành B&W), và preview phải khớp PDF xuất ra.
- **Kiểm tra:** `node --check app.js`/`sw.js` PASS; JSON/`server.py` static validation PASS; rehearsal thật trong browser pane (server.py + import/detect/export thật): (1) UI — filter "Tự động đẹp" active mặc định cho trang mới, chuyển đổi 4 filter cập nhật preview, xoay 90°×4 không crash, không lỗi console, không request nào rời origin (network tab chỉ có `localhost`/`blob:`); (2) **định lượng bằng ảnh tổng hợp xuất PDF thật rồi giải mã lại JPEG nhúng** (không phải đọc canvas nội bộ, để test đúng đường export): case nền tối (139.5→172.3, tương phản nền/chữ 99.5→160.9), case ánh sáng lệch giữa 2 bên trang (độ lệch giữa 3 vùng nền 28.7→9.6), case ảnh đã đẹp không bị làm xấu (nền/tương phản gần như giữ nguyên, tỉ lệ pixel clip <0.2%), case màu (con dấu đỏ giữ kênh R trội hơn G/B trung bình ~206 điểm sau xử lý, không bị wash-out về xám), case chữ nhỏ/nét mảnh (dải sáng-tối vẫn đầy đủ 0–255 sau xử lý, không bị làm mờ phẳng). Phát hiện và sửa 2 lỗi qua chính rehearsal định lượng này trước khi merge (xem [03-decisions.md](03-decisions.md)): (a) mục tiêu làm sáng nền dùng nhầm trung bình thay vì percentile cao, khiến nền bị làm TỐI đi; (b) bán kính blur cho background-shading quá hẹp (dùng chung với local-contrast), không đủ để làm phẳng gradient ánh sáng toàn trang.

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

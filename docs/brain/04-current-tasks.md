# 04 — Current Tasks

> Cập nhật mỗi khi bắt đầu hoặc hoàn thành task. Agent đọc đây để biết được phép làm gì.

---

## Đang làm

_(trống)_

---

## Chờ làm (backlog)

### GATE-01: Đóng gate PWA install / Service Worker / offline reload trên trình duyệt thật
- **Mô tả:** Xác nhận `navigator.serviceWorker.register('./sw.js')` thành công, service worker chuyển `activated`, app installable, và reload khi offline vẫn mở được — trên Chrome hoặc Edge thật (không phải browser pane nhúng).
- **Liên quan:** `sw.js`, `manifest.webmanifest`, toàn bộ pipeline offline.
- **Ưu tiên:** Cao — đây là gate duy nhất còn chặn verdict `SCANVUONG_V1_LOCAL_ACCEPTANCE_PASS`.
- **Trạng thái:** Bị chặn hai lần liên tiếp (2026-08-22) vì môi trường không có Chrome/Edge thật khả dụng (Claude in Chrome extension không kết nối; browser pane nhúng tái hiện đúng lỗi "unknown error occurred when fetching the script" dù `fetch('./sw.js')` trả về 200 hợp lệ — kết luận là giới hạn môi trường nhúng, không phải lỗi app). Cần người dùng tự chạy checklist thủ công hoặc bật Claude in Chrome extension.

### Cải thiện auto-detect trên nền tương phản thấp
- **Mô tả:** Case "giấy trắng trên nền sáng" (Case C trong bộ rehearsal) vẫn để lại ~8% sai số góc — hiện được xử lý đúng bằng cách đánh dấu "cần kiểm tra" thay vì cắt sai, nhưng bản thân độ chính xác detector còn có thể cải thiện.
- **Liên quan:** `componentQuad()`, `edgeQuad()` trong `app.js`.
- **Ưu tiên:** Thấp — hành vi an toàn (đánh dấu cảnh báo) đã đúng, đây chỉ là cải thiện độ chính xác, không phải bug.

---

## Không làm lúc này

- OCR, cloud storage, đăng nhập, database, API AI — ngoài scope V1 theo quyết định thiết kế, xem [00-project-overview.md](00-project-overview.md).
- Deploy Vercel/static host — chưa được yêu cầu. (Đổi branch → `main`, tạo commit đầu, và tạo GitHub repo công khai đã được thực hiện 2026-08-22 theo yêu cầu trực tiếp của người dùng, trước khi `GATE-01` PASS — xem [06-ai-working-log.md](06-ai-working-log.md).)
- Refactor `app.js` thành nhiều module/file — không có lợi ích rõ ràng và đi ngược nguyên tắc dependency-free/không build-step.

---

## Đã hoàn thành gần đây

- [2026-08-23] Thêm tính năng Auto Enhance ("Tự động đẹp") — pixel pipeline thật (background shading correction, auto levels, local contrast, sharpen) dùng chung cho preview và export; nâng cấp filter Đen trắng sang cùng cơ chế. Xem chi tiết trong [03-decisions.md](03-decisions.md) và [06-ai-working-log.md](06-ai-working-log.md). Branch `feat/auto-enhance`, chưa merge vào `main`.
- [2026-08-22] Audit toàn bộ source, sửa các lỗi phát hiện qua rehearsal chức năng (xem [03-decisions.md](03-decisions.md)), viết `AGENTS.md`/`CLAUDE.md`/`README.md` đầu tiên cho dự án, `git init` cục bộ, cập nhật `PROJECTS.md` ở workspace root.
- [2026-08-22] Hai lần thử đóng `GATE-01` — cả hai đều BLOCKED vì không có Chrome/Edge thật trong môi trường (không phải lỗi app, xem chi tiết trong `GATE-01` ở trên).
- [2026-08-22] Dựng bộ AI project brain (`docs/brain/00-06`), hợp nhất với `AGENTS.md`/`CLAUDE.md` đã có sẵn từ trước (giữ nguyên nội dung kiến trúc/bảo mật/validation, thêm cấu trúc trỏ tới `docs/brain/` theo khung của skill `setup-ai-brain`).

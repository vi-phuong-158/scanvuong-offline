# 00 — Project Overview

## Mục tiêu

ScanVuông biến ảnh chụp tài liệu giấy thành file PDF sạch, thẳng, có thể đọc được — hoàn toàn trên thiết bị của người dùng, không cần mạng, không cần tài khoản, không gửi tài liệu đi đâu cả.

## Người dùng chính

- Người cần số hoá nhanh một vài tờ giấy (đơn từ, hoá đơn, biên bản) bằng điện thoại hoặc máy tính, không muốn cài app nặng hay tạo tài khoản.
- Người quan tâm đến quyền riêng tư tài liệu — không chấp nhận việc ảnh tài liệu được tải lên máy chủ của bên thứ ba.
- Người dùng ở nơi mạng yếu/không ổn định — cần app dùng được offline sau lần cài đầu.

## Phạm vi

### Trong scope (V1)

- Import nhiều ảnh JPG/PNG/WEBP cùng lúc, kéo-thả, hoặc chụp ảnh trực tiếp bằng camera.
- Tự động phát hiện 4 góc tờ giấy kèm mức độ tin cậy; trang chưa chắc chắn được đánh dấu để người dùng tự kiểm tra, không âm thầm cắt sai.
- Chỉnh tay 4 điểm góc, sửa phối cảnh, xoay 90°.
- Quản lý nhiều trang: xoá, sắp xếp lại, xem thumbnail.
- 4 bộ lọc ảnh: Tự động đẹp (mặc định, pixel pipeline thật) / Tài liệu màu / Đen trắng / Gốc.
- Xuất PDF: khổ A4 tự xoay hoặc theo tỷ lệ tài liệu, nhiều mức chất lượng, chế độ "cố gắng dưới 2 MB".
- Cài đặt như PWA và dùng offline sau lần tải đầu.

### Ngoài scope

- OCR / trích xuất chữ — quyết định thiết kế của V1, không phải tính năng thiếu.
- Lưu trữ đám mây, đăng nhập, tài khoản, chia sẻ tài liệu.
- Cơ sở dữ liệu hoặc bất kỳ hình thức lưu trữ lâu dài nào của tài liệu.
- Bất kỳ API AI/LLM nào.
- Backend hoặc máy chủ quản lý tài liệu.
- Ký PDF, watermark, đồng bộ nhiều thiết bị, ứng dụng native (Electron/Tauri/Android/iOS).

## Điểm khác biệt / giá trị cốt lõi

Khác với các app scan phổ biến, ScanVuông không có backend, không phụ thuộc thư viện ngoài (không framework, không CDN, không package manager) và xử lý ảnh 100% bằng Canvas/WebGL ngay trong trình duyệt. Đây là lựa chọn thiết kế có chủ đích để tối đa hoá quyền riêng tư và khả năng chạy offline, đổi lại việc không có OCR hay tính năng AI.

## Trạng thái dự án (2026-08-22)

Đã hoàn thiện và audit kỹ V1: source được khảo sát toàn bộ, sửa các lỗi phát hiện trong quá trình kiểm thử (xem [03-decisions.md](03-decisions.md) và [06-ai-working-log.md](06-ai-working-log.md)), có bộ rehearsal chức năng chạy bằng ảnh tổng hợp (import, auto-crop, chỉnh tay, phối cảnh, filter, xoay, sắp xếp, xuất PDF, xác minh bằng pypdf/pymupdf) đều PASS. Gate còn lại chưa đóng được: **PWA install / service worker registration / offline reload trên trình duyệt Chrome/Edge thật** — môi trường hiện tại không có Chrome/Edge thật để kiểm thử (xem [04-current-tasks.md](04-current-tasks.md)). Repo Git: branch `main`, đã có commit đầu (2026-08-22), remote công khai tại https://github.com/vi-phuong-158/scanvuong-offline.

# 00 — Project Overview

## Mục tiêu

ScanVuông biến ảnh chụp tài liệu giấy thành file PDF sạch, thẳng, có thể đọc được — hoàn toàn trên thiết bị của người dùng, không cần mạng, không cần tài khoản, không gửi tài liệu đi đâu cả.

Ứng dụng có hai workflow độc lập, chọn ở màn hình bắt đầu (`state.mode`):
- **Document mode** (mặc định lịch sử): nhiều trang → nhiều/1 trang PDF theo tỷ lệ tài liệu hoặc A4.
- **ID mode** ("Scan ID", thêm 2026-08-23): đúng 2 ảnh (mặt trước/mặt sau một thẻ/căn cước) → ghép lên **một trang A4 duy nhất**. Xem [01-architecture.md](01-architecture.md) mục "ID mode" và quyết định trong [03-decisions.md](03-decisions.md).

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
- **Scan ID**: workflow riêng — mặt trước + mặt sau một thẻ/căn cước → auto-crop/phối cảnh từng mặt (tái dùng đúng pipeline trên) → ghép lên 1 trang A4 dọc ("Bản in đẹp": thẻ phóng lớn vừa phải, không phải kích thước thật) → xuất PDF 1 trang. Không thể xuất nếu thiếu một mặt.

### Ngoài scope

- OCR / trích xuất chữ — quyết định thiết kế của V1, không phải tính năng thiếu. Áp dụng cho cả Scan ID: không đọc số căn cước, không nhận diện khuôn mặt, không parse QR/NFC/chip, không eKYC.
- Lưu trữ đám mây, đăng nhập, tài khoản, chia sẻ tài liệu.
- Cơ sở dữ liệu hoặc bất kỳ hình thức lưu trữ lâu dài nào của tài liệu.
- Bất kỳ API AI/LLM nào.
- Backend hoặc máy chủ quản lý tài liệu.
- Ký PDF, watermark, đồng bộ nhiều thiết bị, ứng dụng native (Electron/Tauri/Android/iOS).
- Scan ID: preset kích thước thật (85.60×53.98mm, in-scale-thật) — backlog, xem [04-current-tasks.md](04-current-tasks.md). Nhãn "Mặt trước/Mặt sau" in trên PDF/preview — không làm trong V1 (giữ thiết kế sạch theo yêu cầu), UI wizard vẫn hiển thị "đang ở mặt nào" ở bước capture qua `idStepBadge`.

## Điểm khác biệt / giá trị cốt lõi

Khác với các app scan phổ biến, ScanVuông không có backend, không phụ thuộc thư viện ngoài (không framework, không CDN, không package manager) và xử lý ảnh 100% bằng Canvas/WebGL ngay trong trình duyệt. Đây là lựa chọn thiết kế có chủ đích để tối đa hoá quyền riêng tư và khả năng chạy offline, đổi lại việc không có OCR hay tính năng AI.

## Trạng thái dự án (2026-08-23)

- **V1 Document mode & Scan ID mode**: Hoàn thành và merge vào `main`.
- **Tự động nhận diện 4 góc bằng Machine Learning**: Tích hợp mô hình neural network DocCornerNet Lean (`document-detector.js` + `assets/ml/`) chạy offline qua ONNX Runtime Web WASM, bảo vệ bằng Geometry Guard và fallback sang classical CV. Nghiệm thu thực tế trên 25 ảnh dataset thực tế đạt 100% usable (88% Auto-OK, 0% thất bại nặng). Kiểm thử offline trên Chromium headless và Service Worker cache hoàn tất thành công.
- **Bảo mật & Offline**: 100% tài nguyên đóng gói cục bộ, zero network calls, zero external CDN, zero persistent storage, tuân thủ giấy phép bên thứ ba tại `THIRD_PARTY_NOTICES.md`.

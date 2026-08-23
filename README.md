# Vigil Lens

> **See clearly. Capture precisely.**

A private, precision-focused document scanner by VPH.

---

## VPH Vigil Ecosystem

**Vigil Lens** là một phần của hệ sinh thái công cụ **VIGIL** mang tinh thần observation, detection, precision và security workflows. Ứng dụng tập trung thực hiện xuất sắc chu trình cốt lõi:

$$\text{Capture} \longrightarrow \text{Detect} \longrightarrow \text{Correct} \longrightarrow \text{Export}$$

**Không OCR · Không máy chủ · Không cơ sở dữ liệu · Không đăng nhập · Không gửi ảnh đi đâu cả.**

---

## Tính năng chính

### 1. Scan tài liệu (Nhiều trang)
- Chọn nhiều ảnh JPG/PNG/WEBP cùng lúc hoặc kéo-thả trực tiếp.
- Chụp ảnh bằng camera thiết bị (mobile-first).
- Tự động nhận diện 4 góc mép giấy bằng mô hình Machine Learning cục bộ (DocCornerNet / ONNX Runtime Web WASM) kèm classical CV & geometry guard.
- Tinh chỉnh thủ công 4 điểm góc với kích thước touch target đạt chuẩn $\ge 44\times 44\text{px}$.
- Sửa phối cảnh quang học (homography warp) qua WebGL (hoặc CPU fallback an toàn).
- 4 chế độ lọc hình ảnh: **Tự động** (làm sáng nền, đậm nét chữ) / **Màu** / **Đen trắng** / **Gốc**.
- Tùy chọn khổ xuất: **A4 tự xoay** (dọc/ngang theo từng trang) hoặc **Theo tỷ lệ tài liệu**.
- 4 mức chất lượng xuất: **Cao** / **Tiêu chuẩn** / **Nhẹ** / **Cố gắng dưới 2 MB**.
- Tạo file PDF nhị phân trực tiếp trên trình duyệt (không thư viện ngoài, không telemetry).

### 2. Scan ID (Căn cước / Thẻ hai mặt)
- Chụp hoặc chọn **mặt trước** và **mặt sau** độc lập.
- Tự động nhận diện góc và cho phép căn chỉnh từng mặt.
- Tự động ghép 2 mặt lên **một trang A4 dọc duy nhất** theo tỷ lệ chuẩn, căn giữa đối xứng và giữ nguyên màu ảnh/mã QR.
- Bảo vệ dữ liệu cá nhân: không OCR, không trích xuất số thẻ, không nhận diện khuôn mặt.

---

## Chạy ứng dụng

### Chạy cục bộ trên máy tính (Windows / macOS / Linux)

1. Mở thư mục dự án trong Terminal.
2. Khởi chạy máy chủ cục bộ:
   ```bash
   python server.py
   # hoặc: python -m http.server 8765
   # hoặc click đúp: start-windows.bat (trên Windows)
   ```
3. Truy cập địa chỉ `http://127.0.0.1:8765` trên trình duyệt.

### Cài đặt PWA trên điện thoại (Android / iOS)

1. Triển khai thư mục tĩnh lên một host HTTPS (Vercel, Cloudflare Pages, GitHub Pages...).
2. Mở trình duyệt Chrome/Safari và chọn **Cài đặt ứng dụng** (**Add to Home Screen**).
3. Ứng dụng sẽ được lưu vào Service Worker Cache (`vigil-lens-v2.2.0`) và hoạt động **100% Offline** không cần kết nối mạng.

---

## Quyền riêng tư & Bảo mật

- **Xử lý 100% tại chỗ:** Mọi thao tác từ xử lý ảnh, chạy AI nhận diện góc đến đóng gói PDF đều chạy trực tiếp trong trang bằng Canvas/WebGL/WASM.
- **Không upload, không backend:** Không có bất kỳ lệnh gọi API mạng, tracking hay phân tích dữ liệu nào.
- **Không lưu trữ vĩnh viễn:** Không sử dụng `localStorage`, `sessionStorage`, `indexedDB` hay cookie. Khi đóng tab hoặc phiên làm việc, toàn bộ dữ liệu tạm trong bộ nhớ RAM tự động giải phóng.

---

## Cấu trúc thư mục

| File / Thư mục | Vai trò |
|---|---|
| `index.html` | Giao diện ứng dụng Vigil Lens, khai báo UI |
| `styles.css` | Hệ thống Design Tokens, typography Be Vietnam Pro & bố cục responsive |
| `app.js` | Quản lý vòng đời UI, tương tác 4 góc, bộ lọc, xử lý trang và xuất PDF |
| `document-detector.js` | Module nhận diện 4 góc tài liệu (ML inference + geometry validator + classical CV) |
| `assets/fonts/` | Bộ font tiếng Việt Be Vietnam Pro tự host cục bộ (WOFF2) |
| `assets/ml/` | Mô hình DocCornerNet Lean (`.ort`) và ONNX Runtime Web WASM |
| `sw.js` | Service Worker quản lý precache và chế độ hoạt động offline |
| `manifest.webmanifest` | Khai báo PWA (Vigil Lens, standalone display, icons) |
| `icons/` | Icon ứng dụng PWA (192px, 512px) |
| `server.py` | Máy chủ cục bộ lightweight bằng Python chuẩn |
| `THIRD_PARTY_NOTICES.md` | Giấy phép phần mềm bên thứ ba (MIT, SIL OFL 1.1) |

---

## Kiểm thử & Phát triển

```bash
# Kiểm tra cú pháp
node --check app.js
node --check document-detector.js
node --check sw.js

# Kiểm tra tĩnh & bảo mật
python scripts/validate_static.py

# Kiểm tra tương tác touch targets
node scripts/test_touch_targets.cjs

# Kiểm tra regression logic
node scripts/regression_export_busy.js
node scripts/regression_scan_id.js
node scripts/regression_ml_detector.js
node scripts/regression_sw_update.cjs

# Kiểm tra tập ảnh thực tế
node scripts/rehearsal_dataset.cjs

# Kiểm tra PWA Offline
node scripts/acceptance_offline_pwa.cjs
```

---

## Bản quyền & Tác giả

- **Tác giả:** VPH
- **Thương hiệu:** VPH Vigil Lens
- **Giấy phép mã nguồn:** MIT License (xem chi tiết trong `THIRD_PARTY_NOTICES.md`).

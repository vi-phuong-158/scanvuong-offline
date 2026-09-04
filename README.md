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

### 3. Scan tài liệu Đảng (Party Document Mode)
- Nhập ảnh hoặc PDF lớn hoàn toàn tại chỗ; thumbnail PDF render bằng PDF.js 5.7.284 được vendor nội bộ, còn export giữ page-object copier local.
- Chủ động tách/ghép, đổi thứ tự, chuyển trang giữa các tài liệu, thêm trang, thay trang và bỏ trang khỏi tài liệu.
- Theo dõi page coverage của phiên: X/Y trang nguồn đã được phân vào tài liệu; không có checklist hay trạng thái thiếu thành phần hồ sơ.
- Chọn loại tài liệu từ taxonomy canonical 104 loại, tìm theo mã/tên/không dấu; filename lấy từ filename_base, không hard-code.
- Nhiều tài liệu cùng loại chỉ nhận hậu tố .1/.2/... sau khi người dùng xác nhận thứ tự.
- Export từng tài liệu dạng PDF; trang PDF nguồn được copy trực tiếp, ảnh mới chỉ qua canvas crop/filter do cán bộ kiểm soát. Party mode không gọi OCR, AI hoặc ML, không upload và không persistence.
- Party Mode chỉ là công cụ scan và xuất tài liệu, không phải phần mềm quản lý hồ sơ.

### 4. Làm sạch vùng chân trang không mất chất lượng (Lossless Footer Cleaning)
- **Bóc tách cấu trúc (Structural Surgery):** Không dùng phương pháp inpainting hay nén lại ảnh gây mờ chữ. Hệ thống can thiệp trực tiếp cấu trúc PDF, loại bỏ khối chỉ lệnh vẽ thừa trong Content Stream và bóc tách đối tượng thừa ở chân trang khỏi từ điển `Resources`.
- **Bit-for-bit Lossless:** Giữ nguyên 100% byte stream của ảnh quét tài liệu gốc (`DCTDecode`/JPEG). Mã băm SHA-256 của ảnh scan trước và sau khi xử lý hoàn toàn trùng khớp, không re-encode, không suy giảm độ sắc nét.
- **Nhận diện Heuristic thông minh:** Tự động phát hiện và làm sạch vùng chân trang dựa trên toạ độ dải lề dưới trang, kích thước và tỷ lệ hiển thị, đối chiếu với ảnh tài liệu chính lớn.
- **Tốc độ mili-giây & Tối ưu dung lượng:** Xử lý xong trong vài mili-giây ngay trên trình duyệt client. Dung lượng file PDF sạch giảm đúng bằng kích thước đối tượng được loại bỏ.
- **Fail-safe an toàn:** Nếu tài liệu không chứa nội dung thừa ở chân trang hoặc đã là tệp sạch, hệ thống giữ nguyên vẹn tệp gốc 100%.

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
3. Ứng dụng sẽ được lưu vào Service Worker Cache (`vigil-lens-v2.5.0`) và hoạt động **100% Offline** không cần kết nối mạng.

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
| `party-mode.js` | Quản lý vòng đời và tương tác Party Document Mode |
| `party-pdf.js` | Trình import, preview và copy trang PDF local không qua rasterization |
| `party-taxonomy.js` | Mirror local danh mục 104 loại tài liệu Đảng |
| `watermark-mode.js` | Module quản lý giao diện và quy trình Làm sạch chân trang Lossless |
| `document-detector.js` | Module nhận diện 4 góc tài liệu (ML inference + geometry validator + classical CV) |
| `assets/fonts/` | Bộ font tiếng Việt Be Vietnam Pro tự host cục bộ (WOFF2) |
| `assets/ml/` | Mô hình DocCornerNet Lean (`.ort`) và ONNX Runtime Web WASM |
| `assets/vendor/pdfjs/` | PDF.js 5.7.284 và worker local dùng riêng để render thumbnail PDF |
| `sw.js` | Service Worker quản lý precache và chế độ hoạt động offline |
| `manifest.webmanifest` | Khai báo PWA (Vigil Lens, standalone display, icons) |
| `icons/` | Icon ứng dụng PWA (192px, 512px) |
| `server.py` | Máy chủ cục bộ lightweight bằng Python chuẩn |
| `THIRD_PARTY_NOTICES.md` | Giấy phép phần mềm bên thứ ba (MIT, SIL OFL 1.1, Apache 2.0) |

---

## Kiểm thử & Phát triển

```bash
# Kiểm tra cú pháp
node --check app.js
node --check document-detector.js
node --check party-pdf.js
node --check party-mode.js
node --check party-taxonomy.js
node --check watermark-mode.js
node --check sw.js

# Kiểm tra tĩnh & bảo mật
python scripts/validate_static.py

# Kiểm tra tương tác touch targets
node scripts/test_touch_targets.cjs

# Kiểm tra regression logic
node scripts/regression_watermark.cjs
node scripts/regression_export_busy.js
node scripts/regression_scan_id.js
node scripts/regression_ml_detector.js
node scripts/regression_party_mode.cjs
node scripts/regression_sw_update.cjs

# Browser acceptance
node scripts/acceptance_party_ui.cjs
node scripts/acceptance_offline_pwa.cjs
```

---

## Bản quyền & Tác giả

- **Tác giả:** VPH
- **Thương hiệu:** VPH Vigil Lens
- **Giấy phép mã nguồn:** MIT License (xem chi tiết trong `THIRD_PARTY_NOTICES.md`).

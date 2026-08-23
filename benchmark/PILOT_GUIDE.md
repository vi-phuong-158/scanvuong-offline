# Hướng dẫn thu thập & Đánh giá Dữ liệu Thực tế (Real-World Pilot Guide)

Tài liệu này hướng dẫn chi tiết cách bổ sung ảnh chụp camera thật, gán nhãn 4 góc ground truth, chạy pipeline đánh giá và mở visual contact sheet trực quan cho **ScanVuông Offline**.

---

## 1. Mục tiêu Tập Pilot (20 Ảnh Camera Thật)

Để kiểm chứng các cải tiến nhận diện góc (đặc biệt là Experiment B — Local Contrast Preprocessing trên nền trắng) mà không bị phụ thuộc vào dữ liệu mô phỏng (synthetic), tập pilot cần thu thập tối thiểu **20 ảnh camera thật** thuộc các nhóm khó:

| Nhóm thử thách | Số lượng tối thiểu | Mô tả bối cảnh chụp thực tế |
| :--- | :---: | :--- |
| **`RW01_WHITE_ON_WHITE`** | **5 ảnh** | Giấy A4 trắng đặt trên bàn trắng, gạch men sáng, sàn đá hoa nhạt màu. |
| **`RW02_PARTIAL_OCCLUSION`** | **3 ảnh** | Ngón tay đang cầm mép giấy, kẹp bướm kim loại, hoặc giấy ghi chú nhỏ đè lên góc. |
| **`RW03_STRONG_PERSPECTIVE`** | **4 ảnh** | Chụp nghiêng góc hẹp ($< 35^\circ$), chụp chéo từ cạnh hoặc góc nhìn phối cảnh cao. |
| **`RW04_SHADOW_UNEVEN_LIGHT`** | **3 ảnh** | Bóng người/điện thoại đổ ngang qua văn bản, ánh sáng đèn bàn gắt một phía. |
| **`RW05_NEAR_FRAME`** | **2 ảnh** | Tài liệu chiếm sát 4 viền camera ($> 92\%$ diện tích khung hình). |
| **`NEG_DOCUMENT_LIKE`** | **3 ảnh** | Vật thể hình chữ nhật không phải tài liệu: Laptop mở, màn hình máy tính bảng, hộp carton, khung tranh. |

---

## 2. Cấu trúc Thư mục Đặt Ảnh

Tất cả ảnh thực tế được đặt trong thư mục **`benchmark-private/`** (thư mục này được bảo vệ trong `.gitignore`, tuyệt đối không commit lên git):

```text
scanvuong-offline/
  benchmark-private/
    positives/
      RW01_WHITE_ON_WHITE/          <-- 5 ảnh giấy trắng trên nền trắng (.jpg/.png)
      RW02_PARTIAL_OCCLUSION/       <-- 3 ảnh ngón tay / kẹp che góc
      RW03_STRONG_PERSPECTIVE/      <-- 4 ảnh chụp chéo / nghiêng góc hẹp
      RW04_SHADOW_UNEVEN_LIGHT/     <-- 3 ảnh bóng đổ / ánh sáng loang
      RW05_NEAR_FRAME/              <-- 2 ảnh chụp sát mép khung hình
    negatives/
      NEG_DOCUMENT_LIKE/            <-- 3 ảnh laptop, tablet, hộp carton (đặt tên doclike_01.jpg, ...)
```

---

## 3. Quy trình Gán Nhãn Ground Truth (100% Offline)

1. Mở file công cụ gán nhãn trực tiếp trên trình duyệt:
   ```text
   benchmark/tools/ground_truth_annotator.html
   ```
2. Bấm nút **"📷 Mở ảnh"** và chọn ảnh chụp thực tế.
3. Chọn đúng **Danh mục (Category)** tương ứng.
4. Kéo 4 handle tròn màu sắc tới đúng 4 góc tài liệu theo thứ tự chiều kim đồng hồ:
   - **1. Top-Left (Xanh dương)**
   - **2. Top-Right (Xanh lá)**
   - **3. Bottom-Right (Vàng)**
   - **4. Bottom-Left (Đỏ)**
5. **Phím tắt hỗ trợ:**
   - Phím `1`, `2`, `3`, `4`: Chuyển nhanh giữa 4 góc cần chỉnh.
   - Phím `Mũi tên` (Arrow Keys): Vi chỉnh toạ độ 1 pixel.
   - Nhấn `Shift + Mũi tên`: Vi chỉnh 5 pixel.
   - Phím `S` (hoặc `Ctrl+S`): Lưu file JSON ground truth.
6. Lưu file JSON ground truth (ví dụ `RW01_001_ground_truth.json`) vào cùng thư mục với ảnh hoặc xuất chung vào file `benchmark-private/annotations.json`.

---

## 4. Chạy Pipeline Đánh giá (Chỉ 1 Lệnh Duy Nhất)

Sau khi đặt ảnh và gán nhãn, chạy lệnh:

```bash
node scripts/benchmark_real_world.cjs
```

Hệ thống sẽ tự động:
1. Kiểm tra mã băm SHA-256 chống trùng lặp với 25 ảnh lịch sử (`REGRESSION_V1`).
2. Xác thực cấu trúc hình học của ground truth (đảm bảo không tự cắt, đủ 4 góc, diện tích hợp lệ).
3. Chạy song song **Production Baseline** và **Experiment B** (Tiền xử lý tương phản cục bộ).
4. Tính toán Polygon IoU, Corner Error, Phân loại chất lượng (`EXCELLENT`, `GOOD`, `MANUAL_ADJUST`, `CATASTROPHIC`).
5. Xuất báo cáo máy đọc được (`benchmark-output/pilot_evidence_report.json`), báo cáo Markdown (`benchmark-output/pilot_evidence_summary.md`), và **Visual Contact Sheet HTML** (`benchmark-output/contact_sheet.html`).

---

## 5. Mở và Xem Visual Contact Sheet

Mở file sau trực tiếp bằng trình duyệt (Chrome/Edge/Firefox):

```text
benchmark-output/contact_sheet.html
```

Contact sheet hiển thị trực quan toàn bộ các ảnh cạnh nhau:
- **Đường viền màu Xanh lá (`#4ade80`):** Ground Truth chuẩn do người dùng gán nhãn.
- **Đường viền màu Xanh dương (`#38bdf8` nét đứt):** Kết quả nhận diện của Production Baseline.
- **Đường viền màu Vàng (`#facc15` nét chấm):** Kết quả nhận diện của Experiment B.
- **Hộp thông số:** Hiển thị chi tiết IoU, độ lệch góc, thời gian suy luận (Latency) và điểm tin cậy ML.

---

## 6. Phân biệt Rõ Ràng các Phân tập Dữ liệu (Provenance)

- **`REGRESSION_V1` (`LEGACY_REGRESSION`):** 25 ảnh lịch sử dùng để bảo vệ baseline chấp thuận ban đầu. Tuyệt đối không tính vào validation độc lập.
- **`SYNTHETIC_HARD_CASE_V1` (`SYNTHETIC_GENERATED`):** 24 ca thử thách toán học phục vụ CI tự động. Không được coi là bằng chứng thay thế ảnh thật.
- **`REAL_WORLD_PILOT_V1` (`CAMERA_REAL`):** 20 ảnh camera thực tế giai đoạn đầu để quyết định có mở rộng nghiên cứu hay không.
- **`REAL_WORLD_HARD_CASE_V1` (`CAMERA_REAL`):** $\ge 50$ ảnh camera độc lập phục vụ điều kiện release candidate cuối cùng.
- **`CAMSCANNER_REFERENCE_V1` (`CAMERA_REAL`):** Tập ảnh kèm toạ độ crop thực tế từ CamScanner (nếu người dùng cung cấp).

# ScanVuông — Hướng Dẫn Thực Hiện Real-World Pilot (100% Offline)

Tài liệu này hướng dẫn quy trình đơn giản nhất để chuẩn bị và đánh giá **20 ảnh camera thực tế** cho hệ thống nhận diện 4 góc tài liệu ScanVuông.

---

## QUY TRÌNH 3 BƯỚC ĐƠN GIẢN (ONE-COMMAND WORKFLOW)

Bạn **không cần** tự tạo 6 thư mục con, không cần đổi tên ảnh phức tạp hay tính toán mã băm SHA-256. Tất cả được tự động hóa.

### Bước 1: Mở Trình Trợ Lý Thu Thập & Gán Nhãn Cục Bộ

Mở file sau trên trình duyệt (hoạt động 100% offline, không tải bất kỳ thứ gì lên mạng):

```text
benchmark/tools/pilot_capture_assistant.html
```

### Bước 2: Thêm 20 Ảnh Camera Thực Tế & Gán 4 Góc

Kéo thả hoặc bấm **"📷 Thêm ảnh"** để nạp 20 ảnh chụp từ điện thoại theo danh mục gợi ý:

1. **`RW01_WHITE_ON_WHITE` (5 ảnh):** Giấy trắng đặt trên bàn trắng hoặc nền gạch sáng màu (tương phản mép thấp).
2. **`RW02_PARTIAL_OCCLUSION` (3 ảnh):** Ngón tay cầm góc/mép, kẹp bướm hoặc giấy note che một phần góc.
3. **`RW03_STRONG_PERSPECTIVE` (4 ảnh):** Chụp nghiêng góc hẹp ($< 35^\circ$), chụp chéo góc cao từ các phía.
4. **`RW04_SHADOW_UNEVEN_LIGHT` (3 ảnh):** Bóng người/đèn đổ ngang qua tài liệu, ánh sáng phòng không đều.
5. **`RW05_NEAR_FRAME` (2 ảnh):** Tài liệu chụp rất gần, chiếm sát 4 mép camera ($> 92\%$ khung hình).
6. **`NEG_DOCUMENT_LIKE` (3 ảnh vật thể không phải tài liệu):** Màn hình laptop mở, màn hình tablet, hộp carton, khung tranh chữ nhật.

*Thao tác:*
- Chọn danh mục tương ứng cho từng ảnh.
- Kéo 4 góc về đúng 4 góc tài liệu (dùng phím `1`, `2`, `3`, `4` và `Phím mũi tên` để vi chỉnh).
- Bấm **"💾 Xuất Gói Pilot (`pilot_manifest.json`)"** và lưu chung vào thư mục chứa ảnh.

### Bước 3: Chạy 1 Lệnh Duy Nhất Để Đánh Giá

Chạy lệnh sau trên terminal (thay đường dẫn thư mục ảnh của bạn):

```bash
node scripts/run_real_world_pilot.cjs --input "D:\DuongDanChuaAnhVaManifest"
```

Lệnh này sẽ tự động:
1. Kiểm toán mã băm SHA-256 đối chiếu với 25 ảnh lịch sử `REGRESSION_V1`.
2. Kiểm tra tính hợp lệ hình học của ground-truth 4 góc.
3. Tự động sao chép và phân loại vào cấu trúc chuẩn `benchmark-private/`.
4. Chạy song song **Production Baseline**, **Experiment B** (Tiền xử lý tương phản), và **Experiment C2** (Multi-Signal False Positive Rejection).
5. Tính toán chỉ số trải nghiệm `AUTO_ACCEPT_RATE = EXCELLENT + GOOD`.
6. Xuất báo cáo JSON, Markdown và **Visual Contact Sheet HTML** tại:
   ```text
   benchmark-output/contact_sheet.html
   ```

---

## CÁC LỆNH HỖ TRỢ BỔ SUNG

Nếu bạn muốn chuẩn bị thư mục `benchmark-private/` trước rồi chạy riêng:

```bash
# 1. Tự động chuẩn bị thư mục benchmark-private
node scripts/prepare_real_world_pilot.cjs --input "D:\DuongDanChuaAnh"

# 2. Chạy đánh giá
node scripts/benchmark_real_world.cjs
```

---

## NGUYÊN TẮC BẢO MẬT & BẢN QUYỀN

- **Không đưa thông tin cá nhân:** Vui lòng sử dụng giấy trắng, văn bản mẫu, hóa đơn không chứa thông tin nhạy cảm.
- **Không bao giờ tải lên mạng:** Toàn bộ quá trình chạy hoàn toàn cục bộ trên máy bạn.
- **Không commit ảnh vào Git:** Thư mục `benchmark-private/` và `benchmark-output/` được cấu hình tự động trong `.gitignore` để không bao giờ bị đẩy lên GitHub.

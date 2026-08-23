# ScanVuông Hard-Case & Real-World Pilot Benchmark System

Hệ thống đánh giá độ chính xác tự động nhận diện 4 góc tài liệu (Document Corner Detection) cho **ScanVuông Offline**.

---

## 1. Mục tiêu và Nguyên tắc

1. **Không tối ưu theo cảm tính:** Mọi cải tiến detector phải được đo lường định lượng trên dữ liệu thực tế và bộ thử thách tiêu chuẩn.
2. **Tách biệt dữ liệu (Provenance):** Không gộp chung ảnh synthetic với ảnh chụp thật khi công bố chất lượng; chia rõ 4 phân tập:
   - **`REGRESSION_V1` (`LEGACY_REGRESSION`)**: 25 ảnh private dùng để bảo vệ không bị regression so với baseline chấp thuận V1.
   - **`SYNTHETIC_HARD_CASE_V1` (`SYNTHETIC_GENERATED`)**: 24 ca thử thách toán học có ground-truth chính xác (Perspective, Rotation, White-on-White, Shadow, Occlusion, Small doc, Cropped doc, Negatives).
   - **`REAL_WORLD_PILOT_V1` (`CAMERA_REAL`)**: 20 ảnh camera thực tế giai đoạn pilot để so sánh baseline và Experiment B.
   - **`REAL_WORLD_HARD_CASE_V1` (`CAMERA_REAL`)**: $\ge 50$ ảnh camera thật độc lập phục vụ release candidate.
   - **`REAL_WORLD_NEGATIVE_V1` (`CAMERA_REAL`)**: $\ge 30$ ảnh không chứa tài liệu (trong đó $\ge 15$ vật thể chữ nhật) để đo False Positive Rate (FPR).
3. **Bảo mật và Riêng tư:** Không bao giờ commit ảnh cá nhân, ảnh tài liệu thật, hoặc thông tin định danh vào git repo.

---

## 2. Cấu trúc thư mục

```text
benchmark/
  README.md                          — Tài liệu hướng dẫn & phương pháp luận
  PILOT_GUIDE.md                     — Hướng dẫn chi tiết thu thập 20 ảnh pilot & gán nhãn
  geometry.js                        — Thuật toán hình học, polygon area, polygon clipping, IoU
  schemas/
    manifest_schema.json             — JSON Schema chuẩn cho benchmark manifest
    ground_truth_schema.json         — JSON Schema chuẩn cho ground-truth records
  fixtures/
    synthetic_manifest.json          — Fixtures deterministic dùng cho CI
  tools/
    ground_truth_annotator.html      — Công cụ gán nhãn 4 góc 100% offline chạy trên trình duyệt
  synthetic/
    generate_hard_cases.cjs          — Script sinh các ca thử thách synthetic
benchmark-private/                   — (Ignored) Thư mục chứa ảnh thực tế local
  positives/                         — Chứa ảnh chụp tài liệu thật (RW01 - RW07)
  negatives/                         — Chứa ảnh không phải tài liệu (NEG_ORDINARY, NEG_DOCUMENT_LIKE)
benchmark-output/                    — (Ignored) Thư mục chứa kết quả chạy benchmark (JSON, Markdown, HTML contact sheet)
```

---

## 3. Cách chạy Benchmark & Pilot Pipeline

### Bước chuẩn bị (Clean Clone):
```bash
npm ci --prefix benchmark
```

### Chạy Unit Test kiểm tra tính toán hình học & Pipeline:
```bash
# Unit test toán học hình học (Dependency-free Node.js)
node scripts/test_benchmark_engine.cjs

# Unit test pipeline đánh giá dữ liệu thực tế
node scripts/test_pilot_pipeline.cjs
```

### Chạy Synthetic Benchmark Gate (CI / Clean Clone không cần ảnh private):
```bash
node scripts/benchmark_hard_cases.cjs --synthetic-only
```

### Chạy Real-World Pilot Evidence Pipeline (Đánh giá trên ảnh camera thật):
```bash
node scripts/benchmark_real_world.cjs
```

*Sau khi chạy, mở file `benchmark-output/contact_sheet.html` bằng trình duyệt để xem trực quan kết quả so sánh giữa Production Baseline và Experiment B.*

---

## 4. Hệ thống Chỉ số Đánh giá (Metrics)

| Chỉ số | Định nghĩa | Đơn vị |
| :--- | :--- | :--- |
| **Polygon IoU** | Tỷ lệ diện tích giao cắt trên diện tích hợp ($A_{int} / A_{union}$) tính bằng thuật toán cắt đa giác Sutherland-Hodgman. | $0.0 \rightarrow 1.0$ |
| **Corner Error** | Khoảng cách Euclidean chuẩn hoá giữa 4 góc dự đoán và 4 góc ground truth (Mean và Worst). | Normalized $[0, 1]$ |
| **EXCELLENT** | $IoU \ge 0.95$ VÀ $d_{\max} \le 0.025$ (Chuẩn xác tuyệt đối, 0 cần chỉnh). | Phân loại |
| **GOOD** | $IoU \ge 0.90$ VÀ $d_{\max} \le 0.060$ (Dùng được ngay, chỉnh rất nhẹ). | Phân loại |
| **MANUAL_ADJUST** | $IoU \ge 0.70$ VÀ $d_{\max} \le 0.150$ (Cần kéo lại góc). | Phân loại |
| **CATASTROPHIC** | $IoU < 0.70$ HOẶC $d_{\max} > 0.150$ HOẶC hình học không hợp lệ. | Phân loại |
| **FPR (Negatives)**| Tỷ lệ ảnh negative mà detector nhận diện nhầm thành tài liệu hợp lệ (tách riêng Ordinary và Document-like). | $\%$ |
| **Latency** | Thời gian suy luận (tách riêng Cold Init và Warm Inferences). | ms |

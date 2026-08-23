# ScanVuông Hard-Case Benchmark System

Hệ thống đánh giá độ chính xác tự động nhận diện 4 góc tài liệu (Document Corner Detection) cho **ScanVuông Offline**.

---

## 1. Mục tiêu và Nguyên tắc

1. **Không tối ưu theo cảm tính:** Mọi cải tiến detector phải được đo lường định lượng trên dữ liệu thực tế và bộ thử thách tiêu chuẩn.
2. **Tách biệt dữ liệu:** Không gộp chung ảnh synthetic với ảnh chụp thật khi công bố chất lượng; chia rõ 4 phân tập:
   - **`REGRESSION_V1`**: 25 ảnh private dùng để bảo vệ không bị regression so với baseline chấp thuận V1.
   - **`SYNTHETIC_HARD_CASE_V1`**: 24 ca thử thách toán học có ground-truth chính xác (Perspective, Rotation, White-on-White, Shadow, Occlusion, Small doc, Cropped doc, Negatives).
   - **`REAL_WORLD_HARD_CASE_V1`**: Ảnh chụp camera thật từ các tình huống văn phòng và đời thực khó.
   - **`REAL_WORLD_NEGATIVE_V1`**: Ảnh không chứa tài liệu và vật thể hình chữ nhật giống tài liệu để đo False Positive Rate (FPR).
3. **Bảo mật và Riêng tư:** Không bao giờ commit ảnh cá nhân, ảnh tài liệu thật, hoặc thông tin định danh vào git repo.

---

## 2. Cấu trúc thư mục

```text
benchmark/
  README.md                          — Tài liệu hướng dẫn & phương pháp luận
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
benchmark-output/                    — (Ignored) Thư mục chứa kết quả chạy benchmark (JSON, CSV)
```

---

## 3. Cách chạy Benchmark

### Chạy kiểm tra nhanh từ clean clone (chỉ synthetic fixtures, không cần ảnh private)
```bash
node scripts/benchmark_hard_cases.cjs --synthetic-only
```

### Chạy đầy đủ trên toàn bộ dataset
```bash
node scripts/benchmark_hard_cases.cjs
```

### Tuỳ chọn dòng lệnh CLI
```bash
node scripts/benchmark_hard_cases.cjs --help
node scripts/benchmark_hard_cases.cjs --dataset synthetic
node scripts/benchmark_hard_cases.cjs --dataset regression
node scripts/benchmark_hard_cases.cjs --private-dir "G:\My Drive\CamScaner"
node scripts/benchmark_hard_cases.cjs --threshold 0.60
```

### Chạy Unit Test cho Benchmark Engine
```bash
node scripts/test_benchmark_engine.cjs
```

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
| **FPR (Negatives)**| Tỷ lệ ảnh negative mà detector nhận diện nhầm thành tài liệu hợp lệ. | $\%$ |
| **Latency** | Thời gian suy luận (tách riêng Cold Init và Warm Inferences). | ms |

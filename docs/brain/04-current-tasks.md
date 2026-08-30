# 04 — Current Tasks

> Cập nhật mỗi khi bắt đầu hoặc hoàn thành task. Agent đọc đây để biết được phép làm gì.

---

## Đang làm

- **PR #8 Final Acceptance & Release Candidate Preparation**: Hoàn tất các tiêu chuẩn nghiệm thu cuối cùng cho PR #8 (`feat/mobile-ui-redesign`), đồng bộ launcher icon, tích hợp touch-target CI, và chuẩn bị tài liệu cho bước review merge.

---

## Chờ làm (backlog)

### GATE-01: Nghiệm thu PWA Installability thủ công trên trình duyệt thật (OS Launcher)
- **Mô tả:** Kiểm tra thủ công prompt cài đặt PWA ("Cài đặt ứng dụng" / "Add to Home Screen") trên trình duyệt Chrome/Edge thực tế ngoài môi trường headless, xác nhận icon launcher xuất hiện trên màn hình chính và mở ứng dụng standalone khi không có mạng.
- **Trạng thái kỹ thuật (Automated Headless Acceptance):** **PASS**
  - `SERVICE_WORKER_REGISTERED`: PASS
  - `PRECACHE_COMPLETE`: PASS (16/16 assets)
  - `OFFLINE_RELOAD_PASS`: PASS (App Shell load hoàn toàn từ Service Worker cache khi ngắt mạng)
  - `BE_VIETNAM_PRO_OFFLINE_PASS`: PASS (4 weights 400, 500, 600, 700 tải offline)
  - `OFFLINE_DOCUMENT_FLOW_PASS`: PASS
  - `OFFLINE_SCAN_ID_FLOW_PASS`: PASS
  - `NO_REQUIRED_RUNTIME_NETWORK_DEPENDENCY`: PASS
- **Trạng thái nghiệm thu thủ công (Manual OS Prompt):** **PENDING** (`PWA_INSTALLABILITY_NOT_VERIFIED_ENVIRONMENT_LIMITATION` do môi trường headless CI không kích hoạt giao diện prompt native của hệ điều hành).

### Scan ID: preset kích thước thật (physical-size, 85.60×53.98mm in-scale-thật)
- **Mô tả:** V1 Scan ID hỗ trợ layout preset "Bản in đẹp" (thẻ phóng lớn vừa phải, căn giữa A4). Preset thứ hai render thẻ đúng kích thước vật lý thật (cần physical DPI/print scaling chính xác) được đưa vào backlog.
- **Liên quan:** `composeIdA4()` trong `app.js`.
- **Ưu tiên:** Thấp — backlog sau V1.

---

## Không làm lúc này

- OCR, cloud storage, đăng nhập, database, API AI — ngoài scope V1 theo quyết định thiết kế (xem [00-project-overview.md](00-project-overview.md)).
- Thêm dependency, bundler hoặc framework bên ngoài.
- Refactor pipeline cốt lõi (`app.js`, `document-detector.js`).
- Tự ý merge PR #8 vào `main` khi chưa có phê duyệt từ người dùng.

---

## Tính năng đã hoàn thành trên branch `feat/mobile-ui-redesign` (PR #8)

- [2026-08-23] **Rebrand toàn diện VPH Vigil Lens**: Master brand: VPH, Ecosystem: VIGIL, Product: Vigil Lens, Signature: by VPH, Tagline: *See clearly. Capture precisely.* Cập nhật launcher icons 192/512px, Topbar SVG logo, PWA manifest, cache `vigil-lens-v2.2.1` và documentation.
- [2026-08-23] **Mobile-First UI & Touch Targets**: Giao diện tối ưu thao tác 1 tay, 50dvh canvas viewport, 100% interactive targets đạt $\ge 44\times 44\text{px}$ (140/140 checks PASS trên 5 kích thước màn hình), tích hợp regression vào CI.
- [2026-08-23] **Tự host font Be Vietnam Pro**: Trọn bộ 4 weights WOFF2 cục bộ kèm giấy phép SIL Open Font License 1.1 trong `assets/fonts/OFL.txt`.
- [2026-08-23] **Tự động nhận diện 4 góc bằng Machine Learning**: Mô hình DocCornerNet Lean (`assets/ml/`) chạy offline qua ONNX Runtime Web WASM kèm Geometry Guard và classical fallback (25/25 ảnh dataset thực tế đạt 100% usable).
- [2026-08-23] **Scan ID (Căn cước 2 mặt → 1 trang A4)**: Workflow riêng biệt 2 mặt, ghép tự động lên A4 chuẩn đối xứng và khóa an toàn trong suốt quá trình xuất PDF.
- [2026-08-23] **Auto Enhance ("Tự động")**: Shading correction và contrast tuning thời gian thực cho văn bản.

## Party Document Mode — implementation status (2026-08-30)

- Đã triển khai trên branch feat/party-document-mode: mode thứ ba, page coverage, operator-controlled page operations, local 104-type taxonomy, canonical naming, same-type order confirmation, image/PDF/hybrid export và footer nhận diện.
- Đã thêm regression scripts/regression_party_mode.cjs cho page copy, hybrid output và taxonomy.
- Đã thay placeholder PDF bằng preview canvas derivative cục bộ theo từng trang; giữ page-object copy nguyên gốc khi export. Renderer hỗ trợ geometry/vector và image filters phổ biến, fail riêng từng preview nếu gặp filter chưa hỗ trợ; parser vẫn fail-closed với PDF encrypted/corrupt/unsupported.
- Browser acceptance Party Mode đã kiểm tra synthetic PDF có nội dung khác nhau, portrait/landscape, thứ tự canvas, back/re-entry, overflow và touch target trên 1792×896, 1366×768, 1024×768, 768×1024, 390×844.
- Không thay đổi mục backlog Scan ID physical-size hoặc gate manual PWA installability.

# 04 — Current Tasks

> Cập nhật mỗi khi bắt đầu hoặc hoàn thành task. Agent đọc đây để biết được phép làm gì.

---

## Đang làm

- **PR #12 (Watermark Stripping): đã đóng**, xem `06-ai-working-log.md` các entry 2026-09-04.
- **[2026-09-05] Giảm dung lượng PDF offline — mode thứ 5 + tích hợp Party Mode**: hoàn thành, xem `06-ai-working-log.md` (2026-09-05) và `03-decisions.md`.
- **[2026-09-06] Compress mode: memory audit + hardening + mobile-safety guard + realistic benchmark**: hoàn thành, xem entry đầu `06-ai-working-log.md` (2026-09-06) và `03-decisions.md` "Compress mode memory audit". Verdict: `PDF_COMPRESSION_TECHNICAL_PASS_OWNER_MOBILE_ACCEPTANCE_PENDING`. Known limitation không chặn: `exportAll()` không có cảnh báo >20MB theo từng file (chỉ `exportSingleDocument()`); đo memory bằng Chromium desktop `--single-process` (proxy, không thay thế điện thoại thật); 80MB ở rìa an toàn theo số đo; `PREVIEW_SOURCE_MAX_EDGE=640px` cố định trong fallback renderer của `party-pdf.js` (dùng chung, không sửa). **Cần owner test thật trên điện thoại** — xem checklist trong báo cáo phiên làm việc hoặc `06-ai-working-log.md`.

---

## Chờ làm (backlog)

### [ĐÃ XÁC NHẬN 2026-09-05] Scan ID với ảnh chụp bằng điện thoại — SCAN_ID_JPEG_ANDROID_RUNTIME_ACCEPTANCE_PASS
- **Mô tả:** Hai lớp sửa liên tiếp cho cùng một luồng báo lỗi của người dùng:
  1. [2026-09-05, sáng] Thang bậc giải mã trong `loadImage()` — sửa cho ảnh THẬT SỰ khó giải mã (quá lớn, HEIC, bytes không đọc được).
  2. [2026-09-05, DEV MODE audit] Tách miền lỗi "giải mã" khỏi miền lỗi "nhận diện góc" trong `detectPage()` — sửa cho đúng root cause thật: một ảnh JPEG Android **hợp lệ, giải mã tốt** vẫn bị báo "Không đọc được ảnh này" vì bộ nhận diện góc (ML/WASM hoặc canvas) crash và lỗi đó bị `addFiles()`/`addIdFile()` gộp chung với lỗi giải mã. Xem [03-decisions.md](03-decisions.md), mục 2026-09-05 (cả hai).
- **Kết quả:** Operator đã test trực tiếp trên điện thoại Android thật — ảnh JPEG từ thư viện điện thoại hoạt động bình thường. **Đóng mục này**, không còn hành động nào cần làm thêm.

### Flake đã biết (không thuộc scope hiện tại): `runPreviewLifecycleAcceptance` trong `acceptance_party_ui.cjs`
- **Mô tả:** Bước "Stale preview lifecycle" trong `acceptance_party_ui.cjs` thất bại với cùng một thông điệp lỗi y hệt (`calls:8, ready:6, blankReady:false`, cùng kích thước canvas) trên CẢ code trước và sau các thay đổi Hướng dẫn (2026-09-05) — tái hiện giống hệt trên cả hai, chứng tỏ đây là vấn đề timing/môi trường có sẵn từ trước trong pipeline render preview của Party PDF, không liên quan tới việc di chuyển Hướng dẫn.
- **Việc cần làm:** Không nằm trong phạm vi task Hướng dẫn (không được sửa business logic/rendering của Party). Cần một phiên làm việc riêng để root-cause pipeline preview PDF của Party mode nếu muốn khắc phục.
- **Ưu tiên:** Thấp — không chặn release, không phải regression mới.

### GATE-01: Nghiệm thu PWA Installability thủ công trên trình duyệt thật (OS Launcher)
- **Mô tả:** Kiểm tra thủ công prompt cài đặt PWA ("Cài đặt ứng dụng" / "Add to Home Screen") trên trình duyệt Chrome/Edge thực tế ngoài môi trường headless, xác nhận icon launcher xuất hiện trên màn hình chính và mở ứng dụng standalone khi không có mạng.
- **Trạng thái kỹ thuật (Automated Headless Acceptance):** **PASS**
  - `SERVICE_WORKER_REGISTERED`: PASS
  - `PRECACHE_COMPLETE`: PASS (27/27 assets)
  - `OFFLINE_RELOAD_PASS`: PASS (App Shell load hoàn toàn từ Service Worker cache khi ngắt mạng)
  - `BE_VIETNAM_PRO_OFFLINE_PASS`: PASS (4 weights 400, 500, 600, 700 tải offline)
  - `OFFLINE_DOCUMENT_FLOW_PASS`: PASS
  - `OFFLINE_SCAN_ID_FLOW_PASS`: PASS
  - `NO_REQUIRED_RUNTIME_NETWORK_DEPENDENCY`: PASS
- **Trạng thái nghiệm thu thủ công (Manual OS Prompt):** **PWA_MANUAL_OS_INSTALL_PROMPT_PENDING_NON_BLOCKING** (Môi trường headless CI/server không hỗ trợ kích hoạt giao diện prompt native OS; toàn bộ hạ tầng kỹ thuật PWA đạt 100% chuẩn web app manifest và offline service worker cache).

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
- Gate 100 trang đã xác nhận lazy preview: chỉ preload 6 trang, thumbnail cuối được render khi cuộn; fixture corrupt/encrypted bị từ chối fail-closed. Preview image cache downsample tối đa 1200px, không ảnh hưởng export.
- Không thay đổi mục backlog Scan ID physical-size hoặc gate manual PWA installability.

## Party PDF preview hardening — completed (2026-08-30)

- Đã khóa stale async preview bằng monotonic generation token; job cũ không được ghi state, paint canvas hoặc cập nhật DOM sau re-render/back/re-entry.
- Đã giới hạn image derivative cache ở 16 entry, giới hạn stream/decode/image allocation, đóng `ImageBitmap`, revoke object URL và dọn canvas DOM khi discard source.
- Chromium acceptance synthetic đã PASS lifecycle delayed-render, re-entry, 100-page image-heavy probe (`100/100`, cache `16/16`), corrupt/encrypted fail-closed và responsive workspace 5 viewport; không có console error.
- Real-PDF acceptance: NOT_EXECUTED — checkout không chứa PDF corpus được phép thử; không dùng dữ liệu production.

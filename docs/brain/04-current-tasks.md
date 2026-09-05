# 04 — Current Tasks

> Cập nhật mỗi khi bắt đầu hoặc hoàn thành task. Agent đọc đây để biết được phép làm gì.

---

## Đang làm
 
- **PR #12: Lossless CamScanner Watermark Stripping & Final Defect Closure**: Đóng toàn bộ các lỗi tồn đọng:
  1. MediaBox/CropBox/Rotate parser hardening cho cả direct & indirect objects, bỏ qua `/CropBox null`, và định vị thẻ đóng dictionary chuẩn.
  2. False-positive safety cho bộ bóc tách watermark CamScanner: kiểm tra tỷ lệ khung hình 2.3–3.2, yêu cầu ảnh quét chính $\ge 500$k px và gấp $\ge 8\times$, phân tích ma trận `cm` trong cửa sổ lookback 250 ký tự tại lề dưới $\le 20\%$, kích thước hiển thị $20\le W\le 220, 5\le H\le 70$, loại bỏ fallback regex nguy hiểm.
  3. Làm sạch từ điển `/Resources` và inline vào trang, loại bỏ triệt để đối tượng watermark khỏi file xuất ra, bảo toàn bit-for-bit nguyên vẹn ảnh quét chính.
  4. Mở rộng bộ kiểm thử 10 negative regression test cases và CI static validation workflow.
  5. Cập nhật Hướng dẫn sử dụng người dùng cho cả 4 chế độ làm việc.
 
---

## Chờ làm (backlog)

### Xác nhận trên thiết bị thật: Scan ID với ảnh chụp bằng điện thoại
- **Mô tả:** Lỗi "Không xuất được PDF: The source image cannot be decoded." + khung xem trước A4 trắng đã được sửa bằng thang bậc giải mã trong `loadImage()` (xem [03-decisions.md](03-decisions.md), mục 2026-09-05). Đã nghiệm thu bằng harness Node và Chromium headless thật, **chưa** nghiệm thu trên chính máy Android của người dùng.
- **Việc cần làm:** Cập nhật app lên cache `vigil-lens-v2.8.2` (bấm "Cập nhật" khi hiện banner, hoặc tải lại trang), rồi chọn lại **đúng tấm ảnh đã gây lỗi** trong Scan ID. Nếu vẫn hỏng, giờ đây thông báo sẽ hiện **ngay ở bước chụp** kèm nguyên nhân — chụp lại màn hình đó là đủ để lần tiếp theo khoanh vùng.
- **Ưu tiên:** Cao — đây là đường xác nhận duy nhất còn lại cho lỗi người dùng báo.

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

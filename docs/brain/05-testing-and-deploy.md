# 05 — Testing & Deploy

> Mọi lệnh để dựng môi trường, chạy, test, build, deploy. Agent đọc đây thay vì đoán lệnh.

## Cài đặt môi trường local

Không có bước cài đặt. Đây là static site không dependency, không `package.json`, không `pip install`. Chỉ cần Python 3 (thư viện chuẩn) đã có sẵn trên máy để chạy server local.

Không có biến môi trường nào — ứng dụng không đọc `.env` hay config runtime nào.

## Chạy local (dev)

Cách 1 — launcher có sẵn (Windows, tự tìm `py` hoặc `python`):
```bash
start-windows.bat
```

Cách 2 — chạy trực tiếp server của dự án (đa nền tảng, có MIME map đúng cho `.webmanifest`, port fallback 8765→8768):
```bash
python server.py
```

Cách 3 — server tối giản không qua `server.py` (không có MIME map đúng cho `.webmanifest`, chỉ dùng khi cần nhanh):
```bash
python -m http.server 8765
```

Truy cập: `http://127.0.0.1:8765` (hoặc cổng fallback tiếp theo nếu 8765 đang bận, `server.py` sẽ tự thử 8766–8768 và in ra URL thật).

## Build (production)

Không có bước build — `index.html`/`app.js`/`styles.css` chạy thẳng, không qua bundler/transpiler.

## Test

Không có test runner tự động. Lệnh kiểm tra tĩnh thực sự tồn tại:

```bash
node --check app.js
node --check sw.js
python -c "import json,io; json.load(io.open('manifest.webmanifest',encoding='utf-8')); json.load(io.open('vercel.json',encoding='utf-8')); print('json ok')"
python -c "import ast,io; ast.parse(io.open('server.py',encoding='utf-8').read()); print('server.py ok')"
```

Checklist thủ công trước khi báo một thay đổi là PASS (đầy đủ trong `AGENTS.md` mục Validation):
- [ ] Trang mở không có lỗi console.
- [ ] Import nhiều ảnh → mỗi ảnh một trang; trang có độ tin cậy thấp bị đánh dấu, không âm thầm crop sai.
- [ ] Kéo tay 4 góc di chuyển đúng điểm vừa chọn, preview cập nhật theo.
- [ ] Đổi filter thay đổi preview trong editor.
- [ ] Xoay/xoá/sắp xếp cập nhật đúng thumbnail và tổng kết xuất PDF.
- [ ] PDF xuất ra mở được, đúng số trang, đúng thứ tự, **không trang nào bị lật hoặc mirror**.
- [ ] Chế độ A4 chọn đúng chiều dọc/ngang theo từng trang.
- [ ] Không có request nào rời khỏi origin trong suốt các bước trên (kiểm tra tab Network).
- [ ] (Khi có Chrome/Edge thật) Service worker đăng ký thành công, chuyển `activated`, reload khi offline vẫn mở được app và xuất được PDF.

## Deploy

Không nằm trong phạm vi công việc thường xuyên — dự án là static site, có thể deploy lên bất kỳ static host HTTPS nào (Vercel, Cloudflare Pages, GitHub Pages) chỉ bằng cách copy nguyên thư mục. `vercel.json` đã khai báo sẵn header cho `sw.js` (`Service-Worker-Allowed`) và một số header bảo mật cơ bản nếu deploy lên Vercel. **Không tự deploy** trừ khi được yêu cầu rõ ràng — xem `04-current-tasks.md`, mục "Không làm lúc này".

## Môi trường

| Môi trường | Branch | URL |
|-----------|--------|-----|
| Production | `main`, remote: https://github.com/vi-phuong-158/scanvuong-offline | `https://scanvuong-offline.vercel.app` |
| Local | nhánh mặc định `main`, remote: https://github.com/vi-phuong-158/scanvuong-offline (public) | `http://127.0.0.1:8765` (hoặc cổng fallback 8766–8768) |

## CI

`.github/workflows/static-validation.yml` chạy trên `push`/`pull_request`: `node --check app.js`/`sw.js`/`pdf-compress.js`/`compress-mode.js`, `node scripts/regression_export_busy.js`, `node scripts/regression_scan_id.js`, `node scripts/regression_image_decode.js`, `node scripts/regression_detection_fallback.js`, `node scripts/regression_help_ia.js`, `node scripts/regression_pdf_compress.cjs`, `node scripts/acceptance_pdf_compress.cjs` (Chromium), parse JSON của `manifest.webmanifest`/`vercel.json`, `ast.parse` `server.py`, xác nhận asset trong `ASSETS` của `sw.js` tồn tại trên đĩa, quét không có URL runtime CDN/external, và quét ranh giới riêng tư (không `XMLHttpRequest`/`sendBeacon`/`WebSocket`/`localStorage`/`sessionStorage`/`indexedDB`/cookie/`fetch` trong `app.js`/`party-pdf.js`/`party-mode.js`/`party-taxonomy.js`/`pdf-compress.js`/`compress-mode.js`). Logic quét nằm trong `scripts/validate_static.py` (Python stdlib only, không dependency mới).

## Regression harnesses

- `node scripts/regression_export_busy.js` — script Node dependency-free cho Document mode: chứng minh export snapshot đóng băng trang và export settings (`pageSize`/`margin`/`fileName`/`quality`), và mọi mutation handler bị khoá khi `state.busy === true`.
- `node scripts/regression_scan_id.js` — script Node dependency-free cho Scan ID: chứng minh front/back tách biệt khỏi `state.pages`, state machine `front→back→preview` và "Sửa mặt trước/sau", từ chối xuất khi thiếu mặt, khoá busy toàn diện, export snapshot isolation, thu hồi Object URL, bất biến hình học layout A4 (equal width 65% độc lập resolution nguồn, khoảng cách 28 mm, căn giữa dọc toàn block, bảo toàn aspect ratio, trong viền trang), và PDF 1 trang A4 portrait. Chạy trong CI.
- `node scripts/regression_image_decode.js` — script Node dependency-free cho thang giải mã ảnh (`loadImage`/`releaseImage`/`sniffImageSize`): đọc kích thước từ header JPEG/PNG/WEBP, ảnh quá lớn được giải mã **đã thu nhỏ** (`resizeWidth ≤ MAX_DECODE_EDGE`), giải mã full-res thất bại vẫn cứu được bằng các bậc thu nhỏ, Object URL của `<img>` fallback sống tới đúng `releaseImage()`, `File` không đọc được bytes vẫn đi tiếp được, và ảnh không giải mã được **bị từ chối ngay tại bước chụp Scan ID** (mặt lỗi bị gỡ, wizard đứng nguyên, không tới được Xuất PDF). Chạy trong CI.
- `node scripts/regression_detection_fallback.js` — script Node dependency-free chứng minh `detectPage()` tách biệt hai miền lỗi độc lập: `loadImage()` (giải mã ảnh thật) so với khối nhận diện góc (`drawRotatedToCanvas` + `DocumentDetector.detect()`/`detectDocument()`). Tái hiện đúng lỗi gốc: khi `DocumentDetector.detect()` crash (mô phỏng ONNX/WASM lỗi) HOẶC khi `getImageData()` của `detectDocument()` ném lỗi (mô phỏng SecurityError canvas thật), ảnh **vẫn đã giải mã thành công** — trang/mặt phải được **giữ lại**, gắn `detectorSource: 'DETECTION_ERROR_FALLBACK'`, dùng khung cắt toàn khung mặc định, đánh dấu cần kiểm tra thủ công, và **không được** hiện thông báo "Không đọc được ảnh này". Đồng thời xác nhận hành vi cũ không đổi: file thật sự không giải mã được vẫn bị từ chối đúng như trước. Chứng minh regression bằng cách chạy chính harness này trên code trước khi sửa (4/11 PASS — tái hiện đúng lỗi) và sau khi sửa (17/17 PASS). Chạy trong CI.
- `node scripts/regression_pdf_compress.cjs` — script Node dependency-free cho engine `pdf-compress.js` (`PdfCompress`): hằng số target (19.000.000 byte decimal, dưới cả 20.000.000 và 20×1024×1024), `verifyTarget()` ở biên, bảng `ROUNDS` giảm dần `maxEdge`/`jpeg` không có field grayscale (giữ màu mặc định), `BEYOND_FLOOR_ROUNDS` luôn thấp hơn floor, `resolveRounds()` không bao giờ vượt floor nếu không có `allowBeyondFloor`/`rounds` tường minh, `buildCompressedPdf()` (dùng lại `PartyPdf.buildPdf`) giữ đúng số trang/thứ tự/orientation và không mutate `items` đầu vào. Không kiểm được vòng lặp render/adaptive-retry thật (cần Canvas/PDF.js thật) — xem `acceptance_pdf_compress.cjs`. Chạy trong CI.
- `node scripts/regression_help_ia.js` — script Node dependency-free chứng minh kiến trúc thông tin của "Hướng dẫn": `#helpBtn` là entry điểm toàn cục (topbar), hiển thị bất kể đang ở màn hình chọn chế độ hay đã vào một chế độ bất kỳ; mở Hướng dẫn KHÔNG chạm vào `state.mode`; hai link "Xem hướng dẫn" trong Scan hồ sơ Đảng mở đúng `#helpDialog` toàn cục (không phải dialog riêng của Party) và deep-link mở sẵn `#helpSectionParty`; mở/đóng Hướng dẫn khi đang có phiên scan dở dang (ảnh đã nạp ở Document mode) không làm mất `state.pages`/`state.selectedId`; các nút rút gọn ("Quick-start") trong Hướng dẫn dùng lại đúng cơ chế xác nhận "Chuyển chế độ sẽ xóa ảnh đang xử lý" đã có ở nút "Đổi chế độ" — không có đường tắt nào bỏ qua xác nhận này. Chạy trong CI.

## Scan ID validation với ảnh chụp điện thoại (browser acceptance)

    node scripts/acceptance_scan_id_photo.cjs

Cần Chromium/Chrome thật (tự tìm, hoặc đặt `CHROME_PATH`) nên **không** chạy trong CI. Script dựng ảnh 6000×3783 (cạnh dài vượt `MAX_DECODE_EDGE`) ngay trong trình duyệt, chạy đúng luồng Scan ID thật, rồi kiểm tra: khung xem trước A4 có vẽ thật (không trắng trơn), Xuất PDF ra file `%PDF-` đúng **1 trang A4 dọc**, và — bằng một dấu đen bất đối xứng trên từng mặt — **mặt trước nằm trên, mặt sau nằm dưới, không mặt nào bị lật hay mirror**, không lỗi console.

## Giảm dung lượng PDF validation

    node --check pdf-compress.js
    node --check compress-mode.js
    node scripts/regression_pdf_compress.cjs
    node scripts/acceptance_pdf_compress.cjs

`acceptance_pdf_compress.cjs` cần Chromium/Chrome thật (tự tìm theo `CHROME_PATH`/`GOOGLE_CHROME_BIN`, `/opt/pw-browsers`, hoặc `which`) nên **không phụ thuộc CI phải có PDF thật** — toàn bộ fixture (một PDF nguồn >20 MB, và các trang ảnh JPEG nguồn của Party Mode) được dựng **trong chính trình duyệt** bằng Canvas (text/dấu đỏ/vùng xám/nhiễu, theo đúng checklist "trang có nội dung chữ" — không dùng ảnh trắng đơn thuần) rồi gắn vào `<input>`/dropzone qua `DataTransfer`+`File` tổng hợp — không có file nào được ghi ra đĩa hay commit vào repo. Script kiểm tra: mode Giảm dung lượng PDF nhận PDF >20 MB qua kéo-thả, hiển thị đúng tên/số trang/dung lượng, nén xuống dưới target và tải PDF kết quả — xác nhận lại bằng cách `PartyPdf.parse()`/`pageInfo()` trên chính blob đã tải để bảo đảm đúng số trang và không trang nào hỏng cấu trúc; và Party Mode: export mặc định (lossless) >20 MB hiện dialog cảnh báo, "Tải bản gốc" tải đúng blob lossless không đổi dung lượng, "Tạo bản dưới 20MB" gọi `PdfCompress.compressPdf()` (không có logic nén riêng trong `party-mode.js`) và tải ra bản nhỏ hơn giữ đúng số trang.

**Ghi chú môi trường:** engine nén dùng lại `PartyPdf.renderThumbnail()` (đã có sẵn cho Party Mode) để dựng từng trang — hàm này tự thử PDF.js trước, nếu `page.render()` lỗi (từng gặp trên một bản Chromium headless cụ thể trong quá trình phát triển task này, do thiếu `Map.prototype.getOrInsertComputed`) thì tự chuyển sang bộ dựng cổ điển của `party-pdf.js`, nên tính năng nén không phụ thuộc PDF.js phải chạy được 100%.

## Hướng dẫn — kiểm tra kiến trúc thông tin (browser acceptance)

    node scripts/acceptance_help_ui.cjs

Cần Chromium/Chrome thật nên **không** chạy trong CI (bổ sung cho `regression_help_ia.js`, vốn chỉ chạy trên fake DOM trong Node). Dùng đúng kỹ thuật CDP `Emulation.setDeviceMetricsOverride` đặt TRƯỚC `Page.navigate` như `acceptance_party_ui.cjs` — script tự xác nhận `window.innerWidth` đúng bằng viewport yêu cầu (390px/360px) trước khi tin bất kỳ phép đo tràn ngang nào; cờ `--window-size` khi khởi động Chromium headless không đáng tin ở môi trường này (đã đo được ~500px thực tế bất kể giá trị truyền vào). Kiểm tra: `#helpBtn` luôn hiện ở topbar bất kể đang ở màn hình nào; mở Hướng dẫn từ trang chủ không cần vào Scan hồ sơ Đảng; `#partyHelpDialog` không còn tồn tại trong DOM; link "Xem hướng dẫn" trong Party mở đúng `#helpDialog` toàn cục và tự mở rộng + cuộn tới `#helpSectionParty`; không tràn ngang ở 390×844 và 360×800 cả khi đóng lẫn khi mở Hướng dẫn; mở/đóng Hướng dẫn khi đang có trang scan dở dang không làm mất trang đó; không lỗi console.

## Lưu ý

- `server.py` tự thử các cổng 8765→8768 nếu cổng trước bị chiếm — luôn đọc URL thật được in ra console thay vì giả định 8765.
- Chế độ xuất PDF "Cố gắng dưới 2 MB" có thể mất vài chục giây với nhiều trang nội dung phức tạp — đây là hành vi bình thường (nén lại nhiều vòng), không phải app bị treo.
- Mở trực tiếp `index.html` bằng `file://` sẽ **không** đăng ký được Service Worker — đây là giới hạn của trình duyệt, không phải lỗi app; phải chạy qua `http://localhost` hoặc HTTPS thật để test PWA/offline.

## Party Document Mode validation

    node --check party-pdf.js
    node --check party-mode.js
    node --check party-taxonomy.js
    node scripts/regression_party_mode.cjs
    node scripts/acceptance_party_ui.cjs

Regression này xác minh PDF 10 trang tách đúng 2 trang, output giữ content stream/page-object path không có JPEG conversion cho source page, hybrid giữ source page và thêm image page, taxonomy có 104 id duy nhất, tìm kiếm không dấu và filename canonical type 05. Browser acceptance_party_ui.cjs còn kiểm tra thumbnail canvas có pixel nội dung thật, đủ portrait/landscape, đúng thứ tự, back/re-entry, overflow và touch target tại 1792×896, 1366×768, 1024×768, 768×1024, 390×844. Đây vẫn không thay thế nghiệm thu offline PWA thủ công.

Preview hardening acceptance thêm delayed renderer để tạo stale generation có chủ đích, kiểm tra re-render và back/re-entry khi job còn pending, rồi chạy synthetic PDF 100 trang ảnh qua browser để xác nhận 100 derivative renders, cache không vượt `16/16`, và cache/DOM về `0` khi rời Party Mode. Real-PDF acceptance chỉ chạy khi có corpus local được phép; không dùng production input/output.

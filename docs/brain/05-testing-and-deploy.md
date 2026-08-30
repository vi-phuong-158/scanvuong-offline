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

`.github/workflows/static-validation.yml` chạy trên `push`/`pull_request`: `node --check app.js`/`sw.js`, `node scripts/regression_export_busy.js`, `node scripts/regression_scan_id.js`, parse JSON của `manifest.webmanifest`/`vercel.json`, `ast.parse` `server.py`, xác nhận asset trong `ASSETS` của `sw.js` tồn tại trên đĩa, quét không có URL runtime CDN/external, và quét ranh giới riêng tư (không `XMLHttpRequest`/`sendBeacon`/`WebSocket`/`localStorage`/`sessionStorage`/`indexedDB`/cookie/`fetch` trong `app.js`). Logic quét nằm trong `scripts/validate_static.py` (Python stdlib only, không dependency mới).

## Regression harnesses

- `node scripts/regression_export_busy.js` — script Node dependency-free cho Document mode: chứng minh export snapshot đóng băng trang và export settings (`pageSize`/`margin`/`fileName`/`quality`), và mọi mutation handler bị khoá khi `state.busy === true`.
- `node scripts/regression_scan_id.js` — script Node dependency-free cho Scan ID: chứng minh front/back tách biệt khỏi `state.pages`, state machine `front→back→preview` và "Sửa mặt trước/sau", từ chối xuất khi thiếu mặt, khoá busy toàn diện, export snapshot isolation, thu hồi Object URL, bất biến hình học layout A4 (equal width 65% độc lập resolution nguồn, khoảng cách 28 mm, căn giữa dọc toàn block, bảo toàn aspect ratio, trong viền trang), và PDF 1 trang A4 portrait. Chạy trong CI.

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

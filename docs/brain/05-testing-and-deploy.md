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
| Production | _(chưa deploy — chỉ có repo GitHub, chưa deploy static host)_ | _(cần bổ sung khi có yêu cầu deploy)_ |
| Local | `main` (1 commit, remote: https://github.com/vi-phuong-158/scanvuong-offline, public) | `http://127.0.0.1:8765` (hoặc cổng fallback 8766–8768) |

## Lưu ý

- `server.py` tự thử các cổng 8765→8768 nếu cổng trước bị chiếm — luôn đọc URL thật được in ra console thay vì giả định 8765.
- Chế độ xuất PDF "Cố gắng dưới 2 MB" có thể mất vài chục giây với nhiều trang nội dung phức tạp — đây là hành vi bình thường (nén lại nhiều vòng), không phải app bị treo.
- Mở trực tiếp `index.html` bằng `file://` sẽ **không** đăng ký được Service Worker — đây là giới hạn của trình duyệt, không phải lỗi app; phải chạy qua `http://localhost` hoặc HTTPS thật để test PWA/offline.

# ScanVuông — Scan PDF Offline

Ứng dụng web/PWA nhỏ gọn để biến ảnh chụp tài liệu thành PDF: tự nhận 4 góc tờ giấy, sửa phối cảnh, chỉnh tay góc cắt, làm rõ tài liệu và xuất PDF. Toàn bộ xử lý diễn ra ngay trên máy/điện thoại của bạn.

**Không OCR · Không máy chủ · Không cơ sở dữ liệu · Không đăng nhập · Không gửi ảnh đi đâu cả.**

## Chức năng V1

- Chọn nhiều ảnh JPG/PNG/WEBP cùng lúc, hoặc kéo-thả ảnh vào cửa sổ.
- Chụp ảnh trực tiếp bằng camera trên điện thoại.
- Tự phát hiện mép tờ giấy; trang nào chưa chắc chắn sẽ được **đánh dấu cảnh báo** thay vì cắt bừa.
- Kéo trực tiếp 4 điểm góc để sửa vùng cắt.
- Sửa phối cảnh (ảnh chụp xiên thành ảnh thẳng) khi xuất PDF.
- Xoay 90°, xóa trang, đổi thứ tự trang (nút ↑ ↓ trên mọi thiết bị, kéo-thả trên máy tính).
- 4 chế độ ảnh: **Tự động đẹp** (mặc định, tự làm sáng nền/tối chữ/nét hơn) / **Tài liệu màu** / **Đen trắng** / **Gốc**.
- Khổ **A4 tự xoay** (dọc/ngang theo từng trang) hoặc **theo tỷ lệ tài liệu**.
- Chất lượng **Cao / Tiêu chuẩn / Nhẹ / Cố gắng dưới 2 MB**.
- Tùy chọn chừa lề trắng nhỏ.
- Cài như ứng dụng (PWA) và dùng được khi không có mạng.

## Chạy trên Windows

Cách dễ nhất (máy đã có Python):

1. Giải nén / mở thư mục `scanvuong-offline`.
2. Bấm đúp vào **`start-windows.bat`**.
3. Trình duyệt sẽ tự mở `http://127.0.0.1:8765`.
4. Muốn dừng: quay lại cửa sổ đen và bấm `Ctrl + C`.

Nếu muốn tự gõ lệnh, mở thư mục này trong Terminal rồi chạy:

```bash
python -m http.server 8765
```

rồi mở trình duyệt tới `http://127.0.0.1:8765`.

> `start-windows.bat` chỉ chạy một máy chủ tĩnh trên chính máy bạn (`127.0.0.1`). Nó **không** cần quyền quản trị, **không** cài thêm gì và **không** thay đổi cài đặt hệ thống.

**Nếu máy chưa có Python:** file `.bat` sẽ báo "Khong tim thay Python tren may". Bạn có thể mở thẳng `index.html` bằng trình duyệt để dùng các chức năng cơ bản, nhưng chế độ cài đặt PWA và cache offline **cần** chạy qua `localhost` hoặc HTTPS. Ứng dụng không tự tải Python về; nếu cần, hãy tự cài Python từ python.org rồi chạy lại file `.bat`.

## Dùng trên điện thoại Android

Thư mục này là một trang tĩnh, nên để cài lên điện thoại bạn cần đưa nó lên một địa chỉ HTTPS (Vercel, Cloudflare Pages, GitHub Pages… đều phù hợp — đây là việc bạn chủ động làm, ứng dụng không tự gửi gì đi).

1. Deploy toàn bộ thư mục này lên một host tĩnh HTTPS.
2. Mở địa chỉ đó bằng Chrome trên điện thoại.
3. Chọn **Cài ứng dụng** / **Add to Home screen** (nút "Cài ứng dụng" cũng hiện sẵn trong ứng dụng khi trình duyệt cho phép).
4. Mở app từ màn hình chính và dùng như một ứng dụng bình thường.

Nút **Chụp ảnh** sẽ mở camera sau của máy.

## Chế độ offline hoạt động thế nào

- **Lần đầu bạn phải tải được ứng dụng** (qua `localhost` hoặc HTTPS). Đây là lúc trình duyệt tải HTML/CSS/JS/icon về.
- Service Worker (`sw.js`) lưu sẵn bộ khung ứng dụng vào cache của trình duyệt.
- **Từ lần sau, mở app không cần mạng.** Khi có mạng, app vẫn âm thầm tải bản mới về cache để lần mở kế tiếp là bản cập nhật.
- **Ảnh tài liệu của bạn không bao giờ được gửi lên máy chủ** — kể cả khi đang online. Việc deploy chỉ để phục vụ mấy file HTML/CSS/JS tĩnh.
- Mở trực tiếp bằng `file://` sẽ **không** bật được Service Worker; đó là giới hạn của trình duyệt, không phải lỗi ứng dụng.

## Riêng tư

- Không có backend. Không có API. Không có tài khoản.
- Ảnh được đọc bằng File API, xử lý bằng Canvas/WebGL, PDF được tạo ngay trong trình duyệt.
- Không có analytics, không có telemetry, không có thư viện tải từ CDN.
- Ứng dụng **không lưu tài liệu lại**: không dùng localStorage, không dùng cơ sở dữ liệu. Đóng tab là mọi thứ biến mất. Hãy xuất PDF trước khi đóng.

## Vì sao không có OCR

Đây là **quyết định thiết kế của V1**, không phải tính năng lỗi hay chưa làm xong. ScanVuông V1 tập trung làm thật tốt một việc: ảnh → tài liệu thẳng, sạch → PDF, hoàn toàn offline và không phụ thuộc thư viện ngoài. OCR chạy trên máy sẽ kéo theo một bộ dữ liệu ngôn ngữ lớn và làm hỏng mục tiêu "nhẹ, không phụ thuộc" đó.

## Giới hạn đã biết

- **Tự nhận mép giấy** hoạt động tốt nhất với tờ giấy sáng trên nền tương phản. Nếu nền quá sáng (giấy trắng trên bàn trắng), mép giấy bị che, hoặc trang chiếm quá ít khung hình, ứng dụng sẽ **đánh dấu trang đó là "cần kiểm tra"** để bạn kéo 4 góc bằng tay — nó cố tình không cắt bừa.
- **"Cố gắng dưới 2 MB" là cố gắng, không phải cam kết.** App sẽ nén lại nhiều lần để tiến gần mốc 2 MB; nếu tài liệu quá nhiều trang hoặc quá nhiều chi tiết, file cuối vẫn có thể vượt 2 MB và app sẽ nói rõ điều đó thay vì làm chữ mờ đến mức không đọc được.
- Xuất PDF nhiều trang ở chế độ nén mạnh có thể mất vài chục giây — mọi việc đều chạy bằng CPU/GPU của chính máy bạn.
- Máy không hỗ trợ WebGL vẫn dùng được: ứng dụng tự chuyển sang sửa phối cảnh bằng CPU, chỉ chậm hơn.

## Cấu trúc thư mục

| File | Vai trò |
|---|---|
| `index.html` | Giao diện, khai báo toàn bộ phần tử DOM |
| `styles.css` | Giao diện responsive cho máy tính và điện thoại |
| `app.js` | Nhận diện mép giấy, editor 4 góc, warp phối cảnh, bộ lọc, quản lý trang, bộ ghi PDF |
| `sw.js` | Service Worker — cache offline |
| `manifest.webmanifest` | Khai báo PWA (tên, icon, chế độ hiển thị) |
| `icons/` | Icon 192px và 512px cho PWA |
| `server.py` | Máy chủ tĩnh cục bộ (chỉ dùng thư viện chuẩn của Python) |
| `start-windows.bat` | Chạy nhanh trên Windows |
| `vercel.json` | Header khi deploy lên host tĩnh (không bắt buộc để chạy) |
| `AGENTS.md`, `CLAUDE.md` | Hướng dẫn cho công cụ AI khi sửa dự án |

## Dành cho người phát triển

Dự án **không có** package manager, bundler, linter hay test runner — đó là chủ ý. Kiểm tra nhanh:

```bash
node --check app.js
```

Xem [`AGENTS.md`](AGENTS.md) để biết kiến trúc, ranh giới riêng tư và danh sách kiểm tra đầy đủ.

# 02 — Coding Rules

## Nguyên tắc chung

- Viết ít nhất có thể để giải quyết đúng task. Không tính năng speculative.
- Không abstraction sớm: 3 đoạn lặp vẫn tốt hơn 1 abstraction non — codebase này cố tình phẳng, một file `app.js` duy nhất.
- Không xử lý lỗi cho kịch bản không thể xảy ra.
- Comment WHY, không comment WHAT — tên hàm/biến trong `app.js` đã đủ rõ WHAT (ví dụ `orderCorners`, `homographyCoeffs`, `warpCpu`).
- Không refactor code lân cận nếu không liên quan task.

## Style code

- Ngôn ngữ / runtime: JavaScript ES2020 thuần chạy trong trình duyệt (không TypeScript, không Node runtime), Python 3 stdlib cho `server.py`.
- Format: 2-space indent trong `app.js`/`styles.css`/`index.html`; nhiều hàm tiện ích viết compact trên một dòng theo phong cách sẵn có trong file — khi sửa, bám theo mật độ dòng của đoạn xung quanh thay vì áp một style mới.
- Linter / formatter: không có (không ESLint, không Prettier, không cấu hình nào được cài). Kiểm tra cú pháp bằng `node --check`.

## Đặt tên

- Hàm đặt tên theo động từ mô tả đúng việc nó làm trong pipeline (`detectDocument`, `renderPageCanvas`, `buildPdf`) — giữ nguyên quy ước này khi thêm hàm mới.
- Trạng thái toàn cục gom trong một object `state` duy nhất; phần tử DOM gom trong object `els` duy nhất, tra theo `id`. Không tạo biến toàn cục rời rạc mới ngoài hai object này.
- Tên tiếng Anh cho code/định danh; chuỗi hiển thị cho người dùng (UI text, thông báo lỗi, toast) viết bằng tiếng Việt — giữ đúng ngôn ngữ hiện có của từng phần khi sửa.

## Bảo mật

Xem đầy đủ ranh giới bảo mật/riêng tư (phần quan trọng nhất của dự án này) trong [`../../AGENTS.md`](../../AGENTS.md#security-and-privacy). Tóm tắt các quy tắc cứng:

- Không hardcode secret/API key — dự án này không có secret nào và không được có.
- Không thêm bất kỳ lệnh gọi mạng nào (`fetch`/`XMLHttpRequest`/`sendBeacon`/`WebSocket`) trong `app.js`. `fetch` duy nhất được phép tồn tại là trong `sw.js`, giới hạn same-origin.
- Không thêm `localStorage`/`sessionStorage`/`indexedDB`/cookie — ứng dụng cố tình không lưu tài liệu.
- Không thêm CDN script, webfont ngoài, hay bất kỳ asset tải từ xa nào — phá vỡ khả năng offline.
- Mọi Object URL (`URL.createObjectURL`) phải được `revokeObjectURL` khi trang bị xoá/xoá toàn bộ/tải xong PDF — giữ đúng kỷ luật đã có trong `removeSelected()`, `clearBtn` handler, và `exportPdf()`.

## Không làm

- Không cài framework, bundler, package manager, hay bất kỳ dependency runtime nào — dự án dependency-free có chủ đích.
- Không thêm OCR, cloud storage, đăng nhập, database, API AI — xem "Ngoài scope" trong [00-project-overview.md](00-project-overview.md).
- Không thêm build step khiến `index.html` không còn mở được trực tiếp từ static server.

## Test

Không có test runner tự động. Checklist thủ công đầy đủ nằm trong [05-testing-and-deploy.md](05-testing-and-deploy.md) và trong `AGENTS.md` (mục Validation) — chạy `node --check`, kiểm tra JSON hợp lệ, rồi rehearsal chức năng thật trong trình duyệt (import → auto-crop → chỉnh tay → filter → xuất PDF → xác nhận không lật/mirror trang nào).

## Git

- Repo hiện tại: branch `master`, 0 commit, không remote (khởi tạo `git init` cục bộ ngày 2026-08-22).
- Không push thẳng `main`/`master` nếu chưa được yêu cầu rõ ràng — hiện tại chưa có commit nào nên chưa phát sinh tình huống này.
- Không `reset`/`stash`/`clean`/`commit`/`push`/`merge` trừ khi người dùng yêu cầu rõ ràng (quy tắc workspace, xem `D:\04. Github\CLAUDE.md`).
- Commit message ngắn gọn khi được yêu cầu tạo commit, format `type: short description`.

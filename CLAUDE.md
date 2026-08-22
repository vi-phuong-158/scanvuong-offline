# CLAUDE.md — Hướng dẫn cho Claude Code

> Dành riêng cho **Claude Code**. Codex dùng `AGENTS.md`.
> Dự án: **ScanVuông Offline** — quét tài liệu, sửa phối cảnh, xuất PDF hoàn toàn offline, không OCR.

---

## BẮT BUỘC: Đọc trước khi code

Trước khi bắt đầu bất kỳ task nào, đọc **toàn bộ** `docs/brain/`:

```
docs/brain/00-project-overview.md   — mục tiêu, phạm vi V1, trạng thái dự án
docs/brain/01-architecture.md       — stack, cấu trúc thư mục, CODE GRAPH (đồ thị gọi hàm trong app.js)
docs/brain/02-coding-rules.md       — style code, đặt tên, bảo mật, git
docs/brain/03-decisions.md          — các quyết định kỹ thuật đã chốt (vì sao pipeline làm như vậy)
docs/brain/04-current-tasks.md      — gate đang mở (GATE-01), việc không được làm
docs/brain/05-testing-and-deploy.md — lệnh chạy/test thật, không đoán lệnh
docs/brain/06-ai-working-log.md     — nhật ký các lần AI sửa code trước đó
```

**Đặc biệt đọc Code Graph trong `01-architecture.md`** để hiểu đồ thị gọi hàm nội bộ trong
`app.js` (một IIFE duy nhất, không có module) trước khi sửa — nhất là `orderCorners()`,
`homographyCoeffs()` và `FILTER_CSS`, ba điểm mà một thay đổi nhỏ có thể làm PDF xuất ra bị
lật/mirror/sai màu mà không báo lỗi.

## Cài đặt nhanh

Không có bước cài đặt — dependency-free, không `package.json`. Lệnh đầy đủ nằm trong
`docs/brain/05-testing-and-deploy.md`.

```bash
start-windows.bat        # hoặc: python server.py
node --check app.js
```

---

## Sau khi sửa code

**Bắt buộc** thêm một entry vào `docs/brain/06-ai-working-log.md`:

```
## [YYYY-MM-DD] [Tên task]
- **Agent:** Claude Code
- **Thay đổi:** <mô tả ngắn>
- **File đã sửa:** <danh sách file>
- **Lý do:** <vì sao>
- **Kiểm tra:** <cách xác minh hoạt động đúng>
```

## Khi thay đổi kiến trúc / pipeline / cấu trúc file

Nếu thay đổi cách detect góc, công thức homography, cấu trúc `state.pages`, danh sách asset
trong `sw.js`, hay luồng import→export —

→ **Phải cập nhật** `docs/brain/01-architecture.md` (gồm cả **Code Graph**) **VÀ**
`docs/brain/03-decisions.md`.

---

## Ba điều dễ phá vỡ nhất ở đây

1. **Offline và riêng tư là sản phẩm.** Không backend, không upload, không analytics, không
   CDN/webfont, không storage API. Mọi asset phải nằm cục bộ. Thêm bất kỳ điều nào ở trên là
   thay đổi thiết kế cần được duyệt, không phải chi tiết triển khai. Xem đầy đủ ranh giới
   trong `AGENTS.md` (mục "Bảo mật và quyền riêng tư").
2. **Dependency-free theo thiết kế.** Không framework, không bundler, không `package.json`.
   Không tự cài gì — nếu thật sự cần, dừng lại và nêu blocker.
3. **Chạy validation thật trước khi báo PASS.** Lệnh và checklist thật nằm trong
   `docs/brain/05-testing-and-deploy.md` và `AGENTS.md`. Bắt buộc xác nhận PDF xuất ra thật có
   đúng thứ tự trang và không trang nào bị lật/mirror trước khi báo xong việc.

## Quy tắc cứng khác

- Không tự đổi stack nếu chưa ghi lý do vào `docs/brain/03-decisions.md`.
- Không thêm tính năng ngoài scope task (OCR, cloud, login, database, AI API — xem
  [00-project-overview.md](docs/brain/00-project-overview.md)).
- Không reset/stash/clean/commit/push/merge trừ khi được yêu cầu rõ ràng.
- Kiểm tra `docs/brain/04-current-tasks.md` trước khi bắt đầu — có gate nào đang mở
  (`GATE-01`) trùng với việc sắp làm không.

Không lặp lại toàn bộ `AGENTS.md` ở đây — đọc file đó để biết chi tiết kiến trúc, bảo mật và
quy tắc review đầy đủ.

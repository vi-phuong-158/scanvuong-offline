# AGENTS.md — Hướng dẫn cho Codex

> Dành riêng cho **OpenAI Codex**. Claude Code dùng `CLAUDE.md`.
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

**Đặc biệt đọc Code Graph trong `01-architecture.md`** — `app.js` là một IIFE duy nhất nên
Code Graph ở đây là đồ thị gọi hàm nội bộ theo 7 cụm của pipeline
`Image → Detection → Corners → Perspective → Filter → Pages → PDF`. Đọc để biết "sửa hàm X
ảnh hưởng tới đâu" trước khi động vào, đặc biệt là `orderCorners()`, `homographyCoeffs()` và
`FILTER_CSS` — ba điểm mà một thay đổi nhỏ có thể làm PDF xuất ra bị lật/mirror/sai màu.

## Cài đặt nhanh

Không có bước cài đặt — dự án dependency-free, không `package.json`. Lệnh đầy đủ (chạy, test,
deploy) nằm trong `docs/brain/05-testing-and-deploy.md`. Hai lệnh dùng ngay:

```bash
start-windows.bat        # hoặc: python server.py
node --check app.js      # kiểm tra cú pháp trước khi báo xong việc
```

Mở `http://127.0.0.1:8765` (hoặc cổng fallback do `server.py` in ra).

---

## Sau khi sửa code

**Bắt buộc** thêm một entry vào `docs/brain/06-ai-working-log.md`:

```
## [YYYY-MM-DD] [Tên task]
- **Agent:** Codex
- **Thay đổi:** <mô tả ngắn>
- **File đã sửa:** <danh sách file>
- **Lý do:** <vì sao>
- **Kiểm tra:** <cách xác minh hoạt động đúng>
```

## Khi thay đổi kiến trúc / pipeline / cấu trúc file

Nếu thay đổi: cách detect góc, công thức homography, cấu trúc `state.pages`, danh sách asset
trong `sw.js`, hoặc luồng import→export —

→ **Phải cập nhật** `docs/brain/01-architecture.md` (gồm cả **Code Graph**) **VÀ**
`docs/brain/03-decisions.md`. Code Graph lỗi thời còn nguy hiểm hơn không có, vì agent sau sẽ tin nó.

---

## Quy tắc cứng

1. **Không cài dependency, framework, bundler, package manager, plugin hay MCP server nào.**
   Dự án dependency-free có chủ đích ([03-decisions.md](docs/brain/03-decisions.md)) — nếu một
   task thực sự cần dependency mới, dừng lại và nêu rõ blocker thay vì tự cài.
2. **Không thêm bất kỳ network call, storage API (localStorage/sessionStorage/indexedDB/cookie),
   CDN script, hay webfont ngoài nào.** Offline và riêng tư là sản phẩm, không phải chi tiết kỹ
   thuật — xem đầy đủ ở mục "Bảo mật và quyền riêng tư" bên dưới.
3. **Không thêm OCR, cloud storage, đăng nhập, database, hay API AI/LLM.** Đây là quyết định
   phạm vi V1, không phải tính năng thiếu — xem [00-project-overview.md](docs/brain/00-project-overview.md).
4. **Không tự đổi stack** nếu chưa ghi rõ lý do vào `docs/brain/03-decisions.md`.
5. **Không thêm tính năng ngoài scope task** — chỉ làm đúng yêu cầu.
6. **Không xóa code** mà không hiểu vì sao nó tồn tại (đọc `06-ai-working-log.md` trước).
7. **Không reset/stash/clean/commit/push/merge** trừ khi được yêu cầu rõ ràng (quy tắc workspace
   chung, xem `D:\04. Github\CLAUDE.md`).
8. Kiểm tra `docs/brain/04-current-tasks.md` trước khi bắt đầu: task có được phép làm không, có
   đang trùng với gate đang mở (`GATE-01`) không.

## Nguyên tắc code

- Viết code tối thiểu để giải quyết task. Không tính năng speculative.
- Tuân thủ style code hiện tại của dự án (xem [02-coding-rules.md](docs/brain/02-coding-rules.md)).
- Dọn sạch biến/import thừa do mình tạo ra.
- Không abstraction sớm — codebase này cố tình phẳng, một file `app.js` duy nhất.

---

## Bảo mật và quyền riêng tư

Đây là ràng buộc quan trọng nhất của dự án — quan trọng hơn mọi quy tắc code thông thường.

- **Tài liệu chỉ được xử lý cục bộ.** Ảnh đọc bằng File API, xử lý bằng Canvas/WebGL ngay
  trong trang. Không có gì về tài liệu rời khỏi thiết bị.
- **Không upload.** Không backend, không API client, không `fetch`/`XMLHttpRequest`/
  `sendBeacon` trong `app.js`. `fetch` duy nhất trong toàn bộ codebase nằm trong `sw.js` và bị
  giới hạn same-origin cho asset của app.
- **Không telemetry, không analytics.** Không được thêm.
- **Không dependency runtime từ bên ngoài.** Không CDN script, không webfont host, không ảnh
  tải từ xa. Mọi asset app cần đều nằm trong thư mục này. Thêm asset từ xa sẽ phá offline và
  không được phép.
- **Không lưu trữ lâu dài.** Không `localStorage`, `sessionStorage`, `indexedDB`, cookie. Đóng
  tab là tài liệu biến mất. Không thêm persistence nếu chưa có quyết định rõ ràng, vì điều đó
  đồng nghĩa lưu tài liệu người dùng lên đĩa.
- **Object URL phải được thu hồi** (`revokeObjectURL`) khi xoá trang, khi xoá toàn bộ session,
  và sau khi tải PDF xong. Giữ đúng kỷ luật này khi thêm code tạo Object URL mới.
- Secret/config: không có, và không được có.
- Authentication/authorization/RLS: không áp dụng — app không có server, không có tài khoản.
- Chính sách thay đổi production: repo này chỉ chứa file tĩnh. Deploy nằm ngoài phạm vi công
  việc thường xuyên, phải được yêu cầu rõ ràng.

## Validation

Không có test runner, không linter, không bundler, không type checker. Đừng bịa lệnh. Lệnh
thật sự tồn tại:

```text
node --check app.js
node --check sw.js
python -c "import json,io; json.load(io.open('manifest.webmanifest',encoding='utf-8')); json.load(io.open('vercel.json',encoding='utf-8')); print('json ok')"
python -c "import ast,io; ast.parse(io.open('server.py',encoding='utf-8').read()); print('server.py ok')"
python server.py
```

Checklist rehearsal chức năng đầy đủ nằm trong [05-testing-and-deploy.md](docs/brain/05-testing-and-deploy.md).
Không báo `PASS` khi một gate liên quan chưa chạy — xem gate đang mở trong
[04-current-tasks.md](docs/brain/04-current-tasks.md).

## Quy tắc review code

- Kiểm tra tính đúng đắn, phạm vi, ranh giới riêng tư ở trên, và tác động tới tài liệu.
- Coi bất kỳ network call, storage API, asset ngoài, hay dependency mới nào là finding chặn
  merge, trừ khi được yêu cầu rõ ràng.
- Coi thay đổi có thể làm lật/mirror/xoay/sai thứ tự trang PDF là rủi ro cao; yêu cầu bằng
  chứng từ một PDF xuất ra thật.
- Nêu rõ validation còn thiếu và rủi ro chưa xử lý.

## Báo cáo

```text
VERDICT
CHANGED
VALIDATION
RISKS/BLOCKERS
NEXT STEP
```

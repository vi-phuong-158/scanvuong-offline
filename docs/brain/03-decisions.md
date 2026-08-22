# 03 — Technical Decisions

> Ghi lại quyết định kỹ thuật quan trọng để agent sau không "phát minh lại" hoặc đảo ngược
> mà không biết lý do. Mỗi entry: quyết định gì, vì sao, đánh đổi gì.

---

## [gốc dự án, trước audit 2026-08-22] Dependency-free tuyệt đối

- **Quyết định:** Không dùng framework, bundler, package manager, hay bất kỳ thư viện runtime nào. Toàn bộ logic nằm trong một file `app.js` (IIFE), PDF được viết bằng một bộ ghi PDF 1.4 tự viết tay thay vì dùng thư viện PDF có sẵn.
- **Lý do:** Tối đa hoá khả năng chạy offline và tối thiểu hoá bề mặt tấn công/privacy risk — không có dependency nghĩa là không có supply-chain risk, không có gì tải từ CDN có thể phá offline.
- **Đánh đổi:** Code dài hơn, phải tự viết những thứ thư viện thường lo (PDF writer, homography solver, edge detection) — đổi lại zero external risk và không cần build step.
- **Người quyết định:** thiết kế gốc của dự án (trước khi có audit này).

## [gốc dự án] Không OCR

- **Quyết định:** V1 không có OCR hay trích xuất văn bản dưới bất kỳ hình thức nào.
- **Lý do:** OCR chạy trên máy cần một bộ dữ liệu ngôn ngữ lớn, đi ngược mục tiêu "nhẹ, không phụ thuộc". Đây là quyết định phạm vi có chủ đích, không phải tính năng chưa làm xong.
- **Đánh đổi:** App chỉ tạo được PDF dạng ảnh, không tìm kiếm được văn bản trong PDF.
- **Người quyết định:** thiết kế gốc của dự án.

## [2026-08-22] Sửa `orderCorners()` để không bao giờ trả về điểm trùng

- **Quyết định:** Đổi thuật toán sắp xếp 4 góc từ "chọn theo cực trị x+y/x−y cho từng góc riêng lẻ" sang "sắp 4 điểm theo góc quanh trọng tâm rồi chọn điểm bắt đầu gần top-left nhất".
- **Lý do:** Cách cũ có thể trả về cùng một điểm cho hai vai trò góc khác nhau trên một tứ giác xoay (ví dụ ảnh chụp xiên mạnh), làm sập hình dạng tứ giác và khiến hệ phương trình homography không giải được (`solveLinear` ném lỗi hoặc cho kết quả vô nghĩa).
- **Đánh đổi:** Không có — cách mới luôn đúng toán học (luôn là một hoán vị của đầu vào) và không tốn thêm chi phí tính toán đáng kể.
- **Người quyết định:** Claude (phát hiện qua rehearsal chức năng, xác minh bằng test dựng ảnh tổng hợp có góc đánh dấu màu).

## [2026-08-22] Độ tin cậy phát hiện dựa trên sự đồng thuận giữa 2 detector

- **Quyết định:** `detectDocument()` chạy hai detector độc lập (`componentQuad` và `edgeQuad`); độ tin cậy cuối cùng được nâng lên nếu cả hai đồng thuận (lệch <3.5%), và bị giới hạn dưới ngưỡng review (0.58) nếu chỉ một detector cho kết quả hoặc hai detector bất đồng.
- **Lý do:** Test với ảnh nền sáng/tương phản thấp cho thấy một detector đơn lẻ có thể tự tin (điểm số cao) nhưng sai hoàn toàn (trả về toàn khung hình). Yêu cầu sản phẩm rõ ràng: "nếu auto detection không chắc chắn, đánh dấu trang cần kiểm tra; không âm thầm crop sai."
- **Đánh đổi:** Chạy 2 detector tốn thêm ~2x thời gian xử lý mỗi trang so với chạy 1 detector — chấp nhận được vì phát hiện chạy trên canvas nhỏ (≤560px).
- **Người quyết định:** Claude, theo đúng yêu cầu "không crop sai trong im lặng" từ AGENTS.md gốc.

## [2026-08-22] Phạt tứ giác chiếm toàn khung hình trong `componentQuad()`

- **Quyết định:** Nếu tứ giác phát hiện được chiếm >93% khung và chạm sát cả 4 cạnh, hạ độ tin cậy xuống 0.3 thay vì để nguyên điểm số cao.
- **Lý do:** Giấy trắng trên nền sáng khiến ngưỡng Otsu nuốt luôn cả nền — kết quả là "tài liệu" được phát hiện chính là toàn bộ khung hình, với độ tin cậy ban đầu tính ra tới 0.78 (đủ để KHÔNG bị đánh dấu cảnh báo), dẫn tới xuất PDF sai mà không có cảnh báo.
- **Đánh đổi:** Không có — đây là sửa lỗi logic, không đánh đổi gì.
- **Người quyết định:** Claude, phát hiện qua Case C (nền tương phản thấp) trong bộ rehearsal 5 case bắt buộc.

## [2026-08-22] Fallback CPU cho warp phối cảnh khi không có WebGL

- **Quyết định:** Thêm `warpCpu()` — cùng công thức homography, lấy mẫu song tuyến tính (bilinear) bằng JavaScript thuần — dùng khi `getGL()` không tạo được context WebGL. Cache lại trạng thái `glUnavailable` để không thử tạo lại WebGL context mỗi trang.
- **Lý do:** Trước đó, thiết bị/trình duyệt không hỗ trợ WebGL sẽ khiến toàn bộ export thất bại (ném lỗi "Trình duyệt không hỗ trợ WebGL").
- **Đánh đổi:** Đường CPU chậm hơn đường GPU (khoảng 1s/trang so với vài trăm ms), chấp nhận được vì đây là fallback hiếm khi kích hoạt.
- **Người quyết định:** Claude, xác minh hình học giống hệt đường WebGL bằng test tắt WebGL có chủ đích.

## [2026-08-22] `sleepFrame()` không chỉ dựa vào requestAnimationFrame

- **Quyết định:** `sleepFrame()` đua `requestAnimationFrame` với một `setTimeout(40ms)` dự phòng, lấy cái nào chạy trước.
- **Lý do:** `requestAnimationFrame` không bao giờ chạy khi tab ở nền (`document.hidden`) — phát hiện được khi import/export bị treo vĩnh viễn nếu người dùng chuyển tab giữa chừng.
- **Đánh đổi:** Không có — timer dự phòng chỉ kích hoạt khi rAF không chạy kịp.
- **Người quyết định:** Claude.

## [2026-08-22] Service Worker: cache-first kèm refresh nền

- **Quyết định:** Viết lại `sw.js` để phục vụ same-origin GET từ cache trước (mở app tức thì, dùng được offline), đồng thời fetch nền để cập nhật cache — thay vì chỉ cache tĩnh một lần.
- **Lý do:** Bản gốc chỉ cache app shell lúc install và không bao giờ refresh — người dùng quay lại sẽ kẹt mãi ở bản cũ dù có mạng.
- **Đánh đổi:** Không có — vẫn giữ nguyên tắc "mở tức thì kể cả offline", chỉ thêm khả năng tự cập nhật.
- **Người quyết định:** Claude. Mỗi lần đổi asset trong `ASSETS`, bắt buộc tăng version `CACHE` — xem [01-architecture.md](01-architecture.md#lưu-ý-kiến-trúc-quan-trọng).

## [2026-08-22] Đóng băng dữ liệu export bằng snapshot bất biến

- **Quyết định:** `exportPdf()` tạo một snapshot độc lập của `state.pages` (`snapshotPagesForExport()`: `file`, `name`, `corners` clone sâu, `rotation`, `filter`) ngay ở dòng đầu tiên, trước khi gọi `setBusy(true)`. `makeJpegs(settings, pages)` và `renderPageCanvas()` chỉ nhận dữ liệu qua tham số `pages` (snapshot), không bao giờ dereference `state.pages[i]` trong vòng lặp export nữa.
- **Lý do:** Trước đây `makeJpegs()` đọc trực tiếp `state.pages[i]` trong một vòng lặp `await` kéo dài; nếu người dùng đổi thứ tự trang, filter, corners/rotation, hoặc xoá/thêm trang trong lúc export đang chạy, PDF cuối có thể không phản ánh đúng trạng thái tại thời điểm bấm Xuất PDF (sai thứ tự, sai filter, sai crop, hoặc crash do trang bị xoá giữa chừng).
- **Đánh đổi:** Không đáng kể — snapshot chỉ clone các object nhỏ (corners), không clone `File`/Blob bytes (an toàn vì `File` object không tự đổi nội dung).
- **Người quyết định:** Claude, theo yêu cầu audit race-condition trong export flow.

## [2026-08-22] Khoá mọi mutation handler khi `state.busy === true`

- **Quyết định:** Audit toàn bộ event handler có thể thay đổi `state.pages`/corners/filter/rotation/thứ tự trang (thêm ảnh, camera, drag/drop import, reorder thumbnail, move up/down, rotate, delete, clear all, reset crop, detect, auto-detect all, đổi filter, export lần hai) và thêm guard `if (state.busy) return;` trực tiếp trong từng handler — không chỉ dựa vào thuộc tính `disabled` của nút. `setBusy()` cũng disable thêm `clearBtn` và các nút `.filter-chip` (trước đó không nằm trong danh sách disable). Independent review (Codex-style second pass) phát hiện thêm một khoảng hở: `pointerdown` trên `#editorCanvas` guard đúng lúc bắt đầu kéo góc, nhưng `pointermove`/`endCornerDrag` (kết thúc kéo) không tự kiểm tra lại `state.busy` — nếu `busy` chuyển thành `true` giữa lúc đang kéo (ví dụ một thao tác async khác bắt đầu), `pointermove` vẫn ghi tiếp vào `page.corners`. Đã vá bằng cách kiểm tra `state.busy` trong cả `pointermove` (huỷ kéo ngay, đặt lại `dragCorner=-1`) và `endCornerDrag` (không `orderCorners()`/render lại nếu đang busy).
- **Lý do:** `disabled` trên nút không chặn được drag/drop thumbnail (không đi qua thuộc tính `disabled`) và không phải là phòng thủ đáng tin cậy cho mọi code path — cần guard logic ở tầng handler để đảm bảo không có đường nào mutate document trong lúc export/detect đang chạy.
- **Đánh đổi:** Không có — guard là một dòng `if` đơn giản mỗi handler, không thay đổi hành vi khi không busy.
- **Người quyết định:** Claude, theo yêu cầu audit busy-state boundary.

## [2026-08-22] `sw.js`: refresh nền phải gắn với `event.waitUntil()`

- **Quyết định:** Khi `fetch` handler của `sw.js` trả về cached response ngay lập tức, fetch refresh chạy nền (để cập nhật cache cho lần mở sau) được bọc trong `event.waitUntil()` thay vì chạy tự do không ai theo dõi. Tăng `CACHE` lên `scanvuong-v1.0.2` vì thay đổi semantics; `activate` chỉ xoá cache có tiền tố `scanvuong-` khác version hiện tại (thay vì xoá mọi cache khác tên) để tránh rủi ro va chạm tên với cache khác nếu có trong tương lai.
- **Lý do:** Không có `waitUntil`, trình duyệt có thể huỷ service worker ngay sau khi `respondWith()` resolve bằng cached response — refresh nền khi đó có thể không bao giờ hoàn tất, khiến "sw.js tự cập nhật cache khi có mạng" (quyết định trước đó, xem mục "Service Worker: cache-first kèm refresh nền" phía trên) không thực sự hoạt động đáng tin cậy.
- **Đánh đổi:** Không có — hành vi cache-first/offline-first/same-origin/GET-only giữ nguyên hoàn toàn, chỉ sửa lifetime của refresh nền.
- **Người quyết định:** Claude, theo yêu cầu audit service worker lifecycle.

## Template cho entry mới

```
## [YYYY-MM-DD] Tiêu đề quyết định

- **Quyết định:** <mô tả>
- **Lý do:** <vì sao chọn hướng này>
- **Đánh đổi:** <cái gì bị đánh đổi>
- **Người quyết định:** <user / Claude / Codex>
```

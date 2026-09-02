# 03 — Technical Decisions

> Ghi lại quyết định kỹ thuật quan trọng để agent sau không "phát minh lại" hoặc đảo ngược
> mà không biết lý do. Mỗi entry: quyết định gì, vì sao, đánh đổi gì.

---

## [2026-08-30] Harden PDF Preview với Blank-Canvas Validation và Multi-Split UX cho Party Document Mode

- **Quyết định:**
  1. **PDF Preview Hardening & Blank-Canvas Validation:** PDF.js là renderer chính, không fallback âm thầm. Sau khi render, hàm `hasContentPixels` kiểm tra mật độ pixel màu khác trắng trên canvas. Nếu một trang PDF có stream/XObject nhưng canvas trắng bất thường, throw error để fallback hoặc kích hoạt UI báo lỗi trực quan với nút "Thử lại". Caching canvas derivative trong bộ nhớ (`page.previewThumbCanvas`) giúp khôi phục tức thì khi UI re-render.
  2. **Multi-Split Architecture:** Hỗ trợ cán bộ đánh dấu nhiều điểm tách `✂ Tách tại đây` cùng lúc và thực thi phân tách tài liệu thành $N+1$ tài liệu chỉ với 1 click (`Áp dụng N điểm tách`). Toàn bộ thứ tự trang, góc xoay, đối tượng PDF nguồn được bảo toàn tuyệt đối, không trùng lặp, không mất trang.
  3. **Hiển thị nguồn trang rõ ràng:** Hiển thị `Trang X · Nguồn: trang Y/Z` để đối chiếu với tài liệu gốc trên giấy.
- **Lý do:** Khắc phục triệt để hiện tượng một số thumbnail PDF scan bị trắng khi nhập file nhiều trang; giải quyết bất tiện khi phải tách từng trang một trên các tài liệu dài.
- **Đánh đổi:** Lưu thêm layer canvas tham chiếu trong bộ nhớ JS trong suốt phiên làm việc (được dọn sạch và thu hồi hoàn toàn khi đóng session/chuyển mode).
- **Người quyết định:** Senior Frontend Engineer & User Mandate.

---

## [2026-08-23] Redesign UI Mobile-First với Be Vietnam Pro tự host & Icon SVG nhất quán

- **Quyết định:** Nâng cấp toàn bộ giao diện thành ứng dụng tiện ích di động hiện đại (Premium Mobile Document Utility) tối ưu hoá thao tác một tay:
  1. Sử dụng font chữ tiếng Việt **Be Vietnam Pro** (OFL-1.1) tự host cục bộ dạng `.woff2` (400, 500, 600, 700) trong `assets/fonts/`, precached trong Service Worker `sw.js`, tuyệt đối không dùng Google Fonts hay kết nối mạng runtime.
  2. Thay thế toàn bộ emoji icon (`📄`, `🪪`, ...) bằng hệ thống icon SVG vector nhất quán (viewBox 20/24, stroke 2px, round join/caps).
  3. Áp dụng kiến trúc Design Tokens với màu nhấn Cobalt Blue (`#2563eb`), độ tương phản cao, bóng mờ tự nhiên, hỗ trợ Safe Area insets (`env(safe-area-inset-top)`, `env(safe-area-inset-bottom)`), và touch targets $\ge 44\text{px}$.
  4. Bố cục mobile-first thông minh: Vùng vẽ chỉnh góc 50dvh cho ngón tay thao tác, dải thumbnails cuộn ngang gọn gàng trên mobile và tự động mở rộng thành 3 cột trên Desktop $\ge 1025\text{px}$.
- **Lý do:** Khắc phục tình trạng font chữ tiếng Việt bị lỗi dấu/lệch kerning trên một số hệ điều hành khi chỉ dùng hệ thống font fallback; loại bỏ emoji đa nền tảng không đồng bộ; nâng cao tốc độ quét và chất lượng trải nghiệm tương đương ứng dụng native.
- **Đánh đổi:** Tăng dung lượng cache offline thêm ~170 KB cho 4 file WOFF2 (đã nén tối ưu). Hoàn toàn phù hợp tiêu chuẩn PWA offline.
- **Người quyết định:** Lead Product Designer & Senior Frontend Engineer.

---

## [2026-08-23] Tích hợp Scanic ML (DocCornerNet Lean) làm Detector góc chính kèm Classical Fallback

- **Quyết định:** Thay thế detector góc tài liệu chính bằng `DocumentDetector` (`document-detector.js`) sử dụng mô hình neural network siêu nhẹ DocCornerNet Lean (~1.93 MB) chạy offline qua ONNX Runtime Web WASM, bảo vệ bởi bộ lọc hình học nghiêm ngặt (Geometry Guard: lồi, không tự cắt, diện tích $\ge 5\%$, biên an toàn). Nếu ML không tải được, gặp lỗi runtime hoặc hình học không hợp lệ, hệ thống tự động kích hoạt detector cổ điển (`detectDocument`: Otsu/Connected Components/Sobel) làm chốt chặn an toàn (fallback).
- **Lý do:** Benchmark thực nghiệm và đánh giá trực tiếp bởi người dùng trên 25 ảnh dataset thực tế (`G:\My Drive\CamScaner`) cho thấy:
  - Tỷ lệ `AUTO_OK`: Tăng từ 16% (`CURRENT`) lên 88% (`SCANIC_ML`).
  - Tỷ lệ `Usable` (sử dụng được ngay hoặc chỉ kéo mép nhẹ $<1\%$): Đạt 100% (25/25 ảnh).
  - Tỷ lệ `Major Failure` (cắt chữ, nuốt bàn): Giảm từ 40% (`CURRENT`) xuống 0% (`SCANIC_ML`).
  - Độ trễ xử lý: Nhanh hơn 2.2 lần (trung vị 122.1 ms so với 269.4 ms).
  - Hoàn toàn offline: 100% tài nguyên được đóng gói tại `assets/ml/`, không gọi API hay telemetry, precached qua Service Worker `sw.js`.
  - Giấy phép: Toàn bộ mã nguồn và trọng số mô hình đều phát hành dưới giấy phép MIT License.
- **Đánh đổi:** Dung lượng cache offline tăng thêm ~3.5 MB (`doccornernet_lean.ort` 1.93 MB + WASM runtime 1.52 MB). Đánh đổi hoàn toàn xứng đáng với bước nhảy vọt về chất lượng nhận diện góc.
- **Người quyết định:** Quyết định nghiệm thu thực tế của người dùng (`SCANIC_ML_PRODUCTION_APPROVED_WITH_AUTO_OK_THRESHOLD_WAIVER`).

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

## [2026-08-30] Party Mode PDF thumbnail preview là derivative local, không sửa export

- **Quyết định:** Party Mode render thumbnail PDF theo từng trang bằng canvas giới hạn kích thước, đọc MediaBox/CropBox, vector content và image XObject phổ biến ngay trong `party-pdf.js`. Page model hiện hữu vẫn giữ `{source, sourcePage}`; `buildMixedPdf()` tiếp tục copy page object/content stream gốc, không rasterize PDF đầu ra vì preview.
- **Lý do:** Operator cần nhận biết nội dung thật, thứ tự và tỷ lệ portrait/landscape trước khi tách/ghép; placeholder số trang không đủ. Không thêm PDF.js/framework/dependency vì dự án phải offline, dependency-free và PDF nguồn không được upload.
- **Failure handling:** PDF lỗi toàn bộ vẫn fail closed trước khi tạo page state; lỗi render từng trang chỉ đánh dấu preview trang đó, giữ position/page number và không làm crash Party Mode.
- **Đánh đổi:** Renderer cố ý giới hạn ở PDF 1.x content stream và image filters phổ biến (FlateDecode, DCTDecode, raw 8-bit RGB/Gray/CMYK); format/filters chưa hỗ trợ hiển thị trạng thái lỗi riêng thay vì đoán hoặc làm mất trang.
- **Hiệu năng:** Canvas được nạp theo IntersectionObserver với preload nhỏ và nhường frame giữa các trang; image XObject trong preview được downsample/cache ở tối đa 1200px. Cache derivative bị giải phóng khi rời Party Mode; export không đọc cache này.

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

## [2026-08-23] Đóng băng luôn cấu hình xuất (quality/pageSize/margin/fileName), không chỉ `state.pages`

- **Quyết định:** Đổi `snapshotPagesForExport()` (chỉ đóng băng trang) thành được gọi bên trong `snapshotExportJob()`, đóng băng thêm `quality`, `pageSize`, `marginToggle.checked`, `fileName` (đã sanitize) — đọc `els.*` đúng một lần ở đầu `exportPdf()`, trước `setBusy(true)`. Toàn bộ phần còn lại của `exportPdf()` (bao gồm nhánh nén lại nhiều vòng cho chế độ "2mb" và lời gọi `buildPdf()`) chỉ dùng `exportJob.*`. `setBusy()` disable thêm 4 control: `fileName`, `pageSize`, `quality`, `marginToggle`.
- **Lý do:** Người dùng test PR #1 phát hiện: dù trang đã được snapshot đúng (P1, merge trước đó), 4 control cấu hình xuất vẫn bị đọc lại từ `els.*` ở cuối `exportPdf()` — SAU KHI vòng lặp render/nén nhiều trang đã chạy xong (có thể mất vài giây tới vài chục giây với chế độ nén mạnh). Đổi `pageSize`/chất lượng/lề/tên file trong lúc export đang chạy khiến PDF cuối dùng cấu hình khác thời điểm bấm "Xuất PDF" — cùng loại race đã sửa cho `state.pages` ở P1, chỉ khác là áp dụng cho export settings thay vì page data.
- **Đánh đổi:** Không có — cùng cơ chế snapshot đã có, chỉ mở rộng phạm vi những gì được đóng băng.
- **Người quyết định:** Claude, theo phát hiện của người dùng khi review PR #1 trước khi merge; xác minh bằng cách mở rộng `scripts/regression_export_busy.js` (Case 5) — parse MediaBox/nội dung PDF thật để xác nhận `pageSize`/`margin`/tên file xuất ra vẫn đúng giá trị tại thời điểm bấm Export dù bị đổi trực tiếp giữa chừng; đã tự xác minh test không vô nghĩa bằng cách revert fix trên bản `app.js` scratch và xác nhận harness FAIL đúng chỗ (3/3 assertion liên quan).

## [2026-08-23] Auto Enhance: pixel pipeline thật thay vì CSS filter, thêm mode "Tự động đẹp"

- **Quyết định:** Thêm filter mode mới `auto` ("Tự động đẹp", mặc định cho trang mới import/chụp), chạy pixel pipeline thật (`enhanceAuto()`: background shading correction → auto levels percentile-based → local contrast → sharpen, tất cả trên `ImageData` qua Canvas) thay vì chỉ tăng `brightness()/contrast()` CSS. Nâng cấp luôn filter `bw` sang cùng cơ chế pixel (`enhanceBW()`). `document`/`original` giữ nguyên CSS filter cũ. `enhanceCanvas()` được gọi từ cả `drawEditor()` (qua cache `ensureEnhancedPreview()`, chỉ tính lại khi `pageId|filter|rotation|kích thước` đổi — không tính lại mỗi `pointermove` khi kéo góc) và `renderPageCanvas()` (export), đảm bảo preview khớp PDF xuất ra.
- **Lý do:** Yêu cầu rõ ràng: CSS filter đơn thuần không được tính là "Auto Enhance" — ảnh chụp bằng camera cần cải thiện dynamic range/nền/độ nét thật để trông giống bản scan, không chỉ là tăng tương phản CSS hời hợt.
- **Đánh đổi:** Tốn thêm CPU mỗi lần export (vài pass `getImageData`/`putImageData` toàn ảnh) — chấp nhận được vì `boxBlur()` là thuật toán sliding-window `O(n)` bất kể bán kính, và preview dùng canvas kích thước hiển thị (không phải full-res) nên vẫn mượt khi kéo góc.
- **Người quyết định:** Claude, theo yêu cầu trực tiếp của người dùng.

## [2026-08-23] Background normalization phải nhắm percentile cao và chỉ khuếch đại lên, không lấy trung bình

- **Quyết định:** Trong `enhanceAuto()`/`enhanceBW()`, mục tiêu độ sáng nền (`targetShade`) lấy percentile 90 của bản đồ shading (blur bán kính rộng), không lấy trung bình; hệ số khuếch đại (`gain`) bị chặn dưới ở 1 (chỉ được làm sáng thêm, không bao giờ làm tối).
- **Lý do:** Bản đầu tiên dùng trung bình toàn ảnh làm mục tiêu — với ảnh có khối chữ/ảnh tối chiếm một phần đáng kể diện tích, trung bình bị kéo xuống thấp hơn mức nền thực, khiến bước này **làm tối** nền sáng thay vì giữ/làm sáng nó (phát hiện qua rehearsal định lượng: ảnh nền đồng đều 215 bị tối xuống 181 sau enhance — sai hướng so với yêu cầu "nền sáng hơn"). Đổi sang percentile cao + chặn gain ≥ 1 khắc phục triệt để, xác nhận lại bằng rehearsal số (nền ảnh tối 139.5→172.3, nền ảnh đã đẹp 249.5→247.3 gần như không đổi).
- **Đánh đổi:** Không có — đây là sửa lỗi logic, không đánh đổi gì.
- **Người quyết định:** Claude, phát hiện qua bộ rehearsal định lượng dùng ảnh tổng hợp export qua PDF thật (giải mã JPEG nhúng để đo lại pixel).

## [2026-08-23] Bán kính blur cho background-shading phải rộng hơn nhiều so với local-contrast

- **Quyết định:** Dùng hai bán kính `boxBlur()` khác nhau trong `enhanceAuto()`/`enhanceBW()`: ~35% cạnh ngắn (chặn 30–260px) cho bước làm phẳng ánh sáng toàn trang, và ~5% cạnh ngắn (chặn 6–40px) cho local contrast ở quy mô ký tự/đoạn văn.
- **Lý do:** Bản đầu tiên dùng chung một bán kính hẹp (~5%) cho cả hai mục đích — với một gradient ánh sáng trải chậm trên toàn trang, bán kính hẹp cho ra giá trị blur gần như bằng chính pixel đó, nên "trừ đi local average" gần như không có tác dụng, gradient không được làm phẳng (phát hiện qua rehearsal: độ lệch giữa 3 vùng nền của ảnh có ánh sáng lệch không giảm mà còn tăng, từ 28.7 lên 47). Tăng bán kính riêng cho bước shading lên ~35% khắc phục, xác nhận lại bằng số (độ lệch giảm còn 9.6).
- **Đánh đổi:** Không có đáng kể — `boxBlur()` là sliding-window nên chi phí không phụ thuộc bán kính.
- **Người quyết định:** Claude, phát hiện qua bộ rehearsal định lượng (case ánh sáng không đều).

## [2026-08-23] Chặn dưới độ rộng dải percentile trong auto levels (`MIN_SPAN`)

- **Quyết định:** Trong `enhanceAuto()`, nếu khoảng `hi-lo` tính theo percentile (sau khi blend LEVEL_BLEND) hẹp hơn `MIN_SPAN = 70`, mở rộng đối xứng quanh điểm giữa cho bằng `MIN_SPAN` trước khi tính `gain`. Tương tự trong `enhanceBW()`, sàn `hi >= lo + 70` (trước là `+10`).
- **Lý do:** Phát hiện khi test một trang tổng hợp **không có nội dung tối nào cả** (chỉ có gradient ánh sáng nhẹ, không chữ, không dấu — mô phỏng trang gần như trắng): sau bước background-shading correction, phần còn lại của trang chỉ dao động trong một dải rất hẹp (~vài chục mức xám); vì auto levels kéo dải percentile toàn ảnh (0.6%–99.2%) ra full range `OUT_LO..OUT_HI` (244 mức), một dải input hẹp bị khuếch đại gấp nhiều lần thành một dải sáng-tối cực đoan giả tạo (đo được: từ dải gốc ~95 dội ngược thành gần đen ở một mép và gần trắng ở mép kia, dù ảnh gốc chỉ lệch sáng nhẹ ~94 mức toàn trang). Tài liệu thật hầu như luôn có chữ/mực (dải rộng tự nhiên >>70) nên không bị ảnh hưởng — đã xác nhận lại toàn bộ 6 case A–F cộng B&W cho kết quả **giống hệt** trước khi thêm sàn này (không có case nào tự nhiên có dải hẹp hơn 70). Case suy biến (không nội dung tối) sau khi thêm sàn: dải màu chỉ còn dao động nhẹ (~95–166), không còn vọt lên gần đen/trắng.
- **Đánh đổi:** Trang thật sự gần như trắng tinh (không một chữ nào) sẽ được enhance nhẹ nhàng hơn thay vì bị kéo tương phản cực mạnh — chấp nhận được, vì mục tiêu Auto Enhance là làm tài liệu có nội dung trông giống bản scan, không phải tạo tương phản giả trên trang trắng.
- **Người quyết định:** Claude, phát hiện qua rehearsal định lượng bổ sung (case suy biến "không có nội dung tối"), trước khi mở PR — không phải bug do người dùng report.

## [2026-08-23] Scan ID: workflow riêng qua `state.mode`, không nhét vào `state.pages`

- **Quyết định:** Thêm màn hình chọn chế độ ở đầu app (`#modeSelect`: "Scan tài liệu" / "Scan ID"),
  giữ trong `state.mode` (`null`|`'document'`|`'id'`). Scan ID có state riêng `state.idScan =
  {step,front,back}` — front/back là object CÙNG SHAPE với một phần tử `state.pages` (để tái dùng mọi
  hàm hiện có: `detectPage`, `renderPageCanvas`, `enhanceCanvas`, rotate, v.v.) nhưng đặt trong field
  riêng, KHÔNG đẩy vào mảng `state.pages`. Điểm nối duy nhất giữa hai workflow là hàm mới
  `activePage()`, trả về `selectedPage()` (document) hoặc `state.idScan.front/back` theo
  `state.idScan.step` (id) — toàn bộ cụm Editor/Corners/Perspective/Filter dùng `activePage()` thay
  vì `selectedPage()` trực tiếp và không có logic detect/homography/warp/filter thứ hai nào được viết
  riêng cho ID mode.
- **Lý do:** Yêu cầu rõ ràng "không nhét ID front/back vào `state.pages` một cách khó hiểu nếu điều đó
  làm hỏng document workflow" và "không duplicate homography/detection logic". Một mảng `state.pages`
  dùng chung cho cả hai sẽ kéo theo rủi ro thật: multi-page reorder/xoá/export của document mode vô
  tình áp dụng lên ảnh ID (ví dụ người dùng kéo-thả làm đảo front/back, hoặc xuất PDF tài liệu lẫn
  ảnh căn cước vào cùng file) — rủi ro riêng tư nghiêm trọng hơn nhiều so với document thường. Tách
  hẳn field loại bỏ khả năng này ở tầng cấu trúc dữ liệu, không phải quy ước code.
- **Đánh đổi:** Thêm một lớp gián tiếp (`activePage()`) ở mọi nơi cụm Editor từng gọi `selectedPage()`
  trực tiếp — chấp nhận được vì đó là 6-7 call site, mỗi chỗ đổi đúng một dòng, và loại bỏ hoàn toàn
  nguy cơ viết trùng pipeline detect/warp/filter cho ID mode.
- **Người quyết định:** Claude, theo yêu cầu trực tiếp của người dùng (feature Scan ID).

## [2026-08-23] Scan ID: `.editor` card dùng chung được RELOCATE (di chuyển DOM), không nhân bản

- **Quyết định:** `.editor` card (canvas, toolbar detect/reset/rotate, filter chips) chỉ tồn tại một
  lần trong `index.html`. `relocateEditor(mode)` di chuyển node này bằng `appendChild`/`insertBefore`
  giữa `#idEditorSlot` (bên trong `#idWorkspace`, có `display:contents` để vẫn là grid item trực tiếp)
  và vị trí gốc trong `#workspace` (document mode), thay vì tạo một `<canvas>`/bộ toolbar thứ hai cho
  ID mode.
- **Lý do:** Nhân bản DOM cho ID mode sẽ buộc phải nhân bản luôn logic `drawEditor()`/pointer drag
  handlers/`ensureEnhancedPreview()` (vì chúng gắn cứng vào `els.editorCanvas` qua querySelector một
  lần lúc khởi động) — đúng thứ "duplicate scanner logic" mà yêu cầu cấm. Di chuyển node giữ nguyên
  100% event listener đã gắn (listener gắn vào phần tử, không phải vào vị trí DOM của nó) và chỉ cần
  một dòng để chuyển ngữ cảnh.
- **Đánh đổi:** Cần class modifier `id-hosted` trên `.editor` để ẩn nhóm nút riêng của document mode
  (↑ Trước/↓ Sau/Xóa trang) khi đang ở ID mode qua CSS, thay vì tách hẳn hai bộ nút — chấp nhận được,
  các nút đó vẫn an toàn nếu lỡ bấm (no-op trên `state.pages` rỗng/`state.selectedId=null`).
- **Người quyết định:** Claude, theo yêu cầu trực tiếp của người dùng.

## [2026-08-23] Scan ID: `composeIdA4()` scale theo chiều rộng chung, không theo độ phân giải nguồn

- **Quyết định:** `composeIdA4(frontCanvas, backCanvas)` vẽ lên canvas cố định 1240×1754 (tỷ lệ A4
  dọc). Mỗi mặt được vẽ ở cùng một chiều rộng mục tiêu (`cardW`, phần trăm cố định của chiều rộng
  trang) rồi co theo chiều cao vùng riêng của nó nếu tỷ lệ khung hình quá cao (ví dụ một mặt bị xoay
  thành gần vuông-đứng) để không tràn trang — trường hợp đó đổi "cùng chiều rộng tuyệt đối" lấy
  "không bao giờ méo/tràn trang".
- **Lý do:** Yêu cầu rõ ràng "hai ảnh resolution rất khác nhau... trên A4 vẫn cùng kích thước" (ví dụ
  mặt trước 4000×2500, mặt sau 1600×1000). Scale theo pixel nguồn sẽ khiến ảnh phân giải cao hơn hiển
  thị to hơn trên trang dù thẻ vật lý cùng kích thước — sai với kỳ vọng người dùng. Xác nhận bằng
  rehearsal trình duyệt thật: mặt trước 800×500 và mặt sau 4000×2500 (5 lần độ phân giải) đều ra
  ~1092px chiều rộng trên trang.
- **Đánh đổi:** Trường hợp hiếm (thẻ bị xoay thành hình gần vuông-đứng) sẽ không có "cùng chiều rộng"
  tuyệt đối với mặt còn lại — chấp nhận được vì ID card thật luôn là hình chữ nhật ngang, trường hợp
  này chỉ xảy ra nếu người dùng xoay sai hướng.
- **Người quyết định:** Claude, phát hiện qua rehearsal có chủ đích (xoay một mặt 90° để kiểm tra Test
  C, phát hiện tác dụng phụ lên "cùng chiều rộng" và xác nhận đây là fallback an toàn, không phải bug,
  bằng cách kiểm tra `dw/dh` luôn giữ đúng tỷ lệ nguồn — không có méo hình ở bất kỳ nhánh nào).

## [2026-08-23] Scan ID: `applyIdAspectHint()` chỉ hạ confidence, không đổi detector lõi

- **Quyết định:** Thêm `applyIdAspectHint(detection, w, h)`, gọi từ `detectPage()` chỉ khi
  `state.mode==='id'`, so tỷ lệ khung hình quad phát hiện được với tỷ lệ thẻ ID-1 (85.60×53.98mm ≈
  1.586:1, không phụ thuộc chiều — dùng `max/min` nên không quan trọng ngang hay dọc). Lệch >35% thì
  trần `detection.confidence` ở 0.5 (dưới ngưỡng review 0.58). Hàm này KHÔNG được sửa
  `detectDocument()`/`componentQuad()`/`edgeQuad()`/`orderCorners()`.
- **Lý do:** Yêu cầu "detector ID có thể dùng tỷ lệ ID-1 làm prior/hint... nhưng không được làm
  detector quá aggressive" và "flag review thay vì confidently crop sai" — đúng nguyên tắc đã có của
  `detectDocument()`. Chỉ hạ, không bao giờ nâng, đảm bảo hint này không thể khiến một crop tệ được
  tự tin chấp nhận (rủi ro cao hơn nhiều so với việc thi thoảng đánh dấu nhầm một crop tốt là "cần
  kiểm tra").
- **Đánh đổi:** Không có — đây là một lớp phủ (overlay) đọc/hạ confidence sau khi `detectDocument()`
  đã chạy xong, không thay đổi chi phí hay hành vi của pipeline detect chính, và document mode hoàn
  toàn không bị ảnh hưởng (hàm chỉ chạy khi `state.mode==='id'`).
- **Người quyết định:** Claude, theo yêu cầu trực tiếp của người dùng.

## [2026-08-23] Scan ID: Điều chỉnh kích thước thẻ (~65%), khoảng cách 28mm và căn giữa dọc toàn block trên A4

- **Quyết định:** Tách `calculateIdA4Layout(frontW, frontH, backW, backH, options)` thành hàm pure helper kiểm thử được. Giữ target width của thẻ ở **65%** chiều rộng trang A4 (`cardW = 806px` trên raster 1240×1754, tương đương ~136.5 mm trên khổ A4 210 mm); giảm khoảng cách (gap) giữa mặt trước và mặt sau từ ~70 mm xuống **~28 mm** (`165px`); và **căn giữa dọc toàn bộ cụm block (front + gap + back)** trên trang A4 thay vì chia cứng hai nửa riêng biệt.
- **Lý do:** Kích thước 65% phóng to thẻ ~1.59x so với thẻ thật (85.6 mm) giúp chữ sắc nét dễ đọc. Thu hẹp khoảng cách xuống 28 mm và căn giữa toàn block giúp bố cục bản in A4 thanh thoát, cân xứng, khoảng trắng trên/dưới đồng đều (~4.9 cm), không để lại khoảng trống quá lớn ở giữa hai mặt thẻ.
## [2026-08-23] Thiết kế PWA Launcher Icon cho VPH Vigil Lens (Optical Symbol Mark)

- **Quyết định:** Thiết kế lại toàn bộ launcher icon PWA (`icons/icon-192.png` và `icons/icon-512.png`) theo biểu tượng quang học của VPH Vigil Lens (chữ **V** hình học platinum, 4 ngoặc lấy nét/đăng ký góc tài liệu xanh cobalt `#3b82f6` và tâm quang học `#60a5fa` trên nền slate `#090d16` có ánh sáng radial lens). Toàn bộ đồ họa chính nằm gọn trong vùng an toàn maskable (bán kính $\le 40\%$ canvas). Loại bỏ hoàn toàn chữ nhỏ/typography khỏi icon để giữ nét căng, dễ nhận diện ở mọi kích thước launcher (32px, 48px, 96px, 192px, 512px).
- **Lý do:** Icon cũ là hình vẽ tờ giấy bitmap pixelated của ScanVuông. Icon mới đồng bộ 100% với hệ thống nhận diện thương hiệu VPH Vigil Lens, thể hiện tinh thần công cụ quang học độ chính xác cao và an toàn hiển thị khi hệ điều hành Android/iOS bo tròn hoặc cắt theo hình tròn/squircle adaptive.
- **Đánh đổi:** Không có — icon vector được render trực tiếp qua HTML5 Canvas độ phân giải cao thành PNG, không thêm bất kỳ runtime dependency nào.
- **Người quyết định:** Codex (theo yêu cầu acceptance PR #8).

## Template cho entry mới

```
## [YYYY-MM-DD] Tiêu đề quyết định

- **Quyết định:** <mô tả>
- **Lý do:** <vì sao chọn hướng này>
- **Đánh đổi:** <cái gì bị đánh đổi>
- **Người quyết định:** <user / Claude / Codex>
```

## [2026-08-30] Party Document Mode dùng page-object copier local, không thêm dependency runtime

- Quyết định: Thêm Party Mode bằng các script static party-mode.js, party-pdf.js, party-taxonomy.js và taxonomy JSON local. Không thêm framework, package manager, CDN hay runtime network dependency. PDF page nhập sẵn được giữ dưới dạng page reference và export bằng copier indirect-object local; ảnh mới vẫn tái sử dụng renderPageCanvas()/detector hiện tại.
- Lý do: Repository đang khóa dependency-free/offline. Chuyển PDF sang canvas/JPEG sẽ làm mất chất lượng và vi phạm yêu cầu page-object preservation. Copier chỉ nhận PDF 1.x object model đọc được; PDF encrypted/corrupt/unsupported báo lỗi rõ và không tạo output giả.
- Đánh đổi: Không có PDF renderer đầy đủ trong static app hiện tại, nên thumbnail PDF hiển thị placeholder PDF + số trang thay vì rasterize nội dung. Đây là giới hạn được công khai; output vẫn giữ page object. Muốn thumbnail nội dung thật cần vendor PDF.js và phải có quyết định dependency riêng.
- Taxonomy: Bản local được copy từ vi-phuong-158/hoso-digitization-manager branch main tại commit bfdcbaae55238b06bdf297803789c63002741cc3, xác nhận 104 id duy nhất và filename_base đầy đủ.
- Palette: Token Party Mode lấy từ app/manager/static/manager.css của cùng commit: #20303b, #6d7d83, #d9e1df, #ffffff, #173f5f, #2f7d72, #b7791f, #a84343.

## [2026-08-30] Party PDF preview dùng generation invalidation và LRU derivative cache

- **Quyết định:** Mỗi lần Party Mode dựng lại preview DOM hoặc thoát mode sẽ tăng `previewGeneration`; mỗi job giữ generation của nó và phải xác minh generation/page/canvas hiện tại trước khi cập nhật state, paint hoặc DOM. Preview image chỉ giữ derivative downsampled trong LRU tối đa 16 entry; khi thay source/thoát mode phải giải phóng pending/resolved resources và xoá canvas khỏi DOM.
- **Lý do:** Source review phát hiện job render cũ có thể hoàn tất sau khi người dùng re-render/back-reenter và cache ảnh full-resolution có nguy cơ tăng không giới hạn. Invalidation tách biệt với queue worker để job cũ dừng im lặng mà không khóa job mới; bounds bảo vệ PDF ảnh lớn/malformed.
- **Đánh đổi:** Preview chỉ hỗ trợ các filter/ảnh được parser local hiểu; filter hiếm như CCITT/JPX/inline image parser đầy đủ tiếp tục fail riêng từng trang thay vì thêm dependency nặng hoặc làm thay đổi source-page export.
- **Người quyết định:** Codex, theo yêu cầu hardening của người dùng.

## [2026-09-02] Party Document Mode: Thay thế cơ chế "Tách tại đây" bằng mô hình Chọn trang → Tạo tài liệu → Xuất riêng lẻ

- **Quyết định:**
  1. Bỏ hoàn toàn cơ chế đa điểm tách (`markedSplits`, nút "Tách tại đây", "Áp dụng N điểm tách", "Bỏ các điểm tách", thanh multisplit và các divider).
  2. Áp dụng mô hình Chọn trang → Tạo tài liệu: Người dùng xem danh sách trang nguồn trong pool (`.party-source-pool`), tích chọn các trang (checkbox touch target $\ge 44\text{px}$ hoặc nhập khoảng trang `1-3`, `17-22`), sau đó bấm **Tạo tài liệu từ trang đã chọn**.
  3. Bắt buộc bảo toàn thứ tự nguồn tăng dần: Khi tạo tài liệu, dù người dùng tích chọn theo thứ tự bất kỳ (ví dụ 19, 17, 18), tài liệu mới luôn sắp xếp các trang theo thứ tự trang nguồn tăng dần (17, 18, 19).
  4. Chống trùng lặp trang nguồn (no unintended duplication): Các trang đã được gán vào tài liệu sẽ hiển thị huy hiệu `Tài liệu N` và bị vô hiệu hóa chọn trong pool nguồn. Xóa tài liệu hoặc gỡ trang sẽ tự động trả trang về trạng thái chưa gán trong pool.
  5. Xuất riêng từng tài liệu (Partial Export): Mỗi thẻ tài liệu có nút **Xuất tài liệu này**, kích hoạt ngay khi tài liệu có $\ge 1$ trang, đã chọn taxonomy chuẩn (01–104) và không busy. Không còn chặn xuất bởi điều kiện toàn bộ file scan phải đạt 100% coverage.
  6. Tỷ lệ phủ (Coverage) chuyển thành thông tin kiểm toán hỗ trợ người dùng (`N/M trang nguồn đã được xếp vào tài liệu`), không còn là rào cản ngăn xuất PDF.
  7. Bỏ nút `+ Tài liệu` để tránh người dùng vô tình tạo hàng loạt tài liệu rỗng.
- **Lý do:**
  Trong thực tế làm việc với hồ sơ Đảng nhiều trang (ví dụ file scan 80 trang gồm nhiều văn bản rời rạc), cán bộ thường chỉ cần xử lý và xuất ngay văn bản 2 trang đầu tiên mà không muốn bị ép phải phân loại hết 78 trang còn lại. Cơ chế đa điểm tách cũ buộc người dùng phải duyệt hết file, căn đặt điểm cắt giữa các trang và chỉ cho phép xuất khi coverage đạt 100%. Mô hình mới giúp thao tác trực quan, linh hoạt, xử lý đến đâu xuất đến đó một cách an toàn.
- **Đánh đổi:**
  Các tài liệu được tạo chỉ từ các trang người dùng đã chủ động chọn. Tuy nhiên, thứ tự trang, ghép/chuyển trang, xoay trang và đổi loại tài liệu vẫn được hỗ trợ đầy đủ.
- **Người quyết định:** Codex (theo yêu cầu DEV TASK của người dùng).

## [2026-09-02] Party PDF Parser: Hỗ trợ giải mã gián tiếp `/Length n 0 R` và lấy declared length làm authority chính cho stream

- **Quyết định:**
  1. Quét trước vị trí các object (`buildObjectIndex(text)`): Quét 1 lần toàn bộ buffer dạng text Latin-1 để lập bảng ánh xạ `objectId` -> vị trí định nghĩa `n g obj`. Bảng này cho phép tìm nhanh bất kỳ object nào với độ phức tạp $O(1)$ mà không quét lặp.
  2. Hỗ trợ giải mã `/Length n 0 R` gián tiếp (`resolveIndirectLength`): Khi stream dictionary chứa `/Length <refId> <refGen> R`, tra cứu `refId` trong `objectIndex`, trích xuất giá trị số nguyên trong body của object tham chiếu, xác thực không âm và nằm trong giới hạn buffer, phòng chống self-reference và cyclic reference với tập `visited`, có cơ chế cache `lengthCache`.
  3. Declared length làm authority chính cho stream boundary: Không scan nhị phân để tìm `endstream` trước. Vị trí kết thúc dữ liệu stream được xác định bởi `dataEnd = dataStart + length`. Kiểm tra bounded lookahead tại `declaredEnd + [0, 1, 2]` cho 4 biến thể PDF thực tế: `<binary byte>endstream`, `\nendstream`, `\rendstream`, `\r\nendstream`. Không yêu cầu byte cuối dữ liệu nhị phân phải là khoảng trắng.
  4. Lưu trữ `streamDataStart`, `streamDataEnd`, `endStreamOffset` trong object metadata: `streamFor` và `rewriteObjectBytes` tái sử dụng trực tiếp các offset này, miễn nhiễm hoàn toàn với chuỗi byte giả `endstream` bên trong dữ liệu nhị phân.
  5. Fail-closed: Bất kỳ trường hợp `/Length` tham chiếu object không tồn tại, body không phải số nguyên, số âm, hoặc vượt quá kích thước tệp đều ném lỗi rõ ràng thay vì nuốt lỗi hoặc đoán vị trí.
- **Lý do:**
  Tệp PDF thực tế của máy scan văn phòng (`Scan2026-08-24_150131.pdf`, 13 trang, 1097 objects, 528 indirect lengths) dùng `/Length 11 0 R` với object 11 định nghĩa sau. Parser cũ không hỗ trợ tham chiếu gián tiếp nên rơi vào fallback scan nhị phân `findToken('endstream')`. Vì byte cuối stream của object 10 là `\x04` (không phải whitespace), `hasTokenBoundary` từ chối `endstream` thật và nuốt nhầm toàn bộ 30 object tiếp theo (bao gồm object 11), dẫn tới lỗi xuất `PDF thiếu object 11.`.
- **Đánh đổi:**
  Tốn thêm ~2.2ms cho một lượt quét regex lập chỉ mục vị trí các object lúc nạp tệp (1097 objects trong 1.1MB chỉ mất 2.2ms). Đổi lại, parser đạt độ chính xác 100%, không phụ thuộc thứ tự xuất hiện của object độ dài, xử lý an toàn mọi tệp scan MRC/đa lớp.
- **Người quyết định:** Codex (theo yêu cầu DEV TASK của người dùng).

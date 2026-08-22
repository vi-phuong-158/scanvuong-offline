# 01 — Architecture

## Stack

| Layer | Công nghệ |
|-------|-----------|
| Frontend | HTML + CSS thuần + JavaScript ES2020 (một IIFE duy nhất trong `app.js`). Không framework, không bundler, không `package.json`. |
| Xử lý ảnh | Canvas 2D + `createImageBitmap`; warp phối cảnh bằng shader WebGL1, có fallback CPU thuần JS (`warpCpu`) khi không có WebGL. |
| PDF | Bộ ghi PDF 1.4 viết tay trong `app.js` (nhúng ảnh JPEG qua `/DCTDecode`), không dùng thư viện PDF nào. |
| PWA / offline | `manifest.webmanifest` + `sw.js` (Service Worker, cache-first + refresh nền giữ sống bằng `event.waitUntil()`). |
| Backend | Không có. |
| Database | Không có — không `localStorage`/`sessionStorage`/`indexedDB`/cookie. |
| Hạ tầng / Hosting | Chạy local qua `server.py` (Python stdlib, `http.server`) khởi động bởi `start-windows.bat`. `vercel.json` chỉ khai báo header cho trường hợp deploy tĩnh, không bắt buộc để chạy app. |
| Khác | Không có dependency runtime nào — cố ý dependency-free. |

## Cấu trúc thư mục chính

```
scanvuong-offline/
├── index.html            # Toàn bộ DOM; mọi phần tử app.js thao tác đều khai báo ở đây bằng id
├── styles.css             # Layout responsive: desktop / ≤1080px / ≤720px
├── app.js                  # Toàn bộ logic: detect, editor, warp, filter, quản lý trang, PDF writer, PWA glue
├── sw.js                   # Service Worker — cache app shell, phục vụ offline
├── manifest.webmanifest    # Khai báo PWA (tên, icon, display mode, start_url)
├── icons/
│   ├── icon-192.png
│   └── icon-512.png
├── server.py                # Static HTTP server cục bộ (chỉ dùng thư viện chuẩn Python)
├── start-windows.bat        # Launcher Windows: tìm py/python, chạy server.py
├── vercel.json               # Header khi deploy lên host tĩnh (không bắt buộc để chạy local)
├── AGENTS.md / CLAUDE.md      # Hướng dẫn cho AI agent — trỏ tới docs/brain/
└── docs/brain/                 # Bộ nhớ dự án dùng chung (thư mục này)
```

Không có thư mục `src/`, `dist/`, `node_modules/` — mọi thứ nằm phẳng ở gốc vì đây là static site không build.

## Code Graph (bản đồ module)

> `app.js` là một IIFE duy nhất, không có import/require giữa các file JS. Vì vậy "code graph" ở đây là **đồ thị gọi hàm nội bộ trong `app.js`**, chia theo 7 cụm chức năng tương ứng đúng pipeline `Image → Detection → Corners → Perspective → Filter → Pages → PDF`.

### Cụm / hàm then chốt

| Cụm | Hàm chính | Được gọi bởi | Gọi tới |
|---|---|---|---|
| **Import** | `addFiles()` | sự kiện `change` trên `#fileInput`/`#cameraInput`, `drop` trên `#dropZone` | `isSupportedImage()`, `detectPage()`, `sleepFrame()`, `updateShell()` |
| **Detection** | `detectPage()` | `addFiles()`, nút `#detectBtn`, `#autoAllBtn` | `loadImage()`, `drawRotatedToCanvas()`, `detectDocument()` |
| | `detectDocument()` | `detectPage()` | `otsuThreshold()`, `componentQuad()` (light-mode), `edgeQuad()`, `orderCorners()` |
| | `componentQuad()` / `edgeQuad()` | `detectDocument()` | `orderCorners()`, `polygonArea()`, `quadShapeScore()` |
| **Corners** | `orderCorners()` | `detectDocument()`, `endCornerDrag()`, `resetCropBtn`, `rotateCorners90()` | — (thuần toán học, không gọi hàm khác) |
| | `endCornerDrag()` (pointerup/pointercancel trên `#editorCanvas`) | sự kiện con trỏ | `orderCorners()`, `renderThumbs()`, `drawEditor()`, `updateSummaryOnly()` |
| **Editor / preview** | `renderSelected()` | `updateShell()`, khi chọn trang khác | `loadImage()`, `renderConfidenceHint()`, `drawEditor()` |
| | `drawEditor()` | `renderSelected()`, `pointermove`, `resize`, `endCornerDrag()` | dùng `FILTER_CSS`, `rotatedDimensions()` |
| **Perspective** | `homographyCoeffs()` | `homographyFromUnitQuad()` (đường WebGL), `warpCpu()` (đường CPU) | `solveLinear()` |
| | `renderPageCanvas()` | `makeJpegs()` | `loadImage()`, `drawRotatedToCanvas()`, `getGL()`, `homographyFromUnitQuad()`, `warpCpu()` (fallback khi `glUnavailable`) |
| **Filter** | `FILTER_CSS` (bảng hằng, không phải hàm) | `drawEditor()` **và** `renderPageCanvas()` | — |
| **Pages** | `state.pages` (mảng trạng thái trung tâm) | mọi nút sửa trang | `removeSelected()`, `moveSelected()`, `rotateCorners90()`, `renderThumbs()`, `updateShell()` |
| **PDF** | `exportPdf()` | nút `#exportBtn` | `snapshotPagesForExport()`, `makeJpegs()`, `buildPdf()`, `sanitizeFilename()`, `setProgress()` |
| | `snapshotPagesForExport()` | `exportPdf()` (dòng đầu tiên, trước `setBusy(true)`) | `cloneCorners()` |
| | `makeJpegs(settings, pages)` | `exportPdf()`, nhận **snapshot** làm tham số `pages` — không đọc `state.pages` | `renderPageCanvas()`, `canvasToJpeg()`, `sleepFrame()` |
| | `buildPdf()` | `exportPdf()` (qua `makeJpegs()`'s output) | `concatBytes()`, `strBytes()` |
| **PWA glue** | cuối file (ngoài mọi hàm) | tải trang | `navigator.serviceWorker.register('./sw.js')`, `beforeinstallprompt`, `online`/`offline` |

### Luồng xử lý chính

```
[chọn/thả ảnh hoặc chụp ảnh]
        │
        ▼
   addFiles() ──► isSupportedImage() lọc file hợp lệ
        │
        ▼
   detectPage() ──► loadImage() + drawRotatedToCanvas() (canvas làm việc ≤560px)
        │
        ▼
   detectDocument() ──┬─► componentQuad()  (Otsu + connected components)
                       └─► edgeQuad()       (Sobel + percentile threshold)
        │        (chọn candidate mạnh hơn, độ tin cậy điều chỉnh theo mức 2 detector đồng thuận)
        ▼
   orderCorners() ──► góc chuẩn hoá TL/TR/BR/BL, lưu vào page.corners
        │
        ├──(người dùng kéo tay góc)──► pointermove cập nhật preview ──► endCornerDrag() gọi lại orderCorners()
        │
        ▼  (khi bấm Xuất PDF)
   exportPdf() ──► snapshotPagesForExport() (đóng băng file/name/corners/rotation/filter)
                                          │
                                          ▼
                                    makeJpegs(settings, snapshot) ──► renderPageCanvas() ──► homographyCoeffs()
                                          │                                     │
                                          │                           WebGL (getGL) hoặc warpCpu() fallback
                                          ▼
                                    áp FILTER_CSS (cùng bảng dùng cho preview)
                                          ▼
                                    canvasToJpeg()
        ▼
   buildPdf() ──► ghi object/xref/trailer PDF thủ công ──► Blob tải xuống
```

`makeJpegs()`/`renderPageCanvas()` không bao giờ dereference `state.pages[i]` trong lúc export đang chạy — toàn bộ vòng lặp chỉ đọc từ mảng snapshot bất biến được tạo một lần ở đầu `exportPdf()`. Song song, `setBusy(true)` khoá mọi handler có thể mutate `state.pages`/corners/filter/rotation/order (xem mục "Lưu ý kiến trúc quan trọng" bên dưới) — hai lớp phòng thủ độc lập cho cùng một bất biến: "PDF xuất ra phản ánh đúng trạng thái tại thời điểm bấm Xuất".

Song song, ngoài IIFE chính: `navigator.serviceWorker.register('./sw.js')` (bỏ qua nếu `location.protocol === 'file:'`) nạp `sw.js`, file này tự vận hành độc lập (install → cache app shell → activate → fetch cache-first + refresh nền, refresh nền được giữ sống bằng `event.waitUntil()` khi có cached response).

## Mô hình dữ liệu / API

Không có API hay database. Cấu trúc dữ liệu trung tâm là một object trong bộ nhớ (không persist), mỗi phần tử của `state.pages`:

```js
{
  id, file, name, url,        // file gốc + object URL cho thumbnail
  corners: [{x,y}×4],          // toạ độ chuẩn hoá 0–1, thứ tự TL,TR,BR,BL, theo ảnh ĐÃ xoay
  confidence,                   // 0–1, dưới 0.58 thì bị đánh dấu "cần kiểm tra"
  rotation,                     // 0/90/180/270
  filter,                       // 'document' | 'bw' | 'original', khoá vào FILTER_CSS
  width, height                 // kích thước ảnh đã xoay, ghi sau detectPage()
}
```

## Biến môi trường

Không có. Ứng dụng không đọc bất kỳ biến môi trường nào — không `.env`, không secret, không config runtime.

## Lưu ý kiến trúc quan trọng

- **`orderCorners()` phải luôn trả về một hoán vị của đầu vào.** Cách làm cũ (chọn từng góc theo cực trị x+y/x−y) có thể trả về cùng một điểm hai lần trên tứ giác xoay, làm sập hình dạng và khiến homography không giải được — đã sửa bằng cách sắp theo góc quanh trọng tâm. Xem quyết định trong [03-decisions.md](03-decisions.md).
- **Nhãn góc (TL/TR/BR/BL) chỉ được tính lại khi kết thúc kéo** (`pointerup`/`pointercancel`), không phải mỗi `pointermove` — nếu không, tay cầm có thể "nhảy" ra khỏi ngón tay giữa chừng kéo.
- **`sleepFrame()` không được chỉ dựa vào `requestAnimationFrame`** — rAF không bao giờ chạy khi tab ẩn (background), sẽ treo vĩnh viễn các vòng lặp dài (`addFiles`, `makeJpegs`). Hàm này đua rAF với một `setTimeout` dự phòng.
- **`componentQuad()` phải phạt nặng tứ giác chiếm toàn khung hình** — nền sáng dưới giấy sáng khiến ngưỡng Otsu nuốt luôn cả nền, trả về "tài liệu" là toàn bộ ảnh với độ tin cậy cao nếu không có phạt này.
- **Độ tin cậy dựa trên sự đồng thuận giữa 2 detector độc lập** (`componentQuad` và `edgeQuad`), không chỉ dựa vào điểm số của detector thắng — một detector đơn lẻ hoặc hai detector bất đồng sẽ bị giới hạn dưới ngưỡng review (0.58) để trang được đánh dấu thay vì bị cắt sai trong im lặng.
- **`FILTER_CSS` là một bảng dùng chung** cho cả preview trong editor và canvas xuất PDF — tách bảng ra hai chỗ khác nhau sẽ khiến "cái người dùng thấy" khác "cái được xuất ra".
- **`warpCpu()` phải cho kết quả hình học giống hệt đường WebGL** (đã xác minh bằng test tắt WebGL) — đây là fallback bắt buộc phải đúng, không phải "best effort".
- **Mỗi khi sửa danh sách asset trong `ASSETS` của `sw.js`, phải tăng version của hằng `CACHE`** — nếu không, người dùng cũ vẫn kẹt ở app shell cache cũ.
- Không có cơ chế race condition đáng lo vì không có state ngoài bộ nhớ tab; rủi ro duy nhất là các Promise bất đồng bộ (`loadImage`, `renderPageCanvas`) chạy chồng khi người dùng thao tác rất nhanh — `state.renderToken` trong `renderSelected()` dùng để huỷ kết quả cũ.
- **`exportPdf()` phải luôn snapshot `state.pages` (`snapshotPagesForExport()`) trước khi gọi `setBusy(true)`**, và `makeJpegs()`/`renderPageCanvas()` chỉ nhận dữ liệu qua tham số `pages`, không bao giờ đọc `state.pages` trực tiếp trong vòng lặp export. `corners` phải clone sâu (`cloneCorners()`) vì đó là mảng object UI có thể mutate sau khi snapshot đã chụp; `file` không cần clone vì bản thân `File` object không đổi.
- **Mọi handler có thể mutate `state.pages`/corners/filter/rotation/thứ tự trang phải tự guard bằng `if (state.busy) return;` ngay trong handler**, không được chỉ dựa vào thuộc tính `disabled` của nút — drag/drop thumbnail và một số code path khác không đi qua `disabled`. `setBusy()` vẫn toggle `disabled` cho các nút liên quan (kể cả `clearBtn` và các `.filter-chip`) để UI phản hồi rõ ràng, nhưng đó chỉ là lớp UX, không phải cơ chế chặn chính.
- **`sw.js`: refresh nền khi có cached response phải bọc trong `event.waitUntil()`** — nếu không, trình duyệt có thể huỷ service worker giữa chừng refresh (ngay sau khi `respondWith()` đã resolve bằng cached response), khiến cache không bao giờ thực sự được cập nhật cho lần mở sau.

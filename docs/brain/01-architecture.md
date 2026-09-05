# 01 — Architecture

## Stack

| Layer | Công nghệ |
|-------|-----------|
| Frontend | HTML + CSS thuần + JavaScript ES2020 (`app.js` và `document-detector.js`). Không framework, không bundler, không `package.json`. |
| Xử lý ảnh & ML | Nhận diện góc tự động bằng mô hình neural network DocCornerNet Lean chạy qua ONNX Runtime Web WASM (`document-detector.js` + `assets/ml/`), kèm fallback classical CV (`detectDocument` trong `app.js`). Xử lý ảnh bằng Canvas 2D + `createImageBitmap`; warp phối cảnh bằng shader WebGL1, có fallback CPU thuần JS (`warpCpu`). |
| PDF | Bộ ghi PDF 1.4 viết tay trong `app.js` (nhúng ảnh JPEG qua `/DCTDecode`), không dùng thư viện PDF nào. |
| PWA / offline | `manifest.webmanifest` + `sw.js` (Service Worker, cache-first + precache toàn bộ assets ML phục vụ 100% offline). |
| Backend | Không có. |
| Database | Không có — không `localStorage`/`sessionStorage`/`indexedDB`/cookie. |
| Hạ tầng / Hosting | Chạy local qua `server.py` (Python stdlib, `http.server`) khởi động bởi `start-windows.bat`. `vercel.json` chỉ khai báo header cho trường hợp deploy tĩnh, không bắt buộc để chạy app. |
| Khác | Toàn bộ tài nguyên và mô hình ML đóng gói cục bộ trong repo — 100% offline, zero network telemetry. |

## Cấu trúc thư mục chính

```
scanvuong-offline/
├── index.html            # Toàn bộ DOM; mọi phần tử app.js thao tác đều khai báo ở đây bằng id
├── styles.css             # Layout responsive: desktop / ≤1080px / ≤720px
├── app.js                  # Toàn bộ logic: editor, warp, filter, quản lý trang, PDF writer, PWA glue
├── document-detector.js    # Detector module: lazy ML runtime, geometry guard, classical fallback
├── party-mode.js           # Workflow quản lý tài liệu Đảng
├── party-pdf.js            # Engine PDF nhị phân local: bóc tách/copy page object, decompress, watermark stripper
├── party-taxonomy.js       # Danh mục 104 loại văn bản tài liệu Đảng
├── watermark-mode.js       # Workflow bóc tách watermark CamScanner lossless
├── pdf-compress.js         # Engine nén PDF thích ứng theo dung lượng mục tiêu (dùng chung)
├── compress-mode.js        # Workflow "Giảm dung lượng PDF" — UI only, gọi pdf-compress.js
├── assets/
│   ├── fonts/              # Typography tiếng Việt cục bộ (100% offline)
│   │   ├── BeVietnamPro-Regular.woff2    # 400 Regular
│   │   ├── BeVietnamPro-Medium.woff2     # 500 Medium
│   │   ├── BeVietnamPro-SemiBold.woff2   # 600 SemiBold
│   │   └── BeVietnamPro-Bold.woff2       # 700 Bold
│   ├── ml/                 # Tài nguyên ML cục bộ (100% offline)
│   │   ├── doccornernet_lean.ort          # Trọng số mô hình DocCornerNet Lean (1.93 MB)
│   │   ├── ort-wasm-simd-threaded.wasm    # ONNX Runtime Web WASM binary (1.52 MB)
│   │   ├── ort-wasm-simd-threaded.mjs     # Emscripten WASM loader
│   │   └── scanic-ort.wasm.min.js         # ONNX Runtime Web JS API
│   ├── party/              # Danh mục tài liệu Đảng JSON canonical
│   │   └── document_types.json
│   └── vendor/pdfjs/       # PDF.js 5.7.284 vendor nội bộ để render thumbnail PDF
├── sw.js                   # Service Worker — cache app shell, assets ML và font, phục vụ offline
├── manifest.webmanifest    # Khai báo PWA (tên, icon, display mode, start_url)
├── icons/
│   ├── icon-192.png
│   ├── icon-512.png
│   └── vector-bua-liem-5.png
├── server.py                # Static HTTP server cục bộ (chỉ dùng thư viện chuẩn Python)
├── start-windows.bat        # Launcher Windows: tìm py/python, chạy server.py
├── vercel.json               # Header khi deploy lên host tĩnh (không bắt buộc để chạy local)
├── THIRD_PARTY_NOTICES.md   # Giấy phép và xuất xứ các thành phần bên thứ ba (MIT)
├── AGENTS.md / CLAUDE.md      # Hướng dẫn cho AI agent — trỏ tới docs/brain/
└── docs/brain/                 # Bộ nhớ dự án dùng chung (thư mục này)
```

Không có thư mục `src/`, `dist/`, `node_modules/` — mọi thứ nằm phẳng ở gốc vì đây là static site không build.

## Code Graph (bản đồ module)

> `app.js` và `document-detector.js` là các script độc lập chạy trong trình duyệt mà không cần bundler. Code graph dưới đây là **đồ thị gọi hàm nội bộ**, chia theo các cụm chức năng tương ứng đúng pipeline `Image → Detection → Corners → Perspective → Filter → Pages → PDF`.

### Cụm / hàm then chốt

| Cụm | Hàm chính | Được gọi bởi | Gọi tới |
|---|---|---|---|
| **Import** | `addFiles()` | sự kiện `change` trên `#fileInput`/`#cameraInput`, `drop` trên `#dropZone` | `isSupportedImage()`, `detectPage()`, `sleepFrame()`, `updateShell()` — ảnh nào `detectPage()` ném lỗi giải mã thì bị **loại khỏi `state.pages`** ngay tại bước import, không để lại trang hỏng |
| **Decode** | `loadImage()` | `detectPage()`, `renderSelected()`, `renderPageCanvas()` | `sniffImageSize()`, `sniffImageMime()`, `decodeBitmap()`, `decodeElement()`; ném `ImageDecodeError` khi mọi bậc thang đều thất bại |
| | `decodeBitmap()` | `loadImage()` | `createImageBitmap()` với nhiều tổ hợp option (`imageOrientation`, `resizeWidth`), trả `null` thay vì ném |
| | `decodeElement()` | `loadImage()` | `new Image()` + `decode()`/`onload` (đua với nhau — `decode()` chỉ được thắng sớm, không được làm hỏng) |
| | `releaseImage()` | `detectPage()`, `renderSelected()`, `renderPageCanvas()`, `#switchModeBtn` | `ImageBitmap.close()` + `URL.revokeObjectURL()` của Object URL tạm do `loadImage()` cấp — **nơi duy nhất** được thu hồi URL đó |
| **Detection** | `detectPage()` | `addFiles()`, `addIdFile()`, nút `#detectBtn`, `#autoAllBtn` | `loadImage()`, `drawRotatedToCanvas()`, `DocumentDetector.detect()`, `releaseImage()` — **hai miền lỗi tách biệt bằng try/catch lồng nhau**: lỗi từ `loadImage()` (giải mã ảnh thật) luôn được ném ra ngoài cho caller; lỗi từ khối `drawRotatedToCanvas()`+`DocumentDetector.detect()`/`detectDocument()`+`applyIdAspectHint()` (canvas render, ML/WASM, CV) bị bắt **tại chỗ**, không bao giờ thoát ra ngoài — ảnh coi như vẫn giải mã tốt, chỉ hạ về khung cắt toàn khung mặc định với `page.detectorSource = 'DETECTION_ERROR_FALLBACK'` và `confidence = 0.55` (dưới ngưỡng 0.58 nên tự động được đánh dấu cần kiểm tra). Đây là ranh giới cố ý: một lỗi trong bước nhận diện góc không bao giờ được phép hiện thành thông báo "Không đọc được ảnh này" |
| | `DocumentDetector.detect()` | `detectPage()` | `detectMl()`, `validateGeometry()`, fallback sang `detectDocument()` |
| | `detectMl()` | `DocumentDetector.detect()` | `initMlSession()`, `preprocessToTensor()`, session inference, `validateGeometry()` |
| | `detectDocument()` (fallback) | `DocumentDetector.detect()` | `otsuThreshold()`, `componentQuad()` (light-mode), `edgeQuad()`, `orderCorners()` |
| | `componentQuad()` / `edgeQuad()` | `detectDocument()` | `orderCorners()`, `polygonArea()`, `quadShapeScore()` |
| **Corners** | `orderCorners()` | `detectDocument()`, `endCornerDrag()`, `resetCropBtn`, `rotateCorners90()` | — (thuần toán học, không gọi hàm khác) |
| | `endCornerDrag()` (pointerup/pointercancel trên `#editorCanvas`) | sự kiện con trỏ | `orderCorners()`, `renderThumbs()`, `drawEditor()`, `updateSummaryOnly()` |
| **Editor / preview** | `renderSelected()` | `updateShell()`, khi chọn trang khác | `loadImage()`, `renderConfidenceHint()`, `drawEditor()` |
| | `drawEditor()` | `renderSelected()`, `pointermove`, `resize`, `endCornerDrag()` | dùng `FILTER_CSS`, `rotatedDimensions()` |
| **Perspective** | `homographyCoeffs()` | `homographyFromUnitQuad()` (đường WebGL), `warpCpu()` (đường CPU) | `solveLinear()` |
| | `renderPageCanvas()` | `makeJpegs()` | `loadImage()`, `drawRotatedToCanvas()`, `getGL()`, `homographyFromUnitQuad()`, `warpCpu()` (fallback khi `glUnavailable`), `enhanceCanvas()` (khi filter thuộc `PIXEL_FILTERS`) |
| **Filter** | `FILTER_CSS` (bảng hằng) | `drawEditor()` **và** `renderPageCanvas()` — chỉ dùng cho `document`/`original` | — |
| | `PIXEL_FILTERS` (`Set('auto','bw')`) + `enhanceCanvas()` | `drawEditor()` (qua `ensureEnhancedPreview()`) **và** `renderPageCanvas()` | `enhanceAuto()` hoặc `enhanceBW()` → `computeLuma()`, `channelHistogram()`, `histPercentile()`, `boxBlur()` |
| | `ensureEnhancedPreview()` | `drawEditor()` | `drawRotatedToCanvas()`, `enhanceCanvas()` — cache theo key `pageId|filter|rotation|kích thước hiển thị`, chỉ tính lại khi key đổi (không tính lại mỗi `pointermove` khi kéo góc) |
| **Pages** | `state.pages` (mảng trạng thái trung tâm) | mọi nút sửa trang | `removeSelected()`, `moveSelected()`, `rotateCorners90()`, `renderThumbs()`, `updateShell()` |
| **PDF** | `exportPdf()` | nút `#exportBtn` | `snapshotExportJob()`, `makeJpegs()`, `buildPdf()`, `setProgress()` |
| | `snapshotExportJob()` | `exportPdf()` (dòng đầu tiên, trước `setBusy(true)`) | `snapshotPagesForExport()`, `sanitizeFilename()`, đọc `els.quality/pageSize/marginToggle/fileName` **một lần duy nhất** |
| | `snapshotPagesForExport()` | `snapshotExportJob()` | `cloneCorners()` |
| | `makeJpegs(settings, pages)` | `exportPdf()`, nhận **snapshot** làm tham số `pages` — không đọc `state.pages` | `renderPageCanvas()`, `canvasToJpeg()`, `sleepFrame()` |
| | `buildPdf()` | `exportPdf()` (qua `makeJpegs()`'s output, dùng `exportJob.pageSize`/`exportJob.margin`) | `concatBytes()`, `strBytes()` |
| **PWA glue** | cuối file (ngoài mọi hàm) | tải trang | `navigator.serviceWorker.register('./sw.js')`, `beforeinstallprompt`, `online`/`offline` |
| **Mode select** | `enterMode()` / `renderModeShell()` | `#modeDocBtn`/`#modeIdBtn` click, `#switchModeBtn` click | `relocateEditor()`, `updateShell()` (document) hoặc `updateIdShell()` (id) |
| | `leaveActiveModeWithConfirm()` | `#switchModeBtn` click, Help's quick-start shortcuts (`#helpGotoDocBtn` v.v.) | Xác nhận (`confirm()`) khi có dữ liệu dở dang rồi dọn dẹp mode hiện tại + `state.mode = null` + `renderModeShell()`; trả về `false` nếu người dùng từ chối — **logic dùng chung duy nhất** để rời một mode, tách ra từ `#switchModeBtn`'s handler cũ để Help tái sử dụng chứ không tự chế một đường tắt bỏ qua xác nhận |
| **Global Help** (`docs/brain/03-decisions.md`, mục "Hướng dẫn là cross-application support surface") | `openHelp(sectionId?)` / `closeHelp()` | `#helpBtn` (topbar, hiện ở MỌI màn hình, không riêng mode-select), `#partyHelpLinkEmpty`/`#partyHelpLinkToolbar` (Party), `#helpClose`, click ra ngoài `#helpDialog` | `els.helpDialog.showModal()`/`.close()`; khi có `sectionId`, mở `<details>` tương ứng (`$('#'+sectionId)`) và `scrollIntoView()` — **không bao giờ đọc/ghi `state.mode`** ngoại trừ qua `leaveActiveModeWithConfirm()` khi một quick-start shortcut yêu cầu chuyển thẳng vào một mode |
| | `helpGotoDocBtn`/`helpGotoIdBtn`/`helpGotoPartyBtn`/`helpGotoWatermarkBtn` | click bên trong `#helpDialog`'s Quick-start | `closeHelp()` → `leaveActiveModeWithConfirm()` → `enterMode(mode)` nếu không bị từ chối |
| **ID mode** | `activePage()` | mọi chỗ trong Editor/Corners/Filter cluster (`drawEditor`, `renderSelected`, pointer handlers, `detectBtn`/`resetCropBtn`/`rotateBtn`, filter-chip handler) — thay `selectedPage()` | `selectedPage()` (document) hoặc `state.idScan.front/back` theo `state.idScan.step` (id) |
| | `addIdFile()` | `#idFileInput`/`#idCameraInput` change | `isSupportedImage()`, `detectPage()` (dùng chung với document), `renderModeShell()` — ảnh không giải mã được bị **gỡ khỏi `state.idScan[step]`** ngay tại bước chụp, wizard đứng nguyên tại mặt đó nên không thể đi tiếp tới preview/Xuất PDF với một mặt hỏng |
| | `applyIdAspectHint()` | `detectPage()`, chỉ khi `state.mode==='id'` | chỉ đọc/hạ `detection.confidence`, không đổi `orderCorners()`/`detectDocument()` |
| | `calculateIdA4Layout()` | `composeIdA4()` | pure layout geometry helper (tính toạ độ/kích thước front/back trên A4, target width ~65%) |
| | `composeIdA4()` | `exportIdPdf()`, `renderIdPreview()` | gọi `calculateIdA4Layout()`, thuần canvas 2D, không gọi lại detect/homography |
| | `exportIdPdf()` | `#idExportBtn` click | `renderPageCanvas()` ×2 (front, back — **dùng chung** với document export), `composeIdA4()`, `canvasToJpeg()`, `buildPdf()` (dùng chung) |
| | `renderIdPreview()` | `updateIdShell()` khi `step==='preview'` | `renderPageCanvas()` ×2 (maxEdge thấp hơn), `composeIdA4()`; lỗi được hiển thị ở `#idExportNotice` thay vì để lại khung xem trước trống |
| **Watermark Stripper** | `detectCamScannerWatermarks()` | `stripWatermarks()` | phân tích XObjects trong `Resources`, kiểm tra kích thước/tỷ lệ logo, giải nén Content Stream qua `inflateSync` kiểm tra toạ độ `cm` ở dải lề dưới |
| | `stripWatermarkFromContentStream()` | `copyPageObjects()` (khi `stripWatermarks: true`) | regex & token stripping loại bỏ khối `q ... cm /ImX Do Q` |
| | `stripWatermarks()` | `watermark-mode.js` (`processPdfFile`) | `sourceFromBuffer()`, `detectCamScannerWatermarks()`, `copyPageObjects()`, `buildPdf()`, trả về kết quả hoặc fail-safe tệp gốc |
| | `VigilLensWatermark` | `#watermarkChooseBtn`, drag-drop, `enterMode('watermark')` | `PartyPdf.stripWatermarks()`, render thống kê kết quả, tải file PDF sạch, thu hồi Object URL |
| **Giảm dung lượng PDF** | `PdfCompress.compressPdf()` | `VigilLensCompress` (`compress-mode.js`), `party-mode.js`'s `#partyLargeCompressBtn` handler | `PartyPdf.sourceFromBuffer()` (parse), `renderRound()` → `renderCompressionPage()` → `PartyPdf.renderThumbnail()` (dùng lại renderer PDF.js-kèm-fallback-cổ-điển của Party Mode, không tự bootstrap PDF.js riêng) → `encodePage()` (canvas→JPEG) → `buildCompressedPdf()` (`PartyPdf.buildPdf([], items)`) → `verifyTarget()`, lặp qua `resolveRounds()` cho tới khi đạt target hoặc hết rounds |
| | `resolveRounds(options)` | `compressPdf()`, `scripts/regression_pdf_compress.cjs` | thuần hàm: `options.rounds` tường minh, hoặc `ROUNDS` (+`BEYOND_FLOOR_ROUNDS` chỉ khi `options.allowBeyondFloor===true`) — nơi DUY NHẤT quyết định có vượt quality floor hay không |
| | `VigilLensCompress` | `#modeCompressBtn`, `enterMode('compress')`, drop-zone `#compressDropZone` | `PdfCompress.inspectPdf()` (hiện tên/số trang/dung lượng), `PdfCompress.compressPdf()`, tải kết quả, không chứa logic nén |
| | Party Mode `>20MB` dialog | `exportSingleDocument()` khi `result.blob.size > 20.000.000 byte` | `openLargeFileDialog()` → `#partyLargeOriginalBtn` (tải đúng blob lossless đã có, không đổi) hoặc `#partyLargeCompressBtn` (gọi thẳng `PdfCompress.compressPdf()`, KHÔNG có bản sao logic nén trong `party-mode.js`) |

### Luồng xử lý chính

```
[chọn/thả ảnh hoặc chụp ảnh]
        │
        ▼
   addFiles() ──► isSupportedImage() lọc file hợp lệ
        │
        ▼
   detectPage() ──► loadImage() (thang giải mã, xem cụm Decode) + drawRotatedToCanvas() (canvas làm việc ≤560px)
        │
        ▼
   DocumentDetector.detect() ──┬─► Scanic ML (DocCornerNet Lean ONNX WASM)
                               │   ├─► validateGeometry() (lồi, không tự cắt, diện tích ≥5%)
                               │   └─► Thành công: trả về 4 góc ML TL/TR/BR/BL
                               │
                               └─► Fallback khi ML lỗi / hình học không hợp lệ:
                                   detectDocument() ──┬─► componentQuad() (Otsu + connected components)
                                                      └─► edgeQuad()      (Sobel + percentile)
        │
        ▼
   orderCorners() ──► góc chuẩn hoá TL/TR/BR/BL, lưu vào page.corners
        │
        ├──(người dùng kéo tay góc)──► pointermove cập nhật preview ──► endCornerDrag() gọi lại orderCorners()
        │
        ▼  (khi bấm Xuất PDF)
   exportPdf() ──► snapshotExportJob() (đóng băng pages qua snapshotPagesForExport() VÀ
                    quality/pageSize/margin/fileName — đọc els.* đúng MỘT lần, ở đây)
                                          │
                                          ▼
                                    makeJpegs(settings, exportJob.pages) ──► renderPageCanvas() ──► homographyCoeffs()
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

### Auto Enhance pixel pipeline (`enhanceAuto`/`enhanceBW`)

Filter `auto` ("Tự động đẹp", mặc định cho trang mới) và filter `bw` ("Đen trắng") không dùng
CSS filter — chúng chạy xử lý pixel thật qua `enhanceCanvas(canvas, mode)`, được gọi từ **cả**
`drawEditor()` (preview, qua cache `ensureEnhancedPreview()`) **và** `renderPageCanvas()` (export),
đảm bảo "preview = export". `document`/`original` vẫn dùng `FILTER_CSS` như cũ.

`enhanceAuto()` chạy theo thứ tự (thứ tự này quan trọng — xem lý do trong
[03-decisions.md](03-decisions.md)):

1. **Background/shading correction** (`boxBlur` bán kính rộng, ~35% cạnh ngắn): ước lượng ánh
   sáng nền bằng blur bán kính lớn, lấy percentile 90 làm mục tiêu (không lấy trung bình — trung
   bình bị nội dung tối kéo xuống), chỉ khuếch đại lên (`gain` chặn dưới ở 1) để không bao giờ
   làm tối vùng đã sáng.
2. **Auto levels**: percentile-based stretch từng kênh R/G/B (0.6%–99.2%), trộn với mức chung
   theo luma (`LEVEL_BLEND`) để không làm lệch màu con dấu đỏ/mực màu.
3. **Local contrast**: unsharp mask bán kính hẹp hơn (~5% cạnh ngắn), ở quy mô đoạn văn/ký tự.
4. **Sharpen**: unsharp mask bán kính 1px, biên độ nhỏ để không tạo halo/nhiễu.

`enhanceBW()` theo cùng logic (grayscale → percentile stretch → chia cho nền cục bộ bán kính
rộng để làm phẳng ánh sáng không đều → sharpen nhẹ), không nhị phân hoá cứng để giữ nét mảnh.

`boxBlur()` là box blur tách trục kiểu sliding-window (`O(n)` **bất kể bán kính**), nên dùng
bán kính lớn cho bước 1 không tốn thêm chi phí đáng kể so với bán kính nhỏ ở bước 3.

**Đã kiểm chứng bằng số** (xem `06-ai-working-log.md` để biết cách đo): nền sáng lên khi ảnh tối
(case B: 139.5→172.3), nền đồng đều hơn khi ánh sáng lệch (case C: độ lệch giữa 3 vùng nền
28.7→9.6), không làm xấu ảnh đã đẹp (case F: nền/tương phản gần như giữ nguyên, tỉ lệ clip
<0.2%), giữ màu con dấu đỏ (case D: kênh R cao hơn G/B trung bình ~206 điểm sau xử lý).

### ID mode (Scan ID: mặt trước + mặt sau → 1 trang A4)

Workflow độc lập với document mode, chọn ở màn hình bắt đầu (`#modeSelect`) và giữ trong
`state.mode` (`null` | `'document'` | `'id'` | `'party'` | `'watermark'` | `'compress'`):

```
[chọn "Scan ID"]
        │
        ▼
   state.idScan.step = 'front'
        │  (Chọn ảnh / Chụp ảnh → addIdFile())
        ▼
   detectPage(front) ──► applyIdAspectHint() (chỉ hạ confidence nếu tỷ lệ quá lệch ID-1)
        │  (chỉnh tay 4 góc / xoay 90° / đổi filter — DÙNG CHUNG editor với document mode)
        │  (Xác nhận mặt trước)
        ▼
   state.idScan.step = 'back' ──► lặp lại y hệt cho mặt sau
        │  (Xác nhận mặt sau)
        ▼
   state.idScan.step = 'preview' ──► renderIdPreview():
        renderPageCanvas(front) + renderPageCanvas(back) ──► composeIdA4() ──► vẽ preview canvas
        │  (Xuất PDF)
        ▼
   exportIdPdf(): snapshot state.idScan MỘT LẦN (như snapshotExportJob() bên document)
        ──► renderPageCanvas(job.front), renderPageCanvas(job.back)   [HÀM DÙNG CHUNG, không viết lại]
        ──► composeIdA4(frontCanvas, backCanvas)                     [canvas 1240×1754, A4 portrait]
        ──► canvasToJpeg() ──► buildPdf([...], 'a4', false)          [HÀM DÙNG CHUNG]
         ──► PDF 1 trang, tên mặc định "VigilLens-ID.pdf"
```

Nguyên tắc thiết kế then chốt (đã kiểm chứng bằng regression + rehearsal trình duyệt thật, xem
`06-ai-working-log.md`):

- **Không có scanner/detector/homography thứ hai.** `activePage()` là điểm nối DUY NHẤT giữa hai
  workflow: nó trả về `selectedPage()` (document) hoặc `state.idScan.front`/`.back` theo
  `state.idScan.step` (id), và toàn bộ cụm Editor/Corners/Perspective/Filter (kể cả
  `renderPageCanvas`, `homographyCoeffs`, `warpCpu`, `enhanceCanvas`) hoạt động y hệt cho cả
  hai — không có nhánh `if (mode==='id')` nào bên trong các hàm đó.
- **Editor UI được RELOCATE (di chuyển DOM node), không nhân bản.** `.editor` card (canvas, toolbar,
  filter chips) là MỘT phần tử DOM duy nhất; `relocateEditor(mode)` di chuyển nó vào
  `#idEditorSlot` (id mode, `display:contents` để vẫn là grid item trực tiếp của `#idWorkspace`)
  hoặc trả về vị trí gốc trong `#workspace` (document mode) bằng `insertBefore`. Không có `<canvas>`
  thứ hai, không có bộ event handler thứ hai.
- **`state.idScan` tách biệt hoàn toàn khỏi `state.pages`** — hai mảng/field độc lập, không bao giờ
  trộn. Front/back là object rời (`{id,file,name,url,corners,confidence,rotation,filter,width,height}`,
  cùng shape với một phần tử `state.pages` để tái dùng mọi hàm hiện có), không phải một mảng có thể
  reorder — vì vậy front luôn ở trên/back luôn ở dưới trên A4 là bất biến CẤU TRÚC, không phải quy ước
  UI có thể phá vỡ bằng kéo-thả.
- **`exportIdPdf()` snapshot `state.idScan` đúng một lần** trước `setBusy(true)`, y hệt nguyên tắc
  `snapshotExportJob()` của document mode — sửa corners/rotation/filter hoặc rời hẳn Scan ID trong
  lúc export đang chạy không ảnh hưởng PDF đang xuất.
- **`composeIdA4(frontCanvas, backCanvas)`** nhận output CÓ SẴN của `renderPageCanvas()` (đã
  crop/warp/filter), không tự vẽ lại từ ảnh gốc. Dùng `calculateIdA4Layout()` để tính toán vị trí trên raster
  cố định 1240×1754 (tỷ lệ A4 dọc): mỗi mặt được scale theo CHIỀU RỘNG mục tiêu chung (65% chiều rộng A4,
  ~806px) bất kể độ phân giải nguồn; khoảng cách giữa hai thẻ là ~28 mm (~165px); cả cụm 2 thẻ và gap được
  căn giữa theo chiều dọc trang A4. Nếu một mặt bị xoay thành hình dạng rất cao (gần vuông-đứng thay vì thẻ ngang),
  hàm co theo chiều cao khả dụng thay vì chiều rộng để không tràn trang — đây là fallback cố ý, đánh đổi "cùng
  chiều rộng tuyệt đối" lấy "không bao giờ méo/tràn trang" cho trường hợp hiếm; ID card thật luôn ngang nên
  trường hợp này gần như không xảy ra trong thực tế. Không in nhãn "Mặt trước/Mặt sau" lên trang (giữ thiết kế
  sạch theo yêu cầu).
- **`applyIdAspectHint()` chỉ HẠ, không bao giờ NÂNG, confidence** — so tỷ lệ khung hình quad phát
  hiện được với tỷ lệ ID-1 (85.60×53.98mm ≈ 1.586:1); lệch >35% thì trần confidence ở 0.5 (dưới
  ngưỡng review 0.58) để buộc người dùng kiểm tra tay. Không đổi `detectDocument()`/
  `componentQuad()`/`edgeQuad()`/`orderCorners()` — ba điểm dễ vỡ nhất của app không bị chạm vào.
- **Đã kiểm chứng bằng rehearsal trình duyệt thật** (ảnh tổng hợp có marker màu TL/TR/BR/BL ở 4 góc,
  giải mã JPEG nhúng trong PDF xuất ra để đo lại vị trí pixel): mặt trước/sau không bị lật/mirror
  (kể cả sau khi xoay 90° một mặt — marker vẫn đúng vị trí TL/TR/BR/BL theo phép xoay theo chiều kim
  đồng hồ), mặt trước luôn ở trên và mặt sau ở dưới, cả cụm căn giữa dọc trang, và hai mặt có độ phân giải nguồn
  chênh lệch 5 lần vẫn ra cùng chiều rộng (~806px, ~65% chiều rộng trang A4 1240×1754).

## Mô hình dữ liệu / API

Không có API hay database. Cấu trúc dữ liệu trung tâm là một object trong bộ nhớ (không persist), mỗi phần tử của `state.pages`:

```js
{
  id, file, name, url,        // file gốc + object URL cho thumbnail
  corners: [{x,y}×4],          // toạ độ chuẩn hoá 0–1, thứ tự TL,TR,BR,BL, theo ảnh ĐÃ xoay
  confidence,                   // 0–1, dưới 0.58 thì bị đánh dấu "cần kiểm tra"
  rotation,                     // 0/90/180/270
  filter,                       // 'auto' | 'document' | 'bw' | 'original' — mặc định 'auto' cho trang mới;
                                 // 'auto'/'bw' chạy qua enhanceCanvas(), 'document'/'original' khoá vào FILTER_CSS
  width, height                 // kích thước ảnh đã xoay, ghi sau detectPage()
}
```

`state.mode` (`null` | `'document'` | `'id'` | `'party'` | `'watermark'` | `'compress'`) chọn workflow đang active. `state.idScan` giữ trạng
thái Scan ID, độc lập hoàn toàn với `state.pages`:

```js
state.idScan = {
  step,           // 'front' | 'back' | 'preview'
  front, back     // null hoặc object CÙNG SHAPE với một phần tử state.pages ở trên
                   // (id, file, name, url, corners, confidence, rotation, filter, width, height)
}
```

Không có field `layout`/preset riêng — V1 Scan ID chỉ có một bố cục ("Bản in đẹp", cố định trong
`composeIdA4()`), nên không cần state cho lựa chọn preset chưa tồn tại.

## Biến môi trường

Không có. Ứng dụng không đọc bất kỳ biến môi trường nào — không `.env`, không secret, không config runtime.

## Lưu ý kiến trúc quan trọng

- **`orderCorners()` phải luôn trả về một hoán vị của đầu vào.** Cách làm cũ (chọn từng góc theo cực trị x+y/x−y) có thể trả về cùng một điểm hai lần trên tứ giác xoay, làm sập hình dạng và khiến homography không giải được — đã sửa bằng cách sắp theo góc quanh trọng tâm. Xem quyết định trong [03-decisions.md](03-decisions.md).
- **Nhãn góc (TL/TR/BR/BL) chỉ được tính lại khi kết thúc kéo** (`pointerup`/`pointercancel`), không phải mỗi `pointermove` — nếu không, tay cầm có thể "nhảy" ra khỏi ngón tay giữa chừng kéo.
- **`sleepFrame()` không được chỉ dựa vào `requestAnimationFrame`** — rAF không bao giờ chạy khi tab ẩn (background), sẽ treo vĩnh viễn các vòng lặp dài (`addFiles`, `makeJpegs`). Hàm này đua rAF với một `setTimeout` dự phòng.
- **`componentQuad()` phải phạt nặng tứ giác chiếm toàn khung hình** — nền sáng dưới giấy sáng khiến ngưỡng Otsu nuốt luôn cả nền, trả về "tài liệu" là toàn bộ ảnh với độ tin cậy cao nếu không có phạt này.
- **Độ tin cậy dựa trên sự đồng thuận giữa 2 detector độc lập** (`componentQuad` và `edgeQuad`), không chỉ dựa vào điểm số của detector thắng — một detector đơn lẻ hoặc hai detector bất đồng sẽ bị giới hạn dưới ngưỡng review (0.58) để trang được đánh dấu thay vì bị cắt sai trong im lặng.
- **`FILTER_CSS`/`enhanceCanvas()` dùng chung** cho cả preview trong editor và canvas xuất PDF — tách ra hai chỗ khác nhau sẽ khiến "cái người dùng thấy" khác "cái được xuất ra". `enhanceCanvas()` là pixel pipeline thật (không phải CSS) cho `auto`/`bw`, xem mục "Auto Enhance pixel pipeline" ở trên.
- **Background-normalization trong `enhanceAuto()`/`enhanceBW()` phải lấy percentile cao (không lấy trung bình) làm mục tiêu sáng, và chỉ được khuếch đại lên (gain ≥ 1)** — dùng trung bình sẽ bị nội dung tối/ảnh trong tài liệu kéo mục tiêu xuống thấp hơn nền thật, khiến bước này LÀM TỐI nền thay vì làm sáng nó (phát hiện qua rehearsal case "ảnh sáng đều" bị tối đi sau enhance). Xem [03-decisions.md](03-decisions.md).
- **Bán kính blur cho local-contrast (~5% cạnh ngắn) và cho background-shading (~35% cạnh ngắn) phải khác nhau rõ rệt** — bán kính nhỏ chỉ thấy được chi tiết ở quy mô ký tự, không đủ rộng để làm phẳng một gradient ánh sáng trải toàn trang; dùng chung một bán kính nhỏ cho cả hai mục đích sẽ khiến nền không đều không được sửa (phát hiện qua rehearsal case ánh sáng lệch, xem [03-decisions.md](03-decisions.md)).
- **`warpCpu()` phải cho kết quả hình học giống hệt đường WebGL** (đã xác minh bằng test tắt WebGL) — đây là fallback bắt buộc phải đúng, không phải "best effort".
- **Mỗi khi sửa danh sách asset trong `ASSETS` của `sw.js`, phải tăng version của hằng `CACHE`** — nếu không, người dùng cũ vẫn kẹt ở app shell cache cũ.
- Không có cơ chế race condition đáng lo vì không có state ngoài bộ nhớ tab; rủi ro duy nhất là các Promise bất đồng bộ (`loadImage`, `renderPageCanvas`) chạy chồng khi người dùng thao tác rất nhanh — `state.renderToken` trong `renderSelected()` dùng để huỷ kết quả cũ.
- **`exportPdf()` phải luôn snapshot `state.pages` (`snapshotPagesForExport()`) trước khi gọi `setBusy(true)`**, và `makeJpegs()`/`renderPageCanvas()` chỉ nhận dữ liệu qua tham số `pages`, không bao giờ đọc `state.pages` trực tiếp trong vòng lặp export. `corners` phải clone sâu (`cloneCorners()`) vì đó là mảng object UI có thể mutate sau khi snapshot đã chụp; `file` không cần clone vì bản thân `File` object không đổi.
- **`snapshotExportJob()` phải đóng băng luôn cả cấu hình xuất** (`quality`, `pageSize`, `marginToggle.checked`, `fileName`), không chỉ `state.pages` — các control này được đọc từ `els.*` đúng **một lần**, ở đầu `exportPdf()`, trước `setBusy(true)`. Toàn bộ phần còn lại của `exportPdf()`/`buildPdf()` chỉ được dùng `exportJob.*`, không được đọc lại `els.quality.value`/`els.pageSize.value`/`els.marginToggle.checked`/`els.fileName.value` — nếu không, đổi các control này trong lúc vòng lặp render/nén nhiều trang đang chạy (có thể mất vài giây tới vài chục giây) sẽ khiến PDF cuối dùng cấu hình khác với thời điểm bấm "Xuất PDF". Phát hiện qua review độc lập sau khi P1 (snapshot trang) đã merge.
- **Mọi handler có thể mutate `state.pages`/corners/filter/rotation/thứ tự trang phải tự guard bằng `if (state.busy) return;` ngay trong handler**, không được chỉ dựa vào thuộc tính `disabled` của nút — drag/drop thumbnail và một số code path khác không đi qua `disabled`. `setBusy()` vẫn toggle `disabled` cho các nút liên quan (kể cả `clearBtn` và các `.filter-chip`) để UI phản hồi rõ ràng, nhưng đó chỉ là lớp UX, không phải cơ chế chặn chính.
- **`sw.js`: refresh nền khi có cached response phải bọc trong `event.waitUntil()`** — nếu không, trình duyệt có thể huỷ service worker giữa chừng refresh (ngay sau khi `respondWith()` đã resolve bằng cached response), khiến cache không bao giờ thực sự được cập nhật cho lần mở sau.
- **`activePage()` là điểm nối DUY NHẤT giữa document mode và ID mode** — nếu thêm một hàm mới trong
  cụm Editor/Corners/Perspective/Filter cần biết "trang đang sửa là gì", nó PHẢI gọi `activePage()`
  thay vì `selectedPage()` trực tiếp, nếu không hàm đó sẽ câm lặng không hoạt động (hoặc hoạt động sai
  trang) khi ở ID mode. Đừng thêm `if (state.mode==='id')` rải rác trong các hàm dùng chung — mọi
  phân nhánh mode nên đi qua `activePage()`, không đi qua từng call site.
- **`.editor` card chỉ tồn tại MỘT LẦN trong DOM và được `relocateEditor()` di chuyển**, không bao giờ
  được nhân bản (không tạo `<canvas>`/toolbar thứ hai cho ID mode) — nhân bản sẽ tách preview/export
  của hai workflow ra hai đường code khác nhau, đúng thứ "một pixel pipeline dùng chung" mà kiến trúc
  này cố tránh. `#idEditorSlot`/vị trí gốc trong `#workspace` chỉ là điểm neo DOM, không phải bản sao.
- **`exportIdPdf()` phải snapshot `state.idScan` một lần trước `setBusy(true)`**, cùng nguyên tắc với
  `snapshotExportJob()` — xem mục "ID mode" ở trên. Nếu thêm control cấu hình mới cho Scan ID (ví dụ
  preset layout thứ hai), nó phải được đọc vào snapshot đó, không đọc lại `els.*`/`state.idScan.*`
  giữa chừng render.
- **`applyIdAspectHint()` chỉ được HẠ `detection.confidence`, không bao giờ nâng nó và không được
  sửa `detectDocument()`/`componentQuad()`/`edgeQuad()`/`orderCorners()`** — đây là nơi duy nhất Scan
  ID "biết" về hình dạng thẻ ID, và nó phải ở dạng review-hint an toàn (thà đánh dấu nhầm một tài
  liệu hợp lệ là "cần kiểm tra" còn hơn tự tin sai) theo đúng nguyên tắc của `detectDocument()`.

## Party Document Mode architecture (2026-08-30)

The third workflow is isolated in party-mode.js and party-pdf.js; party-taxonomy.js is a generated offline mirror of assets/party/document_types.json. Party state remains in the module browser-memory closure and is reset on mode switch or page close.

The source model is sources[] plus documents[].pages[]. An image page references a local object URL and is rendered only through the existing canvas export helper; Party mode does not call OCR, AI, or ML detection. A PDF page references {source, sourcePage}; its output path remains an unmodified source-page copy, while PartyPdf.renderThumbnail() derives a bounded local canvas preview from page geometry, vector content and supported image XObjects. PartyPdf.sourceFromBuffer() parses ordinary PDF 1.x indirect objects and page objects; PartyPdf.buildPdf() copies reachable resources/content streams and creates new page wrappers. Hybrid exports preserve the operator-selected order of copied PDF pages and newly encoded scan images. Encrypted, corrupt, unsupported PDFs fail closed, and an individual preview failure remains isolated to its page.

The UI organizes the workflow into two clear sections: a Source Pool (`.party-source-pool`) containing all imported source pages, and Created Documents (`.party-created-docs`). Operators select pages via checkboxes (touch target >= 44px) or range input (`1-3`, `5,7`), and click "Tạo tài liệu từ trang đã chọn". `createDocumentFromSelection` strictly preserves the original ascending source order of selected pages regardless of the sequence in which checkboxes were clicked. Pages assigned to documents receive an unselectable badge in the source pool, preventing accidental duplication across documents. Deleting a document or removing a page automatically restores those pages to the unassigned source pool.

Each created document has an individual "Xuất tài liệu này" button that enables immediately once the document has at least one page and a valid taxonomy (01-104), allowing partial export of specific documents without requiring 100% whole-file coverage. The coverage indicator serves as an informational audit metric (`N/M trang nguồn đã được xếp vào tài liệu`) rather than an export barrier. Operations inside created documents support merge-with-previous, merge-with-next, reorder, move between documents, page rotation, page replacement, and deletion. Taxonomy selection is an operator action; search normalizes Vietnamese accents only for matching and uses canonical filename_base for output names. Same-type sequence suffixes (.1, .2) are automatically managed when duplicate types exist.

### Party preview lifecycle and resource bounds (2026-08-30)

`party-mode.js` assigns a monotonic `previewGeneration` to every DOM preview rebuild and mode exit. Each queued canvas captures that generation; the async renderer checks generation, active mode, connected canvas, and the current page identity before changing page state, canvas pixels, or status DOM. Generation is an invalidation token, not the queue mutex; the queue worker remains separate so a stale job cannot block the current generation.

`party-pdf.js` stores only downsampled derivative `ImageData` in a per-source LRU cache capped at 16 entries. It validates image dimensions, components, decoded byte limits, direct stream lengths and bounded fallback stream offsets before allocating/decoding. For stream objects, it pre-indexes object definitions and resolves both direct (`/Length <number>`) and indirect (`/Length <id> <gen> R`) lengths, using declared length as the primary stream authority with bounded 0..2 byte lookahead (`endstream`, `\nendstream`, `\rendstream`, `\r\nendstream`). Recorded stream offsets (`streamDataStart`, `streamDataEnd`, `endStreamOffset`) are preserved across object extraction and rewriting to avoid false matches on binary payload bytes. JPEG previews use a bounded resize path and close `ImageBitmap`; fallback object URLs are revoked in `finally`. On source discard, pending/resolved preview entries are released and the Party document container is cleared so stale canvases do not remain in the DOM. Unsupported filters remain page-local preview errors and do not affect source-page export.

## Lossless Watermark Stripper architecture (2026-09-04)

The fourth workflow provides automated, bit-for-bit lossless removal of CamScanner watermarks ("Scanned with CamScanner") from existing PDF documents.

### Invariants and Technical Principles

1. **Bit-for-bit Lossless (Zero Re-encoding):**
   Unlike raster inpainting approaches that convert pages to bitmaps, fill pixels, and recompress to JPEG (causing degradation, blurriness, and generational loss), this engine treats the PDF at the binary object level. The high-resolution scan image byte stream (`DCTDecode`/JPEG) is extracted and copied without touching a single pixel. Its SHA-256 hash remains identical before and after stripping.

2. **Structural Surgery (XObject & Content Stream):**
   CamScanner places watermarks as separate image XObjects rendered via content stream operators in the lower margin.
    - **Detection (`detectCamScannerWatermarks`):** Scans each page's `/Resources/XObject` dictionary. Ignores 1-bit ImageMasks (`/ImageMask true`). Evaluates candidate images against heuristic rules:
      - **Type 1 (Compact Badge):** $140\text{px} \le \text{width} \le 270\text{px}$, $45\text{px} \le \text{height} \le 110\text{px}$, aspect ratio $2.3 \le W/H \le 3.2$ (standard CamScanner sizes: 240×90, 166×62, 160×60, 200×75, 180×68).
      - **Type 2 (Wide Text Banner):** $350\text{px} \le \text{width} \le 1600\text{px}$, $30\text{px} \le \text{height} \le 180\text{px}$, aspect ratio $5.5 \le W/H \le 13.0$ (e.g. "Được quét bằng CamScanner" / "Scanned with CamScanner", $888\times 92\text{px}$, $W/H=9.65$).
      - **Accompaniment & Area Ratio:** Accompanied by a primary document scan image of significantly greater resolution on the same page ($\ge 500,000\text{px}$ and $\ge 8\times$ candidate area).
      - **Content stream & Affine Matrix Compounding:** Decompresses streams via `inflateSync` (if `/FlateDecode`), accumulates multiple consecutive `cm` transformations inside the enclosing `q ... Q` block ($CTM = cm \times CTM$) to resolve true coordinates and dimensions ($20\le renderW \le 280\text{pt}$, $5\le renderH \le 70\text{pt}$, $y \le box_1 + pageHeight \times 0.20$).
    - **Content Stream Stripping (`stripWatermarkFromContentStream`):** Bóc tách sạch sẽ các lệnh vẽ watermark:
      `q ... cm ... cm /ImX Do Q`, `q ... /ImX Do ... Q` hoặc standalone `/ImX Do`.
    - **Object Pruning & Serialization (`copyPageObjects`):** Removes the watermark reference `/ImX <id> 0 R` from the page's `/Resources/XObject` dictionary (direct or indirect). Because the watermark XObject is no longer reachable from the page dictionary, it is excluded from object copying, reducing the output file size by the exact byte length of the watermark asset.
    - **Annotation Sanitization (`cleanCamScannerAnnotations`):** Removes `/Subtype /Link` annotations pointing to `camscanner.com` or positioned directly over the watermark rectangle, pruning the `/Annots` key when empty to prevent invisible click traps.
    - **Fail-Safe Integrity:** If 0 watermarks are detected, `stripWatermarks` immediately returns the original PDF buffer unmodified (`unmodified: true`).

## Giảm dung lượng PDF (Compress Mode) architecture (2026-09-05)

The fifth top-level workflow, `state.mode==='compress'`, is a standalone tool independent from Document/ID/Party/Watermark — it never touches `state.pages`/`state.idScan`. `enterMode('compress')` calls `window.VigilLensCompress.activate()`, mirroring exactly how `'watermark'` wires `window.VigilLensWatermark` (same pattern in `renderModeShell()`/`leaveActiveModeWithConfirm()`).

### Split: engine vs. UI

- **`pdf-compress.js` (`window.PdfCompress`)** is the only place compression logic exists. Public contract: `inspectPdf(fileOrBlob)` (cheap page-count/size lookup), `compressPdf(fileOrBlob, options)` (the adaptive loop), `resolveRounds(options)`, `renderCompressionPage`, `encodePage`, `buildCompressedPdf`, `verifyTarget`, plus the constants `PDF_COMPRESSION_TARGET_BYTES` (19,000,000 bytes — decimal MB, not MiB, chosen so the margin below 20MB survives either a decimal or MiB reading of "20MB" on a receiving system), `PDF_COMPRESSION_DISPLAY_LIMIT_BYTES` (20,000,000), `ROUNDS`, `BEYOND_FLOOR_ROUNDS`.
- **`compress-mode.js` (`window.VigilLensCompress`)** is UI-only: drop-zone → file-info screen (name/pages/size, "đã dưới 20MB" notice if applicable, never auto-compresses) → progress → result (before/after size, reduction %, page-count/target checkmarks, download, and a "Nén mạnh hơn" button that only appears once `!achievedTarget`). It never re-implements any part of the compression loop.
- **`party-mode.js`** calls `window.PdfCompress.compressPdf()` directly from the `>20MB` dialog's "Tạo bản dưới 20MB" button (see the "Giảm dung lượng PDF" row in the Code Graph table above) — there is exactly one compression implementation in the codebase, reused by both callers, per the task's hard "không duplicate compression logic" requirement.

### Why the renderer reuses `PartyPdf.renderThumbnail()` instead of a second PDF.js bootstrap

`renderCompressionPage(source, pageIndex, maxEdge)` does **not** load PDF.js itself. It calls `PartyPdf.renderThumbnail(ref, canvas, maxEdge)` — the exact same function Party Mode's own page thumbnails use — which already tries `page.render()` (PDF.js) first and, if that throws for any reason (WASM/runtime failure, an unsupported filter, or a genuine `page.render()` incompatibility observed on one specific headless Chromium build during this task's development, missing `Map.prototype.getOrInsertComputed`), falls back to `party-pdf.js`'s own classical content-stream renderer. This was a deliberate design change from an initial version that bootstrapped PDF.js independently: that version had no fallback, so any PDF.js/WASM hiccup took the entire compression feature down even though Party Mode's preview pipeline already had a proven, tested recovery path for exactly this failure mode. Reusing `renderThumbnail()` means:
- One rendering pipeline, one place that knows how to recover from a broken `page.render()` — not two.
- `inspectPdf()`/`compressPdf()` get page count and MediaBox/CropBox/Rotate handling from `PartyPdf.sourceFromBuffer()`'s classical parser, so a bad PDF is rejected with the same, already-tested Vietnamese error messages `party-pdf.js` already produces (`'Tệp không phải PDF.'`, `'PDF có mật khẩu/mã hóa chưa được hỗ trợ.'`, `'PDF page thiếu MediaBox/CropBox hợp lệ.'`) instead of a second copy of that validation.
- `compressPdf()` calls `PartyPdf.releasePreviewCache(source)` in a `finally` block, reusing Party Mode's already-audited per-source cache/`ImageBitmap`/pdf.js-document cleanup instead of writing a second memory-lifecycle path.

### Adaptive loop

`compressPdf()` resolves a round table via `resolveRounds(options)` (pure function, unit-tested in isolation — see `scripts/regression_pdf_compress.cjs`): `options.rounds` verbatim if given, else `ROUNDS` and, only when `options.allowBeyondFloor===true`, `ROUNDS.concat(BEYOND_FLOOR_ROUNDS)`. For each round in order it re-renders **every** page (`renderRound()`: render → JPEG-encode → drop the *canvas* — only one full-resolution canvas pixel buffer is ever resident at a time, never all of them at once), assembles the whole PDF via `PartyPdf.buildPdf([], items, {})` (the same local writer Party Mode already uses for its own image pages — reused rather than a third hand-rolled PDF assembler), and checks the **real** `blob.size` against the target; it stops at the first round that fits, or returns the last (floor) round's result with `achievedTarget:false` if none did. Color is never dropped (no grayscale field anywhere in the round tables — this is a deliberate scope decision to avoid adding a black/white option that isn't asked for, not an oversight); page count/order/orientation come for free from iterating `source.pageCount` in index order and letting `buildPdf` derive each output page's size from that page's own rendered width/height (so a landscape source page doesn't get force-fit into a portrait A4, matching the AGENTS.md task brief's "giữ đúng aspect ratio của source page").

**Peak memory is not small just because only one canvas is held at a time** (docs/brain/03-decisions.md, "Compress mode memory audit", 2026-09-06 — corrects an earlier overclaim): `renderRound()`'s `items` array still holds every page's *encoded JPEG bytes* for the current round, and the dominant cost by far is the shared `PartyPdf.sourceFromBuffer()` classical parser, which decodes the whole source file into a JS string twice and keeps a byte-slice *and* text-slice copy of every PDF object alive for the entire `compressPdf()` call (all rounds) because `source` must stay alive throughout. Real Chromium measurement (`scripts/benchmark_pdf_compress.cjs`, `--single-process` + `/proc/<pid>/status` VmRSS — `performance.memory`/`Performance.getMetrics` JSHeapUsedSize does not see this at all, since large TypedArray/Blob backing stores are V8 external allocations) showed RSS growing ~4.6–5× the input file size for realistic 20–80MB inputs. `estimateMemoryRisk(inputBytes)` uses that measured 5× multiplier (`PARSE_MEMORY_MULTIPLIER`) to fail closed — before ever calling `sourceFromBuffer()` — on files estimated to risk crashing a mobile tab (`SAFE_MOBILE_PEAK_BYTES = 500,000,000`, chosen so the full 20–80MB requested range passes with headroom). `inspectPdf()` runs this same check *before* parsing too (an earlier version of `inspectPdf()` parsed first and checked risk after, defeating the point of an early warning for the info screen — fixed), returning `{pageCount: null, memoryRisk}` for an oversized file rather than paying the same expensive/risky parse just to refuse it. Both callers surface the exact message `PdfCompress.MEMORY_RISK_MESSAGE` ("Tệp này quá lớn để xử lý an toàn trên thiết bị hiện tại. Hãy thử trên máy tính hoặc chia tài liệu thành các phần nhỏ hơn."), never a silent crash. This guard's threshold is a same-order-of-magnitude proxy from desktop-class Chromium, not a substitute for real-device measurement — see decisions.md for the honest caveat on the 80MB tier.

### Party Mode integration (`>20MB` detour)

`exportSingleDocument()`'s existing lossless export path (`exportDocument()` → `PartyPdf.buildMixedPdf()`, page-object copy for PDF pages / canvas+JPEG for image pages — **unchanged**) is untouched. Only the point right before the automatic download changed: if `result.blob.size > 20,000,000`, `openLargeFileDialog(result)` shows `#partyLargeFileDialog` instead of auto-downloading. "Tải bản gốc" downloads that exact same lossless blob (no re-encode). "Tạo bản dưới 20MB" is the only path that calls `PdfCompress.compressPdf(pending.blob, {onProgress})`, then downloads the compressed result named `<type>_duoi-20MB.pdf`. `exportAll()` (bulk multi-document export) is intentionally left untouched — a per-file size-check interstitial would break its batch download loop; this is a scoped limitation, not an oversight (see `06-ai-working-log.md`).

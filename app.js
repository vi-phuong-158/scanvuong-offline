(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const els = {
    emptyState: $('#emptyState'), workspace: $('#workspace'), dropZone: $('#dropZone'),
    chooseBtn: $('#chooseBtn'), cameraBtn: $('#cameraBtn'), addBtn: $('#addBtn'),
    fileInput: $('#fileInput'), cameraInput: $('#cameraInput'), pageCount: $('#pageCount'),
    reviewCount: $('#reviewCount'), thumbList: $('#thumbList'), editorCanvas: $('#editorCanvas'),
    processingOverlay: $('#processingOverlay'), processingText: $('#processingText'),
    confidenceDot: $('#confidenceDot'), confidenceText: $('#confidenceText'), detectBtn: $('#detectBtn'),
    resetCropBtn: $('#resetCropBtn'), rotateBtn: $('#rotateBtn'), moveUpBtn: $('#moveUpBtn'),
    moveDownBtn: $('#moveDownBtn'), deleteBtn: $('#deleteBtn'), autoAllBtn: $('#autoAllBtn'),
    clearBtn: $('#clearBtn'), fileName: $('#fileName'), pageSize: $('#pageSize'), quality: $('#quality'),
    marginToggle: $('#marginToggle'), exportBtn: $('#exportBtn'), exportProgress: $('#exportProgress'),
    progressBar: $('#progressBar'), progressLabel: $('#progressLabel'), exportSummary: $('#exportSummary'),
    exportNotice: $('#exportNotice'), toast: $('#toast'), installBtn: $('#installBtn'), offlineBadge: $('#offlineBadge'),
    // Mode select + Scan ID (front/back → single A4 PDF)
    modeSelect: $('#modeSelect'), modeDocBtn: $('#modeDocBtn'), modeIdBtn: $('#modeIdBtn'), modePartyBtn: $('#modePartyBtn'), modeWatermarkBtn: $('#modeWatermarkBtn'), switchModeBtn: $('#switchModeBtn'),
    idWorkspace: $('#idWorkspace'), idStepBadge: $('#idStepBadge'), idStepHint: $('#idStepHint'),
    idChooseBtn: $('#idChooseBtn'), idCameraBtn: $('#idCameraBtn'), idFileInput: $('#idFileInput'), idCameraInput: $('#idCameraInput'),
    idBackStepBtn: $('#idBackStepBtn'), idConfirmBtn: $('#idConfirmBtn'), idEditorSlot: $('#idEditorSlot'),
    idPreviewSection: $('#idPreviewSection'), idPreviewCanvas: $('#idPreviewCanvas'),
    idEditFrontBtn: $('#idEditFrontBtn'), idEditBackBtn: $('#idEditBackBtn'), idExportBtn: $('#idExportBtn'),
    idExportProgress: $('#idExportProgress'), idProgressBar: $('#idProgressBar'), idProgressLabel: $('#idProgressLabel'), idExportNotice: $('#idExportNotice'),
    updateBanner: $('#updateBanner'), updateBtn: $('#updateBtn'), updateDismiss: $('#updateDismiss')
  };

  const state = {
    pages: [],
    selectedId: null,
    busy: false,
    deferredInstallPrompt: null,
    renderToken: 0,
    dragId: null,
    preview: { image: null, mapping: null, pageId: null, dragCorner: -1, enhancedCanvas: null, enhancedKey: '' },
    // Which top-level workflow is active: null (mode not chosen yet, showing
    // #modeSelect) | 'document' (existing multi-page flow) | 'id' (Scan ID:
    // front/back → single A4 PDF). Independent of state.pages so the two
    // workflows can never mix data — see docs/brain/03-decisions.md.
    mode: null,
    idScan: { step: 'front', front: null, back: null }
  };

  const DEFAULT_CORNERS = [
    { x: 0.045, y: 0.045 }, { x: 0.955, y: 0.045 },
    { x: 0.955, y: 0.955 }, { x: 0.045, y: 0.955 }
  ];

  const FILTER_CSS = {
    auto: 'none',
    document: 'brightness(1.07) contrast(1.22) saturate(.9)',
    bw: 'none',
    original: 'none'
  };
  // 'auto' and 'bw' run the real pixel pipeline below instead of a CSS filter,
  // so preview and PDF export always show identical, non-CSS-only processing.
  const PIXEL_FILTERS = new Set(['auto', 'bw']);

  const QUALITY = {
    high: { maxEdge: 2600, jpeg: 0.9 },
    standard: { maxEdge: 2000, jpeg: 0.82 },
    small: { maxEdge: 1400, jpeg: 0.68 },
    '2mb': { maxEdge: 1500, jpeg: 0.64 }
  };

  const sleepFrame = () => new Promise(resolve => {
    // requestAnimationFrame never fires while the tab is hidden, which would
    // freeze a long import or export in the background. Fall back to a timer.
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    const timer = setTimeout(finish, 40);
    requestAnimationFrame(() => { clearTimeout(timer); finish(); });
  });
  const cloneCorners = (corners) => corners.map(p => ({ x: p.x, y: p.y }));
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  function uid() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function toast(message, duration = 2500) {
    els.toast.textContent = message;
    els.toast.classList.remove('hidden');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => els.toast.classList.add('hidden'), duration);
  }

  function setBusy(busy, text = 'Đang xử lý…') {
    state.busy = busy;
    els.processingText.textContent = text;
    els.processingOverlay.classList.toggle('hidden', !busy);
    [els.detectBtn, els.resetCropBtn, els.rotateBtn, els.moveUpBtn, els.moveDownBtn, els.deleteBtn, els.autoAllBtn, els.exportBtn, els.clearBtn,
     els.fileName, els.pageSize, els.quality, els.marginToggle,
     els.switchModeBtn, els.idChooseBtn, els.idCameraBtn, els.idConfirmBtn, els.idBackStepBtn,
     els.idEditFrontBtn, els.idEditBackBtn, els.idExportBtn]
      .forEach(el => { if (el) el.disabled = busy; });
    $$('.filter-chip').forEach(el => { el.disabled = busy; });
  }

  function selectedPage() {
    return state.pages.find(p => p.id === state.selectedId) || null;
  }

  function getPageIndex(id) {
    return state.pages.findIndex(p => p.id === id);
  }

  // The shared editor (canvas, corner drag, detect/reset/rotate, filter chips)
  // is reused as-is by both workflows — it just needs to know which
  // page-shaped object is "active" right now. Document mode's active page is
  // the selected thumbnail; Scan ID's is whichever side (front/back) the
  // wizard is currently on (null during the A4 preview step, which has no
  // editable page). See docs/brain/01-architecture.md.
  function activePage() {
    if (state.mode === 'id') {
      const s = state.idScan;
      return s.step === 'front' ? s.front : (s.step === 'back' ? s.back : null);
    }
    return selectedPage();
  }

  function updateShell() {
    const hasPages = state.pages.length > 0;
    els.emptyState.classList.toggle('hidden', hasPages);
    els.workspace.classList.toggle('hidden', !hasPages);
    const review = state.pages.filter(p => p.confidence < 0.58).length;
    els.pageCount.textContent = `${state.pages.length} trang`;
    els.reviewCount.textContent = review ? `${review} cần kiểm tra` : 'Tất cả đã ổn';
    els.exportSummary.innerHTML = `<div><span>Số trang</span><strong>${state.pages.length}</strong></div><div><span>Trang cần kiểm tra</span><strong>${review}</strong></div>`;
    els.exportBtn.disabled = !hasPages || state.busy;
    if (hasPages && !state.selectedId) state.selectedId = state.pages[0].id;
    renderThumbs();
    renderSelected();
  }

  function renderThumbs() {
    els.thumbList.innerHTML = '';
    state.pages.forEach((page, index) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `thumb-item${page.id === state.selectedId ? ' active' : ''}`;
      btn.draggable = true;
      btn.dataset.id = page.id;
      btn.innerHTML = `
        <img class="thumb-image" src="${page.url}" alt="Trang ${index + 1}" />
        <span class="thumb-meta"><strong>Trang ${index + 1}</strong><span>${escapeHtml(page.name)}</span></span>
        <span class="thumb-status ${page.confidence < 0.58 ? 'warn' : ''}" title="${page.confidence < 0.58 ? 'Cần kiểm tra góc cắt' : 'Đã nhận diện tốt'}"></span>
      `;
      btn.addEventListener('click', () => { state.selectedId = page.id; renderThumbs(); renderSelected(); });
      btn.addEventListener('dragstart', (e) => { if (state.busy) { e.preventDefault(); return; } state.dragId = page.id; e.dataTransfer.effectAllowed = 'move'; });
      btn.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
      btn.addEventListener('drop', (e) => {
        e.preventDefault();
        if (state.busy) return;
        const from = getPageIndex(state.dragId), to = getPageIndex(page.id);
        if (from < 0 || to < 0 || from === to) return;
        const [moved] = state.pages.splice(from, 1);
        state.pages.splice(to, 0, moved);
        renderThumbs();
      });
      els.thumbList.appendChild(btn);
    });
  }

  function escapeHtml(str = '') {
    return str.replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
  }

  const IMAGE_EXT = /\.(jpe?g|png|webp)$/i;
  function isSupportedImage(file) {
    // Some Android pickers hand over an empty MIME type; fall back to the name.
    if (/^image\/(jpeg|jpg|png|webp)$/i.test(file.type || '')) return true;
    return !file.type && IMAGE_EXT.test(file.name || '');
  }

  async function addFiles(fileList) {
    const files = Array.from(fileList || []).filter(isSupportedImage);
    if (!files.length) return toast('Hãy chọn ảnh JPG, PNG hoặc WEBP.');
    const firstNewId = uid();
    const newPages = files.map((file, i) => ({
      id: i === 0 ? firstNewId : uid(), file, name: file.name || `Ảnh ${state.pages.length + i + 1}`,
      url: URL.createObjectURL(file), corners: cloneCorners(DEFAULT_CORNERS), confidence: 0,
      rotation: 0, filter: 'auto', width: 0, height: 0
    }));
    state.pages.push(...newPages);
    state.selectedId = firstNewId;
    updateShell();

    setBusy(true, `Đang nhận mép 1/${newPages.length}…`);
    try {
      for (let i = 0; i < newPages.length; i++) {
        els.processingText.textContent = `Đang nhận mép ${i + 1}/${newPages.length}…`;
        await detectPage(newPages[i], false);
        if (i % 2 === 1) await sleepFrame();
      }
    } finally {
      setBusy(false);
      updateShell();
      const review = newPages.filter(p => p.confidence < 0.58).length;
      toast(review ? `Đã thêm ${newPages.length} trang · ${review} trang cần kiểm tra.` : `Đã thêm ${newPages.length} trang.`);
    }
  }

  async function loadImage(fileOrUrl) {
    if (fileOrUrl instanceof Blob && 'createImageBitmap' in window) {
      try {
        const bmp = await createImageBitmap(fileOrUrl, { imageOrientation: 'from-image' });
        return bmp;
      } catch (_) {}
    }
    const url = fileOrUrl instanceof Blob ? URL.createObjectURL(fileOrUrl) : fileOrUrl;
    try {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      await img.decode();
      return img;
    } finally {
      if (fileOrUrl instanceof Blob && url !== fileOrUrl) URL.revokeObjectURL(url);
    }
  }

  function rotatedDimensions(w, h, rotation) {
    const r = ((rotation % 360) + 360) % 360;
    return (r === 90 || r === 270) ? { w: h, h: w } : { w, h };
  }

  function drawRotatedToCanvas(source, rotation, maxEdge = Infinity) {
    const sw = source.width || source.naturalWidth, sh = source.height || source.naturalHeight;
    const rd = rotatedDimensions(sw, sh, rotation);
    const scale = Math.min(1, maxEdge / Math.max(rd.w, rd.h));
    const outW = Math.max(1, Math.round(rd.w * scale)), outH = Math.max(1, Math.round(rd.h * scale));
    const canvas = document.createElement('canvas');
    canvas.width = outW; canvas.height = outH;
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.save();
    const r = ((rotation % 360) + 360) % 360;
    if (r === 90) { ctx.translate(outW, 0); ctx.rotate(Math.PI / 2); }
    else if (r === 180) { ctx.translate(outW, outH); ctx.rotate(Math.PI); }
    else if (r === 270) { ctx.translate(0, outH); ctx.rotate(-Math.PI / 2); }
    ctx.scale(scale, scale);
    ctx.drawImage(source, 0, 0);
    ctx.restore();
    return canvas;
  }

  async function detectPage(page, rerender = true) {
    const source = await loadImage(page.file);
    try {
      const rotated = drawRotatedToCanvas(source, page.rotation, 560);
      let detection;
      if (typeof DocumentDetector !== 'undefined') {
        const detRes = await DocumentDetector.detect(rotated, {
          rotation: 0,
          fallbackDetector: (c) => detectDocument(c)
        });
        detection = {
          corners: detRes.corners,
          confidence: detRes.documentScore !== null && detRes.documentScore !== undefined ? detRes.documentScore : 0.55,
          source: detRes.source
        };
      } else {
        detection = detectDocument(rotated);
      }
      if (state.mode === 'id') applyIdAspectHint(detection, rotated.width, rotated.height);
      const safeCorners = (detection && detection.corners && Array.isArray(detection.corners) && detection.corners.length === 4)
        ? detection.corners
        : [{ x: 0.045, y: 0.045 }, { x: 0.955, y: 0.045 }, { x: 0.955, y: 0.955 }, { x: 0.045, y: 0.955 }];
      page.corners = safeCorners;
      page.confidence = detection && typeof detection.confidence === 'number' ? detection.confidence : 0.55;
      page.detectorSource = detection && detection.source ? detection.source : 'DEFAULT_FALLBACK';
      page.width = rotated.width;
      page.height = rotated.height;
    } finally {
      source.close?.();
    }
    if (rerender) { renderThumbs(); renderSelected(); updateSummaryOnly(); }
  }

  // ID-1 card ratio (85.60×53.98mm ≈ 1.586:1) used only as a review hint, not
  // to reshape the crop: a quad whose aspect is very far from a card's is
  // more likely a bad detection than an odd document, so its confidence gets
  // capped at the review threshold. This only ever LOWERS confidence — it
  // never raises it and never touches the shared detectDocument()/
  // orderCorners() math — so document mode is completely unaffected.
  const ID_CARD_ASPECT = 85.60 / 53.98;
  function applyIdAspectHint(detection, w, h) {
    const c = detection.corners.map(p => ({ x: p.x * w, y: p.y * h }));
    const quadW = (dist(c[0], c[1]) + dist(c[3], c[2])) / 2;
    const quadH = (dist(c[0], c[3]) + dist(c[1], c[2])) / 2;
    if (quadW <= 1 || quadH <= 1) return detection;
    const ratio = Math.max(quadW, quadH) / Math.min(quadW, quadH);
    const deviation = Math.abs(ratio - ID_CARD_ASPECT) / ID_CARD_ASPECT;
    if (deviation > 0.35) detection.confidence = Math.min(detection.confidence, 0.5);
    return detection;
  }

  function detectDocument(canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const { width: w, height: h } = canvas;
    const data = ctx.getImageData(0, 0, w, h).data;
    const gray = new Uint8Array(w * h);
    const hist = new Uint32Array(256);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const g = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
      gray[p] = g; hist[g]++;
    }

    const threshold = otsuThreshold(hist, w * h);
    const candidates = [];
    const light = componentQuad(gray, w, h, threshold, true);
    if (light) candidates.push(light);
    const edge = edgeQuad(gray, w, h);
    if (edge) candidates.push(edge);

    if (!candidates.length) return { corners: cloneCorners(DEFAULT_CORNERS), confidence: 0.28 };
    candidates.sort((a, b) => b.confidence - a.confidence);
    const best = candidates[0];
    // Two independent detectors landing on the same quad is the strongest
    // signal available. A lone detector, or two that disagree, means the crop
    // must be flagged for review rather than applied silently.
    if (candidates.length > 1) {
      const own = orderCorners(best.corners), rival = orderCorners(candidates[1].corners);
      const drift = Math.max(...own.map((p, i) => dist(p, rival[i])));
      if (drift < .035) best.confidence = clamp(best.confidence + .07, .25, .95);
      else if (drift > .10) best.confidence = Math.min(best.confidence, .55);
    } else {
      best.confidence = Math.min(best.confidence, .55);
    }
    const inset = 0.003;
    best.corners = orderCorners(best.corners).map(p => ({ x: clamp(p.x, inset, 1 - inset), y: clamp(p.y, inset, 1 - inset) }));
    return best;
  }

  function otsuThreshold(hist, total) {
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, max = 0, threshold = 127;
    for (let i = 0; i < 256; i++) {
      wB += hist[i]; if (!wB) continue;
      const wF = total - wB; if (!wF) break;
      sumB += i * hist[i];
      const mB = sumB / wB, mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > max) { max = between; threshold = i; }
    }
    return clamp(threshold, 90, 220);
  }

  function componentQuad(gray, w, h, threshold, lightMode) {
    // Connected components on a coarser grid keeps detection fast on phones.
    const step = Math.max(1, Math.ceil(Math.max(w, h) / 300));
    const gw = Math.ceil(w / step), gh = Math.ceil(h / step), n = gw * gh;
    const mask = new Uint8Array(n), seen = new Uint8Array(n);
    for (let gy = 0; gy < gh; gy++) {
      const y = Math.min(h - 1, gy * step);
      for (let gx = 0; gx < gw; gx++) {
        const x = Math.min(w - 1, gx * step);
        const v = gray[y * w + x];
        mask[gy * gw + gx] = lightMode ? (v > threshold + 4 ? 1 : 0) : (v < threshold - 4 ? 1 : 0);
      }
    }
    const queue = new Int32Array(n);
    let best = null;
    const minArea = n * 0.12;
    for (let start = 0; start < n; start++) {
      if (!mask[start] || seen[start]) continue;
      let qh = 0, qt = 0; queue[qt++] = start; seen[start] = 1;
      let count = 0, minX = gw, minY = gh, maxX = 0, maxY = 0;
      let tl = null, tr = null, br = null, bl = null;
      let minSum = Infinity, maxSum = -Infinity, minDiff = Infinity, maxDiff = -Infinity;
      while (qh < qt) {
        const idx = queue[qh++], x = idx % gw, y = (idx / gw) | 0; count++;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        const s = x + y, d = x - y;
        if (s < minSum) { minSum = s; tl = { x, y }; }
        if (s > maxSum) { maxSum = s; br = { x, y }; }
        if (d > maxDiff) { maxDiff = d; tr = { x, y }; }
        if (d < minDiff) { minDiff = d; bl = { x, y }; }
        const neighbors = [idx - 1, idx + 1, idx - gw, idx + gw];
        if (x === 0) neighbors[0] = -1; if (x === gw - 1) neighbors[1] = -1;
        for (const ni of neighbors) if (ni >= 0 && ni < n && mask[ni] && !seen[ni]) { seen[ni] = 1; queue[qt++] = ni; }
      }
      if (count < minArea || count > n * 0.97 || !tl || !tr || !br || !bl) continue;
      const boxArea = Math.max(1, (maxX - minX + 1) * (maxY - minY + 1));
      const fill = count / boxArea;
      const areaRatio = count / n;
      const centerX = (minX + maxX) / 2 / gw, centerY = (minY + maxY) / 2 / gh;
      const centered = 1 - Math.min(1, Math.hypot(centerX - .5, centerY - .5) / .7);
      const score = areaRatio * 0.5 + fill * 0.25 + centered * 0.25;
      if (!best || score > best.score) best = { score, count, fill, areaRatio, tl, tr, br, bl };
    }
    if (!best) return null;
    const corners = [best.tl, best.tr, best.br, best.bl].map(p => ({ x: p.x / Math.max(1, gw - 1), y: p.y / Math.max(1, gh - 1) }));
    const qArea = polygonArea(corners);
    if (qArea < 0.18) return null;
    const borderTouch = corners.filter(p => p.x < .012 || p.x > .988 || p.y < .012 || p.y > .988).length;
    let confidence = 0.43 + Math.min(.3, qArea * .32) + Math.min(.2, best.fill * .2) - borderTouch * .035;
    if (best.areaRatio > .25 && best.areaRatio < .9) confidence += .08;
    // A quad that fills the whole frame means the threshold swallowed the
    // background too (light paper on a light desk). Keep it as a last resort
    // instead of letting it outrank a real edge detection.
    const fillsFrame = qArea > .93 && corners.every(p => p.x < .02 || p.x > .98 || p.y < .02 || p.y > .98);
    if (fillsFrame) confidence = .3;
    return { corners, confidence: clamp(confidence, .25, .88) };
  }

  function edgeQuad(gray, w, h) {
    const mags = new Uint16Array(w * h);
    const hist = new Uint32Array(1024);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const gx = -gray[i - w - 1] - 2 * gray[i - 1] - gray[i + w - 1] + gray[i - w + 1] + 2 * gray[i + 1] + gray[i + w + 1];
        const gy = -gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1] + gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1];
        const m = Math.min(1023, Math.abs(gx) + Math.abs(gy)); mags[i] = m; hist[m]++;
      }
    }
    const total = (w - 2) * (h - 2), target = total * .91;
    let acc = 0, th = 100;
    for (let i = 0; i < hist.length; i++) { acc += hist[i]; if (acc >= target) { th = Math.max(85, i); break; } }
    const points = [];
    const stride = Math.max(1, Math.floor(Math.max(w, h) / 500));
    for (let y = 2; y < h - 2; y += stride) for (let x = 2; x < w - 2; x += stride) {
      const m = mags[y * w + x]; if (m >= th) points.push({ x: x / w, y: y / h, m });
    }
    if (points.length < 80) return null;
    const extremes = [
      points.slice().sort((a,b) => (a.x+a.y)-(b.x+b.y)).slice(0, Math.min(30, points.length)),
      points.slice().sort((a,b) => (b.x-b.y)-(a.x-a.y)).slice(0, Math.min(30, points.length)),
      points.slice().sort((a,b) => (b.x+b.y)-(a.x+a.y)).slice(0, Math.min(30, points.length)),
      points.slice().sort((a,b) => (a.x-a.y)-(b.x-b.y)).slice(0, Math.min(30, points.length))
    ];
    const corner = arr => {
      // Use the furthest strong point rather than the average, which tends to drift onto an edge.
      const sorted = arr.sort((a,b) => b.m-a.m).slice(0, 8);
      return { x: sorted.reduce((s,p)=>s+p.x,0)/sorted.length, y: sorted.reduce((s,p)=>s+p.y,0)/sorted.length };
    };
    const corners = extremes.map(corner);
    const ordered = orderCorners(corners), area = polygonArea(ordered);
    if (area < .16) return null;
    const shape = quadShapeScore(ordered);
    return { corners: ordered, confidence: clamp(.32 + area * .34 + shape * .22, .25, .68) };
  }

  function orderCorners(points) {
    // Walking the quad around its centroid always returns a permutation of the
    // four inputs. Picking each corner by an extreme (min x+y, max x-y, ...)
    // can return the same point twice on rotated/diamond quads, which collapses
    // the shape and makes the homography unsolvable.
    const pts = points.map(p => ({ x: p.x, y: p.y }));
    if (pts.length !== 4) return pts;
    const cx = (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4;
    const cy = (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4;
    // y grows downwards, so ascending atan2 walks the quad clockwise on screen.
    const ring = pts.slice().sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
    let start = 0, bestSum = Infinity;
    ring.forEach((p, i) => { const sum = p.x + p.y; if (sum < bestSum) { bestSum = sum; start = i; } });
    return [ring[start], ring[(start + 1) % 4], ring[(start + 2) % 4], ring[(start + 3) % 4]];
  }

  function polygonArea(p) {
    let a = 0; for (let i=0;i<p.length;i++) { const j=(i+1)%p.length; a += p[i].x*p[j].y-p[j].x*p[i].y; }
    return Math.abs(a)/2;
  }

  function quadShapeScore(p) {
    const e = [dist(p[0],p[1]),dist(p[1],p[2]),dist(p[2],p[3]),dist(p[3],p[0])];
    const minE=Math.min(...e), maxE=Math.max(...e); if (!maxE) return 0;
    return clamp(minE/maxE*1.35,0,1);
  }

  async function renderSelected() {
    const page = activePage();
    if (!page) {
      state.preview.image?.close?.();
      state.preview.image = null; state.preview.pageId = null; state.preview.mapping = null;
      state.preview.enhancedCanvas = null; state.preview.enhancedKey = '';
      return;
    }
    const token = ++state.renderToken;
    $$('.filter-chip').forEach(b => b.classList.toggle('active', b.dataset.filter === page.filter));
    renderConfidenceHint();

    const img = await loadImage(page.file);
    if (token !== state.renderToken) { img.close?.(); return; }
    state.preview.image?.close?.();
    state.preview.image = img; state.preview.pageId = page.id;
    drawEditor();
  }

  function renderConfidenceHint() {
    const page = activePage();
    if (!page) return;
    const warn = page.confidence < .58;
    els.confidenceDot.classList.toggle('warn', warn);
    els.confidenceText.textContent = warn
      ? 'Mép giấy chưa chắc chắn. Hãy kéo 4 điểm tròn vào đúng góc tờ giấy.'
      : 'Mép giấy đã nhận diện tốt. Có thể kéo 4 điểm để tinh chỉnh.';
  }

  // Recomputes the enhanced preview canvas only when page/filter/rotation/size
  // actually changed — NOT on every pointermove while dragging a corner — so
  // corner dragging stays responsive even though the pixel pipeline runs.
  function ensureEnhancedPreview(page, source, dw, dh) {
    const outW = Math.max(1, Math.round(dw)), outH = Math.max(1, Math.round(dh));
    const key = `${page.id}|${page.filter}|${page.rotation}|${outW}x${outH}`;
    if (state.preview.enhancedKey === key) return;
    const oriented = drawRotatedToCanvas(source, page.rotation, Math.max(outW, outH));
    enhanceCanvas(oriented, page.filter);
    state.preview.enhancedCanvas = oriented;
    state.preview.enhancedKey = key;
  }

  function drawEditor() {
    const page = activePage(), source = state.preview.image;
    if (!page || !source || state.preview.pageId !== page.id) return;
    const stage = els.editorCanvas.parentElement;
    const cssW = Math.max(280, stage.clientWidth), cssH = Math.max(320, stage.clientHeight);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const canvas = els.editorCanvas;
    canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
    canvas.style.width = `${cssW}px`; canvas.style.height = `${cssH}px`;
    const ctx = canvas.getContext('2d'); ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,cssW,cssH); ctx.fillStyle='#1c1210'; ctx.fillRect(0,0,cssW,cssH);

    const sw = source.width || source.naturalWidth, sh = source.height || source.naturalHeight;
    const rd = rotatedDimensions(sw, sh, page.rotation);
    const scale = Math.min((cssW - 26) / rd.w, (cssH - 26) / rd.h);
    const dw = rd.w * scale, dh = rd.h * scale, ox=(cssW-dw)/2, oy=(cssH-dh)/2;
    ctx.save(); ctx.translate(ox,oy);
    if (PIXEL_FILTERS.has(page.filter)) {
      ensureEnhancedPreview(page, source, dw, dh);
      ctx.drawImage(state.preview.enhancedCanvas, 0, 0, dw, dh);
    } else {
      ctx.filter = FILTER_CSS[page.filter] || 'none';
      const r=((page.rotation%360)+360)%360;
      if(r===90){ctx.translate(dw,0);ctx.rotate(Math.PI/2);}
      else if(r===180){ctx.translate(dw,dh);ctx.rotate(Math.PI);}
      else if(r===270){ctx.translate(0,dh);ctx.rotate(-Math.PI/2);}
      ctx.scale(scale,scale); ctx.drawImage(source,0,0);
    }
    ctx.restore();

    const pts = page.corners.map(p => ({x: ox+p.x*dw, y: oy+p.y*dh}));
    ctx.save();
    ctx.fillStyle='rgba(179,38,30,.10)'; ctx.strokeStyle='#d9a441'; ctx.lineWidth=2.5;
    ctx.beginPath(); ctx.moveTo(pts[0].x,pts[0].y); for(let i=1;i<4;i++)ctx.lineTo(pts[i].x,pts[i].y); ctx.closePath(); ctx.fill(); ctx.stroke();
    pts.forEach((p,i)=>{ ctx.beginPath(); ctx.arc(p.x,p.y,11,0,Math.PI*2); ctx.fillStyle='#fff';ctx.fill();ctx.lineWidth=4;ctx.strokeStyle=i===state.preview.dragCorner?'#d9a441':'#b3261e';ctx.stroke(); });
    ctx.restore();
    state.preview.mapping={ox,oy,dw,dh,cssW,cssH,pts};
  }

  function pointerToCss(e) {
    const r=els.editorCanvas.getBoundingClientRect(); return {x:e.clientX-r.left,y:e.clientY-r.top};
  }
  els.editorCanvas.addEventListener('pointerdown', (e) => {
    if (state.busy) return;
    const p=pointerToCss(e), map=state.preview.mapping; if(!map)return;
    let best=-1,bestD=32;
    map.pts.forEach((pt,i)=>{const d=Math.hypot(pt.x-p.x,pt.y-p.y);if(d<bestD){best=i;bestD=d;}});
    if(best>=0){state.preview.dragCorner=best;els.editorCanvas.setPointerCapture(e.pointerId);drawEditor();}
  });
  els.editorCanvas.addEventListener('pointermove', (e) => {
    const idx=state.preview.dragCorner,map=state.preview.mapping,page=activePage(); if(idx<0||!map||!page)return;
    // Something else (e.g. an in-flight detect/export) can flip state.busy
    // true after the drag already started via pointerdown's guard — bail out
    // of the drag immediately rather than keep writing to page.corners.
    if(state.busy){state.preview.dragCorner=-1;return;}
    const p=pointerToCss(e); page.corners[idx]={x:clamp((p.x-map.ox)/map.dw,.002,.998),y:clamp((p.y-map.oy)/map.dh,.002,.998)};
    page.confidence=Math.max(page.confidence,.62); drawEditor();
  });
  function endCornerDrag(){
    if(state.preview.dragCorner<0)return;
    state.preview.dragCorner=-1;
    if(state.busy)return;
    // Re-label TL/TR/BR/BL only once the drag ends. Re-ordering on every
    // pointermove can move the handle out from under the finger mid-drag.
    const page=activePage(); if(page)page.corners=orderCorners(page.corners);
    renderThumbs();drawEditor();updateSummaryOnly();
  }
  els.editorCanvas.addEventListener('pointerup',endCornerDrag); els.editorCanvas.addEventListener('pointercancel',endCornerDrag);

  function updateSummaryOnly(){
    const review=state.pages.filter(p=>p.confidence<.58).length;
    renderConfidenceHint();
    els.pageCount.textContent=`${state.pages.length} trang`; els.reviewCount.textContent=review?`${review} cần kiểm tra`:'Tất cả đã ổn';
    els.exportSummary.innerHTML=`<div><span>Số trang</span><strong>${state.pages.length}</strong></div><div><span>Trang cần kiểm tra</span><strong>${review}</strong></div>`;
  }

  // ---------- Auto Enhance pixel pipeline ----------
  // Real per-pixel processing (not CSS brightness/contrast) shared by the
  // editor preview and the PDF export path, so what the user sees is what
  // gets written to the PDF. See docs/brain/01-architecture.md for the design.

  function computeLuma(data, w, h) {
    const n = w * h;
    const luma = new Float32Array(n);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      luma[p] = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    }
    return luma;
  }

  function channelHistogram(data, w, h, offset) {
    const hist = new Uint32Array(256);
    for (let i = offset; i < data.length; i += 4) hist[data[i]]++;
    return hist;
  }

  function histPercentile(hist, total, pct) {
    const target = total * pct;
    let acc = 0;
    for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= target) return i; }
    return 255;
  }

  // Separable box blur (sliding-window sum, O(n) regardless of radius) used
  // both as the "local average" for local-contrast/normalization and as the
  // narrow blur behind the unsharp-mask sharpen step.
  function boxBlur(src, w, h, r) {
    if (r < 1) return src.slice();
    const clampi = (v, hi) => v < 0 ? 0 : (v > hi ? hi : v);
    const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
    const norm = 1 / (2 * r + 1);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let sum = 0;
      for (let x = -r; x <= r; x++) sum += src[row + clampi(x, w - 1)];
      for (let x = 0; x < w; x++) {
        tmp[row + x] = sum * norm;
        sum += src[row + clampi(x + r + 1, w - 1)] - src[row + clampi(x - r, w - 1)];
      }
    }
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) sum += tmp[clampi(y, h - 1) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = sum * norm;
        sum += tmp[clampi(y + r + 1, h - 1) * w + x] - tmp[clampi(y - r, h - 1) * w + x];
      }
    }
    return out;
  }

  // Auto Enhance (color): percentile-based auto levels + light background
  // whitening, wide-radius local contrast, then a narrow unsharp sharpen.
  // The level correction is blended with a shared luma target (LEVEL_BLEND)
  // instead of applying each channel's own gain fully independently, which
  // is what keeps red stamps/colored ink from drifting toward gray.
  function enhanceAuto(imageData) {
    const { data, width: w, height: h } = imageData;
    const n = w * h;
    if (n < 4) return;

    // Background normalization first: a whole-page lighting gradient/shadow
    // is a much LOWER spatial frequency than per-character contrast, so it
    // needs a blur radius comparable to the page itself, not a small one.
    // The box blur is O(n) regardless of radius, so a large radius costs
    // nothing extra — dividing it out here (instead of after the levels
    // stretch) keeps the next step's global percentiles from being skewed
    // by one corner of the page being brighter than the other.
    const shadeR = clamp(Math.round(Math.min(w, h) * 0.35), 30, 260);
    const shading = boxBlur(computeLuma(data, w, h), w, h, shadeR);
    // Target the brightest plausible background patch (a high percentile,
    // not the mean — the mean gets pulled down by ink/photos and would
    // darken already-bright paper instead of lifting the dim corners up to
    // match it) and only ever brighten (gain floored at 1) so this step
    // can't wash out or darken a region that was already well lit.
    const shadeHist = new Uint32Array(256);
    for (let p = 0; p < n; p++) shadeHist[clamp(Math.round(shading[p]), 0, 255)]++;
    const targetShade = clamp(histPercentile(shadeHist, n, 0.9), 120, 245);
    const MAX_SHADE_GAIN = 2.2;
    for (let p = 0, i = 0; p < n; p++, i += 4) {
      const g = clamp(targetShade / Math.max(shading[p], 25), 1, MAX_SHADE_GAIN);
      data[i] = clamp(data[i] * g, 0, 255);
      data[i + 1] = clamp(data[i + 1] * g, 0, 255);
      data[i + 2] = clamp(data[i + 2] * g, 0, 255);
    }

    // Auto levels: percentile-based per-channel stretch (auto white balance),
    // blended with a shared luma target so red stamps/colored ink don't drift
    // toward gray (LEVEL_BLEND controls how much per-channel correction applies).
    const histR = channelHistogram(data, w, h, 0), histG = channelHistogram(data, w, h, 1), histB = channelHistogram(data, w, h, 2);
    const LOW_PCT = 0.006, HIGH_PCT = 0.992, OUT_LO = 6, OUT_HI = 250, LEVEL_BLEND = 0.55;
    const loR = histPercentile(histR, n, LOW_PCT), hiR = Math.max(loR + 8, histPercentile(histR, n, HIGH_PCT));
    const loG = histPercentile(histG, n, LOW_PCT), hiG = Math.max(loG + 8, histPercentile(histG, n, HIGH_PCT));
    const loB = histPercentile(histB, n, LOW_PCT), hiB = Math.max(loB + 8, histPercentile(histB, n, HIGH_PCT));
    const loY = (loR + loG + loB) / 3, hiY = (hiR + hiG + hiB) / 3;
    let loRf = loR * LEVEL_BLEND + loY * (1 - LEVEL_BLEND), hiRf = hiR * LEVEL_BLEND + hiY * (1 - LEVEL_BLEND);
    let loGf = loG * LEVEL_BLEND + loY * (1 - LEVEL_BLEND), hiGf = hiG * LEVEL_BLEND + hiY * (1 - LEVEL_BLEND);
    let loBf = loB * LEVEL_BLEND + loY * (1 - LEVEL_BLEND), hiBf = hiB * LEVEL_BLEND + hiY * (1 - LEVEL_BLEND);
    // Floor the stretch span: a page with no genuinely dark content anywhere
    // (near-blank, or a gradient with no ink to anchor the low percentile)
    // would otherwise have its whole percentile range sit inside a narrow
    // band, and stretching that sliver to the full OUT_LO..OUT_HI range
    // amplifies tiny residual shading/noise into a fake black-to-white swing.
    const MIN_SPAN = 70;
    const widenSpan = (lo, hi) => {
      if (hi - lo >= MIN_SPAN) return [lo, hi];
      const mid = (lo + hi) / 2;
      return [mid - MIN_SPAN / 2, mid + MIN_SPAN / 2];
    };
    [loRf, hiRf] = widenSpan(loRf, hiRf);
    [loGf, hiGf] = widenSpan(loGf, hiGf);
    [loBf, hiBf] = widenSpan(loBf, hiBf);
    const gainR = (OUT_HI - OUT_LO) / (hiRf - loRf), gainG = (OUT_HI - OUT_LO) / (hiGf - loGf), gainB = (OUT_HI - OUT_LO) / (hiBf - loBf);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = clamp((data[i] - loRf) * gainR + OUT_LO, 0, 255);
      data[i + 1] = clamp((data[i + 1] - loGf) * gainG + OUT_LO, 0, 255);
      data[i + 2] = clamp((data[i + 2] - loBf) * gainB + OUT_LO, 0, 255);
    }

    // Local contrast: a narrower unsharp pass at roughly paragraph/character
    // scale, on top of the already-flattened background.
    const wideR = clamp(Math.round(Math.min(w, h) * 0.05), 6, 40);
    const wideBlur = boxBlur(computeLuma(data, w, h), w, h, wideR);
    const luma1 = computeLuma(data, w, h);
    const LOCAL_AMOUNT = 0.3;
    for (let p = 0, i = 0; p < n; p++, i += 4) {
      const add = (luma1[p] - wideBlur[p]) * LOCAL_AMOUNT;
      data[i] = clamp(data[i] + add, 0, 255);
      data[i + 1] = clamp(data[i + 1] + add, 0, 255);
      data[i + 2] = clamp(data[i + 2] + add, 0, 255);
    }

    // Sharpen: narrow-radius unsharp mask so text edges read crisper without
    // the halo a large radius or a high amount would introduce.
    const luma2 = computeLuma(data, w, h);
    const narrowBlur = boxBlur(luma2, w, h, 1);
    const SHARPEN_AMOUNT = 0.55;
    for (let p = 0, i = 0; p < n; p++, i += 4) {
      const add = (luma2[p] - narrowBlur[p]) * SHARPEN_AMOUNT;
      data[i] = clamp(data[i] + add, 0, 255);
      data[i + 1] = clamp(data[i + 1] + add, 0, 255);
      data[i + 2] = clamp(data[i + 2] + add, 0, 255);
    }
  }

  // Đen trắng (upgraded): grayscale + percentile levels, then divide out a
  // wide local background estimate (a lightweight stand-in for adaptive
  // threshold/CLAHE) so uneven lighting doesn't leave a patchy page, and a
  // small sharpen. Kept continuous-tone (not hard binarized) so thin strokes
  // and half-tone photos on the page don't get destroyed.
  function enhanceBW(imageData) {
    const { data, width: w, height: h } = imageData;
    const n = w * h;
    if (n < 4) return;
    const luma = computeLuma(data, w, h);
    const hist = new Uint32Array(256);
    for (let p = 0; p < n; p++) hist[Math.round(clamp(luma[p], 0, 255))]++;
    const lo = histPercentile(hist, n, 0.01), hi = Math.max(lo + 70, histPercentile(hist, n, 0.97));
    const gain = (250 - 4) / (hi - lo);
    const stretched = new Float32Array(n);
    for (let p = 0; p < n; p++) stretched[p] = clamp((luma[p] - lo) * gain + 4, 0, 255);

    // Wide radius so a whole-page lighting gradient is what gets divided out,
    // not just per-character contrast (a narrow radius barely differs from
    // the pixel itself across a slow gradient, so it wouldn't flatten it).
    const radius = clamp(Math.round(Math.min(w, h) * 0.35), 30, 260);
    const localAvg = boxBlur(stretched, w, h, radius);
    const normalized = new Float32Array(n);
    for (let p = 0; p < n; p++) {
      const bg = Math.max(localAvg[p], 40);
      normalized[p] = clamp((stretched[p] / bg) * 235, 0, 255);
    }

    const narrowBlur = boxBlur(normalized, w, h, 1);
    for (let p = 0, i = 0; p < n; p++, i += 4) {
      const v = clamp(normalized[p] + (normalized[p] - narrowBlur[p]) * 0.5, 0, 255);
      data[i] = data[i + 1] = data[i + 2] = v;
    }
  }

  function enhanceCanvas(canvas, mode) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    if (mode === 'auto') enhanceAuto(imageData);
    else if (mode === 'bw') enhanceBW(imageData);
    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  // ---------- Perspective rendering (WebGL) ----------
  let glState = null;
  let glUnavailable = false;
  function getGL(){
    if(glState)return glState;
    const canvas=document.createElement('canvas');
    const gl=canvas.getContext('webgl',{premultipliedAlpha:false,preserveDrawingBuffer:true,antialias:false});
    if(!gl) throw new Error('Trình duyệt không hỗ trợ WebGL.');
    const vs=`attribute vec2 a_position; varying vec2 v_uv; void main(){v_uv=a_position*0.5+0.5;gl_Position=vec4(a_position,0.0,1.0);}`;
    const fs=`precision highp float; varying vec2 v_uv; uniform sampler2D u_image; uniform mat3 u_h; void main(){vec2 dest=vec2(v_uv.x,1.0-v_uv.y);vec3 q=u_h*vec3(dest,1.0);vec2 uv=q.xy/q.z; if(uv.x<0.0||uv.x>1.0||uv.y<0.0||uv.y>1.0){gl_FragColor=vec4(1.0);}else{gl_FragColor=texture2D(u_image,uv);}}`;
    const compile=(type,src)=>{const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;};
    const prog=gl.createProgram();gl.attachShader(prog,compile(gl.VERTEX_SHADER,vs));gl.attachShader(prog,compile(gl.FRAGMENT_SHADER,fs));gl.linkProgram(prog);if(!gl.getProgramParameter(prog,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const buf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buf);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
    const pos=gl.getAttribLocation(prog,'a_position');gl.enableVertexAttribArray(pos);gl.vertexAttribPointer(pos,2,gl.FLOAT,false,0,0);
    const tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,tex);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.uniform1i(gl.getUniformLocation(prog,'u_image'),0);
    glState={canvas,gl,prog,tex,hLoc:gl.getUniformLocation(prog,'u_h')}; return glState;
  }

  function solveLinear(A,b){
    const n=b.length; A=A.map((r,i)=>r.slice().concat(b[i]));
    for(let col=0;col<n;col++){
      let pivot=col;for(let r=col+1;r<n;r++)if(Math.abs(A[r][col])>Math.abs(A[pivot][col]))pivot=r;
      [A[col],A[pivot]]=[A[pivot],A[col]]; const pv=A[col][col]; if(Math.abs(pv)<1e-10)throw new Error('Không tính được phối cảnh.');
      for(let c=col;c<=n;c++)A[col][c]/=pv;
      for(let r=0;r<n;r++)if(r!==col){const f=A[r][col];for(let c=col;c<=n;c++)A[r][c]-=f*A[col][c];}
    }
    return A.map(r=>r[n]);
  }

  // Maps the unit square (0,0)(1,0)(1,1)(0,1) onto the destination quad, i.e.
  // output pixel -> source pixel, which is what an inverse warp needs.
  function homographyCoeffs(dst){
    const src=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}],A=[],b=[];
    for(let i=0;i<4;i++){
      const x=src[i].x,y=src[i].y,u=dst[i].x,v=dst[i].y;
      A.push([x,y,1,0,0,0,-u*x,-u*y]); b.push(u);
      A.push([0,0,0,x,y,1,-v*x,-v*y]); b.push(v);
    }
    return solveLinear(A,b);
  }

  function homographyFromUnitQuad(dst){
    const h=homographyCoeffs(dst);
    // GLSL mat3 expects column-major: [h11,h21,h31,h12,h22,h32,h13,h23,h33]
    return new Float32Array([h[0],h[3],h[6], h[1],h[4],h[7], h[2],h[5],1]);
  }

  // Same warp without WebGL, for browsers/devices where the GL context fails.
  function warpCpu(oriented, corners, outW, outH){
    const sctx=oriented.getContext('2d',{willReadFrequently:true});
    const sw=oriented.width, sh=oriented.height;
    const sd=sctx.getImageData(0,0,sw,sh).data;
    const out=new ImageData(outW,outH), od=out.data;
    const h=homographyCoeffs(corners);
    for(let y=0;y<outH;y++){
      const ny=(y+0.5)/outH;
      for(let x=0;x<outW;x++){
        const nx=(x+0.5)/outW;
        const den=h[6]*nx+h[7]*ny+1;
        const o=(y*outW+x)*4;
        if(!den){ od[o]=od[o+1]=od[o+2]=255; od[o+3]=255; continue; }
        const u=(h[0]*nx+h[1]*ny+h[2])/den, v=(h[3]*nx+h[4]*ny+h[5])/den;
        if(u<0||u>1||v<0||v>1){ od[o]=od[o+1]=od[o+2]=255; od[o+3]=255; continue; }
        const fx=clamp(u*sw-0.5,0,sw-1), fy=clamp(v*sh-0.5,0,sh-1);
        const x0=fx|0, y0=fy|0, x1=Math.min(sw-1,x0+1), y1=Math.min(sh-1,y0+1);
        const ax=fx-x0, ay=fy-y0;
        const i00=(y0*sw+x0)*4, i10=(y0*sw+x1)*4, i01=(y1*sw+x0)*4, i11=(y1*sw+x1)*4;
        for(let c=0;c<3;c++){
          const top=sd[i00+c]+(sd[i10+c]-sd[i00+c])*ax;
          const bot=sd[i01+c]+(sd[i11+c]-sd[i01+c])*ax;
          od[o+c]=top+(bot-top)*ay;
        }
        od[o+3]=255;
      }
    }
    const canvas=document.createElement('canvas');
    canvas.width=outW; canvas.height=outH;
    canvas.getContext('2d',{alpha:false}).putImageData(out,0,0);
    return canvas;
  }

  async function renderPageCanvas(page, maxEdge){
    const source=await loadImage(page.file);
    try{
      const oriented=drawRotatedToCanvas(source,page.rotation,Math.max(maxEdge*1.5,1200));
      const p=page.corners;
      const pix=p.map(q=>({x:q.x*oriented.width,y:q.y*oriented.height}));
      const rawW=Math.max(dist(pix[0],pix[1]),dist(pix[3],pix[2]));
      const rawH=Math.max(dist(pix[0],pix[3]),dist(pix[1],pix[2]));
      let outW=Math.max(320,rawW),outH=Math.max(320,rawH);
      const scale=Math.min(1,maxEdge/Math.max(outW,outH));outW=Math.max(320,Math.round(outW*scale));outH=Math.max(320,Math.round(outH*scale));
      let warped=null;
      if(!glUnavailable){
        try{
          const gs=getGL(),gl=gs.gl;gs.canvas.width=outW;gs.canvas.height=outH;gl.viewport(0,0,outW,outH);gl.useProgram(gs.prog);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,gs.tex);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,oriented);gl.uniformMatrix3fv(gs.hLoc,false,homographyFromUnitQuad(p));gl.drawArrays(gl.TRIANGLES,0,6);
          warped=gs.canvas;
        }catch(err){ glUnavailable=true; console.warn('WebGL khong dung duoc, chuyen sang CPU:',err); }
      }
      if(!warped) warped=warpCpu(oriented,p,outW,outH);
      const final=document.createElement('canvas');final.width=outW;final.height=outH;const ctx=final.getContext('2d',{alpha:false});ctx.fillStyle='white';ctx.fillRect(0,0,outW,outH);
      // Both warp paths already produce the desired visual orientation.
      if(PIXEL_FILTERS.has(page.filter)){
        ctx.drawImage(warped,0,0,outW,outH);
        enhanceCanvas(final,page.filter);
      }else{
        ctx.filter = FILTER_CSS[page.filter] || 'none';
        ctx.drawImage(warped,0,0,outW,outH);ctx.filter='none';
      }
      return final;
    }finally{source.close?.();}
  }

  function canvasToJpeg(canvas,quality){return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Không tạo được ảnh JPEG.')),'image/jpeg',quality));}

  // ---------- Scan ID: front/back → single A4 page ----------
  // Composes two already-cropped/warped/filtered card canvases (the exact
  // output of renderPageCanvas(), reused unchanged) onto one A4-portrait
  // raster: front on top, back on bottom, same target width (~65% of A4 width)
  // so a big/small source resolution difference between the two sides never
  // shows up as a size difference on the page. "Bản in đẹp" is the only
  // preset (V1) — a physical-size (85.60×53.98mm true-scale) preset is
  // backlog, see docs/brain/04-current-tasks.md.
  const A4_PORTRAIT_RATIO = 841.89 / 595.28;

  function calculateIdA4Layout(frontW, frontH, backW, backH, options = {}) {
    const pageW = options.pageW || 1240;
    const pageH = options.pageH || Math.round(pageW * A4_PORTRAIT_RATIO);
    const targetWidthRatio = options.targetWidthRatio || 0.65;
    const targetCardW = Math.round(pageW * targetWidthRatio);
    const gapMm = options.gapMm !== undefined ? options.gapMm : 28;
    const pxPerMm = pageW / 210;
    const gap = options.gap !== undefined ? options.gap : Math.round(gapMm * pxPerMm);
    const maxCardH = (pageH - gap - Math.round(pageH * 0.08)) / 2;

    const measureCard = (w, h) => {
      const srcW = Math.max(1, w || 1), srcH = Math.max(1, h || 1);
      const ratio = srcH / srcW;
      let dw = targetCardW, dh = Math.round(dw * ratio);
      if (dh > maxCardH) {
        dh = Math.round(maxCardH);
        dw = Math.round(dh / ratio);
      }
      return { width: dw, height: dh };
    };

    const frontSize = measureCard(frontW, frontH);
    const backSize = measureCard(backW, backH);
    const contentHeight = frontSize.height + gap + backSize.height;
    const startY = Math.round((pageH - contentHeight) / 2);

    const front = {
      x: Math.round((pageW - frontSize.width) / 2),
      y: startY,
      width: frontSize.width,
      height: frontSize.height,
    };

    const back = {
      x: Math.round((pageW - backSize.width) / 2),
      y: startY + frontSize.height + gap,
      width: backSize.width,
      height: backSize.height,
    };

    return {
      pageW,
      pageH,
      gap,
      contentHeight,
      startY,
      front,
      back,
    };
  }

  function composeIdA4(frontCanvas, backCanvas) {
    const layout = calculateIdA4Layout(frontCanvas.width, frontCanvas.height, backCanvas.width, backCanvas.height);
    const canvas = document.createElement('canvas');
    canvas.width = layout.pageW; canvas.height = layout.pageH;
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, layout.pageW, layout.pageH);

    ctx.drawImage(frontCanvas, 0, 0, frontCanvas.width, frontCanvas.height, layout.front.x, layout.front.y, layout.front.width, layout.front.height);
    ctx.drawImage(backCanvas, 0, 0, backCanvas.width, backCanvas.height, layout.back.x, layout.back.y, layout.back.width, layout.back.height);
    return canvas;
  }

  function resetIdScan() {
    const s = state.idScan;
    if (s.front) URL.revokeObjectURL(s.front.url);
    if (s.back) URL.revokeObjectURL(s.back.url);
    state.idScan = { step: 'front', front: null, back: null };
  }

  async function addIdFile(file) {
    if (!file || !isSupportedImage(file)) { toast('Hãy chọn ảnh JPG, PNG hoặc WEBP.'); return; }
    const step = state.idScan.step;
    if (step !== 'front' && step !== 'back') return;
    const prev = state.idScan[step];
    if (prev) URL.revokeObjectURL(prev.url);
    const side = {
      id: uid(), file, name: file.name || (step === 'front' ? 'MatTruoc' : 'MatSau'),
      url: URL.createObjectURL(file), corners: cloneCorners(DEFAULT_CORNERS),
      confidence: 0, rotation: 0, filter: 'auto', width: 0, height: 0
    };
    state.idScan[step] = side;
    renderModeShell();
    setBusy(true, 'Đang nhận mép…');
    try { await detectPage(side, false); } finally { setBusy(false); }
    renderModeShell();
  }

  function setIdProgress(percent, label) {
    els.idExportProgress.classList.remove('hidden');
    els.idProgressBar.style.width = `${clamp(percent, 0, 100)}%`;
    els.idProgressLabel.textContent = label;
  }

  // Same freeze-before-render discipline as exportPdf()/snapshotExportJob():
  // read state.idScan exactly once, before setBusy(true), and never touch
  // state.idScan again inside the async render/compose/build chain below.
  async function exportIdPdf() {
    if (state.busy) return;
    const { front, back } = state.idScan;
    if (!front || !back) { toast('Cần đủ cả mặt trước và mặt sau trước khi xuất.'); return; }
    const job = {
      front: { file: front.file, name: front.name, corners: cloneCorners(front.corners), rotation: front.rotation, filter: front.filter },
      back: { file: back.file, name: back.name, corners: cloneCorners(back.corners), rotation: back.rotation, filter: back.filter },
      fileName: 'VigilLens-ID'
    };
    setBusy(true, 'Đang xuất PDF…'); els.idExportNotice.classList.add('hidden'); setIdProgress(5, 'Đang dựng mặt trước…');
    try {
      const frontCanvas = await renderPageCanvas(job.front, 1600);
      setIdProgress(45, 'Đang dựng mặt sau…');
      const backCanvas = await renderPageCanvas(job.back, 1600);
      setIdProgress(75, 'Đang ghép trang A4…');
      const composed = composeIdA4(frontCanvas, backCanvas);
      const blob = await canvasToJpeg(composed, 0.92);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      setIdProgress(92, 'Đang đóng gói PDF…');
      const pdf = buildPdf([{ bytes, width: composed.width, height: composed.height }], 'a4', false);
      const name = job.fileName + '.pdf';
      const a = document.createElement('a'); a.href = URL.createObjectURL(pdf); a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      setIdProgress(100, `Hoàn tất · ${(pdf.size / 1024 / 1024).toFixed(2)} MB`);
      toast(`Đã xuất ${name} · ${(pdf.size / 1024 / 1024).toFixed(2)} MB`, 3500);
    } catch (err) {
      console.error(err);
      els.idExportNotice.textContent = `Không xuất được PDF: ${err.message || err}`;
      els.idExportNotice.classList.remove('hidden');
      toast('Có lỗi khi xuất PDF.');
    } finally {
      setBusy(false);
      setTimeout(() => els.idExportProgress.classList.add('hidden'), 5000);
    }
  }

  // Lower-resolution rehearsal of exactly the export pipeline above
  // (renderPageCanvas → composeIdA4), so what the A4 preview shows is the
  // same geometry/filter/order the exported PDF will contain.
  async function renderIdPreview() {
    const { front, back } = state.idScan;
    const canvas = els.idPreviewCanvas;
    const stage = canvas.parentElement;
    const cssW = Math.max(280, stage.clientWidth), cssH = Math.max(320, stage.clientHeight);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
    canvas.style.width = `${cssW}px`; canvas.style.height = `${cssH}px`;
    const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH); ctx.fillStyle = '#1c1210'; ctx.fillRect(0, 0, cssW, cssH);
    if (!front || !back) return;
    setBusy(true, 'Đang dựng trang A4…');
    try {
      const [fc, bc] = await Promise.all([renderPageCanvas(front, 900), renderPageCanvas(back, 900)]);
      const composed = composeIdA4(fc, bc);
      const scale = Math.min((cssW - 24) / composed.width, (cssH - 24) / composed.height);
      const dw = composed.width * scale, dh = composed.height * scale, ox = (cssW - dw) / 2, oy = (cssH - dh) / 2;
      ctx.fillStyle = '#fff'; ctx.fillRect(ox, oy, dw, dh);
      ctx.drawImage(composed, ox, oy, dw, dh);
    } finally { setBusy(false); }
  }

  // ---------- Mode switching (Scan tài liệu / Scan ID) ----------
  const editorCardEl = $('.editor');
  const exportPanelEl = $('.export-panel');

  function relocateEditor(mode) {
    if (mode === 'id') els.idEditorSlot.appendChild(editorCardEl);
    else els.workspace.insertBefore(editorCardEl, exportPanelEl);
    editorCardEl.classList.toggle('id-hosted', mode === 'id');
  }

  function enterMode(mode) {
    state.mode = mode;
    if (mode !== 'party' && mode !== 'watermark') relocateEditor(mode);
    renderModeShell();
    if (mode === 'party') window.VigilLensParty?.activate();
    if (mode === 'watermark') window.VigilLensWatermark?.activate();
  }

  function updateIdShell() {
    if (state.mode !== 'id') return;
    const s = state.idScan;
    const label = s.step === 'front' ? 'Mặt trước' : s.step === 'back' ? 'Mặt sau' : 'Xem trước';
    els.idStepBadge.textContent = label;
    els.idStepHint.textContent = s.step === 'front' ? 'Chụp hoặc chọn ảnh mặt trước căn cước.'
      : s.step === 'back' ? 'Chụp hoặc chọn ảnh mặt sau căn cước.' : '';
    els.idWorkspace.classList.toggle('hidden', s.step === 'preview');
    els.idPreviewSection.classList.toggle('hidden', s.step !== 'preview');
    els.idBackStepBtn.classList.toggle('hidden', s.step !== 'back');
    els.idConfirmBtn.textContent = s.step === 'front' ? 'Xác nhận mặt trước →' : 'Xác nhận mặt sau →';
    const current = activePage();
    els.idConfirmBtn.disabled = state.busy || !current || !current.file;
    if (s.step === 'preview') renderIdPreview();
    else renderSelected();
  }

  // Single entry point for top-level visibility: mode-select screen vs
  // document workflow vs Scan ID workflow vs Watermark Stripper. Mirrors how updateShell() already
  // owns emptyState/workspace visibility for document mode.
  function renderModeShell() {
    els.modeSelect.classList.toggle('hidden', state.mode !== null);
    els.switchModeBtn.classList.toggle('hidden', state.mode === null);
    if (state.mode !== 'document') { els.emptyState.classList.add('hidden'); els.workspace.classList.add('hidden'); }
    if (state.mode !== 'id') { els.idWorkspace.classList.add('hidden'); els.idPreviewSection.classList.add('hidden'); }
    if (state.mode !== 'watermark') {
      const wmWs = $('#watermarkWorkspace');
      if (wmWs) wmWs.classList.add('hidden');
    }
    if (state.mode === 'document') updateShell();
    else if (state.mode === 'id') updateIdShell();
  }

  // ---------- Minimal PDF writer ----------
  const enc=new TextEncoder();
  function concatBytes(parts){let len=0;for(const p of parts)len+=p.length;const out=new Uint8Array(len);let off=0;for(const p of parts){out.set(p,off);off+=p.length;}return out;}
  function strBytes(s){return enc.encode(s);}

  function buildPdf(jpegs,pageMode,margin){
    const objects=[]; const add=(content)=>{objects.push(content);return objects.length;};
    const catalogId=add(null), pagesId=add(null); const pageIds=[];
    jpegs.forEach((item,i)=>{
      const imageId=add({binary:item.bytes,prefix:`<< /Type /XObject /Subtype /Image /Width ${item.width} /Height ${item.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${item.bytes.length} >>\nstream\n`,suffix:'\nendstream'});
      let pw,ph;
      if(pageMode==='a4'){const portrait=item.height>=item.width;pw=portrait?595.28:841.89;ph=portrait?841.89:595.28;}
      else{const ratio=item.height/item.width;pw=595.28;ph=clamp(pw*ratio,240,1200);}
      const pad=margin?18:0; const scale=Math.min((pw-2*pad)/item.width,(ph-2*pad)/item.height); const dw=item.width*scale,dh=item.height*scale,dx=(pw-dw)/2,dy=(ph-dh)/2;
      const content=`q\n${dw.toFixed(2)} 0 0 ${dh.toFixed(2)} ${dx.toFixed(2)} ${dy.toFixed(2)} cm\n/Im${i+1} Do\nQ\n`;
      const contentBytes=strBytes(content); const contentId=add(`<< /Length ${contentBytes.length} >>\nstream\n${content}endstream`);
      const pageId=add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pw.toFixed(2)} ${ph.toFixed(2)}] /Resources << /XObject << /Im${i+1} ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`);
      pageIds.push(pageId);
    });
    objects[catalogId-1]=`<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objects[pagesId-1]=`<< /Type /Pages /Kids [${pageIds.map(id=>`${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
    const chunks=[strBytes('%PDF-1.4\n%VigilLens\n')], offsets=[0]; let position=chunks[0].length;
    objects.forEach((obj,idx)=>{
      offsets[idx+1]=position; const head=strBytes(`${idx+1} 0 obj\n`),tail=strBytes('\nendobj\n'); chunks.push(head);position+=head.length;
      if(typeof obj==='string'){const body=strBytes(obj);chunks.push(body);position+=body.length;}
      else{const pre=strBytes(obj.prefix);chunks.push(pre,obj.binary);position+=pre.length+obj.binary.length;const suf=strBytes(obj.suffix);chunks.push(suf);position+=suf.length;}
      chunks.push(tail);position+=tail.length;
    });
    const xrefPos=position; let xref=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
    for(let i=1;i<=objects.length;i++)xref+=`${String(offsets[i]).padStart(10,'0')} 00000 n \n`;
    xref+=`trailer\n<< /Size ${objects.length+1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
    chunks.push(strBytes(xref)); return new Blob([concatBytes(chunks)],{type:'application/pdf'});
  }

  // Frozen per-page data the export pipeline reads from — never state.pages
  // directly — so reorder/filter/corner/rotation edits made while an export
  // is in flight cannot change what gets written to the PDF.
  function snapshotPagesForExport(){
    return state.pages.map(p => ({
      file: p.file, name: p.name, corners: cloneCorners(p.corners), rotation: p.rotation, filter: p.filter
    }));
  }

  async function makeJpegs(settings,pages){
    const items=[];
    for(let i=0;i<pages.length;i++){
      setProgress((i/pages.length)*88,`Đang xử lý trang ${i+1}/${pages.length}…`);
      const canvas=await renderPageCanvas(pages[i],settings.maxEdge); const blob=await canvasToJpeg(canvas,settings.jpeg); const bytes=new Uint8Array(await blob.arrayBuffer());
      items.push({bytes,width:canvas.width,height:canvas.height}); await sleepFrame();
    }
    return items;
  }

  function setProgress(percent,label){els.exportProgress.classList.remove('hidden');els.progressBar.style.width=`${clamp(percent,0,100)}%`;els.progressLabel.textContent=label;}

  // Frozen alongside the page snapshot: the export-wide settings, so changing
  // quality/page size/margin/filename in the UI while an export is already
  // running can't change what gets written to the PDF either.
  function snapshotExportJob(){
    return {
      pages: snapshotPagesForExport(),
      quality: els.quality.value,
      pageSize: els.pageSize.value,
      margin: els.marginToggle.checked,
      fileName: sanitizeFilename(els.fileName.value||'VigilLens')
    };
  }

  async function exportPdf(){
    if(!state.pages.length||state.busy)return;
    const exportJob=snapshotExportJob();
    setBusy(true,'Đang xuất PDF…');els.exportNotice.classList.add('hidden');setProgress(1,'Đang chuẩn bị…');
    try{
      let settings={...QUALITY[exportJob.quality]}; let jpegs=await makeJpegs(settings,exportJob.pages); let total=jpegs.reduce((s,j)=>s+j.bytes.length,0);
      if(exportJob.quality==='2mb'&&total>1.82*1024*1024){
        const rounds=[{maxEdge:1250,jpeg:.52},{maxEdge:1050,jpeg:.43},{maxEdge:900,jpeg:.36}];
        for(let r=0;r<rounds.length&&total>1.82*1024*1024;r++){
          setProgress(5,`Đang nén thêm để gần 2 MB (lần ${r+1})…`);settings=rounds[r];jpegs=await makeJpegs(settings,exportJob.pages);total=jpegs.reduce((s,j)=>s+j.bytes.length,0);
        }
      }
      setProgress(92,'Đang đóng gói PDF…'); const pdf=buildPdf(jpegs,exportJob.pageSize,exportJob.margin); const name=exportJob.fileName+'.pdf';
      const a=document.createElement('a');a.href=URL.createObjectURL(pdf);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),5000);
      setProgress(100,`Hoàn tất · ${(pdf.size/1024/1024).toFixed(2)} MB`);
      if(exportJob.quality==='2mb'&&pdf.size>2*1024*1024){els.exportNotice.textContent=`PDF hiện ${(pdf.size/1024/1024).toFixed(2)} MB. Với ${jpegs.length} trang, không thể giữ chất lượng đọc tốt mà xuống dưới 2 MB; app đã nén ở mức an toàn nhất.`;els.exportNotice.classList.remove('hidden');}
      toast(`Đã xuất ${name} · ${(pdf.size/1024/1024).toFixed(2)} MB`,3500);
    }catch(err){console.error(err);els.exportNotice.textContent=`Không xuất được PDF: ${err.message||err}`;els.exportNotice.classList.remove('hidden');toast('Có lỗi khi xuất PDF.');}
    finally{setBusy(false);setTimeout(()=>els.exportProgress.classList.add('hidden'),5000);}
  }

  function sanitizeFilename(name){return name.trim().replace(/[\\/:*?"<>|]+/g,'-').replace(/\s+/g,' ').slice(0,80)||'VigilLens';}

  function rotateCorners90(corners){return orderCorners(corners.map(p=>({x:1-p.y,y:p.x})));}

  // ---------- Events ----------
  els.chooseBtn.addEventListener('click',()=>els.fileInput.click()); els.addBtn.addEventListener('click',()=>els.fileInput.click()); els.cameraBtn.addEventListener('click',()=>els.cameraInput.click());
  // Every handler below guards on state.busy itself — during an export the
  // matching buttons are also disabled, but drag/drop and other code paths
  // don't go through `disabled`, so the guard has to live in the handler.
  els.fileInput.addEventListener('change',async e=>{if(state.busy||state.mode!=='document'){e.target.value='';return;}await addFiles(e.target.files);e.target.value='';});
  els.cameraInput.addEventListener('change',async e=>{if(state.busy||state.mode!=='document'){e.target.value='';return;}await addFiles(e.target.files);e.target.value='';});
  ['dragenter','dragover'].forEach(ev=>els.dropZone.addEventListener(ev,e=>{e.preventDefault();els.dropZone.classList.add('dragging');}));
  ['dragleave','drop'].forEach(ev=>els.dropZone.addEventListener(ev,e=>{e.preventDefault();els.dropZone.classList.remove('dragging');}));
  els.dropZone.addEventListener('drop',e=>{if(state.busy||state.mode!=='document')return;addFiles(e.dataTransfer.files);}); els.dropZone.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();els.fileInput.click();}});

  els.detectBtn.addEventListener('click',async()=>{if(state.busy)return;const p=activePage();if(!p)return;setBusy(true,'Đang nhận lại mép giấy…');try{await detectPage(p);}finally{setBusy(false);}});
  els.resetCropBtn.addEventListener('click',()=>{if(state.busy)return;const p=activePage();if(!p)return;p.corners=cloneCorners(DEFAULT_CORNERS);p.confidence=.4;renderThumbs();renderSelected();updateSummaryOnly();});
  els.rotateBtn.addEventListener('click',()=>{if(state.busy)return;const p=activePage();if(!p)return;p.rotation=(p.rotation+90)%360;p.corners=rotateCorners90(p.corners);renderSelected();renderThumbs();});
  els.deleteBtn.addEventListener('click',()=>removeSelected());
  function removeSelected(){if(state.busy)return;const i=getPageIndex(state.selectedId);if(i<0)return;const [p]=state.pages.splice(i,1);URL.revokeObjectURL(p.url);state.selectedId=state.pages[Math.min(i,state.pages.length-1)]?.id||null;updateShell();}
  els.moveUpBtn.addEventListener('click',()=>moveSelected(-1));els.moveDownBtn.addEventListener('click',()=>moveSelected(1));
  function moveSelected(delta){if(state.busy)return;const i=getPageIndex(state.selectedId),j=i+delta;if(i<0||j<0||j>=state.pages.length)return;[state.pages[i],state.pages[j]]=[state.pages[j],state.pages[i]];renderThumbs();}
  els.clearBtn.addEventListener('click',()=>{if(state.busy)return;if(!state.pages.length)return;if(!confirm('Xóa toàn bộ ảnh khỏi phiên làm việc này?'))return;state.pages.forEach(p=>URL.revokeObjectURL(p.url));state.pages=[];state.selectedId=null;updateShell();});
  els.autoAllBtn.addEventListener('click',async()=>{if(state.busy)return;setBusy(true,'Đang nhận lại tất cả…');try{for(let i=0;i<state.pages.length;i++){els.processingText.textContent=`Đang nhận mép ${i+1}/${state.pages.length}…`;await detectPage(state.pages[i],false);await sleepFrame();}}finally{setBusy(false);updateShell();}});
  $$('.filter-chip').forEach(btn=>btn.addEventListener('click',()=>{if(state.busy)return;const p=activePage();if(!p)return;p.filter=btn.dataset.filter;$$('.filter-chip').forEach(b=>b.classList.toggle('active',b===btn));drawEditor();}));
  els.exportBtn.addEventListener('click',exportPdf);
  window.addEventListener('resize',()=>{clearTimeout(window._scanResize);window._scanResize=setTimeout(drawEditor,80);});

  // ---------- Mode select / Scan ID events ----------
  els.modeDocBtn.addEventListener('click', () => { if (state.busy) return; enterMode('document'); });
  els.modeIdBtn.addEventListener('click', () => { if (state.busy) return; enterMode('id'); });
  if (els.modePartyBtn) els.modePartyBtn.addEventListener('click', () => { if (state.busy) return; enterMode('party'); });
  if (els.modeWatermarkBtn) els.modeWatermarkBtn.addEventListener('click', () => { if (state.busy) return; enterMode('watermark'); });

  els.switchModeBtn.addEventListener('click', () => {
    if (state.busy) return;
    const hasDocWork = state.mode === 'document' && state.pages.length > 0;
    const hasIdWork = state.mode === 'id' && (state.idScan.front || state.idScan.back);
    const hasPartyWork = state.mode === 'party' && !!window.VigilLensParty?.hasWork();
    const hasWatermarkWork = state.mode === 'watermark' && !!window.VigilLensWatermark?.hasWork();
    if ((hasDocWork || hasIdWork || hasPartyWork || hasWatermarkWork) && !confirm('Chuyển chế độ sẽ xóa ảnh đang xử lý. Tiếp tục?')) return;
    if (state.mode === 'document') { state.pages.forEach(p => URL.revokeObjectURL(p.url)); state.pages = []; state.selectedId = null; }
    if (state.mode === 'id') resetIdScan();
    if (state.mode === 'party') window.VigilLensParty?.deactivate();
    if (state.mode === 'watermark') window.VigilLensWatermark?.deactivate();
    state.preview.image?.close?.();
    state.preview.image = null; state.preview.pageId = null; state.preview.mapping = null;
    state.preview.enhancedCanvas = null; state.preview.enhancedKey = '';
    state.mode = null;
    renderModeShell();
  });

  els.idChooseBtn.addEventListener('click', () => { if (state.busy) return; els.idFileInput.click(); });
  els.idCameraBtn.addEventListener('click', () => { if (state.busy) return; els.idCameraInput.click(); });
  els.idFileInput.addEventListener('change', async e => { if (state.busy || state.mode !== 'id') { e.target.value = ''; return; } await addIdFile(e.target.files[0]); e.target.value = ''; });
  els.idCameraInput.addEventListener('change', async e => { if (state.busy || state.mode !== 'id') { e.target.value = ''; return; } await addIdFile(e.target.files[0]); e.target.value = ''; });

  els.idConfirmBtn.addEventListener('click', () => {
    if (state.busy) return;
    const cur = activePage(); if (!cur || !cur.file) return;
    if (state.idScan.step === 'front') state.idScan.step = 'back';
    else if (state.idScan.step === 'back') state.idScan.step = 'preview';
    renderModeShell();
  });
  els.idBackStepBtn.addEventListener('click', () => { if (state.busy || state.idScan.step !== 'back') return; state.idScan.step = 'front'; renderModeShell(); });
  els.idEditFrontBtn.addEventListener('click', () => { if (state.busy) return; state.idScan.step = 'front'; renderModeShell(); });
  els.idEditBackBtn.addEventListener('click', () => { if (state.busy) return; state.idScan.step = 'back'; renderModeShell(); });
  els.idExportBtn.addEventListener('click', exportIdPdf);

  // Small read-only bridge for Party Document Mode. The existing image
  // pipeline remains the single implementation for crop/filter/export.
  window.VigilLensCore = { renderPageCanvas, buildPdf, detectPage, defaultCorners: cloneCorners(DEFAULT_CORNERS) };
  // PWA install + offline state
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();state.deferredInstallPrompt=e;els.installBtn.classList.remove('hidden');});
  els.installBtn.addEventListener('click',async()=>{if(!state.deferredInstallPrompt)return;state.deferredInstallPrompt.prompt();await state.deferredInstallPrompt.userChoice;state.deferredInstallPrompt=null;els.installBtn.classList.add('hidden');});
  function updateOnlineBadge(){if(!els.offlineBadge)return;els.offlineBadge.textContent=navigator.onLine?'Xử lý trên thiết bị':'Offline · vẫn dùng được';}
  addEventListener('online',updateOnlineBadge);addEventListener('offline',updateOnlineBadge);updateOnlineBadge();

  // Service Worker registration + update detection
  if('serviceWorker'in navigator&&location.protocol!=='file:'){
    let pendingWorker=null;
    function showUpdateBanner(worker){
      pendingWorker=worker;
      if(els.updateBanner)els.updateBanner.classList.remove('hidden');
    }
    navigator.serviceWorker.register('./sw.js').then(reg=>{
      // If a new SW is already waiting (e.g. page was open during install)
      if(reg.waiting){showUpdateBanner(reg.waiting);}
      // Watch for new SW installing
      reg.addEventListener('updatefound',()=>{
        const newWorker=reg.installing;
        if(!newWorker)return;
        newWorker.addEventListener('statechange',()=>{
          if(newWorker.state==='installed'&&navigator.serviceWorker.controller){
            showUpdateBanner(newWorker);
          }
        });
      });
      // Periodically check for updates (every 60 minutes when online)
      setInterval(()=>{if(navigator.onLine)reg.update().catch(()=>{});},60*60*1000);
    }).catch(err=>console.warn('Service worker:',err));
    // "Cập nhật" button → tell waiting SW to activate, then reload
    if(els.updateBtn)els.updateBtn.addEventListener('click',()=>{
      if(pendingWorker){pendingWorker.postMessage({type:'SKIP_WAITING'});}
      if(els.updateBanner)els.updateBanner.classList.add('hidden');
    });
    // Dismiss button
    if(els.updateDismiss)els.updateDismiss.addEventListener('click',()=>{
      if(els.updateBanner)els.updateBanner.classList.add('hidden');
    });
    // When the new SW takes over, reload the page to load new assets
    navigator.serviceWorker.addEventListener('controllerchange',()=>{location.reload();});
  }

  renderModeShell();
})();

/* VPH Vigil Lens — Party Document Mode (session-only, local processing). */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const els = {
    empty: $('partyEmptyState'), workspace: $('partyWorkspace'), documents: $('partyDocuments'),
    coverageText: $('partyCoverageText'), coverageBar: $('partyCoverageBar'), coverageWarning: $('partyCoverageWarning'),
    orderPanel: $('partyOrderPanel'), exportAll: $('partyExportAllBtn'), exportStatus: $('partyExportStatus'),
    fileInput: $('partyFileInput'), cameraInput: $('partyCameraInput'), pdfInput: $('partyPdfInput'),
    cameraBtn: $('partyCameraBtn'), chooseBtn: $('partyChooseBtn'), pdfBtn: $('partyPdfBtn'),
    addBtn: $('partyAddBtn'), addPdfBtn: $('partyAddPdfBtn'),
    selectionBar: $('partySelectionBar'), selectionCount: $('partySelectionCount'),
    createDocBtn: $('partyCreateDocBtn'), selectAllBtn: $('partySelectAllBtn'),
    clearSelectionBtn: $('partyClearSelectionBtn'),
    rangeInput: $('partyRangeInput'), rangeBtn: $('partyRangeBtn'),
    helpDialog: $('partyHelpDialog'), helpClose: $('partyHelpClose'),
    viewerDialog: $('partyPreviewDialog'), viewerCanvas: $('partyPreviewCanvas'), viewerImage: $('partyPreviewImage'),
    viewerTitle: $('partyPreviewTitle'), viewerMeta: $('partyPreviewMeta'), viewerStatus: $('partyPreviewStatus'),
    viewerPrev: $('partyPreviewPrev'), viewerNext: $('partyPreviewNext'), viewerRotate: $('partyPreviewRotate'),
    viewerClose: $('partyPreviewClose')
  };

  const state = {
    active: false, busy: false, sources: [], documents: [], selected: null,
    orderConfirmed: false, pendingAction: null, nextDocument: 1, selectedPages: new Set(),
    previewObserver: null, previewQueue: new Map(), previewRunning: false, previewGeneration: 0,
    cachedThumbPages: [], viewer: { pageId: null, generation: 0 }
  };

  const defaultCorners = [{ x: .045, y: .045 }, { x: .955, y: .045 }, { x: .955, y: .955 }, { x: .045, y: .955 }];
  const imageExt = /\.(jpe?g|png|webp)$/i;
  const esc = value => String(value || '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const uid = prefix => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  function taxonomy() {
    const data = window.PartyTaxonomy;
    if (!data || !Array.isArray(data.document_types) || data.document_types.length !== 104) throw new Error('Taxonomy local bị thiếu hoặc không hợp lệ.');
    return data.document_types;
  }

  function toast(message) {
    const node = $('toast');
    if (node) { node.textContent = message; node.classList.remove('hidden'); setTimeout(() => node.classList.add('hidden'), 3200); }
  }

  function openHelp() { if (els.helpDialog?.showModal) els.helpDialog.showModal(); }

  function isImage(file) { return !!file && (/^image\/(jpeg|jpg|png|webp)$/i.test(file.type || '') || (!file.type && imageExt.test(file.name || ''))); }
  function isPdf(file) { return !!file && (/application\/pdf/i.test(file.type || '') || /\.pdf$/i.test(file.name || '')); }

  function createImagePage(file) {
    return { id: uid('image'), kind: 'image', file, name: file.name || 'Ảnh mới', url: URL.createObjectURL(file),
      corners: defaultCorners.map(p => ({ ...p })), rotation: 0, filter: 'auto', confidence: .4, sourcePage: null };
  }

  function createPdfPages(file, source) {
    return Array.from({ length: source.pageCount }, (_, index) => {
      const info = PartyPdf.pageInfo(source, index);
      return {
        id: uid('pdf-page'), kind: 'pdf', file, name: `${file.name || 'Tài liệu PDF'} · trang ${index + 1}`,
        url: '', source, sourcePage: index, sourceTotalPages: source.pageCount,
        previewState: 'pending', previewWidth: info.width, previewHeight: info.height,
        previewThumbCanvas: null, previewRenderer: null, previewError: null,
        corners: defaultCorners.map(p => ({ ...p })), rotation: 0, filter: 'original', confidence: 1
      };
    });
  }

  function currentDocument() { return state.documents.find(doc => doc.id === state.selected?.documentId) || state.documents[0] || null; }
  function findDocumentByPageId(id) {
    for (const doc of state.documents) {
      if (doc.pages.some(item => item.id === id)) return doc;
    }
    return null;
  }
  function pageById(id) {
    const page = state.sources.find(item => item.id === id);
    if (!page) {
      for (const doc of state.documents) {
        const p = doc.pages.find(item => item.id === id);
        if (p) return { doc, page: p };
      }
      return null;
    }
    const doc = findDocumentByPageId(id);
    return { doc, page };
  }
  function isPageAvailable(id) {
    return !findDocumentByPageId(id);
  }
  function sourcePageKey(page) { return page.kind === 'pdf' ? `${page.source.id}:${page.sourcePage}` : page.id; }

  function pagePreview(page, index) {
    if (page.kind === 'pdf') {
      if (page.previewState === 'error') {
        return `<div class="party-pdf-thumb is-error" role="img" aria-label="Không thể hiển thị xem trước trang ${index + 1}">
          <strong>Không thể hiển thị xem trước</strong>
          <small>Trang vẫn được giữ nguyên khi xuất PDF</small>
          <button class="btn secondary small party-retry-preview" data-page-retry="${page.id}" type="button">Thử lại</button>
        </div>`;
      }
      const ratio = page.previewWidth && page.previewHeight ? ` style="aspect-ratio:${page.previewWidth}/${page.previewHeight}"` : '';
      const isReady = page.previewState === 'ready' && !!page.previewThumbCanvas;
      const statusText = page.previewRenderer === 'fallback' ? 'PDF (fallback)' : 'PDF';
      return `<div class="party-pdf-thumb ${isReady ? '' : 'is-loading'}"${ratio}><canvas class="party-pdf-preview" data-pdf-preview="${page.id}" aria-label="Xem trước trang PDF ${index + 1}"></canvas><span class="party-pdf-status">${isReady ? statusText : 'Đang dựng…'}</span></div>`;
    }
    return `<img src="${page.url}" alt="Trang ${index + 1}" loading="lazy" />`;
  }

  function frame() { return new Promise(resolve => (window.requestAnimationFrame || window.setTimeout)(resolve, 0)); }

  function disconnectPdfPreviewObserver() {
    state.previewObserver?.disconnect();
    state.previewObserver = null;
    state.previewQueue.clear();
  }

  function isCurrentPreview(canvas, page, generation) {
    const found = pageById(canvas?.dataset?.pdfPreview);
    return state.active && generation === state.previewGeneration && canvas?.isConnected && found?.page === page;
  }

  function restoreRenderedCanvases() {
    const canvases = [...els.documents.querySelectorAll('[data-pdf-preview]')];
    canvases.forEach(canvas => {
      const found = pageById(canvas.dataset.pdfPreview);
      if (found && found.page.previewThumbCanvas && found.page.previewState === 'ready') {
        const thumb = found.page.previewThumbCanvas;
        canvas.width = thumb.width;
        canvas.height = thumb.height;
        const ctx = canvas.getContext('2d', { alpha: false });
        if (ctx) {
          ctx.drawImage(thumb, 0, 0);
          canvas.dataset.previewRendered = 'true';
          canvas.parentElement?.classList.remove('is-loading');
          const status = canvas.parentElement?.querySelector('.party-pdf-status');
          if (status) status.textContent = found.page.previewRenderer === 'fallback' ? 'PDF (fallback)' : 'PDF';
        }
      }
    });
  }

  async function renderPdfPreview(canvas, generation) {
    if (!canvas?.isConnected || canvas.dataset.previewRendered === 'true') return;
    const found = pageById(canvas.dataset.pdfPreview);
    if (!found || found.page.kind !== 'pdf' || found.page.previewState === 'error') return;
    const page = found.page;
    if (!isCurrentPreview(canvas, page, generation)) return;
    if (page.previewThumbCanvas && page.previewState === 'ready') {
      const thumb = page.previewThumbCanvas;
      canvas.width = thumb.width;
      canvas.height = thumb.height;
      const ctx = canvas.getContext('2d', { alpha: false });
      if (ctx) {
        ctx.drawImage(thumb, 0, 0);
        canvas.dataset.previewRendered = 'true';
        canvas.parentElement?.classList.remove('is-loading');
        const status = canvas.parentElement?.querySelector('.party-pdf-status');
        if (status) status.textContent = page.previewRenderer === 'fallback' ? 'PDF (fallback)' : 'PDF';
      }
      return;
    }
    page.previewState = 'rendering';
    try {
      const result = await PartyPdf.renderThumbnail(page.source.page(page.sourcePage), canvas, 320, () => isCurrentPreview(canvas, page, generation), page.rotation);
      if (result?.stale || !isCurrentPreview(canvas, page, generation)) {
        if (page.previewState === 'rendering') page.previewState = 'pending';
        return;
      }
      page.previewState = 'ready';
      page.previewRenderer = result.renderer || 'pdfjs';
      if (result.layer) {
        page.previewThumbCanvas = result.layer;
      } else {
        const copy = document.createElement('canvas');
        copy.width = canvas.width; copy.height = canvas.height;
        copy.getContext('2d', { alpha: false })?.drawImage(canvas, 0, 0);
        page.previewThumbCanvas = copy;
      }
      state.cachedThumbPages = state.cachedThumbPages.filter(p => p !== page);
      state.cachedThumbPages.push(page);
      if (state.cachedThumbPages.length > 32) {
        const evicted = state.cachedThumbPages.shift();
        if (evicted) {
          evicted.previewThumbCanvas = null;
        }
      }
      canvas.dataset.previewRendered = 'true';
      canvas.parentElement?.classList.remove('is-loading');
      const status = canvas.parentElement?.querySelector('.party-pdf-status');
      if (status) status.textContent = page.previewRenderer === 'fallback' ? 'PDF (fallback)' : 'PDF';
    } catch (error) {
      if (!isCurrentPreview(canvas, page, generation)) {
        if (page.previewState === 'rendering') page.previewState = 'pending';
        return;
      }
      page.previewState = 'error';
      page.previewError = error?.message || 'Không thể hiển thị xem trước trang PDF.';
      page.previewThumbCanvas = null;
      state.cachedThumbPages = state.cachedThumbPages.filter(p => p !== page);
      const parent = canvas.parentElement;
      if (parent) {
        const pageIdx = found.doc ? found.doc.pages.indexOf(page) : state.sources.indexOf(page);
        parent.outerHTML = pagePreview(page, pageIdx >= 0 ? pageIdx : 0);
      }
    }
  }

  async function drainPdfPreviewQueue() {
    if (state.previewRunning) return;
    state.previewRunning = true;
    try {
      while (state.previewQueue.size) {
        const [canvas, generation] = state.previewQueue.entries().next().value;
        state.previewQueue.delete(canvas);
        await renderPdfPreview(canvas, generation);
        await frame();
      }
    } finally {
      state.previewRunning = false;
      if (state.previewQueue.size) drainPdfPreviewQueue();
    }
  }

  function queuePdfPreview(canvas) {
    if (!canvas?.isConnected || canvas.dataset.previewRendered === 'true') return;
    state.previewQueue.set(canvas, state.previewGeneration);
    drainPdfPreviewQueue();
  }

  function queuePdfPreviews() {
    state.previewGeneration += 1;
    disconnectPdfPreviewObserver();
    restoreRenderedCanvases();
    const canvases = [...els.documents.querySelectorAll('[data-pdf-preview]:not([data-preview-rendered="true"])')];
    canvases.slice(0, 6).forEach(queuePdfPreview);
    if (typeof IntersectionObserver === 'function' && canvases.length > 6) {
      state.previewObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            queuePdfPreview(entry.target);
            state.previewObserver?.unobserve(entry.target);
          }
        });
      }, { root: null, rootMargin: '600px', threshold: 0.01 });
      canvases.slice(6).forEach(canvas => state.previewObserver.observe(canvas));
    }
  }

  // In-place page viewer: a modal over the workspace, never a new tab, so the
  // operator keeps the document list and the split marks they were working on.
  function setViewerStatus(text, isError = false) {
    if (!els.viewerStatus) return;
    els.viewerStatus.textContent = text || '';
    els.viewerStatus.classList.toggle('hidden', !text);
    els.viewerStatus.classList.toggle('is-error', !!isError);
  }

  function clearViewerCanvas() {
    if (!els.viewerCanvas) return;
    els.viewerCanvas.width = els.viewerCanvas.width;
  }

  function viewerMaxEdge() {
    const stage = Math.max(720, Math.min(window.innerWidth || 900, (window.innerHeight || 900) * 1.4));
    return Math.min(1600, Math.round(stage * Math.min(2, window.devicePixelRatio || 1)));
  }

  async function renderPageViewer() {
    const found = pageById(state.viewer.pageId);
    const stage = els.viewerCanvas?.parentElement;
    if (!found || !stage) return;
    const { doc, page } = found;
    const list = doc ? doc.pages : state.sources;
    const index = list.indexOf(page);
    const generation = ++state.viewer.generation;

    els.viewerTitle.textContent = doc ? `Trang ${index + 1}` : `Trang nguồn ${index + 1}`;
    els.viewerMeta.textContent = page.kind === 'pdf'
      ? `Nguồn: trang ${page.sourcePage + 1}/${page.source?.pageCount || page.sourceTotalPages || '?'} · ${page.source?.name || ''}`
      : (page.file?.name || page.name || 'Ảnh scan mới');
    els.viewerPrev.disabled = index <= 0;
    els.viewerNext.disabled = index >= list.length - 1;

    if (page.kind !== 'pdf') {
      els.viewerCanvas.hidden = true;
      els.viewerImage.hidden = false;
      els.viewerImage.src = page.url;
      stage.classList.remove('is-busy', 'is-empty');
      setViewerStatus('');
      return;
    }

    els.viewerImage.hidden = true;
    els.viewerImage.removeAttribute('src');
    els.viewerCanvas.hidden = false;
    clearViewerCanvas();
    stage.classList.add('is-busy');
    stage.classList.remove('is-empty');
    setViewerStatus('Đang dựng bản xem trước…');
    const isCurrent = () => state.active && generation === state.viewer.generation && state.viewer.pageId === page.id;
    try {
      const result = await PartyPdf.renderThumbnail(page.source.page(page.sourcePage), els.viewerCanvas, viewerMaxEdge(), isCurrent, page.rotation);
      if (result?.stale || generation !== state.viewer.generation) return;
      stage.classList.remove('is-busy');
      setViewerStatus(result.isBlank
        ? 'Trang này dựng ra ảnh trắng. Trang gốc vẫn được giữ nguyên khi xuất PDF.'
        : '');
    } catch (error) {
      if (generation !== state.viewer.generation) return;
      stage.classList.remove('is-busy');
      stage.classList.add('is-empty');
      setViewerStatus(`${error?.message || 'Không dựng được bản xem trước cho trang này.'} Trang gốc vẫn được giữ nguyên khi xuất PDF.`, true);
    }
  }

  function openPageViewer(pageId) {
    if (!pageById(pageId) || typeof els.viewerDialog?.showModal !== 'function') return;
    state.viewer.pageId = pageId;
    if (!els.viewerDialog.open) els.viewerDialog.showModal();
    renderPageViewer();
  }

  function closePageViewer() {
    state.viewer.pageId = null;
    state.viewer.generation += 1;
    if (els.viewerDialog?.open) els.viewerDialog.close();
  }

  function stepPageViewer(delta) {
    const found = pageById(state.viewer.pageId);
    if (!found) return;
    const list = found.doc ? found.doc.pages : state.sources;
    const target = list[list.indexOf(found.page) + delta];
    if (!target) return;
    state.selected = { documentId: found.doc?.id || null, pageId: target.id };
    state.viewer.pageId = target.id;
    render();
    renderPageViewer();
  }

  function setAction(action, documentId, pageId) {
    state.pendingAction = { action, documentId, pageId };
    els.fileInput.value = '';
    els.fileInput.click();
  }

  function togglePageSelection(pageId) {
    if (!isPageAvailable(pageId)) return;
    if (state.selectedPages.has(pageId)) {
      state.selectedPages.delete(pageId);
    } else {
      state.selectedPages.add(pageId);
    }
    render();
  }

  function clearPageSelection() {
    state.selectedPages.clear();
    render();
  }

  function selectAllAvailablePages() {
    state.sources.forEach(p => {
      if (isPageAvailable(p.id)) state.selectedPages.add(p.id);
    });
    render();
  }

  function selectPageRange(rangeStr) {
    if (!rangeStr || !state.sources.length) return;
    const parts = String(rangeStr).split(/[,;\s]+/).filter(Boolean);
    let added = 0;
    for (const part of parts) {
      const m = part.match(/^(\d+)(?:-(\d+))?$/);
      if (!m) continue;
      const start = parseInt(m[1], 10);
      const end = m[2] ? parseInt(m[2], 10) : start;
      const min = Math.min(start, end);
      const max = Math.max(start, end);
      for (let i = min; i <= max; i++) {
        const page = state.sources[i - 1];
        if (page && isPageAvailable(page.id)) {
          if (!state.selectedPages.has(page.id)) {
            state.selectedPages.add(page.id);
            added++;
          }
        }
      }
    }
    render();
    if (added) toast(`Đã chọn thêm ${added} trang.`);
    else toast('Không tìm thấy trang nguồn khả dụng trong khoảng đã nhập.');
  }

  function createDocumentFromSelection() {
    if (!state.selectedPages.size) return toast('Chưa chọn trang nào để tạo tài liệu.');
    const pagesToAssign = state.sources.filter(p => state.selectedPages.has(p.id) && isPageAvailable(p.id));
    if (!pagesToAssign.length) {
      state.selectedPages.clear();
      render();
      return toast('Các trang đã chọn đã thuộc tài liệu khác.');
    }
    const newDoc = {
      id: uid('doc'),
      pages: pagesToAssign,
      typeId: null
    };
    state.documents.push(newDoc);
    state.selectedPages.clear();
    state.selected = { documentId: newDoc.id, pageId: pagesToAssign[0]?.id || null };
    state.orderConfirmed = false;
    render();
    toast(`Đã tạo Tài liệu ${state.documents.length} gồm ${pagesToAssign.length} trang.`);
  }

  function renderSelectionBar() {
    if (!els.selectionBar) return;
    const count = state.selectedPages.size;
    const total = state.sources.length;
    els.selectionBar.classList.toggle('hidden', total === 0);
    if (els.selectionCount) {
      els.selectionCount.textContent = `Đã chọn ${count} trang`;
    }
    if (els.createDocBtn) {
      els.createDocBtn.disabled = count === 0 || state.busy;
    }
    if (els.clearSelectionBtn) {
      els.clearSelectionBtn.disabled = count === 0 || state.busy;
    }
    if (els.selectAllBtn) {
      const availableCount = state.sources.filter(p => isPageAvailable(p.id)).length;
      els.selectAllBtn.disabled = availableCount === 0 || state.busy;
    }
    if (els.rangeBtn) {
      els.rangeBtn.disabled = total === 0 || state.busy;
    }
  }

  function renderSourcePageCard(page, index) {
    const isChecked = state.selectedPages.has(page.id);
    const doc = findDocumentByPageId(page.id);
    const isAssigned = !!doc;
    const assignedDocIndex = isAssigned ? state.documents.indexOf(doc) : -1;
    const isSelected = state.selected?.pageId === page.id;
    const sourceInfo = page.kind === 'pdf'
      ? `Nguồn: trang ${page.sourcePage + 1}/${page.source?.pageCount || page.sourceTotalPages || '?'}`
      : 'Ảnh scan mới';
    const fileName = page.file?.name || page.source?.name || page.name;

    return `<div class="party-page ${isSelected ? 'is-selected' : ''} ${isChecked ? 'is-checked' : ''} ${isAssigned ? 'is-assigned' : ''}" data-page-id="${page.id}">
      <label class="party-page-check touch-target" title="${isAssigned ? `Đã thuộc Tài liệu ${assignedDocIndex + 1}` : (isChecked ? 'Bỏ chọn trang này' : 'Chọn trang này')}">
        <input type="checkbox" class="party-page-checkbox" data-page-select="${page.id}" ${isChecked ? 'checked' : ''} ${isAssigned ? 'disabled' : ''} aria-label="Chọn trang ${index + 1}">
        <span class="party-page-check-label">Trang ${index + 1}</span>
        ${isAssigned ? `<span class="party-assigned-badge" title="Trang đã thuộc Tài liệu ${assignedDocIndex + 1}">Tài liệu ${assignedDocIndex + 1}</span>` : ''}
      </label>
      <button class="party-page-thumb" data-page-id="${page.id}" type="button" title="Xem trước trang ${index + 1}">
        ${pagePreview(page, index)}
        <span>${index + 1}</span>
      </button>
      <div class="party-page-meta">
        <strong>Trang ${index + 1}</strong>
        <small class="party-page-source">${esc(sourceInfo)}</small>
        <small class="party-page-filename" title="${esc(fileName)}">${esc(fileName)}</small>
      </div>
    </div>`;
  }

  function renderDocumentPageCard(page, index, doc) {
    const isSelected = state.selected?.pageId === page.id;
    const sourceInfo = page.kind === 'pdf'
      ? `Nguồn: trang ${page.sourcePage + 1}/${page.source?.pageCount || page.sourceTotalPages || '?'}`
      : 'Ảnh scan mới';
    const fileName = page.file?.name || page.source?.name || page.name;

    return `<div class="party-page ${isSelected ? 'is-selected' : ''}" data-page-id="${page.id}" draggable="true">
      <button class="party-page-thumb" data-page-id="${page.id}" type="button" title="Xem trước trang ${index + 1}">
        ${pagePreview(page, index)}
        <span>${index + 1}</span>
      </button>
      <div class="party-page-meta">
        <strong>Trang ${index + 1}</strong>
        <small class="party-page-source">${esc(sourceInfo)}</small>
        <small class="party-page-filename" title="${esc(fileName)}">${esc(fileName)}</small>
      </div>
      <div class="party-page-actions">
        <button title="Đưa trang về trước" aria-label="Đưa trang về trước" data-page-action="up" data-page-id="${page.id}" type="button">← Trước</button>
        <button title="Đưa trang về sau" aria-label="Đưa trang về sau" data-page-action="down" data-page-id="${page.id}" type="button">Sau →</button>
        <button title="Xoay trang" aria-label="Xoay trang" data-page-action="rotate" data-page-id="${page.id}" type="button">↻ Xoay</button>
        <button class="party-page-action-optional" title="Thay trang" aria-label="Thay trang" data-page-action="replace" data-page-id="${page.id}" type="button">↺ Thay trang</button>
        <button class="party-page-action-optional" title="Thêm trang sau" aria-label="Thêm trang sau" data-page-action="insert" data-page-id="${page.id}" type="button">+ Thêm sau</button>
        <button class="party-page-action-optional" title="Xóa khỏi tài liệu" aria-label="Xóa trang khỏi tài liệu" data-page-action="remove" data-page-id="${page.id}" type="button">Xóa</button>
        <details class="party-page-more">
          <summary aria-label="Thêm thao tác cho trang này">••• Thêm</summary>
          <div>
            <button title="Thay trang" aria-label="Thay trang" data-page-action="replace" data-page-id="${page.id}" type="button">↺ Thay trang</button>
            <button title="Thêm trang sau" aria-label="Thêm trang sau" data-page-action="insert" data-page-id="${page.id}" type="button">+ Thêm sau</button>
            <button title="Xóa khỏi tài liệu" aria-label="Xóa trang khỏi tài liệu" data-page-action="remove" data-page-id="${page.id}" type="button">Xóa khỏi tài liệu</button>
          </div>
        </details>
      </div>
    </div>`;
  }

  function renderDocument(doc, docIndex) {
    const docs = state.documents;
    const type = taxonomy().find(item => item.id === doc.typeId);
    const canExportThisDoc = doc.pages.length > 0 && !!doc.typeId && !state.busy;

    const pageItemsHtml = doc.pages.map((page, index) => renderDocumentPageCard(page, index, doc)).join('');

    return `<article class="party-document ${state.selected?.documentId === doc.id ? 'is-selected' : ''}" data-document-id="${doc.id}">
      <header class="party-document-head">
        <div>
          <span class="party-doc-number">TÀI LIỆU ${docIndex + 1}</span>
          <h3>${esc(type?.name_vi || 'Chưa chọn loại tài liệu')}</h3>
          <p>${doc.pages.length} trang · ${type ? esc(type.filename_base) + '.pdf' : 'Chọn loại để sinh tên file'}</p>
        </div>
        <div class="party-head-actions">
          <button class="btn primary small party-export-doc-btn" data-doc-export="${doc.id}" type="button" ${canExportThisDoc ? '' : 'disabled'}>Xuất tài liệu này</button>
          <button class="btn ghost small party-remove-document" data-document-id="${doc.id}" type="button">Xóa tài liệu</button>
        </div>
      </header>
      <div class="party-page-rail" data-document-id="${doc.id}">${pageItemsHtml}</div>
      <div class="party-document-actions">
        <button class="btn secondary small" data-doc-action="add" data-document-id="${doc.id}" type="button">+ Thêm trang</button>
        <button class="btn secondary small" data-doc-action="merge-prev" data-document-id="${doc.id}" type="button">Ghép với trước</button>
        <button class="btn secondary small" data-doc-action="merge-next" data-document-id="${doc.id}" type="button">Ghép với sau</button>
        <select class="party-move-select" aria-label="Chuyển trang sang tài liệu khác" data-document-id="${doc.id}">
          <option value="">Chuyển trang…</option>
          ${docs.filter(other => other.id !== doc.id).map(other => `<option value="${other.id}">→ Tài liệu ${docs.indexOf(other) + 1}</option>`).join('')}
        </select>
      </div>
      <div class="party-taxonomy-field">
        <label for="party-type-${doc.id}">Loại tài liệu do cán bộ chọn</label>
        <input id="party-type-${doc.id}" list="party-types-${doc.id}" value="${type ? `${type.id} — ${esc(type.name_vi)}` : ''}" placeholder="Tìm theo mã, tên hoặc không dấu…" data-type-input="${doc.id}" autocomplete="off">
        <div class="party-type-results" data-type-results="${doc.id}"></div>
        <datalist id="party-types-${doc.id}">${taxonomy().map(item => `<option value="${item.id} — ${esc(item.name_vi)}"></option>`).join('')}</datalist>
        <small>${type ? `Tên chuẩn: ${esc(type.filename_base)}.pdf` : 'Chưa gán taxonomy — chưa thể xuất'}</small>
      </div>
    </article>`;
  }

  function render() {
    if (!state.active) return;
    if (state.viewer.pageId && !pageById(state.viewer.pageId)) closePageViewer();
    const docs = state.documents;
    const railScroll = new Map();
    els.documents.querySelectorAll('.party-page-rail[data-document-id]').forEach(rail => {
      if (rail.scrollLeft) railScroll.set(rail.dataset.documentId, rail.scrollLeft);
    });
    const sourceRail = $('partySourceRail');
    const sourceRailScroll = sourceRail ? sourceRail.scrollLeft : 0;

    els.empty.classList.toggle('hidden', state.sources.length > 0);
    els.workspace.classList.toggle('hidden', state.sources.length === 0);

    renderSelectionBar();

    const unassignedCount = state.sources.filter(p => isPageAvailable(p.id)).length;
    const sourcePoolHtml = state.sources.length ? `
      <section class="party-source-pool" aria-label="Danh sách trang nguồn">
        <div class="party-pool-head">
          <div>
            <span class="party-kicker">DANH SÁCH TRANG NGUỒN</span>
            <h3>Trang nguồn (${state.sources.length} trang${unassignedCount < state.sources.length ? ` · ${unassignedCount} chưa xếp` : ''})</h3>
            <p class="muted">Tích chọn các trang để tạo tài liệu mới. Trang đã gán có nhãn và không thể chọn lại.</p>
          </div>
        </div>
        <div class="party-page-rail" id="partySourceRail">${state.sources.map((page, idx) => renderSourcePageCard(page, idx)).join('')}</div>
      </section>` : '';

    const docsHtml = docs.length
      ? docs.map((doc, docIndex) => renderDocument(doc, docIndex)).join('')
      : '<div class="party-empty-doc">Chưa có tài liệu nào. Hãy tích chọn các trang nguồn ở trên và bấm "Tạo tài liệu từ trang đã chọn".</div>';

    const createdDocsHtml = `
      <section class="party-created-docs" aria-label="Danh sách tài liệu đã tạo">
        <div class="party-docs-head">
          <div>
            <span class="party-kicker">TÀI LIỆU ĐÃ TẠO</span>
            <h3>Tài liệu (${docs.length})</h3>
          </div>
        </div>
        ${docsHtml}
      </section>`;

    els.documents.innerHTML = sourcePoolHtml + createdDocsHtml;

    if (sourceRailScroll && $('partySourceRail')) {
      $('partySourceRail').scrollLeft = sourceRailScroll;
    }
    if (railScroll.size) {
      els.documents.querySelectorAll('.party-page-rail[data-document-id]').forEach(rail => {
        const left = railScroll.get(rail.dataset.documentId);
        if (left) rail.scrollLeft = left;
      });
    }
    renderCoverage();
    renderOrderPanel();
    queuePdfPreviews();
  }

  function retryPreview(pageId) {
    const found = pageById(pageId);
    if (!found || found.page.kind !== 'pdf') return;
    found.page.previewState = 'pending';
    found.page.previewError = null;
    found.page.previewThumbCanvas = null;
    state.cachedThumbPages = state.cachedThumbPages.filter(p => p !== found.page);
    render();
    const canvas = els.documents.querySelector(`[data-pdf-preview="${pageId}"]`);
    if (canvas) queuePdfPreview(canvas);
  }

  function renderCoverage() {
    const total = state.sources.length;
    const assigned = state.sources.filter(p => !isPageAvailable(p.id)).length;
    const percent = total ? Math.round(assigned / total * 100) : 0;
    els.coverageText.textContent = `${assigned}/${total} trang nguồn đã được xếp vào tài liệu`;
    els.coverageBar.style.width = `${percent}%`;
    const missing = total - assigned;
    els.coverageWarning.textContent = missing ? `Còn ${missing} trang chưa xử lý` : 'Đã phân đủ mọi trang nguồn.';
    els.coverageWarning.classList.toggle('hidden', total === 0);
    els.coverageWarning.classList.toggle('is-ok', !!total && !missing);
  }

  function sameTypeGroups() {
    const map = new Map();
    state.documents.filter(doc => doc.typeId).forEach(doc => { if (!map.has(doc.typeId)) map.set(doc.typeId, []); map.get(doc.typeId).push(doc); });
    return [...map.entries()].filter(([, docs]) => docs.length > 1);
  }

  function renderOrderPanel() {
    const groups = sameTypeGroups();
    if (!groups.length) {
      state.orderConfirmed = false;
      els.orderPanel.innerHTML = '<p class="party-order-empty">Mỗi loại hiện chỉ có một tài liệu. Thứ tự sẽ lấy theo danh sách tài liệu.</p>';
    } else {
      els.orderPanel.innerHTML = groups.map(([typeId, docs]) => `<div class="party-order-group"><strong>${typeId} · ${esc(taxonomy().find(item => item.id === typeId)?.name_vi)}</strong><p>Kéo hoặc dùng nút để xác nhận thứ tự .1/.2/.3</p><ol>${docs.map((doc, index) => `<li><span>Tài liệu ${state.documents.indexOf(doc) + 1}</span><button aria-label="Đưa tài liệu lên" data-order="up" data-doc-id="${doc.id}" type="button">↑</button><button aria-label="Đưa tài liệu xuống" data-order="down" data-doc-id="${doc.id}" type="button">↓</button><small>${index + 1}</small></li>`).join('')}</ol></div>`).join('') + `<button id="partyConfirmOrderBtn" class="btn secondary full" type="button">${state.orderConfirmed ? 'Đã xác nhận thứ tự' : 'Xác nhận thứ tự tài liệu'}</button>`;
    }
    updateExportState();
  }

  function updateExportState() {
    const ready = state.documents.length > 0 &&
      state.documents.every(doc => doc.pages.length > 0 && doc.typeId) &&
      (!sameTypeGroups().length || state.orderConfirmed);
    els.exportAll.disabled = !ready || state.busy;
    if (!state.documents.length) {
      els.exportStatus.textContent = 'Chưa có tài liệu nào để xuất.';
    } else if (ready) {
      els.exportStatus.textContent = 'Sẵn sàng xuất PDF theo tên canonical.';
    } else {
      els.exportStatus.textContent = 'Cần chọn loại tài liệu cho mọi tài liệu đã tạo.';
    }
  }

  function showTypeResults(input) {
    const results = input.parentElement.querySelector(`[data-type-results="${input.dataset.typeInput}"]`);
    if (!results) return;
    const query = normalize(input.value);
    const matches = query.length < 1 ? [] : taxonomy().filter(item => normalize(`${item.id} ${item.name_vi} ${item.filename_base}`).includes(query)).slice(0, 8);
    results.innerHTML = matches.map(item => `<button type="button" data-type-result data-document-id="${input.dataset.typeInput}" data-type-id="${item.id}" data-type-name="${esc(item.name_vi)}"><strong>${item.id}</strong><span>${esc(item.name_vi)}</span></button>`).join('');
    results.classList.toggle('is-visible', matches.length > 0);
    results.querySelectorAll('[data-type-result]').forEach(button => button.addEventListener('click', () => {
      input.value = `${button.dataset.typeId} — ${button.dataset.typeName}`;
      assignType(input.dataset.typeInput, input.value);
    }));
  }
  function assignType(documentId, value) {
    const id = String(value).match(/^\d{1,3}/)?.[0].padStart(2, '0');
    const doc = state.documents.find(item => item.id === documentId);
    const type = taxonomy().find(item => item.id === id);
    if (!doc) return;
    doc.typeId = type?.id || null; state.orderConfirmed = false; render();
  }

  function removeDocument(documentId) {
    const index = state.documents.findIndex(doc => doc.id === documentId);
    if (index < 0) return;
    state.documents.splice(index, 1);
    state.orderConfirmed = false;
    render();
    toast(`Đã xóa tài liệu. Các trang đã được trả về danh sách trang nguồn.`);
  }

  function handleDocumentAction(action, documentId) {
    const doc = state.documents.find(item => item.id === documentId);
    if (!doc) return;
    if (action === 'add') { state.pendingAction = { action: 'append', documentId }; els.fileInput.click(); return; }
    const index = state.documents.indexOf(doc);
    if (action === 'merge-prev' && index > 0) {
      state.documents[index - 1].pages.push(...doc.pages);
      state.documents.splice(index, 1);
      state.orderConfirmed = false;
      render();
    }
    if (action === 'merge-next' && index < state.documents.length - 1) {
      state.documents[index].pages.push(...state.documents[index + 1].pages);
      state.documents.splice(index + 1, 1);
      state.orderConfirmed = false;
      render();
    }
  }

  function handlePageAction(action, pageId) {
    const found = pageById(pageId);
    if (!found) return;
    if (found.doc) {
      state.selected = { documentId: found.doc.id, pageId };
    }
    if (action === 'up' || action === 'down') {
      if (!found.doc) return;
      const index = found.doc.pages.indexOf(found.page);
      const target = action === 'up' ? index - 1 : index + 1;
      if (target >= 0 && target < found.doc.pages.length) {
        [found.doc.pages[index], found.doc.pages[target]] = [found.doc.pages[target], found.doc.pages[index]];
      }
      render();
    }
    if (action === 'rotate') {
      found.page.rotation = (found.page.rotation + 90) % 360;
      if (found.page.kind === 'pdf') {
        [found.page.previewWidth, found.page.previewHeight] = [found.page.previewHeight, found.page.previewWidth];
        found.page.previewState = 'pending';
        found.page.previewThumbCanvas = null;
      }
      render();
    }
    if (action === 'remove') {
      if (!found.doc) return;
      const index = found.doc.pages.indexOf(found.page);
      if (index >= 0) {
        found.doc.pages.splice(index, 1);
        if (found.doc.pages.length === 0) {
          state.documents.splice(state.documents.indexOf(found.doc), 1);
        }
        render();
        toast('Đã gỡ trang khỏi tài liệu.');
      }
    }
    if (action === 'replace' || action === 'insert') {
      if (found.doc) setAction(action, found.doc.id, pageId);
    }
  }

  function movePage(pageId, documentId) {
    const found = pageById(pageId), target = state.documents.find(doc => doc.id === documentId);
    if (!found || !found.doc || !target || found.doc === target) return;
    found.doc.pages.splice(found.doc.pages.indexOf(found.page), 1);
    if (found.doc.pages.length === 0) {
      state.documents.splice(state.documents.indexOf(found.doc), 1);
    }
    target.pages.push(found.page);
    state.selected = { documentId: target.id, pageId };
    state.orderConfirmed = false;
    render();
  }
  function reorderPage(fromId, toId) { const from = pageById(fromId), to = pageById(toId); if (!from || !to || !from.doc || !to.doc || from.doc !== to.doc || fromId === toId) return; const list = from.doc.pages, a = list.indexOf(from.page), b = list.indexOf(to.page); list.splice(a, 1); list.splice(b, 0, from.page); state.selected = { documentId: from.doc.id, pageId: fromId }; render(); }
  function reorderDocuments(documentId, direction) { const index = state.documents.findIndex(doc => doc.id === documentId), target = direction === 'up' ? index - 1 : index + 1; if (index < 0 || target < 0 || target >= state.documents.length) return; [state.documents[index], state.documents[target]] = [state.documents[target], state.documents[index]]; state.orderConfirmed = false; render(); }

  function addImages(files, target) {
    const pages = Array.from(files || []).filter(isImage).map(createImagePage);
    if (!pages.length) return toast('Hãy chọn ảnh JPG, PNG hoặc WEBP.');
    state.sources.push(...pages);
    if (target) {
      const doc = state.documents.find(item => item.id === target);
      if (doc) doc.pages.push(...pages);
    }
    state.selected = { documentId: target || null, pageId: pages[0].id };
    render();
    toast(`Đã thêm ${pages.length} ảnh.`);
  }

  async function addPdf(file, target) {
    if (!isPdf(file)) return toast('Hãy chọn một file PDF.');
    try {
      const source = PartyPdf.sourceFromBuffer(await file.arrayBuffer(), file.name || 'PDF');
      const pages = createPdfPages(file, source);
      state.sources.push(...pages);
      if (target) {
        const doc = state.documents.find(item => item.id === target);
        if (doc) doc.pages.push(...pages);
      }
      state.selected = { documentId: target || null, pageId: pages[0].id };
      render();
      toast(`Đã nhập ${source.pageCount} trang PDF. Tích chọn các trang để tạo tài liệu.`);
    } catch (error) { toast(`Không nhập được PDF: ${error.message || error}`); }
  }

  async function handleFileSelection(files) {
    const action = state.pendingAction; state.pendingAction = null;
    const selectedFiles = Array.from(files || []);
    if (action?.action === 'replace' || action?.action === 'insert' || action?.action === 'append') {
      const found = action.pageId ? pageById(action.pageId) : null;
      const file = selectedFiles[0];
      if (!file) return;
      if (isPdf(file)) {
        try {
          const source = PartyPdf.sourceFromBuffer(await file.arrayBuffer(), file.name || 'PDF');
          const pages = createPdfPages(file, source);
          const list = state.documents.find(doc => doc.id === action.documentId)?.pages;
          if (!list) return;
          state.sources.push(...pages);
          const index = found && found.doc ? list.findIndex(item => item.id === found.page.id) : list.length;
          if (action.action === 'replace') list.splice(index, 1, ...pages);
          else list.splice(action.action === 'insert' ? index + 1 : index, 0, ...pages);
          state.selected = { documentId: action.documentId, pageId: pages[0].id };
          render();
          toast(`Đã thêm ${pages.length} trang PDF vào tài liệu.`);
        } catch (error) { toast(`Không nhập được PDF: ${error.message || error}`); }
        return;
      }
      if (!isImage(file)) return toast('Hãy chọn ảnh hoặc PDF.');
      const page = createImagePage(file); state.sources.push(page);
      const list = state.documents.find(doc => doc.id === action.documentId)?.pages; if (!list) return;
      const index = found && found.doc ? list.findIndex(item => item.id === found.page.id) : list.length;
      if (action.action === 'replace') { const old = list[index]; if (old?.kind === 'image') URL.revokeObjectURL(old.url); list[index] = page; }
      else list.splice(action.action === 'insert' ? index + 1 : index, 0, page);
      state.selected = { documentId: action.documentId, pageId: page.id }; render(); return;
    }
    const images = selectedFiles.filter(isImage);
    if (images.length) addImages(images, null);
    for (const file of selectedFiles.filter(isPdf)) await addPdf(file, null);
    if (!images.length && !selectedFiles.some(isPdf)) toast('Hãy chọn ảnh JPG, PNG, WEBP hoặc PDF.');
  }

  async function exportDocument(doc, sequence, totalForType) {
    const type = taxonomy().find(item => item.id === doc.typeId); if (!type) throw new Error('Tài liệu chưa chọn loại.');
    const name = `${type.filename_base}${totalForType > 1 ? `.${sequence}` : ''}.pdf`;
    const mixedItems = [];
    for (const page of doc.pages) {
      if (page.kind === 'pdf') {
        mixedItems.push({ kind: 'pdf', ref: page.source.page(page.sourcePage), rotation: page.rotation });
        continue;
      }
      const core = window.VigilLensCore; if (!core?.renderPageCanvas || !core?.buildPdf) throw new Error('Pipeline ảnh Vigil Lens chưa sẵn sàng.');
      const canvas = await core.renderPageCanvas(page, 2200); const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Không tạo được trang ảnh.')), 'image/jpeg', .9));
      mixedItems.push({ kind: 'image', item: { bytes: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height, pageMode: 'a4', margin: false } });
    }
    return { name, blob: PartyPdf.buildMixedPdf(mixedItems) };
  }

  async function exportSingleDocument(documentId) {
    const doc = state.documents.find(item => item.id === documentId);
    if (!doc || !doc.pages.length || !doc.typeId || state.busy) return;
    state.busy = true;
    updateExportState();
    render();
    try {
      const sameTypes = state.documents.filter(item => item.typeId === doc.typeId);
      const total = sameTypes.length;
      const sequence = total > 1 ? sameTypes.indexOf(doc) + 1 : 1;
      const unassigned = state.sources.filter(p => isPageAvailable(p.id)).length;
      if (unassigned > 0) {
        toast(`Đang xuất ${doc.pages.length}/${state.sources.length} trang nguồn. ${unassigned} trang còn lại chưa xử lý và vẫn được giữ nguyên trong phiên.`);
      }
      const result = await exportDocument(doc, sequence, total);
      const url = URL.createObjectURL(result.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = result.name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast(`Đã xuất tài liệu: ${result.name}`);
    } catch (error) {
      toast(`Không xuất được: ${error.message || error}`);
    } finally {
      state.busy = false;
      updateExportState();
      render();
    }
  }

  async function exportAll() {
    if (els.exportAll.disabled || state.busy) return; state.busy = true; updateExportState();
    try {
      const unassigned = state.sources.filter(p => isPageAvailable(p.id)).length;
      if (unassigned > 0) {
        toast(`Đang xuất ${state.sources.length - unassigned}/${state.sources.length} trang nguồn. ${unassigned} trang chưa xử lý được giữ nguyên.`);
      }
      const groups = sameTypeGroups(); const counts = new Map(groups.map(([id, docs]) => [id, docs.length]));
      for (let i = 0; i < state.documents.length; i++) {
        els.exportStatus.textContent = `Đang dựng tài liệu ${i + 1}/${state.documents.length}…`;
        const doc = state.documents[i];
        const total = counts.get(doc.typeId) || 1;
        const sequence = total > 1 ? state.documents.filter(item => item.typeId === doc.typeId).indexOf(doc) + 1 : 1;
        const result = await exportDocument(doc, sequence, total);
        const url = URL.createObjectURL(result.blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = result.name;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }
      toast(`Đã xuất ${state.documents.length} tài liệu.`);
    } catch (error) {
      els.exportStatus.textContent = `Không xuất được: ${error.message || error}`;
      toast('Không xuất được PDF.');
    } finally {
      state.busy = false;
      updateExportState();
    }
  }

  function activate() { state.active = true; els.empty.classList.remove('hidden'); render(); }
  function deactivate() {
    state.active = false; state.previewGeneration += 1; disconnectPdfPreviewObserver();
    closePageViewer();
    state.selectedPages.clear();
    state.cachedThumbPages = [];
    const releasedSources = new Set();
    [...state.sources, ...state.documents.flatMap(doc => doc.pages)].forEach(page => {
      if (page.kind === 'image' && page.url) URL.revokeObjectURL(page.url);
      if (page.kind === 'pdf') {
        page.previewThumbCanvas = null;
        if (!releasedSources.has(page.source)) {
          releasedSources.add(page.source);
          PartyPdf.releasePreviewCache?.(page.source);
        }
      }
    });
    state.sources = []; state.documents = []; state.selected = null; state.orderConfirmed = false; state.pendingAction = null;
    els.documents.innerHTML = '';
    els.empty.classList.add('hidden'); els.workspace.classList.add('hidden');
    if (els.selectionBar) els.selectionBar.classList.add('hidden');
  }
  function hasWork() { return state.sources.length > 0; }

  els.documents.addEventListener('click', event => {
    const thumbBtn = event.target.closest('.party-page-thumb');
    if (thumbBtn) {
      const found = pageById(thumbBtn.dataset.pageId);
      if (found) {
        state.selected = { documentId: found.doc?.id || null, pageId: found.page.id };
        render();
        openPageViewer(found.page.id);
      }
      return;
    }
    const retryBtn = event.target.closest('[data-page-retry]');
    if (retryBtn) {
      retryPreview(retryBtn.dataset.pageRetry);
      return;
    }
    const pageActionBtn = event.target.closest('[data-page-action]');
    if (pageActionBtn) {
      handlePageAction(pageActionBtn.dataset.pageAction, pageActionBtn.dataset.pageId);
      return;
    }
    const docActionBtn = event.target.closest('[data-doc-action]');
    if (docActionBtn) {
      handleDocumentAction(docActionBtn.dataset.docAction, docActionBtn.dataset.documentId);
      return;
    }
    const exportDocBtn = event.target.closest('[data-doc-export]');
    if (exportDocBtn) {
      exportSingleDocument(exportDocBtn.dataset.docExport);
      return;
    }
    const removeDocBtn = event.target.closest('.party-remove-document');
    if (removeDocBtn) {
      removeDocument(removeDocBtn.dataset.documentId);
      return;
    }
    const typeResultBtn = event.target.closest('[data-type-result]');
    if (typeResultBtn) {
      const input = els.documents.querySelector(`[data-type-input="${typeResultBtn.dataset.documentId}"]`);
      if (input) {
        input.value = `${typeResultBtn.dataset.typeId} — ${typeResultBtn.dataset.typeName}`;
        assignType(typeResultBtn.dataset.documentId, input.value);
      }
      return;
    }
  });

  els.documents.addEventListener('change', event => {
    const checkInput = event.target.closest('[data-page-select]');
    if (checkInput) {
      togglePageSelection(checkInput.dataset.pageSelect);
      return;
    }
    const moveSelect = event.target.closest('.party-move-select');
    if (moveSelect && moveSelect.value) {
      const docId = moveSelect.dataset.documentId;
      const doc = state.documents.find(d => d.id === docId);
      const pageToMove = (state.selected?.documentId === docId && state.selected?.pageId && doc?.pages.some(p => p.id === state.selected.pageId))
        ? state.selected.pageId
        : doc?.pages[0]?.id;
      if (pageToMove) {
        movePage(pageToMove, moveSelect.value);
        return;
      }
    }
    const typeInput = event.target.closest('[data-type-input]');
    if (typeInput) {
      assignType(typeInput.dataset.typeInput, typeInput.value);
      return;
    }
  });

  els.documents.addEventListener('input', event => {
    const typeInput = event.target.closest('[data-type-input]');
    if (typeInput) {
      showTypeResults(typeInput);
    }
  });

  els.documents.addEventListener('dragstart', event => {
    const card = event.target.closest('.party-page');
    if (card && card.dataset.pageId) {
      event.dataTransfer.setData('text/plain', card.dataset.pageId);
    }
  });
  els.documents.addEventListener('dragover', event => {
    if (event.target.closest('.party-page')) {
      event.preventDefault();
    }
  });
  els.documents.addEventListener('drop', event => {
    const card = event.target.closest('.party-page');
    if (card && card.dataset.pageId) {
      event.preventDefault();
      const fromId = event.dataTransfer.getData('text/plain');
      if (fromId) reorderPage(fromId, card.dataset.pageId);
    }
  });

  els.orderPanel.addEventListener('click', event => {
    const orderBtn = event.target.closest('[data-order]');
    if (orderBtn) {
      reorderDocuments(orderBtn.dataset.docId, orderBtn.dataset.order);
      return;
    }
    if (event.target.id === 'partyConfirmOrderBtn' || event.target.closest('#partyConfirmOrderBtn')) {
      state.orderConfirmed = true;
      renderOrderPanel();
      updateExportState();
    }
  });

  els.createDocBtn?.addEventListener('click', createDocumentFromSelection);
  els.selectAllBtn?.addEventListener('click', selectAllAvailablePages);
  els.clearSelectionBtn?.addEventListener('click', clearPageSelection);
  els.rangeBtn?.addEventListener('click', () => {
    selectPageRange(els.rangeInput?.value);
    if (els.rangeInput) els.rangeInput.value = '';
  });
  els.rangeInput?.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      selectPageRange(els.rangeInput.value);
      els.rangeInput.value = '';
    }
  });

  els.cameraBtn.addEventListener('click', () => els.cameraInput.click());
  els.chooseBtn.addEventListener('click', () => els.fileInput.click());
  els.pdfBtn.addEventListener('click', () => els.pdfInput.click());
  els.addBtn.addEventListener('click', () => els.fileInput.click());
  els.addPdfBtn.addEventListener('click', () => els.pdfInput.click());
  els.fileInput.addEventListener('change', event => { if (state.active) handleFileSelection(event.target.files); event.target.value = ''; });
  els.cameraInput.addEventListener('change', event => { if (state.active) addImages(event.target.files, null); event.target.value = ''; });
  els.pdfInput.addEventListener('change', async event => { if (state.active) await addPdf(event.target.files[0], null); event.target.value = ''; });
  els.exportAll.addEventListener('click', exportAll);
  document.querySelectorAll('[data-party-help]').forEach(button => button.addEventListener('click', openHelp));
  els.helpClose?.addEventListener('click', () => els.helpDialog.close());
  els.helpDialog?.addEventListener('click', event => { if (event.target === els.helpDialog) els.helpDialog.close(); });

  els.viewerClose?.addEventListener('click', closePageViewer);
  els.viewerPrev?.addEventListener('click', () => stepPageViewer(-1));
  els.viewerNext?.addEventListener('click', () => stepPageViewer(1));
  els.viewerRotate?.addEventListener('click', () => {
    const pageId = state.viewer.pageId;
    if (!pageId) return;
    handlePageAction('rotate', pageId);
    state.viewer.pageId = pageId;
    renderPageViewer();
  });
  els.viewerDialog?.addEventListener('click', event => { if (event.target === els.viewerDialog) closePageViewer(); });
  els.viewerDialog?.addEventListener('close', () => { state.viewer.pageId = null; state.viewer.generation += 1; });
  els.viewerDialog?.addEventListener('keydown', event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    stepPageViewer(event.key === 'ArrowLeft' ? -1 : 1);
  });

  window.VigilLensParty = {
    activate, deactivate, hasWork,
    togglePageSelection, clearPageSelection, selectAllAvailablePages, selectPageRange, createDocumentFromSelection
  };
})();

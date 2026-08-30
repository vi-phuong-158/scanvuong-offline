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
    addBtn: $('partyAddBtn'), addPdfBtn: $('partyAddPdfBtn'), newDocumentBtn: $('partyNewDocumentBtn'),
    helpDialog: $('partyHelpDialog'), helpClose: $('partyHelpClose')
  };

  const state = {
    active: false, busy: false, sources: [], documents: [], selected: null,
    orderConfirmed: false, pendingAction: null, nextDocument: 1, markedSplits: new Set(),
    previewObserver: null, previewQueue: new Map(), previewRunning: false, previewGeneration: 0
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
  function pageById(id) { for (const doc of state.documents) { const page = doc.pages.find(item => item.id === id); if (page) return { doc, page }; } return null; }
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
      const parent = canvas.parentElement;
      if (parent) {
        parent.outerHTML = pagePreview(page, found.doc.pages.indexOf(page));
        bindDocumentEvents();
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
    canvases.slice(0, 8).forEach(queuePdfPreview);
    if (typeof IntersectionObserver === 'function') {
      state.previewObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => { if (entry.isIntersecting) queuePdfPreview(entry.target); });
      }, { root: null, rootMargin: '600px', threshold: 0.01 });
      canvases.forEach(canvas => state.previewObserver.observe(canvas));
    }
    els.documents.querySelectorAll('.party-page-rail').forEach(rail => {
      rail.addEventListener('scroll', () => {
        const unrendered = [...rail.querySelectorAll('[data-pdf-preview]:not([data-preview-rendered="true"])')];
        unrendered.forEach(queuePdfPreview);
      }, { passive: true });
    });
  }

  function setAction(action, documentId, pageId) {
    state.pendingAction = { action, documentId, pageId };
    els.fileInput.value = '';
    els.fileInput.click();
  }

  function render() {
    if (!state.active) return;
    const docs = state.documents;
    els.empty.classList.toggle('hidden', state.sources.length > 0);
    els.workspace.classList.toggle('hidden', state.sources.length === 0);
    els.documents.innerHTML = docs.length ? docs.map((doc, docIndex) => renderDocument(doc, docIndex)).join('') : '<div class="party-empty-doc">Chưa có tài liệu. Hãy thêm nguồn hoặc tạo tài liệu mới.</div>';
    bindDocumentEvents();
    renderCoverage();
    renderOrderPanel();
    queuePdfPreviews();
  }

  function renderPageCard(page, index, doc) {
    const isSelected = state.selected?.pageId === page.id;
    const sourceInfo = page.kind === 'pdf'
      ? `Nguồn: trang ${page.sourcePage + 1}/${page.source?.pageCount || page.sourceTotalPages || '?'}`
      : 'Ảnh scan mới';
    const fileName = page.file?.name || page.source?.name || page.name;

    return `<div class="party-page ${isSelected ? 'is-selected' : ''}" data-page-id="${page.id}" draggable="true">
      <button class="party-page-thumb" data-page-id="${page.id}" type="button">
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
    const docMarkedCount = doc.pages.filter(p => state.markedSplits.has(p.id)).length;

    const pageItemsHtml = doc.pages.map((page, index) => {
      const cardHtml = renderPageCard(page, index, doc);
      const isSplitMarked = state.markedSplits.has(page.id);
      const splitDividerHtml = index < doc.pages.length - 1 ? `
        <div class="party-split-divider">
          <button class="party-split-btn ${isSplitMarked ? 'is-marked' : ''}" data-split-toggle="${page.id}" data-document-id="${doc.id}" type="button" aria-pressed="${isSplitMarked}" title="${isSplitMarked ? 'Bỏ điểm tách' : 'Đánh dấu tách tại đây'}">
            <span class="party-split-icon">✂</span>
            <span class="party-split-label">${isSplitMarked ? 'Đã đánh dấu tách' : 'Tách tại đây'}</span>
          </button>
        </div>` : '';
      return cardHtml + splitDividerHtml;
    }).join('');

    const multiSplitActionHtml = docMarkedCount > 0 ? `
      <div class="party-multisplit-bar">
        <button class="btn primary small party-apply-splits" data-doc-action="apply-splits" data-document-id="${doc.id}" type="button">Áp dụng ${docMarkedCount} điểm tách</button>
        <button class="btn ghost small party-clear-splits" data-doc-action="clear-splits" data-document-id="${doc.id}" type="button">Bỏ các điểm tách</button>
      </div>` : '';

    return `<article class="party-document ${state.selected?.documentId === doc.id ? 'is-selected' : ''}" data-document-id="${doc.id}">
      <header class="party-document-head"><div><span class="party-doc-number">TÀI LIỆU ${docIndex + 1}</span><h3>${esc(type?.name_vi || 'Chưa chọn loại tài liệu')}</h3><p>${doc.pages.length} trang · ${type ? esc(type.filename_base) + '.pdf' : 'Chọn loại để sinh tên file'}</p></div>
      <button class="btn ghost small party-remove-document" data-document-id="${doc.id}" type="button">Xóa tài liệu</button></header>
      ${multiSplitActionHtml}
      <div class="party-page-rail" data-document-id="${doc.id}">${pageItemsHtml}</div>
      <div class="party-document-actions">
        <button class="btn secondary small" data-doc-action="split" data-document-id="${doc.id}" type="button">Tách sau trang đang chọn</button>
        <button class="btn secondary small" data-doc-action="merge-prev" data-document-id="${doc.id}" type="button">Ghép với trước</button>
        <button class="btn secondary small" data-doc-action="merge-next" data-document-id="${doc.id}" type="button">Ghép với sau</button>
        <button class="btn secondary small" data-doc-action="add" data-document-id="${doc.id}" type="button">+ Thêm trang</button>
        <select class="party-move-select" aria-label="Chuyển trang sang tài liệu khác" data-document-id="${doc.id}"><option value="">Chuyển trang…</option>${docs.filter(other => other.id !== doc.id).map(other => `<option value="${other.id}">→ Tài liệu ${docs.indexOf(other) + 1}</option>`).join('')}</select>
      </div>
      <div class="party-taxonomy-field"><label for="party-type-${doc.id}">Loại tài liệu do cán bộ chọn</label><input id="party-type-${doc.id}" list="party-types-${doc.id}" value="${type ? `${type.id} — ${esc(type.name_vi)}` : ''}" placeholder="Tìm theo mã, tên hoặc không dấu…" data-type-input="${doc.id}" autocomplete="off"><div class="party-type-results" data-type-results="${doc.id}"></div><datalist id="party-types-${doc.id}">${taxonomy().map(item => `<option value="${item.id} — ${esc(item.name_vi)}"></option>`).join('')}</datalist><small>${type ? `Tên chuẩn: ${esc(type.filename_base)}.pdf` : 'Chưa gán taxonomy — chưa thể xuất'}</small></div>
    </article>`;
  }

  function toggleSplitMark(pageId) {
    if (state.markedSplits.has(pageId)) {
      state.markedSplits.delete(pageId);
    } else {
      state.markedSplits.add(pageId);
    }
    render();
  }

  function applyDocumentSplits(documentId) {
    const doc = state.documents.find(item => item.id === documentId);
    if (!doc) return;
    const markedIndices = [];
    doc.pages.forEach((page, idx) => {
      if (state.markedSplits.has(page.id) && idx < doc.pages.length - 1) {
        markedIndices.push(idx);
      }
    });
    if (!markedIndices.length) return toast('Chưa có điểm tách nào được đánh dấu.');

    const chunks = [];
    let start = 0;
    for (const splitIdx of markedIndices) {
      chunks.push(doc.pages.slice(start, splitIdx + 1));
      start = splitIdx + 1;
    }
    chunks.push(doc.pages.slice(start));

    doc.pages = chunks[0];
    const newDocs = chunks.slice(1).map(chunk => ({
      id: uid('doc'),
      pages: chunk,
      typeId: null
    }));

    const docIndex = state.documents.indexOf(doc);
    state.documents.splice(docIndex + 1, 0, ...newDocs);

    markedIndices.forEach(idx => {
      // Clear split marks for this doc
    });
    state.markedSplits.clear();
    state.orderConfirmed = false;
    render();
    toast(`Đã chia thành ${chunks.length} tài liệu (${markedIndices.length} điểm tách).`);
  }

  function retryPreview(pageId) {
    const found = pageById(pageId);
    if (!found || found.page.kind !== 'pdf') return;
    found.page.previewState = 'pending';
    found.page.previewError = null;
    found.page.previewThumbCanvas = null;
    render();
    const canvas = els.documents.querySelector(`[data-pdf-preview="${pageId}"]`);
    if (canvas) queuePdfPreview(canvas);
  }

  function bindDocumentEvents() {
    els.documents.querySelectorAll('.party-page-thumb').forEach(button => button.addEventListener('click', () => { const found = pageById(button.dataset.pageId); if (found) { state.selected = { documentId: found.doc.id, pageId: found.page.id }; render(); } }));
    els.documents.querySelectorAll('.party-remove-document').forEach(button => button.addEventListener('click', () => removeDocument(button.dataset.documentId)));
    els.documents.querySelectorAll('[data-doc-action]').forEach(button => button.addEventListener('click', () => handleDocumentAction(button.dataset.docAction, button.dataset.documentId)));
    els.documents.querySelectorAll('[data-page-action]').forEach(button => button.addEventListener('click', () => handlePageAction(button.dataset.pageAction, button.dataset.pageId)));
    els.documents.querySelectorAll('[data-split-toggle]').forEach(button => button.addEventListener('click', () => toggleSplitMark(button.dataset.splitToggle)));
    els.documents.querySelectorAll('[data-page-retry]').forEach(button => button.addEventListener('click', () => retryPreview(button.dataset.pageRetry)));
    els.documents.querySelectorAll('.party-move-select').forEach(select => select.addEventListener('change', () => { if (select.value && state.selected?.pageId) movePage(state.selected.pageId, select.value); }));
    els.documents.querySelectorAll('[data-type-input]').forEach(input => {
      input.addEventListener('input', () => showTypeResults(input));
      input.addEventListener('change', () => assignType(input.dataset.typeInput, input.value));
    });
    els.documents.querySelectorAll('[data-type-result]').forEach(button => button.addEventListener('click', () => {
      const input = els.documents.querySelector(`[data-type-input="${button.dataset.documentId}"]`);
      if (input) { input.value = `${button.dataset.typeId} — ${button.dataset.typeName}`; assignType(button.dataset.documentId, input.value); }
    }));
    els.documents.querySelectorAll('.party-page').forEach(card => { card.addEventListener('dragstart', event => { event.dataTransfer.setData('text/plain', card.dataset.pageId); }); card.addEventListener('dragover', event => event.preventDefault()); card.addEventListener('drop', event => { event.preventDefault(); reorderPage(event.dataTransfer.getData('text/plain'), card.dataset.pageId); }); });
  }

  function renderCoverage() {
    const total = state.sources.length;
    const assigned = new Set(state.documents.flatMap(doc => doc.pages.map(sourcePageKey))).size;
    const percent = total ? Math.round(assigned / total * 100) : 0;
    els.coverageText.textContent = `${assigned}/${total} trang nguồn đã được xếp vào tài liệu`;
    els.coverageBar.style.width = `${percent}%`;
    const missing = total - assigned;
    els.coverageWarning.textContent = missing ? `Còn ${missing} trang chưa được đưa vào tài liệu` : 'Đã phân đủ mọi trang nguồn.';
    els.coverageWarning.classList.toggle('hidden', !missing);
    els.coverageWarning.classList.toggle('is-ok', !!total && !missing);
  }

  function sameTypeGroups() {
    const map = new Map();
    state.documents.filter(doc => doc.typeId).forEach(doc => { if (!map.has(doc.typeId)) map.set(doc.typeId, []); map.get(doc.typeId).push(doc); });
    return [...map.entries()].filter(([, docs]) => docs.length > 1);
  }

  function renderOrderPanel() {
    const groups = sameTypeGroups();
    if (!groups.length) { state.orderConfirmed = false; els.orderPanel.innerHTML = '<p class="party-order-empty">Mỗi loại hiện chỉ có một tài liệu. Thứ tự sẽ lấy theo danh sách tài liệu.</p>'; } else {
      els.orderPanel.innerHTML = groups.map(([typeId, docs]) => `<div class="party-order-group"><strong>${typeId} · ${esc(taxonomy().find(item => item.id === typeId)?.name_vi)}</strong><p>Kéo hoặc dùng nút để xác nhận thứ tự .1/.2/.3</p><ol>${docs.map((doc, index) => `<li><span>Tài liệu ${state.documents.indexOf(doc) + 1}</span><button aria-label="Đưa tài liệu lên" data-order="up" data-doc-id="${doc.id}" type="button">↑</button><button aria-label="Đưa tài liệu xuống" data-order="down" data-doc-id="${doc.id}" type="button">↓</button><small>${index + 1}</small></li>`).join('')}</ol></div>`).join('') + `<button id="partyConfirmOrderBtn" class="btn secondary full" type="button">${state.orderConfirmed ? 'Đã xác nhận thứ tự' : 'Xác nhận thứ tự tài liệu'}</button>`;
      els.orderPanel.querySelectorAll('[data-order]').forEach(button => button.addEventListener('click', () => reorderDocuments(button.dataset.docId, button.dataset.order)));
      $('partyConfirmOrderBtn').addEventListener('click', () => { state.orderConfirmed = true; renderOrderPanel(); updateExportState(); });
    }
    updateExportState();
  }

  function updateExportState() {
    const ready = state.documents.length > 0 && state.documents.every(doc => doc.pages.length && doc.typeId) && new Set(state.documents.flatMap(doc => doc.pages.map(sourcePageKey))).size === state.sources.length && (!sameTypeGroups().length || state.orderConfirmed);
    els.exportAll.disabled = !ready || state.busy;
    els.exportStatus.textContent = ready ? 'Sẵn sàng xuất PDF theo tên canonical.' : 'Cần phân đủ trang, chọn loại và xác nhận thứ tự nếu có loại trùng.';
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

  function ensureDocument() { if (!state.documents.length) state.documents.push({ id: uid('doc'), pages: [], typeId: null }); return state.documents[0]; }
  function createDocument() { const doc = { id: uid('doc'), pages: [], typeId: null }; state.documents.push(doc); state.nextDocument += 1; state.selected = { documentId: doc.id, pageId: null }; render(); }

  function removeDocument(documentId) {
    const index = state.documents.findIndex(doc => doc.id === documentId); if (index < 0) return;
    const [doc] = state.documents.splice(index, 1);
    doc.pages.forEach(p => state.markedSplits.delete(p.id));
    const fallback = ensureDocument(); fallback.pages.push(...doc.pages); state.orderConfirmed = false; render();
  }

  function handleDocumentAction(action, documentId) {
    const doc = state.documents.find(item => item.id === documentId); if (!doc) return;
    if (action === 'add') { state.pendingAction = { action: 'append', documentId }; els.fileInput.click(); return; }
    if (action === 'apply-splits') { applyDocumentSplits(documentId); return; }
    if (action === 'clear-splits') { doc.pages.forEach(p => state.markedSplits.delete(p.id)); render(); return; }
    if (action === 'split') {
      const index = doc.pages.findIndex(page => page.id === state.selected?.pageId);
      if (index < 0 || index === doc.pages.length - 1) return toast('Chọn một trang ở giữa tài liệu để tách.');
      const next = { id: uid('doc'), pages: doc.pages.splice(index + 1), typeId: null };
      state.documents.splice(state.documents.indexOf(doc) + 1, 0, next);
      state.markedSplits.delete(doc.pages[index]?.id);
      state.orderConfirmed = false;
      render();
      return;
    }
    const index = state.documents.indexOf(doc);
    if (action === 'merge-prev' && index > 0) { state.documents[index - 1].pages.push(...doc.pages); state.documents.splice(index, 1); state.orderConfirmed = false; render(); }
    if (action === 'merge-next' && index < state.documents.length - 1) { state.documents[index].pages.push(...state.documents[index + 1].pages); state.documents.splice(index + 1, 1); state.orderConfirmed = false; render(); }
  }

  function handlePageAction(action, pageId) {
    const found = pageById(pageId); if (!found) return;
    state.selected = { documentId: found.doc.id, pageId };
    if (action === 'up' || action === 'down') { const index = found.doc.pages.indexOf(found.page), target = action === 'up' ? index - 1 : index + 1; if (target >= 0 && target < found.doc.pages.length) [found.doc.pages[index], found.doc.pages[target]] = [found.doc.pages[target], found.doc.pages[index]]; render(); }
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
      state.markedSplits.delete(pageId);
      found.doc.pages.splice(found.doc.pages.indexOf(found.page), 1);
      render();
    }
    if (action === 'replace' || action === 'insert') { setAction(action, found.doc.id, pageId); }
  }

  function movePage(pageId, documentId) {
    const found = pageById(pageId), target = state.documents.find(doc => doc.id === documentId);
    if (!found || !target || found.doc === target) return;
    state.markedSplits.delete(pageId);
    found.doc.pages.splice(found.doc.pages.indexOf(found.page), 1);
    target.pages.push(found.page);
    state.selected = { documentId: target.id, pageId };
    state.orderConfirmed = false;
    render();
  }
  function reorderPage(fromId, toId) { const from = pageById(fromId), to = pageById(toId); if (!from || !to || from.doc !== to.doc || fromId === toId) return; const list = from.doc.pages, a = list.indexOf(from.page), b = list.indexOf(to.page); list.splice(a, 1); list.splice(b, 0, from.page); state.selected = { documentId: from.doc.id, pageId: fromId }; render(); }
  function reorderDocuments(documentId, direction) { const index = state.documents.findIndex(doc => doc.id === documentId), target = direction === 'up' ? index - 1 : index + 1; if (index < 0 || target < 0 || target >= state.documents.length) return; [state.documents[index], state.documents[target]] = [state.documents[target], state.documents[index]]; state.orderConfirmed = false; render(); }

  function addImages(files, target) {
    const pages = Array.from(files || []).filter(isImage).map(createImagePage);
    if (!pages.length) return toast('Hãy chọn ảnh JPG, PNG hoặc WEBP.');
    state.sources.push(...pages);
    const doc = target ? state.documents.find(item => item.id === target) : ensureDocument();
    doc.pages.push(...pages);
    state.selected = { documentId: doc.id, pageId: pages[0].id };
    render();

  }

  async function addPdf(file, target) {
    if (!isPdf(file)) return toast('Hãy chọn một file PDF.');
    try {
      const source = PartyPdf.sourceFromBuffer(await file.arrayBuffer(), file.name || 'PDF');
      const pages = createPdfPages(file, source); state.sources.push(...pages); const doc = target ? state.documents.find(item => item.id === target) : ensureDocument(); doc.pages.push(...pages); state.selected = { documentId: doc.id, pageId: pages[0].id }; render(); toast(`Đã nhập ${source.pageCount} trang PDF. Thumbnail giữ nguyên trang gốc khi xuất.`);
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
          const index = found ? list.findIndex(item => item.id === found.page.id) : list.length;
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
      const index = found ? list.findIndex(item => item.id === found.page.id) : list.length;
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
    // PartyPdf preserves source PDF page objects in their operator-selected
    // order; scanned images are encoded only for newly added image pages.
    return { name, blob: PartyPdf.buildMixedPdf(mixedItems) };
  }
  async function exportAll() {
    if (els.exportAll.disabled || state.busy) return; state.busy = true; updateExportState();
    try {
      const groups = sameTypeGroups(); const counts = new Map(groups.map(([id, docs]) => [id, docs.length]));
      for (let i = 0; i < state.documents.length; i++) { els.exportStatus.textContent = `Đang dựng tài liệu ${i + 1}/${state.documents.length}…`; const doc = state.documents[i]; const total = counts.get(doc.typeId) || 1; const sequence = total > 1 ? state.documents.filter(item => item.typeId === doc.typeId).indexOf(doc) + 1 : 1; const result = await exportDocument(doc, sequence, total); const url = URL.createObjectURL(result.blob); const link = document.createElement('a'); link.href = url; link.download = result.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 5000); }
      toast(`Đã xuất ${state.documents.length} tài liệu.`);
    } catch (error) { els.exportStatus.textContent = `Không xuất được: ${error.message || error}`; toast('Không xuất được PDF.'); }
    finally { state.busy = false; updateExportState(); }
  }

  function activate() { state.active = true; els.empty.classList.remove('hidden'); render(); }
  function deactivate() {
    state.active = false; state.previewGeneration += 1; disconnectPdfPreviewObserver();
    state.markedSplits.clear();
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
  }
  function hasWork() { return state.sources.length > 0; }

  els.cameraBtn.addEventListener('click', () => els.cameraInput.click());
  els.chooseBtn.addEventListener('click', () => els.fileInput.click());
  els.pdfBtn.addEventListener('click', () => els.pdfInput.click());
  els.addBtn.addEventListener('click', () => els.fileInput.click());
  els.addPdfBtn.addEventListener('click', () => els.pdfInput.click());
  els.newDocumentBtn.addEventListener('click', createDocument);
  els.fileInput.addEventListener('change', event => { if (state.active) handleFileSelection(event.target.files); event.target.value = ''; });
  els.cameraInput.addEventListener('change', event => { if (state.active) addImages(event.target.files, null); event.target.value = ''; });
  els.pdfInput.addEventListener('change', async event => { if (state.active) await addPdf(event.target.files[0], null); event.target.value = ''; });
  els.exportAll.addEventListener('click', exportAll);
  document.querySelectorAll('[data-party-help]').forEach(button => button.addEventListener('click', openHelp));
  els.helpClose?.addEventListener('click', () => els.helpDialog.close());
  els.helpDialog?.addEventListener('click', event => { if (event.target === els.helpDialog) els.helpDialog.close(); });

  window.VigilLensParty = { activate, deactivate, hasWork };
})();

/* VPH Vigil Lens — Lossless Watermark Stripper (offline, in-browser). */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const els = {
    workspace: $('watermarkWorkspace'),
    dropZone: $('watermarkDropZone'),
    fileInput: $('watermarkFileInput'),
    chooseBtn: $('watermarkChooseBtn'),
    result: $('watermarkResult'),
    statusIcon: $('watermarkStatusIcon'),
    statusTitle: $('watermarkStatusTitle'),
    statusDesc: $('watermarkStatusDesc'),
    metaName: $('watermarkMetaName'),
    metaPages: $('watermarkMetaPages'),
    metaRemoved: $('watermarkMetaRemoved'),
    metaSize: $('watermarkMetaSize'),
    downloadBtn: $('watermarkDownloadBtn'),
    resetBtn: $('watermarkResetBtn')
  };

  const state = {
    active: false,
    busy: false,
    cleanBlob: null,
    cleanFilename: '',
    originalName: '',
    originalSize: 0,
    cleanSize: 0,
    totalPages: 0,
    removedCount: 0
  };

  function toast(message) {
    const node = $('toast');
    if (node) {
      node.textContent = message;
      node.classList.remove('hidden');
      setTimeout(() => node.classList.add('hidden'), 3200);
    }
  }

  function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }

  async function processPdfFile(file) {
    if (!file || state.busy) return;
    if (!/application\/pdf/i.test(file.type || '') && !/\.pdf$/i.test(file.name || '')) {
      toast('Hãy chọn tệp định dạng PDF.');
      return;
    }

    state.busy = true;
    state.originalName = file.name || 'document.pdf';
    state.originalSize = file.size;

    if (els.chooseBtn) els.chooseBtn.disabled = true;
    toast('Đang phân tích cấu trúc PDF…');

    try {
      const buffer = await file.arrayBuffer();
      const result = PartyPdf.stripWatermarks(new Uint8Array(buffer), { name: state.originalName });

      state.cleanBlob = result.blob;
      state.cleanSize = result.blob.size;
      state.totalPages = result.totalPages;
      state.removedCount = result.removedCount;

      const baseName = state.originalName.replace(/\.pdf$/i, '');
      state.cleanFilename = result.removedCount > 0 ? `${baseName}_no_wm.pdf` : state.originalName;

      renderResult(result);
    } catch (err) {
      console.error('[WatermarkStripper]', err);
      toast(`Lỗi xử lý tệp: ${err.message || err}`);
    } finally {
      state.busy = false;
      if (els.chooseBtn) els.chooseBtn.disabled = false;
    }
  }

  function renderResult(result) {
    if (!els.result || !els.dropZone) return;
    els.dropZone.classList.add('hidden');
    els.result.classList.remove('hidden');

    if (result.removedCount > 0) {
      els.statusTitle.textContent = `Đã làm sạch thành công vùng chân trang (${result.removedCount} vị trí)`;
      els.statusDesc.textContent = `Xử lý trên ${result.removedPages.length}/${result.totalPages} trang. Dữ liệu ảnh quét gốc được bảo toàn 100% (bit-for-bit lossless).`;
      els.statusIcon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="icon-success"><path d="M20 6 9 17l-5-5"/></svg>`;
      els.metaRemoved.textContent = `${result.removedCount} vị trí đã xử lý`;
      els.metaRemoved.className = 'watermark-meta-value text-success';
    } else {
      els.statusTitle.textContent = 'Vùng chân trang đã sạch';
      els.statusDesc.textContent = 'Tài liệu không có nội dung thừa ở chân trang hoặc đã là tệp sạch. Tệp được giữ nguyên vẹn 100%.';
      els.statusIcon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="icon-info"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
      els.metaRemoved.textContent = '0 (Tệp sạch)';
      els.metaRemoved.className = 'watermark-meta-value';
    }

    els.metaName.textContent = state.originalName;
    els.metaPages.textContent = `${state.totalPages} trang`;
    const diff = state.originalSize - state.cleanSize;
    if (diff > 0) {
      els.metaSize.textContent = `${formatBytes(state.originalSize)} → ${formatBytes(state.cleanSize)} (giảm ${formatBytes(diff)})`;
    } else {
      els.metaSize.textContent = formatBytes(state.originalSize);
    }
  }

  function downloadCleanPdf() {
    if (!state.cleanBlob) return;
    const url = URL.createObjectURL(state.cleanBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = state.cleanFilename || 'document_no_wm.pdf';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast(`Đã tải xuống: ${link.download}`);
  }

  function reset() {
    state.cleanBlob = null;
    state.cleanFilename = '';
    state.originalName = '';
    state.originalSize = 0;
    state.cleanSize = 0;
    state.totalPages = 0;
    state.removedCount = 0;
    if (els.fileInput) els.fileInput.value = '';
    if (els.dropZone) els.dropZone.classList.remove('hidden');
    if (els.result) els.result.classList.add('hidden');
  }

  function activate() {
    state.active = true;
    reset();
    if (els.workspace) els.workspace.classList.remove('hidden');
  }

  function deactivate() {
    state.active = false;
    reset();
    if (els.workspace) els.workspace.classList.add('hidden');
  }

  function hasWork() {
    return !!state.cleanBlob;
  }

  // Events
  if (els.chooseBtn && els.fileInput) {
    els.chooseBtn.addEventListener('click', () => els.fileInput.click());
  }
  if (els.fileInput) {
    els.fileInput.addEventListener('change', e => {
      const file = e.target.files?.[0];
      if (file) processPdfFile(file);
      e.target.value = '';
    });
  }
  if (els.dropZone) {
    ['dragenter', 'dragover'].forEach(ev => {
      els.dropZone.addEventListener(ev, e => {
        e.preventDefault();
        els.dropZone.classList.add('dragging');
      });
    });
    ['dragleave', 'drop'].forEach(ev => {
      els.dropZone.addEventListener(ev, e => {
        e.preventDefault();
        els.dropZone.classList.remove('dragging');
      });
    });
    els.dropZone.addEventListener('drop', e => {
      const file = e.dataTransfer?.files?.[0];
      if (file) processPdfFile(file);
    });
    els.dropZone.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        els.fileInput?.click();
      }
    });
  }
  if (els.downloadBtn) {
    els.downloadBtn.addEventListener('click', downloadCleanPdf);
  }
  if (els.resetBtn) {
    els.resetBtn.addEventListener('click', reset);
  }

  window.VigilLensWatermark = {
    activate,
    deactivate,
    hasWork,
    processPdfFile
  };
})();

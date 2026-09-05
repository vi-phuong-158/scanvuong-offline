/* VPH Vigil Lens — "Giảm dung lượng PDF" mode (offline, in-browser).
   Thin UI layer only — all compression logic lives in pdf-compress.js
   (PdfCompress), shared with Party Mode's own ">20MB" action so the
   algorithm exists in exactly one place. */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const els = {
    workspace: $('compressWorkspace'),
    dropZone: $('compressDropZone'),
    fileInput: $('compressFileInput'),
    chooseBtn: $('compressChooseBtn'),
    info: $('compressInfo'),
    metaName: $('compressMetaName'),
    metaPages: $('compressMetaPages'),
    metaSize: $('compressMetaSize'),
    alreadySmallNotice: $('compressAlreadySmallNotice'),
    startBtn: $('compressStartBtn'),
    changeFileBtn: $('compressChangeFileBtn'),
    progress: $('compressProgress'),
    progressBar: $('compressProgressBar'),
    progressLabel: $('compressProgressLabel'),
    result: $('compressResult'),
    resultSizes: $('compressResultSizes'),
    resultReduction: $('compressResultReduction'),
    resultChecks: $('compressResultChecks'),
    resultNotice: $('compressResultNotice'),
    downloadBtn: $('compressDownloadBtn'),
    strongerBtn: $('compressStrongerBtn'),
    resetBtn: $('compressResetBtn')
  };

  const state = {
    active: false,
    busy: false,
    file: null,
    originalName: '',
    originalSize: 0,
    pageCount: 0,
    result: null,
    downloadUrl: null,
    usedBeyondFloor: false
  };

  function toast(message) {
    const node = $('toast');
    if (node) { node.textContent = message; node.classList.remove('hidden'); setTimeout(() => node.classList.add('hidden'), 3200); }
  }

  function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function sanitizeFilename(name) {
    return name.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').slice(0, 80) || 'VigilLens';
  }

  function isPdfFile(file) {
    return /application\/pdf/i.test(file?.type || '') || /\.pdf$/i.test(file?.name || '');
  }

  function showState(name) {
    els.dropZone.classList.toggle('hidden', name !== 'drop');
    els.info.classList.toggle('hidden', name !== 'info');
    els.result.classList.toggle('hidden', name !== 'result');
    if (name !== 'result') els.progress.classList.add('hidden');
  }

  async function handleFile(file) {
    if (state.busy || !file) return;
    if (!isPdfFile(file)) { toast('Hãy chọn tệp định dạng PDF.'); return; }
    revokeDownloadUrl();
    state.file = file;
    state.originalName = file.name || 'document.pdf';
    state.originalSize = file.size;
    state.result = null;
    state.busy = true;
    toast('Đang đọc PDF…');
    try {
      const info = await PdfCompress.inspectPdf(file);
      state.pageCount = info.pageCount;
      renderInfo();
      showState('info');
    } catch (err) {
      console.error('[PdfCompress]', err);
      toast(`Không đọc được PDF: ${err.message || err}`);
      reset();
    } finally {
      state.busy = false;
    }
  }

  function renderInfo() {
    els.metaName.textContent = state.originalName;
    els.metaPages.textContent = `${state.pageCount} trang`;
    els.metaSize.textContent = formatBytes(state.originalSize);
    const alreadySmall = state.originalSize <= PdfCompress.PDF_COMPRESSION_DISPLAY_LIMIT_BYTES;
    els.alreadySmallNotice.classList.toggle('hidden', !alreadySmall);
  }

  function setProgress(percent, label) {
    els.progress.classList.remove('hidden');
    els.progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    els.progressLabel.textContent = label;
  }

  function onCompressProgress(info) {
    if (info.phase === 'rendering') {
      const roundFrac = (info.round - 1) / info.roundCount;
      const pageFrac = (info.pageIndex + 1) / info.pageCount / info.roundCount;
      const label = info.round > 1
        ? `Đang tối ưu thêm để đạt dưới 20 MB… (trang ${info.pageIndex + 1}/${info.pageCount})`
        : `Đang xử lý trang ${info.pageIndex + 1}/${info.pageCount}`;
      setProgress((roundFrac + pageFrac) * 90, label);
    } else if (info.phase === 'packaging') {
      setProgress(92, 'Đang đóng gói PDF…');
    }
  }

  async function runCompress(options) {
    if (state.busy || !state.file) return;
    state.busy = true;
    els.startBtn.disabled = true;
    els.strongerBtn.disabled = true;
    showState('info');
    setProgress(1, 'Đang chuẩn bị…');
    state.usedBeyondFloor = options?.rounds === PdfCompress.BEYOND_FLOOR_ROUNDS;
    try {
      const result = await PdfCompress.compressPdf(state.file, { ...options, onProgress: onCompressProgress });
      state.result = result;
      setProgress(100, 'Hoàn tất');
      renderResult(result);
      showState('result');
    } catch (err) {
      console.error('[PdfCompress]', err);
      toast(`Không nén được PDF: ${err.message || err}`);
      showState('info');
    } finally {
      state.busy = false;
      els.startBtn.disabled = false;
      els.strongerBtn.disabled = false;
      setTimeout(() => els.progress.classList.add('hidden'), 4000);
    }
  }

  function renderResult(result) {
    revokeDownloadUrl();
    state.downloadUrl = URL.createObjectURL(result.blob);
    const reduction = state.originalSize > 0
      ? Math.round((1 - result.outputBytes / state.originalSize) * 100)
      : 0;
    els.resultSizes.textContent = `${formatBytes(state.originalSize)} → ${formatBytes(result.outputBytes)}`;
    els.resultReduction.textContent = reduction > 0 ? `Giảm ${reduction}%` : '';
    const checkIcon = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10l4 4 8-8"/></svg>';
    const crossIcon = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15"/></svg>';
    const pageCheck = result.pageCount === state.pageCount;
    els.resultChecks.innerHTML = [
      `<li class="${pageCheck ? 'text-success' : 'text-danger'}">${pageCheck ? checkIcon : crossIcon} ${result.pageCount}/${state.pageCount} trang</li>`,
      `<li class="${result.achievedTarget ? 'text-success' : 'text-danger'}">${result.achievedTarget ? checkIcon : crossIcon} Dưới 20 MB</li>`,
      `<li class="text-success">${checkIcon} Xử lý hoàn toàn trên thiết bị</li>`
    ].join('');
    if (result.achievedTarget) {
      els.resultNotice.classList.add('hidden');
      els.strongerBtn.classList.add('hidden');
    } else {
      els.resultNotice.textContent = 'Chưa đạt dưới 20 MB với mức chất lượng an toàn hiện tại.';
      els.resultNotice.classList.remove('hidden');
      els.strongerBtn.classList.toggle('hidden', state.usedBeyondFloor);
    }
  }

  function downloadResult() {
    if (!state.result || !state.downloadUrl) return;
    const baseName = sanitizeFilename(state.originalName.replace(/\.pdf$/i, ''));
    const link = document.createElement('a');
    link.href = state.downloadUrl;
    link.download = `${baseName}_duoi-20MB.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    toast(`Đã tải xuống: ${link.download}`);
  }

  function revokeDownloadUrl() {
    if (state.downloadUrl) { URL.revokeObjectURL(state.downloadUrl); state.downloadUrl = null; }
  }

  function reset() {
    revokeDownloadUrl();
    state.file = null;
    state.originalName = '';
    state.originalSize = 0;
    state.pageCount = 0;
    state.result = null;
    state.usedBeyondFloor = false;
    if (els.fileInput) els.fileInput.value = '';
    showState('drop');
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
    return !!state.file;
  }

  // Events
  if (els.chooseBtn && els.fileInput) els.chooseBtn.addEventListener('click', () => els.fileInput.click());
  if (els.fileInput) {
    els.fileInput.addEventListener('change', e => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
      e.target.value = '';
    });
  }
  if (els.dropZone) {
    ['dragenter', 'dragover'].forEach(ev => els.dropZone.addEventListener(ev, e => { e.preventDefault(); els.dropZone.classList.add('dragging'); }));
    ['dragleave', 'drop'].forEach(ev => els.dropZone.addEventListener(ev, e => { e.preventDefault(); els.dropZone.classList.remove('dragging'); }));
    els.dropZone.addEventListener('drop', e => { const file = e.dataTransfer?.files?.[0]; if (file) handleFile(file); });
    els.dropZone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); els.fileInput?.click(); } });
  }
  if (els.startBtn) els.startBtn.addEventListener('click', () => runCompress());
  if (els.strongerBtn) els.strongerBtn.addEventListener('click', () => runCompress({ rounds: PdfCompress.BEYOND_FLOOR_ROUNDS }));
  if (els.changeFileBtn) els.changeFileBtn.addEventListener('click', reset);
  if (els.resetBtn) els.resetBtn.addEventListener('click', reset);
  if (els.downloadBtn) els.downloadBtn.addEventListener('click', downloadResult);

  window.VigilLensCompress = { activate, deactivate, hasWork };
})();

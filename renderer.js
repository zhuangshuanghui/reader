const ipcRenderer = { invoke: window.readerApi.invoke };
const path = { extname: window.readerApi.extname };
const pathToFileURL = (value) => ({ href: window.readerApi.toFileUrl(value) });
const { cleanFileName, formatProgress, escapeHtml } = window.readerApi;

let books = [];
let activeBook = null;
let readerInstance = null;
let readerOpened = false;
let currentTheme = localStorage.getItem('reader-theme') || 'dark';
let fishMode = localStorage.getItem('reader-fish-mode') === '1';
let topChromeCollapsed = localStorage.getItem('reader-top-chrome-collapsed') === '1';
let fontSize = Number(localStorage.getItem('reader-font-size') || 18);
let saveTimer = null;
let tocVisible = true;
let tocCollapsed = false;
let selectionState = null;
let noteDraft = '';
let immersiveMode = false;
let epubLocationsReady = null;
let readerZoom = 1;
let readerState = {
  toc: [],
  currentHref: '',
  currentLabel: '',
  coverUrl: '',
  mode: 'plain',
};
let notesSearchQuery = '';
let selectedAnnotationId = '';
let imageZoomVisible = false;
let reviewSaveTimer = null;
let readingTimer = null;
let pendingReadingByDate = {};
let readingTickAt = 0;
let windowFocused = true;

const state = {
  searchFilter: '',
  searchResults: [],
};

const els = {
  importBtn: document.getElementById('importBtn'),
  totalReadingTime: document.getElementById('totalReadingTime'),
  readingStatsBtn: document.getElementById('readingStatsBtn'),
  searchLibrary: document.getElementById('searchLibrary'),
  recentList: document.getElementById('recentList'),
  bookmarkList: document.getElementById('bookmarkList'),
  bookList: document.getElementById('bookList'),
  bookTitle: document.getElementById('bookTitle'),
  bookMeta: document.getElementById('bookMeta'),
  tocBtn: document.getElementById('tocBtn'),
  tocFoldBtn: document.getElementById('tocFoldBtn'),
  zoomOutBtn: document.getElementById('zoomOutBtn'),
  zoomResetBtn: document.getElementById('zoomResetBtn'),
  zoomInBtn: document.getElementById('zoomInBtn'),
  immersiveBtn: document.getElementById('immersiveBtn'),
  readerWorkspace: document.getElementById('readerWorkspace'),
  readerHost: document.getElementById('readerHost'),
  bookDetail: document.getElementById('bookDetail'),
  detailTitle: document.getElementById('detailTitle'),
  detailMeta: document.getElementById('detailMeta'),
  detailSummary: document.getElementById('detailSummary'),
  openReaderBtn: document.getElementById('openReaderBtn'),
  backDetailBtn: document.getElementById('backDetailBtn'),
  readerSidebar: document.getElementById('readerSidebar'),
  readerCover: document.getElementById('readerCover'),
  readerSidebarTitle: document.getElementById('readerSidebarTitle'),
  readerSidebarHint: document.getElementById('readerSidebarHint'),
  readerSidebarList: document.getElementById('readerSidebarList'),
  progressText: document.getElementById('progressText'),
  syncText: document.getElementById('syncText'),
  searchBookInput: document.getElementById('searchBookInput'),
  searchBookBtn: document.getElementById('searchBookBtn'),
  searchResults: document.getElementById('searchResults'),
  bookmarkBtn: document.getElementById('bookmarkBtn'),
  notesBtn: document.getElementById('notesBtn'),
  reviewBtn: document.getElementById('reviewBtn'),
  fontMinusBtn: document.getElementById('fontMinusBtn'),
  fontPlusBtn: document.getElementById('fontPlusBtn'),
  themeBtn: document.getElementById('themeBtn'),
  fishModeBtn: document.getElementById('fishModeBtn'),
  menuToggleBtn: document.getElementById('menuToggleBtn'),
  fishChrome: document.getElementById('fishChrome'),
  fishFileName: document.getElementById('fishFileName'),
  fishBreadcrumbs: document.getElementById('fishBreadcrumbs'),
  annotationList: document.getElementById('annotationList'),
  selectionMenu: document.getElementById('selectionMenu'),
  highlightSelectionBtn: document.getElementById('highlightSelectionBtn'),
  noteSelectionBtn: document.getElementById('noteSelectionBtn'),
  cancelSelectionBtn: document.getElementById('cancelSelectionBtn'),
  noteModal: document.getElementById('noteModal'),
  noteInput: document.getElementById('noteInput'),
  saveNoteBtn: document.getElementById('saveNoteBtn'),
  closeNoteBtn: document.getElementById('closeNoteBtn'),
  notesModal: document.getElementById('notesModal'),
  closeNotesBtn: document.getElementById('closeNotesBtn'),
  notesSearchInput: document.getElementById('notesSearchInput'),
  notesList: document.getElementById('notesList'),
  noteDetailTitle: document.getElementById('noteDetailTitle'),
  noteDetailMeta: document.getElementById('noteDetailMeta'),
  noteDetailInput: document.getElementById('noteDetailInput'),
  saveNoteDetailBtn: document.getElementById('saveNoteDetailBtn'),
  deleteNoteBtn: document.getElementById('deleteNoteBtn'),
  jumpNoteBtn: document.getElementById('jumpNoteBtn'),
  imageZoomModal: document.getElementById('imageZoomModal'),
  imageZoomImg: document.getElementById('imageZoomImg'),
  closeImageZoomBtn: document.getElementById('closeImageZoomBtn'),
  reviewModal: document.getElementById('reviewModal'),
  closeReviewBtn: document.getElementById('closeReviewBtn'),
  reviewTitle: document.getElementById('reviewTitle'),
  reviewMeta: document.getElementById('reviewMeta'),
  reviewInput: document.getElementById('reviewInput'),
  reviewStatus: document.getElementById('reviewStatus'),
  saveReviewBtn: document.getElementById('saveReviewBtn'),
  readingStatsModal: document.getElementById('readingStatsModal'),
  closeReadingStatsBtn: document.getElementById('closeReadingStatsBtn'),
  readingStatsDate: document.getElementById('readingStatsDate'),
  readingStatsSummary: document.getElementById('readingStatsSummary'),
  readingStatsList: document.getElementById('readingStatsList'),
};

function setStatus(text, sync = '') {
  els.progressText.textContent = text;
  els.syncText.textContent = sync;
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function ensureLocalReadingStats(book) {
  if (!book) {
    return { totalSeconds: 0, daily: {} };
  }
  if (!book.readingStats || typeof book.readingStats !== 'object') {
    book.readingStats = { totalSeconds: 0, daily: {} };
  }
  if (!book.readingStats.daily || typeof book.readingStats.daily !== 'object') {
    book.readingStats.daily = {};
  }
  book.readingStats.totalSeconds = Math.max(0, Math.floor(Number(book.readingStats.totalSeconds || 0)));
  return book.readingStats;
}

function formatReadingDuration(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds || 0)));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  if (hours > 0) {
    return `${hours}小时${minutes}分钟`;
  }
  if (minutes > 0) {
    return `${minutes}分钟`;
  }
  return `${value}秒`;
}

function readingStatsText(book = activeBook) {
  const stats = ensureLocalReadingStats(book);
  const todaySeconds = Math.max(0, Math.floor(Number(stats.daily?.[localDateKey()] || 0)));
  return `今日 ${formatReadingDuration(todaySeconds)} · 累计 ${formatReadingDuration(stats.totalSeconds)}`;
}

function renderTotalReadingTime() {
  const totalSeconds = books.reduce((sum, book) => sum + ensureLocalReadingStats(book).totalSeconds, 0);
  els.totalReadingTime.textContent = `总阅读 ${formatReadingDuration(totalSeconds)}`;
}

function renderReadingStatsPage() {
  const date = els.readingStatsDate.value || localDateKey();
  const rows = books
    .map((book) => {
      const stats = ensureLocalReadingStats(book);
      return {
        book,
        seconds: Math.max(0, Math.floor(Number(stats.daily?.[date] || 0))),
      };
    })
    .filter((row) => row.seconds > 0)
    .sort((a, b) => b.seconds - a.seconds);
  const totalSeconds = rows.reduce((sum, row) => sum + row.seconds, 0);
  els.readingStatsSummary.textContent = `${date} · 共 ${formatReadingDuration(totalSeconds)}`;
  els.readingStatsList.innerHTML = rows.length
    ? rows.map(({ book, seconds }) => `
      <div class="reading-stats-item">
        <div>
          <div class="name">${escapeHtml(book.title || book.originalName || '未命名')}</div>
          <div class="meta">${escapeHtml(book.author || '未知作者')} · ${escapeHtml(String(book.format || '').toUpperCase())}</div>
        </div>
        <div class="reading-stats-duration">${escapeHtml(formatReadingDuration(seconds))}</div>
      </div>
    `).join('')
    : '<div class="meta">这一天还没有阅读记录</div>';
}

function openReadingStatsPage() {
  els.readingStatsDate.value = localDateKey();
  renderReadingStatsPage();
  els.readingStatsModal.classList.remove('hidden');
}

function closeReadingStatsPage() {
  els.readingStatsModal.classList.add('hidden');
}

function loadTheme() {
  document.body.classList.toggle('light-theme', currentTheme === 'light');
}

function saveTheme() {
  localStorage.setItem('reader-theme', currentTheme);
}

function saveFishMode() {
  localStorage.setItem('reader-fish-mode', fishMode ? '1' : '0');
}

function saveTopChromeState() {
  localStorage.setItem('reader-top-chrome-collapsed', topChromeCollapsed ? '1' : '0');
}

function syncTopChromeUI() {
  if (!els.menuToggleBtn || !els.readerWorkspace || !els.bookDetail) {
    return;
  }
  const collapsed = topChromeCollapsed;
  els.menuToggleBtn.textContent = collapsed ? '▼' : '▲';
  els.menuToggleBtn.title = collapsed ? '展开顶部菜单' : '收起顶部菜单';
  els.menuToggleBtn.setAttribute('aria-label', collapsed ? '展开顶部菜单' : '收起顶部菜单');
  els.menuToggleBtn.classList.toggle('collapsed', collapsed);
  document.body.classList.toggle('top-chrome-collapsed', collapsed);
  els.readerWorkspace.classList.toggle('top-chrome-collapsed', collapsed);
  els.bookDetail.classList.toggle('hidden', collapsed && !readerOpened);
  updateFishChrome();
}

function toggleTopChrome() {
  topChromeCollapsed = !topChromeCollapsed;
  saveTopChromeState();
  syncTopChromeUI();
}

function syncFishModeUI() {
  document.body.classList.toggle('fish-mode', fishMode);
  if (els.fishModeBtn) {
    els.fishModeBtn.textContent = fishMode ? '退出摸鱼' : '摸鱼模式';
  }
  updateFishChrome();
}

function toggleFishMode() {
  fishMode = !fishMode;
  saveFishMode();
  syncFishModeUI();
}

function saveFontSize() {
  localStorage.setItem('reader-font-size', String(fontSize));
}

function fishFileLabel(book = activeBook) {
  if (!book) {
    return 'untitled.txt';
  }
  const base = cleanFileName(book.title || book.originalName || 'untitled') || 'untitled';
  const ext = String(book.format || path.extname(book.entryPath || book.originalName || '') || 'txt')
    .replace(/^\./, '')
    .toLowerCase() || 'txt';
  return `${base}.${ext}`;
}

function updateFishChrome() {
  if (!els.fishChrome || !els.fishFileName || !els.fishBreadcrumbs) {
    return;
  }
  els.fishChrome.classList.toggle('hidden', !fishMode);
  els.fishFileName.textContent = fishFileLabel();
  const chapter = readerState.currentLabel ? ` > ${readerState.currentLabel}` : '';
  els.fishBreadcrumbs.textContent = activeBook
    ? `${activeBook.title || activeBook.originalName || 'workspace'}${chapter}`
    : 'workspace';
  document.title = fishMode ? `${fishFileLabel()} - Visual Studio Code` : '本地阅读器';
}

function normalizeAnnotations(items) {
  return (items || [])
    .filter((item) => item && item.anchor)
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

function filterAnnotations(items, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) {
    return items;
  }
  return items.filter((item) => {
    const parts = [item.type, item.note, item.excerpt, item.chapter, item.anchor?.href]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return parts.includes(q);
  });
}

function annotationTitle(item) {
  return item.type === 'note' ? '笔记' : '划线';
}

function updateReviewInfo(saved = false) {
  const content = els.reviewInput.value || '';
  const count = content.replace(/\s/g, '').length;
  const review = activeBook?.review || null;
  const updatedAt = review?.updatedAt ? new Date(review.updatedAt).toLocaleString() : '尚未保存';
  els.reviewStatus.textContent = `${count} 字${saved ? ' · 已保存' : ''}`;
  els.reviewMeta.textContent = activeBook
    ? `${activeBook.author || '未知作者'} · 最近修改 ${updatedAt}`
    : '请先选择一本书';
}

function openReviewPage() {
  const title = activeBook?.title || activeBook?.originalName || '读后感';
  els.reviewTitle.textContent = activeBook ? `《${title}》读后感` : '读后感';
  els.reviewInput.value = activeBook?.review?.content || '';
  els.reviewInput.disabled = !activeBook;
  els.saveReviewBtn.disabled = !activeBook;
  updateReviewInfo();
  els.reviewModal.classList.remove('hidden');
  if (activeBook) {
    setTimeout(() => els.reviewInput.focus(), 0);
  }
}

async function saveReview(silent = false) {
  if (!activeBook) {
    return;
  }
  clearTimeout(reviewSaveTimer);
  const review = await ipcRenderer.invoke('library:saveReview', {
    bookId: activeBook.id,
    content: els.reviewInput.value,
  });
  if (!review) {
    return;
  }
  activeBook.review = review;
  books = books.map((book) => book.id === activeBook.id ? { ...book, review } : book);
  updateReviewInfo(true);
  if (!silent) {
    setStatus('读后感已保存', '本地已保存');
  }
}

function scheduleReviewSave() {
  updateReviewInfo();
  clearTimeout(reviewSaveTimer);
  reviewSaveTimer = setTimeout(() => {
    saveReview(true);
  }, 900);
}

function closeReviewPage() {
  if (!els.reviewModal.classList.contains('hidden') && activeBook) {
    saveReview(true);
  }
  els.reviewModal.classList.add('hidden');
}

function renderNotesPage() {
  if (!activeBook) {
    els.notesList.innerHTML = '<div class="meta">请先选择一本书</div>';
    els.noteDetailTitle.textContent = '请选择一条笔记';
    els.noteDetailMeta.textContent = '';
    els.noteDetailInput.value = '';
    return;
  }

  const items = filterAnnotations(normalizeAnnotations(activeBook.annotations), notesSearchQuery);
  els.notesList.innerHTML = items.length
    ? items.map((item) => `
      <div class="note-item ${item.id === selectedAnnotationId ? 'active' : ''}" data-note-id="${item.id}">
        <div class="note-item-top">
          <div class="note-item-title">${escapeHtml(annotationTitle(item))}</div>
          <div class="meta">${escapeHtml(new Date(item.createdAt).toLocaleString())}</div>
        </div>
        <div class="note-item-meta">${escapeHtml(item.chapter || item.anchor?.href || '未定位')}</div>
        <div class="meta">${escapeHtml(item.excerpt || '')}</div>
      </div>
    `).join('')
    : '<div class="meta">没有匹配的笔记</div>';

  document.querySelectorAll('.note-item').forEach((node) => {
    node.addEventListener('click', () => selectNote(node.dataset.noteId));
  });

  if (!selectedAnnotationId && items[0]) {
    selectNote(items[0].id, true);
  }
}

function selectNote(annotationId, skipRender = false) {
  selectedAnnotationId = annotationId || '';
  const item = (activeBook?.annotations || []).find((entry) => entry.id === selectedAnnotationId);
  if (!item) {
    els.noteDetailTitle.textContent = '请选择一条笔记';
    els.noteDetailMeta.textContent = '';
    els.noteDetailInput.value = '';
    els.saveNoteDetailBtn.disabled = true;
    els.deleteNoteBtn.disabled = true;
    els.jumpNoteBtn.disabled = true;
    if (!skipRender) {
      renderNotesPage();
    }
    return;
  }

  els.noteDetailTitle.textContent = `${annotationTitle(item)} · ${item.chapter || item.anchor?.href || '未定位'}`;
  els.noteDetailMeta.textContent = `${new Date(item.createdAt).toLocaleString()}${item.updatedAt ? ` · 更新于 ${new Date(item.updatedAt).toLocaleString()}` : ''}`;
  els.noteDetailInput.value = item.note || '';
  els.saveNoteDetailBtn.disabled = false;
  els.deleteNoteBtn.disabled = false;
  els.jumpNoteBtn.disabled = false;
  if (!skipRender) {
    renderNotesPage();
  }
}

function openNotesPage() {
  notesSearchQuery = '';
  selectedAnnotationId = '';
  els.notesSearchInput.value = '';
  renderNotesPage();
  els.notesModal.classList.remove('hidden');
}

function closeNotesPage() {
  els.notesModal.classList.add('hidden');
}

async function saveSelectedNote() {
  if (!activeBook || !selectedAnnotationId) {
    return;
  }
  const note = els.noteDetailInput.value.trim();
  const updated = await ipcRenderer.invoke('library:updateAnnotation', {
    bookId: activeBook.id,
    annotationId: selectedAnnotationId,
    note,
  });
  if (updated) {
    activeBook.annotations = (activeBook.annotations || []).map((item) => item.id === selectedAnnotationId ? { ...item, ...updated } : item);
    renderAnnotationsList();
    renderNotesPage();
    setStatus('笔记已更新', '本地已保存');
  }
}

async function deleteSelectedNote() {
  if (!activeBook || !selectedAnnotationId) {
    return;
  }
  await ipcRenderer.invoke('library:deleteAnnotation', { bookId: activeBook.id, annotationId: selectedAnnotationId });
  activeBook.annotations = (activeBook.annotations || []).filter((item) => item.id !== selectedAnnotationId);
  selectedAnnotationId = '';
  renderAnnotationsList();
  renderNotesPage();
  setStatus('笔记已删除', '本地已保存');
}

async function jumpSelectedNote() {
  if (!activeBook || !selectedAnnotationId) {
    return;
  }
  const item = (activeBook.annotations || []).find((entry) => entry.id === selectedAnnotationId);
  if (item) {
    await jumpToAnnotation(item);
  }
}

function renderAnnotationsList() {
  const items = normalizeAnnotations(activeBook?.annotations);
  els.annotationList.innerHTML = items.length
    ? items.map((item) => {
        const typeLabel = item.type === 'note' ? '笔记' : '划线';
        const anchorLabel = item.anchor?.mode === 'epub' ? (item.chapter || item.anchor?.href || 'EPUB') : '本地文本';
        return `
          <div class="annotation-item" data-id="${item.id}">
            <div class="annotation-head">
              <div class="annotation-type">${escapeHtml(typeLabel)} · ${escapeHtml(anchorLabel)}</div>
              <button class="annotation-delete" data-delete-id="${item.id}">删除</button>
            </div>
            <div class="meta">${escapeHtml(item.excerpt || '无摘录')}</div>
            ${item.note ? `<div class="annotation-note">${escapeHtml(item.note)}</div>` : ''}
          </div>
        `;
      }).join('')
    : '<div class="meta">当前书籍还没有划线或笔记</div>';

  document.querySelectorAll('.annotation-item').forEach((node) => {
    node.addEventListener('click', async () => {
      const item = (activeBook?.annotations || []).find((entry) => entry.id === node.dataset.id);
      if (!item) {
        return;
      }
      await jumpToAnnotation(item);
    });
  });

  document.querySelectorAll('.annotation-delete').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      const annotationId = button.dataset.deleteId;
      if (!activeBook || !annotationId) {
        return;
      }
      await ipcRenderer.invoke('library:deleteAnnotation', { bookId: activeBook.id, annotationId });
      activeBook.annotations = (activeBook.annotations || []).filter((item) => item.id !== annotationId);
      renderAnnotationsList();
      await renderReader(activeBook);
      setStatus('笔记已删除', '本地已保存');
    });
  });
}

async function renderFallbackText(book, message = '') {
  const text = await ipcRenderer.invoke('library:readSearchText', book.id);
  const wrapper = document.createElement('div');
  wrapper.className = 'reader-scroll';
  wrapper.style.fontSize = `${fontSize}px`;
  wrapper.innerHTML = `
    <div class="chapter">
      ${message ? `<div class="reader-warning">${escapeHtml(message)}</div>` : ''}
      <pre>${escapeHtml(text)}</pre>
    </div>
  `;
  els.readerHost.appendChild(wrapper);
  setStatus('阅读中 · 纯文本兜底', message || '');
  setSidebarMode('toc');
  readerState.toc = [];
  renderReaderSidebar();
}

async function jumpToSearchResult(item) {
  if (!activeBook || !item) {
    return;
  }

  const totalLength = Math.max(1, Number(item.totalLength || 1));
  const percent = Math.min(1, Math.max(0, Number(item.index || 0) / totalLength));

  if (!readerOpened) {
    readerOpened = true;
    syncModeUI();
    await renderReader(activeBook);
    startReadingTimer();
  }

  if (activeBook.format === 'epub' || path.extname(activeBook.entryPath).toLowerCase() === '.epub') {
    try {
      if (!epubLocationsReady && readerInstance?.bookObject?.locations) {
        epubLocationsReady = readerInstance.bookObject.locations.generate(1200).catch(() => null);
      }
      await epubLocationsReady;
      const cfi = readerInstance?.bookObject?.locations?.cfiFromPercentage(percent);
      if (cfi && readerInstance?.display) {
        await readerInstance.display(cfi);
      }
    } catch {
      // ignore and fall through
    }
    return;
  }

  if (['.html', '.htm', '.xhtml'].includes(path.extname(activeBook.entryPath).toLowerCase())) {
    const frame = els.readerHost.querySelector('iframe');
    const doc = frame?.contentDocument;
    const scrolling = doc?.scrollingElement || doc?.documentElement || doc?.body;
    if (scrolling) {
      scrolling.scrollTop = Math.max(0, (scrolling.scrollHeight - scrolling.clientHeight) * percent);
    }
    return;
  }

  if (path.extname(activeBook.entryPath).toLowerCase() === '.pdf' && readerState.pdfPageNodes?.length) {
    const pageIndex = Math.max(1, Math.min(readerState.pdfPageNodes.length, Math.ceil(percent * readerState.pdfPageNodes.length)));
    readerState.pdfPageNodes[pageIndex - 1]?.scrollIntoView({ block: 'start' });
    return;
  }

  const wrapper = els.readerHost.querySelector('.reader-scroll');
  if (wrapper) {
    wrapper.scrollTop = Math.max(0, (wrapper.scrollHeight - wrapper.clientHeight) * percent);
  }
}

function syncModeUI() {
  const reading = readerOpened;
  els.bookDetail.classList.toggle('hidden', reading);
  els.backDetailBtn.classList.toggle('hidden', !reading);
  els.readerCover.classList.toggle('hidden', reading || !activeBook);
}

function syncImmersiveMode() {
  document.body.classList.toggle('immersive', immersiveMode);
  els.immersiveBtn.textContent = immersiveMode ? '退出沉浸' : '沉浸';
}

function syncTocFoldMode() {
  els.readerSidebar.classList.toggle('compact', tocCollapsed);
  els.tocFoldBtn.textContent = tocCollapsed ? '展开目录' : '折叠目录';
}

function showImageZoom(src, alt = '图片') {
  if (!src) {
    return;
  }
  els.imageZoomImg.src = src;
  els.imageZoomImg.alt = alt;
  els.imageZoomModal.classList.remove('hidden');
  imageZoomVisible = true;
}

function hideImageZoom() {
  els.imageZoomModal.classList.add('hidden');
  els.imageZoomImg.src = '';
  imageZoomVisible = false;
}

function bindImageZoom(doc, toCanvas = null) {
  if (!doc || !doc.addEventListener) {
    return;
  }
  doc.addEventListener('click', (event) => {
    const img = event.target && event.target.closest ? event.target.closest('img') : null;
    if (img && img.src) {
      event.preventDefault();
      event.stopPropagation();
      showImageZoom(img.src, img.alt || '图片');
    }
  }, true);
  if (toCanvas) {
    doc.addEventListener('click', (event) => {
      const canvas = event.target && event.target.closest ? event.target.closest('canvas') : null;
      if (canvas) {
        event.preventDefault();
        const src = canvas.toDataURL('image/png');
        showImageZoom(src, 'PDF 页面');
      }
    }, true);
  }
}

async function applyZoom(nextZoom) {
  readerZoom = Math.max(0.7, Math.min(1.6, nextZoom));
  els.zoomResetBtn.textContent = `${Math.round(readerZoom * 100)}%`;
  if (activeBook && readerOpened) {
    await renderReader(activeBook);
  }
}

function showSelectionMenu() {
  els.selectionMenu.classList.remove('hidden');
}

function hideSelectionMenu() {
  els.selectionMenu.classList.add('hidden');
}

function showNoteModal() {
  noteDraft = '';
  els.noteInput.value = '';
  els.noteModal.classList.remove('hidden');
  setTimeout(() => els.noteInput.focus(), 0);
}

function hideNoteModal() {
  els.noteModal.classList.add('hidden');
}

function hideSelectionUi() {
  hideSelectionMenu();
  hideNoteModal();
  selectionState = null;
}

function resolveTextSelection(wrapper) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }
  const range = selection.getRangeAt(0);
  if (!wrapper.contains(range.commonAncestorContainer)) {
    return null;
  }

  const pre = wrapper.querySelector('pre');
  if (!pre) {
    return null;
  }

  const startRange = document.createRange();
  startRange.selectNodeContents(pre);
  startRange.setEnd(range.startContainer, range.startOffset);
  const endRange = document.createRange();
  endRange.selectNodeContents(pre);
  endRange.setEnd(range.endContainer, range.endOffset);
  const start = startRange.toString().length;
  const end = endRange.toString().length;
  const normalizedStart = Math.min(start, end);
  const normalizedEnd = Math.max(start, end);
  const excerpt = selection.toString().trim();
  if (!excerpt) {
    return null;
  }

  return {
    mode: 'text',
    start: normalizedStart,
    end: normalizedEnd,
    excerpt,
    scrollTop: wrapper.scrollTop,
  };
}

function buildTextAnnotationHtml(text, annotations) {
  const pieces = [];
  const ranges = (annotations || [])
    .filter((item) => item.anchor?.mode === 'text' && Number.isFinite(item.anchor.start) && Number.isFinite(item.anchor.end))
    .sort((a, b) => a.anchor.start - b.anchor.start);

  let cursor = 0;
  for (const item of ranges) {
    const start = Math.max(0, Math.min(text.length, item.anchor.start));
    const end = Math.max(start, Math.min(text.length, item.anchor.end));
    if (start < cursor) {
      continue;
    }
    pieces.push(escapeHtml(text.slice(cursor, start)));
    const cssClass = item.type === 'note' ? 'plain-note' : 'plain-highlight';
    pieces.push(`<mark class="${cssClass}" data-annotation-id="${item.id}">${escapeHtml(text.slice(start, end))}</mark>`);
    cursor = end;
  }
  pieces.push(escapeHtml(text.slice(cursor)));
  return pieces.join('');
}

async function openNoteEditor() {
  if (!selectionState) {
    return;
  }
  hideSelectionMenu();
  showNoteModal();
}

async function saveSelectionAnnotation(type, noteText = '') {
  if (!activeBook || !selectionState) {
    return;
  }

  const payload = {
    bookId: activeBook.id,
    type,
    note: noteText,
    excerpt: selectionState.excerpt,
    anchor: selectionState,
    chapter: readerState.currentLabel || '',
  };
  const annotation = await ipcRenderer.invoke('library:addAnnotation', payload);
  if (!annotation) {
    return;
  }

  activeBook.annotations = [annotation, ...(activeBook.annotations || [])];
  renderAnnotationsList();
  if (selectionState.mode === 'text') {
    await renderReader(activeBook);
    renderBookmarks();
    renderAnnotationsList();
  } else if (selectionState.mode === 'epub' && readerInstance?.annotations) {
    applyEpubAnnotation(annotation);
  }
  setStatus(type === 'note' ? '笔记已保存' : '划线已保存', '本地已保存');
  hideSelectionUi();
}

function applyEpubAnnotation(annotation) {
  if (!readerInstance || !readerInstance.annotations || annotation.anchor?.mode !== 'epub' || !annotation.anchor.cfiRange) {
    return;
  }
  const className = annotation.type === 'note' ? 'local-note' : 'local-highlight';
  const styles = annotation.type === 'note'
    ? { 'background-color': 'rgba(91, 140, 255, 0.24)' }
    : { 'background-color': 'rgba(255, 216, 84, 0.3)' };
  readerInstance.annotations.highlight(
    annotation.anchor.cfiRange,
    { id: annotation.id, note: annotation.note || '', excerpt: annotation.excerpt || '' },
    null,
    className,
    styles,
  );
}

function applyAllEpubAnnotations() {
  const annotations = normalizeAnnotations(activeBook?.annotations).filter((item) => item.anchor?.mode === 'epub' && item.anchor.cfiRange);
  annotations.forEach((annotation) => applyEpubAnnotation(annotation));
}

async function jumpToAnnotation(annotation) {
  if (!annotation?.anchor) {
    return;
  }
  if (annotation.anchor.mode === 'epub' && readerInstance && typeof readerInstance.display === 'function') {
    await readerInstance.display(annotation.anchor.cfiRange);
    return;
  }
  if (annotation.anchor.mode === 'text') {
    const wrapper = els.readerHost.querySelector('.reader-scroll');
    if (wrapper) {
      wrapper.scrollTop = annotation.anchor.scrollTop || 0;
    }
  }
}

function flattenToc(items, level = 0, output = []) {
  for (const item of items || []) {
    output.push({
      label: item.label || item.title || '未命名章节',
      href: item.href || '',
      id: item.id || '',
      level,
    });
    if (Array.isArray(item.subitems) && item.subitems.length) {
      flattenToc(item.subitems, level + 1, output);
    }
  }
  return output;
}

function simplifyToc(items) {
  const output = [];
  const visit = (nodes, level = 0) => {
    for (const node of nodes || []) {
      if (!node) continue;
      const href = String(node.href || node.src || '').trim();
      const label = String(node.label || node.title || node.text || '').trim();
      if (href || label) {
        output.push({
          label: label || href || '章节',
          href,
          level,
        });
      }
      const children = node.subitems || node.children || node.childNodes;
      if (Array.isArray(children) && children.length) {
        visit(children, level + 1);
      }
    }
  };
  visit(items);
  return output;
}

function matchTocLabel(toc, href) {
  const target = String(href || '').split('#')[0];
  const found = (toc || []).find((item) => String(item.href || '').split('#')[0] === target);
  return found?.label || '';
}

function setSidebarMode(mode) {
  readerState.mode = mode;
  els.readerSidebarTitle.textContent = mode === 'bookmark' ? '书签' : '目录';
  els.readerSidebarHint.textContent = mode === 'bookmark' ? '点击书签跳转' : '点击章节跳转';
}

function renderReaderSidebar() {
  if (!activeBook) {
    els.readerSidebarList.innerHTML = '<div class="meta">打开一本书后显示目录</div>';
    els.readerCover.innerHTML = '<div class="reader-cover-placeholder">封面</div>';
    els.annotationList.innerHTML = '<div class="meta">打开一本书后显示划线与笔记</div>';
    return;
  }

  if (!readerOpened) {
    const tocCount = Array.isArray(activeBook.toc) ? activeBook.toc.length : 0;
    els.readerSidebarList.innerHTML = tocCount
      ? `<div class="meta">目录已解析，共 ${tocCount} 条。点击“阅读”后显示。</div>`
      : '<div class="meta">点击“阅读”后显示目录。</div>';
    els.readerCover.innerHTML = activeBook.coverPath
      ? `<img src="${pathToFileURL(activeBook.coverPath).href}" alt="封面" />`
      : '<div class="reader-cover-placeholder">封面</div>';
    els.annotationList.innerHTML = '<div class="meta">点击“阅读”后可看划线与笔记</div>';
    return;
  }

  const coverUrl = readerState.coverUrl || (activeBook.coverPath ? pathToFileURL(activeBook.coverPath).href : '');
  if (coverUrl) {
    els.readerCover.innerHTML = `<img src="${coverUrl}" alt="封面" />`;
  } else {
    els.readerCover.innerHTML = '<div class="reader-cover-placeholder">封面</div>';
  }

  const activeHref = readerState.currentHref;
  const tocSource = Array.isArray(readerState.toc) && readerState.toc.length ? readerState.toc : (activeBook?.toc || []);
  const toc = simplifyToc(tocSource).filter((item) => !tocCollapsed || item.level === 0);
  if (!toc.length) {
    els.readerSidebarList.innerHTML = '<div class="meta">当前书籍没有目录</div>';
  } else {
    els.readerSidebarList.innerHTML = toc.map((item) => `
      <div class="toc-item toc-level-${Math.min(item.level, 3)} ${item.href && activeHref && item.href === activeHref ? 'active' : ''}" data-href="${escapeHtml(item.href)}" data-level="${item.level}">
        <div class="toc-label">${escapeHtml(item.label)}</div>
        <div class="toc-meta">${item.level === 0 ? '章' : `第 ${item.level + 1} 层`}</div>
      </div>
    `).join('');

    document.querySelectorAll('.toc-item').forEach((node) => {
      node.addEventListener('click', () => {
        const href = node.dataset.href;
        if (readerInstance && typeof readerInstance.display === 'function' && href) {
          readerInstance.display(href);
        }
      });
    });
  }
  renderAnnotationsList();
}

function updateReaderChapter(href, label = '') {
  readerState.currentHref = href || '';
  readerState.currentLabel = label || '';
  if (activeBook) {
    const parts = [
      activeBook.author || '未知作者',
      String(activeBook.format || '').toUpperCase(),
      formatProgress(activeBook),
    ];
    if (readerState.currentLabel) {
      parts.push(readerState.currentLabel);
    }
    els.bookMeta.textContent = parts.join(' · ');
  }
  updateFishChrome();
  renderReaderSidebar();
}

function syncTocVisibility() {
  els.readerSidebar.classList.toggle('hidden', !tocVisible);
  els.readerWorkspace.classList.toggle('sidebar-hidden', !tocVisible);
  els.tocBtn.textContent = tocVisible ? '收起目录' : '目录';
}

function isModalReadingPaused() {
  return !els.notesModal.classList.contains('hidden')
    || !els.reviewModal.classList.contains('hidden')
    || !els.readingStatsModal.classList.contains('hidden')
    || !els.imageZoomModal.classList.contains('hidden')
    || !els.noteModal.classList.contains('hidden');
}

function shouldTrackReadingTime() {
  return !!activeBook && readerOpened && windowFocused && !document.hidden && !isModalReadingPaused();
}

function addLocalReadingTime(seconds, date = localDateKey()) {
  const value = Math.max(0, Math.floor(Number(seconds || 0)));
  if (!activeBook || !value) {
    return;
  }
  const stats = ensureLocalReadingStats(activeBook);
  stats.daily[date] = Math.max(0, Math.floor(Number(stats.daily[date] || 0))) + value;
  stats.totalSeconds += value;
  pendingReadingByDate[date] = Math.max(0, Math.floor(Number(pendingReadingByDate[date] || 0))) + value;
}

async function flushReadingTime() {
  if (!activeBook) {
    pendingReadingByDate = {};
    return;
  }
  const entries = Object.entries(pendingReadingByDate)
    .map(([date, seconds]) => ({ date, seconds: Math.floor(Number(seconds || 0)) }))
    .filter((entry) => entry.seconds > 0);
  if (!entries.length) {
    return;
  }
  pendingReadingByDate = {};
  const stats = await ipcRenderer.invoke('library:addReadingTime', { bookId: activeBook.id, entries });
  if (stats) {
    activeBook.readingStats = stats;
    books = books.map((book) => book.id === activeBook.id ? { ...book, readingStats: stats } : book);
    renderLibrary();
    renderRecent();
    renderTotalReadingTime();
    if (!els.readingStatsModal.classList.contains('hidden')) {
      renderReadingStatsPage();
    }
  }
}

function updateReadingTimer() {
  const now = Date.now();
  if (!readingTickAt) {
    readingTickAt = now;
  }
  if (!shouldTrackReadingTime()) {
    readingTickAt = now;
    return;
  }
  const elapsed = Math.min(5, Math.floor((now - readingTickAt) / 1000));
  if (elapsed <= 0) {
    return;
  }
  readingTickAt += elapsed * 1000;
  addLocalReadingTime(elapsed);
  renderTotalReadingTime();
  if (!els.readingStatsModal.classList.contains('hidden')) {
    renderReadingStatsPage();
  }
  const currentStatus = els.progressText.textContent.replace(/ · 今日 .*$/, '');
  const baseStatus = currentStatus.startsWith('阅读中') ? currentStatus : `阅读中 · ${formatProgress(activeBook)}`;
  setStatus(baseStatus, els.syncText.textContent);
  const pendingTotal = Object.values(pendingReadingByDate).reduce((sum, seconds) => sum + Number(seconds || 0), 0);
  if (pendingTotal >= 30) {
    flushReadingTime();
  }
}

function startReadingTimer() {
  if (readingTimer) {
    return;
  }
  readingTickAt = Date.now();
  readingTimer = setInterval(updateReadingTimer, 1000);
}

async function stopReadingTimer() {
  if (readingTimer) {
    clearInterval(readingTimer);
    readingTimer = null;
  }
  readingTickAt = 0;
  await flushReadingTime();
}

async function refreshLibrary() {
  const result = await ipcRenderer.invoke('library:get');
  books = result.books || [];
  renderTotalReadingTime();
  renderLibrary();
  renderRecent();
  bindBookDeleteButtons();
}

function renderLibrary() {
  const filter = state.searchFilter.trim().toLowerCase();
  const filtered = books.filter((book) => {
    if (!filter) return true;
    return `${book.title || ''} ${book.author || ''}`.toLowerCase().includes(filter);
  });
  els.bookList.innerHTML = filtered.length
    ? filtered.map((book) => bookCard(book, book.id === activeBook?.id)).join('')
    : '<div class="meta">暂无书籍</div>';
  document.querySelectorAll('.book-card').forEach((node) => {
    node.addEventListener('click', () => selectBook(node.dataset.id));
  });
}

function renderRecent() {
  const recent = [...books]
    .filter((book) => book.lastOpenedAt)
    .sort((a, b) => new Date(b.lastOpenedAt) - new Date(a.lastOpenedAt))
    .slice(0, 10);
  els.recentList.innerHTML = recent.length
    ? recent.map((book) => recentCard(book)).join('')
    : '<div class="meta">还没有最近阅读记录</div>';
  document.querySelectorAll('.recent-card').forEach((node) => {
    node.addEventListener('click', () => selectBook(node.dataset.id));
  });
}

function clearReaderView() {
  stopReadingTimer();
  readerInstance = null;
  els.readerHost.className = 'reader-host empty-state';
  els.readerHost.innerHTML = '导入一本书开始阅读';
  readerOpened = false;
  syncModeUI();
  renderReaderSidebar();
  setStatus('就绪');
}

function bindBookDeleteButtons() {
  document.querySelectorAll('.book-delete').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      const bookId = button.dataset.deleteBookId;
      if (!bookId) {
        return;
      }
      const book = books.find((item) => item.id === bookId);
      const title = book?.title || book?.originalName || '这本书';
      if (!window.confirm(`确定删除《${title}》吗？\n会同时删除软件本地库里的书籍文件、进度、书签、划线和笔记。`)) {
        return;
      }
      await ipcRenderer.invoke('library:deleteBook', bookId);
      books = books.filter((item) => item.id !== bookId);
      if (activeBook?.id === bookId) {
        clearReaderView();
      }
      renderLibrary();
      renderRecent();
      setStatus('书籍已删除', '本地库已清理');
    });
  });
}

function renderBookmarks() {
  const bookmarks = activeBook?.bookmarks || [];
  els.bookmarkList.innerHTML = bookmarks.length
    ? bookmarks.map((item) => `
        <div class="bookmark-card" data-bookmark-id="${item.id}">
          <div class="name">${escapeHtml(item.label || '书签')}</div>
          <div class="meta">${escapeHtml(new Date(item.createdAt).toLocaleString())}</div>
        </div>
      `).join('')
    : '<div class="meta">当前书籍没有书签</div>';
  document.querySelectorAll('.bookmark-card').forEach((node) => {
    node.addEventListener('click', () => openBookmark(node.dataset.bookmarkId));
  });
}

function bookCard(book, active) {
  const coverUrl = book.coverPath ? pathToFileURL(book.coverPath).href : '';
  return `
    <div class="book-card ${active ? 'active' : ''}" data-id="${book.id}">
      <div class="book-thumb ${coverUrl ? '' : 'placeholder'}">${coverUrl ? `<img src="${coverUrl}" alt="封面" />` : ''}</div>
      <div class="book-body">
        <div class="book-actions">
          <button class="book-delete" data-delete-book-id="${book.id}">删除</button>
        </div>
        <div class="name">${escapeHtml(book.title || book.originalName || '未命名')}</div>
        <div class="meta">${escapeHtml(book.author || '未知作者')}</div>
        <div class="meta">${escapeHtml((book.format || '').toUpperCase())} · ${escapeHtml(formatProgress(book))}</div>
        <div class="meta">${escapeHtml(readingStatsText(book))}</div>
      </div>
    </div>
  `;
}

function recentCard(book) {
  const coverUrl = book.coverPath ? pathToFileURL(book.coverPath).href : '';
  return `
    <div class="recent-card" data-id="${book.id}">
      <div class="recent-thumb ${coverUrl ? '' : 'placeholder'}">${coverUrl ? `<img src="${coverUrl}" alt="封面" />` : ''}</div>
      <div class="book-body">
        <div class="book-actions">
          <button class="book-delete" data-delete-book-id="${book.id}">删除</button>
        </div>
        <div class="name">${escapeHtml(book.title || book.originalName || '未命名')}</div>
        <div class="meta">最后阅读 ${escapeHtml(new Date(book.lastOpenedAt).toLocaleString())}</div>
        <div class="meta">${escapeHtml(readingStatsText(book))}</div>
      </div>
    </div>
  `;
}

function renderBookDetail() {
  if (!activeBook) {
    els.detailTitle.textContent = '请选择一本书';
    els.detailMeta.textContent = '';
    els.detailSummary.textContent = '点击左侧书籍查看详情。';
    els.openReaderBtn.disabled = true;
    els.bookDetail.classList.add('empty-state');
    return;
  }

  const progress = formatProgress(activeBook);
  const lastOpened = activeBook.lastOpenedAt ? new Date(activeBook.lastOpenedAt).toLocaleString() : '未阅读';
  const tocCount = Array.isArray(activeBook.toc) ? activeBook.toc.length : 0;
  els.detailTitle.textContent = activeBook.title || activeBook.originalName || '未命名';
  els.detailMeta.textContent = `${activeBook.author || '未知作者'} · ${String(activeBook.format || '').toUpperCase()} · ${progress} · 目录 ${tocCount} 条 · 最近阅读 ${lastOpened} · ${readingStatsText(activeBook)}`;
  els.detailSummary.textContent = activeBook.description || `导入文件：${activeBook.originalName || ''}`;
  els.openReaderBtn.disabled = false;
  els.bookDetail.classList.remove('empty-state');
}

async function selectBook(bookId) {
  await stopReadingTimer();
  const book = await ipcRenderer.invoke('library:open', bookId);
  if (!book) {
    return;
  }
  activeBook = book;
  state.searchResults = [];
  els.searchResults.classList.remove('show');
  els.searchResults.innerHTML = '';
  renderLibrary();
  renderBookDetail();
  renderBookmarks();
  renderAnnotationsList();
  clearReaderView();
  syncModeUI();
  updateFishChrome();
  setStatus(`已选中：${book.title || book.originalName || '未命名'}`, '点击阅读进入正文');
  await refreshLibrary();
}

async function openReader() {
  if (!activeBook) {
    return;
  }
  readerOpened = true;
  if (Array.isArray(activeBook.toc) && activeBook.toc.length) {
    readerState.toc = activeBook.toc;
  }
  syncModeUI();
  updateFishChrome();
  await renderReader(activeBook);
  renderBookmarks();
  renderAnnotationsList();
  startReadingTimer();
  setStatus(`阅读中 · ${formatProgress(activeBook)}`, '本地已保存');
}

async function renderReader(book) {
  if (readerInstance && typeof readerInstance.destroy === 'function') {
    try {
      readerInstance.destroy();
    } catch {
      // ignore
    }
  }
  readerInstance = null;
  els.readerHost.className = 'reader-host';
  els.readerHost.innerHTML = '';
  readerState = {
    toc: [],
    currentHref: '',
    currentLabel: '',
    coverUrl: '',
    mode: 'plain',
    readerKind: '',
    pdfPageNodes: [],
    pdfPageCount: 0,
    htmlFrame: null,
  };
  setSidebarMode('toc');
  updateFishChrome();
  renderReaderSidebar();

  const entryExt = path.extname(book.entryPath).toLowerCase();
  if (book.format === 'epub' || entryExt === '.epub') {
    try {
      await renderEpub(book);
    } catch (error) {
      await renderFallbackText(book, `EPUB 渲染失败，已降级为文本阅读：${error.message}`);
    }
  } else if (book.format === 'pdf' || entryExt === '.pdf') {
    try {
      await renderPdf(book);
    } catch (error) {
      await renderFallbackText(book, `PDF 渲染失败，已降级为文本阅读：${error.message}`);
    }
  } else if (['.html', '.htm', '.xhtml'].includes(entryExt)) {
    try {
      await renderHtmlLike(book);
    } catch (error) {
      await renderFallbackText(book, `HTML 渲染失败，已降级为文本阅读：${error.message}`);
    }
  } else {
    await renderTextLike(book);
  }
}

async function renderHtmlLike(book) {
  const iframe = document.createElement('iframe');
  iframe.className = 'html-reader-frame';
  iframe.src = pathToFileURL(book.entryPath).href;
  iframe.setAttribute('sandbox', 'allow-same-origin');
  iframe.setAttribute('referrerpolicy', 'no-referrer');
  els.readerHost.appendChild(iframe);
  readerState.htmlFrame = iframe;
  readerState.readerKind = 'html';

  iframe.addEventListener('load', () => {
    try {
      const doc = iframe.contentDocument;
      if (doc && doc.body) {
        doc.body.style.margin = '0';
        doc.body.style.padding = `${Math.round(40 * readerZoom)}px ${Math.round(56 * readerZoom)}px ${Math.round(96 * readerZoom)}px`;
        doc.body.style.lineHeight = '1.85';
        doc.body.style.fontSize = `${fontSize * readerZoom}px`;
        doc.body.style.color = currentTheme === 'light' ? '#1c1f26' : '#ebeff7';
        doc.body.style.background = currentTheme === 'light' ? '#f7f5ef' : '#14171d';
        doc.body.style.overflowWrap = 'anywhere';
        doc.body.style.wordBreak = 'break-word';
        const style = doc.createElement('style');
        style.textContent = `
          img { max-width: 100%; height: auto; display: block; margin: 1em auto; }
          figure { max-width: 100%; margin: 1em 0; }
          video, audio { max-width: 100%; }
          table { max-width: 100%; display: block; overflow-x: auto; }
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif; }
        `;
        doc.head && doc.head.appendChild(style);
        bindImageZoom(doc);
      }
    } catch {
      // ignore cross-document styling failures
    }
  });

  readerInstance = {
    destroy: () => {
      try {
        iframe.src = 'about:blank';
      } catch {
        // ignore
      }
    },
  };
  setSidebarMode('toc');
  readerState.toc = Array.isArray(activeBook?.toc) ? activeBook.toc : [];
  renderReaderSidebar();
  renderAnnotationsList();
  setStatus('阅读中 · HTML 文档');
}

async function renderTextLike(book) {
  const text = await ipcRenderer.invoke('library:readText', book.id);
  const wrapper = document.createElement('div');
  wrapper.className = 'reader-scroll';
  wrapper.classList.toggle('zoom-compact', readerZoom < 1);
  wrapper.style.fontSize = `${fontSize * readerZoom}px`;
  wrapper.innerHTML = `<div class="chapter"><pre>${buildTextAnnotationHtml(text, activeBook?.annotations || [])}</pre></div>`;
  els.readerHost.appendChild(wrapper);
  readerState.readerKind = 'text';
  const savedScroll = book.progress?.scrollTop || 0;
  wrapper.scrollTop = savedScroll;
  wrapper.addEventListener('mouseup', () => {
    selectionState = resolveTextSelection(wrapper);
    if (selectionState) {
      showSelectionMenu();
    } else {
      hideSelectionUi();
    }
  });
  wrapper.addEventListener('scroll', () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const percent = wrapper.scrollHeight <= wrapper.clientHeight ? 1 : wrapper.scrollTop / Math.max(1, wrapper.scrollHeight - wrapper.clientHeight);
      persistProgress({ mode: 'text', scrollTop: wrapper.scrollTop, percent });
    }, 300);
  });
  setStatus(`阅读中 · ${Math.round((book.progress?.percent || 0) * 100)}%`);
  setSidebarMode('toc');
  readerState.toc = [];
  renderReaderSidebar();
  renderAnnotationsList();
}

async function renderEpub(book) {
  const ePub = window.ePub;
  const fileUrl = pathToFileURL(book.entryPath).href;
  const bookObject = ePub(fileUrl, { replacements: 'blobUrl' });
  await bookObject.ready;
  const toc = flattenToc((book.toc && book.toc.length ? book.toc : bookObject.navigation?.toc) || []);
  let coverUrl = null;
  try {
    coverUrl = await bookObject.coverUrl();
  } catch {
    coverUrl = null;
  }
  readerState.toc = toc;
  readerState.coverUrl = coverUrl || '';
  readerState.mode = 'toc';
  renderReaderSidebar();
  const rendition = bookObject.renderTo(els.readerHost, {
    width: '100%',
    height: '100%',
    spread: 'none',
    flow: 'scrolled-continuous',
  });
  readerInstance = rendition;
  readerInstance.bookObject = bookObject;
  readerInstance.navigation = bookObject.navigation;
  readerInstance.toc = toc;
  readerInstance.annotations = rendition.annotations;
  epubLocationsReady = bookObject.locations?.generate(1200).catch(() => null) || null;
  if (book.progress?.location) {
    await rendition.display(book.progress.location);
  } else {
    await rendition.display();
  }
  rendition.on('rendered', (_section, view) => {
    if (view && view.contents && view.contents.document) {
      bindImageZoom(view.contents.document);
    }
  });
  const currentView = rendition.views && rendition.views()[0];
  if (currentView && currentView.contents && currentView.contents.document) {
    bindImageZoom(currentView.contents.document);
  }
  applyAllEpubAnnotations();
  rendition.themes.default({
    body: {
      margin: '0',
      padding: '40px 56px 96px',
      background: currentTheme === 'light' ? '#f7f5ef' : '#14171d',
      color: currentTheme === 'light' ? '#1c1f26' : '#ebeff7',
      'line-height': '1.85',
      'font-size': `${fontSize * readerZoom}px`,
      'text-align': 'justify',
      'word-break': 'break-word',
      'overflow-wrap': 'anywhere',
      'font-variant-ligatures': 'common-ligatures',
    },
    p: {
      'margin-top': '0.8em',
      'margin-bottom': '0.8em',
    },
    img: {
      'max-width': '100%',
      height: 'auto',
      display: 'block',
      margin: '1em auto',
    },
    figure: {
      margin: '1em 0',
    },
  });
  rendition.on('relocated', (location) => {
    clearTimeout(saveTimer);
    const currentHref = location?.start?.href || '';
    const tocItem = currentHref ? bookObject.navigation?.get(currentHref) : null;
    const label = tocItem?.label || matchTocLabel(toc, currentHref) || '';
    updateReaderChapter(currentHref, label);
    saveTimer = setTimeout(() => {
      persistProgress({ mode: 'epub', location: location.start.cfi, href: currentHref, percent: location.start.percentage || 0 });
    }, 200);
    setStatus(`阅读中 · ${Math.round((location.start.percentage || 0) * 100)}%`, label);
  });
  rendition.on('selected', (cfiRange, contents) => {
    const excerpt = contents?.window?.getSelection?.()?.toString().trim();
    if (!excerpt) {
      return;
    }
    selectionState = {
      mode: 'epub',
      cfiRange,
      excerpt,
      href: readerState.currentHref,
      chapter: readerState.currentLabel || '',
    };
    showSelectionMenu();
  });
}

async function renderPdf(book) {
  const pdfjsLib = await import('./node_modules/pdfjs-dist/legacy/build/pdf.mjs');
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', window.location.href).href;
  const binary = await ipcRenderer.invoke('library:readBinary', book.id);
  if (!binary) {
    throw new Error('无法读取 PDF 文件');
  }
  const data = new Uint8Array(binary);
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  readerState.readerKind = 'pdf';
  readerState.pdfPageNodes = [];
  readerState.pdfPageCount = pdf.numPages;
  const scroll = document.createElement('div');
  scroll.className = 'reader-scroll';
  scroll.style.padding = '24px';
  scroll.style.background = currentTheme === 'light' ? '#f7f5ef' : '#14171d';
  scroll.style.color = currentTheme === 'light' ? '#1c1f26' : '#ebeff7';
  els.readerHost.appendChild(scroll);

  const pageNodes = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1.3 * readerZoom });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const wrapper = document.createElement('div');
    wrapper.className = 'pdf-page';
    wrapper.dataset.page = String(pageNumber);
    wrapper.appendChild(canvas);
    wrapper.style.cursor = 'zoom-in';
    wrapper.addEventListener('click', () => {
      showImageZoom(canvas.toDataURL('image/png'), `第 ${pageNumber} 页`);
    });
    scroll.appendChild(wrapper);
    await page.render({ canvasContext: context, viewport }).promise;
    pageNodes.push(wrapper);
  }
  readerState.pdfPageNodes = pageNodes;

  const startPage = Math.min(Math.max(book.progress?.page || 1, 1), pdf.numPages);
  if (pageNodes[startPage - 1]) {
    pageNodes[startPage - 1].scrollIntoView({ block: 'start' });
  }

  const observer = new IntersectionObserver((entries) => {
    const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!visible) return;
    const page = Number(visible.target.dataset.page);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      persistProgress({ mode: 'pdf', page, percent: page / pdf.numPages });
    }, 250);
    setStatus(`阅读中 · 第 ${page} / ${pdf.numPages} 页`);
  }, { root: scroll, threshold: [0.35, 0.6, 0.85] });

  pageNodes.forEach((node) => observer.observe(node));
  readerInstance = { destroy: () => observer.disconnect() };
  setStatus(`阅读中 · 第 ${startPage} / ${pdf.numPages} 页`);
}

async function persistProgress(progress) {
  if (!activeBook) {
    return;
  }
  const payload = { bookId: activeBook.id, progress };
  await ipcRenderer.invoke('library:saveProgress', payload);
  activeBook.progress = { ...progress };
  renderLibrary();
  renderRecent();
  renderBookmarks();
  renderAnnotationsList();
}

async function openBookmark(bookmarkId) {
  if (!activeBook) {
    return;
  }
  const bookmark = (activeBook.bookmarks || []).find((item) => item.id === bookmarkId);
  if (!bookmark) {
    return;
  }
  activeBook.progress = bookmark.progress;
  await renderReader(activeBook);
  renderBookmarks();
}

async function doSearch() {
  if (!activeBook) {
    return;
  }
  const query = els.searchBookInput.value.trim();
  if (!query) {
    els.searchResults.classList.remove('show');
    els.searchResults.innerHTML = '';
    return;
  }
  const results = await ipcRenderer.invoke('library:search', { bookId: activeBook.id, query });
  els.searchResults.innerHTML = results.length
    ? results.map((item) => `
        <button class="search-hit" data-search-index="${item.index}" data-search-total="${item.totalLength || 1}">
          <div class="name">${escapeHtml(query)}</div>
          <div class="meta">${escapeHtml(item.snippet)}</div>
        </button>
      `).join('')
    : '<div class="meta">没有找到匹配内容</div>';
  els.searchResults.classList.add('show');
  document.querySelectorAll('.search-hit').forEach((node) => {
    node.addEventListener('click', () => {
      jumpToSearchResult({
        index: Number(node.dataset.searchIndex || 0),
        totalLength: Number(node.dataset.searchTotal || 1),
      });
    });
  });
}

async function addBookmark() {
  if (!activeBook) {
    return;
  }
  const bookmark = await ipcRenderer.invoke('library:addBookmark', {
    bookId: activeBook.id,
    label: `书签 ${new Date().toLocaleTimeString()}`,
    progress: activeBook.progress || null,
  });
  if (bookmark) {
    activeBook.bookmarks = [bookmark, ...(activeBook.bookmarks || [])];
    renderBookmarks();
    setStatus('书签已保存', '本地已保存');
  }
}

async function importBooks() {
  const result = await ipcRenderer.invoke('library:import');
  if (result.errors && result.errors.length) {
    setStatus(`导入完成，失败 ${result.errors.length} 个`, result.errors[0].message);
  } else if (result.books && result.books.length) {
    setStatus(`已导入 ${result.books.length} 本书`, '本地已保存');
  }
  await refreshLibrary();
  if (result.books && result.books[0]) {
    await selectBook(result.books[0].id);
  }
}

els.importBtn.addEventListener('click', importBooks);
els.readingStatsBtn.addEventListener('click', openReadingStatsPage);
els.searchLibrary.addEventListener('input', (event) => {
  state.searchFilter = event.target.value;
  renderLibrary();
});
els.searchBookBtn.addEventListener('click', doSearch);
els.searchBookInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    doSearch();
  }
});
els.tocBtn.addEventListener('click', () => {
  tocVisible = !tocVisible;
  syncTocVisibility();
});
els.tocFoldBtn.addEventListener('click', () => {
  tocCollapsed = !tocCollapsed;
  syncTocFoldMode();
  if (readerOpened && activeBook) {
    renderReaderSidebar();
  }
});
els.bookmarkBtn.addEventListener('click', addBookmark);
els.notesBtn.addEventListener('click', openNotesPage);
els.reviewBtn.addEventListener('click', openReviewPage);
els.immersiveBtn.addEventListener('click', () => {
  immersiveMode = !immersiveMode;
  syncImmersiveMode();
});
els.zoomOutBtn.addEventListener('click', () => applyZoom(readerZoom - 0.1));
els.zoomResetBtn.addEventListener('click', () => applyZoom(1));
els.zoomInBtn.addEventListener('click', () => applyZoom(readerZoom + 0.1));
els.highlightSelectionBtn.addEventListener('click', () => saveSelectionAnnotation('highlight'));
els.noteSelectionBtn.addEventListener('click', openNoteEditor);
els.cancelSelectionBtn.addEventListener('click', hideSelectionUi);
els.openReaderBtn.addEventListener('click', openReader);
els.saveNoteBtn.addEventListener('click', async () => {
  noteDraft = els.noteInput.value.trim();
  await saveSelectionAnnotation('note', noteDraft);
});
els.closeNoteBtn.addEventListener('click', hideSelectionUi);
els.noteModal.addEventListener('click', (event) => {
  if (event.target === els.noteModal) {
    hideSelectionUi();
  }
});
els.closeNotesBtn.addEventListener('click', closeNotesPage);
els.notesSearchInput.addEventListener('input', (event) => {
  notesSearchQuery = event.target.value;
  renderNotesPage();
});
els.saveNoteDetailBtn.addEventListener('click', saveSelectedNote);
els.deleteNoteBtn.addEventListener('click', deleteSelectedNote);
els.jumpNoteBtn.addEventListener('click', jumpSelectedNote);
els.notesModal.addEventListener('click', (event) => {
  if (event.target === els.notesModal) {
    closeNotesPage();
  }
});
els.closeReviewBtn.addEventListener('click', closeReviewPage);
els.saveReviewBtn.addEventListener('click', () => saveReview(false));
els.reviewInput.addEventListener('input', scheduleReviewSave);
els.reviewModal.addEventListener('click', (event) => {
  if (event.target === els.reviewModal) {
    closeReviewPage();
  }
});
els.closeReadingStatsBtn.addEventListener('click', closeReadingStatsPage);
els.readingStatsDate.addEventListener('input', renderReadingStatsPage);
els.readingStatsModal.addEventListener('click', (event) => {
  if (event.target === els.readingStatsModal) {
    closeReadingStatsPage();
  }
});
els.imageZoomModal.addEventListener('click', (event) => {
  if (event.target === els.imageZoomModal || event.target === event.currentTarget || event.target.classList.contains('image-zoom-backdrop')) {
    hideImageZoom();
  }
});
els.closeImageZoomBtn.addEventListener('click', hideImageZoom);
els.backDetailBtn.addEventListener('click', async () => {
  await stopReadingTimer();
  readerOpened = false;
  syncModeUI();
  renderReaderSidebar();
  renderBookDetail();
  setStatus(`已返回详情：${activeBook?.title || activeBook?.originalName || '未命名'}`, '点击阅读进入正文');
});
els.fontMinusBtn.addEventListener('click', () => {
  fontSize = Math.max(14, fontSize - 1);
  saveFontSize();
  if (activeBook) {
    renderReader(activeBook);
  }
});
els.fontPlusBtn.addEventListener('click', () => {
  fontSize = Math.min(30, fontSize + 1);
  saveFontSize();
  if (activeBook) {
    renderReader(activeBook);
  }
});
els.themeBtn.addEventListener('click', () => {
  currentTheme = currentTheme === 'light' ? 'dark' : 'light';
  saveTheme();
  loadTheme();
  if (activeBook) {
    renderReader(activeBook);
  }
});
els.fishModeBtn.addEventListener('click', toggleFishMode);
els.menuToggleBtn.addEventListener('click', toggleTopChrome);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    hideSelectionUi();
    els.searchResults.classList.remove('show');
    closeNotesPage();
    closeReviewPage();
    closeReadingStatsPage();
    hideImageZoom();
    if (immersiveMode) {
      immersiveMode = false;
      syncImmersiveMode();
    }
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
    event.preventDefault();
    els.searchBookInput.focus();
  }
  if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'm') {
    event.preventDefault();
    toggleFishMode();
  }
  if (event.key === 'F11') {
    event.preventDefault();
    immersiveMode = !immersiveMode;
    syncImmersiveMode();
  }
  if ((event.ctrlKey || event.metaKey) && event.key === '0') {
    event.preventDefault();
    applyZoom(1);
  }
  if ((event.ctrlKey || event.metaKey) && event.key === '=' ) {
    event.preventDefault();
    applyZoom(readerZoom + 0.1);
  }
  if ((event.ctrlKey || event.metaKey) && event.key === '-') {
    event.preventDefault();
    applyZoom(readerZoom - 0.1);
  }
});
window.addEventListener('focus', () => {
  windowFocused = true;
  readingTickAt = Date.now();
});
window.addEventListener('blur', () => {
  windowFocused = false;
  flushReadingTime();
});
document.addEventListener('visibilitychange', () => {
  readingTickAt = Date.now();
  if (document.hidden) {
    flushReadingTime();
  }
});
window.addEventListener('beforeunload', () => {
  flushReadingTime();
});

loadTheme();
syncFishModeUI();
syncTopChromeUI();
syncTocVisibility();
syncTocFoldMode();
renderBookDetail();
syncModeUI();
syncImmersiveMode();
els.zoomResetBtn.textContent = '100%';
setStatus('就绪');
refreshLibrary();

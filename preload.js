const { contextBridge, ipcRenderer } = require('electron');

const allowedChannels = new Set([
  'library:get',
  'library:import',
  'library:open',
  'library:saveProgress',
  'library:addBookmark',
  'library:deleteBookmark',
  'library:saveReview',
  'library:addReadingTime',
  'library:deleteBook',
  'library:listAnnotations',
  'library:addAnnotation',
  'library:updateAnnotation',
  'library:deleteAnnotation',
  'library:search',
  'library:readText',
  'library:readSearchText',
  'library:readBinary',
  'library:state',
]);

function extname(value) {
  const name = String(value || '').replace(/\\/g, '/').split('/').pop() || '';
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : '';
}

function toFileUrl(value) {
  const normalized = String(value || '').replace(/\\/g, '/');
  const match = normalized.match(/^([A-Za-z]:)(\/.*)?$/);
  if (match) {
    const suffix = (match[2] || '').split('/').map((part) => encodeURIComponent(part)).join('/');
    return `file:///${match[1]}${suffix}`;
  }
  return `file://${normalized.split('/').map((part) => encodeURIComponent(part)).join('/')}`;
}

function cleanFileName(name) {
  return String(name || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim();
}

function formatProgress(book) {
  if (!book?.progress) return '0%';
  if (typeof book.progress.percent === 'number') return `${Math.round(book.progress.percent * 100)}%`;
  if (typeof book.progress.page === 'number' && book.pageCount) return `${Math.round((book.progress.page / book.pageCount) * 100)}%`;
  return '已保存';
}

function escapeHtml(text) {
  return String(text || '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
}

contextBridge.exposeInMainWorld('readerApi', {
  invoke(channel, payload) {
    if (!allowedChannels.has(channel)) {
      return Promise.reject(new Error(`IPC channel is not allowed: ${channel}`));
    }
    return ipcRenderer.invoke(channel, payload);
  },
  extname,
  toFileUrl,
  cleanFileName,
  formatProgress,
  escapeHtml,
});

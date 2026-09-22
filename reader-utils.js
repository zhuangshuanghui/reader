const path = require('path');

function cleanFileName(name) {
  return String(name || '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
}

function getExtension(filePath) {
  return path.extname(String(filePath || '')).slice(1).toLowerCase();
}

function decodeBasicEntities(text) {
  return String(text || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function cleanTocHref(href) {
  return String(href || '').split('#')[0].trim();
}

function decodeXmlText(text) {
  return decodeBasicEntities(String(text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function parseNcxToc(ncxText) {
  const toc = [];
  const navPointRegex = /<navPoint\b[\s\S]*?<navLabel>[\s\S]*?<text>([\s\S]*?)<\/text>[\s\S]*?<content\s+src="([^"]+)"[^>]*>[\s\S]*?<\/navPoint>/gi;
  let match;
  while ((match = navPointRegex.exec(ncxText))) {
    const label = decodeXmlText(match[1]);
    const href = cleanTocHref(match[2]);
    if (label && href) {
      toc.push({ label, href, level: 0 });
    }
  }
  return toc;
}

function formatProgress(book) {
  if (!book || !book.progress) {
    return '0%';
  }
  if (typeof book.progress.percent === 'number') {
    return `${Math.round(book.progress.percent * 100)}%`;
  }
  if (typeof book.progress.page === 'number' && book.pageCount) {
    return `${Math.round((book.progress.page / book.pageCount) * 100)}%`;
  }
  return '已保存';
}

function escapeHtml(text) {
  return String(text || '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
}

module.exports = {
  cleanFileName,
  getExtension,
  decodeBasicEntities,
  cleanTocHref,
  decodeXmlText,
  parseNcxToc,
  formatProgress,
  escapeHtml,
};

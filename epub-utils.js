const path = require('path');

const { cleanTocHref, decodeBasicEntities, decodeXmlText, parseNcxToc } = require('./reader-utils');

function extractEpubMetadataFromOpf(opfText) {
  const titleMatch = String(opfText || '').match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i);
  const authorMatch = String(opfText || '').match(/<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i);
  return {
    title: titleMatch ? decodeBasicEntities(titleMatch[1].trim()) : '',
    author: authorMatch ? decodeBasicEntities(authorMatch[1].trim()) : '',
  };
}

function extractCoverHrefFromOpf(opfText) {
  const opf = String(opfText || '');
  const coverItemMatch = opf.match(/<item[^>]*properties="cover-image"[^>]*href="([^"]+)"/i);
  if (coverItemMatch) {
    return coverItemMatch[1];
  }

  const metaCoverMatch = opf.match(/<meta[^>]*name="cover"[^>]*content="([^"]+)"/i);
  if (metaCoverMatch) {
    const coverId = metaCoverMatch[1];
    const itemMatch = opf.match(new RegExp(`<item[^>]*id="${coverId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*href="([^"]+)"`, 'i'));
    if (itemMatch) {
      return itemMatch[1];
    }
  }

  return '';
}

function parseManifest(opfText) {
  const manifest = new Map();
  const manifestRegex = /<item\b([^>]*)>/gi;
  const opf = String(opfText || '');
  let manifestMatch;
  while ((manifestMatch = manifestRegex.exec(opf))) {
    const fullTag = manifestMatch[1] || '';
    const idMatch = fullTag.match(/\bid="([^"]+)"/i);
    const hrefMatch = fullTag.match(/\bhref="([^"]+)"/i);
    if (!idMatch || !hrefMatch) {
      continue;
    }
    manifest.set(idMatch[1], {
      href: hrefMatch[1],
      tag: fullTag,
    });
  }
  return manifest;
}

function extractNavTocFromHtml(navText) {
  const sourceText = String(navText || '');
  const navSectionMatch = sourceText.match(/<nav[^>]*epub:type="toc"[^>]*>([\s\S]*?)<\/nav>/i) || sourceText.match(/<nav[^>]*type="toc"[^>]*>([\s\S]*?)<\/nav>/i);
  const source = navSectionMatch ? navSectionMatch[1] : sourceText;
  const toc = [];
  const linkRegex = /<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let linkMatch;
  while ((linkMatch = linkRegex.exec(source))) {
    const label = decodeXmlText(linkMatch[2]);
    const href = cleanTocHref(linkMatch[1]);
    if (href && label) {
      toc.push({ label, href, level: 0 });
    }
  }
  return toc;
}

function extractFallbackTocFromOpf(opfText, opfPath = '') {
  const opf = String(opfText || '');
  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const manifest = parseManifest(opf);
  const spineRefs = [...opf.matchAll(/<itemref\b[^>]*idref="([^"]+)"[^>]*>/gi)].map((match) => match[1]);
  const toc = [];
  for (const idref of spineRefs) {
    const item = manifest.get(idref);
    if (!item || !item.href) {
      continue;
    }
    const href = cleanTocHref(path.posix.normalize(path.posix.join(opfDir, item.href)));
    const fallbackLabel = path.posix.basename(item.href, path.posix.extname(item.href)) || '章节';
    toc.push({ label: fallbackLabel, href, level: 0 });
  }
  return toc;
}

function extractTocFromNcx(ncxText) {
  return parseNcxToc(ncxText);
}

module.exports = {
  extractEpubMetadataFromOpf,
  extractCoverHrefFromOpf,
  parseManifest,
  extractNavTocFromHtml,
  extractFallbackTocFromOpf,
  extractTocFromNcx,
};

const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const iconv = require('iconv-lite');
const JSZip = require('jszip');
const { htmlToText } = require('html-to-text');
const { cleanFileName, getExtension, parseNcxToc } = require('./reader-utils');
const { extractEpubMetadataFromOpf, extractCoverHrefFromOpf, parseManifest, extractNavTocFromHtml, extractFallbackTocFromOpf } = require('./epub-utils');
const { decodeTextBytes } = require('./text-utils');
const { relocateBookPaths, toPortableState } = require('./storage-utils');
const { createReadingStats, ensureReadingStats, signReadingStats } = require('./reading-stats');

let mainWindow;
let state;
let storageRoot;
let libraryRoot;
let statePath;

const TEXT_EXTENSIONS = new Set(['txt', 'md', 'text']);
const EPUB_EXTENSIONS = new Set(['epub']);
const PDF_EXTENSIONS = new Set(['pdf']);
const MOBI_EXTENSIONS = new Set(['mobi', 'azw3']);

function uid() {
  return crypto.randomUUID();
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function defaultState() {
  return { books: [] };
}

function normalizeLoadedState(parsed) {
  const books = Array.isArray(parsed.books) ? parsed.books : [];
  books.forEach((book) => ensureReadingStats(book));
  return { books };
}

function isSamePath(left, right) {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

function rebaseStoredPath(value, fromRoot, toRoot) {
  if (typeof value !== 'string' || !value) {
    return value;
  }

  const normalizedValue = path.normalize(value);
  const normalizedFrom = path.normalize(fromRoot);
  const lowerValue = normalizedValue.toLowerCase();
  const lowerFrom = normalizedFrom.toLowerCase();
  if (lowerValue === lowerFrom) {
    return toRoot;
  }
  if (lowerValue.startsWith(`${lowerFrom}${path.sep}`)) {
    return path.join(toRoot, normalizedValue.slice(normalizedFrom.length + 1));
  }
  return value;
}

function rebaseStatePaths(value, fromRoot, toRoot) {
  if (Array.isArray(value)) {
    return value.map((item) => rebaseStatePaths(item, fromRoot, toRoot));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rebaseStatePaths(item, fromRoot, toRoot)]));
  }
  return rebaseStoredPath(value, fromRoot, toRoot);
}

async function migrateLegacyStorage(legacyRoot, portableRoot) {
  if (isSamePath(legacyRoot, portableRoot)) {
    return;
  }

  const legacyStatePath = path.join(legacyRoot, 'state.json');
  const portableStatePath = path.join(portableRoot, 'state.json');
  if (!fs.existsSync(legacyStatePath) || fs.existsSync(portableStatePath)) {
    return;
  }

  await fsp.cp(legacyRoot, portableRoot, { recursive: true, force: false, errorOnExist: false });
  try {
    const raw = await fsp.readFile(portableStatePath, 'utf8');
    const migrated = rebaseStatePaths(JSON.parse(raw), legacyRoot, portableRoot);
    await fsp.writeFile(portableStatePath, JSON.stringify(migrated, null, 2), 'utf8');
  } catch {
    // Keep the copied files even if state path rebasing fails; loadState will fall back safely.
  }
}

async function loadState() {
  try {
    const raw = await fsp.readFile(statePath, 'utf8');
    const parsed = JSON.parse(raw);
    return normalizeLoadedState(parsed);
  } catch {
    return defaultState();
  }
}

async function saveState() {
  await fsp.writeFile(statePath, JSON.stringify(toPortableState(state, storageRoot), null, 2), 'utf8');
}

function findBook(bookId) {
  return state.books.find((book) => book.id === bookId);
}

function recentBooks() {
  return [...state.books].sort((a, b) => new Date(b.lastOpenedAt || b.addedAt) - new Date(a.lastOpenedAt || a.addedAt));
}

async function readTextFile(filePath) {
  const bytes = await fsp.readFile(filePath);
  return decodeTextBytes(bytes);
}

async function copyFileToLibrary(sourcePath, bookId, targetName) {
  const bookDir = path.join(libraryRoot, bookId);
  ensureDir(bookDir);
  const destPath = path.join(bookDir, targetName);
  await fsp.copyFile(sourcePath, destPath);
  return destPath;
}

async function extractEpubText(filePath) {
  const buffer = await fsp.readFile(filePath);
  const zip = await JSZip.loadAsync(buffer);
  const containerXml = await zip.file('META-INF/container.xml')?.async('text');
  let opfPath = '';
  if (containerXml) {
    const rootfileMatch = containerXml.match(/full-path="([^"]+)"/i);
    if (rootfileMatch) {
      opfPath = rootfileMatch[1];
    }
  }
  if (!opfPath) {
    const opfEntry = Object.values(zip.files).find((entry) => !entry.dir && entry.name.toLowerCase().endsWith('.opf'));
    if (opfEntry) {
      opfPath = opfEntry.name;
    }
  }

  let entries = [];
  if (opfPath && zip.file(opfPath)) {
    const opf = await zip.file(opfPath).async('text');
    const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
    const manifest = new Map();
    const manifestRegex = /<item\b([^>]*)>/gi;
    let manifestMatch;
    while ((manifestMatch = manifestRegex.exec(opf))) {
      const fullTag = manifestMatch[1] || '';
      const idMatch = fullTag.match(/\bid="([^"]+)"/i);
      const hrefMatch = fullTag.match(/\bhref="([^"]+)"/i);
      if (!idMatch || !hrefMatch) {
        continue;
      }
      manifest.set(idMatch[1], hrefMatch[1]);
    }

    const spineRefs = [...opf.matchAll(/<itemref\b[^>]*idref="([^"]+)"[^>]*>/gi)].map((match) => match[1]);
    const seen = new Set();
    for (const idref of spineRefs) {
      const href = manifest.get(idref);
      if (!href) {
        continue;
      }
      const entryName = path.posix.normalize(path.posix.join(opfDir, href));
      if (seen.has(entryName)) {
        continue;
      }
      seen.add(entryName);
      if (zip.file(entryName)) {
        entries.push(entryName);
      }
    }
  }

  if (!entries.length) {
    entries = Object.values(zip.files)
      .filter((entry) => !entry.dir && /\.(x?html?|xml)$/i.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  }

  const chunks = [];
  for (const entryName of entries) {
    const content = await zip.file(entryName).async('text');
    const text = htmlToText(content, {
      wordwrap: false,
      selectors: [
        { selector: 'img', format: 'skip' },
        { selector: 'a', options: { ignoreHref: true } },
      ],
    });
    if (text.trim()) {
      chunks.push(text.trim());
    }
  }
  return chunks.join('\n\n');
}

async function extractEpubMetadata(filePath) {
  try {
    const buffer = await fsp.readFile(filePath);
    const zip = await JSZip.loadAsync(buffer);
    const containerXml = await zip.file('META-INF/container.xml')?.async('text');
    let opfPath = '';
    if (containerXml) {
      const rootfileMatch = containerXml.match(/full-path="([^"]+)"/i);
      if (rootfileMatch) {
        opfPath = rootfileMatch[1];
      }
    }
    if (!opfPath) {
      const opfEntry = Object.values(zip.files).find((entry) => !entry.dir && entry.name.toLowerCase().endsWith('.opf'));
      if (opfEntry) {
        opfPath = opfEntry.name;
      }
    }
    if (!opfPath || !zip.file(opfPath)) {
      return {};
    }
    const opf = await zip.file(opfPath).async('text');
    return extractEpubMetadataFromOpf(opf);
  } catch {
    return {};
  }
}

async function zipEntryText(entry) {
  const buffer = await entry.async('nodebuffer');
  const utf8Text = iconv.decode(buffer, 'utf8');
  if (utf8Text && utf8Text.includes('<')) {
    return utf8Text;
  }
  const gbText = iconv.decode(buffer, 'gb18030');
  if (gbText && gbText.includes('<')) {
    return gbText;
  }
  return utf8Text || gbText || '';
}

async function extractEpubToc(filePath) {
  try {
    const buffer = await fsp.readFile(filePath);
    const zip = await JSZip.loadAsync(buffer);
    const containerXml = await zip.file('META-INF/container.xml')?.async('text');
    let opfPath = '';
    if (containerXml) {
      const rootfileMatch = containerXml.match(/full-path="([^"]+)"/i);
      if (rootfileMatch) {
        opfPath = rootfileMatch[1];
      }
    }
    if (!opfPath) {
      const opfEntry = Object.values(zip.files).find((entry) => !entry.dir && entry.name.toLowerCase().endsWith('.opf'));
      if (opfEntry) {
        opfPath = opfEntry.name;
      }
    }
    if (!opfPath || !zip.file(opfPath)) {
      return [];
    }

    const opf = await zip.file(opfPath).async('text');
    const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';

    const ncxMatch = opf.match(/<item\b[^>]*href="([^"]+\.ncx)"[^>]*>/i);
    if (ncxMatch) {
      const ncxPath = path.posix.normalize(path.posix.join(opfDir, ncxMatch[1]));
      const ncxEntry = zip.file(ncxPath) || zip.file(ncxMatch[1]);
      if (ncxEntry) {
        const ncxText = await zipEntryText(ncxEntry);
        const toc = parseNcxToc(ncxText);
        if (toc.length) {
          return toc;
        }
      }
    }

    const manifest = parseManifest(opf);

    const toc = [];
    const navItem = [...manifest.entries()].find(([, value]) => /properties="[^"]*nav[^"]*"/i.test(value.tag));
    if (navItem) {
      const navPath = path.posix.normalize(path.posix.join(opfDir, navItem[1].href));
      const navEntry = zip.file(navPath) || zip.file(navItem[1].href);
      if (navEntry) {
        const navText = await zipEntryText(navEntry);
        toc.push(...extractNavTocFromHtml(navText));
      }
    }

    if (toc.length) {
      return toc;
    }

    return extractFallbackTocFromOpf(opf, opfPath);
  } catch {
    return [];
  }
}

async function extractEpubCover(filePath, bookDir) {
  try {
    const buffer = await fsp.readFile(filePath);
    const zip = await JSZip.loadAsync(buffer);
    const containerXml = await zip.file('META-INF/container.xml')?.async('text');
    let opfPath = '';
    if (containerXml) {
      const rootfileMatch = containerXml.match(/full-path="([^"]+)"/i);
      if (rootfileMatch) {
        opfPath = rootfileMatch[1];
      }
    }
    if (!opfPath) {
      const opfEntry = Object.values(zip.files).find((entry) => !entry.dir && entry.name.toLowerCase().endsWith('.opf'));
      if (opfEntry) {
        opfPath = opfEntry.name;
      }
    }
    if (!opfPath || !zip.file(opfPath)) {
      return '';
    }

    const opf = await zip.file(opfPath).async('text');
    const coverAssetHref = extractCoverHrefFromOpf(opf);

    if (!coverAssetHref) {
      return '';
    }

    const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
    const normalized = path.posix.normalize(path.posix.join(opfDir, coverAssetHref));
    const coverEntry = zip.file(normalized) || zip.file(coverAssetHref) || zip.file(coverAssetHref.replace(/\\/g, '/'));
    if (!coverEntry) {
      return '';
    }

    const ext = path.extname(normalized || coverAssetHref) || '.jpg';
    const coverTarget = path.join(bookDir, `cover${ext}`);
    const content = await coverEntry.async('nodebuffer');
    await fsp.writeFile(coverTarget, content);
    return coverTarget;
  } catch {
    return '';
  }
}

async function extractPdfText(filePath) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(await fsp.readFile(filePath));
  const document = await pdfjs.getDocument({ data, disableWorker: true }).promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const text = textContent.items.map((item) => item.str).join(' ');
    if (text.trim()) {
      pages.push(`Page ${pageNumber}\n${text.trim()}`);
    }
  }
  return pages.join('\n\n');
}

async function extractPdfMetadata(filePath) {
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const data = new Uint8Array(await fsp.readFile(filePath));
    const document = await pdfjs.getDocument({ data, disableWorker: true }).promise;
    const metadata = await document.getMetadata();
    const info = metadata?.info || {};
    return {
      title: info.Title || '',
      author: info.Author || '',
    };
  } catch {
    return {};
  }
}

async function listBookAnnotations(bookId) {
  const book = findBook(bookId);
  return book ? (Array.isArray(book.annotations) ? book.annotations : []) : [];
}

async function addBookAnnotation(payload) {
  const book = findBook(payload.bookId);
  if (!book) {
    return null;
  }

  const annotation = {
    id: uid(),
    type: payload.type || 'highlight',
    anchor: payload.anchor || {},
    excerpt: payload.excerpt || '',
    note: payload.note || '',
    chapter: payload.chapter || '',
    createdAt: new Date().toISOString(),
  };

  book.annotations = Array.isArray(book.annotations) ? [annotation, ...book.annotations] : [annotation];
  await saveState();
  return annotation;
}

async function deleteBookAnnotation(payload) {
  const book = findBook(payload.bookId);
  if (!book) {
    return null;
  }
  book.annotations = (book.annotations || []).filter((item) => item.id !== payload.annotationId);
  await saveState();
  return true;
}

async function updateBookAnnotation(payload) {
  const book = findBook(payload.bookId);
  if (!book) {
    return null;
  }

  const annotation = (book.annotations || []).find((item) => item.id === payload.annotationId);
  if (!annotation) {
    return null;
  }

  if (typeof payload.note === 'string') {
    annotation.note = payload.note;
  }
  if (typeof payload.excerpt === 'string') {
    annotation.excerpt = payload.excerpt;
  }
  if (typeof payload.chapter === 'string') {
    annotation.chapter = payload.chapter;
  }
  annotation.updatedAt = new Date().toISOString();
  await saveState();
  return annotation;
}

async function deleteBook(bookId) {
  const index = state.books.findIndex((book) => book.id === bookId);
  if (index < 0) {
    return false;
  }

  const [book] = state.books.splice(index, 1);
  const bookDir = path.join(libraryRoot, book.id);
  try {
    await fsp.rm(bookDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup failures
  }
  await saveState();
  return !!book;
}

async function ensureEpubMetadata(book) {
  if (!book || book.format !== 'epub' || (Array.isArray(book.toc) && book.toc.length)) {
    return book;
  }

  const bookDir = path.dirname(book.entryPath || book.sourcePath || '');
  if (!bookDir) {
    return book;
  }

  const metadata = await extractEpubMetadata(book.entryPath);
  const coverPath = await extractEpubCover(book.entryPath, bookDir);
  const toc = await extractEpubToc(book.entryPath);
  if (metadata.title) {
    book.title = metadata.title;
  }
  if (metadata.author) {
    book.author = metadata.author;
  }
  if (coverPath) {
    book.coverPath = coverPath;
  }
  if (toc.length) {
    book.toc = toc;
  }
  await saveState();
  return book;
}

function pythonExecutable() {
  return process.env.PYTHON || process.env.PYTHON_EXECUTABLE || 'python';
}

async function extractMobiAsset(sourcePath, bookDir) {
  const helper = path.join(__dirname, 'python', 'mobi_extract.py');
  const extractedDir = path.join(bookDir, 'extracted');
  ensureDir(extractedDir);

  return await new Promise((resolve, reject) => {
    const child = spawn(pythonExecutable(), [helper, sourcePath, extractedDir], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `MOBI extraction failed with code ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch (error) {
        reject(new Error(`Failed to parse MOBI helper output: ${error.message}`));
      }
    });
  });
}

async function buildBookRecord(sourcePath) {
  const ext = getExtension(sourcePath);
  const bookId = uid();
  const safeBase = cleanFileName(path.basename(sourcePath, path.extname(sourcePath))) || 'book';
  const sourceName = `${safeBase}${path.extname(sourcePath).toLowerCase()}`;
  const bookDir = path.join(libraryRoot, bookId);
  ensureDir(bookDir);

  const record = {
    id: bookId,
    title: safeBase,
    author: '',
    originalName: path.basename(sourcePath),
    sourceName,
    sourcePath: '',
    entryPath: '',
    format: ext,
    addedAt: new Date().toISOString(),
    lastOpenedAt: null,
    progress: null,
    bookmarks: [],
    annotations: [],
    review: null,
    readingStats: createReadingStats(bookId),
    coverPath: '',
    searchTextPath: '',
  };

  const copiedSourcePath = await copyFileToLibrary(sourcePath, bookId, sourceName);
  record.sourcePath = copiedSourcePath;
  const normalizedExt = ext.toLowerCase();

  if (TEXT_EXTENSIONS.has(normalizedExt)) {
    record.entryPath = copiedSourcePath;
    record.format = 'txt';
    const text = await readTextFile(copiedSourcePath);
    record.searchTextPath = path.join(bookDir, 'search.txt');
    await fsp.writeFile(record.searchTextPath, text, 'utf8');
  } else if (EPUB_EXTENSIONS.has(normalizedExt)) {
    record.entryPath = copiedSourcePath;
    record.format = 'epub';
    const metadata = await extractEpubMetadata(copiedSourcePath);
    record.title = metadata.title || record.title;
    record.author = metadata.author || record.author;
    record.coverPath = await extractEpubCover(copiedSourcePath, bookDir);
    record.toc = await extractEpubToc(copiedSourcePath);
    const text = await extractEpubText(copiedSourcePath);
    record.searchTextPath = path.join(bookDir, 'search.txt');
    await fsp.writeFile(record.searchTextPath, text, 'utf8');
  } else if (PDF_EXTENSIONS.has(normalizedExt)) {
    record.entryPath = copiedSourcePath;
    record.format = 'pdf';
    const metadata = await extractPdfMetadata(copiedSourcePath);
    record.title = metadata.title || record.title;
    record.author = metadata.author || record.author;
    const text = await extractPdfText(copiedSourcePath);
    record.searchTextPath = path.join(bookDir, 'search.txt');
    await fsp.writeFile(record.searchTextPath, text, 'utf8');
  } else if (MOBI_EXTENSIONS.has(normalizedExt)) {
    const result = await extractMobiAsset(copiedSourcePath, bookDir);
    record.format = result.format || normalizedExt;
    record.entryPath = path.join(bookDir, result.entryPath);
    record.searchTextPath = path.join(bookDir, 'search.txt');
    const entryExt = getExtension(record.entryPath);
    if (entryExt === 'epub') {
      const metadata = await extractEpubMetadata(record.entryPath);
      record.title = metadata.title || record.title;
      record.author = metadata.author || record.author;
      record.coverPath = await extractEpubCover(record.entryPath, bookDir);
      record.toc = await extractEpubToc(record.entryPath);
      const text = await extractEpubText(record.entryPath);
      await fsp.writeFile(record.searchTextPath, text, 'utf8');
    } else if (entryExt === 'html' || entryExt === 'htm') {
      const text = await readTextFile(record.entryPath);
      await fsp.writeFile(record.searchTextPath, htmlToText(text, { wordwrap: false }), 'utf8');
    } else if (entryExt === 'pdf') {
      const text = await extractPdfText(record.entryPath);
      await fsp.writeFile(record.searchTextPath, text, 'utf8');
    }
  } else {
    throw new Error(`Unsupported file type: ${ext}`);
  }

  return record;
}

function upsertBook(record) {
  const index = state.books.findIndex((book) => book.id === record.id);
  if (index >= 0) {
    state.books[index] = record;
  } else {
    state.books.unshift(record);
  }
}

async function importBooks() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '导入书籍',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Books', extensions: ['epub', 'pdf', 'txt', 'mobi', 'azw3'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePaths.length) {
    return { books: [], errors: [] };
  }

  const books = [];
  const errors = [];
  for (const filePath of result.filePaths) {
    try {
      const record = await buildBookRecord(filePath);
      upsertBook(record);
      books.push(record);
    } catch (error) {
      errors.push({ filePath, message: error.message });
    }
  }
  await saveState();
  return { books, errors };
}

async function openBook(bookId) {
  const book = findBook(bookId);
  if (!book) {
    return null;
  }
  await ensureEpubMetadata(book);
  book.lastOpenedAt = new Date().toISOString();
  await saveState();
  return book;
}

async function saveProgress(payload) {
  const book = findBook(payload.bookId);
  if (!book) {
    return null;
  }
  book.progress = {
    ...payload.progress,
    updatedAt: new Date().toISOString(),
  };
  book.lastOpenedAt = new Date().toISOString();
  await saveState();
  return book.progress;
}

async function addBookmark(payload) {
  const book = findBook(payload.bookId);
  if (!book) {
    return null;
  }
  const bookmark = {
    id: uid(),
    label: payload.label || '书签',
    progress: payload.progress,
    createdAt: new Date().toISOString(),
  };
  book.bookmarks = Array.isArray(book.bookmarks) ? [bookmark, ...book.bookmarks] : [bookmark];
  await saveState();
  return bookmark;
}

async function deleteBookmark(payload) {
  const book = findBook(payload.bookId);
  if (!book) {
    return null;
  }
  book.bookmarks = (book.bookmarks || []).filter((item) => item.id !== payload.bookmarkId);
  await saveState();
  return true;
}

async function saveReview(payload) {
  const book = findBook(payload.bookId);
  if (!book) {
    return null;
  }

  const now = new Date().toISOString();
  const previous = book.review && typeof book.review === 'object' ? book.review : {};
  book.review = {
    content: String(payload.content || ''),
    createdAt: previous.createdAt || now,
    updatedAt: now,
  };
  await saveState();
  return book.review;
}

async function addReadingTime(payload) {
  const book = findBook(payload.bookId);
  if (!book) {
    return null;
  }

  const entries = Array.isArray(payload.entries)
    ? payload.entries
    : [{ date: payload.date, seconds: payload.seconds }];
  const stats = ensureReadingStats(book);
  let added = 0;
  for (const entry of entries) {
    const date = String(entry?.date || '');
    const seconds = Math.floor(Number(entry?.seconds || 0));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || seconds <= 0 || seconds > 300) {
      continue;
    }
    stats.daily[date] = Math.max(0, Math.floor(Number(stats.daily[date] || 0))) + seconds;
    stats.totalSeconds += seconds;
    added += seconds;
  }

  if (!added) {
    return stats;
  }
  stats.updatedAt = new Date().toISOString();
  stats.signature = signReadingStats(book.id, stats);
  book.lastOpenedAt = stats.updatedAt;
  await saveState();
  return stats;
}

async function searchBook(payload) {
  const book = findBook(payload.bookId);
  if (!book || !book.searchTextPath || !fs.existsSync(book.searchTextPath)) {
    return [];
  }
  const query = (payload.query || '').trim().toLowerCase();
  if (!query) {
    return [];
  }
  const text = await fsp.readFile(book.searchTextPath, 'utf8');
  const lower = text.toLowerCase();
  const results = [];
  let index = 0;
  while (results.length < 20) {
    index = lower.indexOf(query, index);
    if (index < 0) {
      break;
    }
    const start = Math.max(0, index - 80);
    const end = Math.min(text.length, index + query.length + 160);
    results.push({
      index,
      totalLength: text.length,
      format: book.format,
      snippet: text.slice(start, end).replace(/\s+/g, ' ').trim(),
    });
    index += query.length;
  }
  return results;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: '#0f1115',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(async () => {
  const legacyStorageRoot = path.join(app.getPath('userData'), 'local-reader');
  storageRoot = path.join(__dirname, 'data');
  libraryRoot = path.join(storageRoot, 'library');
  statePath = path.join(storageRoot, 'state.json');
  await migrateLegacyStorage(legacyStorageRoot, storageRoot);
  ensureDir(storageRoot);
  ensureDir(libraryRoot);
  state = await loadState();
  if (relocateBookPaths(state.books, libraryRoot)) {
    await saveState();
  }

  ipcMain.handle('library:get', async () => ({ books: recentBooks() }));
  ipcMain.handle('library:import', async () => importBooks());
  ipcMain.handle('library:open', async (_event, bookId) => openBook(bookId));
  ipcMain.handle('library:saveProgress', async (_event, payload) => saveProgress(payload));
  ipcMain.handle('library:addBookmark', async (_event, payload) => addBookmark(payload));
  ipcMain.handle('library:deleteBookmark', async (_event, payload) => deleteBookmark(payload));
  ipcMain.handle('library:saveReview', async (_event, payload) => saveReview(payload));
  ipcMain.handle('library:addReadingTime', async (_event, payload) => addReadingTime(payload));
  ipcMain.handle('library:deleteBook', async (_event, bookId) => deleteBook(bookId));
  ipcMain.handle('library:listAnnotations', async (_event, bookId) => listBookAnnotations(bookId));
  ipcMain.handle('library:addAnnotation', async (_event, payload) => addBookAnnotation(payload));
  ipcMain.handle('library:updateAnnotation', async (_event, payload) => updateBookAnnotation(payload));
  ipcMain.handle('library:deleteAnnotation', async (_event, payload) => deleteBookAnnotation(payload));
  ipcMain.handle('library:search', async (_event, payload) => searchBook(payload));
  ipcMain.handle('library:readText', async (_event, bookId) => {
    const book = findBook(bookId);
    if (!book || !book.entryPath) {
      return '';
    }
    return readTextFile(book.entryPath);
  });
  ipcMain.handle('library:readSearchText', async (_event, bookId) => {
    const book = findBook(bookId);
    if (!book) {
      return '';
    }
    if (book.searchTextPath && fs.existsSync(book.searchTextPath)) {
      return fsp.readFile(book.searchTextPath, 'utf8');
    }
    if (book.entryPath) {
      return readTextFile(book.entryPath);
    }
    return '';
  });
  ipcMain.handle('library:readBinary', async (_event, bookId) => {
    const book = findBook(bookId);
    if (!book || !book.entryPath) {
      return null;
    }
    return new Uint8Array(await fsp.readFile(book.entryPath));
  });
  ipcMain.handle('library:state', async () => state);

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  if (state) {
    await saveState();
  }
});

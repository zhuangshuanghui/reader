const path = require('path');

const BOOK_PATH_FIELDS = ['sourcePath', 'entryPath', 'coverPath', 'searchTextPath'];

function relocateLibraryPath(value, bookId, libraryRoot) {
  if (typeof value !== 'string' || !value || !bookId || !libraryRoot) {
    return value;
  }

  const parts = path.normalize(value).split(/[\\/]+/);
  const libraryIndex = parts.findLastIndex((part, index) => (
    part.toLowerCase() === 'library'
      && String(parts[index + 1] || '').toLowerCase() === String(bookId).toLowerCase()
  ));
  if (libraryIndex < 0) {
    return value;
  }

  const suffix = parts.slice(libraryIndex + 2);
  if (suffix.some((part) => part === '..')) {
    return value;
  }
  return path.join(libraryRoot, bookId, ...suffix);
}

function relocateBookPaths(books, libraryRoot) {
  let changed = false;
  for (const book of books || []) {
    for (const field of BOOK_PATH_FIELDS) {
      const relocated = relocateLibraryPath(book[field], book.id, libraryRoot);
      if (relocated !== book[field]) {
        book[field] = relocated;
        changed = true;
      }
    }
  }
  return changed;
}

module.exports = { relocateLibraryPath, relocateBookPaths };

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { relocateLibraryPath, relocateBookPaths } = require('../storage-utils');

test('relocateLibraryPath moves a stored book path to the current library', () => {
  const currentLibrary = path.join('D:', 'new-place', 'data', 'library');
  assert.equal(
    relocateLibraryPath('C:\\old-place\\data\\library\\book-1\\book.epub', 'book-1', currentLibrary),
    path.join(currentLibrary, 'book-1', 'book.epub'),
  );
});

test('relocateBookPaths updates supported fields and leaves unrelated paths alone', () => {
  const books = [{
    id: 'book-1',
    sourcePath: 'C:\\old\\library\\book-1\\book.epub',
    entryPath: 'C:\\old\\library\\book-1\\extracted\\book.html',
    coverPath: '',
    searchTextPath: 'C:\\old\\library\\book-1\\search.txt',
    externalPath: 'C:\\keep\\this.txt',
  }];
  const libraryRoot = path.join('D:', 'reader', 'data', 'library');

  assert.equal(relocateBookPaths(books, libraryRoot), true);
  assert.equal(books[0].entryPath, path.join(libraryRoot, 'book-1', 'extracted', 'book.html'));
  assert.equal(books[0].externalPath, 'C:\\keep\\this.txt');
  assert.equal(relocateBookPaths(books, libraryRoot), false);
});

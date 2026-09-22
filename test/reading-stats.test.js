const test = require('node:test');
const assert = require('node:assert/strict');

const { createReadingStats, ensureReadingStats, signReadingStats } = require('../reading-stats');

test('createReadingStats normalizes daily values and signs the result', () => {
  const stats = createReadingStats('book-1', {
    totalSeconds: 12.9,
    daily: { '2026-09-22': 8.8, invalid: 20 },
  });
  assert.equal(stats.totalSeconds, 12);
  assert.deepEqual(stats.daily, { '2026-09-22': 8 });
  assert.equal(stats.signature, signReadingStats('book-1', stats));
});

test('ensureReadingStats resets modified persisted statistics', () => {
  const book = { id: 'book-1', readingStats: createReadingStats('book-1', { totalSeconds: 20 }) };
  book.readingStats.totalSeconds = 999;
  const stats = ensureReadingStats(book);
  assert.equal(stats.totalSeconds, 0);
  assert.equal(stats.signature, signReadingStats('book-1', stats));
});

const crypto = require('crypto');

const READING_STATS_SALT = 'local-reader-reading-stats-v1';

function readingStatsPayload(stats) {
  const daily = stats && typeof stats.daily === 'object' && !Array.isArray(stats.daily) ? stats.daily : {};
  return JSON.stringify({
    totalSeconds: Math.max(0, Math.floor(Number(stats?.totalSeconds || 0))),
    daily: Object.fromEntries(Object.entries(daily).sort(([a], [b]) => a.localeCompare(b))),
    updatedAt: stats?.updatedAt || '',
  });
}

function signReadingStats(bookId, stats) {
  return crypto
    .createHash('sha256')
    .update(`${READING_STATS_SALT}:${bookId}:${readingStatsPayload(stats)}`)
    .digest('hex');
}

function createReadingStats(bookId, stats = {}) {
  const daily = stats && typeof stats.daily === 'object' && !Array.isArray(stats.daily) ? stats.daily : {};
  const normalizedDaily = {};
  for (const [date, seconds] of Object.entries(daily)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      normalizedDaily[date] = Math.max(0, Math.floor(Number(seconds || 0)));
    }
  }
  const normalized = {
    totalSeconds: Math.max(0, Math.floor(Number(stats.totalSeconds || 0))),
    daily: normalizedDaily,
    updatedAt: stats.updatedAt || '',
  };
  normalized.signature = signReadingStats(bookId, normalized);
  return normalized;
}

function ensureReadingStats(book) {
  if (!book) {
    return null;
  }
  if (!book.readingStats || book.readingStats.signature !== signReadingStats(book.id, book.readingStats)) {
    book.readingStats = createReadingStats(book.id);
  }
  return book.readingStats;
}

module.exports = { createReadingStats, ensureReadingStats, signReadingStats };

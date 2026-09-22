const iconv = require('iconv-lite');

function isReasonableDecodedText(text, bytes, encoding) {
  if (!text || !text.length || text.includes('\uFFFD')) {
    return false;
  }
  if (encoding === 'utf8') {
    return Buffer.compare(Buffer.from(text, 'utf8'), Buffer.from(bytes)) === 0;
  }
  return true;
}

function decodeTextBytes(bytes, encodings = ['utf8', 'gb18030', 'gbk', 'big5', 'latin1']) {
  for (const encoding of encodings) {
    try {
      const text = iconv.decode(bytes, encoding);
      if (isReasonableDecodedText(text, bytes, encoding)) {
        return text;
      }
    } catch {
      // try next
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

module.exports = { decodeTextBytes };

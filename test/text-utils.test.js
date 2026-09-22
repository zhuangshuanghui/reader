const test = require('node:test');
const assert = require('node:assert/strict');
const iconv = require('iconv-lite');

const { decodeTextBytes } = require('../text-utils');

test('decodeTextBytes keeps utf8 text intact', () => {
  const bytes = Buffer.from('Hello 本地阅读器', 'utf8');
  assert.equal(decodeTextBytes(bytes), 'Hello 本地阅读器');
});

test('decodeTextBytes decodes gb18030 text', () => {
  const bytes = iconv.encode('简体中文测试', 'gb18030');
  assert.equal(decodeTextBytes(bytes), '简体中文测试');
});

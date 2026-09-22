const test = require('node:test');
const assert = require('node:assert/strict');

const {
  cleanFileName,
  getExtension,
  decodeBasicEntities,
  cleanTocHref,
  decodeXmlText,
  parseNcxToc,
  formatProgress,
  escapeHtml,
} = require('../reader-utils');

test('cleanFileName normalizes invalid characters and whitespace', () => {
  assert.equal(cleanFileName('  书:名 / test *  '), '书_名 _ test _');
});

test('getExtension returns lower-cased extension', () => {
  assert.equal(getExtension('C:\\books\\Demo.EPUB'), 'epub');
  assert.equal(getExtension('.bashrc'), '');
});

test('decodeBasicEntities decodes common HTML entities', () => {
  assert.equal(decodeBasicEntities('&amp;&lt;&gt;&quot;&#39;'), '&<>"\'');
});

test('cleanTocHref strips fragments', () => {
  assert.equal(cleanTocHref('chapter01.xhtml#anchor'), 'chapter01.xhtml');
});

test('decodeXmlText strips tags and decodes entities', () => {
  assert.equal(decodeXmlText('  <b>第1章</b> &amp; <i>开始</i>  '), '第1章 & 开始');
});

test('parseNcxToc parses navPoint entries', () => {
  const toc = parseNcxToc(`
    <navMap>
      <navPoint id="navPoint-1">
        <navLabel><text>第一章</text></navLabel>
        <content src="chap1.xhtml#frag" />
      </navPoint>
      <navPoint id="navPoint-2">
        <navLabel><text>第二章</text></navLabel>
        <content src="chap2.xhtml" />
      </navPoint>
    </navMap>
  `);

  assert.deepEqual(toc, [
    { label: '第一章', href: 'chap1.xhtml', level: 0 },
    { label: '第二章', href: 'chap2.xhtml', level: 0 },
  ]);
});

test('formatProgress handles different progress shapes', () => {
  assert.equal(formatProgress(null), '0%');
  assert.equal(formatProgress({ progress: { percent: 0.42 } }), '42%');
  assert.equal(formatProgress({ progress: { page: 10 }, pageCount: 40 }), '25%');
  assert.equal(formatProgress({ progress: { location: 'abc' } }), '已保存');
});

test('escapeHtml escapes risky characters', () => {
  assert.equal(escapeHtml('<a href="x">Tom & Jerry</a>'), '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&lt;/a&gt;');
});

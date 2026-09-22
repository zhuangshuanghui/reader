const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractEpubMetadataFromOpf,
  extractCoverHrefFromOpf,
  parseManifest,
  extractNavTocFromHtml,
  extractFallbackTocFromOpf,
} = require('../epub-utils');

test('extractEpubMetadataFromOpf reads title and author', () => {
  const opf = `
    <package>
      <metadata>
        <dc:title>测试 &amp; 验证</dc:title>
        <dc:creator>作者 &lt;A&gt;</dc:creator>
      </metadata>
    </package>
  `;

  assert.deepEqual(extractEpubMetadataFromOpf(opf), {
    title: '测试 & 验证',
    author: '作者 <A>',
  });
});

test('extractCoverHrefFromOpf supports cover-image and meta cover', () => {
  const coverImageOpf = `
    <package>
      <manifest>
        <item id="cover" properties="cover-image" href="images/cover.jpg" />
      </manifest>
    </package>
  `;
  const metaCoverOpf = `
    <package>
      <metadata><meta name="cover" content="cov-id" /></metadata>
      <manifest>
        <item id="cov-id" href="cover.png" />
      </manifest>
    </package>
  `;

  assert.equal(extractCoverHrefFromOpf(coverImageOpf), 'images/cover.jpg');
  assert.equal(extractCoverHrefFromOpf(metaCoverOpf), 'cover.png');
});

test('parseManifest collects ids and hrefs', () => {
  const manifest = parseManifest(`
    <manifest>
      <item id="chap1" href="Text/ch1.xhtml" properties="nav" />
      <item id="chap2" href="Text/ch2.xhtml" />
    </manifest>
  `);

  assert.equal(manifest.get('chap1').href, 'Text/ch1.xhtml');
  assert.equal(manifest.get('chap2').href, 'Text/ch2.xhtml');
});

test('extractNavTocFromHtml reads nav anchors', () => {
  const navHtml = `
    <html>
      <body>
        <nav epub:type="toc">
          <ol>
            <li><a href="Text/ch1.xhtml#top">第一章</a></li>
            <li><a href="Text/ch2.xhtml">第二章</a></li>
          </ol>
        </nav>
      </body>
    </html>
  `;

  assert.deepEqual(extractNavTocFromHtml(navHtml), [
    { label: '第一章', href: 'Text/ch1.xhtml', level: 0 },
    { label: '第二章', href: 'Text/ch2.xhtml', level: 0 },
  ]);
});

test('extractFallbackTocFromOpf uses spine order', () => {
  const opf = `
    <package>
      <manifest>
        <item id="chap1" href="Text/ch1.xhtml" />
        <item id="chap2" href="Text/ch2.xhtml" />
      </manifest>
      <spine>
        <itemref idref="chap1" />
        <itemref idref="chap2" />
      </spine>
    </package>
  `;

  assert.deepEqual(extractFallbackTocFromOpf(opf, 'OEBPS/content.opf'), [
    { label: 'ch1', href: 'OEBPS/Text/ch1.xhtml', level: 0 },
    { label: 'ch2', href: 'OEBPS/Text/ch2.xhtml', level: 0 },
  ]);
});

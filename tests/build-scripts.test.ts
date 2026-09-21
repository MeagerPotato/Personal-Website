import { describe, expect, it } from 'vitest';
import {
  canonicalUrl,
  cspHash,
  extractEagerScripts,
  extractInlineScripts,
  extractStaticImports,
  extractUrls,
  firstDifference,
  isPlainOnly,
  metaContent,
  pageSkeleton,
  parseAttributes,
  toSitePath,
} from '../scripts/lib/html.mjs';

describe('parseAttributes', () => {
  it('handles quoted, unquoted and boolean attributes', () => {
    expect(parseAttributes(` type="module" src=/x.js defer data-a='b c'`)).toEqual({
      type: 'module',
      src: '/x.js',
      defer: '',
      'data-a': 'b c',
    });
  });
});

describe('extractInlineScripts', () => {
  it('returns executable inline bodies byte-for-byte', () => {
    const html = `<head><script>(function(){ var a = "x" ; })();</script></head>`;
    expect(extractInlineScripts(html)).toEqual(['(function(){ var a = "x" ; })();']);
  });

  it('skips external scripts, data blocks and empty tags', () => {
    const html = [
      '<script src="/_astro/boot.js" type="module"></script>',
      '<script type="application/ld+json">{"@type":"Person"}</script>',
      '<script type="application/json">{}</script>',
      '<script>  </script>',
      '<script type="module">import "/x.js";</script>',
      '<script type="importmap">{"imports":{}}</script>',
    ].join('');
    expect(extractInlineScripts(html)).toEqual(['import "/x.js";', '{"imports":{}}']);
  });
});

describe('cspHash', () => {
  it('matches the well-known sha256 of an empty-ish script', () => {
    // echo -n "alert(1)" | openssl dgst -sha256 -binary | openssl base64
    expect(cspHash('alert(1)')).toBe("'sha256-bhHHL3z2vDgxUt0W3dWQOrprscmda2Y5pLsLg4GF+pI='");
  });

  it('is sensitive to every byte, including whitespace', () => {
    expect(cspHash('a()')).not.toBe(cspHash('a() '));
  });
});

describe('extractUrls', () => {
  it('collects href, src, poster and every srcset candidate', () => {
    const html = `<a href="/about/">x</a><img src=/a.png srcset="/a-1x.avif 1x, /a-2x.avif 2x">
      <video poster='/p.jpg'></video><link href="/_astro/x.css" rel="stylesheet">`;
    expect(extractUrls(html).sort()).toEqual(
      ['/_astro/x.css', '/a-1x.avif', '/a-2x.avif', '/a.png', '/about/', '/p.jpg'].sort(),
    );
  });
});

describe('extractEagerScripts', () => {
  it('sees script src and modulepreload, but not other links', () => {
    const html = `<script type="module" src="/_astro/boot.js"></script>
      <link rel="modulepreload" href="/_astro/chunk.js"><link rel="stylesheet" href="/x.css">`;
    expect(extractEagerScripts(html)).toEqual(['/_astro/boot.js', '/_astro/chunk.js']);
  });
});

describe('extractStaticImports', () => {
  it('finds static imports and re-exports in minified output', () => {
    const js = `import{a as b}from"./one.js";import"./two.js";export{c}from'./three.js';export*from"./four.js";`;
    expect(extractStaticImports(js).sort()).toEqual(
      ['./four.js', './one.js', './three.js', './two.js'].sort(),
    );
  });

  it('ignores dynamic imports: that seam is what keeps three.js out of plain mode', () => {
    const js = `const x=()=>import("./engine.js");x().then(m=>m.start());`;
    expect(extractStaticImports(js)).toEqual([]);
  });
});

describe('toSitePath', () => {
  it('resolves absolute and relative references against the page', () => {
    expect(toSitePath('/about/', '/')).toBe('/about/');
    expect(toSitePath('cover.png', '/projects/fishai/')).toBe('/projects/fishai/cover.png');
    expect(toSitePath('./chunk.js', '/_astro/boot.js')).toBe('/_astro/chunk.js');
    expect(toSitePath('/a/?x=1#top', '/')).toBe('/a/');
  });

  it('ignores external links, other schemes, and pure query or hash links', () => {
    for (const url of [
      'https://github.com/MeagerPotato',
      '//cdn.example.com/x.js',
      'mailto:someone@example.com',
      'data:image/png;base64,AAAA',
      '#main',
      '?plain',
      '',
    ]) {
      expect(toSitePath(url, '/')).toBeNull();
    }
  });
});

describe('the swap contract', () => {
  const page = (options: { title: string; main: string; current?: string; extraHead?: string }) =>
    [
      '<!doctype html><html lang="en"><head><meta charset="utf-8">',
      `<title data-page-head>${options.title}</title>`,
      `<meta name="description" content="About ${options.title}" data-page-head>`,
      `<link rel="canonical" href="https://site.invalid/${options.title}/" data-page-head>`,
      options.extraHead ?? '',
      '<link rel="stylesheet" href="/_astro/x.css"></head><body><nav>',
      `<a href="/a/"${options.current === 'a' ? ' aria-current="page"' : ''}>A</a>`,
      `<a href="/b/"${options.current === 'b' ? ' aria-current="true"' : ''}>B</a>`,
      `</nav><main id="main" tabindex="-1">${options.main}</main><footer>f</footer></body></html>`,
    ].join('');

  it('ignores exactly what the router swaps: <main>, [data-page-head], aria-current', () => {
    const a = page({ title: 'a', main: '<h1>A</h1><p>one</p>', current: 'a' });
    const b = page({
      title: 'b',
      main: '<h1>B</h1><img src="/x.avif" alt="">',
      current: 'b',
      extraHead: '<script type="application/ld+json" data-page-head>{"@type":"Person"}</script>',
    });
    expect(pageSkeleton(a)).toBe(pageSkeleton(b));
    expect(pageSkeleton(a)).toContain('<main id="main" tabindex="-1"></main>');
    expect(pageSkeleton(a)).not.toContain('aria-current');
    expect(pageSkeleton(a)).not.toContain('<title');
  });

  it('sees any other difference, and says where it is', () => {
    const a = page({ title: 'a', main: '' });
    const b = page({ title: 'b', main: '' }).replace('<body>', '<body class="b">');
    const difference = firstDifference(pageSkeleton(a), pageSkeleton(b));
    expect(difference?.actual).toContain('<body class=\\"b\\">');
    expect(difference?.expected).toContain('<body>');
    expect(firstDifference('same', 'same')).toBeNull();
  });

  it('sees a per-page head node that forgot data-page-head', () => {
    const a = page({ title: 'a', main: '' });
    const b = page({ title: 'b', main: '', extraHead: '<meta name="robots" content="noindex">' });
    expect(pageSkeleton(a)).not.toBe(pageSkeleton(b));
  });

  it('is not fooled by page content that mentions the swapped parts', () => {
    const a = page({ title: 'a', main: '<p>plain</p>' });
    const b = page({ title: 'b', main: '<code>&lt;main&gt; and data-page-head</code>' });
    expect(pageSkeleton(a)).toBe(pageSkeleton(b));
  });

  it('refuses a page without exactly one <main>', () => {
    expect(() => pageSkeleton('<html><body><p>no main</p></body></html>')).toThrow(/one <main>/);
    expect(() => pageSkeleton('<main>a</main><main>b</main>')).toThrow(/one <main>/);
  });

  it('knows the plain-only pages, which the router never swaps in', () => {
    expect(isPlainOnly('<!doctype html><html lang="en" data-plain-only>')).toBe(true);
    expect(isPlainOnly('<!doctype html><html lang="en">')).toBe(false);
    expect(isPlainOnly('<html lang="en"><body data-plain-only>')).toBe(false);
  });
});

describe('head metadata', () => {
  const head = [
    '<meta charset="utf-8">',
    '<meta name="description" content="Tom &amp; Jerry say &quot;hi&quot;" data-page-head>',
    '<link rel="canonical" href="https://site.invalid/about/" data-page-head>',
    '<meta property="og:image" content="https://site.invalid/og/default.png" data-page-head>',
    '<link rel="stylesheet" href="/_astro/x.css">',
  ].join('');

  it('reads a meta tag by property or by name, and decodes what Astro escaped', () => {
    expect(metaContent(head, 'og:image')).toBe('https://site.invalid/og/default.png');
    expect(metaContent(head, 'description')).toBe('Tom & Jerry say "hi"');
    expect(metaContent(head, 'og:video')).toBeNull();
  });

  it('finds the canonical link and nothing else', () => {
    expect(canonicalUrl(head)).toBe('https://site.invalid/about/');
    expect(canonicalUrl('<link rel="stylesheet" href="/x.css">')).toBeNull();
  });
});

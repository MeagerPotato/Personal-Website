import { describe, expect, it } from 'vitest';
import {
  cspHash,
  extractEagerScripts,
  extractInlineScripts,
  extractStaticImports,
  extractUrls,
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

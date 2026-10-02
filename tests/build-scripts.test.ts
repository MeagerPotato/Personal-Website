import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
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
  mainContent,
  metaContent,
  pageSkeleton,
  parseAttributes,
  toSitePath,
} from '../scripts/lib/html.mjs';
import {
  CLOSE_UP_BUDGET,
  CLOSE_UP_CHUNK,
  CLOSE_UP_MARKERS,
  closeUpProblems,
} from '../scripts/lib/closeup.mjs';
import { isShaderModule, squeezeGlsl, squeezeTemplates } from '../scripts/lib/glsl-squeeze.mjs';
import { parseRedirects, redirectProblems } from '../scripts/lib/redirects.mjs';
import {
  ENGINE_INCLUDES,
  KEEP_MATERIALS,
  dietThree,
  isThreeBuild,
  keptChunks,
  readChunks,
} from '../scripts/lib/three-diet.mjs';
import {
  RESUME_PDF,
  printSection,
  printedContent,
  resumeFingerprint,
  resumePdfProblems,
  sha256,
} from '../scripts/lib/resume-pdf.mjs';
import { routes } from '../src/site/routes';

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

describe('mainContent', () => {
  it('returns what the router would swap in, and nothing around it', () => {
    const html =
      '<head><title>t</title></head><body><main id="main"><h1>A</h1></main><footer>f</footer>';
    expect(mainContent(html)).toBe('<h1>A</h1>');
    expect(() => mainContent('<main>a</main><main>b</main>')).toThrow(/one <main>/);
  });
});

describe("the resume's PDF", () => {
  const html = (main: string, head = '') =>
    `<head><title>Resume</title>${head}</head><body><main id="main">${main}</main><footer>f</footer>`;
  const css = (print: string, before = '.a { color: red; }') =>
    `${before}\n/* 4. Print: always the plain layout ---- */\n${print}\n`;
  const PAGE = html('<p class="resume-name">Allen Hsieh</p>');
  const CSS = css('@media print { .b { color: black; } }');
  const PDF = Buffer.from('%PDF-1.7 the bytes');
  const LOCK = { pdf: sha256(PDF), printedFrom: resumeFingerprint(PAGE, CSS), pages: 2 };

  it('is served where the resume page links to it', () => {
    expect(RESUME_PDF).toBe(routes.resumePdf());
  });

  it('is printed from the page and the print section, and nothing else', () => {
    const print = resumeFingerprint(PAGE, CSS);
    // What the page says, and how paper looks, both count.
    expect(resumeFingerprint(html('<p>Allen</p>'), CSS)).not.toBe(print);
    expect(resumeFingerprint(PAGE, css('@media print { .b { color: blue; } }'))).not.toBe(print);
    // A new build stamp in the head, or a screen-only style, changes nothing on paper.
    expect(
      resumeFingerprint(
        html('<p class="resume-name">Allen Hsieh</p>', '<meta name="build" content="x">'),
        CSS,
      ),
    ).toBe(print);
    expect(
      resumeFingerprint(PAGE, css('@media print { .b { color: black; } }', '.a { color: blue; }')),
    ).toBe(print);
    // Windows line endings are the same file.
    expect(resumeFingerprint(PAGE.replaceAll('\n', '\r\n'), CSS.replaceAll('\n', '\r\n'))).toBe(
      print,
    );
  });

  it('ignores what only a screen shows: the title, the intro, the download button', () => {
    // The page as the site builds it: header, name, screen-only intro, actions, entries.
    const page = (title: string, intro: string, button: string, entry: string) =>
      html(
        `<header class="page-header"><p class="eyebrow">Resume station</p><h1 tabindex="-1">${title}</h1></header>` +
          '<p class="resume-name">Allen Hsieh</p>' +
          `<div class="prose screen-only"><p>${intro}</p></div>` +
          `<ul class="actions"><li><a class="button" href="/allen-hsieh-resume.pdf" download>${button}</a></li></ul>` +
          `<section class="resume-section"><h2>Experience</h2><p>${entry}</p></section>`,
      );
    const print = resumeFingerprint(page('Resume', 'The formal version.', 'PDF', 'Raytheon'), CSS);
    expect(resumeFingerprint(page('My resume', 'Reworded.', 'Get it', 'Raytheon'), CSS)).toBe(
      print,
    );
    expect(resumeFingerprint(page('Resume', 'The formal version.', 'PDF', 'RTX'), CSS)).not.toBe(
      print,
    );
    expect(printedContent(page('R', 'i', 'b', 'e'))).not.toMatch(/page-header|screen-only|actions/);
  });

  it('refuses a stylesheet without its print section', () => {
    expect(() => printSection('.a { color: red; }')).toThrow(/4\. Print/);
  });

  it('passes when the committed PDF was printed from this very page', () => {
    expect(resumePdfProblems({ lock: LOCK, pdf: PDF, html: PAGE, css: CSS })).toEqual([]);
  });

  it('asks for a new PDF when the resume changed since it was printed', () => {
    const changed = html('<p class="resume-name">Allen Hsieh</p><p>A new job</p>');
    const problems = resumePdfProblems({ lock: LOCK, pdf: PDF, html: changed, css: CSS });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/changed since .* was printed.*npm run resume-pdf/);
  });

  it('notices a PDF that is not the one the lock describes, or none at all', () => {
    const other = Buffer.from('%PDF-1.7 other bytes');
    expect(resumePdfProblems({ lock: LOCK, pdf: other, html: PAGE, css: CSS })[0]).toMatch(
      /not the file/,
    );
    expect(resumePdfProblems({ lock: LOCK, pdf: null, html: PAGE, css: CSS })[0]).toMatch(
      /missing from dist/,
    );
    expect(resumePdfProblems({ lock: null, pdf: PDF, html: PAGE, css: CSS })[0]).toMatch(
      /resume-pdf\.json is missing/,
    );
  });
});

describe('old URLs (_redirects)', () => {
  /** The real file, as public/ holds it and the build copies it. */
  const real = readFileSync(new URL('../public/_redirects', import.meta.url), 'utf8');
  /** A build with these pages, as verify-dist asks: is there a path/index.html. */
  const built =
    (...pages: string[]) =>
    (path: string) =>
      pages.includes(path.endsWith('/') ? path : `${path}/`);
  const context = (links: Array<{ page: string; target: string }> = []) => ({
    isPage: built('/', '/projects/', '/systems/software/'),
    links: [{ page: '/', target: '/projects/' }, ...links],
  });

  it('reads one rule a line, skipping comments and blank lines, and reports the rest', () => {
    const { rules, unreadable } = parseRedirects(
      '# old URLs\n\n/a/  /b/  301\r\n  /c /d/\n/lonely\n/e /f/ 301 extra\n',
    );
    expect(rules).toEqual([
      { line: 3, from: '/a/', to: '/b/', status: 301 },
      { line: 4, from: '/c', to: '/d/', status: null },
    ]);
    expect(unreadable).toEqual([
      { line: 5, text: '/lonely' },
      { line: 6, text: '/e /f/ 301 extra' },
    ]);
  });

  it('sends both spellings of the Code system to Software, for good', () => {
    const { rules, unreadable } = parseRedirects(real);
    expect(unreadable).toEqual([]);
    expect(rules.map(({ from, to, status }) => [from, to, status])).toEqual([
      ['/systems/code/', '/systems/software/', 301],
      ['/systems/code', '/systems/software/', 301],
    ]);
    expect(redirectProblems(real, context())).toEqual([]);
  });

  it('refuses a destination that is not a page of the build, or not written as one', () => {
    const problems = (to: string) => redirectProblems(`/old/ ${to} 301`, context());
    expect(problems('/systems/gone/')).toEqual([
      expect.stringMatching(/"\/old\/" goes to "\/systems\/gone\/", which must be a page/),
    ]);
    expect(problems('/systems/software')).toHaveLength(1);
    expect(problems('https://example.com/')).toHaveLength(1);
    expect(problems('//example.com/')).toHaveLength(1);
    expect(problems('/systems/software/')).toEqual([]);
  });

  it('refuses a source that is a page: the redirect would hide it', () => {
    // (The home page's link to /projects/ now only redirects too, and is reported as such.)
    expect(redirectProblems('/projects/ /systems/software/ 301', context())).toEqual([
      expect.stringMatching(/"\/projects\/" is a page of this build/),
      expect.stringMatching(/^\/: links to "\/projects\/", which only redirects/),
    ]);
    expect(redirectProblems('/projects /systems/software/ 301', context())).toEqual([
      expect.stringMatching(/"\/projects" is a page of this build/),
    ]);
  });

  it('asks for 301 on every line: a line without a code is a 302', () => {
    expect(redirectProblems('/old/ /projects/ 302', context())).toEqual([
      expect.stringMatching(/must say 301 \(moved for good\), not 302/),
    ]);
    expect(redirectProblems('/old/ /projects/', context())).toEqual([
      expect.stringMatching(/not nothing \(302\)/),
    ]);
  });

  it('allows one exact path each: no splats, no placeholders, no second rule for it', () => {
    expect(redirectProblems('/old/* /projects/ 301', context())).toEqual([
      expect.stringMatching(/must be one exact path/),
    ]);
    expect(redirectProblems('/old/:id/ /projects/ 301', context())).toHaveLength(1);
    expect(
      redirectProblems('/old/ /projects/ 301\n/old/ /systems/software/ 301', context()),
    ).toEqual([expect.stringMatching(/line 2: "\/old\/" is redirected twice \(also line 1\)/)]);
  });

  it('refuses a line Cloudflare would ignore', () => {
    expect(redirectProblems('/systems/code/', context())).toEqual([
      expect.stringMatching(/line 1 is not "source destination 301"/),
    ]);
  });

  it('refuses a page that links to an old URL instead of where it goes', () => {
    const links = [{ page: '/about/', target: '/systems/code/' }];
    expect(redirectProblems(real, context(links))).toEqual([
      expect.stringMatching(/^\/about\/: links to "\/systems\/code\/", which only redirects/),
    ]);
  });
});

describe('closeUpProblems', () => {
  const CHUNK = '/_astro/closeup.Ab1_c.js';
  const rows = `export const NEAR={a:[["${CLOSE_UP_MARKERS.join('"],["')}"]]};`;
  /** A build as Rolldown makes it: the engine loads the close-up rows with import(). */
  const build = (over: Record<string, string> = {}): Map<string, string> =>
    new Map(
      Object.entries({
        '/_astro/api.X1.js':
          'import{a as t}from"./three.Q2.js";const l=()=>import(`./closeup.Ab1_c.js`);',
        '/_astro/three.Q2.js': 'export const a=1;',
        [CHUNK]: rows,
        ...over,
      }),
    );
  const light = (): number => 3000;

  it('passes a chunk of its own, loaded only through import(), within its budget', () => {
    expect(closeUpProblems(build(), light)).toEqual([]);
    expect(CLOSE_UP_CHUNK.test(CHUNK)).toBe(true);
  });

  it('refuses a static import of it, which would download it with the engine', () => {
    const problems = closeUpProblems(
      build({ '/_astro/api.X1.js': 'import{NEAR as n}from"./closeup.Ab1_c.js";' }),
      light,
    );
    expect(problems).toContain(
      `/_astro/api.X1.js imports ${CHUNK} statically: the close-up would load with it`,
    );
    expect(problems).toContain(`nothing loads ${CHUNK} with import()`);
  });

  it('refuses close-up rows folded into another chunk', () => {
    const marker = CLOSE_UP_MARKERS[0] ?? '';
    const problems = closeUpProblems(
      build({ '/_astro/three.Q2.js': `export const a="${marker}";` }),
      light,
    );
    expect(problems).toEqual([
      `/_astro/three.Q2.js holds "${marker}", a part only the close-up rows have`,
    ]);
    // ...or a chunk of that name without them.
    expect(closeUpProblems(build({ [CHUNK]: 'export const NEAR={};' }), light)).toHaveLength(
      CLOSE_UP_MARKERS.length,
    );
  });

  it('wants exactly one such chunk, within its budget', () => {
    const none = build();
    none.delete(CHUNK);
    expect(closeUpProblems(none, light)).toEqual([
      'the close-up rows should be one chunk of their own (closeup.*.js); found 0',
    ]);
    expect(closeUpProblems(build({ '/_astro/closeup.Zz9.js': rows }), light)).toHaveLength(1);
    expect(closeUpProblems(build(), () => CLOSE_UP_BUDGET + 1)).toEqual([
      `${CHUNK} weighs ${CLOSE_UP_BUDGET + 1} B gzipped; the close-up chunk's budget is ${CLOSE_UP_BUDGET} B`,
    ]);
  });

  it('looks for names only the close-up rows have: parts of near.ts, and no string elsewhere', () => {
    // As a string, which is what a bundle keeps (a comment may name the part: it is stripped).
    const near = readFileSync('src/universe/design/worlds/near.ts', 'utf8');
    const elsewhere = sourceFiles('src')
      .filter((file) => !/design[\\/]worlds[\\/](near|motion|closeup)\.ts$/.test(file))
      .filter((file) => !file.endsWith('.test.ts'))
      .map((file) => [file, readFileSync(file, 'utf8')] as const);
    for (const marker of CLOSE_UP_MARKERS) {
      expect(near, marker).toContain(`'${marker}'`);
      for (const [file, text] of elsewhere) {
        const quoted = ["'", '"', '`'].some((q) => text.includes(`${q}${marker}${q}`));
        expect(quoted, `${marker} in ${file}`).toBe(false);
      }
    }
  });
});

/** Every .ts and .astro file under `dir`. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|astro)$/.test(entry.name) ? [path] : [];
  });
}

// THE GLSL SQUEEZE (scripts/lib/glsl-squeeze.mjs): builds ship the shaders without their comments
// and indentation. What it must never do is change the program.
describe('squeezeGlsl', () => {
  it('drops comments and the whitespace that separates nothing', () => {
    const squeezed = squeezeGlsl(`
      // The header says what the uniforms are.
      uniform float uTime; /* seconds */
      void main() {
        float wave = 0.5 + 0.5 * sin( uTime );
        gl_FragColor = vec4( wave, 0.0, 0.0, 1.0 );
      }
    `);
    expect(squeezed).toBe(
      'uniform float uTime;void main(){float wave=0.5+0.5*sin(uTime);' +
        'gl_FragColor=vec4(wave,0.0,0.0,1.0);}',
    );
  });

  it('keeps the space between two words, and between signs that would join', () => {
    expect(squeezeGlsl('uniform   vec3\n uColor ;')).toBe('uniform vec3 uColor;');
    expect(squeezeGlsl('float a = b - -c;')).toBe('float a=b- -c;');
    expect(squeezeGlsl('float a = b + +c;')).toBe('float a=b+ +c;');
    expect(squeezeGlsl('float a = b\n  - -c;')).toBe('float a=b- -c;');
    // A block comment separates two words as a space does.
    expect(squeezeGlsl('return/* the lit side */color;')).toBe('return color;');
    expect(squeezeGlsl('float x = 1. - .5;')).toBe('float x=1.-.5;');
  });

  it('gives every preprocessor line a line of its own, as written', () => {
    const squeezed = squeezeGlsl(`
      #define GLOW_COUNT 4
      uniform vec3 uGlow[GLOW_COUNT];
      vec3 tap() {
        #ifdef MASKED
          return a * b;
        #else
          return a;
        #endif
      }
      void main() {
        gl_FragColor = vec4(tap(), 1.0);
        #include <colorspace_fragment>
      }
    `);
    expect(squeezed).toBe(
      [
        '',
        '#define GLOW_COUNT 4',
        'uniform vec3 uGlow[GLOW_COUNT];vec3 tap(){',
        '#ifdef MASKED',
        'return a*b;',
        '#else',
        'return a;',
        '#endif',
        '}void main(){gl_FragColor=vec4(tap(),1.0);',
        '#include <colorspace_fragment>',
        '}',
      ].join('\n'),
    );
    // A macro with arguments is not a macro without them: the space in a directive stays.
    expect(squeezeGlsl('#define sq (x)')).toBe('\n#define sq (x)\n');
  });

  it('leaves an interpolation alone: in its line when inside one, on its own line when it had one', () => {
    const count = '$' + '{GLOW_COUNT}';
    expect(squeezeGlsl(`  #define GLOW_COUNT ${count}\n  float a;`)).toBe(
      `\n#define GLOW_COUNT ${count}\nfloat a;`,
    );
    // What a lone one puts there is not known: it may end in a comment or a directive.
    const noise = '$' + '{ noise }';
    expect(squeezeGlsl(`float a;\n  ${noise}\n  float b;`)).toBe(`float a;\n${noise}\nfloat b;`);
    const twice = '$' + '{ scale * 2 }';
    // A sign beside one keeps its space: what it holds may start or end with a sign of its own
    // (`1.0 - ${x}` with x = -0.5 must not become `1.0--0.5`).
    expect(squeezeGlsl(`float a = ${twice} + 1.0; // twice`)).toBe(`float a=${twice} +1.0;`);
    expect(squeezeGlsl(`float a = 1.0 - ${twice};`)).toBe(`float a=1.0- ${twice};`);
    expect(squeezeGlsl(`float a = 1.0\n  - ${twice};`)).toBe(`float a=1.0- ${twice};`);
    expect(squeezeGlsl(`vec2 a = vec2(${twice}, ${twice});`)).toBe(
      `vec2 a=vec2(${twice},${twice});`,
    );
    // Braces, quotes and templates inside one are JavaScript, and none of the shader's business.
    const nested = '$' + '{ pick({ a: "}" }, `$' + '{b} // not a comment`) }';
    expect(squeezeGlsl(`x = ${nested};`)).toBe(`x=${nested};`);
  });

  it('refuses what it cannot keep whole', () => {
    expect(() => squeezeGlsl('#define TWO \\\n  lines')).toThrow(/backslash/);
    expect(() => squeezeGlsl('float a = $' + '{ never;')).toThrow(/never closes/);
  });
});

describe('squeezeTemplates', () => {
  it('squeezes the template literals tagged glsl, and nothing else in the module', () => {
    const module = [
      '/** Uniforms: uTime. */',
      'export const COUNT = 4;',
      'export const sky = {',
      '  vertexShader: /* glsl */ `',
      '    void main() {',
      '      gl_Position = vec4( position, 1.0 ); // far away',
      '    }',
      '  `,',
      '  note: `  not   a shader  // and not a comment `,',
      '};',
    ].join('\n');
    expect(squeezeTemplates(module)).toBe(
      [
        '/** Uniforms: uTime. */',
        'export const COUNT = 4;',
        'export const sky = {',
        '  vertexShader: /* glsl */ `void main(){gl_Position=vec4(position,1.0);}`,',
        '  note: `  not   a shader  // and not a comment `,',
        '};',
      ].join('\n'),
    );
  });

  it('only applies to the shader modules', () => {
    expect(isShaderModule('C:\\repo\\src\\universe\\design\\shaders\\sky.ts')).toBe(true);
    expect(isShaderModule('/repo/src/universe/design/shaders/toonFlat.ts?v=1')).toBe(true);
    expect(isShaderModule('/repo/src/universe/design/shaders/sky.test.ts')).toBe(false);
    expect(isShaderModule('/repo/src/universe/design/materials.ts')).toBe(false);
    expect(isShaderModule('/repo/src/universe/design/shaders/deep/sky.ts')).toBe(false);
  });

  // The real shaders: whatever is written there, the squeeze must give back the same program.
  const SHADERS = join(import.meta.dirname, '../src/universe/design/shaders');
  const modules = readdirSync(SHADERS).filter((name) => isShaderModule(`/${SHADERS}/${name}`));
  /** Every tagged literal's text in a module. (No shader holds a backtick of its own.) */
  const literals = (source: string): string[] =>
    [...source.matchAll(/\/\*\s*glsl\s*\*\/\s*`([^`]*)`/g)].map((match) => match[1] ?? '');
  const uncommented = (glsl: string): string =>
    glsl.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, '');
  const words = (glsl: string): string[] => glsl.match(/[A-Za-z_]\w*/g) ?? [];

  it('finds the shaders', () => {
    expect(modules.length).toBeGreaterThanOrEqual(6);
  });

  it.each(modules)('%s: the same program, without its comments', (name) => {
    const source = readFileSync(join(SHADERS, name), 'utf8');
    const before = literals(source);
    const after = literals(squeezeTemplates(source));
    expect(before.length).toBeGreaterThan(0);
    expect(after).toHaveLength(before.length);
    for (const [i, squeezed] of after.entries()) {
      const written = uncommented(before[i] ?? '');
      // Nothing but whitespace and comments went: character for character, the rest is there...
      expect(squeezed.replace(/\s+/g, '')).toBe(written.replace(/\s+/g, ''));
      // ...and two words that were apart are still apart: the same words, in the same order.
      expect(words(squeezed)).toEqual(words(written));
      expect(squeezed).not.toMatch(/\/\/|\/\*/);
      expect(squeezed.length).toBeLessThan((before[i] ?? '').length);
      // A directive has its line to itself (three.js resolves an include only at a line's start).
      for (const line of squeezed.split('\n')) {
        if (line.includes('#')) expect(line).toMatch(/^#\w+( [^;]*)?$/);
      }
    }
    // Squeezing what is squeezed changes nothing.
    expect(squeezeTemplates(squeezeTemplates(source))).toBe(squeezeTemplates(source));
  });
});

// THE THREE.JS DIET (scripts/lib/three-diet.mjs): builds ship three without the GLSL of the
// materials nobody uses. What it must never do is take away something the engine compiles.
describe('dietThree', () => {
  const ROOT = join(import.meta.dirname, '..');
  // Wherever three is installed (a worktree finds the main checkout's): its build folder.
  const build = dirname(createRequire(import.meta.url).resolve('three'));
  const three = readFileSync(join(build, 'three.module.js'), 'utf8');
  const { chunks } = readChunks(three);
  const kept = keptChunks(chunks);
  const dieted = dietThree(three);

  /** Every module of the engine and the shell that ships (no tests). */
  const sources = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return sources(path);
      return /\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) ? [path] : [];
    });
  const engine = [...sources(join(ROOT, 'src/universe')), ...sources(join(ROOT, 'src/shell'))].map(
    (path) => ({ path, text: readFileSync(path, 'utf8') }),
  );

  it('only reads the one file', () => {
    expect(isThreeBuild('C:\\repo\\node_modules\\three\\build\\three.module.js')).toBe(true);
    expect(isThreeBuild('/repo/node_modules/three/build/three.module.js?v=1')).toBe(true);
    expect(isThreeBuild('/repo/node_modules/three/build/three.core.js')).toBe(false);
    expect(isThreeBuild('/repo/src/universe/main.ts')).toBe(false);
  });

  it('keeps the basic program whole, and what the renderer and the engine paste in', () => {
    expect(chunks.size).toBeGreaterThan(120);
    // The basic program and everything it includes: a new three.js that includes more shows here.
    expect(kept.size).toBe(64);
    for (const name of ['meshbasic_vert', 'meshbasic_frag', 'common', 'project_vertex']) {
      expect(kept.has(name), name).toBe(true);
    }
    for (const name of kept) {
      const text = chunks.get(name)?.text ?? '';
      expect(text.length, name).toBeGreaterThan(0);
      expect(dieted.includes(JSON.stringify(text)), name).toBe(true);
    }
  });

  it('empties the rest, and leaves an #error where a dropped program was', () => {
    const after = readChunks(dieted).chunks;
    expect(after.size).toBe(chunks.size);
    let saved = 0;
    for (const [name, chunk] of chunks) {
      if (kept.has(name)) continue;
      const text = after.get(name)?.text ?? 'missing';
      if (/_(vert|frag)$/.test(name)) expect(text).toMatch(/^#error \w+: dropped by scripts/);
      else expect(text).toBe('');
      saved += chunk.text.length - text.length;
    }
    expect(saved).toBeGreaterThan(100_000);
    // Nothing else moved: the same lines, and only chunk lines differ.
    const before = three.split('\n');
    const lines = dieted.split('\n');
    expect(lines).toHaveLength(before.length);
    const changed = lines.filter((line, index) => line !== before[index]);
    expect(changed).toHaveLength(chunks.size - kept.size);
    for (const line of changed) expect(line).toMatch(/^(var|const) [\w$]+ = "[^"]*";$/);
  });

  it('refuses a three.js it cannot read', () => {
    expect(() => dietThree('export const nothing = 1;')).toThrow(/no `const ShaderChunk/);
    expect(() => dietThree('const ShaderChunk = {\n\tcommon: common,\n};')).toThrow(/no text/);
  });

  it('the engine uses no built-in material but the kept ones', () => {
    const imported = new Set<string>();
    for (const { text } of engine) {
      for (const match of text.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from 'three'/g)) {
        for (const name of (match[1] ?? '').split(','))
          imported.add(name.replace(/\btype\b/, '').trim());
      }
    }
    const materials = [...imported].filter((name) => /Material$/.test(name)).sort();
    const allowed = ['Material', 'ShaderMaterial', ...KEEP_MATERIALS];
    expect(materials.filter((name) => !allowed.includes(name))).toEqual([]);
    expect(materials).toContain('ShaderMaterial');
  });

  it('the engine includes no chunk but the kept ones, and asks three for no shadow or background', () => {
    const included = new Set<string>();
    for (const { path, text } of engine) {
      for (const match of text.matchAll(/#include <(\w+)>/g)) included.add(match[1] ?? '');
      // Shadows compile the depth program; a texture as the scene's background compiles its own.
      expect(text, path).not.toMatch(/shadowMap\.enabled|castShadow|\.background\s*=\s*[a-z]/);
    }
    expect([...included].sort()).toEqual([...ENGINE_INCLUDES].sort());
    for (const name of included) expect(kept.has(name), name).toBe(true);
  });
});

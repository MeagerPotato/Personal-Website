import type { JSONContent } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { headingId, highlightCode, renderMath, renderPost, styleHashes } from './render';

type Mark = NonNullable<JSONContent['marks']>[number];
const text = (value: string, marks?: Mark[]): JSONContent => ({
  type: 'text',
  text: value,
  ...(marks ? { marks } : {}),
});
const paragraph = (...content: object[]) => ({ type: 'paragraph', content });

describe('renderPost', () => {
  it('puts headings one level down, with ids, and lists them', async () => {
    const post = await renderPost({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [text('Why rockets?')] },
        { type: 'heading', attrs: { level: 2 }, content: [text('Why rockets?')] },
        paragraph(text('Because.')),
      ],
    });
    expect(post.html).toContain('<h2 id="why-rockets">Why rockets?</h2>');
    expect(post.html).toContain('<h3 id="why-rockets-2">Why rockets?</h3>');
    expect(post.html).not.toContain('<h1');
    expect(post.headings).toEqual([
      { level: 1, text: 'Why rockets?', id: 'why-rockets' },
      { level: 2, text: 'Why rockets?', id: 'why-rockets-2' },
    ]);
    expect(post.words).toBe(5);
  });

  it('highlights code in the language it names, and escapes the rest', async () => {
    const post = await renderPost({
      type: 'doc',
      content: [
        {
          type: 'codeBlock',
          attrs: { language: 'python' },
          content: [text('def f(x):\n    return x < 2')],
        },
        { type: 'codeBlock', attrs: { language: 'klingon' }, content: [text('<b>hi</b>')] },
      ],
    });
    expect(post.html).toContain('<pre class="code" data-language="python">');
    expect(post.html).toContain('<span class="hljs-keyword">def</span>');
    expect(post.html).toContain('return</span> x &#x3C; <span class="hljs-number">2</span>');
    expect(post.html).toContain('<code class="hljs">&lt;b&gt;hi&lt;/b&gt;</code>');
  });

  it('typesets math as MathML, and shows an error as the source', async () => {
    const post = await renderPost({
      type: 'doc',
      content: [
        paragraph(text('Energy: '), { type: 'mathInline', attrs: { latex: 'E = mc^2' } }),
        { type: 'mathBlock', attrs: { latex: String.raw`\int_0^1 x\,dx` } },
        { type: 'mathBlock', attrs: { latex: String.raw`\frac{1}{` } },
      ],
    });
    expect(post.html).toMatch(/<span class="math-inline"><math[^>]*>/);
    expect(post.html).toContain('<annotation encoding="application/x-tex">E = mc^2</annotation>');
    expect(post.html).toMatch(/<div class="math-block"><math display="block"/);
    expect(post.html).toContain('<code class="math-error"');
    // Display math carries a style attribute; the page's CSP must allow exactly that.
    expect(post.styleHashes).toHaveLength(1);
    expect(post.styleHashes[0]).toMatch(/^'sha256-[A-Za-z0-9+/]+=*'$/);
  });

  it('gives an image every stored width, its size and its caption', async () => {
    const post = await renderPost({
      type: 'doc',
      content: [
        {
          type: 'image',
          attrs: {
            id: 'm_abc',
            ext: 'webp',
            width: 3000,
            height: 2000,
            widths: [640, 1280, 2048],
            alt: 'A rocket on the pad "at dawn"',
          },
          content: [text('Launch day.')],
        },
      ],
    });
    expect(post.html).toContain('src="/media/m_abc/1280.webp"');
    expect(post.html).toContain(
      'srcset="/media/m_abc/640.webp 640w, /media/m_abc/1280.webp 1280w, /media/m_abc/2048.webp 2048w"',
    );
    expect(post.html).toContain('width="3000" height="2000"');
    expect(post.html).toContain('alt="A rocket on the pad &quot;at dawn&quot;"');
    expect(post.html).toContain('<figcaption>Launch day.</figcaption>');
  });

  it('shows to-dos without letting readers tick them, and toggles as <details>', async () => {
    const post = await renderPost({
      type: 'doc',
      content: [
        {
          type: 'taskList',
          content: [
            { type: 'taskItem', attrs: { checked: true }, content: [paragraph(text('Build'))] },
            { type: 'taskItem', attrs: { checked: false }, content: [paragraph(text('Fly'))] },
          ],
        },
        {
          type: 'details',
          content: [
            { type: 'detailsSummary', content: [text('Spoiler')] },
            { type: 'detailsContent', content: [paragraph(text('It flew.'))] },
          ],
        },
      ],
    });
    expect(post.html).toContain(
      '<ul data-type="taskList"><li data-checked="true"><label><input type="checkbox" disabled checked aria-label="Done"></label><div><p>Build</p></div></li>',
    );
    expect(post.html).toContain('<input type="checkbox" disabled aria-label="To do">');
    expect(post.html).toContain('<details class="toggle"><summary>Spoiler</summary>');
    expect(post.html).toContain('<div class="toggle__body"><p>It flew.</p></div></details>');
  });

  it('keeps callouts, marks and safe links, and drops script links', async () => {
    const post = await renderPost({
      type: 'doc',
      content: [
        {
          type: 'callout',
          attrs: { icon: '🚀', family: 'sky' },
          content: [
            paragraph(
              text('Read '),
              text('this', [{ type: 'link', attrs: { href: 'https://allenkh.com' } }]),
              text(' and '),
              text('not this', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }]),
              text(' <script>', [{ type: 'bold' }]),
            ),
          ],
        },
      ],
    });
    expect(post.html).toContain('data-type="callout" data-icon="🚀" data-family="sky"');
    expect(post.html).toContain('href="https://allenkh.com"');
    expect(post.html).not.toContain('javascript:');
    expect(post.html).toContain('<strong> &lt;script&gt;</strong>');
  });

  it('renders nothing for no document', async () => {
    expect(await renderPost(null)).toEqual({
      html: '',
      text: '',
      words: 0,
      headings: [],
      styleHashes: [],
    });
  });
});

describe('helpers', () => {
  it('makes readable, unique heading ids', () => {
    const taken = new Set<string>();
    expect(headingId('Café & Crème: Part 2!', taken)).toBe('cafe-creme-part-2');
    expect(headingId('Café & Crème: Part 2!', taken)).toBe('cafe-creme-part-2-2');
    expect(headingId('!!!', taken)).toBe('section');
  });

  it('never throws on bad LaTeX or unknown languages', () => {
    expect(renderMath('x^', false)).toContain('math-error');
    expect(renderMath('', true)).toBe('');
    expect(highlightCode('plain', null)).toBe(
      '<pre class="code"><code class="hljs">plain</code></pre>',
    );
  });

  it('hashes each distinct style attribute once, as the browser will', async () => {
    const hashes = await styleHashes('<a style="color:red;"></a><b style="color:red;"></b>');
    // node -e "console.log(require('crypto').createHash('sha256').update('color:red;').digest('base64'))"
    expect(hashes).toEqual(["'sha256-BQ5eA/mw6jES31KSfh/A55TC7nzftLBWpZBzzDfwUrA='"]);
  });
});

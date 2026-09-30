import { Node, type JSONContent } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { closeEmptyElements, joinChildren, renderHtml } from './render';

type Mark = NonNullable<JSONContent['marks']>[number];
const text = (value: string, ...marks: Mark[]): JSONContent => ({
  type: 'text',
  text: value,
  ...(marks.length ? { marks } : {}),
});
const paragraph = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content });
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content });

/** A site's own code block: the same name and `language` attribute as the shared one. */
const MyCodeBlock = Node.create({
  name: 'codeBlock',
  group: 'block',
  content: 'text*',
  marks: '',
  code: true,
  addAttributes: () => ({ language: { default: null } }),
  renderHTML: () => ['pre', { class: 'mine' }, ['code', 0]],
});

describe('renderHtml', () => {
  it('renders every block of the shared schema, so a stored document always reads', () => {
    const html = renderHtml(
      doc(
        { type: 'heading', attrs: { level: 1 }, content: [text('Title')] },
        { type: 'heading', attrs: { level: 3 }, content: [text('Small')] },
        paragraph(text('Plain')),
        { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph(text('dot'))] }] },
        { type: 'orderedList', content: [{ type: 'listItem', content: [paragraph(text('one'))] }] },
        {
          type: 'taskList',
          content: [
            { type: 'taskItem', attrs: { checked: true }, content: [paragraph(text('done'))] },
          ],
        },
        { type: 'blockquote', content: [paragraph(text('quoted'))] },
        {
          type: 'callout',
          attrs: { icon: '🚀', family: 'mint' },
          content: [paragraph(text('note'))],
        },
        {
          type: 'details',
          content: [
            { type: 'detailsSummary', content: [text('More')] },
            { type: 'detailsContent', content: [paragraph(text('hidden'))] },
          ],
        },
        { type: 'codeBlock', attrs: { language: 'ts' }, content: [text('let x = 1;')] },
        { type: 'horizontalRule' },
      ),
    );
    for (const expected of [
      '<h2 data-level="1">Title</h2>',
      '<h4 data-level="3">Small</h4>',
      '<p>Plain</p>',
      '<ul><li><p>dot</p></li></ul>',
      '<ol><li><p>one</p></li></ol>',
      'data-checked="true"',
      '<blockquote><p>quoted</p></blockquote>',
      'data-type="callout" data-icon="🚀" data-family="mint"',
      '<summary>More</summary>',
      '<p>hidden</p>',
      'class="language-ts"',
      'let x = 1;',
      '<hr/>',
    ]) {
      expect(html).toContain(expected);
    }
  });

  it('renders every mark', () => {
    const html = renderHtml(
      doc(
        paragraph(
          text('b', { type: 'bold' }),
          text('i', { type: 'italic' }),
          text('u', { type: 'underline' }),
          text('s', { type: 'strike' }),
          text('c', { type: 'code' }),
          text('h', { type: 'highlight' }),
          text('l', { type: 'link', attrs: { href: 'https://allenkh.com/' } }),
        ),
      ),
    );
    expect(html).toBe(
      '<p><strong>b</strong><em>i</em><u>u</u><s>s</s><code>c</code><mark>h</mark>' +
        '<a rel="noopener noreferrer" href="https://allenkh.com/">l</a></p>',
    );
  });

  it('escapes text, and keeps a callout’s family to the five it knows', () => {
    const html = renderHtml(
      doc(paragraph(text('<script>alert(1)</script> & "quotes"')), {
        type: 'callout',
        attrs: { icon: '"><img>', family: 'neon' },
        content: [paragraph(text('x'))],
      }),
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp;');
    expect(html).not.toContain('<img>');
  });

  it('lets a site render a block its own way, and bring its own code block', () => {
    const html = renderHtml(
      doc({ type: 'codeBlock', attrs: { language: 'py' }, content: [text('pass')] }),
      {
        schema: { codeBlock: MyCodeBlock },
        nodes: {
          codeBlock: ({ node, children }) =>
            `<pre data-lang="${String(node.attrs['language'])}">${joinChildren(children)}</pre>`,
        },
      },
    );
    expect(html).toBe('<pre data-lang="py">pass</pre>');
  });

  it('closes every empty element that is not void, as a browser needs', () => {
    const html = renderHtml(
      doc({
        type: 'taskList',
        content: [{ type: 'taskItem', attrs: { checked: false }, content: [paragraph(text('a'))] }],
      }),
    );
    expect(html).not.toMatch(/<span\/>/);
    expect(html).toContain('<span></span>');
    expect(
      closeEmptyElements(
        '<p>a<br/>b</p><div class="x"/><mspace width="1em"/><img src="/a.png" alt=""/>',
      ),
    ).toBe(
      '<p>a<br/>b</p><div class="x"></div><mspace width="1em"></mspace><img src="/a.png" alt=""/>',
    );
  });
});

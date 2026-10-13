import { describe, expect, it } from 'vitest';
import { SectionError, sectionize } from './sections';

// What Astro's Markdown step makes of a page: flat, every `##` a top-level <h2 id>.
const ABOUT = [
  '<p>I’m Allen. I build things.</p>',
  '<h2 id="rockets">Rockets</h2>',
  '<p>They come back in <strong>one</strong> piece.</p>',
  '<ul>\n<li>one</li>\n<li>two</li>\n</ul>',
  '<h2 id="robots">Robots</h2>',
  '<p>They know where they are.</p>',
].join('\n');

describe('sectionize', () => {
  it('splits a text at its headings, and keeps their ids', () => {
    expect(sectionize(ABOUT)).toEqual({
      intro: '<p>I’m Allen. I build things.</p>',
      sections: [
        {
          id: 'rockets',
          title: 'Rockets',
          html: '<p>They come back in <strong>one</strong> piece.</p>\n<ul>\n<li>one</li>\n<li>two</li>\n</ul>',
        },
        { id: 'robots', title: 'Robots', html: '<p>They know where they are.</p>' },
      ],
    });
  });

  it('loses nothing: the parts and the headings make up the whole text again', () => {
    const { intro, sections } = sectionize(ABOUT);
    const again = [
      intro,
      ...sections.flatMap((section) => [
        `<h2 id="${section.id}">${section.title}</h2>`,
        section.html,
      ]),
    ].join('\n');
    expect(again).toBe(ABOUT);
  });

  it('a text with no heading is all intro', () => {
    expect(sectionize('<p>One line.</p>\n')).toEqual({ intro: '<p>One line.</p>', sections: [] });
    expect(sectionize('')).toEqual({ intro: '', sections: [] });
  });

  it('a text that opens with a heading has an empty intro', () => {
    expect(sectionize('<h2 id="a">A</h2>\n<p>Text.</p>')).toEqual({
      intro: '',
      sections: [{ id: 'a', title: 'A', html: '<p>Text.</p>' }],
    });
  });

  it('a heading with nothing under it is an empty section', () => {
    expect(sectionize('<h2 id="a">A</h2><h2 id="b">B</h2>').sections).toEqual([
      { id: 'a', title: 'A', html: '' },
      { id: 'b', title: 'B', html: '' },
    ]);
  });

  it('gives the title as plain text: it is printed again, as a link', () => {
    const title = (heading: string) => sectionize(`<h2 id="x">${heading}</h2>`).sections[0]?.title;
    expect(title('Programming &amp; tools')).toBe('Programming & tools');
    expect(title('Allen&#39;s &quot;tree&quot;')).toBe('Allen\'s "tree"');
    expect(title('2 &lt; 3 &#x26; 4 &gt; 3')).toBe('2 < 3 & 4 > 3');
    expect(title('  Security,\n  on purpose ')).toBe('Security, on purpose');
    // An ampersand that starts no reference is an ampersand.
    expect(title('R&D')).toBe('R&D');
  });

  it('reads an id however it is quoted, and whatever else the heading carries', () => {
    expect(sectionize(`<h2 class="x" id='the-bots' data-n=1>The bots</h2>`).sections[0]?.id).toBe(
      'the-bots',
    );
    expect(sectionize('<h2 id=bots>The bots</h2>').sections[0]?.id).toBe('bots');
  });

  it('keeps lower headings, void elements, comments and code inside their section', () => {
    const html = [
      '<h2 id="a">A</h2>',
      '<h3 id="a-1">Smaller</h3>',
      '<p>A line<br>and <img src="/x.png" alt="a > b"> a picture.</p><hr>',
      '<!-- <h2>not a heading</h2> -->',
      '<pre><code>&lt;h2&gt;not one either&lt;/h2&gt;</code></pre>',
      '<table><thead><tr><th>Line</th></tr></thead><tbody><tr><td>Boss</td></tr></tbody></table>',
      '<h2 id="b">B</h2>',
    ].join('\n');
    const { sections } = sectionize(html);
    expect(sections.map((section) => section.id)).toEqual(['a', 'b']);
    expect(sections[0]?.html).toContain('<h3 id="a-1">Smaller</h3>');
    expect(sections[0]?.html).toContain('</table>');
  });

  it('refuses a heading without an id', () => {
    expect(() => sectionize('<p>Intro.</p><h2>Rockets</h2>')).toThrow(SectionError);
    expect(() => sectionize('<p>Intro.</p><h2>Rockets</h2>')).toThrow(
      'the heading "Rockets" has no id',
    );
    expect(() => sectionize('<h2 id="">Rockets</h2>')).toThrow('has no id');
    // `data-id` is not an id.
    expect(() => sectionize('<h2 data-id="x">Rockets</h2>')).toThrow('has no id');
  });

  it('refuses markup inside a heading', () => {
    expect(() => sectionize('<h2 id="x">The <code>sim</code> lab</h2>')).toThrow(
      'the heading "The sim lab" has markup in it',
    );
    expect(() => sectionize('<h2 id="x"><a href="#x">Linked</a></h2>')).toThrow(SectionError);
  });

  it('refuses a heading that is not at the top level', () => {
    expect(() => sectionize('<blockquote>\n<h2 id="x">Quoted</h2>\n</blockquote>')).toThrow(
      'the heading "Quoted" is inside <blockquote>',
    );
    expect(() => sectionize('<ul><li><h2 id="x">Listed</h2></li></ul>')).toThrow('is inside <li>');
  });

  it('refuses an id used twice', () => {
    expect(() => sectionize('<h2 id="x">One</h2><p>Text.</p><h2 id="x">Two</h2>')).toThrow(
      'two headings share the id "x"',
    );
  });

  it('refuses a heading with no words, and a character reference it does not know', () => {
    expect(() => sectionize('<h2 id="x">  </h2>')).toThrow('has no words');
    expect(() => sectionize('<h2 id="x">Caf&eacute;</h2>')).toThrow('&eacute;');
  });

  it('refuses markup that does not balance: its depth could not be trusted', () => {
    expect(() => sectionize('<div><p>Text.</div>')).toThrow('does not balance');
    expect(() => sectionize('</p><h2 id="x">X</h2>')).toThrow('closes nothing');
    expect(() => sectionize('<div><p>Text.</p>')).toThrow('<div> is never closed');
    expect(() => sectionize('<h2 id="x">Never closed')).toThrow('never closed');
  });

  it('takes a self-closed element and raw text for what they are', () => {
    const html =
      '<p>A <span class="x"/> b</p><style>h2 > p { color: red }</style><h2 id="a">A</h2>';
    expect(sectionize(html).sections.map((section) => section.id)).toEqual(['a']);
  });
});

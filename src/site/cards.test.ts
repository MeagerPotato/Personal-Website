import { describe, expect, it } from 'vitest';
import {
  CARD,
  CardError,
  MAX_CARDS,
  entrySections,
  projectCards,
  sunCards,
  systemCards,
  textCards,
  wholeText,
  type TextEntry,
} from './cards';

/** A content entry whose Markdown came to this HTML. */
const entry = (html: string, over: Partial<TextEntry> = {}): TextEntry => ({
  id: 'fishai',
  filePath: 'src/content/projects/fishai/index.md',
  rendered: { html },
  ...over,
});

const heading = (id: string, title = id): string => `<h2 id="${id}">${title}</h2>\n<p>Text.</p>`;
const headings = (count: number): string =>
  Array.from({ length: count }, (_, index) => heading(`s${index + 1}`)).join('\n');
const idsOf = (cards: ReadonlyArray<{ id: string }>): string[] => cards.map((card) => card.id);

const NONE = { title: 'FishAI', gallery: false, moons: false, related: false };

describe('the named cards', () => {
  it('have ids of their own, and the quiet ones are the six a page never gave a heading', () => {
    const cards = Object.values(CARD);
    expect(new Set(idsOf(cards)).size).toBe(cards.length);
    expect(cards.filter((card) => 'quiet' in card).map((card) => card.title)).toEqual([
      'In short',
      'At a glance',
      'The story',
      'About this system',
      'Contact and PDF',
      'Ways to reach me',
    ]);
  });

  it('are ids a fragment can be: lowercase kebab-case, the page they belong to first', () => {
    for (const { id } of Object.values(CARD)) {
      expect(id).toMatch(/^(about|project|system|resume|contact)-[a-z]+$/);
    }
  });
});

describe('entrySections', () => {
  it('cuts the text Astro rendered, and takes an entry without one for an empty text', () => {
    expect(entrySections(entry(`<p>Intro.</p>\n${heading('a', 'A')}`))).toEqual({
      intro: '<p>Intro.</p>',
      sections: [{ id: 'a', title: 'A', html: '<p>Text.</p>' }],
    });
    expect(entrySections({ id: 'x' })).toEqual({ intro: '', sections: [] });
  });

  it('names the file when the text cannot be cut', () => {
    expect(() => entrySections(entry('<h2>No id</h2>'))).toThrow(CardError);
    expect(() => entrySections(entry('<h2>No id</h2>'))).toThrow(
      'src/content/projects/fishai/index.md: the heading "No id" has no id',
    );
    // Without a path, the id is the next best name.
    expect(() => entrySections({ id: 'fishai', rendered: { html: '<h2>No id</h2>' } })).toThrow(
      /^fishai: /,
    );
  });

  it('refuses a picture in the Markdown: the page prints the text without preparing it', () => {
    const pictured = entry('<p><img __ASTRO_IMAGE_="x"></p>', {
      rendered: { html: '<p>x</p>', metadata: { imagePaths: ['./shot.png'] } },
    });
    expect(() => entrySections(pictured)).toThrow(
      /a picture in the Markdown text \(\.\/shot\.png\)/,
    );
    const none = entry('<p>x</p>', {
      rendered: { html: '<p>x</p>', metadata: { imagePaths: [] } },
    });
    expect(entrySections(none).intro).toBe('<p>x</p>');
  });
});

describe('wholeText', () => {
  it('gives a text that is one piece, and refuses one with sections of its own', () => {
    expect(wholeText(entry('<p>One.</p>\n<p>Two.</p>'))).toBe('<p>One.</p>\n<p>Two.</p>');
    expect(() => wholeText(entry(`<p>One.</p>\n${heading('more', 'More')}`))).toThrow(
      'src/content/projects/fishai/index.md: the heading "More". This page\'s text is one card',
    );
  });
});

describe('textCards (the About page)', () => {
  it('opens with the intro under a quiet title, then one card per heading', () => {
    const cards = textCards(entry(`<p>Intro.</p>\n${headings(3)}`), CARD.aboutIntro);
    expect(cards.intro).toEqual({ card: CARD.aboutIntro, html: '<p>Intro.</p>' });
    expect(idsOf(cards.sections)).toEqual(['s1', 's2', 's3']);
    expect(idsOf(cards.all)).toEqual(['about-intro', 's1', 's2', 's3']);
  });

  it('has no intro card when the text opens with a heading', () => {
    const cards = textCards(entry(headings(2)), CARD.aboutIntro);
    expect(cards.intro).toBeUndefined();
    expect(idsOf(cards.all)).toEqual(['s1', 's2']);
  });

  it('has room for eight cards: the intro and seven headings, not eight', () => {
    expect(textCards(entry(`<p>Intro.</p>\n${headings(7)}`), CARD.aboutIntro).all).toHaveLength(
      MAX_CARDS,
    );
    expect(() => textCards(entry(`<p>Intro.</p>\n${headings(8)}`), CARD.aboutIntro)).toThrow(
      'src/content/projects/fishai/index.md: 9 cards; a page has room for 8 (merge two sections)',
    );
    // Without an intro, the eighth heading has its room.
    expect(textCards(entry(headings(8)), CARD.aboutIntro).all).toHaveLength(8);
  });
});

describe('projectCards', () => {
  it('a project with a text and nothing else: at a glance, then the story', () => {
    const cards = projectCards(entry('<p>One line.</p>'), NONE);
    expect(cards.glance).toEqual(CARD.projectGlance);
    expect(cards.story).toEqual({ card: CARD.projectStory, html: '<p>One line.</p>' });
    expect(cards.sections).toEqual([]);
    expect([cards.gallery, cards.moons, cards.related]).toEqual([undefined, undefined, undefined]);
    expect(idsOf(cards.all)).toEqual(['project-glance', 'project-story']);
  });

  it('everything a project can have, in the order the page shows it', () => {
    const cards = projectCards(entry(`<p>Intro.</p>\n${headings(3)}`), {
      title: 'Canadian Fish',
      gallery: true,
      moons: true,
      related: true,
    });
    expect(idsOf(cards.all)).toEqual([
      'project-glance',
      'project-story',
      's1',
      's2',
      's3',
      'project-gallery',
      'project-moons',
      'project-related',
    ]);
    expect(cards.all).toHaveLength(MAX_CARDS);
    expect(cards.gallery?.title).toBe('Gallery');
    // The moons' card names its planet, as the heading always did.
    expect(cards.moons).toEqual({ id: 'project-moons', title: 'Moons of Canadian Fish' });
    expect(cards.related?.title).toBe('Connected by motorway');
    // Only the two that never had a heading are quiet.
    expect(cards.all.filter((card) => card.quiet).map((card) => card.id)).toEqual([
      'project-glance',
      'project-story',
    ]);
  });

  it('leaves the story out when the text is empty, or opens with a heading', () => {
    expect(idsOf(projectCards(entry(''), NONE).all)).toEqual(['project-glance']);
    const cards = projectCards(entry(headings(2)), { ...NONE, related: true });
    expect(cards.story).toBeUndefined();
    expect(idsOf(cards.all)).toEqual(['project-glance', 's1', 's2', 'project-related']);
  });

  it('refuses a ninth card, and says which file and what to do', () => {
    const full = { title: 'FishAI', gallery: true, moons: true, related: true };
    expect(() => projectCards(entry(`<p>Intro.</p>\n${headings(4)}`), full)).toThrow(
      'src/content/projects/fishai/index.md: 9 cards; a page has room for 8 (merge two sections)',
    );
    expect(() => projectCards(entry(`<p>Intro.</p>\n${headings(4)}`), full)).toThrow(CardError);
  });

  it("refuses a heading that takes the id of one of the page's own cards", () => {
    expect(() =>
      projectCards(entry(`<p>Intro.</p>\n${heading('project-gallery', 'Project gallery')}`), {
        ...NONE,
        gallery: true,
      }),
    ).toThrow('two cards share the id "project-gallery"');
    // The same words on a project without a gallery are only a heading.
    expect(
      idsOf(projectCards(entry(heading('project-gallery', 'Project gallery')), NONE).all),
    ).toEqual(['project-glance', 'project-gallery']);
  });
});

describe('systemCards', () => {
  const sun = (html: string): TextEntry =>
    entry(html, { id: 'software', filePath: 'src/content/systems/software.md' });

  it('a sun with a text: about it under a quiet title, then its planets', () => {
    const cards = systemCards(sun('<p>What orbits here.</p>'), { link: false, twin: false });
    expect(cards.about).toEqual({ card: CARD.systemAbout, html: '<p>What orbits here.</p>' });
    expect(cards.planets).toEqual(CARD.systemPlanets);
    expect(idsOf(cards.all)).toEqual(['system-about', 'system-planets']);
  });

  it('keeps the first card for a link key or a twin note alone', () => {
    expect(systemCards(sun(''), { link: true, twin: false }).about).toEqual({
      card: CARD.systemAbout,
      html: '',
    });
    expect(idsOf(systemCards(sun(''), { link: false, twin: true }).all)).toEqual([
      'system-about',
      'system-planets',
    ]);
  });

  it('a sun with nothing to say has its planets and no more', () => {
    const cards = systemCards(sun(''), { link: false, twin: false });
    expect(cards.about).toBeUndefined();
    expect(idsOf(cards.all)).toEqual(['system-planets']);
  });

  it("refuses sections in a sun's text: the page has no cards for them", () => {
    expect(() =>
      systemCards(sun(`<p>Text.</p>\n${heading('more', 'More')}`), { link: false, twin: false }),
    ).toThrow('src/content/systems/software.md: the heading "More"');
  });
});

describe('sunCards (the projects index)', () => {
  const suns = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      id: `sun${index + 1}`,
      name: `Sun ${index + 1}`,
    }));

  it('names a card after each sun, with the id its section always had', () => {
    const software = { id: 'software', name: 'Software', tagline: 'Code.' };
    expect(sunCards([software], 'src/pages/projects/index.astro')).toEqual([
      { sun: software, card: { id: 'system-software', title: 'Software' } },
    ]);
  });

  it('has room for eight suns', () => {
    expect(sunCards(suns(8), 'the page')).toHaveLength(8);
    expect(() => sunCards(suns(9), 'src/pages/projects/index.astro')).toThrow(
      'src/pages/projects/index.astro: 9 cards; a page has room for 8',
    );
  });
});

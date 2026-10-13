import { SectionError, sectionize, type Section, type Sections } from './sections';

// Which cards a page has. Everything a page says inside <main> is a list of cards: a head (the
// route sign, the <h1>, the lede), then section cards, each opening with an <h2 id> whose words
// link to the card's own fragment (src/components/Card.astro; scripts/lib/cards.mjs holds the
// built pages to it). The .astro pages are markup: which cards a page has, what they are called
// and how many there may be is decided here, in plain functions.

/** How many section cards a page has room for, after its head. */
export const MAX_CARDS = 8;

/** What `Card` needs to know about a card: spread it onto the component. */
export interface CardRef {
  /** The id of the card's heading: its fragment, so `/about/#rockets` names the card. */
  id: string;
  title: string;
  /**
   * A title the page itself never showed: it is there for a screen reader and for the keyboard
   * (it shows while its link has focus), and it is the card's title row where cards are drawn
   * as cards.
   */
  quiet?: boolean;
}

/** A card whose body is a piece of the page's Markdown, as Astro rendered it. */
export interface TextCard {
  card: CardRef;
  html: string;
}

export class CardError extends Error {}

/**
 * The cards that are a part of a page's layout, not a heading of its text. The quiet ones are
 * the parts of a page that never had a heading: these are the names they go by. Ids are API: a
 * card's id is its fragment, so it is in every URL that was shared of it.
 */
export const CARD = {
  aboutIntro: { id: 'about-intro', title: 'In short', quiet: true },
  projectGlance: { id: 'project-glance', title: 'At a glance', quiet: true },
  projectStory: { id: 'project-story', title: 'The story', quiet: true },
  projectGallery: { id: 'project-gallery', title: 'Gallery' },
  /** On the page it names its planet: "Moons of Canadian Fish" (projectCards). */
  projectMoons: { id: 'project-moons', title: 'Moons' },
  projectRelated: { id: 'project-related', title: 'Connected by motorway' },
  systemAbout: { id: 'system-about', title: 'About this system', quiet: true },
  systemPlanets: { id: 'system-planets', title: 'Planets' },
  resumeContact: { id: 'resume-contact', title: 'Contact and PDF', quiet: true },
  resumeEducation: { id: 'resume-education', title: 'Education' },
  resumeExperience: { id: 'resume-experience', title: 'Experience' },
  resumeLeadership: { id: 'resume-leadership', title: 'Leadership' },
  resumeSkills: { id: 'resume-skills', title: 'Skills' },
  resumeAwards: { id: 'resume-awards', title: 'Awards' },
  contactWays: { id: 'contact-ways', title: 'Ways to reach me', quiet: true },
} as const satisfies Record<string, CardRef>;

/** A content entry, as far as its text goes (Astro's own type has more). */
export interface TextEntry {
  id: string;
  /** Where the entry was read from, for a message a person can act on. */
  filePath?: string | undefined;
  rendered?:
    | {
        html: string;
        metadata?: { imagePaths?: readonly string[] | undefined } | undefined;
      }
    | undefined;
}

const fileOf = (entry: TextEntry): string => entry.filePath ?? entry.id;

/**
 * An entry's text, cut at its `##` headings. The page prints the HTML Astro rendered, as it is,
 * which skips the step that prepares a Markdown picture: so a text with one is refused here (a
 * project's pictures are its cover and its gallery, which do go through that step).
 */
export function entrySections(entry: TextEntry): Sections {
  const file = fileOf(entry);
  const pictures = entry.rendered?.metadata?.imagePaths ?? [];
  if (pictures.length > 0) {
    throw new CardError(
      `${file}: a picture in the Markdown text (${pictures.join(', ')}). The text is printed as ` +
        'it was rendered, without the step that prepares pictures: use the cover or the gallery.',
    );
  }
  try {
    return sectionize(entry.rendered?.html ?? '');
  } catch (error) {
    if (error instanceof SectionError) throw new CardError(`${file}: ${error.message}`);
    throw error;
  }
}

/** The cards of one page, in order: no more than a page has room for, and no id twice. */
function checked(file: string, cards: readonly CardRef[]): CardRef[] {
  if (cards.length > MAX_CARDS) {
    throw new CardError(
      `${file}: ${cards.length} cards; a page has room for ${MAX_CARDS} (merge two sections)`,
    );
  }
  const ids = new Set<string>();
  for (const card of cards) {
    if (ids.has(card.id)) {
      throw new CardError(
        `${file}: two cards share the id "${card.id}" (a heading that takes the id of one of ` +
          "the page's own cards needs other words)",
      );
    }
    ids.add(card.id);
  }
  return [...cards];
}

const refOf = ({ id, title }: Section): CardRef => ({ id, title });
const present = (cards: ReadonlyArray<CardRef | undefined>): CardRef[] =>
  cards.flatMap((card) => (card ? [card] : []));

/** A text that is one piece: the words, or a refusal that names the first heading in the way. */
export function wholeText(entry: TextEntry): string {
  const { intro, sections } = entrySections(entry);
  const heading = sections[0];
  if (heading !== undefined) {
    throw new CardError(
      `${fileOf(entry)}: the heading "${heading.title}". This page's text is one card: it has ` +
        'no room for sections of its own',
    );
  }
  return intro;
}

export interface TextCards {
  /** What the text opens with, before its first heading. None when it opens with a heading. */
  intro: TextCard | undefined;
  /** One card per `##`. */
  sections: Section[];
  /** Every card of the page, in the order the page shows them. */
  all: CardRef[];
}

/** A page that is its text (About): the opening under a quiet title, then a card per heading. */
export function textCards(entry: TextEntry, opening: CardRef): TextCards {
  const { intro, sections } = entrySections(entry);
  const first = intro === '' ? undefined : { card: opening, html: intro };
  return {
    intro: first,
    sections,
    all: checked(fileOf(entry), [...present([first?.card]), ...sections.map(refOf)]),
  };
}

export interface ProjectCards {
  /** The link keys, the cover and the facts. Every project has it. */
  glance: CardRef;
  /** The text before the first heading. None when the text opens with a heading, or is empty. */
  story: TextCard | undefined;
  /** One card per `##`. */
  sections: Section[];
  gallery: CardRef | undefined;
  moons: CardRef | undefined;
  related: CardRef | undefined;
  /** Every card of the page, in the order the page shows them. */
  all: CardRef[];
}

/** A planet's or a moon's page: which cards it has, in the order `all` gives. */
export function projectCards(
  entry: TextEntry,
  has: { title: string; gallery: boolean; moons: boolean; related: boolean },
): ProjectCards {
  const { intro, sections } = entrySections(entry);
  const glance: CardRef = CARD.projectGlance;
  const story = intro === '' ? undefined : { card: CARD.projectStory, html: intro };
  const gallery = has.gallery ? CARD.projectGallery : undefined;
  const moons = has.moons ? { ...CARD.projectMoons, title: `Moons of ${has.title}` } : undefined;
  const related = has.related ? CARD.projectRelated : undefined;
  return {
    glance,
    story,
    sections,
    gallery,
    moons,
    related,
    all: checked(fileOf(entry), [
      glance,
      ...present([story?.card]),
      ...sections.map(refOf),
      ...present([gallery, moons, related]),
    ]),
  };
}

export interface SystemCards {
  /**
   * The key to the system's own site, its text and its twin note, under a quiet title. None for
   * a sun with none of the three. `html` is its text, "" when it has none.
   */
  about: TextCard | undefined;
  planets: CardRef;
  /** Every card of the page, in the order the page shows them. */
  all: CardRef[];
}

/** A sun's page: its planets, and before them what there is to say about it, if anything. */
export function systemCards(entry: TextEntry, has: { link: boolean; twin: boolean }): SystemCards {
  const html = wholeText(entry);
  const about = html !== '' || has.link || has.twin ? { card: CARD.systemAbout, html } : undefined;
  const planets: CardRef = CARD.systemPlanets;
  return {
    about,
    planets,
    all: checked(fileOf(entry), [...present([about?.card]), planets]),
  };
}

/** The projects index: one card per sun, named after it. `file` is the page, for the refusal. */
export function sunCards<Sun extends { id: string; name: string }>(
  suns: readonly Sun[],
  file: string,
): Array<{ sun: Sun; card: CardRef }> {
  const cards = suns.map((sun) => ({ sun, card: { id: `system-${sun.id}`, title: sun.name } }));
  checked(
    file,
    cards.map(({ card }) => card),
  );
  return cards;
}

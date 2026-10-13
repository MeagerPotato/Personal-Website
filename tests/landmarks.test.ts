import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readRealInput } from '../scripts/journeys/galaxies';
import { CARD } from '../src/site/cards';
import { buildUniverse } from '../src/universe/data/build';
import { tuning } from '../src/universe/design/tuning';
import { BODIES } from '../src/universe/design/worlds/bodies';
import { LANDMARKS } from '../src/universe/design/worlds/landmarks';
import { NEAR } from '../src/universe/design/worlds/near';
import { landmarkPoint, type Landmark, type LandmarkTable } from '../src/universe/sim/landmarks';
import type { Vec3 } from '../src/universe/sim/world/kit';
import { pivotOf, type Item, type PartRow } from '../src/universe/sim/world/rows';

// design/worlds/landmarks.ts says what each card of a page points at, BY THE BODY'S ID and BY THE
// CARD'S HEADING. Rename a project, reword a heading or move a part, and a landmark would quietly
// stop being read, or point at nothing: so every body must be one of the real galaxy (drafts
// included: a landmark may be ready before its page is), every card a heading that page can
// have, every latitude one the camera can turn to, and a landmark that names a part must stand
// where that part does.

const real = buildUniverse(readRealInput(true));
const ids = new Set(real.bodies.map((body) => body.id));
const DEG = Math.PI / 180;

/** The entries of `table`, flat: [body, card, landmark]. */
function entries(table: LandmarkTable): [string, string, Landmark][] {
  return Object.entries(table).flatMap(([body, marks]) =>
    Object.entries(marks ?? {}).flatMap(([card, mark]): [string, string, Landmark][] =>
      mark ? [[body, card, mark]] : [],
    ),
  );
}

/** The bodies of `table` that the galaxy does not have. */
const strangers = (table: LandmarkTable): string[] =>
  Object.keys(table).filter((body) => !ids.has(body));

/** The text a body's page is written in, if it has one of its own. */
function textOf(body: string): string | null {
  const [kind, id] = body.split('/');
  const path =
    kind === 'page'
      ? `pages/${id}.md`
      : kind === 'project'
        ? `projects/${id}/index.md`
        : `systems/${id}.md`;
  const file = fileURLToPath(new URL(`../src/content/${path}`, import.meta.url));
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

/** A heading's id as the build slugs it: lower case, words joined by hyphens, the rest dropped. */
const slug = (heading: string): string =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');

/** Every card a body's page can have: the ones every such page has, and its text's own headings. */
function cardsOf(body: string): Set<string> {
  const own = [...(textOf(body) ?? '').matchAll(/^## +(.+)$/gm)].map((match) =>
    slug(match[1] ?? ''),
  );
  return new Set([...Object.values(CARD).map((card) => card.id), ...own]);
}

/** Degrees between a landmark and a place in its body's frame, seen from the body's middle. */
function apart(mark: Landmark, place: Vec3): number {
  const at = landmarkPoint(mark, 1, { x: 0, y: 0, z: 0 });
  const long = Math.hypot(at.x, at.y, at.z) * Math.hypot(...place);
  const cos = (at.x * place[0] + at.y * place[1] + at.z * place[2]) / long;
  return Math.acos(Math.min(1, Math.max(-1, cos))) / DEG;
}

/** The items of a part of a body, from its everyday rows or its close-up ones. */
function partOf(body: string, name: string): readonly Item[] | null {
  const far = BODIES[body]?.rows;
  const rows = typeof far === 'function' ? far({ map: false }) : far;
  const parts: readonly PartRow[] = [
    ...((rows?.slice(1) ?? []) as PartRow[]),
    ...(NEAR[body] ?? []),
  ];
  const row = parts.find((part) => part[0] === name);
  return row ? (row.slice(2) as Item[]) : null;
}

describe('design/worlds/landmarks.ts', () => {
  it('gives landmarks only to bodies that exist', () => {
    expect(
      strangers(LANDMARKS),
      'a key in src/universe/design/worlds/landmarks.ts names no body: rename it to the body’s ' +
        'id in /universe.json (page/<id>, project/<id>, system/<id>), or remove it',
    ).toEqual([]);
    // And it would notice one that names nothing.
    expect(strangers({ 'page/about': {}, 'project/gone': {} })).toEqual(['project/gone']);
  });

  it('keys each landmark by a heading its page can have', () => {
    for (const [body, card] of entries(LANDMARKS)) {
      expect(
        cardsOf(body).has(card),
        `${body} has no card '${card}': a landmark's key is the id of the card's heading ` +
          '(the fragment in its link), so reword the two together',
      ).toBe(true);
    }
    // About's text has a Rockets heading and no Submarines one.
    expect(cardsOf('page/about').has('rockets')).toBe(true);
    expect(cardsOf('page/about').has('submarines')).toBe(false);
    expect(slug('What the lab found')).toBe('what-the-lab-found');
  });

  it('keeps every latitude where the camera can turn to it', () => {
    // The orbit camera goes round a body and never climbs: a landmark on the pole has no side to
    // turn to, and one far underneath is never seen from above.
    for (const [body, card, mark] of entries(LANDMARKS)) {
      expect(mark.lat, `${body} ${card}`).toBeGreaterThanOrEqual(-15);
      expect(mark.lat, `${body} ${card}`).toBeLessThanOrEqual(85);
    }
    expect(tuning.deck.defaultLatDeg).toBeGreaterThanOrEqual(-15);
    expect(tuning.deck.defaultLatDeg).toBeLessThanOrEqual(85);
  });

  it('names only parts its body has', () => {
    for (const [body, card, mark] of entries(LANDMARKS)) {
      if (mark.part === undefined) continue;
      expect(partOf(body, mark.part), `${body} ${card}: no part '${mark.part}'`).not.toBeNull();
    }
    expect(partOf('page/about', 'launch-pad')).not.toBeNull();
    expect(partOf('page/about', 'landing-pad')).toBeNull();
  });

  it('stands a landmark where the part it names stands, to a degree', () => {
    // A part stood on its world (an `s` or `n` placement) has a pivot off the middle: that is
    // where it is. One made of several pieces has none; those are held below, each by name.
    let held = 0;
    for (const [body, card, mark] of entries(LANDMARKS)) {
      const items = mark.part === undefined ? null : partOf(body, mark.part);
      if (!items) continue;
      const { origin } = pivotOf(items);
      if (Math.hypot(...origin) < 1e-6) continue;
      held += 1;
      expect(apart(mark, origin), `${body} ${card} against its part '${mark.part}'`).toBeLessThan(
        1,
      );
    }
    // About Me's launch pad, at least: if this ever counts none, the check has gone blind.
    expect(held).toBeGreaterThanOrEqual(1);
  });

  it('points each section of the resume at its own pod, in the page’s order', () => {
    // The pods are one part of five pieces round the wheel (`around`): piece j stands at bearing
    // phase + j / n of a turn, on the ring's radius, and wears the page's j-th pictogram.
    const items = partOf('page/resume', 'stop-pods');
    const ring = items?.[0] as unknown as readonly [string, number, number, number, number];
    if (!Array.isArray(ring) || ring[0] !== 'around') throw new Error('the pods are no ring now');
    const [, n, phase, r, y] = ring;
    const sections = [
      CARD.resumeEducation,
      CARD.resumeExperience,
      CARD.resumeLeadership,
      CARD.resumeSkills,
      CARD.resumeAwards,
    ];
    expect(n).toBe(sections.length);
    sections.forEach((card, j) => {
      const mark = LANDMARKS['page/resume']?.[card.id];
      if (!mark) throw new Error(`the resume's ${card.id} has no landmark`);
      const bearing = phase + (j / n) * Math.PI * 2;
      const pod: Vec3 = [r * Math.sin(bearing), y, -r * Math.cos(bearing)];
      expect(apart(mark, pod), `${card.id} against pod ${j}`).toBeLessThan(1);
      expect(mark.part).toBe('stop-pods');
    });
  });

  it('points the resume’s contact line at the two pages on the mast', () => {
    // Two pieces again: the landmark is between them, as near the top of the mast as a latitude
    // the camera can turn to allows.
    const items = partOf('page/resume', 'two-pages') ?? [];
    const tops = items.map((item) => {
      const mod = Array.isArray(item) ? item.at(-1) : undefined;
      const at = (mod as { at?: Vec3 } | undefined)?.at;
      if (!at) throw new Error('a page of the two has no place of its own now');
      return at;
    });
    expect(tops).toHaveLength(2);
    const between: Vec3 = [
      ((tops[0]?.[0] ?? 0) + (tops[1]?.[0] ?? 0)) / 2,
      ((tops[0]?.[1] ?? 0) + (tops[1]?.[1] ?? 0)) / 2,
      ((tops[0]?.[2] ?? 0) + (tops[1]?.[2] ?? 0)) / 2,
    ];
    const mark = LANDMARKS['page/resume']?.[CARD.resumeContact.id];
    if (!mark) throw new Error('the resume’s contact line has no landmark');
    expect(mark.part).toBe('two-pages');
    expect(apart(mark, between)).toBeLessThan(6);
    // And at their height, not out in space above them.
    expect(1 + (mark.alt ?? 0)).toBeCloseTo(Math.hypot(...between), 1);
  });
});

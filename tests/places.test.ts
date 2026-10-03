import { describe, expect, it } from 'vitest';
import { readRealInput } from '../scripts/journeys/galaxies';
import { buildUniverse } from '../src/universe/data/build';
import { handPlace, round, slotPosition } from '../src/universe/data/layout';
import type { ProjectInput, UniverseInput } from '../src/universe/data/types';
import { tuning } from '../src/universe/design/tuning';

// THE PLACE PIN. Where every system of the real galaxy stands, to the hundredth of a unit that
// /universe.json keeps. A visitor learns where things are, so a system keeps its place for ever
// (docs/PLAN.md §5.4): data/layout.test.ts pins the slots, and this pins who stands where, the
// one placed by hand included. A NEW system adds a line here and changes no other; a line that
// changes is a system that moved, and only Allen moves one (Research, on 2026-10-03, from slot 2
// below home to the pocket of slot 5, above Hackathons and left of Projects on the star map).

const MOVED =
  'a system of the real galaxy moved: every visitor finds it somewhere else, and the journeys, ' +
  "the star map's first view and the names on it were measured where it was (docs/PLAN.md §5.4)";

const L = tuning.layout;

const planet = (id: string, over: Partial<ProjectInput>): ProjectInput => ({
  id,
  title: id,
  href: `/projects/${id}/`,
  size: 'l',
  biome: 'terra',
  rings: false,
  decorMoons: 0,
  flagship: false,
  related: [],
  draft: false,
  planned: true,
  ...over,
});

describe('where the systems of the real galaxy stand (the place pin)', () => {
  const real = readRealInput();
  const manifest = buildUniverse(real);
  const orders = new Map(real.systems.map((system) => [system.id, system]));

  it('stands where it did', () => {
    expect(Object.fromEntries(manifest.systems.map(({ id, position }) => [id, position])), MOVED)
      // (x is to the LEFT on the star map, z up it.)
      .toEqual({
        home: [0, 0],
        projects: [-487.9, 487.9],
        hackathons: [666.49, 178.59],
        research: [218, 813],
      });
  });

  it("stands on its slot's centre, all but the ones placed by hand", () => {
    const byHand: string[] = [];
    for (const { id, position } of manifest.systems) {
      const input = orders.get(id);
      if (input?.order === undefined) continue;
      if (input.position !== 'auto') byHand.push(id);
      else expect(position, id).toEqual(slotPosition(input.order).map((value) => round(value)));
    }
    expect(byHand).toEqual(['research']);
  });

  describe('Research, placed by hand in the room of slot 5', () => {
    const research = orders.get('research');
    const reach = manifest.systems.find((system) => system.id === 'research')?.radius ?? NaN;
    const place =
      research?.order !== undefined && research.position !== 'auto'
        ? handPlace(research.order, research.position)
        : null;
    const withMore = (extra: ProjectInput): UniverseInput => ({
      ...real,
      projects: [...real.projects, extra],
    });

    it('leaves every other slot the room of a full-size system', () => {
      expect(research?.order).toBe(5);
      // As near slot 1 (Projects) as slot 3 (Hackathons): 777 u from the centre of each, where a
      // full-size system with its gap takes 611.
      expect(place?.distance).toBeCloseTo(776.93, 2);
      expect(place?.room).toBeCloseTo(165.93, 2);
      expect(reach).toBeLessThanOrEqual(place?.room ?? NaN);
      expect(place?.room).toBeLessThan(L.maxSystemRadius);
    });

    it('has room there for one more planet or moon of any size, as the Projects binary has', () => {
      // (A planet of size l is the most any one addition takes: 53.6 u. tuning.layout says so of
      // maxSystemRadius too.)
      const grown = (extra: ProjectInput): number =>
        buildUniverse(withMore(extra)).systems.find((system) => system.id === 'research')?.radius ??
        NaN;
      const withPlanet = grown(planet('one-more-question', { system: 'research' }));
      const withMoon = grown(planet('one-more-market', { parent: 'sports-analysis' }));
      expect(withPlanet).toBeGreaterThan(reach);
      expect(withPlanet).toBeLessThanOrEqual(place?.room ?? NaN);
      expect(withMoon).toBeGreaterThan(reach);
      expect(withMoon).toBeLessThanOrEqual(place?.room ?? NaN);
    });
  });
});

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
        research: [214, 800],
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
      // On the line from home to its own slot's centre, which is as near slot 1 (Projects) as
      // slot 3 (Hackathons): 768 u from the centre of each (slot 1's the nearer by half a unit),
      // where a full-size system with its gap takes 611.
      expect(place?.slot).toBe(1);
      expect(place?.distance).toBeCloseTo(768.16, 2);
      expect(place?.room).toBeCloseTo(157.16, 2);
      expect(reach).toBeLessThanOrEqual(place?.room ?? NaN);
      expect(place?.room).toBeLessThan(L.maxSystemRadius);
    });

    it('has room there for one more project: a planet of the usual size, or a moon of any', () => {
      // Every planet of the real galaxy is of size m, and one more of them here reaches 150.6 u;
      // a moon of the largest size, 154.2 u. Both fit.
      const grown = (extra: ProjectInput): number =>
        buildUniverse(withMore(extra)).systems.find((system) => system.id === 'research')?.radius ??
        NaN;
      const withPlanet = grown(planet('one-more-question', { system: 'research', size: 'm' }));
      const withMoon = grown(planet('one-more-market', { parent: 'sports-analysis' }));
      expect(withPlanet).toBeGreaterThan(reach);
      expect(withPlanet).toBeLessThanOrEqual(place?.room ?? NaN);
      expect(withMoon).toBeGreaterThan(reach);
      expect(withMoon).toBeLessThanOrEqual(place?.room ?? NaN);
      // A LARGE planet (165.8 u) is the one addition that does not: the build refuses it, and
      // says how far the place has room and which way to move it (data/build.test.ts).
      expect(() =>
        buildUniverse(withMore(planet('one-large-question', { system: 'research' }))),
      ).toThrow(/it has room to reach 157\.16 u, and it reaches 165\.8 u/);
    });
  });
});

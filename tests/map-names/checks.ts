import { afterEach, describe, expect, it, vi } from 'vitest';
import { spread, watch, type GalaxyKind, type Look, type ScreenSize, type Seen } from './harness';

// WHAT `npm test` HOLDS THE STAR MAP'S NAMES TO (tests/map-names/harness.ts says how they are
// watched). Samples of a turn, spread over it: a few seconds of work a screen, so that `npm run
// verify` stays quick. The whole turns, and every number docs/PLAN.md §5.4 quotes, are `npm run
// map-names` (sweep.measure.ts).
//
// Everywhere: no name flickers at rest (changes again within three frames), no planet's or moon's
// tag lies on a sun or the home planet, and a name changes no more often than `LIMITS` says. At
// the view the map opens on, and zoomed in once and twice: every system named whenever its body
// is in view, and no name changes twice within a second. Opening with the blend: every system
// named in the frame the map arrives, and nothing changed again in the second after.

/**
 * The most changes a minute at rest, per look, and how many tags of systems may lie on another
 * system's sun, on average, at the fit (a last resort: ui/Labels.ts). About twice what these
 * samples counted on 2026-09-30, so that a change that makes names hop, or lays them over the
 * landmarks, fails by far. Under the fingers, half as much again, and the flickers in the 100 s:
 * while the view slides past them, names at its edges come and go within a few frames, as many as
 * before the names had places.
 */
const LIMITS: Readonly<
  Record<
    ScreenSize,
    {
      fit: number;
      zoomed: readonly [number, number, number];
      pan: number;
      fingers: readonly [perMinute: number, flickers: number];
      landmarks: number;
    }
  >
> = {
  '360x740': { fit: 1, zoomed: [1, 6, 11], pan: 2, fingers: [310, 30], landmarks: 0.2 },
  '412x839': { fit: 1, zoomed: [4, 10, 17], pan: 3, fingers: [330, 30], landmarks: 0.2 },
  '1280x800': { fit: 9, zoomed: [8, 17, 27], pan: 25, fingers: [320, 66], landmarks: 0.1 },
};

/** A page open beside the map: the laptop's side panel, a phone's sheet (as tall as at 60%). */
const PANEL: Readonly<Record<ScreenSize, Look['inset']>> = {
  '360x740': { bottom: 444 },
  '412x839': { bottom: 503 },
  '1280x800': { right: 480 },
};

function onNoLandmark(seen: Seen): void {
  expect(seen.othersOnLandmarks, "a planet's or a moon's tag on a sun").toBe(0);
}

function steady(seen: Seen): void {
  expect(seen.flickers, 'a name that changed again within three frames').toEqual([]);
  onNoLandmark(seen);
}

function still(seen: Seen, most: number): void {
  steady(seen);
  expect(seen.twice, 'a name that changed twice within a second').toEqual([]);
  expect(seen.perMinute, 'changes a minute').toBeLessThanOrEqual(most);
}

/** The checks for one screen. */
export function checks(size: ScreenSize): void {
  const most = LIMITS[size];
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe(`the star map's names at ${size}`, () => {
    it('name every system at the view the map opens on, and hold still there', () => {
      const seen = watch({ size }, spread(12, 20));
      still(seen, most.fit);
      expect(seen.unnamed, 'a system with no name').toEqual({});
      expect(seen.onLandmarks).toBeLessThanOrEqual(most.landmarks);
    });

    it('hold still zoomed in, and name every system zoomed in once and twice', () => {
      for (const [press, limit] of most.zoomed.entries()) {
        const seen = watch({ size, zoomIns: press + 1 }, spread(8, 20));
        if (press < 2) {
          still(seen, limit);
          expect(seen.unnamed, `a system with no name, ${press + 1} presses in`).toEqual({});
        } else {
          // Three presses in, bodies cross the edges of the view all the time, and a name that
          // has just appeared may have to go with its body.
          steady(seen);
          expect(seen.perMinute).toBeLessThanOrEqual(limit);
        }
      }
    });

    it('name every system the moment the map arrives from the blend, and leave them be', () => {
      const seen = watch({ size, open: 'blend' }, spread(8, 4));
      expect(seen.blend?.missingOnArrival, 'a system with no name as the map arrived').toEqual([]);
      still(seen, most.fit);
    });

    it('hold still dragged to an edge with the keys', () => {
      const key = size === '1280x800' ? 'ArrowDown' : 'ArrowLeft';
      still(watch({ size, zoomIns: 2, pan: [[key, 4]] }, spread(4, 20)), most.pan);
    });

    it('hold still beside a page', () => {
      const seen = watch({ size, inset: PANEL[size] }, spread(6, 20));
      still(seen, most.fit);
      // A phone's sheet leaves a strip of the map too short for every system's name.
      if (size === '1280x800') expect(seen.unnamed, 'a system with no name').toEqual({});
    });

    it('keep the systems named under the fingers: strokes, pinches and a slow drag', () => {
      const seen = watch({ size, fingers: true }, spread(2, 50));
      onNoLandmark(seen);
      expect(seen.perMinute).toBeLessThanOrEqual(most.fingers[0]);
      expect(seen.flickers.length).toBeLessThanOrEqual(most.fingers[1]);
      for (const [system, share] of Object.entries(seen.unnamed)) {
        expect(share, `${system} unnamed`).toBeLessThanOrEqual(0.05);
      }
    });
  });
}

/** Grown galaxies (scripts/journeys/galaxies.ts): six and eight systems. */
export function grownChecks(): void {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const looks: ReadonlyArray<readonly [string, Look & { galaxy: GalaxyKind }, number]> = [
    ['six systems at 360x740, at the fit', { size: '360x740', galaxy: 6 }, 0],
    ['eight systems at 412x839, zoomed in once', { size: '412x839', galaxy: 8, zoomIns: 1 }, 0],
    ['eight systems at 1280x800, at the fit', { size: '1280x800', galaxy: 8 }, 0],
    // Some 6.8% of a whole turn: there the last system's name has room only in some ways of
    // placing all eight, which the search finds in time most of the time.
    ['eight systems at 360x740, zoomed in once', { size: '360x740', galaxy: 8, zoomIns: 1 }, 0.25],
  ];
  describe("the star map's names in grown galaxies", () => {
    for (const [name, look, unnamed] of looks) {
      it(`name every system, and hold still: ${name}`, () => {
        const seen = watch(look, spread(6, 20, look.galaxy));
        still(seen, 2);
        for (const [system, share] of Object.entries(seen.unnamed)) {
          expect(share, `${system} unnamed`).toBeLessThanOrEqual(unnamed);
        }
      });
    }
  });
}

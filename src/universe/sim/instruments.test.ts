import { describe, expect, it } from 'vitest';
import { tuning } from '../design/tuning';
import { createShipState, maxYawRate, stepFlight, topSpeed } from './flight';
import {
  MERIDIANS,
  bearingOf,
  deckLayout,
  deckShows,
  etaShown,
  gOf,
  isBehind,
  lampsOf,
  markerShare,
  meridians,
  offBearing,
  relativeBearing,
  systemAt,
  warpTier,
  wholeBearing,
  type DeckMode,
} from './instruments';

const P = tuning.instruments;
const STEP = 1 / tuning.loop.stepHz;
const REM = 16;

/** The side panel of a wide screen: 30rem wide, --space-6 from the right edge (global.css). */
const SIDE_PANEL = 480 + 24;

describe('how big the deck is', () => {
  const layout = (width: number, height: number, right = 0, bottom = 0, rem = REM) =>
    deckLayout(width - right, height - bottom, bottom > 0, rem, P);

  it('is the whole cluster in open sky from 768 by 576', () => {
    expect(layout(1366, 650)).toBe('full');
    expect(layout(1280, 720)).toBe('full');
    expect(layout(1280, 800)).toBe('full');
    expect(layout(768, 576)).toBe('full');
    // A tablet, either way up.
    expect(layout(768, 1024)).toBe('full');
    expect(layout(1024, 768)).toBe('full');
  });

  it('is the whole cluster beside an open side panel from 1272 wide, and the strip under that', () => {
    expect(layout(1280, 800, SIDE_PANEL)).toBe('full');
    expect(layout(1272, 800, SIDE_PANEL)).toBe('full');
    expect(layout(1271, 800, SIDE_PANEL)).toBe('strip');
    expect(layout(1024, 768, SIDE_PANEL)).toBe('strip');
  });

  it('is the strip in any window under 576 tall, and on a phone either way up', () => {
    expect(layout(1366, 575)).toBe('strip');
    expect(layout(900, 500)).toBe('strip');
    expect(layout(767, 900)).toBe('strip');
    expect(layout(360, 740)).toBe('strip');
    expect(layout(320, 568)).toBe('strip');
    expect(layout(740, 360)).toBe('strip');
    expect(layout(568, 320)).toBe('strip');
    // The smallest view that still has one.
    expect(layout(296, 320)).toBe('strip');
  });

  it('is nothing under a bottom sheet, however much sky the sheet leaves', () => {
    expect(layout(360, 740, 0, 429)).toBe('off');
    expect(layout(412, 915, 0, 1)).toBe('off');
    expect(layout(1280, 800, 0, 100)).toBe('off');
  });

  it('is nothing where even the strip has no room: 320 by 256, a laptop at 400 % zoom', () => {
    expect(layout(320, 256)).toBe('off');
    expect(layout(295, 600)).toBe('off');
    expect(layout(600, 319)).toBe('off');
  });

  it('counts in rem, so a page with bigger type gets the strip where the cluster will not fit', () => {
    // 1280 by 720 at 200 % zoom is 640 by 360 CSS px.
    expect(layout(640, 360)).toBe('strip');
    // A visitor who set their type to 20 px: 1280 px is 64rem, 720 px is 36rem.
    expect(layout(1280, 720, 0, 0, 20)).toBe('full');
    expect(layout(1280, 700, 0, 0, 20)).toBe('strip');
    // A root size nobody can read is taken for the usual one.
    expect(layout(1280, 720, 0, 0, 0)).toBe('full');
  });
});

describe('whether the deck shows', () => {
  it('shows while the ship is under way and the sky is in view', () => {
    expect(deckShows(false, false)).toBe(true);
    expect(deckShows(true, false)).toBe(false);
    expect(deckShows(false, true)).toBe(false);
    expect(deckShows(true, true)).toBe(false);
  });
});

describe('bearings', () => {
  it('reads a heading as a compass does: north is +Z, and it counts clockwise', () => {
    expect(bearingOf(0)).toBe(0);
    // Counter-clockwise from above is to the pilot's left, which from north is west.
    expect(bearingOf(Math.PI / 2)).toBeCloseTo(270, 9);
    expect(bearingOf(-Math.PI / 2)).toBeCloseTo(90, 9);
    expect(bearingOf(Math.PI)).toBeCloseTo(180, 9);
    // The nose along -X (east on the map, where +X is to the left).
    expect(bearingOf(Math.atan2(-1, 0))).toBeCloseTo(90, 9);
  });

  it('wraps an unwrapped heading, and is never 360', () => {
    expect(bearingOf(100 * Math.PI + 0.1)).toBeCloseTo(360 - (0.1 * 180) / Math.PI, 6);
    expect(bearingOf(-100 * Math.PI - 0.1)).toBeCloseTo((0.1 * 180) / Math.PI, 6);
    for (const heading of [1e-18, -1e-18, 2 * Math.PI, -2 * Math.PI, 1e-9, -1e-9, 12345.678]) {
      const bearing = bearingOf(heading);
      expect(bearing).toBeGreaterThanOrEqual(0);
      expect(bearing).toBeLessThan(360);
      const whole = wholeBearing(heading);
      expect(Number.isInteger(whole)).toBe(true);
      expect(whole).toBeGreaterThanOrEqual(0);
      expect(whole).toBeLessThan(360);
    }
    // 359.7 degrees is "000" on the chip, not "360".
    expect(wholeBearing((0.3 * Math.PI) / 180)).toBe(0);
    expect(wholeBearing((-67 * Math.PI) / 180)).toBe(67);
  });

  it('says where a point lies off the nose: 0 dead ahead, positive to the left', () => {
    // Heading 0: the nose along +Z.
    expect(relativeBearing(0, 0, 0, 0, 100)).toBeCloseTo(0, 12);
    // +X is to the pilot's left when flying along +Z.
    expect(relativeBearing(0, 0, 0, 100, 100)).toBeCloseTo(Math.PI / 4, 12);
    expect(relativeBearing(0, 0, 0, -100, 100)).toBeCloseTo(-Math.PI / 4, 12);
    // From anywhere, at any heading: turn the ship and the world turns the other way.
    expect(relativeBearing(10, -20, 1, 10 + Math.sin(1.5), -20 + Math.cos(1.5))).toBeCloseTo(
      0.5,
      12,
    );
    // Dead astern is half a turn, either way round.
    expect(Math.abs(relativeBearing(3, 4, 7 * Math.PI, 3, 5))).toBeCloseTo(Math.PI, 9);
    // A point the ship is on is nowhere in particular: dead ahead.
    expect(relativeBearing(3, 4, 2, 3, 4)).toBe(0);
  });

  it('puts a mark on the side it is on, and pins what is behind at the rim', () => {
    expect(markerShare(0)).toBe(0);
    expect(isBehind(0)).toBe(false);
    // To the left: left of the nose on the ball.
    expect(markerShare(0.5)).toBeCloseTo(-Math.sin(0.5), 12);
    expect(markerShare(-0.5)).toBeCloseTo(Math.sin(0.5), 12);
    expect(isBehind(Math.PI / 2 - 0.01)).toBe(false);
    // Behind, on the left and on the right.
    expect(isBehind(Math.PI / 2 + 0.01)).toBe(true);
    expect(markerShare(2)).toBe(-1);
    expect(markerShare(Math.PI)).toBe(-1);
    expect(isBehind(-3)).toBe(true);
    expect(markerShare(-3)).toBe(1);
  });

  it('measures a mark round the compass from the nose, clockwise to the right', () => {
    expect(offBearing(90, 0)).toBe(90);
    expect(offBearing(0, 90)).toBe(-90);
    expect(offBearing(10, 350)).toBe(20);
    expect(offBearing(350, 10)).toBe(-20);
    expect(offBearing(180, 0)).toBe(-180);
    expect(offBearing(0, 0)).toBe(0);
  });
});

describe('the meridians of the ball', () => {
  const R = 42;
  const at = (bearing: number): Float64Array =>
    meridians(bearing, R, new Float64Array(MERIDIANS * 2));

  it('draws the twelfths of the compass that are within a quarter turn of the nose', () => {
    const north = at(0);
    // Dead ahead: north itself, a straight line from pole to pole.
    expect([north[0], north[1]]).toEqual([0, 1]);
    // 30 and 60 degrees to the right, 30 and 60 to the left (330 and 300).
    expect(north[1 * 2]).toBeCloseTo(R / 2, 9);
    expect(north[1 * 2 + 1]).toBe(1);
    expect(north[2 * 2]).toBeCloseTo(R * Math.sin(Math.PI / 3), 9);
    expect(north[11 * 2]).toBeCloseTo(R / 2, 9);
    expect(north[11 * 2 + 1]).toBe(-1);
    expect(north[10 * 2 + 1]).toBe(-1);
    // East, south and west with their neighbours are abeam or behind: not drawn.
    for (const k of [3, 4, 5, 6, 7, 8, 9]) expect([north[k * 2], north[k * 2 + 1]]).toEqual([0, 0]);

    let drawn = 0;
    const turned = at(47);
    for (let k = 0; k < MERIDIANS; k += 1) {
      const off = offBearing(k * 30, 47);
      const shown = turned[k * 2 + 1] !== 0;
      expect(shown, `meridian ${k}`).toBe(Math.abs(off) < 90);
      if (shown) drawn += 1;
    }
    expect(drawn).toBe(6);
  });

  it('slides them across as the ship turns, with no jump, and in and out at the rim', () => {
    const stepDeg = 0.1;
    let before = at(0);
    for (let bearing = stepDeg; bearing <= 360.05; bearing += stepDeg) {
      const now = at(bearing);
      for (let k = 0; k < MERIDIANS; k += 1) {
        const [wasRx = 0, wasSide = 0] = [before[k * 2], before[k * 2 + 1]];
        const [rx = 0, side = 0] = [now[k * 2], now[k * 2 + 1]];
        if (wasSide !== 0 && side !== 0) {
          // No further than the turn itself carries a point on the equator.
          const moved = Math.abs(side * rx - wasSide * wasRx);
          expect(moved).toBeLessThanOrEqual(R * stepDeg * (Math.PI / 180) * 1.001);
        } else if (wasSide !== 0 || side !== 0) {
          // It came into view, or left: at the rim, where it lies on the globe's own edge.
          expect(Math.max(rx, wasRx)).toBeGreaterThan(R * 0.9999);
        }
      }
      before = now;
    }
  });

  it('is the same ball a whole turn later', () => {
    for (const heading of [0.3, -2.2, 5]) {
      const a = at(bearingOf(heading));
      const b = at(bearingOf(heading + 2 * Math.PI));
      const c = at(bearingOf(heading - 20 * Math.PI));
      for (let i = 0; i < a.length; i += 1) {
        expect(b[i]).toBeCloseTo(a[i] ?? 0, 9);
        expect(c[i]).toBeCloseTo(a[i] ?? 0, 9);
      }
    }
  });
});

describe('the g arc', () => {
  it('reads 3.5 g from rest at full thrust, as the drive pushes', () => {
    // The drive's own push, with nothing in its way.
    expect(gOf(0, tuning.flight.thrustAccel * STEP, STEP, P)).toBeCloseTo(3.47, 2);
    // ...and what one real step from rest gives (drag has begun to take its share).
    const ship = createShipState();
    stepFlight(ship, { thrust: 1, turn: 0, brake: 0, boost: false }, tuning.flight, STEP);
    expect(gOf(ship.vx, ship.vz, STEP, P)).toBeCloseTo(3.47, 1);
  });

  it('stays under full in ordinary flying: boosting, and in a full turn at any speed', () => {
    const { thrustAccel, boostFactor } = tuning.flight;
    expect(gOf(0, thrustAccel * boostFactor * STEP, STEP, P)).toBeLessThan(P.gFull);
    // A turn pulls the speed times the turn rate at the most (fast ships turn wider).
    const fastest = topSpeed(tuning.flight, true);
    let hardest = 0;
    for (let speed = 0; speed <= fastest; speed += 0.25) {
      hardest = Math.max(hardest, speed * maxYawRate(speed, tuning.flight));
    }
    expect(gOf(hardest * STEP, 0, STEP, P)).toBeGreaterThan(8);
    expect(gOf(hardest * STEP, 0, STEP, P)).toBeLessThan(P.gFull);
  });

  it('pegs where the autopilot pulls, and clamps instead of skipping', () => {
    const { thrustAccel } = tuning.cruise.flight;
    expect(gOf(thrustAccel * STEP, 0, STEP, P)).toBe(P.gFull);
    expect(gOf(400 * P.gUnit * STEP, 0, STEP, P)).toBe(P.gFull);
    expect(gOf(Infinity, 0, STEP, P)).toBe(P.gFull);
    expect(gOf(0, 0, STEP, P)).toBe(0);
    // Nothing to divide by: no reading, not a peg.
    expect(gOf(1, 1, 0, P)).toBe(0);
  });
});

describe('the chevrons', () => {
  it('are none at any speed the pilot can reach, and one, two, three from 82, 300 and 600', () => {
    expect(topSpeed(tuning.flight, true)).toBeLessThan(Math.min(...P.warpTiers));
    expect(warpTier(0, P.warpTiers)).toBe(0);
    expect(warpTier(81, P.warpTiers)).toBe(0);
    expect(warpTier(82, P.warpTiers)).toBe(1);
    expect(warpTier(299, P.warpTiers)).toBe(1);
    expect(warpTier(300, P.warpTiers)).toBe(2);
    expect(warpTier(599, P.warpTiers)).toBe(2);
    expect(warpTier(600, P.warpTiers)).toBe(3);
    expect(warpTier(tuning.cruise.far.cruiseSpeed, P.warpTiers)).toBe(3);
  });
});

describe('the lamps', () => {
  const MODES: readonly DeckMode[] = ['flight', 'autopilot', 'approach', 'docked'];
  const lamps = (mode: DeckMode, halting = false, guarding = false, weight = 0) =>
    lampsOf(mode, halting, guarding, weight, P.assistOn);

  it('lights AUTO while the ship flies itself: a journey, an approach, Stop’s brake', () => {
    expect(lamps('autopilot')).toEqual({ auto: true, assist: false });
    expect(lamps('approach')).toEqual({ auto: true, assist: false });
    expect(lamps('flight', true)).toEqual({ auto: true, assist: false });
    // On a journey the assist's weight is pinned to 1 (sim/surroundings.ts): still AUTO alone.
    expect(lamps('autopilot', false, false, 1)).toEqual({ auto: true, assist: false });
    expect(lamps('approach', false, false, 1)).toEqual({ auto: true, assist: false });
  });

  it('lights ASSIST while the pilot flies and is helped', () => {
    expect(lamps('flight')).toEqual({ auto: false, assist: false });
    expect(lamps('flight', false, false, P.assistOn)).toEqual({ auto: false, assist: false });
    expect(lamps('flight', false, false, P.assistOn + 0.01)).toEqual({ auto: false, assist: true });
    expect(lamps('flight', false, false, 1)).toEqual({ auto: false, assist: true });
    // The reflex after a journey was taken back at speed.
    expect(lamps('flight', false, true)).toEqual({ auto: false, assist: true });
  });

  it('lights none in orbit, and never both', () => {
    expect(lamps('docked', false, false, 1)).toEqual({ auto: false, assist: false });
    for (const mode of MODES) {
      for (const halting of [false, true]) {
        for (const guarding of [false, true]) {
          for (const weight of [0, 0.04, 0.5, 1]) {
            const lit = lamps(mode, halting, guarding, weight);
            expect(lit.auto && lit.assist, `${mode} ${halting} ${guarding} ${weight}`).toBe(false);
          }
        }
      }
    }
  });

  it('writes into the object it is given', () => {
    const out = { auto: false, assist: true };
    expect(lampsOf('autopilot', false, false, 0, P.assistOn, out)).toBe(out);
    expect(out).toEqual({ auto: true, assist: false });
  });
});

describe('the countdown', () => {
  it('shows whole seconds, and never rises', () => {
    let shown = Infinity;
    const seen: number[] = [];
    // A journey whose plans find the way a little longer now and then.
    for (const eta of [3.2, 2.9, 3.4, 2.1, 2.6, 1.2, 0.4, 0.9, 0]) {
      shown = etaShown(shown, eta);
      seen.push(shown);
    }
    expect(seen).toEqual([4, 3, 3, 3, 3, 2, 1, 1, 0]);
    for (let i = 1; i < seen.length; i += 1) {
      expect(seen[i]).toBeLessThanOrEqual(seen[i - 1] ?? Infinity);
    }
  });

  it('keeps what it showed when there is nothing to show', () => {
    expect(etaShown(3, Number.NaN)).toBe(3);
    expect(etaShown(Infinity, Number.NaN)).toBe(Infinity);
    expect(etaShown(Infinity, -1)).toBe(0);
  });
});

describe('which system the ship is in', () => {
  const SYSTEMS = [
    { position: [0, 0], radius: 66 },
    { position: [-690, 0], radius: 400 },
    { position: [345, 598], radius: 150 },
  ] as const;

  it('is none between systems, and a system inside its reach', () => {
    // A new visitor starts 118 u from home, outside its 66.
    expect(systemAt(-1, 0, -118, SYSTEMS, P)).toBe(-1);
    expect(systemAt(-1, 0, -66, SYSTEMS, P)).toBe(0);
    expect(systemAt(-1, 10, 20, SYSTEMS, P)).toBe(0);
    expect(systemAt(-1, -690 + 399, 0, SYSTEMS, P)).toBe(1);
    expect(systemAt(-1, -690 + 401, 0, SYSTEMS, P)).toBe(-1);
    expect(systemAt(-1, 345, 598 + 149, SYSTEMS, P)).toBe(2);
  });

  it('keeps the system it was in out to 1.3 of its radius, and enters only at 1.0', () => {
    const edge = 66 * P.leaveRadii;
    expect(systemAt(0, 0, 70, SYSTEMS, P)).toBe(0);
    expect(systemAt(0, 0, edge - 0.01, SYSTEMS, P)).toBe(0);
    expect(systemAt(0, 0, edge + 0.01, SYSTEMS, P)).toBe(-1);
    // Coming the other way, the same spot is still "between".
    expect(systemAt(-1, 0, 70, SYSTEMS, P)).toBe(-1);
    // And it does not flicker: out, then back in only once inside the reach.
    let at = 0;
    const seen: number[] = [];
    for (const z of [60, 80, 85.7, 86, 80, 70, 66.5, 65.9, 80]) {
      at = systemAt(at, 0, z, SYSTEMS, P);
      seen.push(at);
    }
    expect(seen).toEqual([0, 0, 0, -1, -1, -1, -1, 0, 0]);
  });

  it('goes straight from one system to another that it is inside', () => {
    const close = [
      { position: [0, 0], radius: 100 },
      { position: [150, 0], radius: 100 },
    ] as const;
    // Kept, though the other is nearer: it was here first.
    expect(systemAt(0, 90, 0, close, P)).toBe(0);
    // Past its own 1.3, and inside the other.
    expect(systemAt(0, 131, 0, close, P)).toBe(1);
    // In both, with no past: the nearer in its own radii.
    expect(systemAt(-1, 60, 0, close, P)).toBe(0);
    expect(systemAt(-1, 90, 0, close, P)).toBe(1);
  });

  it('answers none for a galaxy with no systems, or an index that is not one', () => {
    expect(systemAt(-1, 0, 0, [], P)).toBe(-1);
    expect(systemAt(7, 0, 0, SYSTEMS, P)).toBe(0);
    expect(systemAt(7, 5000, 0, SYSTEMS, P)).toBe(-1);
  });
});

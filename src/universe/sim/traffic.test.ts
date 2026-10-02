import { describe, expect, it } from 'vitest';
import { TAU } from './math';
import { bodyPositions, createOrbitTable } from './orbits';
import { placeTraffic, trafficDots, type TrafficParams } from './traffic';

const params: TrafficParams = {
  minOrbitRadiusU: 18,
  speedUPerSec: 7,
  sizesPx: [3.4, 2.6],
  seed: 'test-traffic',
};

/** A sun at (100, -50), a planet round it, a moon round the planet, and a small ring. */
const orbits = createOrbitTable(
  [{ id: 's', position: [100, -50] }],
  [
    { id: 'sun', parent: null, system: 's', orbit: null },
    { id: 'planet', parent: 'sun', system: 's', orbit: { radius: 70, phase: 1, periodSec: 200 } },
    { id: 'moon', parent: 'planet', system: 's', orbit: { radius: 20, phase: 2, periodSec: 40 } },
    { id: 'pebble', parent: 'planet', system: 's', orbit: { radius: 9, phase: 0, periodSec: 30 } },
  ],
);
const everywhere = (): boolean => true;
const at = (t: number): Float64Array =>
  bodyPositions(orbits, t, new Float64Array(orbits.count * 2));
const shown = new Float64Array(orbits.count).fill(1);

describe('traffic', () => {
  it('puts two dots on every orbit that is large enough, one each way, at one speed', () => {
    const dots = trafficDots(orbits, everywhere, params);
    // The planet's and the moon's: the sun has no orbit, and the pebble's is too small.
    expect(dots.count).toBe(4);
    expect(Array.from(dots.row)).toEqual([1, 1, 2, 2]);
    expect(Array.from(dots.sizePx)).toEqual([3.4, 2.6, 3.4, 2.6].map(Math.fround));
    for (let i = 0; i < dots.count; i += 2) {
      const radius = orbits.radius[dots.row[i] ?? 0] ?? 0;
      expect((dots.rate[i] ?? 0) * radius).toBeCloseTo(7, 12);
      expect((dots.rate[i + 1] ?? 0) * radius).toBeCloseTo(-7, 12);
      expect(dots.phase[i]).toBeGreaterThanOrEqual(0);
      expect(dots.phase[i]).toBeLessThan(TAU);
    }
  });

  it('leaves out the orbits it is told have none', () => {
    const dots = trafficDots(orbits, (row) => orbits.ids[row] !== 'moon', params);
    expect(Array.from(dots.row)).toEqual([1, 1]);
  });

  it('places an orbit’s dots from its own id: another orbit moves nobody', () => {
    const all = trafficDots(orbits, everywhere, params);
    const moonOnly = trafficDots(orbits, (row) => orbits.ids[row] === 'moon', params);
    expect(Array.from(moonOnly.phase)).toEqual(Array.from(all.phase.slice(2)));
    const other = trafficDots(orbits, everywhere, { ...params, seed: 'another' });
    expect(Array.from(other.phase)).not.toEqual(Array.from(all.phase));
  });

  it('is a pure function of the time: on its line, and the same whoever asks', () => {
    const dots = trafficDots(orbits, everywhere, params);
    for (const t of [0, 3.25, 977]) {
      const positions = at(t);
      const out = placeTraffic(dots, orbits, positions, shown, t, new Float32Array(dots.count * 3));
      // The planet's orbit is round the sun, which holds still; the moon's rides the planet.
      for (let i = 0; i < dots.count; i += 1) {
        const row = dots.row[i] ?? 0;
        const [cx, cz] = row === 1 ? [100, -50] : [positions[2] ?? 0, positions[3] ?? 0];
        const from = Math.hypot((out[i * 3] ?? 0) - cx, (out[i * 3 + 2] ?? 0) - cz);
        expect(from).toBeCloseTo(orbits.radius[row] ?? 0, 3);
        expect(out[i * 3 + 1]).toBe(dots.sizePx[i]);
      }
      // A rebuilt engine makes its dots again and asks for the same time.
      const again = trafficDots(orbits, everywhere, params);
      expect(
        Array.from(placeTraffic(again, orbits, at(t), shown, t, new Float32Array(again.count * 3))),
      ).toEqual(Array.from(out));
    }
  });

  it('moves along its line at the speed asked for, and rests at its start at time zero', () => {
    const dots = trafficDots(orbits, everywhere, params);
    const a = placeTraffic(dots, orbits, at(0), shown, 0, new Float32Array(dots.count * 3));
    const b = placeTraffic(dots, orbits, at(0), shown, 0.1, new Float32Array(dots.count * 3));
    // The planet's two dots (the sun holds still): 0.7 u in a tenth of a second, either way.
    for (const i of [0, 1]) {
      expect(a[i * 3]).toBeCloseTo(100 + 70 * Math.sin(dots.phase[i] ?? 0), 3);
      expect(a[i * 3 + 2]).toBeCloseTo(-50 + 70 * Math.cos(dots.phase[i] ?? 0), 3);
      const moved = Math.hypot(
        (b[i * 3] ?? 0) - (a[i * 3] ?? 0),
        (b[i * 3 + 2] ?? 0) - (a[i * 3 + 2] ?? 0),
      );
      expect(moved).toBeCloseTo(0.7, 3);
    }
  });

  it('draws nothing on an orbit whose body the star map has no room for', () => {
    const dots = trafficDots(orbits, everywhere, params);
    const scales = Float64Array.from([1, 1, 0, 1]);
    const out = placeTraffic(dots, orbits, at(5), scales, 5, new Float32Array(dots.count * 3));
    expect([out[1], out[4], out[7], out[10]]).toEqual([3.4, 2.6, 0, 0].map(Math.fround));
  });
});

import { describe, expect, it } from 'vitest';
import { BODIES } from '../../design/worlds/bodies';
import { MOTION } from '../../design/worlds/motion';
import { NEAR } from '../../design/worlds/near';
import { absentAtRest, drive, driveValue, SHAPES, type MotionRow, type Shape } from './motion';
import { rowsOf } from './rows';

// Calm first (vocabulary.md, section 7). These rules hold over the WHOLE table, so a row that
// breaks them fails here, whoever wrote it. (That every mover's still is exactly the still mesh,
// pivots and all, is measured on the built bodies: tests/world-bodies.test.ts.)

const CONTINUOUS: ReadonlySet<Shape> = new Set(['ramp', 'sine']);
const rows = Object.entries(MOTION).flatMap(([id, list]) => list.map((row) => [id, row] as const));

/**
 * Parts that do ONE motion together, said here rather than guessed: the twin rocket hops with its
 * flame, the Cal Hacks stands do one wave between them, Hardware's fourteen gears click together
 * (a whole tooth each), and HackGT's magnifier rides its wave ring. Rows of one part are one
 * motion too (the letter slides and swells). The planned kit's crane is not counted: it is the
 * kit's.
 */
const TOGETHER: Readonly<Record<string, readonly (readonly string[])[]>> = {
  'page/about': [['twin-rocket', 'twin-flame']],
  'system/hardware': [
    [
      'big-yp',
      'big-yn',
      'big-xp',
      'big-xn',
      'big-zp',
      'big-zn',
      'pin-ppp',
      'pin-ppn',
      'pin-pnp',
      'pin-pnn',
      'pin-npp',
      'pin-npn',
      'pin-nnp',
      'pin-nnn',
    ],
  ],
  'project/cal-hacks-13': [['stands-1', 'stands-2', 'stands-3', 'stands-4']],
  'project/hackgt-13': [['wave-ring', 'magnifier']],
};
const motionOf = (id: string, part: string): string =>
  TOGETHER[id]?.find((parts) => parts.includes(part))?.join('+') ?? part;

describe('the motion table', () => {
  it('moves continuously no faster than once in 6 s, an event every 10 s, a glow every 2.4 s', () => {
    for (const [id, row] of rows) {
      const [part, target, , shape, , period] = row;
      const floor = target === 'glow' ? 2.4 : CONTINUOUS.has(shape) ? 6 : 10;
      expect(period, `${id} ${part}`).toBeGreaterThanOrEqual(floor);
    }
  });

  it('keeps a glow between 0.7 and 1 of full brightness: nothing blinks', () => {
    for (const [id, row] of rows.filter(([, r]) => r[1] === 'glow')) {
      for (let time = 0; time < 2 * row[5]; time += 0.05) {
        const { value } = drive(row, time);
        expect(value, id).toBeGreaterThanOrEqual(0.7);
        expect(value, id).toBeLessThanOrEqual(1);
      }
    }
  });

  it('gives each body at most two motions, besides a planned body’s crane', () => {
    for (const [id, list] of Object.entries(MOTION)) {
      const motions = new Set(
        list.filter(([part]) => part !== 'crane').map(([part]) => motionOf(id, part)),
      );
      expect(motions.size, `${id}: ${[...motions].join(', ')}`).toBeLessThanOrEqual(2);
    }
  });

  it('keeps the parts of one motion in step: one period and one wave, and every one of them moves', () => {
    for (const [id, groups] of Object.entries(TOGETHER)) {
      const list = MOTION[id] ?? [];
      for (const parts of groups) {
        const own = list.filter(([part]) => parts.includes(part));
        expect(new Set(own.map((row) => row[0])), id).toEqual(new Set(parts));
        expect(new Set(own.map((row) => row[5])).size, `${id}: one period`).toBe(1);
        expect(new Set(own.map((row) => row[3])).size, `${id}: one wave`).toBe(1);
      }
    }
  });

  it('leaves out of the still only close-up parts, so the everyday mesh never has a hole', () => {
    for (const [id, list] of Object.entries(MOTION)) {
      const absent = [...absentAtRest(list)];
      const recipe = BODIES[id];
      if (!recipe) throw new Error(`motion for ${id}, which has no rows`);
      const [, ...parts] = rowsOf(recipe, { map: false });
      const far = new Set(parts.map(([name]) => name));
      const near = new Set((NEAR[id] ?? []).map(([name]) => name));
      for (const part of absent) {
        expect(far.has(part), `${id} ${part} is far`).toBe(false);
        expect(near.has(part), `${id} ${part} is near`).toBe(true);
      }
    }
  });

  it('is at its still at its rest time, and a period on (a turn by a whole amount more)', () => {
    for (const [id, row] of rows) {
      const [part, target, , shape, amount, period, , rest = 0] = row;
      const still = drive(row, 'still').value;
      for (const k of [0, 1, 3]) {
        const at = drive(row, (rest + k) * period).value;
        const turns = target === 'rot' && (shape === 'ramp' || shape === 'step');
        expect(at, `${id} ${part} +${k}`).toBeCloseTo(turns ? still + k * amount : still, 9);
      }
    }
  });
});

describe('the driver', () => {
  const sway: MotionRow = ['dish', 'rot', 'z', 'sine', 0.25, 8];

  it('turns by its amount at the top of its wave, and not at all at its still', () => {
    expect(drive(sway, 2)).toEqual({ target: 'rot', axis: 'z', value: 0.25 });
    expect(drive(sway, 6).value).toBeCloseTo(-0.25, 12);
    expect(drive(sway, 'still').value).toBe(0);
  });

  it('comes back to the same picture each period, except a turn, which keeps turning', () => {
    for (const [id, row] of rows) {
      const [, target, , shape, amount, period] = row;
      const now = drive(row, 5.3).value;
      const later = drive(row, 5.3 + period).value;
      if (target === 'rot' && (shape === 'ramp' || shape === 'step')) {
        // A whole number of turns (a ramp of TAU) or one notch more (a ratchet).
        expect(later - now, id).toBeCloseTo(amount, 9);
      } else expect(later, `${id} ${row[0]}`).toBeCloseTo(now, 9);
    }
  });

  it('slides from the still and starts over each period', () => {
    const letter: MotionRow = ['letter', 'pos', 'z', 'ramp', 1.5, 10, 0, 0.35];
    expect(drive(letter, 3.5).value).toBeCloseTo(0, 12);
    expect(drive(letter, 5).value).toBeCloseTo(1.5 * (0.5 - 0.35), 12);
    expect(drive(letter, 9.9).value).toBeCloseTo(1.5 * (0.99 - 0.35), 12);
    expect(drive(letter, 10).value).toBeCloseTo(1.5 * -0.35, 12);
  });

  it('scales from the still’s own size', () => {
    const cloud: MotionRow = ['pose-cloud', 'scale', '*', 'hill', 1, 12, 0, 0.3];
    expect(drive(cloud, 'still').value).toBe(1);
    expect(drive(cloud, 6).value).toBeCloseTo(1 / Math.sin(Math.PI * 0.3), 12);
  });

  it('leaves out of the still what only exists while it plays', () => {
    expect([...absentAtRest(MOTION['page/about'] ?? [])]).toEqual(['twin-flame']);
    expect([...absentAtRest(MOTION['system/hackathons'] ?? [])]).toEqual(['confetti']);
    expect([...absentAtRest(MOTION['project/cyberpatriot'] ?? [])]).toEqual(['fix-tick']);
    expect([...absentAtRest(MOTION['project/robotics'] ?? [])]).toEqual([]);
    // A scale at 0 at its still, and nothing else.
    expect([...absentAtRest([['a', 'scale', '*', 'sine', 1, 8]])]).toEqual(['a']);
    expect([...absentAtRest([['a', 'pos', 'x', 'hill', 1, 10]])]).toEqual([]);
    expect([...absentAtRest([['a', 'scale', '*', 'hill', 1, 10, 0, 0.3]])]).toEqual([]);
  });

  it('gives the same value without making anything, for a caller that sets it every frame', () => {
    for (const [id, row] of rows) {
      for (const time of [0, 1.7, 5.3, 9.99, 'still'] as const) {
        expect(driveValue(row, time), `${id} ${row[0]} ${time}`).toBe(drive(row, time).value);
      }
    }
  });

  it('has waves that rest where they say', () => {
    expect(SHAPES.bump(0.5)).toBe(0);
    expect(SHAPES.blip(0.2)).toBe(0);
    expect(SHAPES.bump(0.2)).toBeCloseTo(1, 12);
    expect(SHAPES.step(1.5)).toBe(2);
    expect(SHAPES.hill(0)).toBe(0);
  });
});

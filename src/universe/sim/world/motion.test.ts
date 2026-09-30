import { describe, expect, it } from 'vitest';
import { MOTION } from '../../design/worlds/motion';
import { absentAtRest, drive, SHAPES, type MotionRow, type Shape } from './motion';

// Calm first (vocabulary.md, section 7). These rules hold over the WHOLE table, so a row that
// breaks them fails here, whoever wrote it.

const CONTINUOUS: ReadonlySet<Shape> = new Set(['ramp', 'sine']);
const rows = Object.entries(MOTION).flatMap(([id, list]) => list.map((row) => [id, row] as const));

describe('the motion table', () => {
  it('moves continuously no faster than once in 6 s, and glows no faster than 2.4 s', () => {
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
      // Rows that share a period are one motion: the letter slides and swells, the twin rocket
      // and its flame hop together, the Cal Hacks stands do one wave.
      const motions = new Set(list.filter(([part]) => part !== 'crane').map((row) => row[5]));
      expect(motions.size, id).toBeLessThanOrEqual(2);
    }
  });

  it('has a still for every row: at rest, a turn and a slide are 0 and a scale is 1 or absent', () => {
    for (const [id, row] of rows) {
      const { target, value } = drive(row, 'still');
      if (target === 'rot' || target === 'pos') expect(Math.abs(value), `${id} ${row[0]}`).toBe(0);
      if (target === 'scale') {
        const absent = absentAtRest([row]).has(row[0]);
        expect(absent || value === 1, `${id} ${row[0]}`).toBe(true);
      }
      expect(Number.isFinite(value)).toBe(true);
    }
  });
});

describe('the driver', () => {
  const sway: MotionRow = ['dish', 'rot', 'z', 'sine', 0.25, 8];

  it('is a pure function of the row and the time', () => {
    expect(drive(sway, 3.7)).toEqual(drive(sway, 3.7));
    expect(drive(sway, 2)).toEqual({ target: 'rot', axis: 'z', value: 0.25 });
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
  });

  it('has waves that rest where they say', () => {
    expect(SHAPES.bump(0.5)).toBe(0);
    expect(SHAPES.blip(0.2)).toBe(0);
    expect(SHAPES.bump(0.2)).toBeCloseTo(1, 12);
    expect(SHAPES.step(1.5)).toBe(2);
    expect(SHAPES.hill(0)).toBe(0);
  });
});

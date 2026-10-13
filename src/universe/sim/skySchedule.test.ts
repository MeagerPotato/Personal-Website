import { describe, expect, it } from 'vitest';
import { bandCount, createSkySchedule } from './skySchedule';

/** Run a schedule to its end on frames of the given lengths (the last one repeats). */
function run(bands: number, hurry: boolean, frames: readonly number[]): number[] {
  const schedule = createSkySchedule(bands, 22, hurry);
  const drawn: number[] = [];
  for (let frame = 0; schedule.left > 0 && frame < 200; frame += 1) {
    drawn.push(schedule.next(frames[Math.min(frame, frames.length - 1)] ?? 16));
  }
  return drawn;
}
const sum = (list: readonly number[]): number => list.reduce((a, b) => a + b, 0);

describe('the sky’s bake schedule', () => {
  it('counts the bands that cover the panorama', () => {
    expect(bandCount(1024, 64)).toBe(16);
    expect(bandCount(512, 64)).toBe(8);
    expect(bandCount(1000, 64)).toBe(16);
    expect(bandCount(64, 64)).toBe(1);
  });

  it('draws one band a frame while frames are quick', () => {
    expect(run(16, false, [16])).toEqual(Array.from({ length: 16 }, () => 1));
    expect(run(8, false, [8])).toHaveLength(8);
  });

  it('draws one band every second frame while frames are slow', () => {
    const drawn = run(8, false, [30]);
    expect(drawn).toEqual([1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1]);
    expect(sum(drawn)).toBe(8);
  });

  it('never two frames in a row without a band, whatever the frames do', () => {
    const drawn = run(16, false, [16, 40, 40, 16, 16, 60, 16, 60, 60, 60, 16]);
    expect(sum(drawn)).toBe(16);
    for (let i = 1; i < drawn.length; i += 1)
      expect((drawn[i - 1] ?? 0) + (drawn[i] ?? 0)).toBeGreaterThan(0);
    // A slow frame that drew is followed by a rest; a quick one is not.
    expect(drawn.slice(0, 5)).toEqual([1, 0, 1, 1, 1]);
  });

  it('draws two a frame for a visitor who has seen the sky, however slow the frames', () => {
    expect(run(16, true, [50])).toEqual(Array.from({ length: 8 }, () => 2));
    // An odd count ends on a single band, and never draws more than there are.
    expect(run(5, true, [16])).toEqual([2, 2, 1]);
  });

  it('is done when nothing is left, and then draws nothing', () => {
    const schedule = createSkySchedule(2, 22, false);
    expect(schedule.next(10)).toBe(1);
    expect(schedule.next(10)).toBe(1);
    expect(schedule.left).toBe(0);
    expect(schedule.next(10)).toBe(0);
    expect(createSkySchedule(0, 22, true).next(10)).toBe(0);
  });
});

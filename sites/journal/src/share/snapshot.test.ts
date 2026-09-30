import { describe, expect, test } from 'vitest';
import { inLines } from './snapshot';

describe('inLines', () => {
  const items = [100, 200, 300, 150, 250].map((w, id) => ({ id, w }));
  const ids = (lines: { id: number }[][]) => lines.map((line) => line.map((item) => item.id));

  test('fills each line as far as it goes, the gaps counted', () => {
    // 100 + 10 + 200 + 10 + 300 = 620: within 640, past 615.
    expect(ids(inLines(items, 640, 10, 5))).toEqual([
      [0, 1, 2],
      [3, 4],
    ]);
    expect(ids(inLines(items, 615, 10, 5))).toEqual([[0, 1], [2, 3], [4]]);
    // Something wider than the line has one of its own, even first.
    expect(ids(inLines(items, 250, 10, 5))).toEqual([[0], [1], [2], [3], [4]]);
    const wide = [300, 100].map((w, id) => ({ id, w }));
    expect(ids(inLines(wide, 250, 10, 5))).toEqual([[0], [1]]);
  });

  test('never gives more lines than asked for, and none for none', () => {
    expect(ids(inLines(items, 250, 10, 2))).toEqual([[0], [1]]);
    expect(inLines(items, 250, 10, 0)).toEqual([]);
  });
});

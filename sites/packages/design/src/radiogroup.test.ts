import { describe, expect, it } from 'vitest';
import { radioStep, radioTabIndex } from './radiogroup.ts';

describe('a radio group', () => {
  it('is one stop in the tab order: its checked radio, or its first while none is', () => {
    const stops = (checked: number) => [0, 1, 2, 3].map((index) => radioTabIndex(index, checked));
    expect(stops(2)).toEqual([-1, -1, 0, -1]);
    expect(stops(0)).toEqual([0, -1, -1, -1]);
    expect(stops(-1)).toEqual([0, -1, -1, -1]);
  });

  it('moves forward with Right and Down, back with Left and Up, round at either end', () => {
    expect(radioStep('ArrowRight', 1, 5)).toBe(2);
    expect(radioStep('ArrowDown', 1, 5)).toBe(2);
    expect(radioStep('ArrowLeft', 1, 5)).toBe(0);
    expect(radioStep('ArrowUp', 1, 5)).toBe(0);
    expect(radioStep('ArrowRight', 4, 5)).toBe(0);
    expect(radioStep('ArrowLeft', 0, 5)).toBe(4);
  });

  it('ignores every other key, a group of one, and a radio it cannot find', () => {
    for (const key of ['Enter', ' ', 'Tab', 'Home', 'a']) expect(radioStep(key, 1, 5)).toBeNull();
    expect(radioStep('ArrowRight', 0, 1)).toBeNull();
    expect(radioStep('ArrowRight', -1, 5)).toBeNull();
  });
});

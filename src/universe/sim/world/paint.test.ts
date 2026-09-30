import { describe, expect, it } from 'vitest';
import type { FacetPlace } from '../planet';
import { painterOf } from './paint';
import { colorOf } from './palette';

// Paint ops recolour a ground's facets by where they are; the last op that answers wins.

const at = (colat: number, az = 0): FacetPlace => ({ d: [0, 1, 0], pos: [0, 1, 0], colat, az });

describe('paint ops', () => {
  it('paints a band between two colatitudes: a cap from the pole', () => {
    const paint = painterOf([['band', 0, 0.2, 'ink.high']]);
    expect(paint(at(0))).toEqual(colorOf('ink.high'));
    expect(paint(at(0.19))).toEqual(colorOf('ink.high'));
    expect(paint(at(0.2))).toBeUndefined();
  });

  it('checks a grid through its colours, leaving the null cells alone', () => {
    const paint = painterOf([['grid', 2, 4, ['coral.base', null], 0.5, 1]]);
    expect(paint(at(0.4))).toBeUndefined();
    expect(paint(at(0.55, 0.1))).toEqual(colorOf('coral.base'));
    expect(paint(at(0.55, 0.1 + Math.PI / 2))).toBeUndefined();
    expect(paint(at(0.8, 0.1))).toBeUndefined();
    expect(paint(at(0.8, 0.1 + Math.PI / 2))).toEqual(colorOf('coral.base'));
    // Azimuths below zero wrap into the same sectors.
    expect(paint(at(0.55, 0.1 - 2 * Math.PI))).toEqual(colorOf('coral.base'));
  });

  it('paints where a test holds, in its colour or the one the test answers', () => {
    const red = colorOf('coral.base');
    const paint = painterOf([
      ['where', ({ az }) => az > 1, 'sky.base'],
      ['where', ({ az }) => (az > 2 ? red : false)],
    ]);
    expect(paint(at(0.5, 0.5))).toBeUndefined();
    expect(paint(at(0.5, 1.5))).toEqual(colorOf('sky.base'));
    expect(paint(at(0.5, 2.5))).toBe(red);
  });

  it('lets the last op that answers win', () => {
    const paint = painterOf([
      ['band', 0, 1, 'ink.high'],
      ['band', 0, 0.5, 'mint.base'],
    ]);
    expect(paint(at(0.25))).toEqual(colorOf('mint.base'));
    expect(paint(at(0.75))).toEqual(colorOf('ink.high'));
  });

  it('throws when an op names no colour, before any facet is painted', () => {
    expect(() => painterOf([['band', 0, 1, 'ink.hgh' as 'ink.high']])).toThrow("'ink.hgh'");
  });
});

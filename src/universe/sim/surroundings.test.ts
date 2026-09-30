import { describe, expect, it } from 'vitest';
import { tuning } from '../design/tuning';
import { createSurroundings, type SurroundingsInput } from './surroundings';

const input = (solidRadius?: number): SurroundingsInput => ({
  home: [0, 0],
  systems: [{ id: 'home', position: [0, 0], radius: 66 }],
  bodies: [
    {
      id: 'home',
      system: 'home',
      parent: null,
      orbit: null,
      radius: 14,
      dockRadius: 26.6,
      ...(solidRadius === undefined ? {} : { solidRadius }),
    },
    {
      id: 'relay',
      system: 'home',
      parent: 'home',
      orbit: { radius: 50, phase: 0, periodSec: 100 },
      radius: 1.4,
      dockRadius: 7.4,
      docks: false,
    },
  ],
});

describe('createSurroundings', () => {
  it('takes a world’s solid as its surface, and leaves its ring where it is', () => {
    const drawn = createSurroundings(input(21.98), tuning.edge.margin);
    const home = drawn.orbits.indexOf('home');
    // The cushions, the shells, the assist's swerve and the docking guard all measure from here.
    expect(drawn.field.radius[home]).toBe(21.98);
    expect(drawn.field.ringRadius[home]).toBe(26.6);

    // Without one, its radius, as always.
    const plain = createSurroundings(input(), tuning.edge.margin);
    expect(plain.field.radius[home]).toBe(14);
    expect(plain.field.radius[plain.orbits.indexOf('relay')]).toBe(1.4);
    expect(plain.field.docks[plain.orbits.indexOf('relay')]).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import { readRealInput } from '../../scripts/journeys/galaxies';
import { buildUniverse } from '../universe/data/build';
import { tokens } from '../universe/design/tokens';
import { BODIES } from '../universe/design/worlds/bodies';
import {
  hasPortrait,
  pictureOf,
  portraitOf,
  subjectOf,
  type Portrait,
  type PortraitOf,
} from './portrait';

const real = buildUniverse(readRealInput(true));
const projects = real.bodies.filter((body) => body.id.startsWith('project/'));
const of = (id: string): PortraitOf => {
  const body = real.bodies.find((b) => b.id === id);
  if (!body) throw new Error(id);
  return subjectOf(body);
};

/** How much of the picture the body covers, and the middle of what it covers. */
function coverage(picture: Portrait): { share: number; x: number; y: number } {
  let sum = 0;
  let x = 0;
  let y = 0;
  for (let i = 0; i < picture.width * picture.height; i += 1) {
    const a = (picture.data[i * 4 + 3] ?? 0) / 255;
    sum += a;
    x += a * (i % picture.width);
    y += a * Math.floor(i / picture.width);
  }
  return { share: sum / (picture.width * picture.height), x: x / sum, y: y / sum };
}

describe('a world as a picture', () => {
  it('every project has a world to draw', () => {
    expect(projects.length).toBeGreaterThan(0);
    for (const body of projects) expect(hasPortrait(body.id), body.id).toBe(true);
  });

  it('is the body on a clear ground, near the middle, and the same every time', () => {
    for (const body of projects) {
      const picture = portraitOf(of(body.id), 48);
      const { share, x, y } = coverage(picture);
      expect(share, body.id).toBeGreaterThan(0.05);
      expect(share, body.id).toBeLessThan(0.75);
      expect(Math.abs(x - 24), body.id).toBeLessThan(10);
      expect(Math.abs(y - 24), body.id).toBeLessThan(10);
      // The corners are the ground: the world fits in the circle a station draws round it.
      for (const at of [0, 47, 48 * 47, 48 * 48 - 1]) expect(picture.data[at * 4 + 3]).toBe(0);
    }
    const once = portraitOf(of('project/fishai'), 32);
    expect(portraitOf(of('project/fishai'), 32).data).toEqual(once.data);
  });

  it('is lit: a world has a lit side and a shade side, which is tinted and not black', () => {
    const picture = portraitOf(of('project/cyberpatriot'), 64);
    const lums: number[] = [];
    for (let i = 0; i < 64 * 64; i += 1) {
      if ((picture.data[i * 4 + 3] ?? 0) < 255) continue;
      const [r = 0, g = 0, b = 0] = picture.data.slice(i * 4, i * 4 + 3);
      lums.push(0.2126 * r + 0.7152 * g + 0.0722 * b);
    }
    lums.sort((a, b) => a - b);
    // Its own dark parts aside (a screen, a windshield), the darkest tenth is still a colour.
    const tenth = lums[Math.floor(lums.length / 10)] ?? 0;
    expect(tenth).toBeGreaterThan(40);
    expect((lums.at(-1) ?? 0) - tenth).toBeGreaterThan(25);
  });

  it("outlines planned work in its family's lines, as the galaxy draws its ghosts", () => {
    const planned = projects.filter((body) => BODIES[body.id]?.ghost);
    expect(planned.length).toBeGreaterThan(0);
    for (const body of planned) {
      const family = BODIES[body.id]?.ghost ?? 'sky';
      const hex = tokens.color.system[family].base;
      const want = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
      const picture = portraitOf(of(body.id), 96);
      let lines = 0;
      for (let i = 0; i < 96 * 96; i += 1) {
        if ((picture.data[i * 4 + 3] ?? 0) < 255) continue;
        const near = want.every((v, k) => Math.abs((picture.data[i * 4 + k] ?? 0) - v) <= 2);
        if (near) lines += 1;
      }
      expect(lines, body.id).toBeGreaterThan(15);
    }
  });

  it('says so of a body with no world, which keeps its ball on the pages', () => {
    expect(hasPortrait('project/nowhere')).toBe(false);
    expect(pictureOf('nowhere', 96)).toBeNull();
    expect(pictureOf('fishai', 96)).toBe('/worlds/fishai-96.webp');
    expect(() => portraitOf({ ...of('project/fishai'), id: 'project/nowhere' }, 8)).toThrow(
      /no world/,
    );
  });
});

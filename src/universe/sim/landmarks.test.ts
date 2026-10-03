import { describe, expect, it } from 'vitest';
import { tuning } from '../design/tuning';
import {
  defaultLandmark,
  landmarkOf,
  landmarkPoint,
  limbPoint,
  type LandmarkTable,
} from './landmarks';
import { dirOf } from './world/placement';

const RING = { defaultLatDeg: 30, defaultLonDeg: 15 };

describe('the ring of landmarks for cards that have none of their own', () => {
  it('spreads the cards evenly all the way round the body, at one latitude', () => {
    const marks = Array.from({ length: 8 }, (_, i) => defaultLandmark(i, 8, RING));
    expect(marks.map((mark) => mark.lat)).toEqual(Array.from({ length: 8 }, () => 30));
    expect(marks.map((mark) => mark.lon)).toEqual([15, 60, 105, 150, 195, 240, 285, 330]);
    // A page of one card, and (never asked, but never a division by nothing) of none.
    expect(defaultLandmark(0, 1, RING)).toEqual({ lat: 30, lon: 15 });
    expect(defaultLandmark(0, 0, RING)).toEqual({ lat: 30, lon: 15 });
  });

  it('is what the design says: tuning.deck', () => {
    expect(defaultLandmark(1, 4, tuning.deck)).toEqual({
      lat: tuning.deck.defaultLatDeg,
      lon: tuning.deck.defaultLonDeg + 90,
    });
  });

  it('stands in for a card nobody gave a landmark, and never for one that has its own', () => {
    const table: LandmarkTable = { 'page/about': { rockets: { lat: 80, lon: 30 } } };
    expect(landmarkOf(table, 'page/about', 'rockets', 2, 8, RING)).toEqual({ lat: 80, lon: 30 });
    expect(landmarkOf(table, 'page/about', 'robots', 3, 8, RING)).toEqual({ lat: 30, lon: 150 });
    expect(landmarkOf(table, 'project/fishai', 'rockets', 0, 5, RING)).toEqual({
      lat: 30,
      lon: 15,
    });
  });
});

describe('a landmark in its body’s frame', () => {
  it('is where a part stood at that latitude and longitude is (placement.ts, dirOf)', () => {
    for (const [lat, lon] of [
      [0, 0],
      [80, 30],
      [-15, 200],
      [30, 285],
    ] as const) {
      const point = landmarkPoint({ lat, lon }, 1, { x: 0, y: 0, z: 0 });
      const [x, y, z] = dirOf(lat, lon);
      expect(point.x).toBeCloseTo(x, 12);
      expect(point.y).toBeCloseTo(y, 12);
      expect(point.z).toBeCloseTo(z, 12);
    }
    // Longitude 0 is the body's +Z, 90 its +X; north is +Y.
    expect(landmarkPoint({ lat: 0, lon: 90 }, 1, { x: 0, y: 0, z: 0 }).x).toBeCloseTo(1, 12);
    expect(landmarkPoint({ lat: 90, lon: 0 }, 1, { x: 0, y: 0, z: 0 }).y).toBeCloseTo(1, 12);
  });

  it('is out at the body’s radius, and above the ground by its height in radii', () => {
    const on = landmarkPoint({ lat: 20, lon: 70 }, 12, { x: 0, y: 0, z: 0 });
    expect(Math.hypot(on.x, on.y, on.z)).toBeCloseTo(12, 9);
    const above = landmarkPoint({ lat: 20, lon: 70, alt: 0.25 }, 12, { x: 0, y: 0, z: 0 });
    expect(Math.hypot(above.x, above.y, above.z)).toBeCloseTo(15, 9);
    // The same direction: only further out.
    expect(above.x / on.x).toBeCloseTo(1.25, 9);
  });
});

describe('the point of a body’s limb nearest a card', () => {
  it('is on the edge of the disc, on the straight line from its middle to the card', () => {
    const out = { x: 0, y: 0 };
    limbPoint(640, 400, 100, 940, 400, out);
    expect(out).toEqual({ x: 740, y: 400 });
    limbPoint(640, 400, 100, 640, 100, out);
    expect(out.x).toBeCloseTo(640, 9);
    expect(out.y).toBeCloseTo(300, 9);
    limbPoint(640, 400, 100, 340, 0, out);
    expect(Math.hypot(out.x - 640, out.y - 400)).toBeCloseTo(100, 9);
    // On the line: the same direction from the middle as the card.
    expect((out.x - 640) / (out.y - 400)).toBeCloseTo(-300 / -400, 9);
  });

  it('gives lines that never cross: each ends on its own side of the body', () => {
    const anchors = [
      [355, 150],
      [355, 400],
      [355, 650],
      [925, 150],
      [925, 400],
      [925, 650],
    ] as const;
    const ends = anchors.map(([x, y]) => limbPoint(640, 400, 120, x, y, { x: 0, y: 0 }));
    // Radial lines meet only at the middle, which is inside the disc and on none of them.
    ends.forEach((end, i) => {
      const [x, y] = anchors[i] ?? [0, 0];
      expect(Math.sign(end.x - 640)).toBe(Math.sign(x - 640));
      expect(Math.sign(end.y - 400)).toBe(Math.sign(y - 400));
      expect(Math.hypot(end.x - x, end.y - y)).toBeCloseTo(Math.hypot(x - 640, y - 400) - 120, 9);
    });
  });

  it('has an answer from the very middle too, where no point is nearest', () => {
    expect(limbPoint(640, 400, 100, 640, 400, { x: 0, y: 0 })).toEqual({ x: 740, y: 400 });
  });
});

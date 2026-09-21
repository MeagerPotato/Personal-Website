import { describe, expect, it } from 'vitest';
import {
  boundsOf,
  clampView,
  displayScales,
  fitSpan,
  fitView,
  panBy,
  pointUnder,
  unitsPerPx,
  zoomAbout,
  type MapBodies,
  type MapView,
} from './mapView';

const PARAMS = { spanMin: 400, spanMax: 7000, fitMargin: 1.25 };
const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 412, height: 915 };

// The galaxy as it is today: the home system, and one system up and to the left of it.
const SYSTEMS = [
  { position: [0, 0], radius: 66 },
  { position: [-735, 618], radius: 203 },
] as const;

describe('the map, fitting the galaxy', () => {
  it('draws the rectangle round every system, orbits included', () => {
    expect(boundsOf(SYSTEMS)).toEqual({ minX: -938, maxX: 66, minZ: -66, maxZ: 821 });
    expect(boundsOf([])).toEqual({ minX: 0, maxX: 0, minZ: 0, maxZ: 0 });
  });

  it('opens on everything, with room to spare, on a wide screen and on a tall one', () => {
    const bounds = boundsOf(SYSTEMS);
    for (const frame of [DESKTOP, PHONE]) {
      const view = fitView(bounds, frame, PARAMS, { x: 0, z: 0, span: 0 });
      expect(view.x).toBeCloseTo(-436, 6);
      expect(view.z).toBeCloseTo(377.5, 6);
      const perPx = unitsPerPx(view.span, frame);
      // The whole rectangle is inside the frame, and it is not lost in it either.
      expect(perPx * frame.width).toBeGreaterThanOrEqual((bounds.maxX - bounds.minX) * 1.25 - 1e-9);
      expect(perPx * frame.height).toBeGreaterThanOrEqual(
        (bounds.maxZ - bounds.minZ) * 1.25 - 1e-9,
      );
      const slack = Math.min(
        (perPx * frame.width) / (bounds.maxX - bounds.minX),
        (perPx * frame.height) / (bounds.maxZ - bounds.minZ),
      );
      expect(slack).toBeCloseTo(1.25, 9);
    }
  });

  it('never opens closer than the closest zoom, and may open further out than the furthest', () => {
    const small = boundsOf([{ position: [0, 0], radius: 50 }]);
    expect(fitSpan(small, DESKTOP, PARAMS)).toBe(400);
    const huge = boundsOf([
      { position: [-6000, 0], radius: 300 },
      { position: [6000, 0], radius: 300 },
    ]);
    const span = fitSpan(huge, DESKTOP, PARAMS);
    expect(span).toBeGreaterThan(7000);
    // ...and the limit follows, so that zooming back out to everything is always possible.
    const view = clampView({ x: 0, z: 0, span: 1e9 }, huge, DESKTOP, PARAMS);
    expect(view.span).toBeCloseTo(span, 9);
  });

  it('keeps the middle of the view over the galaxy', () => {
    const bounds = boundsOf(SYSTEMS);
    const view = clampView({ x: 5000, z: -5000, span: 10 }, bounds, DESKTOP, PARAMS);
    expect(view).toEqual({ x: 66, z: -66, span: 400 });
  });
});

describe('the map, dragged and zoomed', () => {
  it('moves the world with the pointer: what was under it stays under it', () => {
    const view: MapView = { x: 100, z: 200, span: 1600 };
    const under = pointUnder(view, 150, -80, DESKTOP, new Float64Array(2));
    const [wx, wz] = [under[0], under[1]];
    // The pointer goes 40 px right and 25 px down, dragging the map along.
    panBy(view, 40, 25, DESKTOP);
    pointUnder(view, 190, -55, DESKTOP, under);
    expect(under[0]).toBeCloseTo(wx ?? NaN, 9);
    expect(under[1]).toBeCloseTo(wz ?? NaN, 9);
    // Right on screen is -X: dragging right brings what lies at +X into the middle.
    expect(view.x).toBeGreaterThan(100);
    expect(view.z).toBeGreaterThan(200);
  });

  it('zooms about the pointer, in and out, and stops at the limits', () => {
    const limits = { min: 400, max: 7000 };
    const view: MapView = { x: -300, z: 120, span: 2000 };
    const under = pointUnder(view, -310, 222, PHONE, new Float64Array(2));
    const [wx, wz] = [under[0], under[1]];

    zoomAbout(view, 0.5, -310, 222, PHONE, limits);
    expect(view.span).toBe(1000);
    pointUnder(view, -310, 222, PHONE, under);
    expect(under[0]).toBeCloseTo(wx ?? NaN, 9);
    expect(under[1]).toBeCloseTo(wz ?? NaN, 9);

    zoomAbout(view, 100, -310, 222, PHONE, limits);
    expect(view.span).toBe(7000);
    pointUnder(view, -310, 222, PHONE, under);
    expect(under[0]).toBeCloseTo(wx ?? NaN, 9);

    // At a limit nothing moves at all: no creeping sideways against the stop.
    const before = { ...view };
    zoomAbout(view, 2, -310, 222, PHONE, limits);
    expect(view).toEqual(before);
  });
});

describe('how big bodies are drawn', () => {
  // A sun, a planet 60 u out, its moon 20 u from it, and a planet 200 u out.
  const bodies: MapBodies = {
    count: 4,
    parent: [-1, 0, 1, 0],
    orbitRadius: [0, 60, 20, 200],
    radius: [20, 8, 1.8, 12],
    minRadiusPx: [9, 6, 3.5, 6],
  };
  const params = { clearPx: 4 };

  it('leaves everything alone off the map', () => {
    expect([...displayScales(bodies, 3, 0, params, new Float64Array(4))]).toEqual([1, 1, 1, 1]);
  });

  it('never shrinks a body that is big enough already', () => {
    // 0.5 u per px: the sun is 40 px, the planets 16 and 24, and even the moon has its room.
    const close = displayScales(bodies, 0.5, 1, params, new Float64Array(4));
    expect(close[0]).toBe(1);
    expect(close[1]).toBe(1);
    expect(close[3]).toBe(1);
    // The moon (3.6 px) is brought up to its 3.5 px... which it already beats.
    expect(close[2]).toBe(1);
  });

  it('blows small bodies up to their smallest size, and hides what has no room', () => {
    // 3 u per px: the sun would be 6.7 px, the inner planet 2.7 px.
    const far = displayScales(bodies, 3, 1, params, new Float64Array(4));
    expect((far[0] ?? 0) * 20).toBeCloseTo(9 * 3, 9);
    expect((far[3] ?? 0) * 12).toBeCloseTo(6 * 3, 9);
    // The inner planet: 20 px from the sun, discs of 9 and 6 px: 5 px apart, so it shows.
    expect((far[1] ?? 0) * 8).toBeCloseTo(6 * 3, 9);
    // Its moon circles 6.7 px out, inside the planet's own 6 px disc: gone.
    expect(far[2]).toBe(0);

    // Further out still, the inner planet goes too, and takes its moon along whatever happens.
    const further = displayScales(bodies, 6, 1, params, new Float64Array(4));
    expect(further[1]).toBe(0);
    expect(further[2]).toBe(0);
    expect(further[3]).toBeGreaterThan(0);
  });

  it('mixes smoothly on the way there: by ratio for size, by share for presence', () => {
    const half = displayScales(bodies, 3, 0.5, params, new Float64Array(4));
    expect(half[0]).toBeCloseTo(Math.sqrt(1.35), 9);
    // The moon is on its way out: it only ever dwindles, and never swells up first.
    expect(half[2]).toBeCloseTo(0.5, 9);
    let last = 1;
    for (let w = 0; w <= 1.0001; w += 0.05) {
      const moon = displayScales(bodies, 3, w, params, new Float64Array(4))[2] ?? 0;
      expect(moon).toBeLessThanOrEqual(last + 1e-12);
      last = moon;
    }
    expect(last).toBeCloseTo(0, 9);
  });
});

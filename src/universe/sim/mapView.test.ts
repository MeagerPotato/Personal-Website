import { describe, expect, it } from 'vitest';
import {
  boundsOf,
  clampView,
  displayScales,
  fitSpan,
  fitView,
  panBy,
  pointUnder,
  spanLimit,
  takeIn,
  unitsPerPx,
  zoomAbout,
  type MapBodies,
  type MapView,
} from './mapView';

const PARAMS = { spanMin: 400, zoomOutPastFit: 1, fitMargin: 1.25, fitPadPx: 0 };
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

  it('never opens closer than the closest zoom, and never zooms out past everything', () => {
    const small = boundsOf([{ position: [0, 0], radius: 50 }]);
    expect(fitSpan(small, DESKTOP, PARAMS)).toBe(400);
    for (const galaxy of [
      SYSTEMS,
      [
        { position: [-6000, 0], radius: 300 },
        { position: [6000, 0], radius: 300 },
      ] as const,
    ]) {
      const bounds = boundsOf(galaxy);
      const span = fitSpan(bounds, DESKTOP, PARAMS);
      // However big the galaxy has grown, everything is as far out as the map goes.
      expect(spanLimit(bounds, DESKTOP, PARAMS)).toBeCloseTo(span, 9);
      const view = clampView({ x: 0, z: 0, span: 1e9 }, bounds, DESKTOP, PARAMS);
      expect(view.span).toBeCloseTo(span, 9);
    }
    // Unless asked to leave some room past it.
    const roomy = { ...PARAMS, zoomOutPastFit: 1.5 };
    const bounds = boundsOf(SYSTEMS);
    expect(spanLimit(bounds, DESKTOP, roomy)).toBeCloseTo(fitSpan(bounds, DESKTOP, roomy) * 1.5, 9);
  });

  it('fits snugly: the margin, and room in pixels for the names at the edge, on any screen', () => {
    const bounds = boundsOf(SYSTEMS);
    const padded = { ...PARAMS, fitMargin: 1, fitPadPx: 40 };
    for (const frame of [DESKTOP, PHONE]) {
      const perPx = unitsPerPx(fitSpan(bounds, frame, padded), frame);
      // The galaxy fills the frame but for 40 px on each side, in the direction it is tight in.
      const across = (bounds.maxX - bounds.minX) / perPx;
      const up = (bounds.maxZ - bounds.minZ) / perPx;
      expect(Math.max(across - (frame.width - 80), up - (frame.height - 80))).toBeCloseTo(0, 6);
      expect(across).toBeLessThanOrEqual(frame.width - 80 + 1e-6);
      expect(up).toBeLessThanOrEqual(frame.height - 80 + 1e-6);
    }
    // A frame too small for its padding still shows everything, in two thirds of itself.
    const tiny = { width: 60, height: 60 };
    const perPx = unitsPerPx(fitSpan(bounds, tiny, { ...padded, spanMin: 0 }), tiny);
    expect((bounds.maxX - bounds.minX) / perPx).toBeCloseTo(40, 6);
  });

  it('gives the galaxy two thirds of a squeezed frame at least: the phone map above an open page', () => {
    // 360 px wide, and the strip the bottom sheet leaves above it. With 44 px padding above and
    // below, the galaxy had 62 px of 150; a sixth of the frame is 25 px, and it has 100.
    const bounds = boundsOf(SYSTEMS);
    const padded = { ...PARAMS, fitMargin: 1, fitPadPx: 44, spanMin: 0 };
    const strip = { width: 360, height: 150 };
    const perPx = unitsPerPx(fitSpan(bounds, strip, padded), strip);
    expect((bounds.maxZ - bounds.minZ) / perPx).toBeCloseTo(100, 6);
    // Across, where there is room, the padding is as it always is.
    expect((bounds.maxX - bounds.minX) / perPx).toBeLessThanOrEqual(360 - 88 + 1e-6);
    // And the view can be dragged that sixth past the galaxy's edge, no further.
    const view = clampView({ x: 0, z: -5000, span: 400 }, bounds, strip, {
      ...padded,
      spanMin: 400,
    });
    const stripPerPx = unitsPerPx(400, strip);
    expect(view.z).toBeCloseTo(-66 + (75 - 25) * stripPerPx, 9);
  });

  it("keeps the view on the galaxy: its edge at the frame's edge, and no further", () => {
    const bounds = boundsOf(SYSTEMS);
    // 400 u across 800 px: 0.5 u a pixel, so the view reaches 320 u either side and 200 u up and down.
    const view = clampView({ x: 5000, z: -5000, span: 10 }, bounds, DESKTOP, PARAMS);
    expect(view).toEqual({ x: 66 - 320, z: -66 + 200, span: 400 });
    clampView(Object.assign(view, { x: -5000, z: 5000 }), bounds, DESKTOP, PARAMS);
    expect(view).toEqual({ x: -938 + 320, z: 821 - 200, span: 400 });
    // With padding, that much further: never more empty space than the names need.
    const padded = { ...PARAMS, fitPadPx: 40 };
    clampView(Object.assign(view, { x: 5000, z: -5000 }), bounds, DESKTOP, padded);
    expect(view).toEqual({ x: 66 - 320 + 20, z: -66 + 200 - 20, span: 400 });
    // A view bigger than the galaxy keeps all of it in view: it goes as far as having the galaxy's
    // edge at its own, no further. (1.375 u a pixel: 880 u either side, 550 up and down.)
    clampView(Object.assign(view, { x: 5000, z: -5000, span: 1100 }), bounds, DESKTOP, PARAMS);
    expect(view.x).toBeCloseTo(-938 + 880, 9);
    expect(view.z).toBeCloseTo(821 - 550, 9);
    clampView(Object.assign(view, { x: -5000, z: 5000 }), bounds, DESKTOP, PARAMS);
    expect(view.x).toBeCloseTo(66 - 880, 9);
    expect(view.z).toBeCloseTo(-66 + 550, 9);
  });

  it('takes in the ship, wherever it is', () => {
    const bounds = boundsOf(SYSTEMS);
    const out = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
    expect(takeIn(bounds, -100, 100, out)).toEqual(bounds);
    expect(takeIn(bounds, 1500, -900, out)).toEqual({
      minX: -938,
      maxX: 1500,
      minZ: -900,
      maxZ: 821,
    });
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

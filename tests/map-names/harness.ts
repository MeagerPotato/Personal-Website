import { PerspectiveCamera } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CameraRig } from '../../src/universe/camera/CameraRig';
import { MapCam } from '../../src/universe/camera/MapCam';
import type { Frame } from '../../src/universe/core/Engine';
import { buildUniverse } from '../../src/universe/data/build';
import type { ManifestBody } from '../../src/universe/data/types';
import { tuning } from '../../src/universe/design/tuning';
import { homeSystemOf, nearestNeighbourOf } from '../../src/universe/manifest';
import { boundsOf, displayScales } from '../../src/universe/sim/mapView';
import { bodyPositions } from '../../src/universe/sim/orbits';
import { spawnPoint } from '../../src/universe/sim/spawn';
import { createSurroundings } from '../../src/universe/sim/surroundings';
import { BodiesOnScreen } from '../../src/universe/ui/BodiesOnScreen';
import { Labels } from '../../src/universe/ui/Labels';
import { StarMap } from '../../src/universe/ui/StarMap';
import { readRealInput } from '../../scripts/journeys/galaxies';

// THE STAR MAP'S NAMES HOLD STILL. The map at rest, over a whole turn of the slowest orbit (the
// Projects binary's, 4,470 s), at 60 frames a second, on two phones and a laptop (a file each, so
// that they run side by side), at the view it opens on and zoomed in twice (+ twice): the real
// galaxy (src/content, as the build reads it), the real StarMap, camera rig, projection, Labels
// and declutter, and the ship where a first visit starts. A name CHANGES when it appears, hides,
// or moves (more than 10 px beside its body: to another side, or slid along it). As bodies go
// round a name must now and then (another name needs the room, or its body takes it past the edge
// of the view), but it must not flicker: no name changes within three frames of its last change,
// and at the view the map opens on none changes twice within a second. Zoomed in, bodies cross
// the edges of the view, and a name that has just appeared may have to go with its body: a few
// such a turn at most.
//
// On 2026-09-30, changes a minute and (in brackets) changes within a second of the last, a turn,
// at 360x740 / 412x839 / 1280x800:
//
//                       at the fit                         zoomed in twice
//   the first try       4.8 / 107 / 270                    16 / 40 / 96
//     (ce1c5e5)         (278 / 7,801 / 18,403)             (324 / 2,053 / 4,544)
//   now                 0.38 / 0.74 / 7.8 (0 / 0 / 0)      4.4 / 5.5 / 15 (0 / 0 / 2)
//
// Before the names had places (one, below a body, or above it for the ship), a headless probe
// with the sizes measured in a browser counted 0.47 / 0.19 / 2.9 (0) at the fit and 1.1 / 2.8 /
// 4.0 (0 / 0 / 1) zoomed in: calmer, as a name that had no room simply stayed away, and half as
// many names showed (at a phone's first view never Software's or Hackathons').
//
// Names are not laid out here (happy-dom): each is as wide as the browser draws it, near enough
// (`nameWidth`), and the page round the map (the top bar, the Map button, the footer chip) is
// where the browser put it at each size.

/** One of the screens, and where the browser put the page round the map there (CSS px). */
interface Screen {
  readonly width: number;
  readonly height: number;
  /** How far down the top bar reaches. */
  readonly top: number;
  /** The footer chip in the bottom-left corner: from the left edge to `right`, from `top` down. */
  readonly foot: { readonly right: number; readonly top: number };
  /** The Map button. */
  readonly button: { readonly left: number; readonly top: number; readonly width: number };
}

export const SCREENS = {
  '360x740': {
    width: 360,
    height: 740,
    top: 101,
    foot: { right: 163, top: 684 },
    button: { left: 236, top: 113, width: 108 },
  },
  '412x839': {
    width: 412,
    height: 839,
    top: 101,
    foot: { right: 164, top: 783 },
    button: { left: 288, top: 113, width: 108 },
  },
  '1280x800': {
    width: 1280,
    height: 800,
    top: 57,
    foot: { right: 169, top: 744 },
    button: { left: 1118.4, top: 69, width: 137.6 },
  },
} as const satisfies Readonly<Record<string, Screen>>;

export type ScreenSize = keyof typeof SCREENS;

/**
 * How wide the browser draws a body's name (CSS px), within about 10: 6.8 px a letter and 24 of
 * padding, a system's glyph 28 more, the note of planned work (", Planned", set smaller) 41, and
 * a link's arrow 15. Every name is 44 px tall, its tag 26.
 */
function nameWidth(body: Pick<ManifestBody, 'title' | 'kind' | 'planned' | 'docks'>): number {
  const glyph = body.kind === 'sun' || body.kind === 'home' ? 28 : 0;
  const note = body.planned === true ? 41 : 0;
  const arrow = body.docks === false ? 15 : 0;
  return 24 + 6.8 * body.title.length + glyph + note + arrow;
}
const NAME_HEIGHT = 44;
const TAG_HEIGHT = 26;

/** How far a name must move beside its body to count as a change (CSS px). */
const HOP_PX = 10;

const manifest = buildUniverse(readRealInput());

/** The map at `screen`, open on everything, and a step of the world as main.ts takes it. */
function mapAt(screen: Screen) {
  document.body.innerHTML = '';
  const canvas = document.createElement('canvas');
  const overlay = document.createElement('div');
  document.body.append(canvas, overlay);
  const viewport = { width: screen.width, height: screen.height, pixelRatio: 1 };
  const home = homeSystemOf(manifest);
  const surroundings = createSurroundings(
    { systems: manifest.systems, bodies: manifest.bodies, home: home.position },
    tuning.edge.margin,
  );
  const { orbits } = surroundings;
  const spawn = spawnPoint(
    home.position,
    nearestNeighbourOf(manifest, home)?.position ?? null,
    tuning.ship.spawn,
  );
  const camera = new PerspectiveCamera(
    tuning.camera.fovDegrees,
    screen.width / screen.height,
    tuning.camera.near,
    tuning.camera.far,
  );
  const rig = new CameraRig(camera, { update: () => undefined }, tuning.cameraRig);
  const map = new StarMap({
    canvas,
    overlay,
    bounds: boundsOf(manifest.systems),
    ship: () => spawn,
    view: rig.shape,
    params: tuning.map,
    reducedMotion: true,
    onChange: () => undefined,
  });
  const button = overlay.querySelector<HTMLElement>('.map-toggle');
  if (!button) throw new Error('no Map button');
  const { left, top, width } = screen.button;
  button.getBoundingClientRect = () =>
    DOMRect.fromRect({ x: left, y: top, width, height: NAME_HEIGHT });

  // The world, as world/Galaxy.ts draws it: where each body is, and how big on the map.
  const byId = new Map(manifest.bodies.map((body) => [body.id, body]));
  const bodies = orbits.ids.map((id) => {
    const body = byId.get(id);
    if (!body) throw new Error(`no body ${id}`);
    return body;
  });
  const positions = new Float64Array(orbits.count * 2);
  const scales = new Float64Array(orbits.count).fill(1);
  const sizes = {
    count: orbits.count,
    parent: orbits.parent,
    orbitRadius: orbits.radius,
    radius: bodies.map((body) => body.radius),
    minRadiusPx: Float64Array.from(bodies, (body) => tuning.map.minRadiusPx[body.kind]),
  };
  let reach = 0;
  const onScreen = new BodiesOnScreen({
    camera,
    positions,
    radii: surroundings.field.radius,
    scales,
    count: orbits.count,
  });

  // The names, and the ship's marker they keep off, as main.ts makes them.
  const shipAt = { x: 0, y: 0 };
  const shipBox = { left: 0, top: 0, width: 0, height: 0 };
  const labels = new Labels({
    overlay,
    screen: onScreen.map,
    bodies: bodies.map((body) => ({
      title: body.title,
      kind: body.kind,
      planned: body.planned === true,
      href: body.docks === false ? body.href : undefined,
    })),
    params: tuning.labels,
    view: rig.shape,
    target: () => -1,
    docked: () => false,
    onPick: () => undefined,
    obstacles: [() => map.box()],
    ship: () => {
      const units = Math.max(1, tuning.map.shipRadiusPx * map.unitsPerPx);
      if (!onScreen.pointAt(spawn.x, spawn.z, shipAt, map.weight * (reach + units))) return null;
      const half = units / map.unitsPerPx;
      shipBox.left = shipAt.x - half;
      shipBox.top = shipAt.y - half;
      shipBox.width = 2 * half;
      shipBox.height = 2 * half;
      return shipBox;
    },
    onMap: () => map.isOpen,
  });
  // By row (the links' names are in a group of their own, after the others).
  const names: HTMLElement[] = [];
  for (const name of overlay.querySelectorAll<HTMLElement>('.body-label')) {
    names[Number(name.dataset.row)] = name;
  }
  for (const name of names) {
    const body = bodies[Number(name.dataset.row)];
    const width = body ? nameWidth(body) : 100;
    Object.defineProperty(name, 'offsetWidth', { get: () => width });
    Object.defineProperty(name, 'offsetHeight', { get: () => NAME_HEIGHT });
  }
  // The tag, the visible part of a name's 44 px box (`.body-label::after` in global.css).
  const computed = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) =>
    pseudo === '::after'
      ? ({ height: `${TAG_HEIGHT}px`, left: '0px' } as CSSStyleDeclaration)
      : computed(element, pseudo),
  );

  rig.resize(viewport);
  rig.setInset({ top: 0, right: 0, bottom: 0 }, true);
  onScreen.resize(viewport);
  map.resize(viewport);
  map.setTop(screen.top);
  labels.resize(viewport);
  labels.setTop(screen.top);
  labels.setFoot(screen.foot);
  map.setOpen(true, true);
  rig.use(new MapCam(map), 0);

  let elapsed = 0;
  const frame = (simTime: number): Frame => ({ elapsed, dt: 1 / 60, alpha: 1, simTime });
  return {
    bodies,
    names,
    screen: onScreen.map,
    /** + on the keyboard: the map zooms in about its middle. */
    zoomIn(): void {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Equal', bubbles: true }));
    },
    step(simTime: number): void {
      elapsed += 1 / 60;
      map.frameUpdate(frame(simTime));
      bodyPositions(orbits, simTime, positions);
      displayScales(sizes, map.unitsPerPx, map.weight, tuning.map, scales);
      reach = 0;
      for (let row = 0; row < orbits.count; row += 1) {
        reach = Math.max(reach, (sizes.radius[row] ?? 0) * (scales[row] ?? 1));
      }
      rig.frameUpdate(frame(simTime));
      onScreen.frameUpdate();
      labels.frameUpdate(frame(simTime));
    },
    dispose(): void {
      labels.dispose();
      map.dispose();
    },
  };
}

/** Where a name hangs from its body (CSS px): the second move of its transform, or null. */
function placeOf(name: HTMLElement): { dx: number; dy: number } | null {
  if (name.dataset.shown === undefined) return null;
  const moves = name.style.transform.match(/-?[\d.]+/g) ?? [];
  return { dx: Number(moves[2] ?? 0), dy: Number(moves[3] ?? 0) };
}

/** A whole turn of the map at rest, one frame at a time: what the names did. */
function watch(size: ScreenSize, zoomIns: number) {
  const world = mapAt(SCREENS[size]);
  try {
    world.step(0);
    for (let press = 0; press < zoomIns; press += 1) world.zoomIn();
    const turnSec = Math.max(...manifest.bodies.map((body) => body.orbit?.periodSec ?? 0));
    const frames = Math.ceil(turnSec * 60);
    const count = world.names.length;
    const was: Array<{ dx: number; dy: number } | null> = new Array(count).fill(null);
    const lastChange = new Float64Array(count).fill(-Infinity);
    let changes = 0;
    const flickers: string[] = [];
    const twice: string[] = [];
    const unnamed = new Set<string>();
    for (let k = 0; k <= frames; k += 1) {
      const t = k / 60;
      world.step(t);
      world.names.forEach((name, row) => {
        const now = placeOf(name);
        const before = was[row] ?? null;
        was[row] = now;
        const body = world.bodies[row];
        if (!now && (body?.kind === 'sun' || body?.kind === 'home')) unnamed.add(body.title);
        if (k === 0) return;
        const moved =
          now && before ? Math.hypot(now.dx - before.dx, now.dy - before.dy) > HOP_PX : false;
        if (!moved && !now === !before) return;
        changes += 1;
        const since = t - (lastChange[row] ?? -Infinity);
        const what = `${body?.title ?? row} at ${t.toFixed(2)} s, ${since.toFixed(2)} s after the last`;
        if (since <= 3 / 60 + 1e-9) flickers.push(what);
        if (since < 1) twice.push(what);
        lastChange[row] = t;
      });
    }
    return {
      perMinute: Math.round((changes / (frames / 60 / 60)) * 100) / 100,
      flickers,
      twice,
      unnamed: [...unnamed],
    };
  } finally {
    world.dispose();
  }
}

/**
 * The most each may be: about half as much again as on 2026-09-30 (above). A change that makes
 * names hop or blink back and forth fails by far.
 */
const MOST: Readonly<Record<ScreenSize, { fit: number; zoomed: number; twice: number }>> = {
  '360x740': { fit: 1, zoomed: 7, twice: 3 },
  '412x839': { fit: 1.2, zoomed: 8, twice: 3 },
  '1280x800': { fit: 12, zoomed: 22, twice: 5 },
};

/** The two tests for one screen, at the view the map opens on and zoomed in twice. */
export function holdsStill(size: ScreenSize): void {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe(`the star map at ${size}, at rest over a whole turn`, () => {
    it('names every system at the view it opens on, and holds its names still there', () => {
      const seen = watch(size, 0);
      expect(seen.unnamed, 'a system with no name').toEqual([]);
      expect(seen.flickers, 'a name that changed again within three frames').toEqual([]);
      expect(seen.twice, 'a name that changed twice within a second').toEqual([]);
      expect(seen.perMinute).toBeLessThanOrEqual(MOST[size].fit);
    });

    it('holds its names still zoomed in twice', () => {
      const seen = watch(size, 2);
      expect(seen.flickers, 'a name that changed again within three frames').toEqual([]);
      expect(seen.twice.length, seen.twice.join('; ')).toBeLessThanOrEqual(MOST[size].twice);
      expect(seen.perMinute).toBeLessThanOrEqual(MOST[size].zoomed);
    });
  });
}

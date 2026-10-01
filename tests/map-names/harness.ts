import { PerspectiveCamera, Vector3 } from 'three';
import { vi } from 'vitest';
import { CameraRig } from '../../src/universe/camera/CameraRig';
import { ChaseCam } from '../../src/universe/camera/ChaseCam';
import { MapCam } from '../../src/universe/camera/MapCam';
import type { Frame } from '../../src/universe/core/Engine';
import { buildUniverse } from '../../src/universe/data/build';
import type { ManifestBody, UniverseManifest } from '../../src/universe/data/types';
import { tuning } from '../../src/universe/design/tuning';
import { homeSystemOf, nearestNeighbourOf } from '../../src/universe/manifest';
import { createRng } from '../../src/universe/sim/rng';
import { boundsOf, displayScales } from '../../src/universe/sim/mapView';
import { bodyPositions } from '../../src/universe/sim/orbits';
import { spawnPoint } from '../../src/universe/sim/spawn';
import { createSurroundings } from '../../src/universe/sim/surroundings';
import { BodiesOnScreen } from '../../src/universe/ui/BodiesOnScreen';
import { Labels, type LabelsOptions } from '../../src/universe/ui/Labels';
import { StarMap } from '../../src/universe/ui/StarMap';
import { grow, readRealInput } from '../../scripts/journeys/galaxies';

// THE STAR MAP'S NAMES, WATCHED FRAME BY FRAME. The real galaxy (src/content, as the build reads
// it, or grown to 6 or 8 systems as scripts/journeys/galaxies.ts grows it), the real StarMap,
// camera rig, projection, Labels and declutter, the ship where a first visit starts, at 60 frames
// a second, on two phones and a laptop. A LOOK says how the visitor looks at the map: how it
// opens (a cut, as under reduced motion, or with its 0.9 s blend from the chase view), how far in
// they zoom, where they drag it with the keys, whether a page is open beside it, and whether
// their fingers are on it. Everything is counted from the moment the map has ARRIVED (its blend
// over, the zoom and the drag done), but the fingers, which are counted as they go.
//
// A name CHANGES when it appears, hides, or moves (more than 10 px beside its body: to another
// side, or slid along it). As bodies go round a name must now and then (another name needs the
// room, or its body takes it past the edge of the view), but it must not flicker (change again
// within three frames of its last change) nor, mostly, change twice within a second. A system's
// name (a sun's, or the home planet's) must be there whenever its body is in view at the view the
// map opens on, and no planet's or moon's tag may lie on a sun or the home planet (a system's only
// as a last resort): those are the landmarks the map is read by.
//
// Two ways to run it. `npm test` (tests/map-names/*.test.ts) looks at samples of a turn: long
// enough each to see every rule at work, spread over the turn, a few seconds a screen. `npm run
// map-names` (sweep.measure.ts) looks at WHOLE turns of the slowest orbit (the Projects binary's,
// 4,470 s), every look, and prints the numbers that docs/PLAN.md §5.4 quotes.
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

/** The real galaxy, or the real one grown to this many systems (home included). */
export type GalaxyKind = 'real' | 6 | 8;

/** How the visitor looks at the map. */
export interface Look {
  readonly size: ScreenSize;
  /** 'real' unless said. */
  readonly galaxy?: GalaxyKind;
  /**
   * 'cut': at once, as under reduced motion. 'blend': from the chase view behind the ship, over
   * the map's 0.9 s blend, as most visitors open it (and the zoom and the keys' drag then ease).
   */
  readonly open?: 'cut' | 'blend';
  /** Presses of + once it has arrived. */
  readonly zoomIns?: number;
  /** Arrow keys held one after another once it has zoomed (the code, and for how long, s). */
  readonly pan?: ReadonlyArray<readonly [code: string, seconds: number]>;
  /** A page open beside the map: a laptop's side panel (right) or a phone's sheet (bottom), px. */
  readonly inset?: { readonly right?: number; readonly bottom?: number };
  /** Fingers on the map while it is watched: strokes, pinches and a slow drag (`fingers`). */
  readonly fingers?: boolean;
}

/** A stretch of a turn to watch: from `from` s into a visit, for `seconds` once the map is there. */
export interface Window {
  readonly from: number;
  readonly seconds: number;
}

/** What the names did, over every window of a look. */
export interface Seen {
  /** Frames watched, and seconds. */
  readonly frames: number;
  readonly seconds: number;
  readonly changes: number;
  readonly perMinute: number;
  /** A name that changed again within three frames of its last change. */
  readonly flickers: readonly string[];
  /** A name that changed again within a second of its last change. */
  readonly twice: readonly string[];
  /** Of those, within 70 ms (four frames): the names a hand sees blink. */
  readonly quick: number;
  /** How many names show, on average. */
  readonly shown: number;
  /**
   * For each system (a sun, or the home planet) whose body was in view at some moment: the share
   * of those moments it had no name. Only the ones that ever went unnamed.
   */
  readonly unnamed: Readonly<Record<string, number>>;
  /** The same for every body, systems included. */
  readonly bodiesUnnamed: Readonly<Record<string, number>>;
  /** Names whose tag lies on a sun or the home planet (not their own), per look (every 0.5 s). */
  readonly onLandmarks: number;
  /** ...of those, a planet's or a moon's (a system's may, as a last resort: ui/Labels.ts). */
  readonly othersOnLandmarks: number;
  /** ...on any body not their own. */
  readonly onBodies: number;
  /**
   * Names below or above their body whose tag is level with another body that is off one of its
   * ends by 30 px or less, per look: a name that reads as that body's.
   */
  readonly crossed: number;
  /**
   * The share of moments at `labels.max` names when a moon's name shows while a planet's (or a
   * station's, a satellite's, a link's) does not, its body 40 px or more inside the view and room
   * for its name under it, over it or beside it: a gap clear of every name that shows but a
   * moon's.
   */
  readonly moonsOverPlanets: number;
  /**
   * Opening with the blend: the changes during it, those of them within 70 ms of the same name's
   * last change, the systems with no name in the frame it arrives, and how long after arriving
   * the last of them came (s; 0 if none was missing).
   */
  readonly blend: {
    readonly changes: number;
    readonly quick: number;
    readonly missingOnArrival: readonly string[];
    readonly lastNamedSec: number;
  } | null;
}

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

/** Labels writes where a name is to the tenth of a pixel: up to this far from where it decided. */
const WRITTEN_PX = 0.05;
/** How far a name must move beside its body to count as a change (CSS px). */
const HOP_PX = 10;
const FPS = 60;
/** Every how many frames where the tags lie is looked at. */
const LOOK_EVERY = 30;

const manifests = new Map<GalaxyKind, UniverseManifest>();
function manifestOf(kind: GalaxyKind): UniverseManifest {
  let manifest = manifests.get(kind);
  if (!manifest) {
    const real = readRealInput();
    manifest = buildUniverse(kind === 'real' ? real : grow(real, kind));
    manifests.set(kind, manifest);
  }
  return manifest;
}

/** A whole turn of a galaxy: its slowest orbit (s). */
export function turnOf(kind: GalaxyKind = 'real'): number {
  return Math.max(...manifestOf(kind).bodies.map((body) => body.orbit?.periodSec ?? 0));
}

/** `count` windows of `seconds` each, spread evenly over a turn. */
export function spread(count: number, seconds: number, kind: GalaxyKind = 'real'): Window[] {
  const turn = turnOf(kind);
  return Array.from({ length: count }, (_, k) => ({ from: (k * turn) / count, seconds }));
}

/** The names of a look, as main.ts makes them (`labels` replaces them: another version to compare). */
export type MakeLabels = (options: LabelsOptions) => {
  frameUpdate(frame: Frame): void;
  resize(viewport: { width: number; height: number; pixelRatio: number }): void;
  setTop(px: number): void;
  setFoot(foot: { right: number; top: number } | null): void;
  remeasure?(): void;
  dispose(): void;
};

/** The map, looked at as `look` says, and a step of the world as main.ts takes it. */
function mapAt(look: Look, makeLabels?: MakeLabels) {
  const screen: Screen = SCREENS[look.size];
  const manifest = manifestOf(look.galaxy ?? 'real');
  const cut = (look.open ?? 'cut') === 'cut';
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
  // Flying, the camera chases the ship, parked where a first visit starts.
  const chase = new ChaseCam(
    { position: new Vector3(spawn.x, 0, spawn.z), heading: spawn.heading, speed: 0 },
    { reducedMotion: cut },
  );
  const rig = new CameraRig(camera, chase, tuning.cameraRig);
  const map = new StarMap({
    canvas,
    overlay,
    bounds: boundsOf(manifest.systems),
    ship: () => spawn,
    view: rig.shape,
    params: tuning.map,
    reducedMotion: cut,
    onChange: () => undefined,
  });
  const mapCam = new MapCam(map);
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
  const options: LabelsOptions = {
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
      if (!map.isOpen) return null;
      const units = Math.max(1, tuning.map.shipRadiusPx * map.unitsPerPx);
      if (!onScreen.pointAt(spawn.x, spawn.z, shipAt, map.weight * (reach + units))) return null;
      const half = units / map.unitsPerPx;
      shipBox.left = shipAt.x - half;
      shipBox.top = shipAt.y - half;
      shipBox.width = 2 * half;
      shipBox.height = 2 * half;
      return shipBox;
    },
    onMap: () => map.arrived,
  };
  const labels = makeLabels ? makeLabels(options) : new Labels(options);
  // By row (the links' names are in a group of their own, after the others).
  const names: HTMLElement[] = [];
  for (const name of overlay.querySelectorAll<HTMLElement>('.body-label')) {
    names[Number(name.dataset.row)] = name;
  }
  // What each name shows, as Labels writes it: plain objects instead of the DOM's, so that
  // watching every name in every frame of a turn costs next to nothing. `box` is where the name's
  // box was last put, and `body` where its body was then (the transform's two moves, or for an
  // older Labels with one move, the body where it is at the time of looking: NaN).
  const box = new Float64Array(names.length * 2);
  const body = new Float64Array(names.length * 2).fill(Number.NaN);
  const datasets: Array<Record<string, string | undefined>> = [];
  names.forEach((name, row) => {
    const at = bodies[row];
    const nameW = at ? nameWidth(at) : 100;
    Object.defineProperty(name, 'offsetWidth', { get: () => nameW });
    Object.defineProperty(name, 'offsetHeight', { get: () => NAME_HEIGHT });
    const dataset: Record<string, string | undefined> = { ...name.dataset };
    datasets[row] = dataset;
    Object.defineProperty(name, 'dataset', { value: dataset });
    let transform = '';
    Object.defineProperty(name, 'style', {
      value: {
        get transform() {
          return transform;
        },
        set transform(value: string) {
          transform = value;
          const moves = value.match(/-?[\d.]+/g) ?? [];
          if (moves.length >= 4) {
            box[2 * row] = Number(moves[0]) + Number(moves[2]);
            box[2 * row + 1] = Number(moves[1]) + Number(moves[3]);
            body[2 * row] = Number(moves[0]);
            body[2 * row + 1] = Number(moves[1]);
          } else {
            box[2 * row] = Number(moves[0]);
            box[2 * row + 1] = Number(moves[1]);
          }
        },
      },
    });
  });
  // The tag, the visible part of a name's 44 px box (`.body-label::after` in global.css).
  const computed = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) =>
    pseudo === '::after'
      ? ({ height: `${TAG_HEIGHT}px`, left: '0px' } as CSSStyleDeclaration)
      : computed(element, pseudo),
  );

  rig.resize(viewport);
  rig.setInset({ top: 0, right: look.inset?.right ?? 0, bottom: look.inset?.bottom ?? 0 }, true);
  onScreen.resize(viewport);
  map.resize(viewport);
  map.setTop(screen.top);
  labels.resize(viewport);
  labels.setTop(screen.top);
  labels.setFoot(screen.foot);

  let elapsed = 0;
  const frame = (simTime: number): Frame => ({ elapsed, dt: 1 / FPS, alpha: 1, simTime });
  return {
    size: look.size,
    bodies,
    names,
    map,
    screen: onScreen.map,
    view: rig.shape,
    shown: (row: number): boolean => datasets[row]?.shown !== undefined,
    side: (row: number): string => datasets[row]?.side ?? 'below',
    /** Where a name's box is, and where it hangs from its body (CSS px). */
    boxX: (row: number): number => box[2 * row] ?? Number.NaN,
    boxY: (row: number): number => box[2 * row + 1] ?? Number.NaN,
    bodyX: (row: number): number => body[2 * row] ?? onScreen.map.x[row] ?? Number.NaN,
    bodyY: (row: number): number => body[2 * row + 1] ?? onScreen.map.y[row] ?? Number.NaN,
    width: (row: number): number => {
      const at = bodies[row];
      return at ? nameWidth(at) : 0;
    },
    /** Open the map, as main.ts does: the camera goes over to the map's (a cut, or the blend). */
    open(): void {
      map.setOpen(true, cut);
      rig.use(mapCam, cut ? 0 : tuning.map.blendSec);
      labels.remeasure?.();
    },
    key(code: string, down: boolean): void {
      window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true }));
    },
    pointer(type: 'pointerdown' | 'pointermove' | 'pointerup', id: number, x: number, y: number) {
      canvas.dispatchEvent(
        new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, pointerType: 'touch' }),
      );
    },
    step(simTime: number): void {
      elapsed += 1 / FPS;
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
      vi.restoreAllMocks();
    },
  };
}

type World = ReturnType<typeof mapAt>;

/**
 * A visitor's fingers on the map, frame by frame from `t0` (s): 16 strokes of 90 to 120 px over
 * 0.6 s, each after a pause of 1.2 s, this way and that; then 8 pinches, 60 px apart to 150 and
 * back, each over 0.6 s with the same pause; then one slow drag of 160 px over 4 s. About 47 s.
 * What a finger does in the frame at `t`, or nothing once it is all done (false).
 */
function fingersAt(world: World, t: number, plan: FingerPlan): boolean {
  const { width, height, top } = SCREENS[plan.size];
  const middle = { x: width / 2, y: (top + height) / 2 };
  for (;;) {
    const move = plan.moves[plan.next];
    if (!move) return false;
    if (t < move.start) return true;
    if (!plan.down) {
      plan.down = true;
      const [a, b] = move.fingers(0);
      world.pointer('pointerdown', 1, middle.x + a.x, middle.y + a.y);
      if (b) world.pointer('pointerdown', 2, middle.x + b.x, middle.y + b.y);
    }
    const s = Math.min(1, (t - move.start) / move.seconds);
    const [a, b] = move.fingers(s);
    world.pointer('pointermove', 1, middle.x + a.x, middle.y + a.y);
    if (b) world.pointer('pointermove', 2, middle.x + b.x, middle.y + b.y);
    if (s < 1) return true;
    world.pointer('pointerup', 1, middle.x + a.x, middle.y + a.y);
    if (b) world.pointer('pointerup', 2, middle.x + b.x, middle.y + b.y);
    plan.down = false;
    plan.next += 1;
  }
}

interface Point {
  readonly x: number;
  readonly y: number;
}

interface FingerMove {
  readonly start: number;
  readonly seconds: number;
  /** Where the fingers are at `s` (0 to 1) of the move, from the middle of the screen (px). */
  fingers(s: number): readonly [Point, Point?];
}
interface FingerPlan {
  readonly size: ScreenSize;
  readonly moves: FingerMove[];
  next: number;
  down: boolean;
}

function planFingers(size: ScreenSize, t0: number, rng: () => number): FingerPlan {
  const moves: FingerMove[] = [];
  let at = t0 + 1.2;
  for (let k = 0; k < 16; k += 1) {
    const length = 90 + rng() * 30;
    const angle = (k * Math.PI) / 2 + (rng() - 0.5) * 0.6;
    const from = { x: (rng() - 0.5) * 80, y: (rng() - 0.5) * 80 };
    const way = { x: Math.cos(angle) * length, y: Math.sin(angle) * length };
    moves.push({
      start: at,
      seconds: 0.6,
      fingers: (s) => [{ x: from.x + way.x * s, y: from.y + way.y * s }],
    });
    at += 1.8;
  }
  for (let k = 0; k < 8; k += 1) {
    const [a, b] = k % 2 === 0 ? [60, 150] : [150, 60];
    const angle = rng() * Math.PI;
    const centre = { x: (rng() - 0.5) * 60, y: (rng() - 0.5) * 60 };
    moves.push({
      start: at,
      seconds: 0.6,
      fingers: (s) => {
        const half = (a + (b - a) * s) / 2;
        const dx = Math.cos(angle) * half;
        const dy = Math.sin(angle) * half;
        return [
          { x: centre.x - dx, y: centre.y - dy },
          { x: centre.x + dx, y: centre.y + dy },
        ];
      },
    });
    at += 1.8;
  }
  moves.push({ start: at, seconds: 4, fingers: (s) => [{ x: -80 + 160 * s, y: 20 * s }] });
  return { size, moves, next: 0, down: false };
}

/** Is a body's disc in the part of the view where names may go? */
function inView(world: World, row: number): boolean {
  const { screen, view } = world;
  const { width, height, top } = SCREENS[world.size];
  if (!((screen.depth[row] ?? 0) > 0)) return false;
  const r = screen.radius[row] ?? 0;
  if (r < tuning.labels.minVisiblePx) return false;
  const x = screen.x[row] ?? 0;
  const y = screen.y[row] ?? 0;
  return (
    x > -r && x < width * view.freeWidth + r && y > top - r && y < height * view.freeHeight + r
  );
}

/** Whether a body's centre is in the part of the view where names may go. */
function centreInView(world: World, row: number): boolean {
  const { screen, view } = world;
  const { width, height, top } = SCREENS[world.size];
  if (!((screen.depth[row] ?? 0) > 0)) return false;
  if ((screen.radius[row] ?? 0) < tuning.labels.minVisiblePx) return false;
  const x = screen.x[row] ?? 0;
  const y = screen.y[row] ?? 0;
  return x >= 0 && x <= width * view.freeWidth && y >= top && y <= height * view.freeHeight;
}

const isLandmark = (kind: string | undefined): boolean => kind === 'sun' || kind === 'home';

/**
 * Watch the names of a look over `windows` of a turn, each afresh: the map opens at the window's
 * start, as the look says, and is watched for its seconds from the moment it has arrived.
 */
export function watch(look: Look, windows: readonly Window[], makeLabels?: MakeLabels): Seen {
  let frames = 0;
  let changes = 0;
  let quick = 0;
  let shownSum = 0;
  let looks = 0;
  let onLandmarks = 0;
  let othersOnLandmarks = 0;
  let onBodies = 0;
  let crossed = 0;
  let moonsOverPlanets = 0;
  const flickers: string[] = [];
  const twice: string[] = [];
  const inViewFrames = new Map<string, number>();
  const unnamedFrames = new Map<string, number>();
  const systemsInView = new Map<string, number>();
  const systemsUnnamed = new Map<string, number>();
  const blend: { changes: number; quick: number; missing: Set<string>; lastNamed: number } | null =
    look.open === 'blend' ? { changes: 0, quick: 0, missing: new Set(), lastNamed: 0 } : null;
  const rng = createRng(`map-names ${look.size}`);

  for (const { from, seconds } of windows) {
    const world = mapAt(look, makeLabels);
    try {
      const count = world.names.length;
      const wasShown = new Uint8Array(count);
      const wasX = new Float64Array(count);
      const wasY = new Float64Array(count);
      const lastChange = new Float64Array(count).fill(-Infinity);
      let t = from;
      const tick = (): void => {
        world.step(t);
        t += 1 / FPS;
      };
      /** One frame's look at the names: what changed (counted only while `counting`). */
      const see = (counting: boolean, during: 'blend' | 'watch', since: number): number => {
        let changed = 0;
        for (let row = 0; row < count; row += 1) {
          const shows = world.shown(row);
          const dx = world.boxX(row) - world.bodyX(row);
          const dy = world.boxY(row) - world.bodyY(row);
          const moved =
            shows && wasShown[row] === 1
              ? Math.hypot(dx - (wasX[row] ?? 0), dy - (wasY[row] ?? 0)) > HOP_PX
              : false;
          const flipped = shows !== (wasShown[row] === 1);
          wasShown[row] = shows ? 1 : 0;
          if (shows) {
            wasX[row] = dx;
            wasY[row] = dy;
          }
          if (!counting || (!moved && !flipped)) continue;
          changed += 1;
          const gap = t - (lastChange[row] ?? -Infinity);
          lastChange[row] = t;
          if (during === 'blend') {
            if (blend) blend.changes += 1;
            if (blend && gap <= 4 / FPS + 1e-9) blend.quick += 1;
            continue;
          }
          const what = `${world.bodies[row]?.title ?? row} at ${(t - since).toFixed(2)} s (${t.toFixed(1)} s into the visit), ${gap.toFixed(2)} s after its last change`;
          changes += 1;
          if (gap <= 3 / FPS + 1e-9) flickers.push(what);
          if (gap < 1) twice.push(what);
          if (gap <= 4 / FPS + 1e-9) quick += 1;
        }
        return changed;
      };

      // Flying, then the map. With the blend, two seconds of the chase view first (what the
      // names were doing in flight is where they start from), and the blend is watched too.
      if (!world.map.isOpen && look.open === 'blend') {
        for (let k = 0; k < 2 * FPS; k += 1) {
          tick();
          see(false, 'blend', 0);
        }
      }
      world.open();
      while (!world.map.arrived) {
        tick();
        see(blend !== null, 'blend', 0);
      }
      const arrival = t;
      if (blend) {
        // The frame it arrives in: which systems in view have no name yet.
        for (let row = 0; row < count; row += 1) {
          const at = world.bodies[row];
          if (isLandmark(at?.kind) && centreInView(world, row) && !world.shown(row)) {
            blend.missing.add(at?.title ?? String(row));
          }
        }
      }
      // Zoomed in, and dragged with the keys: the view moves, and is let come to rest.
      for (let press = 0; press < (look.zoomIns ?? 0); press += 1) {
        world.key('Equal', true);
        world.key('Equal', false);
      }
      for (const [code, held] of look.pan ?? []) {
        world.key(code, true);
        for (let k = 0; k < held * FPS; k += 1) {
          tick();
          see(false, 'watch', 0);
        }
        world.key(code, false);
      }
      // The view eases to where it was sent (with the blend's motion): two seconds more.
      if (look.open === 'blend' && ((look.zoomIns ?? 0) > 0 || (look.pan?.length ?? 0) > 0)) {
        for (let k = 0; k < 2 * FPS; k += 1) {
          tick();
          see(false, 'watch', 0);
        }
      }
      const since = t;
      const plan = look.fingers ? planFingers(look.size, since, rng) : null;
      let missingUntil = blend && blend.missing.size > 0 ? Infinity : arrival;
      const end = since + seconds;
      let frame = 0;
      // The first frame of the watch is where the names start from: no change of its own.
      tick();
      see(false, 'watch', since);
      while (t < end) {
        if (plan) fingersAt(world, t, plan);
        tick();
        see(true, 'watch', since);
        frame += 1;
        frames += 1;
        let shownNow = 0;
        let systemMissing = false;
        for (let row = 0; row < count; row += 1) {
          const at = world.bodies[row];
          const title = at?.title ?? String(row);
          const shows = world.shown(row);
          if (shows) shownNow += 1;
          if (inView(world, row)) {
            inViewFrames.set(title, (inViewFrames.get(title) ?? 0) + 1);
            if (!shows) unnamedFrames.set(title, (unnamedFrames.get(title) ?? 0) + 1);
          }
          if (isLandmark(at?.kind) && centreInView(world, row)) {
            systemsInView.set(title, (systemsInView.get(title) ?? 0) + 1);
            if (!shows) {
              systemsUnnamed.set(title, (systemsUnnamed.get(title) ?? 0) + 1);
              systemMissing = true;
            }
          }
        }
        shownSum += shownNow;
        if (shownNow >= tuning.labels.max && moonOverPlanet(world)) moonsOverPlanets += 1;
        if (blend && !systemMissing && missingUntil === Infinity) missingUntil = t;
        if (frame % LOOK_EVERY === 0) {
          looks += 1;
          const lying = tagsLying(world);
          onLandmarks += lying.landmarks;
          othersOnLandmarks += lying.others;
          onBodies += lying.bodies;
          crossed += lying.crossed;
        }
      }
      if (blend) {
        blend.lastNamed = Math.max(
          blend.lastNamed,
          (missingUntil === Infinity ? end : missingUntil) - arrival,
        );
      }
    } finally {
      world.dispose();
    }
  }
  const seconds = frames / FPS;
  const share = (part: Map<string, number>, whole: Map<string, number>) =>
    Object.fromEntries(
      [...part.entries()]
        .map(([title, n]) => [title, round(n / (whole.get(title) ?? 1), 4)] as const)
        .filter(([, value]) => value > 0)
        .sort(([, a], [, b]) => b - a),
    );
  return {
    frames,
    seconds,
    changes,
    perMinute: round(changes / (seconds / 60), 2),
    flickers,
    twice,
    quick,
    shown: round(shownSum / Math.max(1, frames), 2),
    unnamed: share(systemsUnnamed, systemsInView),
    bodiesUnnamed: share(unnamedFrames, inViewFrames),
    onLandmarks: round(onLandmarks / Math.max(1, looks), 3),
    othersOnLandmarks: round(othersOnLandmarks / Math.max(1, looks), 3),
    onBodies: round(onBodies / Math.max(1, looks), 3),
    crossed: round(crossed / Math.max(1, looks), 3),
    moonsOverPlanets: round(moonsOverPlanets / Math.max(1, frames), 4),
    blend: blend && {
      changes: blend.changes,
      quick: blend.quick,
      missingOnArrival: [...blend.missing],
      lastNamedSec: round(blend.lastNamed, 3),
    },
  };
}

/** Does a moon's name show while a planet's waits, its body 40 px or more inside the view? */
function moonOverPlanet(world: World): boolean {
  const { screen, view } = world;
  const { width, height, top } = SCREENS[world.size];
  const { offsetPx, edgePx, gapPx, minVisiblePx } = tuning.labels;
  const right = width * view.freeWidth - edgePx;
  const bottom = height * view.freeHeight - edgePx;
  let moon = false;
  let planet = false;
  for (let row = 0; row < world.names.length && !(moon && planet); row += 1) {
    const kind = world.bodies[row]?.kind;
    if (kind === 'moon') {
      moon ||= world.shown(row);
      continue;
    }
    if (planet || kind === 'sun' || kind === 'home' || world.shown(row)) continue;
    if (!((screen.depth[row] ?? 0) > 0)) continue;
    const r = screen.radius[row] ?? 0;
    if (r < minVisiblePx) continue;
    const x = screen.x[row] ?? 0;
    const y = screen.y[row] ?? 0;
    if (x < 40 || x > width * view.freeWidth - 40 || y < top + 40 || y > bottom + edgePx - 40) {
      continue;
    }
    // Room for its name under its body, over it, or beside it: in the free view, and a gap clear
    // of every name that shows but a moon's.
    const w = world.width(row);
    const spots: ReadonlyArray<readonly [number, number]> = [
      [x - w / 2, y + r + offsetPx],
      [x - w / 2, y - r - offsetPx - NAME_HEIGHT],
      [x + r + offsetPx, y - NAME_HEIGHT / 2],
      [x - r - offsetPx - w, y - NAME_HEIGHT / 2],
    ];
    const roof = Math.max(top + edgePx, tuning.labels.topPx);
    for (const [left, above] of spots) {
      if (left < edgePx || left + w > right || above < roof || above + NAME_HEIGHT > bottom) {
        continue;
      }
      let clear = true;
      for (let other = 0; other < world.names.length && clear; other += 1) {
        if (!world.shown(other) || world.bodies[other]?.kind === 'moon') continue;
        const ox = world.boxX(other);
        const oy = world.boxY(other);
        clear =
          left - gapPx >= ox + world.width(other) ||
          left + w + gapPx <= ox ||
          above - gapPx >= oy + NAME_HEIGHT ||
          above + NAME_HEIGHT + gapPx <= oy;
      }
      if (clear) planet = true;
    }
  }
  return moon && planet;
}

/**
 * The tags of the names that show, and what they lie on: a sun or the home planet (not their
 * own body), any other body, and (below or above their body) another body level with them within
 * 30 px of an end, which they read as the name of.
 */
function tagsLying(world: World): {
  landmarks: number;
  others: number;
  bodies: number;
  crossed: number;
} {
  const { screen } = world;
  let landmarks = 0;
  let others = 0;
  let bodies = 0;
  let crossed = 0;
  const count = world.names.length;
  for (let row = 0; row < count; row += 1) {
    if (!world.shown(row)) continue;
    const side = world.side(row);
    const left = world.boxX(row);
    const y = world.boxY(row);
    const top =
      side === 'above'
        ? y + NAME_HEIGHT - TAG_HEIGHT
        : side === 'left' || side === 'right'
          ? y + (NAME_HEIGHT - TAG_HEIGHT) / 2
          : y;
    const right = left + world.width(row);
    const bottom = top + TAG_HEIGHT;
    let onLandmark = false;
    let onBody = false;
    let level = false;
    for (let other = 0; other < count; other += 1) {
      if (other === row || !((screen.depth[other] ?? 0) > 0)) continue;
      const r = screen.radius[other] ?? 0;
      if (r < tuning.labels.minVisiblePx) continue;
      const x = screen.x[other] ?? 0;
      const oy = screen.y[other] ?? 0;
      const dx = x - Math.min(Math.max(x, left), right);
      const dy = oy - Math.min(Math.max(oy, top), bottom);
      // On it by more than the rounding of where the name was written (a twentieth of a pixel).
      const into = r - WRITTEN_PX;
      if (dx * dx + dy * dy < into * into) {
        onBody = true;
        if (isLandmark(world.bodies[other]?.kind)) onLandmark = true;
      }
      if (
        (side === 'below' || side === 'above') &&
        dy === 0 &&
        dx !== 0 &&
        Math.abs(dx) - r <= 30
      ) {
        level = true;
      }
    }
    if (onLandmark) landmarks += 1;
    if (onLandmark && !isLandmark(world.bodies[row]?.kind)) others += 1;
    if (onBody) bodies += 1;
    if (level) crossed += 1;
  }
  return { landmarks, others, bodies, crossed };
}

function round(value: number, places: number): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

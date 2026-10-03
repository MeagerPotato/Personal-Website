import GUI from 'lil-gui';
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  LineLoop,
  SRGBColorSpace,
  Vector3,
  WebGLRenderTarget,
} from 'three';
import { CameraRig } from '../camera/CameraRig';
import { AssetStore } from '../core/AssetStore';
import { Engine, type Frame, type System, type Viewport } from '../core/Engine';
import { PerfHud } from '../core/debug/PerfHud';
import { addControls, copyText } from '../core/debug/guiControls';
import { JobQueue } from '../core/jobs';
import { TIERS, type QualityTier } from '../core/quality/tiers';
import { Scope } from '../core/scope';
import {
  createGlowMaterial,
  createLineMaterial,
  createToonMaterial,
  refreshToonLook,
  setBloomMask,
  setToonFlatness,
  type ToonMaterial,
} from '../design/materials';
import type { StarClass } from '../design/lookTypes';
import { skyColours } from '../design/skyRecipe';
import { tokens, type AirKey, type BiomeKey, type StarKey, type ThemeKey } from '../design/tokens';
import { tuning } from '../design/tuning';
import { BODIES } from '../design/worlds/bodies';
import { readManifest, type ManifestBody, type ManifestSystem } from '../manifest';
import { PostFX } from '../fx/PostFX';
import { EngineFlame } from '../ship/EngineFlame';
import { Rocket } from '../ship/Rocket';
import { TAU } from '../sim/math';
import { bodyPositions, createOrbitTable } from '../sim/orbits';
import { planetTriangleCount } from '../sim/planet';
import { createRng, pickWeighted } from '../sim/rng';
import { directionOf, SKY_POSE_NAMES, SKY_POSES, type SkyPoseName } from '../sim/skyDirections';
import { createSkyOracle, luminance } from '../sim/skyOracle';
import { sunSeed } from '../sim/sunSurface';
import { isLivingSun, type GroundSpec } from '../sim/world/ground';
import { rowsOf, type BodyRecipe } from '../sim/world/rows';
import { buildStarList, STAR_KINDS, type StarKind, type StarList } from '../sim/starList';
import { AirShells } from '../world/AirShells';
import { Backdrop } from '../world/Backdrop';
import { Chart } from '../world/Chart';
import { BodyMesh, CloseUpLoader } from '../world/BodyMesh';
import { PlanetMesh } from '../world/PlanetMesh';
import { SkyBake } from '../world/SkyBake';
import { starGeometry, Starfield } from '../world/Starfield';
import { SunCorona } from '../world/SunCorona';
import { Traffic } from '../world/Traffic';
import { airOf, lookOf, type LookedAt } from '../world/looks';
import { TurntableCam } from './TurntableCam';

const SUBJECTS = [
  'world',
  'planet',
  'moon',
  'sun',
  'rocket',
  'station',
  'satellite',
  'relay',
  'sky',
  'stars',
  'orbits',
  'chart',
] as const;
type Subject = (typeof SUBJECTS)[number];

/** What the `stars` subject shows: the sky's own stars, or a sheet of one kind of them. */
const STAR_SHEETS = ['sky', ...STAR_KINDS] as const;
type StarSheet = (typeof STAR_SHEETS)[number];
const STAR_TINTS = ['mixed', ...(Object.keys(tokens.color.star) as StarKey[])] as const;
type StarTint = (typeof STAR_TINTS)[number];
/** View heights, CSS px, a star's sizes can be judged at (0: this window's own). */
const STAR_ROWS = [0, 600, 800, 1080];
/** A sheet: this many stars across and down, this many degrees apart. */
const SHEET: Record<StarKind, readonly [across: number, down: number, stepDeg: number]> = {
  dust: [40, 24, 1.6],
  field: [24, 14, 2.6],
  bright: [12, 7, 5],
  mid: [8, 5, 7],
  hero: [4, 2, 14],
};

/**
 * A sheet of one kind of star, laid out in front of a view of the sky: a grid, each star nudged
 * off its place (a star field in rows reads as a pattern, not as stars), across the kind's whole
 * range of brightness, in one tint or in the sky's mix of them.
 */
function starSheet(kind: StarKind, tint: StarTint, pose: SkyPoseName): StarList<StarKey> {
  const { classes, palette, heroes, twinkleShare } = tuning.starfield;
  const [across, down, stepDeg] = SHEET[kind];
  const count = across * down;
  const view = SKY_POSES[pose] ?? SKY_POSES.first;
  const rng = createRng(`lab-stars-${kind}`);
  const cls: StarClass | null = kind === 'hero' ? null : classes[kind];
  const list = {
    count,
    directions: new Float32Array(count * 3),
    brightness: new Float32Array(count),
    kinds: new Uint8Array(count).fill(STAR_KINDS.indexOf(kind)),
    tints: [] as StarKey[],
    sizes: new Float32Array(count).fill(1),
    phases: new Float32Array(count),
    twinkles: new Uint8Array(count),
  };
  for (let i = 0; i < count; i += 1) {
    const nudge = kind === 'hero' ? 0 : 0.7;
    const column = (i % across) - (across - 1) / 2 + (rng() - 0.5) * nudge;
    const row = Math.floor(i / across) - (down - 1) / 2 + (rng() - 0.5) * nudge;
    list.directions.set(
      directionOf(view.yawDeg + column * stepDeg, view.pitchDeg + row * stepDeg),
      i * 3,
    );
    const [lo, hi] = cls ? cls.yRange : [1, 1];
    list.brightness[i] = lo + (hi - lo) * rng() ** (cls?.yExp ?? 1);
    const any = pickWeighted(rng, cls?.palette ?? palette);
    // The heroes of the sheet are the sky's eight: their sizes, and (mixed) their tints.
    const hero = kind === 'hero' ? heroes[i % heroes.length] : undefined;
    list.tints.push(tint !== 'mixed' ? tint : (hero?.tint ?? any));
    if (hero) list.sizes[i] = hero.size;
    // A class whose spikes vary in length (the mids) shows its whole range of them.
    else if (cls?.sizeRange) {
      const [short, long] = cls.sizeRange;
      list.sizes[i] = short + (long - short) * rng();
    }
    list.phases[i] = rng();
    const twinkles = kind !== 'hero' && kind !== 'mid' && rng() < twinkleShare;
    list.twinkles[i] = twinkles ? 1 : 0;
  }
  return list;
}

/** The emblem worlds, by manifest id (design/worlds/): the `world` subject shows any of them. */
const WORLD_IDS = Object.keys(BODIES).sort();

/** What the lab needs of a body to draw its world as the galaxy does. */
type WorldBody = Pick<ManifestBody, 'kind' | 'radius' | 'seed' | 'planned'>;

/** A guess at each kind's size, until /universe.json says (tuning.layout has the real ones). */
const GUESSED_RADIUS: Partial<Record<ManifestBody['kind'], number>> = {
  home: 14,
  station: 2.2,
  satellite: 1.6,
  link: 1.4,
  sun: 20,
};

/**
 * Before /universe.json has arrived (or if it cannot), a body's kind is guessed from its id, at
 * a planet's size: close enough to look at its rows. A relay waiting for its URL (Devpost) is
 * never in the manifest, and is guessed right.
 */
function guessBody(id: string): WorldBody {
  const kind: ManifestBody['kind'] =
    id === 'page/about'
      ? 'home'
      : id === 'page/resume'
        ? 'station'
        : id === 'page/contact'
          ? 'satellite'
          : id.startsWith('link/')
            ? 'link'
            : id.startsWith('system/')
              ? 'sun'
              : 'planet';
  return { kind, radius: GUESSED_RADIUS[kind] ?? 8, seed: id };
}

/** What kind of body a subject is: a relay is a link's body (a profile elsewhere). */
const KIND_OF = {
  planet: 'planet',
  moon: 'moon',
  station: 'station',
  satellite: 'satellite',
  relay: 'link',
} as const satisfies Record<
  Exclude<Subject, 'rocket' | 'world' | 'sun' | 'sky' | 'stars' | 'orbits' | 'chart'>,
  LookedAt['kind']
>;

/** Whose air the thing on show wears: what the galaxy gives it, none, or one of the tokens'. */
const AIR_CHOICES = ['galaxy', 'none', ...(Object.keys(tokens.color.air) as AirKey[])] as const;
type AirChoice = (typeof AIR_CHOICES)[number];

/**
 * The `orbits` subject: a made-up system on the flight plane below and ahead of the view, as the
 * chase camera sees one. Four planets' orbits (the real radii of a system of four) and, further
 * out, a path as wide as a binary's sun's, which is drawn fainter.
 */
const ORBIT_RADII = [60.2, 98.6, 137, 175.4];
const TRACK_RADIUS = 240;
/** How far ahead of the view the system's centre is, and how far below it the flight plane (u). */
const ORBITS_AHEAD = 220;
const ORBITS_BELOW = 30;

/** The blocks of design/tuning.ts whose effect can be judged here. */
const LAB_BLOCKS = ['shading', 'planet', 'world', 'post', 'ship'] as const;

/** Rebuilding a planet on every tick of a slider would queue dozens of them. */
const REBUILD_AFTER_MS = 120;
const LIGHT_DISTANCE = 10000;
/** The rocket is 2 u long (design/models/rocket.ts); this leaves room for its flame. */
const ROCKET_FRAME_RADIUS = 1.7;

export interface LabOptions {
  mount: HTMLElement;
  tier: QualityTier;
  /** The visitor picked another tier. A tier is a property of the canvas, so the owner reboots. */
  onTier(tier: QualityTier): void;
  /**
   * What to show, from the page's address, so that a view can be linked to and photographed
   * (scripts/look/capture.mjs): any key of the table's state (`subject=sky`, `pose=first`,
   * `theme=mint`, `world=page/about`, `near=1`...), and three of the lab's own: `turn` (the
   * turntable's rad/s), `still=1` (the sky as under reduced motion: no twinkle, no drift) and
   * `ui=0` (no panel and no read-out: only the picture).
   */
  query?: ReadonlyMap<string, string>;
  /** The first frame is on the screen. */
  onReady?(): void;
}

/** Write what the address asks for into the table's state, each value as the kind it replaces. */
function applyQuery(state: Record<string, unknown>, query: ReadonlyMap<string, string>): void {
  for (const [key, value] of query) {
    const now = state[key];
    if (typeof now === 'number' && Number.isFinite(Number(value))) state[key] = Number(value);
    else if (typeof now === 'boolean') state[key] = value !== '0' && value !== 'false';
    else if (typeof now === 'string') state[key] = value;
  }
}

/**
 * DEV ONLY: `/lab/` under `npm run dev`. ONE thing on a turntable, in front of the real sky, lit
 * and post-processed exactly as in the universe, with sliders for the tuning that shapes it. This
 * is where a planet biome, a model or a shading change is judged before it is judged in flight
 * (docs/DESIGN.md). api.ts imports this file behind `import.meta.env.DEV`, and
 * scripts/verify-dist.mjs proves that no build contains it.
 */
export function bootLab(options: LabOptions): { dispose(): void } {
  const { mount } = options;
  const query = options.query ?? new Map<string, string>();
  const bare = query.get('ui') === '0';
  const still = query.get('still') === '1';
  const tier = tuning.quality.tiers[options.tier];
  setBloomMask(tier.post);

  const engine = new Engine({
    mount,
    quality: tier,
    pipeline: (renderer, samples) => new PostFX(renderer, samples),
    coarsePointer: false,
    canDemote: false,
    onFirstFrame: () => options.onReady?.(),
    onDemote: () => undefined,
    onContextLost: () => console.warn('[lab] WebGL context lost: reload the page'),
  });

  const assets = engine.add(new AssetStore());
  const jobs = new JobQueue(tuning.world.jobBudget);
  const camera = new TurntableCam(engine.canvas);
  const turn = Number(query.get('turn'));
  if (query.has('turn') && Number.isFinite(turn)) camera.turnRate = turn;
  const low = options.tier === 'low';
  // The view as the stars are told of it (they size themselves in CSS px, by its height).
  const viewport = (): Viewport => ({
    width: mount.clientWidth || 1,
    height: mount.clientHeight || 1,
    pixelRatio: 1,
  });
  const starfield = engine.add(new Starfield({ coarsePointer: false, reducedMotion: still, low }));
  const table = engine.add(new Turntable(assets, jobs, camera, starfield, low, viewport, query));
  // The worlds' kinds and sizes, as the galaxy has them; until then, and without it, a guess.
  void fetch('/universe.json')
    .then((response) => response.json())
    .then((data: unknown) => table.know(readManifest(data)))
    .catch(() => undefined);
  engine.add(new CameraRig(engine.camera, camera, tuning.cameraRig));

  const backdrop = engine.add(new Backdrop());
  engine.scene.add(backdrop.object, starfield.object, table.object);
  engine.add(jobs);
  // The baked sky as the universe has it, but painted at once (two bands a frame, and a cut).
  // It is quieter while docked and on the star map: the lab says which with two of its controls.
  const page = mount.ownerDocument.documentElement;
  engine.add({
    frameUpdate: () => sky.setView(table.state.docked, table.mapWeight),
    dispose: () => undefined,
  });
  const sky = engine.add(
    new SkyBake({
      renderer: engine.renderer,
      tier: tuning.look.sky.tiers[options.tier],
      seen: true,
      reducedMotion: still,
      onState: (state) => {
        page.dataset.sky = state;
      },
      onBand: () => engine.excuseFrame(),
    }),
  );
  const meter = engine.add(new SkyMeter(engine, backdrop, sky, page, query.get('parity') === '1'));
  if (!bare) {
    engine.add(
      new PerfHud(mount, engine.renderer, () => [
        `tier  ${options.tier} x${engine.resolutionScale.toFixed(2)}`,
        `shows ${table.describe()}`,
        `stars ${starfield.object.geometry.instanceCount}`,
        `sky Y ${meter.text}`,
      ]),
    );
  }

  const gui = new GUI({ title: 'universe-lab (dev only)' });
  if (bare) gui.hide();
  const { state } = table;
  let timer = 0;
  const rebuild = (): void => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => table.show(), REBUILD_AFTER_MS);
  };

  gui.add(state, 'subject', SUBJECTS).onChange(rebuild);
  // An emblem world, as the galaxy draws it (world/BodyMesh.ts): far, or up close with its
  // close-up parts and, unless it holds still, its movers; or its star map variant.
  const emblem = gui.addFolder('world (subject: world)');
  emblem.add(state, 'world', WORLD_IDS).name('body').onChange(rebuild);
  emblem.add(state, 'near').name('close-up');
  emblem.add(state, 'moving').name('moving (close-up)').onChange(rebuild);
  // As the star map draws it: its map variant if it has one, flat, a sun's corona down to its halo.
  emblem.add(state, 'onMap').name('as on the star map');
  // A sun is the family's living sun: its surface and its corona (the system theme picks it).
  const world = gui.addFolder('planet, moon, sun');
  world.add(state, 'biome', Object.keys(tokens.color.biome)).onChange(rebuild);
  world
    .add(state, 'theme', Object.keys(tokens.color.system))
    .name('system theme')
    .onChange(rebuild);
  // Planned work, as the galaxy draws it: a maquette in the system theme's colours.
  world.add(state, 'planned').name('planned (planet, moon)').onChange(rebuild);
  world.add(state, 'radius', 1, 24, 0.5).onChange(rebuild);
  world.add(state, 'seed').onFinishChange(rebuild);
  world.add(state, 'rings').onChange(rebuild);
  world.add(state, 'closeUp').name('close-up detail').onChange(rebuild);
  // Air (a world's, or a generated planet's): whichever the galaxy gives the body on show, any
  // one of the tokens', or none; its clouds (not on the low tier) and, up close, its lamps. Turn
  // the light round with the two sliders under "light" to see the dusk and the night.
  const airFolder = gui.addFolder('air (world, planet)');
  airFolder.add(state, 'air', AIR_CHOICES).onChange(rebuild);
  airFolder.add(state, 'clouds').onChange(rebuild);
  airFolder.add(state, 'cloudShare', 0, 1, 0.05).name('cloud share (no row)').onChange(rebuild);
  airFolder.add(state, 'windows').name('lamps (close-up)').onChange(rebuild);
  // The sky alone, looked OUT at from the middle: the seven views it is judged from
  // (sim/skyDirections.ts), or wherever a drag leaves it.
  const skyFolder = gui.addFolder('sky (subject: sky)');
  skyFolder.add(state, 'pose', SKY_POSE_NAMES).onChange(rebuild);
  skyFolder.add(state, 'docked').name('as while docked (half strength)').listen();
  // The recipe. Its numbers are baked into the panorama: move them, then repaint. (The exposure
  // keys are read every frame.) "sky Y" in the read-out is the luminance of the view, stars
  // left out: p50, p95, p99.9 and the brightest pixel, against the gates 0.04 (p95), 0.10
  // (p99.9) and 0.19 (the ceiling).
  const recipe = skyFolder.addFolder('tuning.look.sky');
  recipe.close();
  addControls(recipe, tuning.look.sky as unknown as Record<string, unknown>, () => undefined);
  const skyActions = {
    'rebake sky': () => sky.paint(true),
    'copy look.sky as JSON': () => copyText(JSON.stringify(tuning.look.sky, null, 2)),
  };
  skyFolder.add(skyActions, 'rebake sky');
  skyFolder.add(skyActions, 'copy look.sky as JSON');
  // The stars alone, from the same views: the sky's own, or a sheet of one kind at 1:1, in one
  // tint or the mix, and drawn as a view of another height would draw them (a hero's spikes
  // follow the view's height).
  // Orbit lines and their traffic in front of the sky, from the same views: how strong a line
  // has to be to read over the stars. 0 is the tuning's own (tuning.world.orbitLineOpacity and
  // sunTrackOpacity, under "world" below).
  const orbitFolder = gui.addFolder('orbits (subject: orbits)');
  orbitFolder
    .add(state, 'lineOpacity', 0, 0.6, 0.01)
    .name('line opacity (0: tuning)')
    .onChange(rebuild);
  orbitFolder
    .add(state, 'trackOpacity', 0, 0.6, 0.01)
    .name('sun track (0: tuning)')
    .onChange(rebuild);
  // The star map’s ground, from straight above; the slider zooms, as the wheel does on the map.
  const chartFolder = gui.addFolder('chart (subject: chart)');
  chartFolder.add(state, 'chartSpanU', 100, 4000, 50).name('view height, u');
  addControls(chartFolder, tuning.look.chart as unknown as Record<string, unknown>, rebuild);
  const starFolder = gui.addFolder('stars (subject: stars)');
  starFolder.add(state, 'starKind', STAR_SHEETS).name('kind').onChange(rebuild);
  starFolder.add(state, 'starTint', STAR_TINTS).name('tint').onChange(rebuild);
  starFolder.add(state, 'starRows', STAR_ROWS).name('as a view this high, px').onChange(rebuild);
  starFolder
    .add(state, 'starMap', 0, 1, 0.01)
    .name('on the star map')
    .onChange((calm: number) => starfield.setCalm(calm, tuning.map.starOpacity));
  const rocket = gui.addFolder('rocket');
  rocket.add(state, 'thrust', 0, 1, 0.01);
  rocket.add(state, 'boost');
  const view = gui.addFolder('light and view');
  view.add(state, 'lightAzimuthDeg', -180, 180, 1).name('light azimuth');
  view.add(state, 'lightElevationDeg', -90, 90, 1).name('light elevation');
  view.add(camera, 'turnRate', 0, 1.5, 0.05).name('turntable rad/s');
  view.add(state, 'sky').onChange((sky: boolean) => {
    backdrop.object.visible = sky;
    starfield.object.visible = sky;
  });
  view
    .add({ tier: options.tier }, 'tier', [...TIERS])
    .name('quality tier (reloads)')
    .onChange((next: QualityTier) => options.onTier(next));

  const knobs = gui.addFolder('tuning.ts');
  for (const block of LAB_BLOCKS) {
    const folder = knobs.addFolder(block);
    folder.close();
    addControls(folder, tuning[block] as unknown as Record<string, unknown>, () => {
      refreshToonLook();
      // `shading` and `post` are read every frame. The rest is baked into the mesh.
      if (block !== 'shading' && block !== 'post') rebuild();
    });
  }
  const actions = {
    'copy tuning as JSON': () =>
      copyText(JSON.stringify(Object.fromEntries(LAB_BLOCKS.map((b) => [b, tuning[b]])), null, 2)),
  };
  gui.add(actions, 'copy tuning as JSON');

  engine.start();
  return {
    dispose: () => {
      window.clearTimeout(timer);
      gui.destroy();
      camera.dispose();
      engine.dispose();
    },
  };
}

const METER_WIDTH = 480;
const METER_HEIGHT = 300;
const toLinear = (code: number): number => {
  const c = code / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const toCode = (linear: number): number =>
  255 * (linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055);

/**
 * MEASURES THE SKY (the lab only). Once a second it draws the backdrop alone, the stars left
 * out, into a small copy of the view and reads it back: the luminance (linear Y) at the middle,
 * at 95% and at 99.9% of the pixels, and of the brightest one, which are what the sky's gates are
 * written in (tests/sky-gates.test.ts holds the oracle to them; this is the GPU's own picture).
 * The numbers also go on <html data-sky-y> for a script to read.
 *
 * With `?parity=1` it also reads the baked panorama back, once, and compares it texel by texel
 * with the oracle (sim/skyOracle.ts): the mean and the worst difference in linear light, and in
 * code values of the 8-bit panorama (which is dithered: half a code is its own noise), on
 * <html data-sky-parity>.
 */
class SkyMeter implements System {
  text = '...';
  private readonly target = new WebGLRenderTarget(METER_WIDTH, METER_HEIGHT, {
    colorSpace: SRGBColorSpace,
    depthBuffer: false,
  });
  private readonly pixels = new Uint8Array(METER_WIDTH * METER_HEIGHT * 4);
  private readonly values = new Float32Array(METER_WIDTH * METER_HEIGHT);
  private seconds = 1;
  private compared = false;

  constructor(
    private readonly engine: Engine,
    private readonly backdrop: Backdrop,
    private readonly sky: SkyBake,
    private readonly page: HTMLElement,
    private readonly parity: boolean,
  ) {}

  frameUpdate(frame: Frame): void {
    this.seconds += frame.dt;
    if (this.seconds < 1) return;
    this.seconds = 0;
    const { renderer, camera } = this.engine;
    const { pixels, values } = this;
    renderer.setRenderTarget(this.target);
    renderer.render(this.backdrop.object, camera);
    renderer.setRenderTarget(null);
    renderer.readRenderTargetPixels(this.target, 0, 0, METER_WIDTH, METER_HEIGHT, pixels);
    for (let i = 0; i < values.length; i += 1) {
      values[i] = luminance([
        toLinear(pixels[i * 4] ?? 0),
        toLinear(pixels[i * 4 + 1] ?? 0),
        toLinear(pixels[i * 4 + 2] ?? 0),
      ]);
    }
    values.sort();
    const at = (share: number): number =>
      values[Math.min(values.length - 1, Math.floor(values.length * share))] ?? 0;
    const read = { p50: at(0.5), p95: at(0.95), p999: at(0.999), max: at(1) };
    this.text = Object.values(read)
      .map((value) => value.toFixed(4))
      .join(' ');
    this.page.dataset.skyY = JSON.stringify(read);
    if (this.parity && this.sky.seen && !this.compared) {
      this.compared = true;
      this.page.dataset.skyParity = JSON.stringify(this.compare());
    }
  }

  /** The panorama against the oracle, on every 16th row and every 8th texel of it. */
  private compare(): Record<string, number> {
    const { width, height } = this.sky.pano;
    const look = tuning.look.sky;
    const texel = createSkyOracle(look, skyColours());
    const row = new Uint8Array(width * 4);
    const out = [0, 0, 0, 0];
    let count = 0;
    let sum = 0;
    let worst = 0;
    let codes = 0;
    let worstCodes = 0;
    let worstClear = 0;
    for (let j = 5; j < height; j += 16) {
      this.engine.renderer.readRenderTargetPixels(this.sky.pano, 0, j, width, 1, row);
      const y = ((j + 0.5) / height) * 2 - 1;
      const r = Math.sqrt(Math.max(1 - y * y, 0));
      for (let i = 3; i < width; i += 8) {
        const az = ((i + 0.5) / width - 0.5) * 2 * Math.PI;
        texel([r * Math.sin(az), y, r * Math.cos(az)], out);
        for (let c = 0; c < 3; c += 1) {
          const code = row[i * 4 + c] ?? 0;
          const error = Math.abs(toLinear(code) - (out[c] ?? 0));
          const inCodes = Math.abs(code - toCode(out[c] ?? 0));
          sum += error;
          codes += inCodes;
          if (error > worst) worst = error;
          if (inCodes > worstCodes) worstCodes = inCodes;
          count += 1;
        }
        worstClear = Math.max(worstClear, Math.abs((row[i * 4 + 3] ?? 0) / 255 - (out[3] ?? 0)));
      }
    }
    return {
      samples: count,
      meanAbs: sum / count,
      worstAbs: worst,
      meanCodes: codes / count,
      worstCodes,
      worstOcclusion: worstClear,
    };
  }

  dispose(): void {
    this.target.dispose();
  }
}

/** What is on show, and everything that was made for it. */
class Turntable implements System {
  readonly object = new Group();
  readonly state = {
    subject: 'world' as Subject,
    world: 'page/about',
    near: false,
    moving: true,
    onMap: false,
    biome: 'terra' as BiomeKey,
    theme: 'coral' as ThemeKey,
    radius: 8,
    seed: 'lab',
    rings: false,
    planned: false,
    closeUp: false,
    thrust: 0.7,
    boost: false,
    lightAzimuthDeg: -55,
    lightElevationDeg: 35,
    air: 'galaxy' as AirChoice,
    clouds: true,
    cloudShare: 0.55,
    windows: true,
    sky: true,
    docked: false,
    pose: 'first' as SkyPoseName,
    starKind: 'sky' as StarSheet,
    starTint: 'mixed' as StarTint,
    starRows: 0,
    starMap: 0,
    lineOpacity: 0,
    trackOpacity: 0,
    chartSpanU: 2000,
  };

  private scope = new Scope();
  /** The sheet of stars on show in place of the sky's own, if one is. */
  private sheet: StarKind | null = null;
  private planet: PlanetMesh | null = null;
  private world: BodyMesh | null = null;
  /** The light round the sun on show, and where it is told the sun is (the middle, at its size). */
  private corona: SunCorona | null = null;
  /** The air of the world on show, if it has any. */
  private air: AirShells | null = null;
  /** The traffic on the orbits on show. */
  private traffic: Traffic | null = null;
  /** The chart on show, and the map it is told of: all of it, at the scale of this view. */
  private chart: Chart | null = null;
  private readonly chartMap = { weight: 1, unitsPerPx: 1 };
  private systems: readonly ManifestSystem[] = [];
  /** The view as the engine last gave it: the real pixel ratio, which a dot's size goes by. */
  private view: Viewport = { width: 1, height: 1, pixelRatio: 1 };
  /** Where the thing on show is: the middle of the table. */
  private readonly center = new Vector3();
  /** The radius of the body on show (u). */
  private shownRadius = 1;
  /** Has the camera been framed on the world's built reach yet? */
  private framed = false;
  private bodies = new Map<string, WorldBody>();
  /** The close-up chunk, loaded the first time a world is looked at up close. */
  private readonly closeUp = new CloseUpLoader();
  /** Gone: whatever arrives after (the galaxy's bodies, a rebuild's timer) shows nothing. */
  private disposed = false;
  private rocket: Rocket | null = null;
  private flame: EngineFlame | null = null;
  private lit: Array<{ uniforms: { uSunPosition: { value: Vector3 } } }> = [];
  private triangles = 0;
  private readonly light = new Vector3();
  private readonly input = { thrust: 0, turn: 0, brake: 0, boost: false };

  constructor(
    private readonly assets: AssetStore,
    private readonly jobs: JobQueue,
    private readonly camera: TurntableCam,
    private readonly stars: Starfield,
    private readonly low: boolean,
    private readonly viewport: () => Viewport,
    query: ReadonlyMap<string, string>,
  ) {
    this.object.name = 'universe-lab';
    applyQuery(this.state, query);
    this.stars.setCalm(this.state.starMap, tuning.map.starOpacity);
    this.show();
  }

  /** The galaxy's bodies have arrived: draw the world on show at its real kind and size. */
  know(manifest: { bodies: readonly ManifestBody[]; systems: readonly ManifestSystem[] }): void {
    if (this.disposed) return;
    this.bodies = new Map(manifest.bodies.map((body) => [body.id, body]));
    this.systems = manifest.systems;
    if (this.state.subject === 'world' || this.state.subject === 'chart') this.show();
  }

  /** How much of the star map the sky and the stars are drawn as: all of it under the chart. */
  get mapWeight(): number {
    return this.state.subject === 'chart' ? 1 : this.state.starMap;
  }

  resize(viewport: Viewport): void {
    this.view = viewport;
    this.traffic?.resize(viewport);
  }

  describe(): string {
    const { subject, biome, theme } = this.state;
    if (subject === 'chart') return `chart, ${this.chartMap.unitsPerPx.toFixed(2)} u/px`;
    if (subject === 'sky' || subject === 'stars' || subject === 'orbits') {
      const gaze = this.camera.gaze;
      const at = gaze
        ? `yaw ${gaze.yawDeg.toFixed(1)} pitch ${gaze.pitchDeg.toFixed(1)} fov ${gaze.fovDeg.toFixed(0)}`
        : '';
      const what =
        subject === 'sky'
          ? 'sky'
          : subject === 'orbits'
            ? 'orbits'
            : `stars (${this.state.starKind})`;
      return `${what} from "${this.state.pose}", ${at}`;
    }
    if (subject === 'world') {
      const { world, near, moving, onMap } = this.state;
      const how = onMap ? 'map' : near ? (moving ? 'close-up, moving' : 'close-up') : 'far';
      return `${world} (${this.bodyOf(world).kind}), ${how}`;
    }
    const what =
      subject === 'sun'
        ? `${theme} sun, ${this.low ? 'low tier' : 'full'} corona`
        : subject === 'rocket'
          ? subject
          : this.isPlanned()
            ? `planned ${theme} ${subject}`
            : biome;
    return this.triangles > 0 ? `${what}, ${this.triangles} tris` : `${subject}`;
  }

  /** Only a planet or a moon is ever planned work. */
  private isPlanned(): boolean {
    const { subject, planned } = this.state;
    return planned && (subject === 'planet' || subject === 'moon');
  }

  /** Throw away what is on the table and build what `state` asks for. */
  show(): void {
    if (this.disposed) return;
    this.clear();
    const { state, scope, assets } = this;
    // The sky's own stars, unless a sheet of one kind is asked for.
    const sheet = state.subject === 'stars' && state.starKind !== 'sky' ? state.starKind : null;
    if (sheet !== null || this.sheet !== null) {
      this.sheet = sheet;
      this.stars.object.geometry.dispose();
      this.stars.object.geometry = starGeometry(
        sheet
          ? starSheet(sheet, state.starTint, state.pose)
          : buildStarList(tuning.starfield, tuning.look.sky.band, { coarse: false, low: this.low }),
      );
    }
    this.stars.rows = state.subject === 'stars' && state.starRows > 0 ? state.starRows : null;
    this.stars.resize(this.viewport());
    this.stars.setCalm(this.mapWeight, tuning.map.starOpacity);
    if (state.subject === 'chart') {
      this.showChart();
      return;
    }
    if (state.subject === 'orbits') this.showOrbits();
    if (state.subject === 'sky' || state.subject === 'stars' || state.subject === 'orbits') {
      // Nothing on the table: the camera turns round and looks out.
      const pose = SKY_POSES[state.pose] ?? SKY_POSES.first;
      this.camera.gaze = { yawDeg: pose.yawDeg, pitchDeg: pose.pitchDeg, fovDeg: pose.fovDeg };
      // The docked view is judged at the strength the sky has while docked.
      state.docked = pose.exposure < 1;
      return;
    }
    this.camera.gaze = null;
    const surface = scope.track(createToonMaterial({ vertexColors: true }));
    this.lit.push(surface);
    this.triangles = 0;

    const { subject } = state;
    if (subject === 'world') {
      this.showWorld(surface);
      return;
    }
    if (subject === 'rocket') {
      this.rocket = new Rocket(assets, scope);
      this.flame = new EngineFlame(assets, this.rocket.engine, scope, tuning.ship.flame, true);
      this.object.add(this.rocket.object);
      this.camera.frame(ROCKET_FRAME_RADIUS);
      return;
    }

    if (subject === 'sun') {
      // A living sun of the family, as the galaxy draws one: its ball's tones, and its corona.
      this.showBody(
        'lab/sun',
        { kind: 'sun', radius: state.radius, seed: state.seed },
        { rows: [{ sun: state.theme, recipe: 'sun', seed: state.seed }] },
        surface,
      );
      this.triangles = planetTriangleCount(
        this.low ? tuning.look.sun.detailLow : tuning.world.detailSun,
      );
      return;
    }

    // Looked at exactly as the galaxy looks at a body of this kind (world/looks.ts).
    const shape = lookOf(
      {
        id: 'lab',
        kind: KIND_OF[subject],
        biome: state.biome,
        rings: state.rings,
        ...(this.isPlanned() ? { planned: true as const } : {}),
      },
      state.theme,
      undefined,
      // A made-up body has no rows of its own.
      {},
    );
    if (shape.world) return;
    const body = { kind: KIND_OF[subject], radius: state.radius, seed: state.seed };
    const air = this.airOn(
      'lab',
      { ...body, biome: state.biome, ...(this.isPlanned() ? { planned: true as const } : {}) },
      shape.model === null,
    );
    if (shape.model !== null) {
      const handle = assets.acquire(shape.model, surface);
      scope.onDispose(() => handle.release());
      handle.object.scale.setScalar(state.radius);
      this.object.add(handle.object);
      this.camera.frame(state.radius * 1.2);
      return;
    }

    // The galaxy swaps the close-up in as the ship comes near; here it is asked for.
    const detail = state.closeUp && shape.nearDetail !== null ? shape.nearDetail : shape.detail;
    this.triangles = planetTriangleCount(detail);
    this.planet = new PlanetMesh({
      radius: state.radius,
      seed: state.seed,
      bands: shape.bands,
      look: shape.look,
      detail,
      nearDetail: null,
      material: air ? scope.track(air()) : surface,
      jobs: this.jobs,
    });
    this.object.add(this.planet.mesh);

    if (shape.rings) {
      const theme = tokens.color.system[state.theme];
      const ring = assets.acquire(
        'planetRing',
        scope.track(
          createGlowMaterial({ intensity: 1, bloom: tuning.world.ringBloom, tint: theme.light }),
        ),
      );
      scope.onDispose(() => ring.release());
      ring.object.scale.setScalar(state.radius * tuning.world.ringInnerRadii);
      ring.object.rotation.set((tuning.world.ringTiltDeg * Math.PI) / 180, 0, 0);
      this.object.add(ring.object);
    }
    const reach = shape.rings ? tuning.world.ringOuterRadii : 1;
    this.camera.frame(state.radius * reach);
  }

  frameUpdate(frame: Frame): void {
    const { state } = this;
    const azimuth = (state.lightAzimuthDeg * Math.PI) / 180;
    const elevation = (state.lightElevationDeg * Math.PI) / 180;
    this.light
      .set(
        Math.sin(azimuth) * Math.cos(elevation),
        Math.sin(elevation),
        Math.cos(azimuth) * Math.cos(elevation),
      )
      .multiplyScalar(LIGHT_DISTANCE);
    for (const material of this.lit) material.uniforms.uSunPosition.value.copy(this.light);
    this.rocket?.setSun(this.light);

    this.input.thrust = state.thrust;
    this.input.boost = state.boost;
    this.flame?.update(this.input, frame);
    // Up close as if the ship were at its surface; far as if across its system.
    this.world?.update(state.near ? 0 : 1000, frame.dt, frame.simTime, state.onMap);
    // On the star map every surface is flat colour, and a corona is only its halo (main.ts).
    setToonFlatness(state.onMap && this.world ? tuning.map.flatness : 0);
    this.corona?.setCalm(state.onMap ? 1 : 0);
    this.corona?.frameUpdate(frame);
    this.air?.setCalm(state.onMap ? 1 : 0);
    this.air?.frameUpdate(frame);
    this.traffic?.frameUpdate(frame);
    if (this.chart && this.camera.gaze) {
      // The view is `chartSpanU` tall: so far below the camera the chart lies, through this lens.
      const below = state.chartSpanU / 2 / Math.tan((this.camera.gaze.fovDeg * Math.PI) / 360);
      this.chartMap.unitsPerPx = state.chartSpanU / this.viewport().height;
      this.chart.object.parent?.position.setY(-below);
      this.chart.frameUpdate();
    }
    if (this.world && !this.framed && this.world.built) {
      this.framed = true;
      // A sun is framed with the nearer steps of its halo.
      this.camera.frame(this.shownRadius * Math.max(this.world.reach, this.corona ? 1.7 : 1));
    }
  }

  /**
   * Orbit lines and their traffic, in the system theme, on a flight plane below the view: what
   * the chase camera sees of a system ahead, in front of whatever the pose has behind it.
   */
  private showOrbits(): void {
    const { state, scope } = this;
    const pose = SKY_POSES[state.pose] ?? SKY_POSES.first;
    const [x, , z] = directionOf(pose.yawDeg, 0);
    const center: [number, number] = [x * ORBITS_AHEAD, z * ORBITS_AHEAD];
    const { shade } = tokens.color.system[state.theme];
    const circle = scope.track(new BufferGeometry());
    const segments = tuning.world.orbitLineSegments;
    const points = new Float32Array(segments * 3);
    for (let i = 0; i < segments; i += 1) {
      points[i * 3] = Math.sin((i / segments) * TAU);
      points[i * 3 + 2] = Math.cos((i / segments) * TAU);
    }
    circle.setAttribute('position', new BufferAttribute(points, 3));
    const plane = new Group();
    plane.position.y = -ORBITS_BELOW;
    const ring = (radius: number, opacity: number): void => {
      const line = new LineLoop(circle, scope.track(createLineMaterial({ color: shade, opacity })));
      line.position.set(center[0], 0, center[1]);
      line.scale.setScalar(radius);
      plane.add(line);
    };
    const line = state.lineOpacity || tuning.world.orbitLineOpacity;
    for (const radius of ORBIT_RADII) ring(radius, line);
    ring(TRACK_RADIUS, state.trackOpacity || tuning.world.sunTrackOpacity);

    // The same circles as an orbit table: a body on each, holding still, round a centre.
    const radii = [...ORBIT_RADII, TRACK_RADIUS];
    const orbits = createOrbitTable(
      [{ id: 'lab', position: center }],
      [
        { id: 'lab/sun', parent: null, system: 'lab', orbit: null },
        ...radii.map((radius, i) => ({
          id: `lab/orbit-${i}`,
          parent: 'lab/sun',
          system: 'lab',
          orbit: { radius, phase: 0, periodSec: 0 },
        })),
      ],
    );
    this.traffic = new Traffic({
      orbits,
      families: orbits.ids.map((_, row) => (row === 0 ? undefined : state.theme)),
      positions: bodyPositions(orbits, 0, new Float64Array(orbits.count * 2)),
      scales: new Float64Array(orbits.count).fill(1),
      reducedMotion: !state.moving,
    });
    this.traffic.resize(this.view);
    plane.add(this.traffic.object);
    this.object.add(plane);
    scope.onDispose(() => plane.removeFromParent());
  }

  /** The star map's ground under today's galaxy, from straight above, north up, as the map is. */
  private showChart(): void {
    this.camera.gaze = { yawDeg: 0, pitchDeg: -90, fovDeg: tuning.map.fovDegrees };
    this.state.docked = false;
    const xs = this.systems.map((system) => system.position[0]);
    const zs = this.systems.map((system) => system.position[1]);
    const midX = xs.length > 0 ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0;
    const midZ = zs.length > 0 ? (Math.min(...zs) + Math.max(...zs)) / 2 : 0;
    this.chart = new Chart({
      districts: this.systems.map(({ position, radius, theme }) => ({
        x: position[0] - midX,
        z: position[1] - midZ,
        radius,
        family: theme,
      })),
      map: this.chartMap,
    });
    const ground = new Group();
    ground.add(this.chart.object);
    this.object.add(ground);
    this.scope.onDispose(() => ground.removeFromParent());
  }

  private bodyOf(id: string): WorldBody {
    return this.bodies.get(id) ?? guessBody(id);
  }

  /** An emblem world, drawn exactly as the galaxy draws it (world/BodyMesh.ts). */
  private showWorld(surface: ToonMaterial): void {
    const { state } = this;
    const recipe = BODIES[state.world];
    if (!recipe) return;
    this.showBody(state.world, this.bodyOf(state.world), recipe, surface);
  }

  /** Has the world on show lamps on its night side? */
  private lamps = false;

  /**
   * The air of the thing on show, as the galaxy would give it one (world/looks.ts, `airOf`) or
   * as the panel asks: its shell and its clouds are put on the table, and what makes the
   * material its ground is to wear comes back (null: no air).
   */
  private airOn(
    id: string,
    body: WorldBody & { biome?: BiomeKey },
    globe: boolean,
  ): (() => ToonMaterial) | null {
    const { state } = this;
    const own = airOf(
      {
        id,
        kind: body.kind,
        ...(body.biome ? { biome: body.biome } : {}),
        ...(body.planned ? { planned: true as const } : {}),
      },
      globe,
    );
    const air =
      state.air === 'galaxy'
        ? own
        : state.air === 'none' || body.kind === 'sun'
          ? undefined
          : {
              air: state.air,
              cloud: own?.cloud ?? { share: state.cloudShare, peak: 'frost' as BiomeKey },
              windows: own?.windows ?? false,
            };
    this.lamps = air?.windows === true && state.windows;
    if (!air) return null;
    const { center } = this;
    const make = (): ToonMaterial => {
      const material = createToonMaterial({
        vertexColors: true,
        air: { key: air.air, center },
      });
      this.lit.push(material);
      return material;
    };
    this.air = new AirShells({
      worlds: [
        {
          id,
          row: 0,
          radius: body.radius,
          air: air.air,
          light: this.light,
          // The tiers' own rule (main.ts) would hide them on low; the lab shows what is asked for.
          cloud: state.clouds && !this.low ? air.cloud : undefined,
        },
      ],
      positions: [0, 0],
      scales: [1],
      low: this.low,
      reducedMotion: !state.moving,
    });
    this.object.add(this.air.object);
    return make;
  }

  /** A body drawn from rows; a sun in its own material (its ball's tones), with its corona. */
  private showBody(id: string, body: WorldBody, recipe: BodyRecipe, surface: ToonMaterial): void {
    const { state } = this;
    const [ground] = rowsOf(recipe, { map: false });
    const family = Array.isArray(ground) ? undefined : (ground as GroundSpec).sun;
    const air = this.airOn(id, body, false);
    let material = air ? this.scope.track(air()) : surface;
    if (body.kind === 'sun' && family !== undefined) {
      material = this.scope.track(createToonMaterial({ vertexColors: true, sun: family }));
      this.lit.push(material);
      this.corona = new SunCorona({
        suns: [
          {
            row: 0,
            family,
            radius: body.radius,
            seed: sunSeed(id),
            living: isLivingSun(ground as GroundSpec),
          },
        ],
        positions: [0, 0],
        scales: [1],
        low: this.low,
        reducedMotion: !state.moving,
      });
      this.object.add(this.corona.object);
    }
    this.shownRadius = body.radius;
    this.world = new BodyMesh({
      id,
      kind: body.kind,
      planned: body.planned === true,
      radius: body.radius,
      seed: body.seed,
      recipe,
      material,
      jobs: this.jobs,
      low: this.low,
      reducedMotion: !state.moving,
      closeUp: this.closeUp,
      lamps: this.lamps,
      ...(air ? { another: air } : {}),
    });
    this.object.add(this.world.object);
    this.framed = false;
    // Until it is built and its reach known: its radius and room for what stands out.
    this.camera.frame(body.radius * 1.8);
  }

  dispose(): void {
    this.disposed = true;
    this.clear();
    this.closeUp.dispose();
    this.object.removeFromParent();
  }

  private clear(): void {
    this.corona?.dispose();
    this.corona = null;
    this.air?.dispose();
    this.air = null;
    this.traffic?.dispose();
    this.traffic = null;
    this.chart?.dispose();
    this.chart = null;
    this.lamps = false;
    setToonFlatness(0);
    this.planet?.dispose();
    this.planet = null;
    this.world?.dispose();
    this.world = null;
    this.rocket = null;
    this.flame = null;
    this.lit = [];
    this.scope.dispose();
    this.scope = new Scope();
  }
}

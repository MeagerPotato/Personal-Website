import GUI from 'lil-gui';
import { Group, Vector3 } from 'three';
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
  createToonMaterial,
  refreshToonLook,
  setBloomMask,
  setToonFlatness,
  type ToonMaterial,
} from '../design/materials';
import type { StarClass } from '../design/lookTypes';
import { tokens, type BiomeKey, type StarKey, type ThemeKey } from '../design/tokens';
import { tuning } from '../design/tuning';
import { BODIES } from '../design/worlds/bodies';
import { readManifest, type ManifestBody } from '../manifest';
import { PostFX } from '../fx/PostFX';
import { EngineFlame } from '../ship/EngineFlame';
import { Rocket } from '../ship/Rocket';
import { planetTriangleCount } from '../sim/planet';
import { createRng, pickWeighted } from '../sim/rng';
import { directionOf, SKY_POSE_NAMES, SKY_POSES, type SkyPoseName } from '../sim/skyDirections';
import { sunSeed } from '../sim/sunSurface';
import { isLivingSun, type GroundSpec } from '../sim/world/ground';
import { rowsOf, type BodyRecipe } from '../sim/world/rows';
import { buildStarList, STAR_KINDS, type StarKind, type StarList } from '../sim/starList';
import { Backdrop } from '../world/Backdrop';
import { BodyMesh, CloseUpLoader } from '../world/BodyMesh';
import { PlanetMesh } from '../world/PlanetMesh';
import { starGeometry, Starfield } from '../world/Starfield';
import { SunCorona } from '../world/SunCorona';
import { lookOf, type LookedAt } from '../world/looks';
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
    const any = pickWeighted(rng, palette);
    // The heroes of the sheet are the sky's eight: their sizes, and (mixed) their tints.
    const hero = kind === 'hero' ? heroes[i % heroes.length] : undefined;
    list.tints.push(tint !== 'mixed' ? tint : (hero?.tint ?? any));
    if (hero) list.sizes[i] = hero.size;
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
  Exclude<Subject, 'rocket' | 'world' | 'sun' | 'sky' | 'stars'>,
  LookedAt['kind']
>;

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
    .then((data: unknown) => table.know(readManifest(data).bodies))
    .catch(() => undefined);
  engine.add(new CameraRig(engine.camera, camera, tuning.cameraRig));

  const backdrop = engine.add(new Backdrop());
  engine.scene.add(backdrop.object, starfield.object, table.object);
  engine.add(jobs);
  if (!bare) {
    engine.add(
      new PerfHud(mount, engine.renderer, () => [
        `tier  ${options.tier} x${engine.resolutionScale.toFixed(2)}`,
        `shows ${table.describe()}`,
        `stars ${starfield.object.geometry.instanceCount}`,
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
  // The sky alone, looked OUT at from the middle: the seven views it is judged from
  // (sim/skyDirections.ts), or wherever a drag leaves it.
  const skyFolder = gui.addFolder('sky (subject: sky)');
  skyFolder.add(state, 'pose', SKY_POSE_NAMES).onChange(rebuild);
  // The stars alone, from the same views: the sky's own, or a sheet of one kind at 1:1, in one
  // tint or the mix, and drawn as a view of another height would draw them (a hero's spikes
  // follow the view's height).
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
    sky: true,
    pose: 'first' as SkyPoseName,
    starKind: 'sky' as StarSheet,
    starTint: 'mixed' as StarTint,
    starRows: 0,
    starMap: 0,
  };

  private scope = new Scope();
  /** The sheet of stars on show in place of the sky's own, if one is. */
  private sheet: StarKind | null = null;
  private planet: PlanetMesh | null = null;
  private world: BodyMesh | null = null;
  /** The light round the sun on show, and where it is told the sun is (the middle, at its size). */
  private corona: SunCorona | null = null;
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
  know(bodies: readonly ManifestBody[]): void {
    if (this.disposed) return;
    this.bodies = new Map(bodies.map((body) => [body.id, body]));
    if (this.state.subject === 'world') this.show();
  }

  describe(): string {
    const { subject, biome, theme } = this.state;
    if (subject === 'sky' || subject === 'stars') {
      const gaze = this.camera.gaze;
      const at = gaze
        ? `yaw ${gaze.yawDeg.toFixed(1)} pitch ${gaze.pitchDeg.toFixed(1)} fov ${gaze.fovDeg.toFixed(0)}`
        : '';
      const what = subject === 'sky' ? 'sky' : `stars (${this.state.starKind})`;
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
    if (state.subject === 'sky' || state.subject === 'stars') {
      // Nothing on the table: the camera turns round and looks out.
      const pose = SKY_POSES[state.pose] ?? SKY_POSES.first;
      this.camera.gaze = { yawDeg: pose.yawDeg, pitchDeg: pose.pitchDeg, fovDeg: pose.fovDeg };
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
      material: surface,
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
    if (this.world && !this.framed && this.world.built) {
      this.framed = true;
      // A sun is framed with the nearer steps of its halo.
      this.camera.frame(this.shownRadius * Math.max(this.world.reach, this.corona ? 1.7 : 1));
    }
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

  /** A body drawn from rows; a sun in its own material (its ball's tones), with its corona. */
  private showBody(id: string, body: WorldBody, recipe: BodyRecipe, surface: ToonMaterial): void {
    const { state } = this;
    const [ground] = rowsOf(recipe, { map: false });
    const family = Array.isArray(ground) ? undefined : (ground as GroundSpec).sun;
    let material = surface;
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

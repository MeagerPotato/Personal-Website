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
  type ToonMaterial,
} from '../design/materials';
import { tokens, type BiomeKey, type ThemeKey } from '../design/tokens';
import { tuning } from '../design/tuning';
import { BODIES } from '../design/worlds/bodies';
import { readManifest, type ManifestBody } from '../manifest';
import { PostFX } from '../fx/PostFX';
import { EngineFlame } from '../ship/EngineFlame';
import { Rocket } from '../ship/Rocket';
import { HYPER_SPENT, HYPER_TUNNEL, HYPER_WINDUP, type Hyper } from '../sim/docking';
import { planetTriangleCount } from '../sim/planet';
import { Backdrop } from '../world/Backdrop';
import { BodyMesh, CloseUpLoader } from '../world/BodyMesh';
import { Hyperspace } from '../world/Hyperspace';
import { PlanetMesh } from '../world/PlanetMesh';
import { Starfield } from '../world/Starfield';
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
  'hyperspace',
] as const;
type Subject = (typeof SUBJECTS)[number];

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
  sun: 'sun',
  station: 'station',
  satellite: 'satellite',
  relay: 'link',
} as const satisfies Record<Exclude<Subject, 'rocket' | 'world' | 'hyperspace'>, LookedAt['kind']>;

/** The blocks of design/tuning.ts whose effect can be judged here. */
const LAB_BLOCKS = ['shading', 'planet', 'world', 'post', 'ship', 'hyper'] as const;
/** The hyperspace subject's jump: its tunnel closes this many seconds after the press. */
const JUMP_TUNNEL_END = 1.95;

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
  const tier = tuning.quality.tiers[options.tier];
  setBloomMask(tier.post);

  const engine = new Engine({
    mount,
    quality: tier,
    pipeline: (renderer, samples) => new PostFX(renderer, samples),
    coarsePointer: false,
    canDemote: false,
    onFirstFrame: () => undefined,
    onDemote: () => undefined,
    onContextLost: () => console.warn('[lab] WebGL context lost: reload the page'),
  });

  const assets = engine.add(new AssetStore());
  const jobs = new JobQueue(tuning.world.jobBudget);
  const camera = new TurntableCam(engine.canvas);
  const table = engine.add(
    new Turntable(assets, jobs, camera, options.tier === 'low', engine.camera),
  );
  // The worlds' kinds and sizes, as the galaxy has them; until then, and without it, a guess.
  void fetch('/universe.json')
    .then((response) => response.json())
    .then((data: unknown) => table.know(readManifest(data).bodies))
    .catch(() => undefined);
  engine.add(new CameraRig(engine.camera, camera, tuning.cameraRig));

  const backdrop = engine.add(new Backdrop());
  const starfield = engine.add(new Starfield({ coarsePointer: false, reducedMotion: false }));
  engine.scene.add(backdrop.object, starfield.object, table.object);
  engine.add(jobs);
  engine.add(
    new PerfHud(mount, engine.renderer, () => [
      `tier  ${options.tier} x${engine.resolutionScale.toFixed(2)}`,
      `shows ${table.describe()}`,
    ]),
  );

  const gui = new GUI({ title: 'universe-lab (dev only)' });
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
  emblem.add(state, 'onMap').name('star map variant');
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
  const rocket = gui.addFolder('rocket');
  rocket.add(state, 'thrust', 0, 1, 0.01);
  rocket.add(state, 'boost');
  // A jump (world/Hyperspace.ts), seen from behind the rocket: held anywhere on its timeline
  // (the wind-up, the tunnel from tuning.hyper.windupSec, on its way out from 1.95 s), or played.
  const jump = gui.addFolder('hyperspace (subject: hyperspace)');
  jump.add(state, 'jumpAt', 0, JUMP_TUNNEL_END + 0.5, 0.005).name('seconds after the press');
  jump.add(state, 'jumpPlay').name('play in a loop');
  jump.add(state, 'jumpSpeed', 0, 700, 10).name('speed u/s');
  jump.add(state, 'theme', Object.keys(tokens.color.system)).name('family');
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
    jumpAt: 1.2,
    jumpPlay: false,
    jumpSpeed: 600,
  };

  private scope = new Scope();
  private planet: PlanetMesh | null = null;
  private world: BodyMesh | null = null;
  /** Has the camera been framed on the world's built reach yet? */
  private framed = false;
  private bodies = new Map<string, WorldBody>();
  /** The close-up chunk, loaded the first time a world is looked at up close. */
  private readonly closeUp = new CloseUpLoader();
  /** Gone: whatever arrives after (the galaxy's bodies, a rebuild's timer) shows nothing. */
  private disposed = false;
  private rocket: Rocket | null = null;
  private flame: EngineFlame | null = null;
  /** The hyperspace subject: the view, and the made-up dock, ship and destination it reads. */
  private jump: {
    view: Hyperspace;
    dock: { hyper: Hyper; hyperSec: number };
    ship: { position: Vector3; velocity: Vector3; heading: number; speed: number };
    target: { id: string; x: number; z: number; theme: ThemeKey };
    /** The turntable as it was, to give back. */
    was: { fov: number; turnRate: number };
  } | null = null;
  private viewport: Viewport = { width: 1, height: 1, pixelRatio: 1 };
  private lit: Array<{ uniforms: { uSunPosition: { value: Vector3 } } }> = [];
  private triangles = 0;
  private readonly light = new Vector3();
  private readonly input = { thrust: 0, turn: 0, brake: 0, boost: false };

  constructor(
    private readonly assets: AssetStore,
    private readonly jobs: JobQueue,
    private readonly camera: TurntableCam,
    private readonly low: boolean,
    private readonly lens: { readonly fov: number },
  ) {
    this.object.name = 'universe-lab';
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
    if (subject === 'world') {
      const { world, near, moving, onMap } = this.state;
      const how = onMap ? 'map' : near ? (moving ? 'close-up, moving' : 'close-up') : 'far';
      return `${world} (${this.bodyOf(world).kind}), ${how}`;
    }
    const what =
      subject === 'sun'
        ? `${theme} sun`
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
    const surface = scope.track(createToonMaterial({ vertexColors: true }));
    this.lit.push(surface);
    this.triangles = 0;

    const { subject } = state;
    if (subject === 'world') {
      this.showWorld(surface);
      return;
    }
    if (subject === 'rocket' || subject === 'hyperspace') {
      this.rocket = new Rocket(assets, scope);
      this.flame = new EngineFlame(assets, this.rocket.engine, scope, tuning.ship.flame, true);
      this.object.add(this.rocket.object);
      this.camera.frame(ROCKET_FRAME_RADIUS);
      if (subject === 'hyperspace') this.showJump();
      return;
    }

    // Looked at exactly as the galaxy looks at a body of this kind (world/looks.ts).
    const isSun = subject === 'sun';
    const shape = lookOf(
      {
        id: 'lab',
        kind: KIND_OF[subject],
        biome: state.biome,
        rings: state.rings && !isSun,
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
      material: isSun
        ? scope.track(createGlowMaterial({ intensity: 1, bloom: tuning.world.sunBloom }))
        : surface,
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
    this.stepJump(frame);
    this.flame?.update(this.input, frame);
    // Up close as if the ship were at its surface; far as if across its system.
    this.world?.update(state.near ? 0 : 1000, frame.dt, frame.simTime, state.onMap);
    if (this.world && !this.framed && this.world.built) {
      this.framed = true;
      this.camera.frame(this.bodyOf(state.world).radius * this.world.reach);
    }
  }

  resize(viewport: Viewport): void {
    this.viewport = viewport;
    this.jump?.view.resize(viewport);
  }

  /** The hyperspace subject: a jump along +Z, which is where the rocket points, seen from behind. */
  private showJump(): void {
    const dock = { hyper: HYPER_SPENT as Hyper, hyperSec: 0 };
    const ship = { position: new Vector3(), velocity: new Vector3(), heading: 0, speed: 0 };
    const target = { id: '', x: 0, z: 1000, theme: this.state.theme };
    const view = new Hyperspace({
      dock,
      ship,
      target: () => target,
      mapWeight: () => 0,
      camera: this.lens,
      dashes: tuning.hyper.dashes[this.low ? 'low' : 'high'],
      ribs: !this.low,
    });
    view.resize(this.viewport);
    this.object.add(view.object);
    const was = { fov: this.camera.fov, turnRate: this.camera.turnRate };
    this.jump = { view, dock, ship, target, was };
    // From behind and a little above, through the lens the chase camera has in the tunnel.
    const { fovDegrees } = tuning.camera;
    const { fovBoostDegrees, surgeFovDegrees } = tuning.chaseCam;
    this.camera.fov = fovDegrees + fovBoostDegrees + surgeFovDegrees;
    this.camera.yaw = Math.PI;
    this.camera.pitch = 0.2;
    this.camera.turnRate = 0;
  }

  /** Put the jump where the sliders say it is on its timeline, and draw that. */
  private stepJump(frame: Frame): void {
    const { jump, state } = this;
    if (!jump) return;
    const wind = tuning.hyper.windupSec;
    jump.ship.speed = state.jumpSpeed;
    jump.ship.velocity.set(0, 0, state.jumpSpeed);
    jump.target.theme = state.theme;
    jump.target.id = `lab/${state.theme}`;
    const at = (seconds: number, dt: number): void => {
      jump.dock.hyper =
        seconds < wind ? HYPER_WINDUP : seconds < JUMP_TUNNEL_END ? HYPER_TUNNEL : HYPER_SPENT;
      jump.dock.hyperSec = seconds < wind ? seconds : seconds - wind;
      jump.view.frameUpdate({ elapsed: frame.elapsed, dt, alpha: 1, simTime: seconds });
    };
    const seconds = state.jumpPlay ? frame.elapsed % (JUMP_TUNNEL_END + 1.5) : state.jumpAt;
    // Held on its way out, it has to have been in the tunnel a moment before.
    if (!state.jumpPlay && seconds >= JUMP_TUNNEL_END) at(JUMP_TUNNEL_END - 1e-3, 0);
    at(seconds, frame.dt);
    this.flame?.setSurge(jump.view.look.surge);
  }

  private bodyOf(id: string): WorldBody {
    return this.bodies.get(id) ?? guessBody(id);
  }

  /** An emblem world, drawn exactly as the galaxy draws it (world/BodyMesh.ts). */
  private showWorld(surface: ToonMaterial): void {
    const { state } = this;
    const recipe = BODIES[state.world];
    if (!recipe) return;
    const body = this.bodyOf(state.world);
    this.world = new BodyMesh({
      id: state.world,
      kind: body.kind,
      planned: body.planned === true,
      radius: body.radius,
      seed: body.seed,
      recipe,
      material: surface,
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
    this.planet?.dispose();
    this.planet = null;
    this.world?.dispose();
    this.world = null;
    this.rocket = null;
    this.flame = null;
    if (this.jump) {
      this.jump.view.dispose();
      Object.assign(this.camera, this.jump.was);
      this.jump = null;
    }
    this.lit = [];
    this.scope.dispose();
    this.scope = new Scope();
  }
}

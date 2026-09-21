import GUI from 'lil-gui';
import { Group, Vector3 } from 'three';
import { CameraRig } from '../camera/CameraRig';
import { AssetStore } from '../core/AssetStore';
import { Engine, type Frame, type System } from '../core/Engine';
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
} from '../design/materials';
import { tokens, type BiomeKey, type ThemeKey } from '../design/tokens';
import { tuning } from '../design/tuning';
import { PostFX } from '../fx/PostFX';
import { EngineFlame } from '../ship/EngineFlame';
import { Rocket } from '../ship/Rocket';
import { planetTriangleCount } from '../sim/planet';
import { Backdrop } from '../world/Backdrop';
import { PlanetMesh } from '../world/PlanetMesh';
import { Starfield } from '../world/Starfield';
import { biomeBands, sunBands, sunLook } from '../world/looks';
import { TurntableCam } from './TurntableCam';

const SUBJECTS = ['planet', 'moon', 'sun', 'rocket', 'station', 'satellite'] as const;
type Subject = (typeof SUBJECTS)[number];

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
  const table = engine.add(new Turntable(assets, jobs, camera));
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
  const world = gui.addFolder('planet, moon, sun');
  world.add(state, 'biome', Object.keys(tokens.color.biome)).onChange(rebuild);
  world.add(state, 'theme', Object.keys(tokens.color.system)).name('sun theme').onChange(rebuild);
  world.add(state, 'radius', 1, 24, 0.5).onChange(rebuild);
  world.add(state, 'seed').onFinishChange(rebuild);
  world.add(state, 'rings').onChange(rebuild);
  world.add(state, 'closeUp').name('close-up detail').onChange(rebuild);
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
    subject: 'planet' as Subject,
    biome: 'terra' as BiomeKey,
    theme: 'coral' as ThemeKey,
    radius: 8,
    seed: 'lab',
    rings: false,
    closeUp: false,
    thrust: 0.7,
    boost: false,
    lightAzimuthDeg: -55,
    lightElevationDeg: 35,
    sky: true,
  };

  private scope = new Scope();
  private planet: PlanetMesh | null = null;
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
  ) {
    this.object.name = 'universe-lab';
    this.show();
  }

  describe(): string {
    const { subject, biome, theme } = this.state;
    const what = subject === 'sun' ? `${theme} sun` : subject === 'rocket' ? subject : biome;
    return this.triangles > 0 ? `${what}, ${this.triangles} tris` : `${subject}`;
  }

  /** Throw away what is on the table and build what `state` asks for. */
  show(): void {
    this.clear();
    const { state, scope, assets } = this;
    const surface = scope.track(createToonMaterial({ vertexColors: true }));
    this.lit.push(surface);
    this.triangles = 0;

    if (state.subject === 'rocket') {
      this.rocket = new Rocket(assets, scope);
      this.flame = new EngineFlame(assets, this.rocket.engine, scope, tuning.ship.flame, true);
      this.object.add(this.rocket.object);
      this.camera.frame(ROCKET_FRAME_RADIUS);
      return;
    }

    if (state.subject === 'station' || state.subject === 'satellite') {
      const handle = assets.acquire(state.subject, surface);
      scope.onDispose(() => handle.release());
      handle.object.scale.setScalar(state.radius);
      this.object.add(handle.object);
      this.camera.frame(state.radius * 1.2);
      return;
    }

    const isSun = state.subject === 'sun';
    const { detailSun, detailMoon, detailPlanet, detailNear } = tuning.world;
    const everyday = isSun ? detailSun : state.subject === 'moon' ? detailMoon : detailPlanet;
    const detail = state.closeUp && state.subject === 'planet' ? detailNear : everyday;
    this.triangles = planetTriangleCount(detail);
    this.planet = new PlanetMesh({
      radius: state.radius,
      seed: state.seed,
      bands: isSun ? sunBands(state.theme) : biomeBands(state.biome),
      look: isSun ? sunLook() : tuning.planet,
      detail,
      nearDetail: null,
      material: isSun
        ? scope.track(createGlowMaterial({ intensity: 1, bloom: tuning.world.sunBloom }))
        : surface,
      jobs: this.jobs,
    });
    this.object.add(this.planet.mesh);

    if (state.rings && !isSun) {
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
    const reach = state.rings && !isSun ? tuning.world.ringOuterRadii : 1;
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
  }

  dispose(): void {
    this.clear();
    this.object.removeFromParent();
  }

  private clear(): void {
    this.planet?.dispose();
    this.planet = null;
    this.rocket = null;
    this.flame = null;
    this.lit = [];
    this.scope.dispose();
    this.scope = new Scope();
  }
}

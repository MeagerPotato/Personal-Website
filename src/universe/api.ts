/**
 * THE ONLY DOOR INTO THE ENGINE. The web layer (src/shell) imports this file and nothing else
 * from src/universe, and it does so with a dynamic import(), so plain mode never downloads
 * three.js. No top-level side effects here.
 *
 * Commands go down as method calls (`goTo`, `undock`), facts come up as events (`docked`,
 * `undocked`, `statechange`), and both sides are IDEMPOTENT: the visitor may dock from inside the
 * world and the router then follows, or the route may change and the ship then follows, and
 * being told what one already knows is never an error. The map (setMapOpen) lands in Phase 3; see
 * docs/PLAN.md §5.5.
 */

import { EventBus } from './core/events';
import { isTier, lowerTier, startingTier, type QualityTier } from './core/quality/tiers';
import { RebuildBudget, startingFrom, type Snapshot, type StartOptions } from './core/snapshot';
import { boot, type Booted } from './main';
import { FLIGHT, type AppState } from './state/appMachine';
import type { NavigatorEvents } from './state/Navigator';

export type { QualityTier } from './core/quality/tiers';
export type { StartOptions } from './core/snapshot';
export type { AppMode, AppState } from './state/appMachine';

/**
 * DEV ONLY: the lab, one asset on a turntable (lab/LabScene.ts). The condition is a build-time
 * constant, so a production build drops the import and everything behind it, lil-gui included
 * (scripts/verify-dist.mjs checks).
 */
export async function createLab(options: {
  mount: HTMLElement;
  quality?: QualityTier;
  onQuality(tier: QualityTier): void;
}): Promise<{ dispose(): void }> {
  if (import.meta.env.DEV) {
    const { bootLab } = await import('./lab/LabScene');
    return bootLab({
      mount: options.mount,
      tier: isTier(options.quality) ? options.quality : 'high',
      onTier: options.onQuality,
    });
  }
  throw new Error('the lab exists in development only');
}

export interface UniverseOptions {
  /** Element the engine mounts its own <canvas> into. */
  mount: HTMLElement;
  /**
   * Element for the engine's interactive DOM (the dock prompt, later the labels). It must NOT be
   * inside `mount`, which is decorative and hidden from assistive technology. Without it the
   * engine shows no DOM of its own.
   */
  overlay?: HTMLElement;
  /**
   * The parsed body of /universe.json (the web layer fetches it). Checked on the way in: a
   * manifest this engine cannot read makes createUniverse reject, and the shell goes plain.
   */
  manifest: unknown;
  /**
   * The visitor prefers reduced motion but chose the universe anyway (the mode script sends them
   * to plain mode otherwise). The loop still runs, because flying is motion they asked for;
   * everything AMBIENT is calmed: no twinkle, no sky drift, and later no camera flourishes.
   */
  reducedMotion?: boolean;
  /**
   * Where the visit starts: in orbit round the body whose page is open (`at`), and with the world
   * as an earlier `snapshot()` from this tab left it. Neither: at the spawn point, in open sky.
   */
  start?: StartOptions;
  /** Force a quality tier (`?q=`). The engine then neither probes nor demotes. */
  quality?: QualityTier;
  /**
   * The tier this device was demoted to on an earlier visit. The web layer remembers it (see the
   * `quality` event); the engine never starts above it, and never promotes itself.
   */
  qualityCeiling?: QualityTier;
  /**
   * `perf`: a small frame-rate readout, in every build (for phones on a preview URL).
   * `tweak`: the live tuning panel. Development only; ignored in a production build.
   */
  debug?: { perf?: boolean; tweak?: boolean };
}

export type UniverseEvents = {
  /** The first frame is on screen. */
  ready: undefined;
  /** The visitor steered for the first time: they know how to fly, so hints can go. */
  firstinput: undefined;
  /**
   * The quality tier in use: once at the start, and again if the first seconds showed that the
   * device needs a lower one (`demoted`: worth remembering for the next visit).
   */
  quality: { tier: QualityTier; demoted: boolean };
  /** What the visitor is doing changed: flight, autopilot, approach, docked (state/appMachine.ts). */
  statechange: AppState;
  /** The ship came within reach of a body it could dock at (`id`), or left it (null). */
  soi: { id: string | null };
  /** The ship is in orbit round `id`: its page is what the panel should show. */
  docked: { id: string };
  /**
   * An approach or a dock ended. `by: 'pilot'` means it started INSIDE the engine (the controls,
   * the prompt), so the web layer should follow (go home); `by: 'asked'` means it came through
   * this API, so the web layer already knows.
   */
  undocked: { id: string; by: 'pilot' | 'asked' };
  /** The engine cannot continue; the web layer should fall back to plain mode. */
  fatal: { reason: string };
};

export interface Universe {
  /** Subscribe to an engine event. Returns the unsubscribe function. */
  on<K extends keyof UniverseEvents>(
    event: K,
    listener: (payload: UniverseEvents[K]) => void,
  ): () => void;
  /** What the visitor is doing right now. */
  readonly state: AppState;
  /**
   * Go to the body with this id (`/universe.json`). `fly` travels there when it is within reach
   * and (until the autopilot exists, E6) cuts there when it is not; `instant` always cuts.
   * Resolves `arrived` once docked, `cancelled` when the pilot or another request got in first,
   * or the body is unknown. Asking for where the ship already is resolves `arrived` at once.
   */
  goTo(id: string, options?: { mode?: 'fly' | 'instant' }): Promise<'arrived' | 'cancelled'>;
  /** Let go of whatever the ship is docked at or headed for. */
  undock(): void;
  /**
   * Where everything is, as plain data that survives JSON: hand it back as `start.snapshot` and
   * the next universe in this tab carries on from here (a reload, a full page load). Null only
   * when there is nothing to tell.
   */
  snapshot(): unknown;
  /**
   * How much of the viewport the info panel covers, in CSS pixels from the right and from the
   * bottom edge. The engine keeps what matters in the middle of what is left, without distorting
   * it (camera/CameraRig.ts). The view eases over; `cut` jumps, for the first layout of a page.
   */
  setPanelInset(inset: { right?: number; bottom?: number }, options?: { cut?: boolean }): void;
  setPaused(paused: boolean): void;
  dispose(): void;
}

/** A GPU that loses its context more often than this is not going to get better: go plain. */
const MAX_REBUILDS = 3;
const REBUILD_WINDOW_MS = 60_000;

/**
 * Rejects if WebGL is unavailable or only software-rendered.
 *
 * Ordering guarantee: `ready` fires from the first animation frame, which is always after this
 * promise resolves, so a listener attached right after `await createUniverse()` never misses it.
 *
 * A LOST WEBGL CONTEXT (a phone that spent a minute in the background, a driver reset) is not
 * the end: the engine is thrown away, canvas and all, and built again from a snapshot as soon as
 * someone is looking, with the ship and every planet where they were. The web layer notices
 * nothing. Only a context that keeps getting lost, or cannot be had again, is `fatal`.
 */
export async function createUniverse(options: UniverseOptions): Promise<Universe> {
  const events = new EventBus<UniverseEvents>();
  const budget = new RebuildBudget(MAX_REBUILDS, REBUILD_WINDOW_MS);
  let paused = false;
  let disposed = false;
  let announcedReady = false;
  let announcedInput = false;
  let current: Booted | null = null;
  let waiting: (() => void) | null = null;
  /** What the engine knew when it was last taken down: the answer to `snapshot()` until it is back. */
  let last: Snapshot | null = null;
  /** The web layer's word on the panel: a rebuilt engine needs to hear it again. */
  let inset: { right?: number; bottom?: number } = {};
  /** The one journey somebody is waiting on. A new one, or the pilot, cancels it. */
  let journey: { id: string; settle(result: 'arrived' | 'cancelled'): void } | null = null;

  function settleJourney(result: 'arrived' | 'cancelled'): void {
    const settled = journey;
    journey = null;
    settled?.settle(result);
  }

  const forced = isTier(options.quality);
  let tier: QualityTier = isTier(options.quality)
    ? options.quality
    : startingTier(
        {
          coarsePointer: window.matchMedia('(pointer: coarse)').matches,
          deviceMemory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
          hardwareConcurrency: navigator.hardwareConcurrency,
        },
        isTier(options.qualityCeiling) ? options.qualityCeiling : null,
      );

  const hooks = {
    onFirstFrame: (): void => {
      if (announcedReady) return;
      announcedReady = true;
      // From the first frame, like `ready` and just before it: a listener attached right after
      // `await createUniverse()` hears both.
      events.emit('quality', { tier, demoted: false });
      events.emit('ready', undefined);
    },
    onFirstInput: (): void => {
      if (announcedInput) return;
      announcedInput = true;
      events.emit('firstinput', undefined);
    },
    onDemote: (): void => {
      const lower = lowerTier(tier);
      if (disposed || !current || !lower) return;
      // A tier decides what kind of canvas there is, so a new tier is a new engine.
      const snapshot = (last = current.snapshot());
      current.engine.dispose();
      current = null;
      tier = lower;
      events.emit('quality', { tier, demoted: true });
      rebuild(snapshot);
    },
    onNavigation: <K extends keyof NavigatorEvents>(
      event: K,
      payload: NavigatorEvents[K],
    ): void => {
      // Only news about the journey's OWN destination settles it: setting out from one dock for
      // another also reports the old one as left.
      const about = (payload as { id?: string | null }).id;
      if (journey && about === journey.id) {
        if (event === 'docked') settleJourney('arrived');
        else if (event === 'undocked') settleJourney('cancelled');
      }
      // The navigator's events are a subset of the universe's, name for name and shape for shape.
      events.emit(event, payload as UniverseEvents[K]);
    },
    onContextLost: (): void => {
      if (disposed || !current) return;
      const snapshot = (last = current.snapshot());
      current.engine.dispose();
      current = null;
      if (!budget.spend(performance.now())) {
        events.emit('fatal', { reason: 'WebGL context lost repeatedly' });
        return;
      }
      whenVisible(() => rebuild(snapshot));
    },
  };

  function rebuild(snapshot: Snapshot): void {
    if (disposed) return;
    try {
      current = boot(options, hooks, { tier, forced }, snapshot);
      current.rig.setInset(inset, true);
      current.engine.setPaused(paused);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      events.emit('fatal', { reason: `WebGL context lost and not regained: ${reason}` });
    }
  }

  /** Browsers take contexts from tabs nobody is looking at; asking for one back there is futile. */
  function whenVisible(run: () => void): void {
    if (!document.hidden) {
      run();
      return;
    }
    const onChange = (): void => {
      if (document.hidden) return;
      waiting?.();
      run();
    };
    waiting = (): void => {
      document.removeEventListener('visibilitychange', onChange);
      waiting = null;
    };
    document.addEventListener('visibilitychange', onChange);
  }

  const start = startingFrom(options.start);
  current = boot(options, hooks, { tier, forced }, start.snapshot, start.at);

  return {
    on: (event, listener) => events.on(event, listener),
    get state(): AppState {
      return current?.navigator.state ?? FLIGHT;
    },
    goTo: (id, { mode = 'fly' } = {}) => {
      const navigator = current?.navigator;
      if (!navigator) return Promise.resolve('cancelled');
      const { state } = navigator;
      if (state.mode === 'docked' && state.target === id) return Promise.resolve('arrived');

      settleJourney('cancelled');
      const going = (mode === 'fly' && navigator.approach(id)) || navigator.place(id);
      if (!going) return Promise.resolve('cancelled');
      // `place` has docked already, but says so with the next frame, like everything else.
      return new Promise((settle) => {
        journey = { id, settle };
      });
    },
    undock: () => current?.navigator.release('asked'),
    snapshot: () => current?.snapshot() ?? last,
    setPanelInset: (next, { cut = false } = {}) => {
      inset = { ...next };
      // The panel itself does not slide under reduced motion (global.css); neither does the view.
      current?.rig.setInset(inset, cut || options.reducedMotion === true);
    },
    setPaused: (value) => {
      paused = value;
      current?.engine.setPaused(value);
    },
    dispose: () => {
      disposed = true;
      settleJourney('cancelled');
      waiting?.();
      current?.engine.dispose();
      current = null;
      events.clear();
    },
  };
}

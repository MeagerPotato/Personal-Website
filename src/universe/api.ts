/**
 * THE ONLY DOOR INTO THE ENGINE. The web layer (src/shell) imports this file and nothing else
 * from src/universe, and it does so with a dynamic import(), so plain mode never downloads
 * three.js. No top-level side effects here.
 *
 * So far this is the lifecycle and one fact about the pilot. The navigation surface (goTo, undock,
 * setMapOpen, setPanelInset, state, activeDestination) lands in Phase 2; see docs/PLAN.md §5.5.
 */

import { EventBus } from './core/events';
import { isTier, lowerTier, startingTier, type QualityTier } from './core/quality/tiers';
import { RebuildBudget, type Snapshot } from './core/snapshot';
import { boot, type Booted } from './main';

export type { QualityTier } from './core/quality/tiers';

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
  /** The engine cannot continue; the web layer should fall back to plain mode. */
  fatal: { reason: string };
};

export interface Universe {
  /** Subscribe to an engine event. Returns the unsubscribe function. */
  on<K extends keyof UniverseEvents>(
    event: K,
    listener: (payload: UniverseEvents[K]) => void,
  ): () => void;
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
      const snapshot = current.snapshot();
      current.engine.dispose();
      current = null;
      tier = lower;
      events.emit('quality', { tier, demoted: true });
      rebuild(snapshot);
    },
    onContextLost: (): void => {
      if (disposed || !current) return;
      const snapshot = current.snapshot();
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

  current = boot(options, hooks, { tier, forced }, null);

  return {
    on: (event, listener) => events.on(event, listener),
    setPaused: (value) => {
      paused = value;
      current?.engine.setPaused(value);
    },
    dispose: () => {
      disposed = true;
      waiting?.();
      current?.engine.dispose();
      current = null;
      events.clear();
    },
  };
}

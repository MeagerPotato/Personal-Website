/**
 * THE ONLY DOOR INTO THE ENGINE. The web layer (src/shell) imports this file and nothing else
 * from src/universe, and it does so with a dynamic import(), so plain mode never downloads
 * three.js. No top-level side effects here.
 *
 * Phase 0 exposes the lifecycle only. The navigation surface (goTo, undock, setMapOpen,
 * setPanelInset, state, activeDestination) lands in Phase 2; see docs/PLAN.md §5.5.
 */

import { boot } from './main';

export interface UniverseOptions {
  /** Element the engine mounts its own <canvas> into. */
  mount: HTMLElement;
  /**
   * The visitor prefers reduced motion but chose the universe anyway (the mode script sends them
   * to plain mode otherwise). The loop still runs, because flying is motion they asked for;
   * everything AMBIENT is calmed: no twinkle, no sky drift, and later no camera flourishes.
   */
  reducedMotion?: boolean;
}

export type UniverseEvents = {
  /** The first frame is on screen. */
  ready: undefined;
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

/**
 * Rejects if WebGL is unavailable or only software-rendered.
 *
 * Ordering guarantee: `ready` fires from the first animation frame, which is always after this
 * promise resolves, so a listener attached right after `await createUniverse()` never misses it.
 */
export async function createUniverse(options: UniverseOptions): Promise<Universe> {
  const { engine, events } = boot(options);
  return {
    on: (event, listener) => events.on(event, listener),
    setPaused: (paused) => engine.setPaused(paused),
    dispose: () => {
      engine.dispose();
      events.clear();
    },
  };
}

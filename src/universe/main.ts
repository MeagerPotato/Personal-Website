import type { UniverseEvents, UniverseOptions } from './api';
import { Engine } from './core/Engine';
import { EventBus } from './core/events';
import { Starfield } from './world/Starfield';

/**
 * Composition root: builds the engine and adds systems in an explicit order. Phase 0 has one
 * system (the sky). Flight, camera rig, world, and UI systems are added here from Phase 1.
 */
export function boot(options: UniverseOptions): {
  engine: Engine;
  events: EventBus<UniverseEvents>;
} {
  const events = new EventBus<UniverseEvents>();
  const reducedMotion = options.reducedMotion ?? false;

  const engine = new Engine({
    mount: options.mount,
    onFirstFrame: () => events.emit('ready', undefined),
    // Phase 1 step 12 replaces this with "rebuild the engine on a fresh canvas from a snapshot".
    onContextLost: () => events.emit('fatal', { reason: 'WebGL context lost' }),
  });

  const starfield = engine.add(
    new Starfield({
      coarsePointer: window.matchMedia('(pointer: coarse)').matches,
      reducedMotion,
    }),
  );
  engine.scene.add(starfield.object);

  engine.start();
  return { engine, events };
}

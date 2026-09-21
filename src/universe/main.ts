import type { UniverseEvents, UniverseOptions } from './api';
import { Engine } from './core/Engine';
import { EventBus } from './core/events';
import { Backdrop } from './world/Backdrop';
import { SpaceDust } from './world/SpaceDust';
import { Starfield } from './world/Starfield';

/**
 * Composition root: builds the engine and adds systems in an explicit order. So far that is the
 * sky (backdrop, stars) and the dust; flight, the camera rig, the world and the UI join here.
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

  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;

  const backdrop = engine.add(new Backdrop());
  const starfield = engine.add(new Starfield({ coarsePointer, reducedMotion }));
  const dust = engine.add(new SpaceDust({ coarsePointer, reducedMotion }));
  engine.scene.add(backdrop.object, starfield.object, dust.object);

  engine.start();
  return { engine, events };
}

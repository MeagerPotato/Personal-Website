import type { FlightInput } from '../../sim/types';
import type { System } from '../Engine';
import { clearIntent, isSteering, type InputSource } from './intents';

/**
 * Merges every input device into ONE FlightInput per simulation step. It must be added to the
 * engine before anything that flies, so that a step always sees the input sampled for it.
 */
export class InputSystem implements System {
  /** What the pilot wants during the current step. Read it; do not keep or change it. */
  readonly current: FlightInput = { thrust: 0, turn: 0, brake: 0, boost: false };

  /**
   * When set, this source ALONE flies the ship and the devices are not read: a replay (exactness
   * needs every other hand off the stick). Whoever sets it clears it, and disposes it.
   */
  override: InputSource | null = null;

  private readonly sources: InputSource[] = [];
  private sawInput = false;

  /** `onFirstInput` fires once, the first time the pilot asks for anything. */
  constructor(private readonly onFirstInput: () => void = () => undefined) {}

  add<T extends InputSource>(source: T): T {
    this.sources.push(source);
    return source;
  }

  fixedUpdate(): void {
    clearIntent(this.current);
    if (this.override) this.override.read(this.current);
    else for (const source of this.sources) source.read(this.current);

    if (!this.sawInput && isSteering(this.current)) {
      this.sawInput = true;
      this.onFirstInput();
    }
  }

  dispose(): void {
    this.override = null;
    for (const source of this.sources.splice(0)) source.dispose();
    clearIntent(this.current);
  }
}

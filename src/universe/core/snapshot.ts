import type { ShipState } from '../sim/types';

/**
 * Everything needed to build the engine again exactly where it was: after the browser takes the
 * WebGL context away (a phone that spent a minute in the background), and later when a page is
 * opened on a planet or a quality tier needs a different kind of canvas. It is deliberately tiny,
 * because nothing else in the world is state: where every planet is follows from `steps`.
 */
export interface Snapshot {
  /** Simulation steps taken so far. The simulation's only clock (core/loop.ts). */
  readonly steps: number;
  readonly ship: Readonly<ShipState>;
}

/**
 * How often the engine may be rebuilt. One lost context is a phone being a phone; several in a
 * row is a GPU that cannot cope, and then the honest answer is plain mode, not a loop.
 */
export class RebuildBudget {
  private readonly times: number[] = [];

  constructor(
    private readonly maxRebuilds: number,
    private readonly windowMs: number,
  ) {}

  /** Asks for one rebuild at `nowMs`. False means: give up. */
  spend(nowMs: number): boolean {
    while (this.times.length > 0 && nowMs - (this.times[0] ?? 0) > this.windowMs) {
      this.times.shift();
    }
    if (this.times.length >= this.maxRebuilds) return false;
    this.times.push(nowMs);
    return true;
  }
}

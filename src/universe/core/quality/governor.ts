/**
 * THE FRAME GOVERNOR watches how long frames take and does two things about it
 * (docs/PLAN.md, Appendix A):
 *
 * 1. THE PROBE. After a warm-up (shaders compile, planets are generated), a couple of seconds of
 *    frames decide whether the quality tier is too much for this device. If so it says `demote`,
 *    once. It never promotes.
 * 2. DYNAMIC RESOLUTION, for the rest of the visit: additive increase, bigger decrease. A second
 *    of slow frames takes a slice off the render resolution; a long clean stretch puts a smaller
 *    slice back; changes are kept apart so the picture never pumps.
 *
 * Two traps. HITCHES: a garbage collection or a planet being uploaded makes one long frame, and
 * no resolution would have saved it, so the slowest tenth of every window is left out of the
 * average. But a frame is never ignored just for being long: a device on which EVERY frame takes
 * a quarter of a second needs help more than any other.
 *
 * And 30 Hz DISPLAYS: a phone that is saving power runs its display at 30 Hz. Frames then take a
 * rock steady 33 ms while our own work takes a few, and no amount of demoting would change that.
 * Such a cadence is the display's doing, so the target becomes 33 ms and nothing is sacrificed.
 *
 * Pure: it is fed numbers and returns decisions, so it is tested without a GPU.
 */

export interface GovernorParams {
  /** Seconds after the first frame that do not count. */
  readonly warmupSec: number;
  /** Then the probe: this many seconds decide whether the tier is too much for the device ... */
  readonly probeSec: number;
  /** ... which it is if they averaged fewer frames per second than this. */
  readonly demoteBelowFps: number;
  /** A window of frames slower than slowFactor x the target takes scaleDown off the resolution ... */
  readonly slowFactor: number;
  readonly scaleDown: number;
  /** ... but never below this share of the full resolution. */
  readonly minScale: number;
  /** cleanSec of good frames put scaleUp back. */
  readonly scaleUp: number;
  readonly cleanSec: number;
  /** At least this long between two changes. */
  readonly holdSec: number;
  /** A 30 Hz display: frames within this much jitter (ms) of 33 ms, with our own work under cappedJsMs. */
  readonly cappedJitterMs: number;
  readonly cappedJsMs: number;
}

export type GovernorAction = { kind: 'demote' } | { kind: 'scale'; scale: number };

const WINDOW_SEC = 1;
/** No frame counts for more than this, so that one stall cannot be a whole window by itself. */
const STALL_MS = 250;
/** The slowest share of a window's frames that is put down to hitches and left out. */
const HITCH_SHARE = 0.1;
const THIRTY_HZ_MS = 1000 / 30;
const CAPACITY = 1024;

export class FrameGovernor {
  /** Share of the full resolution to render at: minScale to 1. */
  scale = 1;

  private phase: 'warmup' | 'probe' | 'steady' = 'warmup';
  private phaseSec = 0;
  private count = 0;
  private readonly frames = new Float32Array(CAPACITY);
  private readonly work = new Float32Array(CAPACITY);
  private readonly sorted = new Float32Array(CAPACITY);
  private sinceChangeSec = Infinity;
  private cleanSec = 0;

  constructor(
    private readonly params: GovernorParams,
    private readonly options: { readonly targetFps: number; readonly canDemote: boolean },
  ) {}

  /**
   * Feed it every frame: how long the frame took, and how much of that was our own JavaScript.
   * Returns what to do about it, or null (almost always).
   */
  frame(frameMs: number, jsMs: number): GovernorAction | null {
    if (!(frameMs > 0)) return null;
    frameMs = Math.min(frameMs, STALL_MS);
    this.phaseSec += frameMs / 1000;

    if (this.phase === 'warmup') {
      if (this.phaseSec >= this.params.warmupSec) this.enter('probe');
      return null;
    }

    if (this.count < CAPACITY) {
      this.frames[this.count] = frameMs;
      this.work[this.count] = jsMs;
      this.count += 1;
    }
    const windowSec = this.phase === 'probe' ? this.params.probeSec : WINDOW_SEC;
    if (this.phaseSec < windowSec) return null;

    const { mean, capped } = this.measure();
    const wasProbe = this.phase === 'probe';
    const spanSec = this.phaseSec;
    this.enter('steady');

    if (wasProbe) {
      const tooSlow = mean > 1000 / this.params.demoteBelowFps;
      return this.options.canDemote && tooSlow && !capped ? { kind: 'demote' } : null;
    }
    return this.adapt(mean, capped, spanSec);
  }

  private adapt(meanMs: number, capped: boolean, spanSec: number): GovernorAction | null {
    const { slowFactor, scaleDown, scaleUp, minScale, cleanSec, holdSec } = this.params;
    const targetMs = capped ? THIRTY_HZ_MS : 1000 / this.options.targetFps;
    this.sinceChangeSec += spanSec;

    if (meanMs > slowFactor * targetMs) {
      this.cleanSec = 0;
      if (this.scale <= minScale + 1e-6 || this.sinceChangeSec < holdSec) return null;
      return this.setScale(Math.max(minScale, this.scale - scaleDown));
    }

    this.cleanSec += spanSec;
    if (this.scale >= 1 || this.cleanSec < cleanSec || this.sinceChangeSec < holdSec) return null;
    this.cleanSec = 0;
    return this.setScale(Math.min(1, this.scale + scaleUp));
  }

  private setScale(scale: number): GovernorAction {
    this.scale = Math.round(scale * 100) / 100;
    this.sinceChangeSec = 0;
    return { kind: 'scale', scale: this.scale };
  }

  private enter(phase: 'probe' | 'steady'): void {
    this.phase = phase;
    this.phaseSec = 0;
    this.count = 0;
  }

  /** The window's average frame, hitches left out, and whether it looks like a 30 Hz display. */
  private measure(): { mean: number; capped: boolean } {
    const { count, frames, work } = this;
    const ordered = this.sorted.subarray(0, count);
    ordered.set(frames.subarray(0, count));
    ordered.sort();
    const hitchMs = ordered[count - 1 - Math.floor(count * HITCH_SHARE)] ?? STALL_MS;

    let n = 0;
    let sum = 0;
    let workSum = 0;
    for (let i = 0; i < count; i += 1) {
      const ms = frames[i] ?? 0;
      if (ms > hitchMs) continue;
      n += 1;
      sum += ms;
      workSum += work[i] ?? 0;
    }
    n = Math.max(n, 1);
    const mean = sum / n;
    let deviation = 0;
    for (let i = 0; i < count; i += 1) {
      const ms = frames[i] ?? 0;
      if (ms <= hitchMs) deviation += Math.abs(ms - mean);
    }

    const capped =
      Math.abs(mean - THIRTY_HZ_MS) < 2.5 &&
      deviation / n < this.params.cappedJitterMs &&
      workSum / n < this.params.cappedJsMs;
    return { mean, capped };
  }
}

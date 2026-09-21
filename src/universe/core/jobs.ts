import type { Frame, System } from './Engine';

/**
 * How much of a frame the queue may spend: `share` of the time the last frame took, but at least
 * `minMs` and at most `maxMs`. At 60 fps a quarter of a frame is the usual 4 ms. On a device that
 * manages 15 fps a fixed 4 ms would stretch building the world over a minute; a share keeps it to
 * seconds, and costs a frame rate that is already low very little.
 */
export interface JobBudget {
  readonly share: number;
  readonly minMs: number;
  readonly maxMs: number;
}

/**
 * TIME-SLICED WORK. Building a detailed planet takes a few milliseconds, and a few milliseconds
 * in the wrong frame is a dropped frame. A job is a generator that yields at safe places to
 * pause; each frame the queue runs jobs until its budget is spent and picks up where it stopped
 * on the next frame. Work arrives a little later; frames always arrive on time.
 *
 * Jobs run in the order they were added, one at a time. Add the queue to the engine LAST, so it
 * spends only what the rest of the frame left over.
 */
export class JobQueue implements System {
  private readonly jobs: Array<{ run: Generator<void, unknown>; done: (result: never) => void }> =
    [];

  private readonly budget: JobBudget;

  /** `budget`: a JobBudget, or a plain number of milliseconds per frame. */
  constructor(
    budget: JobBudget | number,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.budget = typeof budget === 'number' ? { share: 0, minMs: budget, maxMs: budget } : budget;
  }

  get pending(): number {
    return this.jobs.length;
  }

  /** Returns a function that cancels the job: `done` will then never be called. */
  add<T>(run: Generator<void, T>, done: (result: T) => void): () => void {
    const job = { run, done: done as (result: never) => void };
    this.jobs.push(job);
    return () => {
      const at = this.jobs.indexOf(job);
      if (at >= 0) this.jobs.splice(at, 1);
    };
  }

  frameUpdate(frame?: Frame): void {
    const { share, minMs, maxMs } = this.budget;
    const budgetMs = Math.min(Math.max((frame?.dt ?? 0) * 1000 * share, minMs), maxMs);
    const deadline = this.now() + budgetMs;
    // Always at least one slice per frame, however late the frame already is: work must finish.
    do {
      const job = this.jobs[0];
      if (!job) return;
      const step = job.run.next();
      if (step.done) {
        this.jobs.shift();
        job.done(step.value as never);
      }
    } while (this.now() < deadline);
  }

  dispose(): void {
    this.jobs.length = 0;
  }
}

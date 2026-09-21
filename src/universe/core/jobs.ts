import type { System } from './Engine';

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

  constructor(
    private readonly budgetMs: number,
    private readonly now: () => number = () => performance.now(),
  ) {}

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

  frameUpdate(): void {
    const deadline = this.now() + this.budgetMs;
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

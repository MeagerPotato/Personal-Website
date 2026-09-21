import { describe, expect, it, vi } from 'vitest';
import { JobQueue } from './jobs';

function* countTo(n: number, log: number[]): Generator<void, string> {
  for (let i = 1; i <= n; i += 1) {
    log.push(i);
    yield;
  }
  return `counted to ${n}`;
}

describe('JobQueue', () => {
  it('runs a job across frames, stopping each frame when the budget is spent', () => {
    let clock = 0;
    const log: number[] = [];
    const done = vi.fn();
    // Every slice "takes" 3 ms; the budget is 4 ms, so two slices fit in a frame.
    const queue = new JobQueue(4, () => clock);
    queue.add(
      (function* () {
        for (const step of countTo(5, log)) {
          clock += 3;
          yield step;
        }
        return 'finished';
      })(),
      done,
    );

    queue.frameUpdate();
    expect(log).toEqual([1, 2]);
    expect(done).not.toHaveBeenCalled();
    queue.frameUpdate();
    queue.frameUpdate();
    expect(log).toEqual([1, 2, 3, 4, 5]);
    // The generator's last slice (its return) still has to run.
    queue.frameUpdate();
    expect(done).toHaveBeenCalledWith('finished');
    expect(queue.pending).toBe(0);
  });

  it('always makes some progress, even in a frame that is already late', () => {
    const log: number[] = [];
    const queue = new JobQueue(0, () => 0);
    queue.add(countTo(3, log), () => undefined);
    queue.frameUpdate();
    expect(log).toEqual([1]);
  });

  it('runs jobs in order, and never reports a cancelled one', () => {
    const first = vi.fn();
    const second = vi.fn();
    const queue = new JobQueue(1000);
    const cancel = queue.add(countTo(2, []), first);
    queue.add(countTo(1, []), second);
    cancel();
    cancel(); // twice is harmless

    queue.frameUpdate();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('counted to 1');
  });

  it('drops everything when it is disposed', () => {
    const done = vi.fn();
    const queue = new JobQueue(1000);
    queue.add(countTo(1, []), done);
    queue.dispose();
    queue.frameUpdate();
    expect(done).not.toHaveBeenCalled();
  });
});

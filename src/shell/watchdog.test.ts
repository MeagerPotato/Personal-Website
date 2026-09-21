import { describe, expect, it, vi } from 'vitest';
import { startFrameWatchdog, type FrameSource } from './watchdog';

/** A hand-cranked requestAnimationFrame: nothing runs until the test delivers a frame. */
function fakeFrames() {
  let nextHandle = 1;
  const queue = new Map<number, (now: number) => void>();
  const source: FrameSource = {
    request(callback) {
      const handle = nextHandle++;
      queue.set(handle, callback);
      return handle;
    },
    cancel(handle) {
      queue.delete(handle);
    },
  };
  return {
    source,
    frame(now: number): void {
      const batch = [...queue.values()];
      queue.clear();
      for (const callback of batch) callback(now);
    },
    get pending(): number {
      return queue.size;
    },
  };
}

describe('startFrameWatchdog', () => {
  it('never fires synchronously', () => {
    const frames = fakeFrames();
    const onExpire = vi.fn();
    startFrameWatchdog(0, onExpire, frames.source);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('expires exactly once when frame time adds up to the budget, then stops asking for frames', () => {
    const frames = fakeFrames();
    const onExpire = vi.fn();
    startFrameWatchdog(100, onExpire, frames.source);

    for (let now = 0; now <= 96; now += 16) frames.frame(now); // 96 ms of frames: not yet
    expect(onExpire).not.toHaveBeenCalled();

    frames.frame(112);
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(frames.pending).toBe(0);

    frames.frame(128);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('does not count time without frames: a background tab is not a broken engine', () => {
    const frames = fakeFrames();
    const onExpire = vi.fn();
    startFrameWatchdog(8000, onExpire, frames.source);

    frames.frame(0);
    frames.frame(16);
    frames.frame(10 * 60_000); // the visitor comes back to the tab ten minutes later
    expect(onExpire).not.toHaveBeenCalled();
    expect(frames.pending).toBe(1);
  });

  it('still expires for a visible page that never gets its first frame', () => {
    const frames = fakeFrames();
    const onExpire = vi.fn();
    startFrameWatchdog(8000, onExpire, frames.source);

    for (let now = 0; now <= 8000; now += 16) frames.frame(now);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('ignores a clock that runs backwards', () => {
    const frames = fakeFrames();
    const onExpire = vi.fn();
    startFrameWatchdog(50, onExpire, frames.source);

    frames.frame(1000);
    frames.frame(900);
    frames.frame(910);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('stop() cancels the pending frame and nothing fires afterwards', () => {
    const frames = fakeFrames();
    const onExpire = vi.fn();
    const stop = startFrameWatchdog(10, onExpire, frames.source);

    frames.frame(0);
    stop();
    expect(frames.pending).toBe(0);

    frames.frame(1000);
    expect(onExpire).not.toHaveBeenCalled();
  });
});

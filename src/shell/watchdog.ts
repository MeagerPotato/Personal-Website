/**
 * A deadline that only counts time during which the browser is delivering animation frames.
 *
 * Why not setTimeout: a page opened in a background tab, or sitting in a minimised window, gets
 * no animation frames, so the engine CANNOT draw its first frame there. A wall-clock timer would
 * call that a failure and drop a perfectly healthy visitor into plain mode before they ever look
 * at the page. Frame time stands still exactly when the engine is unable to make progress.
 */

export interface FrameSource {
  request(callback: (now: number) => void): number;
  cancel(handle: number): void;
}

const browserFrames: FrameSource = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
};

/**
 * The most one frame may add to the clock. The first frame after a long pause reports the whole
 * pause as its delta; none of that was time the engine could have used.
 */
const MAX_STEP_MS = 250;

/**
 * Calls `onExpire` once, after `budgetMs` of frame time, unless the returned stop function runs
 * first. Never fires synchronously.
 */
export function startFrameWatchdog(
  budgetMs: number,
  onExpire: () => void,
  frames: FrameSource = browserFrames,
): () => void {
  let spent = 0;
  let last: number | undefined;
  let handle = 0;
  let done = false;

  const tick = (now: number): void => {
    if (done) return;
    if (last !== undefined) spent += Math.min(Math.max(now - last, 0), MAX_STEP_MS);
    last = now;

    if (spent >= budgetMs) {
      done = true;
      onExpire();
      return;
    }
    handle = frames.request(tick);
  };
  handle = frames.request(tick);

  return () => {
    done = true;
    frames.cancel(handle);
  };
}

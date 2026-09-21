/**
 * Ownership of GPU resources. three.js never frees a geometry, material, texture or render target
 * by itself: whoever creates one must dispose it (AGENTS.md, invariant 9). A Scope makes that one
 * line per resource and one call at the end:
 *
 *   const geometry = scope.track(new IcosahedronGeometry(1, 2));
 *   ...
 *   scope.dispose(); // everything tracked, newest first
 *
 * It knows nothing about three.js, only about things with a dispose() method, so it runs (and is
 * tested) without a GPU.
 */

export interface Disposable {
  dispose(): void;
}

export class Scope implements Disposable {
  /** A Set keeps insertion order and lets a short-lived child leave without a linear search. */
  private readonly cleanups = new Set<() => void>();
  /** Set on a child: tells the parent to forget it. Not a cleanup, so it never counts in `size`. */
  private detach: (() => void) | undefined;
  private closed = false;

  /** Number of things this scope will clean up. For leak checks and the dispose audit. */
  get size(): number {
    return this.cleanups.size;
  }

  get disposed(): boolean {
    return this.closed;
  }

  /** Take ownership of a resource. Returns it, so the call wraps the constructor. */
  track<T extends Disposable>(resource: T): T {
    this.onDispose(() => resource.dispose());
    return resource;
  }

  /**
   * Any other cleanup: remove a listener, detach an object from its parent, stop a timer.
   * Returns a function that withdraws the cleanup WITHOUT running it, for whoever cleans up
   * early by themselves.
   */
  onDispose(cleanup: () => void): () => void {
    if (this.closed) {
      // Work that finished after its owner was torn down (a model that arrived late, say) must
      // not leak: clean it up on the spot.
      cleanup();
      return () => undefined;
    }
    // Wrapped, so that registering the same function twice gives two independent entries.
    const entry = (): void => cleanup();
    this.cleanups.add(entry);
    return () => {
      this.cleanups.delete(entry);
    };
  }

  /**
   * A scope with a shorter life (one planet's close-up mesh). It ends with its parent at the
   * latest; if it ends earlier, the parent forgets it, so a long session does not pile them up.
   */
  child(): Scope {
    const child = new Scope();
    child.detach = this.onDispose(() => child.dispose());
    return child;
  }

  /**
   * Runs every cleanup, newest first, exactly once. One failing cleanup must not leak the rest,
   * so errors are collected and rethrown together at the end.
   */
  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.detach?.();
    this.detach = undefined;

    const pending = [...this.cleanups].reverse();
    this.cleanups.clear();
    const errors: unknown[] = [];
    for (const cleanup of pending) {
      try {
        cleanup();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, 'Scope: several cleanups failed');
  }
}

/**
 * A tiny typed event bus. Engine rule (docs/PLAN.md §5.5): commands go DOWN as method calls;
 * discrete facts go UP as events ("docked", "ready"); per-frame data is pulled, never emitted.
 */
export class EventBus<Events extends object> {
  private readonly listeners = new Map<keyof Events, Set<(payload: never) => void>>();

  /** Subscribe. Returns the unsubscribe function. */
  on<K extends keyof Events>(event: K, listener: (payload: Events[K]) => void): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as (payload: never) => void);
    return () => {
      set.delete(listener as (payload: never) => void);
    };
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    // Copy first: a listener may unsubscribe (or subscribe others) while we iterate.
    for (const listener of [...set]) (listener as (payload: Events[K]) => void)(payload);
  }

  clear(): void {
    this.listeners.clear();
  }
}

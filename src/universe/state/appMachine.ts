/**
 * WHAT THE VISITOR IS DOING, as the rest of the site needs to know it (docs/PLAN.md §5.5):
 *
 *   flight     flying freely. `target` is null.
 *   autopilot  being flown to a body that is out of reach (from Phase 2, E6).
 *   approach   within reach of the body: being flown onto its ring.
 *   docked     circling it. This is when its page is the panel.
 *
 * A pure table of what may follow what. `transition` answers with the new state, or with null
 * when the event changes nothing or is not allowed here; whoever drives it (state/Navigator.ts)
 * announces a `statechange` exactly when the answer is not null.
 */
export type AppMode = 'flight' | 'autopilot' | 'approach' | 'docked';

export interface AppState {
  readonly mode: AppMode;
  /** Id of the body travelled to, approached or docked at. Null exactly in free flight. */
  readonly target: string | null;
}

export type AppEvent =
  /** Set out for a body that is out of reach. */
  | { readonly type: 'travel'; readonly to: string }
  /** The body is within reach: fly onto its ring. */
  | { readonly type: 'approach'; readonly to: string }
  /** The approach reached the ring, or a journey arrived beside it (sim/docking.ts, arrive). */
  | { readonly type: 'capture' }
  /** Be in orbit there at once, from wherever (a page opened on a planet). */
  | { readonly type: 'place'; readonly at: string }
  /** Back to free flight: the pilot took over, or the route went home. */
  | { readonly type: 'release' };

export const FLIGHT: AppState = Object.freeze({ mode: 'flight', target: null });

export function transition(state: AppState, event: AppEvent): AppState | null {
  switch (event.type) {
    case 'travel':
    case 'approach': {
      const mode = event.type === 'travel' ? 'autopilot' : 'approach';
      if (state.target === event.to) {
        // Already there, or already on the way in the same manner.
        if (state.mode === 'docked' || state.mode === mode) return null;
        // A journey never goes back a stage: within reach there is nothing left to travel.
        if (mode === 'autopilot' && state.mode === 'approach') return null;
      }
      return { mode, target: event.to };
    }
    case 'capture':
      return state.mode === 'approach' || state.mode === 'autopilot'
        ? { mode: 'docked', target: state.target }
        : null;
    case 'place':
      return state.mode === 'docked' && state.target === event.at
        ? null
        : { mode: 'docked', target: event.at };
    case 'release':
      return state.mode === 'flight' ? null : FLIGHT;
  }
}

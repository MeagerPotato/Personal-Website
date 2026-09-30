/** The studio's overview (posts, comments waiting, email), shared by the frame and the screens. */
import { createContext, use } from 'react';
import type { Overview } from './api';

export interface OverviewState {
  /** Null until the first load. */
  overview: Overview | null;
  /** Loads it again: after anything that changes a count or the list of posts. */
  refresh: () => Promise<void>;
}

export const OverviewContext = createContext<OverviewState>({
  overview: null,
  refresh: async () => undefined,
});

export const useOverview = (): OverviewState => use(OverviewContext);

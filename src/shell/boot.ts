// The only script every page loads. It must stay tiny: plain mode pays for nothing else.
// mode.inline.js already chose the mode before first paint; here we only act on it.
//
// Load chain (docs/PLAN.md §5.2):
//   mode.inline.js -> boot.ts -> import('./universe-shell') -> import('../universe/api')
// Both imports are DYNAMIC on purpose. scripts/verify-dist.mjs fails the build if three.js ever
// becomes statically reachable from a page.

import { ANALYTICS_HOST, ANALYTICS_TOKEN } from '../config/analytics';
import { startAnalytics } from './analytics';

// Both modes, every page: a visit is a visit. It does nothing without a token, off the real
// site, or for a visitor who asks not to be tracked (see analytics.ts).
startAnalytics({
  token: ANALYTICS_TOKEN,
  countedHost: ANALYTICS_HOST,
  hostname: location.hostname,
  privacy: {
    globalPrivacyControl: (navigator as Navigator & { globalPrivacyControl?: boolean })
      .globalPrivacyControl,
    doNotTrack: navigator.doNotTrack,
  },
});

if (import.meta.env.DEV && document.documentElement.dataset.lab !== undefined) {
  // The asset lab, `/lab/` under `npm run dev`. The condition is a build-time constant: no build
  // contains this branch, the page, or anything behind the import.
  void import('./lab-shell').then(({ start }) => start());
} else if (document.documentElement.dataset.mode === 'universe') {
  void import('./universe-shell').then(({ start }) => start());
}

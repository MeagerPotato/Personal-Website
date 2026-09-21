// The only script every page loads. It must stay tiny: plain mode pays for nothing else.
// mode.inline.js already chose the mode before first paint; here we only act on it.
//
// Load chain (docs/PLAN.md §5.2):
//   mode.inline.js -> boot.ts -> import('./universe-shell') -> import('../universe/api')
// Both imports are DYNAMIC on purpose. scripts/verify-dist.mjs fails the build if three.js ever
// becomes statically reachable from a page.

if (document.documentElement.dataset.mode === 'universe') {
  void import('./universe-shell').then(({ start }) => start());
}

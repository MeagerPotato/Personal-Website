// Counting visits, politely. Cloudflare Web Analytics sets no cookie and keeps no fingerprint, so
// there is no consent banner to show. The beacon is THEIR script from THEIR host (the CSP names
// it, config/headers.template), added to the page only:
//
//   - when a token is configured (src/config/analytics.ts),
//   - on the real site: a preview deployment, `wrangler dev` or localhost is not a visit,
//   - for a visitor whose browser does not say "do not track me" (Global Privacy Control, or the
//     older Do Not Track). Nothing requires honouring them for cookie-less counting; it is polite.
//
// The beacon watches the History API by itself, so a soft navigation (src/shell/router.ts) is
// counted as a page view without anyone telling it.

const BEACON_SRC = 'https://static.cloudflareinsights.com/beacon.min.js';

export interface AnalyticsOptions {
  token: string;
  /** The one hostname on which visits count. */
  countedHost: string;
  /** Where this page is being served from. */
  hostname: string;
  /** What the visitor's browser says about being tracked. */
  privacy: { globalPrivacyControl?: boolean | undefined; doNotTrack?: string | null | undefined };
}

/** Pure: is this page view one to count? */
export function countsAsVisit(options: AnalyticsOptions): boolean {
  if (options.token === '' || options.hostname !== options.countedHost) return false;
  const { globalPrivacyControl, doNotTrack } = options.privacy;
  return globalPrivacyControl !== true && doNotTrack !== '1';
}

/** Add the beacon, once. Returns whether it is on the page now. */
export function startAnalytics(options: AnalyticsOptions, doc: Document = document): boolean {
  if (!countsAsVisit(options)) return false;
  if (doc.querySelector('script[data-cf-beacon]')) return true;
  const script = doc.createElement('script');
  script.defer = true;
  script.src = BEACON_SRC;
  // The attribute the beacon reads its settings from, exactly as Cloudflare's own snippet has it.
  script.setAttribute('data-cf-beacon', JSON.stringify({ token: options.token }));
  doc.head.append(script);
  return true;
}

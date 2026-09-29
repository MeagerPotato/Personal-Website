/**
 * Cloudflare Web Analytics (docs/PLAN.md §5.9). A module of its own, and not part of `site.ts`,
 * because `src/shell/boot.ts` reads it on every page and must stay tiny.
 *
 * The token is public by design: it ships in the page. EMPTY = ANALYTICS OFF, and the beacon code
 * does nothing. Allen added the site in the Cloudflare dashboard on 2026-09-29, in manual mode so
 * that Cloudflare injects nothing of its own (docs/runbooks/cloudflare-setup.md, step 5); to find
 * this value again: Web Analytics, then Manage site on the allenkh.com card.
 */
export const ANALYTICS_TOKEN = '1cb2cc551dd5472c8dc0293c72f95e11';

/** Visits are only counted here: a preview deployment, `wrangler dev` or localhost is not a visit. */
export const ANALYTICS_HOST = 'allenkh.com';

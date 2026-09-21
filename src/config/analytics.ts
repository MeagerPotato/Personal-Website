/**
 * Cloudflare Web Analytics (docs/PLAN.md §5.9). A module of its own, and not part of `site.ts`,
 * because `src/shell/boot.ts` reads it on every page and must stay tiny.
 *
 * The token is public by design: it ships in the page. EMPTY = ANALYTICS OFF, and the beacon code
 * does nothing. It is filled in once Allen has added the site in the Cloudflare dashboard
 * (docs/runbooks/cloudflare-setup.md, step 5).
 */
export const ANALYTICS_TOKEN = '';

/** Visits are only counted here: a preview deployment, `wrangler dev` or localhost is not a visit. */
export const ANALYTICS_HOST = 'allenkh.com';

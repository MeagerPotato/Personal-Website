/**
 * The headers every page is served with. The Content-Security-Policy is the contract: scripts and
 * styles are the blog's own files, no inline script, ever. Two things may widen it, per page:
 *
 *   - a post's math: Temml writes a few style attributes (`display:block math`, a colour, a
 *     box's padding), and a post names exactly those, by hash ('unsafe-hashes' allows hashed
 *     attributes and nothing else), computed when it is published (server/render.ts);
 *   - Turnstile on the comment form, when it is switched on: Cloudflare's script and frame.
 *
 * A page that needs neither says nothing, and gets the strictest policy by default.
 */

const TURNSTILE = 'https://challenges.cloudflare.com';

export interface PolicyOptions {
  /** 'sha256-…' sources for the style attributes a post's HTML carries. */
  styleHashes?: readonly string[];
  turnstile?: boolean;
  /** The studio: image previews from blob: URLs before they are uploaded. */
  studio?: boolean;
}

export function contentSecurityPolicy(options: PolicyOptions = {}): string {
  const hashes = options.styleHashes ?? [];
  const style = hashes.length ? `'self' 'unsafe-hashes' ${hashes.join(' ')}` : `'self'`;
  const directives = [
    `default-src 'none'`,
    `script-src 'self'${options.turnstile ? ` ${TURNSTILE}` : ''}`,
    `style-src ${style}`,
    // data: for Temml's \cancelto arrow, a mask image written into its stylesheet.
    `img-src 'self' data:${options.studio ? ' blob:' : ''}`,
    `font-src 'self'`,
    `connect-src 'self'`,
    `manifest-src 'self'`,
    ...(options.turnstile ? [`frame-src ${TURNSTILE}`] : []),
    `form-action 'self'`,
    `base-uri 'none'`,
    `frame-ancestors 'none'`,
  ];
  return directives.join('; ');
}

/** Everything but the CSP, the same on every page. */
export const PAGE_HEADERS: Readonly<Record<string, string>> = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  // Not no-referrer: a form's POST must carry its Origin, and with no-referrer it is "null".
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Content-Type-Options': 'nosniff',
  'Permissions-Policy':
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), publickey-credentials-create=(self), publickey-credentials-get=(self)',
  // Never includeSubDomains: allenkh.com's other subdomains are not this Worker's to decide.
  'Strict-Transport-Security': 'max-age=31536000',
};

/**
 * Adds the page headers to an HTML response from Astro. A header the page set itself (a post's
 * CSP, the studio's Cache-Control) is kept. The status text is not: Astro's 404 keeps the "OK"
 * of the page it rendered, and without one the runtime writes the status's own ("Not Found").
 */
export function withPageHeaders(response: Response): Response {
  const type = response.headers.get('content-type') ?? '';
  const out = new Response(response.body, { status: response.status, headers: response.headers });
  for (const [name, value] of Object.entries(PAGE_HEADERS)) {
    if (!out.headers.has(name)) out.headers.set(name, value);
  }
  if (type.startsWith('text/html')) {
    if (!out.headers.has('Content-Security-Policy')) {
      out.headers.set('Content-Security-Policy', contentSecurityPolicy());
    }
    if (!out.headers.has('Cache-Control')) out.headers.set('Cache-Control', 'no-cache');
  }
  return out;
}

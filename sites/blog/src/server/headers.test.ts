import { describe, expect, it } from 'vitest';
import { PAGE_HEADERS, contentSecurityPolicy, withPageHeaders } from './headers';

describe('the Content-Security-Policy', () => {
  it('allows only the blog’s own files by default: no inline script or style, no frames', () => {
    const policy = contentSecurityPolicy();
    expect(policy).toBe(
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; " +
        "connect-src 'self'; manifest-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    );
    expect(policy).not.toContain('unsafe-inline');
  });

  it('names a post’s math styles by hash, and nothing broader', () => {
    const policy = contentSecurityPolicy({ styleHashes: ["'sha256-abc='", "'sha256-def='"] });
    expect(policy).toContain("style-src 'self' 'unsafe-hashes' 'sha256-abc=' 'sha256-def='");
    expect(policy).toContain("script-src 'self';");
  });

  it('lets Turnstile in only where it is switched on', () => {
    const policy = contentSecurityPolicy({ turnstile: true });
    expect(policy).toContain("script-src 'self' https://challenges.cloudflare.com");
    expect(policy).toContain('frame-src https://challenges.cloudflare.com');
  });

  it('lets the studio preview an image before it is uploaded', () => {
    expect(contentSecurityPolicy({ studio: true })).toContain("img-src 'self' data: blob:");
  });
});

describe('withPageHeaders', () => {
  it('gives a page every header, and the strict policy when it names none', () => {
    const page = withPageHeaders(
      new Response('<h1>Hi</h1>', { headers: { 'content-type': 'text/html' } }),
    );
    for (const [name, value] of Object.entries(PAGE_HEADERS))
      expect(page.headers.get(name)).toBe(value);
    expect(page.headers.get('content-security-policy')).toBe(contentSecurityPolicy());
    expect(page.headers.get('cache-control')).toBe('no-cache');
    expect(page.headers.get('strict-transport-security')).not.toContain('includeSubDomains');
  });

  it('keeps a policy and a Cache-Control the page chose', () => {
    const own = contentSecurityPolicy({ styleHashes: ["'sha256-abc='"] });
    const page = withPageHeaders(
      new Response('<h1>Hi</h1>', {
        headers: {
          'content-type': 'text/html',
          'content-security-policy': own,
          'cache-control': 'no-store',
        },
      }),
    );
    expect(page.headers.get('content-security-policy')).toBe(own);
    expect(page.headers.get('cache-control')).toBe('no-store');
  });

  it('keeps a redirect a redirect', () => {
    const moved = withPageHeaders(
      new Response(null, { status: 301, headers: { location: '/new/' } }),
    );
    expect(moved.status).toBe(301);
    expect(moved.headers.get('location')).toBe('/new/');
  });

  it('keeps a 404 a 404, without the "OK" Astro gives it', () => {
    const missing = withPageHeaders(
      new Response('<h1>Lost</h1>', {
        status: 404,
        statusText: 'OK',
        headers: { 'content-type': 'text/html' },
      }),
    );
    expect(missing.status).toBe(404);
    expect(missing.statusText).toBe('');
  });
});

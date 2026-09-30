/**
 * journal.allenkh.com's Worker. Static assets (the web app) are served before this runs; only
 * /api/* reaches it (wrangler.jsonc: assets.run_worker_first).
 *
 * Everything here handles ciphertext. docs/journal-crypto.md says what the server can and cannot
 * see; the short version is: sizes, timings, and which passkeys exist, but no content.
 */
import { Hono } from 'hono';
import { migrate } from './db/migrate';
import type { AppContext, Env } from './env';
import { HttpError } from './lib/http';
import { readSession, sweep } from './lib/sessions';
import { auth } from './routes/auth';
import { blobs } from './routes/blobs';
import { sync } from './routes/sync';

export const app = new Hono<AppContext>().basePath('/api');

app.use('*', async (c, next) => {
  // Writes come only from the journal's own pages. SameSite does not separate subdomains of one
  // site (days2meet.allenkh.com is "same-site"), so the Origin header is checked as well.
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    if (c.req.header('origin') !== c.env.ORIGIN)
      throw new HttpError(403, 'Cross-origin request refused');
  }
  await migrate(c.env.DB);
  c.set('session', await readSession(c));
  await next();
  // Nothing the API says may be cached anywhere but in the page that asked (blobs set their own).
  if (!c.res.headers.has('Cache-Control')) c.header('Cache-Control', 'no-store');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer');
});

app.route('/', auth);
app.route('/', sync);
app.route('/', blobs);

app.notFound((c) => c.json({ error: 'Not found' }, 404));
app.onError((error, c) => {
  if (error instanceof HttpError) {
    const response = c.json({ error: error.message }, error.status);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
  console.error(error);
  return c.json({ error: 'Something went wrong on the server' }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(migrate(env.DB).then(() => sweep(env.DB)));
  },
} satisfies ExportedHandler<Env>;

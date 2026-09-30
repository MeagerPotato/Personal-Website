/**
 * blog.allenkh.com's Worker. Static files (/_astro/…, the icons) are served before it runs; the
 * rest arrives here: the API and the images first, then Astro renders the page.
 */
import { handle } from '@astrojs/cloudflare/handler';
import { api } from './server/api';
import { migrate } from './server/db/migrate';
import { withPageHeaders } from './server/headers';
import { serveMedia } from './server/media';
import { runCron } from './server/scheduled';

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/api/')) return api.fetch(request, env, ctx);
    if (pathname.startsWith('/media/')) return serveMedia(request, env, ctx);
    await migrate(env.DB);
    const page = withPageHeaders(await handle(request, env, ctx));
    // The dev server injects its styles and its reloader inline; the build never does, and the
    // end-to-end tests run the build, its policy included.
    if (import.meta.env.DEV) page.headers.delete('Content-Security-Policy');
    return page;
  },
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(runCron(env));
  },
} satisfies ExportedHandler<Env>;

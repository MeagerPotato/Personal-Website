/** Search engines: everything but the studio and the API. */
import type { APIRoute } from 'astro';
import { robots } from '../server/feeds';
import { blogEnv } from '../site/env';

export const GET: APIRoute = () =>
  new Response(robots(blogEnv().ORIGIN), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    },
  });

/** The RSS feed: the newest posts, in full. */
import type { APIRoute } from 'astro';
import { FEED_POSTS, rss } from '../server/feeds';
import { recentLive } from '../server/posts';
import { blogEnv } from '../site/env';

export const GET: APIRoute = async () => {
  const env = blogEnv();
  return new Response(rss(env.ORIGIN, await recentLive(env.DB, FEED_POSTS)), {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=600',
    },
  });
};

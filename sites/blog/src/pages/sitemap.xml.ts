/** Every page a search engine should know. */
import type { APIRoute } from 'astro';
import { sitemap } from '../server/feeds';
import { listPublished, listSeries, listTags } from '../server/posts';
import { blogEnv } from '../site/env';

export const GET: APIRoute = async () => {
  const env = blogEnv();
  const [posts, tags, series] = await Promise.all([
    listPublished(env.DB),
    listTags(env.DB),
    listSeries(env.DB),
  ]);
  return new Response(sitemap(env.ORIGIN, { posts, tags, series }), {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};

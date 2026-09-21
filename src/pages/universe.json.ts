import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { toUniverseInput } from '../site/universe-input';
import { buildUniverse } from '../universe/data/build';

// The galaxy as data: built once, at build time, into a static /universe.json. The engine fetches
// it in universe mode; plain mode never does. No prose in here: that lives in the HTML pages.
// buildUniverse() throws, listing every problem, if the content does not add up, so a broken
// reference fails the build instead of reaching the site.
export const GET: APIRoute = async () => {
  const [systems, projects, pages] = await Promise.all([
    getCollection('systems'),
    getCollection('projects'),
    getCollection('pages'),
  ]);

  const manifest = buildUniverse(
    toUniverseInput({ systems, projects, pages, includeDrafts: import.meta.env.DEV }),
  );

  return new Response(JSON.stringify(manifest), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};

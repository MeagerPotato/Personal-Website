import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection } from 'astro:content';
import sharp from 'sharp';
import { site } from '../../config/site';
import { hasPortrait, portraitOf, subjectOf } from '../../site/portrait';
import { profiles } from '../../site/profiles';
import { WORLD_PICTURE_SIZES } from '../../site/routes';
import { toUniverseInput } from '../../site/universe-input';
import { visibleProjects } from '../../site/view-models';
import { buildUniverse } from '../../universe/data/build';

// Every project's world as a small picture, /worlds/<id>-<size>.webp, drawn once at build time.
// The drawing is a pure function (src/site/portrait.ts) of the body the galaxy builds, so a
// change to a world's rows repaints its picture; this wrapper only encodes it.
export const getStaticPaths = (async () => {
  const [systems, projects, pages] = await Promise.all([
    getCollection('systems'),
    getCollection('projects'),
    getCollection('pages'),
  ]);
  const { bodies } = buildUniverse(
    toUniverseInput({
      systems,
      projects,
      pages,
      profiles: profiles(site.socials),
      includeDrafts: import.meta.env.DEV,
    }),
  );
  const visible = visibleProjects(projects, import.meta.env.DEV);
  return visible.flatMap((entry) => {
    const body = bodies.find((b) => b.id === `project/${entry.id}`);
    if (!body) throw new Error(`worlds: project ${entry.id} has no body in the galaxy`);
    // A body with no world of its own keeps its ball on the pages, and has no picture.
    if (!hasPortrait(body.id)) return [];
    return Object.values(WORLD_PICTURE_SIZES).map((size) => ({
      params: { file: `${entry.id}-${size}.webp` },
      props: {
        size,
        body: subjectOf(body),
      },
    }));
  });
}) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ props }) => {
  const { size, body } = props as Awaited<ReturnType<typeof getStaticPaths>>[number]['props'];
  const picture = portraitOf(body, size);
  const webp = await sharp(Buffer.from(picture.data.buffer), {
    raw: { width: picture.width, height: picture.height, channels: 4 },
  })
    .webp({ quality: 88, alphaQuality: 90, effort: 6 })
    .toBuffer();
  return new Response(new Uint8Array(webp), { headers: { 'Content-Type': 'image/webp' } });
};

/**
 * Addresses. A post lives at /<slug>/, right under the root (blog.allenkh.com/first-flight/), so
 * a slug must never be the name of one of the site's own pages: those are reserved.
 */

/** Top-level names the site uses or may use. A post can never take one. */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  '404',
  '500',
  'about',
  'admin',
  'api',
  'archive',
  'assets',
  'atom',
  'drafts',
  'feed',
  'feeds',
  'media',
  'page',
  'posts',
  'preview',
  'rss',
  'search',
  'series',
  'sitemap',
  'studio',
  'subscribe',
  'tags',
  'unsubscribe',
]);

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MAX_SLUG = 80;

/** Words to a slug: "Café: 1st Flight!" → "cafe-1st-flight". Empty when nothing is left. */
export function slugify(text: string, max = MAX_SLUG): string {
  const slug = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length <= max) return slug;
  // Cut at a word boundary when there is one close enough.
  const cut = slug.slice(0, max);
  const lastDash = cut.lastIndexOf('-');
  return (lastDash > max / 2 ? cut.slice(0, lastDash) : cut).replace(/-+$/, '');
}

/** Whether `slug` can be a post's address. */
export function isPostSlug(slug: string): boolean {
  return slug.length > 0 && slug.length <= MAX_SLUG && SLUG.test(slug) && !RESERVED_SLUGS.has(slug);
}

/** Whether `slug` can name a tag or a series (they live under /tags/ and /series/). */
export function isNameSlug(slug: string): boolean {
  return slug.length > 0 && slug.length <= MAX_SLUG && SLUG.test(slug);
}

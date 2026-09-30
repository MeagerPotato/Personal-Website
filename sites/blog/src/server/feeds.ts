/**
 * The blog for machines: an RSS feed with every post in full, a sitemap, robots.txt. Built from
 * the same reads as the pages, as strings.
 */
import { site } from '../config';
import type { LivePost, PostSummary, SeriesInfo, TagInfo } from './posts';
import { escapeHtml } from './util';

/** Posts in the feed: the newest, in full. */
export const FEED_POSTS = 20;

/**
 * A post's HTML for another site's reader: its own addresses (/media/…, /#heading) made
 * absolute, in src, srcset and href alike.
 */
export function absoluteUrls(html: string, origin: string): string {
  return html
    .replace(/\s(src|href)="\/(?!\/)/g, (_match, name: string) => ` ${name}="${origin}/`)
    .replace(/\ssrcset="([^"]*)"/g, (_match, list: string) => {
      const absolute = list.replace(/(^|,\s*)\/(?!\/)/g, (_m, lead: string) => `${lead}${origin}/`);
      return ` srcset="${absolute}"`;
    });
}

const cdata = (text: string): string => `<![CDATA[${text.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;

export function rss(origin: string, posts: readonly LivePost[]): string {
  const items = posts.map((post) => {
    const url = `${origin}/${post.slug}/`;
    const categories = post.tags
      .map((tag) => `<category>${escapeHtml(tag.name)}</category>`)
      .join('');
    return [
      '<item>',
      `<title>${escapeHtml(post.title)}</title>`,
      `<link>${url}</link>`,
      `<guid isPermaLink="false">${escapeHtml(post.id)}</guid>`,
      `<pubDate>${new Date(post.publishedAt).toUTCString()}</pubDate>`,
      post.summary ? `<description>${escapeHtml(post.summary)}</description>` : '',
      categories,
      `<content:encoded>${cdata(absoluteUrls(post.html, origin))}</content:encoded>`,
      '</item>',
    ].join('');
  });
  const updated = posts[0]?.updatedAt ?? posts[0]?.publishedAt;
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">',
    '<channel>',
    `<title>${escapeHtml(site.title)}</title>`,
    `<link>${origin}/</link>`,
    `<description>${escapeHtml(site.description)}</description>`,
    `<language>${site.lang}</language>`,
    `<atom:link href="${origin}/rss.xml" rel="self" type="application/rss+xml"/>`,
    updated ? `<lastBuildDate>${new Date(updated).toUTCString()}</lastBuildDate>` : '',
    ...items,
    '</channel>',
    '</rss>',
    '',
  ].join('\n');
}

export function sitemap(
  origin: string,
  content: {
    posts: readonly PostSummary[];
    tags: readonly TagInfo[];
    series: readonly SeriesInfo[];
  },
): string {
  const day = (time: number) => new Date(time).toISOString().slice(0, 10);
  const entry = (path: string, modified?: number) =>
    `<url><loc>${origin}${path}</loc>${modified ? `<lastmod>${day(modified)}</lastmod>` : ''}</url>`;
  const newest = content.posts.reduce((latest, post) => Math.max(latest, post.updatedAt), 0);
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    entry('/', newest || undefined),
    ...content.posts.map((post) => entry(`/${post.slug}/`, post.updatedAt)),
    ...(content.tags.length ? [entry('/tags/')] : []),
    ...content.tags.map((tag) => entry(`/tags/${tag.slug}/`)),
    ...(content.series.length ? [entry('/series/')] : []),
    ...content.series.map((series) => entry(`/series/${series.slug}/`)),
    '</urlset>',
    '',
  ].join('\n');
}

export function robots(origin: string): string {
  return [
    'User-agent: *',
    'Disallow: /studio/',
    'Disallow: /api/',
    '',
    `Sitemap: ${origin}/sitemap.xml`,
    '',
  ].join('\n');
}

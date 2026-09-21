import { site } from '../config/site';
import { OG_SIZE } from './og';
import { routes } from './routes';
import type { Crumb } from './view-models';

// What search engines and link previews read. Plain functions, so the wording is tested once and
// every page says it the same way.

/** "FishAI · Allen". The home page writes its own title in full. */
export const pageTitle = (title: string): string => `${title} · ${site.name}`;

/** Every URL that leaves the site (canonical, og:image, JSON-LD) must be absolute. */
export const absoluteUrl = (path: string): string => new URL(path, site.url).href;

// --- link-preview image --------------------------------------------------------------------------

export interface PreviewImage {
  /** Site-relative path, e.g. "/og/default.png" or a hashed "/_astro/..." file. */
  path: string;
  alt: string;
  width: number;
  height: number;
}

/** Used by every page that has no picture of its own. Drawn by src/site/og.ts. */
export const DEFAULT_PREVIEW: PreviewImage = {
  path: routes.ogDefault(),
  alt: 'A small solar system in flat pastel colours on dark navy space: a butter-yellow sun and four toy planets, one of them ringed.',
  ...OG_SIZE,
};

// --- structured data (JSON-LD) ----------------------------------------------------------------------

type JsonLd = Record<string, unknown>;

const PERSON_ID = `${site.url}/#allen`;
const WEBSITE_ID = `${site.url}/#website`;

/** Allen, once and in full. Other nodes point here with { '@id': ... }. */
export const personLd = (): JsonLd => ({
  '@type': 'Person',
  '@id': PERSON_ID,
  name: site.name,
  url: absoluteUrl(routes.page('about')),
  description: site.description,
  sameAs: Object.values(site.socials),
  affiliation: { '@type': 'CollegeOrUniversity', name: site.affiliation },
  knowsAbout: [...site.knowsAbout],
});

export const websiteLd = (): JsonLd => ({
  '@type': 'WebSite',
  '@id': WEBSITE_ID,
  name: site.name,
  url: absoluteUrl(routes.home()),
  description: site.description,
  inLanguage: site.locale,
  author: { '@id': PERSON_ID },
});

/** The About page is a profile of the person. */
export const profilePageLd = (): JsonLd => ({
  '@type': 'ProfilePage',
  url: absoluteUrl(routes.page('about')),
  isPartOf: { '@id': WEBSITE_ID },
  mainEntity: personLd(),
});

/** "Projects > Code > FishAI", ending with the page itself. */
export const breadcrumbLd = (crumbs: readonly Crumb[], current: Crumb): JsonLd => ({
  '@type': 'BreadcrumbList',
  itemListElement: [...crumbs, current].map((crumb, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    name: crumb.label,
    item: absoluteUrl(crumb.href),
  })),
});

export interface ProjectLdInput {
  id: string;
  title: string;
  summary: string;
  /** "2026-08" */
  date: string;
  stack: readonly string[];
  repo?: string | undefined;
  parentId?: string | undefined;
  imagePath: string;
}

const projectNodeId = (id: string): string => `${absoluteUrl(routes.project(id))}#project`;

/** A project is source code when it links a repository, otherwise simply a creative work. */
export const projectLd = (project: ProjectLdInput): JsonLd => ({
  '@type': project.repo ? 'SoftwareSourceCode' : 'CreativeWork',
  '@id': projectNodeId(project.id),
  name: project.title,
  description: project.summary,
  url: absoluteUrl(routes.project(project.id)),
  image: absoluteUrl(project.imagePath),
  dateCreated: project.date,
  author: { '@id': PERSON_ID },
  ...(project.repo ? { codeRepository: project.repo } : {}),
  ...(project.stack.length > 0 ? { keywords: project.stack.join(', ') } : {}),
  ...(project.parentId ? { isPartOf: { '@id': projectNodeId(project.parentId) } } : {}),
});

/**
 * One <script type="application/ld+json"> body. "<" is escaped so that no string inside the data
 * (a summary, a title) can ever close the script element.
 */
export const serializeLd = (nodes: readonly JsonLd[]): string =>
  JSON.stringify({ '@context': 'https://schema.org', '@graph': nodes }).replaceAll('<', '\\u003c');

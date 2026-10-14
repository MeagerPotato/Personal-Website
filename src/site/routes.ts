/**
 * Every internal URL is built here, so a route can be renamed in one place and a link can never
 * forget its trailing slash (Cloudflare answers a slash-less page URL with a 307).
 */
export const routes = {
  home: (): string => '/',
  /** Standalone pages: about, resume, contact. */
  page: (id: string): string => `/${id}/`,
  projects: (): string => '/projects/',
  /** Planets and moons share one URL shape, so promoting a moon to a planet breaks no links. */
  project: (id: string): string => `/projects/${id}/`,
  system: (id: string): string => `/systems/${id}/`,
  universeManifest: (): string => '/universe.json',
  /**
   * A project's world as a small picture (src/site/portrait.ts), drawn at build time at one of
   * `WORLD_PICTURE_SIZES` pixels square.
   */
  worldPicture: (id: string, size: number): string => `/worlds/${id}-${size}.webp`,
  /** The link-preview image for pages without a picture of their own. */
  ogDefault: (): string => '/og/default.png',
  /**
   * The resume as a PDF, printed from /resume/ by `npm run resume-pdf` (scripts/lib/resume-pdf.mjs
   * names the same file; tests/build-scripts.test.ts holds the two together).
   */
  resumePdf: (): string => '/allen-hsieh-resume.pdf',
} as const;

/**
 * The sizes a world's picture is drawn at (px): a station on a route line and a moon's (at most
 * 2.5rem, so twice that for a sharp screen), and a page's planet where it has no cover (10rem).
 */
export const WORLD_PICTURE_SIZES = { station: 96, hero: 320 } as const;

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The id of a content entry is the first segment of its path: "fishai/index.md" -> "fishai",
 * "code.md" -> "code". Ours rather than the framework's default, because the id IS the URL.
 */
export function entryIdFromPath(entryPath: string): string {
  const first = entryPath.replaceAll('\\', '/').split('/')[0] ?? '';
  const id = first.replace(/\.(md|ya?ml|json)$/i, '');
  if (!KEBAB.test(id)) {
    throw new Error(
      `Content entry "${entryPath}": "${id}" becomes part of a URL, so it must be lowercase kebab-case.`,
    );
  }
  return id;
}

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
} as const;

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

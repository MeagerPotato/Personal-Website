// Which body of the galaxy a page belongs to, and which page a body opens: the two lookups that
// keep the route and the ship in step (follow.ts). And what a body is called (announcer.ts). They come from /universe.json, the same file
// the engine gets. The engine checks it for its own purposes; this file takes only what it can
// use and ignores the rest, so a manifest it cannot read means "no page has a body", not a crash.

export interface Destinations {
  /** The body a page is shown from: the body whose own page it is, or the one it is listed at. */
  idFor(pathname: string): string | null;
  /** The page a body opens. */
  hrefOf(id: string): string | null;
  /** What a body is called, as it is said: planned work says so ("Sports Analysis, planned"). */
  titleOf(id: string): string | null;
}

/**
 * Only a page of this site is a destination: a path from the root, never another site (a body
 * that stands for a profile elsewhere) and never a protocol-relative `//host`. Docking follows a
 * destination with the router, so an outbound href here would carry the visitor off the site.
 */
const isSitePath = (href: string): boolean => href.startsWith('/') && !href.startsWith('//');

/** Pages end with a slash (astro.config.ts); a path typed without one is the same page. */
const withSlash = (pathname: string): string =>
  pathname.endsWith('/') ? pathname : `${pathname}/`;

export function readDestinations(manifest: unknown): Destinations {
  const idByPath = new Map<string, string>();
  const hrefById = new Map<string, string>();
  const titleById = new Map<string, string>();
  const data = (typeof manifest === 'object' && manifest !== null ? manifest : {}) as {
    bodies?: unknown;
    alsoAt?: unknown;
  };

  for (const body of Array.isArray(data.bodies) ? (data.bodies as unknown[]) : []) {
    const { id, href, title, docks, planned } = (
      typeof body === 'object' && body !== null ? body : {}
    ) as {
      id?: unknown;
      href?: unknown;
      title?: unknown;
      docks?: unknown;
      planned?: unknown;
    };
    if (typeof id !== 'string') continue;
    if (typeof title === 'string') {
      // The engine's label and prompt show "Planned" after the name; spoken, it is part of it.
      titleById.set(id, planned === true ? `${title}, planned` : title);
    }
    if (typeof href !== 'string' || !isSitePath(href) || docks === false) continue;
    hrefById.set(id, href);
    idByPath.set(withSlash(href), id);
  }

  // Pages shown FROM a body that is not theirs (the projects index, from a sun). A body's own
  // page always wins, and a listing for a body that does not exist is dropped.
  if (typeof data.alsoAt === 'object' && data.alsoAt !== null) {
    for (const [path, id] of Object.entries(data.alsoAt)) {
      if (typeof id !== 'string' || !hrefById.has(id) || idByPath.has(withSlash(path))) continue;
      idByPath.set(withSlash(path), id);
    }
  }

  return {
    idFor: (pathname) => idByPath.get(withSlash(pathname)) ?? null,
    hrefOf: (id) => hrefById.get(id) ?? null,
    titleOf: (id) => titleById.get(id) ?? null,
  };
}

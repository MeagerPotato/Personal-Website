// The main navigation's "you are here" rule. Its own tiny module because two sides need it: the
// layout at build time, and (from Phase 2 W4) the router after every soft navigation.

export interface NavItem {
  label: string;
  href: string;
  /** URL prefixes for which this item counts as "where you are". */
  section: readonly string[];
}

/**
 * aria-current for a nav link: "page" on the page itself, "true" anywhere else in its section.
 *
 * These attributes are the ONE thing outside <main> and [data-page-head] that differs between
 * pages (docs/PLAN.md §5.1, "swap contract"): the router re-derives them with this function, and
 * scripts/verify-dist.mjs ignores them when it compares pages.
 */
export function navCurrent(item: NavItem, pathname: string): 'page' | 'true' | undefined {
  if (pathname === item.href) return 'page';
  return item.section.some((prefix) => pathname.startsWith(prefix)) ? 'true' : undefined;
}

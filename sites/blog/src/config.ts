/**
 * The blog's words about itself, in one place. The name is Allen's choice (2026-10-05): the blog
 * goes by its writer's name, and has no tagline (2026-10-07): the front page shows the name alone.
 */
export const site = {
  title: 'Allen Hsieh',
  /** For the feed and link previews, which need a line; no page shows it. */
  description: 'Allen Hsieh’s blog.',
  author: 'Allen',
  /** The main site, where "Allen" leads. */
  home: 'https://allenkh.com',
  /** The public contact address (the only one the repository may hold). */
  contact: 'allen@allenkh.com',
  lang: 'en',
  /** Posts on the front page before "All posts". */
  frontPageLimit: 500,
} as const;

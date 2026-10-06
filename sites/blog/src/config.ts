/**
 * The blog's words about itself, in one place. The name is Allen's choice (2026-10-05): the blog
 * goes by its writer's name. The description is still a working one: Allen's to change.
 */
export const site = {
  title: 'Allen Hsieh',
  description: 'Allen’s blog: notes on building things, and on what they teach.',
  author: 'Allen',
  /** The main site, where "Allen" leads. */
  home: 'https://allenkh.com',
  /** The public contact address (the only one the repository may hold). */
  contact: 'allen@allenkh.com',
  lang: 'en',
  /** Posts on the front page before "All posts". */
  frontPageLimit: 500,
} as const;

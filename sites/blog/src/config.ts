/**
 * The blog's words about itself, in one place. "Captain’s Log" is the working name from the main
 * site's plan (docs/PLAN.md, decision 19): Allen's to change.
 */
export const site = {
  title: 'Captain’s Log',
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

/** Site-wide constants. No phone number, ever (docs/PLAN.md decision 28). */
export const site = {
  name: 'Allen',
  url: 'https://allenkh.com',
  locale: 'en',

  socials: {
    github: 'https://github.com/MeagerPotato',
    linkedin: 'https://www.linkedin.com/in/allenkhsieh',
  },

  /** Live things worth linking before their planets exist. */
  elsewhere: {
    days2meet: 'https://days2meet.allenkh.com',
  },

  /**
   * Cloudflare Web Analytics token (public by design; it ships in the beacon snippet).
   * Empty = analytics off. Filled in Phase 0 step 9, after Allen adds the site in the dashboard.
   */
  analyticsToken: '',
} as const;

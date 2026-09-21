import { routes } from '../site/routes';

/** Site-wide constants. No phone number, ever (docs/PLAN.md decision 28). */
export const site = {
  name: 'Allen',
  url: 'https://allenkh.com',
  locale: 'en',

  /** One sentence about the site's owner, for search engines and link previews. */
  description:
    'Allen studies aerospace engineering at UC Berkeley and builds rockets, robots, and software.',
  affiliation: 'University of California, Berkeley',
  knowsAbout: [
    'Aerospace engineering',
    'Model rocketry',
    'Robotics',
    'Software engineering',
    'Cybersecurity',
  ],

  /**
   * The PUBLIC contact address, named by Allen on 2026-09-20. It is the only email address that
   * may appear anywhere in this repository or on the site.
   */
  email: 'allen@allenkh.com',

  socials: {
    github: 'https://github.com/MeagerPotato',
    linkedin: 'https://www.linkedin.com/in/allenkhsieh',
  },

  /**
   * The main navigation, identical on every page. `section` lists the URL prefixes for which the
   * item counts as "where you are" (a project page lights up Projects).
   */
  nav: [
    { label: 'About', href: routes.page('about'), section: [routes.page('about')] },
    { label: 'Projects', href: routes.projects(), section: [routes.projects(), '/systems/'] },
    { label: 'Resume', href: routes.page('resume'), section: [routes.page('resume')] },
    { label: 'Contact', href: routes.page('contact'), section: [routes.page('contact')] },
  ],

  /**
   * Cloudflare Web Analytics token (public by design; it ships in the beacon snippet).
   * Empty = analytics off. Filled in Phase 0 step 9, after Allen adds the site in the dashboard.
   */
  analyticsToken: '',
} as const;

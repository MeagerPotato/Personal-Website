import { describe, expect, it } from 'vitest';
import { readDestinations } from './destinations';

const MANIFEST = {
  version: 2,
  bodies: [
    { id: 'page/about', href: '/about/', kind: 'home' },
    { id: 'system/code', href: '/systems/code/', kind: 'sun' },
    { id: 'project/fishai', href: '/projects/fishai/', kind: 'planet', title: 'FishAI' },
  ],
  alsoAt: { '/projects/': 'system/code' },
};

describe('destinations', () => {
  it('finds the body of a page, and the page of a body', () => {
    const destinations = readDestinations(MANIFEST);
    expect(destinations.idFor('/projects/fishai/')).toBe('project/fishai');
    expect(destinations.hrefOf('project/fishai')).toBe('/projects/fishai/');
    expect(destinations.idFor('/')).toBeNull();
    expect(destinations.idFor('/nowhere/')).toBeNull();
    expect(destinations.hrefOf('project/unknown')).toBeNull();
  });

  it('knows what a body is called, when the galaxy says so', () => {
    const destinations = readDestinations(MANIFEST);
    expect(destinations.titleOf('project/fishai')).toBe('FishAI');
    expect(destinations.titleOf('system/code')).toBeNull();
    expect(destinations.titleOf('project/unknown')).toBeNull();
  });

  it('says that planned work is planned, as part of its name, and nothing else', () => {
    const destinations = readDestinations({
      bodies: [
        {
          id: 'project/sports',
          href: '/projects/sports/',
          title: 'Sports Analysis',
          planned: true,
        },
        { id: 'project/odd', href: '/projects/odd/', title: 'Odd', planned: 'yes' },
      ],
    });
    expect(destinations.titleOf('project/sports')).toBe('Sports Analysis, planned');
    expect(destinations.titleOf('project/odd')).toBe('Odd');
    // Its page is its page all the same.
    expect(destinations.idFor('/projects/sports/')).toBe('project/sports');
  });

  it('shows a listed page from the body it is listed at, which still opens its OWN page', () => {
    const destinations = readDestinations(MANIFEST);
    expect(destinations.idFor('/projects/')).toBe('system/code');
    expect(destinations.hrefOf('system/code')).toBe('/systems/code/');
  });

  it('never makes a destination of another site: a body standing for a profile elsewhere', () => {
    const destinations = readDestinations({
      bodies: [
        {
          id: 'link/github',
          href: 'https://github.com/MeagerPotato',
          title: 'GitHub',
          docks: false,
        },
        { id: 'link/odd', href: '//elsewhere.example/x/', title: 'Odd' },
        { id: 'page/about', href: '/about/', title: 'About', docks: false },
      ],
    });
    expect(destinations.hrefOf('link/github')).toBeNull();
    expect(destinations.hrefOf('link/odd')).toBeNull();
    expect(destinations.idFor('/MeagerPotato/')).toBeNull();
    expect(destinations.idFor('/x/')).toBeNull();
    // A body that says it cannot be docked at is no destination either, wherever it points.
    expect(destinations.idFor('/about/')).toBeNull();
    // Its name is still known, for whatever announces it.
    expect(destinations.titleOf('link/github')).toBe('GitHub');
  });

  it('treats a path without its slash as the same page', () => {
    const destinations = readDestinations(MANIFEST);
    expect(destinations.idFor('/about')).toBe('page/about');
    expect(destinations.idFor('/projects')).toBe('system/code');
  });

  it('never lets a listing take over a body’s own page, or point at a body that is not there', () => {
    const destinations = readDestinations({
      ...MANIFEST,
      alsoAt: { '/about/': 'system/code', '/log/': 'station/log', '/projects/': 7 },
    });
    expect(destinations.idFor('/about/')).toBe('page/about');
    expect(destinations.idFor('/log/')).toBeNull();
    expect(destinations.idFor('/projects/')).toBeNull();
  });

  it('reads anything at all without throwing: what it cannot use, it does not have', () => {
    for (const rubbish of [null, undefined, 'html', 42, [], {}, { bodies: 'none' }]) {
      const destinations = readDestinations(rubbish);
      expect(destinations.idFor('/about/')).toBeNull();
      expect(destinations.hrefOf('page/about')).toBeNull();
    }
    const partly = readDestinations({ bodies: [null, 'x', { id: 'a' }, { id: 'b', href: '/b/' }] });
    expect(partly.idFor('/b/')).toBe('b');
    expect(partly.hrefOf('a')).toBeNull();
  });
});

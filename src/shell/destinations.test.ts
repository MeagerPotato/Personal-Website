import { describe, expect, it } from 'vitest';
import { readDestinations } from './destinations';

const MANIFEST = {
  version: 1,
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

  it('shows a listed page from the body it is listed at, which still opens its OWN page', () => {
    const destinations = readDestinations(MANIFEST);
    expect(destinations.idFor('/projects/')).toBe('system/code');
    expect(destinations.hrefOf('system/code')).toBe('/systems/code/');
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

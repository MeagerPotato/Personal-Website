import { describe, expect, it } from 'vitest';
import { site } from '../config/site';
import { navCurrent } from './nav';

const item = (label: string) => {
  const found = site.nav.find((entry) => entry.label === label);
  if (!found) throw new Error(`no nav item called ${label}`);
  return found;
};

describe('navCurrent', () => {
  it('marks the page itself as aria-current="page"', () => {
    expect(navCurrent(item('About'), '/about/')).toBe('page');
    expect(navCurrent(item('Projects'), '/projects/')).toBe('page');
  });

  it('marks the section for pages inside it: a project or a system lights up Projects', () => {
    expect(navCurrent(item('Projects'), '/projects/fishai/')).toBe('true');
    expect(navCurrent(item('Projects'), '/systems/code/')).toBe('true');
  });

  it('marks nothing elsewhere, and nothing at all on the home page', () => {
    expect(navCurrent(item('Projects'), '/about/')).toBeUndefined();
    expect(navCurrent(item('About'), '/about-something-else/')).toBeUndefined();
    for (const entry of site.nav) expect(navCurrent(entry, '/')).toBeUndefined();
  });

  it('never marks two items for one URL', () => {
    for (const pathname of ['/about/', '/projects/x/', '/systems/x/', '/resume/', '/contact/']) {
      const current = site.nav.filter((entry) => navCurrent(entry, pathname) !== undefined);
      expect(current).toHaveLength(1);
    }
  });
});

describe('site.nav', () => {
  it('links to pages with trailing slashes (Cloudflare would 307 without)', () => {
    for (const entry of site.nav) expect(entry.href).toMatch(/^\/.*\/$/);
  });
});

import { describe, expect, it } from 'vitest';
import { site } from '../config/site';
import { PROFILE, profiles, type ProfileKey } from './profiles';

describe('profiles', () => {
  it('lists only the networks with a URL, in slot order', () => {
    const listed = profiles({
      linkedin: 'https://www.linkedin.com/in/someone',
      github: 'https://github.com/someone',
    });
    expect(listed).toEqual([
      {
        key: 'github',
        label: 'GitHub',
        note: 'where the projects live',
        href: 'https://github.com/someone',
        host: 'github.com',
        slot: 2,
      },
      {
        key: 'linkedin',
        label: 'LinkedIn',
        note: 'the formal version',
        href: 'https://www.linkedin.com/in/someone',
        host: 'linkedin.com',
        slot: 4,
      },
    ]);
  });

  it('shows nothing of Devpost until it has a URL, and then only that line changes', () => {
    expect(profiles(site.socials).map(({ key }) => key)).not.toContain('devpost');
    const before = profiles(site.socials);
    const after = profiles({ ...site.socials, devpost: 'https://devpost.com/someone' });
    expect(after.map(({ key }) => key)).toEqual(['github', 'linkedin', 'devpost']);
    expect(after.slice(0, before.length)).toEqual(before);
  });

  it("knows the site's own networks: GitHub and LinkedIn", () => {
    expect(profiles(site.socials).map(({ label, href }) => [label, href])).toEqual([
      ['GitHub', site.socials.github],
      ['LinkedIn', site.socials.linkedin],
    ]);
  });

  it('gives every network its own slot on the ring, never the satellite', () => {
    const slots = Object.values(PROFILE).map(({ slot }) => slot);
    expect(new Set(slots).size).toBe(slots.length);
    for (const slot of slots) {
      expect(Number.isInteger(slot)).toBe(true);
      expect(slot).toBeGreaterThanOrEqual(1);
      expect(slot).toBeLessThanOrEqual(7);
    }
  });

  it('refuses a URL that is not https', () => {
    expect(() => profiles({ github: 'http://github.com/someone' })).toThrow(/https/);
    expect(() => profiles({ github: 'github.com/someone' })).toThrow(/not a URL/);
  });

  it('only takes the networks it knows', () => {
    const socials: Partial<Record<ProfileKey, string>> = {
      // @ts-expect-error: a network this site does not know is a type error, not a silent no-op.
      myspace: 'https://myspace.com/someone',
    };
    expect(profiles(socials)).toEqual([]);
  });
});

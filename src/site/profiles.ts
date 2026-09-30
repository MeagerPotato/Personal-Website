/**
 * ALLEN ELSEWHERE: the networks this site knows how to show. The URLs live in one place,
 * `site.socials` (src/config/site.ts); a network with no URL there shows nowhere: not on the home
 * page, not on the contact page, not in the universe, not in the structured data. Adding one is
 * that one line (AGENTS.md, "Add a profile").
 *
 * `slot` is where its relay circles in the home system: on the Contact satellite's ring, `slot`
 * steps of 45 degrees ahead of the satellite, which is slot 0 (data/build.ts). NEVER renumber a
 * slot: it is where the relay is, and a returning visitor's sky would rearrange itself. A new
 * network takes a free slot, 1 to 7.
 *
 * `note` is what the home page says after the name. The resume does not read this file: it keeps
 * its own two links, so a new network never changes the resume, its print or its PDF.
 */
export const PROFILE = {
  github: { label: 'GitHub', note: 'where the projects live', slot: 2 },
  linkedin: { label: 'LinkedIn', note: 'the formal version', slot: 4 },
  devpost: { label: 'Devpost', note: 'hackathon builds', slot: 6 },
} as const;

export type ProfileKey = keyof typeof PROFILE;

export interface Profile {
  key: ProfileKey;
  label: string;
  note: string;
  href: string;
  slot: number;
}

/**
 * The configured profiles, in slot order: what the home page, the contact page, the structured
 * data and the universe list. A URL that is not https is a mistake in the config, and fails the
 * build here rather than reach a page.
 */
export function profiles(socials: Readonly<Partial<Record<ProfileKey, string>>>): Profile[] {
  const out: Profile[] = [];
  for (const key of Object.keys(PROFILE) as ProfileKey[]) {
    const href = socials[key];
    if (href === undefined) continue;
    let url: URL;
    try {
      url = new URL(href);
    } catch {
      throw new Error(`site.socials.${key}: "${href}" is not a URL`);
    }
    if (url.protocol !== 'https:') {
      throw new Error(`site.socials.${key}: "${href}" must be an https URL`);
    }
    const { label, note, slot } = PROFILE[key];
    out.push({ key, label, note, href, slot });
  }
  return out.sort((a, b) => a.slot - b.slot);
}

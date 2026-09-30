/** A tag's colour family. Pure, so the studio shows a new tag in the colour it will get. */

export const FAMILIES = ['coral', 'butter', 'mint', 'sky', 'lilac'] as const;
export type Family = (typeof FAMILIES)[number];

/** A tag's colour when it is first made: the same name always gets the same family. */
export function familyFor(slug: string): Family {
  let hash = 0;
  for (const char of slug) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return FAMILIES[hash % FAMILIES.length] ?? 'sky';
}

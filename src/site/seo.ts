import { site } from '../config/site';

// What search engines and link previews read. Plain functions, so the wording is tested once and
// every page says it the same way.

/** "FishAI · Allen". The home page writes its own title in full. */
export const pageTitle = (title: string): string => `${title} · ${site.name}`;

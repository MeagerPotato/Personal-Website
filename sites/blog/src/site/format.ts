/** How the pages (and the studio) write dates and lengths. Pure: no server code comes with it. */

/** Allen's clock: a post's date is the day it was on where it was written. */
export const TIME_ZONE = 'America/Los_Angeles';

const long = new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: TIME_ZONE });
const short = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: TIME_ZONE });

/** "September 30, 2026" */
export const longDate = (time: number): string => long.format(time);
/** "Sep 30, 2026" */
export const shortDate = (time: number): string => short.format(time);
/** "2026-09-30", for <time datetime>, on the same clock. */
export function isoDate(time: number): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: TIME_ZONE,
    })
      .formatToParts(time)
      .map((part) => [part.type, part.value]),
  );
  return `${parts['year']}-${parts['month']}-${parts['day']}`;
}

/** Reading speed for "5 min read". */
export const WORDS_PER_MINUTE = 220;
export const readingMinutes = (words: number): number =>
  Math.max(1, Math.round(words / WORDS_PER_MINUTE));

/** "4 min read" */
export const readingTime = (words: number): string => `${readingMinutes(words)} min read`;

/** A page's <title>: "Post title · Allen Hsieh", or the blog's name alone. */
export const pageTitle = (title: string | null, blog: string): string =>
  title ? `${title} · ${blog}` : blog;

/**
 * Calendar arithmetic on the journal's own dates: 'YYYY-MM-DD' strings with no time zone. A day
 * is the day you lived, wherever you were; so every calculation runs on UTC midnights, where
 * there is no daylight saving to add or lose an hour.
 */

const MS_PER_DAY = 86_400_000;

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

function parse(date: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

const format = (value: Date): string =>
  `${pad(value.getUTCFullYear(), 4)}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;

/** Today on this device's clock, in its time zone. */
export function today(now = new Date()): string {
  return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export const addDays = (date: string, days: number): string =>
  format(new Date(parse(date).getTime() + days * MS_PER_DAY));

/** Whole days from a to b (b later: positive). */
export const daysBetween = (a: string, b: string): number =>
  Math.round((parse(b).getTime() - parse(a).getTime()) / MS_PER_DAY);

export const monthOf = (date: string): string => date.slice(0, 7);

export function addMonths(month: string, months: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const index = y * 12 + (m - 1) + months;
  return `${pad(Math.floor(index / 12), 4)}-${pad((index % 12) + 1)}`;
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Every date of a month, in order. */
export function datesOf(month: string): string[] {
  return Array.from({ length: daysInMonth(month) }, (_, i) => `${month}-${pad(i + 1)}`);
}

/** 0 Sunday … 6 Saturday. */
export const weekday = (date: string): number => parse(date).getUTCDay();

/**
 * A month as calendar rows: weeks of seven, starting on `weekStart` (0 Sunday, 1 Monday), with
 * null for the days that belong to the months either side.
 */
export function monthGrid(month: string, weekStart: 0 | 1): (string | null)[][] {
  const dates = datesOf(month);
  const lead = (weekday(dates[0] as string) - weekStart + 7) % 7;
  const cells: (string | null)[] = [...Array<null>(lead).fill(null), ...dates];
  while (cells.length % 7 !== 0) cells.push(null);
  const rows: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}

/** The weekday names in calendar order, short ("Mon") or long. */
export function weekdayNames(weekStart: 0 | 1, style: 'short' | 'narrow' | 'long' = 'short') {
  const formatter = new Intl.DateTimeFormat(undefined, { weekday: style, timeZone: 'UTC' });
  // 2023-01-01 was a Sunday.
  return Array.from({ length: 7 }, (_, i) =>
    formatter.format(parse(`2023-01-${pad(1 + ((i + weekStart) % 7))}`)),
  );
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify(options);
  let found = formatters.get(key);
  if (!found) {
    found = new Intl.DateTimeFormat(undefined, { ...options, timeZone: 'UTC' });
    formatters.set(key, found);
  }
  return found;
}

/** "Tuesday, September 29", with the year only when it is not this year's. */
export function longDate(date: string, current = today()): string {
  const sameYear = date.slice(0, 4) === current.slice(0, 4);
  return formatter({
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(parse(date));
}

/** "Sep 29", or "Sep 29, 2025" for another year. */
export function shortDate(date: string, current = today()): string {
  const sameYear = date.slice(0, 4) === current.slice(0, 4);
  return formatter({
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(parse(date));
}

/** "September 2026". */
export const monthName = (month: string, style: 'long' | 'short' = 'long'): string =>
  formatter({ month: style, year: 'numeric' }).format(parse(`${month}-01`));

/** "Today", "Yesterday", "Tomorrow", or null. */
export function relativeDay(date: string, current = today()): string | null {
  const gap = daysBetween(current, date);
  if (gap === 0) return 'Today';
  if (gap === -1) return 'Yesterday';
  if (gap === 1) return 'Tomorrow';
  return null;
}

/**
 * Patterns in the journal: the numbers behind the Stats page and a month's snapshot. Pure
 * functions of the days (the journal never leaves the device, so neither do these).
 */
import { wordCount } from '@allenkh/editor/text';
import { addDays, daysBetween, datesOf, monthOf, today } from './dates';
import type { Activity, Activities, Day, Photo, Song } from './types';

export { plainText, wordCount } from '@allenkh/editor/text';

/** Whether a day holds anything at all. */
export const hasEntry = (day: Day): boolean =>
  day.mood !== null ||
  day.activities.length > 0 ||
  day.photos.length > 0 ||
  day.song !== null ||
  wordCount(day.note) > 0;

export interface MonthSummary {
  month: string;
  /** Days with anything written, ticked or picked. */
  entries: number;
  /** Count per mood value, 1 … 5. */
  moods: Record<number, number>;
  /** Mean of the days with a mood, or null. */
  averageMood: number | null;
  /** The mood picked most often (ties: the better one). */
  topMood: number | null;
  /** Activities by how often they were ticked. */
  topActivities: { id: string; count: number }[];
  highlights: Day[];
  photos: { date: string; photo: Photo }[];
  songs: { date: string; song: Song }[];
  words: number;
  longestStreak: number;
}

export function monthSummary(days: readonly Day[], month: string): MonthSummary {
  const inMonth = days
    .filter((day) => monthOf(day.date) === month && hasEntry(day))
    .sort((a, b) => a.date.localeCompare(b.date));
  const moods: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let moodSum = 0;
  let moodDays = 0;
  const activityCounts = new Map<string, number>();
  let words = 0;
  for (const day of inMonth) {
    if (day.mood !== null) {
      moods[day.mood] = (moods[day.mood] ?? 0) + 1;
      moodSum += day.mood;
      moodDays += 1;
    }
    for (const id of new Set(day.activities)) {
      activityCounts.set(id, (activityCounts.get(id) ?? 0) + 1);
    }
    words += wordCount(day.note);
  }
  let topMood: number | null = null;
  for (let mood = 5; mood >= 1; mood -= 1) {
    if (
      (moods[mood] ?? 0) > 0 &&
      (topMood === null || (moods[mood] ?? 0) > (moods[topMood] ?? 0))
    ) {
      topMood = mood;
    }
  }
  return {
    month,
    entries: inMonth.length,
    moods,
    averageMood: moodDays > 0 ? moodSum / moodDays : null,
    topMood,
    topActivities: [...activityCounts]
      .map(([id, count]) => ({ id, count }))
      .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id)),
    highlights: inMonth.filter((day) => day.highlight),
    photos: inMonth.flatMap((day) => day.photos.map((photo) => ({ date: day.date, photo }))),
    songs: inMonth.flatMap((day) => (day.song ? [{ date: day.date, song: day.song }] : [])),
    words,
    longestStreak: longestRun(inMonth.map((day) => day.date)),
  };
}

/** The longest run of consecutive dates in a sorted, de-duplicated list. */
function longestRun(dates: readonly string[]): number {
  let best = 0;
  let run = 0;
  let previous: string | null = null;
  for (const date of dates) {
    run = previous !== null && daysBetween(previous, date) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    previous = date;
  }
  return best;
}

export interface Streaks {
  /** Days in a row with an entry, ending today (or yesterday: today may not be written yet). */
  current: number;
  longest: number;
  total: number;
}

export function streaks(days: readonly Day[], current = today()): Streaks {
  const dates = [...new Set(days.filter(hasEntry).map((day) => day.date))]
    .filter((date) => date <= current)
    .sort();
  const written = new Set(dates);
  let run = 0;
  let cursor = written.has(current) ? current : addDays(current, -1);
  while (written.has(cursor)) {
    run += 1;
    cursor = addDays(cursor, -1);
  }
  return { current: run, longest: longestRun(dates), total: dates.length };
}

/** Mood by date between two dates (inclusive), null where none was picked. */
export function moodSeries(
  days: readonly Day[],
  from: string,
  to: string,
): { date: string; mood: number | null }[] {
  const byDate = new Map(days.map((day) => [day.date, day.mood]));
  const out: { date: string; mood: number | null }[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    out.push({ date, mood: byDate.get(date) ?? null });
  }
  return out;
}

/** A year as pixels: every date of the year and its mood. */
export function yearInPixels(days: readonly Day[], year: number): Map<string, number | null> {
  const out = new Map<string, number | null>();
  const byDate = new Map(days.map((day) => [day.date, day.mood]));
  for (let month = 1; month <= 12; month += 1) {
    for (const date of datesOf(`${year}-${String(month).padStart(2, '0')}`)) {
      out.set(date, byDate.get(date) ?? null);
    }
  }
  return out;
}

export interface ActivityImpact {
  activity: Activity;
  /** Days it was ticked. */
  count: number;
  /** Mean mood on days with it, and on days (with a mood) without it. */
  withMood: number | null;
  withoutMood: number | null;
  /** withMood − withoutMood, or null when either is unknown. */
  lift: number | null;
}

/**
 * How each activity goes with your mood: the mean mood on days you ticked it against the days
 * you did not. A pattern, not a cause; the page says so.
 */
export function activityImpact(days: readonly Day[], activities: Activities): ActivityImpact[] {
  const withMood = days.filter((day) => day.mood !== null);
  const total = withMood.reduce((sum, day) => sum + (day.mood as number), 0);
  const out: ActivityImpact[] = [];
  for (const group of activities.groups) {
    for (const activity of group.items) {
      const ticked = days.filter((day) => day.activities.includes(activity.id));
      const tickedWithMood = ticked.filter((day) => day.mood !== null);
      const sumWith = tickedWithMood.reduce((sum, day) => sum + (day.mood as number), 0);
      const withoutCount = withMood.length - tickedWithMood.length;
      const meanWith = tickedWithMood.length > 0 ? sumWith / tickedWithMood.length : null;
      const meanWithout = withoutCount > 0 ? (total - sumWith) / withoutCount : null;
      if (ticked.length === 0) continue;
      out.push({
        activity,
        count: ticked.length,
        withMood: meanWith,
        withoutMood: meanWithout,
        lift: meanWith !== null && meanWithout !== null ? meanWith - meanWithout : null,
      });
    }
  }
  return out.sort((a, b) => b.count - a.count);
}

/**
 * The activities used most in the `window` days before `date`, most used first, at most `count`
 * of them, ties in their own order; archived ones, and ids no longer defined, are left out. With
 * the day's own, they are what its folded activity picker offers. The day itself never counts,
 * so picking on it leaves the list as it was.
 */
export function usualActivities(
  days: readonly Day[],
  activities: Activities,
  date: string,
  { window = 60, count = 8 } = {},
): string[] {
  const since = addDays(date, -window);
  const uses = new Map<string, number>();
  for (const day of days) {
    if (day.date < since || day.date >= date) continue;
    for (const id of day.activities) uses.set(id, (uses.get(id) ?? 0) + 1);
  }
  return activities.groups
    .flatMap((group) => group.items.filter((item) => !item.archived && uses.has(item.id)))
    .map((item) => item.id)
    .sort((a, b) => (uses.get(b) ?? 0) - (uses.get(a) ?? 0))
    .slice(0, count);
}

/** Days a person or place appears on, newest first. */
export const daysWith = (days: readonly Day[], id: string, field: 'people' | 'places'): Day[] =>
  days.filter((day) => day[field].includes(id)).sort((a, b) => b.date.localeCompare(a.date));

/** This day in earlier years ("On this day"). */
export function onThisDay(days: readonly Day[], date: string): Day[] {
  const monthDay = date.slice(5);
  return days
    .filter((day) => day.date.slice(5) === monthDay && day.date < date && hasEntry(day))
    .sort((a, b) => b.date.localeCompare(a.date));
}

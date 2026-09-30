import { describe, expect, it } from 'vitest';
import { dateToTime } from '../server/posts';
import { isoDate, longDate, pageTitle, readingTime, shortDate } from './format';

describe('format', () => {
  it('writes a chosen date as that day, wherever the Worker runs', () => {
    const time = dateToTime('2026-09-30');
    expect(longDate(time)).toBe('September 30, 2026');
    expect(shortDate(time)).toBe('Sep 30, 2026');
    expect(isoDate(time)).toBe('2026-09-30');
  });

  it('writes a publishing moment on Allen’s clock, not UTC’s', () => {
    // 9 pm in Berkeley is already the next day in UTC.
    const evening = Date.parse('2026-10-01T04:00:00Z');
    expect(isoDate(evening)).toBe('2026-09-30');
    expect(longDate(evening)).toBe('September 30, 2026');
  });

  it('rounds reading time, never to zero', () => {
    expect(readingTime(0)).toBe('1 min read');
    expect(readingTime(1100)).toBe('5 min read');
  });

  it('names the page, then the blog', () => {
    expect(pageTitle('First light', 'Captain’s Log')).toBe('First light · Captain’s Log');
    expect(pageTitle(null, 'Captain’s Log')).toBe('Captain’s Log');
  });
});

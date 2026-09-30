import { describe, expect, it } from 'vitest';
import { blankDay } from './records';
import { usualActivities } from './stats';
import type { Activities, Day } from './types';

const activities: Activities = {
  v: 1,
  createdAt: 0,
  updatedAt: 0,
  kind: 'activities',
  groups: [
    {
      id: 'feelings',
      name: 'Feelings',
      items: [
        { id: 'happy', name: 'happy', icon: '😊', archived: false },
        { id: 'tired', name: 'tired', icon: '🥱', archived: false },
      ],
    },
    {
      id: 'making',
      name: 'Making',
      items: [
        { id: 'coding', name: 'coding', icon: '💻', archived: false },
        { id: 'rocketry', name: 'rocketry', icon: '🚀', archived: false },
        { id: 'knitting', name: 'knitting', icon: '🧶', archived: true },
      ],
    },
  ],
};

const day = (date: string, ids: string[]): Day => ({ ...blankDay(date), activities: ids });

describe('the usual activities', () => {
  it('are the ones used most lately, ties in their own order', () => {
    const days = [
      day('2026-09-28', ['coding', 'tired']),
      day('2026-09-29', ['coding', 'happy']),
      day('2026-09-30', ['rocketry', 'tired', 'coding']),
    ];
    expect(usualActivities(days, activities, '2026-10-01')).toEqual([
      'coding',
      'tired',
      'happy',
      'rocketry',
    ]);
    expect(usualActivities(days, activities, '2026-10-01', { count: 2 })).toEqual([
      'coding',
      'tired',
    ]);
  });

  it('count only the days in the window before the day, never the day itself', () => {
    const days = [
      day('2026-07-01', ['happy', 'happy']),
      day('2026-09-01', ['tired']),
      day('2026-09-30', ['coding']),
      day('2026-10-02', ['rocketry']),
    ];
    expect(usualActivities(days, activities, '2026-09-30', { window: 60 })).toEqual(['tired']);
  });

  it('leave out what is archived or no longer defined', () => {
    const days = [day('2026-09-30', ['knitting', 'gone', 'happy'])];
    expect(usualActivities(days, activities, '2026-10-01')).toEqual(['happy']);
  });

  it('are none in a new journal', () => {
    expect(usualActivities([], activities, '2026-09-30')).toEqual([]);
  });
});

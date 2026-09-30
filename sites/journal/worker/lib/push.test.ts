import { describe, expect, it } from 'vitest';
import { due, isTimeZone, lastSentWhenSet, localNow, type Reminder } from './push';

const at = (iso: string) => new Date(iso);
const reminder = (patch: Partial<Reminder> = {}): Reminder => ({
  endpoint: 'https://push.example.test/device',
  remindAt: '21:00',
  timeZone: 'America/Los_Angeles',
  lastSent: null,
  ...patch,
});

describe('localNow', () => {
  it('reads the wall clock in a zone, summer time included', () => {
    // 2031-03-11 04:00 UTC is 21:00 on the 10th in California (PDT, since the 9th).
    expect(localNow(at('2031-03-11T04:00:00Z'), 'America/Los_Angeles')).toEqual({
      date: '2031-03-10',
      time: '21:00',
    });
    // The same instant is already the 11th in Taipei.
    expect(localNow(at('2031-03-11T04:00:00Z'), 'Asia/Taipei')).toEqual({
      date: '2031-03-11',
      time: '12:00',
    });
  });

  it('writes midnight as 00, never 24', () => {
    expect(localNow(at('2031-03-11T00:00:00Z'), 'UTC').time).toBe('00:00');
  });
});

describe('isTimeZone', () => {
  it('knows real zones, and nothing else', () => {
    expect(isTimeZone('America/Los_Angeles')).toBe(true);
    expect(isTimeZone('UTC')).toBe(true);
    expect(isTimeZone('Mars/Olympus_Mons')).toBe(false);
  });
});

describe('due', () => {
  it('is not due before its time', () => {
    expect(due(reminder(), at('2031-03-11T03:59:00Z'), null)).toEqual({
      due: false,
      date: '2031-03-10',
    });
  });

  it('is due from its time on, once a day', () => {
    expect(due(reminder(), at('2031-03-11T04:00:00Z'), null).due).toBe(true);
    expect(due(reminder(), at('2031-03-11T06:30:00Z'), null).due).toBe(true);
    const sent = reminder({ lastSent: '2031-03-10' });
    expect(due(sent, at('2031-03-11T06:30:00Z'), null).due).toBe(false);
    // The next evening, again.
    expect(due(sent, at('2031-03-12T04:00:00Z'), null).due).toBe(true);
  });

  it('skips a day that is already written', () => {
    expect(due(reminder(), at('2031-03-11T04:00:00Z'), '2031-03-10').due).toBe(false);
    expect(due(reminder(), at('2031-03-12T04:00:00Z'), '2031-03-10').due).toBe(true);
  });
});

describe('lastSentWhenSet', () => {
  it('starts tomorrow when the time has already passed today', () => {
    expect(lastSentWhenSet('21:00', 'UTC', at('2031-03-10T22:00:00Z'), null)).toBe('2031-03-10');
  });

  it('still reminds today when the time is still to come', () => {
    expect(lastSentWhenSet('21:00', 'UTC', at('2031-03-10T20:00:00Z'), null)).toBe(null);
    expect(lastSentWhenSet('21:00', 'UTC', at('2031-03-10T20:00:00Z'), '2031-03-09')).toBe(
      '2031-03-09',
    );
  });

  it('never reminds twice in a day, even when the time moves later', () => {
    expect(lastSentWhenSet('23:00', 'UTC', at('2031-03-10T22:00:00Z'), '2031-03-10')).toBe(
      '2031-03-10',
    );
  });
});

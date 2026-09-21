// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { countsAsVisit, startAnalytics, type AnalyticsOptions } from './analytics';

const VISIT: AnalyticsOptions = {
  token: '0123456789abcdef0123456789abcdef',
  countedHost: 'allenkh.com',
  hostname: 'allenkh.com',
  privacy: {},
};

const beacons = (): HTMLScriptElement[] => [
  ...document.querySelectorAll<HTMLScriptElement>('script[data-cf-beacon]'),
];

afterEach(() => {
  for (const script of beacons()) script.remove();
});

describe('analytics', () => {
  it('adds the beacon the way Cloudflare writes it, once', () => {
    expect(startAnalytics(VISIT)).toBe(true);
    expect(startAnalytics(VISIT)).toBe(true);
    const [script, ...others] = beacons();
    expect(others).toEqual([]);
    expect(script?.src).toBe('https://static.cloudflareinsights.com/beacon.min.js');
    expect(script?.defer).toBe(true);
    expect(JSON.parse(script?.getAttribute('data-cf-beacon') ?? '')).toEqual({
      token: VISIT.token,
    });
    expect(script?.parentElement).toBe(document.head);
  });

  it('is off until there is a token', () => {
    expect(startAnalytics({ ...VISIT, token: '' })).toBe(false);
    expect(beacons()).toEqual([]);
  });

  it('counts the real site only: no preview, no localhost, no other subdomain', () => {
    for (const hostname of [
      'localhost',
      '127.0.0.1',
      'claude-p2-e2e-allenkh-com.example.workers.dev',
      'www.allenkh.com',
      'days2meet.allenkh.com',
    ]) {
      expect(countsAsVisit({ ...VISIT, hostname }), hostname).toBe(false);
    }
    expect(countsAsVisit(VISIT)).toBe(true);
  });

  it('leaves alone a visitor whose browser asks not to be tracked', () => {
    expect(countsAsVisit({ ...VISIT, privacy: { globalPrivacyControl: true } })).toBe(false);
    expect(countsAsVisit({ ...VISIT, privacy: { doNotTrack: '1' } })).toBe(false);
    // "0", "unspecified" and nothing at all are not a request.
    expect(countsAsVisit({ ...VISIT, privacy: { doNotTrack: '0' } })).toBe(true);
    expect(countsAsVisit({ ...VISIT, privacy: { doNotTrack: null } })).toBe(true);
    expect(countsAsVisit({ ...VISIT, privacy: { globalPrivacyControl: false } })).toBe(true);
    expect(startAnalytics({ ...VISIT, privacy: { globalPrivacyControl: true } })).toBe(false);
    expect(beacons()).toEqual([]);
  });
});

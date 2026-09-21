import { describe, expect, it } from 'vitest';
import { asTier, recallTier, rememberTier } from './quality-memory';

function fakeStore(): { store: () => Storage; items: Map<string, string> } {
  const items = new Map<string, string>();
  const storage = {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  } as Storage;
  return { store: () => storage, items };
}

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

describe('quality memory', () => {
  it('knows a tier when it sees one', () => {
    expect(asTier('low')).toBe('low');
    expect(asTier('ultra')).toBeUndefined();
    expect(asTier(null)).toBeUndefined();
  });

  it('recalls what it was told, for a week', () => {
    const { store } = fakeStore();
    expect(recallTier(store, NOW)).toBeUndefined();
    rememberTier(store, 'low', NOW);
    expect(recallTier(store, NOW + 1000)).toBe('low');
    expect(recallTier(store, NOW + 6 * DAY)).toBe('low');
    rememberTier(store, 'medium', NOW);
    expect(recallTier(store, NOW + 1000)).toBe('medium');
  });

  it('forgets after a week, and clears up after itself', () => {
    const { store, items } = fakeStore();
    rememberTier(store, 'low', NOW);
    expect(recallTier(store, NOW + 8 * DAY)).toBeUndefined();
    expect(items.size).toBe(0);
  });

  it('does not trust what it cannot read: nonsense, no date, a date in the future', () => {
    for (const value of ['ultra@1', 'low', 'low@soon', `low@${NOW + DAY}`, '']) {
      const { store, items } = fakeStore();
      items.set('quality', value);
      expect(recallTier(store, NOW)).toBeUndefined();
      expect(items.size).toBe(0);
    }
  });

  it('shrugs when storage is blocked', () => {
    const blocked = (): Storage => {
      throw new Error('SecurityError');
    };
    expect(() => rememberTier(blocked, 'low', NOW)).not.toThrow();
    expect(recallTier(blocked, NOW)).toBeUndefined();
  });
});

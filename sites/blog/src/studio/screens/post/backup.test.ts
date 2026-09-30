import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { blankDraft, type Draft } from '../../../server/posts';
import { dropBackup, findBackup, keepBackup, sameDraft } from './backup';

/** The browser's storage for the site, as a Map. */
function fakeStorage() {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

const KEY = 'studio:unsaved:p_12345678';
const ID = 'p_12345678';
const written = (title: string): Draft => ({ ...blankDraft(), title, tags: ['Rockets'] });

let storage: ReturnType<typeof fakeStorage>;

beforeEach(() => {
  storage = fakeStorage();
  vi.stubGlobal('localStorage', storage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the copy on this device', () => {
  it('keeps the writing, the version it was done over, and when', () => {
    keepBackup(ID, 3, written('First flight'), 1_000);
    expect(findBackup(ID)).toEqual({
      rev: 3,
      draft: written('First flight'),
      at: 1_000,
      tab: expect.any(String),
    });
    expect(findBackup('p_other000')).toBeNull();
  });

  it('goes once this tab no longer needs it', () => {
    keepBackup(ID, 3, written('First flight'));
    dropBackup(ID);
    expect(storage.items.has(KEY)).toBe(false);
  });

  it('is left alone when another tab kept it last, unless its post is gone', () => {
    keepBackup(ID, 3, written('First flight'));
    const theirs = { ...JSON.parse(storage.items.get(KEY) ?? '{}'), tab: 'another tab' };
    storage.setItem(KEY, JSON.stringify(theirs));
    dropBackup(ID);
    expect(findBackup(ID)?.tab).toBe('another tab');
    dropBackup(ID, { anyTab: true });
    expect(findBackup(ID)).toBeNull();
  });

  it('is ignored when it cannot be read as a draft', () => {
    const cases = [
      'not json',
      JSON.stringify({ rev: 1, at: 1, tab: 't', draft: { title: 'No other fields' } }),
      JSON.stringify({ rev: '1', at: 1, tab: 't', draft: written('Rev as text') }),
      JSON.stringify({ rev: 1, at: 1, tab: 't', draft: { ...written('Tags'), tags: [1] } }),
      JSON.stringify(null),
    ];
    for (const value of cases) {
      storage.setItem(KEY, value);
      expect(findBackup(ID)).toBeNull();
    }
  });

  it('costs nothing where the storage is full or refused', () => {
    storage.setItem = () => {
      throw new DOMException('Full', 'QuotaExceededError');
    };
    expect(() => keepBackup(ID, 3, written('First flight'))).not.toThrow();
    vi.stubGlobal('localStorage', undefined);
    expect(() => keepBackup(ID, 3, written('First flight'))).not.toThrow();
    expect(findBackup(ID)).toBeNull();
    expect(() => dropBackup(ID)).not.toThrow();
  });
});

describe('two drafts', () => {
  it('are the same writing whatever order their keys are in', () => {
    const draft = written('First flight');
    const reordered = Object.fromEntries(Object.entries(draft).reverse()) as Draft;
    expect(sameDraft(draft, reordered)).toBe(true);
    // As in JSON, a key whose value is undefined is not there; null is a value.
    expect(sameDraft(draft, { ...draft, extra: undefined } as Draft)).toBe(true);
    expect(sameDraft(draft, { ...draft, date: undefined } as unknown as Draft)).toBe(false);
    expect(sameDraft(draft, written('Second flight'))).toBe(false);
    expect(sameDraft(draft, { ...draft, tags: ['Rockets', 'Tests'] })).toBe(false);
  });
});

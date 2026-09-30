/**
 * A copy, on this device, of writing the server does not have yet. The session keeps its working
 * copy in memory and saves it within a second or so (session.ts). But offline, signed out, or
 * with the server unwell, that copy can wait a long while, and a tab that dies meanwhile (a
 * crash, a flat battery, a browser closed from the task list) would take it with it. So the
 * writing is also kept here, in this site's storage in the browser, until the server has it, and
 * the next time the post is opened on this device it comes back.
 *
 * One copy per post: whichever tab wrote last. A tab removes the copy only when it is its own, so
 * a save in one tab never throws away what another has not saved.
 */
import type { Draft } from '../../../server/posts';

const PREFIX = 'studio:unsaved:';
/** This tab. */
const TAB = crypto.randomUUID();

export interface Backup {
  /** The server's version of the draft (draft_rev) this writing was done over. */
  rev: number;
  draft: Draft;
  /** When it was kept (ms since 1970). */
  at: number;
  /** The tab that kept it. */
  tab: string;
}

/** The browser's storage for this site, or null where it is refused (some private windows). */
function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const orNull = (value: unknown, check: (value: unknown) => boolean) =>
  value === null || check(value);

/** A draft's shape, loosely: enough to open it. The server checks the rest when it is saved. */
function isDraft(value: unknown): value is Draft {
  return (
    isRecord(value) &&
    typeof value['title'] === 'string' &&
    typeof value['summary'] === 'string' &&
    typeof value['slug'] === 'string' &&
    orNull(value['doc'], isRecord) &&
    Array.isArray(value['tags']) &&
    value['tags'].every((tag) => typeof tag === 'string') &&
    orNull(value['series'], isRecord) &&
    orNull(value['cover'], isRecord) &&
    orNull(value['date'], (date) => typeof date === 'string')
  );
}

function isBackup(value: unknown): value is Backup {
  return (
    isRecord(value) &&
    typeof value['rev'] === 'number' &&
    typeof value['at'] === 'number' &&
    typeof value['tab'] === 'string' &&
    isDraft(value['draft'])
  );
}

/** The copy of this post's unsaved writing kept on this device, if there is one. */
export function findBackup(id: string): Backup | null {
  try {
    const value: unknown = JSON.parse(storage()?.getItem(PREFIX + id) ?? 'null');
    return isBackup(value) ? value : null;
  } catch {
    return null;
  }
}

/** Keeps a copy of the writing, done over the server's version `rev`, as this tab's. */
export function keepBackup(id: string, rev: number, draft: Draft, at = Date.now()): void {
  const backup: Backup = { rev, draft, at, tab: TAB };
  try {
    storage()?.setItem(PREFIX + id, JSON.stringify(backup));
  } catch {
    // The storage is full or refused: the session still has the writing, as before.
  }
}

/**
 * The server has the writing (or it was given up): the copy goes, unless another tab has kept one
 * since. `anyTab` for a post that is gone, whoever kept its copy.
 */
export function dropBackup(id: string, { anyTab = false } = {}): void {
  const kept = findBackup(id);
  if (kept && !anyTab && kept.tab !== TAB) return;
  try {
    storage()?.removeItem(PREFIX + id);
  } catch {
    // Refused: nothing was kept either.
  }
}

/** Whether two drafts hold the same writing, whatever order their keys are in. */
export function sameDraft(a: Draft, b: Draft): boolean {
  return canonical(a) === canonical(b);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isRecord(value)) {
    // As in JSON, a key whose value is undefined is not there.
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

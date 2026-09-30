/**
 * One post being written: the working copy, and getting it to the server.
 *
 *   - Every change is kept here at once and saved soon after (SAVE_DELAY_MS), one save at a time,
 *     each over the version it was based on (the server's draft_rev).
 *   - Offline, signed out, the server unwell: the copy stays here and the save is tried again,
 *     later and later (up to a minute), and at once when the connection or the session is back.
 *   - Saved elsewhere in between (another tab, another device): the server says 409 and sends its
 *     version, and the writer chooses which one to keep. Nothing is overwritten silently.
 *   - Leaving the screen saves what is left; closing the tab with unsaved changes asks first;
 *     signing out saves first (saveAll).
 *   - Until the server has it, the writing is also kept on this device (backup.ts), so a tab that
 *     dies first loses nothing: opening the post here again brings it back and saves it, or, if
 *     the server's draft has moved on meanwhile, asks which version to keep, as above.
 *
 * Sessions outlive their screen until they are saved: opening the post again picks up the same
 * one, so a slow save never meets a fresh copy of its own post.
 */
import type { Draft, StudioPost } from '../../../server/posts';
import { api, ApiError, onSignedIn } from '../../api';
import { describe } from '../../ui/common';
import { dropBackup, findBackup, keepBackup, sameDraft } from './backup';

export const SAVE_DELAY_MS = 800;
const MAX_RETRY_MS = 60_000;
/** The copy on this device follows the writing at most this far behind. */
const BACKUP_DELAY_MS = 400;

export type SaveState =
  | { kind: 'saved'; at: number }
  /** Changed; the save is on its way. */
  | { kind: 'waiting' }
  | { kind: 'saving' }
  /** Not saved, and trying again (offline, signed out…). */
  | { kind: 'retrying'; message: string }
  /** Not saved, and trying again will not help until something changes (too long…). */
  | { kind: 'failed'; message: string }
  | { kind: 'conflict'; theirs: StudioPost };

export interface DraftView {
  /** The server's side: status, address, revisions. */
  post: StudioPost;
  /** The working copy. */
  draft: Draft;
  save: SaveState;
  /** Goes up when the copy is replaced from outside (their version): the editor starts again. */
  generation: number;
  /** When the writing brought back from this device (backup.ts) was kept, if it was. */
  restoredAt: number | null;
}

const isPost = (value: unknown): value is StudioPost =>
  typeof value === 'object' && value !== null && 'draftRev' in value && 'draft' in value;

const live = new Map<string, DraftSession>();

export class DraftSession {
  #view: DraftView;
  #rev: number;
  #edits = 0;
  #saved = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #backupTimer: ReturnType<typeof setTimeout> | undefined;
  #queue: Promise<unknown> = Promise.resolve();
  #retryMs = 0;
  #open = true;
  readonly #listeners = new Set<() => void>();

  private constructor(post: StudioPost) {
    this.#view = {
      post,
      draft: post.draft,
      save: { kind: 'saved', at: post.draftSavedAt },
      generation: 0,
      restoredAt: null,
    };
    this.#rev = post.draftRev;
  }

  /** The session still at work on this post, if any (its copy is newer than the server's). */
  static existing(id: string): DraftSession | null {
    return live.get(id) ?? null;
  }

  static start(post: StudioPost): DraftSession {
    const session = new DraftSession(post);
    session.#restore();
    live.set(post.id, session);
    return session;
  }

  /**
   * Writing this device kept (backup.ts) that the server does not have comes back into the copy.
   * If it was written over the server's current version, it saves; if the server's draft has
   * moved on since, the writer chooses which version to keep.
   */
  #restore(): void {
    const backup = findBackup(this.id);
    if (!backup) return;
    const server = this.#view.post;
    // A field a later studio added comes from the server's copy.
    const draft = { ...server.draft, ...backup.draft };
    if (sameDraft(draft, server.draft)) {
      // It reached the server after all (the tab went between the save and the tidying).
      dropBackup(this.id, { anyTab: true });
      return;
    }
    const current = backup.rev === server.draftRev;
    // The version the writing was done over, so that saving it can never pass for a later one.
    this.#rev = backup.rev;
    this.#edits = 1;
    this.#view = {
      ...this.#view,
      draft,
      save: current ? { kind: 'waiting' } : { kind: 'conflict', theirs: server },
      restoredAt: backup.at,
    };
    // This tab's copy from now on.
    keepBackup(this.id, backup.rev, draft, backup.at);
    if (current) this.#schedule(0);
  }

  /** A screen shows it (again). */
  attach(): void {
    this.#open = true;
    live.set(this.id, this);
  }

  /** Whether anything here is not on the server yet (for leaving the page). */
  static anyUnsaved(): boolean {
    return [...live.values()].some((session) => session.dirty);
  }

  /** Tries every waiting save now (the connection or the session is back). */
  static retryAll(): void {
    for (const session of live.values()) {
      if (session.dirty && session.#view.save.kind === 'retrying') void session.flush();
    }
  }

  /** Brings every copy on this device up to date now (the page may be frozen or closed). */
  static keepAll(): void {
    for (const session of live.values()) session.#backupNow();
  }

  /** Saves everything that can be saved now (before signing out, after which nothing can be). */
  static async saveAll(): Promise<void> {
    await Promise.all([...live.values()].map((session) => session.flush()));
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  view = (): DraftView => this.#view;

  get id(): string {
    return this.#view.post.id;
  }

  get dirty(): boolean {
    return this.#edits !== this.#saved;
  }

  #update(patch: Partial<DraftView>): void {
    this.#view = { ...this.#view, ...patch };
    for (const listener of this.#listeners) listener();
  }

  #schedule(ms: number): void {
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => void this.flush(), ms);
  }

  /** Keeps the copy on this device a moment after a change (at most every BACKUP_DELAY_MS). */
  #backupSoon(): void {
    this.#backupTimer ??= setTimeout(() => this.#backupNow(), BACKUP_DELAY_MS);
  }

  /** The copy on this device, now: the working copy while the server lacks any of it, else none. */
  #backupNow(): void {
    clearTimeout(this.#backupTimer);
    this.#backupTimer = undefined;
    if (this.dirty) keepBackup(this.id, this.#rev, this.#view.draft);
    else dropBackup(this.id);
  }

  /** A change from the page: kept at once, saved soon. */
  change(update: (draft: Draft) => Draft): void {
    const draft = update(this.#view.draft);
    if (draft === this.#view.draft) return;
    this.#edits += 1;
    const { save } = this.#view;
    const stuck = save.kind === 'conflict' || save.kind === 'failed';
    this.#update({ draft, save: stuck ? save : { kind: 'waiting' } });
    this.#backupSoon();
    if (save.kind !== 'conflict') this.#schedule(SAVE_DELAY_MS);
  }

  /** Saves everything now. True once the server has all of it. */
  flush(): Promise<boolean> {
    clearTimeout(this.#timer);
    const run = this.#queue.then(() => this.#save());
    this.#queue = run.catch(() => undefined);
    return run;
  }

  async #save(): Promise<boolean> {
    while (this.dirty) {
      if (this.#view.save.kind === 'conflict') return false;
      const edits = this.#edits;
      const draft = this.#view.draft;
      this.#update({ save: { kind: 'saving' } });
      try {
        const saved = await api.saveDraft(this.id, draft, this.#rev);
        this.#rev = saved.draftRev;
        this.#saved = edits;
        this.#retryMs = 0;
        this.#update({
          post: {
            ...this.#view.post,
            draft,
            draftRev: saved.draftRev,
            draftSavedAt: saved.draftSavedAt,
          },
          save: this.dirty ? { kind: 'waiting' } : { kind: 'saved', at: saved.draftSavedAt },
        });
        // Over the new version, or gone once the server has it all.
        this.#backupNow();
      } catch (error) {
        this.#fail(error);
        return false;
      }
    }
    if (!this.#open) live.delete(this.id);
    return true;
  }

  #fail(error: unknown): void {
    if (error instanceof ApiError && error.status === 409 && isPost(error.body['current'])) {
      this.#update({ save: { kind: 'conflict', theirs: error.body['current'] } });
    } else if (error instanceof ApiError && [400, 404, 413].includes(error.status)) {
      this.#update({ save: { kind: 'failed', message: error.message } });
    } else {
      this.#retryMs = Math.min(MAX_RETRY_MS, Math.max(2_000, this.#retryMs * 2));
      this.#update({ save: { kind: 'retrying', message: describe(error) } });
      this.#schedule(this.#retryMs);
    }
  }

  /** The conflict: keep what is here (it overwrites theirs). */
  keepMine(): void {
    const { save } = this.#view;
    if (save.kind !== 'conflict') return;
    this.#rev = save.theirs.draftRev;
    this.#saved = -1;
    this.#update({ post: { ...save.theirs, draft: this.#view.draft }, save: { kind: 'waiting' } });
    this.#backupNow();
    void this.flush();
  }

  /** The conflict: take theirs (what is here is dropped). */
  takeTheirs(): void {
    const { save } = this.#view;
    if (save.kind !== 'conflict') return;
    this.#rev = save.theirs.draftRev;
    this.#saved = this.#edits;
    this.#update({
      post: save.theirs,
      draft: save.theirs.draft,
      save: { kind: 'saved', at: save.theirs.draftSavedAt },
      generation: this.#view.generation + 1,
    });
    this.#backupNow();
  }

  /** Why the post cannot be published or previewed yet, if it cannot. */
  #unsavedWords(): string {
    const { save } = this.#view;
    if (save.kind === 'conflict') return 'First choose which version to keep.';
    if (save.kind === 'failed' || save.kind === 'retrying')
      return `The post isn’t saved: ${save.message}`;
    return 'The post isn’t saved yet.';
  }

  /** Saves, then makes the saved draft the live post. */
  async publish(): Promise<{ slug: string; firstTime: boolean }> {
    if (!(await this.flush())) throw new Error(this.#unsavedWords());
    const result = await api.publish(this.id, this.#rev);
    this.#update({ post: { ...result.post, draft: this.#view.draft } });
    return result;
  }

  async unpublish(): Promise<void> {
    const post = await api.unpublish(this.id);
    this.#update({ post: { ...post, draft: this.#view.draft } });
  }

  async notify(): Promise<number> {
    const { queued } = await api.notify(this.id);
    this.#update({ post: { ...this.#view.post, notifiedAt: Date.now() } });
    return queued;
  }

  /** Saves before a preview, which renders the server's copy. */
  async ready(): Promise<void> {
    if (!(await this.flush())) throw new Error(this.#unsavedWords());
  }

  async delete(): Promise<void> {
    clearTimeout(this.#timer);
    await api.deletePost(this.id);
    this.#saved = this.#edits;
    clearTimeout(this.#backupTimer);
    dropBackup(this.id, { anyTab: true });
    live.delete(this.id);
  }

  /**
   * The screen is going: what is left is saved, and the session goes once it is. One with a
   * conflict (or a save that failed) waits for the post to be opened again, where it shows.
   */
  close(): void {
    this.#backupNow();
    this.#open = false;
    if (!this.dirty) live.delete(this.id);
    else if (this.#view.save.kind !== 'conflict') void this.flush();
  }
}

// Leaving with unsaved writing asks first; a connection or a session coming back retries.
addEventListener('beforeunload', (event) => {
  if (DraftSession.anyUnsaved()) event.preventDefault();
});
addEventListener('online', () => DraftSession.retryAll());
onSignedIn(() => DraftSession.retryAll());
// A hidden page may be frozen, or thrown away, without another word: the copies are made now.
addEventListener('pagehide', () => DraftSession.keepAll());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') DraftSession.keepAll();
});

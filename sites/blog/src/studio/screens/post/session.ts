/**
 * One post being written: the working copy, and getting it to the server.
 *
 *   - Every change is kept here at once and saved soon after (SAVE_DELAY_MS), one save at a time,
 *     each over the version it was based on (the server's draft_rev).
 *   - Offline, signed out, the server unwell: the copy stays here and the save is tried again,
 *     later and later (up to a minute), and at once when the connection or the session is back.
 *   - Saved elsewhere in between (another tab, another device): the server says 409 and sends its
 *     version, and the writer chooses which one to keep. Nothing is overwritten silently.
 *   - Leaving the screen saves what is left; closing the tab with unsaved changes asks first.
 *
 * Sessions outlive their screen until they are saved: opening the post again picks up the same
 * one, so a slow save never meets a fresh copy of its own post.
 */
import type { Draft, StudioPost } from '../../../server/posts';
import { api, ApiError, onSignedIn } from '../../api';
import { describe } from '../../ui/common';

export const SAVE_DELAY_MS = 800;
const MAX_RETRY_MS = 60_000;

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
    };
    this.#rev = post.draftRev;
  }

  /** The session still at work on this post, if any (its copy is newer than the server's). */
  static existing(id: string): DraftSession | null {
    return live.get(id) ?? null;
  }

  static start(post: StudioPost): DraftSession {
    const session = new DraftSession(post);
    live.set(post.id, session);
    return session;
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

  /** A change from the page: kept at once, saved soon. */
  change(update: (draft: Draft) => Draft): void {
    const draft = update(this.#view.draft);
    if (draft === this.#view.draft) return;
    this.#edits += 1;
    const { save } = this.#view;
    const stuck = save.kind === 'conflict' || save.kind === 'failed';
    this.#update({ draft, save: stuck ? save : { kind: 'waiting' } });
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
    live.delete(this.id);
  }

  /**
   * The screen is going: what is left is saved, and the session goes once it is. One with a
   * conflict (or a save that failed) waits for the post to be opened again, where it shows.
   */
  close(): void {
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

/**
 * Writing a post, Notion's way: the cover, the title, a quiet table of properties, then the
 * page itself. It saves as you go (post/session.ts); the bar on top says so, and holds Preview
 * and Publish. Rarer things (email subscribers, take down, delete) wait at the bottom.
 */
import type { Doc } from '@allenkh/editor';
import { wordCount } from '@allenkh/editor/text';
import { ChevronLeft, ExternalLink } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { mediaUrl, pickWidth } from '../../editor/nodes';
import type { Draft, SeriesInfo, TagInfo } from '../../server/posts';
import type { StoredImage } from '../../server/media';
import { readingMinutes } from '../../site/format';
import { api, ApiError } from '../api';
import { useOverview } from '../data';
import { StudioEditor } from '../editor/StudioEditor';
import { uploadImage } from '../editor/uploads';
import { follow, hrefFor, navigate, useTitle } from '../router';
import { busyLabel, describe, ErrorText, plural, Title, useConfirm, whenAgo } from '../ui/common';
import { dropBackup } from './post/backup';
import { Properties } from './post/Properties';
import { DraftSession, type SaveState } from './post/session';
import { PublishState, standing } from './post/status';

export function PostEditor({ id }: { id: string }) {
  const [session, setSession] = useState<DraftSession | null>(() => DraftSession.existing(id));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session) return undefined;
    let live = true;
    api.post(id).then(
      (post) => {
        if (live) setSession(DraftSession.existing(id) ?? DraftSession.start(post));
      },
      (caught: unknown) => {
        // Deleted elsewhere: whatever this device kept of it has nowhere to go.
        if (caught instanceof ApiError && caught.status === 404) dropBackup(id, { anyTab: true });
        if (live) setError(describe(caught));
      },
    );
    return () => {
      live = false;
    };
  }, [id, session]);

  useEffect(() => {
    if (!session) return undefined;
    session.attach();
    return () => session.close();
  }, [session]);

  if (error) {
    return (
      <div className="page">
        <header className="page__head">
          <a className="back-link" href={hrefFor({ name: 'posts' })} onClick={follow}>
            <ChevronLeft aria-hidden />
            Posts
          </a>
          <Title className="page__title">This post can’t be opened</Title>
        </header>
        <ErrorText error={error} />
      </div>
    );
  }
  if (!session) {
    return (
      <div className="page" aria-busy="true">
        <Title className="visually-hidden">Opening the post</Title>
        <p className="hint">Opening…</p>
      </div>
    );
  }
  return <Writing session={session} />;
}

/** How the saving is going, in a few words (problems also as an alert, below the bar). */
function saveWords(save: SaveState): string {
  switch (save.kind) {
    case 'saved':
      return 'Saved';
    case 'waiting':
    case 'saving':
      return 'Saving…';
    case 'retrying':
    case 'failed':
    case 'conflict':
      return 'Not saved';
  }
}

/** Grows a one-line textarea with what is typed in it. */
function useAutoGrow(value: string) {
  const field = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = field.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
  }, [value]);
  return field;
}

/** Pictures the studio has asked the server about (a cover's sizes), by id. */
const coverSizes = new Map<string, StoredImage>();

function pickFile(onPick: (file: File) => void) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) onPick(file);
  });
  input.click();
}

type Busy = null | 'publish' | 'preview' | 'unpublish' | 'notify' | 'delete' | 'cover';

type Notice =
  { kind: 'published'; slug: string; firstTime: boolean } | { kind: 'sent'; queued: number };

function Writing({ session }: { session: DraftSession }) {
  const { post, draft, save, generation, restoredAt } = useSyncExternalStore(
    session.subscribe,
    session.view,
  );
  const { overview, refresh } = useOverview();
  const [confirmDialog, ask] = useConfirm();
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [known, setKnown] = useState<{ tags: TagInfo[]; series: SeriesInfo[] }>({
    tags: [],
    series: [],
  });
  const [cover, setCover] = useState<StoredImage | null>(() =>
    draft.cover ? (coverSizes.get(draft.cover.id) ?? null) : null,
  );
  const title = useAutoGrow(draft.title);
  const name = draft.title.trim() || 'Untitled';
  useTitle(name);

  useEffect(() => {
    let live = true;
    Promise.all([api.tags(), api.series()]).then(
      ([tags, series]) => {
        if (live) setKnown({ tags, series });
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);

  // The cover's sizes, when the post has one this screen has not seen.
  const coverId = draft.cover?.id ?? null;
  useEffect(() => {
    if (!coverId || coverSizes.has(coverId)) return undefined;
    let live = true;
    api.media(coverId).then(
      (image) => {
        coverSizes.set(image.id, image);
        if (live) setCover(image);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [coverId]);
  const shownCover = coverId
    ? cover?.id === coverId
      ? cover
      : (coverSizes.get(coverId) ?? null)
    : null;

  const change = (update: (current: Draft) => Draft) => session.change(update);
  const run = async (what: Exclude<Busy, null>, task: () => Promise<void>) => {
    setBusy(what);
    setError(null);
    try {
      await task();
    } catch (caught) {
      setError(describe(caught));
    } finally {
      setBusy(null);
    }
  };

  const state = standing(post);
  const unsaved = save.kind !== 'saved';
  const mailReady = overview?.mail.ready ?? false;
  const canNotify = mailReady && post.status === 'published' && post.notifiedAt === null;
  const words = wordCount(draft.doc);

  const publish = () =>
    run('publish', async () => {
      const result = await session.publish();
      setNotice({ kind: 'published', slug: result.slug, firstTime: result.firstTime });
      void refresh();
    });

  const preview = () => {
    // The tab opens now, while the click still counts as one; the preview loads once saved.
    const tab = window.open('about:blank', '_blank');
    void run('preview', async () => {
      try {
        await session.ready();
      } catch (caught) {
        tab?.close();
        throw caught;
      }
      const url = `/studio/preview/${post.id}/`;
      if (tab) tab.location.href = url;
      else
        throw new Error(
          `The browser blocked the preview’s tab. Allow pop-ups here, or open ${url}.`,
        );
    });
  };

  const unpublish = async () => {
    const yes = await ask({
      title: 'Take this post off the blog?',
      body: 'Readers will find it gone. Its address stays reserved for it, and publishing it again brings it back.',
      confirm: 'Take it down',
      danger: true,
    });
    if (yes) {
      await run('unpublish', async () => {
        await session.unpublish();
        setNotice(null);
        void refresh();
      });
    }
  };

  const notify = async () => {
    const yes = await ask({
      title: 'Email this post to your subscribers?',
      body: `Everyone subscribed gets “${name}” by email, once. This can’t be taken back.`,
      confirm: 'Send it',
    });
    if (yes) {
      await run('notify', async () => {
        setNotice({ kind: 'sent', queued: await session.notify() });
        void refresh();
      });
    }
  };

  const remove = async () => {
    const yes = await ask({
      title: 'Delete this post?',
      body: 'The post and its comments are deleted for good. Its images stay in storage.',
      confirm: 'Delete post',
      danger: true,
    });
    if (yes) {
      await run('delete', async () => {
        await session.delete();
        void refresh();
        navigate(hrefFor({ name: 'posts' }), { replace: true });
      });
    }
  };

  const coverControls = {
    busy: busy === 'cover',
    pick: () =>
      pickFile((file) => {
        void run('cover', async () => {
          const image = await uploadImage(file);
          const stored = {
            id: image.id,
            ext: image.ext,
            width: image.width,
            height: image.height,
            widths: image.widths,
          };
          coverSizes.set(stored.id, stored);
          setCover(stored);
          change((current) => ({
            ...current,
            cover: { id: stored.id, alt: current.cover?.alt ?? '' },
          }));
        });
      }),
    remove: () => change((current) => ({ ...current, cover: null })),
  };

  const focusText = () => document.querySelector<HTMLElement>('.post-editor .ProseMirror')?.focus();

  return (
    <div className="post-editor">
      <div className="post-bar">
        <a className="back-link" href={hrefFor({ name: 'posts' })} onClick={follow}>
          <ChevronLeft aria-hidden />
          Posts
        </a>
        <span className="post-bar__save" data-state={save.kind}>
          {saveWords(save)}
        </span>
        <span className="post-bar__spacer" />
        <PublishState post={post} />
        <button type="button" className="button" disabled={busy !== null} onClick={preview}>
          {busyLabel(busy === 'preview', 'Preview', 'Saving…')}
        </button>
        {state !== 'published' || unsaved ? (
          <button
            type="button"
            className="button button--primary"
            disabled={busy !== null || save.kind === 'conflict'}
            onClick={() => void publish()}
          >
            {busyLabel(
              busy === 'publish',
              state === 'draft' ? 'Publish' : state === 'unpublished' ? 'Publish again' : 'Update',
              'Publishing…',
            )}
          </button>
        ) : post.slug ? (
          <a className="button" href={`/${post.slug}/`} target="_blank" rel="noopener">
            View
            <ExternalLink aria-hidden />
          </a>
        ) : null}
      </div>

      <div className="page post-page">
        {save.kind === 'conflict' ? (
          <div className="banner" role="alert">
            {restoredAt !== null ? (
              <p>
                <strong>Writing kept on this device never reached the blog</strong> (kept{' '}
                {whenAgo(restoredAt)}), and the post was saved somewhere else since (
                {whenAgo(save.theirs.draftSavedAt)}). Which version should it keep?
              </p>
            ) : (
              <p>
                <strong>This post was changed somewhere else</strong> (another tab or device, saved{' '}
                {whenAgo(save.theirs.draftSavedAt)}). Which version should it keep?
              </p>
            )}
            <div className="row">
              <button
                type="button"
                className="button button--primary"
                onClick={() => session.keepMine()}
              >
                Keep this one
              </button>
              <button
                type="button"
                className="button"
                onClick={() => {
                  void ask({
                    title: 'Use the other version?',
                    body: 'What is on this screen and not saved will be lost.',
                    confirm: 'Use the other version',
                    danger: true,
                  }).then((yes) => {
                    if (yes) session.takeTheirs();
                  });
                }}
              >
                Use the other version
              </button>
            </div>
          </div>
        ) : save.kind === 'retrying' || save.kind === 'failed' ? (
          <div className="banner" role="alert">
            <p>
              <strong>Not saved yet.</strong> {save.message}
              {save.kind === 'retrying' ? ' It’s kept here, and saves on its own when it can.' : ''}
            </p>
            {save.kind === 'retrying' ? (
              <div className="row">
                <button type="button" className="button" onClick={() => void session.flush()}>
                  Try now
                </button>
              </div>
            ) : null}
          </div>
        ) : restoredAt !== null ? (
          <div className="banner banner--good" role="status">
            <p>
              <strong>Brought back</strong> from this device: writing that hadn’t reached the blog
              (kept {whenAgo(restoredAt)}).
            </p>
          </div>
        ) : null}

        {notice?.kind === 'published' ? (
          <div className="banner banner--good" role="status">
            <p>
              {notice.firstTime ? 'Published' : 'Updated'} at{' '}
              <a href={`/${notice.slug}/`} target="_blank" rel="noopener">
                {location.host}/{notice.slug}/
              </a>
              .
            </p>
            {canNotify && notice.firstTime ? (
              <div className="row">
                <button
                  type="button"
                  className="button"
                  disabled={busy !== null}
                  onClick={() => void notify()}
                >
                  Email it to subscribers
                </button>
              </div>
            ) : null}
          </div>
        ) : notice?.kind === 'sent' ? (
          <div className="banner banner--good" role="status">
            <p>
              On its way to {plural(notice.queued, 'subscriber')}. The first go at once, the rest
              over the next minutes.
            </p>
          </div>
        ) : null}
        <ErrorText error={error} />

        {shownCover ? (
          <figure className="editor-cover">
            <img
              src={mediaUrl(shownCover.id, pickWidth(shownCover.widths, 1600), shownCover.ext)}
              alt=""
              width={shownCover.width}
              height={shownCover.height}
            />
          </figure>
        ) : null}

        <Title className="visually-hidden">{name}</Title>
        <textarea
          ref={title}
          className="bare-input page__title post-title"
          rows={1}
          maxLength={200}
          value={draft.title}
          placeholder="Untitled"
          aria-label="Title"
          // A new post starts at its title (as a new event does in the journal).
          autoFocus={!draft.title}
          onChange={(event) =>
            change((current) => ({ ...current, title: event.target.value.replace(/\n/g, ' ') }))
          }
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              focusText();
            }
          }}
        />

        <Properties
          post={post}
          draft={draft}
          known={known}
          cover={coverControls}
          onChange={change}
        />

        <div className="studio-editor">
          <StudioEditor
            key={generation}
            value={draft.doc as Doc | null}
            onChange={(doc) => change((current) => ({ ...current, doc: doc as Draft['doc'] }))}
            onUploadError={setError}
          />
        </div>

        <footer className="post-foot">
          <span className="hint">
            {plural(words, 'word')} · {readingMinutes(words)} min read
          </span>
          <span className="post-bar__spacer" />
          {canNotify && !(notice?.kind === 'published' && notice.firstTime) ? (
            <button
              type="button"
              className="button button--quiet"
              disabled={busy !== null}
              onClick={() => void notify()}
            >
              Email subscribers
            </button>
          ) : null}
          {post.status === 'published' ? (
            <button
              type="button"
              className="button button--quiet"
              disabled={busy !== null}
              onClick={() => void unpublish()}
            >
              Take down
            </button>
          ) : null}
          <button
            type="button"
            className="button button--quiet button--danger"
            disabled={busy !== null}
            onClick={() => void remove()}
          >
            Delete post
          </button>
        </footer>
      </div>
      {confirmDialog}
    </div>
  );
}

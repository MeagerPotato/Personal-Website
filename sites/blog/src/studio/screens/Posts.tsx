/** Every post: drafts first, then what is on the blog. "New post" starts one. */
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { api, type ListedPost } from '../api';
import { useOverview } from '../data';
import { follow, hrefFor, navigate, useTitle } from '../router';
import { busyLabel, describe, ErrorText, plural, shortDate, whenAgo } from '../ui/common';
import { PublishState } from './post/status';

function PostRow({ post }: { post: ListedPost }) {
  const title = post.draft.title.trim() || 'Untitled';
  const when =
    post.status === 'published' && post.publishedAt !== null
      ? `Published ${shortDate(post.publishedAt)}`
      : `Edited ${whenAgo(post.draftSavedAt)}`;
  return (
    <li>
      <a
        className="record-row post-item"
        href={hrefFor({ name: 'post', id: post.id })}
        onClick={follow}
      >
        <span className="post-item__text">
          <span
            className="record-row__name"
            data-untitled={post.draft.title.trim() ? undefined : ''}
          >
            {title}
          </span>
          <span className="post-item__meta">{when}</span>
        </span>
        <PublishState post={post} />
      </a>
    </li>
  );
}

export function Posts() {
  useTitle('Posts');
  const { overview } = useOverview();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = () => {
    setBusy(true);
    setError(null);
    api
      .createPost()
      .then((post) => navigate(hrefFor({ name: 'post', id: post.id })))
      .catch((caught: unknown) => {
        setError(describe(caught));
        setBusy(false);
      });
  };

  const posts = overview?.posts ?? null;
  const drafts = posts?.filter((post) => post.status === 'draft') ?? [];
  const live = posts?.filter((post) => post.status === 'published') ?? [];
  const pending = overview?.pendingComments ?? 0;

  return (
    <div className="page">
      <header className="page__head page__head--row">
        <h1 className="page__title">Posts</h1>
        <button type="button" className="button button--primary" disabled={busy} onClick={create}>
          <Plus aria-hidden />
          {busyLabel(busy, 'New post', 'Starting…')}
        </button>
      </header>
      <ErrorText error={error} />

      {pending > 0 ? (
        <p className="studio-notice">
          <a href={hrefFor({ name: 'comments' })} onClick={follow}>
            {plural(pending, 'comment')} {pending === 1 ? 'is' : 'are'} waiting for you
          </a>
        </p>
      ) : null}

      {posts === null ? (
        <p className="hint" aria-busy="true">
          Loading…
        </p>
      ) : posts.length === 0 ? (
        <div className="empty-state">
          <p className="empty-hint">
            Nothing here yet. “New post” starts one; it stays a draft, seen by no one, until you
            publish it.
          </p>
        </div>
      ) : (
        <>
          {drafts.length > 0 ? (
            <section className="section" aria-labelledby="drafts">
              <h2 id="drafts" className="section__title">
                Drafts
              </h2>
              <ul className="record-list">
                {drafts.map((post) => (
                  <PostRow key={post.id} post={post} />
                ))}
              </ul>
            </section>
          ) : null}
          {live.length > 0 ? (
            <section className="section" aria-labelledby="published">
              <h2 id="published" className="section__title">
                On the blog
              </h2>
              <ul className="record-list">
                {live.map((post) => (
                  <PostRow key={post.id} post={post} />
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

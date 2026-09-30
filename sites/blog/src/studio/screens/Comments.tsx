/**
 * Comments, read before they appear: waiting ones first. Approve, mark as spam, delete, or
 * reply (a reply is published at once, and approves what it answers).
 */
import { ExternalLink } from 'lucide-react';
import { useCallback, useEffect, useId, useState } from 'react';
import type { CommentStatus, StudioComment } from '../../server/comments';
import { api } from '../api';
import { useOverview } from '../data';
import { useTitle } from '../router';
import { busyLabel, describe, ErrorText, Title, useConfirm, whenAgo } from '../ui/common';

const TABS: { status: CommentStatus; label: string }[] = [
  { status: 'pending', label: 'Waiting' },
  { status: 'approved', label: 'Approved' },
  { status: 'spam', label: 'Spam' },
];

const EMPTY: Record<CommentStatus, string> = {
  pending: 'Nothing waiting. New comments land here before anyone else sees them.',
  approved: 'No approved comments yet.',
  spam: 'No spam. Comments with too many links are put here on their own.',
};

function Reply({ comment, onSent }: { comment: StudioComment; onSent: () => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = useId();
  if (!open) {
    return (
      <button type="button" className="button button--quiet" onClick={() => setOpen(true)}>
        Reply
      </button>
    );
  }
  return (
    <form
      className="comment-reply"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        api
          .reply(comment.id, text)
          .then(() => {
            setText('');
            setOpen(false);
            onSent();
          })
          .catch((caught: unknown) => setError(describe(caught)))
          .finally(() => setBusy(false));
      }}
    >
      <label className="visually-hidden" htmlFor={field}>
        Reply to {comment.name}
      </label>
      <textarea
        id={field}
        className="input"
        rows={3}
        maxLength={3000}
        value={text}
        required
        placeholder={`Reply to ${comment.name}, as Allen`}
        onChange={(event) => setText(event.target.value)}
      />
      <ErrorText error={error} />
      <div className="row">
        <button type="submit" className="button button--primary" disabled={busy || !text.trim()}>
          {busyLabel(busy, 'Publish reply', 'Publishing…')}
        </button>
        <button type="button" className="button button--quiet" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function CommentCard({
  comment,
  onChanged,
  ask,
}: {
  comment: StudioComment;
  onChanged: () => void;
  ask: ReturnType<typeof useConfirm>[1];
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = (task: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    task()
      .then(onChanged)
      .catch((caught: unknown) => setError(describe(caught)))
      .finally(() => setBusy(false));
  };
  const move = (status: CommentStatus) => act(() => api.setCommentStatus(comment.id, status));
  const remove = () => {
    void ask({
      title: 'Delete this comment?',
      body: 'It is deleted for good, with any replies to it.',
      confirm: 'Delete comment',
      danger: true,
    }).then((yes) => {
      if (yes) act(() => api.deleteComment(comment.id));
    });
  };

  return (
    <li className="comment-card" aria-busy={busy || undefined}>
      <p className="comment-card__meta">
        <strong>{comment.name}</strong>
        {comment.author ? <span className="tag">You</span> : null}
        <span>
          on{' '}
          {comment.postSlug ? (
            <a href={`/${comment.postSlug}/#comments`} target="_blank" rel="noopener">
              {comment.postTitle || 'Untitled'}
              <ExternalLink aria-hidden className="inline-icon" />
            </a>
          ) : (
            comment.postTitle || 'an unpublished post'
          )}
        </span>
        <span className="hint">{whenAgo(comment.createdAt)}</span>
      </p>
      {comment.parentId ? <p className="hint">A reply to another comment</p> : null}
      <p className="comment-card__body">{comment.body}</p>
      <ErrorText error={error} />
      <div className="row comment-card__actions">
        {comment.status !== 'approved' ? (
          <button
            type="button"
            className="button button--primary"
            disabled={busy}
            onClick={() => move('approved')}
          >
            {comment.status === 'spam' ? 'Not spam: approve' : 'Approve'}
          </button>
        ) : null}
        {comment.author ? null : <Reply comment={comment} onSent={onChanged} />}
        {comment.status === 'approved' ? (
          <button
            type="button"
            className="button button--quiet"
            disabled={busy}
            onClick={() => move('pending')}
          >
            Hide again
          </button>
        ) : null}
        {comment.status !== 'spam' && !comment.author ? (
          <button
            type="button"
            className="button button--quiet"
            disabled={busy}
            onClick={() => move('spam')}
          >
            Spam
          </button>
        ) : null}
        <button
          type="button"
          className="button button--quiet button--danger"
          disabled={busy}
          onClick={remove}
        >
          Delete
        </button>
      </div>
    </li>
  );
}

export function Comments() {
  useTitle('Comments');
  const { overview, refresh } = useOverview();
  const [status, setStatus] = useState<CommentStatus>('pending');
  const [comments, setComments] = useState<StudioComment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDialog, ask] = useConfirm();

  const load = useCallback(
    (which: CommentStatus) =>
      api.comments(which).then(
        (list) => {
          setComments(list);
          setError(null);
        },
        (caught: unknown) => setError(describe(caught)),
      ),
    [],
  );

  useEffect(() => {
    void load(status);
  }, [load, status]);

  const changed = () => {
    void load(status);
    void refresh();
  };

  const pending = overview?.pendingComments ?? 0;

  return (
    <div className="page">
      <header className="page__head">
        <Title className="page__title">Comments</Title>
      </header>
      <div className="segmented" role="group" aria-label="Show">
        {TABS.map((tab) => (
          <button
            key={tab.status}
            type="button"
            aria-pressed={status === tab.status}
            onClick={() => {
              setComments(null);
              setStatus(tab.status);
            }}
          >
            {tab.label}
            {tab.status === 'pending' && pending > 0 ? ` (${pending})` : ''}
          </button>
        ))}
      </div>
      <ErrorText error={error} />
      {comments === null ? (
        <p className="hint" aria-busy="true">
          Loading…
        </p>
      ) : comments.length === 0 ? (
        <p className="hint comments-empty">{EMPTY[status]}</p>
      ) : (
        <ul className="comment-queue">
          {comments.map((comment) => (
            <CommentCard key={comment.id} comment={comment} onChanged={changed} ask={ask} />
          ))}
        </ul>
      )}
      {confirmDialog}
    </div>
  );
}

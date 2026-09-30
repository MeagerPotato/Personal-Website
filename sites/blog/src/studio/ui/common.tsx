/**
 * Small pieces every screen of the studio uses: the gate layout, error words, dates, and a
 * question before anything that cannot be undone.
 */
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ApiError } from '../api';
import { cancelled } from '../passkeys';

/** The screens before the studio opens: one calm column under the blog's mark. */
export function Gate({
  title,
  lede,
  children,
}: {
  title: string;
  lede?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="gate">
      <div className="gate__column">
        <img className="gate__mark" src="/icon.svg" alt="" width={48} height={48} />
        <h1 className="gate__title">{title}</h1>
        {lede ? <p className="gate__lede">{lede}</p> : null}
        {children}
      </div>
    </main>
  );
}

export function ErrorText({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p className="error-text" role="alert">
      {error}
    </p>
  );
}

/** Words for whatever went wrong, for a person rather than a log. */
export function describe(error: unknown): string {
  if (cancelled(error)) return 'The passkey prompt was closed. Try again when you’re ready.';
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.name === 'InvalidStateError') {
    return 'This device already has a passkey for the studio.';
  }
  if (error instanceof Error && error.message) return error.message;
  console.error(error);
  return 'Something went wrong. Try again.';
}

/** A button's words while it works: it says what it is doing. */
export const busyLabel = (busy: boolean, idle: string, working: string): string =>
  busy ? working : idle;

const day = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const dayThisYear = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });

/** "Sep 29" this year, "Sep 29, 2025" before. */
export function shortDate(at: number, now = Date.now()): string {
  return new Date(at).getFullYear() === new Date(now).getFullYear()
    ? dayThisYear.format(at)
    : day.format(at);
}

/** "just now", "5 min ago", "3:40 PM" today, else the date. */
export function whenAgo(at: number, now = Date.now()): string {
  const seconds = Math.round((now - at) / 1000);
  if (seconds < 45) return 'just now';
  if (seconds < 60 * 60) return `${Math.max(1, Math.round(seconds / 60))} min ago`;
  if (new Date(at).toDateString() === new Date(now).toDateString()) return time.format(at);
  return shortDate(at, now);
}

export const plural = (count: number, one: string, many = `${one}s`): string =>
  `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;

export interface Question {
  title: string;
  body?: ReactNode;
  /** The button that goes ahead ("Delete post"). */
  confirm: string;
  /** Red, for what cannot be undone. */
  danger?: boolean;
}

/**
 * Asks before doing something that cannot be undone: `ask()` shows a modal dialog and resolves
 * to whether the answer was yes. Render the returned element anywhere on the screen.
 */
export function useConfirm(): [ReactNode, (question: Question) => Promise<boolean>] {
  const [pending, setPending] = useState<(Question & { resolve: (yes: boolean) => void }) | null>(
    null,
  );
  const ask = useCallback(
    (question: Question) => new Promise<boolean>((resolve) => setPending({ ...question, resolve })),
    [],
  );
  const element = pending ? (
    <ConfirmDialog
      question={pending}
      onAnswer={(yes) => {
        pending.resolve(yes);
        setPending(null);
      }}
    />
  ) : null;
  return [element, ask];
}

function ConfirmDialog({
  question,
  onAnswer,
}: {
  question: Question;
  onAnswer: (yes: boolean) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);
  // close() puts the focus back where it was before the question.
  const answer = (yes: boolean) => {
    dialog.current?.close();
    onAnswer(yes);
  };
  return (
    <dialog
      ref={dialog}
      className="sheet dialog"
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault();
        answer(false);
      }}
    >
      <form
        className="dialog__body"
        onSubmit={(event) => {
          event.preventDefault();
          answer(true);
        }}
      >
        <h2 id={title} className="dialog__title">
          {question.title}
        </h2>
        {question.body ? <div className="dialog__text">{question.body}</div> : null}
        <div className="dialog__actions">
          <button type="button" className="button" onClick={() => answer(false)}>
            Cancel
          </button>
          <button
            type="submit"
            className={question.danger ? 'button button--danger' : 'button button--primary'}
          >
            {question.confirm}
          </button>
        </div>
      </form>
    </dialog>
  );
}

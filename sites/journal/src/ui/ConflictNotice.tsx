/**
 * When two devices rewrote the same text while apart, the newer version shows and the other is
 * kept (journal/merge.ts). This says so, shows the other version, and lets you dismiss it once
 * you have taken what you want from it.
 */
import { plainText } from '@allenkh/editor/text';
import type { ConflictCopy } from '../journal/merge';

const when = (at: number): string =>
  at > 0
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(at)
    : 'earlier';

export function ConflictNotice(props: {
  conflicts: ConflictCopy[] | undefined;
  onDismiss: (id: string) => void;
}) {
  if (!props.conflicts?.length) return null;
  return (
    <div className="conflicts">
      {props.conflicts.map((copy) => (
        <details key={copy.id} className="callout conflict" data-family="lilac">
          <summary>
            <span aria-hidden="true">🔀</span> Another version of this, written {when(copy.at)} on
            another device, was kept here.
          </summary>
          <div className="conflict__body">
            <p className="conflict__text">{plainText(copy.value) || '(empty)'}</p>
            <button type="button" className="button" onClick={() => props.onDismiss(copy.id)}>
              Dismiss
            </button>
          </div>
        </details>
      ))}
    </div>
  );
}

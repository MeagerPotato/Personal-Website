/**
 * Who gets new posts by email. Addresses arrive only through the double opt-in (a confirmation
 * link), so there is nothing to add here: only to see, and to remove.
 */
import { useCallback, useEffect, useState } from 'react';
import type { Subscriber } from '../../server/subscribers';
import { api } from '../api';
import { useOverview } from '../data';
import { useTitle } from '../router';
import { describe, ErrorText, plural, shortDate, useConfirm } from '../ui/common';

const STATUS: Record<Subscriber['status'], string> = {
  active: 'Subscribed',
  pending: 'Not confirmed yet',
  unsubscribed: 'Unsubscribed',
};

export function Subscribers() {
  useTitle('Subscribers');
  const { overview } = useOverview();
  const [list, setList] = useState<Subscriber[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDialog, ask] = useConfirm();

  const load = useCallback(
    () =>
      api.subscribers().then(
        (subscribers) => setList(subscribers),
        (caught: unknown) => setError(describe(caught)),
      ),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (subscriber: Subscriber) => {
    const yes = await ask({
      title: `Remove ${subscriber.email}?`,
      body: 'They get no more posts, and the address is forgotten. They can subscribe again later.',
      confirm: 'Remove',
      danger: true,
    });
    if (!yes) return;
    try {
      await api.removeSubscriber(subscriber.id);
      await load();
    } catch (caught) {
      setError(describe(caught));
    }
  };

  const mail = overview?.mail ?? null;
  const active = list?.filter((subscriber) => subscriber.status === 'active').length ?? 0;

  return (
    <div className="page">
      <header className="page__head">
        <h1 className="page__title">Subscribers</h1>
        {list ? <p className="hint">{plural(active, 'confirmed subscriber')}</p> : null}
      </header>

      {mail && !mail.ready ? (
        <div className="banner" role="note">
          <p>
            <strong>Email isn’t set up yet,</strong> so the blog doesn’t offer subscribing. The
            blog’s runbook (sites/docs/runbooks/blog-setup.md) has the steps.
          </p>
        </div>
      ) : null}
      {mail && mail.ready && (mail.queued > 0 || mail.failed > 0) ? (
        <p className="hint">
          {mail.queued > 0 ? `${plural(mail.queued, 'email')} waiting to go out. ` : ''}
          {mail.failed > 0 ? `${plural(mail.failed, 'email')} could not be delivered.` : ''}
        </p>
      ) : null}

      <ErrorText error={error} />
      {list === null ? (
        <p className="hint" aria-busy="true">
          Loading…
        </p>
      ) : list.length === 0 ? (
        <p className="hint">No one yet. Readers subscribe at the bottom of every post.</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Email</th>
                <th scope="col">Status</th>
                <th scope="col">Since</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((subscriber) => (
                <tr key={subscriber.id} data-status={subscriber.status}>
                  <td className="data-table__main">{subscriber.email}</td>
                  <td>{STATUS[subscriber.status]}</td>
                  <td>{shortDate(subscriber.confirmedAt ?? subscriber.createdAt)}</td>
                  <td className="data-table__actions">
                    <button
                      type="button"
                      className="button button--quiet button--danger"
                      aria-label={`Remove ${subscriber.email}`}
                      onClick={() => void remove(subscriber)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {confirmDialog}
    </div>
  );
}

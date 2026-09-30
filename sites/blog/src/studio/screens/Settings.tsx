/**
 * The studio's passkeys (one per device you write on; add, rename, remove), signing out, and
 * whether email is set up.
 */
import { KeyRound, Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api, type Passkey } from '../api';
import { useOverview } from '../data';
import { addPasskey, deviceLabel } from '../passkeys';
import { useTitle } from '../router';
import { busyLabel, describe, ErrorText, shortDate, useConfirm, whenAgo } from '../ui/common';

type Ask = ReturnType<typeof useConfirm>[1];

function PasskeyRow({
  passkey,
  onChanged,
  ask,
}: {
  passkey: Passkey;
  onChanged: () => void;
  ask: Ask;
}) {
  const [label, setLabel] = useState(passkey.label);
  const [error, setError] = useState<string | null>(null);
  const rename = () => {
    const next = label.trim();
    if (next === passkey.label) return;
    api
      .renamePasskey(passkey.id, next)
      .then(onChanged, (caught: unknown) => setError(describe(caught)));
  };
  const remove = () => {
    void ask({
      title: `Remove the passkey “${passkey.label || 'Passkey'}”?`,
      body: 'The device it lives on can no longer sign in to the studio.',
      confirm: 'Remove passkey',
      danger: true,
    }).then((yes) => {
      if (yes)
        api
          .deletePasskey(passkey.id)
          .then(onChanged, (caught: unknown) => setError(describe(caught)));
    });
  };
  return (
    <li className="passkey">
      <div className="settings__row">
        <KeyRound aria-hidden className="passkey__icon" />
        <input
          className="bare-input"
          value={label}
          maxLength={60}
          placeholder="Passkey"
          aria-label="Passkey name"
          onChange={(event) => setLabel(event.target.value)}
          onBlur={rename}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
        {passkey.current ? (
          <span className="tag">This session</span>
        ) : (
          <button type="button" className="button button--quiet button--danger" onClick={remove}>
            Remove
          </button>
        )}
      </div>
      <p className="hint passkey__meta">
        Made {shortDate(passkey.createdAt)}
        {passkey.lastUsedAt ? ` · last used ${whenAgo(passkey.lastUsedAt)}` : ''}
        {passkey.synced ? ' · synced across your devices' : ' · on one device only'}
      </p>
      <ErrorText error={error} />
    </li>
  );
}

export function Settings() {
  useTitle('Settings');
  const { overview } = useOverview();
  const [passkeys, setPasskeys] = useState<Passkey[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDialog, ask] = useConfirm();

  const load = useCallback(
    () =>
      api.passkeys().then(
        (list) => setPasskeys(list),
        (caught: unknown) => setError(describe(caught)),
      ),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const add = () => {
    setBusy(true);
    setError(null);
    addPasskey(deviceLabel())
      .then(load)
      .catch((caught: unknown) => setError(describe(caught)))
      .finally(() => setBusy(false));
  };

  const signOut = () => {
    void api
      .logout()
      .catch(() => undefined)
      .then(() => location.assign('/studio/'));
  };

  const mail = overview?.mail ?? null;

  return (
    <div className="page">
      <header className="page__head">
        <h1 className="page__title">Settings</h1>
      </header>

      <section className="settings__section" aria-labelledby="passkeys-title">
        <h2 id="passkeys-title" className="settings__title">
          Passkeys
        </h2>
        <p className="hint">
          Each device you write on signs in with its own passkey (or one synced from your phone or
          your password manager). There is no password to forget.
        </p>
        <ErrorText error={error} />
        {passkeys === null ? (
          <p className="hint" aria-busy="true">
            Loading…
          </p>
        ) : (
          <ul className="settings__list">
            {passkeys.map((passkey) => (
              <PasskeyRow
                key={`${passkey.id}:${passkey.label}`}
                passkey={passkey}
                ask={ask}
                onChanged={() => void load()}
              />
            ))}
          </ul>
        )}
        <div className="settings__actions">
          <button type="button" className="button" disabled={busy} onClick={add}>
            <Plus aria-hidden />
            {busyLabel(busy, 'Add a passkey on this device', 'Waiting for the passkey…')}
          </button>
        </div>
      </section>

      <section className="settings__section" aria-labelledby="email-title">
        <h2 id="email-title" className="settings__title">
          Email
        </h2>
        {mail === null ? (
          <p className="hint">Checking…</p>
        ) : mail.ready ? (
          <p>
            Set up: readers can subscribe, and each post can be emailed to them once.
            {mail.failed > 0 ? ` ${mail.failed} could not be delivered.` : ''}
          </p>
        ) : (
          <p>
            Not set up yet, so the blog doesn’t offer subscribing. The steps are in the blog’s
            runbook (sites/docs/runbooks/blog-setup.md).
          </p>
        )}
      </section>

      <section className="settings__section" aria-labelledby="session-title">
        <h2 id="session-title" className="settings__title">
          This browser
        </h2>
        <p className="hint">A session lasts a day without use, and a week at most.</p>
        <div className="settings__actions">
          <button type="button" className="button" onClick={signOut}>
            Sign out
          </button>
        </div>
      </section>
      {confirmDialog}
    </div>
  );
}

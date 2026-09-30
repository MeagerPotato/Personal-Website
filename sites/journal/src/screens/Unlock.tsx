/**
 * The lock screen: one button, one passkey prompt. The sign-in challenge is fetched as soon as
 * the screen shows (and refreshed before it expires), so the tap goes straight to the prompt.
 * Offline, the same button unlocks from this device's own copy.
 */
import { useEffect, useState } from 'react';
import {
  UnlockError,
  prepareUnlock,
  unlockWithPassphrase,
  unlockWithPasskey,
  type Unlocked,
  type UnlockTicket,
} from '../account/account';
import { PasskeyError } from '../auth/webauthn';
import { getMeta, type OfflineUnlock } from '../store/db';
import { longDate, today } from '../model/dates';
import { ErrorText, Gate, busyLabel, describe, unlockVerb, useStep } from '../ui/common';
import { Recover } from './Recover';

const REFRESH_MS = 4 * 60 * 1000;

export function Unlock({ onUnlocked }: { onUnlocked: (unlocked: Unlocked) => void }) {
  const [ticket, setTicket] = useState<UnlockTicket | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useStep<'passkey' | 'passphrase' | 'recover'>('passkey');
  const [hasPassphrase, setHasPassphrase] = useState(false);
  /** Bumped to fetch a fresh challenge at once (after one has been used). */
  const [round, setRound] = useState(0);

  useEffect(() => {
    let live = true;
    const prepare = () =>
      prepareUnlock().then(
        (next) => {
          if (live) setTicket(next);
        },
        (caught: unknown) => {
          if (!live) return;
          setTicket(null);
          setError(describe(caught));
        },
      );
    void prepare();
    const timer = setInterval(() => void prepare(), REFRESH_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [round]);

  useEffect(() => {
    void getMeta<OfflineUnlock>('unlock').then((cache) =>
      setHasPassphrase(Boolean(cache?.slots.some((slot) => slot.kind === 'passphrase'))),
    );
  }, []);

  if (mode === 'recover') {
    return <Recover onUnlocked={onUnlocked} onCancel={() => setMode('passkey')} />;
  }

  if (mode === 'passphrase') {
    return (
      <PassphraseUnlock
        online={ticket?.mode === 'online'}
        onUnlocked={onUnlocked}
        onCancel={() => setMode('passkey')}
      />
    );
  }

  const unlock = async () => {
    if (!ticket) return;
    setBusy(true);
    setError(null);
    try {
      onUnlocked(await unlockWithPasskey(ticket));
    } catch (caught) {
      setError(describe(caught));
      if (caught instanceof PasskeyError && caught.problem === 'no-prf') setHasPassphrase(true);
      if (caught instanceof UnlockError && caught.problem === 'no-slot') setMode('recover');
      setRound((n) => n + 1); // the challenge was used (or is suspect): get a fresh one
    } finally {
      setBusy(false);
    }
  };

  return (
    <Gate title="Journal" lede={longDate(today())}>
      <button
        type="button"
        className="button button--primary button--large button--block"
        disabled={busy || !ticket}
        onClick={() => void unlock()}
      >
        {busyLabel(busy, unlockVerb(), 'Unlocking…')}
      </button>
      {ticket?.mode === 'offline' ? (
        <p className="hint center">Offline: unlocking this device’s own copy.</p>
      ) : null}
      <ErrorText error={error} />
      <div className="gate__links">
        {hasPassphrase ? (
          <button
            type="button"
            className="button button--quiet"
            onClick={() => setMode('passphrase')}
          >
            Use passphrase
          </button>
        ) : null}
        <button type="button" className="button button--quiet" onClick={() => setMode('recover')}>
          Use recovery phrase
        </button>
      </div>
    </Gate>
  );
}

function PassphraseUnlock(props: {
  online: boolean;
  onUnlocked: (unlocked: Unlocked) => void;
  onCancel: () => void;
}) {
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Gate
      title="Passphrase"
      lede="Unlocking takes a second or two: the passphrase is stretched on purpose."
    >
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          unlockWithPassphrase(passphrase, props.online)
            .then(props.onUnlocked)
            .catch((caught: unknown) => setError(describe(caught)))
            .finally(() => setBusy(false));
        }}
      >
        <label className="field">
          <span>Passphrase</span>
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
            required
          />
        </label>
        <button
          type="submit"
          className="button button--primary button--large button--block"
          disabled={busy}
        >
          {busyLabel(busy, 'Unlock', 'Unlocking…')}
        </button>
        <button
          type="button"
          className="button button--quiet button--block"
          onClick={props.onCancel}
        >
          Back
        </button>
        <ErrorText error={error} />
      </form>
    </Gate>
  );
}

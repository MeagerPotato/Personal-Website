/**
 * The recovery phrase: for a new device (or after losing every passkey). The 24 words open the
 * account key here, on the device; the server only learns that the phrase was right (from a
 * value derived from it). Then this device gets its own passkey, exactly as in setup.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  beginRecovery,
  createRecoveryPasskey,
  forget,
  prepareOnlineUnlock,
  sealPasskeySlot,
  type RecoveryTicket,
  type Unlocked,
  type UnlockTicket,
} from '../account/account';
import { isRecoveryPhrase, isRecoveryWord, normalizePhrase } from '../vault/recovery';
import { ErrorText, Gate, busyLabel, describe, deviceName } from '../ui/common';

export function Recover(props: { onUnlocked: (unlocked: Unlocked) => void; onCancel: () => void }) {
  const [phrase, setPhrase] = useState('');
  const [ticket, setTicket] = useState<RecoveryTicket | null>(null);
  const [step, setStep] = useState<'phrase' | 'passkey' | 'finish'>('phrase');
  const [unlockTicket, setUnlockTicket] = useState<Extract<
    UnlockTicket,
    { mode: 'online' }
  > | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!ticket) return undefined;
    return () => forget(ticket.raw);
  }, [ticket]);

  const words = useMemo(() => normalizePhrase(phrase).split(' ').filter(Boolean), [phrase]);
  const unknown = words.filter((word) => !isRecoveryWord(word));
  const complete = words.length === 24 && unknown.length === 0;

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (caught) {
      setError(describe(caught));
    } finally {
      setBusy(false);
    }
  };

  if (step === 'passkey' && ticket) {
    return (
      <Gate
        title="Make a passkey here"
        lede={`The phrase checks out. Now your ${deviceName()} gets its own passkey, so next time it unlocks with one tap.`}
      >
        <button
          type="button"
          className="button button--primary button--large button--block"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await createRecoveryPasskey(ticket, deviceName());
              setUnlockTicket(await prepareOnlineUnlock());
              setStep('finish');
            })
          }
        >
          {busyLabel(busy, 'Make a passkey', 'Waiting for your passkey…')}
        </button>
        <ErrorText error={error} />
      </Gate>
    );
  }

  if (step === 'finish' && ticket) {
    return (
      <Gate
        title="Unlock once to finish"
        lede="The new passkey unlocks the journal for the first time."
      >
        <button
          type="button"
          className="button button--primary button--large button--block"
          disabled={busy || !unlockTicket}
          onClick={() =>
            unlockTicket &&
            run(async () => {
              const unlocked = await sealPasskeySlot(unlockTicket, ticket.raw, ticket.akId).catch(
                async (caught: unknown) => {
                  setUnlockTicket(await prepareOnlineUnlock().catch(() => null));
                  throw caught;
                },
              );
              props.onUnlocked(unlocked);
            })
          }
        >
          {busyLabel(busy, 'Unlock', 'Unlocking…')}
        </button>
        <ErrorText error={error} />
      </Gate>
    );
  }

  return (
    <Gate
      title="Recovery phrase"
      lede="Type your 24 words, in order, separated by spaces. Capitals and line breaks don’t matter."
    >
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (!isRecoveryPhrase(phrase)) {
            setError('That phrase isn’t right: a word may be misspelled or out of order.');
            return;
          }
          void run(async () => {
            setTicket(await beginRecovery(phrase));
            setStep('passkey');
          });
        }}
      >
        <label className="field">
          <span>
            Words: {words.length} of 24
            {unknown.length > 0 ? ` · not in the list: ${unknown.slice(0, 3).join(', ')}` : ''}
          </span>
          <textarea
            className="input phrase-input"
            rows={5}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={phrase}
            onChange={(event) => setPhrase(event.target.value)}
            required
          />
        </label>
        <button
          type="submit"
          className="button button--primary button--large button--block"
          disabled={busy || !complete}
        >
          {busyLabel(busy, 'Continue', 'Checking…')}
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

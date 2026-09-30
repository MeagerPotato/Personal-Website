/**
 * First run: the setup code, the recovery phrase (shown once, confirmed), the first passkey, and
 * one unlock to prove it works. Nothing is stored on the server until the passkey exists, and
 * the phrase never leaves this screen except on paper.
 */
import { useEffect, useState, type FormEvent } from 'react';
import {
  beginSetup,
  createFirstPasskey,
  forget,
  prepareOnlineUnlock,
  sealPasskeySlot,
  type SetupTicket,
  type Unlocked,
  type UnlockTicket,
} from '../account/account';
import { passkeySupport } from '../auth/webauthn';
import { normalizePhrase } from '../vault/recovery';
import { ErrorText, Gate, busyLabel, describe, deviceName } from '../ui/common';

type Step = 'code' | 'phrase' | 'confirm' | 'passkey' | 'finish';

/** Three word positions to check, different each time. */
function pickPositions(): number[] {
  const picked = new Set<number>();
  const random = new Uint32Array(8);
  crypto.getRandomValues(random);
  for (const value of random) {
    if (picked.size === 3) break;
    picked.add(value % 24);
  }
  while (picked.size < 3) picked.add(picked.size * 8);
  return [...picked].sort((a, b) => a - b);
}

export function Setup({ onUnlocked }: { onUnlocked: (unlocked: Unlocked) => void }) {
  const [step, setStep] = useState<Step>('code');
  const [ticket, setTicket] = useState<SetupTicket | null>(null);
  const [unlockTicket, setUnlockTicket] = useState<Extract<
    UnlockTicket,
    { mode: 'online' }
  > | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [support, setSupport] = useState<{ platform: boolean; prf: boolean | null } | null>(null);

  useEffect(() => {
    void passkeySupport().then(setSupport);
  }, []);

  // Drop the key bytes when this screen goes away, finished or not.
  useEffect(() => {
    if (!ticket) return undefined;
    return () => forget(ticket.raw);
  }, [ticket]);

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

  if (step === 'code') {
    return (
      <CodeStep
        busy={busy}
        error={error}
        unsupported={support !== null && (!support.platform || support.prf === false)}
        onSubmit={(code) =>
          run(async () => {
            setTicket(await beginSetup(code));
            setStep('phrase');
          })
        }
      />
    );
  }

  if (!ticket) return null;

  if (step === 'phrase') {
    return <PhraseStep phrase={ticket.phrase} onNext={() => setStep('confirm')} />;
  }

  if (step === 'confirm') {
    return (
      <ConfirmStep
        phrase={ticket.phrase}
        onBack={() => setStep('phrase')}
        onNext={() => setStep('passkey')}
      />
    );
  }

  if (step === 'passkey') {
    return (
      <Gate
        title="Make your passkey"
        lede={`Your ${deviceName()} keeps a passkey for the journal and unlocks it with your face, fingerprint or PIN. Nothing about it is ever sent to the server.`}
      >
        <button
          type="button"
          className="button button--primary button--large button--block"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await createFirstPasskey(ticket, deviceName());
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

  return (
    <Gate
      title="Unlock once to finish"
      lede="One more prompt: the passkey unlocks the journal for the first time, which proves it works before you rely on it."
      mood={5}
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
                // A challenge is single-use: get a fresh one for the next try.
                setUnlockTicket(await prepareOnlineUnlock().catch(() => null));
                throw caught;
              },
            );
            onUnlocked(unlocked);
          })
        }
      >
        {busyLabel(busy, 'Unlock', 'Unlocking…')}
      </button>
      <ErrorText error={error} />
    </Gate>
  );
}

function CodeStep(props: {
  busy: boolean;
  error: string | null;
  unsupported: boolean;
  onSubmit: (code: string) => void;
}) {
  const [code, setCode] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (code.trim()) props.onSubmit(code.trim());
  };
  return (
    <Gate
      title="Set up your journal"
      lede="Everything you write is encrypted on your devices before it goes anywhere. The server stores it, but can never read it."
    >
      {props.unsupported ? (
        <p className="callout" data-family="coral">
          <span aria-hidden="true">⚠️</span>
          <span>
            This browser can’t unlock the journal with a passkey. Use Safari on an iPhone, iPad or
            Mac, or Edge or Chrome on Windows.
          </span>
        </p>
      ) : null}
      <form className="stack" onSubmit={submit}>
        <label className="field">
          <span>Setup code</span>
          <input
            className="input"
            name="code"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            required
          />
        </label>
        <p className="hint">
          The code set as the <code>SETUP_TOKEN</code> secret. It is needed once, so nobody else can
          claim the journal first.
        </p>
        <button
          type="submit"
          className="button button--primary button--large button--block"
          disabled={props.busy}
        >
          {busyLabel(props.busy, 'Continue', 'Checking…')}
        </button>
        <ErrorText error={props.error} />
      </form>
    </Gate>
  );
}

function PhraseStep({ phrase, onNext }: { phrase: string; onNext: () => void }) {
  const [saved, setSaved] = useState(false);
  const words = phrase.split(' ');
  return (
    <Gate
      title="Your recovery phrase"
      lede="If you ever lose every device with a passkey, these 24 words are the only way back in. Nobody can reset them for you, not even the server."
    >
      <ol className="phrase" aria-label="Recovery phrase">
        {words.map((word, index) => (
          <li key={index}>
            <span className="phrase__n">{index + 1}</span>
            <span className="phrase__word">{word}</span>
          </li>
        ))}
      </ol>
      <div className="row">
        <button type="button" className="button" onClick={() => print()}>
          Print
        </button>
        <p className="hint">Write it on paper, or print it. Keep it somewhere safe and offline.</p>
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={saved}
          onChange={(event) => setSaved(event.target.checked)}
        />
        <span>I’ve written down all 24 words</span>
      </label>
      <button
        type="button"
        className="button button--primary button--large button--block"
        disabled={!saved}
        onClick={onNext}
      >
        Continue
      </button>
    </Gate>
  );
}

function ConfirmStep(props: { phrase: string; onBack: () => void; onNext: () => void }) {
  const [positions] = useState(pickPositions);
  const words = props.phrase.split(' ');
  const [answers, setAnswers] = useState<string[]>(['', '', '']);
  const [error, setError] = useState<string | null>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const right = positions.every(
      (position, i) => normalizePhrase(answers[i] ?? '') === words[position],
    );
    if (right) props.onNext();
    else setError('Those words don’t match. Check what you wrote down.');
  };
  return (
    <Gate title="Check your phrase" lede="Type these words from what you wrote down.">
      <form className="stack" onSubmit={submit}>
        {positions.map((position, i) => (
          <label className="field" key={position}>
            <span>Word {position + 1}</span>
            <input
              className="input"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={answers[i]}
              onChange={(event) =>
                setAnswers(answers.map((answer, j) => (j === i ? event.target.value : answer)))
              }
              required
            />
          </label>
        ))}
        <button type="submit" className="button button--primary button--large button--block">
          Continue
        </button>
        <button type="button" className="button button--quiet button--block" onClick={props.onBack}>
          Show the phrase again
        </button>
        <ErrorText error={error} />
      </form>
    </Gate>
  );
}

/** Before the studio opens: making its first passkey, and signing in. */
import { useState } from 'react';
import { setUpStudio, signIn, signInVerb } from '../passkeys';
import { useTitle } from '../router';
import { busyLabel, describe, ErrorText, Gate } from '../ui/common';

export function SetUp({ onDone }: { onDone: () => void }) {
  useTitle('Set up');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Gate
      title="Set up the studio"
      lede="The studio is where the blog is written. It has no password: this device makes a passkey, and signing in is your fingerprint, face or PIN."
    >
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          setUpStudio(code)
            .then(onDone)
            .catch((caught: unknown) => setError(describe(caught)))
            .finally(() => setBusy(false));
        }}
      >
        <label className="field">
          <span>Setup code</span>
          <input
            className="input"
            name="code"
            value={code}
            autoComplete="off"
            spellCheck={false}
            required
            onChange={(event) => setCode(event.target.value)}
          />
        </label>
        <p className="hint">
          The SETUP_TOKEN from the blog’s settings in Cloudflare (its runbook says where).
        </p>
        <ErrorText error={error} />
        <button
          type="submit"
          className="button button--primary button--large button--block"
          disabled={busy}
        >
          {busyLabel(busy, 'Create a passkey', 'Waiting for the passkey…')}
        </button>
      </form>
    </Gate>
  );
}

export function SignIn({ onDone }: { onDone: () => void }) {
  useTitle('Sign in');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Gate title="Studio" lede="Where the blog is written. Sign in with a passkey made for it.">
      <div className="stack">
        <ErrorText error={error} />
        <button
          type="button"
          className="button button--primary button--large button--block"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError(null);
            signIn()
              .then(onDone)
              .catch((caught: unknown) => setError(describe(caught)))
              .finally(() => setBusy(false));
          }}
        >
          {busyLabel(busy, signInVerb(), 'Signing in…')}
        </button>
        <a className="gate__back" href="/">
          Back to the blog
        </a>
      </div>
    </Gate>
  );
}

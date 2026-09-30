/**
 * The gate: what shows depends on whether the studio has a passkey yet and whether this browser
 * is signed in.
 *
 *   setup        no passkey yet: the first one is made with the setup code (screens/Gates)
 *   signed-out   sign in with a passkey
 *   signed-in    the studio (Shell). If the session ends while it is open (a 401 anywhere), the
 *                passkey is asked for again over it, so nothing on screen is lost.
 */
import { useEffect, useRef, useState } from 'react';
import { api, onSignedOut, signedInAgain } from './api';
import { signIn, signInVerb } from './passkeys';
import { SetUp, SignIn } from './screens/Gates';
import { Shell } from './Shell';
import { busyLabel, describe, ErrorText, Gate } from './ui/common';

type GateState =
  | { state: 'loading' }
  | { state: 'setup' }
  | { state: 'signed-out' }
  | { state: 'signed-in' }
  | { state: 'unavailable'; message: string };

export function App() {
  const [gate, setGate] = useState<GateState>({ state: 'loading' });
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    let live = true;
    api.state().then(
      (state) => {
        if (!live) return;
        if (state.signedIn) setGate({ state: 'signed-in' });
        else setGate({ state: state.setUp ? 'signed-out' : 'setup' });
      },
      (error: unknown) => {
        if (live) setGate({ state: 'unavailable', message: describe(error) });
      },
    );
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => onSignedOut(() => setExpired(true)), []);

  switch (gate.state) {
    case 'loading':
      return <main className="gate" aria-busy="true" />;
    case 'setup':
      return <SetUp onDone={() => setGate({ state: 'signed-in' })} />;
    case 'signed-out':
      return <SignIn onDone={() => setGate({ state: 'signed-in' })} />;
    case 'unavailable':
      return (
        <Gate title="Studio" lede={`The blog’s server isn’t answering (${gate.message}).`}>
          <button
            type="button"
            className="button button--large button--block"
            onClick={() => location.reload()}
          >
            Try again
          </button>
        </Gate>
      );
    case 'signed-in':
      return (
        <>
          <Shell onSignOut={() => setGate({ state: 'signed-out' })} />
          {expired ? (
            <SignInAgain
              onDone={() => {
                setExpired(false);
                signedInAgain();
              }}
            />
          ) : null}
        </>
      );
  }
}

/** The session ended while the studio was open: the passkey again, over everything. */
function SignInAgain({ onDone }: { onDone: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="sheet dialog"
      aria-labelledby="signed-out-title"
      // Not dismissable: without a session nothing can be saved.
      onCancel={(event) => event.preventDefault()}
    >
      <div className="dialog__body">
        <h2 id="signed-out-title" className="dialog__title">
          Signed out
        </h2>
        <p className="dialog__text">
          The studio’s session ended. Sign in again to carry on: everything on screen is kept, and
          saves as soon as you’re back.
        </p>
        <ErrorText error={error} />
        <div className="dialog__actions">
          <button
            type="button"
            className="button button--primary"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError(null);
              signIn()
                .then(() => {
                  dialog.current?.close();
                  onDone();
                })
                .catch((caught: unknown) => setError(describe(caught)))
                .finally(() => setBusy(false));
            }}
          >
            {busyLabel(busy, signInVerb(), 'Signing in…')}
          </button>
        </div>
      </div>
    </dialog>
  );
}

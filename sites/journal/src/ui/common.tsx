/** Small pieces every screen uses: the gate layout, error text, device names, error wording. */
import type { ReactNode } from 'react';
import { ApiError, OfflineError } from '../api/client';
import { UnlockError } from '../account/account';
import { PasskeyError } from '../auth/webauthn';
import { Bean } from './Bean';

/** The screens before the journal opens: one calm column, a bean at the top. */
export function Gate({
  title,
  lede,
  children,
  mood = 4,
}: {
  title: string;
  lede?: ReactNode;
  children: ReactNode;
  mood?: number;
}) {
  return (
    <main className="gate">
      <div className="gate__column">
        <Bean
          mood={mood}
          family={mood === 5 ? 'butter' : 'mint'}
          size={56}
          className="gate__bean"
        />
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
  if (error instanceof PasskeyError) {
    if (error.problem === 'cancelled') return 'The prompt was closed. Try again when you’re ready.';
    return error.message;
  }
  if (error instanceof OfflineError) return 'You’re offline. Connect and try again.';
  if (error instanceof ApiError || error instanceof UnlockError) return error.message;
  if (error instanceof RangeError) return error.message;
  console.error(error);
  return 'Something went wrong. Try again.';
}

/** This device, in words: the label a new passkey gets ("iPhone", "Windows laptop"). */
export function deviceName(): string {
  const agent = navigator.userAgent;
  if (/iPhone/.test(agent)) return 'iPhone';
  if (/iPad/.test(agent) || (/Macintosh/.test(agent) && navigator.maxTouchPoints > 1))
    return 'iPad';
  if (/Macintosh/.test(agent)) return 'Mac';
  if (/Windows/.test(agent)) return 'Windows';
  if (/Android/.test(agent)) return 'Android';
  if (/Linux/.test(agent)) return 'Linux';
  return 'This device';
}

/** What the unlock button should say on this device. */
export function unlockVerb(): string {
  const device = deviceName();
  if (device === 'iPhone' || device === 'iPad') return 'Unlock with Face ID';
  if (device === 'Mac') return 'Unlock with Touch ID';
  if (device === 'Windows') return 'Unlock with Windows Hello';
  return 'Unlock with your passkey';
}

/** A spinner-free busy label: the button says what it is doing. */
export function busyLabel(busy: boolean, idle: string, working: string): string {
  return busy ? working : idle;
}

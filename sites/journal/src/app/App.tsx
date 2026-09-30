/**
 * The gate: what shows depends on whether the journal exists and whether it is unlocked.
 *
 *   setup      the server has no account yet: first run (screens/Setup)
 *   locked     the lock screen (screens/Unlock), online or from this device's copy
 *   unlocked   the journal (Shell), until it is locked by hand or by time
 *
 * Locking drops the Journal object, and with it the keys and every decrypted record. Either way
 * round, the next screen's title takes the focus (@allenkh/design/focus).
 */
import { focusNextTitle } from '@allenkh/design/focus';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { OfflineError, api } from '../api/client';
import type { Unlocked } from '../account/account';
import { Journal } from '../journal/journal';
import { getMeta, persist, type OfflineUnlock } from '../store/db';
import { Setup } from '../screens/Setup';
import { Unlock } from '../screens/Unlock';
import { Gate } from '../ui/common';
import { SessionProvider } from './context';
import { preloadDay } from './Screen';
import { Shell } from './Shell';

type GateState =
  | { state: 'loading' }
  | { state: 'setup' }
  | { state: 'locked' }
  | { state: 'unlocked'; journal: Journal }
  | { state: 'unavailable'; message: string };

/** Unlocked for longer than this, the journal locks itself even while in use. */
const MAX_UNLOCKED_MS = 12 * 60 * 60 * 1000;

async function boot(): Promise<GateState> {
  try {
    const state = await api.state();
    return state.account ? { state: 'locked' } : { state: 'setup' };
  } catch (error) {
    const cache = await getMeta<OfflineUnlock>('unlock').catch(() => undefined);
    if (cache) return { state: 'locked' };
    return {
      state: 'unavailable',
      message:
        error instanceof OfflineError
          ? 'You’re offline, and this device hasn’t opened the journal before. Connect once to set it up.'
          : 'The journal’s server isn’t answering. Try again in a moment.',
    };
  }
}

export function App() {
  const [gate, setGate] = useState<GateState>({ state: 'loading' });
  const unlockedAt = useRef(0);

  useEffect(() => {
    void boot().then(setGate);
    preloadDay();
  }, []);

  const open = useCallback(async (unlocked: Unlocked) => {
    const journal = await Journal.open(unlocked.keys, unlocked.online);
    unlockedAt.current = Date.now();
    void persist();
    focusNextTitle();
    setGate({ state: 'unlocked', journal });
  }, []);

  const journal = gate.state === 'unlocked' ? gate.journal : null;

  const lock = useCallback(() => {
    if (!journal) return;
    focusNextTitle();
    setGate({ state: 'locked' });
    void journal.close();
  }, [journal]);

  // Lock after enough time in the background (Settings: auto-lock), or after a long session.
  useEffect(() => {
    if (!journal) return undefined;
    let hiddenAt: number | null = null;
    const check = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        return;
      }
      const limit = journal.settings().autoLockMinutes * 60_000;
      const away = hiddenAt === null ? 0 : Date.now() - hiddenAt;
      hiddenAt = null;
      if (away >= limit || Date.now() - unlockedAt.current >= MAX_UNLOCKED_MS) lock();
    };
    document.addEventListener('visibilitychange', check);
    const timer = setInterval(() => {
      if (Date.now() - unlockedAt.current >= MAX_UNLOCKED_MS) lock();
    }, 60_000);
    return () => {
      document.removeEventListener('visibilitychange', check);
      clearInterval(timer);
    };
  }, [journal, lock]);

  const session = useMemo(() => (journal ? { journal, lock } : null), [journal, lock]);

  switch (gate.state) {
    case 'loading':
      return <main className="gate" aria-busy="true" />;
    case 'setup':
      return <Setup onUnlocked={(unlocked) => void open(unlocked)} />;
    case 'locked':
      return <Unlock onUnlocked={(unlocked) => void open(unlocked)} />;
    case 'unavailable':
      return (
        <Gate title="Journal" lede={gate.message} mood={3}>
          <button
            type="button"
            className="button button--large button--block"
            onClick={() => location.reload()}
          >
            Try again
          </button>
        </Gate>
      );
    case 'unlocked':
      return session ? (
        <SessionProvider value={session}>
          <Shell />
        </SessionProvider>
      ) : null;
  }
}

/**
 * The unlocked journal, for every screen: `useJournal()` returns it and re-renders the caller
 * whenever a record or the sync status changes. Screens read typed records from it and call its
 * save methods; nothing else talks to the vault.
 */
import { createContext, use, useSyncExternalStore, type ReactNode } from 'react';
import type { Journal } from '../journal/journal';

interface Session {
  journal: Journal;
  /** Locks now: saves, drops the keys, shows the unlock screen. */
  lock: () => void;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ value, children }: { value: Session; children: ReactNode }) {
  return <SessionContext value={value}>{children}</SessionContext>;
}

function useSession(): Session {
  const session = use(SessionContext);
  if (!session) throw new Error('useJournal() outside an unlocked journal');
  return session;
}

/** The journal, subscribed: the caller re-renders on every change. */
export function useJournal(): Journal {
  const { journal } = useSession();
  useSyncExternalStore(journal.subscribe, journal.snapshot);
  return journal;
}

export function useLock(): () => void {
  return useSession().lock;
}

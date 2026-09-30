/**
 * Signing out, from the sidebar or from Settings. Whatever is written is saved first: signed out,
 * it could not be. And the studio signs out only once the blog has ended the session: if the blog
 * cannot be told (no connection), the studio stays as it is and says so, because looking signed
 * out while the session lives on would leave the studio open to whoever uses this browser next.
 */
import type { ReactNode } from 'react';
import { api, ApiError } from './api';
import { DraftSession } from './screens/post/session';
import { describe, useConfirm } from './ui/common';

/** Ends the session; throws if the blog could not end it. */
export async function signOut(): Promise<void> {
  await DraftSession.saveAll().catch(() => undefined);
  try {
    await api.logout();
  } catch (error) {
    // A session that had already ended is as good as ended.
    if (!(error instanceof ApiError && error.status === 401)) throw error;
  }
}

/** Why the browser is still signed in. */
function stillSignedIn(error: unknown): string {
  return error instanceof ApiError && error.status === 0
    ? 'The blog can’t be reached, so this browser is still signed in. Try again once you’re online.'
    : `The blog couldn’t end the session (${describe(error)}), so this browser is still signed in.`;
}

/**
 * A sign-out button: `start()` signs out and then calls `done`; if the blog cannot be told, a
 * dialog says so and offers to try again. Render `dialog` anywhere on the screen.
 */
export function useSignOut(done: () => void): { dialog: ReactNode; start: () => void } {
  const [dialog, ask] = useConfirm();
  const attempt = async (): Promise<void> => {
    try {
      await signOut();
    } catch (error) {
      const again = await ask({
        title: 'Not signed out',
        body: stillSignedIn(error),
        confirm: 'Try again',
      });
      if (again) await attempt();
      return;
    }
    done();
  };
  return { dialog, start: () => void attempt() };
}

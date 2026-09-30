/**
 * The daily reminder on this device (the server's half: worker/routes/push.ts, worker/lib/push.ts).
 * A push subscription belongs to the service worker, so reminders need the installed app's
 * worker (production builds only: src/pwa.ts); and on iPhone and iPad, the app added to the Home
 * Screen, because Safari offers push to nothing else there.
 */
import { api } from './api/client';
import { fromBase64Url } from './vault/bytes';

/** 'install': an iPhone or iPad in a Safari tab, where reminders need the Home Screen app. */
export type ReminderSupport = 'ok' | 'install' | 'unsupported';

export function reminderSupport(): ReminderSupport {
  if ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window) {
    return 'ok';
  }
  const iPad = /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1;
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || iPad ? 'install' : 'unsupported';
}

export class ReminderError extends Error {
  override name = 'ReminderError';
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const found = await navigator.serviceWorker.getRegistration();
  if (!found) throw new ReminderError('The app is still installing. Try again in a moment.');
  return found;
}

/** This device's push subscription, if it has one. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  const found = await navigator.serviceWorker.getRegistration();
  return (await found?.pushManager.getSubscription()) ?? null;
}

const sameKey = (subscription: PushSubscription, key: Uint8Array): boolean => {
  const current = subscription.options.applicationServerKey;
  if (!current) return false;
  const bytes = new Uint8Array(current);
  return bytes.length === key.length && bytes.every((byte, i) => byte === key[i]);
};

/**
 * Turns this device's reminder on, or moves it to a new time. The first time, the browser asks
 * whether the journal may show notifications (it must be asked from a tap, as here).
 */
export async function enableReminder(remindAt: string, publicKey: string): Promise<string> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new ReminderError(
      'Notifications are turned off for the journal. Allow them in this browser’s settings, then try again.',
    );
  }
  const worker = await registration();
  const key = fromBase64Url(publicKey);
  let subscription = await worker.pushManager.getSubscription();
  // Made for another server key (the server was set up again): it would never be delivered.
  if (subscription && !sameKey(subscription, key)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await worker.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: key,
  });
  await api.setReminder({
    endpoint: subscription.endpoint,
    remindAt,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  return subscription.endpoint;
}

/** Turns this device's reminder off: the server forgets it, and the browser drops the address. */
export async function disableReminder(): Promise<void> {
  const subscription = await currentSubscription();
  if (!subscription) return;
  await api.removeReminder(subscription.endpoint);
  await subscription.unsubscribe();
}

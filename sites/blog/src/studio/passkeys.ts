/**
 * The passkey ceremonies, through @simplewebauthn/browser, with the API's two halves around each;
 * and signing out.
 */
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { api } from './api';
import { DraftSession } from './screens/post/session';

type CreationOptions = Parameters<typeof startRegistration>[0]['optionsJSON'];
type RequestOptions = Parameters<typeof startAuthentication>[0]['optionsJSON'];

/** A short name for this device's passkey ("Mac", "iPhone"), editable later in Settings. */
export function deviceLabel(): string {
  const agent = navigator.userAgent;
  if (/iPhone/.test(agent)) return 'iPhone';
  // An iPad says it is a Mac, but a Mac has no touch screen.
  if (/iPad/.test(agent) || (/Macintosh/.test(agent) && navigator.maxTouchPoints > 1))
    return 'iPad';
  if (/Macintosh/.test(agent)) return 'Mac';
  if (/Windows/.test(agent)) return 'Windows';
  if (/Android/.test(agent)) return 'Android';
  if (/Linux/.test(agent)) return 'Linux';
  return 'This device';
}

/** What the sign-in button should say on this device. */
export function signInVerb(): string {
  const device = deviceLabel();
  if (device === 'iPhone' || device === 'iPad') return 'Sign in with Face ID';
  if (device === 'Mac') return 'Sign in with Touch ID';
  if (device === 'Windows') return 'Sign in with Windows Hello';
  return 'Sign in with your passkey';
}

export async function setUpStudio(token: string): Promise<void> {
  const begin = await api.setupBegin(token);
  const response = await startRegistration({
    optionsJSON: begin.options as unknown as CreationOptions,
  });
  await api.setupFinish({ token, challengeId: begin.challengeId, response, label: deviceLabel() });
}

export async function signIn(): Promise<void> {
  const begin = await api.loginBegin();
  const response = await startAuthentication({
    optionsJSON: begin.options as unknown as RequestOptions,
  });
  await api.loginFinish({ challengeId: begin.challengeId, response });
}

/** Ends the session, once whatever is written has been saved if it can be: signed out, it cannot. */
export async function signOut(): Promise<void> {
  await DraftSession.saveAll().catch(() => undefined);
  await api.logout().catch(() => undefined);
}

export async function addPasskey(label: string): Promise<void> {
  const begin = await api.passkeyBegin();
  const response = await startRegistration({
    optionsJSON: begin.options as unknown as CreationOptions,
  });
  await api.passkeyFinish({ challengeId: begin.challengeId, response, label });
}

/** A passkey prompt the person closed is not an error to shout about. */
export const cancelled = (error: unknown): boolean =>
  error instanceof Error && (error.name === 'NotAllowedError' || error.name === 'AbortError');

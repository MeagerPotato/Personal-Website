/**
 * Additional authenticated data: what every ciphertext is bound to, so that the server (which
 * stores them all) cannot move one to where another belongs. A record sealed as version 7 of
 * record X only opens as version 7 of record X; a key slot only opens as that slot.
 *
 * The strings are part of the storage format: changing one makes existing data unreadable. Add a
 * new version prefix instead.
 */
import { encodeUtf8 } from './bytes';

const APP = 'allenkh-journal';

export type SlotKind = 'passkey' | 'passphrase' | 'recovery';

export const aad = {
  /** The account key, wrapped by one unlock method. */
  slot: (kind: SlotKind, slotId: string, akId: string) =>
    encodeUtf8(`${APP}:v1:slot:${kind}:${slotId}:${akId}`),

  /** A record's own key, wrapped by the account key. */
  recordKey: (recordId: string, rev: number) =>
    encodeUtf8(`${APP}:v1:record-key:${recordId}:${rev}`),

  /** A record's content, under its own key. */
  record: (recordId: string, rev: number) => encodeUtf8(`${APP}:v1:record:${recordId}:${rev}`),

  /** One chunk of a file (a photo, a thumbnail). `final` stops a file being cut short. */
  blobChunk: (blobId: string, index: number, final: boolean) =>
    encodeUtf8(`${APP}:v1:blob:${blobId}:${index}:${final ? 'final' : 'more'}`),
} as const;

/** HKDF labels: one purpose, one label. */
export const info = {
  kekPasskey: (credentialId: string) => encodeUtf8(`${APP}:v1:kek:passkey:${credentialId}`),
  kekPassphrase: encodeUtf8(`${APP}:v1:kek:passphrase`),
  kekRecovery: encodeUtf8(`${APP}:v1:kek:recovery`),
  /** What the server keeps a hash of, so the recovery phrase can prove who you are. */
  recoveryAuth: encodeUtf8(`${APP}:v1:recovery-auth`),
  recordWrap: encodeUtf8(`${APP}:v1:ak:record-wrap`),
  ids: encodeUtf8(`${APP}:v1:ak:ids`),
  manifest: encodeUtf8(`${APP}:v1:ak:manifest`),
} as const;

/** HKDF salt. Fixed and public: every input it stretches is already high-entropy key material. */
export const HKDF_SALT = encodeUtf8(`${APP}:v1:hkdf-salt`);

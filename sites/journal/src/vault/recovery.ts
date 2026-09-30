/**
 * The recovery phrase: 24 English BIP39 words, 256 bits of entropy plus an 8-bit checksum, so a
 * mistyped word is caught before any decryption is tried. Printed at setup and kept offline: it
 * is the one unlock method that does not depend on a device or a passkey provider.
 */
import {
  entropyToMnemonic,
  generateMnemonic,
  mnemonicToEntropy,
  validateMnemonic,
} from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

const STRENGTH_BITS = 256;

/** Lower-case, single spaces, no stray punctuation: how a phrase is compared and stored. */
export function normalizePhrase(input: string): string {
  return input
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .join(' ');
}

export const newRecoveryPhrase = (): string => generateMnemonic(wordlist, STRENGTH_BITS);

export const isRecoveryPhrase = (input: string): boolean => {
  const phrase = normalizePhrase(input);
  return phrase.split(' ').length === 24 && validateMnemonic(phrase, wordlist);
};

/** The phrase's 32 bytes of entropy. Throws on a wrong word or a failed checksum. */
export function recoveryEntropy(input: string): Uint8Array<ArrayBuffer> {
  const phrase = normalizePhrase(input);
  if (!isRecoveryPhrase(phrase)) throw new RangeError('That is not a valid recovery phrase');
  return new Uint8Array(mnemonicToEntropy(phrase, wordlist));
}

/** Only for tests and for re-showing a phrase made from known entropy. */
export const phraseFromEntropy = (entropy: Uint8Array): string =>
  entropyToMnemonic(entropy, wordlist);

/** A word from the English list, for checking one word at a time as it is typed. */
export const isRecoveryWord = (word: string): boolean => wordlist.includes(word.toLowerCase());

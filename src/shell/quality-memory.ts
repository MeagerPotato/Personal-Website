// A device that needed a lower quality tier starts there on its next page, so that a visit is
// probed (and blinks) once, not on every hard navigation. The memory fades: a laptop that was busy
// installing updates that one time gets another chance a week later, at the price of one probe.

import type { QualityTier } from '../universe/api';

const KEY = 'quality';
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function asTier(value: string | null | undefined): QualityTier | undefined {
  return value === 'low' || value === 'medium' || value === 'high' ? value : undefined;
}

/** `store` is a function because merely touching `localStorage` throws where storage is blocked. */
export function rememberTier(store: () => Store, tier: QualityTier, nowMs: number): void {
  try {
    store().setItem(KEY, `${tier}@${Math.round(nowMs)}`);
  } catch {
    // storage blocked or full: the probe simply runs again next time
  }
}

export function recallTier(store: () => Store, nowMs: number): QualityTier | undefined {
  try {
    const [name, at] = (store().getItem(KEY) ?? '').split('@');
    const tier = asTier(name);
    const age = nowMs - Number(at);
    if (tier && age >= 0 && age < KEEP_MS) return tier;
    store().removeItem(KEY);
  } catch {
    // storage blocked: every visit starts from the device's default
  }
  return undefined;
}

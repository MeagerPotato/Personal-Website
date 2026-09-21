import { describe, expect, it } from 'vitest';
import { tuning } from '../../design/tuning';
import { createRng } from '../../sim/rng';
import { FrameGovernor, type GovernorAction } from './governor';
import { TIERS, isTier, lowerTier, startingTier } from './tiers';

describe('quality tiers', () => {
  it('starts desktops high and phones medium', () => {
    expect(startingTier({ coarsePointer: false }, null)).toBe('high');
    expect(startingTier({ coarsePointer: true }, null)).toBe('medium');
  });

  it('starts a machine that says it is small one tier lower', () => {
    expect(startingTier({ coarsePointer: false, deviceMemory: 2 }, null)).toBe('medium');
    expect(startingTier({ coarsePointer: true, hardwareConcurrency: 2 }, null)).toBe('low');
    expect(
      startingTier({ coarsePointer: true, deviceMemory: 8, hardwareConcurrency: 8 }, null),
    ).toBe('medium');
  });

  it('never starts above the tier the device was demoted to, and never promotes', () => {
    expect(startingTier({ coarsePointer: false }, 'low')).toBe('low');
    expect(startingTier({ coarsePointer: false }, 'medium')).toBe('medium');
    expect(startingTier({ coarsePointer: true }, 'high')).toBe('medium');
  });

  it('knows its own names', () => {
    expect(TIERS.every(isTier)).toBe(true);
    expect(isTier('ultra')).toBe(false);
    expect(lowerTier('high')).toBe('medium');
    expect(lowerTier('medium')).toBe('low');
    expect(lowerTier('low')).toBeNull();
  });

  it('has settings for every tier, each no more demanding than the next', () => {
    const { tiers } = tuning.quality;
    expect(tiers.low.maxMegapixels).toBeLessThanOrEqual(tiers.medium.maxMegapixels);
    expect(tiers.medium.maxMegapixels).toBeLessThanOrEqual(tiers.high.maxMegapixels);
    expect(tiers.low.maxPixelRatio).toBeLessThanOrEqual(tiers.medium.maxPixelRatio);
    expect(tiers.medium.maxPixelRatio).toBeLessThanOrEqual(tiers.high.maxPixelRatio);
  });
});

describe('FrameGovernor', () => {
  const params = tuning.quality.governor;

  /** Feed `seconds` of frames of `frameMs` each (with a little seeded jitter). */
  function run(
    governor: FrameGovernor,
    seconds: number,
    frameMs: number,
    options: { jitterMs?: number; jsMs?: number; seed?: string } = {},
  ): GovernorAction[] {
    const rng = createRng(options.seed ?? 'frames');
    const actions: GovernorAction[] = [];
    let elapsed = 0;
    while (elapsed < seconds * 1000) {
      const ms = frameMs + (rng() * 2 - 1) * (options.jitterMs ?? 0.5);
      elapsed += ms;
      const action = governor.frame(ms, options.jsMs ?? 3);
      if (action) actions.push(action);
    }
    return actions;
  }

  it('leaves a device that keeps up alone', () => {
    const governor = new FrameGovernor(params, { targetFps: 60, canDemote: true });
    expect(run(governor, 60, 16.7)).toEqual([]);
    expect(run(new FrameGovernor(params, { targetFps: 60, canDemote: true }), 60, 6.9)).toEqual([]);
    expect(governor.scale).toBe(1);
  });

  it('demotes once, after the warm-up and the probe, when the device cannot keep up', () => {
    const governor = new FrameGovernor(params, { targetFps: 60, canDemote: true });
    // A terrible warm-up does not count.
    expect(run(governor, params.warmupSec, 80, { jitterMs: 20 })).toEqual([]);
    const actions = run(governor, params.probeSec + 0.2, 40, { jitterMs: 8 });
    expect(actions).toEqual([{ kind: 'demote' }]);
  });

  it('does not demote when told it cannot (a forced tier, or the lowest one)', () => {
    const governor = new FrameGovernor(params, { targetFps: 60, canDemote: false });
    const actions = run(governor, 6, 40, { jitterMs: 8 });
    expect(actions.every((action) => action.kind === 'scale')).toBe(true);
  });

  it('takes a steady 33 ms with little work of our own for a 30 Hz display, and leaves it be', () => {
    const governor = new FrameGovernor(params, { targetFps: 60, canDemote: true });
    expect(run(governor, 30, 1000 / 30, { jitterMs: 0.8, jsMs: 4 })).toEqual([]);
    expect(governor.scale).toBe(1);
  });

  it('but not when our own work is what takes the time', () => {
    const governor = new FrameGovernor(params, { targetFps: 60, canDemote: true });
    const actions = run(governor, 6, 1000 / 30, { jitterMs: 0.8, jsMs: 25 });
    expect(actions[0]).toEqual({ kind: 'demote' });
  });

  it('lowers the resolution step by step while frames are slow, down to the floor', () => {
    const governor = new FrameGovernor(params, { targetFps: 60, canDemote: false });
    const actions = run(governor, 40, 24, { jitterMs: 4 });
    const scales = actions.map((action) => (action.kind === 'scale' ? action.scale : NaN));
    expect(scales[0]).toBeCloseTo(1 - params.scaleDown, 5);
    expect(scales.at(-1)).toBeCloseTo(params.minScale, 5);
    // Monotonic, and never below the floor.
    for (let i = 1; i < scales.length; i += 1) {
      expect(scales[i]).toBeLessThan(scales[i - 1] ?? 0);
    }
    expect(governor.scale).toBeCloseTo(params.minScale, 5);
  });

  it('gives the resolution back slowly once frames are good again', () => {
    const governor = new FrameGovernor(params, { targetFps: 60, canDemote: false });
    run(governor, 40, 24, { jitterMs: 4 });
    expect(governor.scale).toBeCloseTo(params.minScale, 5);

    // Not at once: a clean stretch comes first. (The window that straddles the change may still
    // count as slow, hence the second of slack.)
    expect(run(governor, params.cleanSec - 1, 16.7)).toEqual([]);
    const actions = run(governor, 3, 16.7);
    expect(actions).toEqual([{ kind: 'scale', scale: params.minScale + params.scaleUp }]);

    run(governor, 600, 16.7);
    expect(governor.scale).toBe(1);
  });

  it('keeps changes apart', () => {
    const governor = new FrameGovernor(params, { targetFps: 60, canDemote: false });
    const times: number[] = [];
    let elapsed = 0;
    while (elapsed < 20_000) {
      elapsed += 24;
      if (governor.frame(24, 3)) times.push(elapsed);
    }
    for (let i = 1; i < times.length; i += 1) {
      expect((times[i] ?? 0) - (times[i - 1] ?? 0)).toBeGreaterThanOrEqual(params.holdSec * 1000);
    }
  });

  it('shrugs off a stall (a garbage collection, a tab coming back)', () => {
    const governor = new FrameGovernor(params, { targetFps: 60, canDemote: true });
    run(governor, params.warmupSec + 0.5, 16.7);
    expect(governor.frame(3000, 1)).toBeNull();
    expect(run(governor, 10, 16.7)).toEqual([]);

    // Once the probe is over, too: one stall in a second of good frames changes nothing.
    for (let second = 0; second < 10; second += 1) {
      expect(governor.frame(3000, 1)).toBeNull();
      expect(run(governor, 1.5, 16.7)).toEqual([]);
    }
    expect(governor.scale).toBe(1);
  });

  it('but a device on which EVERY frame is a stall is demoted like any other slow one', () => {
    const governor = new FrameGovernor(params, { targetFps: 60, canDemote: true });
    const actions: GovernorAction[] = [];
    for (let i = 0; i < 40; i += 1) {
      const action = governor.frame(400, 30);
      if (action) actions.push(action);
    }
    expect(actions[0]).toEqual({ kind: 'demote' });
  });

  it('targets 30 on a device that is locked to 30', () => {
    const governor = new FrameGovernor(params, { targetFps: 30, canDemote: false });
    expect(run(governor, 30, 1000 / 30, { jitterMs: 3, jsMs: 12 })).toEqual([]);
  });
});

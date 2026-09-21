import { describe, expect, it } from 'vitest';
import { RebuildBudget } from './snapshot';

describe('RebuildBudget', () => {
  it('allows a few rebuilds, then says stop', () => {
    const budget = new RebuildBudget(3, 60_000);
    expect(budget.spend(0)).toBe(true);
    expect(budget.spend(1_000)).toBe(true);
    expect(budget.spend(2_000)).toBe(true);
    expect(budget.spend(3_000)).toBe(false);
  });

  it('forgets rebuilds that happened long ago', () => {
    const budget = new RebuildBudget(2, 60_000);
    expect(budget.spend(0)).toBe(true);
    expect(budget.spend(10_000)).toBe(true);
    expect(budget.spend(20_000)).toBe(false);
    // A refusal is not a rebuild: it does not push the window along.
    expect(budget.spend(60_001)).toBe(true);
    expect(budget.spend(65_000)).toBe(false);
    expect(budget.spend(70_001)).toBe(true);
  });
});

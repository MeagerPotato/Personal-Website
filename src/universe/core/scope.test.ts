import { describe, expect, it } from 'vitest';
import { Scope } from './scope';

const resource = (log: string[], name: string) => ({ dispose: () => void log.push(name) });

describe('Scope', () => {
  it('disposes what it tracks, newest first, exactly once', () => {
    const log: string[] = [];
    const scope = new Scope();
    const geometry = resource(log, 'geometry');
    expect(scope.track(geometry)).toBe(geometry);
    scope.track(resource(log, 'material'));
    scope.onDispose(() => log.push('detach from scene'));
    expect(scope.size).toBe(3);

    scope.dispose();
    scope.dispose();
    expect(log).toEqual(['detach from scene', 'material', 'geometry']);
    expect(scope.size).toBe(0);
    expect(scope.disposed).toBe(true);
  });

  it('cleans up at once anything that arrives after the end', () => {
    const log: string[] = [];
    const scope = new Scope();
    scope.dispose();

    // A model that finished loading after its planet was torn down must not leak.
    scope.track(resource(log, 'late texture'));
    expect(log).toEqual(['late texture']);
    expect(scope.size).toBe(0);
  });

  it('ends children with the parent', () => {
    const log: string[] = [];
    const parent = new Scope();
    parent.track(resource(log, 'parent'));
    const child = parent.child();
    child.track(resource(log, 'child'));

    parent.dispose();
    expect(log).toEqual(['child', 'parent']);
    expect(child.disposed).toBe(true);
  });

  it('forgets a child that ended early, so a long session does not pile them up', () => {
    const log: string[] = [];
    const parent = new Scope();
    for (let visit = 0; visit < 100; visit += 1) {
      const closeUp = parent.child();
      closeUp.track(resource(log, `close-up ${visit}`));
      expect(closeUp.size).toBe(1);
      closeUp.dispose();
    }
    expect(log).toHaveLength(100);
    expect(parent.size).toBe(0);

    parent.dispose();
    expect(log).toHaveLength(100);
  });

  it('can withdraw a cleanup without running it', () => {
    const log: string[] = [];
    const scope = new Scope();
    const withdraw = scope.onDispose(() => log.push('listener'));
    withdraw();
    scope.dispose();
    expect(log).toEqual([]);
  });

  it('runs every cleanup even when one throws, then reports the failure', () => {
    const log: string[] = [];
    const scope = new Scope();
    scope.track(resource(log, 'first'));
    scope.onDispose(() => {
      throw new Error('boom');
    });
    scope.track(resource(log, 'last'));

    expect(() => scope.dispose()).toThrow('boom');
    expect(log).toEqual(['last', 'first']);

    const both = new Scope();
    both.onDispose(() => {
      throw new Error('one');
    });
    both.onDispose(() => {
      throw new Error('two');
    });
    expect(() => both.dispose()).toThrow(AggregateError);
  });
});

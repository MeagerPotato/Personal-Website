// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { keepSnapshot, recallSnapshot, rememberSnapshot } from './pose-memory';

const SNAPSHOT = { steps: 5400, ship: { x: 64, z: -99 }, dock: null };
const blocked = (): Storage => {
  throw new DOMException('denied', 'SecurityError');
};

afterEach(() => sessionStorage.clear());

describe('the remembered snapshot', () => {
  it('comes back as it was saved, for as long as the tab lives', () => {
    expect(recallSnapshot(() => sessionStorage)).toBeUndefined();
    rememberSnapshot(() => sessionStorage, SNAPSHOT);
    expect(recallSnapshot(() => sessionStorage)).toEqual(SNAPSHOT);
  });

  it('keeps what it has when there is nothing new to tell', () => {
    rememberSnapshot(() => sessionStorage, SNAPSHOT);
    rememberSnapshot(() => sessionStorage, null);
    rememberSnapshot(() => sessionStorage, undefined);
    expect(recallSnapshot(() => sessionStorage)).toEqual(SNAPSHOT);
  });

  it('shrugs off blocked storage and stored rubbish', () => {
    expect(() => rememberSnapshot(blocked, SNAPSHOT)).not.toThrow();
    expect(recallSnapshot(blocked)).toBeUndefined();
    sessionStorage.setItem('universe:snapshot', '{not json');
    expect(recallSnapshot(() => sessionStorage)).toBeUndefined();
  });

  it('is saved when the page goes away or into the background, until told to stop', () => {
    let steps = 1;
    const stop = keepSnapshot(
      () => ({ steps }),
      () => sessionStorage,
    );
    window.dispatchEvent(new Event('pagehide'));
    expect(recallSnapshot(() => sessionStorage)).toEqual({ steps: 1 });

    // Coming back into view is not a reason to save; going out of it is.
    steps = 2;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(recallSnapshot(() => sessionStorage)).toEqual({ steps: 1 });
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(recallSnapshot(() => sessionStorage)).toEqual({ steps: 2 });

    stop();
    steps = 3;
    window.dispatchEvent(new Event('pagehide'));
    expect(recallSnapshot(() => sessionStorage)).toEqual({ steps: 2 });
    Reflect.deleteProperty(document, 'visibilityState');
  });
});

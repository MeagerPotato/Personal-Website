import { describe, expect, it, vi } from 'vitest';
import { EventBus } from './events';

interface TestEvents {
  ready: undefined;
  docked: { id: string };
}

describe('EventBus', () => {
  it('delivers payloads to every listener of that event only', () => {
    const bus = new EventBus<TestEvents>();
    const onDocked = vi.fn();
    const onReady = vi.fn();
    bus.on('docked', onDocked);
    bus.on('ready', onReady);

    bus.emit('docked', { id: 'fishai' });

    expect(onDocked).toHaveBeenCalledExactlyOnceWith({ id: 'fishai' });
    expect(onReady).not.toHaveBeenCalled();
  });

  it('unsubscribes', () => {
    const bus = new EventBus<TestEvents>();
    const listener = vi.fn();
    const off = bus.on('ready', listener);
    off();
    bus.emit('ready', undefined);
    expect(listener).not.toHaveBeenCalled();
  });

  it('lets a listener unsubscribe itself mid-emit without skipping the others', () => {
    const bus = new EventBus<TestEvents>();
    const second = vi.fn();
    const off = bus.on('ready', () => off());
    bus.on('ready', second);

    bus.emit('ready', undefined);
    bus.emit('ready', undefined);

    expect(second).toHaveBeenCalledTimes(2);
  });

  it('clear() drops everything and emitting with no listeners is a no-op', () => {
    const bus = new EventBus<TestEvents>();
    const listener = vi.fn();
    bus.on('ready', listener);
    bus.clear();
    expect(() => bus.emit('ready', undefined)).not.toThrow();
    expect(listener).not.toHaveBeenCalled();
  });
});

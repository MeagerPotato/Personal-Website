import { describe, expect, it } from 'vitest';
import { tokens } from '../universe/design/tokens';
import { tokensToCss } from './tokens-css';

describe('tokensToCss', () => {
  it('flattens nested keys into kebab-case custom properties', () => {
    const css = tokensToCss({ color: { ink: { high: '#fff' } }, motion: { easeOut: 'linear' } });
    expect(css).toBe(':root{--color-ink-high:#fff;--motion-ease-out:linear}');
  });

  it('keeps numeric-looking keys and accepts a custom selector', () => {
    expect(tokensToCss({ space: { 900: '#000' } }, '.scope')).toBe('.scope{--space-900:#000}');
  });

  it('exposes every real token the stylesheet relies on', () => {
    const css = tokensToCss(tokens);
    for (const name of [
      '--color-space-900',
      '--color-ink-high',
      '--color-surface-panel',
      '--color-system-coral-base',
      '--color-accent',
      '--color-focus',
      '--font-body',
      '--text-display',
      '--space-4',
      '--radius-lg',
      '--motion-ease-out',
    ]) {
      expect(css).toContain(`${name}:`);
    }
  });

  it('only contains values that are safe inside a <style> tag', () => {
    expect(tokensToCss(tokens)).not.toMatch(/[<>]/);
  });
});

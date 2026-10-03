import { describe, expect, it } from 'vitest';
import { tokens } from '../universe/design/tokens';
import { ENGINE_ONLY, tokensToCss, type TokenTree } from './tokens-css';

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

  it('leaves out a whole group or a single key, and nothing beside them', () => {
    const tree = { color: { star: { warm: '#111', hot: '#222' }, air: { terra: '#333' } }, a: '1' };
    expect(tokensToCss(tree, ':root', ['color.star.hot', 'color.air'])).toBe(
      ':root{--color-star-warm:#111;--a:1}',
    );
    // A path is a whole key, never a prefix of one: `color.star.ho` is nobody.
    expect(tokensToCss(tree, ':root', ['color.star.ho', 'color.ai'])).toBe(tokensToCss(tree));
  });

  it('keeps the engine-only tokens out of every page', () => {
    const css = tokensToCss(tokens, ':root', ENGINE_ONLY);
    for (const name of [
      '--color-nebula',
      '--color-air',
      '--color-star-hot',
      '--color-star-amber',
      '--color-star-ember',
      '--color-shading-dusk',
      '--color-shading-night',
      '--color-window',
    ]) {
      expect(css, name).not.toContain(name);
    }
    // 26 of them, and each names a token that exists: a typo here would mirror it after all.
    const full = tokensToCss(tokens).split(';').length;
    expect(full - css.split(';').length).toBe(26);
    for (const path of ENGINE_ONLY) {
      let at: string | TokenTree | undefined = tokens;
      for (const key of path.split('.')) at = typeof at === 'object' ? at[key] : undefined;
      expect(at, path).toBeDefined();
    }
  });

  it('still mirrors every token a stylesheet could read', () => {
    const css = tokensToCss(tokens, ':root', ENGINE_ONLY);
    for (const name of [
      '--color-space-900',
      '--color-system-lilac-shade',
      '--color-biome-primer-peak',
      '--color-shading-shadow',
      '--color-star-warm',
      '--color-star-cool',
      '--color-star-white',
      '--color-focus',
      '--motion-ease-in-out',
    ]) {
      expect(css).toContain(`${name}:`);
    }
  });
});

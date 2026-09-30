// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { plannedName, plannedNote } from './planned';

describe('planned note', () => {
  it('reads "<name>, Planned", with the comma in a part of its own', () => {
    const name = plannedName('body-label', 'Sports Analysis');
    expect(name.className).toBe('body-label__name');
    expect(name.textContent).toBe('Sports Analysis, Planned');
    const note = name.querySelector('.body-label__note');
    expect(note?.parentElement).toBe(name);
    expect(note?.firstElementChild?.className).toBe('body-label__sep');
    expect(note?.firstElementChild?.textContent).toBe(', ');
    expect(plannedNote('dock-prompt').textContent).toBe(', Planned');
  });

  it('keeps the note and its comma in the line of the name, where a browser reads them as one', () => {
    // A browser pads every part of a name that is not inline with spaces as it reads it out, so
    // the visually hidden recipe (out of the flow) read "Sports Analysis , Planned" in a real
    // browser: the comma is only transparent, and nothing here leaves the line.
    const css = readFileSync(path.resolve('src/styles/global.css'), 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    );
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .map(([, selector = '', body = '']) => ({ selector: selector.trim(), body }))
      .filter(({ selector }) => /(body-label|dock-prompt)__(name|note|sep)\b/.test(selector));
    expect(rules.map(({ selector }) => selector)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('.body-label__note'),
        expect.stringContaining('.body-label__sep'),
      ]),
    );
    for (const { selector, body } of rules) {
      expect(body, selector).not.toMatch(/(^|[\s;])(position|display|float|clip-path)\s*:/);
    }
    const seps = rules.filter(({ selector }) => selector.includes('__sep'));
    expect(seps.map(({ body }) => /opacity:\s*0;/.test(body))).toEqual([true]);
    expect(seps[0]?.selector).toContain('.dock-prompt .dock-prompt__sep');
  });
});

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// The architecture boundaries in eslint.config.js are load-bearing, and flat config makes them
// easy to break by accident (a later block silently REPLACES an earlier rule). So we lint small
// violating snippets at virtual paths and assert that each boundary still bites.

const eslint = new ESLint();

async function violations(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((message) => message.ruleId ?? 'parse-error');
}

describe('lint boundaries', () => {
  it('the engine cannot import Astro or the web layer', async () => {
    const found = await violations(
      'src/universe/world/Example.ts',
      `import { getCollection } from 'astro:content';\nimport { start } from '../../shell/universe-shell';\nexport const x = [getCollection, start];\n`,
    );
    expect(found.filter((rule) => rule === 'no-restricted-imports')).toHaveLength(2);
  });

  it('the engine MAY import three.js and its own modules', async () => {
    const found = await violations(
      'src/universe/world/Example.ts',
      `import { Scene } from 'three';\nimport { tuning } from '../design/tuning';\nexport const x = [Scene, tuning];\n`,
    );
    expect(found).toEqual([]);
  });

  it.each(['src/universe/sim/example.ts', 'src/universe/data/example.ts'])(
    '%s is pure: no three.js, no DOM, no clock, no Math.random, no framework',
    async (filePath) => {
      const found = await violations(
        filePath,
        [
          `import { Vector3 } from 'three';`,
          `import { defineConfig } from 'astro/config';`,
          `export const a = Math.random();`,
          `export const b = Date.now();`,
          `export const c = document.title;`,
          `export const d = window.innerWidth;`,
          `export const e = [Vector3, defineConfig];`,
        ].join('\n'),
      );
      expect(found.filter((rule) => rule === 'no-restricted-imports')).toHaveLength(2);
      expect(found.filter((rule) => rule === 'no-restricted-properties')).toHaveLength(2);
      expect(found.filter((rule) => rule === 'no-restricted-globals')).toHaveLength(2);
    },
  );

  it('only the router may write history', async () => {
    const code = `history.pushState(null, '', '/x/');\nhistory.replaceState(null, '', '/y/');\n`;
    for (const filePath of [
      'src/shell/panel.ts',
      'src/universe/state/example.ts',
      'src/universe/sim/example.ts',
    ]) {
      const found = await violations(filePath, code);
      expect(found.filter((rule) => rule === 'no-restricted-properties')).toHaveLength(2);
    }
    expect(await violations('src/shell/router.ts', code)).toEqual([]);
  });

  it('shell and site code cannot import astro:* virtual modules', async () => {
    for (const filePath of ['src/shell/example.ts', 'src/site/example.ts']) {
      const found = await violations(
        filePath,
        `import { getCollection } from 'astro:content';\nexport const x = getCollection;\n`,
      );
      expect(found).toContain('no-restricted-imports');
    }
  });
});

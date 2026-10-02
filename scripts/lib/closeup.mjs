// THE CLOSE-UP CHUNK (src/universe/design/worlds/closeup.ts): the emblem worlds' close-up rows and
// their motion table, which world/BodyMesh.ts loads with import() the first time a world is seen
// up close (or at idle). It only stays out of the first download while nothing imports it
// statically, and a test of the module cannot see that: the build can. Pure, like ./html.mjs, so
// tests/build-scripts.test.ts holds it; verify-dist checks the built chunks (9).

import { extractStaticImports, toSitePath } from './html.mjs';

/** The chunk's file: Rolldown names it after its entry module, closeup.ts. */
export const CLOSE_UP_CHUNK = /^\/_astro\/closeup\.[\w-]+\.js$/;

/**
 * Tripwire, gzip -9 bytes: the chunk was 3.6 KiB when it was set, so this leaves room for more
 * rows. Raise it on purpose, in a PR that says why.
 */
export const CLOSE_UP_BUDGET = 4.5 * 1024;

/**
 * Names of parts that only the close-up rows have (design/worlds/near.ts): found in the chunk,
 * and in no other, or the rows were folded into a chunk that every visit downloads.
 * tests/build-scripts.test.ts checks that each is still such a name.
 */
export const CLOSE_UP_MARKERS = ['floodlights', 'binder-rings', 'solver-board'];

const DYNAMIC_IMPORT_RE = /\bimport\(\s*["'`]([^"'`]+)["'`]\s*\)/g;

/**
 * What is wrong with the close-up chunk in a build: `scripts` maps each script's site path to its
 * source, `gzipSize` its weight. An empty list is a chunk of its own, loaded only by import(),
 * holding the close-up rows and nothing else's, within its budget.
 */
export function closeUpProblems(scripts, gzipSize) {
  const chunks = [...scripts.keys()].filter((path) => CLOSE_UP_CHUNK.test(path));
  if (chunks.length !== 1) {
    return [
      `the close-up rows should be one chunk of their own (closeup.*.js); found ${chunks.length}` +
        (chunks.length > 0 ? `: ${chunks.join(', ')}` : ''),
    ];
  }
  const [chunk] = chunks;
  const problems = [];
  const weight = gzipSize(chunk);
  if (weight > CLOSE_UP_BUDGET) {
    problems.push(
      `${chunk} weighs ${weight} B gzipped; the close-up chunk's budget is ${CLOSE_UP_BUDGET} B`,
    );
  }
  let loaded = false;
  for (const [path, js] of scripts) {
    if (path === chunk) continue;
    for (const specifier of extractStaticImports(js)) {
      if (toSitePath(specifier, path) === chunk) {
        problems.push(`${path} imports ${chunk} statically: the close-up would load with it`);
      }
    }
    for (const match of js.matchAll(DYNAMIC_IMPORT_RE)) {
      if (toSitePath(match[1], path) === chunk) loaded = true;
    }
    for (const marker of CLOSE_UP_MARKERS) {
      if (js.includes(marker)) {
        problems.push(`${path} holds "${marker}", a part only the close-up rows have`);
      }
    }
  }
  if (!loaded) problems.push(`nothing loads ${chunk} with import()`);
  const own = scripts.get(chunk) ?? '';
  for (const marker of CLOSE_UP_MARKERS) {
    if (!own.includes(marker)) problems.push(`${chunk} does not hold "${marker}"`);
  }
  return problems;
}

// THE THREE.JS DIET. three's WebGL renderer carries the GLSL of every built-in material
// (physical, standard, phong, lambert, toon, matcap, shadows, environment maps, sprites, ...) as
// strings, and a bundler cannot tell that nobody compiles them: they hang off one object,
// `ShaderChunk`, that is looked up by name at run time. The engine draws with its own shaders
// (ShaderMaterial) and with two built-in materials, the basic line and the basic mesh. So the
// build empties every chunk that those cannot reach: about 114,000 characters of GLSL, 18 KiB of
// the lazy chunk after gzip, and not one pixel.
//
// How it stays honest:
//   - KEEP_PROGRAMS names the built-in programs the engine may compile. What is kept is those,
//     the chunks the renderer itself pastes in (RENDERER_CHUNKS), the chunks the engine's own
//     shaders `#include` (ENGINE_INCLUDES), and everything any of them includes, to any depth.
//   - A dropped PROGRAM (`meshphong_frag`, ...) is not emptied: it becomes a one-line `#error`,
//     so a material nobody planned for fails to compile with this file's name in the console
//     instead of drawing nothing.
//   - tests/build-scripts.test.ts runs this over the three.js that is installed (it is pinned
//     exactly), holds the kept list still, and reads the engine's source: a new material class or
//     a new `#include` there fails the test until it is named here.
//   - If three's build ever stops looking the way this expects, the build fails; it never ships
//     a three.js that was only half understood.
//
// Pure, like ./glsl-squeeze.mjs; scripts/vite-three-diet.mjs is the Vite plugin (builds only: the
// dev server and the lab run three.js as published).

/** The built-in programs the engine may compile: `<name>_vert` and `<name>_frag` of each. */
export const KEEP_PROGRAMS = ['meshbasic'];
/** The material classes that compile them (three maps both to the `basic` program). */
export const KEEP_MATERIALS = ['LineBasicMaterial', 'MeshBasicMaterial'];
/** Chunks the renderer pastes into every program itself (WebGLProgram), and the common one. */
export const RENDERER_CHUNKS = ['common', 'colorspace_pars_fragment', 'tonemapping_pars_fragment'];
/** Chunks the engine's own shaders include (src/universe/design/shaders). */
export const ENGINE_INCLUDES = ['colorspace_fragment'];

/**
 * Is this module three's WebGL build, the one file the diet reads?
 * @param {string} id
 * @returns {boolean}
 */
export function isThreeBuild(id) {
  return /[\\/]node_modules[\\/]three[\\/]build[\\/]three\.module\.js$/.test(id.split('?')[0]);
}

const INCLUDE_RE = /#include <(\w+)>/g;
/** `var name = "...";` on one line: how three's build declares a chunk's text. */
const TEXT_RE = /^(?:var|const) ([\w$]+) = "((?:[^"\\]|\\.)*)";$/;
/** `\tname: variable,` inside `const ShaderChunk = {`. */
const ENTRY_RE = /^\s*(\w+): ([\w$]+),?$/;
const PROGRAM_RE = /_(vert|frag)$/;

/**
 * Reads three's build: which chunk names there are, which line holds each one's text, and what
 * each includes. Throws when the build does not look as expected.
 * @param {string} code
 * @returns {{ lines: string[], chunks: Map<string, { index: number, text: string, includes: string[] }> }}
 */
export function readChunks(code) {
  const lines = code.split('\n');
  const variables = new Map();
  lines.forEach((line, index) => {
    const found = TEXT_RE.exec(line);
    if (found) variables.set(found[1], { index, text: JSON.parse(`"${found[2]}"`) });
  });
  const start = lines.findIndex((line) => line.startsWith('const ShaderChunk = {'));
  if (start < 0) throw new Error('three-diet: no `const ShaderChunk = {` in three.module.js');
  const chunks = new Map();
  for (let i = start + 1; i < lines.length && !lines[i].startsWith('}'); i += 1) {
    if (!lines[i].trim()) continue;
    const found = ENTRY_RE.exec(lines[i]);
    if (!found) throw new Error(`three-diet: cannot read the ShaderChunk entry "${lines[i]}"`);
    const variable = variables.get(found[2]);
    if (!variable) throw new Error(`three-diet: no text for the chunk "${found[1]}"`);
    chunks.set(found[1], {
      ...variable,
      includes: [...variable.text.matchAll(INCLUDE_RE)].map((match) => match[1]),
    });
  }
  return { lines, chunks };
}

/**
 * The names of the chunks that stay: the roots, and whatever they include, to any depth.
 * @param {Map<string, { includes: string[] }>} chunks
 * @returns {Set<string>}
 */
export function keptChunks(chunks) {
  const roots = [
    ...KEEP_PROGRAMS.flatMap((name) => [`${name}_vert`, `${name}_frag`]),
    ...RENDERER_CHUNKS,
    ...ENGINE_INCLUDES,
  ];
  const kept = new Set();
  const visit = (name) => {
    if (kept.has(name)) return;
    const chunk = chunks.get(name);
    if (!chunk) throw new Error(`three-diet: three has no chunk called "${name}"`);
    kept.add(name);
    chunk.includes.forEach(visit);
  };
  roots.forEach(visit);
  return kept;
}

/**
 * three's build with every chunk nobody can reach emptied.
 * @param {string} code
 * @returns {string}
 */
export function dietThree(code) {
  const { lines, chunks } = readChunks(code);
  const kept = keptChunks(chunks);
  for (const [name, chunk] of chunks) {
    if (kept.has(name)) continue;
    const text = PROGRAM_RE.test(name)
      ? `#error ${name}: dropped by scripts/lib/three-diet.mjs`
      : '';
    lines[chunk.index] = lines[chunk.index].replace(/ = ".*";$/, ` = ${JSON.stringify(text)};`);
  }
  return lines.join('\n');
}

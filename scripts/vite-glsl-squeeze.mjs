// The Vite plugin for the GLSL squeeze (scripts/lib/glsl-squeeze.mjs, which says what it does
// and why). Builds only: under `npm run dev` the shaders stay as written. It runs before
// TypeScript is compiled away (`enforce: 'pre'`), while the glsl tags are still in the source.

import { isShaderModule, squeezeTemplates } from './lib/glsl-squeeze.mjs';

/** @returns {import('vite').Plugin} */
export function glslSqueeze() {
  return {
    name: 'glsl-squeeze',
    apply: 'build',
    enforce: 'pre',
    transform(code, id) {
      if (!isShaderModule(id)) return null;
      const squeezed = squeezeTemplates(code);
      return squeezed === code ? null : { code: squeezed, map: null };
    },
  };
}

// The Vite plugin for the three.js diet (scripts/lib/three-diet.mjs, which says what it does and
// how it stays honest). Builds only: under `npm run dev` three.js runs as published.

import { dietThree, isThreeBuild } from './lib/three-diet.mjs';

/** @returns {import('vite').Plugin} */
export function threeDiet() {
  return {
    name: 'three-diet',
    apply: 'build',
    transform(code, id) {
      return isThreeBuild(id) ? { code: dietThree(code), map: null } : null;
    },
  };
}

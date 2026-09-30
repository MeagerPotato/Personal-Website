/**
 * A Vite plugin that serves the tokens as a stylesheet: `import 'virtual:allenkh/tokens.css'`.
 * Both apps build with Vite (Astro is Vite underneath), so both get the same custom properties
 * from the same source, and a palette change reaches every page on the next build.
 */
import type { Plugin } from 'vite';
import { tokensCss } from './css.ts';
import { themes } from './tokens.ts';

const ID = 'virtual:allenkh/tokens.css';
// The id must keep a .css ending so Vite's CSS pipeline picks it up; the \0 prefix is the Rollup
// convention that keeps other plugins (and the file system) from trying to load it.
const RESOLVED = `\0${ID}`;

export function designTokens(): Plugin {
  return {
    name: 'allenkh-design-tokens',
    resolveId(id) {
      return id === ID ? RESOLVED : undefined;
    },
    load(id) {
      return id === RESOLVED ? tokensCss() : undefined;
    },
    // index.html cannot read custom properties: `%token:day.bg%` there becomes the value.
    transformIndexHtml(html) {
      return html.replace(
        /%token:(day|night)\.(\w+)%/g,
        (match, theme: 'day' | 'night', key: string) => {
          const value = (themes[theme] as unknown as Record<string, unknown>)[key];
          if (typeof value !== 'string')
            throw new Error(`index.html asks for an unknown token: ${match}`);
          return value;
        },
      );
    },
  };
}

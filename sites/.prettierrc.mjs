// The same settings as the main site's (../.prettierrc.mjs), kept here so that sites/ formats
// with its own installed plugins and never reaches into the root's node_modules.
/** @type {import('prettier').Config} */
export default {
  plugins: ['prettier-plugin-astro'],
  overrides: [{ files: '*.astro', options: { parser: 'astro' } }],
  endOfLine: 'lf',
  singleQuote: true,
  printWidth: 100,
};

/**
 * The highlighter for code blocks: lowlight (highlight.js's grammars, as a syntax tree), used by
 * the studio's editor while writing and by the Worker when a post is published, so the colours
 * on the page are the ones in the editor. highlight.js's "common" set, plus what an aerospace
 * engineer writes (MATLAB, LaTeX, Julia, Verilog) and TOML and Dockerfiles.
 */
import { common, createLowlight } from 'lowlight';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import julia from 'highlight.js/lib/languages/julia';
import latex from 'highlight.js/lib/languages/latex';
import matlab from 'highlight.js/lib/languages/matlab';
import verilog from 'highlight.js/lib/languages/verilog';

export const lowlight = createLowlight(common);
lowlight.register({ dockerfile, julia, latex, matlab, verilog });

/** The code block's language menu, in the order people look for them. */
export const LANGUAGES: readonly { id: string; label: string }[] = [
  { id: 'plaintext', label: 'Plain text' },
  { id: 'python', label: 'Python' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'c', label: 'C' },
  { id: 'cpp', label: 'C++' },
  { id: 'matlab', label: 'MATLAB' },
  { id: 'latex', label: 'LaTeX' },
  { id: 'rust', label: 'Rust' },
  { id: 'go', label: 'Go' },
  { id: 'java', label: 'Java' },
  { id: 'kotlin', label: 'Kotlin' },
  { id: 'swift', label: 'Swift' },
  { id: 'csharp', label: 'C#' },
  { id: 'julia', label: 'Julia' },
  { id: 'r', label: 'R' },
  { id: 'arduino', label: 'Arduino' },
  { id: 'verilog', label: 'Verilog' },
  { id: 'bash', label: 'Bash' },
  { id: 'shell', label: 'Shell session' },
  { id: 'sql', label: 'SQL' },
  { id: 'json', label: 'JSON' },
  { id: 'yaml', label: 'YAML' },
  { id: 'toml', label: 'TOML' },
  { id: 'xml', label: 'HTML / XML' },
  { id: 'css', label: 'CSS' },
  { id: 'markdown', label: 'Markdown' },
  { id: 'dockerfile', label: 'Dockerfile' },
  { id: 'diff', label: 'Diff' },
];

/** A language lowlight knows (an alias counts), or null. */
export function knownLanguage(language: unknown): string | null {
  if (typeof language !== 'string' || language === '') return null;
  return lowlight.registered(language) ? language : null;
}

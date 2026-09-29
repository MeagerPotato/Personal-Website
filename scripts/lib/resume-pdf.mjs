// The resume as a PDF: printed from /resume/ by `npm run resume-pdf` (scripts/resume-pdf.mjs),
// committed under public/, and held to the page it was printed from by verify-dist. Pure, like
// ./html.mjs, so tests/build-scripts.test.ts can hold it too.

import { createHash } from 'node:crypto';
import { mainContent } from './html.mjs';

/** Where the PDF is served. src/site/routes.ts (resumePdf) names the same file; a test checks. */
export const RESUME_PDF = '/allen-hsieh-resume.pdf';

/** The page it is printed from. */
export const RESUME_PAGE = '/resume/';

/** What the PDF was printed from, recorded when it was printed: see resumeFingerprint(). */
export const RESUME_PDF_LOCK = 'config/resume-pdf.json';

/** The heading of the stylesheet's print section (src/styles/global.css), which runs to the end. */
const PRINT_SECTION = '/* 4. Print';

export const sha256 = (data) => createHash('sha256').update(data).digest('hex');

/** The part of the stylesheet that decides what paper looks like: section 4, to the end. */
export function printSection(css) {
  const start = css.indexOf(PRINT_SECTION);
  if (start < 0) throw new Error(`the stylesheet has no "${PRINT_SECTION}" section`);
  return css.slice(start);
}

/**
 * The parts of the resume's <main> that never reach paper, because section 4 of the stylesheet
 * hides them: the page's own header (its title and eyebrow), the screen-only intro, and the
 * actions (the download button). A new word there changes nothing in the PDF, so it must not ask
 * for a new one. Regex, like ./html.mjs: the input is our own generated HTML.
 */
const SCREEN_ONLY = [
  /<header class="page-header"[^>]*>[\s\S]*?<\/header>/g,
  /<div class="prose screen-only"[^>]*>[\s\S]*?<\/div>/g,
  /<ul class="actions"[^>]*>[\s\S]*?<\/ul>/g,
];

/** What of the resume page's <main> is printed. */
export function printedContent(html) {
  return SCREEN_ONLY.reduce((main, block) => main.replace(block, ''), mainContent(html));
}

/**
 * What the PDF is printed FROM, as one hash: what the resume page prints (its <main>, less the
 * parts only a screen shows) and the print section of the stylesheet. When either changes, the
 * PDF may no longer say what the page says, and verify-dist asks for a new one. Not caught: a
 * change that shows on paper through anything else (the rest of the stylesheet, a design token,
 * the typeface). Print again by hand after one.
 */
export function resumeFingerprint(html, css) {
  const lf = (text) => text.replaceAll('\r\n', '\n');
  return sha256(`${lf(printedContent(html))}\n\n${lf(printSection(css))}`);
}

/**
 * The problems with a built site's resume PDF, as sentences a person can act on (none = fine).
 * `lock` is config/resume-pdf.json, `pdf` the bytes dist/ serves, `html` dist's /resume/ page and
 * `css` the source stylesheet; null for whichever is missing.
 */
export function resumePdfProblems({ lock, pdf, html, css }) {
  const again = 'Run `npm run resume-pdf` and commit what it writes.';
  if (pdf === null) return [`${RESUME_PDF} is missing from dist/. ${again}`];
  if (lock === null) return [`${RESUME_PDF_LOCK} is missing. ${again}`];
  if (html === null || css === null) {
    return [`${RESUME_PAGE} or the stylesheet is missing, so the PDF cannot be checked`];
  }
  const problems = [];
  if (sha256(pdf) !== lock.pdf) {
    problems.push(`${RESUME_PDF} is not the file ${RESUME_PDF_LOCK} describes. ${again}`);
  }
  if (resumeFingerprint(html, css) !== lock.printedFrom) {
    problems.push(
      `the resume changed since ${RESUME_PDF} was printed (its page or the print stylesheet), ` +
        `so the PDF no longer says what the page says. ${again}`,
    );
  }
  return problems;
}

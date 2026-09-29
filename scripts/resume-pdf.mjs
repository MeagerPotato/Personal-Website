// `npm run resume-pdf`: prints /resume/ into public/allen-hsieh-resume.pdf through the print
// stylesheet, as a visitor's browser would print it, and records in config/resume-pdf.json what
// it was printed from. verify-dist then fails any build whose resume has changed since, so the PDF
// can never quietly say something the page no longer says.
//
// The npm script builds first: the PDF is printed from dist/. It needs Playwright's Chromium
// (`npx playwright install chromium`, once), which is why it is NOT part of the build: the PDF is
// committed, and Cloudflare's build never needs a browser. Run it after changing the resume (its
// YAML, its page or the print section of the stylesheet), then `npm run verify` and commit both
// files.

import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { chromium } from '@playwright/test';
import {
  RESUME_PAGE,
  RESUME_PDF,
  RESUME_PDF_LOCK,
  resumeFingerprint,
  sha256,
} from './lib/resume-pdf.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const PAGE_FILE = join(DIST, ...RESUME_PAGE.split('/').filter(Boolean), 'index.html');
const OUT = join(ROOT, 'public', RESUME_PDF.slice(1));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.woff2': 'font/woff2',
};

if (!existsSync(PAGE_FILE)) {
  console.error('resume-pdf: dist/ has no resume page. Run `npm run build` first.');
  process.exit(1);
}

// dist/ served as files, without Cloudflare's headers: all the browser needs to lay the page out.
const server = createServer(async (request, response) => {
  const path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
  let file = normalize(join(DIST, path));
  if (file !== DIST && !file.startsWith(DIST + sep)) {
    response.writeHead(403).end();
    return;
  }
  if (path.endsWith('/')) file = join(file, 'index.html');
  try {
    const body = await readFile(file);
    const type = TYPES[extname(file)] ?? 'application/octet-stream';
    response.writeHead(200, { 'content-type': type }).end(body);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((listening) => server.listen(0, '127.0.0.1', listening));
const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());

const browser = await chromium.launch();
let pdf;
try {
  const page = await browser.newPage();
  // Plain mode: paper is always the plain layout, and the 3D engine has no business here.
  await page.goto(`http://127.0.0.1:${port}${RESUME_PAGE}?plain`, { waitUntil: 'networkidle' });
  // (These callbacks run in the page, where globalThis is the window.)
  await page.evaluate(() => globalThis.document.fonts.ready);
  // The PDF's own title, which a PDF reader shows and a screen reader announces first.
  const name = (await page.locator('.resume-name').textContent())?.trim();
  if (!name) throw new Error('the resume page has no .resume-name');
  await page.evaluate((title) => {
    globalThis.document.title = title;
  }, `${name}, resume`);
  // US Letter, the margins the stylesheet's @page asks for, and a tagged PDF (headings, lists and
  // reading order survive, for screen readers and for applicant tracking systems).
  pdf = await page.pdf({ format: 'Letter', preferCSSPageSize: false, tagged: true, outline: true });
} finally {
  await browser.close();
  server.close();
}

const html = await readFile(PAGE_FILE, 'utf8');
const css = await readFile(join(ROOT, 'src', 'styles', 'global.css'), 'utf8');
const pages = pdf.toString('latin1').match(/\/Type\s*\/Page(?!s)\b/g)?.length ?? 0;
const lock = { pdf: sha256(pdf), printedFrom: resumeFingerprint(html, css), pages };

await writeFile(OUT, pdf);
await writeFile(join(ROOT, RESUME_PDF_LOCK), `${JSON.stringify(lock, null, 2)}\n`);
console.log(
  `resume-pdf: wrote public${RESUME_PDF} (${(pdf.length / 1024).toFixed(1)} KiB, ` +
    `${pages} ${pages === 1 ? 'page' : 'pages'}) and ${RESUME_PDF_LOCK}. ` +
    'Run `npm run verify` and commit both.',
);

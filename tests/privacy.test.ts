import { readFile, readdir } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { site } from '../src/config/site';

// AGENTS.md, "Never": no phone number and no private email address anywhere in the repo. The site
// is public and so is the repository, so this scans every text file we author, not just the pages.

const ROOT = resolve(import.meta.dirname, '..');
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.astro', '.wrangler', 'coverage']);
const SKIP_FILES = new Set(['package-lock.json']);
const TEXT = new Set([
  '.astro',
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.json',
  '.jsonc',
  '.md',
  '.mjs',
  '.svg',
  '.template',
  '.ts',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
  '',
]);

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
// North American shapes: three digits (bare or in brackets), three, then four, separated by
// spaces, dots or dashes, with an optional +1 in front. (No example here: this file is scanned.)
const PHONE = /(?:\+?1[ .-]?)?(?:\(\d{3}\)\s?|\b\d{3}[ .-])\d{3}[ .-]\d{4}\b/g;

const allowedEmail = (address: string): boolean =>
  address === site.email || /@example\.(?:com|org|net)$/.test(address);

async function textFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) found.push(...(await textFiles(path)));
    } else if (!SKIP_FILES.has(entry.name) && TEXT.has(extname(entry.name).toLowerCase())) {
      found.push(path);
    }
  }
  return found;
}

describe('privacy', () => {
  it('the only email address in the repository is the public contact address', async () => {
    const leaks: string[] = [];
    for (const file of await textFiles(ROOT)) {
      const text = await readFile(file, 'utf8');
      for (const [address] of text.matchAll(EMAIL)) {
        if (!allowedEmail(address)) leaks.push(`${relative(ROOT, file)}: ${address}`);
      }
    }
    expect(leaks).toEqual([]);
  });

  it('there is no phone number anywhere', async () => {
    const leaks: string[] = [];
    for (const file of await textFiles(ROOT)) {
      const text = await readFile(file, 'utf8');
      for (const [number] of text.matchAll(PHONE)) leaks.push(`${relative(ROOT, file)}: ${number}`);
    }
    expect(leaks).toEqual([]);
  });

  it('the scanner itself works: it sees a planted address and planted numbers', () => {
    // Assembled at run time, so that this file does not trip the two scans above.
    const address = ['first.last+tag', 'mail.school.edu'].join('@');
    const numbers = [['(555) 010', '4477'].join('-'), ['555', '010', '4477'].join('.')];
    const planted = `write to ${address} or call ${numbers.join(' / ')}`;

    expect([...planted.matchAll(EMAIL)].map(([match]) => match)).toEqual([address]);
    expect([...planted.matchAll(PHONE)].map(([match]) => match)).toEqual(numbers);
    expect(allowedEmail(address)).toBe(false);
    expect(allowedEmail(site.email)).toBe(true);
  });
});

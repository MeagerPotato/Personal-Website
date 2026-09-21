// Runs before every build. Guards the rules in AGENTS.md for committed binary assets:
//   - 5 MiB per file (Cloudflare's hard limit is 25 MiB; ours is a performance budget)
//   - kebab-case, lowercase names (Windows hides case bugs that Cloudflare will 404 on)
//   - no Git LFS pointer files (we do not use LFS; a pointer would deploy as a 130-byte "model")

import { open, stat } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { toPosix, walk } from './lib/fs.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const ASSET_ROOTS = ['public', 'src/content'];
const MAX_BYTES = 5 * 1024 * 1024;
const SEGMENT_RE = /^[a-z0-9]+(?:[-.][a-z0-9]+)*$/;
const SEGMENT_ALLOWLIST = new Set(['.well-known', '_redirects']);
const LFS_MAGIC = 'version https://git-lfs.github.com/spec/v1';

const problems = [];
let checked = 0;

for (const root of ASSET_ROOTS) {
  for (const file of await walk(resolve(ROOT, root))) {
    checked += 1;
    const rel = toPosix(relative(ROOT, file));

    for (const segment of rel.split('/').slice(root.split('/').length)) {
      if (!SEGMENT_RE.test(segment) && !SEGMENT_ALLOWLIST.has(segment)) {
        problems.push(`${rel}: "${segment}" is not kebab-case lowercase`);
      }
    }

    const { size } = await stat(file);
    if (size > MAX_BYTES) {
      problems.push(`${rel}: ${(size / 1024 / 1024).toFixed(1)} MiB exceeds the 5 MiB budget`);
    }

    const handle = await open(file, 'r');
    try {
      const { buffer, bytesRead } = await handle.read(Buffer.alloc(LFS_MAGIC.length), 0);
      if (buffer.subarray(0, bytesRead).toString('utf8') === LFS_MAGIC) {
        problems.push(
          `${rel}: is a Git LFS pointer, not the real file (this repo does not use LFS)`,
        );
      }
    } finally {
      await handle.close();
    }
  }
}

if (problems.length > 0) {
  console.error(`check-assets: ${problems.length} problem(s)\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}
console.log(`check-assets: ${checked} file(s) OK`);

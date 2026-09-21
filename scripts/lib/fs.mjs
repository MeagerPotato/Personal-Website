import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

/** Recursively list files under `dir` (absolute paths). Missing directory = empty list. */
export async function walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else files.push(path);
  }
  return files;
}

/** Windows-safe: always forward slashes, relative to `root`. */
export function toPosix(path) {
  return path.replaceAll('\\', '/');
}

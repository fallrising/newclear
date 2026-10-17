import { lstat, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
export async function isEmpty(root) {
  try {
    if (typeof root !== 'string') return false;
    const stat = await lstat(root); if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
    for (const entry of await readdir(root)) if (!await isEmpty(join(root, entry))) return false;
    return true;
  } catch { return false; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const empty = process.argv.length === 2 && await isEmpty('/media');
  process.stdout.write(empty ? 'EMPTY\n' : 'NOT_EMPTY\n'); process.exitCode = empty ? 0 : 6;
}

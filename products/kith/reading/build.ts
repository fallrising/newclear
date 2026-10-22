import { mkdir, open, rename, lstat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { COMMIT, SAFE_ID, exactKeys, object, parseBundle, safePath, validText } from './bundle.ts';
import type { ReadingBundle } from './bundle.ts';
import { blob, git } from './git.ts';

export type BuildOptions = { repo: string; commit: string; registry: string; output: string };

export async function buildReading({ repo, commit, registry, output }: BuildOptions): Promise<ReadingBundle> {
  if (!COMMIT.test(commit) || !safePath(registry)) throw new Error('Invalid immutable content source');
  if ((await git(repo, ['rev-parse', '--verify', `${commit}^{commit}`], 128)).trim() !== commit) throw new Error('Source is not an exact commit');
  let manifest: unknown;
  try { manifest = JSON.parse(await blob(repo, commit, registry, 256 * 1024)); } catch { throw new Error('Invalid article registry'); }
  if (!object(manifest) || !exactKeys(manifest, ['version', 'articles']) || manifest.version !== 1 || !Array.isArray(manifest.articles) || manifest.articles.length > 200) throw new Error('Invalid article registry');
  const ids = new Set<string>(); const articles = [];
  for (const entry of manifest.articles) {
    if (!object(entry) || !exactKeys(entry, ['id', 'title', 'path']) || typeof entry.id !== 'string' || !SAFE_ID.test(entry.id) || ids.has(entry.id) || !validText(entry.title, 200) || !safePath(entry.path)) throw new Error('Invalid or duplicate article identity');
    ids.add(entry.id); articles.push({ id: entry.id, title: entry.title, body: await blob(repo, commit, entry.path) });
  }
  const bundle = parseBundle({ version: 1, commit, articles });
  if (!bundle) throw new Error('Invalid article bundle or unknown article link');
  await mkdir(dirname(output), { recursive: true });
  try { const target = await lstat(output); if (!target.isFile() || target.isSymbolicLink() || target.nlink !== 1) throw new Error('Unsafe output file'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const temporary = `${output}.${randomUUID()}.tmp`;
  const file = await open(temporary, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(bundle) + '\n'); await file.sync(); } finally { await file.close(); }
  await rename(temporary, output);
  const directory = await open(dirname(output), 'r'); try { await directory.sync(); } finally { await directory.close(); }
  return bundle;
}

export function argumentsFor(argv: string[], names: string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]; const value = argv[index + 1];
    if (!flag || !names.includes(flag) || !value || Object.hasOwn(values, flag)) throw new Error('Invalid CLI arguments');
    values[flag] = value;
  }
  if (Object.keys(values).length !== names.length) throw new Error('Missing CLI arguments');
  return values;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = argumentsFor(process.argv.slice(2), ['--repo', '--commit', '--registry', '--output']);
    const bundle = await buildReading({ repo: args['--repo']!, commit: args['--commit']!, registry: args['--registry']!, output: args['--output']! });
    console.log(JSON.stringify({ commit: bundle.commit, articles: bundle.articles.length }));
  } catch { console.error('Reading build failed; previous artifact preserved.'); process.exitCode = 1; }
}

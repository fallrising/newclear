import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
/** No shell, hooks, signing, textconv, fsmonitor or inherited Git routing. */
export async function git(repo: string, args: string[], maxBuffer = 8 * 1024 * 1024): Promise<string> {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ATTR_NOSYSTEM: '1' };
  for (const name of Object.keys(env)) if (/^GIT_(DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|CONFIG_COUNT|CONFIG_KEY_\d+|CONFIG_VALUE_\d+)$/u.test(name)) delete env[name];
  try {
    const { stdout } = await execute('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.attributesFile=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'commit.gpgSign=false', '-c', 'tag.gpgSign=false', '-c', 'protocol.ext.allow=never', '-C', repo, ...args], { env, encoding: 'buffer', timeout: 30_000, maxBuffer });
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(stdout);
  } catch {
    // Git's stderr may contain repository paths or private blob content.
    throw new Error(`Git ${args[0] ?? 'operation'} failed`);
  }
}

export async function blob(repo: string, commit: string, path: string, max = 65536): Promise<string> {
  const entry = await git(repo, ['ls-tree', '-z', commit, '--', path], 4096);
  const match = /^(100644|100755) blob ([a-f0-9]{40})\t([^\0]+)\0$/u.exec(entry);
  if (!match || match[3] !== path || !match[2]) throw new Error('Missing regular content blob');
  const size = Number((await git(repo, ['cat-file', '-s', match[2]], 128)).trim());
  if (!Number.isSafeInteger(size) || size > max || size < 1) throw new Error('Content blob size rejected');
  const content = await git(repo, ['cat-file', 'blob', match[2]], max + 1);
  // git() decodes bytes using fatal UTF-8; also verify the exact declared size.
  if (Buffer.byteLength(content) !== size) throw new Error('Invalid UTF-8 content blob');
  return content;
}

import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { COMMIT, SAFE_ID, exactKeys, object, validText } from './bundle.ts';
import { argumentsFor } from './build.ts';
import { git } from './git.ts';

export type Capture = { id: string; body: string; source: 'web'; created_at: string; exported_commit: string | null };
export type Note = { id: string; article_id: string; body: string; revision: number; updated_at: string; exported_commit: string | null };
export type Kind = 'captures' | 'notes';
export type Snapshot = { kind: Kind; records: (Capture | Note)[] };
export type ExportEvent = { type: 'overwrite'; kind: Kind; id: string };
export type ExportOptions = { repo: string; branch: string; baseUrl: string; token: string; fetch?: typeof fetch; fault?: (stage: 'afterWrite' | 'afterCommit' | 'afterPush', snapshot: Snapshot) => void | Promise<void>; onEvent?: (event: ExportEvent) => void };
type Journal = Snapshot & { version: 1; repo: string; branch: string; baseUrl: string; remote: string; base: string; commit: string | null };
type Result = { complete: true; commits: string[]; acknowledged: { captures: number; notes: number }; overwrites: { kind: Kind; id: string }[] };
// 100 valid 16-KiB bodies may expand six-fold when JSON escapes controls.
const RESPONSE_LIMIT = 16 * 1024 * 1024;
const JOURNAL_LIMIT = 16 * 1024 * 1024;

function validDate(value: unknown): value is string {
  return typeof value === 'string' && value.length === 24 && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
function recordsFor(kind: Kind, input: unknown): (Capture | Note)[] {
  if (!Array.isArray(input) || input.length > 100) throw new Error('Invalid export records');
  let previous = '';
  return input.map(value => {
    const keys = kind === 'captures' ? ['id', 'body', 'source', 'created_at', 'exported_commit'] : ['id', 'article_id', 'body', 'revision', 'updated_at', 'exported_commit'];
    if (!object(value) || !exactKeys(value, keys) || typeof value.id !== 'string' || !SAFE_ID.test(value.id) || value.id <= previous || !validText(value.body, 16384) || !(value.exported_commit === null || typeof value.exported_commit === 'string' && COMMIT.test(value.exported_commit))) throw new Error('Invalid export record');
    previous = value.id;
    if (kind === 'captures') {
      if (value.source !== 'web' || !validDate(value.created_at)) throw new Error('Invalid capture');
      return { id: value.id, body: value.body, source: 'web', created_at: value.created_at, exported_commit: value.exported_commit } as Capture;
    }
    if (typeof value.article_id !== 'string' || !SAFE_ID.test(value.article_id) || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1 || !validDate(value.updated_at)) throw new Error('Invalid note');
    return { id: value.id, article_id: value.article_id, body: value.body, revision: Number(value.revision), updated_at: value.updated_at, exported_commit: value.exported_commit } as Note;
  });
}
function bytes(record: Capture | Note): string {
  const { exported_commit: _ignored, ...content } = record;
  return JSON.stringify(content, null, 2) + '\n';
}
function pathFor(kind: Kind, id: string): string {
  if (!SAFE_ID.test(id)) throw new Error('Unsafe export ID');
  return `${kind}/${id}.json`;
}
function endpoint(input: string): string {
  let url: URL; try { url = new URL(input); } catch { throw new Error('Invalid export endpoint'); }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || !(url.protocol === 'https:' || url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname))) throw new Error('Unsafe export endpoint');
  return url.origin;
}
async function request(options: ExportOptions, path: string, body?: unknown): Promise<unknown> {
  let response: Response;
  try { response = await (options.fetch ?? fetch)(options.baseUrl + path, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${options.token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, redirect: 'error', signal: AbortSignal.timeout(15_000), ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); } catch { throw new Error('Export request failed'); }
  if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error('Export request rejected'); }
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > RESPONSE_LIMIT) throw new Error('Export response too large'); chunks.push(value); }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks)));
  } catch { await reader.cancel(); throw new Error('Invalid export response'); } finally { reader.releaseLock(); }
}
async function privateFile(path: string): Promise<void> {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) throw new Error('Unsafe private file');
}
async function readPrivate(path: string, max: number): Promise<string> {
  await privateFile(path); const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { const stat = await handle.stat(); if (stat.size > max || !stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) throw new Error('Unsafe private file'); return await handle.readFile('utf8'); } finally { await handle.close(); }
}
async function persist(path: string, journal: Journal): Promise<void> {
  const content = JSON.stringify(journal);
  if (Buffer.byteLength(content) > JOURNAL_LIMIT) throw new Error('Export journal exceeds bound');
  const temporary = `${path}.${randomUUID()}.tmp`; const handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, path);
  const dir = await open(resolve(path, '..'), 'r'); try { await dir.sync(); } finally { await dir.close(); }
}
async function acquire(common: string): Promise<() => Promise<void>> {
  // Linux abstract sockets are kernel-owned and disappear on process death.
  // There is no stale PID, pathname removal or lock-stealing recovery race.
  if (process.platform !== 'linux') throw new Error('Exporter locking requires Linux');
  const server = createServer(socket => socket.destroy());
  await new Promise<void>((yes, no) => {
    server.once('error', () => no(new Error('Exporter lock unavailable; another pass may be running')));
    server.listen('\0kith-reading-' + createHash('sha256').update(common).digest('hex'), () => yes());
  });
  return () => new Promise<void>((yes, no) => { server.close(error => error ? no(error) : yes()); });
}
async function safeExportPath(repo: string, kind: Kind, id: string): Promise<string> {
  const directory = join(repo, kind);
  try { await mkdir(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  const dir = await lstat(directory); if (!dir.isDirectory() || dir.isSymbolicLink()) throw new Error('Unsafe export directory');
  const path = join(repo, pathFor(kind, id));
  try { const stat = await lstat(path); if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('Unsafe export file'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  return path;
}
async function assertClean(repo: string, allowed: Set<string> = new Set()): Promise<void> {
  const status = await git(repo, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  for (const entry of status.split('\0').filter(Boolean)) if (!allowed.has(entry.slice(3)) || /^[RC]|^.[RC]/u.test(entry)) throw new Error('Unrelated dirty worktree; preserve it before export');
}
async function readAt(repo: string, commit: string, path: string): Promise<string | null> {
  const entry = await git(repo, ['ls-tree', '-z', commit, '--', path], 4096);
  if (!entry) return null;
  const match = /^100644 blob ([a-f0-9]{40})\t[^\0]+\0$/u.exec(entry);
  if (!match?.[1]) throw new Error('Unsafe committed export path');
  const size = Number((await git(repo, ['cat-file', '-s', match[1]], 128)).trim());
  if (!Number.isSafeInteger(size) || size > 128 * 1024) throw new Error('Committed export file too large');
  return git(repo, ['cat-file', 'blob', match[1]], 128 * 1024);
}
async function ancestor(repo: string, first: string, second: string): Promise<boolean> {
  try { await git(repo, ['merge-base', '--is-ancestor', first, second]); return true; } catch { return false; }
}
async function fetchHead(repo: string, branch: string): Promise<string> {
  await git(repo, ['fetch', '--no-tags', 'origin', `refs/heads/${branch}`]);
  const commit = (await git(repo, ['rev-parse', '--verify', 'FETCH_HEAD^{commit}'], 128)).trim();
  if (!COMMIT.test(commit)) throw new Error('Invalid remote commit'); return commit;
}
async function matches(repo: string, commit: string, snapshot: Snapshot): Promise<boolean> {
  for (const record of snapshot.records) if (await readAt(repo, commit, pathFor(snapshot.kind, record.id)) !== bytes(record)) return false;
  return true;
}
async function acknowledge(options: ExportOptions, journal: Journal, commit: string, result: Result): Promise<void> {
  const pending = journal.records.filter(row => row.exported_commit === null);
  if (!pending.length) return;
  const response = await request(options, '/api/reading-export/ack', { commit, captures: journal.kind === 'captures' ? pending.map(row => row.id) : [], notes: journal.kind === 'notes' ? pending.map(row => ({ id: row.id, revision: (row as Note).revision })) : [] });
  if (!object(response) || !exactKeys(response, ['captures', 'notes']) || !Number.isSafeInteger(response.captures) || !Number.isSafeInteger(response.notes) || Number(response.captures) < 0 || Number(response.notes) < 0 || Number(response.captures) + Number(response.notes) > pending.length) throw new Error('Invalid export acknowledgment');
  result.acknowledged.captures += Number(response.captures); result.acknowledged.notes += Number(response.notes);
}
async function processJournal(options: ExportOptions, journal: Journal, journalPath: string, result: Result): Promise<void> {
  const paths = journal.records.map(row => pathFor(journal.kind, row.id));
  await assertClean(options.repo, new Set(paths));
  for (const record of journal.records) await safeExportPath(options.repo, journal.kind, record.id);
  const remote = await fetchHead(options.repo, options.branch);
  let head = (await git(options.repo, ['rev-parse', 'HEAD'], 128)).trim();
  // A push response can be lost, or the process can die before persisting its
  // new commit. Recover by inspecting actual remote bytes, never a local flag.
  if (await ancestor(options.repo, journal.base, remote) && await matches(options.repo, remote, journal)) {
    if (!(await ancestor(options.repo, head, remote)) && !(await ancestor(options.repo, remote, head))) throw new Error('Export branch divergence requires operator resolution');
    await acknowledge(options, journal, remote, result); await unlink(journalPath); return;
  }
  if (journal.commit && head !== journal.commit) throw new Error('Journal commit does not match local branch');
  if (head !== journal.base) {
    // Only one exact, single-parent export commit may be recovered. Do not
    // publish or discard unrelated commits made while a journal was pending.
    const parent = (await git(options.repo, ['rev-parse', `${head}^`], 128)).trim();
    const changed = (await git(options.repo, ['diff-tree', '--no-commit-id', '--name-only', '-r', head])).trim().split('\n').filter(Boolean);
    if (parent !== journal.base || changed.some(path => !paths.includes(path)) || !(await matches(options.repo, head, journal))) throw new Error('Unrelated local commits conflict with export journal');
    journal.commit = head; await persist(journalPath, journal);
  }
  if (!(await ancestor(options.repo, remote, head))) throw new Error('Remote divergence or push conflict; journal remains pending');
  if (!journal.commit) {
    for (const record of journal.records) {
      const path = await safeExportPath(options.repo, journal.kind, record.id); const content = bytes(record);
      const prior = await readAt(options.repo, head, pathFor(journal.kind, record.id));
      if (prior !== null && prior !== content) { const event: ExportEvent = { type: 'overwrite', kind: journal.kind, id: record.id }; result.overwrites.push({ kind: event.kind, id: event.id }); options.onEvent?.(event); }
      const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600);
      try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
    }
    await options.fault?.('afterWrite', journal);
    for (const path of paths) {
      // --no-filters avoids executing a repository's configured clean filter.
      const hash = (await git(options.repo, ['hash-object', '-w', '--no-filters', '--', path], 128)).trim();
      await git(options.repo, ['update-index', '--add', '--cacheinfo', `100644,${hash},${path}`]);
    }
    const staged = (await git(options.repo, ['diff', '--cached', '--name-only', '--no-ext-diff', '--no-textconv'])).trim();
    if (staged) {
      await git(options.repo, ['-c', 'user.name=Kith export', '-c', 'user.email=kith-export@localhost', 'commit', '--no-verify', '-m', `Export ${journal.kind} snapshot`]);
      head = (await git(options.repo, ['rev-parse', 'HEAD'], 128)).trim(); result.commits.push(head);
    }
    journal.commit = head; await persist(journalPath, journal);
    await options.fault?.('afterCommit', journal);
  }
  let pushed = false;
  try { await git(options.repo, ['push', 'origin', `${journal.commit}:refs/heads/${options.branch}`]); pushed = true; } catch { /* Inspect the remote even when the push response was lost. */ }
  if (pushed) await options.fault?.('afterPush', journal);
  const confirmed = await fetchHead(options.repo, options.branch);
  if (!journal.commit || !(await ancestor(options.repo, journal.commit, confirmed)) || !(await matches(options.repo, confirmed, journal))) throw new Error('Push unconfirmed or conflicted; snapshot remains pending');
  await acknowledge(options, journal, confirmed, result);
  await unlink(journalPath);
}

export async function runExport(input: ExportOptions): Promise<Result> {
  const options = { ...input, repo: await realpath(input.repo), baseUrl: endpoint(input.baseUrl) };
  if (!/^kith_export_[A-Za-z0-9_-]{1,256}$/u.test(options.token) || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/u.test(options.branch)) throw new Error('Invalid exporter configuration');
  await git(options.repo, ['check-ref-format', `refs/heads/${options.branch}`]);
  const common = await realpath(resolve(options.repo, (await git(options.repo, ['rev-parse', '--git-common-dir'])).trim()));
  const release = await acquire(common);
  try {
    if ((await git(options.repo, ['rev-parse', '--show-toplevel'])).trim() !== options.repo || (await git(options.repo, ['symbolic-ref', '--quiet', '--short', 'HEAD'])).trim() !== options.branch) throw new Error('Unexpected exporter worktree or branch');
    // ls-files does not apply clean filters. Include ignored/untracked files:
    // even an untracked attributes file can execute filters during git status.
    const localTree = await git(options.repo, ['ls-files', '--cached', '--others', '-z']);
    if (localTree.split('\0').some(path => path === '.gitattributes' || path.endsWith('/.gitattributes'))) throw new Error('Export checkout attributes require operator resolution');
    try { const attributes = await lstat(join(common, 'info', 'attributes')); if (!attributes.isFile() || attributes.isSymbolicLink() || attributes.size !== 0) throw new Error('Export checkout attributes require operator resolution'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const remote = (await git(options.repo, ['remote', 'get-url', '--all', 'origin'])).trim();
    const pushRemote = (await git(options.repo, ['remote', 'get-url', '--push', '--all', 'origin'])).trim();
    if (remote !== pushRemote || remote.includes('\n') || !(/^(https:\/\/[^@\s]+|ssh:\/\/[^\s]+|[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+:[A-Za-z0-9_./-]+|\/[^\0\r\n]+)$/u.test(remote))) throw new Error('Unexpected export remote');
    const state = join(common, 'kith-reading-export');
    try { await mkdir(state, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const stat = await lstat(state); if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) throw new Error('Unsafe export state directory');
    const journalPath = join(state, 'journal.json');
    const result: Result = { complete: true, commits: [], acknowledged: { captures: 0, notes: 0 }, overwrites: [] };
    let journal: Journal | null = null;
    try {
      const value: unknown = JSON.parse(await readPrivate(journalPath, JOURNAL_LIMIT));
      if (!object(value) || !exactKeys(value, ['version', 'repo', 'branch', 'baseUrl', 'remote', 'base', 'commit', 'kind', 'records']) || value.version !== 1 || value.repo !== options.repo || value.branch !== options.branch || value.baseUrl !== options.baseUrl || value.remote !== remote || typeof value.base !== 'string' || !COMMIT.test(value.base) || !(value.commit === null || typeof value.commit === 'string' && COMMIT.test(value.commit)) || !(value.kind === 'captures' || value.kind === 'notes')) throw new Error('Invalid or mismatched export journal');
      journal = { ...value, records: recordsFor(value.kind, value.records) } as Journal;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (journal) await processJournal(options, journal, journalPath, result);
    await assertClean(options.repo);
    const remoteHead = await fetchHead(options.repo, options.branch); const localHead = (await git(options.repo, ['rev-parse', 'HEAD'], 128)).trim();
    if (remoteHead !== localHead) {
      if (!(await ancestor(options.repo, localHead, remoteHead))) throw new Error('Local branch divergence; do not discard or publish unrelated work');
      // A dedicated export checkout is operator-owned. Refuse attributes rather
      // than run configured checkout filters while advancing it.
      const tree = await git(options.repo, ['ls-tree', '-r', '--name-only', remoteHead]);
      if (tree.split('\n').some(path => path === '.gitattributes' || path.endsWith('/.gitattributes'))) throw new Error('Export checkout attributes require operator resolution');
      await git(options.repo, ['merge', '--ff-only', '--no-edit', remoteHead]);
    }
    for (const kind of ['captures', 'notes'] as const) {
      let cursor: string | null = null;
      for (let page = 0; page < 100; page++) {
        const query = new URLSearchParams({ kind, limit: '100' }); if (cursor) query.set('cursor', cursor);
        const response = await request(options, `/api/reading-export?${query}`);
        if (!object(response) || !exactKeys(response, ['records', 'next_cursor']) || !(response.next_cursor === null || typeof response.next_cursor === 'string' && SAFE_ID.test(response.next_cursor))) throw new Error('Invalid export page');
        const records = recordsFor(kind, response.records);
        if (records.some(row => cursor !== null && row.id <= cursor) || response.next_cursor !== null && (records.length === 0 || response.next_cursor !== records.at(-1)?.id)) throw new Error('Non-progressing export page');
        if (records.length) {
          journal = { version: 1, repo: options.repo, branch: options.branch, baseUrl: options.baseUrl, remote, base: (await git(options.repo, ['rev-parse', 'HEAD'], 128)).trim(), commit: null, kind, records };
          await persist(journalPath, journal); await processJournal(options, journal, journalPath, result);
        }
        cursor = response.next_cursor;
        if (cursor === null) break;
        if (page === 99) throw new Error('Export incomplete: page bound reached; pending work preserved');
      }
    }
    return result;
  } finally { await release(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = argumentsFor(process.argv.slice(2), ['--repo', '--branch', '--url', '--token-file']);
    const token = (await readPrivate(args['--token-file']!, 1024)).replace(/\r?\n$/u, '');
    const result = await runExport({ repo: args['--repo']!, branch: args['--branch']!, baseUrl: args['--url']!, token, onEvent: event => console.log(JSON.stringify(event)) });
    console.log(JSON.stringify({ complete: result.complete, commits: result.commits, acknowledged: result.acknowledged }));
  } catch { console.error('Reading export failed; pending work and journal preserved.'); process.exitCode = 1; }
}

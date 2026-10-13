import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const execute = promisify(execFile);

// Own synthetic directory, credentials and real production CLI. No SQL seeding
// or response interception: the browser reads records actually archived/imported.
export async function startArchiveFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'signalhub-browser-m5-'));
  const binary = resolve(process.env.SIGNALHUB_BINARY || '/tmp/signalhub');
  const tokens = Object.fromEntries(['owner', 'reader', 'source'].map(role => [role, randomBytes(32).toString('base64url')]));
  let child;
  let base;
  let stopped = false;
  async function stop() {
    if (stopped) return;
    stopped = true;
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill('SIGTERM');
      const kill = setTimeout(() => child.kill('SIGKILL'), 15_000);
      await exited;
      clearTimeout(kill);
    }
    await rm(directory, { recursive: true, force: true });
  }
  try {
    for (const [role, token] of Object.entries(tokens)) await writeFile(join(directory, role + '.token'), token, { mode: 0o600 });
    const ref = role => 'file:' + join(directory, role + '.token');
    const configPath = join(directory, 'config.json');
    const dbPath = join(directory, 'events.sqlite');
    const archivePath = join(directory, 'archive');
    await mkdir(archivePath, { mode: 0o700 });
    const config = {
      sources: [{ name: 'archive', source_prefix: 'urn:example:archive:', allowed_types: ['inspection.check.*'], retention_days: 1, token_ref: ref('source') }],
      rules: [], subscriptions: [], webhook_allowlist: [],
    };
    await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
    child = spawn(binary, ['-config', configPath, '-db', dbPath, '-owner-token-ref', ref('owner'), '-readonly-token-ref', ref('reader'), '-listen', '127.0.0.1:0'], { stdio: ['ignore', 'ignore', 'pipe'] });
    base = await new Promise((resolve, reject) => {
      let stderr = '';
      const timer = setTimeout(() => reject(new Error('M5 Go fixture startup timeout')), 15_000);
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('exit', () => { clearTimeout(timer); reject(new Error('M5 fixture exited before startup: ' + stderr)); });
      child.stderr.on('data', chunk => {
        stderr = (stderr + chunk.toString()).slice(-16_384);
        const match = stderr.match(/signalhub listening on (127\.0\.0\.1:\d+)/);
        if (match) { clearTimeout(timer); resolve('http://' + match[1]); }
      });
    });
    async function api(path, { role = 'reader', method = 'GET', body, status = 200 } = {}) {
      const response = await fetch(base + path, {
        method,
        headers: { Authorization: 'Bearer ' + tokens[role], 'Content-Type': 'application/cloudevents+json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const result = await response.json();
      if (response.status !== status) throw new Error('M5 fixture HTTP ' + response.status + ': ' + JSON.stringify(result));
      return result;
    }
    async function cli(...args) {
      await execute(binary, args, { timeout: 15_000, maxBuffer: 64 * 1024 });
    }
    const old = new Date(Date.now() - 3 * 86400_000);
    old.setUTCHours(12, 0, 0, 0);
    const day = old.toISOString().slice(0, 10);
    const make = (id, time, summary) => ({
      specversion: '1.0', id, source: 'urn:example:archive:synthetic',
      type: 'inspection.check.passed', time: time.toISOString(), subject: 'synthetic-service',
      summary, correlationid: 'archive-browser-chain', data: { note: '<script>inert</script>' },
    });
    const history = [make('archived-first', old, '封存匯回 · 原始檢查紀錄'), make('archived-related', new Date(old.getTime() + 1000), '封存匯回 · 關聯檢查紀錄')];
    const sequences = [];
    for (const event of history) sequences.push((await api('/v1/events', { role: 'source', method: 'POST', body: event, status: 202 })).seq);
    const ordinary = make('ordinary-current', new Date(), '目前熱資料 · 未曾封存');
    const ordinarySeq = (await api('/v1/events', { role: 'source', method: 'POST', body: ordinary, status: 202 })).seq;
    const original = await api('/v1/events/' + sequences[0]);
    await cli('archive', 'run', '--db', dbPath, '--archive-dir', archivePath);
    await cli('archive', 'verify', '--db', dbPath, '--archive-dir', archivePath, '--day', day);
    for (const seq of sequences) await api('/v1/events/' + seq, { status: 404 });
    const db = new DatabaseSync(dbPath);
    let manifest;
    try { manifest = db.prepare('SELECT path,event_count,sha256 FROM archives WHERE day=?').get(day); }
    finally { db.close(); }
    const bytes = await readFile(join(archivePath, manifest.path));
    if (manifest.event_count !== 2 || manifest.sha256 !== createHash('sha256').update(bytes).digest('hex')) throw new Error('M5 manifest independent check failed');
    await cli('archive', 'import', '--db', dbPath, '--archive-dir', archivePath, '--day', day, '--reason', 'synthetic Chromium drill');
    await cli('archive', 'import', '--db', dbPath, '--archive-dir', archivePath, '--day', day, '--reason', 'synthetic Chromium repeated import');
    const detail = await api('/v1/events/' + sequences[0]);
    if (!detail.item.restored || detail.item.received_at !== original.item.received_at || JSON.stringify(detail.item.event) !== JSON.stringify(original.item.event)) throw new Error('M5 restored detail changed identity/content');
    const result = await api('/v1/events?source=' + encodeURIComponent(ordinary.source));
    if (result.items.length !== 3 || result.items.filter(item => item.restored).length !== 2) throw new Error('M5 repeat import duplicate or missing restored metadata');
    return { base, tokens, api, sequences, ordinarySeq, history, original, stop };
  } catch (error) { await stop(); throw error; }
}

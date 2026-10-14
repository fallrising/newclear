import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

// Real production process and checked-in synthetic producer examples only.
export async function startSourcesFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'signalhub-m6-browser-'));
  const sample = async name => JSON.parse(await readFile(new URL('../examples/sources/' + name, import.meta.url), 'utf8'));
  const tokens = Object.fromEntries(['owner', 'reader', 'release', 'inspection', 'alertmanager'].map(role => [role, randomBytes(32).toString('base64url')]));
  let child;
  let closed = false;
  async function stop() {
    if (closed) return;
    closed = true;
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
    const config = await sample('config.json');
    if (config.subscriptions.length || config.webhook_allowlist.length) throw new Error('M6 browser fixture must have no outbound targets');
    for (const source of config.sources) {
      source.token_ref = ref(source.name);
      source.expected_interval = '1h';
    }
    const configPath = join(directory, 'config.json');
    await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
    child = spawn(resolve(process.env.SIGNALHUB_BINARY || '/tmp/signalhub'), [
      '-config', configPath, '-db', join(directory, 'events.sqlite'),
      '-owner-token-ref', ref('owner'), '-readonly-token-ref', ref('reader'), '-listen', '127.0.0.1:0',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    const base = await new Promise((resolve, reject) => {
      let stderr = '';
      const timer = setTimeout(() => reject(new Error('M6 Go fixture startup timeout')), 15_000);
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('exit', () => { clearTimeout(timer); reject(new Error('M6 fixture exited before startup: ' + stderr)); });
      child.stderr.on('data', chunk => {
        stderr = (stderr + chunk.toString()).slice(-16_384);
        const match = stderr.match(/signalhub listening on (127\.0\.0\.1:\d+)/);
        if (match) { clearTimeout(timer); resolve('http://' + match[1]); }
      });
    });
    const events = [await sample('release.json'), await sample('inspection.json')];
    const alert = await sample('alertmanager-firing.json');
    async function send(role, path, body, expected) {
      const response = await fetch(base + path, { method: 'POST', headers: {
        Authorization: 'Bearer ' + tokens[role], 'Content-Type': 'application/json',
      }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
      const result = await response.json();
      if (response.status !== expected) throw new Error('M6 seed HTTP ' + response.status);
      return result;
    }
    const seqs = [];
    for (const [i, role] of ['release', 'inspection'].entries()) {
      seqs.push((await send(role, '/v1/events', events[i], 202)).seq);
      const repeated = await send(role, '/v1/events', events[i], 200);
      if (!repeated.duplicate || repeated.seq !== seqs[i]) throw new Error('M6 immutable retry changed identity');
    }
    const result = await send('alertmanager', '/v1/adapters/alertmanager', alert, 200);
    if (result.results.length !== 1 || result.results[0].status !== 202) throw new Error('M6 Alertmanager member failed');
    seqs.push(result.results[0].seq);
    return { base, tokens, events, alert, seqs, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

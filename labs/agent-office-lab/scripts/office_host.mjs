// Actual restartable Office process; private configuration and ready link remain in the run.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { startLocalOffice } from './office_runtime.mjs';
import { observePermissions } from './permission_probe.mjs';

const configFile = path.resolve(process.argv[2]);
const config = JSON.parse(readFileSync(configFile, 'utf8'));
let office;
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  if (office) {
    const closed = new Promise(resolve => office.server.once('close', resolve));
    office.shutdown(false);
    office.server.closeAllConnections();
    await closed;
  }
  process.exit(0);
}
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => void stop());
try {
  office = await startLocalOffice(config);
  for (const floor of office.floors()) observePermissions(floor.workers, {
    hook(workerId, payload, accepted) {
      if (accepted) process.send?.({ t: 'hook', workerId, payload });
    },
  }, error => process.send?.({ t: 'error', error: String(error) }));
  const port = office.server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const ready = { pid: process.pid, port, url: base + '/lite', sign_in: base + office.signInLink() };
  writeFileSync(path.join(config.out, 'host-ready.json'), JSON.stringify(ready) + '\n', { mode: 0o600 });
  process.send?.({ t: 'ready', ...ready });
  process.on('message', msg => {
    if (msg.t === 'inspect') process.send?.({ t: 'inspect', request: msg.request,
      workers: office.floors().flatMap(f => f.workers.list()), owners: office.floors().flatMap(f => f.workers.owners()) });
    if (msg.t === 'stop') void stop();
  });
} catch (error) {
  process.send?.({ t: 'error', error: String(error) });
  console.error(String(error));
  process.exit(1);
}

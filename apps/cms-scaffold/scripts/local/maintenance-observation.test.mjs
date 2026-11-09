import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as turn } from 'node:timers/promises';
import { releasedSourceFixture } from '../ops/local-recovery-released.fixture.mjs';
import { canonicalBytes, sha256 } from '../ops/recovery-protocol.mjs';
import { beginReadonlyObservation, observationContext, assertObservationGate,
  reserveObservationHelper, registerObservationHelper, observationCleanupContext, closeObservation, finishObservation,
  assertObservationDrain } from './maintenance-observation.mjs';
import { inspectTarget } from './maintenance-target.mjs';
import { workflowSignalContext } from './maintenance-workflow.mjs';
import { WORKFLOW_PHASES } from './maintenance-store.mjs';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { readFileSync } from 'node:fs';
import { runReadonlyInventory, verifiedReadonlyInventoryResult } from './maintenance-helper.mjs';

async function owner(t) {
  const f = await releasedSourceFixture(t);
  const token = await beginReadonlyObservation(f.readonlyIds, f.readonlyDeps);
  t.after(() => closeObservation(token));
  return { ...f, token };
}
test('readonly owner pins real released source and rejects clone/foreign/closed tokens', async t => {
  const f = await owner(t), c = await observationContext(f.token, f.readonlyDeps);
  assert.deepEqual(c.material.proof, f.proof);
  assert.equal(c.operationId, f.lease.operationId);
  assert.match(c.seq, /^[1-9][0-9]*$/);
  assert.ok(Number(c.seq) < 2 ** 48);
  assert.match(c.helperRoot, new RegExp(`/verification/${f.lease.operationId}/[a-f0-9]{32}$`));
  assert.equal(Object.hasOwn(c, 'lease'), false);
  await assert.rejects(observationContext({ ...f.token }, f.readonlyDeps));
  assert.throws(() => assertObservationGate(JSON.parse(JSON.stringify(f.token))));
  closeObservation(f.token);
  await assert.rejects(observationContext(f.token, f.readonlyDeps));
});
test('readonly initial material read already watches transient lock and unrelated setup events', async t => {
  for (const name of ['operation.lock', 'verification']) await t.test(name, async t => {
    const f = await releasedSourceFixture(t), original = f.readonlyDeps.command;
    let injected = false, token;
    const deps = { ...f.readonlyDeps, command: async (...args) => {
      if (!injected) { injected = true; const p = join(f.base, name); await mkdir(p, { mode: 0o700 }); await rm(p, { recursive: true }); }
      return original(...args);
    } };
    try { await assert.rejects(async () => { token = await beginReadonlyObservation(f.readonlyIds, deps); }); }
    finally { if (token) closeObservation(token); }
    assert.equal(injected, true);
  });
});
test('readonly guard rejects changed bytes/inode and a transient lock permanently', async t => {
  for (const mutation of ['bytes', 'inode', 'lock']) await t.test(mutation, async t => {
    const f = await owner(t), lease = join(f.base, 'lease.json'), bytes = await readFile(lease);
    if (mutation === 'bytes') await writeFile(lease, Buffer.concat([bytes, Buffer.from(' ')]));
    if (mutation === 'inode') {
      await writeFile(lease + '.replacement', bytes, { mode: 0o600 });
      await rename(lease + '.replacement', lease);
    }
    if (mutation === 'lock') {
      await mkdir(join(f.base, 'operation.lock'), { mode: 0o700 });
      await rm(join(f.base, 'operation.lock'), { recursive: true });
      await turn(10);
    }
    assert.throws(() => assertObservationGate(f.token));
    await assert.rejects(observationContext(f.token, f.readonlyDeps));
  });
});
test('readonly rejects orphan/incomplete older operation with latest released lease', async t => {
  for (const shape of ['orphan', 'incomplete']) await t.test(shape, async t => {
    const f = await releasedSourceFixture(t), id = '12345678-1234-4123-8123-123456789abc';
    const p = join(f.base, 'operations', id + (shape === 'orphan' ? '.request.json' : '.json'));
    await writeFile(p, canonicalBytes(shape === 'orphan' ? f.request : {
      operationId: id, operation: 'FRESH_INIT', targetId: f.lease.source.targetId,
      releaseId: f.lease.releaseId, phase: 'BOUND', at: f.request.startedAt, failureCode: null
    }), { mode: 0o600 });
    await assert.rejects(beginReadonlyObservation(f.readonlyIds, f.readonlyDeps));
  });
});
test('readonly accepts actual completed legacy bootstrap pair beside V2 restore', async t => {
  const f = await releasedSourceFixture(t), id = '12345678-1234-4123-8123-123456789abc';
  const common = { operationId: id, operation: 'FRESH_INIT', targetId: f.lease.source.targetId,
    releaseId: f.lease.releaseId };
  await writeFile(join(f.base, 'operations', id + '.json'), JSON.stringify({ ...common,
    phase: 'COMPLETE', at: f.request.startedAt, failureCode: null }) + '\n', { mode: 0o600 });
  await writeFile(join(f.base, 'operations', id + '.result.json'), JSON.stringify({ ...common,
    principalId: '12345678-1234-4123-8123-000000000001', completedAt: f.request.startedAt }) + '\n', { mode: 0o600 });
  const token = await beginReadonlyObservation(f.readonlyIds, f.readonlyDeps);
  t.after(() => closeObservation(token));
  assertObservationGate(token);
  await assert.rejects(reserveObservationHelper(token, { step: 7 }, f.readonlyDeps));
  const reservation = await reserveObservationHelper(token, { step: 1 }, f.readonlyDeps);
  assert.deepEqual(reservation, {});
  await assert.rejects(reserveObservationHelper(token, { step: 1 }, f.readonlyDeps));
});
test('readonly preserves original D01 historical Java output permissions', async t => {
  const f = await releasedSourceFixture(t);
  const output = join(f.base, 'operations', f.lease.operationId, 'helper/1/profile/output');
  await mkdir(output, { recursive: true, mode: 0o700 });
  await writeFile(join(output, 'java'), 'synthetic', { mode: 0o644 });
  const token = await beginReadonlyObservation(f.readonlyIds, f.readonlyDeps);
  t.after(() => closeObservation(token)); assertObservationGate(token);
});
test('readonly rejects an existing temporary registry file despite latest COMPLETE', async t => {
  const f = await releasedSourceFixture(t);
  await writeFile(join(f.base, 'lease.json.tmp-original'), '{}\n', { mode: 0o600 });
  await assert.rejects(beginReadonlyObservation(f.readonlyIds, f.readonlyDeps));
});
test('readonly accepts actual terminal V2 recover request/journal/result without fabricating lease', async t => {
  const f = await releasedSourceFixture(t), id = '12345678-1234-4123-8123-123456789abc';
  const request = { version: 1, operationId: id, sourceRunId: f.lease.source.runId, purpose: 'RECOVER_ADMIN',
    targetRunId: null, incidentStartedAt: null, startedAt: f.request.startedAt, environment: null };
  const journal = { version: 2, operationId: id, purpose: request.purpose, sourceTargetId: f.lease.source.targetId,
    releaseId: f.lease.releaseId, records: WORKFLOW_PHASES.RECOVER_ADMIN.flatMap((phase, index) => ['BEGIN', 'END'].map((event, n) => ({
      seq: String(index * 2 + n + 1), phase, event, at: request.startedAt, failureCode: null,
      leaseSha256: 'a'.repeat(64), proofSha256: index < 2 ? null : f.proof.proofSha256 }))) };
  const result = { operationId: id, operation: request.purpose, principalId: '12345678-1234-4123-8123-000000000001',
    targetId: f.lease.source.targetId, releaseId: f.lease.releaseId, completedAt: request.startedAt };
  for (const [suffix, value] of [['.request', request], ['', journal], ['.result', result]])
    await writeFile(join(f.base, 'operations', id + suffix + '.json'), canonicalBytes(value), { mode: 0o600 });
  const token = await beginReadonlyObservation(f.readonlyIds, f.readonlyDeps);
  t.after(() => closeObservation(token)); assertObservationGate(token);
});
test('target inspector rejects forged observation and mixed workflow routes', async t => {
  const f = await releasedSourceFixture(t);
  await assert.rejects(inspectTarget(f.root, f.readonlyDeps, { apiState: 'stopped', observation: {} }));
  await assert.rejects(inspectTarget(f.root, f.readonlyDeps, { apiState: 'stopped', observation: {}, workflow: {} }));
});
test('readonly reservation and JSON policy cannot authorize registration or normal workflow', async t => {
  const f = await owner(t), reservation = await reserveObservationHelper(f.token, { step: 1 }, f.readonlyDeps);
  await assert.rejects(registerObservationHelper(f.token, { policy: {}, helper: {} }, reservation, f.readonlyDeps));
  await assert.rejects(observationCleanupContext(f.token, reservation, f.readonlyDeps));
  await assert.rejects(workflowSignalContext(f.token, f.readonlyDeps));
  await assert.rejects(reserveObservationHelper(f.token, { step: 2 }, f.readonlyDeps));
});
test('readonly guard fails on an added operation, extra client and caller cancellation', async t => {
  for (const mutation of ['operation', 'client', 'cancel']) await t.test(mutation, async t => {
    const f = await releasedSourceFixture(t), controller = new AbortController();
    const deps = { ...f.readonlyDeps, signal: controller.signal };
    const token = await beginReadonlyObservation(f.readonlyIds, deps); t.after(() => closeObservation(token));
    if (mutation === 'operation') await writeFile(join(f.base, 'operations', 'unknown.tmp'), 'x', { mode: 0o600 });
    if (mutation === 'client') f.realSource.state.backends = [{ pid: 55 }];
    if (mutation === 'cancel') controller.abort();
    await assert.rejects(observationContext(token, deps));
    if (mutation === 'client') {
      f.realSource.state.backends = [];
      await assert.rejects(observationContext(token, deps));
    }
  });
});

// Typed daemon/streams, real files, actual fixed runner and private owner. No ticket factory.
async function liveOwner(t, fault) {
  const f = await releasedSourceFixture(t), source = f.realSource, original = f.readonlyDeps.command;
  await mkdir(join(f.cwd, 'scripts/ops'), { recursive: true });
  await writeFile(join(f.cwd, 'scripts/ops/local-media.mjs'), readFileSync(new URL('../ops/local-media.mjs', import.meta.url)));
  await mkdir(join(f.root, 'secrets'), { mode: 0o700 });
  await writeFile(join(f.root, 'secrets/spring.datasource.password'), 'synthetic', { mode: 0o600 });
  let counter = 100; f.created = []; f.started = []; f.permits = []; f.earlyEnded = false;
  f.drainProbe = { caught: false, regained: null };
  f.controller = new AbortController(); f.readonlyDeps.signal = f.controller.signal;
  const helpers = () => source.state.containers.filter(c => c.Config.Labels['org.cms.pp1c.operation']);
  const state = (c, status) => {
    c.State = { Status: status, Running: status === 'running', ExitCode: 0 };
    if (c.HostConfig.NetworkMode === 'none') c.NetworkSettings.Networks = { none: {
      NetworkID: '0'.repeat(64), EndpointID: status === 'running' ? '8'.repeat(64) : '', IPAddress: '' } };
    else {
      const network = source.state.networks.find(n => n.Id === c.HostConfig.NetworkMode);
      c.NetworkSettings.Networks = { [network.Name]: { NetworkID: status === 'running' ? network.Id : '',
        IPAddress: status === 'running' ? '172.31.0.9' : '', EndpointID: '' } };
      if (status === 'running') network.Containers[c.Id] = { IPv4Address: '172.31.0.9/16' }; else delete network.Containers[c.Id];
    }
  };
  f.readonlyDeps.command = async (file, args, options) => {
    if (file === 'javac' || file.endsWith('/javac')) {
      if (args[0] === '-version') return { stdout: 'javac 25.0.5\n' };
      await writeFile(join(args[args.indexOf('-d') + 1], 'Profile.class'), 'synthetic-class'); return { stdout: '' };
    }
    const a = args.slice(2), value = k => a.find(x => x.startsWith(k + '='))?.slice(k.length + 1);
    if (a[0] === 'image') {
      const result = await original(file, args, options), images = JSON.parse(result.stdout);
      for (const image of images) Object.assign(image.Config, { Env: [], User: '', Volumes: image.Id === f.lease.source.images.postgres ? { '/var/lib/postgresql/data': {} } : {} });
      return { stdout: JSON.stringify(images) };
    }
    if (a[0] === 'network' && a[2] === 'none') return { stdout: JSON.stringify([{ Id: '0'.repeat(64), Name: 'none', Driver: 'null', Scope: 'local' }]) };
    if (a[0] === 'volume') return { stdout: JSON.stringify(source.state.volumes.filter(v => a.slice(2).includes(v.Name))) };
    if (a[0] === 'create') {
      const labels = a.includes(f.lease.source.images.api) ? { ...source.state.apiLabels } : {}, mounts = [];
      for (let n = 0; n < a.length; n++) {
        if (a[n] === '--label') { const text = a[++n], at = text.indexOf('='); labels[text.slice(0, at)] = text.slice(at + 1); }
        if (a[n] === '--mount') { const m = Object.fromEntries(a[++n].split(',').map(x => x.split('=')));
          mounts.push({ Type: m.type, Source: m.type === 'volume' ? source.state.volumes.find(v => v.Name === m.src).Mountpoint : m.src,
            Name: m.type === 'volume' ? m.src : undefined, Destination: m.dst, RW: !Object.hasOwn(m, 'readonly') }); }
      }
      const entry = a.indexOf('--entrypoint=' + value('--entrypoint'));
      const c = { Id: (counter++).toString(16).padStart(64, '0'), Name: '/' + a[a.indexOf('--name') + 1], Image: a[entry + 1],
        Config: { Labels: labels, Env: [], User: value('--user'), Entrypoint: [value('--entrypoint')], Cmd: a.slice(entry + 2), OpenStdin: true, Tty: false },
        HostConfig: { NetworkMode: value('--network'), ReadonlyRootfs: true, Privileged: false, CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges'],
          RestartPolicy: { Name: 'no' }, LogConfig: { Type: 'none' }, PortBindings: {}, PidMode: '', IpcMode: 'private',
          Tmpfs: Object.fromEntries(a.filter(x => x.startsWith('--tmpfs=')).map(x => x.slice(8).split(':'))) }, Mounts: mounts, NetworkSettings: { Ports: {}, Networks: {} } };
      state(c, 'created'); source.state.containers.push(c); f.created.push(c.Id);
      if (fault === 'cancel-create' || fault === 'cancel-cleanup') f.controller.abort();
      return { stdout: c.Id + '\n' };
    }
    if (a[0] === 'inspect' && a.length === 2 && a[1] !== '--format') {
      const c = source.state.containers.find(x => x.Id === a[1]);
      if (!c) throw Object.assign(new Error('synthetic missing'), { code: 1, stderr: `Error: No such object: ${a[1]}\n` });
      return { stdout: JSON.stringify([c]) };
    }
    if (a[0] === 'start' && a.includes('--attach')) {
      const c = helpers().find(x => x.Id === a.at(-1)); f.started.push(c.Id); state(c, 'exited');
      if (fault === 'class-replaced' && f.created.length === 1) {
        const classes = c.Mounts.find(m => m.Destination === '/probe/classes').Source;
        await writeFile(join(classes, 'Profile.class'), 'replaced-class');
      }
      const entry = c.Config.Entrypoint[0];
      if (entry.endsWith('/java')) return { stdout: JSON.stringify({ javaRuntimeVersion: '25.0.5+8', jdbc: true, imageio: true, privateFiles: true, mediaReadable: true }) };
      if (entry.endsWith('/pg_dump')) return { stdout: 'pg_dump (PostgreSQL) 16.15\n' };
      if (entry.endsWith('/pg_restore')) return { stdout: 'pg_restore (PostgreSQL) 16.15\n' };
      if (entry.endsWith('/id')) return { stdout: `${process.getuid()}\n` };
      return { stdout: JSON.stringify({ node: 'v24.18.0', uid: process.getuid(), gid: process.getgid(), privateFiles: true, directoryFsync: true }) };
    }
    if (a[0] === 'exec' && a.at(-1).startsWith('SHOW ')) return { stdout: a.at(-1).includes('_num') ? '160015\n' : '16.15\n' };
    if (fault === 'caught-drain' && f.earlyEnded && !f.drainProbe.caught && a[0] === 'exec' && a.at(-1).includes('pg_stat_activity')) {
      f.drainProbe.caught = true; source.state.backends = [{ pid: 999 }];
      try { await assertObservationDrain(f.token, f.readonlyDeps); assert.fail('extra backend was accepted'); }
      catch (error) { assert.equal(error.code, 'WRITER_NOT_QUIESCED'); }
      source.state.backends = [];
      try { assertObservationGate(f.token); f.drainProbe.regained = true; } catch { f.drainProbe.regained = false; }
    }
    if (a[0] === 'rm') { if (fault === 'cleanup' || fault === 'cancel-cleanup') throw new Error('synthetic cleanup failure');
      source.state.containers.splice(source.state.containers.findIndex(c => c.Id === a[1]), 1); return { stdout: '' }; }
    if (a[0] === 'wait') return { stdout: '0\n' };
    if (a[0] === 'stop') { state(helpers().find(c => c.Id === a.at(-1)), 'exited'); source.state.backends = []; return { stdout: '' }; }
    return original(file, args, options);
  };
  f.readonlyDeps.spawn = (_file, args) => {
    const c = helpers().find(x => x.Id === args.at(-1)); state(c, 'running'); f.started.push(c.Id);
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() });
    const request = JSON.parse(readFileSync(c.Mounts.find(m => m.Destination === '/run/pp1/request.json').Source));
    const backend = { pid: 91, backendStartEpoch: '1770000000.123', db: 'cms', role: 'cms_local', clientAddr: '172.31.0.9', applicationName: request.operationId };
    source.state.backends = [{ pid: 91, backend_start_epoch: backend.backendStartEpoch, datname: 'cms', usename: 'cms_local', client_addr: backend.clientAddr, application_name: request.operationId, state: 'idle in transaction' }];
    child.stdout.write(canonicalBytes({ version: 1, operationId: request.operationId, side: 'source', mode: 'INVENTORY', requestSha256: sha256(canonicalBytes(request)), backend, readOnly: true }));
    child.stdin.on('data', bytes => f.permits.push(JSON.parse(bytes)));
    child.stdin.on('finish', async () => {
      const inventory = f.captured.inventory, bytes = canonicalBytes(inventory);
      await writeFile(join(c.Mounts.find(m => m.Destination === '/run/pp1/output').Source, 'inventory.json'), bytes, { mode: 0o600 });
      source.state.backends = []; state(c, 'exited'); child.emit('close', 0, null); f.earlyEnded = true;
      if (fault === 'registry') await writeFile(join(f.base, 'lease.json'), 'changed\n');
      if (fault === 'reappear') setTimeout(() => { source.state.backends = [{ pid: 92,
        backend_start_epoch: '1770000001.123', datname: 'cms', usename: 'cms_local', client_addr: backend.clientAddr,
        application_name: request.operationId, state: 'idle in transaction' }]; }, 50);
      setTimeout(() => { child.stdout.end(canonicalBytes({ version: 1, operationId: request.operationId, mode: 'INVENTORY', inventorySha256: sha256(bytes),
        dbSnapshotSha256: inventory.dbSnapshotSha256, assetCount: String(inventory.assets.length), referencedFileCount: String(inventory.files.filter(x => x.status === 'referenced').length),
        orphanFileCount: String(inventory.files.filter(x => x.status === 'orphan').length), fileCount: String(inventory.files.length), fileBytes: '0' })); child.stderr.end(); }, 150);
    });
    return child;
  };
  const token = await beginReadonlyObservation(f.readonlyIds, f.readonlyDeps); t.after(() => closeObservation(token));
  f.token = token; return { ...f, token, get earlyEnded() { return f.earlyEnded; } };
}
test('readonly actual opaque tickets complete six probes and delayed EOF after child/backend exit', async t => {
  const f = await liveOwner(t), before = await readFile(join(f.base, 'lease.json'));
  const result = await runReadonlyInventory(f.token, f.readonlyDeps);
  assert.equal(f.created.length, 7); assert.equal(f.started.length, 7); assert.equal(f.permits.length, 1); assert.equal(f.earlyEnded, true);
  assert.deepEqual(await readFile(join(f.base, 'lease.json')), before);
  const metadata = verifiedReadonlyInventoryResult(f.token, result); assert.ok(metadata);
  assert.throws(() => verifiedReadonlyInventoryResult(f.token, result));
  await finishObservation(f.token, f.readonlyDeps); assertObservationGate(f.token);
  await assert.rejects(reserveObservationHelper(f.token, { step: 1 }, f.readonlyDeps));
  await mkdir(join(f.base, 'operation.lock'), { mode: 0o700 });
  assert.throws(() => assertObservationGate(f.token));
});
test('readonly own helper cleanup uncertainty retains private exact ID and prohibits next work', async t => {
  const f = await liveOwner(t, 'cleanup');
  await assert.rejects(runReadonlyInventory(f.token, f.readonlyDeps));
  assert.equal(f.created.length, 1); assert.equal(f.started.length, 1);
  await assert.rejects(reserveObservationHelper(f.token, { step: 2 }, f.readonlyDeps));
  assert.equal(f.realSource.state.containers.filter(c => c.Config.Labels['org.cms.pp1c.operation']).length, 1);
});
for (const fault of ['class-replaced', 'registry', 'reappear']) test(`readonly genuine helper ${fault} fails closed`, async t => {
  const f = await liveOwner(t, fault);
  await assert.rejects(runReadonlyInventory(f.token, f.readonlyDeps));
  await assert.rejects(observationContext(f.token, f.readonlyDeps));
  if (fault === 'class-replaced') assert.equal(f.created.length, 1);
  else assert.equal(f.permits.length, 1);
});
for (const fault of ['cancel-create', 'cancel-cleanup']) test(`readonly ${fault} retains creation provenance and never starts`, async t => {
  const f = await liveOwner(t, fault);
  await assert.rejects(runReadonlyInventory(f.token, f.readonlyDeps));
  assert.equal(f.created.length, 1); assert.equal(f.started.length, 0);
  const c = f.realSource.state.containers.filter(c => c.Config.Labels['org.cms.pp1c.operation']);
  assert.equal(c.length, fault === 'cancel-cleanup' ? 1 : 0);
  const roots = await import('node:fs/promises').then(fs => fs.readdir(join(f.base, 'verification', f.lease.operationId)));
  const receipt = JSON.parse(await readFile(join(f.base, 'verification', f.lease.operationId, roots[0], 'profile/probe-1.json')));
  assert.equal(receipt.fullContainerId, f.created[0]); assert.match(receipt.fullContainerId, /^[a-f0-9]{64}$/);
});
test('readonly caught direct drain extra-client failure permanently invalidates after clients return to zero', async t => {
  const f = await liveOwner(t, 'caught-drain');
  await assert.rejects(runReadonlyInventory(f.token, f.readonlyDeps));
  assert.equal(f.drainProbe.caught, true); assert.equal(f.drainProbe.regained, false);
  await assert.rejects(observationContext(f.token, f.readonlyDeps));
});

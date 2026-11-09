import test from 'node:test';
import assert from 'node:assert/strict';
import { connect } from 'node:net';
import { EventEmitter, getEventListeners } from 'node:events';
import { PassThrough } from 'node:stream';
import { canonicalBytes, sha256 } from './recovery-protocol.mjs';
import { once } from 'node:events';
import { lstat, chmod, mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildHelperPolicy } from '../local/maintenance-helper.mjs';
import { encodeSmokeFrame, createCredentialChannel, validateBrowserInput, validateSmokeFrames, runBrowserChild, runRestoreSmoke, verifiedRestoreSmoke, browserPolicyMaterial } from './local-restore-smoke.mjs';
const request = {version: 1, operationId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', targetRunId: 'a'.repeat(32), fixtureSha256: 'b'.repeat(64)};
const credentials = Object.fromEntries(['admin', 'operator'].map(actor => [actor, {principalId: actor, username: actor, password: 'PRIVATE-CANARY', oldSessionToken: 'OLD-CANARY'}]));
async function client(path) {
  const socket = connect({path, allowHalfOpen: true}); await once(socket, 'connect');
  const chunks = []; socket.on('data', chunk => chunks.push(chunk));
  return {socket, chunks};
}
test('T162_A1_real_private_socket_delivers_exactly_one_frame_then_accepts_frames_and_EOF', async t => {
  let peers = 0;const controller=new AbortController();
  const channel = await createCredentialChannel({controlledSignal:controller.signal,request, credentials, verifyPeer: async () => { peers++; }, validateObservations: value => assert.deepEqual(value, {observations: true}), validateAssertions: value => assert.deepEqual(value, {assertions: true})});
  t.after(() => channel.close()); channel.arm();
  const info = await lstat(channel.path), parent = await lstat(channel.directory);
  assert.equal(info.isSocket(), true); assert.equal(info.mode & 0o777, 0o600); assert.equal(parent.mode & 0o777, 0o700);
  assert.ok(Buffer.byteLength(channel.path) <= 100);
  const {socket, chunks} = await client(channel.path); t.after(() => socket.destroy());
  socket.write(encodeSmokeFrame(request));
  while (chunks.length === 0) await new Promise(resolve => setTimeout(resolve, 1));
  const bytes = Buffer.concat(chunks), size = bytes.readUInt32BE(0);
  assert.equal(size, bytes.length - 4); assert.deepEqual(JSON.parse(bytes.subarray(4)), {...request, ...credentials});
  socket.write(encodeSmokeFrame({observations: true})); socket.end(encodeSmokeFrame({assertions: true}));
  const result = await channel.done;
  assert.equal(result.deliveredOnce, true); assert.equal(result.eof, true); assert.ok(peers >= 1);
  assert.equal(getEventListeners(controller.signal,'abort').length,0);
});
for (const fault of ['wrong_request', 'overflow', 'early_eof', 'pipelined_observations', 'second_connection']) {
  test(`T162_A1_${fault}_fails_without_second_credential_delivery`, async t => {
    const channel = await createCredentialChannel({request, credentials, verifyPeer: async () => {}, validateObservations: () => {}, validateAssertions: () => {}});
    t.after(() => channel.close()); channel.arm();
    const {socket} = await client(channel.path); socket.on('error', () => {}); t.after(() => socket.destroy());
    if (fault === 'wrong_request') socket.end(encodeSmokeFrame({...request, targetRunId: 'c'.repeat(32)}));
    if (fault === 'overflow') { const bytes = Buffer.alloc(4); bytes.writeUInt32BE(16385); socket.end(bytes); }
    if (fault === 'early_eof') socket.end(Buffer.from([0, 0]));
    if (fault === 'pipelined_observations') socket.end(Buffer.concat([encodeSmokeFrame(request), encodeSmokeFrame({observations: true})]));
    if (fault === 'second_connection') { const second = await client(channel.path); second.socket.on('error', () => {}); t.after(() => second.socket.destroy()); }
    await assert.rejects(channel.done, error => error.code === 'SMOKE_FAILED');
  });
}


const id = digit => `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
function smokeInput() {
  const fixture = {version: 1, sourceRunId: 'c'.repeat(32), adminPrincipalId: id('1'), operatorPrincipalId: id('2'),
    oldSessionIds: {admin: id('3'), operator: id('4')}, publishedEntryId: id('5'), revisionNo: 1, refEntryId: id('6'),
    media: Object.fromEntries(['publicImageId', 'publicPdfId', 'draftImageId', 'privateImageId', 'replacedImageId', 'deletedImageId'].map((k, i) => [k, id(String(i + 1))])),
    expected: Object.fromEntries('privateEntrySha256 operatorEntrySha256 publicEntrySha256 revisionListSha256 publicOriginalSha256 publicThumbnailSha256 publicWebSha256 publicPdfSha256 draftOriginalSha256 privateOriginalSha256 replacedOriginalSha256'.split(' ').map(k => [k, 'd'.repeat(64)])),
    sessionAbsoluteSeconds: '43200', sessionMaxSeconds: '604800'};
  return {version: 1, stage: 'RESTORE_SMOKE_READY', operationId: request.operationId, sourceRunId: fixture.sourceRunId,
    targetRunId: request.targetRunId, releaseId: 'sha256:' + 'e'.repeat(64), rawComparisonSha256: 'f'.repeat(64),
    sessionCommitSha256: '1'.repeat(64), startupInventorySha256: '2'.repeat(64), fixtureSha256: hashValue(fixture), fixture};
}
function hashValue(value) { return sha256(canonicalBytes(value)); }
function frames(input) {
  const observations = {version: 1, operationId: input.operationId, targetRunId: input.targetRunId};
  for (const actor of ['admin', 'operator']) observations[actor] = {principalId: input.fixture[actor + 'PrincipalId'], sessionTokenSha256: 'a'.repeat(64),
    oldRejectedAt: '2026-11-06T17:00:01.000Z', loginStartedAt: '2026-11-06T17:00:02.000Z', loginFinishedAt: '2026-11-06T17:00:03.000Z'};
  const assertions = {...request, fixtureSha256: input.fixtureSha256, startedAt: '2026-11-06T17:00:00.000Z', finishedAt: '2026-11-06T17:00:04.000Z',
    checks: Object.fromEntries('oldAdminRejected oldOperatorRejected adminLogin operatorLogin publishedBytes privateIsolation restoredContent originTls'.split(' ').map(k => [k, true])), loginCount: '2', credentialDeliveries: '1'};
  return {observations, assertions};
}
test('T162_A2_exact_input_frames_and_time_bindings', () => {
  const input = smokeInput(), {observations, assertions} = frames(input);
  assert.equal(validateBrowserInput(input), input); assert.equal(validateSmokeFrames(input, observations, assertions), true);
  for (const fault of ['unknown', 'principal', 'hash', 'old_after_login', 'outside_stage', 'count', 'false_check']) {
    const a = structuredClone(observations), b = structuredClone(assertions);
    if (fault === 'unknown') a.extra = true;
    if (fault === 'principal') a.admin.principalId = id('9');
    if (fault === 'hash') a.admin.sessionTokenSha256 = 'CANARY';
    if (fault === 'old_after_login') a.admin.oldRejectedAt = a.admin.loginFinishedAt;
    if (fault === 'outside_stage') a.admin.loginFinishedAt = '2026-11-06T17:00:05.000Z';
    if (fault === 'count') b.loginCount = '3';
    if (fault === 'false_check') b.checks.originTls = false;
    assert.throws(() => validateSmokeFrames(input, a, b), e => e.code === 'SMOKE_FAILED');
  }
  assert.throws(() => validateBrowserInput({...input, fixtureSha256: '0'.repeat(64)}), e => e.code === 'SMOKE_FAILED');
});
test('T162_A2_changed_socket_mode_blocks_credentials_before_peer_callback', async t => {
  let checks = 0;
  const channel = await createCredentialChannel({request, credentials, verifyPeer: async () => { checks++; }, validateObservations: () => {}, validateAssertions: () => {}});
  t.after(() => channel.close()); channel.arm(); await chmod(channel.path, 0o666);
  const {socket, chunks} = await client(channel.path); socket.on('error', () => {}); t.after(() => socket.destroy()); socket.end(encodeSmokeFrame(request));
  await assert.rejects(channel.done, e => e.code === 'SMOKE_FAILED');
  await chmod(channel.path, 0o600);
  assert.equal(checks, 0); assert.equal(chunks.length, 0);
});
test('T162_A2_request_deadline_is_bounded_without_credentials', async t => {
  const channel = await createCredentialChannel({request, credentials, verifyPeer: async () => {}, requestTimeout: 10});
  t.after(() => channel.close()); channel.arm(); await assert.rejects(channel.done, e => e.code === 'SMOKE_FAILED');
});


const childEnvironment = {CMS_PP1_SUITE: 'recovery', CMS_PP1_TLS_MODE: 'trusted', CMS_PP1_RECOVERY_INPUT: '/fixture/browser.json',
  CMS_PP1_CREDENTIAL_SOCKET: '/run/pp1/credential.sock', CMS_PP1_CHROMIUM: '/chromium/chrome', CMS_PP1_RUN_ROOT: '/fixture',
  HOME: '/tmp/browser-home', XDG_CACHE_HOME: '/tmp/browser-cache', PATH: '/usr/bin:/bin'};
function launcher() {
  const calls = [], child = Object.assign(new EventEmitter(), {stdout: new PassThrough(), stderr: new PassThrough(), kill: () => {}});
  return {calls, deps: {environment: childEnvironment, mkdir: async (path, options) => calls.push({path, options}),
    command: async (file, args, options) => { calls.push({file, args, options}); return {stdout: '', stderr: ''}; },
    spawn: (file, args, options) => { calls.push({file, args, options}); setImmediate(() => { child.stdout.end('RAW-PRIVATE-CANARY'); child.stderr.end('RAW-ERROR-CANARY'); child.emit('close', 0, null); }); return child; }}};
}
test('T162_B2_browser_child_installs_NSS_before_only_fixed_Playwright_command', async () => {
  const f = launcher(); assert.equal(await runBrowserChild(['browser-child'], f.deps), 0);
  const commands = f.calls.filter(call => call.file);
  assert.deepEqual(commands.map(call => call.file), ['/nss-tools/certutil', '/nss-tools/certutil', '/opt/pp1-node']);
  assert.deepEqual(commands[0].args, ['-N', '--empty-password', '-d', 'sql:/tmp/browser-home/.pki/nssdb']);
  assert.deepEqual(commands[1].args, ['-A', '-d', 'sql:/tmp/browser-home/.pki/nssdb', '-n', 'pp1c-child', '-t', 'C,,', '-i', '/fixture/ca.crt']);
  assert.deepEqual(commands[2].args, ['/work/node_modules/@playwright/test/cli.js', 'test', '--config', '/work/playwright.pp1-local.config.ts', '--workers=1', '--retries=0', '--timeout=120000', '--reporter=list']);
  assert.equal(commands[2].options.shell, false); assert.equal(commands[2].options.cwd, '/work');
  assert.deepEqual(commands[2].options.stdio, ['ignore', 'pipe', 'pipe']);
});
for (const fault of ['arbitrary_argv', 'untrusted', 'extra_env', 'node_options', 'NSS_failure']) {
  test(`T162_B2_${fault}_rejects_before_runner`, async () => {
    const f = launcher(); f.deps.environment = {...childEnvironment};
    if (fault === 'untrusted') f.deps.environment.CMS_PP1_TLS_MODE = 'untrusted';
    if (fault === 'extra_env') f.deps.environment.CMS_PP1_SECRET = 'CANARY';
    if (fault === 'node_options') f.deps.environment.NODE_OPTIONS = '--inspect';
    if (fault === 'NSS_failure') f.deps.command = async () => { throw Error('RAW-PRIVATE-CANARY'); };
    assert.equal(await runBrowserChild(fault === 'arbitrary_argv' ? ['browser-child', 'shell'] : ['browser-child'], f.deps), 7);
    assert.ok(!f.calls.some(call => call.file === '/opt/pp1-node'));
  });
}


async function hostFixture(t, fault = null) {
  const directory = await mkdtemp('/tmp/cms-smoke-test-'); t.after(() => rm(directory, {recursive: true, force: true}));
  const workflowController=new AbortController();
  const input = smokeInput(), token = Object.freeze({}), root = join(directory, 'target'), helperRoot = join(directory, 'helper/1');
  await mkdir(join(root, 'tls'), {recursive: true, mode: 0o700}); await mkdir(helperRoot, {recursive: true, mode: 0o700});
  if(fault==='diagnostic-existing')await writeFile(join(helperRoot,'browser-diagnostic.json'),'PRIOR-EVIDENCE',{mode:0o600});
  await writeFile(join(root, 'tls/ca.crt'), 'synthetic-public-CA', {mode: 0o600});
  const target = {runId: input.targetRunId, project: 'cms-pp1-local-' + input.targetRunId,
    images: {node: 'sha256:' + 'a'.repeat(64)}, networkIds: {web: 'b'.repeat(64)}, nodeBinarySha256: '41a74efb34cbde5c7632cdac0cf8bd1a14d0b8d73dc1e82755014d9a9ce70f5c',
    apiBuild: {jarSha256: input.releaseId.slice(7)}};
  const context = {root, runRoot: root, cwd: process.cwd(), helperRoot, operationId: input.operationId, seq: '1', helperSequence: 1,
    uid: process.getuid(), gid: process.getgid(), nodeBinary: process.execPath, target, webNetworkName: target.project + '_web', ingressWebAddress: '192.168.252.3',
    lease: {phase: 'BROWSER_VERIFIED', source: {runId: input.sourceRunId}, helper: null}};
  const secrets = Object.fromEntries(['admin', 'operator'].map(actor => [actor, {principalId: input.fixture[actor + 'PrincipalId'], username: actor, password: 'PRIVATE-CANARY-1234', oldSessionToken: 'OLD-CANARY-' + actor}]));
  const bindings = Object.fromEntries(['admin', 'operator'].map(actor => [actor, {principalId: secrets[actor].principalId, username: actor,
    oldSessionId: input.fixture.oldSessionIds[actor], oldSessionTokenSha256: sha256(Buffer.from(secrets[actor].oldSessionToken)), oldSessionExpiresAt: '2026-11-07 17:00:00+00'}]));
  let container, peerDelivered = false;
  const wf = {workflowSignalContext:async value=>{assert.equal(value,token);return {signal:workflowController.signal};},reserveHelper: async value => assert.equal(value, token), browserHelperContext: async value => { assert.equal(value, token); return context; },
    assertWorkflow: async value => { assert.equal(value, token); return context; },
    registerOwnedHelper: async (value, registered) => { assert.equal(value, token); context.lease.helper = registered; },
    updateOwnedHelper: async (value, registered) => { assert.equal(value, token); context.lease.helper = registered; },
    clearOwnedHelper: async value => { assert.equal(value, token); context.lease.helper = null; }};
  const deps = {workflow: wf, verifier: {restoreSmokeContext: async value => { assert.equal(value, token); return {input, credentialBindings: bindings}; }},
    command: async (_file, args) => ({stdout: JSON.stringify(args.includes('image') ? [{Id: target.images.node, Os: 'linux', Config: {Env: ['PATH=/usr/bin'], Labels: {}}}] : [container])}),
    lifecycle: async (policy, expected, consume, callbacks) => {
      const id = 'f'.repeat(64), material = await browserPolicyMaterial(token, deps);
      assert.deepEqual(buildHelperPolicy({...context, kind: 'BROWSER', side: 'target', browser: material, image: {Id: target.images.node, Os: 'linux', Config: {Env: ['PATH=/usr/bin'], Labels: {}}}}), policy);
      container = {Id: id, Name: '/' + expected.name, Image: policy.imageId, State: {Status: 'created', Running: false, ExitCode: 0},
        Config: {Labels: expected.labels, Env: policy.env, User: policy.user, Entrypoint: [policy.entrypoint], Cmd: policy.args, OpenStdin: true, Tty: false},
        HostConfig: {NetworkMode: policy.networkId, ReadonlyRootfs: true, Privileged: false, CapDrop: ['ALL'], CapAdd: null,
          SecurityOpt: ['no-new-privileges'], RestartPolicy: {Name: 'no'}, LogConfig: {Type: 'none'}, PortBindings: {}, Devices: [], DeviceRequests: null,
          ExtraHosts: null, PidMode: '', IpcMode: 'private', AutoRemove: false, Tmpfs: {'/tmp': 'rw,nosuid,nodev,size=536870912'}},
        Mounts: policy.mounts.map(m => ({Type: m.type, Source: m.source, Destination: m.destination, RW: false})), NetworkSettings: {Ports: {}, Networks: {[expected.webNetworkName]: {NetworkID: '', IPAddress: '', EndpointID: ''}}}};
      await callbacks.onCreated(id, container, {...expected, fullContainerId: id});
      container.State = {Status: 'running', Running: true, ExitCode: 0}; container.NetworkSettings.Networks[expected.webNetworkName] = {NetworkID: policy.networkId, IPAddress: '192.168.252.4'};
      await callbacks.onRunning(id, container);
      if (fault === 'peer_id') container.Id = '0'.repeat(64);
      if (fault === 'peer_network') container.NetworkSettings.Networks = {foreign_web: container.NetworkSettings.Networks[expected.webNetworkName]};
      if (fault === 'peer_mount') container.Mounts.find(m => m.Destination === '/run/pp1/credential.sock').RW = true;
      if (fault === 'input_changed') await writeFile(material.inputFile, 'tampered', {mode: 0o600});
      const child = {stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough()};
      const connection = await client(material.socketFile); connection.socket.on('error', () => {}); t.after(() => connection.socket.destroy());
      connection.socket.write(encodeSmokeFrame({version: 1, operationId: input.operationId, targetRunId: input.targetRunId, fixtureSha256: input.fixtureSha256}));
      const sender = (async () => {
        while (connection.chunks.length === 0 && !connection.socket.destroyed) await new Promise(resolve => setTimeout(resolve, 1));
        if (!connection.chunks.length) return;
        peerDelivered = true; const f = frames(input);
        connection.socket.write(encodeSmokeFrame(f.observations)); connection.socket.end(encodeSmokeFrame(f.assertions));
      })();
      child.stdout.end(); child.stderr.end(fault?.startsWith('diagnostic')?'PRIVATE-CANARY\nPP1C_DIAG:L_PW_EXIT\nPP1C_DIAG:J_CONTEXTS\nPP1C_DIAG:J_CONTEXTSSECRET-CANARY\n':'');
      try { const value = await consume(child, {id, container, policy}); await sender; return value; }
      finally {
        container.Id = id; container.State = {Status: 'exited', Running: false, ExitCode: ['nonzero_exit','diagnostic','diagnostic-existing'].includes(fault) ? 1 : 0};
        container.NetworkSettings.Networks[expected.webNetworkName] = {NetworkID: '', IPAddress: '', EndpointID: ''};
        await callbacks.onExited(id, container); await callbacks.onRemoved(id);
      }
    }};
  return {token, input, context, secrets, deps, workflowController, delivered: () => peerDelivered};
}
test('T162_C1_real_files_socket_policy_and_private_result_bind_actual_completion', async t => {
  const f = await hostFixture(t), result = await runRestoreSmoke(f.token, {fixture: f.input.fixture, recoverySecrets: f.secrets, startupInventorySha256: f.input.startupInventorySha256}, f.deps);
  const owned = await verifiedRestoreSmoke(f.token, result, f.deps);
  await assert.rejects(readFile(join(f.context.helperRoot,'browser-diagnostic.json')),{code:'ENOENT'});
  assert.equal(f.delivered(), true); assert.equal(owned.deliveredOnce, true); assert.equal(owned.eof, true); assert.equal(owned.exitCode, 0);
  assert.equal(owned.observations.admin.principalId, f.input.fixture.adminPrincipalId);
  await assert.rejects(verifiedRestoreSmoke(f.token, structuredClone(result), f.deps), e => e.code === 'SMOKE_FAILED');
  await assert.rejects(verifiedRestoreSmoke({}, result, f.deps), e => e.code === 'SMOKE_FAILED');
  f.context.lease.phase = 'TARGET_STOPPED'; f.context.helperSequence = 2;
  assert.equal((await verifiedRestoreSmoke(f.token, result, f.deps)).eof, true);
  f.context.helperSequence = 3;
  await assert.rejects(verifiedRestoreSmoke(f.token, result, f.deps), e => e.code === 'SMOKE_FAILED');
});
test('T162_C1_wrong_live_full_ID_cannot_receive_credentials', async t => {
  const f = await hostFixture(t, 'peer_id');
  await assert.rejects(runRestoreSmoke(f.token, {fixture: f.input.fixture, recoverySecrets: f.secrets, startupInventorySha256: f.input.startupInventorySha256}, f.deps), e => e.code === 'SMOKE_FAILED');
  assert.equal(f.delivered(), false);
});


for (const fault of ['peer_network', 'peer_mount', 'input_changed', 'nonzero_exit']) {
  test(`T162_C1_${fault}_cannot_mint_a_smoke_result`, async t => {
    const f = await hostFixture(t, fault);
    await assert.rejects(runRestoreSmoke(f.token, {fixture: f.input.fixture, recoverySecrets: f.secrets, startupInventorySha256: f.input.startupInventorySha256}, f.deps), e => e.code === 'SMOKE_FAILED');
    if (fault !== 'nonzero_exit') assert.equal(f.delivered(), false);
  });
}
for (const fault of ['fixture', 'startup', 'old_token_hash', 'foreign_token']) {
  test(`T162_C1_wrong_${fault}_refused_before_delivery`, async t => {
    const f = await hostFixture(t), options = {fixture: f.input.fixture, recoverySecrets: f.secrets, startupInventorySha256: f.input.startupInventorySha256};
    if (fault === 'fixture') options.fixture = {...options.fixture, revisionNo: 2};
    if (fault === 'startup') options.startupInventorySha256 = '0'.repeat(64);
    if (fault === 'old_token_hash') options.recoverySecrets.admin.oldSessionToken += '-changed';
    await assert.rejects(runRestoreSmoke(fault === 'foreign_token' ? {} : f.token, options, f.deps), e => e.code === 'SMOKE_FAILED');
    assert.equal(f.delivered(), false);
  });
}
test('T162_A2_completed_frames_without_EOF_never_succeed', async t => {
  const channel = await createCredentialChannel({request, credentials, verifyPeer: async () => {}, validateObservations: () => {}, validateAssertions: () => {}, stageTimeout: 10});
  t.after(() => channel.close()); channel.arm(); const {socket, chunks} = await client(channel.path); socket.on('error', () => {}); t.after(() => socket.destroy());
  socket.write(encodeSmokeFrame(request)); while (!chunks.length) await new Promise(resolve => setTimeout(resolve, 1));
  socket.write(Buffer.concat([encodeSmokeFrame({observations: true}), encodeSmokeFrame({assertions: true})]));
  await assert.rejects(channel.done, e => e.code === 'SMOKE_FAILED');
});


test('T162_E1_abort_during_suspended_peer_never_delivers_credentials', {timeout:5000}, async t => {
  const controller=new AbortController(),entered=Promise.withResolvers(),resume=Promise.withResolvers();
  const channel=await createCredentialChannel({request,credentials,controlledSignal:controller.signal,
    verifyPeer:async()=>{entered.resolve();await resume.promise;},requestTimeout:200,stageTimeout:200});
  let closed=false;t.after(async()=>{resume.resolve();if(!closed)await channel.close();});channel.arm();
  const connection=await client(channel.path);connection.socket.on('error',()=>{});t.after(()=>connection.socket.destroy());
  connection.socket.write(encodeSmokeFrame(request));await entered.promise;
  controller.abort();resume.resolve();await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal(connection.chunks.reduce((size,chunk)=>size+chunk.length,0),0);
  await assert.rejects(channel.done,{code:'INTERRUPTED'});assert.throws(()=>channel.result(),{code:'INTERRUPTED'});
  assert.equal(getEventListeners(controller.signal,'abort').length,0);
  await channel.close();closed=true;await assert.rejects(lstat(channel.path),{code:'ENOENT'});
  await assert.rejects(lstat(channel.directory),{code:'ENOENT'});
});
test('T162_E1_already_aborted_signal_refuses_channel_creation',async t=>{
  const controller=new AbortController();controller.abort();let unexpected;
  t.after(async()=>{if(unexpected)await unexpected.close();});
  await assert.rejects(createCredentialChannel({request,credentials,controlledSignal:controller.signal}).then(value=>{unexpected=value;}),{code:'INTERRUPTED'});
});

for(const fault of ['before-arm','ordinary-frame'])test(`T162_E1_${fault}_detaches_abort_listener`,async t=>{
  const controller=new AbortController(),channel=await createCredentialChannel({request,credentials,controlledSignal:controller.signal,verifyPeer:async()=>{}});
  t.after(()=>channel.close());assert.equal(getEventListeners(controller.signal,'abort').length,1);
  if(fault==='before-arm')controller.abort();
  else {channel.arm();const connection=await client(channel.path);connection.socket.on('error',()=>{});t.after(()=>connection.socket.destroy());connection.socket.end(encodeSmokeFrame({wrong:true}));}
  await assert.rejects(channel.done,{code:fault==='before-arm'?'INTERRUPTED':'SMOKE_FAILED'});
  assert.equal(getEventListeners(controller.signal,'abort').length,0);
});
test('T162_E1_abort_during_final_EOF_peer_check_cannot_seal_success',{timeout:5000},async t=>{
  const controller=new AbortController(),entered=Promise.withResolvers(),resume=Promise.withResolvers();let checks=0;
  const channel=await createCredentialChannel({request,credentials,controlledSignal:controller.signal,
    verifyPeer:async()=>{if(++checks===4){entered.resolve();await resume.promise;}},validateObservations:()=>{},validateAssertions:()=>{}});
  t.after(async()=>{resume.resolve();await channel.close();});channel.arm();
  const connection=await client(channel.path);connection.socket.on('error',()=>{});t.after(()=>connection.socket.destroy());
  connection.socket.write(encodeSmokeFrame(request));while(!connection.chunks.length)await new Promise(resolve=>setTimeout(resolve,1));
  connection.socket.end(Buffer.concat([encodeSmokeFrame({observations:true}),encodeSmokeFrame({assertions:true})]));
  await entered.promise;controller.abort();resume.resolve();
  await assert.rejects(channel.done,{code:'INTERRUPTED'});assert.throws(()=>channel.result(),{code:'INTERRUPTED'});
  assert.equal(getEventListeners(controller.signal,'abort').length,0);
});

for(const source of ['workflow','caller'])test(`T162_E2_preaborted_${source}_signal_prevents_helper_reservation`,async t=>{
  const f=await hostFixture(t),caller=new AbortController();f.deps.signal=caller.signal;
  (source==='workflow'?f.workflowController:caller).abort();let reservations=0;
  f.deps.workflow.reserveHelper=async()=>{reservations++;};
  await assert.rejects(runRestoreSmoke(f.token,{fixture:f.input.fixture,recoverySecrets:f.secrets,startupInventorySha256:f.input.startupInventorySha256},f.deps),{code:'INTERRUPTED'});
  assert.equal(reservations,0);assert.equal(f.delivered(),false);
});
for(const source of ['workflow','caller'])test(`T162_E2_cancelled_${source}_cannot_reuse_completed_private_browser_result`,async t=>{
  const f=await hostFixture(t),caller=new AbortController();f.deps.signal=caller.signal;
  const result=await runRestoreSmoke(f.token,{fixture:f.input.fixture,recoverySecrets:f.secrets,startupInventorySha256:f.input.startupInventorySha256},f.deps);
  (source==='workflow'?f.workflowController:caller).abort();
  await assert.rejects(verifiedRestoreSmoke(f.token,result,f.deps),{code:'INTERRUPTED'});
});
for(const source of ['workflow','caller'])test(`T162_E2_${source}_abort_suspended_real_peer_cleans_owned_helper_and_socket`,{timeout:30000},async t=>{
  const f=await hostFixture(t),caller=new AbortController(),entered=Promise.withResolvers(),resume=Promise.withResolvers();
  f.deps.signal=caller.signal;const command=f.deps.command,lifecycle=f.deps.lifecycle;let held=false,lifecycleSignal;
  f.deps.command=async(...args)=>{
    const value=await command(...args);
    if(!held&&args[1].includes('inspect')&&!args[1].includes('image')){held=true;entered.resolve();await resume.promise;}
    return value;
  };
  f.deps.lifecycle=(...args)=>{lifecycleSignal=args[3].signal;return lifecycle(...args);};
  const operation=runRestoreSmoke(f.token,{fixture:f.input.fixture,recoverySecrets:f.secrets,startupInventorySha256:f.input.startupInventorySha256},f.deps);
  operation.catch(()=>{});t.after(()=>resume.resolve());await entered.promise;
  const material=await browserPolicyMaterial(f.token,f.deps);
  (source==='workflow'?f.workflowController:caller).abort();
  await assert.rejects(operation,{code:'INTERRUPTED'});
  assert.ok(lifecycleSignal instanceof AbortSignal);assert.equal(lifecycleSignal.aborted,true);
  assert.equal(f.delivered(),false);assert.equal(f.context.lease.helper,null);
  await assert.rejects(lstat(material.socketFile),{code:'ENOENT'});resume.resolve();
});
test('T162_E2_abort_after_actual_EOF_and_owned_removal_cannot_mint_private_proof',async t=>{
  const f=await hostFixture(t),lifecycle=f.deps.lifecycle;
  f.deps.lifecycle=async(...args)=>{const value=await lifecycle(...args);f.workflowController.abort();return value;};
  await assert.rejects(runRestoreSmoke(f.token,{fixture:f.input.fixture,recoverySecrets:f.secrets,startupInventorySha256:f.input.startupInventorySha256},f.deps),{code:'INTERRUPTED'});
  assert.equal(f.delivered(),true);assert.equal(f.context.lease.helper,null);
});

for(const signal of [{aborted:false},false,null])test(`T162_E2_lowlevel_rejects_non_AbortSignal_${String(signal)}`,async()=>{
  await assert.rejects(createCredentialChannel({request,credentials,controlledSignal:signal}),{code:'SMOKE_FAILED'});
});
test('T162_E2_private_workflow_signal_cannot_be_JSON_authority',async t=>{
  const f=await hostFixture(t);let reservations=0;
  f.deps.workflow.workflowSignalContext=async()=>({signal:{aborted:false}});
  f.deps.workflow.reserveHelper=async()=>{reservations++;};
  await assert.rejects(runRestoreSmoke(f.token,{fixture:f.input.fixture,recoverySecrets:f.secrets,startupInventorySha256:f.input.startupInventorySha256},f.deps),{code:'SMOKE_FAILED'});
  assert.equal(reservations,0);assert.equal(f.delivered(),false);
});

test('T178_registration_material_cannot_be_minted_from_JSON_or_normal_browser_slot',async t=>{
  const module=await import('./local-restore-smoke.mjs'),f=await hostFixture(t);
  await assert.rejects(module.browserRegistrationMaterial({},f.deps),{code:'SMOKE_FAILED'});
  await assert.rejects(module.browserRegistrationMaterial(f.token,f.deps),{code:'SMOKE_FAILED'});
});

test('T180_closed_byte_parser_never_forwards_unknown_secret_or_incomplete_prefix',async()=>{
  const module=await import('./local-restore-smoke.mjs');assert.equal(typeof module.createSmokeDiagnosticParser,'function');
  const seen=[],parser=module.createSmokeDiagnosticParser(code=>seen.push(code));
  for(const byte of Buffer.from('PP1C_DIAG:J_INPUT\n'))parser.feed(Buffer.from([byte]));
  parser.feed(Buffer.from('PRIVATE-CANARY\nxPP1C_DIAG:J_CHANNEL\nPP1C_DIAG:J_INPUTPRIVATE-CANARY\nPP1C_DIAG:UNKNOWN\nPP1C_DIAG:J_INPUT\nPP1C_DIAG:J_CHANNEL'));
  assert.deepEqual(seen,['J_INPUT']);assert.ok(!JSON.stringify(seen).includes('PRIVATE-CANARY'));
});
test('T180_launcher_reports_only_fixed_stage_when_NSS_error_contains_secret',async()=>{
  const f=launcher(),seen=[];f.deps.diagnostic=code=>seen.push(code);f.deps.command=async()=>{throw Error('PRIVATE-CANARY https://secret.invalid/private');};
  assert.equal(await runBrowserChild(['browser-child'],f.deps),7);assert.deepEqual(seen,['L_ENV','L_NSS_INIT']);
});

test('T180_launcher_discards_raw_runner_output_and_forwards_only_whole_journey_markers',async()=>{
  const f=launcher(),seen=[];f.deps.diagnostic=code=>seen.push(code);
  f.deps.spawn=()=>{const child=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),kill:()=>{}});
    setImmediate(()=>{child.stdout.end('PRIVATE-CANARY\nPP1C_DIAG:J_INPUT\nPP1C_DIAG:L_NSS_INIT\n');child.stderr.end('xPP1C_DIAG:J_CHANNEL\nPP1C_DIAG:J_CONTEXTS\n');child.emit('close',1,null);});return child;};
  assert.equal(await runBrowserChild(['browser-child'],f.deps),7);
  assert.deepEqual(seen,['L_ENV','L_NSS_INIT','L_NSS_TRUST','L_PW_SPAWN','J_INPUT','J_CONTEXTS','L_PW_EXIT']);
});
const setupStages=['J_ENV_CHECK','J_MODULE_IMPORT','J_BINDINGS'];
for(const [index,stage]of setupStages.entries())test(`setup_stage_${stage}_preserves_failed_prefix_without_raw_output`,async()=>{
  const f=launcher(),seen=[],prefix=setupStages.slice(0,index+1);f.deps.diagnostic=code=>seen.push(code);
  f.deps.spawn=()=>{const child=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),kill:()=>{}});
    setImmediate(()=>{
      child.stdout.end('PRIVATE-CANARY\nPP1C_DIAG:UNKNOWN\n');
      for(const code of [...prefix,...prefix])for(const byte of Buffer.from(`PP1C_DIAG:${code}\n`))child.stderr.write(Buffer.from([byte]));
      child.stderr.end(`xPP1C_DIAG:${stage}\nPP1C_DIAG:${stage}PRIVATE-CANARY\nPP1C_DIAG:J_INPUT`);
      child.emit('close',1,null);
    });return child;};
  assert.equal(await runBrowserChild(['browser-child'],f.deps),7);
  assert.deepEqual(seen,['L_ENV','L_NSS_INIT','L_NSS_TRUST','L_PW_SPAWN',...prefix,'L_PW_EXIT']);
  assert.ok(!JSON.stringify(seen).includes('PRIVATE-CANARY'));
});
test('T180_page_error_classification_never_contains_message_url_or_secret',async()=>{
  const module=await import('./local-restore-smoke.mjs');
  for(const code of ['CERT_AUTHORITY_INVALID','NAME_NOT_RESOLVED','CONNECTION_REFUSED','SSL_PROTOCOL_ERROR'])
    assert.equal(module.classifySmokePageError(Error('page.goto: net::ERR_'+code+' at https://PRIVATE-CANARY.invalid')),'J_ERR_'+code);
  assert.equal(module.classifySmokePageError({name:'TimeoutError',message:'PRIVATE-CANARY'}),'J_ERR_TIMEOUT');
  assert.equal(module.classifySmokePageError({name:'TargetClosedError',message:'PRIVATE-CANARY'}),'J_ERR_TARGET_CLOSED');
  assert.equal(module.classifySmokePageError(Error('PRIVATE-CANARY')),null);
});
test('T180_failure_artifact_is_private_constant_only',async t=>{
  const f=await hostFixture(t,'diagnostic');
  await assert.rejects(runRestoreSmoke(f.token,{fixture:f.input.fixture,recoverySecrets:f.secrets,startupInventorySha256:f.input.startupInventorySha256},f.deps),{code:'SMOKE_FAILED'});
  const path=join(f.context.helperRoot,'browser-diagnostic.json'),bytes=await readFile(path),value=JSON.parse(bytes);
  assert.deepEqual(value,{version:1,codes:['L_PW_EXIT','J_CONTEXTS']});assert.equal((await lstat(path)).mode&0o777,0o600);
  assert.ok(!bytes.includes(Buffer.from('PRIVATE-CANARY'))&&!bytes.includes(Buffer.from('SECRET-CANARY')));
});

test('T180_failure_diagnostic_cannot_overwrite_existing_evidence',async t=>{
  const f=await hostFixture(t,'diagnostic-existing');
  await assert.rejects(runRestoreSmoke(f.token,{fixture:f.input.fixture,recoverySecrets:f.secrets,startupInventorySha256:f.input.startupInventorySha256},f.deps),{code:'SMOKE_FAILED'});
  assert.equal(await readFile(join(f.context.helperRoot,'browser-diagnostic.json'),'utf8'),'PRIOR-EVIDENCE');
});
test('T180_parser_deduplicates_to_closed_bounded_enum',async()=>{
  const module=await import('./local-restore-smoke.mjs'),seen=[],parser=module.createSmokeDiagnosticParser(code=>seen.push(code));
  assert.ok(module.smokeDiagnosticCodes.length<=40);
  for(let round=0;round<10;round++)for(const code of module.smokeDiagnosticCodes)parser.feed(Buffer.from(module.smokeDiagnosticMarker(code)));
  assert.deepEqual(seen,module.smokeDiagnosticCodes);
});

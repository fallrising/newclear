import { OpsError, canonicalBytes, parseStrictJson, sha256 } from './recovery-protocol.mjs';
import { createServer } from 'node:net';
import { mkdtemp, chmod, lstat, unlink, rmdir, mkdir, readFile, readdir, open } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
const ensure = value => { if (!value) throw new OpsError('SMOKE_FAILED'); };
const notCancelled=signal=>{if(signal?.aborted)throw new OpsError('INTERRUPTED');};
export function encodeSmokeFrame(value) {
  const bytes = canonicalBytes(value); ensure(bytes.length > 0 && bytes.length <= 16384);
  const prefix = Buffer.alloc(4); prefix.writeUInt32BE(bytes.length);
  return Buffer.concat([prefix, bytes]);
}
export async function createCredentialChannel(options) {
  const controlledSignal=options.controlledSignal;
  ensure(controlledSignal===undefined||controlledSignal instanceof AbortSignal);
  if(controlledSignal?.aborted)throw new OpsError('INTERRUPTED');
  let credentials = options.credentials;
  const verifyPeer = options.verifyPeer, validateObservations = options.validateObservations, validateAssertions = options.validateAssertions;
  const requestTimeout = options.requestTimeout ?? 10000, stageTimeout = options.stageTimeout ?? 600000;
  const request = structuredClone(options.request), sockets = new Set();
  options = null;
  const directory = await mkdtemp('/tmp/cms-pp1c-'), path = join(directory, 'credential.sock');
  await chmod(directory, 0o700); ensure(Buffer.byteLength(path) <= 100);
  let accepted = false, armed = false, responseSent = false, finished = false, failure;
  let timer, resolveDone, rejectDone, record, releaseArm;
  const ready = new Promise(resolve => { releaseArm = resolve; });
  const done = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
  done.catch(() => {});
  const detachSignal=()=>controlledSignal?.removeEventListener('abort',cancel);
  const fail = (code='SMOKE_FAILED') => {
    failure ??= new OpsError(code==='INTERRUPTED'?'INTERRUPTED':'SMOKE_FAILED');
    detachSignal(); credentials = null; clearTimeout(timer); releaseArm();
    for (const socket of sockets) socket.destroy();
    rejectDone(failure);
  };
  const cancel=()=>{fail('INTERRUPTED');server.unref();};
  const active=()=>{if(controlledSignal?.aborted)cancel();if(failure)throw failure;};
  const expire = milliseconds => { clearTimeout(timer); timer = setTimeout(fail, milliseconds); };
  const server = createServer({allowHalfOpen: true}, socket => {
    sockets.add(socket); socket.on('error', fail);
    if (accepted) { fail(); return; }
    accepted = true;
    let buffer = Buffer.alloc(0), stage = 0, processing = false, requested = false;
    const consume = async () => {
      if (processing || failure) return;
      processing = true;
      try {
        while (buffer.length >= 4) {
          const size = buffer.readUInt32BE(0); ensure(size > 0 && size <= 16384);
          if (buffer.length < size + 4) break;
          const raw = Buffer.from(buffer.subarray(4, size + 4)), rest = Buffer.from(buffer.subarray(size + 4));
          buffer.fill(0); buffer = rest;
          let value;
          try { value = parseStrictJson(raw); } finally { raw.fill(0); }
          ensure(stage < 3);
          if (stage === 0) {
            requested = true; ensure(buffer.length === 0); await ready; active(); ensure(armed);
            ensure(canonicalBytes(value).equals(canonicalBytes(request)));
            await current(); active(); await verifyPeer(); active();
            const response = encodeSmokeFrame({...request, ...credentials});
            try {
              await new Promise((resolve, reject) => {
                active();
                socket.write(response,error=>{
                  try{active();if(error)throw error;resolve();}catch(failure){reject(failure);}
                });
              });
              active(); responseSent = true; credentials = null; expire(stageTimeout);
            } finally { response.fill(0); }
          } else {
            ensure(responseSent); await current(); active(); await verifyPeer(); active();
            if (stage === 1) { await validateObservations(value); active(); record = {observations: value}; }
            else { await validateAssertions(value); active(); record.assertions = value; }
          }
          stage++;
        }
      } catch { fail(); }
      finally { processing = false; }
    };
    socket.on('data', chunk => {
      if (failure || finished || requested && !responseSent || buffer.length + chunk.length > 32776) {
        chunk.fill(0); fail(); return;
      }
      const previous = buffer; buffer = Buffer.concat([previous, chunk]); previous.fill(0); chunk.fill(0);
      void consume();
    });
    socket.once('end', async () => {
      // Wait for the final frame's asynchronous peer check, but never invent EOF success.
      while (processing && !failure) await new Promise(resolve => setTimeout(resolve, 1));
      if (failure || stage !== 3 || buffer.length !== 0 || !responseSent) { buffer.fill(0); fail(); return; }
      try {
        await current(); active(); await verifyPeer(); active();
        active(); finished = true; clearTimeout(timer); detachSignal(); socket.end();
        resolveDone(Object.freeze({...record, deliveredOnce: true, eof: true}));
      } catch { fail(); }
    });
    socket.once('close', () => { sockets.delete(socket); buffer.fill(0); if (!finished && !failure) fail(); });
  });
  server.on('error', fail);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(path, resolve); });
  await chmod(path, 0o600);
  const parent = await lstat(directory), endpoint = await lstat(path);
  const current = async () => {
    const [a, b] = await Promise.all([lstat(directory), lstat(path)]);
    ensure(a.isDirectory() && b.isSocket() && a.dev === parent.dev && a.ino === parent.ino
      && b.dev === endpoint.dev && b.ino === endpoint.ino && a.uid === process.getuid() && b.uid === process.getuid()
      && a.gid === process.getgid() && b.gid === process.getgid() && a.nlink >= 1 && b.nlink === 1
      && (a.mode & 0o7777) === 0o700 && (b.mode & 0o7777) === 0o600);
  };
  await current();
  const channel=Object.freeze({path, directory, done, current,
    arm() { active(); ensure(!armed); armed = true; releaseArm(); expire(requestTimeout); },
    abort() { fail(); server.unref(); },
    result() { active(); ensure(finished); return Object.freeze({...record, deliveredOnce: true, eof: true}); },
    async close() {
      detachSignal(); clearTimeout(timer); credentials = null;
      await current();
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => server.close(resolve));
      try { await current(); await unlink(path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const after = await lstat(directory); ensure(after.dev === parent.dev && after.ino === parent.ino);
      await rmdir(directory);
    }});
  controlledSignal?.addEventListener('abort',cancel,{once:true});
  if(controlledSignal?.aborted){cancel();await channel.close();throw failure;}
  return channel;
}

const exact = (value, keys) => ensure(value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(' ') === keys.split(' ').sort().join(' '));
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const runId = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
const utc = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const digest = value => sha256(canonicalBytes(value));
export function validateBrowserInput(input) {
  exact(input, 'version stage operationId sourceRunId targetRunId releaseId rawComparisonSha256 sessionCommitSha256 startupInventorySha256 fixtureSha256 fixture');
  ensure(input.version === 1 && input.stage === 'RESTORE_SMOKE_READY' && uuid(input.operationId)
    && runId(input.sourceRunId) && runId(input.targetRunId) && input.sourceRunId !== input.targetRunId
    && /^sha256:[a-f0-9]{64}$/.test(input.releaseId));
  ensure(['rawComparisonSha256', 'sessionCommitSha256', 'startupInventorySha256', 'fixtureSha256'].every(key => hex(input[key])));
  const f = input.fixture;
  exact(f, 'version sourceRunId adminPrincipalId operatorPrincipalId oldSessionIds publishedEntryId revisionNo refEntryId media expected sessionAbsoluteSeconds sessionMaxSeconds');
  ensure(f.version === 1 && f.sourceRunId === input.sourceRunId && f.revisionNo === 1
    && ['adminPrincipalId', 'operatorPrincipalId', 'publishedEntryId', 'refEntryId'].every(key => uuid(f[key]))
    && f.adminPrincipalId !== f.operatorPrincipalId && f.publishedEntryId !== f.refEntryId);
  exact(f.oldSessionIds, 'admin operator'); ensure(Object.values(f.oldSessionIds).every(uuid) && f.oldSessionIds.admin !== f.oldSessionIds.operator);
  exact(f.media, 'publicImageId publicPdfId draftImageId privateImageId replacedImageId deletedImageId');
  ensure(Object.values(f.media).every(uuid) && new Set(Object.values(f.media)).size === 6);
  exact(f.expected, 'privateEntrySha256 operatorEntrySha256 publicEntrySha256 revisionListSha256 publicOriginalSha256 publicThumbnailSha256 publicWebSha256 publicPdfSha256 draftOriginalSha256 privateOriginalSha256 replacedOriginalSha256');
  ensure(Object.values(f.expected).every(hex) && ['sessionAbsoluteSeconds', 'sessionMaxSeconds'].every(key => /^[1-9][0-9]*$/.test(f[key])));
  ensure(digest(f) === input.fixtureSha256); return input;
}
export function validateSmokeFrames(input, observations, assertions) {
  validateBrowserInput(input);
  exact(observations, 'version operationId targetRunId admin operator');
  exact(assertions, 'version operationId targetRunId fixtureSha256 startedAt finishedAt checks loginCount credentialDeliveries');
  for (const value of [observations, assertions]) ensure(value.version === 1 && value.operationId === input.operationId && value.targetRunId === input.targetRunId);
  ensure(assertions.fixtureSha256 === input.fixtureSha256 && utc(assertions.startedAt) && utc(assertions.finishedAt)
    && assertions.startedAt <= assertions.finishedAt && assertions.loginCount === '2' && assertions.credentialDeliveries === '1');
  exact(assertions.checks, 'oldAdminRejected oldOperatorRejected adminLogin operatorLogin publishedBytes privateIsolation restoredContent originTls');
  ensure(Object.values(assertions.checks).every(value => value === true));
  for (const actor of ['admin', 'operator']) {
    const value = observations[actor]; exact(value, 'principalId sessionTokenSha256 loginStartedAt loginFinishedAt oldRejectedAt');
    ensure(value.principalId === input.fixture[actor + 'PrincipalId'] && hex(value.sessionTokenSha256)
      && ['loginStartedAt', 'loginFinishedAt', 'oldRejectedAt'].every(key => utc(value[key]))
      && assertions.startedAt <= value.oldRejectedAt && value.oldRejectedAt < value.loginStartedAt
      && value.loginStartedAt <= value.loginFinishedAt && value.loginFinishedAt <= assertions.finishedAt);
  }
  return true;
}

export const smokeDiagnosticCodes=Object.freeze([
  'L_ENV','L_NSS_INIT','L_NSS_TRUST','L_PW_SPAWN','L_PW_EXIT','L_PW_OUTPUT_LIMIT','L_PW_TIMEOUT',
  ...'BEFORE_BROWSER ENV_CHECK MODULE_IMPORT BINDINGS INPUT CHANNEL CONTEXTS OLD_ADMIN OLD_OPERATOR ADMIN_LOGIN OPERATOR_LOGIN CONTENT PUBLIC_BYTES PRIVATE_ISOLATION FRAMES CLOSE'.split(' ').map(code=>'J_'+code),
  ...'CERT_AUTHORITY_INVALID NAME_NOT_RESOLVED CONNECTION_REFUSED SSL_PROTOCOL_ERROR TIMEOUT TARGET_CLOSED'.split(' ').map(code=>'J_ERR_'+code)
]);
export function smokeDiagnosticMarker(code){ensure(smokeDiagnosticCodes.includes(code));return `PP1C_DIAG:${code}\n`;}
export function createSmokeDiagnosticParser(accept) {
  const root={next:new Map()},seen=new Set();
  for(const code of smokeDiagnosticCodes){let node=root;for(const byte of Buffer.from(smokeDiagnosticMarker(code).slice(0,-1))){
    if(!node.next.has(byte))node.next.set(byte,{next:new Map()});node=node.next.get(byte);
  }node.code=code;}
  let node=root;
  return Object.freeze({feed(bytes){for(const byte of bytes){
    if(byte===10){if(node?.code&&!seen.has(node.code)){seen.add(node.code);accept(node.code);}node=root;}
    else node=node?.next.get(byte);
  }}});
}
export function classifySmokePageError(error) {
  const message=typeof error?.message==='string'?error.message:'';
  for(const code of ['CERT_AUTHORITY_INVALID','NAME_NOT_RESOLVED','CONNECTION_REFUSED','SSL_PROTOCOL_ERROR'])
    if(message.includes('net::ERR_'+code))return 'J_ERR_'+code;
  if(error?.name==='TimeoutError')return 'J_ERR_TIMEOUT';
  if(error?.name==='TargetClosedError'||message.includes('Target page, context or browser has been closed'))return 'J_ERR_TARGET_CLOSED';
  return null;
}

const fixedChildEnvironment = {
  CMS_PP1_SUITE: 'recovery', CMS_PP1_TLS_MODE: 'trusted', CMS_PP1_RECOVERY_INPUT: '/fixture/browser.json',
  CMS_PP1_CREDENTIAL_SOCKET: '/run/pp1/credential.sock', CMS_PP1_CHROMIUM: '/chromium/chrome',
  CMS_PP1_RUN_ROOT: '/fixture', HOME: '/tmp/browser-home', XDG_CACHE_HOME: '/tmp/browser-cache'
};
const execute = promisify(execFile);
export async function runBrowserChild(argv, deps = {}) {
  const emit=code=>{ensure(smokeDiagnosticCodes.includes(code));if(deps.diagnostic)deps.diagnostic(code);else process.stderr.write(smokeDiagnosticMarker(code));};
  try {
    emit('L_ENV');
    ensure(Array.isArray(argv) && argv.length === 1 && argv[0] === 'browser-child');
    const env = {...(deps.environment ?? process.env)};
    ensure(Object.entries(fixedChildEnvironment).every(([key, value]) => env[key] === value));
    ensure(Object.keys(env).filter(key => key.startsWith('CMS_PP1_')).every(key => Object.hasOwn(fixedChildEnvironment, key))
      && !['NODE_OPTIONS', 'JAVA_TOOL_OPTIONS', 'JDK_JAVA_OPTIONS', '_JAVA_OPTIONS'].some(key => Object.hasOwn(env, key)));
    const make = deps.mkdir ?? mkdir;
    for (const path of ['/tmp/browser-home', '/tmp/browser-home/.pki', '/tmp/browser-home/.pki/nssdb', '/tmp/browser-cache']) {
      await make(path, {recursive: true, mode: 0o700});
    }
    const command = deps.command ?? execute, options = {env, cwd: '/work', shell: false, timeout: 10000, maxBuffer: 65536};
    for (const args of [['-N', '--empty-password', '-d', 'sql:/tmp/browser-home/.pki/nssdb'],
      ['-A', '-d', 'sql:/tmp/browser-home/.pki/nssdb', '-n', 'pp1c-child', '-t', 'C,,', '-i', '/fixture/ca.crt']]) {
      emit(args[0]==='-N'?'L_NSS_INIT':'L_NSS_TRUST');
      const result = await command('/nss-tools/certutil', args, options); ensure(result.code === undefined || result.code === 0);
    }
    emit('L_PW_SPAWN');
    const child = (deps.spawn ?? spawn)('/opt/pp1-node', ['/work/node_modules/@playwright/test/cli.js', 'test', '--config',
      '/work/playwright.pp1-local.config.ts', '--workers=1', '--retries=0', '--timeout=120000', '--reporter=list'],
    {env, cwd: '/work', shell: false, stdio: ['ignore', 'pipe', 'pipe']});
    let size = 0, overflow = false;
    const timer = setTimeout(() => { overflow = true; emit('L_PW_TIMEOUT');child.kill('SIGTERM'); }, 600000);
    try {
      for (const stream of [child.stdout, child.stderr]) {
        const parser=createSmokeDiagnosticParser(code=>{if(code.startsWith('J_'))emit(code);});
        stream.on('data', chunk => {
          size += chunk.length;parser.feed(chunk);chunk.fill(0);if(size>1048576){if(!overflow)emit('L_PW_OUTPUT_LIMIT');overflow=true;child.kill('SIGTERM');}
        });
      }
      const exit = await new Promise((accept, reject) => { child.once('error', reject); child.once('close', (code, signal) => accept({code, signal})); });
      if(exit.code!==0||exit.signal!==null)emit('L_PW_EXIT');
      ensure(!overflow && exit.code === 0 && exit.signal === null); return 0;
    } finally { clearTimeout(timer); }
  } catch { return 7; }
}

async function fileStamp(path, privateFile = false) {
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await fd.stat({bigint: true});
    ensure(before.isFile() && before.nlink === 1n);
    if (privateFile) ensure(before.uid === BigInt(process.getuid()) && before.gid === BigInt(process.getgid()) && (before.mode & 0o7777n) === 0o600n);
    const hash = createHash('sha256');
    for await (const chunk of fd.createReadStream({autoClose: false})) hash.update(chunk);
    const stamp = value => Object.fromEntries(['dev', 'ino', 'size', 'mode', 'uid', 'gid', 'nlink', 'mtimeNs', 'ctimeNs'].map(key => [key, String(value[key])]));
    const metadata = stamp(before);
    ensure(digest(metadata) === digest(stamp(await fd.stat({bigint: true}))) && digest(metadata) === digest(stamp(await lstat(path, {bigint: true}))));
    return {...metadata, sha256: hash.digest('hex')};
  } finally { await fd.close(); }
}
async function treeStamp(root) {
  const rows = [];
  async function walk(path, relative) {
    const info = await lstat(path); ensure(info.isDirectory() || info.isFile());
    if (info.isDirectory()) {
      rows.push({path: relative, directory: true, dev: String(info.dev), ino: String(info.ino), mode: info.mode});
      for (const name of (await readdir(path)).sort()) await walk(join(path, name), relative ? `${relative}/${name}` : name);
    } else rows.push({path: relative, ...(await fileStamp(path))});
  }
  await walk(root, ''); return digest(rows);
}
async function writePrivateNew(path, bytes) {
  const fd = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await fd.writeFile(bytes); await fd.sync(); } finally { await fd.close(); }
  const directory = await open(dirname(path), constants.O_RDONLY); try { await directory.sync(); } finally { await directory.close(); }
}
async function prepareBrowserMaterial(context, input, channel) {
  const worktreeRoot = join(context.helperRoot, 'browser-worktree'); await mkdir(worktreeRoot, {mode: 0o700});
  const lock = JSON.parse(await readFile(join(context.cwd, 'package-lock.json')));
  async function copy(source, target) {
    const info = await lstat(source);
    if (info.isDirectory()) {
      await mkdir(target, {recursive: true, mode: 0o700});
      for (const name of (await readdir(source)).sort()) await copy(join(source, name), join(target, name));
    } else {
      const before = await fileStamp(source), bytes = await readFile(source); ensure(sha256(bytes) === before.sha256);
      await mkdir(dirname(target), {recursive: true, mode: 0o700}); await writePrivateNew(target, bytes);
      ensure(digest(before) === digest(await fileStamp(source)));
    }
  }
  for (const path of ['package.json', 'package-lock.json', 'playwright.pp1-local.config.ts', 'e2e-pp1-local/recovery.spec.ts',
    'scripts/ops/local-restore-smoke.mjs', 'scripts/ops/recovery-protocol.mjs']) await copy(join(context.cwd, path), join(worktreeRoot, path));
  for (const name of ['@playwright/test', 'playwright', 'playwright-core']) {
    const path = `node_modules/${name}`, actual = JSON.parse(await readFile(join(context.cwd, path, 'package.json')));
    ensure(lock.packages[path]?.version === actual.version); await copy(join(context.cwd, path), join(worktreeRoot, path));
  }
  const material = Object.freeze({worktreeRoot, chromiumRoot: join(homedir(), '.cache/ms-playwright/chromium-1243/chrome-linux64'),
    nssToolsRoot: join(homedir(), '.cache/devbox/cms-pp1-tooling-20261101/nss/usr/bin'), caFile: join(context.root, 'tls/ca.crt'),
    inputFile: join(context.helperRoot, 'browser.json'), socketFile: channel.path});
  await writePrivateNew(material.inputFile, canonicalBytes(input));
  ensure((await fileStamp(context.nodeBinary)).sha256 === context.target.nodeBinarySha256
    && (await fileStamp(join(material.chromiumRoot, 'chrome'))).sha256 === '8c599d43aec53f2460a31ae2f4af6bd863f8258b34ff519564bc5d4726bfaa1e'
    && (await fileStamp(join(material.nssToolsRoot, 'certutil'))).sha256 === '2bd9deab438d1a76b0406a648c762dfe3255c0423b7ed8eac6de95df1efb4faf');
  const stamps = {worktree: await treeStamp(worktreeRoot), chromium: await treeStamp(material.chromiumRoot), nss: await treeStamp(material.nssToolsRoot),
    ca: await fileStamp(material.caFile), input: await fileStamp(material.inputFile, true), node: await fileStamp(context.nodeBinary)};
  return {material, stamps};
}

const browserRuns = new WeakMap(), smokeResults = new WeakMap();
const deepFreeze = value => { if (value && typeof value === 'object') { for (const item of Object.values(value)) deepFreeze(item); Object.freeze(value); } return value; };
async function modules(deps) {
  return {wf: deps.workflow ?? await import('../local/maintenance-workflow.mjs'),
    verifier: deps.verifier ?? await import('./local-recovery-verify.mjs'), helper: await import('../local/maintenance-helper.mjs')};
}
async function immutableMaterial(record, socket = true) {
  const {material: m, stamps: s, context: c} = record;
  ensure(await treeStamp(m.worktreeRoot) === s.worktree && await treeStamp(m.chromiumRoot) === s.chromium
    && await treeStamp(m.nssToolsRoot) === s.nss && digest(await fileStamp(m.caFile)) === digest(s.ca)
    && digest(await fileStamp(m.inputFile, true)) === digest(s.input) && digest(await fileStamp(c.nodeBinary)) === digest(s.node));
  if (socket) await record.channel.current();
}
export async function browserPolicyMaterial(token, deps = {}) {
  const record = browserRuns.get(token); ensure(record?.status === 'active');
  const {wf} = await modules(deps), current = await wf.browserHelperContext(token, deps);
  ensure(current.operationId === record.context.operationId && current.seq === record.context.seq
    && current.helperRoot === record.context.helperRoot && digest(current.target) === record.targetSha256);
  await immutableMaterial(record); return record.material;
}
// The registrar alone opens this interval; ordinary material reads stay fully inspected.
export async function browserRegistrationMaterial(token,deps={}) {
  const record=browserRuns.get(token);ensure(record?.status==='active'&&record.id&&record.policy);notCancelled(record.signal);
  const {wf}=await modules(deps);
  const match=current=>ensure(current.operationId===record.context.operationId&&current.seq===record.context.seq
    &&current.helperRoot===record.context.helperRoot&&current.root===record.context.root
    &&digest(current.target)===record.targetSha256&&current.fullContainerId===record.id
    &&current.policySha256===digest(record.policy));
  match(await wf.browserRegistrationContext(token,deps));await immutableMaterial(record);notCancelled(record.signal);
  match(await wf.browserRegistrationContext(token,deps));notCancelled(record.signal);return record.material;
}
function validateSecrets(input, bindings, secrets) {
  exact(bindings, 'admin operator'); exact(secrets, 'admin operator');
  for (const actor of ['admin', 'operator']) {
    const b = bindings[actor], s = secrets[actor]; exact(s, 'principalId username password oldSessionToken');
    exact(b, 'principalId username oldSessionId oldSessionTokenSha256 oldSessionExpiresAt');
    ensure(b.principalId === input.fixture[actor + 'PrincipalId'] && s.principalId === b.principalId && s.username === b.username
      && b.oldSessionId === input.fixture.oldSessionIds[actor] && typeof s.password === 'string' && s.password.length >= 12
      && typeof s.oldSessionToken === 'string' && s.oldSessionToken.length > 0
      && typeof s.username === 'string' && s.username.length > 0 && s.password.toLowerCase() !== s.username.toLowerCase()
      && !/[\u0000-\u001f\u007f]/u.test(s.password + s.username + s.oldSessionToken)
      && sha256(Buffer.from(s.oldSessionToken)) === b.oldSessionTokenSha256 && Number.isFinite(Date.parse(b.oldSessionExpiresAt)));
  }
}
export async function runRestoreSmoke(token, options, deps = {}) {
  let channel, record, signal;
  try {
    ensure(token && typeof token === 'object' && !browserRuns.has(token)); exact(options, 'fixture recoverySecrets startupInventorySha256');
    ensure(deps.signal===undefined||deps.signal instanceof AbortSignal);notCancelled(deps.signal);
    const {wf, verifier, helper} = await modules(deps),signalContext=await wf.workflowSignalContext(token,deps);
    exact(signalContext,'signal');ensure(signalContext.signal instanceof AbortSignal);
    const ownedSignal=signalContext.signal;signal=deps.signal?AbortSignal.any([ownedSignal,deps.signal]):ownedSignal;
    deps={...deps,signal};notCancelled(signal);
    const currentExecution=async()=>{const current=await wf.workflowSignalContext(token,deps);ensure(current.signal===ownedSignal);notCancelled(signal);};
    const proofContext=await verifier.restoreSmokeContext(token,deps);notCancelled(signal);
    exact(proofContext, 'input credentialBindings'); const input = deepFreeze(structuredClone(validateBrowserInput(proofContext.input)));
    ensure(digest(options.fixture) === input.fixtureSha256 && options.startupInventorySha256 === input.startupInventorySha256);
    validateSecrets(input, proofContext.credentialBindings, options.recoverySecrets);
    await wf.reserveHelper(token, {side: 'target', kind: 'BROWSER'}, deps);notCancelled(signal);
    const c = await wf.browserHelperContext(token, deps);notCancelled(signal);
    ensure(c.operationId === input.operationId && c.target.runId === input.targetRunId && c.lease.source.runId === input.sourceRunId
      && `sha256:${c.target.apiBuild.jarSha256}` === input.releaseId && ['INGRESS_STARTED', 'BROWSER_VERIFIED'].includes(c.lease.phase));
    const env = {...(deps.environment ?? process.env)};
    ensure((!env.DOCKER_HOST || env.DOCKER_HOST === 'unix:///var/run/docker.sock') && (!env.DOCKER_CONTEXT || env.DOCKER_CONTEXT === 'default') && !env.DOCKER_TLS_VERIFY);
    for (const key of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']) delete env[key];
    const docker = async args => {
      notCancelled(signal);const value = await (deps.command ?? execute)('docker', ['--host', 'unix:///var/run/docker.sock', ...args], {env, shell: false, timeout: 30000, maxBuffer: 16777216});
      notCancelled(signal);ensure(value.code === undefined || value.code === 0); return JSON.parse(value.stdout);
    };
    const request = {version: 1, operationId: input.operationId, targetRunId: input.targetRunId, fixtureSha256: input.fixtureSha256};
    const peer = async () => {
      ensure(record?.running && record.status === 'active');
      const current = await wf.browserHelperContext(token, deps);
      ensure(current.seq === c.seq && current.operationId === c.operationId && digest(current.target) === record.targetSha256);
      await wf.assertWorkflow(token, {side: 'target', stage: c.lease.phase}, deps);
      const values = await docker(['inspect', record.id]); ensure(values.length === 1);
      helper.assertHelperPolicy(values[0], record.policy, {...record.expected, fullContainerId: record.id, state: 'running'});
      await immutableMaterial(record);await currentExecution();
    };
    channel = await createCredentialChannel({controlledSignal:signal,request, credentials: structuredClone(options.recoverySecrets), verifyPeer: peer,
      validateObservations: value => { record.observations = value; },
      validateAssertions: value => {
        validateSmokeFrames(input, record.observations, value);
        for (const actor of ['admin', 'operator']) ensure(Date.parse(record.observations[actor].oldRejectedAt) < Date.parse(proofContext.credentialBindings[actor].oldSessionExpiresAt));
      }});
    notCancelled(signal);const prepared = await prepareBrowserMaterial(c, input, channel);notCancelled(signal);
    record = {...prepared, channel, signal, workflowSignal:ownedSignal, context: c, input, proofContextSha256: digest(proofContext), inputSha256: digest(input),
      diagnosticCodes:[],targetSha256: digest(c.target), status: 'active', running: false, stopped: false, removed: false};
    browserRuns.set(token, record);
    const images = await docker(['image', 'inspect', c.target.images.node]); ensure(images.length === 1);
    const policy = helper.buildHelperPolicy({...c, kind: 'BROWSER', side: 'target', image: images[0], browser: prepared.material});
    const expected = {name: `cms-pp1c-${c.operationId}-${c.seq}`, webNetworkName: c.webNetworkName, volumeMountpoints: {},
      labels: {...(images[0].Config.Labels ?? {}), 'org.cms.pp1c.operation': c.operationId, 'org.cms.pp1c.seq': c.seq,
        'org.cms.pp1c.kind': 'BROWSER', 'org.cms.pp1c.policy': digest(policy)}};
    Object.assign(record, {policy, expected}); let registered;
    const result = await (deps.lifecycle ?? helper.executeHelperLifecycle)(policy, expected, async child => {
      child.stdin.end();
      const drain = stream => new Promise((accept, reject) => {
        const parser=createSmokeDiagnosticParser(code=>{if(!record.diagnosticCodes.includes(code))record.diagnosticCodes.push(code);});
        let size = 0; stream.on('data', chunk => { size += chunk.length;parser.feed(chunk);chunk.fill(0); if (size > 1048576) reject(new OpsError('SMOKE_FAILED')); });
        stream.once('end', accept); stream.once('error', reject);
      });
      const values = await Promise.all([channel.done, drain(child.stdout), drain(child.stderr)]); return values[0];
    }, {...deps,
      onCreated: async (id, _snapshot, fullExpected) => {
        record.id = id; registered = {kind: 'BROWSER', side: 'target', fullContainerId: id, policySha256: digest(policy), state: 'CREATED', endpoint: null, backend: null, startedAt: new Date().toISOString()};
        await wf.registerOwnedHelper(token, registered, policy, fullExpected, deps);
      },
      onRunning: async (_id, snapshot) => {
        const endpoint = snapshot.NetworkSettings.Networks[c.webNetworkName]; ensure(endpoint?.NetworkID === policy.networkId && endpoint.IPAddress);
        registered = {...registered, state: 'RUNNING', endpoint: {networkId: endpoint.NetworkID, address: endpoint.IPAddress}};
        await wf.updateOwnedHelper(token, registered, deps); record.running = true; channel.arm();
      },
      onExited: async (id, snapshot) => {
        helper.assertHelperPolicy(snapshot, policy, {...expected, fullContainerId: id, state: 'exited'});
        record.stopped = true; record.running = false; record.exitCode = snapshot.State.ExitCode;
        registered = {...registered, state: 'EXITED'}; await wf.updateOwnedHelper(token, registered, deps);
      },
      onRemoved: async () => { record.removed = true; await wf.clearOwnedHelper(token, deps); }
    });
    await currentExecution();ensure(record.stopped && record.removed && record.exitCode === 0 && channel.result().deliveredOnce && result.eof);
    await immutableMaterial(record);await currentExecution(); record.status = 'complete'; record.data = deepFreeze(structuredClone(result));
    await channel.close(); channel = null;await currentExecution();
    const value = deepFreeze({version: 1, operationId: input.operationId, targetRunId: input.targetRunId, fixtureSha256: input.fixtureSha256});
    smokeResults.set(value, {token, record}); return value;
  } catch(error) {
    if (record) {
      record.status = 'failed';
      if(record.diagnosticCodes?.length)try{await writePrivateNew(join(record.context.helperRoot,'browser-diagnostic.json'),canonicalBytes({version:1,codes:record.diagnosticCodes}));}catch{/* Diagnostic metadata never overrides the primary failure. */}
    }
    if (channel) { channel.abort(); if (!record?.id || record.stopped) try { await channel.close(); } catch { /* Unknown socket identity is retained. */ } }
    throw new OpsError(signal?.aborted||error?.code==='INTERRUPTED'?'INTERRUPTED':'SMOKE_FAILED');
  } finally { options = null; }
}
export async function verifiedRestoreSmoke(token, result, deps = {}) {
  const owned = smokeResults.get(result); ensure(owned?.token === token && owned.record.status === 'complete');
  notCancelled(owned.record.signal);
  const record = owned.record, {wf, verifier} = await modules(deps), current = await wf.assertWorkflow(token, {side: 'target'}, deps);
  ensure(current.operationId === record.context.operationId && digest(current.target) === record.targetSha256 && current.lease.helper === null);
  const sequence = Number(record.context.seq), phase = current.lease.phase;
  ensure(phase === 'BROWSER_VERIFIED' && current.helperSequence === sequence
    || phase === 'TARGET_STOPPED' && [sequence, sequence + 1].includes(current.helperSequence));
  ensure(digest(await verifier.restoreSmokeContext(token, deps)) === record.proofContextSha256);
  await immutableMaterial(record, false);
  const signalContext=await wf.workflowSignalContext(token,deps);ensure(signalContext.signal===record.workflowSignal);notCancelled(record.signal);
  return deepFreeze({operationId: result.operationId, targetRunId: result.targetRunId, fixtureSha256: result.fixtureSha256,
    helperId: record.id, helperSequence: record.context.seq, inputSha256: record.inputSha256,
    deliveredOnce: true, eof: true, exitCode: 0, observations: record.data.observations, assertions: record.data.assertions});
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await runBrowserChild(process.argv.slice(2));
  if (process.exitCode !== 0) process.stderr.write('SMOKE_FAILED\n');
}

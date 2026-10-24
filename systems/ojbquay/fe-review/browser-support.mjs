import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, existsSync, lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resumePlan, completedPlan, acceptedDelay} from './resume-plan.mjs';

export const origin = 'http://127.0.0.1:5173';
export const state = '/state';
export const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
export function privateJSON(name) {
  assert(/^[a-z-]+\.json$/.test(name), 'REVIEW_PRIVATE_NAME');
  const path = state + '/' + name;
  const st = lstatSync(path);
  assert(st.isFile() && !st.isSymbolicLink() && st.uid === process.getuid() && (st.mode & 0o077) === 0, 'REVIEW_PRIVATE_FILE');
  return JSON.parse(readFileSync(path, 'utf8'));
}
export function writePrivate(name, value) {
  assert(/^[a-z-]+\.json$/.test(name), 'REVIEW_PRIVATE_NAME');
  writeFileSync(state + '/' + name, JSON.stringify(value), {flag: 'wx', mode: 0o600});
}
export async function login(page, credentials) {
  const response = await page.goto(origin + '/login');
  assert.equal(response.status(), 200);
  await page.getByRole('heading', {name: 'Welcome back', exact: true}).waitFor();
  await page.getByLabel('Username', {exact: true}).fill(credentials.user);
  await page.getByLabel('Password', {exact: true}).fill(credentials.password);
  await page.getByRole('button', {name: 'Sign in', exact: true}).click();
  await page.getByRole('heading', {name: 'System overview', exact: true}).waitFor();
  assert.equal(page.url(), origin + '/dashboard', 'REVIEW_LOGIN_URL');
  const responseMe = await page.request.get(origin + '/api/v1/auth/me', {maxRedirects: 0});
  const envelope = await responseMe.json();
  assert(responseMe.status() === 200 && envelope.code === 'OK' && envelope.data.username === credentials.user && envelope.data.roles.includes('ADMIN'), 'REVIEW_TRUE_ADMIN');
}
export async function apiClient(page) {
  const response = await page.request.get(origin + '/api/v1/auth/csrf', {maxRedirects: 0});
  const envelope = await response.json();
  assert(response.status() === 200 && envelope.code === 'OK', 'REVIEW_CSRF');
  const csrf = envelope.data;
  return async (method, path, data) => {
    assert(/^\/api\/v1\//.test(path), 'REVIEW_API_PATH');
    if(process.env.FE_REVIEW_RESUME_READONLY==='1')assert.equal(method,'GET','REVIEW_READONLY_SEED_METHOD');
    const res = await page.request.fetch(origin + path, {method, data, maxRedirects: 0, headers: {[csrf.headerName]: csrf.token}, timeout: 10000});
    const body = await res.json();
    if (!(res.ok() && body.code === 'OK')) writeFileSync(state+'/api-errors.jsonl', JSON.stringify({method,path,status:res.status(),body})+'\n', {flag:'a',mode:0o600});
    assert(res.ok() && body.code === 'OK', 'REVIEW_API_' + res.status());
    return body.data;
  };
}
export async function waitRead(read, predicate, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  do {
    const result = await read();
    if (predicate(result)) return result;
    await pause(500);
  } while (Date.now() < deadline);
  throw new Error('REVIEW_READBACK_TIMEOUT');
}
export async function seed(page, credentials, receipt) {
  const api = await apiClient(page);
  receipt.seedProgress = ['clusters'];
  const clusters = await api('GET', '/api/v1/clusters');
  assert(clusters.length === 1, 'REVIEW_FRESH_CLUSTER');
  const suffix = credentials.run.slice(-8);
  let topic, groups=[], subscriptions=[];
  if(process.env.FE_REVIEW_RESUME_READONLY==='1') {
    const full=completedPlan({run:credentials.run,user:credentials.user,clusters,topics:await api('GET','/api/v1/topics'),groups:await api('GET','/api/v1/groups'),subscriptions:await api('GET','/api/v1/subscriptions')});
    ({topic,groups,subscriptions}=full);
    const priorResult=privateJSON('prior-result.json');
    assert(priorResult.run===credentials.run&&priorResult.source===credentials.source&&priorResult.failure?.category==='REVIEW_GRPC_RESULT','REVIEW_PRIOR_ATTEMPT');
    assert.deepEqual({topic:full.ids.topic,groups:full.ids.groups,subscriptions:full.ids.subscriptions.slice(0,2)},priorResult.resume.partialIds,'REVIEW_PRIOR_PARTIAL_IDS');
    const prior=privateJSON('grpc-response.json');
    const actualHash=createHash('sha256').update(readFileSync(state+'/grpc-response.json')).digest('hex');
    assert(/^[0-9a-f]{64}$/.test(process.env.FE_REVIEW_GRPC_RESPONSE_SHA256??'')&&actualHash===process.env.FE_REVIEW_GRPC_RESPONSE_SHA256,'REVIEW_PRIOR_GRPC_HASH');
    const delayId='review-delay-'+suffix;
    const accepted=acceptedDelay(prior,delayId);
    const delay=await api('GET','/api/v1/delay/'+delayId);
    assert(delay.delayId===delayId&&delay.targetTopic===topic.name&&['PENDING','DONE'].includes(delay.status),'REVIEW_EXISTING_DELAY');
    const dead=await api('GET',`/api/v1/subscriptions/${subscriptions[1].id}/dlq?n=50`);
    assert(dead.length>0,'REVIEW_EXISTING_DLQ');
    receipt.resume={sameOwnedStack:true,readOnlySeed:true,priorGrpcSha256:actualHash,ids:full.ids,accepted};
    receipt.seed={topicCount:1,groupCount:3,subscriptionCount:3,modes:['PUSH','PULL'],dlqCount:dead.length,delayReadback:true,delayStatus:delay.status,delayDueAt:delay.dueAt,noSeedMutation:true};
    writePrivate('fixture.json',{cluster:clusters[0],topic,groups,subscriptions,delayId,delay,secrets:[topic.token,...groups.map(g=>g.token)]});
    await page.context().storageState({path:state+'/auth.storage.json'});
    return;
  }
  if(process.env.FE_REVIEW_RESUME==='1') {
    const partial=resumePlan({run:credentials.run,user:credentials.user,clusters,topics:await api('GET','/api/v1/topics'),groups:await api('GET','/api/v1/groups'),subscriptions:await api('GET','/api/v1/subscriptions')});
    ({topic,groups,subscriptions}=partial);receipt.resume={sameOwnedStack:true,partialIds:partial.ids,onlyMissingPullCreated:true};
  } else {
    for (const endpoint of ['topics', 'groups', 'subscriptions']) assert.equal((await api('GET', '/api/v1/' + endpoint)).length, 0, 'REVIEW_FRESH_RESOURCES');
    receipt.seedProgress.push('create-topic');
    topic = await api('POST', '/api/v1/topics', {name: 'review.orders.' + suffix, clusterId: clusters[0].id, partitions: 1, replication: 1, delayTopic: true, maxMessageBytes: 1048576, retentionMs: 86400000, produceQuotaTps: 1000, compression: 'zstd', remark: 'Synthetic review only'});
    for (const role of ['delivered', 'dead', 'pull']) {receipt.seedProgress.push('create-group-' + role);groups.push(await api('POST', '/api/v1/groups', {name: 'review-' + role + '-' + suffix, remark: 'Synthetic review only'}));}
  }
  for (let index = subscriptions.length; index < groups.length; index++) {
    const common = {mode: index === 2 ? 'PULL' : 'PUSH', concurrency: 1, maxTps: 1000, filterCel: '', tags: [], transit: {}, ordered: false, dlqEnabled: true, shadowTraffic: false};
    const spec = index === 2 ? {...common, pull: {maxBatch: 1, ackTimeoutMs: 30000, maxRetry: 3}} : {...common, push: {urls: [index === 0 ? 'http://push-sink:8080/events' : 'http://push-sink:9/unreachable'], method: 'POST', timeoutMs: 2000, retryIntervalsMs: [150, 300], headers: {}}};
    receipt.seedProgress.push('create-subscription-' + index);
    subscriptions.push(await api('POST', '/api/v1/subscriptions', {groupId: groups[index].id, topicId: topic.id, spec}));
  }
  assert((await api('GET', '/api/v1/topics')).some(t => t.id === topic.id), 'REVIEW_TOPIC_READBACK');
  assert.equal((await api('GET', '/api/v1/subscriptions')).length, 3);
  // Existing runtime contract adopts published config within five seconds.
  await pause(5500);
  const body = Buffer.from(JSON.stringify({event: 'review', run: credentials.run})).toString('base64');
  receipt.seedProgress.push('test-message');
  await api('POST', `/api/v1/topics/${topic.id}/test-message`, {key: 'review-key', valueBase64: body, tags: [], headers: {}});
  receipt.seedProgress.push('dlq-readback');
  const dead = await waitRead(() => api('GET', `/api/v1/subscriptions/${subscriptions[1].id}/dlq?n=50`), entries => entries.length > 0);
  const delayId = 'review-delay-' + suffix;
  const dueAtMs = Date.now() + 30 * 60 * 1000;
  receipt.seedProgress.push('grpc-delay');
  writePrivate('grpc-request.json', {method: 'ProduceDelay', body: {msg: {topic: topic.name, key: 'review-delay', value: body}, token: topic.token, delay_id: delayId, due_at_ms: dueAtMs}});
  const deadline = Date.now() + 90000;
  while (!existsSync(state + '/grpc-response.json') && Date.now() < deadline) await pause(250);
  assert(existsSync(state + '/grpc-response.json'), 'REVIEW_GRPC_BRIDGE_TIMEOUT');
  const grpc = privateJSON('grpc-response.json');
  receipt.grpc=acceptedDelay(grpc,delayId);
  let notReady404s = 0;
  const delay = await waitRead(async () => {
    try {return await api('GET', '/api/v1/delay/' + delayId);}
    catch (error) {if (error.message === 'REVIEW_API_404') {notReady404s++;return null;}throw error;}
  }, data => data?.delayId === delayId);
  receipt.delayReadbackPending404s = notReady404s;
  receipt.seed = {topicCount: 1, groupCount: 3, subscriptionCount: 3, modes: ['PUSH', 'PULL'], dlqCount: dead.length, delayReadback: true, delayDueAtMs: dueAtMs, payloadSha256: createHash('sha256').update(Buffer.from(body, 'base64')).digest('hex')};
  writePrivate('fixture.json', {cluster: clusters[0], topic, groups, subscriptions, delayId, delay, secrets: [topic.token, ...groups.map(g => g.token)]});
  await page.context().storageState({path: state + '/auth.storage.json'});
}

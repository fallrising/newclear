/** Public metadata only. No prompt, transcript, raw summary or command is accepted. */
export const STATES = Object.freeze(['coding', 'terminal', 'browsing', 'thinking', 'needs-you', 'error', 'idle', 'done']);
export const TASKS = Object.freeze(['general', 'code', 'research', 'content', 'visual', 'review', 'ops']);
export const LABELS = Object.freeze({coding: '撰寫程式', terminal: '執行工具', browsing: '查閱資料', thinking: '規劃工作', 'needs-you': '等待人工確認', error: '工作需要排查', idle: '目前沒有新回報', done: '本次工作已結束'});
const TASK_LABELS = {general: '一般任務', code: '程式開發', research: '資料研究', content: '內容整理', visual: '視覺製作', review: '品質檢查', ops: '維運作業'};
const ID = /^[a-z][a-z0-9-]{0,23}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export class Problem extends Error {
  constructor(status, code, retryAfter = 0) { super(code); this.status = status; this.retryAfter = retryAfter; }
}
const reject = (status, code, wait = 0) => { throw new Problem(status, code, wait); };
export function validateRoster(roster) {
  if (!roster || !Array.isArray(roster.bots) || !roster.bots.length || roster.bots.length > 16) reject(503, 'invalid_roster');
  const ids = new Set(), seats = new Set();
  for (const bot of roster.bots) {
    if (!bot || typeof bot !== 'object' || typeof bot.id !== 'string' || typeof bot.seat !== 'string' || !ID.test(bot.id) || ids.has(bot.id) || !ID.test(bot.seat) || seats.has(bot.seat) || !/^#[0-9A-Fa-f]{6}$/.test(bot.color)) reject(503, 'invalid_roster');
    for (const key of ['name', 'role']) if (typeof bot[key] !== 'string' || !bot[key].length || [...bot[key]].length > 24 || /[<>\p{Cc}\p{Cf}]/u.test(bot[key])) reject(503, 'invalid_roster');
    ids.add(bot.id); seats.add(bot.seat);
  }
  return roster;
}
export function validateReport(input, roster) {
  const keys = ['agentId', 'status', 'taskType', 'collaborators', 'eventId', 'expectedRevision'];
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== keys.length || keys.some(k => !Object.hasOwn(input, k))) reject(422, 'invalid_report');
  const ids = new Set(roster.bots.map(b => b.id));
  if (typeof input.agentId !== 'string' || !ID.test(input.agentId) || !ids.has(input.agentId) || !STATES.includes(input.status) || !TASKS.includes(input.taskType) || typeof input.eventId !== 'string' || !UUID.test(input.eventId) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) reject(422, 'invalid_report');
  const peers = input.collaborators;
  if (!Array.isArray(peers) || peers.length > 3 || new Set(peers).size !== peers.length || peers.some(p => typeof p !== 'string' || !ids.has(p) || p === input.agentId)) reject(422, 'invalid_report');
  return {agentId: input.agentId, status: input.status, taskType: input.taskType, collaborators: [...peers].sort(), eventId: input.eventId, expectedRevision: input.expectedRevision};
}
export function summaryFor(status, taskType) { return `${TASK_LABELS[taskType]}：${LABELS[status]}`; }
export function initialState() { return {schemaVersion: 1, agents: {}}; }
/** Called synchronously inside one persistent transaction. Denials roll back. */
export function applyReport(state, report, now) {
  const old = Object.hasOwn(state.agents, report.agentId) ? state.agents[report.agentId] : undefined;
  const fingerprint = JSON.stringify(report);
  const recent = (old?.recent ?? []).filter(e => now - e.at < 3600000);
  const duplicate = recent.find(e => e.id === report.eventId);
  if (duplicate) {
    if (duplicate.fingerprint !== fingerprint) reject(409, 'event_conflict');
    return {ok: true, duplicate: true, revision: duplicate.revision};
  }
  if ((old?.revision ?? 0) !== report.expectedRevision) reject(409, 'revision_conflict');
  const window = Math.floor(now / 60000);
  const count = old?.rate?.window === window ? old.rate.count : 0;
  if (count >= 12) reject(429, 'rate_limited', Math.max(1, Math.ceil(((window + 1) * 60000 - now) / 1000)));
  const revision = (old?.revision ?? 0) + 1;
  state.agents[report.agentId] = {
    status: report.status, taskType: report.taskType, collaborators: report.collaborators,
    updatedAt: now, revision, rate: {window, count: count + 1},
    recent: [...recent, {id: report.eventId, fingerprint, revision, at: now}].slice(-32)
  };
  return {ok: true, duplicate: false, revision};
}
export function publicState(state, roster, now, mode = 'live') {
  return {schemaVersion: 1, mode, simulated: mode === 'demo', serverTime: new Date(now).toISOString(), bots: roster.bots.map((bot, i) => {
    const record = mode === 'demo' ? {status: STATES[i % STATES.length], taskType: TASKS[i % TASKS.length], updatedAt: now, revision: 0, collaborators: []} : (Object.hasOwn(state.agents, bot.id) ? state.agents[bot.id] : undefined);
    const stale = !record || now - record.updatedAt >= 1800000;
    const reportedStatus = record?.status ?? 'idle';
    const status = stale ? 'idle' : reportedStatus;
    return {id: bot.id, name: bot.name, role: bot.role, color: bot.color, seat: bot.seat,
      status, reportedStatus, alert: ['needs-you', 'error'].includes(reportedStatus), stale,
      taskType: record?.taskType ?? 'general', summary: summaryFor(status, record?.taskType ?? 'general'),
      collaborators: stale ? [] : (record?.collaborators ?? []), revision: record?.revision ?? 0,
      lastSeen: record ? new Date(record.updatedAt).toISOString() : null};
  })};
}
export async function boundedJson(request, max = 1024) {
  if (!request.body) reject(400, 'invalid_json');
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > max)) reject(413, 'body_too_large');
  const reader = request.body.getReader();
  const parts = []; let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > max) { await reader.cancel(); reject(413, 'body_too_large'); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  try { return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)); }
  catch { reject(400, 'invalid_json'); }
}
export async function digest(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(x => x.toString(16).padStart(2, '0')).join('');
}
async function authorize(request, env, id) {
  let hashes;
  try { hashes = JSON.parse(env.AGENT_TOKEN_HASHES); } catch { reject(503, 'auth_not_configured'); }
  if (!hashes || typeof hashes !== 'object' || Array.isArray(hashes) || !Object.hasOwn(hashes, id) || Object.values(hashes).some(h => typeof h !== 'string' || !/^[0-9a-f]{64}$/.test(h)) || new Set(Object.values(hashes)).size !== Object.values(hashes).length) reject(503, 'auth_not_configured');
  const token = /^Bearer ([A-Za-z0-9_-]{32,128})$/.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!token) reject(401, 'unauthorized');
  const actual = await digest(token); let diff = 0;
  for (let i = 0; i < 64; i++) diff |= actual.charCodeAt(i) ^ hashes[id].charCodeAt(i);
  if (diff !== 0) reject(401, 'unauthorized');
}
export function json(value, status = 200, extra = {}) {
  return new Response(JSON.stringify(value), {status, headers: {
    'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'", ...extra
  }});
}
/** Store contract: read() -> snapshot; transact(sync fn) -> atomic durable result. */
export async function handle(request, env, store, roster, now = Date.now()) {
  try {
    validateRoster(roster);
    if (!['live', 'demo'].includes(env.OFFICE_MODE)) reject(503, 'invalid_mode');
    const path = new URL(request.url).pathname;
    if (!['/state', '/report'].includes(path)) reject(404, 'not_found');
    const method = path === '/state' ? 'GET' : 'POST';
    if (request.method !== method) return json({error: 'method_not_allowed'}, 405, {allow: method});
    if (path === '/state') return json(publicState(env.OFFICE_MODE === 'demo' ? initialState() : await store.read(), roster, now, env.OFFICE_MODE));
    if (env.OFFICE_MODE === 'demo') reject(403, 'demo_is_read_only');
    if (request.headers.has('origin')) reject(403, 'browser_reports_forbidden');
    if ((request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase() !== 'application/json') reject(415, 'json_required');
    const report = validateReport(await boundedJson(request), roster);
    await authorize(request, env, report.agentId);
    return json(await store.transact(state => applyReport(state, report, now)));
  } catch (err) {
    if (err instanceof Problem) return json({error: err.message}, err.status, err.retryAfter ? {'retry-after': String(err.retryAfter)} : {});
    // Never log bodies, credentials or exception text containing input data.
    return json({error: 'internal_error'}, 500);
  }
}

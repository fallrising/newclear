/** Pure paired-driver guards. Error messages never interpolate observed URLs. */
export function allowedTransport(raw, websocket = false) {
  try {
    const u = new URL(raw);
    return u.protocol === (websocket ? 'ws:' : 'http:') && u.hostname === '127.0.0.1' && u.port === '1420' && !u.username && !u.password;
  } catch { return false; }
}
export function routeKind(raw) {
  if (!allowedTransport(raw)) return 'external_or_invalid';
  const u = new URL(raw);
  if (u.pathname === '/' && !u.search && !u.hash) return 'home';
  if (u.pathname === '/favicon.ico' && !u.search && !u.hash) return 'favicon';
  return 'same_origin_asset';
}
export function safeReason(error) {
  if (error?.code === 'ERR_ASSERTION') return 'ASSERTION_FAILED';
  const message = error?.message;
  return typeof message === 'string' && /^(REVIEW_[A-Z_]+)$/.test(message) ? message : 'UNCLASSIFIED_FAILURE';
}
export async function bounded(action, milliseconds = 5000) {
  let timer;
  try { return await Promise.race([Promise.resolve().then(action), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('REVIEW_CLEANUP_TIMEOUT')), milliseconds); })]); }
  finally { clearTimeout(timer); }
}
/** Every owned close is attempted even when an earlier close rejects. */
export async function closeOwned(resources, milliseconds = 5000) {
  const results = await Promise.allSettled(resources.map(({ close }) => bounded(close, milliseconds)));
  return Object.fromEntries(resources.map(({ name }, index) => [name, results[index].status === 'fulfilled']));
}
export function createInterruption() {
  let signal = null;
  return { request(name) { signal ??= name; }, get signal() { return signal; }, check() { if (signal) throw new Error('REVIEW_INTERRUPTED'); } };
}
/** Assign ownership BEFORE the cancellation check, including late async creation. */
export async function acquireOwned(factory, assign, interruption) {
  interruption.check();
  const resource = await factory();
  assign(resource);
  interruption.check();
  return resource;
}
export function assertRuntimeHealth(health) {
  if (health.blockedHttp || health.blockedWebSocket || health.pageErrors || health.failedRequests.length || health.responses.length || health.console.some((item) => item.type === 'error')) throw new Error('REVIEW_UNEXPECTED_BROWSER_HEALTH');
}

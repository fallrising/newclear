export function safePath(raw, origin) {
  try {
    const url = new URL(raw);
    const allowed = /^\/(?:api\/(?:auth\/(?:csrf|session|login|logout)|accounts|posts(?:\/\d+(?:\/(?:replies|like|repost|reports))?)?|replies\/\d+\/reports|notifications(?:\/read)?|profiles\/r[a-f0-9]{10}(?:\/posts)?|search|media\/\d+)|notifications|search|profiles\/r[a-f0-9]{10})?$/.test(url.pathname);
    return {sameOrigin: url.origin === origin, path: allowed ? url.pathname : 'unrecognized-path'};
  } catch {return {sameOrigin: false, path: 'invalid-url'};}
}
export function expectedAbort(event, navigations, teardownComplete) {
  return event.sameOrigin && event.path.startsWith('/api/') && event.method === 'GET' && event.errorCode === 'net::ERR_ABORTED' &&
    ((event.teardown === true && teardownComplete) || navigations.some(nav => nav.id === event.navigationId && nav.observed === true && event.timeMs >= nav.startedMs && event.timeMs <= nav.endedMs));
}
export function expectedLogoutAbort(event, proof) {
  return event.sameOrigin && event.path === '/api/auth/logout' && event.method === 'POST' && event.errorCode === 'net::ERR_ABORTED' &&
    proof.sameRequest === true && proof.status204 === true && proof.session200 === true && proof.accountNull === true && proof.signedOutUI === true;
}
export function classifyConsoles(events, responses) {
  const remaining = [...responses];
  return events.map(event => {
    const index = remaining.findIndex(response => event.sameOrigin && event.status === 500 && response.status === 500 && response.path === event.path);
    if (index < 0) return {...event, classification: 'unclassified'};
    remaining.splice(index, 1); return {...event, classification: 'controlled-500-response'};
  });
}

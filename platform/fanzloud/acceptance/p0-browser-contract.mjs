import assert from 'node:assert/strict';

// Reuse the accepted T007 shell and values; do not manufacture a second CLI contract.
export function fixtureFromRust(source, ledger) {
  assert.match(ledger, /^\/[A-Za-z0-9/_.-]+$/);
  const constant = name => {
    const match = source.match(new RegExp(`const ${name}: &str = ("[^"\\n]*");`));
    assert(match, 'T008_FIXTURE_CONSTANT');
    return JSON.parse(match[1]);
  };
  const prompt = constant('PROMPT_CANARY');
  const taskId = constant('TASK_ID');
  const diffBlock = source.match(/const DIFF_CANARY: &str = concat!\(([\s\S]*?)\n\);/);
  assert(diffBlock, 'T008_FIXTURE_DIFF');
  const diff = [...diffBlock[1].matchAll(/"(?:[^"\\]|\\.)*"/g)].map(m => JSON.parse(m[0])).join('');
  const functionBody = source.slice(source.indexOf('fn fixture_script('));
  const raw = functionBody.match(/r#"(#!\/bin\/sh\n[\s\S]*?)"#/);
  assert(raw, 'T008_FIXTURE_SCRIPT');
  const script = raw[1].replaceAll('{ledger}', ledger).replaceAll('{PROMPT_CANARY}', prompt)
    .replaceAll('{TASK_ID}', taskId).replaceAll('{{', '{').replaceAll('}}', '}');
  assert(!/\{(?:ledger|PROMPT_CANARY|TASK_ID)\}/.test(script), 'T008_FIXTURE_PLACEHOLDER');
  return { script, prompt, diff };
}

export function ledgerCounts(text) {
  assert(text.length <= 4096, 'T008_LEDGER_SIZE');
  const entries = text.trim().split('\n');
  const allowed = ['version', 'login_status', 'cloud_exec', 'cloud_status', 'cloud_diff'];
  assert(entries.every(e => allowed.includes(e)), 'T008_LEDGER_UNKNOWN');
  return Object.fromEntries(allowed.map(name => [name, entries.filter(e => e === name).length]));
}

export function assertJourney(receipt) {
  assert.equal(receipt.authenticated, true, 'T008_AUTH');
  assert.equal(receipt.loggedIn, true, 'T008_LOGIN');
  assert.equal(receipt.submitClicks, 1, 'T008_SUBMIT_CLICK');
  assert.equal(receipt.submitResponses, 1, 'T008_SUBMIT_RESPONSE');
  assert.equal(receipt.diffResponses, 1, 'T008_DIFF_RESPONSE');
  assert.equal(receipt.exactDiff, true, 'T008_DIFF');
  assert.equal(receipt.readyOnPage, true, 'T008_READY_PAGE');
  assert.equal(receipt.activityOnPage, true, 'T008_ACTIVITY_PAGE');
  assert.equal(receipt.reconnected, true, 'T008_RECONNECT');
  assert.equal(receipt.logoutRejected, true, 'T008_LOGOUT');
  assert.equal(receipt.pageErrors, 0, 'T008_PAGE_ERROR');
  assert.equal(receipt.failedRequests, 0, 'T008_REQUEST_ERROR');
  assert.equal(receipt.unexpectedResponses, 0, 'T008_HTTP_ERROR');
  assert.deepEqual(receipt.events, [
    { seq: 1, type: 'turn_accepted', state: null },
    { seq: 2, type: 'lifecycle_changed', state: 'pending' },
    { seq: 3, type: 'lifecycle_changed', state: 'ready' },
  ], 'T008_EVENTS');
  assert.equal(receipt.ledger.cloud_exec, 1, 'T008_EXEC_COUNT');
  assert(receipt.ledger.cloud_status >= 1 && receipt.ledger.cloud_status <= 8, 'T008_STATUS_COUNT');
  assert.equal(receipt.ledger.cloud_diff, 1, 'T008_DIFF_COUNT');
}

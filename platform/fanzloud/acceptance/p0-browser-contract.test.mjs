import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fixtureFromRust, ledgerCounts, assertJourney } from './p0-browser-contract.mjs';
const source = readFileSync(new URL('../apps/control-plane/tests/p0_subscription_e2e.rs', import.meta.url), 'utf8');
const good = () => ({ authenticated: true, loggedIn: true, submitClicks: 1, submitResponses: 1,
  diffResponses: 1, exactDiff: true, readyOnPage: true, activityOnPage: true, reconnected: true,
  logoutRejected: true, pageErrors: 0, failedRequests: 0, unexpectedResponses: 0,
  events: [{seq: 1, type: 'turn_accepted', state: null}, {seq: 2, type: 'lifecycle_changed', state: 'pending'},
    {seq: 3, type: 'lifecycle_changed', state: 'ready'}],
  ledger: {cloud_exec: 1, cloud_status: 1, cloud_diff: 1} });
test('AC-01 extracts the accepted CLI contract and rejects unsafe ledger paths', () => {
  const fixture = fixtureFromRust(source, '/state/fixture/invocations.log');
  assert(fixture.script.includes("printf 'codex-cli 0.145.0\\n'"));
  assert(fixture.script.includes("[ \"$7\" = '" + fixture.prompt + "' ]"));
  assert(fixture.script.includes("ledger='/state/fixture/invocations.log'"));
  assert.equal(fixture.diff, 'diff --git a/README.md b/README.md\nindex 1111111..2222222 100644\n--- a/README.md\n+++ b/README.md\n@@ -1 +1,2 @@\n Existing text\n+Synthetic text\n');
  assert.throws(() => fixtureFromRust(source, "/state/';bad"));
  assert.throws(() => fixtureFromRust(source.replace('fn fixture_script(', 'fn absent('), '/state/ledger'));
});
test('AC-01 rejects unknown invocations, duplicate submission, missing state/diff and browser errors', () => {
  assert.deepEqual(ledgerCounts('version\ncloud_exec\ncloud_status\ncloud_diff\n'),
    {version: 1, login_status: 0, cloud_exec: 1, cloud_status: 1, cloud_diff: 1});
  assert.throws(() => ledgerCounts('cloud_apply\n'));
  assertJourney(good());
  for (const mutate of [r => r.ledger.cloud_exec++, r => r.ledger.cloud_status = 0,
    r => r.ledger.cloud_diff = 0, r => r.exactDiff = false, r => r.events.pop(),
    r => r.events[2].seq++, r => r.logoutRejected = false, r => r.pageErrors++,
    r => r.failedRequests++, r => r.unexpectedResponses++]) {
    const value = good(); mutate(value); assert.throws(() => assertJourney(value));
  }
});

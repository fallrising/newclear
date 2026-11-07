# Browser retention/export composition — local snapshot 2026-10-26

Issue #379 / BGC01–02. Prior contract e3811042 precedes author code. Production
baseline PR653 merge ada118988b909c6aa826a76da8939e1ec7451432 is unchanged.

One PostgreSQL/API/fake GitHub cohort has explicit synthetic historical first INSERTs,
not an observed31-day worker lifecycle. A/B terminal never-allocated runs have
canonical immutable archives; A has two old events and one recent suffix. No schema,
immutable-trigger bypass, timestamp rewrite or mid-scenario fixture reset.

Two authenticated Chromium pages retain A/B controls. A freshly approves export;
actual approved event GC removes only A's prefix and actual archive GC removes only
unreferenced B. A archive is protected by its queued export reference. Manifest
checks bind DB identity, boot/cohort, labels, hashes, lifecycle/authority and exact
GC candidates before apply. A real410 reconnect loads snapshot/suffix, keeps result
and download hash; replay with same/new keys keeps one operation. Actual export
worker over synthetic HTTP creates exactly one branch/DraftPR/four writes, unknown
verification remains explicit, idle redispatch adds no effect.

B stale approval and download receive410, no export or file is created, actual
error refetch hides archive/export controls while result/diff/hash/size remain.
Separate authenticated API GET confirms exact artifact_expired JSON. Both pages
reload and preserve final states; authority and permanent event identities remain.

## Verification

Root T102-browser3: **one new Playwright scenario passed (9.8s)**, scoped strict
TypeScript and Prettier passed. Exact-source task mirror under read-only host namespace,
before/after source manifests equal, cached unchanged web inputs/assets verified;
owned PostgreSQL and browser/API resources cleaned up. Actual focused command:

```sh
python ../scripts/test-postgres.py node node_modules/@playwright/test/cli.js test e2e/m4-retention-export.spec.ts --output TASK_BUILD/playwright-results --reporter=line --trace retain-on-failure
```

The runner executed from the mirrored web directory with absolute Python/script/node
paths and node_modules/@playwright/test/cli.js; TASK_BUILD denotes the launcher output.
No other local browser/platform/OC/native suites were replayed.
Root T102-static1: Ruff/format178,43 project contracts,6 indexes,diff passed.
Required changed-source hosted CI and normal merge remain delivery gates.

Initial author9E501 lint failures were fixed and preserved. T102-browser1 and2
failed at45s; browser2 diagnostics isolated Playwright browser response.json()
collection after real B download410. The UI branches on status without reading
that body. Test observation was split into browser410/UI/no-file plus independent
authenticated API410 JSON; no product change, timeout increase or behavior assertion
removal. Both failed source snapshots/logs and diagnostic trace remain preserved.
This is not a product RED/fix or first-green claim.

Frozen source SHA256:
- scripts/browser_m4_retention_fixture.py:4701ac92019d8c0ede74df09e65e834cee2558042c8b20c14456354b465004bb
- scripts/browser-fixture.py:fbc66753729836311779718053a46385a31fdaec1e41f4a3a2c7ecb4e409c317
- web/e2e/m4-retention-export.spec.ts:2749421d4f1f30270e74ef7798046ac63e31337e2433a22897c5a3758cfe5cec

## Boundaries

Real Chromium/auth/TCP API/SQL/GC/export worker/HTTP; synthetic imported history and
GitHub upstream, no VM/model lifecycle exercised. Audit/native/lostACK/stale recovery
retain earlier independent evidence, not rerun here. Full same-version fake fault
matrix, live AT09/12/13, unknown host residue, VM recovery/deployment and whole M4
remain open. No deployment, release or usable tag.

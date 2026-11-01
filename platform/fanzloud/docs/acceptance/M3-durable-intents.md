# M3 / AC05 minimum: durable intents and restart readback

T-0442; [contract](../specs/SPEC-M3-durable-intents.md). This is the fixed minimum
persistence slice, not full M3, complete FN04 event replay, FN05 reviewer handoff or
FN07 owner journey. Fresh-context independent **ACCEPT_M3_MINIMUM** received: code and actual evidence
accepted; required hosted CI and normal merge/readback remain delivery gates.

## Source and actual result

Actual execution source `2e08fabe83b2d2717a3970c2a9eefa658b52e550`; Rust executable
SHA256 `dae7d11cd6de1384783bef04ac8a3ddf2c85ddadbf9e1fd5da870102ad97d6c8`.
Manifest hashes488 tracked Fanzloud/AP source files and3 private harnesses. AP production
code is unchanged. Node24.18.0 / Playwright1.63.0 / Chromium153.0.8010.12 used the retained
pinned browser image, real private HTTPS, Rust, AP API and PostgreSQL. No worker started.

Two actual queued task POSTs, each backed by exactly one AP tasks.create command:

- Confirmed run `9300bbc2-4a55-4142-b168-9aafea72eadb`: intent/receipt survives Rust/AP
  shutdown and restart, fresh browser logs in and finds the identical run; no second POST.
- Unknown run `acd1054a-080c-4104-9f70-e06e5b73f60b`: test-only transport holds a real
  AP202 after DB commit, then Rust is killed with SIGKILL before receipt persistence.
  New Rust and a fresh browser show the retained unknown intent, disable submit, and
  reload/Refresh issue no task POST. The local run reference remains null; it is not guessed
  from the AP task title or manually repaired. AP query by key is still unavailable.

Both tasks were explicitly cancelled through the Web before allocation. Final AP states
are cancelled/not_allocated, sandbox_id null, state_version2, last_event_seq4. Database
agent.started count remained3 (all historical M2), hence **zero new coding invocations,
zero agent starts and zero VM starts**. AP capacity remains1/draining, reservations0.

Two graceful Rust/AP restart receipts at14:52:40.120791Z and14:52:42.854246Z record old/new
process IDs. The additional Rust kill/restart receipt is14:52:44.363425Z, return code-9.
No arbitrary agent execution continuation or power-loss filesystem experiment is claimed.

The page also reopened the accepted M2 Claude result
`69ca2054-3563-4436-957f-819bc1a01d9a` before and after restart, with identical durable
observation cursor1/history, passing checks, displayed/downloaded/AP bytes and fixed base
`55bd36a47d3ca619b0a10bcad427b9fb9b8c99c5`. The285-byte diff hashes to
`c5134c8015bad2104fceb70e5c4c79086d6ec9bd85a0b4fa0f833b4ed3ef6fdb`.
This is readback of a real prior result, not a new successful coding invocation. New queued
intents and retained-result recovery are separately evidenced; no synthesized result was
written to AP or a task. Private screenshots show result and unknown recovery.

## Acceptance mapping

| AC | Observed result | Evidence |
| --- | --- | --- |
| M3-01 | PASS: intent before dispatch; reopen exact confirmed receipt | SQLite tests16; actual first run restart; SQLite read-only audit |
| M3-02 | PASS: concurrent admission/changed payload/unknown prevent extra POST | eight-thread store races; real Rust TCP contract; two AP commands for two explicit requests |
| M3-03 | PASS: lost/invalid receipt and actual kill after AP commit stay unknown; no resend | native fault server plus actual AP hold/SIGKILL/new browser, distinct layers |
| M3-04 | PASS for minimum observed-history/result references | actual prior M2 result after Rust/AP restart; immutable/stale/bounded native projection tests |
| M3-05 | PASS: auth/CSRF and private storage, typed failures | native gateway/store security tests; current inherited AP auth; no provider secrets stored |
| M3-06 | PASS: fresh browser restores lock/confirmed task, failed read locks | Web26 and actual Chromium two fresh-context restarts plus kill/reload/Refresh |

## Commands and failures kept visible

From platform/fanzloud:

```sh
node --test --test-isolation=none apps/control-plane/web/p0-client.test.mjs acceptance/m2-isolated.test.mjs
cargo fmt --all -- --check
cargo clippy --locked --workspace --all-targets --all-features -- -D warnings
cargo test --locked --workspace --all-targets --all-features
cargo build --locked --workspace --bins --all-features
python3 -m unittest discover -s tools -p 'test_m1*.py' -v
```

Web26 pass; full Rust339 tests pass with0 failed/ignored; focused gateway16 and store16
are subsets, not additional tests. Project `python3 scripts/check_project_success.py`
passes52; staged whitespace checks pass. Final browser correction changed embedded JS only,
Web26 reran and current binary rebuilt; unchanged native green suites were not repeated.

- Four initial browser tests failed on the old behavior, then passed. Native GET history
  test failed404 on old source. Initial sandbox sccache permission error was resolved via
  authorized shared-cache execution; worker used offline wrapper-free compilation.
- Store retained meaningful RED for legacy receipt rebind and aggregate list-size limit;
  both fixed; initial skeleton missing-API compile failure and a patch-match error are kept.
- Independent review found delayed A response could overwrite B's uncertain local key,
  and stale404 selection lacked fallback. Both reproduced, fixed with immutable key/
  generation and404-only read fallback, then26 Web tests passed. No automatic resend added.
- Actual browser passed, but final private Python summary export failed on UUID JSON
  serialization after cleanup. The incomplete original `live-summary.json` and exit1 log
  remain intact. A separate **read-only** DB/SQLite reconciliation validates both unique
  command IDs, cancellations, zero new agent.started, unchanged result hash and local
  unknown/confirmed records. It serializes UUIDs explicitly in `live-reconciliation.json`.
  No task, browser journey, coding or VM was rerun to fix reporting. The DB was briefly
  reopened for that audit and stopped again; this is separately recorded.
- Browser page errors0; two expected HTTP502 console messages accompanied deliberate
  interruption. They are retained as expected faults, not silently removed.

## Operations and limitations

All Rust/AP/proxy/browser listeners18447–18450 and acceptance containers are stopped;
PostgreSQL volume retained, remote runtime untouched. New SQLite intent store deliberately
retains the unknown record. [Operator instructions](../isolated-operator.md) explain the
required private `CODEBOX_ISOLATED_STORE`, bounded history and manual unknown investigation.
There is no standing URL, automatic abandon/retry, new package, API billing, release or deploy.
Provider requests/tokens/cost and full orchestration accounting remain unknown/null.

Private evidence root `fanz-m3-20261101`: source-manifest, native/Web logs, browser receipts,
screenshots/diff, original partial export and reconciled DB/SQLite record. Only selected
non-credential artifacts are backed up. Independent review verified all488 source hashes,3 harness hashes, the binary,
three screenshots and the reconciled records. Required hosted CI, normal
[PR929](https://github.com/fallrising/newclear/pull/929) merge/readback and ledger publication
remain delivery gates. Final documentation-only changes must retain source2e08fabe
production bytes; sampled observations are not the full FN04 event stream.

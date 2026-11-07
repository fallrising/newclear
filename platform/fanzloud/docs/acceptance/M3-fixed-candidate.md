# M3 fixed candidate preparation — T-0442

[Contract](../specs/SPEC-M3-fixed-candidate.md), C01–05. Actual source
`4fa2f781d0b45271c1ffa55f0873389d1e2d38dc`; binary SHA256
`fd6621080a89e414cde746ea5d27183edaef562ea084ecb17355fd2bc9ebb1fe`. Fresh-context independent **ACCEPT_FIXED_CANDIDATE_C01_C05** verifies corrected
source, actual evidence, selected backup and ledger facts. **FN05 remains incomplete**:
this is immutable candidate inspection/download, not a real reviewer verdict.

## Actual observation

2026-11-01T15:35:02–15:35:07Z: Chromium153 / Node24.18.0 / Playwright1.63.0 through
private HTTPS → production Rust → unchanged AP API → retained PostgreSQL. No worker.
Two fresh browser contexts explicitly selected prior actual M2 writer
`69ca2054-3563-4436-957f-819bc1a01d9a`, acquired the fixed candidate and downloaded
exact AP archive bytes. This did not repeat M2 coding or its isolation acceptance.

- Artifact `cc32850a-6eb1-56a4-8886-c62f163bb136`,1932bytes. Candidate SHA256
  `43a30ab60f57b7bb594d2b0b40684be47cef870f3da63706b42e3c838cfca8b6`.
- Writer base `55bd36a47d3ca619b0a10bcad427b9fb9b8c99c5`, profile
  `3fb7cee1-3584-42b7-bbff-787290e17507`, verification passed. Distinct diff SHA256
  `c5134c8015bad2104fceb70e5c4c79086d6ec9bd85a0b4fa0f833b4ed3ef6fdb`.
- Both downloads byte-equal database payload and each other. The page displays candidate
  and diff hashes, base/profile and archived individual checks as text; review not started.
- Logout disables download; two deliberate unauthenticated artifact GETs return401.
  Two expected HTTP401 console messages retained separately; zero page/unexpected errors.
- No task POST or other work mutation; historical counts before/after unchanged:
  runs8, tasks.create8, agent.started3. Zero new coding/VM; APslots1/draining and
  unreleasedreservations0. The original prior unknown SQLite is byte-identical; a private
  copy was used for this readback. No unknown record was repaired or cleared.
- All acceptance API/Rust/browser listeners and containers stopped; PostgreSQL volume
  retained. Remote runtime was untouched; no standing URL or resource expansion.

## Acceptance map

| AC | Evidence | Result |
| --- | --- | --- |
| C01 | Rust exact canonical GET allowlist and actual TCP auth/body/410 tests with durable store enabled | PASS |
| C02 | UTF8 archive/size/hash and run/task/base/profile/attempt/goal/diff/check binding; real AP bytes match both downloads | PASS |
| C03 | Metadata tamper, rehashed identity/result mismatch, missing/pruned/oversize/nonterminal reject; exact expiry recheck at download | PASS native; actual auth401 |
| C04 | Late load after selection/logout ignored; expired download clears prior candidate; no dispatch | PASS JS33 and actual logout |
| C05 | Same real archive in two fresh Chromium contexts; DB count/hash equality and cleanup | PASS actual, independently accepted |

## Commands and preserved failures

From platform/fanzloud: `cargo fmt --all -- --check`; `cargo clippy --locked --workspace
--all-targets --all-features -- -D warnings`; `cargo test --locked --workspace --all-targets
--all-features`; `cargo build --locked --workspace --bins --all-features`: exit0. The
parent tool session95184 completed the set-e chain; retained stdout is truncated, so
individual native counts are not derived from that partial transcript. Final embedded
binary rebuilt after JS-only check-detail correction, session55483 exit0.

Repo-root `node --test --test-isolation=none platform/fanzloud/apps/control-plane/web/p0-client.test.mjs
platform/fanzloud/acceptance/m2-isolated.test.mjs`:33pass/0fail/0skip, raw log retained.
`python3 scripts/check_project_success.py`:52pass; qualification unittest discovery
`python3 -m unittest discover -s platform/fanzloud/tools -p 'test_m1*.py' -v`:3pass.
Actual private harness exit0, no retry. Required hosted CI/merge/readback still gates.

Original GET route and missing UI action fail on old behavior (RED). Review requested
individual archived checks; new assertion failed, then fixed and Web33 passed. Wrong-cwd
file/check attempts and task-ID validator formatting failure are retained in the private
check receipt; corrected paths/three-digit local task ID passed. An earlier shell continued
to an old subset after a failed edit: that subset is not the final33-test evidence. Shared
PLAN main-merge conflict was resolved preserving both projects; no production bytes changed.

## Scope and next dependency

[Proposed T-0449](../specs/PROPOSAL-M3-readonly-review.md) is the exact remaining AP
readonly-review admission/tool/result and bounded-rework dependency. It remains unapproved:
no AP/Workforce edits or reviewer CLI calls. Candidate archive is goal/diff/check evidence,
not a full repository snapshot. Existing auth/expiry applies; no missing archive synthesis.
FN05/fullM3/FN07 and oldCloudAC04 are not accepted. Provider requests/tokens/cost unknown.
Private source/harness manifests, receipts, screenshots, original downloads and check logs
are retained separately from mock/TCP tests; credentials/auth logs never enter public Git.

Independent final acceptance verified831 manifest source hashes,3 harnesses and binary,
two exact downloads and recomputed diff hashes, screenshots,24 backup entries and8journal
artifact pointers. Only subsequent documentation differs from the actual source. Required
hosted CI and normal [PR941](https://github.com/fallrising/newclear/pull/941) merge/readback
remain delivery gates; this acceptance never expands to the pending AP dependency.

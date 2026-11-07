# T-0432 — Process interruption and durable recovery

Demand: desk T-0432 / #698; claim PR336 merged `d7043de64820bb072bc772bb2ee2369e604a9633` before product changes. Existing T-1102 §4.1/M-10/UC-R02 and original17AC remain unchanged.

## Goal and boundary

Prove that a killed local process leaves durable attempts and that production startup recovers unresolved rows once without inference replay or duplicate amounts. Existing stream-settlement tests already kill the actual gateway after dispatch and restart twice; buffered HTTP/Antigravity native reopen is a different evidence layer, and completed CLI restart tests do not prove every active interruption boundary. This is an evidence gap, not a proven runtime defect. Preserve baseline passes; only correct a defect if an actual focused failure proves it.

The bounded matrix separates production storage subprocess cuts from real gateway HTTP and fake CLI dispatch receipts. It does not claim every provider/client version, power-loss durability, arbitrary filesystem failures, automatic cleanup of every orphan after SIGKILL, or upstream exactly-once execution. No new timeout, retry, schema, provider, mapping, pricing or client capability policy. AC04/17 remains pending independently; mainline incomplete, usable_tag none, desk in_progress and #698–702 stay open.

## Fixed acceptance

| ID | Given / When / Then | Evidence |
| --- | --- | --- |
| CR-1 | A production-store reservation has committed before dispatch; SIGKILL the owning subprocess; the same pending identity persists and production recovery marks it interrupted/missing once, with a second recovery unchanged. | Deterministic storage-child barrier and actual signal exit, SQLite before/after; explicitly not HTTP |
| CR-2 | A controlled HTTP or fakeCLI receipt proves dispatch while the row remains pending; SIGKILL the owned gateway and restart; retain the same request/attempt and create no new inference/input receipt, refresh or discovery. | Actual isolated gateway and counted fake endpoint/input, owned process identity, prekill row and two recovered snapshots; reused existing stream proof remains attributable |
| CR-3 | Finalization has committed, or a process stops immediately before it; restart preserves finalized values exactly, recovers only pending rows once, and does not duplicate related fallback/retry attempts or known amounts. | Storage subprocess boundaries for HTTP/Claude/Cursor finalizers, finalized history control, existing identity/owner-lock tests plus actual restart |
| CR-4 | The same fixture rows/filter are read after recovery; SQLite, authenticated JSON and CSV agree and interrupted rows remain in coverage denominators. Missing measurements are null/empty, never invented0; finalized history stays unchanged. | Independent exact-scope reconciliation; observed clocks kept distinct; no history backfill or inference replay |
| CR-5 | A terminal user reruns the guarded entry; fixed sources, Cargo artifacts, inventory and retained binary digests are checked before execution; evidence distinguishes layers and owned resources are cleaned. | Headless report/checker, relevant Rust/Python/contracts/fmt/Clippy/lockedbuild and prior journeys, independent source/ledger review, requiredCI/normalmerge/readback/journal/desk/full verified backup/owned worktree cleanup |

## Design and verification

Use test-only subprocess barriers around existing Store reservation/finalization calls. The parent must observe a committed row and exact phase receipt before killing its owned child; do not infer the cut from a sleep. Exercise each existing finalizer family without adding production runtime hooks or dependencies. Use an ordinary gateway process for dispatched HTTP/fakeCLI cases, independent receipt counters, a finalized known-cost history control, two restarts and unchanged configured routes/keys. A fixture may clean a fake child left after gateway SIGKILL; label that cleanup honestly instead of claiming product-wide crash cleanup.

Only synthetic credentials, isolated temporary DB/HOME, absolute fake executables and controlled nonforwarding endpoints are permitted. Before HTTP, prove destination/config confinement, reject unknown/redirect/CONNECT forwarding, and preserve official OAuth allowlists. No installed/live CLI, provider, login, private DB, Docker, dependency/permission broadening, release or deploy. Keep the historical T0428 synthetic official401 evidence; it is not zero outbound history and is never retried here.

If all current runtime behavior meets the contract, add missing regression/evidence only. Any new failure is kept with its exact layer and cause; no fabricated RED and no green rerun as #701 root-cause proof. Native storage, parser/SQL, actual gateway HTTP/fakeCLI and prior evidence remain separately labeled. Existing genericHTTP/Claude/Cursor/namedHTTP journeys, measurementcoverage, bufferedsettlement and Antigravity entry are regression dependencies; original17AC/T1102/Cargo/unrelatedplans and old digest guards remain unchanged.

Estimate2–3activehours including bounded workers/review/delivery, checkpoints every20minutes; at most2reasoned followups per initial issue. Stop affected work on uncertain isolation/boundary, material product ambiguity, scope conflict or unbounded effort. Whole-round tool/agent/model/provider/retry/token/cost/execution-active-wait remain unknown/null; fixture counters are separate. CR-5 cannot be called complete before final management/backup/cleanup gates actually pass.

## Current evidence

Current production Store behavior passes unchanged. The only Rust source change is a test-only module. Nine storage subprocess cases cover three finalizer families × committed reservation/pre-finalizer/committed finalizer. Each observes an acknowledged boundary, reads committed SQLite independently, sees actual SIGKILL9/reap and owner-lock contention, and compares complete stored rows across two recoveries. Six unresolved cuts recover1 then0; three finalized cuts recover0 then0. These are storage-process observations, not HTTP/provider calls.

The fixed terminal entry additionally passed three actual normal-gateway cases: buffered genericHTTP, fakeClaude and fakeCursor. Each observed a committed pending attempt and independent receipt before killing only the gateway PID, then restarted the actual server twice. Three finalized known-cost controls stayed unchanged; three pending rows became interrupted/missing once, without new receipts or attempts. Across this entry's three gateway cases:4fakeHTTP inference receipts,2fakeCLI spawns,2fakeCLI input receipts,6client requests and41admin requests; refresh/discovery0,9intentional isolation denials and0unexpected denials. These are different local denominators, not whole-round model usage. Fake orphan cleanup is harness PID/birth cleanup, not a dead gateway guarantee. Owned processes/listeners/temp state cleanup passed.

SQLite original columns, JSON events, CSV and schema2 daily/measurement/cost coverage agree for the same two fixture rows per case after each restart. Unknown terminal values stay null/empty; known explicitzero/history stay known. Existing actual streaming SIGKILL across all3clientprotocols remains in the required ss4/pc3 Rust regression, separate from these three new buffered cases.

Local gates passed407Rusttests/23groups,199Python tests,20repository tests,49contracts/8indexes,fmt/Clippy/locked ordinary/native builds, and eight previous isolated regressions: genericHTTP/Claude/Cursor/namedHTTP nine-stage journeys, measurementcoverage, Antigravity isolation/settlement, bufferedHTTP and bufferedCLI. The bufferedCLI report was also independently checked. No real provider/client/version acceptance occurred. Independent source/runtime final review passed; normal publication and final ledger/backup/cleanup remain required delivery gates.

Retained failures: sccache denied compiler startup, including the direct-Cargo hypothesis; direct compiler invocation through a command-local wrapper bypass built successfully without changing global cache/permissions. Exact sccache cause remains unknown. First fullPython invocation omitted the existing shared target env and one binary-path setup assertion failed; corrected command environment passed unchanged tests. New independent checkers had two oracle defects: native request-name separator and missing CLI source/pending-clock constraints. The latter has preserved pure negative RED→GREEN; neither is productruntimeRED. Existing runtime baseline passed, so no runtime correction was invented.

Normal binary SHA256 `737a1b65349798f280a05922288547bc1568cdbda88c869c36a650bef066f39d`; native `3776706ee33b58e02b14da59f900179748966816edfa43338ce4b6e39cbbc45d`,295testinventory. Both retain54source/template/Cargo inputs and exact Cargo attribution. A separate integration-context ordinary binary is retained because test dependency features yield a different artifact from ordinary build; shared target freshness alone is not evidence.

## Headless replay

The private handoff retains `local-demo.py`, default check, with pinned manifest/Python/helpers/generatedfixture/sourceinputs and independent normal/native binaries. It runs nine storage-process cuts plus three actual buffered gateway cases and independently validates both reports. `--verify-report <saved-report.json>` only reads/verifies saved evidence and pins. Preserve the entry/artifacts together; old entries/digest guards remain unchanged.

An independently prepared checkout can run the lower-level gateway cases after externally pinning the exact sources, Python/generatedfixture and attributable ordinary binary:

```sh
python3 scripts/crash_recovery_walkthrough.py --check --binary /path/to/preserved-thinrouter --expected-binary-sha256 <verified-sha256> --output-dir /path/to/new-evidence-directory
```

The native storage regression is `store::crash_recovery_tests::m10_storage_boundaries_survive_sigkill`; optionally set `THINROUTER_M10_REPORT_PATH` to an owned report path. The storage checker is `scripts/crash_storage_check.py`; it does not execute HTTP. No owner personal run of this new entry is claimed. Mainline incomplete, usable_tag none, desk in_progress; original AC04/17 scope and live AC01/04/08 remain unresolved. This slice does not close #698–702.

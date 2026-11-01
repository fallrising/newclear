# T-0449 FN05 readonly review acceptance

Status: actual R01–05 evidence captured; independent ACCEPT_READONLY_ACTUAL_AND_NATIVE; PR952 merged as `a69ff34ec173ee36284aceebcb417e560438569c` after finalhead967727b2 passed AP41330719757/Fanz41330719768/contracts41330719829; remote Fanzloud/AP bytes read back equal.. Owner approved bounded proposal after PR941, claim deskPR382 merged800d292. No full M3/platform completion claim.

## Fixed contract / source

[CU-M3-R01–04](../specs/SPEC-M3-readonly-review.md), [approved proposal](../specs/PROPOSAL-M3-readonly-review.md). Existing AP command transactions/Worker/lease/Connector lifecycle; new immutable candidate readonly capability and explicit one-rework/two-review lineage. Pinned Codex0.166.0 and Claude2.1.312 unchanged. Parent integrates AP worker and Fanzloud; source commit recorded at actual run.

## Observed native evidence

- Fanzloud store18 tests, HTTP2 focused handoff tests, Web38 tests passed. Full fmt/clippy/workspace tests/build pipeline session77513 exit0; toolstdout truncated, not a full retained raw transcript. Final hostedCI independently required.
- AP worker offline23 tests and lint/format passed; parent real PostgreSQL first7 then expanded12 admission/recovery tests passed. Full AP PostgreSQL suite832 tests and M0 suite45 tests passed; the final12-test focused run covers the Unicode correction made during the full-suite run. Final Ruff lint/format passed (167files). No real CLI/VM is implied by these fixtures.
- Independent review found valid CJK reasons expanded by ASCII JSON in rework. Dedicated native DB regression first409RED then corrected UTF8 encoding and12GREEN. Native schema021 fingerprint measured on pristinePostgreSQL18 c2f7f977bb02cbdec40ee2f27ae9f76e753887a6f47be025f869175ae88d5707; baseline020 unchanged functions/triggers, adds9columns14constraints4indexes. Backup strict check retained.
- Initial local tests encountered sccache sandbox denial and wrongcwd paths; corrected commands retained. Worker sandbox TestClient hung and was interrupted; parent isolated native DB runs pass. One Web fixture wrongly routed a GET whose runID was rework as a mutation; method restriction fixed,38pass. These are harness/setup failures, not live retries.

## Actual plan / boundaries

One20min window, last3min cleanup only, one4CPU/4GiB VM/zero-warm. Start with retained real Claude writer69ca2054 and exact archive hash43a30ab6...ca8b6; Codex read-only review. Only if request_changes, explicit UI rework then secondreview, totalmax3newinvocations/per<=600s. No unknown resend. Full actual source/harness/binary, candidate/verdict/diff hashes, CLI/tools/VM/run, guest OS/Connector denials and cleanup receipts required.

Acceptance uses its own new private submission-store instance; previous unknownSQLite is preserved and hash-checked, never cleared or reconciled by this test. This proves a separately configured fresh acceptance installation; the existing locked operator instance still cannot submit and requires trusted manual investigation. Fresh browser and Rust/AP restart must reopen exact result via GET. No new package/API billing/public deploy/release. Services stopped after validation; no standingURL. Complete provider requests/tokens/cost unknown.

## Actual fixed-source result — 2026-11-01

Source `865ed05edc732d3fa61313b9303ce3f9a907c665`, [PR952](https://github.com/fallrising/newclear/pull/952). Real Chromium → HTTPS → Rust → AP review admission → existing Worker/lease → Connector/Cocoon readonly candidate → formal Codex CLI. Window17:09:00.252955Z–17:09:24.594046Z including cleanup, below20min. Exactly1 new invocation, no rework and no second review because verdict was accept; those conditional branches retain native evidence only.

- Writer `69ca2054-3563-4436-957f-819bc1a01d9a`, original Claude2.1.312; base `55bd36a47d3ca619b0a10bcad427b9fb9b8c99c5`,285-byte diff SHA256 `c5134c8015bad2104fceb70e5c4c79086d6ec9bd85a0b4fa0f833b4ed3ef6fdb`.
- Candidate archive `cc32850a-6eb1-56a4-8886-c62f163bb136`,1932bytes, SHA256 `43a30ab60f57b7bb594d2b0b40684be47cef870f3da63706b42e3c838cfca8b6`, preserved unchanged.
- Reviewer run `56b60303-2a9d-40da-b369-57d0f1a0684c`, profile `178e7758-3c9b-44b5-8f64-e2cd81bd9c3e`, Codex0.166.0 / gpt-6.1-sol / ChatGPT subscription. CLI SHA256 `b8a11fedf24b2dfb59a70c9e52b030f9a508dcd49cd2dd0d41956f4c785156b8`; configured readonly tools and exactly1 successful fanz_read, no repository write/exec. Process stopped and configuration verified in native receipt.
- Typed verdict `accept`, three reasons, exact candidate/run binding. Result1896bytes SHA256 `cbb4468cbe93b62fbea63c09dcf01013aad7e5ee3c38b3117d02312ccfa08d63`; first download and fresh-browser download after Rust/AP restart are byte-identical to AP archive. One handoff POST, zero additional task/control mutations and zero browser errors; authentication POSTs are excluded. No auto-Done.
- Guest UID2000 read exact candidate; write/unlink/chmod/create denied by OS. Candidate-only workspace, no secret/control/socket access, no allowed egress; observer authority bound before/after to same AP lease/VM. Connector independently rejected write/exec/traversal/other file/unknown action. These actual probes supplement fixture fault tests.
- Final AP cleanup confirmed, reservations0; remote claims0/VM0/cgroups0, runtime/registry stopped, max1/warm0 unchanged. Original unknownSQLite and writer archive unchanged; runs8→9 and agent.started3→4. No standingURL.

Private retained evidence index: `fanz-readonly-20261101-t0449/` under owner backup. `live-summary.json`, `source-manifest.json`, `runtime-{stage,start,stop}-receipt.json`, `boundary-<run>.json`, `connector-denials-<run>.json`, `events.json`, `runs.json`, browser receipt/downloads/two screenshots, CLI receipt/journal, native logs and independent review. Do not publish private host/accounts/configs/raw transcripts. R01/R04 native; R02/R03 actual; R05 native+actual independently accepted; final source CI/merge/readback passed. Rework not live-exercised, review covers supplied task/diff/checks rather than full checkout, prior locked installation remains locked, fullM3/FN07 remains open.

Independent final review `ACCEPT_READONLY_ACTUAL_AND_NATIVE` inspected source/binary/harness/AP tar, all71 backup checksums, actual artifacts and final shutdown. No material product/actual blocker. Actual-source CI AP41329948742/Fanz41329948610/contracts41329948672 all passed; final docs-head CI passed. Reviewer observed a private handling incident (overbroad read exposed a local DB credential only in tool transcript); no value is in product/journal artifacts, no external action used it, and it is distinct from product runtime boundaries.

## Delivery receipt

PR952 merged as `a69ff34ec173ee36284aceebcb417e560438569c` after finalhead967727b2 passed AP41330719757/Fanz41330719768/contracts41330719829; remote Fanzloud/AP bytes read back equal. Independent `ACCEPT_READONLY_ACTUAL_AND_NATIVE` plus parent delivery gate accepts R01–05 for this bounded FN05 dependency. FullM3/FN07 remains open; no additional live execution.

# T-0449 FN05 readonly review acceptance

Status: implementation/native evidence; actual R02/R03/R05 NOT_RUN. Owner approved bounded proposal after PR941, claim deskPR382 merged800d292. No completeFN05/M3/platform claim until independent actual acceptance.

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

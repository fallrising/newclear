# WorkItem detail proposal — review evidence

T-0339 / BOARD HDTLP. Proposal source `a502addb`. [Proposal](../plans/work-item-detail-20261102.md).

## Claude plan review

Independent Claude Code (claude-opus-5-5, read-only Read/Grep/Glob) review of the first draft, 2026-11-02:
**REWORK**, 132.4 s, USD 1.383 list price (not billing). The reviewer reported one read-only `cat` via Bash
against its instructions; nothing was written. Every finding was re-checked in source before disposition.

| # | Severity | Finding | Disposition |
| --- | --- | --- | --- |
| 1 | blocker | Review/Evidence/Approval WorkItem is already stored: same-transaction audit entry with the row's subject digest → group command_id → immutable result `work_item_id` | Verified (service.go `execute` AppendAudit; vertical.go review/approval/complete; human_report.go `changeMutation`). DTL-03 rewritten to audit-derived attribution; unattributable row is `storage_corruption`; completeness flags, migration 0007 and D2 withdrawn |
| 2 | major | `Review`, `Evidence`, `Blocker` schemas are implemented command payloads | Verified (openapi.yaml PublishFixtureReview/Evidence, AddBlocker payloads). New detail-only item schemas; existing schemas unchanged; DTL-AC-02 checks payload schemas are byte-unchanged |
| 3 | major | `AcceptInitialSpecification` changes bound WorkItems but its result has no `work_item_id` | Verified (result.go; `accepted_work_item_bindings`). Audit includes acceptance groups via binding; DTL-AC-03 covers it; runtime groups noted |
| 4 | minor | D2-a migration under-specified | Moot: migration withdrawn |
| 5 | minor | AC-03/04 test the wrong thing after #1 | DTL-AC-03 adds fixture-only subject and acceptance audit; DTL-AC-04 becomes orphan/conflict → 503; writer-mutation clause dropped |
| 6 | minor | Audit could expose result run_id | Adopted (`run_id` when present); `work_item_id` is the requested item, so not repeated |
| 7 | minor | `AddBlocker`/`ResolveBlocker` have no command caller | Verified; noted in Why |
| 8 | — | Right next M2 slice; only D1 remains after #1 | Adopted |

## Follow-up review

Same reviewer setup on the revision: **ACCEPT**, 64.8 s, USD 0.602 list price. All eight dispositions confirmed against source;
every `work_item`/`run` mutation result carries `work_item_id`. Three minor findings, each verified and adopted:

| # | Finding | Disposition |
| --- | --- | --- |
| 1 | `DecodeCanonicalResult` returns only `(*Error, error)` and needs the operation; runtime audit labels are not command operations | DTL-03 specifies a new read-side decoder with the same checks, operation taken from the stored result |
| 2 | Runtime audit groups untested | DTL-AC-03 adds `ClaimDispatch`/`PublishRunObservation` under the Run's item only |
| 3 | No audit index; attribution scans project audit | Cost accepted for this slice in DTL-04; index only from measured latency |

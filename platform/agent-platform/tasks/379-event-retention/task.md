# Issue379 manual event retention

## Goal and scope

Deliver the30-day manual event-history portion of SDD§12/AT-13 under
[EVENT-RETENTION](../../docs/EVENT-RETENTION.md). Preview/apply is explicit,
bounded and identity/approval-bound; preserve source dedupe, monotonically
increasing sequences, ownership/recovery facts and native backup compatibility.
No scheduler, audit pruning, live data, VM/provider/export or deployment.
Whole M4 and SUCCESS AC-04 remain pending.

## Contract-first review

Independent review rejected the initial payload-only replay commitment, insufficient
table lock mode, unclear memory/selection bounds and wide metadata index.
Final contract uses a separate identity digest, EXCLUSIVE NOWAIT, fixed bounded
selection, fixed-size PK FK plus metadata equality trigger, and versioned native
backup qualification. Original proposals/review history remain in the work journal.
Contract and SUCCESS scope are committed before production implementation.

## Acceptance and verification

EVT-01 approved bounded prefix/eligibility/atomic rollback; EVT-02 stable replay
identity and deterministic producer/reader concurrency; EVT-03 real synthetic
CLI/API/browser expiry recovery; EVT-04 migration compatibility, independently
verified pristine schema fingerprint and native backup/restore of pruned history.
Meaningful RED precedes GREEN. Keep all failed attempts and source bindings.
All new local build/test jobs use the shared launcher with unique IDs from this
source, disposable outputs in its task directories and immutable evidence retained.
Independent source/test review, relevant component/project gates and required CI
precede normal PR merge. The root owns task-board completion and issue disposition.

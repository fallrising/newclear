# Same-version fake cross-flow acceptance

Issue #379 retains the full M4 gate. This test-only slice joins already implemented
boundaries without inventing a product defect or replacing original acceptance.
Source baseline: PR649 merge ce5b5e6848884bf92ea0bca4c72f4acc877057f5.

## COMP-01

Use a test-only connector subclass to produce a supported text patch with correct
bytes/hash/base before the real worker persists its immutable result/archive.
Reach a real pre-effect release fault, then explicitly approve one stale attempt.
Assert capacity remains held until existing recovery independently confirms stop;
original uncertain intent/tombstone and result/archive facts remain unchanged.
Approve export through the real authenticated API with explicit fake target, run
the production export worker through a loopback fake GitHub HTTP server, lose the
reply after PR creation and reconcile read-only. Assert exactly one branch/PR and
no duplicate mutations, plus preserved verification status and artifact hash.

## COMP-02

Drain/quiesce that same DB and use actual pg_dump/pg_restore to an owned empty
DB. Compare durable tables, explicitly document session/identity/lease exclusions,
and verify restored result/archive/export/commands/retention metadata. Assert fresh
maintenance identity, drained capacity and private journal/fence preservation.
An otherwise still-valid old cleanup approval must fail identity before dispatch;
export reconciliation must not create another remote effect. No fixture setUp may
truncate/reset the DB midway. No edits to persisted immutable archives or invented
lifecycle/generation transitions; fixture lease expiry is explicitly synthetic.

## Checks and limitations

One new focused integration test with a hard bounded runner; reuse helpers, not
standalone test methods or entire suites. Root runs the test, preserves any genuine
failure before changing behavior, and obtains independent source/evidence review.
No product RED is claimed for a missing test/import. Formatting/lint/contracts/diff
and required changed-source CI remain normal delivery gates.

Real boundaries: PostgreSQL, worker, connector HTTP/private journals, API approval,
export HTTP transport, native DB tools. Synthetic: VM/model and GitHub service.
Browser/full fake E2E/live/provider/KVM/deployment and whole M4 stay unaccepted.
Audit90day expiry cannot be paired with successful one-hour-old approval replay;
no artificial audit timestamp rewrite is used to claim that impossible chronology.
No new retention feature or policy is part of this slice.

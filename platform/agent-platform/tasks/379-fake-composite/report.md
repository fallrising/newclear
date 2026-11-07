# Fake cross-flow acceptance — local snapshot 2026-10-26

Issue #379 / COMP01–02 only. Prior contract `6d52d0f2` committed before test authoring;
production baseline PR649 merge `ce5b5e6848884bf92ea0bca4c72f4acc877057f5` unchanged.
New test source SHA256 `f62babd7a292e6e34e2c37c560c6bd818996a44842db6b6baf203d1ce3902030`.
No product behavior fix or product RED is claimed for this acceptance addition.

The one uninterrupted scenario produces a valid text patch before real worker result
persistence, reaches pre-effect release failure, performs exact approved stale cleanup,
and independently recovers capacity. Original uncertain intent, tombstone, result and
archive remain. Authenticated API approval exports those exact bytes through synthetic
GitHub HTTP; reply loss after PR creation produces uncertain state, then explicit
reconcile performs only GETs. Exactly one branch/PR and four mutation requests occur.

That same quiescent/drained database is dumped/restored using native PostgreSQL tools.
All schema-contract durable tables compare exactly, including empty retention tables;
only the existing four ephemeral auth/token tables and maintenance identity are excluded.
Restored ephemeral tables are empty, identity is fresh, nodes drained. The otherwise
unexpired old cleanup approval refuses identity mismatch before dispatch. Completed
restored worker/export intents remain idle; private journal/fence hashes and external
mutation counts do not change. No fixture setup resets the DB between phases.

## Verification

From the component directory, through the shared disk-backed launcher and exact-source
private-path runner:

```sh
python scripts/test-postgres.py python -m unittest discover -s tests_platform -p test_m4_composite.py -v
```

T098-composite1: **1 test passed / 2.234s**, no skips/failures. It used the existing
Python3.13 development environment. Raw source-bound command/log retained with launcher
evidence; owned PostgreSQL removed, native-client and HTTP cleanup completed.
No old platform700/755 or unrelated browser/OC suite ran locally.

Author Ruff/format/AST/task/report checks passed. Initial review rejected direct SQL
scheduling of a succeeded export for post-restore reconcile: the public API refuses
that state. The initial candidate was preserved and corrected before runtime; this
was a test-review finding, not a runtime product failure. Prior PR649 expected RED,
author lint and older event/audit failures remain historical and unmodified.

Root T098-static1 passed Ruff/format177,43 project contracts,6 navigation indexes
and diff check. T097 independently accepted bounded COMP01/02 source/evidence
and documentation. Required changed-source CI and normal merge remain separate
delivery gates tracked in the PR and task board.

## Boundaries and remaining scope

Real: SQL, workers, connector HTTP/private journals, authenticated API, export HTTP
transport and native dump/restore. API routes/authentication use in-process TestClient,
not TCP; connector and fake GitHub use actual loopback HTTP. Synthetic: VM/model/GitHub upstream; lease expiry
uses the existing explicit fixture clock seam. No actual sandboxd/KVM/provider or
GitHub remote mutation is exercised. Native client transport uses an owned container.
This does not execute event/audit/archive GC: retention table preservation includes
empty tables and is not retention-operation integration acceptance.
Browser presentation/faults, complete same-version fake E2E, opt-in live smoke,
unknown host residue, deployment and whole AT09/12/13/M4 remain open. No release/tag.
The rejected90-day audit/one-hour approval-replay idea was never executed.

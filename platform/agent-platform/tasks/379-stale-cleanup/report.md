# Manual stale cleanup — local delivery snapshot

Recorded 2026-10-25 UTC. This is the bounded STALE01–03 slice of
[issue379](https://github.com/fallrising/newclear/issues/379), not complete
AT-13/M4, live VM qualification, a deployment or a usable release.

## Summary

A normal worker can persist a terminal result/archive and then lose its release
operation before the effect. Existing recovery correctly refuses to repeat that
uncertain operation. The new private CLI issues a bounded plan for one proven
terminal binding and requires its exact approval digest for one new release
attempt. A permanent journal intent precedes the request; replay only observes.
Existing recovery independently checks claim absence and all four host stop
proofs before releasing the retained reservation.

Contract baseline `1b47738b08738978d53f2c551c1f5fabbf9325ba` precedes the
actual missing-behavior RED and implementation. Independent design review first
requested an explicit legacy-journal enrollment rule; the accepted correction
atomically saves the initial identity and first plan without replacing existing
operations. Root draft inspection also required guarded maintenance grants so a
missing fence cannot be silently rebuilt. Existing worker/fence semantics,
migration018 and its independently derived backup pin remain unchanged.

## Verification

All local runtime jobs used the shared task workspace, source-bound PYTHONPATH,
fresh owned PostgreSQL and production HTTP connector with synthetic upstream
resources. No local full platform suite, unrelated browser suite or live VM ran.

| Job | Actual result |
| --- | --- |
| T094-stale-red1 | Expected RED:1 test/0.847s; normal result/archive and live original resource assertions passed before the missing cleanup module |
| T094-stale-green1 |28 tests passed/27.497s: ownership, enrollment, approval, lease/fence, replay, partial proofs, CLI/private HTTP, actual subprocess SIGKILL and recovery races |
| T094-stale-native1 |1 actual native pg_dump/pg_restore passed/2.134s; ten retained authority tables, new maintenance identity/drains, old approval refusal, unchanged private attempt/original intent |
| T094-inflight1 |2 real HTTP overlap cases passed/2.953s, both old/new handler winning orders produce one exact-target physical effect |
| T094-affected1 |12 selected existing tests passed/11.598s: recovery, cancellation, pause, approval, tool/model cleanup and prior event/audit CLI dispatch |

Executed runtime commands inside the source-bound shared-workspace wrapper:

```sh
python scripts/test-postgres.py python -m unittest discover -s tests_platform -p test_stale_cleanup.py -v
python scripts/test-postgres.py python -m unittest discover -s tests_platform -p test_stale_backup.py -v
python scripts/test-postgres.py python -m unittest discover -s tests_platform -p test_stale_inflight.py -v
```

The first command produced both the original RED and the later GREEN on their
respective preserved source versions. T094-affected1 executed the root evidence
selector `T094-affected.py` through the same PostgreSQL wrapper; its exact twelve
method names and raw output are retained with that job.

The original RED source/log and all source freezes are retained. Initial author
lint failures concerned test imports, loop capture and line length; corrected
static checks passed. No earlier event/audit regression failure is rewritten as
an initial pass. The synthetic upstream is not a sandboxd/KVM runtime test;
exact pinned sandboxd capability/pointer release semantics were separately
inspected at `5a800317f15554400c989d9de4c5ab5c1cacf7da`.

Independent implementation review found no production defect and requested the
promised old in-flight release HTTP overlap fixture. Both winning-order cases
then passed, with the nine previously frozen files unchanged. This proves the
synthetic HTTP race against the inspected pinned semantics; it is not execution
of upstream sandboxd or a live VM. Transaction rollback is covered by an injected audit exception after real SQL
updates, with SIGKILL after committed admission; there is no additional durable
boundary inside the uncommitted DB transaction.

T094-static1 passed Ruff/format for176 files,43 project contracts,6 navigation
indexes and diff checks. Required hosted CI remains a separate delivery gate.
Inspect this change's PR and the latest issue/task-board delivery entry for CI
and normal merge results; this report preserves the pre-CI local snapshot.

## Documentation

The [contract](../../docs/STALE-CLEANUP.md), SUCCESS and
[task board](../../docs/tasks/BOARD.md) preserve the broader issue scope. Prior
audit PR641 done rows are carried here as required by the repository protocol.
Private cleanup identities, attempts and tombstones are part of the separately
preserved connector journal, not the database backup bundle.

## Risks and Follow-ups

Unknown resources, active execution, missing authority, changed identity and
absent-claim host residue remain refused or held. A timeout/204/404 is not stop
proof. Remote release cannot be rolled back by a DB transaction. Complete
rollback of all private enrollment evidence is outside the existing trusted
operator/private-state preservation boundary; no external rollback anchor was
added. No SQL migration, dependency, scheduling, automatic collection, live
resource operation, deployment or release is included.

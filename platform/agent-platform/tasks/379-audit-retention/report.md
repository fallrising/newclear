# T-089 audit retention — local evidence snapshot, 2026-10-25

## Summary

Manual `audit-gc-preview` / `audit-gc-apply` implement the existing minimum90-day policy with bounded inspected rows/full canonical encodings, exact database-issued one-hour approval, atomic deletion and immutable minimal receipts/tombstones. Independent authorization, command/approval/recovery/model/tool/export state remains authoritative. This is a scoped [#379](https://github.com/fallrising/newclear/issues/379) AT-13 slice, not whole M4, deployment or usable-version acceptance.

The independently accepted contract baseline `11ac278fa4c4ad28cd9d69dd2a38ce2e2656ae19` preceded actual RED and implementation. This dated snapshot reports local evidence only. Hosted checks and final merge are recorded in the [audit branch PR](https://github.com/fallrising/newclear/pull/641), issue delivery comment and task board; no later CI outcome is inferred here.

## Verification

Root ran new checks from the audit component cwd through the shared workspace launcher and source-bound T091 wrappers, with the existing pinned dependency environment and fresh owned PostgreSQL18.6 fixtures. Task-backed private filesystem isolation preserved original file/backup guards. Native tests execute actual pg_dump/pg_restore via the existing owned-container transport seam. No live database or provider operation occurred.

| Evidence | Actual nested command or operation | Result |
| --- | --- | --- |
| T091-red1 | `python scripts/test-postgres.py python -m unittest discover -s tests_platform -p test_audit_retention.py -v` before implementation | Actual PostgreSQL/API/login/old-row fixture reached missing module;1 expected RED,0.399s |
| T091-schema1 | Independent pristine018 catalog measurement and parser/index/migration inspection | PostgreSQL18.6;37 tables,14 functions,19 triggers; pin approved before backup update |
| T091-audit-green1 | Same focused command after implementation | Original19 passed,6.993s |
| T091-audit-green2 | Same focused command after root added negative probes |21 passed/1 failed,9.164s; root test expectation corrected below |
| T091-audit-green3 | Same focused command with corrected boundary assertions |22 passed,0 skipped,9.157s |
| T091-audit-native1 | `python scripts/test-postgres.py python -m unittest discover -s tests_platform -p test_backup.py -k test_real_native_roundtrip_preserves -v` |3 passed,3.526s: audit evidence/control, archive/history, event replay identity |

The22 focused tests cover age-only writer families, strict cutoff/null/Unicode metadata, fixed inspected-row/no-refill and near-cap limits, exact issuance/hash/size/time, atomic rollback after receipt/tombstone/delete/new audit, SQL current/prior transaction/wrong ID/time, no UUID resurrection, strict malformed/missing receipt rejection, actual database-clock expired successful replay, both writer/GC orders and real private CLI. Full-row control snapshots are followed by actual auth/command/worker/approval/recovery/model/tool/export operations. Native audit restore compares all durable row JSON, verifies deleted raw rows stay absent and minimal evidence survives, rejects pre-restore approvals, then exercises fresh login/command replay.

The green2 failure is preserved, including its exact test source. That root test incorrectly required tombstone INSERT to compare an issued candidate's timestamp to the raw row. The contract checks tombstone versus candidate at INSERT and raw OLD versus candidate/tombstone at DELETE. Corrected probes separately require refusal of a mismatching tombstone and refusal of raw deletion using an exact but wrongly timed candidate/receipt/tombstone. No production code, migration, pin or guard changed for this correction. T090 independently corroborated this boundary and reviewed the new22 evidence; final acceptance is recorded in its root journal report.

All owned PostgreSQL fixtures were removed. Existing event-retention local644pass/4fail and targeted4pass remain historical; its export-lock cause remains unattributed despite later successful PR633 CI. No old700 local suite, unchanged OC long suite or unrelated browser suite was replayed for this audit change.

Source/test freeze SHA256:

```text
a3739dcdd8bc3ec018be1b8f0cdbb22df98b774ad1502853481f40ac8a4c6480  src/agent_platform/audit_retention.py
80c62cc93a1bcb64aab69c0319ab6cda65ee2aca4ccebf01dba42760d4e50f2e  src/agent_platform/migrations/018_audit_retention.sql
d39175c463fd7792669631f23289d60edc1057a09e0e6e4d7fb9858c3fff5996  src/agent_platform/cli.py
87f205bb6b345be3288c5adb69ced3fe893ae6f63c3ca265aeb3fc789b46cdd4  src/agent_platform/backup.py
70001653fdc72fe3a973bca3ae0b1de35b53bb6a197f000f4ebccb6a1c68b467  tests_platform/test_audit_retention.py
d3830a56943290ee73d962fba6c0e8363877bd77e033d2adfacf35d02123d3c6  tests_platform/test_backup.py
```

Raw immutable local log SHA256 (task IDs identify preserved evidence):

```text
e597cfa91959f182ad07302f01f2a935bf458ecd7cdedbe66c4764fe8109cf45  T091-red1/command.log
a36907d0d8051ff31673f51ff224c3fa3751d169f53f6d2d930fbaf9ebe6d16b  T091-schema1/command.log
8123047377afb26b251940a9571509d84f7895d8e77aaf0fe4234f99ff765b05  T091-audit-green1/command.log
e0118daffa8b5181503883ebcda2cb1ba91a2309acb3843a4d7e66a0989ce869  T091-audit-green2/command.log
9572b2fa0f6a19f72c0161305b41b26db0170402bc566d8e7fa04483115c5cb5  T091-audit-green3/command.log
04d6e55f426c9cb8991c58ffdfc9391f0d532f78ea9127eee113b2221e2ff1db  T091-audit-native1/command.log
```

## Documentation

[AUDIT-RETENTION](../../docs/AUDIT-RETENTION.md) supplies the approved policy, exact bounds/schema/locks and private CLI procedure. [BACKUP-RETENTION](../../docs/BACKUP-RETENTION.md) records018 exact-version compatibility and independent pin `456bad6ac3e99751dd9df8c1aa77afa6fdc30f7e164598e1b1151e41f4a55f9e`; restore older bundles with their matching application before explicit migration. Backup parser/quiescence/exclusions and private-path guards are unchanged. README/SUCCESS distinguish this dated local evidence from final hosted delivery. Prior T0087 done rows are carried in this implementation branch, without publishing its redundant standalone board candidate.

## Risks and Follow-ups

Permanent minimal evidence grows; expiry is not complete content erasure or guaranteed disk reclamation. Trusted local operator/database-owner access is not a new authenticated security boundary. Busy writers may produce a deliberate NOWAIT refusal. Full AT-13/M4, stale runtime cleanup, integrated fake/live acceptance and usable-tag readiness remain open. Final required CI/normal merge and post-merge board recording are delivery obligations, separately tracked; no release/deployment/VPS/ERU operation is included.

## Initial hosted CI and bounded fixture correction

[PR641 first Agent Platform run40195306232](https://github.com/fallrising/newclear/actions/runs/40195306232), candidate83c779d8, ran723 platform tests in284.748s:722 passed and one existing pause test failed because its `step` helper required the first `claim_control()` to return a claim. All22 audit tests passed. The other three required checks passed. This failed CI remains part of the record; the original lock owner/interleaving was not captured and is not retrospectively attributed.

Root added a deterministic real PostgreSQL row-lock probe. T091-pause-red1 reproduced the same helper `unexpectedly None` failure in1.142s: production `FOR UPDATE SKIP LOCKED` legitimately skipped the held job. The test helper now uses its existing bounded `wait_for` deadline to acquire the claim, retaining all observed-state/policy/capacity assertions. No production pause, recovery, audit, migration or backup code changed. This corrects a demonstrated fixture synchronization assumption; it does not establish the original CI's exact scheduler history.

T091-pause-green1 ran the affected `test_pause.py` selection:19 passed in16.096s, including the new row-lock probe and originally failing lease-expiry case; owned PostgreSQL removed. Unchanged audit22/native3 evidence remains separately bound to the six-file freeze above. Final required CI is evaluated at the subsequent PR head, not inferred from this local pass.

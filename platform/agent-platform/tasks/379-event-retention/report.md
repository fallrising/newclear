# T-087 manual event retention — local handoff

## Summary

Manual `event-gc-preview` / `event-gc-apply` now expire approved contiguous event prefixes for terminal, cleanup-proven runs. Default/minimum30days; bounded inspected runs/events/encoded bytes; exact database identity, one-hour approval, immutable issuance/receipt and all-or-nothing floor advance. Source replay identities survive payload deletion and native restore, preserving event IDs and sequence allocation. Ordinary readers use consistent snapshots; stale API/browser cursors recover through the existing410 path.

Baseline `6ea13ad2` contains the accepted pre-implementation contract. Phase A required independent corrections for identity-only hashes, EXCLUSIVE NOWAIT, full-encoding/inspection bounds and preserving unbounded event types without a new metadata index. Phase B implements that contract without new dependencies or lifecycle/adapter replay changes. This is a bounded AT-13 slice; complete M4/AC-04 remains unaccepted.

## Verification

Root executed runtime checks from this source through the common workspace launcher, using explicit isolated-src PYTHONPATH, existing exact pinned Python dependencies, a fresh owned PostgreSQL18.6 fixture and task-backed filesystem isolation for private plans/backups. Production private-file/backup guards were preserved. Commands below show the actual nested selections; launcher task IDs identify preserved raw receipts. No deployed database, VM, provider or remote export was used.

| Check | Actual command selection | Result | Receipt |
| --- | --- | --- | --- |
| RED | `python scripts/test-postgres.py python -m unittest discover -s tests_platform -p test_event_retention.py -v` | Expected missing event_retention import after actual DB/API setup;1 test | T084-retention-red1 |
| Focused GREEN | Same selection after implementation/test review | 24 passed,0 skipped,5.883s | T084-retention-private-green3 |
| Native backup/restore | `python scripts/test-postgres.py python -m unittest discover -s tests_platform -p test_backup.py -v` | 26 passed,13.522s; includes actual pruned-history native dump/empty-target restore | T084-retention-private-backup2 |
| Browser (from web cwd) | `python ../scripts/test-postgres.py node node_modules/@playwright/test/cli.js test e2e/event-retention.spec.ts --output <AGENT_BUILD_DIR>/playwright-results --reporter=line` | 1 passed,4.5s; realGC→410→snapshot/result/suffix | T084-retention-browser1 |
| Web preparation (from web cwd) | `node node_modules/typescript/bin/tsc --noEmit`, `node node_modules/vite/bin/vite.js build` | Passed before focused browser execution | T084-retention-browser1 |
| Scoped offline lint/format | `ruff check` / `ruff format --check` on affected Python; `prettier --check web/e2e/event-retention.spec.ts` | Passed; expanded test separately formatted/linted | T087-offline-final-lint / T087-offline-final-format / T087-ts-final-check / T087-expanded-lint2 |
| Catalog pin | Independent pristine migration017 PostgreSQL18 catalog measurement | Approved fingerprint,34tables/10functions/12triggers | T084-schema1 |
| Independent focused acceptance | T088 exact frozen source/tests and root runtime evidence review | ACCEPT EVT-01–04 focused evidence | T088 |
| Additional affected regression | Root selected648 platform cases; then reran only the4 failures | Initial644 passed/4 failed in227.787s; targeted4 passed in2.132s. This is not a clean full-suite run | T084-retention-regression1; T084-retention-failed4 |

The24 focused cases include exact current/prior-transaction receipt authority, expired approval, every metadata field mismatch, real gaps/recent rows/oversized metadata, near-cap multi-run apply/replay, retained dedupe, rollback after floor changes, both producer/GC lock orders, actual Store.events floor/payload interleaving and201-event SSE expiry after its first200 rows. All owned PostgreSQL fixtures were removed by the runners.

Earlier failures remain recorded: sandbox socket denial before tests; interrupted worker escalation (not owner refusal); an incorrect test-only module invocation; private-path rejection under unsafe host ancestors; namespace preflights with unmapped ownership or missing /dev/null. Root corrected execution isolation without changing host permissions or product guards. Those attempts are not GREEN evidence.

The additional648-case attempt had three tool-process recovery failures and one export terminated-lock/uncertain-state failure. Root's regression driver lacked a multiprocessing `__main__` guard, causing spawned children to reexecute the selection and contaminate the shared fixture; root corrected its own driver and preserved the original. The targeted4 then passed. The earlier export-lock failure remains intermittent and unattributed; do not assert the driver caused it. No product code/test guard was changed for these results. Required CI must establish the final full-suite outcome.

Production freeze SHA256:

```text
62ec86b1b41b2b2e9916b47ad3d7110ef71ca6dc2c0c3d95326cb77d723f7393  src/agent_platform/event_retention.py
4be09dbecae4bca52406bae66e07627a80b5328711b45e942946fdb31023fe7d  src/agent_platform/migrations/017_event_retention.sql
d5e32335560d1101b32a87a5729d6e158d73ff83c980fc5c0ce72e2d99629118  src/agent_platform/store.py
cd16f41bfae145b864add30eef31fc17fc4cf145e6ea7956bdec74f1fa0978bc  src/agent_platform/cli.py
80f53f0a31b09a358aac6f9fbf86f3c9648b8000d355598cd8054151695157e0  src/agent_platform/backup.py
fea9a02b62035872d126eaea0607c2536145e4b3b33f3b1793dbeab2178821f6  tests_platform/test_event_retention.py
```

Raw log SHA256 (private launcher evidence, not copied into product data):

```text
3fb7a724d0fd909a8ab8dbb2f8d554bace7c8839d06711adac5f155f6666dd17  T084-retention-red1/command.log
c8c94bc35d776c1cff9b0d35bae324d48068f28f2de86d221550ca154a9d4fd3  T084-retention-private-green3/command.log
e64c63694a436d10a013137f207939227856c76b992463d7e000ebd1a4235fb4  T084-retention-private-backup2/command.log
209b73809788ca9a674305d2b002c51e1269441312fc6bebaa48f5ba0aa70d21  T084-retention-browser1/browser.log
```

## Documentation

[EVENT-RETENTION](../../docs/EVENT-RETENTION.md) contains the approved API/schema/locking/bounds contract and operator procedure. [BACKUP-RETENTION](../../docs/BACKUP-RETENTION.md) records migration017 compatibility: old bundles require matching old application before explicit upgrade; current exact-version restore refuses old manifests. No parser/guard weakening occurred. The independently approved current catalog fingerprint is `3d12b867a4c5bc553afc2f77b4fd01ddf1159483999499b63176abec03d6ba0b`.

## Risks and Follow-ups

T088 accepted the focused EVT-01–04 evidence and candidate progression through normal mandatory CI, not a clean aggregate regression or hosted CI result. Initial648-case regression644pass/4fail plus targeted4pass remains the exact local record; required hosted CI and root's final delivery gates are pending. Permanent identity/maintenance records intentionally grow; manually deleted pre-migration identities cannot be reconstructed. NOWAIT may refuse during writers and requires deliberate operator retry. GC does not erase other content copies or immediately shrink PostgreSQL files. Audit retention, stale runtime cleanup, live deployment/restore, complete same-version M4 and AC-04 remain open. No commit, publication or usable-version claim is made by this report.

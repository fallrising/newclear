STATUS: DONE

## Summary

Fixed the migration019 backup contract mismatch in the integrated root tree. Only
`platform/agent-platform/src/agent_platform/backup.py` changed: the independently
measured fixed schema hash and its provenance comment. No validator, migration,
restore/source guard, manifest format, dependency or test was weakened or changed.

The original full native run retained783tests/13failures/16errors, all identified
failures were reached through the stale018 catalog pin. This follow-up is27targeted
GREEN, not a claim that the full783suite was rerun clean.

## Verification

- T0447-schema1: fresh task-owned pinned PostgreSQL18.6; apply001..018, snapshot
  physical catalog, require exact old pin; apply019, compare complete catalog sections
  and require only the two intended constraint changes; old validator rejects019 — passed
- Native27targeted cases below,33.093s,0failures/0errors; includes actual pg_dump/restore,
  source/target/drift guards, stale cleanup backup, M4 composition and single-node
  process restart; owned PostgreSQL container removed — passed
- Scoped native Ruff check/format and `git diff --check` for backup.py — passed

The pristine measurement used the existing five read-only catalog SELECT contracts
extracted from `_schema` via Python AST, independently of its expected constant.
For each migration, the fixture executed its SQL and recorded the source SHA in
schema_migrations. It compared all columns/functions/triggers/indexes unchanged and
required exactly the following two changed constraint keys before accepting a new pin.
No fingerprint from the running product database or a modified test schema was trusted.

Exact measured values:

- PostgreSQL18.6, same image digest as native `scripts/test-postgres.py`.
- Migrations001..018 catalog SHA256:
  `456bad6ac3e99751dd9df8c1aa77afa6fdc30f7e164598e1b1151e41f4a55f9e`.
- Migrations001..019 catalog SHA256:
  `ab9eb85db71bf7f24b175e61196822dcd02b9a26203902d88245ac28e207ace7`.
- Migration019_subscription_workspace.sql SHA256:
  `6f91e395ef9b7afa373247730aec9f16280d72098d146bd81a13cd35ef5a7499`.
- `agent_profile_revisions.supported_profile`: existing fake/OpenHands branches
  unchanged; adds only backend=claude-subscription, exact
  model_ref=claude-subscription:claude-opus-5-5 and the same immutable template pattern.
- `runs.runs_backend_check`: accepted backend set changes from fake/openhands to
  fake/openhands/claude-subscription. No other constraint changed.
- Columns, function bodies/security settings, trigger definitions/enabled state and
  index definitions were byte-equivalent as canonical JSON before/after019.
- Final backup.py SHA256:
  `0e29f21d5c6eb6e27bcdfdc79d49b4d9e609246582df3d3a75d2240a24eb3f38`.

Run from `platform/agent-platform`, with root-prepared native system Python venv
selected as `PYTHON` and `PYTHONPATH=src:tests_platform`:

```sh
$PYTHON scripts/test-postgres.py $PYTHON -m unittest \
  test_backup.BackupTests.test_active_source_and_undrained_nodes_rejected_without_mutation \
  test_backup.BackupTests.test_confirmed_binding_requires_a_released_reservation_record \
  test_backup.BackupTests.test_finalization_failure_leaves_no_maintenance_identity \
  test_backup.BackupTests.test_manifest_version_migration_major_and_corruption_fail_before_restore \
  test_backup.BackupTests.test_mismatched_or_real_unconfirmed_binding_refused \
  test_backup.BackupTests.test_native_errors_are_sanitized_and_dump_failure_has_no_manifest \
  test_backup.BackupTests.test_native_major_mismatch_refuses_before_dump \
  test_backup.BackupTests.test_native_restore_transaction_failure_leaves_target_empty \
  test_backup.BackupTests.test_never_allocated_proof_and_missing_reservation_fail_closed \
  test_backup.BackupTests.test_offline_acknowledgement_and_exact_target_name_required \
  test_backup.BackupTests.test_other_non_table_objects_reject_dedicated_schema_and_empty_target \
  test_backup.BackupTests.test_pending_exports_and_requested_reconciliation_block_backup \
  test_backup.BackupTests.test_physical_constraint_default_and_trigger_drift_rejected \
  test_backup.BackupTests.test_populated_target_and_source_are_never_overwritten \
  test_backup.BackupTests.test_real_native_roundtrip_preserves_archive_and_all_history \
  test_backup.BackupTests.test_real_native_roundtrip_preserves_expired_audit_evidence_and_control \
  test_backup.BackupTests.test_real_native_roundtrip_preserves_pruned_event_replay_identity \
  test_backup.BackupTests.test_schema_and_migration_drift_rejected \
  test_backup.BackupTests.test_snapshot_share_locks_block_writer_until_dump_completed \
  test_backup.BackupTests.test_standalone_type_rejects_populated_target \
  test_backup.BackupTests.test_temp_namespace_lookalike_rejects_source_and_target \
  test_backup.BackupTests.test_toast_namespace_lookalike_rejects_source_and_target \
  test_backup.BackupTests.test_tombstone_and_gc_history_roundtrip_invalidates_original_plan \
  test_backup.BackupTests.test_unknown_cleanup_and_unfinished_export_rejected \
  test_m4_composite.CompositeTests.test_stale_recovery_export_disconnect_and_native_restore \
  test_single_node_deployment.SingleNodeDeploymentTests.test_real_process_restart_and_native_restore \
  test_stale_backup.StaleNativeTests.test_native_roundtrip_keeps_private_attempt_and_invalidates_old_approval -v
```

Preserved failed attempts: root's original full failure is in workspace-local
`.local/fanz-executor-20261031/ap-native-checks.log`. One follow-up editing command
used repository-relative path while cwd was the component, so it failed before
editing and its subsequent selected suite still imported018, reproducing13failures/
16errors. Corrected to an absolute assigned path; final invocation explicitly asserted
that the019 constant was loaded before starting the native harness. Both owned test
containers were removed by the existing ownership-checked harness. No extra mutation
or provider call occurred. Do not label that setup-error run as a new product defect.

## Documentation

The backup.py comment now references T0447-schema1; this report records its exact
catalog derivation and the relevant targeted verification. Existing negative and
roundtrip tests already cover the changed pin's risk; no implementation-mirroring
unit test was added. Root owns broader task/acceptance/handoff updates.

## Risks and Follow-ups

Independent review and final integrated delivery remain root-owned. Backup still
requires exact current migrations, exact schema fingerprint, private native bundle,
clean/offline source and empty target; it does not silently accept older manifests.
This change does not establish Fanzloud M3 persistence or whole-platform acceptance.
No live task, remote host, provider, release, commit or push was executed by this worker.

# T-442 R2 backup worker report

Status: PARTIAL

## Summary

Fixed the exact reviewer R2 admission mismatch in `backup.py`; only this file,
`tests_platform/test_backup.py`, and this report changed during this follow-up.
Earlier routing changes were preserved. The parent-supplied independently measured
migration020 fingerprint remains `20727fd56d86c4c253e6c3797f469965df0364f737c6f2fe93a482126bece1fd`.

The prior generation0 never-allocated path stays valid. Generation1 is admitted only
with a completed, run-bound cancellation command/result, matching action route and
state version, exact cancelled/not-allocated result and reason, ordered non-null
cancellation timestamps, matching done job, no attempts/lease/adapter operations or
bindings, and no backend cursor/reference/result/control state. Missing nullable
proof is tested inside EXISTS so SQL NULL cannot bypass rejection.

Confirmed cocoon-local bindings now include Claude and Codex subscriptions while
retaining original generation, stopped state, provider-handle, cleanup and released
reservation requirements. Unknown cleanup remains forbidden.

Native roundtrip tests cover both backends in queued-cancelled and confirmed-terminal
histories. The confirmed fixture uses actual Worker/DB/lease/archive/cleanup code with
explicit mocked connector/driver responses; native backup/restore remains the existing
real PostgreSQL fixture. Two SQL guard tests mutate21 queued-proof fields and9 confirmed
proof fields for each backend, rolling every mutation back. Existing generation0 and
missing-reservation tests remain unchanged.

## Verification

Pinned executable prefix:
`/home/ckc/test/codex/.local/fanz-executor-20261031/native-venv/bin/`.
Commands ran in the routing worker worktree.

- Reviewer R2 supplied `backup-green.log`, as described in the read review report — failed:28 tests/one error, queued cancellation refused `backup_source_active`. Existing supplied RED establishes the defect; worker did not independently launch a DB or repeat it.
- `ruff check platform/agent-platform/src/agent_platform/backup.py platform/agent-platform/tests_platform/test_backup.py` using pinned executable — passed. Initial new-test long SQL lines and loop-lambda binding finding fixed; final output `All checks passed!`.
- `ruff format --check platform/agent-platform/src/agent_platform/backup.py platform/agent-platform/tests_platform/test_backup.py` — passed (`2 files already formatted`).
- `python -m compileall -q platform/agent-platform/src/agent_platform/backup.py platform/agent-platform/tests_platform/test_backup.py` using pinned executable — passed.
- `PYTHONPATH=platform/agent-platform/src:platform/agent-platform/tests_platform /home/ckc/test/codex/.local/fanz-executor-20261031/native-venv/bin/python -m unittest test_backup.NativeRunnerTests test_backup.BackupTests.test_real_native_roundtrip_preserves_subscription_profiles_and_cancelled_runs test_backup.BackupTests.test_real_native_roundtrip_preserves_confirmed_subscription_histories test_backup.BackupTests.test_queued_subscription_cancellation_requires_exact_never_admitted_proof test_backup.BackupTests.test_confirmed_subscription_history_requires_matching_cleanup_proof -q` — passed for2 offline tests;6 selected,4 skipped (no TEST_DATABASE_URL),0.003s. Existing FastAPI/httpx deprecation warning unchanged.
- `git diff --check` — passed.
- Four selected PostgreSQL scenarios and existing backup regressions — skipped in worker, explicitly delegated to parent integration. No local DB/Docker/runtime/provider launch.

## Documentation impact

Code comment explains the durable queued-cancellation generation1 exception. Parent
owns R2 review closure, M2 evidence/spec updates and final acceptance; no parent tree
or other documentation was edited. No schema or fingerprint contract weakened.

## Risks and follow-ups

Evidence gate: PARTIAL until parent supplies successful real PostgreSQL/native
roundtrips and negative guard results. SQL predicates and fixture behavior were
reviewed but compileall/offline runner tests do not establish PostgreSQL correctness.
This is synthetic runtime integration, not live provider or VM qualification.
No commit/Git mutation, dependency change, delegation or external service mutation.

## Tool accounting

This follow-up: nested agents0; DB/Docker/VM/provider execution requests0. Actual
provider request/token/cost and full outer/nested totals/timings unknown/null; no
instrumented counter was available. No totals inferred from task budget.

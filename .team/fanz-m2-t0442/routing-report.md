# T-442 AP routing worker report

Status: PARTIAL

## Summary

Implemented bounded `codex-subscription:gpt-6.1-sol` admission and additive migration020.
Both subscription backends have the same verified-command, <=600s, no approval/mock,
no usage/no durable resume capabilities and external-workspace projection. Runtime
allocation suppresses model proxy for either subscription. Existing Claude injection
remains positional/backward-compatible; `codex_subscription=None` is additive.
`Worker.subscription_for(backend)` returns only the explicitly matched driver, and
new claim admission requires that driver plus connector. Recovery/cancellation cover
both routes, and recovery cannot invoke either CLI again. CLI independently injects
`SUBSCRIPTION_CONFIG` and `CODEX_SUBSCRIPTION_CONFIG`.

Changed production paths under `platform/agent-platform/src/agent_platform/`:
`domain.py`, `store.py`, `worker.py`, `runtime_worker.py`, `runtime_client.py`,
`recovery.py`, `cancellation.py`, `cli.py`, `migrations/020_codex_subscription.sql`.
Changed tests under `platform/agent-platform/tests_platform/`:
`test_subscription_routing.py` (new), `test_subscription.py`,
`test_subscription_lifecycle.py`, `test_backup.py`.

`backup.py` remains unchanged deliberately: its exact PostgreSQL18 schema fingerprint
must be independently rederived after migration020. Parent was notified and owns that
measurement/integration; do not ship with the old019 fingerprint.

## Verification

All commands ran in the worker worktree. Let `V` denote the existing pinned executable
prefix `/home/ckc/test/codex/.local/fanz-executor-20261031/native-venv/bin/`.
No dependencies, Docker, VM, or provider invocation was started.

- `PYTHONPATH=platform/agent-platform/src:platform/agent-platform/tests_platform ${V}python -m unittest test_subscription_routing -q` before production edits — failed (expected RED): Codex literal rejected, missing constructor/matching method, wrong lifecycle path; initial test URL also correctly hit existing cleartext guard. The test URL was corrected to HTTPS without weakening the guard.
- Same focused command after implementation — passed:6 tests.
- `PYTHONPATH=platform/agent-platform/src:platform/agent-platform/tests_platform ${V}python -m unittest test_subscription_routing test_subscription test_subscription_lifecycle test_subscription_driver test_subscription_mcp test_backup.NativeRunnerTests test_backup.BackupTests.test_real_native_roundtrip_preserves_subscription_profiles_and_cancelled_runs -q` — passed for16 offline tests;27 total,11 skipped,2.581s. Seven new offline routing/CLI tests plus existing driver/MCP/native-runner tests. Existing FastAPI httpx deprecation warning retained; dependencies unchanged.
- Same command's11 real PostgreSQL cases — skipped: no `TEST_DATABASE_URL`; parent must run both admission classes, both lifecycle classes and the added native backup roundtrip against its isolated DB. These exercise actual jobs/leases, wrong-driver exclusion, uncertain/deadline no relaunch, cancellation without configured driver and preservation of both profile/model/run identities.
- `${V}ruff check platform/agent-platform/src/agent_platform/{domain,store,worker,runtime_worker,runtime_client,recovery,cancellation,cli}.py platform/agent-platform/tests_platform/{test_subscription_routing,test_subscription,test_subscription_lifecycle,test_backup}.py` — passed. Initial new-test import ordering/line lengths were fixed with Ruff; final output `All checks passed!`.
- `${V}ruff format --check` with the same12 paths — passed (`12 files already formatted`).
- `git diff --check` — passed.
- Independent PostgreSQL18 migration020 schema fingerprint and exact backup guard/restore verification — skipped in worker; parent integration required. No invented fingerprint or weakened guard.

## Documentation impact

Read parent `SPEC-M2-two-vendors.md`, AP instructions/SUCCESS/external-workspace contract
before edits. Parent owns all specs, boards and milestone evidence; no out-of-scope docs
changed. The task-worker/evidence-gate skill's linked shared report-contract document
was absent at its resolved path; this report uses the explicit status/headings and
verification requirements in the available skills and assigned task.

## Risks and follow-ups

Evidence gate: PARTIAL due to required DB/backup skips. No full M2, FN02/FN03, live
provider, VM isolation or production-ready claim. Parent must integrate its actual
`subscription_codex.py`, derive/update backup fingerprint, run DB regressions and full
appropriate repository checks, and review before normal delivery. CLI injection test
uses in-memory module doubles and proves wiring only. Native backup test has real API
profile creation/queued cancellation, but does not represent subscription coding.

Unknown usage stays unknown; no resume/retry authority, runtime dependency, permission,
connector/guest code, commit, push or external mutation was added. No nested worker.

## Tool accounting

Scope: this worker turn and own worktree only. Nested agents0; external coding CLI0;
provider/VM requests0 by task execution. Actual model-provider requests/tokens/cost,
outer orchestration totals and elapsed execution/wait timing are unknown/null (no
instrumented counter); do not infer provider counts from shell/tool invocations.

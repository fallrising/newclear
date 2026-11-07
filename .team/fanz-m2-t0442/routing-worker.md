ROLE: WORKER
AGENT: native inherited
ID: T-442
Goal: Add bounded codex-subscription admission and matching AP driver routing for T-0442 M2.
Why: Same AP lifecycle must accept a second real vendor without selecting a wrong driver or changing VM authority.
Inputs to read first: /home/ckc/test/codex/wt/newclear/fanz-m2-20261101/platform/fanzloud/docs/specs/SPEC-M2-two-vendors.md; AP AGENTS, docs/EXTERNAL-WORKSPACE.md; domain/store/worker/runtime_worker/runtime_client/recovery/cancellation/backup/cli and tests_subscription*. Driver parent will implement agent_platform.subscription_codex.CodexSubscription(config_path), execute(worker,claim,run,lost).
Scope (may touch): Only own worktree /home/ckc/test/codex/wt/newclear/fanz-m2-routing-20261101, AP src domain.py/store.py/worker.py/runtime_worker.py/runtime_client.py/recovery.py/cancellation.py/backup.py/cli.py and new migration020; AP tests_platform matching backend/lifecycle/backup tests; report .team/fanz-m2-t0442/routing-report.md. Read parent spec but do not modify parent worktree.
Out of scope (must not touch): subscription_claude.py/subscription_codex.py/subscription_mcp.py, connector/guest, Fanzloud, docs/SUCCESS/boards, unrelated files, auth/runtime/VM/provider calls, dependency installation, git commit/push/PR, recursive delegation.
Definition of done:
- [ ] backend codex-subscription model_ref codex-subscription:gpt-6.1-sol added, all bounded verification/deadline/approval/mock restrictions inherited; additive migration exact backup contract maintained.
- [ ] Worker(...,subscription=existing_claude,codex_subscription=new_codex) backward-compatible; explicit subscription_for(backend) method returns matching driver only. Cannot claim unconfigured route; existing Claude/mock/OpenHands unaffected.
- [ ] All lifecycle/recovery/cancellation paths treat both subscriptions as cocoon-external with zero uncertain relaunch. CLI CODEX_SUBSCRIPTION_CONFIG injects CodexSubscription, existing SUBSCRIPTION_CONFIG unchanged.
- [ ] Focused RED/GREEN or precise tests; no false live claims, report changed paths and tests/outstanding checks.
Verify with: Existing pinned .local/fanz-executor-20261031/native-venv available for imports (set PYTHONPATH to own src/tests_platform). Focused offline tests and ruff on changed paths. DB fixtures if unavailable report skipped for orchestrator's real PostgreSQL integration; don't start Docker independently. Parent will supply driver module during integration.
Budget:25min active, at most2 justified fix attempts for same problem; report early contract conflicts, no subagents. Provider requests/tokens/cost unknown; no external coding CLI execution.

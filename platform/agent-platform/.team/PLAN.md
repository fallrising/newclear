# Single-operator mock acceptance

Objective: finish the locally testable model request/budget failure semantics for a single operator. Actual provider billing and hard money guarantees are deferred; unknown cost must remain explicit. No KVM, paid API, merge, deployment or M4 work.

Baseline: latest main 4a75ad4.

Tasks:
- T-001: bounded worker audit of mock/fixture admission, unknown accounting, token rotation and process restart; add meaningful regressions and the smallest necessary fixes, with red/green evidence.
- T-002: independent read-only review of T-001 and the final public documentation/evidence.
- Orchestrator: test environment, repository checks, milestone limitations, sanitized evidence, handoff and acceptance decision.

Scopes: component src, tests_platform, docs/HANDOFF.md, docs/M3-SINGLE-OPERATOR.md, docs/evidence/m3-single-operator-2026-10-03.json and this .team directory. README, SDD and Agent Computer documentation are outside this delivery.

Verification: make platform-check; git diff --check; team task/report validators. Do not treat SQL runtime records or local mocks as fresh VM or provider evidence.

Acceptance: T-001 accepted after actual diff review and four targeted PostgreSQL/HTTP tests passed. T-002 independent read-only review found no blocking issues. Final make platform-check passed Ruff lint/format, 45 unit tests and 214 PostgreSQL/HTTP tests without skips. The initial host-tool/cache/format failures were remediated and are preserved in evidence.

Evidence gate: only the single-operator mock slice is accepted. Real provider billing/hard money limits are deferred; fresh KVM, complete AT-07 artifact/integration and wider AT-11 integration are not established. M3 remains In progress and M4 Not started. No runtime source, dependency, migration, README, SDD or Agent Computer edits.

Documentation and task/report contracts: orchestrator validated both tasks/reports, checked new public artifacts for private context, validated local links and git diff --check. Independent follow-up confirmed all evidence source hashes and boundaries. Accepted single-operator mock slice after codex-evidence-gate audit; full milestone completion is not claimed. Commit/push and Draft PR only; no merge/release/deploy.


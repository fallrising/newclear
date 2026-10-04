# Safe result diff delivery

Objective: make persisted run diffs safely downloadable by the authenticated operator and verify untrusted result/event content remains inert in the workbench. This is a bounded result transport slice, not artifact storage, remote Git export or full M3 completion. Billing remains deferred.

Orchestrator owns this plan, integration, independent review and acceptance.

Tasks:
- T-003: backend worker in isolated worktree; red-green pure validation plus authenticated HTTP download.
- Orchestrator: download UI, UI tests, real browser fixture/security case, documentation, sanitized evidence and checks.
- T-004: independent read-only final review.

Contract: GET /api/v1/runs/{run_id}/result.diff; authenticated read; retrieve only that run's persisted diff; UTF-8 bytes at most 256 KiB, exact diff_bytes and lowercase SHA-256, matching run base SHA. Missing diff returns 404; corrupted data returns 409. Valid empty diff is downloadable. No mutation or interpretation of patch text. Content-Disposition attachment with server-generated run UUID filename; text/plain UTF-8, nosniff/no-store and restrictive download CSP.

Frontend: operator invokes a download button; fetch same-origin session credentials; verify response success before creating blob/download; show errors. Offer only when diff metadata is present and structurally valid, without requiring verification passed (failed/unknown results remain inspectable). No HTML renderer/preview.

Verification: make platform-check; make web-check; relevant browser suite using real PostgreSQL/API and fake runtime records; git diff --check and team contracts. No live VM/provider operations.

Acceptance: backend T-003 accepted after inspected diff and root targeted7passed; full platform45unit+260SQL/HTTP, frontend37 and browser2passed. Independent T-004 final review accepted after source/evidence inspection; no required findings. Scope is only this M3 slice.

Frontend scope includes web/src/api.ts to declare the persisted diff byte count and base commit fields already returned by the API.

Rebased cleanly onto current main 10d5729 (mock tool broker); all required checks rerun. Platform: 45 unit and 260 SQL/HTTP; frontend37, browser2; no skips. Backend worker scope inspected; no code conflicts with latest main.

Evidence gate: all defined checks map to code tests, final logs and sanitized evidence; tasks/reports valid, scope bounded. Slice accepted for Draft PR review.

# Task search and filters

Next bounded feature: literal substring search across task title and latest run goal; optional project UUID and latest-run state, composable with existing keyset pagination. No writes or new schema/dependency. q trimmed with max200 raw characters; empty is no search; %/_/backslash are literal. State allowlist from existing schema. Query params q, project_id, state. API authenticated and parameterized SQL.

Filtered cursors bind canonical q/project/state. Mismatched filters produce422 invalid_cursor; preserve existing unfiltered list cursor behavior. T-005 isolated backend worker owns API/store/new task_query and SQL tests. Root owns UI/browser/docs. T-006 independent review, root acceptance after actual checks.

UI explicit search submit (no keystroke queries), project/state select, clear filters; apply any filter resets pages. Retain selected task independently of list filter; no task rerun. Empty filtered state says no matches and offers clear. Query cache keys include full filter+cursor; responses cannot replace newer queries.

Acceptance gates: platform-check/web-check/browser-test, diff/contracts, independent review. Root budget110, worker35/review20. No VM/provider/export/billing work.

Task search gates: root platform45unit/273SQLHTTP, frontend40/build, browser3; backend worker13targeted/ruff/diff inspected and accepted. Independent T-006 DONE accepted, no required findings, sevenloghashes verified; scope unchanged. Source base82cd9d8 verified against current main.

Task-search evidence gate accepted: every required item maps to tests, actual final commandlogs and review; definedscope/authorization preserved. Deliver Draft PR, no merge/deployment.

# Persistent task filter links

Continue task history with URL q/project_id/state (no cursor). On initial load/remount and popstate read validated normalized filters; restore search field and reset page cursors. Existing task #hash remains independent and must survive updates. New tab/reload loads the same filter+selected task.

Explicit submit/select/clear writes a browser history entry when filters change; typing and reapplying identical normalized filters do not add entries. Preserve unknown query parameters and hash; clear removes only owned filter keys. Back/Forward synchronizes UI/API without commands. Unknown cursor parameter must not affect paging (only q/project/state owned).

URL input is untrusted: q <=200 Unicode code points before trim, no NUL; canonical UUID project (normalize case), existing state allowlist; duplicate owned params invalid. Any invalid filter falls back to recent tasks with a visible recoverable notice, no invalid filter sent to API. A valid project absent from loaded names gets an explicit selected fallback option, not “all projects.”

T-007 isolated worker owns App.tsx/App.test.tsx/new taskLocation.ts and tests/report. Root owns browser tests/docs/evidence/acceptance. T-008 independent read-only review. No backend/dependency changes; required web-check/browser-test/diff/contracts. Parent PR211 headc9cf96a already all CIpassed, new PR stacked on its branch; no merge.

Persistent links integration: T-007 frontend diff inspected and integrated within declared scope. Root web-check57tests/build and complete browser-test6cases passed; browser cases cover real history/new-tab/reload, invalid recovery, unavailable projects, parent search pagination and prior security/reconnect behavior. T-008 independent review DONE accepted; no required findings, all six evidence hashes independently verified. Backend unchanged.

Persistent-links evidence gate accepted: URL/helper/UI/browser tests map to all defined behaviors; root web/browser suites and diff/contracts passed, independent review accepted. Parent PR211 exact headc9cf96a reconfirmed with all CI green. Deliver this bounded slice as a stacked Draft PR; no merge or deployment.

# Editable retry goals

Next bounded workbench feature: keep one-click retry and add an explicit editor prefilled from the latest terminal attempt. Operator may change only goal, then submit a new attempt using latest base SHA/profile revision/state version. Cancel does not mutate; old attempt goal/result remain immutable. Display the selected attempt goal as inert multiline text in its activity panel.

Validate non-whitespace goal and <=20000 Unicode code points without trimming the submitted content. Preserve draft during polling of the same attempt. When latest attempt identity changes, reset the editor; pending requests disable competing actions and edits. Preserve PendingCommand idempotency and error recovery; selecting history never changes a previous run. New active latest attempts remove retry controls.

T-009 isolated frontend worker owns App.tsx/App.test.tsx/style.css/report. Root owns browser fixture/case, documentation/evidence and acceptance. T-010 independent reviewer. Required root web-check/browser-test, diff/contracts, independent review and PR CI. Backend APIs/dependencies unchanged; local backend suite need not rerun. Base mainc4b1ad6 includes merged PR211/216. Root budget100calls, worker45/review20. No merge/deploy/live provider.

Editable retry integration: T-009 frontend/test/style diff inspected and copied within scope. Root web-check68tests/build, browser-test7cases and fixture Ruff lint/format/diff passed. New browser case verifies raw request metadata, one submission, original run equality, historical goal/result and persisted new goal. Intermediate React key collision and test typing failures were resolved and retained as evidence. T-010 independent review DONE accepted with no required corrections; all nine log hashes verified.

Editable-retry evidence gate accepted: each defined behavior maps to UI or real browser coverage, worker scope inspected, root required checks passed, intermediate issues resolved and independent review accepted. Parent main c4b1ad6 reconfirmed. Deliver a new Draft PR; no merge/deploy.

Precommit base update: main advanced to532e587 in an unrelated component. Fast-forwarded cleanly, and git diff --quiet confirmed agent-platform is identical to tested basec4b1ad6. Product verification remains applicable without rerunning unchanged suites.

# Normal Worker mock tool integration

Objective and contract: docs/WORKER-TOOLS.md. Source base48a303bf; no edits to concurrent process-recovery source scope. New immutable OpenHands profile opt-in plus trusted private mock-only configuration; per-run allocation flag; Worker owns provisioning/session lifecycle and conservative failure/cleanup. No automatic grant rebind/replay. Default disabled, no dependency/schema/UI changes.

T-011 isolated implementation worker owns domain.py/store.py/worker.py/runtime_worker.py/runtime_client.py/new tool_worker.py and new tests_platform/test_worker_tools.py/worker_tools_fixture.py; meaningful red-green and focused SQL/HTTP checks. Root owns docs, evidence, integration and full platform-check. T-012 separate independent read-only review. Workers do not delegate or commit; root alone accepts and publishes a Draft PR. Root budget160, implementation70, review30. No merge/deployment or KVM-host mutation; test evidence explicitly mock-only.

Normal Worker integration checkpoint: inspected and integrated T-011's six production/two test files; exact source SHA256 manifest recorded. Root meaningful red5 reproduced missing profile field. Final worker18 focused passed. Root pinned Python3.12.15 platform-check passed45unit/360SQL-HTTP with all126files formatted; initial host diagnostic compiler errors and fixture collision remain historical and resolved. Main advanced to61dbc06c with six process-recovery regressions and no production source changes; fast-forward preserved all eight manifest hashes, all six added tests passed, and final Ruff129/diff passed. No actual KVM or new provider activation is claimed. Independent T-012 review and PR CI remain final gates.

Evidence gate: ACCEPT T-011 implementation and T-012 independent review for this bounded mock integration. Reviewer found no required corrections and independently checked all eight source/seven log hashes. Every defined item maps to profile/config/normal-worker/fault tests, actual root full checks plus newly merged regression checks, and documented limits. Team contracts/diff passed. Publish a Draft PR and require its exact-head CI before final delivery; no merge or deployment.

Prepublication main advanced to e0d31720 in unrelated components; agent-platform diff from61dbc06c is empty. Fast-forwarded while preserving exact verified implementation hashes. Existing verification remains applicable.


## Historical single-operator mock acceptance (2026-10-03, PR206)

The following plan records the original mock-only slice. Later plans above remain authoritative for their own scopes.

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


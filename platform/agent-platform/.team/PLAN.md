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

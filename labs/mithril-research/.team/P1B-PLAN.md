# Mithril P1b develop-only tools — T-0310

Root owns PLAN, routing, integration and acceptance. Previous accepted source snapshot is [P1A-PLAN](P1A-PLAN.md). Claim was published and remotely read back before source modification. Source base: 873eb7e9 (full identity in protected evidence). Research stays 9959fe2e5cd466614dc20ef7b710befaaf1d746a.

## Objective and bounded scope

Complete one source-deliverable P1 tools segment: four-host Compose/auth bundle generation; a thin, one-shot SSH transport with fixed operations and fail-closed identity/observation handling; exact plan/ownership-bound cleanup planning and guarded down. Destructive purge is a reviewable interface with independent approval conditions, not an automatically enabled deletion capability. No remote invocation, service start, VPS mutation, actual purge, image publication or deployment occurs during this delivery. Cluster initialization/orchestration and runtime acceptance remain later P1/P2 work if not covered by these tools.

The reviewed design must make exact supported operations and remaining gaps explicit before implementation. Avoid a generic arbitrary-command SSH API or a control plane. Local-fixture remains a separate unchanged evidence lane. Every remote/mock result must identify its origin and cannot upgrade synthetic observations to live evidence. Plan digest is integrity/binding only, never approval.

## Team and budget

Scenario: standard-delivery with disjoint specialists if design supports it. Native builder gpt-6.1-sol high; independent design/final reviewer gpt-6-astra high. Both exact IDs exposed by current native collaboration tools and official pages fetched 2026-10-15: https://developers.openai.com/api/docs/models/gpt-6.1-sol and https://developers.openai.com/api/docs/models/gpt-6-astra. Freeze these IDs; no silent substitution, external CLI dispatch or paid API route.

cli-team common source: 39fb407d71c7c5aae5f50a9bc01df6b3c215daa3; resolved README, CONTRACT, planning guide and Codex card read. Native kit governs hosted workers. Subscription quota/window, resolved provider model telemetry, full request/tool/token counts and actual billed cost are unknown. Plan two disjoint Sol assignments plus Astra review capacity; no invented numeric hard budget. Checkpoint/reassess on concrete blockers, scope change or repeated failure.

## Tasks and ownership

- T-004 Astra: independent contract/design review; only its report writable. Identify the smallest sound supported SSH/config/cleanup slice and concrete acceptance corrections.
- T-005 Sol: bounded configuration/auth generation and tests, independent worktree; API frozen after T-004.
- T-006 Sol: bounded transport/cleanup and tests, independent worktree; API frozen after T-004. No overlap with T-005.
- Root: integration, documentation, Make/CI only as needed, actual checks/evidence and all Git/ledger delivery.
- T-007 Astra: independent review of integrated final diff, required negative probes and evidence; root resolves all findings.

Workers use codex-task-worker, cannot delegate/commit/push or modify PLAN. New builds/tests use the common workspace launcher with unique IDs; raw artifacts remain private outside source. No cleanup of existing data. Source/PR contain H1-H4 and synthetic inputs only.

## Proposed acceptance contract for design review

1. Preserve strict P1a plans; use their validated inventory/artifact/caps/topology as bound input, never relabel a fixture plan executable remotely. New bundle/operation manifests have their own schema/lane/digests and link source plan.
2. Generate per-host Compose JSON (valid Compose input), six Redis configs and Mithril config plus separate private credentials. Fixed Redis digest; Mithril image identity must be independently supplied verified immutable digest/provenance or explicit unresolved draft. Never fabricate or publish an image. Non-root UID/GID, host networking, exact private binds, resource caps, read-only config mounts, isolated data paths, labels, no socket/host-root mounts or wildcard listeners.
3. Authentication per fixed upstream syntax: disabled passwordless default, distinct proxy app/admin and backend proxy/replication/operator credentials. Secrets enter via private bounded files, never argv/output/logs or public hashes. Deny injection/newlines and ambiguous syntax; config hashes exclude secret material. Root/source evidence remains sanitized.
4. Thin SSH transport: fixed remote entrypoint/operations, subprocess argv without local shell; never interpolate untrusted values into remote shell command. BatchMode and strict host checking, no agent/port forwarding, bounded deadline/output. Explicit request/response operation ID, exact host/run/plan binding. Unknown/nonzero/malformed/timeout/lost reply stays unknown/uncertain, with no automatic mutation replay. Machine identity rechecked within the operation session; drift blocks effects.
5. Ownership cleanup: exact container IDs + run/plan/role labels and host identity; inspect failures are unknown, never absent. Down only stops/removes exact observed matching containers in proxy-first order and retains data/config/journal/evidence; no compose-down/prune or volume deletion. Destructive cleanup preview binds exact paths/objects/references and independent approval requirements; refuse unknown/foreign/live references/link/mount ambiguity. No actual purge here.
6. If mutations are exposed, explicit independently supplied exact action approval is required in addition to digest, with an admission record that cannot be mistaken for authenticated authority. Develop-only tests inject mock SSH/runtime; no remote calls are made by tests or demo. Persist intent before effects and fence uncertain results; reconciliation observes exact IDs only.
7. Red-Green evidence: argv/credential injection, malformed and overlarge output, timeout/lost reply, drift, foreign/unknown resources, source/plan binding, retained down data, cleanup approval separation and real subprocess mock transport. Root repeats full relevant suite on Python 3.11 and existing CLI demo.
8. Gate: full diff/scope/privacy inspection; independent review and task/report validators; necessary PR checks; normal merge with exact head; remote SHA/content readback; ledger review report. STATUS keeps MR-004 BLOCKED_ENV and full P1 incomplete unless actual requirements are all evidenced.

## Current decisions

T-004 accepted with D1-D5 fully adopted as binding requirements in P1-TOOLS-CONTRACT. Scope is offline bundle + fixed observe/stop/remove with guarded down/reconcile + purge preview only; no up/bootstrap/upload/purge effects. Builder API and file ownership frozen below before implementation. Public source snapshot must not preclaim remote checks/merge. External delivery facts belong to the later ledger report and GitHub.

T-005 owns scripts/bundle.py and tests/test_bundle.py. T-006 owns scripts/ssh_executor.py, scripts/ssh_helper.py, tests/test_ssh_executor.py. bundle.validate_manifest(manifest, expected_digest) is the only dependency of transport on bundle; root will copy the completed bundle module to the transport worktree as a read-only integration input. No concurrent writer shares a source path.

## Root integration checkpoint — 2026-10-17

Initial source base 873eb7e9 was fast-forwarded to latest main 2c0cb8c4 before delivery; intervening changes are in other components and no required Mithril/root contract changed. Existing branches, worktrees and evidence remain preserved.

T-005 accepted after full root code/test diff inspection, actual Green03/Red02 evidence inspection and 7 Compose config-only parses. T-006 initially passed 30 focused/67 integrated tests but T-007 independently reproduced delayed original effects after unsafe abandonment (R1), plus unresolved persisted approval references (R2). Root required actual Red-Green correction. Final transport has 33 focused tests; remote journal accepts only uncertain/completed, opposite observations remain fenced, and unresolved references are refused. Initial failures remain visible in reports/protected evidence.

Root has inspected all new implementation/tests and changed documentation, preserving labctl, its fixture semantics and both locks. Final host suite t0310-root-full02: 70 tests, Python 3.13.5, exit 0. Fixed image Python 3.11.17 t0310-root-py311-03: make check (70 tests) and make demo, exit 0; no network, read-only source, nonroot local container. Demo remains local-fixture, 8 CLI calls/28 operations with retained marker and zero remaining synthetic resources/uncertainty. t0310-root-py311-02 was interrupted without a completed result, not counted. t0310-compose-parse01 passed 7 synthetic config-only parses; draft H4 is nonrunnable.

T-007 final corrected-source review and root static/task/report gate are pending at this checkpoint. Source acceptance and external delivery are separate: normal PR/CI/merge/readback and the final ledger review report will follow only after review passes. No remote SSH, Redis/Mithril startup, VPS write, purge, image publication or release is authorized or executed. Full P1 and MR-004 remain incomplete.

## Root acceptance — 2026-10-17

ACCEPT T-004/T-005/T-006/T-007 for the bounded offline slice. T-007 independently reran 70 tests and separately reproduced delayed stop/remove recovery plus 12 malformed-journal refusals; R1/R2 are resolved with no remaining blocker. Root inspected the complete diff, actual report/check outputs and independent probe records. t0310-root-acceptance01 passed 30-file scope/privacy/UTF-8/whitespace/link checks, four task/four report validators and git diff --check. Both locks, prior fixture implementation/tests and archived P1a PLAN are unchanged. Root's actual purge-preview CLI also passed, with six synthetic candidates and no eligibility/apply.

Evidence gate maps the task scope to private bundle/CLI artifacts, fixed helper and controller tests, independent recovery probes, retained-data checks, separate approval assertions, final guide/STATUS/VALIDATION and passing reports. All required local gates pass; original failures and unexecuted live gates remain explicit. Proceed with the already authorized normal source delivery. PR/main CI, merge SHA, remote-content verification and task review publication are recorded after they occur in GitHub and the ledger, not preclaimed here.

# Fresh run entry, current authority renewal and owned admission

Date: 2026-10-05. The approved mainline review identified missing production orchestration, long-workflow temporal coupling and pending-run admission. This milestone integrates the existing network flow into a coherent local run entry. It does not implement bootstrap/generation or perform real private/SSH/VPS/kernel operations. Formal completion6/outstanding12 and overall PARTIAL remain.

## Scope and contracts

- Production labctl run start/reserve, bounded network-step dispatch, redacted status and observation-only recovery, using existing fixed helpers/adapters and immutable journals. No replay when intent exists or response is uncertain. Status and recovery without inputs are local observations; a named side effect requires exact reviewed operation inputs/current authorization.
- Pending reservation already binds run/review/execution/scope/cluster/fence hashes. Add specialized exclusive run lock that validates the entire expected reservation and private-root identity; ordinary ClusterLock remains blocked. No arbitrary run-id bypass, implicit expiry, release or completion. Existing general mutation paths keep their behavior.
- Separate historical receipt integrity/chronology (validate at actual recorded event time and exact raw hashes) from current short-lived owner authority/fence/isolation/current operation observations. Explicit append-only renewal binds exact same execution, pending, scope, plan/setup/action; no TTL extension, old evidence rewrite, automatic authorization minting or cross-run adoption. All source/inventory/materials/host-incarnation/proof bytes continue to be rechecked. Existing public API strict defaults remain.
- New actions require current operation-scoped authorization at start and final boundary, current fence/isolation with unchanged exact old-host proofs, and applicable live read-only helper post-observation. Historical acceptance does not imply current network readiness; bootstrap will need new probes. Status/recover must distinguish integrity from current eligibility.

## Acceptance

1. Meaningful RED reproduces stale predecessor/accepted receipt and pending owner admission/missing CLI gap.
2. Actual production coordinator and CLI entry operate synthetic temp roots/fixed injected transports through prepare/reserve, receipts/replacement/access prerequisites, directory/staging/firewall/manual/probes to network acceptance. Advance the clock across multiple hours and renew per action; historical receipts stay exact, expired authority blocks only new work, new intent never borrows stale authority.
3. Wrong reservation/run/scope/raw/source/private-root, replacement incarnation, stale/future/false fence/isolation or unsupported operation fails closed before dispatch. Same-run and different-run contention are exclusive; ordinary labctl mutations remain blocked.
4. Failure/lost reply/no-clobber keeps original journals; recovery only observes and never dispatches/replays. Source/data changes and expired current authority during operation prevent acceptance; generation and pending never advance or release.
5. Independent fixed-diff review, focused integration, full offline unittest, original CI validator/compileall/team/privacy/whitespace, exact-head GitHub CI and remote/ledger readback before delivery.

## Bounded ownership

T-260 owns run lock/pending checked reservation. T-261 owns explicit historical/current authority design and network coordinator integration. T-262 independently reviews scope, contracts, source and integration (no production edits). Root owns this document/PLAN, CLI/run driver, end-to-end synthetic integration, acceptance and publication. Workers use isolated worktrees/disjoint scopes and cannot delegate. No runtime dependency or broadened live permission.

## Operator interface and immutable authority

`python3 scripts/labctl.py fresh-run start --plan REVIEW_ID --sha256 REVIEW_SHA --input private/execution-request.json --run-id RUN_ID` validates the native execution envelope and publishes the permanent pending reservation under a checked ordinary lock. Evidence failure before reservation keeps pending absent; a prepared execution is retained rather than silently adopted or overwritten. Start cannot adopt an existing pending run.

`fresh-run next --run RUN_ID --sha256 EXECUTION_SHA --input private/step.json --input-sha256 RAW_SHA` admits only the entire exact pending snapshot under FreshRunLock and dispatches one allowlisted production operation. The request has exactly schema_version1, operation `fresh-run-step`, run_id, execution_sha256, pending_sha256, step, parameters and renewal. Parameters are the exact scalar argument names of the selected public function; transport/adapters/commands cannot be selected by wire data. The fixed operation list is in scripts/fresh_run_ops.py.

`fresh-run status --run RUN_ID --sha256 EXECUTION_SHA` never contacts a host. `fresh-run recover` without input does the same; with an exact request it accepts only reconcile_network_directory, reconcile_network_files or reconcile_network_firewall. Recovery transports expose only observe; journals are reconciled without replaying a writer. Unknown remote outcome is reported as null, not a false guarantee that no dispatch happened.

An owner-supplied immutable renewal reference has schema_version1, kind `fresh-run-step-renewal`, authority owner, approved/owner_confirmed true, binding, exact target, issued_at/expires_at, manual_authorizations and exactly one of admission_request or writer_fence. Binding includes run_id/execution_sha256/pending_sha256/plan_id/plan_sha256/operation/target_sha256. The target digest preserves JSON types, including false versus zero. Validity is at most15 minutes and is rechecked at entry, actual dispatch/publication and exit. The tool never creates owner approval automatically.

Before access planning, plan_id and plan_sha256 must both be null and a direct current fence is required. Its schema_version1/kind `fresh-run-step-fence`, exact binding, observed_at, active true, controller_count1, in_flight_writers0, original prior_fence and isolation reference bind the entire run. Isolation kind `fresh-run-step-isolation` has the same binding, observed_at, all three stopped-writer flags, and all four exact baseline incarnations with isolated true, network/provider-console method and unique raw proof references. This capability cannot turn an old bare-host observation into a fresh one: collect_replacement_facts must obtain a new observation before a delayed prepare_network_access. The new admission is independently current.

With an existing access plan, renewal can reference a new current admission while preserving exact original replacement and old-host proof bindings, or use the direct fence route. New directory/staging/firewall/setup operations also need their original operation-scoped authorization current at the final clock. Firewall renewal derives the full actual action from the bound access plan and immutable staging publications, preserving its native action validator.

Historical validation uses each immutable plan/intent/receipt's actual creation/completion time and original authorization; it does not freeze the current clock. A manual-console record preserves append-only short-lived authorization references and requires uninterrupted coverage for each host's actual started/completed interval, including long work. Idle gaps between host actions do not need action authority. New current approval never retrospectively authorizes an uncovered interval.

A recovered receipt timestamps a later read-only observation, rather than another writer completion. Its original writer authorization must cover the intent and actual original write boundaries; reconciliation requires a new exact current renewal and observation. The recovered observation is validated at its own time without treating the expired original writer authority as a new grant. A successor can validate this immutable recovered history under its own current authority; this does not authorize a late replay or infer that an unauthorized late write was valid.

Status labels execution integrity separately from unverified journal shape/counts. Only the full accepted network chain yields historical_integrity and journal_integrity_verified; historical acceptance always reports current_network_ready false and stage_accepted false. The existing strict inspector remains current-time gated. Next bootstrap must gather current probes and still cannot release pending or change generation.

## Verification boundary

T-260 provides49 focused and144 existing-consumer tests. T-261 provides7 authority and2 integration tests plus63 strict-default compatibility tests; these worker checks are evidence inputs, not combined delivery acceptance. Root owns real CLI/driver moving-clock integration, final independent review, full offline tests and native validators. Expected RED failures and integration-found defects are preserved with their fixing GREEN results in T-263. No live environment or generation bootstrap acceptance is claimed.

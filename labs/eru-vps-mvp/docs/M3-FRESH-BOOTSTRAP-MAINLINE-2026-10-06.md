# Fresh bootstrap mainline after network readiness

Date: 2026-10-06. Baseline: eeca95d015fdd1122c8b10c2f5b093bdc1f481af. This milestone implements the approved empty-control-plane and cluster-bootstrapped stages in the existing fresh-run driver/CLI. Formal completed6/outstanding12 and overall PARTIAL remain until the entire original acceptance contract is met.

## Scope and acceptance boundary

Continue the immutable execution and exact held FreshRunLock/pending reservation from the accepted network chain. Before each new bootstrap side effect, revalidate historical network integrity, collect current fixed identity/authenticated-network/isolation probes, validate current operation-scoped renewal and external writer fence, recheck source/artifacts/host incarnations and raw input hashes. Historical network acceptance alone grants no current readiness. A current observation is separate from a sealed historical receipt. No TTL extension or implicit approval.

Fresh etcd uses the original review's target_token_sha256 and a private raw token input whose bytes must match it; never a fixed token, snapshot, restore input, old membership or old data root. Install only exact pinned artifacts and deterministically rendered fresh files. Creation is no-clobber and must stop on unknown existing paths/state; never erase/adopt/reset to manufacture freshness. Confirm old core/plugin writers stopped before etcd installation/start; observe healthy single-member new etcd identities distinct from the baseline, exact token/data-root provenance and the entire user keyspace empty before sealing empty-control-plane. No /eru-only query or count-only substitute.

Subsequent bootstrap installs/starts pinned core/CLI/resource plugin and exact three worker agents, using safe AddNode contract and fresh-rendered private endpoints, known_hosts/core key and capacities. Each install, service start and registration is a separately journaled bounded operation. Node existence alone cannot establish registration success. Final cluster-bootstrapped acceptance requires current etcd health and identity continuity, current readable core CLI and exact three available/up workers with reviewed role/endpoint/capacity/agent identities, and V01 timing. It stops before apps-replayed. Existing pinned locks stay unchanged; no v0.1.7 builds.

## Records, recovery and public interface

A new strict private bootstrap request/plan binds network plan/receipt, execution/pending/scope/source/artifact digests, new token reference and exact fresh-rendered payload. Inputs cannot choose arbitrary commands, modules, services, destinations or transport. Pure payload/render may reuse existing worker builders but must not call old deploy --apply or ordinary pending-blocked installers.

For each fixed stage/substep/host: durable no-clobber immutable intent before any side effect, pinned raw predecessor refs, one dispatch, separate sealed receipt with actual action timestamps/provenance and observation evidence. Every boundary rechecks current authority and immutable bytes. Unknown/lost reply keeps intent uncertain; recovery exposes observation only and cannot replay a writer. Reconciled completion requires exact postconditions and action provenance plus valid original writer interval; recovery observation time does not extend old authority. Failure stops subsequent hosts. Existing successful records are never rewritten. Pending remains present and accepted generation unchanged.

Root extends allowlisted fresh-run next/recover/status. Mutating requests keep exact scalar parameters and explicit renewal; fixed adapters are selected by code. Status performs no remote work and distinguishes historical integrity, uncertain journal shapes and current eligibility. All public output uses reviewed scalar counts/digests/status, no private token/key/host/spec/error data.

## Definition of done and verification

1. Proportionate expected RED for missing bootstrap behavior; focused GREEN for new-token/fresh-state guards, exact host/artifact/scope/pending/current-authority/probe drift, no-clobber, unknown-data protection, lost reply and observation-only recovery.
2. Actual production helpers and public driver/CLI operate synthetic temporary roots through the existing network chain into both new stages. Current probes must be refreshed across a moving clock; adversarial failure before dispatch has zero writer calls, uncertain operations never replay, completed predecessors remain immutable and ordinary mutation remains blocked.
3. Exact three workers, fresh etcd complete empty-keyspace evidence and new identity, pinned installs/service commands, safe registration, stage order and retained pending/generation are independently verified. Fake transport/kernel observations are local contract evidence, never live acceptance.
4. Independent fixed-source/diff review with adversarial checks; root full offline unittest and unchanged native workflow source/JSON/Markdown/privacy validator, compileall, team task/report validators and scope/whitespace checks. Preserve failed/interrupted checks and reasons.
5. Once all local gates pass, authorized commit/push/PR and exact-head required GitHub CI/review, merge without bypass, fetch/readback and task ledger sync. No release/deploy/live operations.

## Bounded ownership

T-264 GPT-6 Astra owns pure bootstrap contracts/coordinator and focused tests. T-265 GPT-6.1 Sol owns deterministic render, fixed host helper/SSH adapter and focused tests. Writers use separate baseline worktrees and disjoint paths; root owns this document/PLAN, shared authority and driver/CLI integration and end-to-end tests. Interface details are frozen by root after initial inspection, before integration. T-266 GPT-6 Sol independently reviews the fixed combined candidate and may write only review tests/report. No recursive delegation. Root owns evidence gate T-267.

## Explicit exclusions

No real private inputs, VPS/SSH/nft/kernel/provider, release/deploy or destructive operation. No runtime dependency, new campaign permission, app replay/resources/residue/generation completion or formal V08 claim. All tests use isolated synthetic roots and controlled injected runners. Tool calls are observed with no80/120 hard limit; provider requests/token/cost remain unknown unless actual telemetry is available.

## Frozen integration interface

Exports are prepare_bootstrap(project,plan_id,plan_sha,network_receipt_sha,input_file,input_sha), execute_bootstrap(project,run_id,bootstrap_sha,step_index,authorization_file,authorization_sha,adapter,collector=None), reconcile_bootstrap(project,run_id,step_index,expected_intent_sha,observer,collector=None), and local readonly inspect_bootstrap(project,run_id,bootstrap_sha), with explicit now/source_state testing hooks. Current renewal still binds the original exact network plan. Operation authority binds network plan/execution/pending plus bootstrap digest and step_index for at most15 minutes. Steps are etcd-install/start,empty-accept,core-install/start,pod-create, then install/proxy-start/register/agent-start/up per worker, and cluster-accept. Each pod-create and worker-up is independently journaled.

Bootstrap requires private raw token and safe-node-add binary references; its selected binary matches the fixed reviewed public v0.1.5 safe-node-add validation artifact. Fresh render uses the original manual setup's actual core key path, without replacing the key or network configuration. Explicit reviewed capacities are inputs, not imported old metadata. Required prior_baseline is the exact original schema-v2 execution host-baseline observation reference. Old etcd cluster/member IDs derive from its already validated raw status/member captures. New agent incarnation binds replacement machine/boot identity, actual service invocation and binary provenance; old raw metadata is never imported. Missing prior identities fail closed. Existing Docker/containerd are checked runtime prerequisites; this milestone does not install OS packages.

Current network collection takes expected_services only from validated bootstrap phase, as four exact maps of the fixed etcd/core/agent units to active or stopped. Core may run etcd/core, workers may run only agents. The ordinary network default remains all stopped. Actual systemd state and process observations, host/trust/files/firewall/routes/public denial guards remain intact; no raw observation is rewritten as stopped. Bootstrap-specific reads and publication permit at most128MiB for verified artifact/base64 records; ordinary readers retain16MiB and all private path/hash/inode checks.

## Implementation review boundaries

Readonly empty/cluster acceptance observes a complete state both before and after its durable controller intent, with null host writer provenance; it never dispatches. Mutating steps require absent pre-state. Etcd raw status, member-list and keyspace cluster/member IDs must agree and be integers, excluding JSON booleans. Queries may have different revisions; the helper does not claim an atomic multi-command snapshot.

Archive processing verifies pinned compressed bytes, then scans forward under4096member/1GiB-decompressed/1MiB-metadata-read/64MiB-per-member limits, rejects unsafe paths/types/duplicates, and verifies every selected artifact before publishing files. The real pinned archive decompressed size remains unmeasured; synthetic boundary tests do not establish real artifact extraction or runtime compatibility. Service starts use fixed one-unit commands; units are not enabled for reboot here. Live boot persistence and runtime/transport semantics remain future evidence.

## Verification runtime allocation

The real local public-CLI integration completed22steps in1,105.701seconds after the readonly pre-state correction. Prior full suite measured1,136.964seconds; adding these is only an estimated37.4minute full-run budget, not a measurement of the new complete suite. The ERU-only GitHub job timeout increases30→60minutes to retain every required test and validator. Permissions, triggers and commands remain unchanged. Final full-run time is recorded in the evidence gate when observed.

## CLI request routing

The existing `python3 scripts/labctl.py fresh-run next --run RUN --sha256 EXECUTION_SHA --input private/step.json --input-sha256 RAW_STEP_SHA` consumes a strict fresh-run-step request. Its `step` is one of prepare_bootstrap, execute_bootstrap or reconcile_bootstrap (the last goes through fresh-run recover). The outer request binds schema_version1, operation fresh-run-step, run_id, execution_sha256, pending_sha256, exact parameters and renewal `{path,sha256}`. Paths below are reviewed private references, not wire-selectable shell commands.

- prepare_bootstrap parameters: plan_id, plan_sha, network_receipt_sha, input_file, input_sha. Its inner fresh-bootstrap-request contains exact run/execution/pending/network-plan/network-receipt bindings, token_file and safe_core_binary raw refs, artifact_lock_sha256, capacities for three exact workers and prior_baseline raw ref. It publishes a plan without remote mutation.
- execute_bootstrap parameters: run_id, bootstrap_sha, step_index, authorization_file, authorization_sha. One operation authorization binds exact plan/execution/pending/bootstrap/index with scope fresh-bootstrap-one-step-only, owner_confirmed, authorized_at and expires_at. Each request is independently renewed; stale original admission is not reused as current permission.
- reconcile_bootstrap parameters: run_id, step_index, expected_intent_sha. A new current renewal authorizes observation only. Completion proves the original dispatch finished within its original writer interval; absence/unknown state cannot replay a writer.

`fresh-run status` and `fresh-run recover` without a step input read historical local integrity. They keep stage_accepted/current_network_ready/current_authority_verified false even after22sealed slots, show completed_step_count and next_stage apps-replayed, and cannot release pending. Unknown journal files, holes, raw byte drift or poisoned publication block status/successors rather than being adopted.


## Final local acceptance

Final frozen native suite: 1133 tests, 2723.389seconds (45.39minutes), OK/exit0/no failure/error/skip. This is the measured complete new suite and supersedes the earlier37.4minute estimate. Root final60focused/16.610seconds and independent final49/10.123seconds pass. The independent long7/1472.490seconds run preceded the final member-header patch; the final49 and root full cover the final source. Actual source/diff/hash review found no remaining bounded blocker. See [T-267 gate](../.team/reports/T-267.md). GitHub exact-head CI/merge/readback and desk sync follow local acceptance; definitive remote evidence is recorded in desk T-0075. Overall PARTIAL/formal6/12 and all live exclusions remain.

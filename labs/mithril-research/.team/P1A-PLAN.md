# Mithril P1 local delivery — T-0308

Owner 2026-10-15 accepts the proposed P1 develop-only segment, a multi-model team,
planning before implementation, and commit/push/normal PR merge for each segment.
This plan does not authorize VPS writes or P2/P3 execution. Root owns this file,
routing, integration and acceptance. Workers do not commit or delegate.

## Objective and gates

The first segment is P1a, the bounded offline core of P1. Deliver a small Python 3.11 stdlib operator harness: strict four-host/private
inventory and artifact inputs, immutable plan/digest, safe configuration/intents,
and an explicitly local simulated lifecycle with ownership/uncertain-outcome
reconciliation. No SSH executor is enabled in this segment. Remote operations
require later P1 executor tooling and P2 acceptance; the CLI must make the simulated lane unmistakable. Unknown prerequisites
produce a non-executable draft and cannot authorize operations.

Keep research commit 9959fe2e5cd466614dc20ef7b710befaaf1d746a. The v0.1.7 release
tag points to fed12518c4183aebd102a02a41b9073cd23e1b85, so it is excluded. Root
will build the fixed source in an isolated pinned Rust builder when available,
preserve binary/native-check evidence and lock verified hashes only. Redis
7.4.11/bookworm amd64 manifest was inspected; no floating latest inputs.

Acceptance: meaningful Red-Green tests, fixture acceptance through the real CLI,
scope/diff/task/report checks, independent final review, root CI, normal merge
and exact merged-main readback. MR-004/P2/P3 stay incomplete; P1 local/native
evidence cannot be relabelled live deployment evidence.

## Team snapshot and routing

- Scenario: standard-delivery; root plans/integrates, one bounded builder, one
  independent reviewer. Writers use isolated source worktrees.
- Native requested builder: gpt-6.1-sol, high reasoning; requested reviewer:
  gpt-6-astra, high reasoning. Both exposed by the current native collaboration
  catalog. Model exposure, account entitlement and accepted output are separate.
- Current official pages fetched 2026-10-14 UTC:
  https://developers.openai.com/api/docs/models/gpt-6.1-sol and
  https://developers.openai.com/api/docs/models/gpt-6-astra. Exact native IDs are
  frozen. No external CLI dispatch, silent fallback or provider installation.
- cli-team common source: 39fb407d71c7c5aae5f50a9bc01df6b3c215daa3; resolved
  README, full CONTRACT, planning guide and Codex card read. External CLI route
  schemas do not govern native hosted workers.
- Subscription quota/window, full model/tool/token accounting and actual billed
  cost are unknown. Plan for two leaf agents plus root and preserve review capacity.
  No numeric hard budget was requested; worker checkpoints trigger reassessment.
- Public records contain no machine paths, private inventory or host identifiers.

## Tasks and ownership

1. T-001 (Astra): review this plan and proposed P1 contract; report concrete
   blockers and minimal corrections before builder implementation.
2. T-002 (Sol): implement scripts/labctl.py, its supporting stdlib modules and
   tests/test_labctl.py with Red-Green evidence in an isolated worktree.
3. Root: build/provenance, artifact lock, examples/templates, Makefile, docs and
   root path-scoped workflow/spec entry; integrate the builder's diff.
4. T-003 (fresh Astra review turn): inspect the final integrated diff/claims,
   rerun relevant checks and report independently. Root reworks every finding
   before accepting the evidence gate.

## Current state

- Desk T-0308 doing claim published and read back.
- Source base: 4db45139bac19d6ffc5f12c215a80faed51378da.
- P0 readonly inventory exists privately. H3 has shared CI workloads; preserve
  ERU, runners/CI VMs, registry, all unrelated containers/volumes and host settings.
- T-001 design review completed; four findings accepted and contract corrected
  before T-002 implementation: explicit P1a scope, stable operation identity and
  uncertainty reconciliation, semantic plan validation and private state/output.
- Full P1 remains partial: thin SSH executor, per-host Compose/auth runtime
  packaging, separately approved purge and live lifecycle evidence are deferred.
  P1a does not complete P1, MR-004 or MR-R02.
- T-002 native builder completed: 18 test methods, six crash windows and actual
  CLI evidence. Root integrated the frozen worker diff and built the pinned source:
  release, 121 tests, Clippy, format and binary identity passed on native attempt 3.
- T-003 found demo parent traversal before source containment enforcement. Root
  recorded Red evidence, added four demo regressions and corrected creation/write
  with no-follow directory handles. Focused Green passed; also added explicit final
  acceptance assertions and dated historical handoff supersession pointers.
- Root accepted the corrected integrated source after inspecting the complete
  diff and rerunning the whole suite: 22 methods passed on Python 3.13.5; fixed
  Python 3.11.17 container `make check` and `make demo` both exited 0. The demo
  used eight CLI commands/28 intents, two recreated process sets with retained
  marker, and finished owned with zero resources/uncertain operations.
- T-003 independent re-review accepted the correction and final CI/docs delta:
  22 tests and demo rerun, native/Python3.11 hashes and Red/Green audited,
  264 input mutations checked. Root accepts T-002 and T-003 within their bounded
  assignments; initial failures remain recorded, with no unresolved source blocker.

## Pre-merge evidence gate

This file is a planning/source-acceptance snapshot in the submitted commit.
Remote PR/check/merge/readback facts are recorded externally after submission;
this snapshot does not claim those future steps have already happened.

| Task requirement | Visible evidence and root decision |
| --- | --- |
| Strict inputs, plans and owned lifecycle | labctl/tests, 22-pass root and independent runs; accepted |
| Meaningful Red-Green and uncertain outcomes | T-002 Red/Green plus root demo regression Red/Green; six create/remove windows; accepted |
| Fixed provenance | unchanged research pin, runtime lock and native evidence; release/121 tests/lints/version/hash inspected; accepted within native scope |
| Offline root CI | workflow/spec inspected, both Make targets passed on Python 3.11; actual remote run is pending submission |
| Two-model development and review | requested native Sol implementation and Astra independent review; T-001/T-002/T-003 validated; resolved-provider telemetry and billed cost remain unknown |
| Truthful docs | P1a/full-P1/runtime boundaries, dated history and unchanged MR counts independently reviewed; accepted |
| Commit/PR/CI/normal merge/readback | authorized by owner and current task; root will finish external delivery and record exact facts in task report |

Protected evidence stays in common-workspace preserve directories. Public
files include only synthetic inventories and sanitized native/review summaries.
No VPS write, release, image publish, live runtime, purge or fault execution is
part of this segment. Full P1 and MR-004 remain incomplete after P1a delivery.

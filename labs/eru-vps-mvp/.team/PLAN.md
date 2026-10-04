# ERU local closeout — 2026-10-03

Baseline: `82cd9d8`. Branch: `agent/eru/local-closeout`. The orchestrator owns this plan and acceptance.

## Objective and boundaries

Audit local ERU-009/010/013/014/015 readiness, repair three reproduced release provenance/publication defects, and document exact local/live boundaries. Preserve 12 remaining formal tasks. No actual private data, VPS mutation, destructive executor, runtime dependency or unrelated component changes.

Owner explicitly authorized ledger registration/results and target branch commit/push/Draft PR; no merge, release or deployment. Registration completed before product edits. Parallel writers used isolated worktrees and disjoint code/document scopes.

## Bounded tasks

- T-201: read-only drain/loss/reimage audit; accepted, 147 focused tests passed. Local bounded behavior present; live acceptance remains outstanding.
- T-202: read-only release/fresh-planner audit; PARTIAL product-readiness report retained. Three defects reproduced; ERU-015 executor absent.
- T-203: implement three guard fixes plus regression coverage in five source/test files in an isolated worktree. Accepted for integration after diff review; 40 focused tests pass; two shipped manifests validate unchanged.
- T-204: independent fixed-diff review of integrated source/tests and documentation; final decision recorded below.
- Orchestrator: ledger synchronization, integration, documentation, full suite and exact CI gates, final diff review and evidence-based acceptance.

Worker contracts for implementation/review are in tasks/; audit and implementation reports are in reports/. Initial audit contracts and raw synthetic test logs remain in local evidence storage. No worker may delegate or mutate remote services.

## Verification gates

- Baseline full unittest: 429 tests, OK. Baseline CI parity: 88 Python, 2 JSON, 49 existing component Markdown plus this plan, 149 tracked paths; private exclusion and diff checks passed.
- Red: new focused assertions reproduce concurrent destination clobber, same-path/hardlink independent evidence reuse, and missing/failed/ambiguous independent compatibility. Historical red failures are retained as expected regression evidence.
- Green: release/publish/update/patch validation focused suite: 40 tests, OK; existing v0.1.5 manifests both validate.
- Integrated full unittest, exact workflow AST/JSON/Markdown/private-exclusion checks, compileall, independent review, diff check and ledger-native checks are required before delivery.
- Four authorized test-host SSH connections and the control-plane etcd health endpoint passed read-only checks. These do not count as E2E.

## Acceptance decisions and residual work

The three guard fixes are a bounded ERU-013 slice; they cannot complete all five local tasks or formal ERU acceptance. ERU-009/010/014 have fake-tested finite workflows. ERU-013 still needs a selected/pinned new stable build and compatibility evidence before live upgrade/rollback/interruption. Official v0.1.7 now exists, so waiting for a new tag is no longer the prerequisite. ERU-015 remains planner-only and needs a reviewed destructive execution/recovery design and implementation before its live gates.

The current five-task acceptance matrix is in docs/LOCAL-CLOSEOUT-2026-10-03.md. No formal ERU task count is reduced. Public artifacts contain summaries and synthetic fixture evidence, never real private inventory or raw host output.

## Final acceptance checkpoint

T-204 returned no blocking findings; T-203 code/tests accepted unchanged. Integrated full suite: 438 tests, zero failures/errors/skips. Compileall and exact workflow parity passed. T-205 records PASS for the bounded guard slice and PARTIAL for the broader five-task closeout. Unimplemented/new-version/live requirements remain explicit; no task count is reduced.

Final staged-file CI parity: `ast=88 json=2 docs=58 tracked=158 private_exclusion=pass diff_check=pass`. Latest upstream main advanced in unrelated components only; ERU sources and workflow are unchanged.

## Continued local work after merged PR #213

Owner resumed the remaining work; ledger claim renewed before editing. Baseline `1e4bd8e`. T-206 adds an explicit source candidate to the validator without changing deployment locks; T-207 supplies legacy-to-new compatibility regressions; T-208 specifies the fresh executor/recovery boundary. Workers have isolated disjoint worktrees. The orchestrator pins official source/toolchain, performs two independent builds, integrates patches, and runs final gates with independent review. No real private data or VPS mutation. Complete local work first, record any missing full acceptance honestly.

## Resumed candidate gate

T-209 independently reviews the frozen patch, validator and design in an isolated review worktree. T-210 implements documentation in a separate worktree after actual evidence arrives. The orchestrator reviews before importing the patch, performs two isolated builds, exact component CI, publication/manifest verification, final privacy/diff review, authorized Draft PR and ledger sync. Prior call budget is carried forward; full task remains PARTIAL while executor/live requirements are missing.

## Candidate acceptance evidence

T-206/207 implementation and T-208 design accepted within their bounded scope after T-209 independent review. T-210 documentation integrated with actual evidence; its original pending report remains historical. Two isolated source/toolchain/GOPATH/GOCACHE builds passed all patched and compatibility stages, expected baseline panics reproduced, and actual binaries are byte-identical: `312fc5ccffed086ff0d772b8c609ed079b055710b45e052830a7d67db3f5c356`. Only module downloads shared a cache. New v0.1.7 validation manifest and both existing manifests load successfully. Full suite 446 tests passed (68.675 seconds), original CI validation and compileall passed. Deployment locks remain unchanged. The broader local closeout remains PARTIAL: fresh executor and live upgrade/rollback/fresh-generation acceptance are absent.

## Fresh simulation foundation after merged candidate delivery

Baseline 532e587. New bounded tasks: T-212 durable immutable record store, T-213 fake-only 12-stage coordinator (frozen store API), T-214 independent adversarial review. Writers use isolated worktrees and disjoint paths; root owns integration, documentation, native CI and evidence acceptance. Start with lost-response RED; verify durable intent before dispatch, no replay, exact chain/binding recovery, one-winner publication and simulation-only output. Real adapters, global mutation barrier integration, bootstrap, generation acceptance and live operations remain absent. Prior candidate evidence is preserved and not rebuilt.

### Integration and independent review

T-212 store imported after SHA verification and root 16-test pass. T-213 coordinator imported with final frozen test snapshot after its contention expectation was corrected; root 36-test integration passed. T-214 adds five independent adversarial checks against real directory fsync failure, unknown valid JSON, root replacement, foreign action evidence and observation linkage. Its formatting finding on a trailing blank line was fixed without behavior change. Final focused suite: 41 tests, 1.647 seconds, OK. Original 482-test integration passed before the five independent tests were added; final full suite is required before acceptance.

No validation was relaxed: active publication temporaries may conservatively block a competing reader, with at most one fake dispatch and an auditable journal after contention. Full production executor, external fencing, global pending barrier, bootstrap/probes, generation commit/seal and live acceptance remain absent. The module has no production CLI or remote adapter path.

### Final evidence gate

T-212/T-213 implementation and T-214 independent review accepted for the bounded simulation foundation. Final suite: 487 tests, 68.977 seconds, OK; focused 41 tests and original CI validation/compileall pass. Root applied only an EOF whitespace cleanup to the coordinator test snapshot after independent review. T-215 maps acceptance evidence and keeps the overall local closeout PARTIAL. No formal ERU completion count changed.

## Pending-generation admission barrier (2026-10-03)

Continue the merged simulation foundation at `7d4f005`. Implement a persistent controller-local admission barrier without remote operations, generation acceptance or automatic release. Existing mutation locks must reject a pending or malformed reservation, including inherited locks. The trusted `private` root symlink convention remains supported; descendants cannot redirect the barrier. Scope is local API and real admission integration, not a complete production fresh executor or external writer fence.

- T-216: isolated implementation of reservation storage, ClusterLock admission and focused regressions.
- T-217: independent read-only entrypoint audit, followed by fixed-diff adversarial review.
- Orchestrator: integrate any audited uncovered mutation routes, documentation and full native CI parity, task/report checks and evidence gate.
- No accepted-run writer, reservation release, production fresh CLI, dependency or deployment. Read-only paths must be explicitly inventoried; conservative denial of lock-taking recovery is documented rather than adding an unaudited bypass.
- Acceptance requires real temporary-file crash/path/inheritance tests, entrypoint evidence, independent review, complete offline suite and original workflow validation. Formal outstanding count remains 12.

### Barrier acceptance decision

T-216 and T-217 accepted after root inspected the full diff, exact source hashes and report contracts. Historical RED was the empty-pending-directory context-entry regression; resolved without weakening admission. Root 31 focused tests and 514 full tests passed; original CI validation, compileall, scope/privacy and whitespace gates passed. Evidence gate T-218 accepts this local slice only and remains PARTIAL for the full executor. No production reservation caller, release/completion or VPS operation was added. Stable trusted backing root, quiescence and external fencing remain explicit prerequisites.

## Execution-envelope preparation and barrier-aware observation (2026-10-03)

Continue at merged barrier baseline `7bafbf5`. Implement a separate immutable production-shaped execution envelope bound to an existing review plan, current local source/input hashes and explicit recent authorization/fence/host/material evidence. This is local preparation plus observation-only recovery; it cannot execute destructive stages, reserve automatically, accept a generation or clear a barrier. Existing review envelopes remain immutable and non-executable.

- T-219 owns the bounded strict validation/storage and recovery API with temporary-file regressions in an isolated worktree.
- T-220 independently audits contracts and reviews a frozen candidate; owns only independent regression tests and report.
- Root owns CLI integration, documentation, full native checks, evidence gate and authorized Git delivery.
- The reserve API already exists; preparation must never call it implicitly. Recovery compares its exact bindings if present, classifies prepared/reserved/blocked/absent, and never adopts an unknown run or treats reservation as remote-stage completion.
- No broad ClusterLock bypass. Observation uses bounded no-follow reads and rechecks record/root identity; no lock-held mutation permission is returned.
- Gate: test-first missing lifecycle regression, drift/freshness/scope/duplicate/path/crash cases, independent review, all ERU tests and original workflow parity. Formal remaining count stays 12.

### Execution preparation acceptance decision

Accepted T-219 and T-220 after root source/diff/hash inspection and independent adversarial tests. Canonical-cluster redirection was fixed before acceptance; Git queries now explicitly disable optional index writes. Root focused73 (2.164s), full550 (69.419s), independent73 (2.201s), original workflow validation, compileall and team/public-scope gates passed. T-221 accepts only nonexecuting preparation and pending observation, remaining PARTIAL for the full executor. Attestation trust, stable backing root, no automatic reservation/release and future live gates are explicit.

## Fresh baseline observation adapter (2026-10-03)

Continue merged preparation at `e0d3172`. Add a strictly read-only four-host/runtime and core etcd/ERU metadata observer with bounded transport, exact review binding, immutable private evidence, and observation-backed host evidence accepted by preparation. Tests invoke only fake transports or synthetic local processes; no VPS/SSH/provider session is run by the team. Observation cannot establish external fencing, mutate/reserve/release, or mark a stage accepted.

- T-222: isolated fixed-command collector, snapshot validator, safe local evidence lifecycle and fake/contract tests.
- T-223: independent protocol/command audit and frozen-candidate adversarial review.
- Root: envelope v2 host-evidence and CLI wiring, documentation, native suite/workflow parity and evidence gate; authorized PR/merge after exact-head CI.
- Preserve v1 manual host attestation semantics; observation-backed evidence must carry a separate immutable record ref, verified raw-command linkage and exact run/review/scope/generation. No weakening of original parser to accept arbitrary fields.
- Capture old-state baseline, not residue acceptance. Bounded key inventory must detect truncation, values, duplicate keys, revision/identity drift; unsupported/nonempty/unknown facts are never silently promoted.
- Formal outstanding count remains 12; complete fresh dispatch/bootstrap/acceptance and external fencing remain separate gates.

### Observation acceptance decision

Accepted T-222 and T-223 for the bounded observer after frozen source hashes and actual diffs/tests were inspected. Independent review caught and verified process-group cleanup and the pinned etcd member-header revision contract; per-host after-identity checks and malformed-data normalization were added. Root focused57, independent68 and full586 tests passed. Independent final import-only cleanup passed11 tests. Original workflow validation, compileall and team/scope/privacy gates passed. T-224 remains PARTIAL for overall closeout; no formal task count, generation or live authority changed.

## Four-host manual reimage receipt validation (2026-10-03)

Continue at merged c12d510. The approved fresh design requires a dedicated core-and-workers receipt contract; existing single-worker rebuild-node validation must remain unchanged. Deliver strict, read-only validation of four manual console actions/receipts bound to a prepared execution, original host observation, exact provider/volume/image scope and generation. This independent hosts-reimaged input slice does not implement external fencing or declare any stage accepted.

- T-225: isolated pure receipt contract and safe local read-only assessment API, synthetic tests, no remote calls or writes.
- T-226: independent contract/negative-path review and real temporary-file regressions, isolated worktree.
- Root: document-first frozen scope, CLI integration/redaction, remaining-task report, full native validation and evidence gate, authorized GitHub delivery and ledger synchronization.
- Evidence must distinguish historical preparation freshness from current receipt age; do not accept malformed rehashed execution or bypass current source/input/root checks. Receipt acceptance never refreshes authorization or fence, updates trust/inventory, reserves/releases generation, or authorizes dispatch.
- Formal remaining count stays12. Require exact four order/identity, unique actions/new identities/OOB Ed25519 fingerprints, old-identity rejection, exact erase results, action/completion/review chronology, digest/path safety, pending consistency and no writes. Future real-host verification remains a separate gate.

### Four-host receipt acceptance decision

Accepted T-225 and T-226 after frozen hashes, source/diff inspection and independent tests. Root44, worker124, independent138+4 and full614 tests passed; original CI validation, compileall and task/report/scope/privacy gates passed. No existing single-worker validator was changed and independent tests retain its core rejection. T-227 accepts the assessment slice only and remains PARTIAL for the full executor. No live actions, renewed authority, stage acceptance or formal task-count change.

## Fresh replacement-host observation (2026-10-04)

Continue after merged four-host receipt assessment. Add a fixed read-only probe for bare replacement OS identity, OS release, architecture and bounded known ERU/etcd path presence; no Docker/containerd/ERU runtime or Tailscale command prerequisite. Explicit request endpoints and canonical public keys must bind the exact reviewed receipt assessment; keys must match console-attested Ed25519 fingerprints before any transport. Old inventory/trust remains unchanged.

- T-228 owns isolated protocol, immutable private observation collection/loading and synthetic tests.
- T-229 independently reviews the transport/trust/provenance/pending boundary and final CLI with adversarial fixtures.
- Root owns document-first scope, CLI, source/diff review, full native checks, evidence gate, authorized Git delivery and ledger synchronization.
- Dedicated observation only: append immutable evidence under a new area, never obtain mutation admission or weaken ClusterLock. Exact stable pending binding is permitted for read-only facts; malformed/foreign/drifting pending blocks before any probe/publication. Claim IDs once before transport; failures retain claims and stop markers.
- Revalidate current receipt assessment/raw refs, source/input/private root and endpoint hash before/after. Offline inspection rederives saved fixed-probe facts, does not call SSH or write. Facts are fresh within15minutes, collection bounded360seconds.
- Facts match all four new machine/boot/OS/key identities before/after; reject known old-state markers and wrong architecture. Known-marker absence is not complete filesystem/runtime/network/residue/fence acceptance. Formal remaining12 unchanged.

### Replacement facts acceptance decision

Accepted T-228 and T-229 after source/diff/hash review and independent adversarial checks. Two deterministic stale-return regressions were fixed before acceptance; deployed proxy unit markers were added. Root43, worker67, independent86 and full643 tests passed. Original workflow, compileall and team/scope/privacy gates passed. T-230 accepts only this facts slice, keeping overall closeout PARTIAL and formal remaining12. No VPS, stage acceptance, trust/inventory or generation change.

## Fresh network-stage prerequisite inspection (2026-10-04)

Continue after replacement facts. Deliver fixed network-and-access-ready read-only gate linking exact existing pending, replacement observation, fresh scoped owner/fence attestations and independently readable old-host isolation proofs. Historical preparation cannot renew live authority. No transport, storage mutation, admission capability or stage acceptance is added.

- T-231: bounded isolated strict contract and private read-only assessment with synthetic regression tests.
- T-232: independent frozen-candidate review and adversarial tests; no recursive delegation.
- Root: document-first frozen scope, CLI, full native checks/evidence gate and authorized Git delivery.
- Gate: require actual exact pending, current refs/source/root and final-time checks; preserve original reservation, old baseline and legacy validators. Formal remaining12 unchanged.

### Network prerequisite acceptance decision

Accepted T-231 and T-232 after source/diff/hash inspection and independent temporary-file evidence. Four late publication drift cases were reproduced and fixed with retained directory descriptors and final exact entries. Root50, worker62, independent72+13 and full679 tests passed; workflow/compileall/team/scope/privacy gates passed. T-233 accepts this readonly slice only, keeping full closeout PARTIAL and formal remaining12. No stage, live fence or network acceptance; no mutation capability or real host operations.

## Fresh network access configuration plan (2026-10-04)

Continue current-stage prerequisites into a deterministic four-host configuration renderer and immutable private plan lifecycle. Bind current admission and replacement identities, explicit private controller/interface and a canonical public core client key. Fixed management-port policy, pinned known_hosts and staged restricted authorized-key content only; no runtime/service installation, remote calls or stage acceptance.

- T-234: isolated renderer, safe prepare/inspect lifecycle and fake/local tests.
- T-235: independent frozen-candidate policy/publication/trust review and adversarial tests.
- Root: document-first contract, CLI, diff/hash review, full native gates, authorized Git delivery and task sync.
- Required: rederive payload instead of trusting its hash, preserve current admission/freshness/pending checks and complete publication identity across writes. No generic lock bypass; formal remaining12 unchanged.

### Network access plan acceptance decision

Accepted T-234 and T-235 after frozen hash/source/diff review and independent policy/publication regressions. Root reproduced a post-publication raw-byte pin gap; independent RED confirmed whitespace-only tampering could return success, and the publisher-returned digest fix passed. Root30, worker60, independent79 and full705 tests passed; compileall and original workflow validation passed. T-236 accepts this bounded renderer/immutable-plan slice and keeps overall closeout PARTIAL, with formal remaining12. No real network change, current trust update, pending change, stage acceptance or runtime compatibility claim.

## Network file staging coordinator (2026-10-04)

Continue merged network plans into a durable per-execution/per-host staging journal, single-dispatch coordinator and observation-only reconciliation. Fixed two-file host payloads only; no activation, production SSH adapter, execute CLI, current trust/generation change or stage acceptance. T-237 implements in an isolated worktree; T-238 independently reviews and adds adversarial regressions; root owns contract, CLI inspection, integration, native tests, evidence gate and authorized Git delivery. Same slot cannot be replayed via a new plan ID; every dispatch requires a durable intent and freshly revalidated plan/auth/pending/publications. Formal remaining12 unchanged.

### Network staging acceptance decision

Accepted T-237 and T-238 after source/diff/frozen-hash review, real temporary-file concurrency evidence and independent regressions. Observation expiry after final IO, late recovery-loser poisoning and final pending drift were reproduced before correction. Root13, worker66, independent96 and full751 tests passed; original workflow validation and compileall passed. T-239 accepts this coordinator slice only and retains overall PARTIAL/remaining12. T-238 received a bounded extension from32 to48 calls within the same45-minute/scope limit to reproduce and reverify actual blockers. No production adapter, remote activation or stage acceptance was introduced.

## Fixed SSH staging transport and host helper (2026-10-04)

Implement a bounded fixed-command SSH adapter and standard-library host compare-and-stage helper for the existing coordinator. T-240 owns only host helper/tests, T-241 owns only transport/tests, T-242 independently reviews both; each writes in an isolated worktree with frozen wire/API inputs and no recursive delegation. Root owns docs, cross-component synthetic integration, full gates, acceptance and authorized delivery. No live SSH/VPS, execute CLI, directory preparation, activation or stage acceptance; formal remaining12 unchanged.

### SSH staging acceptance decision

Accepted T-240/241 and independent T-242 after source/diff/hash review and regression evidence. Claim-directory replacement was reproduced for both empty/nonempty replacements and fixed before acceptance; UTF8 boundary rejection was also corrected. Root60 tests (10.397s), independent57 (0.479s), full811 (318.087s), compileall and original workflow gates passed. T-243 retains overall PARTIAL and twelve formal tasks. Existing safe-directory preparation is the next explicit prerequisite, followed by activation/bootstrap/generation and live validation. No actual SSH/VPS operation occurred.

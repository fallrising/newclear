# HAI Taskboard P0-A Delivery Plan

## Objective

Create a new `products/hai-taskboard` project in the `newclear` monorepo and deliver the first
document-first, evidence-gated P0-A slice: a single-operator Project/WorkItem/Run control plane with
a deterministic fake executor. The board is a projection; SQLite normalized state and accepted
revision bindings are authoritative for operational state.

## Authorization boundary

The user authorized creating the project, beginning development, and committing/pushing this
accepted checkpoint to its GitHub branch on 2026-09-05. This does not authorize pull requests,
merges, releases, deployments, production mutations, real provider credentials, or real agent
execution. P0-A remains Fake-only.

## Adopted review inputs

- `hai-taskboard-brief.md` — SHA-256 `74596865dcf073626d52548160b709e4506d155fa4e90cc07b6a6535d2c7d7c6`
- `hai-taskboard-design-review-v0.2.md` — SHA-256 `f7cadae975c9300478f2a4d1bd24c2c1efbf3a3bd7bba0daa20fd4ee2db6a01c`
- `hai-taskboard-sdd-review-v0.2-augmented.md` — SHA-256 `e03910bb3cd1cdc763201552e671f34d351a3db9cfc4c234261f507069249dbc`
- Repository baseline — `newclear/main@3ad5533d8148a84ab19145fbee92306d1b69941b`

## Authority during bootstrap

- This file is the only current execution-status index for developing HAI Taskboard.
- `products/hai-taskboard/docs/tasks/` will contain durable product task contracts without mutable
  execution status.
- `.team/tasks/` contains one-run worker envelopes and may only be written by the orchestrator.
- `.team/reports/` contains worker evidence reports; a report never accepts its own task.
- Once the product is ready to dogfood, authority will switch once to SQLite by an explicit migration;
  no bidirectional Markdown/DB status synchronization is permitted.

## Scope

### P0-A

- Project list and one Project board.
- WorkItem phases, orthogonal blockers, immutable AC revisions, multiple Runs.
- Fake executor through a capability-declaring adapter port.
- Subject-bound candidate, review, evidence, human completion gate.
- Idempotent commands, optimistic versions, lease epochs, recovery states, transactional audit/outbox.
- REST commands plus resumable SSE projections.
- Deterministic declared-dependency invalidation and impact preview.
- ContextPack/HANDOFF and documented restore behavior.
- Four UI surfaces: Project/Board, WorkItem detail, Attention inbox, Impact preview.

### Deferred

- Portfolio/global dashboard, multi-agent chat room, Slack/Lark/MCP, webhooks, second provider.
- Real Codex execution, arbitrary shell, provider credentials, merge/deploy/release.
- Semantic equivalence, AI-authored accepted edges, cross-project dependencies, historical time travel.

## Task graph and current status

| ID | Task | Depends on | Status | Acceptance owner |
| --- | --- | --- | --- | --- |
| T-001 | Repository boundary and reuse availability review | — | Accepted | Orchestrator |
| T-002 | Domain, authority, persistence and recovery contract review | — | Accepted with dispositions | Orchestrator |
| T-003 | P0 UI information architecture and interaction contract review | — | Accepted with dispositions | Orchestrator |
| T-004 | SQLite driver/engine/backup executable selection spike | T-002 | Accepted with explicit NotRun follow-ups | Orchestrator |
| T-005 | REST/OpenAPI and artifact envelope contract review | T-002 | Accepted with dispositions | Orchestrator |
| T-006 | Reproducible toolchain, dependency and root-CI gate review | T-001 | Accepted with explicit NotRun follow-ups | Orchestrator |
| T-007 | Independent G0 design evidence gate | T-004,T-005,T-006 | Failed; rework required | Orchestrator |
| T-008 | Independent G0 re-review after contract/status fixes | T-007 | Failed; stale SDD rework required | Orchestrator |
| T-009 | Independent final G0 re-review of repaired design set | T-008 | Failed; Redocly environment NotRun | Orchestrator |
| T-011 | Independent G0 re-review with pinned Redocly environment | T-009 | Accepted | Orchestrator |
| T-010 | Adopt master SDD, ADRs, mini-SDDs and traceability | T-001..T-009,T-011 | Accepted | Human/orchestrator |
| T-012 | Forward-only reviewer-report compatibility contract | T-010 | Accepted by T-013 | Independent reviewer |
| T-013 | Independent reviewer-report compatibility verification | T-012 | Accepted | Orchestrator |
| T-020 | Contract schemas and deterministic Go domain kernel | T-010 | Accepted after T-022/T-024 | Independent reviewer |
| T-021 | Independent domain-kernel code/evidence review | T-020 | Failed; public Done constructor bypass | Orchestrator |
| T-022 | Close public Done-construction authority bypass | T-021 | Accepted by T-024 | Independent reviewer |
| T-023 | Independent domain-kernel re-review | T-022 | Failed; three inventory checks NotRun | Orchestrator |
| T-024 | Final domain inventory evidence re-review | T-023 | Accepted | Orchestrator |
| T-030 | React/shadcn UI shell and contract fixtures | T-010 | Accepted after T-032/T-033 | Independent reviewer |
| T-031 | Independent web-shell code/evidence review | T-030 | Failed; bootstrap hygiene/pins incomplete | Orchestrator |
| T-032 | Repair web pins, shadcn provenance and generated-output hygiene | T-031 | Accepted by T-033 | Independent reviewer |
| T-033 | Independent web-shell re-review | T-032 | Accepted | Orchestrator |
| T-040 | Persistence, command API, SSE and Fake execution vertical slice | T-024,T-033 | In progress via child slices | Independent reviewer |
| T-041 | Executable T-040 design and child-scope decomposition | T-012,T-024,T-033 | Accepted after T-048/T-051/T-052 | Independent reviewer |
| T-042 | Independent T-041 design/decomposition review | T-041 | Failed; four executable-boundary blockers | Orchestrator |
| T-048 | Repair T-041 executable boundary findings | T-042 | Accepted after T-052 | Independent reviewer |
| T-049 | Independent T-048 design re-review | T-048 | Failed; digest oracle ownership mismatch | Orchestrator |
| T-051 | Repair digest codec oracle child ownership | T-049 | Accepted by T-052 | Independent reviewer |
| T-052 | Final T-041/T-048/T-051 design re-review | T-051 | Accepted | Orchestrator |
| T-043 | SQLite V1 foundation and guarded Done rehydration | T-052 | Accepted after T-054/T-056/T-058/T-061/T-063/T-064 | Independent reviewer |
| T-053 | Independent SQLite foundation code/evidence review | T-043 | Failed; five repair groups required | Orchestrator |
| T-054 | Repair SQLite history, transaction port and attack findings | T-053 | Accepted as completed by T-056/T-058/T-061/T-063/T-064 | Independent reviewer |
| T-056 | Complete SQLite public-port and adversarial evidence | T-054 | Accepted after T-058/T-061/T-063/T-064 | Independent reviewer |
| T-057 | Final independent SQLite foundation review | T-056 | Failed; missing approval consumption accepted | Orchestrator |
| T-058 | Require one immutable consumption per completion Approval | T-057 | Accepted by T-064 | Independent reviewer |
| T-061 | Preserve canonical result bytes, verifier role and immutable identities | T-058 | Accepted by T-064 | Independent reviewer |
| T-062 | Final combined SQLite and forward-contract review | T-058,T-061 | Failed; allocator/result ordering repair required | Orchestrator |
| T-063 | Repair canonical success-result transaction ordering | T-062 | Accepted by T-064 | Independent reviewer |
| T-064 | Fresh combined SQLite ordering re-review | T-063 | Accepted | Orchestrator |
| T-044 | Application command and atomic result slice | T-064 | Accepted after T-066/T-067 | Independent reviewer |
| T-065 | Independent T-044 application/real-Store review | T-044 | Failed; three repair groups required | Orchestrator |
| T-066 | Repair application ordering, executor timing and canonical strictness | T-065 | Accepted by T-067 | Independent reviewer |
| T-067 | Fresh T-044/T-066 application and real-Store re-review | T-066 | Accepted | Orchestrator |
| T-050 | Reconciliation, restore and handoff slice | T-040 | Pending | Independent reviewer |
| T-060 | Repository-level evidence gate and P0-A acceptance | T-050 | Pending | Human/orchestrator |

## Required verification gates

- All normative clauses have stable IDs and trace to tests or explicit NotRun evidence.
- Go: format, vet, unit, race, contract, failure-injection and integration checks in pinned containers.
- Web: format, lint, typecheck, unit, accessibility, build and Playwright critical-flow checks.
- Negative completion, idempotency, lease/recovery, stale publication, SSE gap and restore cases remain
  visible; no required failed/skipped/not-run check can be reported as passed.
- Worker scope, reports and actual diffs are independently inspected before acceptance.
- Real adapter work is forbidden until a separate G2 authorization and evidence set exists.

## Decisions and review dispositions

- 2026-09-05 — Adopt the v0.2 scope cut: P0-A Fake core before P0-B real Codex.
- 2026-09-05 — Use `products/hai-taskboard`; it is a user-facing control-plane product, not a shared
  platform library or an extension of Fanzloud/Loom.
- 2026-09-05 — Use state-first persistence with transactional audit, not full event sourcing.
- 2026-09-05 — Keep Web as the primary control surface; channel implementations are deferred.
- 2026-09-05 — Do not use or clean the dirty detached `T-019-newclear-ci` worktree.
- 2026-09-05 — Accepted T-001 report
  `27250c73595a515e9985131c1e258e4a22d67a8eb451e2638ad73c2ed338d6db`: keep
  `products/hai-taskboard`, reuse only root conventions, keep Fanzloud/Loom/Bee Swarm/Fleet as
  reference-only and runtime/state isolated, and add HAI through root path-scoped CI.
- 2026-09-05 — Accepted T-002 report
  `b81518b846164f7b55c7ec1185bd558f87168801d66d4c527639a9e889d6e58c` with these
  dispositions: use stream epoch plus event sequence; fence restore callbacks with restore
  generation and Run lease epoch; scope idempotency by principal/project/operation/key; retain the
  separate execution ADR because external-dispatch uncertainty is a first-class P0 risk; keep the UI
  interaction mini-SDD as a fifth, presentation-only contract.
- 2026-09-05 — Accepted T-003 report
  `37dc8011c3fc56c9b9b56d44a059309dc1775f146f9fed8f612833b8b42a0da9`: select
  Board-first IA, restore the required Review phase, keep Blocked orthogonal with a single-card
  projection, and require drag/keyboard/single-click command parity plus focus recovery.
- 2026-09-05 — Accepted the Board-first interactive checkpoint
  `3a8cdcf9ad5306945215adeec2c946bf16d452a036b76eb55c7bba3fa02ce671` after local
  Chrome rendering at 1024px, 736px and 360px. This accepts IA and responsive hierarchy only; it is
  not frontend implementation or accessibility acceptance evidence.
- 2026-09-05 — Accepted T-005 report
  `621751635806dd8e20384c08ab9319388aa692afacbee1b3c0b60a2cb09f4190`: use
  `/api/v1` projections, typed command ingress, command-result lookup, epoch/sequence SSE and
  Project-bound digest artifact reads. Actor identity comes only from the authenticated session;
  OpenAPI owns wire shape while Go owns authorization, canonicalization and all domain guards.
- 2026-09-05 — Accepted T-006 report
  `e16118fc2b2d5f60442f3e23dea434a1cd5a9478e958bcb5a9c1e4ba3ce8ff93`: freeze
  Go 1.27.1, Node 24.20.0 LTS, pnpm 11.25.0, React 19.2.8, Vite 8.2.2, Tailwind
  4.3.3 and the recorded compatible test/lint pins. shadcn 4.21.0 is a controlled source generator,
  not a runtime package. Dependency resolution, supply-chain, CI and test evidence remain NotRun
  until their bootstrap tasks execute.
- 2026-09-05 — Accepted T-004 report
  `c0cc1978642d671e0692e735b4981faf86df1da9986f279e01711522389d58ea`: select
  `modernc.org/sqlite@v1.58.0`, which linked SQLite 3.53.4 and passed the bounded functional/race,
  CGO-off, repetition, module/license and point-in-time vulnerability checks in Go 1.27.1. Adopt
  per-connection PRAGMA assertions and writer-quiesced `VACUUM INTO`; product crash/disk-full,
  manifest publication, restore generation and non-amd64 evidence remain NotRun.
- 2026-09-05 — T-007 report
  `bf37ccce909eb9a305a861a74f680a31f3f5f9c0162583fb219e8267fb982212` correctly
  failed G0: T-010 violated its dependency ordering, and OpenAPI lacked full Attention/Impact/detail,
  typed SSE data and operation/payload discrimination. T-010 returned to Pending; OpenAPI candidate
  `1da69ce956db58d9b505f0e546fad3c6f87a567fc91152bfd61a1d082ef4a02e`
  now supplies those contracts and passes Redocly 2.51.2 with no warning plus a mismatched-payload
  JSON Schema rejection check. T-008 must independently re-review; this disposition is not a pass.
- 2026-09-05 — T-008 report
  `9f661687f996621c14e0b359ef9b0041e05a279567c8aea67924446ebbc18e08` correctly
  failed G0 because SDD §14 still described already-adopted SQLite, API, UI and traceability choices
  as open. The section is now rewritten as resolved design decisions, while later product checks
  remain explicit NotRun. T-009 must independently verify the repaired design set; this disposition
  is not a pass.
- 2026-09-05 — T-009 report
  `a8edf24cdabc0347fc0ed3756507d0e3e470833c953d900b1a6ce71ecdeb6d94` correctly
  failed G0 because its required pinned Redocly lint environment was absent and pulling/installing
  was outside reviewer scope. All other executed status, schema-instance and graph checks passed,
  but they do not substitute for the NotRun lint.
- 2026-09-05 — The orchestrator bootstrapped the official `redocly/cli:2.51.2` image as immutable
  digest `sha256:2dcc3939c2180e1da96db06a40aa079cb32c4ef3bac8b35ff061f2140322da64`.
  A read-only lint of `api/openapi.yaml` exited 0 with no finding. This setup result is evidence for,
  not acceptance of, the candidate; T-011 must independently rerun it.
- 2026-09-05 — Accepted T-011 report
  `25f52053643dfb2ad9c12bf3dff6475eb8588e09a9c7a5d13bd53141841522f7`: the
  independently rerun digest-pinned, network-disabled and read-only Redocly 2.51.2 lint passed with
  no warning/error; legal/mismatched command instances, all 21 bindings, projection contracts and
  the 21-node/31-edge acyclic spec graph also passed. Later implementation evidence remains NotRun.
- 2026-09-05 — T-010 accepted the G0 SDD, six ADRs, five mini-SDDs, OpenAPI and traceability set for
  P0-A implementation. This accepts design contracts only and unlocks T-020/T-030; it does not
  claim G1, runtime, CI, restore, release or production readiness.
- 2026-09-05 — T-031 report
  `42726f6b423b04e0e0f52b0c4bfd8a7752c5916493ee686586ae77f329dfa466` correctly
  failed T-030 acceptance: functional source and pinned format/lint/type/test/build checks passed,
  but Playwright/axe package pins, shadcn registry/icon provenance and generated-output cleanup were
  incomplete. Browser accessibility remains explicit NotRun. T-032/T-033 own the narrow repair and
  re-review; this disposition is not a pass.
- 2026-09-05 — T-021 report
  `bee03e005d89ed3e32087f1f8761475325ab1c4b708129d567762733ac9425fd` correctly
  failed T-020 acceptance: public transition guards reject Done and all pinned checks passed, but
  `NewWorkItem(..., PhaseDone, ...)` can construct Done without the subject-bound gate or a
  CompletionRecord. T-022/T-023 own the narrow authority repair and re-review; this disposition is
  not a pass.
- 2026-09-05 — T-032 report
  `e21aaee9621172339242b053f8d98cc544f14c9f5a2826bda1a0425bdf8231fe` reports the
  narrow T-031 repair: exact Playwright/axe pins and lockfile, complete shadcn registry/base/colour/
  icon/hash provenance, clean generated paths, and repeated format/lint/type/test/build checks.
  Browser-level evidence remains NotRun. T-033 must independently verify; this is not acceptance.
- 2026-09-05 — T-022 report
  `d69bdb8ed28f1729b3806a81df7b8275b5927d512cd0f3167aab1bce0d047f85` reports the
  narrow T-021 repair: public construction and transition both reject Done, while an external-
  package regression proves gated completion returns Done and its exact-subject CompletionRecord
  together. Pinned Go checks passed; T-023 must independently verify before acceptance.
- 2026-09-05 — T-023 report
  `bec1c433d5539af86ad4bacebf8342484ca81030f1baa63f162c8eef101d5440` correctly
  retained a FAIL after the parent requested immediate publication: source/boundary and primary Go
  gates passed, but test-list, authority/module and go.sum-absence checks were NotRun. The
  orchestrator reproduced all three with exit 0, but T-024 must independently rerun them; this is
  not acceptance.
- 2026-09-05 — Accepted T-024 report
  `309a209287a54454e1b713f56cc34e531654c333c92954cf19fa26f94e351967`: all three
  missing pinned inventory checks passed against unchanged hashes. Together with T-023's passing
  source/boundary/format/vet/unit/race evidence, this accepts T-020/T-022's pure-Go kernel only.
- 2026-09-05 — Accepted T-033 report
  `fb0cb6c2f5216feaa1a0a5debbaa2c6e4f926395332ebcc4017993db10383cd7`: exact web
  pins/provenance/hashes and clean generated paths passed; pinned frozen install, format, lint,
  typecheck, all 8 fixture tests/full jsdom axe and Vite build passed in an isolated copy. This
  accepts T-030/T-032's static fixture shell only; browser contrast/zoom/coarse-pointer remains
  explicit NotRun for broader G1.
- 2026-09-05 — Pre-push `teamctl.py validate-report` passes T-001..T-006, T-009, T-020, T-021,
  T-030 and T-032, but rejects T-007, T-008, T-011, T-022, T-023, T-024, T-031 and T-033 because
  their multi-line reviewer evidence does not match the worker validator's single-line verification
  entry grammar. Their visible PASS/FAIL semantics and hashes are retained rather than rewriting
  history before push. A later document-tooling task must define/normalize a reviewer-report
  contract and update dependent hashes atomically; this is process debt, not product-test evidence.
- 2026-09-05 — Accepted T-012 through independent T-013 report
  `0db20bdab8a8c085d3adbed1589dce5540cf5063711d7be1c5c33a6c0108e5da`: the forward-only
  reviewer profile preserves all 19 historical report bytes/hashes and records the current
  validator's exact 11-pass/8-fail compatibility inventory. Future reviewer evidence uses one
  physical Verification line per result and validates before handoff. Syntax compatibility remains
  process metadata, never an acceptance oracle; a future reviewer-aware validator adds a new
  source-digest-keyed overlay rather than rewriting history.
- 2026-09-05 — T-053 report
  `f984aac52ea00022c0de3aeb573c158294686a5aad85cf281a801e9e728797ad` correctly failed
  T-043 acceptance: the migration prevents retained re-completion history, the public persistence
  port cannot express T-044's required atomic command transaction, SQLite busy handling relies on
  message text, and the adversarial rehydration/project-scope/determinism/optimistic-mutation
  evidence is incomplete. T-054 owns the bounded repair; this disposition is not a pass.
- 2026-09-05 — T-054 report
  `7c11a63198b68ac120e23aa690e51fcea507da1ff7ade5df71ad5a448356126b` remains PARTIAL:
  it repaired historical completion identity, explicit path/clock authority, typed SQLite busy
  classification and the first public UnitOfWork/audit/event allocation seam, but explicitly skipped
  the real-lock, completion-material and exhaustive corrupt/project association attacks. T-056 owns
  those remaining checks; this report is not acceptance evidence.
- 2026-09-05 — T-057 report
  `37b18b7980f27e8d71ff27847dc9f17fc212155075cac22845598cd0ca27c094` correctly failed
  the repaired SQLite candidate after all other pinned/application-only/path/project/lock/corruption
  gates passed: a CompletionRecord with an Approval join but no immutable approval-consumption row
  still rehydrated as Done. T-058 owns only this one-to-one consumption repair; this is not a pass.
- 2026-09-05 — T-058 report
  `a97086b7b5f3435a1b07c7ac37976e257c938d1982b8d7ddcf11dc3cddd6006a` reports the narrow
  one-to-one Approval/consumption repair: nineteen corrupt-Done cases include missing and balanced
  duplicate/missing consumption, while multi-Approval, approval-free and ten rollback seams pass.
  The orchestrator has not accepted it yet because T-061 must close two final T-044 persistence-port
  omissions and immutable-field protection before one fresh combined review.
- 2026-09-05 — T-061 report
  `593eb2c547e1c361ee356d3c228d5e45bbfbac71cdd8967c189c1f48e7a0cab8` reports the bounded
  forward-contract repair: canonical success/failure response bytes survive project-scoped replay
  with digest verification, Evidence verifier role survives reload, and command/event plus mutable-
  record identities have database-enforced immutability with legal state controls. Its pinned Go,
  named SQLite, full, race, license/import and report gates passed, but it does not accept itself.
  T-062 must independently review the combined T-058/T-061 bytes before T-044 may start.
- 2026-09-05 — T-062 report
  `df9adfd90d1a3e72ade61f6ea98736680ce77c826a63c9a11b7607d5324829f4` correctly failed the
  combined candidate after every other pinned, replay, corruption, Done, approval, verifier, V1,
  busy, path, project, rollback and race gate passed. Its application-only probe proved the public
  port cannot persist immutable canonical CommandSuccess bytes containing the real allocator-owned
  audit sequence and projection cursor: allocating first hits immediate command-result FKs, while a
  placeholder cannot be replaced. T-063 owns only commit-deferred transaction-local FK ordering and
  its non-predictive/rollback oracle; T-064 must freshly review the repaired bytes. This is not
  SQLite acceptance and T-044 remains blocked.
- 2026-09-05 — T-063 report
  `38513b1da78d531dce50abb888529c38fd3ef5f08dfe8ee5de1d23a648517744` reports the narrow
  ordering repair: only Approval-consumption, audit-group and outbox command-result FKs are
  commit-deferred, while idempotency remains immediate and command results remain digest-verified
  INSERT-only. Its allocator->canonical-bytes->result replay and missing-result commit rollback
  oracles plus pinned full/race gates pass. This worker report does not accept itself; T-064 must
  independently attack the repaired final bytes.
- 2026-09-05 — Accepted T-064 report
  `bdd7bfd9522d1cc7e488823ef3e3151b9852c1f036f9b8b9c7fd37f4e984dd8e`: a fresh report-only
  reviewer independently exercised application-owned allocation ordering against the real Store,
  commit-time missing-result and cross-project failures, immediate idempotency, all named SQLite
  adversarial suites, full/race tests, schema/trigger/FK inventories and import denial. The
  orchestrator inspected the report-only diff and reran pinned module/format/vet, the allocator
  oracle, full and race gates successfully. This accepts the combined T-043/T-054/T-056/T-058/
  T-061/T-063 SQLite foundation; T-062 remains an immutable historical FAIL.
- 2026-09-05 — T-044 report
  `e7e2b87447c1ec6f0b454574e6dff69aeb4d8fb2ea8837aa71301810f2609575` reports a bounded
  application-command implementation with pinned unit/SQLite/full/race gates passing. It does not
  accept itself; T-065 independently found three cross-boundary blockers.
- 2026-09-05 — T-065 report
  `fe49ad687ea743756bdba037fd7211f06883a6f8cfb3ca4a24aca5cdfc5fb7ec` correctly failed T-044:
  real-Store completion hits `completion_record_required` because Done is updated before the record,
  Dispatch calls the executor declaration inside UnitOfWork, and the canonical codec accepts an
  OpenAPI-forbidden unknown property/out-of-enum failure code. T-066 owns only these repairs and
  T-067 must freshly review; all other pinned gates passed.
- 2026-09-05 — T-066 report
  `a41772e9a835edb1255b4dc46ab85a198431f45b7ae5adc263aa055f0ced4c6e` reports the bounded
  three-file repair: CompletionRecord now precedes Done, executor declaration is cloned at
  construction, and canonical stored results enforce closed OpenAPI shapes/codes and byte identity.
  Its named, real-Store completion/replay, full and race gates pass; this worker report does not
  accept itself and T-067 must freshly attack the repaired bytes.
- 2026-09-05 — Accepted T-067 report
  `9ac88514c6a875d0ab1fa13897dd97a9a311054c1e86c41671db8d82d5241fa2`: a fresh report-only
  reviewer independently reproduced T-065's three attacks and passed them after T-066. Its real-
  Store probe proved Done/version 6, exact joins/Approval consumption, allocator sequence/cursor 3,
  byte-exact replay and late-failure total rollback; executor construction-only declaration and
  strict five-operation/fifteen-code canonical matrices passed. Pinned application/SQLite/full/race,
  idempotency, completion-gate, import/hash/scope and cleanup gates also passed. The orchestrator's
  separate pinned module/format/vet/named/full/race rerun passed. This accepts T-044/T-066; T-065
  remains an immutable historical FAIL and T-045 remains NotRun.

## Current development boundary

- T-040 is in progress through the accepted serial T-043..T-047 child design. T-044 is accepted
  after T-066/T-067. The next child is T-045 deterministic Fake work, but no T-045 execution envelope
  is issued in this continuation. Fake, HTTP/SSE, vertical integration, real providers, Slack/Lark,
  deployment and release remain NotRun/forbidden.

## Resume

1. Read this file and `products/hai-taskboard/AGENTS.md`.
2. Verify branch `agent/hai-taskboard-p0a` and baseline ancestry.
3. Read the latest accepted ADRs and `docs/HANDOFF.md`.
4. Select only the next `Ready` task whose dependencies are accepted.
5. Never infer acceptance from a worker report or prior chat.

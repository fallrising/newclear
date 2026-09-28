# Mini-SDD: Decisions, attention and external ledger import

Status: **Proposed** (2026-09-28). Not accepted. Per HAI-DELIVERY-001 no production behavior may
precede acceptance of these clauses and their named oracles. Acceptance means the owner merges this
file and `.team/PLAN.md` gains the corresponding tasks.

Parent: `../SDD.md` (§5 domain, §6 HAI-EXEC-008, §8 API, §9 Attention, §12 delivery).

## 1. Why

The P0-A core already enforces the hardest control-plane properties: authority separated from
projections, subject-bound evidence, a server-side Done gate, idempotent commands and fenced leases.
Three things a single operator needs every day are still missing:

1. **Questions from workers have no home.** HAI-EXEC-008 names Question/Blocker as a WorkItem-level
   fact, but the V1 schema has no Question or Decision record. A worker that needs an answer can only
   become a blocker with free text; two workers asking the same thing are answered twice.
2. **Attention is a fixture.** The web Attention surface renders static data. The operator cannot
   see "what needs me now" from real state.
3. **There is no way in.** Work is tracked today in an external, private, file-based Markdown ledger.
   HAI Taskboard cannot show that work without retyping it, and the SDD forbids bidirectional
   Markdown/DB synchronization.

There is also no root CI workflow for this component.

## 2. Scope

In scope: Question and Decision records; an Attention projection over real state; a read-only,
one-way import of an external ledger snapshot; a root CI workflow.

Out of scope: real providers, chat integrations, writing back to the external ledger, automatic
answers to Questions, semantic duplicate detection, cross-project dependencies.

## 3. Question and Decision

- `Question`: immutable record raised against one WorkItem (optionally one Run) with `prompt`,
  `sources_consulted` (list of references), `affected_subjects` (WorkItem IDs and/or accepted spec
  paths), `options` (ordered, each with a label and consequence), `recommendation` (option label +
  rationale) and `blocking_level` (`blocks_work_item` | `blocks_run` | `advisory`).
- `Decision`: immutable operator answer to one or more Questions: chosen option or free-form answer,
  rationale, scope (`affected_subjects`), and an optional expiry.

Clauses:

- **HAI-DEC-001** — Question and Decision MUST be distinct records from Blocker, Approval and Review.
  A Decision is a design confirmation; it MUST NOT authorize execution side effects or satisfy any
  Done-predicate term.
- **HAI-DEC-002** — Raising a Question with `blocks_work_item` MUST add a blocker to the WorkItem in the
  same transaction (HAI-DOMAIN-003 still applies). Recording a Decision that answers it MUST clear
  only that blocker.
- **HAI-DEC-003** — Before a new Question is stored, the service MUST look up existing open Questions
  and current Decisions in the same project whose `affected_subjects` intersect and whose normalized
  `prompt` digest matches exactly. A match links the new Question to the existing one instead of
  creating a second item in Attention. Exact-digest matching only; semantic similarity is out of scope.
- **HAI-DEC-004** — A Decision that names several Questions answers all of them atomically. The
  Decision's scope, not the Question, determines which WorkItems it unblocks.
- **HAI-DEC-005** — When accepted spec bytes change for a subject in a Decision's scope, the Decision
  MUST be projected as `Decision-Stale` (same rule shape as `Done-Stale`); it is not rewritten.
- **HAI-DEC-006** — A Run that interrupts on a Question does not resume automatically; answering MAY
  authorize a new Run (HAI-EXEC-008 unchanged).

## 4. Attention projection

Attention items are derived, never stored as independent truth (HAI-API-005). Categories, in the
order shown to the operator:

| Category | Derived from |
| --- | --- |
| `decision_needed` | open Questions (after HAI-DEC-003 linking) |
| `authorization_needed` | pending Approval requests for an exact command subject |
| `acceptance_ready` | WorkItems in `QA` whose Done predicate has no unmet term except the operator's own action |
| `exception` | `OutcomeUnknown`, `NeedsReconcile`, corrupt/missing artifacts, stale ImpactPlans, `Decision-Stale` |
| `changed_since_last_visit` | projection events after the operator's last acknowledged cursor |

- **HAI-ATTN-001** — Each item links to the exact subject and shows the reason code; it MUST NOT show
  progress percentages (HAI-UX-001) or activity-feed entries without an action.
- **HAI-ATTN-002** — `acceptance_ready` MUST be computed by the same predicate code path as
  `CompleteWorkItem`, run read-only; it MUST NOT diverge from the gate.
- **HAI-ATTN-003** — The web Attention surface MUST read this projection through the API. Fixtures
  remain test data only.
- **HAI-ATTN-004** — The projection exposes counts per category so a client can apply a
  review-queue limit (for example, stop releasing new work when `acceptance_ready` exceeds a policy
  threshold). The limit itself is policy data, not hard-coded.

## 5. External ledger import (read-only)

The external ledger is a Git repository of Markdown files with YAML frontmatter
(`id`, `title`, `status`, `parent`, optional `repo`, optional `depends_on`) organized as
goal → plan → task. Its exact field set is provided as a versioned import profile; this document does
not copy the private ledger's rules.

- **HAI-LEDGER-001** — Import reads an immutable Git commit of the ledger, validates it against the
  import profile, and produces a **read-only mirror project**. The ledger stays authoritative for
  everything imported.
- **HAI-LEDGER-002** — Mirror WorkItems MUST reject every state-changing command with a stable
  `external_authority` error. The Board, detail and Attention surfaces show them with their source
  path and commit.
- **HAI-LEDGER-003** — Re-import of a newer commit replaces the mirror atomically (import revision N+1);
  it never merges field-by-field and never writes to the ledger.
- **HAI-LEDGER-004** — Ledger `status` maps to phase for display only:
  `todo`→`Ready`, `doing`→`Developing`, `blocked`→ blocker, `review`→`Review`, `done`→`Done`,
  `dropped`→`Canceled`. The mapping is part of the versioned profile.
- **HAI-LEDGER-005** — Moving authority for a project from the ledger to HAI Taskboard is a separate,
  explicit, one-time migration per project, consistent with the bootstrap rule in `.team/PLAN.md`.
  It is not part of this slice.
- **HAI-LEDGER-006** — Imported text is untrusted data (HAI-BOUNDARY-004); it is rendered, never
  executed or interpreted as instructions.

## 6. CI

- **HAI-CI-001** — A root workflow `.github/workflows/hai-taskboard-ci.yml`, path-scoped to
  `products/hai-taskboard/**`, runs backend `go test ./...` and `go test -race ./...` with the pinned
  toolchain, and web lint/typecheck/unit tests with the pinned Node/pnpm (see
  `docs/reproducibility.md`). It follows `docs/specs/monorepo-ci.md` (no deploy, no secrets).

## 7. Oracles

| Clause | Oracle (named test) |
| --- | --- |
| HAI-DEC-001 | `TestDecisionCannotSatisfyDonePredicate` |
| HAI-DEC-002 | `TestBlockingQuestionAddsAndDecisionClearsOnlyItsBlocker` |
| HAI-DEC-003 | `TestDuplicateQuestionLinksToExisting` |
| HAI-DEC-004 | `TestDecisionAnswersQuestionsAtomically` |
| HAI-DEC-005 | `TestSpecChangeMarksDecisionStale` |
| HAI-ATTN-002 | `TestAcceptanceReadyMatchesCompletionPredicate` |
| HAI-ATTN-003 | web: `attention-reads-projection.spec.tsx` |
| HAI-LEDGER-001..004 | `TestLedgerImportMirrorIsReadOnly`, `TestLedgerReimportReplacesAtomically` |
| HAI-CI-001 | the workflow runs on a PR touching `products/hai-taskboard/` |

## 8. Suggested order

1. HAI-CI-001 (no product behavior; lowers the cost of everything after it).
2. Question/Decision records and HAI-DEC-001..004 with a migration `0002`.
3. Attention projection and API; then switch the web surface off fixtures.
4. Ledger import.

## 9. Open decisions (owner)

- Whether this slice precedes the already-planned persistent outbox slice (HANDOFF "Safe next action").
- FE review D1/D2 (routing; when the UI connects to the backend) — item 3 above forces D2.
- Whether `Decision` needs an expiry at all in P0-A.

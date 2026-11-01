# WorkItem material-index planning evidence

T-0339/HMDTL. Source9f3f72af3940a106877f86c4b43e39a3dfcd72c8, product unchanged from#902 at intake.
[Proposed contract](../plans/work-item-material-index-20261101.md). This report accepts no product behavior.

## Scope and status

DTL-PLAN-01 maps M2 obligations to delivered identity/policy/coverage and remaining full-detail gaps.
DTL-PLAN-02 proposes a separate bounded authenticated metadata/AC/Run/Candidate index, with explicit
D1 owner decision. DTL-PLAN-03 requires reviewed dispositions, document gates and Git/CI/readback/ledger.
IDX-AC-01..06 are fixed but NotRun; production, OpenAPI, accepted SDDs, migrations and dependency files
are unchanged. Complete M2/M3/product acceptance stays pending. No UI/provider/release/deploy.

## Independent source audit

One native read-only T001 inspected schema, ports, service and SQLite. Report DONE covers only its
read-only inventory; source facts are not newly run tests. It identified absent blocker metadata,
generic review class/evidence time, approval request/decision time, complete historical subject
fields and universal WorkItem history association. Root source-check agrees. Dedicated metadata
index preserves the existing full WorkItemDetail contract; no empty-array or timestamp fabrication.
No native writes, tests, network or children. Root saved the report and validated task/report contracts.

## Claude plan review

CLI2.1.312, exact requested/observed claude-opus-5-5/high, supplied public packet only. Safe mode,
empty tools, strict MCP, no session persistence and no children;480s host deadline. User config digest
matches the previously observed profile; project/local/managed configs absent. Effective custom hooks
are disabled by safe-mode; no global settings/auth changes.

Initial REWORK72.286s, exit0, no permission denials/children,1turn. Reported input2/output6959,
cache-read649/cache-created37713, list-priceUSD0.4410218, not billing. Findings:

- B1: explicit canonical path→method→session→project authorization→item syntax→query/body→storage
  precedence; HEAD405/Allow:GET and raw dot-segment interception prevent automatic ServeMux redirects.
- B2: return both Initial/Impact recorded relations with acceptance_kind, no activation or promise of
  downstream support; cite composite head FKs and enabled foreign-key enforcement. Test project-only
  head plus unaccepted item separately from malformed relations.
- B3: preserve legacy generic80 AC vocabulary separately from accepted120; cite supported writer
  invariants for metadata/ID/timestamp, use guarded Done rehydration with blocker preflight. Drop
  candidate/input semantic equality from discovery rather than assume all historical port fixtures
  satisfy a newer writer invariant. Downstream authoritative reads retain their guards.
- N1–N6: byte-limit prose versus JSON character length, board-compatible cursor semantics, closed Run
  vocabularies, legacy non-addressable candidate IDs, accepted/legacy distinction and strict error details.

The one material-revision follow-up returned **ACCEPT for presenting D1**,66.564s, exit0,
no permission denials/children,1turn. Reported input2/output6601, cache-read1545/cache-created28903,
list-priceUSD0.363561, not billing. Both calls total138.850s/list-priceUSD0.8045828.
Reviewer resolved B1–B3 and explicitly allowed root to close these source/editorial conditions
without a third review:

- C1 closed: migration0001_v1.sql:86–90 CHECK constraints exactly match all five declared stored
  Run vocabularies. Corrected prose: desired_action and side_effect_outcome are new index fields,
  not existing RunSummary fields; Reconciled maps to Resolved.
- C2 closed: sqlite/initial_acceptance.go:140–171 writes accepted/current requirements from
  identical m.Bindings/b.ACs loops inside the same transaction;290–305 validates current cardinality
  and membership. FKs alone establish only subset membership. The sole current acceptance writer
  establishes equality; no unsupported Impact writer is claimed.
- C3 closed: name instance_state.restore_generation; label Impact as schema-valid injection,
  not lawful command history; clarify the blocker-capacity difference from board rehydration
  while preserving the index's separately declared collection/response bounds.

No unresolved reviewer blocker remains for the proposal. Root accepts DTL-PLAN-01/02 planning
evidence only. Required D1 owner contract approval is separate from reviewer acceptance;
no implementation or IDX product acceptance is authorized by this review.

## Observed checks and retained failures

Final `python3 scripts/check_project_success.py`:51 contracts pass;
`python3 scripts/check_indexes.py`:9 indexes/0errors;
local link/anchor checker:8Markdown/204links pass (including private worker task/report).
Task/report validators pass.318 untouched tracked product files are hashed separately from changed
navigation/BOARD. Production tests, API lint and code review are NotRun for this docs-only work;
required repository CI on any published documentation head still runs unchanged.

The first local document-edit helper failed SyntaxError due to an unescaped apostrophe; no document
mutation occurred. Original helper/failure retained; quoting corrected and logged rerun passed.
No product failure was hidden or acceptance weakened. Raw prompts/results, metadata, source hashes,
failed helper and document outputs remain in the private durable handoff after delivery.

Aggregate outer/nested tool calls, provider requests/retries, billing and active/wait totals unknown/null.
Observed native leaf1; external launches and measured model usage are recorded per review, not inferred
as hosted request totals. Git/CI/remote receipts and final root evidence-gate follow once observed.

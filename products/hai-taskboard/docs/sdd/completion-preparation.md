# Mini-SDD: Authenticated completion preparation

Status: **Owner-approved C02 scope (2026-10-30); independent contract and implementation reviews ACCEPT; local verification passed, delivery in BOARD**.
Parent: [SDD](../SDD.md) HAI-API-001, HAI-DONE-001..004, HAI-DELIVERY-001;
[runtime integrity](runtime-integrity-predecessors.md), [current inputs](current-specification-inputs.md).
Task: T-0339 / HM1A. Baseline: `6b7bf17c010f6a354f7abf3676f994f7ae2d19ec`.

## Scope and source reconciliation

The owner approved [C01/C02/C06](../plans/m0-contract-decisions-20261029.md) and requested current
HAI design documents as the development basis. At intake, remote main's last HAI change remained
PR799 (`d179894f7f38ecba0d9243cb4368c86215bfea0e`); the product tree was unchanged and no open HAI
design PR was found. The [remaining-work plan](../plans/remaining-work-20261029.md) already includes
the newer [Kanzo design](kanzo-inspired-usability.md), which retains its Proposed follow-up status.
This slice implements M1a only. Outputs/artifact reads, human report persistence, arbitrary policy
management, AC validator alignment, coverage, UI completion, restore and real adapters remain later slices.

## Contract

- **HAI-PREP-001** — Expose `GET /api/v1/projects/{project_id}/work-items/{work_item_id}/candidates/{candidate_id}/completion-preparation`
  through a narrow optional application reader interface implemented by `Service.DescribeCompletion`.
  Authenticate and authorize the project before any material read. Apply existing canonical path,
  session and runtime Host enforcement; GET follows existing read Origin semantics (no new mandatory
  Origin header). Invalid resource identifiers and unauthorized/mismatched project/item/candidate
  return non-disclosing `404 not_found`; missing session returns `401 unauthenticated`; noncanonical
  path returns `400 invalid_request`. Candidate is a nonempty path-safe token of at most 80 ASCII
  characters (`A-Z`, `a-z`, `0-9`, `.`, `_`, `-`), excluding `.` and `..` alone. This route does not
  broaden the existing command candidate contract. Missing reader capability is `503 projection_unavailable`.
- **HAI-PREP-002** — Return the exact bounded snapshot already prepared by the application:
  `expected_version`, `phase`, `completion_subject`, `completion_subject_digest`, `lease_epoch`,
  `restore_generation`, `approval_required`, `verification_rules`. The subject contains the exact
  project/item/candidate, candidate/run/input/graph/policy/recipe digests, required AC revisions and
  optional integration-base digest. In Review the subject uses the prospective QA version
  (`expected_version + 1`); in QA it uses `expected_version`. This is material for explicit intent,
  never a reservation, gate result, coverage or `can_complete` assertion. CompleteWorkItem must still
  recheck all authoritative inputs and the Done predicate transactionally. The read writes no domain,
  command-result, audit, projection or outbox rows, consumes no Approval, and invokes no executor.
- **HAI-PREP-003** — Preserve existing two-snapshot identity checks around bounded candidate artifact
  verification outside SQLite writer locks. Existing limits remain 1024 records per material collection,
  10 MiB per object, 50 MiB total. Response bytes are bounded to 1 MiB. Transport validates a complete
  closed schema, required fields (including false booleans), nested fields, positive SQLite-safe numeric
  versions/fences, Review/QA phase, scope equality and recomputed subject digest. AC revisions and rules
  are sorted, unique and have the same exact AC set; AC IDs retain the accepted 1..120 UTF-8-byte bound.
  Rules retain the Run-input bounds: required verifier class <=128 UTF-8 bytes, optional prohibited
  actor <=120 bytes and optional prohibited Run role <=128 bytes, no controls (actor also no whitespace
  or slashes), nonzero environment digest. Invalid application response is `503 storage_corruption`,
  with no partial response or internal text leakage. Every response uses `Cache-Control: no-store`.
- **HAI-PREP-004** — Preparation error precedence: (1) canonical/auth/scope; (2) malformed or
  inconsistent persisted material is storage corruption; (3) changed captured/current identity,
  including accepted bindings/ACs/graph, policy revision/recipe, adapter/scenario, approval requirement,
  integration base and existing complete verification rules is `409 stale_subject`; (4) only when
  all comparable identity is current, a missing required verification rule or zero environment binding
  is `409 policy_rejected`, `error.details.reason = verification_policy_incomplete`. Missing policy
  data must not mask another stale field or corrupt stored envelope. Changes between the two reads
  also retain stale precedence, even when the second snapshot loses a rule. No persisted material is
  repaired and no captured rule is silently substituted for an absent trusted current rule to grant
  success. Existing mutating commands retain their classifications in this slice.
- **HAI-PREP-005** — Use the existing APIError envelope and sanitized stable messages. Known stale,
  policy, lifecycle (`422 lifecycle_rejected`), not-found and storage errors retain their classifications;
  unrecognized dependency/cancellation failures return `503 projection_unavailable`. Policy details
  contain only the fixed reason above, never AC text, filesystem paths or raw errors. No retry or
  implicit command is performed. Required bounded artifacts remain read-only inputs, never response bytes.

## Fixed acceptance cases and named oracles

| ID | Given / When / Then | Executable oracle |
| --- | --- | --- |
| PREP-AC-01 | Given absent session, forbidden project or mismatched scope, When GET, Then no unauthorized material read and no resource disclosure; valid response is no-store | `TestCompletionPreparationHTTP_AuthScopeAndNoStore` |
| PREP-AC-02 | Given real SQLite admitted candidate in Review/QA, When GET twice and after reopen, Then exact stable subject/fence/rules, unchanged rows/version/phase and no Done verdict | `TestCompletionPreparationHTTP_ExactSnapshotWithoutWrites` |
| PREP-AC-03 | Given changed material or current but incomplete policy, When preparation, Then distinct stale/policy codes; stale plus missing policy remains stale, corrupt envelope remains corruption; no writes | `TestCompletionPreparationHTTP_StaleAndPolicyRemainDistinct`; service `TestCompletionPreparation_PolicyPrecedence` |
| PREP-AC-04 | Given malformed/cross-scope/oversized/extra/duplicate/null nested response or absent reader, When GET, Then fail closed without returning invalid bytes; legal boundaries pass | `TestCompletionPreparationHTTP_StrictBoundsAndCapability` |

Before production changes, create these named executable test skeletons and observe meaningful Red
against the old missing route / old stale-policy classification. Empty or skipped skeletons are not
acceptance evidence. Final verification: focused tests, unchanged pinned backend full/race/vet/build,
OpenAPI lint, existing web gate (shared API regression), project-success/index checks, independent
review and exact-head PR CI. Full browser flow is unchanged and not an M1a acceptance substitute;
M0's historical browser evidence retains its source and date.

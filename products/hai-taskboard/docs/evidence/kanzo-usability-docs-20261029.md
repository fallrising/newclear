# T-1029 — Kanzo usability documentation verification

Date: 2026-10-29 (Asia/Singapore)
Scope: documentation only; [task and authority](../tasks/BOARD.md#t-1029--kanzo-inspired-usability-documentation).
Source: `0111908492c32d0b01d561b24b6024737cb4f641`
Upstream tree: `329d536700a82d86caa8a8d62372ef44c5663689`
Claim commit: `57c581e312fdbfa96b219a884bf82289ecffc531`
Design: [Kanzo-inspired usability](../sdd/kanzo-inspired-usability.md)
Publication base: `354d8962d316e094e2301fa3aef54afc9de96f0c`
Publication base tree: `a5aece48df3b8a5464170d482951339958f1b158`

## Scope and provenance

The working snapshot was materialized from the current upstream Git tree. All 8,851 blob contents
were checked against their upstream Git object IDs; `git write-tree` matched the upstream tree
before edits. Cached Git objects supplied unchanged bytes; the authenticated GitHub app supplied
missing bytes and the branch/commit transport. No other checkout's uncommitted files were used.
The terminal HTTPS clone failed because its configured network proxy was unreachable; this did
not block repository access through the app. Changes use a dedicated branch, atomic Git trees,
an expected previous ref and non-force fast-forward updates, followed by remote read-back.

Before publication, main advanced by four commits affecting 17 paths, all outside HAI Taskboard.
Those upstream bytes were integrated into the isolated validation snapshot, verified against Git
object IDs, and the baseline tree again matched the publication base. The final document checks
below use that updated snapshot. Publication preserves the claim commit and includes current main
as a parent; it does not overwrite the intervening work.

Only product README/SUCCESS, quickstart, the main SDD navigation link, the new mini-SDD,
the current task board and this report are writable. No runtime, API, dependencies, CI, credentials,
AGENTS, historical acceptance records or product AC status is changed. Source/review metadata in
SUCCESS records this static audit; earlier runtime evidence retains its original dates and scope.

## Documentation acceptance

| AC | Result | Evidence |
| --- | --- | --- |
| DOC-01 | Passed — documentation | Entry documents distinguish runnable Fake development, incomplete full P0-A and unavailable real-agent use; source reviewer accepted the historical-evidence qualification. |
| DOC-02 | Passed after rework — documentation | HAI-KZ-001..010 have contracts, dependencies, authority boundaries and Proposed/NotRun oracles; both independent reviews closed with ACCEPT after the corrections below. |
| DOC-03 | Passed — local document checks | Seven Markdown paths only; local links/anchors, unchanged product AC and P0-A scope, project-success/index preflight and independent document review passed. Required PR checks remain a separate head-specific result. |

## Actual verification

| Check | Actual result and limit |
| --- | --- |
| `git diff --cached --check` | Exit 0; no whitespace errors. |
| `python3 scripts/check_project_success.py` | Exit 0; 45 project success contracts and navigation/index pass. |
| `python3 scripts/check_indexes.py` | Exit 0; 45 project contracts, seven llms.txt files and index preflight pass. |
| Scoped Python document audit | Exit 0; exactly the seven authorized Markdown paths; all local links and referenced heading anchors resolve; ten unique HAI-KZ clauses each have a Proposed/NotRun oracle row. |
| Scope/acceptance comparison | Original AC-01..04 table rows and H01..H04 rows are unchanged; mainline/usable_tag unchanged; the normative SDD before References is byte-identical. No runtime/API/AGENTS/dependency/CI path is changed. |

The scoped audit compares the staged path set with the seven-file allowlist, uses the existing
`scripts/check_project_success.py` local-link helper plus Markdown heading checks, and compares
the existing AC/task rows and normative SDD against the materialized upstream baseline. It is a
one-off documentation check, not a new product test or an executable HAI-KZ oracle.

## Independent review

Two independent read-only reviews were performed: product/source fidelity and HAI contract/current
implementation consistency. The product review accepted the source mapping, selected workflows,
staging and preserved boundaries; its heartbeat/renewal clarification was incorporated and closed.

The source review initially returned REWORK: title-only capture did not specify the existing
required Goal and OwnerID. The correction explicitly maps Title to provisional Draft Goal and
uses the verified operator as OwnerID without accepting an AC. A closure review then caught an
incorrect HTTP empty-AC statement. Inspection of `CreateWorkItem` and `decodeRevisions` confirmed
that the request must send `"required_ac_revisions": []`; omission/null is rejected. The document
now states that exact behavior. Both findings and their corrections are retained here.

The final source closure returned ACCEPT with no unresolved finding. It also checked claim/start
phase separation, pending-Run duplicate exclusion, push/pull mutual exclusion, agent authority,
explicit heartbeat/lease renewal and rejection of stale/expired ownership.
Final reviewed mini-SDD SHA-256:
`574746838b77dcca1fe379dd04a8665bb22a897a7b87ca81d735fc8c485a5fd5`.
These are document acceptance decisions, not runtime, product, release or G2 acceptance.

## Product acceptance and delivery boundary

No runtime/browser/provider acceptance tests were run locally for this documentation task. Existing required PR checks
remain applicable and are reported by the PR at its actual head. Product AC-02/03/04 remain pending,
mainline remains incomplete, and no usable tag is created. Every HAI-KZ oracle is Proposed/NotRun.
Task rows remain in_progress until merge; this task stops at a Draft PR for owner review and does
not authorize merge, release or deployment.

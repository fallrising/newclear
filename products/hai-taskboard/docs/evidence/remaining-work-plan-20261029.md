# T-0339 remaining-work planning — review and verification

Documentation review: **ACCEPT after retained REWORK**. This is the pre-publication evidence
checkpoint; actual delivery and merge timestamps are recorded in [BOARD](../tasks/BOARD.md#t-0339--remaining-work-planning).

## Summary

The owner requested a documentation-first plan for unfinished P0-A and unimplemented designs,
reviewed by Claude and revised before delivery. The [plan](../plans/remaining-work-20261029.md)
routes H01..H04 into M0..M8, includes all ten Kanzo clauses and Decision/Attention/ledger proposals,
and separates current capabilities, future implementation, acceptance and required decisions.
Source: `a2c0b5116018160d5e5c24c10fa49c81adff806e`.
Desk claim PR 296 merged as `874ff981f433a6ea64953a9aea1edd833e6e4666`; task read back remotely.

Only six Markdown paths change: plan, this report, BOARD, README, SUCCESS and HANDOFF.
Runtime, API, dependencies, CI, accepted SDD/ADR, historical product acceptance rows and H01..H04
are unchanged. This planning milestone does not implement M0 or any M/U/D feature.

## Verification

| Requirement/check | Observed result and scope |
| --- | --- |
| PLAN-01 — coverage | All H01..H04, HAI-KZ-001..010 and Decision/Attention/ledger mapped; all v0.2 AC-01..54 and AC-P0A-001..016 routed; accepted mini-SDD clauses require explicit M0 inventory. Claude revision review confirmed no omitted registry item. |
| PLAN-02 — executable planning | Dependencies, bounded scope, future positive/negative acceptance and stop points specified; independent Claude ACCEPT after B1..B3 and H1..H7 corrections. |
| PLAN-03 — document checks | Scoped six-file audit passes local links/anchors and preserves original SUCCESS AC/metadata and H01..H04. Native success/index checks pass. Head-specific PR CI and merge are separate delivery evidence in BOARD/PR, not inferred from this report. |
| `python3 scripts/check_project_success.py` | Exit 0: 47 project success contracts and navigation/index. |
| `python3 scripts/check_indexes.py` | Exit 0: 47 project contracts, eight llms.txt files, zero errors. |
| `python3 .review-local/hai-plan/check-docs.py` | Exit 0: exact six Markdown paths, all local links/anchors resolve, unchanged product acceptance/status/metadata; no production, accepted SDD/ADR or CI change. The one-off audit is retained with local evidence, not installed as a product test. |

Precommit requires the staged version of the same audit (`--staged`) and
`git diff --cached --check`; actual output is retained with the local run and the PR description.
Component PR checks remain mandatory even for this document change. No local product/runtime/browser
acceptance suite was executed for this documentation scope; future oracles remain Proposed/NotRun.
Existing historical PASS, FAIL and PARTIAL results retain their original source and scope.

## Documentation

### Independent Claude invocation

Claude Code 2.1.312, requested and observed model `claude-opus-5-5`, requested effort `high`.
Model and CLI are separately identified. Each call is a fresh leaf review of a supplied public-source
packet; no inherited conversation, tool calls, MCP, recursive delegation, filesystem edit or Git action.
Installed help/config preflight checked available flags, the user model alias and hooks presence.
`--safe-mode` disables custom hooks/plugins/skills; `--tools ""` removes built-in tools;
`--strict-mcp-config`, `--permission-mode dontAsk`, `--permission-prompts none`,
`--disable-slash-commands`, `--no-chrome`, `--no-session-persistence` are explicit.
No bypass flag, provider installation, authentication change, model substitution or fallback was used.

Invocation shape (stdin packet; separate result/stderr files):

```sh
claude -p --model claude-opus-5-5 --effort high --safe-mode --tools "" \
  --strict-mcp-config --permission-mode dontAsk --permission-prompts none \
  --disable-slash-commands --no-chrome --no-session-persistence --output-format json
```

A Python subprocess wrapper used a new process group and `wait(timeout=480)`, with bounded
TERM/KILL cleanup only for that group on timeout. This is a no-tools review, not a claim of
OS-level filesystem sandboxing. Both calls exited 0, returned `is_error=false`, one reported turn,
zero permission denials and empty stderr; neither timed out. Exit 0 was inspected separately from verdict.

| Round | Result | Host elapsed | Packet SHA-256 |
| --- | --- | --- | --- |
| 1 | REWORK: B1–B3 blockers, H1–H7 corrections | 131.210 s | `88ff511e0f2eed225d1e31197081c33b52b04e37a68a6d9305d74941b5f081e1` |
| 2 | ACCEPT; B1–B3 closed, H1–H7 addressed; four nonblocking wording notes | 43.839 s | `a7e0d630d29166c08705edaaef9ee1ceb3e2cbeb89073caabe3ae7671243b194` |

Round-1 reviewed plan SHA-256: `877a97207522e87e896ad605ce8f8feac59fc2c75d3a4c0021587afa6c192aee`.
Round-2 reviewed plan SHA-256: `019c652b110ecca156eecf06f13af8af865077366381cafd06b6cbea9695535e`.
Final plan SHA-256: `9feb33f9e45143f13dbfdc74537affeb6a648012c8839b36cb9d06f87ece284d`.
After ACCEPT, root applied only the four recommended wording clarifications below and the review-status
line, then audited the final diff. No third model call or new feature decision was needed.

Raw reviewer-text digests (UTF-8 with final newline):
round 1 `f4b0227f705f675c376df5f42ccaa6822427522d3cde1d4c380a7ef461a537c6`;
round 2 `204118f678bc22a554516fd6fb272690870fb0179ac04257cb9847cc318bba51`.
Full packets, structured outputs, stderr, metadata and text responses are retained in private local
evidence with a README. They are not published as account/session metadata in this public repository.

### Findings and root disposition

| Finding | Revision / disposition |
| --- | --- |
| B1: accepted bootstrap SDD conflicts with current BOARD | Confirmed conflict, not dismissed as history. Plan §6 records precise future owner-approved SDD correction; M8 cannot accept while unresolved. No normative document changed. Ledger bootstrap reference also tracked. |
| B2: checkpoint/resume wrongly assigned to ContextPack | M5a now owns adapter checkpoint/WaitingHuman, supported binding revalidation and unsupported-profile interruption/new Run. v0.2 AC-19/20 routed there; M7 stays ContextPack-only. |
| B3: AC-P0A and accepted mini-SDD coverage omitted | Added AC-P0A-001..016 table and every mini-SDD source with per-clause acceptance inventory; M0/M8 share that complete list. Partial seams never promote durable integration. |
| H1: risk of duplicate status lineage | Clarified desk T-0339 is the overarching requirement; existing T-0980 H01..H04 stay mainline rows, HP01..03 only this docs slice. Future bounded tasks link both without duplicating H status. |
| H2: NotRun oracle described as reusable implementation | Changed to implement already-named NotRun oracles. Source search found no backend/web implementation of the exact restore/resume/ContextPack-redaction names; historical seam status remains. |
| H3: AC-32 and namespace ambiguity | M4 explicitly covers unauthorized edge/no-op changes; SUCCESS, v0.2 and AC-P0A namespaces distinguished. |
| H4: missing policy rule returned as stale | Preserved actual code observation. M0 must resolve whether intentional binding semantics or an API classification conflict; M2 tests the accepted matrix, not an invented immediate behavior change. |
| H5: missing report/Context/U2 dependencies | M6 includes M1c human reports in backup material; U2 graph includes CONTEXT; D1/D2 implementation is after M8 absent explicit reprioritization. |
| H6: obsolete ledger status/claim mapping | Proposed new versioned raw external-status profile; todo/in_progress/done and desk claims grant no HAI phase, Run, lease or completion authority. Old proposed mapping is not silently invalidated by this plan. |
| H7: next task too broad | M0 alone is next, with inventory/gates/conflict outputs; M1a requires separate subsequent activation. |
| Round 2: AC-34 routing | Explicit separate row makes M6 the projection-rebuild owner, integrated with M4. |
| Round 2: M5a dependency | M5a may start after M0 and accepted EXEC contract; complete M5 UI still awaits its own upstreams/integration. |
| Round 2: time-varying execution detail | Plan references applicable execution rules; this report keeps concrete timing/model limits. |
| Round 2: unspecified M1 existing tests | M0 must identify exact confinement/rollback tests and valid evidence; no pre-claimed PASS. |

Root accepted these findings after checking source. The first REWORK remains visible; future authority,
policy, capacity and adapter decisions are intentionally unresolved product work, not documentary defects.

### Execution/cost snapshot

Source/claim preparation began approximately 2026-10-29T16:53Z (estimate). The estimate was 30–45 minutes
active work, with a progress checkpoint every 20 minutes; CI wait boundary is 15 minutes per round.
A checkpoint at about 17:14Z recorded a completed initial plan, first review and revisions, with final
review underway. Later exact delivery timestamps are in BOARD and the ledger.

Measured helper launches: 2; host elapsed sum: 175.049 seconds. Native sub-agent launches: 0.
CLI-reported aggregate usage: 4 input tokens, 85,388 cache-creation input tokens, 2,194 cache-read input
tokens and 17,705 output tokens (including 11,795 thinking tokens). These are returned telemetry,
not a fresh billing measurement. CLI list-price estimate totals USD 1.0376588 (`costBasis: list`);
actual billed amount/quota impact remains unknown. Each result reports one message iteration;
actual provider network request/retry count is unknown, not inferred from launches or iterations.
Root outer orchestration calls/nested tool totals and root provider tokens are unknown/null because
this turn did not instrument them; worker limits are not measured consumption. No helper retry was used.
Pure CI waiting and active work are recorded separately where observed; full active-time split remains estimated.

## Risks and Follow-ups

This document is not P0-A/G1 acceptance. Product AC-02/03/04 remain pending, mainline incomplete,
usable tag none. Review covered supplied source text and the plan, not independent execution of product tests.
Bootstrap authority has a confirmed normative conflict requiring a later explicit spec decision.
M0 must also verify runtime checkpoint capability, policy-error semantics, notification-scope compatibility
and exact current test locations. Subsequent SDD changes must follow their approval process.

The only proposed next task is M0 baseline reconciliation, pending the owner's instruction to begin.
The present documentation milestone stops after required PR delivery and ledger handoff; it does not
activate M0/M1, MCP, a real provider, release or deployment.

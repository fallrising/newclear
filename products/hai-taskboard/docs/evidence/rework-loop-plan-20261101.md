# Rework loop proposal — review and verification

T-0339 / BOARD HRWK. Source `caad3c3a811456da767872aa6fc02d859955011c`. Scope: the
[rework loop proposal](../plans/rework-loop-20261101.md) only; no production, OpenAPI, accepted SDD,
migration or dependency change. RWK-AC-01..05 are NotRun. This records RWK-PLAN-01..03 evidence.

## Claude Code review

Claude Code 2.1.316, requested `claude-opus-5-5` effort high, read-only tools (Read/Grep/Glob) scoped to the
worktree, strict MCP config, no session persistence, 600 s timeout per call. Both calls exited 0.

| Call | Verdict | Duration | Reported list price (not billing) |
| --- | --- | --- | --- |
| Initial plan review | REWORK (4 major, 3 minor, 3 confirmations) | 277.247 s | USD 2.0468508 |
| Follow-up on actual revision | REWORK (small: 2 medium, 2 low wording defects; all 10 initial findings resolved) | 138.087 s | USD 0.8050278 |

The follow-up called its remaining items one-line wording fixes. Root applied them and verified each against source;
the planned budget allows no further model call, so no third review was run. Provider request counts, tokens beyond
the reported totals, billing and aggregate tool counts are unknown/null.

## Dispositions

| Finding | Disposition |
| --- | --- |
| 1 Canceled cannot reach Developing; settled vocabulary wrong | Accepted. Canceled removed from positives and gap table; settled = Succeeded\|Failed, None, Confirmed, not CancelRequested; CancelRequested+Failed limitation recorded as existing; DispatchRun check order pins Canceled → `invalid_transition` |
| 2 `(created_at_ns, run_id)` not reliable with wall clock / random IDs | Accepted. Strict-order clock guard in DispatchRun; tie-break only for injected rows; equal/regressed clock cases in RWK-AC-02 |
| 3 No defined current-Candidate read; unordered `QueryRow` | Accepted. Explicit latest-Run port/store read, no schema change; selector-less material read limited to DispatchRun; separate predicate from `ActiveOrUnknownRun` |
| 4 No lawful nonpassing Evidence writer | Verified (`PublishFixtureEvidence` requires Passing; human Evidence stored Passed). Nonpassing moved to domain-only; v0.2 AC-05 not claimed |
| 5 Accepted-doc amendments understated | Accepted. RWK-05 lists domain-and-gates DispatchRun and RequestRework rows, SDD §5 redispatch clause, HAI-STATE-005 sentence, current-Candidate definition, OpenAPI descriptions and RequestRework `expected_version` bounds |
| 6 Vague RWK-04 reasons | Accepted. Step-by-step codes; QA step states B's Review/Approval present so the exact reason set is `evidence_missing` |
| 7 Existing two-Run fixture | Accepted. Named in RWK-03/AC-03 as must-stay-green; follow-up confirmed byte order keeps it latest |
| 8 Abandoned Succeeded Run | Accepted. Explicit sentence and RWK-AC-02 case |
| 9 AC-05 overlaps rejected matrix | Accepted. Folded into RWK-AC-04; acceptance renumbered RWK-AC-01..05 |
| 10 Decision set | Confirmed: only D1 and D2 |
| N1 "zero writes" vs recorded failures | Accepted. Defined "no domain writes"; oracles assert exactly the failure result and idempotency rows |
| N2 retryable clock refusal replays | Accepted. `retryable: true`, same-key replay, new key after clock advance, covered in RWK-AC-02 |
| N3 missing evidence link | Resolved by this file |
| N4 incomplete amendment list | Accepted (see 5) |
| Nit: fixed test clock | Implementation will add a steppable deterministic clock |

## Document checks

Exact commands and results are retained in the private evidence directory listed in the desk task. Root ran
`python3 scripts/check_project_success.py`, `python3 scripts/check_indexes.py`, a local Markdown link/anchor check
over the changed HAI files and `git diff --cached --check` before commit. Product tests were not run because no
product code changed; document CI does not count as RWK product acceptance.

# T-0436 Memvid notes evaluation delivery

Owner approved M1 status reconciliation, then M2 Traditional Chinese notes evaluation, with commit → PR → CI/review → merge for each. No release/tag/deployment.
Claim: desk #293 merged. Start: 2026-10-29T16:49:00Z (approximate); projected aggregate active work 60–90 minutes; review progress every 20 minutes. CI wait limit 25 minutes per candidate. Initial failure plus at most two evidence-based fixes per issue.

## Milestones and responsibilities

1. M1 orchestrator: reconcile README/SUCCESS/SDD delivery status, root navigation and original evidence context; freeze `docs/notes-usability.md` and BOARD.
2. M1 independent reviewer: read-only diff and specification audit, report to orchestrator; no implementation/Git changes.
3. M2 orchestrator: deterministic corpus, golden queries, evaluator, metrics/SDK regression tests, evidence and documentation.
4. M2 independent reviewer: inspect final code, oracle, reproducibility and decision, bounded independent checks.
5. Orchestrator: evidence gate, PR delivery, BOARD closeout, desk/journal handoff.

## Acceptance gates

- NU-01: original merged commits #709/#733, four current-head CI successes, runtime/lock/workflow unchanged vs 67132cd4 (only BOARD changed at baseline); update links/index and retain limitations.
- NU-02–05: exact `docs/notes-usability.md` contract; no fabricated quality success, failures preserved.
- M1 index checks + independent review + CI; M2 red/green regression, CLI/core, complete evaluation + CI full models, independent review.
- No worker recursively delegates; read-only reviewers have no Git or external mutation authority. Separate worktrees for any parallel writer.

## Decisions and accounting

- Original experimental mainline remains complete; M2 is separate, its unfinished work does not erase AC-01–08.
- Historical component AGENTS Draft-only condition is superseded by owner's explicit current merge instruction; AGENTS bytes are unchanged.
- Native tools used, no external CLI provider dispatch. Provider requests/tokens/cost and exact active/wait split: unknown. Tool-call counts are observational only; this file does not invent totals.
- Environment preparation: existing `wt` required elevated access to main-clone Git metadata; normal call failed read-only, approved tool retry succeeded. Shared uv cache similarly requires normal authorized setup escalation.
- M1 independent review ACCEPT after two documented corrections (reports/T-001.md). NU-01 evidence gate: merged PR and historical CI readbacks + unchanged runtime + local index checks support status reconciliation. New baseline `make check`: 8 passed; `make core RUN_DIR=work/core-baseline`: 12 passed/3 not_run (model profile intentionally unselected); PDF AWT warning followed by successful native fallback. Candidate CI/merge pending. M2 pending.

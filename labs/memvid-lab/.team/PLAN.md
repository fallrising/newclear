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

## M2 execution checkpoint

M1 #773 merged at 2026-10-29T17:02:27Z, SHA da6d735d98ffa77b363cab7cffd4715b2a864dd6; three candidate CI workflows success. M2 branch starts from that merged main. Corpus writer T-002 accepted after orchestrator read of all 24 notes/30 queries and hash/schema checks; frozen SHA a91ec99c3329ddafdf856aa74a193dcfd5f62e32273ccd4c62d9154855c1f970. Original writer worktree isolated, no retrieval until freeze.

TDD: initial missing-module red; four metric tests green; true SDK integration found SDK renderer normalization mismatch. Failure preserved in docs/evidence/notes-development.md. A strict full-render comparison (not substring) fixed it; 15 tests now pass. Full 100/1000 evaluation running in separate bounded processes, followed by T-003 independent review. Per scale process timeout 180 seconds, retained report after every job. No threshold/corpus revisions.

2026-10-29T17:08:00Z checkpoint: ~19 minutes elapsed since approximate initial start; aggregate root/workers active estimated 25–30 minutes, exact split unknown. M1 delivered. M2 fifteen tests pass; native quality Recall/MRR .25, CJK .458333, precision/integrity1 and unknown FP0; natural paraphrases remain misses. Native append returns old+new, current filter passes. Native scale100/1000 complete (7.407s/91.368s build); CJK100 done, CJK1000 running. Review requested a persisted ingest manifest to audit frame mapping; will preserve this intermediate report, add metadata only after run exits, rerun final candidate and review. No corpus/threshold edits. Remaining CI/review/Git/handoff stays within original 60–90min estimate.


## M2 evidence gate

- NU-02: final JSON records 30 fixed queries × 2 strategies, raw hits, ranked URIs, frame-keyed manifests, global/category metrics and frozen corpus hash; retrieval/adoption FAIL remains explicit (not an execution failure).
- NU-03: both strategies persist old/new frames, native queries expose both, application current filter excludes old; native remove absent after child-process reopen.
- NU-04: both strategies × 100/1000 actual counts, write/rebuild seconds, file bytes and 50 warmed timings each; every job completed within 180s. Final source/corpus hashes verified.
- NU-05: final make check 16 passed and py_compile; first red/failure and fixes preserved; existing core baseline12 passed/3 deliberately unselected models. Pinned actionlint1.7.12 for changed workflow passed; index preflight47 contracts/8 llms files passed.
- Independent reviewer T-003 ACCEPT, independently recomputed manifests, metrics, decisions and scale samples; reports/T-003.md. Candidate CI pending. Original full model suite will run in required CI. No runtime scope beyond fixed lexical/bigram evaluation, no dependency change.

## M3 — Chinese semantic retrieval (2026-10-29T17:52:18Z)

Owner accepted the previous recommendation with「好，繼續開發。」Reuse claimed T-0436. Scope: two CPU local semantic models, frozen development corpus plus independently authored held-out corpus, fixed calibration algorithm before held-out retrieval, real Memvid vectors/source/update/reopen controls, bounded cost measurements and adoption decision. No new runtime dependencies, product integration, paid API, private notes, release/tag/deploy.

Budget estimate aggregate active60–90min; checkpoint every20min; each CI candidate wait25min; initial failure plus at most2 evidence-based fixes per issue. Exact active/wait/provider totals unknown. Source base a183b6568b2ee0b0253ec6fcaab5d0276c45b7b5. Root implements/integrates. Two existing native helpers retain inherited model/effort: corpus leaf authors unseen fixture in isolated worktree; read-only reviewer checks authoritative model configuration and independently reviews final implementation/evidence. No nested delegation or external provider CLI.

Gates: scope/spec/data frozen before evaluating; existing notes corpus unchanged; real embeddings and SDK with networking denied; raw and threshold-filtered results separate; calibration sees only development labels; held-out scores cannot modify model/config/thresholds; errors nonzero and original failures retained; tests, source hashes, independent review, project checks and required CI before merge. Final BOARD-only closeout then desk/journal handoff.

M3 preparation: desk scope #305 merged73b75fe128d02ec61e224a0fad117512f4b1b2c1. T-006 metadata PARTIAL accepted only for verified source/config facts; graph/runtime evidence remains pending. Root verified BGE tokenizer bytes and declared exporter. T-007 corpus accepted after reading all24 notes/30queries and source rationales, validator/hash check; fixed held-out SHA75fcd6855b8bffd3d843eb89e2c81782049a2b88dd8ead2ee7d6c9fa4752df5a. No model retrieval executed before freeze.

T-008 design ACCEPT after clarifying per-hit rejection/no-backfill/nonfinite/null boundaries, before inference. New11 pure/boundary tests green after missing-module red. Protocol and heldout now freeze for M3; final implementation review remains pending.

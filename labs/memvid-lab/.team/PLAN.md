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

2026-10-29T18:17:51Z checkpoint (time of recorded snapshot): M3 protocol+holdout freeze committed e6ae6274 before inference. Two actual model graph/CPU/network probes passed; initial27 unit/integration tests passed, core12passed/3models not selected. Actual M3 evaluation failed on returned-frame/ingest-manifest disagreement before calibration or holdout. Independent batch probe showed IDs differ and18hits before seal versus6 after reopen; explicit disable_auto_checkpoint did not resolve; public embedder path producedMV011; official doctor on a copy reportedhealed but0hits. Stop further SDK repair attempts. No model/data/threshold changes.

Delivery scope now limited and explicit: verified semantic_models.py preparation/encoder plus model unit tests, frozen corpus/protocol and reproducible diagnostic evidence. Full evaluator, its proposed CI job and calibration tests remain uncommitted in work/pending-m3; no failing quality gate is removed to claimM3 complete. Original requiredCI remains. M3/NS02–04 remain incomplete; next requested decision is a separate SDK persistence repair scope. Root estimate aggregate active25–35min at checkpoint, exact active/wait/provider accountingunknown; original60–90 estimate not exhausted.


2026-10-29T18:22:31Z evidence gate: final25 tests+py_compile passed; project/index checks passed; T-008 limited candidate ACCEPT after overflow regression/fix. SDK control remainsFAILED and NS02blocked/NS03–04not_run. Preserve historical source hashes. Publish a reviewable **Draft PR** with preparation and failure evidence; do not merge or redefine this as a completed M3 milestone. Ask only for the required SDK-repair scope/retry decision, not Git permission. No further SDK repair attempts until that decision; unblocked CI and journal/desk factual handoff continue.


## Approved persistence repair — 2026-10-30T03:24:08Z

Owner directly replied「好，批准。」to the concrete proposal to repair Memvid vector persistence/source-ID semantics, then resume the frozen M3 comparison. This supersedes the prior pending-decision checkpoint for this repair only; prior failure evidence and limits remain historical. Task T-0436 was reread through GitHub connector, still in_progress/claimed_by codex-gpt6-pilot. Reuse PR#800 and its unchanged worktree/head9a7ae3e3; no extra clone or dependency upgrade.

Plan: inspect pinned SDK/core source and identify root cause; first add a genuine SDK regression with24 real model vectors and append/reopen/source mapping, then minimal repair; independently review the data path; only after persistence/source controls pass restore evaluator, run development calibration before heldout, update/delete/new-process controls and100/1000 costs; required regression/CI, independent acceptance, normal PR merge, BOARD and desk/journal handoff. No new backend, corpus edits, relaxed integrity/adoption gates, private data, paid API, release/tag/deploy.

Estimate aggregate active60–90min for repair+remainingM3, checkpoint every20min. One source-backed repair candidate then at most2 evidence-based corrections for the same issue; stop immediately at that boundary if unresolved. Preparation/source reads are not repeated model experiments. Native workers are reused with inherited model/effort, one read-only source-contract check≤6min and one final bounded review≤8min, no nested delegation or external CLI. Root owns all edits/integration. Each experiment timeout120s, evaluation perjob300s/whole1200s, CIwait25min perhead. Unknown tool/provider/token/cost totals remainunknown; prior excess was not silently reset—this is the owner's explicit new authorization.

2026-10-30T03:46:45Z checkpoint: about23min elapsed since first clock; aggregate active estimate20–30min including bounded source helper, exact counters unknown. Exact PyPI sdist proves WAL/frame ID mismatch and ignored batch options/mixed index commit. Stock24-real-vector regression is RED (18 before/6 after). First native candidate written; no patched success claimed. Official lock reconciliation removes93 unused package identities with zero new/changed versions/checksums. Build corrections: fixed source-workspace lock, then unpacked matching build-only OpenSSL headers without host install; locked native build continuing. T-011 read-only8min candidate review underway. Original semantic/heldout evaluation remains unrun pending persistence controls. Still within60–90min estimate, next resolves build and regression; no backend/model/protocol changes.

2026-10-30T03:58:38Z checkpoint: about35min elapsed, aggregate active estimated35–50min including two bounded read-only helper passes; exact allocationunknown. v1 native build passed; small24 count/IDs passed. T-011 identified HNSW retention and loader cleanup; source-backed correction1(v2) retained1000→1001→1000 but real HNSW search panicked in pinned dependency copy_from_slice with short nearest results. Correction2(v3) fixes both destination slices in the exact existing hnsw0.11 crate via local source patch. No registry dependency versions changed. Final v3 locked build passed; small andlarge real controls are running. This exhausts the two native corrections: another unresolved same-path failure stops repair. Still no heldout retrieval. Build prerequisites and two harness defects are recorded explicitly; historical failures/binaries remain preserved. Frozen evaluator and CI drafts remain ignored pending these controls.

2026-10-30T04:10:55Z local evidence gate: v3native24 andHNSW controls pass; source-backed2correctionsused, no furtherSDKrepair. Frozen eval firstcompleteexit0, independentT-012audit found strictcosineguardcontractmismatch; test-first±1.000001red2failures, fixedstrict[-1,1]/noclamp andreranentirefrozen evaluation. Final04:06:41.652723–04:10:33.274458Z complete14jobs/0errors; all600qualityhits andmetrics unchanged. Bothmodels failadoption criteria, correctlydo_not_adopt_directly. Originalfullfirst12pass/3missingassets andbuildprerequisitefail retained; final37tests+py_compile and15scenarios pass, actionlint1.7.12/project47/index8checks pass. T-012correctionreview ACCEPT localimplementation/evidence with report/calibrationhashes verified. NS01–04 experimentgates passed; NS05localreviewpassed, remoteCI/Gitpending. Preserveoldfailures andbeforestrictreport/source inGit/backup. No release/deploy/tag/newmilestone.

## M4 query-level rejection — 2026-10-30T10:09:26Z

Owner continues development after M3; desk#325 merged f8bbc035e5a3d69704a7162e7ed6675244d6380e. Keep claimedT0436, no priorfixture/spec/result changes. Scope docs/notes-rejection.md NR01–05: fixedscore/margin querygate, dev-onlymodel/family selection, freshsyntheticdev/heldout and realSDKofflineevidence. Root owns spec, integration, code, calibration/evaluation, evidencegate and Git. One independentcorpus leaf in disjointworktree; one readonlyreview leaf. No recursive delegation or external providerCLI. Nativehelpers inheritmodel/effort, exactproviderbillingunknown, scopeinstructionsnotOSisolation.

Budgetestimate60–90minaggregateactive/checkpoint20min; corpus<=10min onepass+onefocusedcorrection<=3min, designreview<=4min, finalreview<=8min+one<=3mincorrection; eval300s/job,1200overall, CI25min/head. Samefailure max2evidencebasedfixes. Freezeprotocol+corpusbeforeanyM4inference, preserveheldoutfailures/noaftertesttuning. Necessary37baseline+newtests/core/fullCI/nativecontrols/index/workflowreview; no newdeps/paid/private/productintegration/release/deploy. Evidence source/counters must distinguish observed/estimated/unknown; currentnewagentlaunches0 before corpus dispatch.

M4pre-freeze: T014corpus accepted afterrootreadall48notes/96questionsandrationales, exacthashcomparison andschema/normalizedoverlap checks; noM4inference. T015designclarifications appliedbeforefreeze: subsetdenominators/null/wrongunknown andstrictallraw/policyvalidation. PolicyREDmissingmodule then10GREEN. Existingmodelsassetsverified582642242bytes. FirstunchangedSDKbuild failed101missingdevelopmentlinkernames despitecorrectheaders; isolatedsymlinkstoexistinglibssl3t64runtime fixprecondition, no source/runtimeupgrade. Initialfailure retained.

M4local evidencegate2026-10-30T10:34Z: ACCEPT NR01–04implementation/recordedevaluation afterT016independentaudit. Freezecommitb3b420d8before10:29:55inference; 4quality/2updates/0errors, 20,604devcandidates/960hitsverified, primaryBGEscore_margin0.79/0.31 heldout1/24correct/0unknownfalse, do_not_adopt_directly. Noafterheldouttuning. Final53tests+py_compile, core12passed/3explicitnot_run, project47/index8/actionlint1.7.12passed; native15/M3/1000/newM4 CIstillrequired. No unresolvedlocaldefects; oldruntime/fixtures/spec/resultsunchanged. Rootrevieweddiff/sourcehashes andacceptsworkerfacts, notfutureGit. Proceedauthorizedcommit/PR/CI/normalmerge/readback thenBOARD-onlycloseout/ledger.

# CMS oldest-PR resume — T-0351

Owner2026-11-01 explicitly resumes development and qualified PR merges. Claim deskPR363 merged a41ba4f6f23ca40c10600adbde521080eb284d23. Original PR333 source98159a86 and PR334 source68610e95; latest main merged normally with no conflicts, pending commit. Preserve all historical checkpoints and failures.

Goal: qualify PP1b under already approved PR331 DOC_READY (fresh-init, initialized semantic checks, guard live negatives, trusted accounts browser, native gates/independent review/CI), and separately correct PP1c draft against its approved parent plus14findings. PP1c remains DRAFT and no product implementation until any necessary owner spec approval. No staging/deploy/release, host trust change, old-volume cleanup, new runtime dependency or unrelated BW6 work.

Root owns runtime preflight, new isolated synthetic runs, source integration, tests, decisions, Git delivery/readback and desk/journal. Component plan avoids monorepo root collisions. T1101 docs-only writer in separate PP1c worktree,50minute active bound; T1102 read-only pending acceptance review in PP1b worktree,20minute bound. Neither may delegate or mutate Git/runtime. Root independent review of docs after writer; final bounded reviewer follow-up on code changes if needed. No external provider CLI. Native launches tracked here, total0 before dispatch.

Estimate90–150 active minutes,20minute checkpoints. Each build/test<=15minutes, CIwait<=15minutes, two hypothesis-driven corrections after initial failure. Stop affected path on missing authority, product contract change or nonconvergent failure, retain evidence; do not weaken tests. Provider/tool/tokens/cost and complete elapsed/wait accounting unknown/null; no hard tool-count budget.

Preflight:40GiB free. Node24.18.0 and Docker29.1.3 exist; JDK25,PG16/JRE base images and PP1-specific browser prerequisites not yet located. Original PP1a requires existing validated immutable image/tool inputs and forbids automatic missing-input downloads; root must resolve available inputs before dependent runtime. Existing shared fanz browser image is not yet validated for this contract.

Verification: ./gradlew test integrationTest (sequential), npm lint/typecheck/test/build/test:bundle, PP1 helper/parser regressions, all remaining fixed G07/E01 acceptance checks, source-bound artifacts/owned cleanup, independent review, root indexes and required CI. No skip counted as pass.

Started 2026-11-01T11:45:38Z

Checkpoint:2native leaves launched (T1101/T1102), no external model CLI. Node117helper tests pass on normal host; sandbox attempt6/8file-wrapper failures preserved and not counted as product regressions. Shared-cache JDK25.0.5+8 verified against officialSHA256; root separately prepares prescribed validation images before handing immutable IDs to unchanged pull-forbidden prepare/compose/browser launch. No product dependency or host trust/config change.

Merge validation note: staged comparison against the old September/October PR parent reports inherited trailing whitespace in three unrelated current-main evidence/README files. Those three index blobs were byte-compared with MERGE_HEAD and remain identical; no historical evidence rewritten. `git diff --cached --check MERGE_HEAD` passes for the actual feature delta. Root index validation passes52contracts/9llms.

Checkpoint: T1101 PARTIAL accepted only as corrected DRAFT. Root actual diff/policy comparison is in REVIEW.md. D01 physical adapters,D02 raw receipt,D03 browser/socket/delta remain unresolved; no DOC_READY,product implementation or merge. PP1b tooling exception remains pending owner decision.

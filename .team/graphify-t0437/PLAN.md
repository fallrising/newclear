# T-0437 — Graphify development pilot

Owner accepted documentation closeout then a real development task on 2026-10-29; commit/PR/merge each milestone. Desk claim #294 merged at 1867902585f58c2454f10599264b3fa1d0030c24. Start 16:53:01Z; estimated active effort 60–90 minutes; 20-minute checkpoints. Native agents only; no provider changes, paid API, deployment, tags, or global configuration. All hosted token/request/cost values unknown unless explicitly observed.

## Delivery
1. M1: reconcile merged initial experiment status in README/SUCCESS/PROJECTS, retain history; register this work and bounded M2 acceptance before code. Parent edits. Independent read-only reviewer after diff.
2. M2: use a real graph and source readback to perform a behavior-preserving refactor of this component's source-location helpers into a reusable module. Compare bounded rg/source and graph/source investigation on the same pinned pre-change code, record result correctness, command time/output bytes separately from agent elapsed time; no causal speed/token claims. Provide a repeatable local agent workflow without global configuration. Parent implements/integrates; independent reviewer audits and tests. No additional features without evidence and scope review.
3. Per-milestone CI, normal merge/readback; final board closeout, desk and journal factual handoff. Third-stage ideas are recommendations only.

## Gates
M1: preserved AC-01–09 evidence, runtime-identical diff, check_indexes, workflow gate, independent review, required CI.
M2: fixed AC in docs/milestones/development-pilot.md; meaningful pre-refactor regression; real Graphify pilot; full cache/CLI/MCP suite; repo checks; independent review; required CI. Keep failures and unknown metrics explicit. At most two justified repair attempts per observed problem. CI wait bounded at 15 minutes per head.

## Status
- Claim complete; first claim CI failed on concurrent T-0436, corrected by normal T-0437 commit and second CI succeeded.
- M1 complete: #775 merged and read back; independent review and both required CI passed.
- M2 implementation and local evidence complete; independent reviewer found no runtime must-fix. Final PR/CI/merge pending.

## Checkpoint 2026-10-29T17:15Z
M1 #775 merged at 17:07:58Z, remote readback confirmed. M2 helpers extracted with legacy import compatibility; source RED then 4 focused/33 existing tests green; integrated 39 tests green. Original real suite 7/7; true pilot 159 nodes/470 edges, ten source callsites/six unique relations present, MCP passed. Initial sandbox MCP failure preserved; native execution passed without upstream changes. Worker T-002 accepted for integration pending independent T-003 review. 47 contracts/8 llms and 40 workflow gates passed. Provider usage unknown; two native agents started (reviewer reused), full orchestration counts unknown. No third milestone initiated.

Precommit staged whitespace check caught one trailing blank line in new source.py; removed without behavioral change, then staged gate rerun. Reviewer independently passed 39 tests, verified AST-identical helpers and all report source hashes.

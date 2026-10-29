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
- M1 local gates passed: 47 contracts, 8 llms files, 40 workflows; runtime diff empty. Independent reviewer ACCEPT after correcting one stale Draft sentence. Required CI/publish pending; M2 not started.

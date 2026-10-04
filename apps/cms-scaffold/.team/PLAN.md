# W4 Admin governance delivery

Status: LOCAL_VERIFIED; required remote CI and merge pending. Baseline: W3b merge a0de08a41eaf3fdc7c56e4ae86b819b705b0ce87.

## Objective and scope
Deliver W4 common CMS governance per docs/v2/waves/W4.md §0–§9. Preserve generic kernel, three surfaces and all accepted P0–W3b work. No dependencies/backend/contracts/Front/Back changes, no deployment.

## Team and dependencies
- T-941: GPT-6.1 Sol high, API/mock; isolated scope/worktree. Freeze shared API before UI final validation.
- T-942: GPT-6.1 Sol high, Admin UI/tests; isolated scope/worktree. Root supplies frozen shared API/mock/UI primitives read-only.
- T-943: GPT-6 Luna medium, independent spec/evidence inventory, read-only source and own report. Root additionally reviews permission/mutation semantics.
- Root: docs, Checkbox/Progress primitives, shell E2E adaptation, bounded integration, diff review, verification, Git delivery.

## Acceptance gates
Relevant Red/Green records; complete frontend lint/typecheck/test/build/bundle; runtime codegen/fixture freshness; existing 68 mock E2E; Java unit and required remote integration CI; exact source and protected baseline hashes; task/report validators. Appendix A new W4 E2E remains W5, explicitly not claimed. No inferred passes.

## Delivery
Review worker actual diffs and logs before accept. Apply evidence gate. LOCAL_VERIFIED only after local gates; commit/push/PR under owner standing authorization; wait required CI/review, merge without bypass, verify remote, update handoff. No fabricated private ledger ID.

## Decisions
Documentation first: W4 §0 resolves old W2 overwrite/codegen/E2E instructions. W3b publication receipt synchronized without revising historical evidence. Snapshot of current CMS and hashes of prior snapshots created before implementation.

## Root acceptance checkpoint
T-941/T-942 accepted after actual diff/log review; generated fixture and shell/audit/entries root corrections are documented in W4 §0 and regressions. Native gates:624 frontend,68 mock E2E,339 Java FROM-CACHE,14 visual captures,883 protected files/10 snapshots/468 original files. No source change after passing native gates. T-943 independently reviewed the final source and evidence; DONE accepted. Required remote publication closure follows. Source corrections owned by root: canonical UUID, current principal retention, keyed resource route state, duplicate fixture uniqueness; all had intended Red then Green. Initial visual entrance-animation capture stabilized without product edits. Original six tests migrated under explicit W4 T10/T21; automatic approval concern was resolved by actual file/coverage inspection and preserved Git/snapshot originals. No permission pending.

Final staged diff check found two new-file blank lines at EOF that the unstaged check did not inspect; both were removed with no semantic change. Final source hashes were refreshed and staged diff check rerun.

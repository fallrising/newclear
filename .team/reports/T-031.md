STATUS: PARTIAL

## Summary

T-031 attempt3, runDG-W1-20260923-01, contractrev4 fixed9be2c18 before code; baseline7a7b41b, previous03a7ee5. Sole lead works again in `/home/ckc/test/codex/newclear-dim-gate-w1`, original PR33 branch `agent/dim-gate/mainline/w1-workspaces`. This containing commit fixes F-04/F-05 from preserved independent T-032 attempt2. W1 NOT_ACCEPTED.

Tablet641–1100 now retains200px labelled/grouped navigation; mobile drawer remains keyboard operable. Workspace switch validates project/environment using the existing canonical dashboard read. Mismatched env is removed; invalid project is removed while independently valid env is rechecked unfiltered and retained. Read failure keeps original URL/workspace/domain and explains retry. Pending workspace text is distinct from identity switching. Added missing/mismatched/partly-valid/read-failure/retry browser cases plus explicit visible label/group and keyboard navigation at768/390 in both themes. Cross-browser smoke now includes a legal project filter during workspace switch.

## Verification

- Correction working diff: typecheck,lint,demo build — passed
- `DIM_GATE_TEST_PORT=4213 pnpm exec playwright test e2e/w1-workspaces.spec.ts`11/11 in1.7m, including new F04/F05 regressions — passed
- Corrected768 light navigation screenshot visually inspected;18 role/theme/viewport axe scans plus4 readable navigation scans pass; keyboard opens/selects/closes390 menu — passed
- Original7d60786 complete fixed gates:240 tests,59 Chromium,6 Firefox/WebKit,3 benchmark,2 isolation,native/actionlint/diff pass; archived separately, not applied to this correction — passed
- Final candidate full64 Chromium,6 Firefox/WebKit,benchmark,isolation,native checks,independent T-032 attempt3 and latest-head CI pending — skipped

## Documentation

Contractrev4, task revisions and DG-D049 preserve requirement/owner/recovery state. T-032 attempt2 retains two medium findings and verified closure of F01–03. Preliminary logs `/tmp/dim-gate-w1-evidence/attempt3-focused-browser.log`, screenshots/trace/report copied into `attempt3-focused-artifacts`. Source and this partial record are SSH-pushed to existing PR33 next.03a7ee5 fixed runner remains unchanged in rework tree.

## Risks and Follow-ups

Do not accept/merge on focused checks. Freeze containing candidate and run full gate runner, independent final review, remeasure300KiB budget and require latest PR-head CI. Preserve previous reports. After accepted authorized merge, confirm actual merge SHA/tree/postmerge CI, release run owner, then start W2. No deploy/cloud/notifications/credentials/force push/main push or worktree deletion.

Regression correction checkpoint (2026-09-23): fixed `4ab62327b47c5924a22c84e99bab9c79e1dfbb0a` adds only M4 reload restoration assertions over5cf product source. Frozen install/lint/typecheck/docs/demo build, all three provider Guide stories (3/3,2.4m), diffcheck passed; independent T-032 narrow delta verdict passes. Manifest `/tmp/dim-gate-w1-evidence/4ab6232-20260923T065129Z/results.json`, archived artifacts `4ab6232-readiness-artifacts`. Testfix and pre-edit scope are SSH-saved on `agent/dim-gate/task/t031-regression-readiness`; no new PR. Main00333ef changes only siblings, no dim-gate/.team/workflow delta, and is normally merged as0f9140a. Full5cf remaining gates and latest final-head CI still required; W1 NOT_ACCEPTED. Sole lead owns readiness checkout while canonical lead checkout stays5cf for its immutable run.

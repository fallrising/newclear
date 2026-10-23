STATUS: DONE

## Summary

Paired issue #156 / fe-review SDD AC-11 design deliverables are ready for independent review, with owner D decisions and AC-15 explicitly pending. Source base: `d8ca3c4089a9fbe852459da3d9602329224230e7`; branch `fe-review/design-flowshot-loom`. Actual paths are `apps/flowshot/fe-review` and `apps/loom/fe-review`; parent corrected the task's original products paths and AC-10 reference before writes.

Both DESIGN files follow the seven required sections with source-line-backed current behavior, bounded changes, verification and rollback. Flowshot uses its existing eager build-info promise seam for the proposed loading/ready/error fixture; Loom proposes a complete command/event/callback mock spanning PTY/history, document, AI, canvas and close boundaries. Neither mock/driver is implemented or capture-ready. Generic capture.mjs has no preload hook; the documents do not invent one or present a runnable harness command.

REVIEW/PROMPT/targets corrections preserve current phase draft and verified=false. Flowshot's resumed development and visible foundation-only entry replace stale dormant/full annotation-journey claims. Native/Xvfb history is separated from Web screenshot and target-Mac gates. Loom's extra native boundaries, metadata-only recovery, Run/Pin limits and synthetic-only scenarios are explicit. Proposed product checks/start commands are marked unrun. Only FE package documents/JSON changed; no code/tests/dependencies/CI/SUCCESS edits or UI startup.

### Assumptions requiring owner confirmation

- Flowshot D1: review-only preload (b), using the existing build-info window promise seam, rather than a production adapter.
- Flowshot D2: this FE slice captures Web only; native screenshot remains outside the slice without waiving original native/Mac acceptance.
- Loom D1: review-only preload (b), with actual locked Tauri callback/event behavior verified before use; stop and revise the design if it cannot work.
- AC-15 owner signoff is pending. No D item was moved into an approved state. PR entry remains pending orchestrator publication; use Refs #156, not automatic closure.

## Verification

- Shared launcher `T030-design-gate -- python3 docs/fe-review/check_design.py AC-11`, both seven-section documents — passed
- Shared launcher `T030-final-links -- python3 ../check_design_docs.py apps/flowshot/fe-review apps/loom/fe-review`, 89 local links and both targets unverified — passed
- Python read-only source-reference check, 46 `#L` anchors target existing files and in-range lines — passed
- `git diff --check` plus `git diff --no-index --check /dev/null <new-file>` for all new scoped files — passed
- Python changed-path inventory asserts all repository changes under the two authorized fe-review folders — passed

The root helper is outside the repository; the actual launcher command used its absolute coordination-directory path. No product tests or runtime/capture commands ran, as required by this documentation-only task.

Read-only GitHub check: issue156 had no comments; comparison from base to main at `c94ade04b7d7608edd7ed0cb391254e1091fe21e` listed only unrelated Goku/Phark/Ojbquay FE docs, no Flowshot/Loom source drift. Open PR scopes filtered to either component returned an empty list. These are point-in-time reads, not a lock against later changes.

Design SHA256:
- Flowshot: `acadd08581728de18bbf737b83bbdb7ba1809b575c395c4891c641a32bb80422`
- Loom: `1b6d3885eb649bac0b2ddee5bb1e113f85304ee35791b4cfc5bd186491c32130`

## Documentation

Process journal: read task/skill and component contracts -> report actual path/AC mismatch and receive corrected scope -> verify issue/comments and relevant main/PR drift -> audit real entry/IPC/capture behavior -> draft paired designs -> correct stale FE package claims -> run scoped structural/link/line/whitespace/scope gates -> hand off without staging or commits. Task/report copies reside in each FE package's tasks/156-design; no new product acceptance claims.

An initial guessed scripts/check_design_docs.py path was absent; the parent supplied the existing coordination-root helper and it passed. The required AC is AC-11, not Phark's AC-10; no global AC claim is made. Unique runtime evidence does not exist because no UI was started.

## Risks and Follow-ups

Review drivers still require implementation and tests in round2 after explicit owner decisions. Network namespace, allowlist environment, disposable synthetic state, fresh contexts, no real native/provider access and preserved unique evidence are prerequisites, not existing verified infrastructure. AC-11 structure/link checks do not certify UI quality, owner AC-15, original product journeys or usable releases. Parent owns independent review/publication and PR number backfill. No delegation, staging, commits or GitHub writes.

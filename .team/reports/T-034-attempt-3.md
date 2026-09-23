STATUS: DONE

## Summary

T-034 attempt3, run DG-W2-20260923-01, W2 contractrevision2 and bounded browser extension DG-D061. Worker `/root/w2_migration` completed its assigned verification and releases this bounded write ownership to lead. Worktree `/home/ckc/test/codex/newclear-dim-gate-w2-browser`, branch `agent/dim-gate/task/t034-resource-browser`, implementation base `ae3bb49a5976099fb0c877cf09e444e1a4e82653`. Exclusive handback is `platform/dim-gate/e2e/w2-governance.spec.ts` plus this report. No production edits, commits/pushes, delegation or self-acceptance. DONE refers only to this bounded verification assignment; W2 milestone acceptance remains lead-owned.

Exact tested test file SHA256: `b6861140a797bc56ba33977ed2a7046dc884f36d97e66471ef29964e1cb3168d`. Base implementation plus the six unchanged lead-provided read-only dependencies below is the actual tested source, not an invented clean commit. Built `dist/.vite/manifest.json` SHA256: `6ee4ec1712e90e6e779fca31c43ad975015187ffabe16db3dfeabe1bcbf31f56`. Reproducible manifest: `/tmp/t034-attempt3-test-manifest.json`.

Five Chromium tests, all business success setup through visible UI controls:

1. `W2 AC-04/07/09: Ops shared Redis resize needs independent approval and updates both consumers after execution` — maintenance keyboard entry/Escape/focus restore; UI shared resize request; hidden self-approval action plus direct403 `SELF_APPROVAL_DENIED`; secondOps approval leaves active object unchanged; original Ops requester executes after independent approval; mid-execution reload; both checkout and storefront read the same updated2048MiB allocation; bindings and unrelated objects remain equal.
2. `W2 AC-05/06: Kafka existing binding preserves object and topic identity is unique within each parent` — visible existing-topic consumer binding adds one binding while all objects remain equal; same-parent normalized uppercase topic name fails409 without adding a Change/object/binding; identical name on the other canonical parent completes approval/execution with distinct object IDs; reload and RD resources read both identities.
3. `W2 AC-06/09/15/17: Admin redis typed revision and disable refuse old changes without rewriting frozen snapshots` — typed Redis default512→768, save/publish revision2; old draft submission and submitted approval both refuse `CATALOG_CHANGED`; new submission freezes revised defaults; disable causes both submitted approval and old-draft submission to refuse `CATALOG_DISABLED`; prior Change snapshots and all resource entities remain equal.
4. `W2 AC-06/09/15/17: Admin kafka typed revision and disable refuse old changes without rewriting frozen snapshots` — same governance journey, with typed partitions3→4 and other typed defaults preserved; immutable revision/history assertions are identical.
5. `W2 AC-09/15: Admin UI grant revocation redacts objects then removes physical resource visibility after reload` — Admin UI pool revocation immediately removes object/binding access and direct object reads404, while remaining project grants legitimately retain the physical CI; subsequent Admin UI removal of those specific project grants makes physical resource and object deep reads404, including after reload. Strict error schema rejects data-bearing responses, IDs do not leak, and business resources remain unchanged.

Thirteen rendered axe scans have zero serious/critical findings: each typed editor in light/dark at1440/768/390 (12scans with screenshots and no document overflow), plus the live Redis maintenance dialog. Browser-health validation has no unexpected console/page/network failures. Read-only sessionStorage access is evidence only; raw HTTP is confined to deliberate403/404 denial probes. No successful API setup or store mutation is used.

## Verification

All commands use component cwd `platform/dim-gate`, Node24.18.0/pnpm11.18.0. Browser environment: `LD_LIBRARY_PATH=/tmp/dim-gate-m5-webkit-libs/usr/lib/x86_64-linux-gnu:/tmp/dim-gate-playwright-libs/usr/lib/x86_64-linux-gnu`, `FONTCONFIG_FILE=/tmp/dim-gate-m3-fonts-kaBaS8/fonts.conf`, `DIM_GATE_TEST_PORT=4223`.

- `pnpm build --mode demo` at exact baseae3 plus lead-provided dependencies; actual production Demo build completed — passed
- `pnpm exec tsc --noEmit --module esnext --moduleResolution bundler --target es2023 --lib ES2023,DOM --strict --skipLibCheck --esModuleInterop --allowImportingTsExtensions --noUnusedLocals --noUnusedParameters --types node e2e/w2-governance.spec.ts` — passed
- `pnpm exec eslint e2e/w2-governance.spec.ts` — passed
- `pnpm exec playwright test e2e/w2-governance.spec.ts`:5/5,1worker,retries0,2.1minutes; individual durations16.9s/32.9s/28.5s/28.8s/15.9s; exact final log `/tmp/t034-attempt3-final-browser.log` — passed
- `pnpm exec playwright test e2e/w2-governance.spec.ts --list`:exactly5tests in1file — passed
- Six read-only dependency SHA256 comparisons, final owned-test SHA256, and `git diff --check` — passed
- Pinned `python3 /tmp/dim-gate-w1-evidence/teamctl.py validate-report .team/reports/T-034-attempt-3.md` — passed

Final evidence is preserved under `/tmp/t034-attempt3-final-evidence/`: HTML report with browser-health, canonical readback JSON, final DOM/screenshots and12typed-editor screenshots; test-results; command log and exact source/dependency manifest. Local component HTML entry: `platform/dim-gate/playwright-report/index.html`. Final successful tests do not generate failure traces; historical failures retain their traces below.

Initial browser run passed the two resource lifecycles and exposed test-only errors: the new test used `catalogItems` instead of canonical `catalogs`, and incorrectly assumed pool revocation removed still-valid project-based physical-CI visibility. Corrected targeted Admin run passed both template stories; its remaining revocation assertion assumed errors lacked the contract's `meta` envelope. The final test uses strict `apiErrorSchema` and explicit no-data/no-ID-leak assertions. These corrections follow the actual schema and union-of-grants contract without changing production or relaxing product requirements. Historical evidence remains `/tmp/t034-attempt3-first-browser/` and `/tmp/t034-attempt3-admin-browser/`. The final exact-file full run above supersedes those test-development failures.

## Documentation

Read applicable AGENTS, existing task/contract extension, exact fixed UI/domain scope rules, and browser-health/shared helpers. Lead owns PLAN/STATUS/specification/canonical report and acceptance. No production bug was found in the assigned stories.

Original migration worktree remains intact. Automatic approval review rejected the initially proposed broad component dependency refresh because it could overwrite uncommitted worker data; that operation wrote nothing. Lead safely created this separate empty worktree and provided explicit read-only dependencies instead. The rejected action was not retried or bypassed. Their final hashes were independently compared and remain unchanged:

| Read-only dependency | SHA256 |
| --- | --- |
| src/features/resources/ChangeForm.tsx | 9408b976f82e9acd54eb2b5c0ce4715c8d57902a3a66c7ef5da881e342dcf14a |
| src/features/resources/ChangeDetailPage.tsx | c9b4fb538265978589d002c08d38b063dd9bd1683c31cf47fcdbd46a2ce19204 |
| src/features/resources/shared.tsx | 677071b249519fc978d985196c8b730a8d42b7e89090bbf8463e099b09b6b3ce |
| src/features/resources/InventoryPages.tsx | 673649f832f620adfdc0674d521b3f37e60c883415b15456de88882a760cf032 |
| src/features/resources/resources.css | 901dbe3776cfaba762071e8871e166a4cc42534c4641e750735919f0a19719a7 |
| e2e/w2-resource-helpers.ts | b4dfe9d7f266b992544d861c7b948fd1c27c22ad1b93864ef6c54f9196a03d90 |

## Risks and Follow-ups

No remaining blocker within assigned browser scope. New test/report are LOCAL_ONLY until lead confirms copy and SSH save. Worker ownership is released; do not copy the six read-only dependencies as worker-owned changes. Parent W2 draft PR36, acceptance, independent review, latest-head CI, push/merge and actual merge verification remain lead responsibilities. Worker did not inspect a new GitHub head or claim these gates passed.

Next executable step: lead hash-check and copy only `e2e/w2-governance.spec.ts` and this report from the browser worktree, integrate its current stable helper/UI source, rerun the five tests on the final implementation commit with other required W2 gates, preserve review and CI evidence in canonical records, and continue the authorized milestone delivery. All prior worktrees and attempts remain preserved.

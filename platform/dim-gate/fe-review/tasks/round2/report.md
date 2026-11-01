STATUS: PARTIAL

## Summary

T005 / T-0380 R2-AC-2 / PR583 implements approved DESIGN M1–M3 in review tooling only, based on source5275f401 plus this scoped diff. SUCCESS scope/acceptance was written before implementation. No product/demo/API/e2e/dependency/lockfile/CI changes, Git mutation or delegation. Local required checks have passed; final independent recheck and required CI/publication remain with root. targets is true for original R2 local evidence only; final review/CI/delivery remain separate. No fullRound3 or product-mainline completion claim.

The driver uses the real persona combobox, same-tab sessionStorage, actual UI theme preferences and loaded-page assertions. Three personas × two themes × three viewports cover216planned static page keys; runtime detail links are discovered from existing lists only. Workflow assertions remain in existing e2e.

## Verification

- `pnpm install --frozen-lockfile` — passed, existing pnpm11.18.0/lockfile unchanged.
- `node --test fe-review/capture.test.mjs` — initial RED missing module, then GREEN2tests. R9 regression RED missing verifiedCaptureKeys export, then GREEN3tests. Covers base-path navigation and rejection,18combinations, incomplete theme/persona/heading evidence excluded from resume. Raw logs retained under ignored runs/.state.
- `set -e; pnpm lint; pnpm typecheck; pnpm test; pnpm check:docs; pnpm check:contracts; pnpm check:ci; pnpm build --mode demo` — passed exit0;46files426tests,207OpenAPI operations/398schemas, Vite8.3.0demo build. No unchanged suite rerun.
- Updated docs and architecture — passed; final docs44Markdown264repositorylinks. Final documentation/link receipt and source hashes in [verification](verification.json). Initial full lint passed. During live E2E a later full lint encountered534errors only in generated trace JavaScript; changed-source ESLint passed without ignore/config/rule changes. Final post-E2E `pnpm lint` passed exit0 without deleting evidence or changing ignores.
- Common `capture.mjs ... --dry-run` and exact configured `--start` — passed42/42HTTP200,0pageErrors, loaded-heading waits; [static manifest](../../runs/static-round2-canonical/capture.json). Mobile catalog-request screenshot visually verified as actual form. The expected pnpm ELIFECYCLE printed when owned dev server was stopped did not fail capture or outer set-e command.
- `pnpm test:e2e --output=fe-review/runs/.state/e2e-results --reporter=line` — passed100/100Chromium tests(34.7m), outer session27950 exit0. No skips/retries, native test modifications or second full run. Original1000UI-command case uses15minute timeout and completed normally. Final ss -ltn showed no listeners; owned container removed.
- Persona capture — passed216fully verified unique planned keys across18combinations. There are217raw capture records: one initial null-theme observation is superseded, not counted as valid or erased. Zero duplicate valid keys and zero missing planned keys;24runtime details explicitly not_available. Manifest/driver hashes and exact aggregation counts are in verification.json.
- Owned persona cleanup — passed after each completed run; final one-key retry exit0 and ss -ltn header only. No global processes stopped.

## Historical Failures and Corrections

Initial offline SDK pnpm12 attempted package-manager version resolution; stopped before native gates. Two pinned11store attempts refused module removal withoutTTY; no purge/reinstall performed. Root proved canonical worktree/shared-store mounts and explicit store-dir plus stricter verify-deps-before-run=error inside clean disposable container home. That setup passed actual targets and existing E2E. No host HOME or credential mounts.

Exact Playwright1.63 requires Chromium1243/153.0.8010.12; old1234 was incompatible. First browser install path was wrong for pnpm layout; corrected @playwright/test CLI install exited0. Root and worker both observed browser installation activity; no single-download/count claim.

[Initial persona run](../../runs/20261024T063828166Z/capture.json) captured94pages then failed on axe execution-context destruction. [Continuation](../../runs/20261024T064605334Z/capture.json) captured122remaining pages with0scannererrors. Axe exceptions are explicitly axe.error, never interpreted as zero violations. Navigation/persona/theme assertions remain required. Original run remains immutable; its historical driver hash is recorded externally because it predates the manifest hash field.

R9 found initial user-rd-commerce|alerts|desktop|light had theme:null. The first216-count audit covered unique raw keys but missed this field; that overbroad evidence claim is corrected. Resume now reads ancestor manifests and only skips actual theme/persona matches with nonempty headings; post-axe assertions enforce fields again. First [one-key correction attempt](../../runs/20261024T070544500Z/capture.json) failed at initial page.goto15000ms timeout while Vite reoptimized dependencies. After existing E2E finished, the single bounded [retry](../../runs/20261024T072323741Z/capture.json) passed1capture/0errors, actualtheme light, selectedPersona user-rd-commerce, correct heading. No timeout changes or fullmatrix repeat.

## Documentation and Scope

PROMPT/REVIEW/README/SUCCESS/STATUS describe original R2 scope. Captures use existing seed IDs and actual parameterized routes; no mock/domain mutations or invented IDs. Fresh seed initializes pipelines/releases/incidents empty in src/demo/seed.ts:114; resources.test.ts:27-28 asserts requests/releases empty. Four detail types × six theme/viewport combinations yield24not_available observations with actual listURL. Independent R9 accepted this M3 applicability; no detail screenshot is falsely claimed.

Public artifacts use relative paths and contain no host paths, credentials or storageState. Screenshots and local runtime logs are ignored; JSON manifests preserve actual observations. Raw evidence must be preserved before worktree removal. Exact assignment start/active/provider counts are unknown; an earlier approximate06:29start was incorrect and is not used as a timestamp.

## Unresolved Health and Delivery Follow-ups

Valid216persona observations have0consoleErrors/pageErrors/failedRequests/whole-page overflow. Axe region moderate appears on216pages; Ops capacity aria-prohibited-attr serious6nodes appears in each of6theme/viewport combinations. These findings remain unresolved and visible in REVIEW; no product correction is authorized by this review-only R2. This is not Round3 health acceptance.

Root owns final independent recheck, required CI, commit/push/PR/merge/readback and ledger. No whole milestone completion is asserted here.

## Parent evidence acceptance before publication

R9 author-other reviewer /root/closeout_review independently recomputed five manifest hashes and four source hashes, reconciled217raw/216complete unique keys, inspected actual100E2E PASS34.7min and final full lint/docs output, and returned ACCEPT for original M1–M3. Root separately inspected source diff, focused tests, corrected actual-theme capture, raw E2E tail and observed42project contracts, index/5llms navigation and diff checks pass. Historical failures and Round3 axe findings stay explicit above. Current-head CI, normal PR583 merge and remote readback remain required; PR timeline records final delivery. T-0380 remains in_progress.

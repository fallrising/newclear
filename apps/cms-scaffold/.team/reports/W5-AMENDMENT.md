STATUS: PARTIAL

## Summary
W5 amendment **approved by owner on 2026-10-05** (「行，繼續幹吧」); implementation resumes under W5 §0.1. The prescribed T02 experiment is insufficient and introduces a provider regression. Fixed budgets, existing assertions and CMS behavior remain requirements. No deployment is proposed.

## Verification
- Root formal build and ten bundle-measurer tests — passed
- Root `npm run measure:bundle`: Front177721/92160, Back179622/163840, Admin180275/163840 bytes; all fail — failed
- Actual-App focused E2E: entries notes workflow and Front mobile menu — passed
- Actual-App Back media library: `FieldsProvider is missing`; screenshot, trace and error context retained — failed
- Static source review confirms composer/media/schedule field-service consumers; independent reviewer agrees — passed

## Documentation
The current W5 §5.1 explicitly limits T02 to six boundaries, then says to stop if budgets fail. §3 excludes packages and workflows. This proposal changes those concrete constraints; it does not treat owner Git publication authority as approval to silently change the implementation design.

### A. Correct provider coverage
Keep the deferred FieldsProvider but group its existing five entries routes together with `/media`, `/media/:id`, `/views/album.composer`, `/views/clinic.schedule`. These all consume fields services; inspect any further consumer before adding it. Keep authentication and route access unchanged. Files: `apps/web-back/src/routes.tsx`, `pages/entry-layout.tsx`; add a focused actual-App regression without the globally provided test helper. Re-run existing media/composer/schedule/entries journeys. Do not change field package behavior or fixtures.

### B. Replace the ineffective fixed import recipe with bounded module analysis
Allow incremental import-boundary work in Front routes, states/shell/member-auth/member pages, Back/Admin route shells, plus `packages/ui` exports and toast loading. Include supporting regression tests. Current Front still statically reaches member pages and shell through states/member-auth; all three entry chunks retain Sonner despite deferred wrappers. Validate any UI side-effect/export change, preserve CSS and toast behavior; no blanket tree-shaking metadata without a module-side-effect audit. Measure after each small change and stop on any semantic regression. Do not move the entire app behind an artificial async bootstrap simply to evade the static-entry metric. Keep Front92160/Back163840/Admin163840 and Vitals limits unchanged; no dependencies, lock changes, API or backend changes. The exact first patch must be documented before editing under this expanded scope.

### C. Provide a canonical visual authoring path
Pin the documented canonical OS to existing CI `ubuntu-24.04` and authorize a bounded quality job in `.github/workflows/cms-scaffold-ci.yml` (or a dedicated CMS quality workflow). Initial authoring produces exactly70 PNGs, verifies required Noto TC fonts/Chromium and uploads only the expected baseline artifact. Explicitly allow the baseline-update flag in that initial authoring job; subsequent verification must compare, never auto-update existing PNGs. Download and visually review the baseline before committing it. No new service permissions beyond read-only checkout/artifact publishing, and no deployment.

### D. Make real-API acceptance disposable and reproducible
Authorize runner/config and an e2e-only Compose override for an isolated project with uniquely owned volumes; never call `down -v` against the shared default project. Wire an ephemeral test password to the disposable API seed environment and the browser, or copy the generated per-user seed file privately after startup. Preserve the requirement that passwords come to the browser through CMS_E2E_PASSWORD or its private file, never Git or logs. Use the existing Docker daemon with a workspace-local Compose plugin if needed; no system installation or existing data cleanup. Implement redaction and cleanup for owned resources, record every attempt, and retain the14 real journeys. Correct browser override placement to `use.launchOptions.executablePath` without changing browser version.

## Risks and Follow-ups
Owner approved A–D together; documentation updated first and bounded work resumes. W5 remains PARTIAL; no W5 commit/PR/merge or new milestone starts from this failed candidate. Existing W4 #289 remains merged. Later full W5 gates (93 mock tests repeated3 times, Vitals25 runs, axe60, visual70, hardening11, real14 and native/remote CI) remain required and unrun. A new chat window is optional because a complete handoff is retained.

Artifact retention correction2026-10-05: the historical provider failure screenshot/trace paths were replaced by a later Playwright output reset before archival. Original observed hashes/error and compactfailurelog remain; see `.team/evidence/w5-provider-artifact-status.json`. Do not claim the originalPNG/traceisstillavailable. Later failures are archived before reruns.

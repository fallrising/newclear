STATUS: PARTIAL

## Summary

T-037 attempt 1 delivers the complete W3 domain implementation for run `DG-W3-20260923-01`, under W3 contract revisions 1–3 and the lead-authorized performance clarification. Worker branch is `agent/dim-gate/task/t037-delivery-domain`, fixed checkout `9b4a4c70a562b55b7f03f38d43d379e02eb997fc`, worktree `/home/ckc/test/codex/newclear-dim-gate-w3-domain`. Accepted W2 baseline remains `91626851fb17df7ab31c96dee9353b9ee4d42c92`. This worker did not commit, push, delegate, modify a historical worktree, or self-accept.

Canonical schema3 adds PipelineDefinition, ServiceConfig, TrafficPolicy and ServiceExecution collections. Strict original V1 and V2 snapshots retain their original navigation/run shapes; pure legacy integrity helpers normalize only empty W3 collections (and empty W2 collections for V1) before checking original relationships. Registered fictional references, bounded typed configuration entries, exact supported traffic plans and strict scenario target combinations are explicit schemas. The first schema handoff preceded API/UI implementation. Public DTO names and shapes stayed unchanged through later module extraction; all 172 exported schemas and the complete shared-reference contract graph compare exactly before/after.

Definitions have immutable revision history, semantic validation, independent production decisions, current requester/approver scope and explicit activation. Production impact uses proposed targets plus the actual active baseline being replaced, including the R1-prod → unapproved R2-nonprod → R3-copy bypass regression. Stale base activation is409. Definition runs preserve the selected-environment-only execution snapshot and source revision, use original five-stage pipelines and original production Release approval, and retain that snapshot on retry.

Typed configuration applies through validate/render/activate clock steps. Failure preserves active configuration and activeReleaseId; success alone updates the environment version and supersedes the prior active revision. Restore and revise always create a new draft. Traffic uses persisted30-second source-time intervals and real60/120/180-second health windows; thresholds are evaluated, missing data waits until twice-window timeout, and abnormal data fails immediately. Verified10/50/100 checkpoints retain their exact sample proof. A failed50 step preserves verified10; a failed first step preserves the captured prior distribution. Desired targets, effective weights and unmeasured active-release fallback remain distinct. Traffic does not rewrite activeReleaseId or artifact/release history.

One derived lock covers original nonterminal Pipeline/Release pairs and new config/traffic executions in both directions. Original production awaiting-approval delivery keeps its existing lock; new W3 source approval before execution is lock-free. All commands authorize current scope before replay inside the existing serialized lazy queue. Grant revocation, self-approval, Admin-only access, stale environment/base/source versions, competing starts and failed persistence are enforced. Receipts, scheduler events and audits preserve correlation, per-command reasons and every changed canonical source/environment reference.

Scoped detail/list/options/WorkItems/home/search/audit/notification projections use the same current source visibility. Definition full reads require all affected scope. Options derive real network references from visible canonical Placement/Relation/CI records; missing mapping stays unknown. Startup integrity checks revision chains, frozen content, approval/source relationships, run snapshots, shared locks, exact active and terminal scheduler positions, step ordering/timestamps, deterministic probe identities, immediate failure on abnormal samples and complete checkpoint proof. Reload resumes exact work without catch-up or repeated completion.

Existing delivery and observation mutations/schedulers now live behind the original engine command import. Canonical models and startup validation stay eager; legacy and W3 command-only input builders have separate modules. `schemas.ts` and `service-delivery-schemas.ts` preserve the public contract facade. Runtime model consumers use `schema-models.ts`; mutation modules import inputs directly, with no runtime facade import. The lead owns corresponding API/demo/runtime import changes and typed deferred API clients.

## Verification

All native commands used component cwd `/home/ckc/test/codex/newclear-dim-gate-w3-domain/platform/dim-gate`, Node24.18.0 at `/home/ckc/test/codex/.toolchains/node-v24.18.0-linux-x64/bin` on PATH, and component-pinned pnpm11.18.0. Commands used approved escalated execution because the default bubblewrap sandbox cannot launch. No dependency, budget, benchmark, build configuration or threshold was changed.

- `pnpm install --offline --frozen-lockfile`:334 cached packages, no dependency changes — passed
- Early focused checks identified a missing WorkItem source dispatch, additive W1/W2 draft assertions, and a transient overly broad config/traffic integrity guard; these were fixed and covered by final tests — failed
- Intermediate full suite328/335 had only parent-owned old schema2/seed-W2 and zero-Data-WorkItems assertions; parent supplied corrected exact dependency bytes, preserving real isolation checks — failed
- Intermediate typecheck after consuming updated parent W2 HTTP test exposed the old local API milestone union without W3; consumed the authorized immutable API dependency slice and retained the stronger test — failed
- Final `pnpm exec vitest run src/domain`:189/189 tests across9 files,1.98s — passed
- Final `pnpm test`:343/343 tests across31 files,8.53s, with authorized API/test dependencies — passed
- Final `pnpm typecheck` — passed
- Final `pnpm exec eslint src/domain` — passed
- `pnpm check:architecture`: feature import boundaries — passed
- Standalone Node `--experimental-strip-types` parity harness: exact exported names,172 individual JSON Schemas and complete `contractSchemas` graph match before/after both schema splits; recursive JSON validator identity preserved; log `/tmp/t037-schema-parity.txt` — passed
- Lead-authorized dependency-only `pnpm generate:contracts`:127 operations,259 schemas, all local references resolved; no owned API/doc change — passed
- Final `pnpm check:contracts`:127 operations,259 schemas, all local references resolved — passed
- Native live and demo builds during module extraction (`pnpm build`, `pnpm build --mode demo`) — passed
- Worker diagnostic unchanged `pnpm benchmark`, before final API/schema-boundary integration: initial gzip308403bytes exceeds307200 by1203; query and persisted HTTP command cases passed; this diagnostic tree did not include the complete new UI — failed
- Latest lead-reported complete-UI benchmark at handoff:307629bytes,429 over unchanged307200; query and persisted-command cases passed. Lead continues its owned runtime API correction; no benchmark acceptance is claimed by this worker — failed
- Initial `git diff --check` found one extra blank line at delivery.ts EOF; removed — failed
- Final owned `git diff --check` and all32 functional-slice3 SHA256 checks — passed
- 44 read-only dependency hashes verified; only explicitly authorized generated OpenAPI/runtime outputs may differ from their source copy, recorded in `/tmp/t037-readonly-dependencies-final.json` — passed
- First report validation invoked from component cwd could not resolve repository-root .team path; corrected to repository cwd, then fixed one missing list-marker space — failed
- Pinned `python3 /tmp/dim-gate-w1-evidence/teamctl.py validate-report .team/reports/T-037-attempt-1.md` — passed
- Final fixed-commit full UI/browser/performance, uninvolved review, CI and acceptance remain lead responsibilities; this worker does not claim those gates — skipped

Meaningful tests cover immutable definition runs/retries, active-baseline production removal, exact per-command audit reasons, independent project-only Ops approval, stale family bases, semantic duplicate-key errors and unsafe secret refs, config failure/restore, actual traffic windows/thresholds/unknown timeouts/retained checkpoints, reciprocal original/new locks including original prod approval, concurrent apply, current-scope replay after a held lazy import,507 atomic config and terminal traffic persistence, exact reload/no ghosts, scoped aggregates, and corrupt steps/timestamps/scheduler/sample/checkpoint proofs.

Diagnostic Chromium used the installed standard browser with `LD_LIBRARY_PATH=/tmp/dim-gate-m5-webkit-libs/usr/lib/x86_64-linux-gnu:/tmp/dim-gate-playwright-libs/usr/lib/x86_64-linux-gnu`, `FONTCONFIG_FILE=/tmp/dim-gate-m3-fonts-kaBaS8/fonts.conf`, and isolated port4179. No custom measurement configuration, alternate exclusions or retries were introduced. Diagnostic JSON is preserved at `/tmp/t037-evidence/diagnostic-performance-results.json`.

## Documentation

Copy exactly the32 owned domain files below plus this report. Immutable code source is `/tmp/t037-functional-slice-3`; manifest `/tmp/t037-functional-slice-3.json`. Final report-inclusive manifest is `/tmp/t037-attempt-1-owned-manifest.json`. These hashes identify uncommitted worker content on the fixed checkout; they are not a claim of a new worker commit.

- `src/domain/command-input-schemas.ts`: `4680b8fb56e4584de3dda139846c549e5c5c7c77d351ded3b08059e8a6aac0ba`
- `src/domain/delivery-commands.ts`: `ef9e243c4332061812b162373bc7717815112cfdc57e7ff4af8b74ae71dc117e`
- `src/domain/delivery.ts`: `8c2d329f121d465d4aed5e852376be38ee573f023427309489e8c674afa16d86`
- `src/domain/engine-commands.ts`: `a6997d7642ec88a6bda8fca8469a94ecf4bd75008e14d2bb204ba3efe44b83ee`
- `src/domain/engine-loading.test.ts`: `c4a817a6cad4579fa0130d96439057a2236e8d0de87d2372d583b4ad600cb1cc`
- `src/domain/engine.ts`: `5f76ad2998403298fc2265e790b7d4f301f44379ebad2f55a9c11dc6455110d7`
- `src/domain/integrity.ts`: `10b2eab2542b205fc657f0f3edd6510d9b6dbfb520b454d3d9d99d9346e35710`
- `src/domain/m4.test.ts`: `86bba4eadec1aa5b12c92a8375d6716dc04bc7ae8e4e78aa3dd37bc2cffdde5b`
- `src/domain/observation-commands.ts`: `920b113e406857c7684981950c5e7bee59a5225e4fb4e2a3ef8f045526bf9a58`
- `src/domain/observation-views.ts`: `d444ce207455afedde803c933efb029f82d6017d77960e002d7b8c96349a37bf`
- `src/domain/observation.ts`: `97d9f2638e97e8dbd9bc7794e8b61d22e968942e86c10af956a18e125f45db95`
- `src/domain/policy.ts`: `14200b3255d036b152abfc0ae9a262404f77f3b0b3a45a4bcf3dda28e1291e39`
- `src/domain/resource-capacity.ts`: `b40b637be2c867765b8897d9220dc4364474195b376dbde4e83effbf2c3cc7c8`
- `src/domain/resource-integrity.ts`: `524303a8fad79c5c57df28c940af75f5eb87c25768504f8cbc45b7b7a3c3f828`
- `src/domain/resource-views.ts`: `74b9cadd45aa2cccccf2c3adb6ce41e402feca3fdc2b242fe16d31dad85b2dbe`
- `src/domain/resources.ts`: `eb8e79e04e4454953636ff957a34a592503ac72126ee9ed181707570274866c0`
- `src/domain/schema-models.ts`: `b1281e66d85f2fae6ae342bf0ddd5b76f1a4e0072a52aff87cdcff50cf5497b8`
- `src/domain/schema-primitives.ts`: `1293078badb920ed1993df179d4c4be9118b966acff91ba192124fc31919e777`
- `src/domain/schemas.ts`: `bd3fbbb55d0b883445a40b9d66e3b19d430204dac58980185274dfd5f23a0388`
- `src/domain/service-delivery-commands.ts`: `1fbb9000dede05f8a28f2481e40fab947b2cba4a3958cbfa58fe04893aa36c72`
- `src/domain/service-delivery-input-schemas.ts`: `3b3b6ff3ea650e35d1ec8149f0f17ded33088ba4614468fcb5fee272b75f0cff`
- `src/domain/service-delivery-integrity.ts`: `13ca4094b6b93452f99ad96c5f8f3b9ae816d220b91255690009cd30442c852a`
- `src/domain/service-delivery-models.ts`: `4b2971cba46ce2b72ec1c648da7d769c235fffcffe9e1e8ff9a0855956aec3c1`
- `src/domain/service-delivery-policy.ts`: `9fdf98a932d7f5878c41ff574bb5df60103fba2693d72793af42fc4811e398c6`
- `src/domain/service-delivery-schemas.ts`: `62eac262e3136ed5326f2f5eee5e44721fe16448fbe79514070dc1c66bad2a11`
- `src/domain/service-delivery-shared.ts`: `ef45eb48452dfe5d9e7a8a88368d94aaca8b0df7b2713ebf15e8d7a5897909fd`
- `src/domain/service-delivery-validation.ts`: `b2a17e9693a6edc4d56a2e305c4ca25552d82e978fc94119e072afd4220c014b`
- `src/domain/service-delivery-views.ts`: `a677dc813d3e0419dd283677dbe4277ecfffa49a500af4b5fd283996c70b976c`
- `src/domain/w1.test.ts`: `d17961f0e47c75c4d32eb875775d2553ab28321ded80c0791cff8aeb8636909b`
- `src/domain/w2.test.ts`: `dd05556f8d504f7b59dcd31bf3493f7be3b3e1a09f4ef7e2f8d13c315abf18ef`
- `src/domain/w3.test.ts`: `60a98adfc7687de3271e8fd036cda53406ed0a4d3ef516b82ee7dc5536684ea2`
- `src/domain/workspace-home.ts`: `fe3dda16d4c46aa3f4da60b137194db952ab101d43a1e66f10f05e7a1c9c7062`

Authorized read-only dependency copies are recorded in `/tmp/t037-readonly-dependencies.json` and verified in `/tmp/t037-readonly-dependencies-final.json`. They include seed/migration files, router/resource UI read dependencies, corrected parent test expectations, and immutable API slice3 from `/tmp/dim-gate-w3-api-slice-3`. Every immutable source hash was checked before copying; clean-target guards and `/tmp/t037-api-dependency-backup` preserve prior API bytes. They are excluded from owner handback. Parent explicitly authorized regenerating only dependency OpenAPI/runtime output after the recursive schema identity correction. No API/UI/demo/router/doc/PLAN/CI source was authored by this worker.

Prior immutable checkpoints `/tmp/t037-schema-slice-2.json`, `/tmp/t037-functional-slice-1.json` and `/tmp/t037-functional-slice-2.json` remain available for handoff provenance. Slice3 supersedes them for integration. Registry entries and all public create/patch/action/query/detail names are preserved by the public facades; canonical model and command builder module paths are the only structural change.

## Risks and Follow-ups

- Status is PARTIAL because historical failures and pending lead-owned final gates are retained, not because domain methods are stubbed. No worker self-acceptance is implied.
- The remaining measured startup overage is explicitly open in the lead-owned complete UI integration. Root is completing the Shell API split; latest complete-UI measurement at handoff is307629bytes,429 over budget. Budget307200, measurement settings and required eager snapshot validation stay unchanged.
- Lead must run its final fixed source tests/browser/performance/review/CI after combining slice3 with its latest API/UI work. Worker full-suite totals refer to this worker dependency set, not the lead's additional W3 UI/browser test files.
- After the validated report and hashed handback, the worker releases domain ownership and stops writes. Any subsequent domain correction requires a new bounded follow-up from the lead.

STATUS: PARTIAL

# T-019 — M3 delivery UI and browser journeys

## Summary

- Task: T-019, revision 1, attempt 1; project `dim-gate`, variant `mainline`.
- Worker scope: `/home/ckc/test/codex/newclear-m3-ui`, branch `agent/dim-gate/task/t019-delivery-ui`.
- Input base: `f1c5cc6a0d9f47e796c675eb7041ae3b9bf25116`; [M3 integration contract revision 1](../../platform/dim-gate/docs/M3-INTEGRATION-CONTRACT.md); AC-13–16 and AC-24, with AC-20 and accessibility regression scenarios.
- The lead created UI checkpoint `d40b98eadb6c7ca993cd91eefe8df804d8fcd4be` while this worker finished the browser scenarios. The worker did not commit, push, merge, delegate, change shared files, or deploy.
- Typed API methods and four delivery pages are implemented. Browser scenarios are authored and discovered; integrated browser execution remains the lead's gate, so this report is PARTIAL and is not acceptance.

Exact implementation files:

- `platform/dim-gate/src/api/clients/delivery.ts`
- `platform/dim-gate/src/features/delivery/index.ts`
- `platform/dim-gate/src/features/delivery/pipelines.tsx`
- `platform/dim-gate/src/features/delivery/releases.tsx`
- `platform/dim-gate/src/features/delivery/dialogs.tsx`
- `platform/dim-gate/src/features/delivery/shared.tsx`
- `platform/dim-gate/src/features/delivery/delivery.css`
- `platform/dim-gate/e2e/m3-delivery.spec.ts`
- `.team/reports/T-019.md`

Public exports from `features/delivery/index.ts`:

- `PipelineListPage({ session })`
- `PipelineDetailPage({ session })`
- `ReleaseListPage({ session })`
- `ReleaseDetailPage({ session, center?: 'rd' | 'ops' })`, with `center` defaulting to `rd`.

API exports: `createDeliveryClient`, `DeliveryClient`, `CreatePipelineInput`, `RollbackReleaseInput`, `PipelineDetail`, `ReleaseDetail`, `PipelineListInput`, and `ReleaseListInput`. Client methods are `listPipelines`, `getPipeline`, `createPipeline`, `cancelPipeline`, `retryPipeline`, `listReleases`, `getRelease`, `approveRelease`, `rejectRelease`, and `rollbackRelease`. The four reason commands use `(id, expectedVersion, reason)`; rollback uses `(id, RollbackReleaseInput)`.

Implemented behavior:

- URL-backed application/environment/state filtering and pagination, scope-bound queries, loading/error/404/empty views, and readable transport error code/request ID.
- A ready-environment trigger dialog, five selectable stages, timestamped stage logs, immutable artifact metadata, retry references, cancellation/retry with reasons, and operation audit with actor, reason, correlation and timestamps.
- Separate current-active and candidate-release views; scoped non-self Ops approval/rejection; rollback with same-environment targets, reviewed versions, a required reason, and retained previous/target references.
- Existing Radix dialogs provide contained focus, Escape and trigger focus restoration. Mutations disable repeat submissions and preserve failed form input. Reason and rollback dialogs retain the versions reviewed when opened; an explicit reload closes the dialog for renewed confirmation.
- Feature-local CSS uses the existing semantic colors and wraps stages at narrow widths; complex tables scroll locally.
- All mutations use the shared transport; no snapshot writes or UI-created fixture state. Clock and one-shot fault controls are explicitly labeled as simulations and do not advance automatically.

## Verification

Runtime: existing Node `24.18.0`, pnpm `11.18.0`, frozen repository lockfile; no dependency changes. Commands ran from `platform/dim-gate` with the existing toolchain prepended to PATH.

Final static checks tested UI commit `d40b98eadb6c7ca993cd91eefe8df804d8fcd4be` plus the local, frozen `e2e/m3-delivery.spec.ts` overlay. Earlier checks tested `f1c5cc6` plus the same implementation diff; they are not browser evidence.

- `pnpm install --frozen-lockfile`; 334 existing locked packages reused, no dependency or lockfile edits — passed
- `pnpm typecheck`, including all nine browser scenarios; exit 0 — passed
- `pnpm lint`; exit 0 — passed
- `pnpm check:architecture`; public feature import boundaries respected — passed
- `git diff --check` for the tracked worker state; no whitespace output — passed
- `pnpm exec playwright test e2e/m3-delivery.spec.ts --list`; nine Chromium tests discovered, no browser execution — passed
- Integrated `pnpm test:e2e -- e2e/m3-delivery.spec.ts`; shared engine/API/router/policy composition absent in worker baseline, lead executes after transfer — skipped
- Screenshots, axe, DOM evidence and browser-health assertions as worker execution evidence; no screenshot or browser pass claimed — skipped

Authored independent Chromium journeys:

1. Real M2 request → Ops approval/provision → newly ready staging → stable → next → reasoned rollback, verifying active changes only after the health gate, package logs, reload, artifact equality, previous/target links, and audit.
2. Build failure → retained stable active → new retry run → success; original failed history stays visible.
3. Health failure → failed candidate with unchanged active → new retry run → success.
4. Visible Admin grant adds an Ops project role to the RD initiator; Admin pipeline creation and initiator self-approval still return 403; a different Ops approves prod and both actors remain visible.
5. A second trigger reports `ENVIRONMENT_BUSY`; pre-deploy cancel releases the lock; retry creates a new run; cancellation is disabled once deployment starts.
6. Prod rejection ends the candidate; another awaiting-approval run can be cancelled; advancing the clock does not activate cancelled work; the environment accepts another trigger.
7. Rollback failure keeps the active version; a second reasoned rollback creates a different release and succeeds while failed history remains.
8. A different project sees empty pipeline lists and 404 run/release details without source revision disclosure.
9. 390/768/1440 layouts, light/dark semantic styles, locally scrolling tables, dialog focus containment/Escape/restore, axe serious/critical checks, and Ops release-list visibility.

Every successful business transition uses a visible UI control. Browser API calls only read state evidence or deliberately exercise denied commands. Each test captures console/page/request/HTTP failures and visible DOM; expected 403/404/409 responses are recorded explicitly for the corresponding rejection tests.

## Documentation

This report records exports, files, actual verification and the integration boundary. Product scope, schema and workflow specifications remain the lead-owned fixed M3 contract. No PLAN, STATUS, shared schema, global CSS, route, seed, engine or existing feature files were changed by this worker.

Lead handoff normalized only verification-line formatting to the kernel validator. The original worker report is preserved unchanged in source commit `768435a`; status and evidence were not upgraded.

## Risks and Follow-ups

- Lead integration must compose `createDeliveryClient`, register the four page exports, pass the current session, and pass `center="ops"` to the Ops release detail. Existing environment links and global invalidation are lead-owned.
- The worker baseline lacks the lead's new `canPerformProjectAction` export. By explicit coordination, the lead will replace the temporary delivery-local `projectAction` implementation with a wrapper around that shared policy helper during integration. The API remains the authoritative scope/state enforcement layer.
- The UI temporarily uses the task-authorized intersection cast for the composed delivery client and the extended demo scenario signature. Integration should supply all referenced methods through the existing shared API instance.
- Browser scenarios are ready but unexecuted here; selectors, runtime behavior, screenshots, responsiveness, axe and browser-health gates still require integrated production execution. No independent review or milestone acceptance is claimed.
- UI source is saved in the lead-created local checkpoint above; browser source and this report are local worker changes until the lead saves/transfers them. Remote durability is not asserted.
- Next action: integrate the frozen client/pages and browser file with the lead's M3 engine, replace the temporary policy guard, then run typecheck/lint/build and all nine production Chromium scenarios. Preserve any browser failure as concrete rework evidence before acceptance.

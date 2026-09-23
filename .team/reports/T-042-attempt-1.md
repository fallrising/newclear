STATUS: PARTIAL

## Summary

T-042 bounded W4 API/demo/migration handback at the contract base. Lead added this validator header after SHA-verified integration; the worker's detailed handback remains below. No worker acceptance or remote operation is claimed.

## Verification

- Accepted-W3 active fixture capture, isolated lint and diff check — passed
- Isolated typecheck and focused W4 HTTP tests before T041 domain integration — failed

## Documentation

The fixed revision-1 W4 integration contract and task define this scope. Lead generated the full runtime/OpenAPI artifacts and ran the combined gates separately in the canonical W4 validation report.

## Risks and Follow-ups

This attempt is a partial handback; its dependency failures are retained below. Combined source, full browser, independent review and CI remain lead-owned.

Bounded API/persistence source handed back; integrated gates and acceptance remain with lead.

## Scope and source

T-042 attempt1, run `DG-W4-20260923-01`, base `9fd3279ead6aa9e776c56c9fb3066e670631484a`, W4 contract revision1 plus lead's clarified additive navigation and CI-only incident requirements. Worker branch `agent/dim-gate/task/t042-alert-api`, worktree `/home/ckc/test/codex/newclear-dim-gate-w4-api`. No commit, push, merge, deployment, external notification, domain/UI/PLAN edits, or delegation. Root owns integration and acceptance. Owned SHA256 manifest is `/tmp/t042-owned-manifest.json`; all manifest paths are repository-relative and must be checked before consumption.

Implemented a v4 fresh seed and strict v1/v2/v3→v4 reader. Original legacy schemas and relationships are validated before additive metadata; every old identity, work row, event, audit, receipt, scheduler task and envelope field is retained. Only empty monitoring/infrastructure collections and metrics are added. Three fixed W4 navigation rows are added to fresh and migrated sessions; old navigation rows and order remain, and reserved-ID collision fails before the controller's atomic write. Quota, malformed data and incompatible snapshots leave original bytes unchanged. The genuine accepted-W3 active-session fixture was captured against product SHA `46e3a557fcd1ff40221ce6881a7565b73c5daa7e`, with an in-flight service configuration and scheduler task; fixture SHA256 `8d8271b06a5a114d4e218cdae2dae8315d6d8988cdebbe3091bb29ad1583c0a8`, 95,216 bytes. Capture source is retained beside it. Existing v1/v2 migration expectations now target v4 and retain their legacy fixture hashes.

Typed lazy-loaded `alerting` client includes all six list/detail collections, three policy create/revise/action families and Silence create. The list query has bounded pagination/sort and per-collection status enums. W4 operation registry defines 34 read/command operations and response schemas, with the OpenAPI generator marked W4 implemented. Existing `/incidents` list/detail wire contract and typed client accept both service and CI-only incident variants through the one canonical route, including `ciId` filter. Runtime manifest and generated OpenAPI require regeneration after T041 domain source is integrated; they have not been falsely marked current in this isolated tree. New direct HTTP tests exercise typed policy/SLO/Silence/evaluation/delivery operations, independent prod approval, scope/DTO/version denials, infrastructure incident readback and operation descriptor parity.

## Actual verification and current dependency

- Temporary accepted-W3 fixture capture via `pnpm exec vitest run src/demo/capture-w3-fixture.test.ts`: 1/1 passed; temporary cross-worktree test was removed after writing the versioned fixture and capture recipe.
- Component `pnpm lint`: passed. `git diff --check`: passed.
- Component `pnpm typecheck`: exit 1 in this isolated T042 tree. T041 files/exports (`monitoring-models`, monitoring input schemas, legacy v3 schema/integrity, incident variant and navigation schema) are absent here by ownership design. It also shows `src/features/observability/incidents.tsx` assumes service-only incident after the new union; T043 was notified to add a discriminant guard in its UI scope.
- `pnpm exec vitest run src/demo/w4-migrations.test.ts src/demo/w4-handlers.test.ts`: exit 1, 8 passed/8 failed in this isolated tree. The missing T041 `monitoringNavigationItemSchema` and `legacySnapshotV3Schema` prevent seed/migration setup; old snapshot remains v3 here. Four W4 HTTP cases fail at setup, not at their asserted business transition. The tests are not counted as product green.
- `pnpm check:contracts` and the full `pnpm test -- src/demo src/api` were not represented as passing: they require the T041 runtime schema and regenerated artifacts. Lead must integrate exact owned bytes, regenerate contracts, run typecheck and focused/full gates, then review failures against actual W4 behavior.

Domain worker confirmed exact DTOs, six read paths, policy command paths and 34-operation model. All six list routes accept the same scope filters; status values are constrained by collection. Nonproduction and infrastructure policy flow is create→validate→submit→activate; production requires an independent Ops approve between submit and requester activation. `setScenario('alert-breach',{ruleId})` generates deterministic persisted evidence; a clock step dispatches queued Mock delivery. T043 received the public typed client method/type names and the incident union impact. The known-target denied write returns 403 and scoped detail remains 404 per T041's latest change.

## Integration work still required

1. Integrate T041 domain files and this owned manifest into the lead's canonical W4 worktree without overwriting unrelated edits. Ensure T041's `scenarioInputSchema` includes alert scenario keys and `ruleId`, and its `incidentVariantSchema` remains the single response union.
2. Generate `docs/openapi.json` and `src/api/runtime-operations.ts` with `pnpm generate:contracts`, then run `pnpm check:contracts`; both generated outputs are owned by T042 but absent from this handback because T041 exports are not present in this isolated tree.
3. Run `pnpm test -- src/demo src/api`, `pnpm typecheck`, lint, and diff checks on the integrated source. Update any direct HTTP assertion only with actual domain evidence; preserve strict denial, legacy byte retention and operation parity.
4. T043/UI owner must handle CI-only incident narrowing in its existing incident view. Lead must complete all broader W4 gates and independent review before acceptance.

This handback is a bounded implementation checkpoint, not T042 product acceptance or a claim that W4 is complete.

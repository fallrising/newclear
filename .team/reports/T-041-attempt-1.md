STATUS: PARTIAL

## Summary

T-041 bounded W4 domain handback at the contract base. Lead added this validator header after SHA-verified integration; the worker's detailed handback and source manifest remain below. No worker acceptance or remote operation is claimed.

## Verification

- Focused W4 domain tests 5/5, domain typecheck/lint and diff check in the worker tree — passed
- Complete native suite in isolated domain-only tree, before T042 seed integration — failed

## Documentation

The fixed revision-1 W4 integration contract and task define this scope. Lead integrated the manifest and ran the combined gates separately in the canonical W4 validation report.

## Risks and Follow-ups

This attempt is a partial handback, not a product verdict. Combined source, full browser, independent review and CI remain lead-owned; see the current canonical W4 validation report.

# T-041 attempt 1 — W4 domain handback

Run `DG-W4-20260923-01`, base `9fd3279ead6aa9e776c56c9fb3066e670631484a`. Worker handback only; no commit, push, acceptance or merge.

Implemented fixed v4 schemas and strict v3 reader/integrity adapter; current target scope and RD/Ops authority; independent production approval with current Ops grant recheck; immutable revisions; source-time rule/monitor revision evaluation; service and CI-only canonical Incident list/detail/ack/investigate; 24-hour Silence; persisted queued/suppressed/delivered/failed delivery statuses. W4 snapshots retain M4 incident and observation proof. No external collection or delivery.

Focused verification in this isolated worktree: `pnpm exec vitest run src/domain/w4.test.ts --reporter=dot` 5/5 PASS; `pnpm exec tsc -b --pretty false` PASS; `pnpm exec eslint src/domain` PASS; `git diff --check` PASS. The broad `pnpm test -- src/domain` attempt yielded 84 passed/291 failed because the isolated T041 worktree still contains the W3 `createSeed` that calls v4 `snapshotSchema.parse` with v3 fields; T042 owns the v4 seed/migration in a separate worktree. The focused test strictly parses that original v3 seed then adds only the v4 empty collections, and is written to pass through T042's v4 seed after integration. The lead must rerun the complete native suite and all other gates on the combined head. Tests cover production independent approval/revocation, CI incident evidence and Ops action, queued→delivered, dispatch-time Silence and expiry, failed delivery, and active monitor revision pinning. Further independent review is pending.

Source SHA256 manifest (paths relative to repository root):

```text
40c149a6c2e1b3b30da752739c18baae9fa2520e7bd1c2ebed590bc1a780ee7f  platform/dim-gate/src/domain/engine-commands.ts
dda1fa8af3a38ec34ddc88f1132cd5fd78bd071a61506b0605bf760030605aab  platform/dim-gate/src/domain/engine.ts
43d0c1077ae32b65687e7029d418b0683f3df9eb01da70c3e68431d07743dbe1  platform/dim-gate/src/domain/integrity.ts
670f5a7dac8714c68e566fb3694062ff8b2f8f94dfbdc471901625a2be9a589d  platform/dim-gate/src/domain/observation-commands.ts
6db9a9d958e6fccbd0006c0a0c5a2166522c9095b2209196d3e66cba046cc31e  platform/dim-gate/src/domain/observation-integrity.ts
8db1955129e9cf75f7f789082f4a1467964425dcdc3bdcbc46adc5a6716c3dd0  platform/dim-gate/src/domain/observation-views.ts
2f5b79780c0a550e9bdb8782af2d85f67b87bdc20559488dea8a7d9c611a846d  platform/dim-gate/src/domain/schema-models.ts
194bb209726fcae55cdf5124b6ee9ca8a52b8c7385651a283ac8a40d6dbf0ed2  platform/dim-gate/src/domain/schemas.ts
f9297d0eb4db2e8aff454815e37426ff0a0b5cd5dea18673e8b6f6fc6b99fd84  platform/dim-gate/src/domain/monitoring-commands.ts
d0f5f654fb83f1c1ae8410d502c8495cd4030d6da8c7ffd157117d7b682a5700  platform/dim-gate/src/domain/monitoring-evaluation.ts
eb8129722a781ec809a46a5c14cb84fe3a0857a521741b5d82eba4adc1eb6845  platform/dim-gate/src/domain/monitoring-input-schemas.ts
fdc5d9989e153fae012399e07c25335c8479ed3ec02a6725f3050d59889a3d6e  platform/dim-gate/src/domain/monitoring-integrity.ts
dd1233f4d020f3344de63521380c461f047836f8074329dd3ea2aec26a56a2fc  platform/dim-gate/src/domain/monitoring-models.ts
925de348bc2921ada3224b9dfefbd00eb75566f0f73515b2a97f0280e8ceb89f  platform/dim-gate/src/domain/monitoring-views.ts
2c951a26f11d7ba119d3a1fe77d501f9563fdf93dfd777419a3640aa538337b7  platform/dim-gate/src/domain/monitoring.ts
83aedee34ada8d5d5a3d01d6ec629f8c90ce8ae653ffdbbdbc85028bb9afc654  platform/dim-gate/src/domain/w4.test.ts
```

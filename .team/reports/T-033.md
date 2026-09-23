STATUS: PARTIAL

## Summary

T-033 attempt 1 delivers the complete bounded W2 canonical resource domain implementation for run DG-W2-20260923-01. Fixed checkpoint `7086a443416fbc9876612e66bac889e83c8200ad`, branch `agent/dim-gate/task/t033-resource-domain`, worktree `/home/ckc/test/codex/newclear-dim-gate-w2-domain`. Evidence binds to that unchanged HEAD plus the 16 owned source files hashed below. Worker did not commit, push, delegate or accept its own work. Lead owns integrated fixed-commit gates, browser validation, independent review and acceptance.

Implemented schemaVersion 2 with typed compute/Redis/Kafka catalogs, canonical ResourceObject/ResourceBinding/ResourceQuota/ChangeRequest/ChangeExecution, strict change inputs and scoped resource inventory/service/WorkItem DTOs. Original Request.templateSnapshot remains compute-only. Exported strict legacySnapshotSchema and pure legacyIntegrityErrors let T-034 validate original relationships before migration; no migration or business seed implementation belongs to this worker.

Resource changes use the existing engine queue, current policy before replay, expected versions, atomic persistence, stable planned IDs, correlation/audit/events, immutable submitted proposal/catalog snapshots, independent approval, derived quota reservation, parent execution lock, five shared-clock steps, failure diagnostics and explicit retry with a new decision. Success creates/reuses canonical object/binding/Placement atomically. Approved/executing changes do not fabricate active records. Existing-object bind consumes no extra quota; resize reserves only positive delta and shrink frees used quota on success. Kafka normalized identity is unique within parent/kind/namespace across history. K8s stays readonly.

Explicit app/environment grants protect object and binding payloads; Ops also requires target pool. Shared partial readers see incomplete impact and null private capacity totals, with no hidden consumer IDs/counts. Change detail, WorkItems, home, search, audit, notifications and guide scheduler counts use current scope. Existing Request/Release state machines and their action-specific scope remain intact. All 60 original CI IDs survive the additive seed; domain fixture counts intentionally account for three new physical parents.

Lead-confirmed contract clarifications: RD shared resize requires every affected RD project/stage but no Ops pool; Ops maintenance requires pool plus every affected Ops project/stage. Existing-object binding affects only its new consumer environment and object version, while shared resize freezes all affected consumer environments. The maintenance requester may execute after a different qualified Ops approves; approve/reject alone enforce nonself. Qualified Ops can read published resource catalog metadata through compatible parent pool plus allowed project/stage; compute catalog visibility is unchanged. Full frozen registered catalog metadata, including allowed parent IDs, remains immutable and does not grant physical detail or consumer access. Worker did not edit the lead-owned contract/task documents.

## Verification

Every pnpm command used Node 24.18.0 via `PATH=/home/ckc/test/codex/.toolchains/node-v24.18.0-linux-x64/bin:$PATH`, component-pinned pnpm 11.18.0 and component cwd. Verification below is worker evidence, not a milestone gate claim.

- `pnpm install --frozen-lockfile`: 334 cached packages, 680 ms; no manifest or lockfile edit — passed
- Initial `pnpm exec vitest run src/domain/engine.test.ts`: 42/45 passed; three original 60/30 count assertions required the intentional additive 63/33 fixture update, completed later — failed
- First focused W2 run: 10/11 passed; resize assertion incorrectly assumed the seeded Commerce allocation was 2048 rather than 1024 MiB; corrected expected delta from 1024 to 2048, then all 18 expanded tests passed — failed
- Initial `pnpm exec vitest run src/domain`: 156/163 passed; seven old fixture assertions covered original counts, disabled compute catalog alongside new catalogs, and an added Placement that duplicated a new explicit seed association; fixed only those fixture expectations/setup — failed
- Subsequent `pnpm exec vitest run src/domain`: 163/163 passed across 7 files, 1.25 s — passed
- Final production-source `pnpm exec vitest run src/domain`: 166/166 passed across 7 files, 1.35 s, including 21 W2 cases — passed
- Final test enhancement `pnpm exec vitest run src/domain/w2.test.ts`: 21/21 passed, 806 ms; mixed WorkItem test now creates actual Request, Release and Change through canonical commands and verifies mine/team filtering — passed
- Initial `pnpm exec eslint src/domain` reported one unused test type import; removed before final lint — failed
- Final `pnpm exec eslint src/domain` — passed
- Prescribed `pnpm test -- src/domain` actually discovers the complete suite: 259/266 passed across 24 files, 6.86 s. Seven failures are untouched cross-owner baseline expectations in src/demo/controller.test.ts (four old 60/old seed assertions), src/api/clients/cmdb.test.ts (two old 60/61 counts), src/demo/w1-handlers.test.ts:47 (old ciCount 1, now 2) — failed
- `pnpm typecheck`: no domain errors; 14 errors only in untouched src/features/admin/routes.tsx and src/features/self-service/routes.tsx assuming all catalog templates have compute fields. Earlier tsc probes exposed the same cross-owner narrowing dependency after domain narrowing was fixed — failed
- `pnpm check:contracts`: untouched generated OpenAPI drifts from schema 2/public schema changes; generation and new API operations belong to the lead and were deliberately not written here — failed
- T-034 attributed independent evidence, not a command run by this worker: migration worker reported 33/33 migration/fixture/resource persistence tests passed against the then-current read-only domain slice, 658 ms; covering Redis/Kafka active reload, terminal write 507, failure/retry stable IDs, scheduler corruption and reset. Later domain changes need lead integrated rerun — passed
- `git diff --check` before report and again after report creation — passed
- `python3 /tmp/dim-gate-w1-evidence/teamctl.py validate-report .team/reports/T-033-attempt-1.md` — passed
- Integrated demo build, browser/accessibility/responsive/cross-browser, performance/initial JS budget, fixed-head CI and independent review are lead responsibilities and were not executed in this worker tree — skipped

Coverage includes hidden Data allocation/consumer isolation, physical-only pool scope, current authorization before same-key replay, revoked shared consumer detail 404/command 403 across all global projections, strict unknown/duplicate/mismatched queries, safe profile allowlist, Admin/project-only/self-approval denial, registered parent compatibility, all-consumer catalog stage restriction, last-quota concurrent approval, cancellation release, atomic persistence 507/retry, stable IDs and preserved execution history, parent locks/reload, catalog disable/revision conflicts and running-snapshot completion, object/binding/Placement identity, quota overcommit and corrupt frozen/scheduler snapshots.

The environment's default bwrap sandbox cannot start commands; narrowly scoped require_escalated execution succeeded through auto-review. apply_patch helper failed before any edit, so owned edits used reviewed shell/Python writes. No auto-review rejection was bypassed.

## Documentation

Exact owned source manifest is also saved as `/tmp/t033-owned-manifest.json`. Lead should integrate these 16 source files plus this report only:

- `src/domain/engine.test.ts`: `bc5e7985866b75c3ff41b2bfc5848548844606e856e4266fc403358548ff55ae`
- `src/domain/engine.ts`: `4caf63b5db124a3a98e444db97a65b897fcd04346f18813ca271475cfebf816f`
- `src/domain/integrity.ts`: `fe2b4d86e4e03a4ffa8c6a50764235cfe44ed36be3c6ebacef507e1aa439adea`
- `src/domain/m1.test.ts`: `13706ba69fe42ffd192e0f44d493f36d64c17f0ac1877c7f6f5976303f6d9894`
- `src/domain/m2.test.ts`: `fe8590ae5c2f732c321a0d3dfda6c38c0f239b1db6abedee08ab87fa51f9c9ac`
- `src/domain/observation-views.ts`: `2a8a7a8679f099603167c10916072c81c2dfb779625cbda2fccfde5868577f8f`
- `src/domain/policy.ts`: `01e14dbfea265bdafc33903fe99ac9326c01e5de953ef44520c8bdea3e8a001f`
- `src/domain/resource-capacity.ts`: `cbca94eb9c55ce0b144821ed77ff543ab6db7753fd8cc43f1311cf9acc8c504f`
- `src/domain/resource-integrity.ts`: `ed84f0966ae66ba3fb10b56351dd1ad990eae1b28356f426d4909deddedb4e34`
- `src/domain/resource-policy.ts`: `e27b53e96cce0c51c29323214dd1d8e41eeffdc017a458182bb35b1c3d936f8a`
- `src/domain/resource-views.ts`: `615a85e843e4d63f1fffaa079ca27e95b07de64b17367c64140c31cbf49c2e15`
- `src/domain/resources.ts`: `f24da72d89548a4a9d07031b14465a795bb26c07139d59031d625f498f7caaab`
- `src/domain/schemas.ts`: `32df18629fde362da6efffed9284f03a8778f639e655aff20903bd808766b0f5`
- `src/domain/w1.test.ts`: `575cff0f74ce4e396a48b35a27d6b50c95c5d6470602530c0d1e1c991b06cec7`
- `src/domain/w2.test.ts`: `b5d884f70acf31985e283205b8f3b2ddbb3437f689bac7e9a10672d54f07ffb0`
- `src/domain/workspace-home.ts`: `09bd3e10516500a7eb841281d7b8c7ef2a0a9926b6f810a8e689177e7b413adb`

The following T-034-owned files were copied byte-for-byte solely as explicitly authorized test dependencies. They are excluded from T-033 ownership and handback; their owner supplies the authoritative integration copy. Dependency hash record: `/tmp/t033-seed-dependencies.json`.

- `src/demo/seed.ts`: `62c85d80c1eea8c757a524e46ad42657467136d6439b20e819d25ce189923f1b`
- `src/demo/seed/core.ts`: `38b44f457a0d6a17333a6efdd4411d6ad532a70955e79e14f802ba1c8d00f359`
- `src/demo/seed/resources.ts`: `b6ac810e02fe887146f28b0c195fed615167420b8c9c2267de055383bb6a7bdc`

No API, UI, router, manifest, CI, docs, PLAN, migration/controller, seed implementation or sibling component changes were authored. The old W1 worker tree remained untouched. Existing domain test edits preserve legacy behavior and change only type narrowing and intentional additive fixture assertions/setup.

## Risks and Follow-ups

- PARTIAL reflects standalone cross-owner validation dependencies, not an omitted resource engine stub. Lead must integrate T-034 migration/seed and its own typed API/UI/generated contracts and update the listed old baseline assertions, then run the complete gates against a fixed commit.
- Public schema shape was published early for read-only consumption. Final schema tightening changes only WorkItem state query validation to the union of actual Request/Release/Change raw states; regenerate OpenAPI from the final schema. Search continues using title (not label), with resourceObject/resourceBinding/change result types.
- Resource access profile registry exports resourceAccessProfiles with w2-profile-redis-runtime, w2-profile-kafka-producer, w2-profile-kafka-consumer and seed-only readonly w2-profile-k8s-reader. Binding and catalog integrity and commands enforce kind/purpose compatibility; no arbitrary credential/profile payload is accepted.
- Registered catalog parent IDs remain metadata by the lead's explicit clarification. Object choices, canonical payloads, execution actions and private used/reserved/observed values still enforce their own current scope. Full ChangeRequest payload is withheld from partial shared-impact readers.
- Parent locks serialize resource executions on the same physical parent. Quota is derived from active objects and approved/executing changes; observed usage remains null without a sample. No real cloud, Redis/Kafka infrastructure, Kubernetes command, external notification or secret is involved.
- Worker releases source ownership after validated report and final handoff. Lead may then copy and own integration fixes; this report does not self-accept T-033 or W2.

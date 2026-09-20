STATUS: DONE

## Summary

Task `T-002`, attempt 1, revision 1; project `dim-gate`, variant `mainline`, milestone M0, AC-01/AC-02/AC-03. This is a bounded worker result awaiting orchestrator acceptance, not a milestone completion claim.

- Worktree: `/workspace/scratch/ac0bbec7578c/t-002`; branch: `agent/dim-gate/mainline/t-002`.
- Task base: `9c79e627265124555bec83b3033b3a88b360519c`; actual dispatched checkout and tested base: `a8258b08f0f1a1720f81362e555fd04415b23e42`.
- Specification: `1117d297aa3efef9472d847c9dfa5714eb6c4460`; shared implementation contract: `platform/dim-gate/docs/M0-CONTRACT.md`, revision 1.
- Private collaboration source: kernel `7cddad13f965d579b218579609c7f64e1ecf35b2`. Task/report contract and worker skill read as source only; no installation, global configuration or private source copy.
- Agent route: built-in collaboration worker, inherited model; exact model ID is not exposed. No nested delegation.
- `implementation_commit: none`; `tested_commit: a8258b08f0f1a1720f81362e555fd04415b23e42 + uncommitted scoped diff and lead-provided dependencies`. Only the orchestrator may commit/push, then bind final integration evidence to the resulting immutable commit.

Implemented these owned paths under `platform/dim-gate/`:

- `src/demo/controller.ts`: atomic snapshot/identity envelope, persisted persona and epochs, generation guard, serial commands, bounded storage, explicit recovery, timer cancellation, reset replay tombstone and independent copied-tab identity.
- `src/demo/handlers.ts`: identical browser/Node handlers, current-session authentication, exact JSON/header/query validation, 150 ms normal latency, typed success/error envelopes, explicit unsupported-operation failures and application-base URL isolation.
- `src/demo/browser.ts`: explicit demo bootstrap, unsupported live/missing-mode errors, Vite base-aware service worker URL/scope, per-document Web Lock ownership, recoverable storage actions and client lifecycle wiring.
- `src/api/client.ts`: schema-validated typed methods, structured errors, identity-aware query keys/notifications, stale response rejection and lost-response command retries retaining the original identity/key.
- `src/demo/controller.test.ts`, `src/demo/handlers.test.ts`, `src/api/client.test.ts`: 24 focused behavioral tests.

## Verification

Commands run from `platform/dim-gate`, with `PATH=/workspace/scratch/ac0bbec7578c/toolchain/node_modules/.bin:$PATH`. Runtime: Node 24.18.0, pnpm 11.18.0; direct local binaries were requested by the dispatcher to avoid pnpm auto-install during parallel manifest synchronization.

- `node_modules/.bin/vitest run src/demo src/api`: 3 test files, 24 tests, final exit 0 — passed
- `node_modules/.bin/eslint src/api src/demo/controller.ts src/demo/handlers.ts src/demo/browser.ts src/demo/controller.test.ts src/demo/handlers.test.ts`: final exit 0 — passed
- `node_modules/.bin/tsc --noEmit --strict --module ESNext --target ES2023 --moduleResolution Bundler --lib ES2023,DOM,DOM.Iterable --types vite/client,node --skipLibCheck src/api/client.ts src/api/client.test.ts src/demo/controller.ts src/demo/controller.test.ts src/demo/handlers.ts src/demo/handlers.test.ts src/demo/browser.ts`: final exit 0 — passed
- Pinned private `scripts/teamctl.py validate-task .team/tasks/T-002.md`: exit 0 — passed
- Pinned private `scripts/teamctl.py validate-report .team/reports/T-002-attempt-1.md` and canonical report: exit 0 — passed

Coverage includes persisted reload/persona selection, quota rejection with full state unchanged, unsuccessful reset/persona persistence, timer cancellation and stale generation work, reset replay after reload and subsequent work, conflicting persona replay, corrupt/incompatible storage left untouched, explicit memory mode, copied-tab identity including copies after reset, scope-filtered HTTP aggregates, unauthorized headers, unknown/duplicate queries, strict body/content type/idempotency keys, CI command replay/conflict/revocation, API scope isolation, client stale responses after persona/reset/policy changes, and retries after a committed command's response was lost.

Earlier executions are retained as history: the first Vitest invocation could not resolve the not-yet-integrated domain engine; the lead supplied that dependency before all final tests ran. The first scoped typecheck found test-only inferred header-union types, corrected with explicit request/header types. The initial post-reset-copy test used a deliberately deterministic ID generator that restarted at the original tab ID; its fixture now injects a distinct new ID. No failing final check remains.

Final owned source SHA-256 fingerprints:

| Path | SHA-256 |
| --- | --- |
| `src/api/client.ts` | `ffb017ca7ba87f7b7524e4434cf708b9b5bc2cd0ef68db14514bd6c4be2b62d9` |
| `src/api/client.test.ts` | `bf562acae0133d4cb246faec5b9328dc43c64a375133eae3e248109db5e28ddc` |
| `src/demo/controller.ts` | `64bce2677d9416cc3344187e51f0f3ac0ac42601390dce61eb914a4a7be8b184` |
| `src/demo/controller.test.ts` | `727f19377b379fe9a4ade0e562cbfffae74be039c86f8e30c337439304c7d44c` |
| `src/demo/handlers.ts` | `114480ce428ebc0271caef61f14e4e57280aa00565b7afa0bb86b799b3bf3e27` |
| `src/demo/handlers.test.ts` | `126e42611b8692d7304369fa6124dbd38e6726e3afc602b41cdc034de4ea5cdb` |
| `src/demo/browser.ts` | `926ab620fb9e8d5fcec88c18941a48876b019991dfca678d868f325976ea7ecb` |

## Documentation

All task-listed inputs were read in full before edits; a combined read was truncated and the affected SDD/CMDB files were re-read completely. No product specification, shared contract, manifest, lockfile, CI or PLAN edits were made by this worker.

The saved format is a strict `formatVersion: 1` envelope at the specified `dim-gate.demo.v1` key. It contains the domain snapshot, selected persona, generation/epoch, immutable persona replay records, one reset tombstone, and a stable `tabOwnershipId`. The ownership ID remains constant through reset/reload; a copied tab must obtain a new ownership/session identity. It avoids the race where resetting the API session would leave its new ID without a tab lock. Snapshot limits include the complete UTF-8 envelope; no audit/idempotency trimming occurs.

HTTP API prefixes are relative to the application base, so the production `/dim-gate/` build requests `/dim-gate/api/v1` and `/dim-gate/__demo/v1`. Engine paths remain canonical suffixes such as `/cis`. The orchestrator approved this M0 clarification for ADR documentation.

UI coordination: `getClientIdentity()` is nullable before bootstrap; `ApiRequestError` exposes code/message/requestId/retryable/status/fieldErrors. `recoverDemoStorage('reset'|'memory')` is allowed only after a recoverable demo storage error. Memory recovery leaves the previous saved value untouched. UI imports public client methods and bootstrap APIs only.

## Risks and Follow-ups

- Source changes are local and uncommitted. No push, remote branch update, PR, deployment or external cloud operation was performed by this worker. Remote durability and independent review are orchestrator-owned.
- The lead copied read-only T-001 domain/seed dependencies into this isolated worktree and owns package/lock/config changes visible in `git status`; those are not T-002 output. Integrate only the seven owned source files and two T-002 reports.
- Full application typecheck, production build, independent review and real-browser verification belong to orchestration. Browser gates should include reload/deep link, duplicate/opened tab both before and after reset, service worker scope, visible storage recovery and missing/live mode. The focused tests validate fork decisions and state consequences; they do not pretend to be a browser Web Locks run.
- Browsers lacking Web Locks receive a clear unsupported-browser error. Web Locks require a secure context, as does the service worker. No silent shared-session fallback exists.
- Concrete next action: sync these owned files into the M0 integration worktree, refresh T-001 dependencies, run native integration gates at a fixed implementation commit, then record the independent reviewer conclusion and acceptance decision.

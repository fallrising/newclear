STATUS: DONE

## Summary

Task `T-002`, revision 2, attempt 2; `dim-gate/mainline`, M0, AC-02 identity lifecycle correction. This is the bounded worker result; acceptance, fixed-commit review and final integration remain orchestrator-owned.

- Worktree: `/workspace/scratch/ac0bbec7578c/t-002`; branch: `agent/dim-gate/mainline/t-002`.
- Original dispatched checkout / current local HEAD: `a8258b08f0f1a1720f81362e555fd04415b23e42`.
- Dispatcher-supplied correction candidate: remote `e7d74275b1bbf157ab8d1888e3d482e95fb647b2`, reported by the dispatcher as tree-equivalent to local `56ca8d0b1f1445f1473ccf3725ec53e0b4a9d45a`. Updated candidate client, DTO and read-only dependencies were supplied into this worktree without changing its HEAD.
- `implementation_commit: none`; `tested_commit: a8258b08f0f1a1720f81362e555fd04415b23e42 + dispatcher-provided candidate files + uncommitted two-file correction`. Source fingerprints below identify the corrected worker output; the orchestrator must bind final evidence to the integration commit.
- Model route: inherited built-in collaboration worker; exact model ID is not exposed. No delegation, commit, push, configuration change or external operation.

The independent review reproduced an obsolete identity restoration: reset/persona completed, its response was lost, a subsequent Admin switch succeeded, then retrying the retained original command installed its obsolete receipt. The client compared the retry call's identity instead of the original request identity.

Changed only `platform/dim-gate/src/api/client.ts` and `platform/dim-gate/src/api/client.test.ts`. The identity-control guard now compares the retained original request identity with the current and returned identities. An obsolete replay raises non-retryable `STALE_RESPONSE` before session replacement or notification. Two regression cases cover lost reset and lost persona responses after an Admin switch and additional clock work.

## Verification

Commands ran from `platform/dim-gate`, with `PATH=/workspace/scratch/ac0bbec7578c/toolchain/node_modules/.bin:$PATH`; direct local binaries were authorized for the shared dependency symlink.

- `node_modules/.bin/vitest run src/demo src/api`: final exit 0, 3 files and 26 tests — passed
- `node_modules/.bin/eslint src/api/client.ts src/api/client.test.ts`: exit 0 — passed
- `node_modules/.bin/tsc --noEmit --strict --module ESNext --target ES2023 --moduleResolution Bundler --lib ES2023,DOM,DOM.Iterable --types vite/client,node --allowImportingTsExtensions --skipLibCheck src/api/client.ts src/api/client.test.ts`: exit 0 — passed
- Pinned private `scripts/teamctl.py validate-task .team/tasks/T-002.md`: exit 0 — passed
- Pinned private `scripts/teamctl.py validate-report .team/reports/T-002-attempt-2.md` and canonical `T-002.md`: exit 0 — passed

Before the fix, `node_modules/.bin/vitest run src/api/client.test.ts -t 'obsolete lost'` reproduced both review findings: both promises incorrectly resolved with old RD/Ops identities. The targeted invocation intentionally excluded the eight unrelated client tests. The subsequent full focused run included all 26 tests and had no failures or omissions.

Each regression asserts that replay rejects, the client and controller retain the current Admin identity/epoch and clock value, no identity notification is emitted by the obsolete response, and a subsequent `getSession()` succeeds as Admin. Existing tests continue to cover valid immediate lost reset/persona retries, lost clock retries without duplicate execution, and reset replay preserving later clock work.

Corrected source SHA-256:

| Path | SHA-256 |
| --- | --- |
| `src/api/client.ts` | `5f0a461a7e10aaf1f1e977a9446a9fb72147aa34b168ed77b236136c28ddadec` |
| `src/api/client.test.ts` | `c9f712b2555f9dda35b9df795c28918b032c0bf37836f014e6eab3b41972fbf7` |

## Documentation

Read the complete revised task, supplied independent reproduction, current client/tests/control DTO and M0 contract revision 2 before editing. The previous attempt's relevant SDD, AGENTS and pinned kernel task/report rules remain applicable. No specification or shared DTO change was needed; this restores the existing stale-response requirement.

[Attempt 1](T-002-attempt-1.md) remains unchanged; its SHA-256 is `2b90f9362106f483caeef9898ba66bf1a36d954e6984239486f573aa2e778c9d`. This report replaces only the canonical T-002 pointer and adds the attempt-2 record.

## Risks and Follow-ups

- Corrections are local and uncommitted; no remote durability or final acceptance is claimed by this worker.
- Controller, handlers, shared DTO, domain, PLAN, package/config and unrelated paths were not changed in this attempt. Lead-supplied files remain read-only worker dependencies.
- Replaying an obsolete identity-control receipt now exposes `STALE_RESPONSE`; the current session remains usable. The server still performs its normal replay authorization and idempotency handling.
- Next action: integrate the two corrected source files and this report, rerun native integration gates at a fixed commit, and have the independent reviewer recheck the two reproduced identity-restoration cases before accepting AC-02.

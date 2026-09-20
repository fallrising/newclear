STATUS: PARTIAL

## Summary

T-004, attempt 1, task revision 1; independent read-only review of dim-gate/mainline/M0, AC-01–03. Recommend REWORK: the candidate has a reproducible AC-02 stale-identity defect and a current DTO/runtime default mismatch. The reviewer has not accepted the implementation or changed product code.

- Reviewed/tested commit: `56ca8d0b1f1445f1473ccf3725ec53e0b4a9d45a`; tree `9880368a9bfde197a2172d5f5108fb383eef9633`.
- Diff base and source specification: `1117d297aa3efef9472d847c9dfa5714eb6c4460`; branch-local M0-CONTRACT revision 2 and ADR-012–014 also reviewed.
- Worktree/branch: `/workspace/scratch/ac0bbec7578c/t-004-review`, `agent/dim-gate/mainline/t-004-review`. HEAD was reconfirmed after diagnostics; checkout was clean before report creation.
- Private instruction source: kernel `7cddad13f965d579b218579609c7f64e1ecf35b2`, read as source, not installed or copied. Actual route: separate built-in collaboration agent; inherited model ID is not exposed. No Claude or external-model execution is claimed.
- Review covered the complete first-party domain, seed, controller, handlers, client, contract registry, UI, tests, scripts and configuration; changed-path inventory, generated response schemas/references, dependency importer/pins, and CI scope were inspected. The checked-in MSW worker is byte-identical to the installed pinned MSW distribution. Generated JSON/lock bulk was not treated as a substitute for source reasoning.
- Scope: only T-004 reports written in the checkout. Temporary diagnostic tests/logs reside outside it. No implementation participation, delegation, PLAN/config edits, commits, pushes, external messages, or acceptance decisions.

## Verification

Runtime independently confirmed: Node `v24.18.0`, pnpm `11.18.0`; lockfile SHA-256 `0da752e9e75f7b22902ba601583d1979e0a0d63b34275bcc445c4286dec7a32b`. Commands below use `PATH=/workspace/scratch/ac0bbec7578c/toolchain/node_modules/.bin:$PATH` and run from `platform/dim-gate`, except explicitly named root commands.

- `git rev-parse HEAD HEAD^{tree}` and ancestor/component instruction inspection: exact assigned candidate, no applicable root/ancestor override; component AGENTS applies — passed
- Independent `pnpm test`: 6 files, 79 tests, exit 0, 2026-09-20 15:03:22 UTC — passed
- Independent `pnpm check:contracts`: 72 operations, 165 schemas, all local references resolve; generated content matches checked-in output — passed
- Independent `pnpm check:ci` and `pnpm check:docs`: workflow policy passed; 30 Markdown files and 104 repository links passed — passed
- Independent `/workspace/scratch/ac0bbec7578c/actionlint/actionlint .github/workflows/dim-gate-ci.yml`: actionlint 1.7.12, exit 0 — passed
- Inspected lead's fixed-commit `evidence-56ca8d0/results.json` and individual logs for `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm check:docs`, `pnpm check:contracts`, `pnpm check:ci`, `pnpm build --mode demo`, `pnpm test:e2e`: all exit 0, with 79 unit/component/contract tests and 7 production Chromium E2E tests — passed
- Inspected real browser screenshots for guide at 1440/768/390, dark guide at 1440, and Ops/Admin/Data RD overviews; visual verdict below — passed
- `pnpm exec vitest run --config /workspace/scratch/ac0bbec7578c/reviewer-diagnostics/vitest.config.ts`: 3 fresh diagnostic tests fail at the reviewed commit, reproducing F-01 twice and F-02 once; exit 1. Repeat output saved in `reviewer-diagnostics/attempt-1-probe.log` — failed
- Root `git diff --check 1117d297aa3efef9472d847c9dfa5714eb6c4460..HEAD`: exit 2, extra blank line at EOF in `.team/reports/dim-gate-m0-preflight.md:52` — failed
- Pinned private `teamctl.py validate-task .team/tasks/T-004.md`: exit 0 — passed

The lead performed the fresh frozen installation in this worktree before review execution and reported 334 packages installed with exit 0. Its install output is in the lead session transcript, not a retained log available to this reviewer; this report does not relabel that as an independently observed install. No dependency mutation was performed by the reviewer.

### AC assessment

| Requirement | Evidence and conclusion at this candidate |
| --- | --- |
| AC-01 | Production build and seven browser-test log entries inspected; four personas, authorized centers, persistent demo indication, explicit unsupported business flows and no real cloud code. Baseline behavior supported. |
| AC-02 | Standard tests support center/persona/reload preservation, reset, copied-tab isolation before/after reset, timers and stale ordinary queries. F-01 disproves the broader old-response guarantee after lost control responses and a later identity change. Not satisfied. |
| AC-03 | Read full engine/controller/HTTP tests and independently ran them. Current authorization is checked before saved command receipts; changed body conflicts; revoked pool/project grants deny replay; races, persistence rejection and counters/events/audit retain atomicity. Covered scenarios pass. F-02 is an additional M0 DTO/OpenAPI alignment failure, not evidence of a broken domain transaction. |

### Visual verdict

The seven actual supplied PNGs were viewed, not inferred from axe. CJK glyphs are legible; desktop hierarchy, neutral/indigo tokens, separation of guide and session controls, scoped counts and M0 capability wording are coherent. At 768px the guide stacks with an icon rail; at 390px controls and text remain within the page and the primary clock/reset actions remain readable. Dark mode is distinguishable and readable. The closed 390px persona select truncates the long display name; this is an advisory refinement, not a blocking finding. The E2E log covers guide axe checks in all three widths and dark mode, reset focus trapping/Escape/focus return, production subpath refresh, copied tabs, and explicit corrupt-storage recovery. It does not establish a complete M5 keyboard/accessibility audit of future screens.

Screenshots inspected under `/workspace/scratch/ac0bbec7578c/newclear/platform/dim-gate/test-results/`:

- `foundation-responsive-shel-10aae--document-overflow-findings-chromium/{guide-1440,guide-768,guide-390,guide-dark-1440}.png` inspected visually — passed
- `foundation-AC-01-productio-5a835-enters-and-keeps-its-banner-chromium/{center-user-ops,center-user-admin,center-user-rd-data}.png` inspected visually — passed

The lead subsequently provided the fixed-commit E2E logs and fresh corresponding screenshots under this review worktree's `platform/dim-gate/test-results/`. Browser environment is the explicitly supplied Chromium 153 bundle with normal web security and Noto CJK. Standard Playwright CDN installation was unavailable locally; a standard-CI-browser pass is not asserted here.

## Documentation

Read the full task, PLAN, component AGENTS, M0 contract, SDD and complete SDD 01–08, development entry/protocol, STATUS, README, docs index, monorepo CI specification, worker canonical/attempt reports and preflight. The task's shorthand `docs/DEVELOPMENT_PROTOCOL.md` resolves to the component's actual `platform/dim-gate/docs/DEVELOPMENT_PROTOCOL.md`; no such root file exists. Any truncated combined reads were reissued for the affected files.

Private source reading included the kernel task/report specification, AGENTS, task-worker/evidence-gate/UI-evidence skills and referenced UI-delivery contract, plus the development prompt/loop and team setup/delivery documentation. No private implementation, source text or configuration was copied to this public repository.

The diff changes only dim-gate, its root CI, and its root task/ledger/report files. Forward M1–M4 DTOs are clearly marked planned; the three-CI seed and absence of completed business flows are intentional M0 scope. OpenAPI's CIView, command receipt, control-result wrappers and planned request-detail wrappers were inspected directly. Cross-entity refinements remain in domain code as documented.

### Fresh-session recovery probe

Read the repository without treating the parent conversation as acceptance evidence: PLAN identifies `dim-gate/mainline`, run `DG-M0-20260920-01`, active owner Codex, M0 RUNNING, T-001–003 EVALUATING, T-004 READY and T-005 RUNNING. `git worktree list --porcelain` and branch inspection confirm the existing foundation and T-001–004 branches. The current implementation exists; no accepted M0 record exists. PLAN's resume block still says candidate-to-be-recorded and not-dispatched review, so it is a pre-candidate checkpoint requiring reconciliation, not a reason to initialize another project or orchestrator.

Correct continuation is to reuse T-004/T-005 and the foundation branch, reconcile the lead's active run and remote PR state, correct the review findings, then review the new immutable candidate. Recreating tasks, implementation branches or an M0 skeleton would duplicate work. This reviewer did not act on the orchestrator role and did not independently query current remote PR/CI state.

## Risks and Follow-ups

### F-01 — High: historical control replay rewinds client identity and prevents continued API use

- Location: `platform/dim-gate/src/api/client.ts:104–108`; original retry identity is selected at lines 64–66.
- Requirement: AC-02 / INV-08; M0 contract requires stale responses across persona/reset changes to be discarded.
- Reproduction using the real shared Node HTTP handlers and controller-to-client subscription: (1) commit a reset and simulate loss of its response, (2) successfully switch to Admin, (3) retry the reset with the retained key. Controller remains Admin, epoch 2, but client becomes Commerce RD, epoch 1. The next `getSession()` returns `409 STALE_IDENTITY`. Equivalent sequence with a lost Ops persona-switch response, then successful Admin switch, then Ops retry also rewinds the client to Ops epoch 1 while controller remains Admin.
- Cause: acceptance compares the identity at the beginning of the retry call with current identity, so that comparison succeeds even though the response belongs to the earlier `requestIdentity`. The subsequent unconditional `updateClientSession(next)` installs the old receipt.
- Required correction: preserve monotonic/current identity when consuming retained control receipts; reject an obsolete replay response without changing client/controller/cache identity. Add both interleaving regressions while retaining immediate lost-response replay and same-session subsequent-work behavior. Lead was notified promptly; no reviewer fix was made.

### F-02 — Medium: implemented list defaults differ from published DTO/OpenAPI

- Locations: `platform/dim-gate/src/api/contracts.ts:21–23`; runtime `platform/dim-gate/src/domain/engine.ts:70`.
- Requirement: M0 DTO/OpenAPI/runtime alignment under SDD 06 and REQ-10; relevant to the M0 contract gate supporting AC-03 verification.
- Reproduction: `operations.find(op => op.id === 'listCIs').query.parse({}).sort` and OpenAPI `/api/v1/cis` publish default `id`. As Ops, omitted `sort` returns AWS then Aliyun, whereas explicit `sort=id` returns Aliyun then AWS. The engine defaults to `name`; `listApplications` has the same declaration mismatch. Pagination and generated clients can therefore disagree on the default ordering.
- Required correction: align shared current list defaults, generated OpenAPI and actual handler behavior, and verify omitted versus explicit documented default through the shared HTTP path. Do not treat generation equality alone as runtime equivalence.

### Other follow-ups and limits

- Remove the extra EOF blank line noted above and rerun the source-to-candidate diff check; a clean worktree diff does not cover the committed PR diff.
- Build log reports 325.12 decimal kB gzip, approximately 317.5 KiB, for initial JS. This exceeds the documented M5 300 KiB budget; it is a recorded M5 follow-up, not a new M0 rejection.
- Frozen install provenance, remote ref/tree mapping, PR CI, final acceptance, report integration and durable checkpoint remain lead-owned. This review binds the local candidate SHA above and does not approve a different commit by branch name alone.
- Concrete resume action: preserve this attempt report, integrate the bounded F-01/F-02 corrections, establish and supply a new immutable candidate, rerun affected native/HTTP/browser gates and the full diff check, then request a bounded independent follow-up. Only the lead records acceptance.

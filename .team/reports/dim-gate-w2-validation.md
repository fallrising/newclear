STATUS: DONE

## Summary

W2 implements the canonical resource/binding/work-item model, Redis allocation/bind/resize, Kafka topic create/bind, independent Ops approval and explicit execution, typed Admin catalogs, and readonly Kubernetes summaries. Existing Request/Release workflows and IDs remain intact. WorkItems project each source; no role has a separate store.

Run `DG-W2-20260923-01`, tasks T033–T036; sole owner Codex orchestrator W2. Branch `agent/dim-gate/mainline/w2-resources`, worktree `/home/ckc/test/codex/newclear-dim-gate-w2`, existing [PR36](https://github.com/fallrising/newclear/pull/36). W1 is accepted and merged at `b4ef57f1e15082f3e980b2eb0d8451b1f1f4433d`, with post-merge CI35833033838 successful and ownership released. W2 acceptance, latest-head CI, merge and owner release are separate decisions recorded in PLAN/PR closeout. W3–W5 remain unimplemented.

The domain/API/migration implementation is fixed at `4a69e07233fb31a90d2abafa664c39d3b91c4f23` under contract revision3. Later `d07166c93d600211454074c91b1bfa2e50526adc` and final `bf3f168a09c2b4f5ae442703588f2a3dd4d5cb20` change only the resource table CSS/class/reference display, browser readiness/geometry assertions and progress documents. No domain/API/state/migration change follows4a69. The complete local regression uses4a69; the affected layout, both extra browsers and fresh performance are retested onbf3f168. Final exact-head CI must run the entire updated suite.

## Verification

Commands ran from `platform/dim-gate` with Node24.18.0 and pinned pnpm11.18.0. Lockfile SHA256 remains `0da752e9e75f7b22902ba601583d1979e0a0d63b34275bcc445c4286dec7a32b`. Browser runtime: Chromium153.0.8010.12, Firefox155, WebKit26.6; one worker, zero retries. Linux libraries/CJK fonts are process-local test environment settings, with no global or dependency changes.

- Fixed4a69 `pnpm install --frozen-lockfile --offline`, `pnpm lint`, `pnpm typecheck`, `pnpm test`:321/321 tests in29files, including real MSW HTTP, quota races, persistence and delayed-command authorization — passed
- `pnpm check:docs`, `pnpm check:contracts`, `pnpm check:ci`, `pnpm check:architecture`, `pnpm build --mode demo`; strict91operations/210schemas and registered operation manifest agree — passed
- Fixed4a69 focused W2 production Chromium:13/13 in3.9min,37images,2,686responses, zero page errors or failed requests — passed
- Fixed4a69 `DIM_GATE_TEST_PORT=4224 pnpm test:e2e`:77/77 in24.8min, preserving all64 legacy/W1 journeys plus13 W2;43health attachments,24,589responses,119images, zero page errors or failed requests — passed
- Fixedbf3f168 `DIM_GATE_TEST_PORT=4219 pnpm test:smoke`:8/8 Firefox/WebKit in2.5min, including full legacy Guide, workspace/deep refresh and Redis delivery;4health attachments,1,115responses,32images, zero page errors or failed requests — passed
- Fixedbf3f168 shared Redis triage/approval/layout journey:1/1 in24.8s;17images,217responses; actual light/dark1440/768/390 axe, keyboard scrolling,812px computed table minimum,252px target column and every target ID on one line — passed
- Fixedbf3f168 `pnpm benchmark`:fresh build and3/3 checks in27.1s; all five cold samples304,477gzipbytes,4×CPU medianLCP756ms,5,000CI queryP95≈0.6ms,100 persisted HTTP commandsP95169.2ms including150ms Mock delay; clean tracked source metadata — passed
- Fixedbf3f168 lint/typecheck/demo build, docs171Markdown405links, contracts91/210 and task/report/diff checks — passed
- Fixed4a69 `pnpm test:isolation`:fresh production Demo/live builds,2/2 in3.0s; actual sibling document/API and service-worker scope, deep refresh, and live mode with no Mock fallback — passed
- Uninvolved [T036 attempt2](T-036-attempt-2.md): F01–03 MEDIUM and F04 LOW independently reproduced and closed;321 native tests,12 Chromium journeys, final layout1 and final Firefox/WebKit2 plus complete lead evidence inspection; no unresolved finding — passed
- Actionlint, final original-worktree preservation audit (all38 remain) and pinned report/task validation — passed

Earlier fresh benchmarks also passed:4a69 measured304,484bytes/LCP792ms/query0.6ms/HTTP169.4ms; d071 measured304,484bytes/LCP756ms/query0.6ms/HTTP169ms. The final result above leaves2,723bytes below the unchanged307,200-byte initial JS limit. Required Demo bootstrap and service-worker scripts are included.

| Exit AC | Canonical implementation and actual evidence |
| --- | --- |
| AC-WS-03 | `src/domain/w2.test.ts`, `src/demo/w2-handlers.test.ts`, `e2e/w2-resources.spec.ts`, `e2e/w2-governance.spec.ts`:shared Redis canonical object/binding IDs, once-per-object physical quota, onePlacement perenvironment/CI, no hidden sibling details. |
| AC-WS-04 | Visible original Request creates staging; RD Redis draft→submit→independentOpsapproval→explicit5-step execution→sameRD/Ops source/correlation/binding; approval alone creates no ready binding; reload preserves canonical state. |
| AC-WS-05 | Domain/realHTTP same-key replay, normalized sameparent/namespace name409, crossparent same name distinctIDs; visible existing Kafka binding preserves object and visible create/fault/retry preservesplannedIDs andpriorattempt. |
| AC-WS-06 | Domain/realMSW parallel lastquota approval has one atomicreservation winner; cancel releases reservation, no negativecapacity/duplicateexecution; observedusage remainsnull and doesnot borrowreservedquota. |
| AC-WS-07 | Version/catalogrevision/disabledtemplate/currentgrant checks onsubmit/approve/execute/retry; visible Admin revision/disable refusesoldchangeswithoutrewritingfrozen snapshots; configurefailure preservesactive/no ghostBinding; retry requiresnewdecision andsameplannedIDs. |
| AC-WS-08 | Selfapproval403 for samepersonacrossroles, pool-only/project-only/Admin business denial, qualifiedsecondOps approval, originalrequester execution afterindependentdecision; per-object scopeallow withunrelatedhiddenallocation, genuinelyhiddenconsumer/no-pooldeny, staleproposalrevocation403. |
| AC-WS-09 | Canonical CI↔readonlyK8s/Redis/Kafka↔service resource links/scope/dataAsOf; missing/stale observeddata explicit; no clustercontrol/unsupported operation masquerades. Existing network/database CMDB behavior preserved. |
| AC-WS-15 | Domain/HTTP list/detail404/action403/search/aggregate/audit/notification/graph scope; partialparent countsunknown; canonicalfullChange requiresallaffectedconsumer scope; realheld200private resource response afterpersona change cannotflash/overwriteDOM/cache. |
| AC-WS-16 | `src/demo/migrations.test.ts`, `e2e/w2-migration.spec.ts`:genuineW1 snapshot fixtureSHA55c21bb325f3d8f5f45a4cc53326125420c90e08b884129b54de6b6d82f1abc6 (actualb4merge provenance), originalIDs/history/clock/receipts/jobs preserved; activeRelease/ProvisionJobcompleteonceviaUIclock; atomicquota/corrupt failures preserveoldbytes; W2midexecutionreload/failure/reset and alllegacy regression retained. |
| AC-WS-17 | Resourcewizard/details/WorkItems/professionalreadonly/typedAdmin, actualthemes1440/768/390axe, dialoginitialfocus/Escape/return, readabletableandkeyboardscroll; crossbrowsercompleteRedisdelivery+legacyGuide/workspace smoke; sameoriginalbudgetbenchmark; genuine sibling/live isolation. |
| AC-WS-18 | Registry-backed routes/Guidelinks andconstantDemo marker; readonly/unknown/pending contenttruthful; W3–W5 andlater/unclearcapabilities remainunavailable; browserhealth noexternalcalls; fixeduninvolvedspec/source/evidence review. |

Source-specific triage summary includes requirement kind, risk and typed current/desired/signeddelta. Newdemand startsat0, existingbinding addsnoquota, stalehistoricalbasis explicitlyunknown. Approved Request/Change appear inbothdecidedandexecution filters; no storedsource-state mutation. Shared object maintenance usesallaffectedconsumerOps grants pluspool, withoutletting anunrelatedhiddenallocationblock anauthorizedobject.

## Documentation

[W2 contract revision3](../../platform/dim-gate/docs/W2-INTEGRATION-CONTRACT.md) fixed scope, shared owners, schema, API, policy, migration and AC before dependent implementation and before review corrections. Specs01–07 and09–14, OpenAPI, Mock, migration tests, capability status, README, DemoGuide, STATUS and PLAN remain synchronized.

T033 handed back16 domain files and then7 performance files; T034 handed back10 migration files, the HTTP test and governance browser test. The lead verified SHA256 manifests before integration. Workers released ownership; their original worktrees and dirty results remain intact. T036 did not participate in implementation. The available built-in uninvolved reviewer was used with the fallback disclosed; the exact runtime model slug is not exposed, so there is no Claude or multi-model claim.

Local evidence is under `/tmp/dim-gate-w2-evidence`: `4a69e07-focused-html`, `4a69e07-full-html`, `4a69e07-full-health.json`, `bf3f168-layout-html`, `bf3f168-smoke-html`, their health summaries, and `bf3f168-performance` with decoded JSON/source metadata. Command logs and original failure traces are preserved there. Local paths are not cross-machine artifact storage. Source/tests/reports are SSH-saved; final GitHub CI uploads `dim-gate-m5-<synthetic-merge-sha>` for30days. Obtain the actual run/artifact links from PR36.

## Risks and Follow-ups

Latest exact PR head CI, main/head reconciliation, authorized merge, actual merge-tree/post-merge-CI verification and owner release remain required before W3 starts. The final metadata checkpoint may reference these tested code commits only after confirming its source/test/config/workflow/lockfile diff is empty. No deployment, real cloud action, external notification, real credential, force push, direct main push or worktree deletion occurred.

Historical failures remain preserved, not passing gates:285b had browser0/4 and314,429gzipbytes over budget; ae3 had browser2/4 and exposed an invalid HTML pattern and missing scroll-region focus; a054 had full76passed but smoke6/8 failed due to redundant bootstrap navigation; the immutable4a69 runner also reproduced the same historical bootstrap smoke6/8 failure; d071 had smoke7/8 failed when persona switching retired an unfinished sequential detail/audit readback. Final smoke enters the wizard directly, then waits for visible completion, submitted state and same-correlation audit before switching persona. Browser health, status handling, timeouts and retries were not relaxed.

T036 attempt1 reproduced three MEDIUM gaps: parent-wide impact wrongly disabled authorized object maintenance; approved work disappeared from the execution filter; triage lacked typed risk/delta. Revision3 fixes all three and preserves redaction. Follow-up found LOW table readability: measured680px table/57.6px target column exposed CSS specificity rather than merely a screenshot concern. Final geometry is812px/252px with unbroken IDs and actual keyboard scrolling. Earlier passing tests never overrode review findings or failed smoke.


## Actual GitHub closeout

W2 actual closeout reconciled 2026-09-23: PR36 ACCEPTED/MERGED at 2026-09-23T10:37:05Z, accepted head e8c7ec113d01a778642d2600b1af002dc7831651, actual merge 91626851fb17df7ab31c96dee9353b9ee4d42c92. Exact-head [CI35846286919](https://github.com/fallrising/newclear/actions/runs/35846286919) succeeded with321unit/77Chromium/8Firefox-WebKit/3benchmark/2isolation and all native gates; artifact10745167006, dim-gate-m5-0c72ed5243b32edccb0a8b5c879575660e846674, expires2026-10-23. SSH main ancestry and component tree410fe5f8aeafc7391754b08f9c9ad31328ddcc26 equal accepted head. Independent T036attempt2 SHA372ae44d6ed11374a3f4b6bbc3df82b3994d27ea77f35868b00bf4c5fd5489f6 unchanged; no unresolved findings. DG-W2-20260923-01 terminalDONE, T033/T034/T035 ACCEPTED, T036 DONE; active_owner NONE. Postmerge CI35849832030 observed in_progress, mirror35849832043 SUCCESS; this is status verification, not a claim that pending CI passed. PR36 body has actual closeout; original53worktrees retained. No deployment or external side effect.

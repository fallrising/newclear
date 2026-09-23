STATUS: PARTIAL

## Summary

T-043 bounded W4 UI/browser handback at the contract base. Lead added this validator header after SHA-verified integration; the worker's detailed handback remains below. No worker acceptance or remote operation is claimed.

## Verification

- Isolated native suite 376/376, lint, architecture and diff check — passed
- Isolated typecheck before T041/T042 domain and typed API integration — failed
- Isolated W4 browser and complete fixed-product gates before integration — skipped

## Documentation

The fixed revision-1 W4 integration contract and task define this scope. Lead registered extra-browser smoke and ran combined gates separately in the canonical W4 validation report.

## Risks and Follow-ups

This attempt is a partial handback; its missing-sibling failures and unrun browser cases are retained below. Combined source, full browser, independent review and CI remain lead-owned.

# T-043 attempt 1 — W4 UI/browser bounded handback

Run `DG-W4-20260923-01`; task revision 1; base contract commit `9fd3279ead6aa9e776c56c9fb3066e670631484a`; dedicated worktree `/home/ckc/test/codex/newclear-dim-gate-w4-ui`. Worker scope only `platform/dim-gate/src/features/**`, `src/app/**`, `e2e/**`, and this report. No commit, push, acceptance, deployment, external notification or main branch mutation was made. Lead owns integration and gates.

## Implemented for integration

- Registered `rd.monitoring`, `rd.alerts`, and `ops.alerting` with lazy feature modules, scoped service links, app/environment mismatch 404, physical CI selection, production approval queue, and separate Ops settings/runtime views. The six previously eager CMDB route components are now lazy, retaining the same route keys and startup snapshot/integrity path while creating initial-JS headroom for W4.
- Actual typed W4 client calls for MonitorPolicy, AlertRule and SLO draft/revise/validate/submit/approve/reject/activate; fixed source/metric/channel forms, status/revision/decision history, current-grant action preview, and readback before closing mutations. Service writes require RD project/stage; infrastructure writes require Ops pool; prod approvals require a different Ops actor with project/prod grant. API/domain remain authoritative for every command.
- Source-time evaluation, freshness/unknown, incident evidence links, bounded Silence with remaining time, and queued/suppressed/delivered/failed Mock delivery history are displayed from scoped API reads. Fixed scenario controls generate samples and use the demo clock for dispatch/expiry. The existing incident center now renders both service and infrastructure incident variants and preserves Ops acknowledge/investigate and audit flow.
- Added W4 route regression, a Chromium browser path for prod RD → independent Ops approval → activation → breach → Silence → expiry/failure/incident evidence plus denial/refresh/keyboard/axe/light-dark/1440/768/390, and a bounded Firefox/WebKit W4 smoke path. Root must register `w4-browser-smoke.spec.ts` in component-root `playwright.smoke.config.ts` because that file is outside T-043 scope.

## Actual verification on this exact isolated tree

- `pnpm test -- src/app/routes/registry.test.ts`: **PASS**, 376 tests in 34 files. The package script invoked the full native suite; the new route test passed. This tree still contains pre-W4 domain/API, so this result does not exercise the new W4 feature module.
- `pnpm lint`: **PASS**.
- `pnpm check:architecture`: **PASS** after exposing shared service-delivery utilities via its public `index.ts`.
- `git diff --check`: **PASS**.
- `pnpm typecheck`: **NOT PASS / blocked by unintegrated sibling scope**. Current T-043 worktree lacks T041 `src/domain/monitoring-models.ts` and T042 `src/api/clients/alerting.ts`/client registration and updated scenario union; reported errors are missing modules/API methods and consequent inferred-any errors. No claim is made that typecheck passes on the integrated tree.
- Focused W4 Playwright, Firefox/WebKit smoke, full Chromium, benchmark, isolation and production build: **NOT RUN** on this tree because the W4 domain/API runtime is absent. No initial-JS byte claim is made. Root must run these on a fixed integrated candidate, then correct actual failures.

## Integration notes and limits

Copy all owned file bytes from the SHA256 manifest accompanying this report. The UI binds to T042 public `api` methods and T041 `monitoring-models.ts` types. The W4 scenario call generates samples immediately; `advanceClock(60)` dispatches queued Mock notifications. The default rule requires two consecutive known samples in a 120-second window. Draft revision edits create a new immutable revision, including draft/validated source states, per T041's updated contract. SLO latency includes its required `thresholdMs`.

The browser specs were written against the fixed typed interface but could not be run before integration. Review the actual integrated error/denial copy and semantics, especially production approval, Silence expiry, incident detail, and W4 native type inference. The expected 403 self-approval response is explicitly registered with the browser health collector. Do not use this handback as W4 product acceptance or a substitute for root exact-head gates and independent review.

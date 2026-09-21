STATUS: PARTIAL

# T-018 — M3 first integrated browser checkpoint

## Summary

Tested code: `2abbec9` on `agent/dim-gate/mainline/m3-delivery`, baseline `e760d8e`.
The domain engine, HTTP contracts, client, routes and delivery views are integrated. This is not acceptance.

## Verification

- Node 24.18.0 / pnpm 11.18.0 frozen install, lint, typecheck, 160 tests across 18 files — passed
- Production `pnpm build --mode demo`, JS gzip 444.80 kB; existing future M5 budget risk remains — passed
- Production Chromium `pnpm exec playwright test e2e/m3-delivery.spec.ts` at `http://127.0.0.1:4173/dim-gate/`, preview `pnpm preview --port 4173 --strictPort`, 7 passed / 2 failed — failed
- Build failure/retry, health failure/retry, prod dual-role self-approval denial/another Ops approval, busy/pre-deploy cancellation, rollback failure/recovery, cross-project list/detail isolation, three viewport/light-dark axe/focus scenario — passed

## Reproduction and classification

1. Test defect: staging flow at `/rd/catalog/catalog-web/request`, Commerce RD, used exact `getByLabel` for the existing wizard. It timed out at the application selector although the accessible snapshot contains `combobox "應用"`. Use its accessible role/name as established by M2 tests. No product relaxation.
2. Product UI synchronization defect: Commerce RD rejects a prod candidate through another Ops, triggers a new prod run, advances 3 ticks, and immediately opens cancellation after the clock-complete notice. `DeliveryDemoControls` published completion before query invalidation completed; the dialog captured an old version. Submission correctly returned `409 VERSION_CONFLICT` (request `http-000035`) and preserved state, but the completion UI was premature. Move completion notice after awaited refresh and retain this immediate-follow-up browser regression.
3. Environment defect: local Chromium screenshots render Chinese glyphs as tofu because no CJK fonts are installed. DOM text is correct. Visual evidence is not accepted until local font configuration is corrected and screenshots are reviewed.

Raw trace, screenshot, DOM and browser-health attachments were preserved before edits in `/tmp/dim-gate-m3-browser-attempt-1.tar.gz` (local-only; not a portable report artifact). Failed paths are `m3-delivery-AC-13-ready-st-19d7a-ct-active-and-audit-history-chromium` and `m3-delivery-AC-15-16-rejec-a9cd8--and-unlock-the-environment-chromium` inside the archive.

## Documentation

T-019's original PARTIAL worker report remains unchanged. T-020 records the independent read-only routing: external Claude source transmission was rejected; a fresh in-environment reviewer inspects the fixed candidate instead. No Claude source-review execution or multi-model review is claimed.

## Risks and Follow-ups

Rerun affected Chromium journeys and full E2E after the UI correction; finish independent review and remaining gates before acceptance. SDD per-second playback must be reconciled by implementation, not silently removed. M4 incident observation/resolution and M5 optimization remain future work. No cloud, deployment, merge or host configuration was performed.

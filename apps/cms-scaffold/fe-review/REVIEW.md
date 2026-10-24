# FE Review — cms-scaffold — REVIEW

## Current state

Round 1 design is approved. Round 2 M1/M2 local gates passed; targets are verified for this mock route contract. Independent review and current publication gates remain root-owned. Six-wave prerequisite audit confirms W1/W2/W3/W3b/W4/W5 VERIFIED and PR229/245/273/281/289/300 merged with all25 listed checks successful. This resolves the former wave-dependency blocker; it does not authorize product changes. [Round 2 report](tasks/round2/report.md) records current gates and historical failures.

The inventory now covers 51 current routes and fixture values, replacing stale Admin `/users` with `/principals`. Shared capture does not record final URLs. The additional verifier therefore checks exact final URL, actual synthetic identity and specific loaded content in a fresh context for each route; intentional logout/login-alias redirects have explicit contracts.

## Confirmed decisions

- D1(b): `packages/ui` remains proposal-only. No shared/component product code changes belong to M1/M2.
- D2(b): existing Vite host configuration stays unchanged; review startup always overrides `--host 127.0.0.1 --strictPort` inside the isolated namespace.
- Three viewports, light preference only; gallery-dark is a site theme, not OS dark mode.
- R2 raw captures/screenshots stay ignored. Only safe concise evidence summaries are published; raw capture.json publication belongs to Round 3.

## Evidence and limits

Native frontend checks passed (648 workspace +66 existing PP1 unit tests). The153 selected captures (144 original +9 repaired) and51 supplemental finalURL/identity/loaded checks passed, with owned process/listener/container cleanup. Initial9 selector failures remain in immutable evidence; only those9 keys were recaptured. Six waves' historical evidence is attributed to their deliveries and remote publication; it is not a fresh run here.

Full Round 3 accessibility, interactions, overflow/copy/skeleton states and production performance are not verified. Real API, PP1 operations and overall CMS usability are not accepted by this review-only milestone. Mainline remains incomplete; no usable tag or owner completion is asserted.

### Retained browser observations

Selected153 captures contain24 console error/warning events and27 requestfailed/HTTP-error events:18 anonymous mock auth/me401,3 logout401,3 logout ERR_ABORTED and3 public album page/home hero404. Existing PageHero explicitly renders fallback on404; populated album content still passed. No global abort suppression or zero-health claim. Supplemental handlers are narrower and observed8console/1requestfailed. Captured overflow0 is a snapshot observation; axe and full R3 interactions/states remain not-run. See [safe history](tasks/round2/history-and-health.json).

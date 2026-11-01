# FE Review Prompt — cms-scaffold

Current scope is approved [DESIGN](DESIGN.md) M1/M2: synchronize and verify the three existing mock apps. Six waves W1/W2/W3/W3b/W4/W5 are VERIFIED via PR229/245/273/281/289/300. Product, shared UI, Vite configuration, fixtures, handlers, backend, dependencies and CI remain outside this review-only implementation. D1(b) remains proposal-only; D2(b) uses CLI loopback override.

Read component AGENTS/SUCCESS, [frontend SDD §7](../docs/v2/01-frontend-sdd.md#7-路由與畫面), [current review](REVIEW.md) and [protocol](../../../docs/fe-review/PROTOCOL.md). The [Round 2 report](tasks/round2/report.md) records passed local gates and retained initial failures; targets are verified only for the M1/M2 contract.

## Current route families

Front covers selector, login/logout, album listing/detail/photo, clinic/vet listing/detail, authenticated member home/new appointment/detail, projects/detail/milestone listing/detail and explicit not-found. Back covers sign-in/login alias, home, album index/new/edit/preview/history, all three custom views, media listing/detail and forbidden/not-found. Admin covers login/home, types/detail, roles/matrix, principals/new/detail, audit/detail, media quota, settings/audit retention, entry lookup/inspector and 403/404. `targets.json` names every concrete fixture path and loaded selector; no obsolete `/users` target remains.

Each capture/verification uses a fresh context. Protected paths carry `?mockUser=`: Front `seed-member-clinic`, Back the matching pack operator, Admin `seed-admin`. These are synthetic fixture identities; no real password/token is used. Mock identity must match `sessionStorage['cms-mock:user']` after load. Anonymous pages must stay anonymous. Composer and board explicitly select existing populated album/project fixtures. Front logout starts synthetic authenticated and must reach `/` with no stored identity; Back `/login` must reach `/sign-in`. All other final URLs must exactly match the target including origin/query/hash. SPA forbidden/not-found surfaces intentionally return document HTTP200 while rendering their specific status page.

## Execution

Root supplies unchanged-lock `npm ci`, native frontend gates and an owned network-none container with Node24, current component Playwright and compatible Chromium. No host ports, host network, host credentials or browser Docker socket. Wait for native builds before starting Vite. Start commands remain `npm run dev:mock -- --host 127.0.0.1 --strictPort` on5173/5174/5175.

From repository root, within that container:

```sh
node --test apps/cms-scaffold/fe-review/route-guard.test.mjs apps/cms-scaffold/fe-review/inventory.test.mjs
node docs/fe-review/capture.mjs apps/cms-scaffold/fe-review/targets.json --dry-run
node docs/fe-review/capture.mjs apps/cms-scaffold/fe-review/targets.json --start --no-axe --out apps/cms-scaffold/fe-review/runs/round2-capture
node apps/cms-scaffold/fe-review/audit-captures.mjs apps/cms-scaffold/fe-review/runs/round2-capture
node apps/cms-scaffold/fe-review/verify-routes.mjs apps/cms-scaffold/fe-review/runs/round2-routes
```

Shared capture gives three viewports (1440×900,834×1112,390×844) ×51 pages ×light =153 PNGs. It records requested URLs only; therefore supplemental verification is mandatory and must not be replaced by HTTP200 alone. All page-specific loaded selectors, actual final URLs, exact synthetic identity and zero page errors must pass. The supplemental driver owns/reaps its servers and verifies closed listeners; the outer supervisor must additionally prove its container absent, including on failure. Preserve first failures and bounded corrections rather than overwriting runs.

Native `lint/typecheck/test/build/test:bundle` are root-owned. Root inspected and explicitly authorized the existing default test command's PP1-local unit helpers: this does not start PP1/Compose or establish operational PP1 acceptance. No extra real API/mock E2E/quality suites are introduced for M2.

## Round 3 still pending

Future interaction review follows selector→album/lightbox/photo, clinic/member appointments, project/milestones; Back entry form/history/preview/custom views/media; Admin types/principals/roles/audit/settings/entry inspector. Future state captures use existing `mock=slow|empty|error500|conflict`, with full keyboard/accessibility/overflow/copy/skeleton checks from DESIGN. No such broader pass is claimed by a loaded route screenshot. Light preference is intentional; gallery-dark is a site scheme. Shared UI fixes require a separate proposal.

# Connected Fake runtime publication checkpoint — 2026-10-23

This checkpoint saves the implemented, locally reviewed P0-A prerequisites before a workstation
restart. It does not mark the complete P0-A product accepted. The owner authorized commit, PR and
merge; GitHub checks on the published commit remain the merge gate. Deployment is not included.

## Scope and acceptance mapping

- AC-01: durable approved-repository proposals, explicit first acceptance, immutable current input,
  Ready/dispatch and exact committed result replay across process restart.
- AC-02 prerequisites: current subject and policy guards, fenced immutable Run-output provenance,
  strict candidate/review/evidence/approval/QA/cancel HTTP adapters and exact completion preparation
  service. Full connected completion and HAI-DONE acceptance remain pending.
- AC-03 prerequisites: loopback cookie login, finite static hosting, real project/board reads,
  explicit admission/dispatch, response-loss lookup and reconnect. Full detail/attention/impact and
  accessibility acceptance remain pending.
- AC-04: durable activation, backup/restore and ContextPack resume remain unfinished.

The source diff is restricted to products/hai-taskboard. No provider execution, dependencies,
credentials, runtime state databases or raw private host evidence are included.

## Executed local verification

All retained build/test tasks used the common workspace. Final backend, frontend, API and browser
jobs used pinned offline container images. The publication tree's code matches their recorded inputs.

| Task | Executed checks | Result |
| --- | --- | --- |
| completion-integrated-20261023 | Unmodified bash scripts/check-backend.sh: pins/modules, formatting, vet, full tests, race tests, build; Go1.27.1 | PASS;141 stable backend inputs |
| root-hai028-green | Node24.20; Vitest30tests/9files, TypeScript, ESLint, Prettier and Vite production build | PASS;36 stable web inputs |
| completion-api-integrated-20261023 | Pinned Redocly2.51.2 OpenAPI lint | PASS;0warnings |
| completion-connected-browser-20261023 | Actual Go runtime and Chromium151.0.7922.34;13 bounded checks and two fresh processes | PASS; fullProductAcceptance=false, doneAcceptance=false |
| review-hai029-keyboard3-20261023 | Independent Chromium Tab focus, ArrowRight horizontal scrolling0→280, visible3px focus outline and two-process flow | PASS on retained accepted artifacts |

The actual browser flow covers cookie login, project/Draft creation, rejected headless Ready,
persistent restart, approved binding/proposal/preparation/explicit acceptance, lost-response original
result lookup without repost, Fake/SSE success remaining Developing, disconnect/reconnect, board
focus, axe light/dark,320px viewport,200% CSS zoom at640px, and logout. CSS zoom does not certify
native browser zoom or the complete keyboard/coarse-pointer interaction requirements.

Final backend log SHA256:
`e80fad7c2fe16b1b6e4be6f507a18fd7997acaa4f3da3dfd985da5de3282972a`.

Independent review results are recorded in traceability. Selected final reports, whose raw local
paths are intentionally omitted here:

| Report | SHA256 |
| --- | --- |
| T-023 | `550fe4911921d4433f919242d11527e91a2ebb7661af964305b166f5522c6653` |
| T-025 | `6cbbd4850dd796b13efc35f96116ddb86be5b3dd245b205c188119b7ffaab913` |
| T-026 | `302393e76ab3c7a4e42e9352bf7d3ba902c17ea81af01b593daa60bbb00a5ab6` |
| T-027 | `4fa5928b045daa3df4630aa16c172a9a3295c9903b53d46351af6441134ba1fe` |
| T-029 | `78af8faa3e7b7cde1f5e18100e11d43d68d6e554a4f7693e0ad0d18dd613dd30` |

T023/T026/T029 PARTIAL status retains corrected reviewer-harness failures; their final bounded
recommendations are ACCEPT. Earlier SQL byte-bound, reset/session, canonical timestamp and board
focus failures remain in original evidence alongside their Red/Green corrections. Passing current
checks do not erase historical failures or replace missing full-product acceptance.

## Resume

Read SUCCESS.md, docs/tasks/BOARD.md and docs/HANDOFF.md. Start with the named completion
preparation/output/artifact/report HTTP slice, then connected candidate→human verification→QA→Done.
Keep Unknown, successful Run and Done distinct. Continue remaining UI and recovery work afterward.

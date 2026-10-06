STATUS: PARTIAL

## Summary
The integrated product passes643 unit tests, native/build/isolation gates, fixed bundle budgets, and60 accessibility cases. New hardening tooling reports7/11; the first full93 mock run is still running and has exposed one stale deferred Admin assertion. No product defect is confirmed by these failures. Failed artifacts remain preserved; W5 is not complete.

## Verification
- `npm run lint`, `npm run typecheck`, `npm test` (643), `npm run build`, `npm run test:bundle`, `npm run measure:bundle` — passed
- Integrated node harness contracts52 and recorder/measurer27 — passed
- `npm run test:a11y -- --reporter=list,json`:60/60, zero critical/serious — passed
- `npm run test:hardening -- --reporter=list,json`:7passed/4failed, artifacts in test-results/frontend/hardening-attempt-1 and compact result .team/evidence/w5-hardening-results.json — failed
- First mock run: deferred W4 member-link assertion expects version1, actual requestversion2; full outcome pending — failed

## Documentation
Concrete source-alignment corrections supported by already accepted contracts:
1. F03/F04/F05: clinic h1 remains Cedar Pet Clinic but document.title must be 診所, per W3§1.1 F05 and home.tsx. Keep exact background/fonts/title-size assertions.
2. S04: wait for target James Carter heading and scope the injected Markdown to that visible target, avoiding hidden outgoing React transition content. Keep injected-hit proof, safe text, undefined __xss and zero injected images.
3. C16: count real matching delayed requests and completions, including StrictMode/cancellation replay. Require at least one hit, navigate while pending, wait until all injected late responses complete, then verify only second route heading. Keep1500ms delay and fail if injection never happens.
4. Deferred W4 member-link: W4§0 already says packaged Bettyversion2 is intentional; use fetched currentversion for exact PATCH body assertion and retain exact principalbinding. No fixture/API/product changes.

### E. Proposed narrow W5§7.7 C13/C14 clarification — owner approved 2026-10-05
W5 currently says album/photo/vet/project all have a Markdown element, but accepted W3§1.1 only markdown fields description/intro/hours/bio/summary/body use MarkdownBody; photo caption is plain text (W3§5 photo page, album.tsx PhotoAside). Vet/project fixtures do not all have an image. Proposed test visits allfour pages, requires MarkdownBody for actual Markdown fields, requires exact plain caption on photo detail, checks every rendered content image's alt/width/height/variant/loading, and explicitly requires album grid and photo detail images. Do not add Markdown formatting or artificial images to the product merely to satisfy the new test. Allfour page journeys, image assertions, XSS checks, counts and performance thresholds remain.

This clarification changes the literal W5 acceptance wording. W5§7.7 states「任何 assertion 失敗都依 §3 停止，不把測試改成迎合現況。」Owner replied「同意，按你建議。」and approved E before implementation; W5§0.3 records the exact scope. This is a project blueprint constraint, not an automatic approval-review rejection.

## Risks and Follow-ups
Root may preserve/review existing evidence and finish already-running verification. No W5 completion, canonical PNG acceptance, commit/PR/merge or deployment is claimed. After E approval, document exact accepted scope then apply the narrow harness corrections and rerun failed gates; no product rewrite or threshold waiver is proposed.

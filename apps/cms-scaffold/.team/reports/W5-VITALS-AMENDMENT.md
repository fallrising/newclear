STATUS: PARTIAL

## Summary
W5 now passes fixed entry bundle budgets, but the first complete production Web Vitals measurement fails the clinic target. Preserve the five samples and trace; no thresholds or product code have been changed in response. The proposed next scope is a bounded performance repair of existing loading behavior, not new CMS functionality.

## Verification
- Normal production build and strict route interception,25 cold recorded samples plus5 warm-ups; complete JSON `.team/evidence/w5-vitals-attempt-2.json` with append-only five rows — passed
- Front album: medianLCP2468ms, max3076ms, maxCLS0.009015448; projects2476/2500ms, CLS0; BackCLS0.003442703; AdminCLS0.007282745 — passed
- Front clinic: LCP2492/2484/2648/3188/2472ms (median2492, max3188>3125); every CLS0.0914948303>0.05 — failed
- Initial Vitals attempt failed before recorded samples due conflicting Playwright automatic/manual tracing; preserved `initial-vitals-results.json`, artifacts and log. Config now leaves trace ownership to the spec and every sample trace remains — failed
- Source and trace-frame inspection: clinic profile uses small HeroSkeleton despite final address/telephone/hours cards; vet cards use square image placeholders although actual cards are text; account/CTA loading and resolved sizes differ. Trace shows profile, footer, navigation and brand shifts during this transition. Exact share attributable to each component remains to be measured — passed

## Documentation
W5§5.2 says「未達標處理：保留 JSON 與 trace，停止 W5。…不得自行加 preload、改圖片、skeleton、等待、cache 或門檻。」Owner A–D authorized measured import boundaries; E authorized test alignment. This measured loading-layout issue requires the following explicit blueprint amendment before implementation. It is not an automatic approval-review rejection.

### F. Owner-approved bounded performance repair — 2026-10-05
1. In Front `home.tsx`/`states.tsx`, provide clinic-profile and text-vet-card loading placeholders matching their existing content structure (heading/intro, three contact cards, text-card grid). Reserve stable account/appointment CTA geometry in `shell.tsx`/`home.tsx` through pending/anonymous/member states. Keep actual content, API queries, authentication, empty/error states, alt/image behavior and copy. Any small header spacing reservation is intentional and must be reviewed in initial visual baselines; no redesign or new feature.
2. In Front `browser-routes.tsx`, start only the currently matched lazy route modules concurrently, with stable cached loader promises shared by React.lazy. This removes nested API-layout/site-layout/page chunk waterfalls while preserving genuine route boundaries and per-App query-client lifetime. Never load all sites or the entire App artificially, and do not prefetch protected API data or alter caching.
3. At most two measured repair iterations. Add narrow loading/navigation regressions first, then rerun changed Front/native/bundle gates and complete25sampleVitals. Keep Front92160/Back163840/Admin163840, medianLCP2500/max3125, CLS0.05/0.1. If still failing, retain evidence and stop for a concrete decision.
4. After performance acceptance, finish hardening11, mock93 three consecutive passes, canonical70-image authoring/comparison, real14 and independent review/CI before normal authorized publication/merge. Do not generate an accepted visual baseline from a layout known to fail.

## Risks and Follow-ups
Owner replied「approve」and authorized F on2026-10-05. It is not yet an implemented or measured fix. Skeleton geometry cannot predict arbitrary long user content, so validate desktop/mobile and loading/error/empty cases rather than only the seeded happy path. Matched-module preloading must retain deep links, history, member redirects and session reuse. Existing failed samples remain in the ledger; no fabricated pass or production-ready claim.

# Current-main integration verification — 2026-11-07

The owner authorized consolidating useful pending work into GitHub on 2026-11-07. This extends the earlier Draft-only delivery authority to a qualified normal merge. It does not assert final owner acceptance, authorize deployment, or create a usable tag. The original AC and historical evidence remain unchanged.

Inputs: implementation `d1bc078c47f73b48375a53d8aad4450b8b01c0fd` and main `04a7340f05ade127f550539817f78411bfba9d2d`. Integration resolves only the root README and llms index conflicts, retaining current-main entries alongside the Motion Prompt implementation entry. Handwritten product source, metadata, locale and generated outputs are unchanged from the implementation.

## Fresh verification

All build/test jobs used the shared task launcher, with test outputs and dependencies outside the source checkout. Node 24.14.0, pinned Playwright 1.62.1 and Chromium 151.0.7922.34 were used. Chromium libraries and Noto CJK fonts were extracted only into the test task; no host packages or product dependencies changed.

| Check | Actual result |
| --- | --- |
| `node tools/build.mjs`, `node tools/build.mjs --check`, `node tools/validate.mjs` | 120 items, 517 generated files, 612 paired specifications; passed |
| `node tools/contract-test.mjs` | Existing negative cases and deterministic-output checks passed |
| `npm test` | Original complete test command passed, including 44 real-browser checks and both strict animation languages |
| Browser | 480 API resources, real clipboard, no console/resource errors or unnecessary external requests; [results](20261107/browser-results.json) |
| Strict animations | [zh-Hant](20261107/animation-zh-Hant.json) and [en](20261107/animation-en.json), 120 each, zero failures/warnings |
| Browser rerun after adding task-local CJK fonts | Passed; six readable screenshots inspected. [Desktop](20261107/desktop-zh.png), [English detail](20261107/desktop-en-detail.png), [mobile](20261107/mobile-zh.png), [mobile detail](20261107/mobile-zh-detail.png), [LP](20261107/desktop-lp.png), [photo](20261107/desktop-photo.png) |
| Root `python3 scripts/check_indexes.py` | 55 contracts, nine llms files, zero errors, using the existing CI-pinned opencc dependency |
| `git diff --cached --check`, `git diff --check` | Passed after conflict resolution |
| Historical evidence integrity | All 15 prior evidence files retain identical bytes |

Earlier failed attempts remain in the task execution evidence: sandbox subprocess `EPERM`, missing Chromium shared libraries, and missing opencc. The original unchanged tests passed after the test environment was prepared. Initial fontless screenshots were unsuitable for Chinese visual review; the linked screenshots are the subsequent CJK-font run. This is not a relaxation of a product assertion.

## Boundaries

The fixed upstream source and earlier upstream-comparison evidence remain at their recorded versions and dates; this run did not repeat or claim a fresh upstream comparison. Final translation naturalness and visual suitability remain subject to owner acceptance. Safari, Firefox, physical mobile devices and deployed hosting were not tested. Merge/CI/review results are recorded against the actual final PR head; the tests above do not pre-claim those outcomes.

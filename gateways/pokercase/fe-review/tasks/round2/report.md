# T-0380 / T021 — Pokercase original Round2 M1–M4

Implementation and local evidence are complete for the approved presentation scope. At the author freeze, independent final review and delivery gates were pending. Root subsequently recorded R31 ACCEPT (no unresolved P1/P2) in [the independent review](evidence/independent-review.md); 42 project contracts/index and staged diff/privacy checks passed. Both current-head CI checks subsequently passed; PR603 normally merged at `05aeed43a3a49cc1b4a98f760e52fa2881c61064` on 2026-10-24T14:18:11Z and fetched scoped equality passed. [Delivery receipt](evidence/delivery.json). No owner completion, full Round3, usable tag or gateway mainline acceptance is claimed. Machine index: [result.json](result.json); [source hashes](source-manifest.json); [private artifact inventory](artifact-manifest.json); [publication provenance](publication-provenance.json).

## Result and scope

Measured Web overflow is fixed using the existing layout, named keyboard-focusable local table regions, readable column width floors, explicit Actions headers, visible focus and underlined prose links. Keys/dashboard copy now states default denial, with local bootstrap only explicit opt-in/zero total keys and no remote or proxy-header admission. No backend/auth/CSRF/provider/dependency/CI semantics changed.

Measured TUI clipping is fixed with display-cell column budgets/ellipsis, a complete two-line navigation/quit/cost/DB footer and neutral “No rows to display.” text. Existing database-error handling and read-only keys remain unchanged. Normal synthetic connection identity suffixes02–09 remain distinct alongside URL/model at80×24 and120×40.

| Approved item | Actual evidence | Result / limit |
| --- | --- | --- |
| M1 isolation/fixture | [final visual receipt](evidence/visual-001.json), [outer receipt](evidence/visual-001-outer.json), [offline guards](evidence/offline-checks.json) | New0700 state, nonroot network-none container, loopback service/mock, clean child environment without HOME/credentials, real session+CSRF API seed10connections/10routes/1key, two synthetic usage events200/500. No SQLite seed or real provider. Missing/reused/foreign state guards tested. |
| M2 responsive/keyboard/errors | [18 current strict views](evidence/visual-001.json), [six unaffected shared views' original receipt](evidence/presentation-001.json), [root image review](evidence/visual-image-review.json) |1440×900/834×1112/390×844 dark;18 affected views have0axe violations/page overflow/unexpected health; maximum synthetic row128.984375px.14 actual journeys with Tab/visible focus/Enter, required input, login failure/success, real connection/route CRUD, controlled400/CSRF403, delete cancel, key lifecycle/logout. Actions starts offscreen, becomes visible via keyboard/local scrolling. |
| M2 contrast | [current visual observations](evidence/visual-001.json), [desktop correction](evidence/contrast-desktop-001.json) |13 axe contrast-incomplete sets remain. Valid union:12 correctly sized sets/519computednodes plus1actual1440×900 node, all520opaque pairs pass. Corrected desktop ratio4.939408500921019≥4.5. This is not a claim that every offscreen pixel was manually inspected. |
| M3 key protection | [14 current journeys](evidence/visual-001.json) | One-time key is observed only in RAM, ordinary prefix-only list is loaded before any image; no trace/HAR/video/DOM/body/header dumps. Logout removes cookie and actual admin API returns401. Default-deny initial admin/inference401 produces no upstream request. |
| M4 terminal | [repair-001 terminal receipt](evidence/repair-001.json), [artifact hashes](artifact-manifest.json), [source/binary mapping](source-manifest.json) |12 captures:2sizes×3pages×empty/populated; ANSI and text stored separately/private.4q/Esc exits restore stty+alternate screen,4owned server/process-group absences. Reused under identical TUI/backend/fixture sources after CSS-only binary rebuild; not falsely retagged as a new terminal run. |

## Source-specific coverage and provenance

Current Web page coverage is six original shared login/dashboard keys plus18 new custom table views (Connections/Routes/Keys/Usage/two edit pages×3sizes). The two underlying login/dashboard templates have no `.table-scroll` selector; only those scoped selectors were appended, and all other native sources were equal. Original24 shared images and22 strict companion results remain historical; the18 old table images are not relabeled as current. Current14journey images are from visual-001. All99 historical PNGs and36ANSI+36plain-text artifacts are hash-indexed privately; no raw image/terminal/state payload is published.

Final native binary is `21fce3fab360ad66f97179bf54d391c83702f62d55cd09a118c693fd349516cd`. Terminal evidence retains binary `0c2c61a26421b9ebed5c72acd193b40995da8e3d473d3acebd49834f29d4413f`. Final CSS is `66ac524ba5844cf62caf2cec425afc5075a80c710898259e88ff064b57e2cd98`; terminal source is `c33c495bd8f799a00d8633a323e7eaef0fcea9ac1cb08310eb7fddc7dc6d6693`. Current Chromium is153.0.8010.12, tmux3.4, TERM xterm-256color/locale C.UTF-8. Parent runtime image is recorded in each outer receipt.

After visual-001, only the review helper's viewport mapping/provenance/mode and one offline regression changed. contrast-desktop-001 used the same native binary, fresh real API seed and exactly one desktop contrast observation; it did not repeat the matrix, journeys or TUI. [Source manifest](source-manifest.json) keeps both runtime versions and the exact delta.

## Observed commands and outcomes

Root native commands use the existing locked toolchain/fixtures; logs remain private with original hashes, structured receipts are public. [Visual native receipt](evidence/visual-native.json), [summary](evidence/visual-summary.json):

- `cargo +1.99.0 fmt --check` — PASS0.264s.
- `cargo +1.99.0 test --locked` — PASS127tests/10testedtargets/0failed/0ignored,23.548s.
- `cargo +1.99.0 clippy --locked --all-targets -- -D warnings` — PASS2.971s.
- `cargo +1.99.0 build --locked` — PASS6.692s.
- `cargo +1.99.0 test --locked tui_app::tests::review_ -- --nocapture` — focused5PASS9.468s before the CSS-only rebuild; these are a subset of127, not additional tests. Four initial renderer RED failures and the later normal-name RED failure are retained in [receipts](evidence/tui-renderer-red.json), [normal-name receipt](evidence/tui-normal-name-red.json).
- Separate offline Node commands observed7fixture/lifecycle,4presentation-contract,2terminal ownership,3CDP/URL,2navigation-order and1viewport-mapping cases passing:19total across different bounded source stages, **not one final aggregate run**. Exact commands, durations and raw hashes: [offline-checks.json](evidence/offline-checks.json). One temporary declaration-mirroring CSS test was removed and excluded from acceptance; actual PNG/geometry supplies the visual RED.
- Parent explicit `visual-001 visual` run — PASS50.369s,18images+14journeys, all9cleanup stages and positive container absence. Parent `contrast-desktop-001 contrast-desktop` — PASS3.002s, actual1440×900/onepair, all9cleanup and positive container absence. Source pin/read-only artifact and wrong-binary checks passed. No worker launched native/browser/services.

## Preserved failures and corrections

1. baseline-001 PASS38.571s is measurement completion only: original tablet/mobile table overflow, three serious dashboard inline-link nodes per viewport, empty Actions headers and contrast incompletes are preserved.
2. presentation-001 FAIL50.240s: original shared login/desktop has one console404 without location. All24status/geometry and22strict companions passed. A later separate anonymous CDP probe proves its own exact faviconGET404/no credential headers/unknown0; it corroborates but cannot identify the original shared event. Do not call original health zero or rewrite FAIL.
3. continuation-001 FAIL8.513s: first login journey checked the old document before redirect settled;0journey steps accepted, cleanup-time GET/login abort preserved. Actual new-document waiter is now armed before Enter, with exact POST/final-document statuses and finalURL, including400/403/200 same-URL documents. No arbitrary sleep or general abort exemption.
4. Earlier TUI candidate hid normal02–09 name suffixes under18-cell cap. A true TestBackend RED preceded the minimal Connections column-budget correction; current repair-001 terminal evidence confirms distinct names, long Chinese/URL visibility, footer and cleanup.
5. repair-001 PASS18.441s established14functional journeys/TUI, but later actual image review found a >1000px nearlyblank long-data row from collapsed columns. The earlier minor-tradeoff assessment was withdrawn. Scoped minimum widths fixed the actual regression; visual-001's measured maximum is128.984375px. No page-level overflow hiding or text deletion was introduced.
6. visual-001 PASS retains one invalid-scope computed desktop contrast pair: old helper used390×844 for all non-tablet names. The original JSON stays unchanged. Twelve other sets remain valid; the separate correction records/asserts1440×900 and replaces only that one pair in the accepted union.

## Limits and publication

Named horizontal scrolling remains intentional. Forms precede tables, so mobile full-page images remain long; that is distinct from the repaired collapsed-row defect. Very long TUI fields use explicit ellipsis. All13 contrast-incomplete sets remain visible;520computed pairs and eight representative root-inspected images are not full manual accessibility certification. Full Round3, light theme, real provider/OAuth/CLI/account integration, deployment and gateway mainline acceptance are outside this result.

[Publication provenance](publication-provenance.json) records original/private and public hashes and explicit safe-field summarization; native structured receipts are byte-identical. No raw PNG/ANSI/authstate/service log or host path is published. Raw failures remain private for the parent-owned backup. No raw log normalization was needed for public summaries. Aggregate provider/model calls, tokens and cost are unknown/null; synthetic owned mock counts are separate. R31 independent review is ACCEPT; both current-head CI checks, normal merge and scoped readback passed in PR603. The scoped board item is done; wider demand/owner acceptance remains incomplete.

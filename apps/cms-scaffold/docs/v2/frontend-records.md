# 前端硬化量測與 e2e 紀錄

[回 v2 索引](README.md) ・ 施工圖：[W5](waves/W5.md)

本檔是 W5 的 **append-only** 實測台帳。只能在各表尾新增列；不得刪除、改寫或重排既有列。資料錯誤時新增一列並在備註寫 `supersedes <record-id>`。空白表是模板，不代表已執行。

## 紀錄規則

- ID：`W5-<kind>-YYYYMMDD-NN`；kind 為 `BUNDLE`、`VITALS`、`MOCK`、`VISUAL`、`REAL`。
- `commit` 用完整 40 字元 SHA；未提交量測仍寫當時 `HEAD`，`dirty` 必須為 `yes`。
- 時間一律 UTC ISO-8601。指令必須是實際執行的精確指令。
- artifact 放在 gitignore 的 `test-results/frontend/`；視覺 baseline 另提交在 W5 §5.4 指定路徑。
- 結果只能是 `passed` 或 `failed`，不可寫 `skipped`。失敗與後續成功都保留。
- 不記錄密碼、cookie、Authorization、CSRF token 或個資。

## Bundle

每次完整量測追加三列；gzip bytes 由 `zlib` level 9 產生，1 KB = 1024 bytes。

| record id | measured at (UTC) | commit | dirty | app | entry gzip bytes | limit bytes | delta bytes | command | artifact | result | notes |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | --- | --- | --- | --- |

| W5-BUNDLE-20261004-01 | 2026-10-04T17:08:19.530Z | 3b7be596e32920268036d4eb91361972f52bc8ba | yes | front | 179115 | 92160 | 86955 | npm run measure:bundle | records/bundle-baseline.json | failed | Historical failed measurement; ledger ID assigned during recording; raw T-951-baseline-bundle.json SHA256 d278d0d7b8068488217fac3a10a6f05b3d11be4e04281de2409131559308e65b |
| W5-BUNDLE-20261004-02 | 2026-10-04T17:08:19.530Z | 3b7be596e32920268036d4eb91361972f52bc8ba | yes | back | 179700 | 163840 | 15860 | npm run measure:bundle | records/bundle-baseline.json | failed | Historical failed measurement; ledger ID assigned during recording; raw T-951-baseline-bundle.json SHA256 d278d0d7b8068488217fac3a10a6f05b3d11be4e04281de2409131559308e65b |
| W5-BUNDLE-20261004-03 | 2026-10-04T17:08:19.530Z | 3b7be596e32920268036d4eb91361972f52bc8ba | yes | admin | 180355 | 163840 | 16515 | npm run measure:bundle | records/bundle-baseline.json | failed | Historical failed measurement; ledger ID assigned during recording; raw T-951-baseline-bundle.json SHA256 d278d0d7b8068488217fac3a10a6f05b3d11be4e04281de2409131559308e65b |
| W5-BUNDLE-20261004-04 | 2026-10-04T17:11:29.551Z | 3b7be596e32920268036d4eb91361972f52bc8ba | yes | front | 177721 | 92160 | 85561 | npm run measure:bundle | records/bundle-prescribed.json | failed | Historical failed measurement; ledger ID assigned during recording; raw w5-prescribed-bundle.json SHA256 65e5d32e53faa3e3ae255702789d405671d9fa0230916cd515af66e38ffa4013 |
| W5-BUNDLE-20261004-05 | 2026-10-04T17:11:29.551Z | 3b7be596e32920268036d4eb91361972f52bc8ba | yes | back | 179622 | 163840 | 15782 | npm run measure:bundle | records/bundle-prescribed.json | failed | Historical failed measurement; ledger ID assigned during recording; raw w5-prescribed-bundle.json SHA256 65e5d32e53faa3e3ae255702789d405671d9fa0230916cd515af66e38ffa4013 |
| W5-BUNDLE-20261004-06 | 2026-10-04T17:11:29.551Z | 3b7be596e32920268036d4eb91361972f52bc8ba | yes | admin | 180275 | 163840 | 16435 | npm run measure:bundle | records/bundle-prescribed.json | failed | Historical failed measurement; ledger ID assigned during recording; raw w5-prescribed-bundle.json SHA256 65e5d32e53faa3e3ae255702789d405671d9fa0230916cd515af66e38ffa4013 |
| W5-BUNDLE-20261004-07 | 2026-10-04T17:15:33.847Z | 3b7be596e32920268036d4eb91361972f52bc8ba | yes | front | 177721 | 92160 | 85561 | npm run measure:bundle | records/bundle-root-confirmation.json | failed | Historical failed measurement; ledger ID assigned during recording; raw w5-root-bundle.json SHA256 22f38de679b4fd936c0fc5993b9f1e9bdcf6a66b8fcc311198903b8fb11df776 |
| W5-BUNDLE-20261004-08 | 2026-10-04T17:15:33.847Z | 3b7be596e32920268036d4eb91361972f52bc8ba | yes | back | 179622 | 163840 | 15782 | npm run measure:bundle | records/bundle-root-confirmation.json | failed | Historical failed measurement; ledger ID assigned during recording; raw w5-root-bundle.json SHA256 22f38de679b4fd936c0fc5993b9f1e9bdcf6a66b8fcc311198903b8fb11df776 |
| W5-BUNDLE-20261004-09 | 2026-10-04T17:15:33.847Z | 3b7be596e32920268036d4eb91361972f52bc8ba | yes | admin | 180275 | 163840 | 16435 | npm run measure:bundle | records/bundle-root-confirmation.json | failed | Historical failed measurement; ledger ID assigned during recording; raw w5-root-bundle.json SHA256 22f38de679b4fd936c0fc5993b9f1e9bdcf6a66b8fcc311198903b8fb11df776 |

| W5-BUNDLE-20261005-01 | 2026-10-05T16:15:53.891Z | 3b7be596e32920268036d4eb91361972f52bc8ba | yes | front | 177721 | 92160 | 85561 | npm run measure:bundle | test-results/frontend/records/T-954-iteration1-bundle.json | failed | T-954 iteration1; record IDs assigned append-only; raw T-954-iteration1-bundle.json SHA256 f73f967c5796abd8ffe20390fbe6c91e79b7b9630f395ef410dcbef0c68ec5f6 |
| W5-BUNDLE-20261005-02 | 2026-10-05T16:15:53.891Z | 3b7be596e32920268036d4eb91361972f52bc8ba | yes | back | 179628 | 163840 | 15788 | npm run measure:bundle | test-results/frontend/records/T-954-iteration1-bundle.json | failed | T-954 iteration1; record IDs assigned append-only; raw T-954-iteration1-bundle.json SHA256 f73f967c5796abd8ffe20390fbe6c91e79b7b9630f395ef410dcbef0c68ec5f6 |
| W5-BUNDLE-20261005-03 | 2026-10-05T16:15:53.891Z | 3b7be596e32920268036d4eb91361972f52bc8ba | yes | admin | 180275 | 163840 | 16435 | npm run measure:bundle | test-results/frontend/records/T-954-iteration1-bundle.json | failed | T-954 iteration1; record IDs assigned append-only; raw T-954-iteration1-bundle.json SHA256 f73f967c5796abd8ffe20390fbe6c91e79b7b9630f395ef410dcbef0c68ec5f6 |
| W5-BUNDLE-20261005-04 | 2026-10-05T16:19:50.118Z | 3b7be596e32920268036d4eb91361972f52bc8ba | yes | front | 123501 | 92160 | 31341 | npm run measure:bundle | test-results/frontend/records/T-954-iteration2-bundle.json | failed | T-954 iteration2; record IDs assigned append-only; raw T-954-iteration2-bundle.json SHA256 ccaefc3590d52cd8202a098093fba70b136819b63b3c0a7f6addc463ab404788 |
| W5-BUNDLE-20261005-05 | 2026-10-05T16:19:50.118Z | 3b7be596e32920268036d4eb91361972f52bc8ba | yes | back | 130894 | 163840 | -32946 | npm run measure:bundle | test-results/frontend/records/T-954-iteration2-bundle.json | passed | T-954 iteration2; record IDs assigned append-only; raw T-954-iteration2-bundle.json SHA256 ccaefc3590d52cd8202a098093fba70b136819b63b3c0a7f6addc463ab404788 |
| W5-BUNDLE-20261005-06 | 2026-10-05T16:19:50.118Z | 3b7be596e32920268036d4eb91361972f52bc8ba | yes | admin | 136589 | 163840 | -27251 | npm run measure:bundle | test-results/frontend/records/T-954-iteration2-bundle.json | passed | T-954 iteration2; record IDs assigned append-only; raw T-954-iteration2-bundle.json SHA256 ccaefc3590d52cd8202a098093fba70b136819b63b3c0a7f6addc463ab404788 |
| W5-BUNDLE-20261005-07 | 2026-10-05T16:28:44.085Z | 3b7be596e32920268036d4eb91361972f52bc8ba | yes | front | 102977 | 92160 | 10817 | npm run measure:bundle | test-results/frontend/records/T-954-iteration3-bundle.json | failed | T-954 iteration3; record IDs assigned append-only; raw T-954-iteration3-bundle.json SHA256 588867196d45386dfedc4370bc72bdba0d37b1f999c9e03f3239d5dee5ea3b14 |
| W5-BUNDLE-20261005-08 | 2026-10-05T16:28:44.085Z | 3b7be596e32920268036d4eb91361972f52bc8ba | yes | back | 130889 | 163840 | -32951 | npm run measure:bundle | test-results/frontend/records/T-954-iteration3-bundle.json | passed | T-954 iteration3; record IDs assigned append-only; raw T-954-iteration3-bundle.json SHA256 588867196d45386dfedc4370bc72bdba0d37b1f999c9e03f3239d5dee5ea3b14 |
| W5-BUNDLE-20261005-09 | 2026-10-05T16:28:44.085Z | 3b7be596e32920268036d4eb91361972f52bc8ba | yes | admin | 136589 | 163840 | -27251 | npm run measure:bundle | test-results/frontend/records/T-954-iteration3-bundle.json | passed | T-954 iteration3; record IDs assigned append-only; raw T-954-iteration3-bundle.json SHA256 588867196d45386dfedc4370bc72bdba0d37b1f999c9e03f3239d5dee5ea3b14 |
| W5-BUNDLE-20261005-10 | 2026-10-05T16:34:28.153Z | 3b7be596e32920268036d4eb91361972f52bc8ba | yes | front | 85127 | 92160 | -7033 | npm run measure:bundle | test-results/frontend/records/T-954-iteration4-bundle.json | passed | T-954 iteration4; record IDs assigned append-only; raw T-954-iteration4-bundle.json SHA256 88d730b31ad3e8c23859eaad80b5d5f68e2aa70e17ee1276e9f9ace8f4282c65 |
| W5-BUNDLE-20261005-11 | 2026-10-05T16:34:28.153Z | 3b7be596e32920268036d4eb91361972f52bc8ba | yes | back | 130889 | 163840 | -32951 | npm run measure:bundle | test-results/frontend/records/T-954-iteration4-bundle.json | passed | T-954 iteration4; record IDs assigned append-only; raw T-954-iteration4-bundle.json SHA256 88d730b31ad3e8c23859eaad80b5d5f68e2aa70e17ee1276e9f9ace8f4282c65 |
| W5-BUNDLE-20261005-12 | 2026-10-05T16:34:28.153Z | 3b7be596e32920268036d4eb91361972f52bc8ba | yes | admin | 136589 | 163840 | -27251 | npm run measure:bundle | test-results/frontend/records/T-954-iteration4-bundle.json | passed | T-954 iteration4; record IDs assigned append-only; raw T-954-iteration4-bundle.json SHA256 88d730b31ad3e8c23859eaad80b5d5f68e2aa70e17ee1276e9f9ace8f4282c65 |

| W5-BUNDLE-20261005-13 | 2026-10-05T16:42:42.921Z | 3b7be596e32920268036d4eb91361972f52bc8ba | yes | front | 85127 | 92160 | -7033 | npm run measure:bundle | bundle.json | passed |  |
| W5-BUNDLE-20261005-14 | 2026-10-05T16:42:42.921Z | 3b7be596e32920268036d4eb91361972f52bc8ba | yes | back | 130889 | 163840 | -32951 | npm run measure:bundle | bundle.json | passed |  |
| W5-BUNDLE-20261005-15 | 2026-10-05T16:42:42.921Z | 3b7be596e32920268036d4eb91361972f52bc8ba | yes | admin | 136589 | 163840 | -27251 | npm run measure:bundle | bundle.json | passed |  |

| W5-BUNDLE-20261005-16 | 2026-10-05T17:28:29.957Z | 3b7be596e32920268036d4eb91361972f52bc8ba | yes | front | 85206 | 92160 | -6954 | npm run measure:bundle | .team/evidence/w5-F-root-bundle.json | passed | Root integrated F iteration1; unchanged fixed budgets |
| W5-BUNDLE-20261005-17 | 2026-10-05T17:28:29.957Z | 3b7be596e32920268036d4eb91361972f52bc8ba | yes | back | 130889 | 163840 | -32951 | npm run measure:bundle | .team/evidence/w5-F-root-bundle.json | passed | Root integrated F iteration1; unchanged fixed budgets |
| W5-BUNDLE-20261005-18 | 2026-10-05T17:28:29.957Z | 3b7be596e32920268036d4eb91361972f52bc8ba | yes | admin | 136589 | 163840 | -27251 | npm run measure:bundle | .team/evidence/w5-F-root-bundle.json | passed | Root integrated F iteration1; unchanged fixed budgets |

## Web Vitals

每個 URL／surface 一列。`runs` 固定為 5，不含一次 warm-up；LCP 用 ms，CLS 無單位。量測必須是正常 `npm run build` 的 production `dist`，資料只由 W5 `e2e-vitals/routes.ts` 的 Playwright route interception 提供；notes 記錄 route log 無 unexpected／missing operation。

| record id | measured at (UTC) | commit | dirty | surface | URL | viewport | network / CPU | runs | median LCP ms | max LCP ms | median CLS | max CLS | limits | command | artifact | result | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | --- | --- |

| W5-VITALS-20261005-01 | 2026-10-05T17:02:56.847Z | 3b7be596e32920268036d4eb91361972f52bc8ba | yes | front | http://127.0.0.1:4173/album | 1280x800 | 150ms/1.6Mbps/750Kbps/4x | 5 | 2468 | 3076 | 0.009015447998046875 | 0.009015447998046875 | LCP median <= 2500ms; max <= 3125ms; CLS median/max <= 0.05 | npm run measure:vitals | test-results/frontend/vitals.json | passed | test-results/frontend/vitals-routes/1791219525180-1897777; normal production dist; strict route interception; one warm-up per target |
| W5-VITALS-20261005-02 | 2026-10-05T17:02:56.847Z | 3b7be596e32920268036d4eb91361972f52bc8ba | yes | front | http://127.0.0.1:4173/clinic | 1280x800 | 150ms/1.6Mbps/750Kbps/4x | 5 | 2492 | 3188 | 0.09149483032226563 | 0.09149483032226563 | LCP median <= 2500ms; max <= 3125ms; CLS median/max <= 0.05 | npm run measure:vitals | test-results/frontend/vitals.json | failed | test-results/frontend/vitals-routes/1791219525180-1897777; normal production dist; strict route interception; one warm-up per target |
| W5-VITALS-20261005-03 | 2026-10-05T17:02:56.847Z | 3b7be596e32920268036d4eb91361972f52bc8ba | yes | front | http://127.0.0.1:4173/projects | 1280x800 | 150ms/1.6Mbps/750Kbps/4x | 5 | 2476 | 2500 | 0 | 0 | LCP median <= 2500ms; max <= 3125ms; CLS median/max <= 0.05 | npm run measure:vitals | test-results/frontend/vitals.json | passed | test-results/frontend/vitals-routes/1791219525180-1897777; normal production dist; strict route interception; one warm-up per target |
| W5-VITALS-20261005-04 | 2026-10-05T17:02:56.847Z | 3b7be596e32920268036d4eb91361972f52bc8ba | yes | back | http://127.0.0.1:4174/ | 1280x800 | 150ms/1.6Mbps/750Kbps/4x | 5 | — | — | 0.003442703247070312 | 0.003442703247070312 | CLS median/max <= 0.1 | npm run measure:vitals | test-results/frontend/vitals.json | passed | test-results/frontend/vitals-routes/1791219525180-1897777; normal production dist; strict route interception; one warm-up per target |
| W5-VITALS-20261005-05 | 2026-10-05T17:02:56.847Z | 3b7be596e32920268036d4eb91361972f52bc8ba | yes | admin | http://127.0.0.1:4175/ | 1280x800 | 150ms/1.6Mbps/750Kbps/4x | 5 | — | — | 0.007282745361328125 | 0.007282745361328125 | CLS median/max <= 0.1 | npm run measure:vitals | test-results/frontend/vitals.json | passed | test-results/frontend/vitals-routes/1791219525180-1897777; normal production dist; strict route interception; one warm-up per target |

| W5-VITALS-20261005-06 | 2026-10-05T17:27:53.133Z | 3b7be596e32920268036d4eb91361972f52bc8ba | yes | front | http://127.0.0.1:4173/album | 1280x800 | 150ms/1.6Mbps/750Kbps/4x | 5 | 2208 | 2332 | 0.009015447998046875 | 0.009015447998046875 | LCP median <= 2500ms; max <= 3125ms; CLS median/max <= 0.05 | npm run measure:vitals | .team/evidence/w5-F1-vitals.json | passed | test-results/frontend/vitals-routes/1791221028441-1926044; normal production dist; strict route interception; one warm-up per target; F iteration1; original producer IDs01–05 retained in raw artifact, normalized to unused06–10 |
| W5-VITALS-20261005-07 | 2026-10-05T17:27:53.133Z | 3b7be596e32920268036d4eb91361972f52bc8ba | yes | front | http://127.0.0.1:4173/clinic | 1280x800 | 150ms/1.6Mbps/750Kbps/4x | 5 | 2316 | 2324 | 0 | 0 | LCP median <= 2500ms; max <= 3125ms; CLS median/max <= 0.05 | npm run measure:vitals | .team/evidence/w5-F1-vitals.json | passed | test-results/frontend/vitals-routes/1791221028441-1926044; normal production dist; strict route interception; one warm-up per target; F iteration1; original producer IDs01–05 retained in raw artifact, normalized to unused06–10 |
| W5-VITALS-20261005-08 | 2026-10-05T17:27:53.133Z | 3b7be596e32920268036d4eb91361972f52bc8ba | yes | front | http://127.0.0.1:4173/projects | 1280x800 | 150ms/1.6Mbps/750Kbps/4x | 5 | 2208 | 2232 | 0 | 0 | LCP median <= 2500ms; max <= 3125ms; CLS median/max <= 0.05 | npm run measure:vitals | .team/evidence/w5-F1-vitals.json | passed | test-results/frontend/vitals-routes/1791221028441-1926044; normal production dist; strict route interception; one warm-up per target; F iteration1; original producer IDs01–05 retained in raw artifact, normalized to unused06–10 |
| W5-VITALS-20261005-09 | 2026-10-05T17:27:53.133Z | 3b7be596e32920268036d4eb91361972f52bc8ba | yes | back | http://127.0.0.1:4174/ | 1280x800 | 150ms/1.6Mbps/750Kbps/4x | 5 | — | — | 0.003442703247070312 | 0.003442703247070312 | CLS median/max <= 0.1 | npm run measure:vitals | .team/evidence/w5-F1-vitals.json | passed | test-results/frontend/vitals-routes/1791221028441-1926044; normal production dist; strict route interception; one warm-up per target; F iteration1; original producer IDs01–05 retained in raw artifact, normalized to unused06–10 |
| W5-VITALS-20261005-10 | 2026-10-05T17:27:53.133Z | 3b7be596e32920268036d4eb91361972f52bc8ba | yes | admin | http://127.0.0.1:4175/ | 1280x800 | 150ms/1.6Mbps/750Kbps/4x | 5 | — | — | 0.007282745361328125 | 0.007282745361328126 | CLS median/max <= 0.1 | npm run measure:vitals | .team/evidence/w5-F1-vitals.json | passed | test-results/frontend/vitals-routes/1791221028441-1926044; normal production dist; strict route interception; one warm-up per target; F iteration1; original producer IDs01–05 retained in raw artifact, normalized to unused06–10 |

## Mock e2e 與 axe

mock e2e 每次 repetition 一列；W5 前置 suite 是 47 個（W0～W2 的 39＋W3b 的 8），materialize W3／W4 後預期 92 個。axe 摘要記在同次最後一列，預期 60 case、critical／serious 皆 0。

| record id | measured at (UTC) | commit | dirty | repetition | Playwright version | Chromium version | passed / total | axe passed / total | critical | serious | command | artifact | result | notes |
| --- | --- | --- | --- | ---: | --- | --- | --- | --- | ---: | ---: | --- | --- | --- | --- |

| W5-MOCK-20261005-01 | 2026-10-05T16:49:24.973Z | 3b7be596e32920268036d4eb91361972f52bc8ba | yes | 1 | 1.63.0 | Google Chrome for Testing 153.0.8010.12 | 92 / 93 | 60 / 60 | 0 | 0 | npm run e2e:mock | test-results/frontend/mock-1.json | failed | Initial attempt:92/93; deferred W4 memberlink hardcodedversion1 conflicts with approved packagedcurrentversion2. Existing68 journeys pass. E amendment approved; no retries. |

| W5-MOCK-20261005-02 | 2026-10-05T17:29:02.211Z | 3b7be596e32920268036d4eb91361972f52bc8ba | yes | 1 | 1.63.0 | 153.0.8010.12 | 93 / 93 | 60 / 60 | 0 | 0 | npm run e2e:mock | test-results/frontend/mock-final-1-results.json | passed | Final F frozen product source; serial run 1 of3; final axe60 confirmed by CI37349357513 on d84738eb; first2runs began before same source commit; no product changes between runs |

| W5-MOCK-20261005-03 | 2026-10-05T17:33:15.624Z | 3b7be596e32920268036d4eb91361972f52bc8ba | yes | 2 | 1.63.0 | 153.0.8010.12 | 93 / 93 | 60 / 60 | 0 | 0 | npm run e2e:mock | test-results/frontend/mock-final-2-results.json | passed | Final F frozen product source; serial run 2 of3; final axe60 confirmed by CI37349357513 on d84738eb; first2runs began before same source commit; no product changes between runs |

| W5-MOCK-20261005-04 | 2026-10-05T17:37:28.672Z | d84738eb728190494145866bf6b0648305105701 | no | 3 | 1.63.0 | 153.0.8010.12 | 93 / 93 | 60 / 60 | 0 | 0 | npm run e2e:mock | test-results/frontend/mock-final-3-results.json | passed | Final F frozen product source; serial run 3 of3; final axe60 confirmed by CI37349357513 on d84738eb; first2runs began before same source commit; no product changes between runs |

## Visual baseline

一組 Linux Chromium baseline 一列；W5 初始組固定 70 張（52 desktop＋15 mobile＋3 state），hash manifest 必須列出每張 PNG 的 SHA-256。更新既有 baseline 時，備註必須附 UX owner 授權依據。

| record id | measured at (UTC) | commit | dirty | OS | Chromium version | desktop cases | mobile cases | threshold | max diff ratio | hash manifest | command | artifact | result | authorization / notes |
| --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- | --- |

| W5-VISUAL-20261005-01 | 2026-10-05T17:39:14.238Z | 24f40f2734cb5d4c2aff00a367609d28d341b9cb | yes | Ubuntu 24.04.5 LTS | 153.0.8010.12 | 52 | 15 | 0.2 | 0.001 | .team/evidence/w5-canonical-initial-hashes.sha256 | npm run test:visual | .team/evidence/w5-canonical-initial-visual.json | passed | W5 initial canonical CI authoring; owner A–D approved 2026-10-05; Noto TC font aliases resolve to TC face; exact 70 expected baselines; CI37349357513 artifact11361114634 verified70 SHA256; root reviewed all70 in7 contact sheets plus full-size clinic/mobile roles/confirmation; no blocking defect |

| W5-VISUAL-20261005-02 | 2026-10-05T17:50:18.063Z | e9c5b202e37deb758bc756f9d9812ad1038277a5 | no | Ubuntu 24.04.5 LTS | 153.0.8010.12 | 52 | 15 | 0.2 | 0.001 | .team/evidence/w5-canonical-initial-hashes.sha256 | npm run test:visual | .team/evidence/w5-canonical-comparison.json | passed | comparison only; Noto TC font aliases resolve to TC face; exact 70 expected baselines; CI37350721874 comparison70passed; same70baselinehashes; original producerID01 preserved inraw |

## Real API e2e

每個 attempt 都追加；成功與失敗都保留。`stack` 寫 API／PostgreSQL／三 app 的版本或 image，不寫憑證。

| record id | measured at (UTC) | commit | dirty | attempt | OS | JDK | Docker / Compose | stack | passed / total | duration s | command | artifact / redacted logs | result | failure class / notes |
| --- | --- | --- | --- | ---: | --- | --- | --- | --- | --- | ---: | --- | --- | --- | --- |

| W5-REAL-20261005-01 | 2026-10-05T17:42:17.207Z | d84738eb728190494145866bf6b0648305105701 | yes | 1 | linux | openjdk 25.0.4.1 2026-08-18 LTS | 5.6.0 | cms-w5-e2e-1942395-769b7e022bc9d437 | 0 / 14 | 93.557 | npm run e2e | test-results/frontend/real-e2e-logs/001/real-e2e.json | failed | tests; Isolated disposable project; owned cleanup and redacted attempt logs. |

| W5-REAL-20261005-02 | 2026-10-05T17:47:22.833Z | 2b6babf860210cd62cd202fe6b18613bf35c872b | yes | 2 | linux | openjdk 25.0.4.1 2026-08-18 LTS | 5.6.0 | cms-w5-e2e-1946377-913c0c36e39cc6cc | 10 / 14 | 74.867 | npm run e2e | test-results/frontend/real-e2e-logs/002/real-e2e.json | failed | tests; Isolated disposable project; owned cleanup and redacted attempt logs. |

| W5-REAL-20261006-03 | 2026-10-06T12:30:36.752Z | 35bc6634debcdd58643b608ed9704b4db6eeaa6e | yes | 3 | linux | openjdk 25.0.4.1 2026-08-18 LTS | 5.6.0 | cms-w5-e2e-2051694-3e943f0111a67954 | 12 / 14 | 65.744 | npm run e2e | test-results/frontend/real-e2e-logs/003/real-e2e.json | failed | tests; Isolated disposable project; owned cleanup and redacted attempt logs. |

| W5-REAL-20261006-04 | 2026-10-06T12:36:14.423Z | 35bc6634debcdd58643b608ed9704b4db6eeaa6e | yes | 4 | linux | openjdk 25.0.4.1 2026-08-18 LTS | 5.6.0 | cms-w5-e2e-2055853-91e5311cf64123c1 | 14 / 14 | 38.073 | npm run e2e | test-results/frontend/real-e2e-logs/004/real-e2e.json | passed | none; Isolated disposable project; owned cleanup and redacted attempt logs. |

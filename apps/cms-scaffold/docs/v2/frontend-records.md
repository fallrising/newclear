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

## Web Vitals

每個 URL／surface 一列。`runs` 固定為 5，不含一次 warm-up；LCP 用 ms，CLS 無單位。量測必須是正常 `npm run build` 的 production `dist`，資料只由 W5 `e2e-vitals/routes.ts` 的 Playwright route interception 提供；notes 記錄 route log 無 unexpected／missing operation。

| record id | measured at (UTC) | commit | dirty | surface | URL | viewport | network / CPU | runs | median LCP ms | max LCP ms | median CLS | max CLS | limits | command | artifact | result | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | --- | --- |

## Mock e2e 與 axe

mock e2e 每次 repetition 一列；W5 前置 suite 是 47 個（W0～W2 的 39＋W3b 的 8），materialize W3／W4 後預期 92 個。axe 摘要記在同次最後一列，預期 60 case、critical／serious 皆 0。

| record id | measured at (UTC) | commit | dirty | repetition | Playwright version | Chromium version | passed / total | axe passed / total | critical | serious | command | artifact | result | notes |
| --- | --- | --- | --- | ---: | --- | --- | --- | --- | ---: | ---: | --- | --- | --- | --- |

## Visual baseline

一組 Linux Chromium baseline 一列；W5 初始組固定 70 張（52 desktop＋15 mobile＋3 state），hash manifest 必須列出每張 PNG 的 SHA-256。更新既有 baseline 時，備註必須附 UX owner 授權依據。

| record id | measured at (UTC) | commit | dirty | OS | Chromium version | desktop cases | mobile cases | threshold | max diff ratio | hash manifest | command | artifact | result | authorization / notes |
| --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- | --- |

## Real API e2e

每個 attempt 都追加；成功與失敗都保留。`stack` 寫 API／PostgreSQL／三 app 的版本或 image，不寫憑證。

| record id | measured at (UTC) | commit | dirty | attempt | OS | JDK | Docker / Compose | stack | passed / total | duration s | command | artifact / redacted logs | result | failure class / notes |
| --- | --- | --- | --- | ---: | --- | --- | --- | --- | --- | ---: | --- | --- | --- | --- |

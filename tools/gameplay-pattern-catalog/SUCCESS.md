---
project: tools/gameplay-pattern-catalog
purpose: 以可追溯的 Gameplay Atlas 來源快照整理可瀏覽的繁中設計模式筆記
kind: tool
mainline: incomplete
usable_tag: none
reviewed: 2026-11-03
source_commit: 29254932be9e6b11be1dde54e7e273bc30677fe7
---

# Gameplay Pattern Catalog — 驗收入口

## 主線與範圍

第一階段 AC-01 至 AC-04 是 14 篇精選筆記，已合併，不再代表目前範圍。本次主線是快照 `atlas-public-2026-11-02`：來源 manifest 為分母，每條公開機制都有實質筆記。主線仍是 incomplete：Draft PR 尚未合併，也還沒有可用版本標記；而且目前每篇筆記都是 draft，完整度宣告為 `partial`。

source_commit 是撤下模板分析、全部改為 draft 的重寫 commit `29254932be9e6b11be1dde54e7e273bc30677fe7`。接手時的 main 是 `90191b1b81c86c5f044d6caf2511f635ffd4b715`。只補 SHA 的後續 commit 不改變 runtime 或筆記。

## 驗收條件

| ID | Given/When/Then | 狀態 | 證據 |
| --- | --- | --- | --- |
| AC-01 | Given 舊的精選 metadata，When 回讀已合併的 PR #960，Then 14 篇筆記與靜態站的歷史驗收仍可查，但不計入本次全量 | historical | [PR #960](https://github.com/fallrising/newclear/pull/960)；[任務板](docs/tasks/BOARD.md) |
| AC-02 | Given 舊的 14 個來源，When 閱讀當時筆記，Then 歷史上已把摘要與分析分開並附上機制頁 | historical | [驗證紀錄](docs/verification.md) 的 T-0001 節 |
| AC-03 | Given 當時的離線建置，When 回讀 CI，Then 歷史瀏覽器 smoke 曾通過，範圍只有精選集 | historical | [CI run 41426641034](https://github.com/fallrising/newclear/actions/runs/41426641034) |
| AC-04 | Given 當時的 candidate，When 回讀四項 workflow，Then 歷史 repo 檢查曾通過 | historical | 同上 CI；本次不把該結果寫成全量通過 |
| AC-05 | Given 公開 sitemap、index、catalog 與逐頁資料，When 檢查 manifest，Then 沒有重複 canonical ID／URL，分類數量與入口差異有記錄，分母不是筆記篇數。此列即 AC-F01 | passed | [manifest](sources/manifest.json)；[完整度報表](docs/coverage.md)；`inventory.py --check` |
| AC-06 | Given 這份 manifest，When 對到筆記狀態，Then 缺漏會列出 ID，只有 reviewed 計入完成。此列即 AC-F02 | pending | 檢查機制已實作：`build.py --check`、pending／draft／blocked／缺檔負向測試。但目前筆記全為 draft（模型起草、未經人工審閱），reviewed 為 0，[coverage](docs/coverage.md) 逐條列為缺口 |
| AC-07 | Given reviewed 筆記，When 讀文末，Then 機制頁 URL 與 frontmatter 一致，摘要、分析、未驗證原型分開。此列即 AC-F03 | pending | 文末 URL、frontmatter 一致與分節標示由測試檢查；本地分析已逐篇改寫為針對該機制的草稿，但只抽讀 10 篇，尚無 reviewed 筆記 |
| AC-08 | Given schema 2，When 驗證關聯與分類，Then 沒有懸空或自我引用，既有 ID 仍指向原檔。此列即 AC-F04 | passed | 23 項單元測試；`allocation-shop-reservation` 仍用本地 allocation、原站 commerce |
| AC-09 | Given 全量靜態站，When 用真實瀏覽器操作，Then 搜尋、分類、詳情、相關模式、來源、空結果、重設、手機寬度、子路徑與無 JavaScript 導航可用。此列即 AC-F05 | passed | 本機 Chrome 完整 HTTP smoke：子路徑 `/nested/catalog/`、搜尋、分類、空結果、重設、NFKC、詳情、相關模式、來源連結、390px、無 JavaScript。見 [驗證紀錄](docs/verification.md) |
| AC-10 | Given 離線建置，When 重複輸出並餵負向案例，Then 跳脫、危險 URL、輸出目錄保護與狀態轉移檢查會擋下錯誤。此列即 AC-F06 | passed | 單元測試的確定性建置、跳脫、symlink、pending、blocked、search-index |
| AC-11 | Given 本次工作樹，When 執行元件測試與 repo 索引檢查，Then 結果如實保留。此列即 AC-F07 | passed | 本機 25 項測試、browser smoke 與索引檢查；CI head `29254932be9e6b11be1dde54e7e273bc30677fe7` 的 [catalog](https://github.com/fallrising/newclear/actions/runs/41492374618)（25 項測試、建置、完整 browser smoke）、[project success](https://github.com/fallrising/newclear/actions/runs/41492374947)、[llms](https://github.com/fallrising/newclear/actions/runs/41492375549) 皆通過。這只證明檢查通過，不代表筆記已審閱 |

## 現況與缺口

筆記與 manifest 已實作，不是 spec-only。完整度以 manifest 為分母，數字見 [coverage](docs/coverage.md)。

2026-11-03 抽查發現，先前 `sources/write_notes.py` 用固定句型產生新增筆記的分析，並把 `reviewed` 寫死。這不符合「不得模板填充」。已做的修正：

- 新增筆記的「本地分析／本地提案」各節與相關模式理由，逐篇交給模型（pi，OpenCode `deepseek-v4.1-flash`），只依該篇的來源摘要、機制名稱、分類與參數名重寫，再組回原有標題結構。來源摘要、frontmatter 的來源欄位與文末引用保留。
- 先前 14 篇只重寫被模板插入的「核心循環」一節，原本手寫的其他分析不動；`commerce-price-discovery` 被誤當成循環步驟的舊說明已移除。
- 所有筆記改為 `draft`；產生器不再寫 `reviewed`，只會替缺檔條目建立 `pending` 骨架，也不覆寫既有筆記。
- 重複句型檢查、簡體字與占位檢查已跑；人工只抽讀 10 篇並修正其中的數字矛盾。其餘篇章沒有人工逐篇審閱，可能仍有推論過度或原型數字不一致。

因此本次是部分完成：來源盤點與每篇草稿都在，但沒有任何筆記達到 reviewed。尚未合併、部署或打 tag。

## 啟動與驗證

由 [README](README.md) 進入。`python3 build.py --check`、`python3 -m unittest discover -s tests -v`、`python3 build.py`、`python3 sources/inventory.py --check`。瀏覽器測試是 `python3 tests/browser_smoke.py`。建置只用 Python 標準函式庫。

## 可用版本

`usable_tag: none`。未合併，不宣稱已部署或已獨立審查。

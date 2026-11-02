---
project: tools/gameplay-pattern-catalog
purpose: 以可追溯的 Gameplay Atlas 來源快照整理可瀏覽的繁中設計模式筆記
kind: tool
mainline: incomplete
usable_tag: none
reviewed: 2026-11-02
source_commit: cd02ede9355eada6773bd9587fb6d7b46317f58f
---

# Gameplay Pattern Catalog — 驗收入口

## 主線與範圍

第一階段 AC-01 至 AC-04 是 14 篇精選筆記，已合併，不再代表目前範圍。本次主線是快照 `atlas-public-2026-11-02`：來源 manifest 為分母，每條公開機制都有實質筆記。主線仍是 incomplete，因為 Draft PR 尚未合併，也還沒有可用版本標記。

source_commit 是本機驗證通過、且完整度文字已改為繁中的 commit `cd02ede9355eada6773bd9587fb6d7b46317f58f`。接手時的 main 是 `90191b1b81c86c5f044d6caf2511f635ffd4b715`。只補 SHA 的後續 commit 不改變 runtime 或筆記。

## 驗收條件

| ID | Given/When/Then | 狀態 | 證據 |
| --- | --- | --- | --- |
| AC-01 | Given 舊的精選 metadata，When 回讀已合併的 PR #960，Then 14 篇筆記與靜態站的歷史驗收仍可查，但不計入本次全量 | historical | [PR #960](https://github.com/fallrising/newclear/pull/960)；[任務板](docs/tasks/BOARD.md) |
| AC-02 | Given 舊的 14 個來源，When 閱讀當時筆記，Then 歷史上已把摘要與分析分開並附上機制頁 | historical | [驗證紀錄](docs/verification.md) 的 T-0001 節 |
| AC-03 | Given 當時的離線建置，When 回讀 CI，Then 歷史瀏覽器 smoke 曾通過，範圍只有精選集 | historical | [CI run 41426641034](https://github.com/fallrising/newclear/actions/runs/41426641034) |
| AC-04 | Given 當時的 candidate，When 回讀四項 workflow，Then 歷史 repo 檢查曾通過 | historical | 同上 CI；本次不把該結果寫成全量通過 |
| AC-05 | Given 公開 sitemap、index、catalog 與逐頁資料，When 檢查 manifest，Then 沒有重複 canonical ID／URL，分類數量與入口差異有記錄，分母不是筆記篇數。此列即 AC-F01 | passed | [manifest](sources/manifest.json)；[完整度報表](docs/coverage.md)；`inventory.py --check` |
| AC-06 | Given 這份 manifest，When 對到筆記狀態，Then 缺漏會列出 ID，只有 reviewed 計入完成。此列即 AC-F02 | passed | `build.py --check`；pending／blocked／缺檔負向測試 |
| AC-07 | Given reviewed 筆記，When 讀文末，Then 機制頁 URL 與 frontmatter 一致，摘要、分析、未驗證原型分開。此列即 AC-F03 | passed | 來源末節測試；manifest 文字投影雜湊 |
| AC-08 | Given schema 2，When 驗證關聯與分類，Then 沒有懸空或自我引用，既有 ID 仍指向原檔。此列即 AC-F04 | passed | 23 項單元測試；`allocation-shop-reservation` 仍用本地 allocation、原站 commerce |
| AC-09 | Given 全量靜態站，When 用真實瀏覽器操作，Then 搜尋、分類、詳情、相關模式、來源、空結果、重設、手機寬度、子路徑與無 JavaScript 導航可用。此列即 AC-F05 | passed | 本機 Chrome 完整 HTTP smoke：子路徑 `/nested/catalog/`、搜尋、分類、空結果、重設、NFKC、詳情、相關模式、來源連結、390px、無 JavaScript。見 [驗證紀錄](docs/verification.md) |
| AC-10 | Given 離線建置，When 重複輸出並餵負向案例，Then 跳脫、危險 URL、輸出目錄保護與狀態轉移檢查會擋下錯誤。此列即 AC-F06 | passed | 單元測試的確定性建置、跳脫、symlink、pending、blocked、search-index |
| AC-11 | Given 本次工作樹，When 執行元件測試與 repo 索引檢查，Then 結果如實保留。此列即 AC-F07 | passed | 23 項單元測試、`check_project_success.py --write-index` 與 `check_indexes.py` 本機通過。GitHub CI 於 PR 重跑，未在此列提前寫成遠端通過 |

## 現況與缺口

筆記與 manifest 已實作，不是 spec-only。完整度以 manifest 為分母，數字見 [coverage](docs/coverage.md)。本機瀏覽器 HTTP smoke 與 repo 索引檢查已通過。GitHub CI 要等 PR 重跑後才算遠端證據。尚未合併、部署或打 tag。

## 啟動與驗證

由 [README](README.md) 進入。`python3 build.py --check`、`python3 -m unittest discover -s tests -v`、`python3 build.py`、`python3 sources/inventory.py --check`。瀏覽器測試是 `python3 tests/browser_smoke.py`。建置只用 Python 標準函式庫。

## 可用版本

`usable_tag: none`。未合併，不宣稱已部署或已獨立審查。

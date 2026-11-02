---
project: tools/gameplay-pattern-catalog
purpose: 以逐篇來源與結構化 metadata 整理可瀏覽的遊戲設計模式筆記
kind: tool
mainline: incomplete
usable_tag: none
reviewed: 2026-11-02
source_commit: fffc1c84ff94f4d8bdf94e9ecf1705c09e759f32
---

# Gameplay Pattern Catalog — 驗收入口

## 主線與範圍

依 [SDD](SDD.md) AC-01 至 AC-04 交付 14 篇精選 pattern、網站 metadata 指引及可重建靜態網站。source_commit 指已提交的認領／規格基準；本次實作與測試候選由 PR head 及 [驗證紀錄](docs/verification.md) 的檔案雜湊對應，不冒充已驗收 release。

不完整爬取原站 280 篇、不搬運圖片或全文、不做自動同步、帳號、資料庫、模型呼叫或部署。首批 13 篇來源為公開頁面摘錄，價格探索為搜尋索引摘錄。

## 驗收條件

| ID | Given/When/Then | 狀態 | 證據 |
| --- | --- | --- | --- |
| AC-01 | Given 網站 metadata 與筆記，When 執行驗證，Then 必填欄位、唯一 ID、來源日期與 URL、關聯 ID 和末節一致性可檢查 | passed | [欄位與來源驗證](docs/verification.md)；[metadata 指引](METADATA.md) |
| AC-02 | Given 14 個已查閱機制，When 閱讀筆記與產生頁面，Then 來源摘要與本地分析分開，逐篇最後保留實際來源網址 | passed | [14 篇筆記](patterns/README.md)；[驗證紀錄](docs/verification.md) |
| AC-03 | Given 無網路的 Python 環境，When 建置與瀏覽，Then 有相對路徑索引、詳情、搜尋、分類及無 JS 導航 | pending | 建置、HTTP client、Chromium DOM／手機版通過；本機瀏覽器 URL 導航被環境政策封鎖，完整導航須以 CI 結果補驗 |
| AC-04 | Given 本次 candidate，When 執行專案測試與 repo CI，Then 安全性、連結、確定性輸出與 repo 索引契約通過 | pending | 本機 18 項單元測試通過；完整 repo check_indexes 與 CI／審查結果待回讀 |

## 現況與缺口

網站與 14 篇筆記已實作；不是 spec-only，也不是原站全量匯入。瀏覽器 render-only 測試不可代替 URL 導航測試。未合併前任務維持 in_progress；[任務板](docs/tasks/BOARD.md) 不提前填完成時間。

## 啟動與驗證

由 [README](README.md) 的命令進入。`python3 build.py --check`、`python3 -m unittest discover -s tests -v`、`python3 build.py`；完整瀏覽器測試為 `python3 tests/browser_smoke.py`。產物在 dist；build 與 runtime 無第三方依賴，Playwright 僅 QA 使用。

## 可用版本

`usable_tag: none`。這是未合併的 Draft PR 里程碑；不宣稱已部署、已發布、已獨立審查或主線全部驗收。具體驗證與環境限制見 [verification](docs/verification.md)。

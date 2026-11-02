---
project: tools/gameplay-pattern-catalog
purpose: 以逐篇來源與結構化 metadata 整理可瀏覽的遊戲設計模式筆記
kind: tool
mainline: incomplete
usable_tag: none
reviewed: 2026-11-02
source_commit: 46b38c2703d1d5b941fc091ec67df8e0949ad022
---

# Gameplay Pattern Catalog — 驗收入口

## 主線與範圍

依 [SDD](SDD.md) AC-01 至 AC-04 交付 14 篇精選 pattern、網站 metadata 指引及可重建靜態網站。source_commit 是四項 CI 全部成功的候選；後續文件收尾不改 runtime、筆記或測試。實作內容另以 [檔案雜湊](docs/checksums.json) 核對。

這次有界交付的自動驗證已通過；主線仍標 incomplete，因 [Draft PR #960](https://github.com/fallrising/newclear/pull/960) 尚待 owner 審查及合併。CI 成功不等於獨立審查、發布或部署。

不完整爬取原站 280 篇、不搬運圖片或全文、不做自動同步、帳號、資料庫、模型呼叫或部署。首批 13 篇來源為公開頁面摘錄，價格探索為搜尋索引摘錄。

## 驗收條件

| ID | Given/When/Then | 狀態 | 證據 |
| --- | --- | --- | --- |
| AC-01 | Given 網站 metadata 與筆記，When 執行驗證，Then 必填欄位、唯一 ID、來源日期與 URL、關聯 ID 和末節一致性可檢查 | passed | 本機與 CI check／18 項測試；[metadata 指引](METADATA.md) |
| AC-02 | Given 14 個已查閱機制，When 閱讀筆記與產生頁面，Then 來源摘要與本地分析分開，逐篇最後保留實際來源網址 | passed | [14 篇筆記](patterns/README.md)；完整連結與來源末節檢查 |
| AC-03 | Given 無網路的 Python 環境，When 建置與瀏覽，Then 有相對路徑索引、詳情、搜尋、分類及無 JS 導航 | passed | 離線建置、本機 Chromium DOM；CI 完整 HTTP 子路徑導航、搜尋、分類、390px 與 no-JS 通過 |
| AC-04 | Given 本次 candidate，When 執行專案測試與 repo CI，Then 安全性、連結、確定性輸出與 repo 索引契約通過 | passed | [CI run 41426641034](https://github.com/fallrising/newclear/actions/runs/41426641034)：18 tests、53 契約、llms 索引與完整瀏覽器 smoke；其他三項 workflow 也成功 |

## 現況與缺口

網站與 14 篇筆記已實作，不是 spec-only，也不是原站全量匯入。本機瀏覽器 URL 導航受環境政策封鎖；未繞過政策，改在 CI 使用完整 HTTP 導航補驗。失敗與修正過程完整保留在 [驗證紀錄](docs/verification.md)。

仍缺 owner 審查與 merge；未部署、未實玩原遊戲、未全量整理原站。未合併前 [任務板](docs/tasks/BOARD.md) 維持 in_progress，不提前填完成時間。

## 啟動與驗證

由 [README](README.md) 的命令進入。`python3 build.py --check`、`python3 -m unittest discover -s tests -v`、`python3 build.py`；完整瀏覽器測試為 `python3 tests/browser_smoke.py`。產物在 dist；build 與 runtime 無第三方依賴，Playwright 僅 QA 使用。

## 可用版本

`usable_tag: none`。這是未合併的 Draft PR 里程碑；不宣稱已部署、已發布或已獨立審查。各項通過證據與環境限制見 [verification](docs/verification.md)。

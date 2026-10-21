---
project: labs/retro-economy
purpose: 驗證兩種職業與一條短冒險路線能否讓少數真人主動交易並願意再玩
kind: lab
mainline: incomplete
usable_tag: none
reviewed: 2026-10-22
source_commit: cda7571e8d45c9c9f036d8b65e41ad26362f7492
---

# retro-economy 成功契約

## 主線與範圍

主線是 [SDD](docs/SDD.md) 的 MVP（RE-0～RE-3）：一座鎮、兩個採集區、鐵匠與藥師、固定價格掛單與購買、一條塔路，
以及 2–3 位真人 30 分鐘試玩後的繼續／修改／停止決定。
非目標見 SDD §4 與 §10：品質等級、委託與 escrow、經濟模擬、公網與 MMO 規模。

## 本次交付：RE-1

Session `Retro-20261021-1826`；[任務 #454](tasks/454-re1-solo/task.md)。交付單人規則、瀏覽器路線、SQLite 持久化與重啟續玩。驗證規劃：Red/Green 規則／持久化／HTTP 測試、實際瀏覽器路線及重啟、repo 檢查、獨立審查與 CI。RE-2 交易、RE-3 真人驗收保留原範圍，本次不執行。

## 驗收條件

| AC ID | Given／When／Then | 狀態 | 證據或缺口 |
| --- | --- | --- | --- |
| AC-00 | Given SDD RE-0，When 核對一頁配方、數值、地圖與遭遇規則表，Then 每種資源來源與去向完整且規則自洽。 | passed | [規則表](docs/rules.md) 與[RE-0 核對報告](tasks/451-re0-rules/report.md)；只代表文件驗收，非遊戲可玩驗收。 |
| AC-01 | Given 規則表與本機伺服器，When 單人在瀏覽器走完採集→製作→塔路並重啟伺服器，Then 角色、背包與完成紀錄一致。 | pending | 尚未實作（RE-1）。 |
| AC-02 | Given 兩個角色與一筆掛單，When 同 action_id 重送、兩人同時購買、購買與取消競爭，Then 物品與貨幣只變一次且貨幣總額守恆（SDD RE-A03～A07）。 | pending | 尚未實作（RE-2）。 |
| AC-03 | Given 2–3 位真人與 30 分鐘場次，When 試玩完成，Then 至少兩人走完循環、至少一次自發交易、無阻斷缺陷，並留下逐人訪談與決定。 | pending | 尚未試玩（RE-3）。 |

## 現況與缺口

RE-0 的[規則表](docs/rules.md) 已整理配方、初始補給、地圖、遭遇及資源收支，驗證紀錄見[報告](tasks/451-re0-rules/report.md)。只有設計文件；沒有程式、伺服器或試玩紀錄。RE-1～RE-3 與 AC-01～AC-03 仍待交付。

## 啟動與驗證

目前沒有遊戲啟動命令。RE-0 文件檢查：`python3 scripts/check_project_success.py`、`python3 .github/scripts/validate_llms_txt.py`、`git diff --check`（從 repo 根目錄執行）。規則人工核對與實際執行結果見報告；這些檢查不驗證遊戲可玩或平衡。

## 可用版本

`usable_tag: none`。AC-01～AC-03 全部通過並保存試玩紀錄前，不建立 usable tag。

---
project: labs/retro-economy
purpose: 驗證兩種職業與一條短冒險路線能否讓少數真人主動交易並願意再玩
kind: lab
mainline: incomplete
usable_tag: none
reviewed: 2026-10-22
source_commit: 222c1a8a736dbb3ac89f34345a7bc73fa887aba8
---

# retro-economy 成功契約

## 主線與範圍

主線是 [SDD](docs/SDD.md) 的 MVP（RE-0～RE-3）：一座鎮、兩個採集區、鐵匠與藥師、固定價格掛單與購買、一條塔路，
以及 2–3 位真人 30 分鐘試玩後的繼續／修改／停止決定。
非目標見 SDD §4 與 §10：品質等級、委託與 escrow、經濟模擬、公網與 MMO 規模。

## 本次交付：RE-0

Session `Retro-20261021-1808`；[任務 #451](tasks/451-re0-rules/task.md)。只交付一頁規則表並核對資源來源／去向，不縮小 RE-0～RE-3 主線。驗證規劃：規則逐項審查、repo 文件檢查、獨立審查及 CI；不把文件驗收當作可玩驗收。

## 驗收條件

| AC ID | Given／When／Then | 狀態 | 證據或缺口 |
| --- | --- | --- | --- |
| AC-00 | Given SDD RE-0，When 核對一頁配方、數值、地圖與遭遇規則表，Then 每種資源來源與去向完整且規則自洽。 | pending | #451：規則表待交付。 |
| AC-01 | Given 規則表與本機伺服器，When 單人在瀏覽器走完採集→製作→塔路並重啟伺服器，Then 角色、背包與完成紀錄一致。 | pending | 尚未實作（RE-1）。 |
| AC-02 | Given 兩個角色與一筆掛單，When 同 action_id 重送、兩人同時購買、購買與取消競爭，Then 物品與貨幣只變一次且貨幣總額守恆（SDD RE-A03～A07）。 | pending | 尚未實作（RE-2）。 |
| AC-03 | Given 2–3 位真人與 30 分鐘場次，When 試玩完成，Then 至少兩人走完循環、至少一次自發交易、無阻斷缺陷，並留下逐人訪談與決定。 | pending | 尚未試玩（RE-3）。 |

## 現況與缺口

只有設計文件；沒有程式、規則表、伺服器或試玩紀錄。

## 啟動與驗證

目前沒有可啟動的命令。實作後的入口與測試命令寫回本節。

## 可用版本

`usable_tag: none`。AC-01～AC-03 全部通過並保存試玩紀錄前，不建立 usable tag。

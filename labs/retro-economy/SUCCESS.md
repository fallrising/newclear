---
project: labs/retro-economy
purpose: 驗證兩職業的瀏覽器循環、故障恢復與受控策略下補給流通
kind: lab
mainline: incomplete
usable_tag: none
reviewed: 2026-10-22
source_commit: 87b326678f7f9abe768059de1d79029da7f7352c
---

# retro-economy 成功契約

## 主線與範圍

主線是 [SDD](docs/SDD.md) 的 MVP（RE-0～RE-3）：一座鎮、兩個採集區、鐵匠與藥師、固定價格掛單與購買、一條塔路，
以及 owner 於 2026-10-22 明確改定的 RE-3 自動化可玩性驗收。真人動機、趣味與訪談不再是必填門檻，仍標示未驗證；變更依據及精確邊界見 [RE-3 契約](docs/re3-contract.md)。
非目標見 SDD §4 與 §10：品質等級、委託與 escrow、經濟模擬產品、公網與 MMO 規模。RE-3 的標準庫策略僅為驗收工具。

## 本次交付：RE-3

Session `Retro-20261022-1315`；[任務 #481](tasks/481-re3-automated/task.md)。目標為固定瀏覽器流程／恢復、僅依 UI 的 agent 探索、固定 seed 策略及反例。實作前 AC-03 保持 pending；最終證據見同任務 report 與 PR。RE-2 已合併 #476，merge `666e5bd54831d1f7f878339734f3ad994cd6e90d`。

## 驗收條件

| AC ID | Given／When／Then | 狀態 | 證據或缺口 |
| --- | --- | --- | --- |
| AC-00 | Given SDD RE-0，When 核對一頁配方、數值、地圖與遭遇規則表，Then 每種資源來源與去向完整且規則自洽。 | passed | [規則表](docs/rules.md) 與[RE-0 核對報告](tasks/451-re0-rules/report.md)；只代表文件驗收，非遊戲可玩驗收。 |
| AC-01 | Given 規則表與本機伺服器，When 單人在瀏覽器走完採集→製作→塔路並重啟伺服器，Then 角色、背包與完成紀錄一致。 | passed | [RE-1 報告](tasks/454-re1-solo/report.md)：26 backend、11 client 測試；兩職業實際瀏覽器路線、回覆遺失重試與途中／登頂重啟一致。 |
| AC-02 | Given 兩個角色與一筆掛單，When 同 action_id 重送、兩人同時購買、購買與取消競爭，Then 物品與貨幣只變一次且貨幣總額守恆（SDD RE-A03～A07）。 | passed | [RE-2 報告](tasks/475-re2-trading/report.md)：RE-A03～A07，42 backend／18 client；競購、買取消、rollback、重啟及真實瀏覽器交易／第二輪。 |
| AC-03 | Given 真實本機遊戲與隔離角色，When 固定瀏覽器流程、UI-only agent 探索及標準庫策略／反例驗收，Then 保存操作／時間／卡點／截圖／收支證據，無未修阻斷缺陷，明列自動化限制。 | pending | [RE-3 契約](docs/re3-contract.md)；尚待執行。 |

## 現況與缺口

RE-0 的[規則表](docs/rules.md) 已整理配方、初始補給、地圖、遭遇及資源收支，驗證紀錄見[報告](tasks/451-re0-rules/report.md)。RE-1 已加入 Python 標準庫伺服器、SQLite、原生瀏覽器地圖與自動驗收。RE-2 已加入掛單／購買／取消、交易持久化與雙角色第二輪的自動驗證。修訂後 RE-3 自動化驗收及 AC-03 仍待交付；真人試玩未執行。

## 啟動與驗證

`source_commit` 指向 runtime 程式來源；之後的 browser harness／文件修正及最終 head 驗證另見 RE-2 報告與 PR #476。

啟動：`python3 labs/retro-economy/server.py`，開啟 `http://127.0.0.1:8080`；持久化與完整命令見 [README](README.md)。RE-1 自動規則／儲存／HTTP／客戶端／瀏覽器驗證見[報告](tasks/454-re1-solo/report.md)。Repo 文件檢查：`python3 scripts/check_project_success.py`、`python3 .github/scripts/validate_llms_txt.py`、`git diff --check`（從 repo 根目錄執行）。文件檢查本身不驗證遊戲玩法；自動瀏覽器驗收亦不代表真人體驗或平衡通過。

## 可用版本

`usable_tag: none`。owner 本次禁止建立 tag；即使修訂後 AC-03 通過，也不建立或宣稱已有 usable tag。

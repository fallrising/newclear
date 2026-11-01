---
project: labs/bee-swarm
purpose: 保存以 GitHub 角色協作及 SimPy 探索流程的概念框架
kind: archived
mainline: not-applicable
usable_tag: none
reviewed: 2026-10-21
source_commit: b97319d74f8442b5173ef42be72a0aa757d87df0
---

# bee-swarm 成功契約

## 主線與範圍

[README](README.md) 定義概念設計與模擬框架，並已列Tier D retired。
保存角色prompt、GitHub異步工作流設計、教育遊戲案例與模擬程式是結束條件。
模擬可探索流程與瓶頸，不證明真實agent協作效率、成本或服務可用率。
不恢復部署、不新增模型呼叫、不把歷史README的效益數字當作實測產品SLO。
封存不等同「自治AI團隊平台已交付」。

## 驗收條件

passed 僅表示本次已核對的靜態條件；historical 表示具日期的既有結果。
沒有 runtime 重跑的項目不以文件檢查代替；pending／failed 保留原缺口。

| AC ID | Given／When／Then | 狀態 | 證據或缺口 |
| --- | --- | --- | --- |
| AC-01 | Given 歷史協作設計，When 由入口查找，Then 角色、流程及教育遊戲模擬來源可定位。 | passed | [PROJECT_INDEX](PROJECT_INDEX.md)、[roles](roles/README.md)、[模擬指南](docs/education-game-project/09-process-simulation/unified-simulation-guide.md)。 |
| AC-02 | Given 模擬腳本與效益數字，When 判讀結果，Then 將SimPy假設與真實provider／GitHub工作流證據分開。 | passed | [README定位](README.md)、[歷史quick start](QUICK_START.md)；本次只確認文件邊界。 |
| AC-03 | Given 真實多人agent工作流，When 經需求、實作、審查及交付，Then 可重現協作效益並有可追溯操作紀錄。 | pending | 未提供支撐歷史73%／127%／99.8%等宣稱的當前實測；封存不補做。 |

## 現況與缺口

[模擬目錄](docs/education-game-project/09-process-simulation/) 具有Python模擬程式。
角色設計及GitHub流程是研究素材，不是已啟用的派工控制面。
QUICK_START含容器、Gemini與模擬多條歷史路徑，依賴及外部設定未重驗。
既有模擬輸出若引用，必須說明參數、假設與合成性質。
本次保留中英文文件及原案例，不改寫舊數字為驗收成功。

模擬輸出不計為真實provider請求或團隊交付次數。
若引用ROI數字，須另有實驗基線與計算方法，不能以範例值補足證據。

## 啟動與驗證

閱讀入口是 [README](README.md)、[QUICK_START](QUICK_START.md) 與角色說明。
具體模擬入口保存為
[bee-swarm-unified-simulation.py](docs/education-game-project/09-process-simulation/bee-swarm-unified-simulation.py)。
執行前須按原指南核對SimPy等依賴；本次未跑模擬、容器或模型provider。
不從已封存指南自動安裝工具、設定GitHub secrets或重啟工作流。

本次只核對文件、入口與證據，未執行產品建置、服務或外部整合。
歷史結果的範圍、來源與未執行項均須隨交接保留。

## 可用版本

目前 `usable_tag: none`。
歷史研究與模擬素材不建立產品可用標記。
若另開驗證里程碑，須先選定模擬或真實協作目標，再留下可重現輸入／輸出和效果證據。

後續標記須綁已合併的目標 SHA、必要 CI／審查及該範圍核心流程證據。
沿用歷史結果前須比較其後程式與設定差異，相關改動要補驗。

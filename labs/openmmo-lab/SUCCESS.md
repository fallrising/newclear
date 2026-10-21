---
project: labs/openmmo-lab
purpose: 建立固定 OpenMMO 的本機雙人世界與持久化試驗入口
kind: lab
mainline: incomplete
usable_tag: none
reviewed: 2026-10-21
source_commit: b97319d74f8442b5173ef42be72a0aa757d87df0
---

# openmmo-lab 成功契約

## 主線與範圍

[SDD](docs/SDD.md) P0要求兩個真人角色進同一世界，驗證移動、戰鬥、交易、重啟與復原。
repo僅保存lab工具、pin與runbook；上游與素材保留外部checkout及各自授權。
P0僅terrain-init、server、client，host只開loopback18080；不啟用agent／LLM／公網。
後續agent、小功能及upstream PR均在世界基準通過後另開階段。
工具準備完成不代表已可玩的遊戲發行版。

## 驗收條件

passed 僅表示本次已核對的靜態條件；historical 是已有紀錄，並非本次重跑。
產品未驗項與後續失敗均保留；文件格式通過不能代替runtime驗收。

| AC ID | Given／When／Then | 狀態 | 證據或缺口 |
| --- | --- | --- | --- |
| AC-01 | Given 固定upstream與獨立乾淨checkout，When check／render，Then pin、資產lock及設定產生符合防覆寫條件。 | historical | [2026-10-04驗收](docs/acceptance.md)：8個工具tests、真固定checkout render通過。 |
| AC-02 | Given 完整資產與Google Web client ID，When doctor及build/up，Then terrain初始化、server健康與client HTTP可達。 | pending | [驗收](docs/acceptance.md)：歷史doctor exit2，Docker/Compose與client ID缺失，283個資產缺少或不符。 |
| AC-03 | Given 兩個真人Google帳號，When 移動／戰鬥／交易及取消，Then 兩端權威狀態一致且物品數量守恆。 | pending | [P0 gameplay gate](docs/acceptance.md) 全部pending；未啟動遊戲。 |
| AC-04 | Given 角色／背包及交易結果，When down/up與隔離備份還原，Then 資料保持且原世界不受修改。 | pending | [持久化與復原gate](docs/acceptance.md) 無實測；up退出0不能取代。 |

## 現況與缺口

P0準備工具與Git fixture有證據，真上游render也已做過。
沒有Docker build、terrain生成、Google登入或WebGPU遊戲旅程證據。
Google登入由本人執行，工具不代管帳號或代簽CLA。
資料使用分離named volumes；停機不應意外丟世界。
外部OpenMMO為PolyForm Noncommercial，repo MIT不替它或素材重新授權。

隔離還原必須使用另一workspace／port並核對原世界不變。

## 啟動與驗證

依 [quickstart](docs/quickstart.md) 分批準備外部checkout、workspace及資產。
[lab.py](lab.py) 提供 `python3 lab.py check` 及render／doctor／up／down／status。
完整各子命令參數以quickstart為準，不以無參數up當作可直接啟動。
工具離線檢查：`python3 -m unittest discover -s tests -v`。
執行gameplay前須記source SHA、image IDs、資產revision、帳號匿名代號與資料保留方式。

本次只核對文件、程式入口與既有證據；未執行產品建置或外部整合。
歷史命令與結果保留原來源，不以文件盤點日期覆蓋實測日期。

## 可用版本

目前 `usable_tag: none`。
必須補環境／build、雙人世界、戰鬥、交易、重啟持久化與隔離復原六層證據。
現有P0準備工具不構成整個可玩lab的可用標記。

標記前須核對已合併目標SHA、必要CI／審查與核心流程證據。
沿用較早結果須比較其後程式及設定差異，相關變更必須補驗。

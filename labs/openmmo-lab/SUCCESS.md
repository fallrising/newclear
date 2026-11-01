---
project: labs/openmmo-lab
purpose: 建立固定 OpenMMO 的本機雙人世界與持久化試驗入口
kind: lab
mainline: incomplete
usable_tag: none
reviewed: 2026-10-23
source_commit: b7f2a4311d1135977ba273efba8e77702b908036
---

# openmmo-lab 成功契約

## 主線與範圍

2026-10-23 owner 啟用 START_DEVELOPMENT_PROMPT，恢復完整 P0 主線。
本次依 AC-01 pin/render → AC-02 合法資產、真 Docker build/terrain/server/client →
AC-03 真人雙人流程 → AC-04 保存及隔離復原順序執行；既有 AC 不縮減。
驗證先重跑工具測試，再核對真固定 checkout、doctor、build 與 runtime，真人登入缺項獨立記錄。
工作狀態唯一入口為 [任務板](docs/tasks/BOARD.md)。未提交、未合併，不建立 usable tag。

[SDD](docs/SDD.md) P0要求兩個真人角色進同一世界，驗證移動、戰鬥、交易、重啟與復原。
repo僅保存lab工具、pin與runbook；上游與素材保留外部checkout及各自授權。
P0僅terrain-init、server、client，host只開loopback18080；不啟用agent／LLM／公網。
後續agent、小功能及upstream PR均在世界基準通過後另開階段。
工具準備完成不代表已可玩的遊戲發行版。

## 驗收條件

passed 僅表示該列明確證據範圍已通過；historical 是已有紀錄，並非本次重跑。
產品未驗項與後續失敗均保留；文件格式通過不能代替runtime驗收。

| AC ID | Given／When／Then | 狀態 | 證據或缺口 |
| --- | --- | --- | --- |
| AC-01 | Given 固定upstream與獨立乾淨checkout，When check／render，Then pin、資產lock及設定產生符合防覆寫條件。 | passed | [2026-10-23驗收](docs/acceptance.md)：真固定 clean checkout 的 check/render 通過；10 個工具 tests 與獨立審查通過。 |
| AC-02 | Given 完整資產與Google Web client ID，When doctor及build/up，Then terrain初始化、server健康與client HTTP可達。 | pending | [本次實測](docs/acceptance.md)：Docker 可用、283 assets checksum、server/client image builds、4096 tiles/manifests 初始化與 terrain reentry 通過。doctor 仍 exit 2：只缺 Google client ID；資產授權資料仍有指定缺口。未驗 server/client runtime。 |
| AC-03 | Given 兩個真人Google帳號，When 移動／戰鬥／交易及取消，Then 兩端權威狀態一致且物品數量守恆。 | pending | [P0 gameplay gate](docs/acceptance.md) 全部pending；未啟動遊戲。 |
| AC-04 | Given 角色／背包及交易結果，When down/up與隔離備份還原，Then 資料保持且原世界不受修改。 | pending | [持久化與復原gate](docs/acceptance.md) 無實測；up退出0不能取代。 |

## 現況與缺口

P0準備工具與真上游render已於本次重驗；OAuth 格式檢查已補 RED/GREEN 回歸與獨立審查。
本次已有固定 source 的 Docker server/client builds、資產 checksum 與真 terrain 生成／重入證據。
尚無完整 Compose up、Google 登入或 WebGPU 遊戲旅程證據；精確缺項為真 Web OAuth client 設定、
兩個真人測試帳號／瀏覽器，以及驗收紀錄列出的資產來源授權資料。
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

本次執行範圍、版本、命令、日誌與未跑原因見 [驗收紀錄](docs/acceptance.md)。
server/client build、單獨 terrain 初始化與完整 Compose 啟動分開記錄；不推定 AC-03/04 通過。
歷史命令與結果保留原來源，不以文件盤點日期覆蓋實測日期。

## 可用版本

目前 `usable_tag: none`。
已取得 build/terrain 層證據；仍須補完整環境啟動、合法資產資料、雙人世界、戰鬥、交易、角色重啟持久化與隔離復原證據。
現有P0準備工具不構成整個可玩lab的可用標記。

標記前須核對已合併目標SHA、必要CI／審查與核心流程證據。
沿用較早結果須比較其後程式及設定差異，相關變更必須補驗。

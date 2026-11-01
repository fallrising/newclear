---
project: labs/zircon-godot
purpose: 研究並規劃 Zircon C# 伺服器與 Godot 客戶端的有界遊戲實驗
kind: lab
mainline: incomplete
usable_tag: none
reviewed: 2026-10-23
source_commit: b7f2a4311d1135977ba273efba8e77702b908036
---

# zircon-godot 成功契約

## 本次開發（2026-10-23）

Owner 已啟用 START_DEVELOPMENT_PROMPT.md，恢復 P0–P4 主線。先核對固定上游與 SDK、合法外置資源及 consumer 路徑，再建置 server/client。AC 與桌面目標維持不變。行為工具採先失敗後通過的測試；建置、登入／移動／戰鬥、正常保存與規則 revert 分開留證。缺素材時持續可獨立執行的建置／協定工作，不將 fixture 或 headless 當作桌面驗收。

進度唯一入口：[任務板](docs/tasks/BOARD.md)。

## 主線與範圍

[SDD](docs/sdd/README.md) 目標是可重建環境、登入選角、權威移動校正、
戰鬥／掉落／拾取、正常存檔還原，以及一個可撤回規則修改。
2026-10-23 已恢復開發，固定來源建置與 host shutdown 測試完成；P0–P4 runtime 尚未完成，不能稱可玩版本。
一台本機server、一個client、一張地圖、一個角色是初始邊界。
不重寫引擎、不做完整MMORPG／商城／公開營運／分片，也不以Web原型取代桌面目標。

## 驗收條件

passed 僅表示本次已核對的靜態條件；historical 是已有紀錄，並非本次重跑。
產品未驗項與後續失敗均保留；文件格式通過不能代替runtime驗收。

| AC ID | Given／When／Then | 狀態 | 證據或缺口 |
| --- | --- | --- | --- |
| AC-01 | Given 固定e383d4a來源，When 查研究manifest，Then 41個取得檔案有path/blobSHA/閱讀範圍且來源類型分清。 | passed | 本次 build runner 重新比對固定 git tree 的 41 個 blob SHA；[本次證據](docs/development-20261023.md)、[sources.json](sources.json)。 |
| AC-02 | Given 核對過的SDK與合法資源，When build ServerCore/GodotClient並啟動，Then 0errors及預期loopback連線。 | pending | **partial**： ServerCore 0 warnings/0 errors；GodotClient 6 warnings/0 errors。SDK／engine 已具備；缺合法素材與圖形會話，未連線遊戲。[證據](docs/development-20261023.md)。 |
| AC-03 | Given 登入角色，When 合法／非法移動、戰鬥、掉落及拾取，Then server權威位置與物品變更一致。 | pending | **blocked**： 缺素材與可登入世界，未跑合法／非法移動、戰鬥／掉落拾取。GroundLootChecks 只涵蓋舊 client，不算 Godot E2E。 |
| AC-04 | Given 固定來源與狀態副本，When 正常停啟及一個規則修改/revert，Then 保存狀態可核對且原切片回歸。 | pending | **partial**： host Ctrl-C／stdin 卡住已以隔離測試 RED→GREEN 並附 patch；真實 Users.db 正常保存、玩法規則修改／revert 仍未跑。 |

## 現況與缺口

本目錄有研究／SDD、固定來源清單、原創 build/editor 工具及 host shutdown regression patch。完整上游與素材保持 repo 外置。
研究讀取範圍不是全部code audit；上游玩法與商業成熟度聲稱不作本lab證據。
固定專案需要 .NET 10、Godot.NET.Sdk 4.6.3。本次工具鏈為 .NET SDK 10.0.402／runtime 10.0.13，Godot 4.6.3.stable.mono.official.7d41c59c4。
上游GroundLootChecks連結舊client，不能代替Godot E2E。
BotRunner的1–20限制也不是最大容量實測。
資料庫、地圖、圖庫與binary各自路徑必須明確，不能假設單一環境變數可解決。

## 啟動與驗證

[quickstart](docs/quickstart.md) 提供P0環境／資源盤點與分階段路線。
quickstart 現在提供已驗證的 build 與 host 測試入口；遊戲 start 仍須補合法素材和 resolved paths。
本次已核對 consumer 路徑規則；資源實際路徑／hash／權利來源未提供，因此不能宣告 P0 完成。
上游binary、Users.db、System.db與素材保持外置；使用隔離資料副本。
正常shutdown／重啟存檔驗收與force-kill恢復須分別設計。

本次實際命令、版本、失敗紀錄與範圍見 [開發證據](docs/development-20261023.md)。本階段獨立 review T-978 已通過；owner 已授權 commit／PR／合併，CI／合併結果將記於任務板，未部署。
歷史命令與結果保留原來源，不以文件盤點日期覆蓋實測日期。

## 可用版本

目前 `usable_tag: none`。
須完成SDD P0–P4的環境、build、最小遊戲、玩法、保存還原與可撤回修改證據。
研究文件完成不足以建立遊戲lab的可用版本標記。

標記前須核對已合併目標SHA、必要CI／審查與核心流程證據。
沿用較早結果須比較其後程式及設定差異，相關變更必須補驗。

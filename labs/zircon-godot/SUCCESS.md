---
project: labs/zircon-godot
purpose: 研究並規劃 Zircon C# 伺服器與 Godot 客戶端的有界遊戲實驗
kind: lab
mainline: incomplete
usable_tag: none
reviewed: 2026-10-21
source_commit: b97319d74f8442b5173ef42be72a0aa757d87df0
---

# zircon-godot 成功契約

## 主線與範圍

[SDD](docs/sdd/README.md) 目標是可重建環境、登入選角、權威移動校正、
戰鬥／掉落／拾取、正常存檔還原，以及一個可撤回規則修改。
本輪已有研究與設計交付；P0–P4 runtime尚未完成，不能稱可玩版本。
一台本機server、一個client、一張地圖、一個角色是初始邊界。
不重寫引擎、不做完整MMORPG／商城／公開營運／分片，也不以Web原型取代桌面目標。

## 驗收條件

passed 僅表示本次已核對的靜態條件；historical 是已有紀錄，並非本次重跑。
產品未驗項與後續失敗均保留；文件格式通過不能代替runtime驗收。

| AC ID | Given／When／Then | 狀態 | 證據或缺口 |
| --- | --- | --- | --- |
| AC-01 | Given 固定e383d4a來源，When 查研究manifest，Then 41個取得檔案有path/blobSHA/閱讀範圍且來源類型分清。 | historical | [2026-10-04 evidence](docs/evidence.md)、[sources.json](sources.json)：靜態來源／連結檢查。 |
| AC-02 | Given 核對過的SDK與合法資源，When build ServerCore/GodotClient並啟動，Then 0errors及預期loopback連線。 | pending | [evidence](docs/evidence.md)：缺dotnet/godot；沒有runtime，未取得完整素材。 |
| AC-03 | Given 登入角色，When 合法／非法移動、戰鬥、掉落及拾取，Then server權威位置與物品變更一致。 | pending | [SDD P2/P3](docs/sdd/README.md) 是後續驗收，無遊戲啟動或日誌。 |
| AC-04 | Given 固定來源與狀態副本，When 正常停啟及一個規則修改/revert，Then 保存狀態可核對且原切片回歸。 | pending | [SDD C3/P4](docs/sdd/README.md) 無實測；launcher kill不代表正常保存。 |

## 現況與缺口

本目錄只有研究、SDD與來源清單，沒有匯入上游程式、資產或新runtime adapter。
研究讀取範圍不是全部code audit；上游玩法與商業成熟度聲稱不作本lab證據。
固定專案需要.NET10、Godot.NET.Sdk4.6.3，不能泛稱裝任意Godot4即能跑。
上游GroundLootChecks連結舊client，不能代替Godot E2E。
BotRunner的1–20限制也不是最大容量實測。
資料庫、地圖、圖庫與binary各自路徑必須明確，不能假設單一環境變數可解決。

## 啟動與驗證

[quickstart](docs/quickstart.md) 提供P0環境／資源盤點與分階段路線。
這裡沒有可直接執行的遊戲命令，不提供假造的一鍵啟動。
先準備外部固定checkout、SDK、合法素材及resolved path清單，再定義build/start證據。
上游binary、Users.db、System.db與素材保持外置；使用隔離資料副本。
正常shutdown／重啟存檔驗收與force-kill恢復須分別設計。

本次只核對文件、程式入口與既有證據；未執行產品建置或外部整合。
歷史命令與結果保留原來源，不以文件盤點日期覆蓋實測日期。

## 可用版本

目前 `usable_tag: none`。
須完成SDD P0–P4的環境、build、最小遊戲、玩法、保存還原與可撤回修改證據。
研究文件完成不足以建立遊戲lab的可用版本標記。

標記前須核對已合併目標SHA、必要CI／審查與核心流程證據。
沿用較早結果須比較其後程式及設定差異，相關變更必須補驗。

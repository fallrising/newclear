# SDD：Zircon-Godot 有界學習實驗

狀態：Draft；本輪交付設計，不宣告 runtime 已可用。來源基準見 [sources.json](../../sources.json)。

## 目標與非目標

目標是讓一位熟悉後端、尚未建立遊戲工程全貌的開發者，能在隔離環境重現一個遊戲操作，知道每一層為何這樣設計，再提交一個有回歸證據的小修改。

成功條件：能重建來源與內容基準；本地登入一個角色；移動及非法移動校正；完成單次戰鬥／掉落／拾取；正常停止再啟動後確認指定狀態保存；一個規則修改可以撤回。以上都是後續階段驗收，不是本輪完成聲明。

非目標：完整重製傳奇 3、公開營運、商城／支付、反作弊完備性、MMO 壓測、Web 發行、引擎替換、把歷史 server 拆成微服務。與其他遊戲實驗保持獨立，不共用帳號／世界狀態或假設協定互通。

## 決策

| ID | 決策 | 理由／代價 |
| --- | --- | --- |
| D1 | newclear 保存第一方研究、設計與後續實驗記錄；上游 checkout 外置 | 避免帶入大量歷史、素材與未釐清的授權；需鎖 SHA |
| D2 | 先驗證 headless server + Godot desktop | 這是上游明確入口，避開 Windows 編輯器與 Web 額外變數 |
| D3 | 基線階段 client/server 同 SHA、同內容集 | 反射封包 ID／屬性與定義索引耦合 |
| D4 | 先單機手動啟動 server，顯式指定 client endpoint | 避開 auto launcher 的滿級測試資料注入、bot 啟動與強制 kill 干擾 |
| D5 | 建置、可玩、存檔、畫面一致分開驗收 | build 成功不能取代行為或持久化證據 |

## 組件與責任

現階段沒有新增 runtime adapter。後續必要時才實作以下最小工具，名稱是設計角色，不表示檔案已存在。

| 組件 | 輸入 | 輸出／責任 | 不負責 |
| --- | --- | --- | --- |
| 基準記錄 | 上游 SHA、SDK／OS、資源清單 | 記錄可重建條件、版本差異 | 自動下載遊戲素材 |
| 環境 preflight | 本機外置路徑、可用工具 | 缺依賴與路徑解析結果 | 修改原始資源或啟動服務 |
| 手動執行入口 | Server.ini、資料副本、固定 binaries | 明確 PID、endpoint、日誌、停止方式 | 改防火牆／公開網路 |
| 行為驗證 | 場景前置條件、輸入序列 | client/server 關聯證據、pass/fail | 以 bot 數量代替容量結論 |
| 還原入口 | 實驗前資料副本、固定 SHA | 還原後重新跑同一切片 | 對正式玩家資料遷移 |

## 契約

### C1：來源與執行內容

`sources.json` 是本輪研究來源清單，包含 repo、40 字 SHA、日期、每個實際取得檔案的 blob SHA 與閱讀範圍。未讀檔案不標為已審查。

後續每次執行另記錄 `run_id`、`source_sha`、`os`、`dotnet_version`、`godot_version`、client/server binaries hash、`asset_set_id`、System.db／地圖／圖庫 hashes、endpoint、起止時間。資料內容或本機絕對路徑含敏感資訊時，公開記錄只保留代號與 hash；完整原始資源不提交。

資源角色必須分開：server 的 `Database/`、server `MapPath`、client 的 `Data/System.db`、圖庫／音訊／地圖位置、`ClientData` JSON。不能只設定一個環境變數就假設所有讀取器皆使用它。P0 必須按實際 consumer 記錄 resolved path。

### C2：wire 與動作

沿用上游 frame／Packet 表，不自行加 opcode。初期不改 Packet class、欄位順序、enum 或資料身份。日後若要改，必須附舊新兩端的相容性決定與序列化 roundtrip／固定 bytes 測試。

移動的輸入是方向及距離意圖；server 驗證目前狀態與規則。期望輸出為權威位置／物件更新，或拒絕後的位置校正。客戶端本地預測不得視為規則驗收。測試非法距離只在本機自有測試 server。

負向驗收至少包含：登入前送遊戲操作、越界方向、距離不合法、被障礙拒絕、斷線後重連不沿用半包、未知 packet ID／壞長度被有界拒絕。後兩項屬後續新增測試設計；本輪不宣稱上游完整覆蓋。

### C3：持久化與還原

System 定義與 Users 狀態使用 MirDB，不以 SQLite 工具修改。實驗前停止 server 並複製資料；保存 source／資料版本配對。不得同時啟動兩個 server 寫同一 Users.db。

基線以正常 shutdown 驗證落盤；記錄指定角色、地圖位置、道具數量的前後值。強制 kill 與崩潰恢復是獨立實驗，不能將 launcher 的 kill 當作保存成功。修改失敗時停服務、還原備份與原 SHA、重跑登入／移動／存檔切片。

### C4：驗收證據

每個案例記錄：case ID、前置資料、操作、期望、實際、結果 `pass|fail|blocked|skipped`、來源與資源版本、client/server 日誌範圍、必要畫面、下一個可判定的問題。缺依賴標 blocked；尚未執行標 skipped，不填 pass。

畫面證據以相同地圖／座標、視窗解析度、圖庫版本、技能與時間點比較。登入與存檔日誌移除帳密、真實帳號及 DB key。僅對需要判斷的欄位留證，不整包公開 Users.db。

## 階段與驗收

| 階段 | 產出與驗收 | 停止條件 |
| --- | --- | --- |
| P0 基線 | 工具版本、來源 SHA、必要資源與權利來源、所有 resolved paths；缺項清楚列出 | 必要資料缺失／來源不明，不聲稱可跑 |
| P1 建置與啟動 | ServerCore 與 GodotClient 0 errors；記 warnings；server 預期 loopback endpoint，無非預期對外服務 | SDK／素材／路徑錯，逐項排除 |
| P2 最小遊戲切片 | 登入、選角、進一張地圖、合法移動、撞牆校正；正常停止／重啟後核對位置 | 先定位 network、definition、world、render 哪段失敗 |
| P3 一個玩法 | 在基線內容中完成攻擊、扣血、掉落、拾取；必要時第二個測試 client 確認相同狀態 | 缺特定內容時換已知 fixture，不擴張成內容製作 |
| P4 最小修改 | 一個既有規則的前後對照、原切片回歸、revert 後恢復；整理可向上游提交的 diff | 改動牽涉新協定／存檔 schema 時另設計，不硬塞 |

每階段只處理一個主要未知。建議 P2 開始先不啟用自動滿級、bot 或其它內容注入，以免測到不同初始條件。

## 依賴、風險與可觀測性

- 固定專案檔要求 .NET 10、`Godot.NET.Sdk/4.6.3`、`BCnEncoder.NET/2.3.0`；這是來源要求，不是本環境已安裝的保證。
- 上游 README 的開發者絕對路徑與外部 launcher 不是通用安裝契約；quickstart 提供準備方法，不複製該機器設定。
- `ServerCore` Debug 預設輸出在 repo 外部相對路徑；P1 顯式選擇 output，核對資料庫基於 binary directory 與地圖／config 路徑的差異。
- Godot GameScene、Server PlayerObject 都是大檔案；以具體 method／事件追蹤，先不做大规模重構。
- 開始只觀察 PID、來源版本、連線階段、map/object ID、權威座標、拒絕原因、保存／結束結果；性能數據晚於正確性。
- 不用歷史圖像 benchmark 或 20 bots 上限推導 MMO 併發能力；容量、長時間記憶體與網路威脅模型另列後續研究。

## 本輪完成定義

README、研究筆記、本 SDD、明示 skipped 的 quickstart、固定來源清單、相對連結與來源檢查、Draft PR。後續 P0–P4 均尚未執行；詳見[驗證紀錄](../evidence.md)。

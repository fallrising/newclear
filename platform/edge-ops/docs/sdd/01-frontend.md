# 01 — Frontend SDD

狀態：proposed，無前端實作。共用契約見 [05](05-contracts-and-security.md)，驗收見 [06](06-delivery-and-acceptance.md)。

## 1. 使用流程與資訊架構

登入 → workspace → 主機列表 → 主機詳情。故障調查由 metrics 的同一時間區間轉到 logs，再到經批准的操作；不可把查看 log 與執行命令混成同一個終端畫面。

| 路由（規劃） | 內容 | 權限／空狀態 |
| --- | --- | --- |
| `/fleet` | 清單／卡片、tags、OS、Agent 版本、CPU／RAM、最後收到時間、健康 | viewer；未加入節點時引導 enrollment |
| `/nodes/:id` | Overview、Metrics、Logs、Jobs、Inventory、Audit tabs | 各 tab 分別授權；unsupported 清楚標記 |
| `/enrollments` | 建立一次性註冊、有效期、撤銷、fingerprint 確認 | node-admin；不提供全機共用 secret |
| `/recipes` | 固定版本、腳本摘要、參數 schema、diff、平台要求、權限 | operator 建候選，不等於批准執行 |
| `/jobs/:id` | 目標快照、批准 digest、逐機狀態、結果、輸出截斷／未知 | operator／approver 分責；P0 不出現可用操作入口 |
| `/alerts` | 離線、恢復、負載、維護期、cooldown、通知狀態 | viewer／operator 各有邊界 |
| `/settings` | 成員、角色、配額、保留期、notification channel | admin；secrets 只有是否設定／版本，不回顯 |

手機版優先展示主機名稱、健康、新鮮度與主要瓶頸；桌面使用可排序 table。第一版不依賴地圖，因定位與真實拓樸不一定有診斷價值。

## 2. 資料狀態

分開显示 `connectivity`、`health`、`init_state`、`execution_mode`。一台機器可 online 但 unhealthy，或 online 但初始化失敗；不能只用一個綠燈代表一切。

全頁狀態至少包含 loading、empty、partial、stale、offline、forbidden、rate-limited、control-plane-unavailable、unsupported。每個圖表帶 UTC 資料範圍、最後 observed／received 時間、單位及缺口。時區只改顯示，不修改 API timestamp。

DO WebSocket 發送 invalidation／版本提示；前端重新讀取有權限的 snapshot。重連不假定收到所有事件；epoch 改變、event gap 或心跳失效就 refetch。收到 revoke／session expiry 立即關閉訂閱及清理敏感 cache。WS 不可用時可退回受配額約束的低頻 HTTP refresh，並顯示 degraded。

日誌由後端 cursor 分頁、可停止追尾、有硬上限；不載入整個 R2 物件。缺頁、丟棄、redacted、truncated、rotation 均可見。內容作純文字轉義，禁止 HTML、ANSI／OSC hyperlink 執行；搜尋條件不能變成任意檔案路径。

## 3. 操作與初始化 UX

建立任務時順序固定：選定 recipe/version → 驗證參數 → 選定並凍結目標 node/generation → 顯示 precheck、預期 postcondition、run-as、timeout、重啟／危險操作提示 → 產生不可變 manifest → 等待外部可信 CLI 核對並簽署 → 提交 approval → dispatch。

普通 Web 確認對話不是獨立簽署。UI 可下載待簽資料，但 CLI 必須自己顯示完整參數、腳本來源／hash、目標與權限供 operator 核對，不能盲簽 browser 給的 hash。簽署後改一個參數也必須建立新候選。

P1b 初版只允許單機；批次 canary／分波 rollout 後續才開啟。任何 unknown／failed postcondition 停止後續擴散。取消有 `cancel_requested` 與最終停止證據兩個時間點；重啟掉線不直接顯示成功。

初始化頁採階段時間線：allocated → bootstrap pending → enrolled → checks → applying → reboot pending（如需要）→ postchecks → ready／failed／unknown。`terraform apply` 成功僅顯示資源已建立，不直接把 node 設成 ready。

## 4. 前端工程邊界

採 React、TypeScript、Vite；路由、server-state cache、schema validation 各選一套既有庫，M0 鎖版本。目錄規劃為 `web/src/features/{fleet,nodes,logs,jobs,enrollment,settings}`、`web/src/api/`、`web/src/components/`；共用契約由 `contracts/` 生成或驗證，禁止複製後端領域規則。

具 `demo`／`live` 明確模式；live API 失敗不得悄悄 fallback 到 fixtures。前端不持有 agent secret、approval 私鑰或 Cloudflare API token。所有授權後端重驗；隱藏按鈕不是授權機制。

## 5. 驗收目標

AC-UI-01：窄螢幕與桌面均可辨識 stale、offline、unknown、unsupported，而非只靠顏色。

AC-UI-02：斷網／WS 重連後 snapshot 可收斂；沒有把漏掉的事件假裝重播完成。

AC-UI-03：viewer 無法透過直接 API 或深連結讀取未授權 logs／建立 job；revocation 清理 cache。

AC-UI-04：scripts/logs 中的 HTML、ANSI、控制字元與惡意長字串不執行，不拖垮頁面。

AC-UI-05：任務完成、逾時、失聯、取消請求、已證實停止清楚分別顯示；approval 綁定內容可追溯。

測試包含 schema fixtures、component tests、Playwright journeys、keyboard navigation、手機 viewport。這些為待執行驗收，不是本次交付的測試結果。

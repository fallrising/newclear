# Virtual Office Lab — 公開狀態投影 SDD

日期：2026-10-31。來源：owner 提供的「虛擬辦公室建立流程」抽象稿；未提供原文連結，本文不冒充上游查證結果。

## 目標與本次交付

讓具有 shell／HTTP 執行權限的 Grok Bot、Codex、Claude、Cursor 等，透過同一個最小協定回報狀態；之後由 Three.js 把安全的公開投影畫成辦公室。

本次 M0 是**設計＋可執行整合骨架**：SDD、office-report、Workers/SQLite Durable Object 骨架、測試、完整 Grok Bot 提示詞與驗收手冊。不是已完成的 3D 網站，也沒有偷偷部署、呼叫模型或宣稱真實 provider 已接通。

完整主線保留 Three.js 場景、真實 Agent 接入、公開部署及恢復驗證，對應 [SUCCESS](SUCCESS.md) AC-06～08。未達成前 `mainline: incomplete`、`usable_tag: none`。

## 與既有項目的關係

這是 presentation adapter，不是新的 orchestration/control plane。

- [HAI Taskboard](../../products/hai-taskboard/README.md) 管理工作圖、派送、交付候選與審查；office 不決定任務完成、不提供 Ready/Approve/Run/Cancel。
- [Agent Workforce](../../platform/agent-workforce/README.md) 的身分、授權、會話與協作生命週期不搬過來。
- [Prism](../../platform/prism/README.md) 保存遙測與排查資料；office 不接收原始 logs、trace、prompt 或工具輸出。

日後整合只能在既有平台的受信邊界內，把事件轉為這裡的白名單 metadata，再呼叫 `/report`。不能把私有平台原始 API 直接公開給 3D 前端。

## 六步建立流程

1. **環境**：先本機 `wrangler dev --local`；公開目的地、成本與 ingress 政策由 owner 明示批准。不假設任何供應商永遠免費，也不自動建立帳號、隧道或雲端資源。
2. **名冊與佈局**：以 [roster.json](roster.json) 的四個公開別名起步。姓名、角色與座位同樣需要公開審閱。預設低多邊形、安靜、不自動播放音樂；佈局見下節。
3. **核心服務**：公開 `GET /state`、每個 Agent 獨立 Bearer 的 `POST /report`。先跑真 HTTP 狀態更新，再做動畫；不能把裝修、擴充 agent 框架或額外 provider 支線放到這條主線前面。
4. **上報與隱私**：本機摘要最多 80 Unicode code points。CLI 丟棄自由文字，只傳狀態、任務分類與公開協作別名。後端拒絕 `summary` 等未知欄位，公開摘要由固定詞彙生成。這不是靠 regex 猜測秘密的 DLP。
5. **Agent 接入**：每個有執行權限的 agent 分別配置 endpoint 與專屬 token；開始、工具／狀態切換、等待人類、錯誤、完成時呼叫。一個視窗批准不代表其他視窗獲得權限；依各宿主實際權限確認，不宣稱特定產品通用行為。
6. **公開與演示**：先驗證本機真 agent 的上報，再經批准部署。正式 namespace 從空狀態起步。demo 與 live 分開，demo 明示「模擬資料」，不可在連線失敗時偷偷以模擬資料補畫面。核心通過後才加互動、裝修與可選音樂。

## 架構與資料

```text
Agent（私人任務／工具輸出留在此處）
  → office-report：檢查 80 字，捨棄原始摘要，映射 enum
  → HTTPS + 每 agent Bearer
  → Worker 固定路由
  → OfficeRoom：驗證、授權、版本／去重、限流、SQLite 交易
  → GET /state：公開欄位白名單
  → Three.js / 無障礙狀態清單（待實作）
```

`roster.json` 是部署時固定、經審閱的公開設定。Workers 沒有可依賴的持久本機 `state.json`；本方案把它的**邏輯內容**放入 SQLite-backed Durable Object 的 `office` 表。只有一個 object 管理一間小辦公室，名稱由 `OFFICE_ID` 設定，絕不取自 URL 或使用者輸入。

每筆更新在同步交易中完成；代理狀態、版本、速率窗口和最多 32 筆／1 小時去重記錄一起保存。GET 不寫狀態，不用定時器反覆寫 idle。這是 4～16 agents 的小型 lab，不宣稱 HA 或無限水平擴充。

不用 Workers KV 讀取整份 state → 修改 → 寫回：KV 的 eventual consistency 與同 key 並行更新不符合這個狀態協調需求。依據：[KV write guidance](https://developers.cloudflare.com/kv/api/write-key-value-pairs/)、[SQLite DO storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)。

若日後加入 VPS adapter，可輸出 `state.json`，但必須有單寫者／跨程序鎖、同檔案系統 temp＋fsync＋atomic rename、重啟恢復與併發測試；普通 `writeFile` 不是持久化證據。本次沒有 VPS adapter。

## 狀態機與呈現優先序

| 協定狀態 | 中文 | 場景行為（前端規格，非本次已實作） |
| --- | --- | --- |
| coding | 寫程式 | 工位，打字姿勢 |
| terminal | 終端中 | 工位，終端圖示；不顯示命令 |
| browsing | 瀏覽網頁 | 工位，資料圖示；不顯示 URL |
| thinking | 思考中 | 工位或白板，思考動畫 |
| needs-you | 需要你 | 紅色注意標示與文字；支援 reduced-motion，禁止快速頻閃 |
| error | 出錯 | 明確錯誤標示；不曝露錯誤堆疊 |
| idle | 空閒 | 休息區 |
| done | 已完成 | 僅新 revision 播放一次撒花；不等於 HAI 驗收完成 |

八種狀態都可轉移至其他狀態；它們是觀測結果，不是任務合法性的裁決。伺服器時間為準，不能相信 agent 自報時間。

30 分鐘無新回報：public `status=idle`、`stale=true`，仍保留 `reportedStatus`、`lastSeen` 與 `alert`；不能因為時效過期就抹掉需要人工介入或出錯。前端顯示「資料過期」而不是裝作 agent 正常休息。

夜間是獨立的 scene presence overlay，不增加第九個協定狀態。預設關閉；啟用時時區 `Asia/Singapore`、22:00～08:00。只讓 stale／idle 且無 alert 的角色走出門；仍在上報的角色不能被假裝下班。

協作座位只在雙方互相列出 collaborator、狀態新鮮且未 idle/done 時啟用；單方提到別人不能強迫對方離席。alert 優先顯示；stale 優先於移動；夜間規則不得遮蔽 alert。多方以公開 ID 排序選固定座位，避免每次 poll 抖動。

## Three.js 佈局與互動規格

低多邊形開放式辦公室，地面 24×16，座標 (x,z)，y 向上。等角相機 `(26,22,26)` 看向 `(12,0,8)`。不依賴付費資產，首版用幾何圖元。

| 區域 | 地面範圍 | 物件／座位 |
| --- | --- | --- |
| 總監室 | x 1～7、z 1～5 | director=(4,3)，桌、椅、白板；門=(6,5) |
| 會議室 | x 13～23、z 1～5 | 桌中心=(18,3)，座位=(15,3)/(17,2)/(19,2)/(21,3)，門=(16,5) |
| 工位區 | x 8～22、z 6～10 | desk-1=(10,8)、desk-2=(14,8)、desk-3=(18,8) |
| 休息區 | x 1～8、z 11～15 | 沙發與植物，候位點=(3,12)/(5,12)/(7,12) |
| 茶水間／出口 | x 18～23、z 12～15 | 咖啡機=(20,13)、門=(23,14) |

走道沿 z=6 與 z=11，室門連接走道；角色沿 waypoint graph 行走，不直穿牆、桌、椅。碰撞與可達性須用測試證明，不以畫面上「看起來接近」驗收。

每個角色頭頂顯示公開名稱、狀態與固定摘要；按角色只開唯讀側欄。文字節點用 `textContent`；Canvas label 用 `fillText`；禁止 `innerHTML` 與未審核外部圖片／音訊。手機可操作相機；提供同內容文字清單；失去 WebGL 時清單仍可用。

每 15 秒、有 jitter、單一 in-flight 的 GET poll；頁面隱藏時停止，恢復時重抓；失敗指數退避，上限 60 秒，顯示斷線與上次成功時間。不得在每 frame 發 API 請求。

## 上報一致性與安全

協定以 [API](docs/API.md) 和 [core.mjs](src/core.mjs) 為準。

- 每 agent 一個隨機高熵 token，server secret 只配置 SHA-256 digest；不同 agent 禁止共用 digest。不能把 token 放前端、URL、Git、shell argv 或 PR。
- 原始摘要不離開 CLI，API 拒收未知欄位。固定摘要也不消除公開活動時間、協作關係與任務分類的隱私風險；需要保密就不要入公開名冊。
- HTTP body 最多 1024 bytes，串流計數不能只相信 Content-Length；嚴格 enums、UUIDv4、已知 agent／collaborators、最多 3 位、不含自身或重複。
- 每 agent 每固定分鐘最多 12 筆接受的更新；429 帶 Retry-After。這不是反 DDoS 或未鑑權流量的邊緣限流；公開前另驗證 WAF／ingress 與用量上限。
- 先 GET revision，再 POST `expectedRevision`。不一致回 409，不能自動刷新 revision 強行覆蓋。單 agent 預設只有一個上報者；多 session 需要上游聚合，不共用 ID 競爭。
- UUID eventId 及同一 body 在一次 CLI 的最多 3 次重試內重用；相同事件同內容回原 revision；相同事件不同內容回 409。去重 32 筆／1 小時後，舊 expectedRevision 仍不能覆蓋新狀態。
- 每次 HTTP 3 秒 timeout，拒絕 redirect，只有 HTTPS 或精確 loopback HTTP；Retry-After 大於 2 秒即回報失敗，不在 agent 裡長時間輪詢。不記 body／token／自由文字錯誤。
- 所有 response `no-store`；沒有瀏覽器寫入與 CORS credential 通道。公共 GET 不含 eventId、rate、fingerprint、秘密或任務原文。
- 固定路由不存取使用者指定的檔案路徑；不是接收任意路徑後用字串 replace 假裝防 traversal。

## 主線順序與驗收

M0（本次）：設計、CLI、後端骨架、契約與本機 HTTP 測試、交接提示詞。
M1：實際 workerd 持久化與重啟→一個有權限的真 agent 執行無敏感任務→狀態端到端證據；不擴寫 provider 框架。
M2：Three.js 畫面與文字 fallback，八狀態、stale、斷線、協作、夜間及 reduced-motion 的瀏覽器測試。
M3：owner 批准目的地／成本後，空白正式 namespace、公開入口、secret rotation、重啟／回復、限制與撤回步驟；demo 永遠分離。
M4（非必要）：裝修、音樂、物件互動。

M1～M3 是完整產品仍須達成的 AC，不因本次 M0 有測試通過就刪除。詳細現況與證據見 [SUCCESS](SUCCESS.md)、[驗證紀錄](docs/evidence/m0.md)。

## 官方資料（2026-10-31 查閱）

- [Durable Objects storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)：SQLite、transactionSync、同步交易限制。
- [Storage lifecycle](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/)：記憶體狀態不能替代持久 storage。
- [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)：此骨架保留仍支援的 `migrations/new_sqlite_classes` 格式，未混用 `exports`。
- [Wrangler 4.156.0](https://github.com/cloudflare/workers-sdk/releases/tag/wrangler%404.156.0)：固定 CLI 頂層版本；不是整個 transitive dependency lock。
- [Three.js installation](https://threejs.org/manual/pages/installation.html)：後續前端應固定版本與 lockfile，bundle 至獨立 public 目錄，不把 repo root 當靜態檔根目錄。

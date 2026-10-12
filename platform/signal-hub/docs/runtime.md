# M1–M3 runtime contract

提供事件 HTTP API、SQLite WAL、本機 Alertmanager v4 adapter、來源新鮮度與內嵌 React 唯讀看板。M3 另提供規則、指標查詢與 owner 設定重載；M4–M6 尚未實作。

## 啟動

`signalhub -config <path> -db <path> -owner-token-ref file:/absolute/path [-readonly-token-ref file:/absolute/path] [-listen 127.0.0.1:8080]`

- M1 設定接受 JSON（YAML 1.2 的子集），完整物件含 sources、rules、subscriptions、webhook_allowlist；不接受重複 key。rules 依 M0 schema 與防迴圈規則驗證；subscriptions 必須為空。一般 YAML 語法尚未提供。POST /v1/config:reload 重新載入同一份 JSON 設定及憑證，僅 owner 可呼叫。
- source secret 由設定的 token_ref 載入；owner／readonly 由 CLI 的 file: 參考載入。Owner 必填，readonly 可省略。每個 token 至少32 bytes、只含 RFC 6750 bearer 字元（英數字與 -._~+/，尾端可帶 =），允許檔案結尾的一個 LF 或 CRLF；不 trim 其他空白。不同角色或來源不能共用 token。記憶體只保留 SHA-256，不保存到資料庫或日誌。
- 預設 listen 僅 loopback，供本機開發；非 loopback 僅允許明確的 Tailscale IPv4/IPv6 位址。拒絕 wildcard、主機名、公網及一般 LAN 位址。這個範圍檢查不證明主機已加入指定 tailnet；M6 仍須驗證介面、ACL 與非 root 部署。
- DB 是本機檔案，不接受 SQLite URI 或記憶體 DSN。使用 WAL、synchronous FULL、有限 busy timeout；啟動時套用版本化 migration，未知較新版本拒絕啟動。資料檔與目錄須由執行者限制權限，範例以 umask 077 建立。
- SIGINT／SIGTERM 停止接受連線並等待處理中的請求。啟動錯誤只輸出分類，不輸出 secret 或設定內容。

資料庫 time 欄位使用內部可排序 UTC 日期鍵，保留任意小數秒精度；它不是公開 RFC3339 欄位。原始時間與事件 bytes 保存在 raw_json，API 從原事件回傳。

## HTTP 邊界

事件 API 回應依 OpenAPI；所有錯誤使用既有 code。HTTP header／request target 上限為128 KiB，容納合法大分組鍵的URL轉義；metric cursor使用固定長度group雜湊，避免大分組讓翻頁失敗。每個 HTTP body 最多 **4 MiB**（單筆、批次與 adapter 共用），超過回413 payload_too_large；data 仍另依 JCS 限16384 bytes。JSON 巢狀深度最多64層，超過回400 invalid_json。這兩個資源限制亦適用於包含大量 extension 或空白的請求。

批次外層 strict JSON 解析／認證失敗不寫入；有效外層的每項獨立驗證及提交。Alertmanager 空 alerts 合法、回空 results；最多100 alerts，超過回400 invalid_event。Adapter 的單筆無效 alert 回400 invalid_event，其他 alert 仍處理。

查詢參數不可重複；未知參數、空的時間／cursor／limit、錯誤格式回400 invalid_query。省略 severity_min 不限制嚴重度；省略事件 severity 以 info 索引，但不修改原事件。游標綁定篩選條件與第一頁的最大 seq；新插入事件從新的查詢開始看見。查詢 q 是大小寫敏感的字面子字串，不解析 SQL wildcard。

`/` 與 `/assets/*` 提供無事件資料的靜態看板；事件與來源 API 仍要求 owner／readonly bearer。看板 token 只存在記憶體，重新整理需重新輸入。未實作路由回404 not_found。healthz 僅確認 process 活著；readyz 檢查 SQLite 可用性，失敗只回503 {"status":"not_ready"}。這不宣稱磁碟剩餘容量、所有 future workers 或實際生產可用性。

## 範圍

本機 Alertmanager 轉換與 AC-06 屬於 M1；M6 負責真實生產者設定、部署與連續運作驗證。M2 已實作 UI 與 source freshness evaluator，詳細持久化／升級語義見 [來源新鮮度契約](source-freshness.md)。尚無 retention cleanup、封存與投遞；retention_days 只驗證設定，尚未清除資料。

## M3 規則與指標

詳細語義見 [M3 實作契約](m3-design.md)。規則支援 count、count_distinct、sum、min、max、avg；以事件時間分入 UTC 桶。啟動與每分鐘評估；新增版本自動回填目前熱資料。每個規則的交易獨立，rollup、門檻狀態及內部事件一起提交。三次連續失敗產生一次失敗事件，成功後重置。

`GET /v1/rules` 只回安全的生效規則定義；`GET /v1/metrics/{rule_id}` 回保留中的 rollup，含版本、partial、樣本數與計算時間。兩者接受 owner/readonly，拒絕 source token。列表預設100、最多200，游標必須配合原查詢；規則列表定義變更後舊游標失效，相同定義重載不影響游標。看板載完全部分頁才顯示完整圖表；大範圍高基數查詢可能消耗較多瀏覽器記憶體，請使用時間範圍縮小結果。

同一規則版本的內容雜湊持久保存；重用版本卻改內容會拒絕整份設定。來源與規則 DB 變更、成功 audit/event 在同一交易提交，之後在 HTTP 共用鎖內切換憑證；失敗時舊設定仍有效。重載後計算是另外的投影工作，失敗不撤销已接受的設定，後續 tick 會重試。設定重載不接收 body 或 query，錯誤不公開檔案路徑、token 或原始設定。

手動回填：`signalhub rules backfill --config <path> --db <path> --rule <id> --from <RFC3339-or-UTC-date>`。此命令不啟動 HTTP，不改規則或憑證；所給設定必須與資料庫中生效的規則相同。建議停止服務後執行，避免與週期評估競爭 SQLite 鎖。單次最多1,000,000個桶；更大範圍在寫入前拒絕，不靜默截斷。保留清理尚未實作，因此 recomputable_from 表示目前資料庫中最早事件，不保證已套用90天保留期。

門檻事件以完整分組鍵生成穩定ID，但事件data僅在分組鍵≤1024 UTF-8 bytes時附原鍵；所有事件都含group_key_sha256。完整分組仍可由metric查詢取得，避免合法大分組超出事件16 KiB限制。停機後從上次成功計算所在桶補算，不留下過期partial桶。

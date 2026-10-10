# M1–M2 runtime contract

提供事件 HTTP API、SQLite WAL、本機 Alertmanager v4 adapter、來源新鮮度與內嵌 React 唯讀看板。M3–M6 路由尚未提供。

## 啟動

`signalhub -config <path> -db <path> -owner-token-ref file:/absolute/path [-readonly-token-ref file:/absolute/path] [-listen 127.0.0.1:8080]`

- M1 設定接受 JSON（YAML 1.2 的子集），完整物件含 sources、rules、subscriptions、webhook_allowlist；不接受重複 key。rules 與 subscriptions 必須為空，避免載入尚無執行器的設定。一般 YAML 語法與熱重載留到後續階段。
- source secret 由設定的 token_ref 載入；owner／readonly 由 CLI 的 file: 參考載入。Owner 必填，readonly 可省略。每個 token 至少32 bytes、只含 RFC 6750 bearer 字元（英數字與 -._~+/，尾端可帶 =），允許檔案結尾的一個 LF 或 CRLF；不 trim 其他空白。不同角色或來源不能共用 token。記憶體只保留 SHA-256，不保存到資料庫或日誌。
- 預設 listen 僅 loopback，供本機開發；非 loopback 僅允許明確的 Tailscale IPv4/IPv6 位址。拒絕 wildcard、主機名、公網及一般 LAN 位址。這個範圍檢查不證明主機已加入指定 tailnet；M6 仍須驗證介面、ACL 與非 root 部署。
- DB 是本機檔案，不接受 SQLite URI 或記憶體 DSN。使用 WAL、synchronous FULL、有限 busy timeout；啟動時套用版本化 migration，未知較新版本拒絕啟動。資料檔與目錄須由執行者限制權限，範例以 umask 077 建立。
- SIGINT／SIGTERM 停止接受連線並等待處理中的請求。啟動錯誤只輸出分類，不輸出 secret 或設定內容。

資料庫 time 欄位使用內部可排序 UTC 日期鍵，保留任意小數秒精度；它不是公開 RFC3339 欄位。原始時間與事件 bytes 保存在 raw_json，API 從原事件回傳。

## HTTP 邊界

事件 API 回應依 OpenAPI；所有錯誤使用既有 code。每個 HTTP body 最多 **4 MiB**（單筆、批次與 adapter 共用），超過回413 payload_too_large；data 仍另依 JCS 限16384 bytes。JSON 巢狀深度最多64層，超過回400 invalid_json。這兩個資源限制亦適用於包含大量 extension 或空白的請求。

批次外層 strict JSON 解析／認證失敗不寫入；有效外層的每項獨立驗證及提交。Alertmanager 空 alerts 合法、回空 results；最多100 alerts，超過回400 invalid_event。Adapter 的單筆無效 alert 回400 invalid_event，其他 alert 仍處理。

查詢參數不可重複；未知參數、空的時間／cursor／limit、錯誤格式回400 invalid_query。省略 severity_min 不限制嚴重度；省略事件 severity 以 info 索引，但不修改原事件。游標綁定篩選條件與第一頁的最大 seq；新插入事件從新的查詢開始看見。查詢 q 是大小寫敏感的字面子字串，不解析 SQL wildcard。

`/` 與 `/assets/*` 提供無事件資料的靜態看板；事件與來源 API 仍要求 owner／readonly bearer。看板 token 只存在記憶體，重新整理需重新輸入。未實作路由回404 not_found。healthz 僅確認 process 活著；readyz 檢查 SQLite 可用性，失敗只回503 {"status":"not_ready"}。這不宣稱磁碟剩餘容量、所有 future workers 或實際生產可用性。

## 範圍

本機 Alertmanager 轉換與 AC-06 屬於 M1；M6 負責真實生產者設定、部署與連續運作驗證。M2 已實作 UI 與 source freshness evaluator，詳細持久化／升級語義見 [來源新鮮度契約](source-freshness.md)。尚無 retention cleanup、封存、指標與投遞；retention_days 只驗證設定，尚未清除資料。

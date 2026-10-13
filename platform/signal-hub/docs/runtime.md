# M1–M5 runtime contract

提供事件 HTTP API、SQLite WAL、本機 Alertmanager v4 adapter、來源新鮮度與內嵌 React 唯讀看板。M3 另提供規則、指標查詢與 owner 設定重載；M4 提供訂閱投遞、摘要、DLQ 與重放；M5 提供封存、匯回與一致備份／隔離還原；部署仍屬 M6。

## 啟動

`signalhub -config <path> -db <path> -owner-token-ref file:/absolute/path [-readonly-token-ref file:/absolute/path] [-listen 127.0.0.1:8080]`

- M1 設定接受 JSON（YAML 1.2 的子集），完整物件含 sources、rules、subscriptions、webhook_allowlist；不接受重複 key。rules 依 M0 schema 與防迴圈規則驗證；subscriptions 依 M4 schema 與防迴圈規則驗證；webhook 和 ntfy 都要求精確 URL allowlist。一般 YAML 語法尚未提供。POST /v1/config:reload 重新載入同一份 JSON 設定及憑證，僅 owner 可呼叫。
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

本機 Alertmanager 轉換與 AC-06 屬於 M1；M6 負責真實生產者設定、部署與連續運作驗證。M2 已實作 UI 與 source freshness evaluator，詳細持久化／升級語義見 [來源新鮮度契約](source-freshness.md)。M5 依已接受的 retention_days 進行驗證後封存清除；未指定維護目錄時不自動刪除資料。

## M3 規則與指標

詳細語義見 [M3 實作契約](m3-design.md)。規則支援 count、count_distinct、sum、min、max、avg；以事件時間分入 UTC 桶。啟動與每分鐘評估；新增版本自動回填目前熱資料。每個規則的交易獨立，rollup、門檻狀態及內部事件一起提交。三次連續失敗產生一次失敗事件，成功後重置。

`GET /v1/rules` 只回安全的生效規則定義；`GET /v1/metrics/{rule_id}` 回保留中的 rollup，含版本、partial、樣本數與計算時間。兩者接受 owner/readonly，拒絕 source token。列表預設100、最多200，游標必須配合原查詢；規則列表定義變更後舊游標失效，相同定義重載不影響游標。看板載完全部分頁才顯示完整圖表；大範圍高基數查詢可能消耗較多瀏覽器記憶體，請使用時間範圍縮小結果。

同一規則版本的內容雜湊持久保存；重用版本卻改內容會拒絕整份設定。來源與規則 DB 變更、成功 audit/event 在同一交易提交，之後在 HTTP 共用鎖內切換憑證；失敗時舊設定仍有效。重載後計算是另外的投影工作，失敗不撤销已接受的設定，後續 tick 會重試。設定重載不接收 body 或 query，錯誤不公開檔案路徑、token 或原始設定。

手動回填：`signalhub rules backfill --config <path> --db <path> --rule <id> --from <RFC3339-or-UTC-date>`。此命令不啟動 HTTP，不改規則或憑證；所給設定必須與資料庫中生效的規則相同。建議停止服務後執行，避免與週期評估競爭 SQLite 鎖。單次最多1,000,000個桶；更大範圍在寫入前拒絕，不靜默截斷。recomputable_from 表示目前熱資料中最早事件。範圍包含已封存且未匯回的事件時，重算整筆交易拒絕並保留原 rollup；先匯回完整範圍再回填。

門檻事件以完整分組鍵生成穩定ID，但事件data僅在分組鍵≤1024 UTF-8 bytes時附原鍵；所有事件都含group_key_sha256。完整分組仍可由metric查詢取得，避免合法大分組超出事件16 KiB限制。停機後從上次成功計算所在桶補算，不留下過期partial桶。

## M4 訂閱與投遞

詳細介面與安全邊界見 [M4 實作契約](m4-design.md)。啟動前完整載入訂閱憑證；重載時先驗證所有來源、規則、訂閱、允許清單與憑證，再原子啟用。訂閱 ID 的 filter、mode、start、digest 與 channel kind 固定，修改需新 ID；URL／secret reference 可在同一 ID 下輪替。移除的訂閱暫停，重加同一 ID 從持久化游標續作。

每秒投影最多每訂閱200個事件或31個摘要窗，再有界地處理到期投遞。新訂閱預設不補送歷史，`earliest_hot` 明確啟用歷史掃描。webhook 保存原始事件 bytes；ntfy 即時與每日摘要的訊息在排隊時固定。摘要依事件時間、IANA 當地執行點切半開視窗；已物化摘要不因更遲到的事件改寫，空窗仍推進排程。摘要保留匹配總數和前20筆。

投遞是 at-least-once。claim 在連線前提交，lease 為2分鐘；重啟要等 lease 到期才重送。2xx 成功；408／429／5xx／連線失敗以30秒起始的指數退避與抖動重試，最多12次、單次延後最多1小時；其他狀態（包含 redirect）進 DLQ。每次 DLQ episode 產生一個內部事件。接收端必須先驗簽與5分鐘時間窗，再按穩定 delivery ID 持久化去重，完成接受交易後才回2xx。

`GET /v1/subscriptions` 與 `/v1/deliveries` 接受 owner／readonly，僅回安全狀態、counts 與最近嘗試摘要。`POST /v1/deliveries/{id}:replay` 只接受 owner 與 `application/json` 的非空白 `reason`，將 audit 與 pending 狀態同時提交。只有仍生效訂閱的 DLQ 可以重放；保留 ID、訊息與歷史次數，重設該輪12次上限。看板提供篩選、分頁、最近嘗試與理由必填重放；設定維持檔案管理。

兩個 channel 都只允許精確列出的 HTTPS URL。每次 dial 重新解析 DNS，整組位址必須都在 Tailscale 範圍，再直接連線到核准 IP 並驗證原主機名 TLS。禁止 redirect、環境 proxy、連線重用與非 tailnet 位址；10秒逾時。不記錄接收端 body、原始 transport error、URL 或憑證。正式 binary 沒有 loopback outbound 例外；真正 TLS 接收端測試使用僅 Go 測試可注入的單一位址／port／憑證。這不證明實際 tailnet ACL 或部署安全，M6 仍另行驗收。


## M5 封存、備份與隔離還原

完整交易與驗收契約見 [M5 設計](m5-design.md)。本機 CLI 不啟動 HTTP；`--db` 必須指向既有 Signal Hub DB，遺失、空白、其他 SQLite 或 symlink 路徑會拒絕。讀写維護與服務共用 SQLite 鎖，可能短暫 busy；保留既有有限 timeout，失敗可稍後重試。

```sh
signalhub archive run --db DB --archive-dir ARCHIVES
signalhub archive verify --db DB --archive-dir ARCHIVES --day 2026-01-01
signalhub archive import --db DB --archive-dir ARCHIVES --day 2026-01-01 --reason 'isolated recovery drill' --retention-days 7
signalhub backup --db DB --output NEW.sqlite
signalhub restore --backup NEW.sqlite --db ISOLATED.sqlite --reason 'isolated recovery drill'
```

封存只處理已完整超出保留期的 UTC 日；來源預設90天，重疊前綴取最長政策。升級的既有來源在首次成功重新載入設定前，因無法證明先前接受的 retention，會暫緩清除。尚未掃描的立即訂閱、尚未物化的摘要（包括暫停者）及規則回填／補算窗也會保留。永久 identity 保留 source/id/hash/原 seq，即使熱事件已刪除，完全相同的重送仍回200與原 seq，異內容回409。

檔案為 `events/YYYY/MM/DD.part-N.jsonl.gz`；每 part 最多1000筆／16 MiB 原始輸入。壓縮檔重新讀取、SHA-256、筆數與精確 membership 全部一致，才能在同一交易寫 manifest、成功事件並刪除對應熱資料。失敗回滾整次封存；檔案寫入後交易失敗留下的 orphan 不覆寫、不自動清理，重試改用新 part。遲到資料也建立新 part。失敗事件為有界 best-effort，DB 無法寫入時可能無法紀錄；CLI 仍回非零。run JSON 為 `{parts,events}`，verify 為 `{parts}`；無該日 manifest 時拒絕驗證。

匯回僅接受此 DB 或其一致備份中已記錄的 manifest，整日驗證與插入原子提交；不是任意外部檔案匯入器。回應 `{imported,duplicates}`；重跑不重複插入、不延長既有還原期限，但會記錄 `archive.import` audit。預設熱保留7天，`restored:true` 是中樞 metadata，原 CloudEvent 不變。原 seq、received time、來源 freshness、subscription cursor、已排隊訊息、attempt、lease、DLQ 與 replay ID 保留。新訂閱與投遞掃描不重送 restored 歷史；規則評估及新版本回填仍包含已匯回熱資料。新增匯回資料會使舊 event query cursor 失效，請重新查詢；已物化 rollup 不隨封存刪除。

備份以 SQLite `VACUUM INTO` 產生一致快照，檢查完整性、fsync、SHA-256 後以不覆寫方式發布快照及 `<snapshot>.manifest.json`。manifest 欄位：version=1、file（basename）、size_bytes、sha256、created_at。還原先驗 manifest／hash／SQLite，再複製至全新位置，在副本寫入 `backup.restore` audit。兩命令 JSON 回傳同一 manifest 形狀。reason 必須是非空白 UTF-8，最多4096 bytes。手動備份／還原的父目錄須已存在；路徑祖先不可為 symlink，目的檔或其 SQLite sidecar 已存在即拒絕。中斷留下不完整 pair 時不能使用，保留現有檔案並改用新輸出名稱重試。

設定與憑證不在 DB 快照中；隔離演練須另建合成設定／憑證，複製需要的 archive 檔並改用獨立目錄。快照保留投遞狀態，因此啟動副本後會恢復到期工作與 lease 到期重試；演練不得指向真實通知帳號。restore 本身不啟動網路或覆寫既有 DB。

服務另接受 `-archive-dir DIR`、`-backup-dir DIR`，明確提供者在啟動與每24小時執行；目錄以0700建立、每份備份用唯一名稱，單項失敗不抑制另一項。省略旗標時不自動執行。沒有 offsite 上傳、備份刪除政策、部署或實體斷電保證。

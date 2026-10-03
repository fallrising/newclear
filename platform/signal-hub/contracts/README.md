# Signal Hub M0 contracts

這個目錄定義事件、設定與 HTTP API，並提供離線驗證。沒有 HTTP server、資料庫 migration、背景工作或部署。

## 驗證

使用 Python 3.11 以上；以下命令從 repository 根目錄執行。依賴只供契約檢查，與未來 Go runtime 分開。

```sh
python3 -m venv /tmp/signalhub-contracts
/tmp/signalhub-contracts/bin/pip install --only-binary=:all: -r platform/signal-hub/contracts/requirements.txt
/tmp/signalhub-contracts/bin/python platform/signal-hub/contracts/check.py
```

安裝需要套件來源可用；安裝後檢查不需要網路、帳號或 secret。requirements 鎖定本次實際安裝的直接及間接依賴版本。JSON Schema 使用 2020-12，OpenAPI 使用 3.1.1；相對 `$ref` 只解析本目錄檔案。

| 檔案 | 責任 |
| --- | --- |
| `schemas/event.schema.json` | CloudEvents 1.0 的 Signal Hub profile；包含內部事件 |
| `schemas/sources.schema.json` | 生產者註冊設定 |
| `schemas/filter.schema.json` | 規則與訂閱共用的篩選語法 |
| `schemas/rules.schema.json` | 版本化聚合規則 |
| `schemas/subscriptions.schema.json` | webhook／ntfy 訂閱 |
| `schemas/config.schema.json` | 完整設定及 webhook URL 允許清單 |
| `openapi.json` | 各階段預定的 API；可驗證契約不代表已有服務 |
| `fixtures.json` | 每份 schema 的正反案例，含設定語意反例 |
| `canonical-vectors.json`、`webhook-vectors.json` | 固定的 canonical JSON／雜湊與簽章案例 |

## M0 補足的決定

以下決定把 SDD v0.1 的未定細節固定下來，供下一階段實作。保留期、圖表套件與部署仍未定。

### 事件與雜湊

- 接收 profile 要求 `time`，`data` 只允許 object；不接受 `data_base64`。`dataschema` 若有值必須為 URI。
- type 是小寫字母開頭、由 `.` 分段的字母／數字名稱。未知 extension 名稱只含小寫字母／數字，值限 string、boolean、signed 32-bit integer 或 null；object／array／浮點 extension 拒絕。JSON duplicate keys、NaN、Infinity 拒絕。
- CloudEvents 可選 attribute 的 null 視同省略；data 仍只能是 object。`seq`、`receivedat`、`clockskew`、`restored` 是保留的 hub metadata 名稱，不能夾入事件。
- 使用 RFC 8785 JCS 序列化後的 UTF-8 bytes：data 上限 **16384 bytes，含 object 標點**；整個事件先移除頂層 null attribute 再做 JCS，以 SHA-256 作內容雜湊。拒絕 JCS 無法表示的輸入（例如超過安全整數範圍、孤立 surrogate）。不補入預設值；省略 severity 與顯式 `info` 因而是不同內容。
- schema 通過不表示具備來源權限。token 無效為 401；source/type 越權及外部使用 `signalhub.*` 為 403；格式錯誤400、data 過大413。`source_prefix` 是字面前綴，沒有隱含分隔符；設定者應明寫所需的 `:` 或 `/` 邊界。
- `causationid` 沿用 `<source>#<id>`，組成前把各部分中的 `%`、`#` 分別編為 `%25`、`%23`，接收端只解碼一次；整體仍受256字元限制。放不下時省略 causationid，以 correlationid 查關聯。這不擴大事件庫欄位。

### 設定與篩選

- 設定 schema 驗證解析後的物件；本次 fixtures 用 JSON（YAML 1.2 的子集）。未來 YAML loader 必須拒絕重複 key，不讀取或執行自訂 tags。
- filter 各條件之間 AND，同一列表內 OR；省略條件表示不限制，空列表拒絕。`types` 是 exact 或以 `.*` 結尾的 prefix pattern；`sources` 是 exact 或只在末尾加 `*`。沒有正則或任意運算式。
- `filter.data` 的 key 是1至3層的點分路徑；值為 JSON scalar，作型別敏感的等值比較（false 不等於0）。不存在的路徑不匹配，包括想比對 null 時；只有顯式 null 匹配 null。
- sources.name、rules.id、subscriptions.id 在各自集合中唯一。token／secret 只允許 `file:/...` 參考，檢查器不開啟這些檔案。name/id 限1–64字元的小寫字母、數字與連字號，首字為字母。
- 規則必須明列 types 並排除所有 `signalhub.rule.*`；不靠其他 filter 欄位證明安全。訂閱 types 若可能匹配 `signalhub.delivery.dlq`，其 subject_prefix 必須排除自己的 subscription id；不靠 data/source 條件例外放行。這是載入前保守的防迴圈政策。
- webhook 先固定為 immediate；ntfy 支援 immediate 與 daily digest。digest 每24h以 IANA timezone 的當地 `at` 時間產生，window 是相鄰執行點間的半開區間；夏令時間不存在的當地時間順延到第一個有效時間，重複時間選第一次。delivery ID 內的 window_start 是起點 Unix 秒；查詢 API 的 window_start 欄位則使用 RFC3339 字串。其他週期或 webhook digest 需先擴充契約。
- 完整設定的 `webhook_allowlist` 逐一列出完整 HTTPS URL，webhook URL 必須精確匹配。這只驗設定，尚不驗 DNS、redirect、tailnet 路由；M4 必須另驗實際 SSRF 防護。空清單不允許任何 webhook。
- 規則內容變更卻未增加 version，需要比較既有生效設定；M0 靜態 checker 沒有該歷史狀態，留給 M3 驗收。

### HTTP 與投遞

- OpenAPI 的回應 schema 是機械契約。單筆新增202 `{seq}`；重複200 `{seq,duplicate:true}`；錯誤 `{error:{code,message}}`。
- batch 外層必須是1–100項陣列；外層正常解析且認證通過後回200 `{results:[...]}`。每項有輸入順序的零起算 index、status，以及成功 seq／duplicate 或失敗 error。每項獨立驗證，部分錯誤不取消其他項；OpenAPI batch items 刻意不先套事件 schema。2xx仍必須等對應資料持久化。
- 查詢 token 是 owner 或 readonly；ingest 是 source token；replay/reload 只允許 owner。health/ready 不需要 token，仍只在 tailnet 提供服務，且只回狀態。
- 時間範圍為 `[from,to)`；列表預設100、最多200，cursor opaque。事件順序 `(time desc,seq desc)`；詳細內容的關聯鏈升序。各回應只公開 OpenAPI 列出的欄位，不公開 token_ref/hash 或 webhook secret。
- webhook 的 timestamp 是無前導零的非負十進位 Unix 秒；簽章格式 `v1=` 加64個小寫hex字元。輸入為 ASCII `v1.<timestamp>.<delivery_id>.` 接原始 body bytes，secret 使用原始 bytes、不 trim、不當hex文字解碼。
- 接收端先驗 header格式、`abs(now-timestamp) <= 300` 與 HMAC constant-time comparison，再查已持久化的 delivery id。有效重複是 duplicate；偽造請求即使 ID 重複也拒絕。接受並持久化後才回2xx。M0 vectors 的 accepted_ids 是合成狀態，未實作持久化接收端。

重生合成測試向量（會覆寫本目錄兩個 vectors 檔）：

```sh
/tmp/signalhub-contracts/bin/python platform/signal-hub/contracts/generate_vectors.py
/tmp/signalhub-contracts/bin/python platform/signal-hub/contracts/check.py
```

checker 另以 RFC 4231 test case 1 核對 HMAC 已知答案。所有 keys、ID、網址與事件均為公開的合成測試資料。

## 尚未驗證

沒有 ingest、SQLite、token授權執行、rule evaluator、持久化去重、dispatcher、來源新鮮度、YAML loader、UI 或部署。OpenAPI 通過只證明文件結構有效；fixtures 通過只證明M0 checker 的契約案例，不能標為 M1–M6 的 runtime 驗收。

# 19 — 控制平面 API 完整規格

Base path：`/api/console/v1`。全部 JSON。路由表見 `09-CONTROL-PLANE.md` §3.2，本文件補完每個端點的 request / response schema。

規格檔置於 `api/openapi/console-v1.yaml`，CI 驗證實作與 spec 一致（`test/compat/openapi_test.go` 用 spec 產生請求並校驗回應）。

## 0. 通用

### 0.1 標頭

| 標頭 | 說明 |
|---|---|
| `Authorization: Bearer <jwt\|api_key>` | 必填（除 `/auth/*`） |
| `X-Prism-Tenant` | 選填；跨租戶操作時指定，需 owner 權限 |
| `Idempotency-Key` | 選填；POST 請求的冪等鍵，24 小時內重複視為同一請求 |

### 0.2 分頁

列表端點統一使用 cursor 分頁：

```
GET /agents?limit=50&cursor=<opaque>
```

```json
{"items": [...], "next_cursor": "...", "total_estimate": 132}
```

`limit` 預設 50，上限 500。`next_cursor` 為空表示已到底。**不使用 offset 分頁**（大 offset 效能差且會漏資料）。

### 0.3 錯誤

```json
{"error": {"code": "invalid_argument", "message": "expr failed to parse",
           "details": [{"field": "expr", "reason": "parse error at 1:5: unexpected }"}],
           "request_id": "01J..."}}
```

`request_id` 必須同時出現在伺服器日誌，供追查。

### 0.4 時間

全部使用 RFC3339（UTC，帶 `Z`）。Duration 使用 Go 格式字串（`"30s"`、`"5m"`）。

---

## 1. `/auth`

### `POST /auth/login`

```json
// req
{"email": "ops@example.com", "password": "..."}
// resp 200
{"access_token": "eyJ...", "refresh_token": "...", "expires_in": 900,
 "user": {"id": "uuid", "email": "...", "display_name": "...",
          "memberships": [{"tenant_id": "default", "role": "admin"}]}}
```

失敗一律回 `401` + `{"error":{"code":"unauthenticated","message":"invalid credentials"}}`。**不得區分「帳號不存在」與「密碼錯誤」**。

失敗需限流：同一 IP 每分鐘 10 次、同一 email 每分鐘 5 次，超出回 `429`。

### `POST /auth/refresh`

```json
{"refresh_token": "..."}  →  {"access_token": "...", "expires_in": 900}
```

refresh token 一次性：使用後失效並發新的（rotation）。偵測到已使用過的 token 被重用時，**撤銷該使用者全部 session** 並記錄 `audit_log`（token 竊取的標準應對）。

### `POST /auth/logout`

撤銷當前 refresh token。回 `204`。

### `GET /me`

```json
{"id":"uuid","email":"...","display_name":"...","status":"active",
 "memberships":[{"tenant_id":"default","role":"admin"}],
 "current_tenant":"default"}
```

---

## 2. `/tenants`

### `GET /tenants`（owner）

```json
{"items":[{"id":"default","name":"Default","status":"active",
           "limits":{"max_active_series":500000,"ingest_rate_bytes_per_sec":10485760},
           "retention":{"metrics_days":30,"logs_days":14,"traces_days":7},
           "created_at":"2026-09-05T00:00:00Z"}],"next_cursor":""}
```

### `POST /tenants`（owner）

```json
// req
{"id":"acme","name":"ACME Corp",
 "limits":{"max_active_series":100000},
 "retention":{"metrics_days":15,"logs_days":7,"traces_days":3}}
// resp 201 — 同 GET 的單一物件
```

`id` 必須符合 `^[a-z0-9][a-z0-9-]{1,62}$`。已存在回 `409 already_exists`。

### `PATCH /tenants/{id}`（owner）

只允許 `name`、`status`、`limits`、`retention`。`id` 不可變。

### `DELETE /tenants/{id}`（owner）

**軟刪除**：設 `status="deleted"`，停止接收該租戶的寫入，保留資料至保留期滿。回 `202` + `{"message":"tenant marked for deletion; telemetry data will expire per retention policy"}`。

硬刪除不提供 API，需管理員在資料庫執行（刻意的摩擦，防止誤刪）。

---

## 3. `/tenants/{t}/apikeys`

### `POST`（admin）

```json
// req
{"name":"prod-agents","scopes":["write:metrics","write:logs","write:traces"],
 "expires_at":"2027-09-05T00:00:00Z"}
// resp 201
{"id":"uuid","name":"prod-agents","key":"pk_acme_7x9K...",  // ★ 只在此回傳一次
 "key_prefix":"pk_acme_","scopes":[...],"expires_at":"...","created_at":"..."}
```

回應必須帶 `Cache-Control: no-store`。

scope 取值：`write:metrics`、`write:logs`、`write:traces`、`read:metrics`、`read:logs`、`read:traces`、`agent`（註冊/心跳/拉配置）、`admin`。

### `GET`（admin）

回傳不含 `key`，只有 `key_prefix`、`last_used_at`、`revoked_at`。

### `DELETE /{id}`（admin）

設 `revoked_at`。必須立即使快取失效——透過行程內的失效事件（單機）或 Postgres `LISTEN/NOTIFY`（多副本）。回 `204`。

---

## 4. `/agents`

### `GET /agents`（viewer）

參數：`status`、`labels`（`k=v,k2=v2`）、`hostname`（前綴匹配）、`limit`、`cursor`。

```json
{"items":[{
  "id":"uuid","hostname":"web-01","os":"linux","arch":"amd64","version":"0.1.0",
  "labels":{"env":"prod","role":"web"},
  "status":"online","last_seen_at":"2026-09-05T10:00:00Z",
  "config_id":"uuid","config_etag":"sha256:...","last_error":"",
  "stats":{"wal_bytes":1048576,"wal_oldest_age_s":3,
           "dropped_total":0,"exported_total":183920,
           "inputs":{"filelog":{"files":4,"lines_total":8123},
                     "hostmetrics":{"points_total":175797}}}
}],"next_cursor":""}
```

`status` 由伺服器依 `last_seen_at` 計算，非 agent 上報：
- `online`：`now - last_seen_at < 3 × heartbeat_interval`
- `degraded`：`online` 且 `last_error != ""` 或 `stats.dropped_total` 近期增長
- `offline`：超過 3 個間隔
- `unknown`：從未心跳

### `PATCH /agents/{id}`（editor）

只允許 `labels` 與 `config_id`。

### `DELETE /agents/{id}`（editor）

移除納管記錄。agent 下次心跳會收到 `404`，應自動重新註冊（見 §5）。

### `POST /agents/register`（scope `agent`）

```json
// req
{"hostname":"web-01","os":"linux","arch":"amd64","version":"0.1.0",
 "labels":{"env":"prod"},"boot_id":"uuid"}
// resp 200
{"agent_id":"uuid","heartbeat_interval":"30s","config_etag":"sha256:..."}
```

**冪等**：同一 `(tenant, hostname)` 重複註冊回同一 `agent_id`。`boot_id` 變更表示主機重啟，記錄但不改 id。

### `POST /agents/{id}/heartbeat`（scope `agent`）

```json
// req
{"version":"0.1.0","config_etag":"sha256:...","last_error":"",
 "stats":{...同上...}}
// resp 200
{"config_changed":false,"heartbeat_interval":"30s",
 "commands":[]}   // 預留：未來可下發 "reload"、"upgrade" 等
```

agent 不存在時回 `404`，agent 應重新走 `/register`。

### `GET /agents/{id}/config`（scope `agent`）

```
If-None-Match: "sha256:abc..."
```

未變更回 `304`（無 body）。變更回 `200`：

```json
{"etag":"sha256:def...","version":7,
 "spec":{"inputs":{...},"process":{...}}}
```

回應帶 `ETag` 標頭。**`spec` 只含 `inputs` 與 `process`**——`output`、`wal`、`limits` 永遠不下發（`08-AGENT-AND-COLLECTORS.md` §8 的安全限制）。伺服器端必須主動剝除，不能依賴 agent 自律。

---

## 5. `/agentconfigs`

### `POST`（editor）

```json
{"name":"web-servers","selector":{"labels":{"role":"web"}},
 "spec":{"inputs":{"hostmetrics":{"interval":"15s"},
                   "filelog":[{"name":"nginx","paths":["/var/log/nginx/*.log"],
                               "labels":{"service":"nginx"}}]},
         "process":{"redact":[{"pattern":"password=\\S+","replace":"password=***"}]}}}
```

伺服器計算 `etag = sha256(canonical_json(spec))`，`version` 自增。

**校驗**：`spec` 必須通過與 agent 端相同的 schema 驗證（共用 `internal/agent/config` 的驗證函式）。校驗失敗回 `400` 並指出具體欄位。

### `POST /agentconfigs/{id}/dryrun`（editor）

回傳「若套用此配置，哪些 agent 會被匹配」：

```json
{"matched_count":12,"agents":[{"id":"...","hostname":"web-01"}],"warnings":[]}
```

---

## 6. `/rulegroups` 與 `/rules`

### `GET /rulegroups`（viewer）

```json
{"items":[{
  "id":"uuid","name":"host","interval":"30s","enabled":true,
  "source":"db",                       // db | file（file 來源唯讀）
  "rules":[{
    "id":"uuid","kind":"alert","name":"HostDiskAlmostFull",
    "expr":"(1 - node_filesystem_avail_bytes / node_filesystem_size_bytes) > 0.85",
    "expr_lang":"promql","for":"10m","keep_firing_for":"5m",
    "labels":{"severity":"warning"},
    "annotations":{"summary":"{{ $labels.instance }} disk at {{ $value | humanizePercentage }}"},
    "enabled":true,"position":0,
    "state":{"health":"ok","last_eval_at":"...","last_eval_duration":"12ms",
             "last_error":"","firing":2,"pending":0}
  }],
  "updated_at":"..."}],"next_cursor":""}
```

`state` 由 ruler 提供，唯讀。`source: "file"` 的群組不可 PUT/DELETE（回 `403` + 明確訊息說明它由檔案管理）。

### `PUT /rulegroups/{id}`（editor）

整組替換（含 rules 陣列）。**必須先校驗全部規則**，任一失敗則整組不變更（原子性）。

### `POST /rulegroups/{id}/validate`（editor）

不儲存，只校驗：

```json
{"valid":false,"errors":[{"rule":"HostDiskAlmostFull","field":"expr",
                          "reason":"unknown function \"foo\""}]}
```

### `POST /rules/preview`（editor）

見 `09-CONTROL-PLANE.md` §3.3。補充：

```json
// req
{"expr":"node_load1 > 2","expr_lang":"promql",
 "labels":{"severity":"warning"},
 "annotations":{"summary":"{{ $labels.instance }} load {{ $value }}"},
 "at":"2026-09-05T10:00:00Z"}   // 選填，預設 now
// resp 200
{"count":2,"duration_ms":45,"warnings":[],
 "alerts":[{"labels":{"alertname":"","instance":"web-01","severity":"warning"},
            "annotations":{"summary":"web-01 load 3.2"},"value":3.2}],
 "template_errors":[]}
```

`count > preview.max_alerts`（預設 100）時截斷並在 `warnings` 說明。查詢受 `query.timeout` 與併發限制約束，不得成為 DoS 管道。

---

## 7. `/receivers` 與通知

### `POST /receivers`（admin）

```json
{"name":"oncall",
 "spec":{"webhook_configs":[{"url_ref":"secret://oncall_webhook","send_resolved":true}],
         "prism_lark_configs":[{"webhook_url_ref":"secret://lark_ops","sign_secret_ref":"secret://lark_sign"}]}}
```

**憑證一律用 `secret://` 引用**，指向 `secrets_dir` 下的檔案或環境變數。API 不接受明文憑證（回 `400`，訊息說明必須用 secret 引用）。

回應中的 `spec` 永遠帶遮罩後的值。

### `POST /receivers/{id}/test`（admin）

```json
// req
{"status":"firing"}   // firing | resolved
// resp 200
{"results":[{"channel":"webhook_configs[0]","ok":true,"duration_ms":142},
            {"channel":"prism_lark_configs[0]","ok":false,"duration_ms":3021,
             "error":"context deadline exceeded"}]}
```

測試發送使用固定的假告警，`alertname="PrismTestAlert"`。**必須明確標示為測試**，避免值班人員誤判。

### `GET /deliveries`（viewer）

參數：`status`（`pending|sent|failed|dead`）、`receiver`、`from`、`to`、`limit`、`cursor`。

```json
{"items":[{"id":"uuid","receiver":"oncall","channel_kind":"webhook_configs",
           "group_key":"{}:{alertname=\"HostDown\"}","status":"dead",
           "attempt":5,"last_error":"500 Internal Server Error",
           "created_at":"...","sent_at":null,
           "alert_count":3,
           "payload_preview":{"status":"firing","alerts":[{"labels":{...}}]}}],
 "next_cursor":""}
```

`payload_preview` 為截斷後的 payload（前 4 KB），憑證已遮罩。完整 payload 需另呼叫 `GET /deliveries/{id}`（admin）。

### `POST /deliveries/{id}/resend`（admin）

重置 `attempt` 與 `next_retry_at`，狀態改回 `pending`。回 `202`。

---

## 8. `/silences`

與 Alertmanager API v2 的 silence 語義相同，但走控制平面的認證與審計。

### `POST /silences`（editor）

```json
{"matchers":[{"name":"alertname","value":"HostDown","isRegex":false,"isEqual":true},
             {"name":"instance","value":"web-.*","isRegex":true,"isEqual":true}],
 "startsAt":"2026-09-05T10:00:00Z","endsAt":"2026-09-05T12:00:00Z",
 "comment":"planned maintenance"}
```

`comment` 必填非空。`createdBy` 由伺服器從認證資訊填入，**不接受客戶端指定**。

`endsAt - startsAt > silences.max_duration`（預設 7 天）時回 `400`（防止「永久靜默」這種常見的壞習慣）。

---

## 9. `/status` 與 `/limits`

### `GET /status`（viewer）

```json
{"version":"0.1.0","git_commit":"abc123","go_version":"go1.23.6",
 "uptime_seconds":86400,"mode":"all-in-one",
 "driver":"clickhouse",
 "capabilities":{ /* 完整的 spi.Capabilities JSON */ },
 "signals":{"metrics":"ok","logs":"ok","traces":"ok"},
 "degraded":[],
 "backend":{"reachable":true,"latency_ms":3,"disk_pressure_level":0},
 "ruler":{"groups":12,"rules":87,"last_eval_at":"...","failing_groups":0},
 "ingest":{"queue_depth":2,"queue_capacity":64,
           "rate_per_sec":{"metrics":1520,"logs":340,"traces":89}}}
```

`signals` 值域：`ok` / `degraded` / `unsupported` / `unavailable`。

**`unsupported` 與 `unavailable` 必須區分**：前者是驅動不支援（如 vmvl 的 traces），後者是後端故障。UI 對兩者的呈現完全不同。

### `GET /limits` / `PATCH /limits`（admin）

```json
{"tenant_id":"acme",
 "effective":{"max_active_series":100000,"max_log_line_bytes":262144,
              "ingest_rate_bytes_per_sec":10485760},
 "overrides":{"max_active_series":100000},
 "defaults":{"max_active_series":500000,"max_log_line_bytes":262144}}
```

回應同時給 `effective`、`overrides`、`defaults` 三層，讓使用者看得出哪些是自己改的。

---

## 10. `/audit`

### `GET /audit`（admin）

參數：`action`（前綴匹配，如 `rule.`）、`actor_id`、`from`、`to`、`limit`、`cursor`。

```json
{"items":[{"id":123,"ts":"...","tenant_id":"acme",
           "actor_type":"user","actor_id":"uuid","actor_label":"ops@example.com",
           "action":"rule.update","resource":"rulegroup/uuid",
           "before":{...},"after":{...},
           "ip":"10.0.0.5","user_agent":"prismctl/0.1.0"}],
 "next_cursor":""}
```

`action` 命名規範：`<resource>.<verb>`，verb 取 `create|update|delete|test|resend|login|logout|revoke`。

**審計日誌唯讀**，無任何寫入或刪除 API。清理由保留期任務執行。

---

## 11. OpenAPI 與實作一致性

`api/openapi/console-v1.yaml` 是規格的**唯一真實來源**。CI 檢查：

1. 每個實作的路由都能在 spec 中找到（用 chi 的路由樹遍歷比對）
2. 每個 spec 中的路由都有實作
3. 對每個端點，用 spec 的 example 發請求，校驗回應符合 schema
4. 錯誤回應的 `code` 值在 spec 的 enum 內

第 3 項需要一組可重現的種子資料（`test/fixtures/console_seed.sql`），在測試前載入。

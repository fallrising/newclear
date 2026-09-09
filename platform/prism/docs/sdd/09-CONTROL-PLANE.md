# 09 — 控制平面

套件：`internal/controlplane`。這是 Prism 唯一「非標準協議」的部分，也是產品差異化所在。

## 1. 職責邊界

控制平面**只管元資料，不碰遙測資料**。

| 在控制平面 | 不在控制平面 |
|---|---|
| 租戶、使用者、角色、API key | 指標 / 日誌 / span |
| 主機與 Agent 納管、配置下發 | 查詢執行 |
| 告警規則 CRUD、靜默、通知渠道 | 告警評估（在 ruler） |
| 通知投遞記錄與重送 | — |
| 保留策略、配額設定 | 保留策略的執行（在驅動） |
| 審計日誌 | — |

## 2. Postgres Schema

遷移檔置於 `internal/controlplane/migrations/NNN_name.up.sql` / `.down.sql`，用 `golang-migrate` 或等價工具，啟動時自動執行。

```sql
CREATE TABLE tenants (
    id          TEXT PRIMARY KEY,              -- slug，如 'default'
    name        TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'active',-- active|suspended
    limits      JSONB NOT NULL DEFAULT '{}',   -- 覆寫 04 §5 的限制
    retention   JSONB NOT NULL DEFAULT '{}',   -- {metrics_days, logs_days, traces_days}
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id            UUID PRIMARY KEY,
    email         CITEXT UNIQUE NOT NULL,
    password_hash TEXT,                         -- argon2id；OIDC 使用者為 NULL
    display_name  TEXT NOT NULL DEFAULT '',
    status        TEXT NOT NULL DEFAULT 'active',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
    user_id   UUID REFERENCES users(id) ON DELETE CASCADE,
    tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
    role      TEXT NOT NULL,                    -- owner|admin|editor|viewer
    PRIMARY KEY (user_id, tenant_id)
);

CREATE TABLE api_keys (
    id          UUID PRIMARY KEY,
    tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    key_prefix  TEXT NOT NULL,                  -- 前 8 字元，供 UI 辨識
    key_hash    TEXT NOT NULL,                  -- sha256(full key)
    scopes      TEXT[] NOT NULL,                -- write:metrics, read:logs, admin …
    expires_at  TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    revoked_at  TIMESTAMPTZ,
    created_by  UUID REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ON api_keys (key_hash);

CREATE TABLE agents (
    id            UUID PRIMARY KEY,
    tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    hostname      TEXT NOT NULL,
    os            TEXT NOT NULL DEFAULT '',
    arch          TEXT NOT NULL DEFAULT '',
    version       TEXT NOT NULL DEFAULT '',
    labels        JSONB NOT NULL DEFAULT '{}',
    config_id     UUID,                         -- 指向 agent_configs
    config_etag   TEXT NOT NULL DEFAULT '',
    status        TEXT NOT NULL DEFAULT 'unknown', -- online|offline|degraded|unknown
    last_seen_at  TIMESTAMPTZ,
    last_error    TEXT,
    stats         JSONB NOT NULL DEFAULT '{}',  -- WAL 深度、丟棄計數等心跳摘要
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ON agents (tenant_id, hostname);
CREATE INDEX ON agents (tenant_id, status, last_seen_at DESC);

CREATE TABLE agent_configs (
    id          UUID PRIMARY KEY,
    tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    selector    JSONB NOT NULL DEFAULT '{}',    -- 依 labels 匹配 agents
    spec        JSONB NOT NULL,                 -- inputs / process 設定
    etag        TEXT NOT NULL,                  -- sha256(spec)
    version     INT  NOT NULL DEFAULT 1,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE rule_groups (
    id          UUID PRIMARY KEY,
    tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    interval_s  INT  NOT NULL DEFAULT 30,
    enabled     BOOLEAN NOT NULL DEFAULT true,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ON rule_groups (tenant_id, name);

CREATE TABLE rules (
    id          UUID PRIMARY KEY,
    group_id    UUID NOT NULL REFERENCES rule_groups(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL,                  -- alert|record
    name        TEXT NOT NULL,
    expr        TEXT NOT NULL,
    expr_lang   TEXT NOT NULL DEFAULT 'promql', -- promql|logql
    for_s       INT  NOT NULL DEFAULT 0,
    keep_firing_for_s INT NOT NULL DEFAULT 0,
    labels      JSONB NOT NULL DEFAULT '{}',
    annotations JSONB NOT NULL DEFAULT '{}',
    enabled     BOOLEAN NOT NULL DEFAULT true,
    position    INT NOT NULL DEFAULT 0,         -- 組內順序
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE alert_state (
    tenant_id   TEXT NOT NULL,
    fingerprint BIGINT NOT NULL,
    rule_id     UUID,
    labels      JSONB NOT NULL,
    state       SMALLINT NOT NULL,              -- 0 inactive 1 pending 2 firing
    active_at   TIMESTAMPTZ,
    fired_at    TIMESTAMPTZ,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, fingerprint)
);

CREATE TABLE silences (
    id          UUID PRIMARY KEY,
    tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    matchers    JSONB NOT NULL,
    starts_at   TIMESTAMPTZ NOT NULL,
    ends_at     TIMESTAMPTZ NOT NULL,
    created_by  TEXT NOT NULL,
    comment     TEXT NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON silences (tenant_id, ends_at);

CREATE TABLE receivers (
    id          UUID PRIMARY KEY,
    tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    spec        JSONB NOT NULL,                 -- 憑證以 secret ref 形式存放
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ON receivers (tenant_id, name);

-- notification_deliveries 見 07-ALERTING.md §6.2

CREATE TABLE audit_log (
    id          BIGSERIAL PRIMARY KEY,
    ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
    tenant_id   TEXT,
    actor_type  TEXT NOT NULL,                  -- user|apikey|system
    actor_id    TEXT NOT NULL,
    action      TEXT NOT NULL,                  -- rule.create, silence.delete …
    resource    TEXT NOT NULL,
    before      JSONB,
    after       JSONB,
    ip          INET,
    user_agent  TEXT
);
CREATE INDEX ON audit_log (tenant_id, ts DESC);
CREATE INDEX ON audit_log (action, ts DESC);
```

## 3. REST API

Base path `/api/console/v1`。JSON。認證：`Authorization: Bearer <jwt>` 或 `<api_key>`（需 `admin` scope）。

### 3.1 錯誤格式

```json
{"error": {"code": "invalid_argument", "message": "...", "details": [{"field":"expr","reason":"parse error at 1:5"}]}}
```

`code` 取值：`invalid_argument`、`unauthenticated`、`permission_denied`、`not_found`、`already_exists`、`resource_exhausted`、`internal`、`unavailable`。

### 3.2 端點

| 方法 | 路徑 | 權限 |
|---|---|---|
| POST | `/auth/login` | — |
| POST | `/auth/refresh` | — |
| GET | `/me` | 任意已認證 |
| GET/POST | `/tenants` | owner |
| GET/PATCH/DELETE | `/tenants/{id}` | owner |
| GET/POST | `/tenants/{t}/apikeys` | admin |
| DELETE | `/tenants/{t}/apikeys/{id}` | admin |
| GET | `/agents` | viewer |
| GET/PATCH/DELETE | `/agents/{id}` | editor |
| POST | `/agents/register` | agent key |
| POST | `/agents/{id}/heartbeat` | agent key |
| GET | `/agents/{id}/config` | agent key |
| GET/POST | `/agentconfigs` | editor |
| GET/PUT/DELETE | `/agentconfigs/{id}` | editor |
| GET/POST | `/rulegroups` | editor |
| GET/PUT/DELETE | `/rulegroups/{id}` | editor |
| POST | `/rulegroups/{id}/validate` | editor |
| POST | `/rules/preview` | editor（乾跑一條 expr，回目前會觸發哪些告警） |
| GET/POST | `/receivers` | admin |
| GET/PUT/DELETE | `/receivers/{id}` | admin |
| POST | `/receivers/{id}/test` | admin（發一則測試通知） |
| GET | `/deliveries` | viewer（投遞記錄，支援 status/時間過濾） |
| POST | `/deliveries/{id}/resend` | admin |
| GET | `/audit` | admin |
| GET | `/limits` / PATCH | admin |
| GET | `/status` | viewer（驅動能力、版本、健康度） |

`GET /status` 必須回傳目前驅動的完整 `Capabilities`：

```json
{"version":"0.1.0","driver":"clickhouse","capabilities":{...},
 "signals":{"metrics":"ok","logs":"ok","traces":"ok"},
 "degraded":[],"uptime_seconds":12345}
```

**這個端點是「可換底層」對使用者的可見面**：換驅動後，Console 上的能力矩陣會直接改變，使用者能理解為何某些功能變快或變慢。

### 3.3 `POST /rules/preview`

輸入一條 `expr`，立刻執行並回傳「若此刻評估，會產生哪些告警」。這是自建告警平台最實用的功能之一，v1 必做。

```json
// req
{"expr":"node_load1 > 2","expr_lang":"promql","labels":{"severity":"warning"},
 "annotations":{"summary":"{{ $labels.instance }} load {{ $value }}"}}
// resp
{"count":2,"alerts":[{"labels":{...},"annotations":{"summary":"h1 load 3.2"},"value":3.2}],
 "duration_ms":45,"warnings":[]}
```

模板必須實際渲染，讓使用者在儲存前就看到通知長什麼樣。

## 4. 認證與授權

- **密碼**：argon2id，參數 `time=3, memory=64MB, threads=4`。
- **JWT**：HS256，`exp` 15 分鐘；refresh token 存 Postgres（可撤銷），7 天。密鑰從 `auth.jwt_secret_file` 讀取，長度 < 32 bytes 時啟動失敗。
- **API key**：格式 `pk_<tenant>_<32 隨機 base62>`，只在建立時回傳一次明文。儲存 sha256。
- **RBAC**：

| 角色 | 權限 |
|---|---|
| `viewer` | 讀遙測資料、讀規則、讀告警、讀投遞記錄 |
| `editor` | viewer + 規則/靜默/agent 配置的 CRUD |
| `admin` | editor + API key、receiver、限制、審計 |
| `owner` | admin + 租戶管理、成員管理 |

- 授權檢查在 middleware 統一做，**禁止在 handler 內散落權限判斷**。
- 所有寫操作寫入 `audit_log`，含 before/after（敏感欄位遮罩）。

## 5. 多租戶隔離

三道防線，缺一不可：

1. **API 層**：middleware 從 JWT/API key 解出 tenant，注入 context。所有 store 方法**必須**接受 tenant 參數，簽章上不允許「不帶 tenant 的查詢」。
2. **SQL 層**：所有查詢帶 `WHERE tenant_id = $1`。CI 用靜態檢查掃描 `internal/controlplane/store` 中是否有未帶 tenant 條件的查詢。
3. **儲存層**：`WithTenantGuard`（見 `03-STORAGE-SPI.md` §6）。

**跨租戶洩漏是這類平台最嚴重的安全缺陷**，測試必須包含專門的越權測試（見 `10-CONFORMANCE-TESTING.md` §6）。

## 6. Console UI（v1 範圍極小）

v1 只做控制平面 CRUD，**不做儀表板**（用 Grafana）。

技術：React + TypeScript + Vite，靜態檔案由 `prismd` 內嵌（`embed.FS`）並服務於 `/console`。

頁面清單（v1）：

1. 登入
2. 總覽：驅動能力、各訊號健康度、寫入速率、活躍告警數
3. 主機列表：agent 狀態、版本、最後心跳、WAL 深度、丟棄計數
4. 規則管理：列表 / 編輯 / preview / 啟停
5. 告警：目前 firing/pending，一鍵建立靜默
6. 靜默管理
7. 通知渠道：CRUD + 測試發送
8. 投遞記錄：狀態過濾、錯誤詳情、重送
9. 設定：API key、限制、保留策略
10. 審計日誌

**每個頁面都必須有「這在 Grafana 做不到」的理由**。做得到的（曲線、日誌搜尋、trace 瀑布圖）一律不做，改為提供「在 Grafana 中開啟」的深層連結。

## 7. 驗收標準

- P1：`admin` 建立 API key 後，用該 key 寫入資料成功；撤銷後立刻失敗（快取 TTL 內以事件失效）。
- P2：租戶 A 的 `viewer` 用任何方式（改 header、改參數、猜 UUID）都無法讀到租戶 B 的資料或元資料。
- P3：所有寫操作在 `audit_log` 留下可追溯記錄。
- P4：`POST /rules/preview` 對含模板的規則回傳已渲染的 annotation。
- P5：`GET /status` 在切換 `storage.driver` 後回報不同的能力矩陣。
- P6：`POST /receivers/{id}/test` 對每種渠道都能實際送出測試訊息。

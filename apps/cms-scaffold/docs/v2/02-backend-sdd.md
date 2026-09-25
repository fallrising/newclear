# 02 — 後端 v2 SDD（v0.1）

[回 v2 索引](README.md)

狀態：**Draft v0.1**（第一版，待細化）  
日期：2026-09-25  
讀者：負責改 `services/cms-api` 的 LLM agent，以及審這些 PR 的人  
輸入：[01 前端 SDD §9 後端缺口](01-frontend-sdd.md#9-後端缺口前端需要的-api)、[總綱](../sdd/00-overview.md)、`docs/specs/kernel-{content,identity,media}.md`、現有原始碼（`main` @ `a5a87bb`）

---

## 0. 權威範圍

| 題目 | 權威來源 | 本文的角色 |
| --- | --- | --- |
| 技術棧、kernel 切面、發布狀態機、權限模型的大原則 | 總綱（凍結） | 遵守，不改 |
| 內容、身份、媒體的領域規則 | `kernel-*.md` | 沿用；本文只列 v2 的變更 |
| v2 的 API 變更、資料表變更、品質閘門、後端波次 | **本文** | 權威 |
| API 位元組級契約 | `openapi.yaml` | 本文定規則，實際契約寫在 YAML 裡，由測試保證一致 |

**v2 後端的定義：** 在同一個 `cms-api` 上做**增量演進**，不重寫。目標只有三個：讓前端 v2 能做出來（補 [01 §9](01-frontend-sdd.md#9-後端缺口前端需要的-api) 的 G-01～G-11）；讓 kernel 不再認得 demo 的欄位名；讓契約和持久層有測試保證。

---

## 1. 現況盤點

### 1.1 保留的部分

| 能力 | 位置 | 評價 |
| --- | --- | --- |
| 發布狀態機（draft／published／archived、工作副本與 `published_payload` 分離、`dirty`、revision 保留 N 版） | `EntryService` | 設計正確，保留 |
| 權限模型（role × action × type allowlist × surface，另有 `fieldEquals` predicate） | `AuthorizationService` | 保留；需要效能與列表支援（B-10、B-12） |
| 以 Origin 判定 surface，Front 硬拒絕草稿類動作 | `IdentityRequestFilter`、`CmsAction.FRONT_HARD_DENY` | 保留，這是「Front 看不到草稿」的第一道防線 |
| Session cookie + double-submit CSRF、Argon2、登入鎖定 | identity 套件 | 保留 |
| 媒體衍生圖（original／thumbnail／web）與「未發布媒體不可匿名讀」 | `MediaService` | 保留 |
| `cms_entry_ref` 關聯表 | V3 migration | 保留，列表的 `ref.<field>` 已經在用 |
| 「OpenAPI 路徑與實作路由必須一致」的契約測試 | `OpenApiContractTests` | 保留並擴充（BD-03） |

### 1.2 問題（B 系列）

| ID | 級 | 問題 | 證據 |
| --- | --- | --- | --- |
| B-01 | P0 | OpenAPI 只有路徑，**幾乎沒有 schema**（`components.schemas` 只有 `Health`、`LoginRequest`、`ErrorEnvelope`），回應都只寫一句描述。前端無法從它產生型別（前端 D-04 會落空）。另有幾個狀態碼與程式不符：`PUT /principals/{id}/roles` 與 `PUT /roles/{code}/permissions` 實際回 204（文件寫 200），`POST /principals/{id}/password` 實際回 200 帶 body（文件寫 204），`POST /media` 的錯誤實際是 409／413／415（文件寫 422）。 | `openapi.yaml:474-535`；`PrincipalController.java:85,96-102,126`；`MediaException.java:24-46` |
| B-02 | P1 | 列表沒有分頁。工作列表一次回全部；公開列表先撈出該類型的全部 published entry，再在 Java 裡逐筆過濾可見性、predicate 與關聯是否公開，每筆都要額外查詢（N+1）。資料一多就會變慢，而且 `total` 永遠等於本頁筆數。 | `EntryController.java:80`、`EntryService.java:389-404` |
| B-03 | P1 | kernel 寫死了 demo 的欄位名：工作投影的標題讀 `title`、搜尋用 `payload->>'title'`、公開排序讀 `sortOrder`、公開可見性讀 `visibility`。標題欄位不叫 `title` 的類型（`clinic_profile` 的是 `name`），標題和搜尋都會失效。 | `ContentProjection.java:22`、`JdbcContentStore.java`（`listEntries` 的 `q`）、`InMemoryContentStore.java:188`、`EntryService.java`（`publicOrder`）、`PublicVisibility.java:18` |
| B-04 | P1 | 使用者查不到「自己能做什麼」。`/auth/me` 只回傳角色代碼；`effective-permissions` 需要 `manage_principals`。 | `AuthController.java`（`mePayload`）、`PrincipalAdminService.java:179` |
| B-05 | P1 | 欄位的中繼資料已存在資料表（`help_text`、`visibility`、`sort_order`、`validations`、`default_value`），但 API 沒有輸出；也沒有顯示名稱、分組、列表欄、enum 選項名稱這些欄位。 | V3 `cms_field`；`AdminContentController.typeJson` |
| B-06 | P1 | 驗證遇到第一個錯誤就拋出，錯誤沒有欄位路徑；`datetime`、`string` 完全不驗證（長度、格式都不檢查）。 | `EntryService.validatePayload` |
| B-07 | P1 | 審計不完整：只有登入、使用者管理與 purge 寫審計；publish、unpublish、archive、restore、類型啟停、導覽發布、媒體刪除都沒有記錄。審計查詢不能分頁，也不回傳操作者。 | `EntryService.java:348` 是唯一的內容類審計；`AdminContentController.java:163-181` |
| B-08 | P1 | PostgreSQL 版的 content 與 media store 沒有任何測試。`./gradlew test` 的 53 個測試全部跑在 in-memory store 上；`integrationTest` 只測 identity，而且 CI 沒有跑它。兩種 store 的行為已經不一致：BW0 細化時以契約測試找到 9 處（排序、部分欄位更新、重複 key、`q` 的萬用字元、NULL jsonb 讀成空 Map 等），清單見 [waves/BW0.md §5.4](waves/BW0.md#54-store-行為對齊02-bd-10)。 | `src/integrationTest/` 只有一個檔案；`.github/workflows/cms-scaffold-ci.yml` |
| B-09 | P2 | `cms_entry_index` 資料表建了卻沒人寫入（程式碼裡只有 DELETE），所以無法依欄位值篩選。 | `JdbcContentStore.java:251` |
| B-10 | P1 | 帶 predicate 的授權（例如「只能讀 `ownerPrincipalId` 是自己的」）不能用在列表：列表授權時傳入的 entry 是 `null`，predicate 一律判定為拒絕。所以會員「看自己的寵物」這種功能沒辦法做。 | `EntryService.listWork`、`AuthorizationService.predicateAllows` |
| B-11 | P2 | 缺 surface 規格要求的能力：請求發布、會員自己的資料與預約、可指派的使用者清單、原子的批次更新。 | surface-back §4.7、surface-front §4.2 |
| B-12 | P2 | 每次授權判斷都重新查角色與權限；公開列表對每一筆 entry 都判斷一次，一個請求可能產生數百次查詢。 | `AuthorizationService.collectGrants` |
| B-13 | P2 | 公開投影中，無法公開的媒體引用會原樣留下 UUID（`orElse(raw)`），洩漏未發布媒體的 id。 | `PublicContentController.java:119` |
| B-14 | P2 | 錯誤信封由三個 `@RestControllerAdvice`（content、media、identity）加上 filter 層的 `IdentityErrorWriter` 各自產生，形狀相近但欄位不完全一致；媒體的錯誤代碼是小寫（`not_found`、`quota_exceeded`…），其他是大寫；也沒有文件列出所有錯誤代碼。壞 JSON、壞 UUID、錯的 method 等框架層錯誤回 Spring 預設格式，`ref.<field>` 不是 UUID、未知的 principal `status` 直接變成 500。 | `ContentExceptionHandler`、`MediaExceptionHandler`、`IdentityExceptionHandler`、`IdentityErrorWriter`；`MediaException.java:24-46`；`EntryController.java:72`、`PublicContentController.java:73`、`PrincipalAdminService.java:83` |
| B-15 | P1 | `JdbcIdentityStore` 的 last-admin guard 以 `queryForObject(..., Long.class)` 讀 `pg_advisory_xact_lock`，但該函式回傳 `void`，所以在 PostgreSQL 上所有 `*KeepingUsableAdmin`（停用使用者、改角色、改權限）一律丟 `DataIntegrityViolationException`。既有的 `JdbcIdentityStoreIntegrationTests.lastAdminGuardRejectsRemovingAdministrativeCapability` 在真實 PostgreSQL 上是紅的，因為 CI 沒跑所以沒人發現（BW0 細化時以 PostgreSQL 16.13 重現）。 | `JdbcIdentityStore.java:296` |

---

## 2. 決策

| ID | 決策 | 理由 | 解決 |
| --- | --- | --- | --- |
| BD-01 | 技術棧不變：Java 25、Spring Boot 3.5、Gradle、PostgreSQL 16、Flyway、JDBC（不引入 JPA）。 | 總綱凍結；現有 JDBC store 清楚、夠用 | — |
| BD-02 | **API 維持 `/api/v1`，以增量方式演進。** 新增欄位與參數不算破壞性變更。確實需要的破壞性變更只有 §4.4 列出的三項，並與前端同一波一起上線。 | 唯一的 API 使用者就是本 repo 的三個前端，而它們正要重寫；另開 `/api/v2` 只會多出兩套要維護的路由 | — |
| BD-03 | **OpenAPI 仍然手寫，並且必須完整。** 每個 operation 都要有 request／response schema、錯誤回應與錯誤代碼。測試用 OpenAPI validator 檢查每個 MockMvc 回應都符合 schema。 | 前端 codegen 的前提（B-01）；手寫 YAML 讓契約先於實作 | B-01、B-14 |
| BD-04 | **列表查詢全部下推到 SQL**：分頁、排序、搜尋、狀態、欄位篩選、關聯篩選、公開可見性，以及可編譯的 predicate。 | 讓 `total` 正確，並消除 N+1（B-02） | B-02、B-09、B-10、B-12 |
| BD-05 | **kernel 不認 demo 欄位名。** 內容類型新增三個設定：`sortField`、`visibilityField`、`ownerField`；標題一律用既有的 `titleField`。 | 總綱 §6：kernel 只知道 ContentType 與 Field | B-03 |
| BD-06 | 欄位中繼資料對外輸出，並補齊 `label`、`group`、`listable`、`filterable`、`enumLabels`、`placeholder`。 | 前端 schema 驅動表單需要（G-05、G-06） | B-05 |
| BD-07 | `/auth/me` 新增 `capabilities`：依**目前 surface** 算出每個類型可做的動作，以及全域動作。 | 前端側欄與按鈕顯隱需要（G-01）；只回傳呼叫者自己的權限，不外洩別人的 | B-04 |
| BD-08 | 錯誤信封統一成一個 handler，並新增 `error.fields: [{ field, code, message }]`；驗證一次收集所有錯誤。不改用 RFC 7807。 | 保留現有信封，變動最小；表單需要欄位級錯誤 | B-06、B-14 |
| BD-09 | 所有狀態變更與治理操作，都在**同一個 transaction** 內寫審計；審計查詢支援分頁與多條件篩選。 | surface-admin §7.1 的要求 | B-07 |
| BD-10 | **一套 store 契約測試，兩種 store 都要過。** 同一組抽象測試在 `test`（in-memory，不需要 Docker）與 `integrationTest`（Testcontainers PostgreSQL）各跑一次；CI 新增 `integrationTest` job。 | 遵守 AGENTS.md「`./gradlew test` 不需要 Docker」的規定，同時讓 JDBC store 有保證 | B-08 |
| BD-11 | 新增一個**通用**的批次更新端點（`POST /api/v1/entries:batch-patch`），全部成功才提交，最多 100 筆。它不是為某個 demo 開的專用 API。 | 相簿重排需要原子性（G-09）；surface-back §3.2 禁止的是 demo 專用的寫入 API | B-11 |
| BD-12 | 「自己擁有的 entry」做成 kernel 原語：類型若設定了 `ownerField`，就開放 `/api/v1/me/...` 端點，由伺服器自動套用「owner＝自己」。 | 會員區（G-08）的通用解法，不是寫死給診所用 | B-10、B-11 |
| BD-13 | 維持單一 `cms_session` cookie，以 Origin 判定 surface。surface-front AC-16（Back 使用者在 Front 仍看不到草稿）由公開 API 只讀 `published_payload` 來保證。 | 關閉前端 Q-07；公開 API 本來就忽略高權限角色 | — |
| BD-14 | 預覽維持 session 式的 `GET /preview/entries/{id}`；token 預覽（surface-back §3.4）延後，不在 v2 範圍。 | v2 前端只做編輯器內預覽 | — |

---

## 3. 資料模型變更

### 3.1 V5 — 類型設定與欄位中繼資料

```sql
ALTER TABLE cms_content_type
    ADD COLUMN sort_field       VARCHAR(63),     -- 公開列表的預設排序欄；null 表示依 published_at DESC
    ADD COLUMN visibility_field VARCHAR(63),     -- 值為 public / unlisted / private 的 enum 欄；null 表示全部公開
    ADD COLUMN owner_field      VARCHAR(63);     -- principal-ref 欄；非 null 時開放 /me 端點

ALTER TABLE cms_field
    ADD COLUMN label        VARCHAR(80),
    ADD COLUMN group_key    VARCHAR(32),         -- main / media / relations / settings，或自訂
    ADD COLUMN listable     BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN filterable   BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN enum_labels  JSONB,               -- {"in_progress": "進行中", ...}
    ADD COLUMN placeholder  VARCHAR(120);
```

種子（`ContentTypeSeed`）同步更新：`album`／`project` 設定 `visibility_field='visibility'`；`photo`／`milestone` 設定 `sort_field='sortOrder'`；`pet`／`visit`／`owner` 設定 `owner_field='ownerPrincipalId'`；各欄位補上 zh-Hant 的 `label` 與 `enum_labels`。

`PublicVisibility` 改成讀 `type.visibilityField()`；`publicOrder` 改成讀 `type.sortField()`；工作投影與搜尋改用 `type.titleField()`。

施工細節見 `waves/BW1a.md` §4.5、§5.1～§5.3。

### 3.2 V6 — 欄位索引真正被寫入

- 條件：`cms_field.indexed = true` 的欄位、`titleField`、`sortField`、`visibilityField`、`ownerField`。
- 時機：在 `create`、`patch`、`publish`、`revert` 的同一個 transaction 內，重建該 entry 的索引列。
- **兩份索引**：新增 `scope` 欄（`work` 或 `published`）。工作列表查 `work`，公開列表查 `published`，這樣公開列表不會被未發布的修改影響。

```sql
ALTER TABLE cms_entry_index ADD COLUMN scope VARCHAR(12) NOT NULL DEFAULT 'work';
ALTER TABLE cms_entry_index ADD CONSTRAINT cms_entry_index_scope_chk CHECK (scope IN ('work', 'published'));
CREATE INDEX cms_entry_index_str_idx ON cms_entry_index (field_key, scope, value_string);
CREATE INDEX cms_entry_index_ts_idx  ON cms_entry_index (field_key, scope, value_ts);
CREATE INDEX cms_entry_index_int_idx ON cms_entry_index (field_key, scope, value_int);
CREATE INDEX cms_entry_index_entry_idx ON cms_entry_index (entry_id, scope);
```

- 既有資料的回填：用 Flyway Java migration `V7__backfill_entry_index`，逐類型讀出 entry 並重建索引。
- **BW1b 細化後補充：** 索引的欄位另外包含 `publicRequiresPublishedRefs` 列出的欄位（公開列表要在 SQL 裡判斷「必要關聯必須公開」）；V6 另外加上 `value_kind` 的 CHECK，並刪除被 `cms_entry_index_str_idx` 取代的 `cms_entry_index_lookup_idx`；寫入 entry 與重建索引在同一個交易，修改類型設定或新增欄位時也重建該類型的索引。

施工細節見 `waves/BW1b.md` §4.5、§5.1。

### 3.3 V8 — 請求發布與審計查詢

```sql
ALTER TABLE cms_entry
    ADD COLUMN publish_requested_at TIMESTAMPTZ,
    ADD COLUMN publish_requested_by UUID;
CREATE INDEX cms_entry_publish_requested_idx ON cms_entry (content_type_id)
    WHERE publish_requested_at IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX cms_audit_event_target_idx   ON cms_audit_event (target_type, target_id);
CREATE INDEX cms_audit_event_action_at_idx ON cms_audit_event (action, at DESC);
```

**不變的規則：** 不為 demo 建實體表；`appointment_request` 仍然是一個內容類型（§4.3 G-08）。

---

## 4. API 變更

### 4.1 列表查詢（G-02）

適用於 `GET /content-types/{typeKey}/entries`（工作）與 `GET /public/content-types/{typeKey}/entries`（公開）。

| 參數 | 說明 | 工作 | 公開 |
| --- | --- | --- | --- |
| `page`（從 1 開始）、`size`（預設 20，最大 100） | 分頁 | ✓ | ✓ |
| `sort` | `updatedAt`、`createdAt`、`title`、`publishedAt`，或 sortable 欄位；前面加 `-` 表示遞減 | ✓（預設 `-updatedAt`） | ✓（預設依 `sortField`，否則 `-publishedAt`） |
| `q` | 對 `titleField` 做不分大小寫的包含搜尋 | ✓ | ✓ |
| `state` | 逗號分隔的發布狀態 | ✓（預設 `draft,published`） | ✗（帶了回 400，維持現行 `rejectAudienceParams`） |
| `filter.<field>` | `filterable` 欄位的等值比對；datetime 欄可以用 `filter.<field>.from`／`.to` | ✓ | ✓（只能用可見性為 `public` 的欄位） |
| `ref.<field>` | 關聯篩選（沿用現行） | ✓ | ✓ |
| `publishRequested=true` | 只列出已請求發布的 | ✓ | ✗ |
| `include=refs` | 展開關聯的摘要（G-10，§4.3） | ✓ | ✗ |

回應（新增 `page`、`size`，保留 `offset`、`limit` 以相容舊版）：

```json
{ "items": [ ... ], "total": 57, "page": 2, "size": 20, "offset": 20, "limit": 20 }
```

**授權如何下推到 SQL（BD-04，修 B-10）：**

1. 先收集呼叫者對該類型、該動作的所有 grant（同一個請求內快取，修 B-12）。
2. 只要有任何一個 grant 不帶 predicate，就不加額外條件。
3. 否則，把每個 `fieldEquals` predicate 編譯成一個以 `cms_entry_index` 為對象的 `EXISTS` 子句，多個 grant 之間用 `OR` 連接。predicate 引用的欄位若沒有建索引，**啟動時就失敗**（fail fast），而不是在執行期悄悄漏資料。
4. 公開列表另外加上：`publication_state = 'published'`、`published_payload IS NOT NULL`、可見性欄位不等於 `private`／`unlisted`，以及 `publicRequiresPublishedRefs` 的 `EXISTS` 子句。

**BW1b 細化後補充：** 第 4 點的可見性精確寫法是「有值且不等於 `public` 就排除」，與 BW1a 的 `PublicVisibility.indexable` 相同（種子的 enum 只有 `public`、`unlisted`、`private`，所以結果與上文一致）。`filter.<field>` 另外要求欄位有索引列；公開列表的 `ref.<field>` 只接受可見性 `public` 的關聯欄位；除了 `ref.<field>`，重複的參數回 400。修改角色權限時送入無法下推的 predicate，回 400 `VALIDATION_FAILED`。

施工細節見 `waves/BW1b.md` §4.3、§4.4、§5.5。

### 4.2 身份與能力（G-01、G-04）

`GET /api/v1/auth/me` 的回應新增：

```json
{
  "capabilities": {
    "surface": "back",
    "types": [
      { "key": "album", "actions": ["read_draft", "create", "update", "publish", "unpublish", "archive"], "scoped": false },
      { "key": "pet",   "actions": ["read_draft", "update"], "scoped": true }
    ],
    "global": ["manage_media"]
  }
}
```

- `scoped: true` 表示權限帶有 predicate，只對部分 entry 有效。前端仍然要準備處理 403。
- 只計算已啟用的類型；`FRONT_HARD_DENY` 與 `BACK_HARD_DENY` 已經先套用。

施工細節（`capabilities`）見 `waves/BW1a.md` §4.4、§5.5。

新增 `GET /api/v1/principals/assignable?contentType=issue&q=`：只回傳 `id` 與 `displayName`；呼叫者必須對該類型有 `update`；最多 20 筆。

施工細節（可指派的定義：啟用中、在 Back 對該類型有 `update`）見 `waves/BW2.md` §4.4、§5.6。

### 4.3 內容寫入

| ID | 端點 | 規則 |
| --- | --- | --- |
| G-03 | `POST /api/v1/entries/{id}/publish-request`、`DELETE` 同一路徑 | 需要 `update`，且狀態必須是 `draft`（或 published 且 `dirty`）；設定或清除 `publish_requested_*`；寫審計。`publish` 成功後自動清除。 |
| G-07 | `PATCH /api/v1/entries/{id}` | payload 中值為 `null` 的鍵代表**清空**（儲存為 JSON null）。依原始碼（`patch` 以 `putAll` 合併、驗證跳過空值），現行行為應該已經是這樣，但沒有測試；v2 把它寫進 OpenAPI，並用契約測試固定下來。 |
| G-09 | `POST /api/v1/entries:batch-patch` | `{ "items": [ { "id", "version", "payload" } ] }`，1～100 筆；在單一 transaction 內，對每一筆執行與單筆 PATCH 相同的授權與驗證；任何一筆失敗就全部回滾，回 409 或 422，並在 `error.fields` 中以 `items[3].payload.sortOrder` 的形式指出是哪一筆的哪個欄位。 |
| G-10 | 工作列表與 `GET /entries/{id}` 支援 `include=refs` | 回應新增 `refs: { "<fieldKey>": { "id", "contentType", "title", "publicationState" } }`；呼叫者沒有目標類型 `read_draft` 權限時，該關聯只回傳 `{ "id", "restricted": true }`。用一次 `IN` 查詢取得，不做 N+1。 |
| G-11 | 所有投影 | 標題一律取 `payload[type.titleField]`。 |

G-07 施工細節見 `waves/BW1c.md` §4.2（清空欄位）。G-03、G-09、G-10 施工細節見 `waves/BW2.md` §5.5、§5.7、§5.8。

### 4.4 破壞性變更（與前端同一波上線）

| 變更 | 原因 | 上線波次 |
| --- | --- | --- |
| `PATCH /entries/{id}` 必須帶 `version`，缺少時回 **428** `VERSION_REQUIRED` | 防止靜默覆蓋；v1 前端有時不帶 | BW1c + 前端 W1 |
| 公開投影中無法公開的媒體引用改回傳 `null`，不再回傳原始 UUID | 修 B-13 | BW1c + 前端 W3 |
| 422 錯誤一次回傳所有欄位錯誤（`error.fields`），`error.message` 只是摘要 | BD-08 | BW1c + 前端 W1 |

施工細節（前後對照、驗證規則、`error.fields` 路徑格式）見 `waves/BW1c.md` §4.2、§4.3。

### 4.5 會員（G-08）

只有設定了 `ownerField` 的類型才開放：

| 端點 | 規則 |
| --- | --- |
| `GET /api/v1/me/content-types/{typeKey}/entries` | 只回傳 `ownerField = 呼叫者` 的 entry；回傳公開投影的欄位，但**包含草稿**（這是會員自己的資料，例如尚未確認的預約）。只允許 Front surface。 |
| `GET /api/v1/me/entries/{id}` | 非本人回 **403**（不用 404 假裝不存在，surface-front AC-11）。 |
| `POST /api/v1/me/content-types/{typeKey}/entries` | 需要該類型的 `create` 權限；伺服器**強制**把 `ownerField` 設成呼叫者（忽略客戶端傳來的值）；永遠建立為 `draft`；請求中若帶 `publicationState` 就回 400。有頻率限制：每位會員每分鐘 5 次，超過回 429。 |

Clinic demo pack 新增 `appointment_request` 內容類型（欄位：`pet` ref、`preferredAt` datetime、`reason` string、`ownerPrincipalId` principal-ref；`ownerField='ownerPrincipalId'`），並授與 member 角色 `create` 與帶 predicate 的 `read_draft`。**這是 demo 資料，不是 kernel 表。**

Front 屬於「讀」的 surface，但 `/me` 的建立需要 `create`：`FRONT_HARD_DENY` 本來就沒有擋 `create`，所以不需要改 surface 規則。會員讀自己的草稿，是透過 `/me` 端點由伺服器用 owner 條件把關，**不會**把 `read_draft` 開放給 Front。

### 4.6 審計（G-07 以外的治理需求）

- 必須寫審計的動作：`entry.create`、`entry.publish`、`entry.unpublish`、`entry.archive`、`entry.restore`、`entry.soft_delete`、`entry.purge`、`entry.revert`、`entry.publish_request`、`type.enable`、`type.disable`、`type.create`、`navigation.publish`、`media.delete`、`role.permissions_update`，以及所有現有的 identity 事件。一般的 `entry.update` 不寫（量太大，而且有 `version` 與 revision 可以追）。
- 被權限拒絕（403）的治理類操作，也要以 `outcome=denied` 記錄。
- `GET /api/v1/admin/audit`：參數 `page`、`size`、`from`、`to`、`actor`（username）、`action`（可用前綴，例如 `entry.`）、`category`、`targetType`、`targetId`、`outcome`；每筆回傳 `id`、`at`、`actor { id, username, displayName }`、`category`、`action`、`targetType`、`targetId`、`surface`、`outcome`。
- `GET /api/v1/admin/audit/{id}`：多回傳 `detail`（`detail_json`）。
- 審計只能新增，不能修改或刪除（surface-admin AC-J）。

**BW2 細化後補充：** `category` 的值、每個動作的 `detail`、被拒治理操作的記法（動作名是治理 action，例如 `manage_types`，`outcome=denied`）見 `waves/BW2.md` §4.3。既有的 `ENTRY_PURGED`、`PERMISSION_CHANGED` 改為上表的 `entry.purge`、`role.permissions_update`（舊列不改）；另外新增 `entry.publish_request_cancel`。`action` 參數以 `.` 結尾時才是前綴。施工細節見 `waves/BW2.md` §4.3、§4.4、§5.3、§5.4。

### 4.7 類型與欄位的輸出（G-05、G-06）

`GET /content-types/{key}` 與 `/admin/content-types` 對每個欄位輸出：`key`、`type`、`label`、`helpText`、`required`、`group`、`order`、`listable`、`filterable`、`enumValues`、`enumLabels`、`refTarget`、`placeholder`、`visibility`。類型層級輸出：`titleField`、`sortField`、`visibilityField`、`ownerField`、`slugPolicy`、`singleton`、`previewable`。

`visibility = internal` 的欄位不輸出給 Back；`visibility != public` 的欄位不出現在公開投影中（現行的公開投影已經依欄位可見性過濾，v2 用測試固定下來）。

施工細節見 `waves/BW1a.md` §4.1、§5.4。

---

## 5. 品質與閘門

### 5.1 測試層次

| 層 | 指令 | 需要 Docker | CI |
| --- | --- | --- | --- |
| 單元與 API（in-memory store） | `./gradlew test` | 否（AGENTS.md 的規定） | ✓（現有） |
| Store 契約測試（PostgreSQL） | `./gradlew integrationTest` | 是（Testcontainers） | ✓（**新增 job**，GitHub runner 內建 Docker） |
| OpenAPI 回應驗證 | 包含在 `test` 中 | 否 | ✓ |
| 前端 mock 與 OpenAPI 對齊 | 前端的 `typecheck`（MSW handler 使用產生的型別） | 否 | ✓（web job） |

### 5.2 Store 契約測試（BD-10）

- 在 `src/test` 定義抽象類別 `ContentStoreContract`、`MediaStoreContract`、`IdentityStoreContract`，內含所有 store 行為的測試案例（分頁、排序、篩選、predicate 下推、索引重建、軟刪、revision 保留數量）。
- `test` 用 in-memory 實作跑一次；`integrationTest` 用 Testcontainers PostgreSQL 跑同一組。
- **規則：** 以後修改任何 store 的行為，必須先在契約測試加案例；兩種 store 都通過才能合併。

施工細節見 `waves/BW0.md` §5.4、§7.6、§7.7。

### 5.3 OpenAPI 驗證（BD-03）

- 在 MockMvc 測試中加入 OpenAPI 回應驗證。~~候選套件是 `com.atlassian.oai:swagger-request-validator-mockmvc`，BW0 時確認它支援 OpenAPI 3.1 與 Spring Boot 3.5 後定案。~~ **BW0 細化後定案：** `openapi.yaml` 現在是 OpenAPI **3.0.3**（`openapi.yaml:1`），v2 維持 3.0.3，不需要 3.1。`swagger-request-validator-mockmvc` 3.0.0 已 relocate 到 `openapi-request-validator-mockmvc`，但該模組以 `javax.servlet` 與 Spring 5 建置，所以改用同一專案的 `com.atlassian.oai:openapi-request-validator-core:3.0.0`（僅 test scope），自寫 MockMvc 轉接。
- 現有的 `OpenApiContractTests`（路徑一致）保留；另加一條：每個 operation 都必須有 `2xx` 回應 schema，以及至少一個錯誤回應。
- 錯誤代碼集中在 `components.schemas.ErrorCode` 的 enum；新增錯誤代碼就必須改這個 enum，否則測試失敗。

施工細節見 `waves/BW0.md` §4.1、§4.5、§5.1、§5.5。

### 5.4 效能目標（本機、PostgreSQL 16、單類型 10,000 筆）

| 操作 | p95 |
| --- | --- |
| 工作列表，一頁 20 筆，含 `q` 與一個 `filter` | ≤ 150ms |
| 公開列表，一頁 20 筆 | ≤ 100ms |
| 單筆 PATCH（含索引重建） | ≤ 80ms |
| 一次請求內的 SQL 查詢數（列表） | ≤ 5（與筆數無關） |

測試資料用一個只在 `integrationTest` 使用的產生器；v2 不做正式的壓力測試。

**BW1b 細化後補充：** 前三列在 store 層量測；最後一列以 content store 的 SQL 計算（`findTypeByKey`、`fieldsOf`、COUNT、分頁 SELECT，共 4 個）。identity 的查詢由 BW1a 的請求內快取保證與筆數無關；公開列表展開 `media-ref` 時的逐筆查詢不在這個數字內，見 BQ-11。施工細節見 `waves/BW1b.md` §5.6。

### 5.5 建置的可重現性

2026-09-24 在雲端 sandbox 中遇到 Maven Central 回 HTTP 429，Gradle 無法解析依賴（見 [00 §1](00-v1-frontend-audit.md#1-怎麼查的)）。**Proposed：** 啟用 Gradle dependency locking 與 dependency verification（`gradle/verification-metadata.xml`），讓依賴版本固定、可以稽核。429 本身是環境的網路限制，不在 repo 內處理；CI 已經有 `setup-gradle` 快取。

BW0 只做 dependency locking；施工細節見 `waves/BW0.md` §5.8。verification metadata 未排入任何波次。

---

## 6. 安全

- 繼續由伺服器強制 surface 規則；新端點都要在 `IdentitySurfaceHardeningTests` 補上 Front／Back／Admin 各自的拒絕案例。
- `/me` 端點：`ownerField` 一律由伺服器設定，任何客戶端傳來的 owner 值都忽略（測試：傳入別人的 principal id，建立的 entry 仍然屬於自己）。
- `batch-patch`：逐筆授權，不能用「第一筆有權限」代表全部。
- `include=refs`：沒有權限讀的目標只回傳 `restricted`，不回傳標題（測試：operator-album 展開 `visit` 的 ref，看不到寵物名）。
  - **BW2 細化後補充：** `seed-operator-album` 沒有 `visit` 的讀取權，所以上面的例子無法觸發；BW2 改以「只有 `photo` editor 權限的帳號展開照片的 `album`」測同一條規則（`waves/BW2.md` §5.8）。
- 公開投影不得包含無法公開的媒體 id（B-13）。

---

## 7. 後端波次

後端波次以 **BW** 開頭，與前端的 W 波交錯進行。整體順序見 [README § 路線圖](README.md#路線圖)。

| 波 | 範圍 | 解決 | 完成定義 |
| --- | --- | --- | --- |
| **BW0 契約與品質基礎** | 補完整 OpenAPI schema（現有全部 operation）；OpenAPI 回應驗證；錯誤信封統一與 `ErrorCode` enum；store 契約測試骨架；CI 新增 `integrationTest` job；dependency locking | B-01、B-08、B-14、B-15 | `./gradlew test integrationTest` 全綠；每個 operation 都有 schema；前端可以從 YAML 產生型別 |
| **BW1a 類型設定與欄位中繼資料** | V5 migration；類型設定（`sortField`、`visibilityField`、`ownerField`）與 kernel 改讀這些設定；標題與搜尋改用 `titleField`；欄位中繼資料輸出；種子的 zh-Hant 標籤；`capabilities`；授權快取 | B-03、B-04、B-05、B-12；G-01、G-05、G-06、G-11 | 契約測試涵蓋新的 store 方法；kernel 原始碼不再出現 demo 欄位名 |
| **BW1b 列表查詢下推** | V6／V7 migration（索引寫入與回填）；列表分頁、排序、篩選、predicate 下推到 SQL；公開列表的可見性與關聯條件下推；效能量測 | B-02、B-09、B-10；G-02 | 契約測試涵蓋每一種查詢參數；§5.4 的列表效能目標達標 |
| **BW1c 驗證與破壞性變更** | 驗證一次收集所有欄位錯誤並輸出 `error.fields`；`datetime`／`string` 驗證；§4.4 的三項破壞性變更；清空欄位的契約測試 | B-06、B-13；G-07 | 每項破壞性變更都有 API 級測試 |
| **BW2 前端 W2／W4 的前置** | `batch-patch`；`include=refs`；請求發布；可指派使用者；審計補齊與查詢 | B-07、B-11（部分）；G-03、G-04、G-09、G-10 | 每個新端點有授權、驗證、審計三類測試 |
| **BW3 會員區** | `/me` 端點；`appointment_request` 類型與種子 | B-11；G-08 | surface-front AC-10～12 可以用 API 級測試驗收 |
| **BW4 硬化** | 效能量測記錄；審計保留期限設定（surface-admin §7.2）；安全測試補齊 | — | §5.4 全部達標並記錄數字 |

每波一個 PR；migration 只能新增，不能修改已經合併的 migration。

**BW1 拆成三波（owner 決定，2026-09-25）：** 原 BW1 細化時估計約 44 張任務卡，超過 REFINE-PROMPT 的 30 張上限，owner 選擇拆成 BW1a、BW1b、BW1c。順序：BW1a → BW1b；BW1c 只依賴 BW0，可以與 BW1a、BW1b 平行。前端 W1 需要三波都完成；W3 需要 BW1b 與 BW1c。原 BW1 的 ID 全部分配到三波，沒有增減。

**BW1c 細化後補充：** BW1c 的契約是在 BW1b 契約上修改後整檔取代，`EntryService`、`PublicContentController`、`ContentProjection` 的 diff 也以 BW1b 完成後為基準，所以實作順序改為 BW1a → BW1b → BW1c（上段「BW1c 可以與 BW1a、BW1b 平行」只適用於細化，不適用於實作）。施工細節見 `waves/BW1c.md` §2.1。

BW0 施工細節見 `waves/BW0.md`。

---

## 8. 開放問題

| ID | 問題 | 建議 |
| --- | --- | --- |
| BQ-01 | OpenAPI 維持手寫，還是改用 springdoc 從程式碼產生？ | 手寫。契約先行符合 SDD 方法；以測試保證一致 |
| BQ-02 | 公開列表的可見性，要讓 `unlisted` 保留「知道網址就能看」的語義嗎？ | 保留現行語義：`unlisted` 不出現在列表，但 slug 直連可以讀 |
| BQ-03 | 審計保留多久？ | 預設 365 天，可在 Admin 設定；BW4 再做清理工作 |
| BQ-04 | `batch-patch` 是否也要支援 `publish`／`unpublish`？ | 不要。批次發布屬於前端 Q-05，v2 不做 |
| BQ-05 | `cms_entry_index` 要不要改用 JSONB GIN 索引取代？ | 先用索引表：它已經存在，型別明確，也方便把 predicate 編譯成 SQL；BW4 量測後再評估 |
| BQ-06 | `/principals/{id}` 系列在 id 不存在時回 **400** `VALIDATION_FAILED`（message `not found`），不是 404（`PrincipalAdminService.java:58` 等）。BW0 只把現況寫進契約。要改成 404 嗎？選項：A. BW2 改成 404 並新增 `PRINCIPAL_NOT_FOUND`，與 W4 Admin 同波上線（破壞性，但唯一使用者是 v2 Admin）；B. 維持 400。 | A |
| BQ-07 | 媒體錯誤代碼是小寫（`not_found`、`variant_not_available`、`unsupported_media_type`、`quota_exceeded`、`file_too_large`、`gone`），其他代碼是大寫。BW0 保留原字串以免破壞。要統一嗎？選項：A. BW1 改成 `MEDIA_NOT_FOUND` 等大寫，與 §4.4 的破壞性變更同波上線；B. 維持。 | A |
| BQ-08 | 管理端有些輸入沒驗證，會在資料庫層失敗成 500 `INTERNAL_ERROR`：例如 `POST /admin/content-types` 的 `slugPolicy` 不在 `required／optional／none`（違反 V3 的 CHECK），或 `POST /principals` 的 email 重複（違反唯一索引）。選項：A. BW2 補驗證，回 422 `FIELD_VALIDATION`／400 `VALIDATION_FAILED`；B. 維持。 | A |
| BQ-09 | 兩種環境類失敗沒有自動測試：本機沒有 Docker 時 `integrationTest` 無法執行；Maven Central 回 HTTP 429 時依賴無法下載（waves/BW0.md §8 的 BW0-FM16、FM18）。選項：A. 接受，以 CI 為準，PR 說明必須寫明哪些閘門只在 CI 跑過；B. 另設 Maven 鏡像。 | A |
| BQ-10 | 公開列表的 `ref.<field>` 以 `cms_entry_ref` 篩選，而 `cms_entry_ref` 記錄的是工作副本的關聯；已發布副本與工作副本的關聯不同時（例如照片已改到另一本相簿但還沒重新發布），公開列表依工作副本的關聯篩選（BW1b 細化時發現，waves/BW1b.md §1.2）。選項：A. 對 `ref`／`principal-ref` 欄位另外寫 `published` scope 的索引列，公開列表改用索引列篩選（BW2）；B. 維持。 | A |
| BQ-11 | 公開列表的每一筆 entry，其 `media-ref` 值都由 `MediaService.resolvePublic` 各自查詢媒體 store（媒體、variants、attachments 與其 entry），查詢數隨筆數增加，§5.4 的「與筆數無關」因此只對 content store 成立（BW1b 細化時發現）。選項：A. BW1c 修 B-13 時一起改成整頁批次解析；B. 維持。 | A |
| BQ-12 | 狀態變更與審計在同一個交易（BD-09），但沒有測試證明「審計寫入失敗時狀態變更也回滾」：`./gradlew test` 用 in-memory store（沒有交易），`integrationTest` 的 store 契約只測單一 store（BW2 細化時發現，waves/BW2.md §7.8）。選項：A. BW4 新增一個 `integrationTest`，以 PostgreSQL 啟動應用並讓審計寫入失敗（例如 actor 指向不存在的 principal，違反外鍵），檢查 entry 沒有改變；B. 維持。 | A |

---

## 9. 參考

- 本 repo：`services/cms-api/src/main/java/com/fallrising/cms/**`、`src/main/resources/db/migration/V1～V4`、`openapi.yaml`、`.github/workflows/cms-scaffold-ci.yml`
- 規格：`docs/specs/kernel-content.md`、`kernel-identity.md`、`kernel-media.md`、`surface-*.md`

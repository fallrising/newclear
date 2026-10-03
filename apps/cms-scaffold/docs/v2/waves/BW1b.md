# BW1b 施工圖 — 列表查詢下推

[回 v2 索引](../README.md) ・ 框架：[02 §7 BW1b](../02-backend-sdd.md#7-後端波次) ・ 契約：[contracts/BW1b.openapi.yaml](../contracts/BW1b.openapi.yaml) ・ 前一波：[BW1a](BW1a.md)

狀態：**DOC_READY**（本檔合併即生效）  
日期：2026-09-25  
讀者：實作 BW1b 的 agent。只讀本檔、`contracts/BW1b.openapi.yaml` 與本檔引用的檔案就能完成，不需要做任何設計決定。

> **預演紀錄。** 本檔的程式碼、YAML 與測試，已套用在「BW1a 施工圖完成後」的 `services/cms-api` 副本上，並逐張任務卡執行過（2026-09-25）。`./gradlew :services:cms-api:test` 在 T02、T04、T06、T08、T10 完成後依序是 144、155、155、171、180 個測試，每次唯一失敗的是 `CmsApiApplicationTests.runtimeIsJava25`（預演環境只有 JDK 21）；`integrationTest` 依序是 54、65、66、66、66 個全綠，T11 後是 67 個，但用的是本機 PostgreSQL 16.13，不是 Testcontainers。各「測試先行」卡的預期紅燈清單也是實際跑出來的。T11 的效能量測在預演環境得到：工作列表 p95 43 ms、公開列表 p95 40 ms、單筆更新 p95 8 ms。

---

## 1. 範圍

### 1.1 解決的 ID

| ID | 來源 | 本波次做到什麼程度 |
| --- | --- | --- |
| B-02 | 02 §1.2 | 工作列表與公開列表都分頁；`total` 是所有頁的筆數；公開列表的可見性、`publicRequiresPublishedRefs`、predicate 都在同一個查詢裡判斷，不再逐筆查詢 |
| B-09 | 02 §1.2 | `cms_entry_index` 在每次新增、更新 entry 時寫入（工作與已發布兩份）；V7 回填既有資料 |
| B-10 | 02 §1.2 | 帶 predicate 的 grant 可以用在列表：編譯成對 `cms_entry_index` 的條件；無法編譯的 predicate 在啟動時與修改權限時被拒絕 |
| G-02 | 01 §9 | 02 §4.1 表中本波次的參數：`page`、`size`、`sort`、`q`、`state`、`filter.<field>`（含 datetime 的 `.from`／`.to`）、`ref.<field>`；回應新增 `page`、`size` |
| BD-04 | 02 §2 | 全部（`publishRequested`、`include=refs` 除外，見 §1.2） |

稽核 ID：沒有新的稽核 ID。前端依賴本波次的是 W1（Back 列表分頁與篩選）與 W3（Front 公開列表），見 01 §9 G-02。

### 1.2 不做

- 01 §1.2、AGENTS.md「不要做」全部。
- 02 §4.1 表中的 `publishRequested=true`（BW2，G-03）與 `include=refs`（BW2，G-10）。本波次收到這兩個參數時照「其他參數一律忽略」處理。
- BW1c 的範圍：欄位錯誤收集與 `error.fields`、428、公開投影的媒體 null（B-06、B-13、G-07）。
- 公開列表展開 `media-ref` 時，每個媒體值仍會各自查詢媒體 store（`MediaService.resolvePublic`）；本波次不改，記為 [02 BQ-11](../02-backend-sdd.md#8-開放問題)。§5.4 的「SQL 數與筆數無關」因此以 content store 的查詢計算（§5.6）。
- 公開列表的 `ref.<field>` 讀的是 `cms_entry_ref`，它記錄工作副本的關聯；已發布副本與工作副本的關聯不同時，以工作副本為準。本波次不改，記為 [02 BQ-10](../02-backend-sdd.md#8-開放問題)。
- 管理端設定 `filterable`、`indexed`：v2 沒有修改欄位中繼資料的 API（見 [BW1a §1.2](BW1a.md#12-不做)）；本波次只讀種子寫入的值。
- 不新增依賴，所以 `gradle.lockfile` 不變。

---

## 2. 先決條件

### 2.1 前置波次

- **BW1a 必須已是 `VERIFIED`**。本波次直接修改 BW1a 的產出：`ContentStore`／`InMemoryContentStore`／`JdbcContentStore`（`listEntries` 在 T10 移除）、`EntryService`（`publicOrder` 在 T10 移除，`PublicOrderTests` 同時刪除）、`AuthorizationService`、`ContentTypeDirectory`、`StoreContentTypeDirectory`、`ContentStoreContract`，以及 `openapi.yaml`（以 BW1b 契約整檔取代）。
- 本檔所有 diff 都以「BW1a 施工圖完成後」的檔案為基準；如果 `main` 上的這些檔案與 BW1a 施工圖的結果不同，先停下來回報，不要硬套。
- **與前端的關係（[01 Q-10](../01-frontend-sdd.md#133-w0-細化時新增已決定owner2026-09-25)）。** 前後端各自依自己的契約開發，差異在整合階段一起處理。如果實作本波次時 W0 已經合併，T10 換上 BW1b 契約後，`web` job 的 `packages/api/src/codegen.test.ts`（W0 的 E-02 新鮮度測試）會失敗，因為產生的型別仍是舊契約。本波次**不改前端**：在 PR 說明列出失敗的測試名稱與「依 01 Q-10 交給整合階段」，§9 的 `web` 一項改勾「只有 codegen 新鮮度或 fixture 型別失敗」。BW1a 施工圖寫成時 Q-10 還沒決定，[BW1a §2.1](BW1a.md#21-前置波次) 在本 PR 補上同樣的說明。

### 2.2 環境

與 [BW0 §2.2](BW0.md#22-環境) 相同：JDK 25、`./gradlew`、`integrationTest` 需要 Docker、沒有新的環境變數。T11 的效能測試在 `integrationTest` 內執行，插入 10,000 筆資料約需 70～90 秒（預演實測）。

### 2.3 查證過的外部事實

`docs.spring.io`、`www.postgresql.org`、`documentation.red-gate.com`、`openjdk.org` 在細化環境被網路政策擋住，所以下列事實以「解析出的 jar 內容」與「預演實際執行」查證（2026-09-25），版本取自 BW0 的 `gradle.lockfile`：

| 事實 | 用在哪裡 | 查證方式 |
| --- | --- | --- |
| Flyway 11.7.2 的 `org.flywaydb.core.api.migration.BaseJavaMigration`、`Context` 存在；放在 `db.migration` 套件、名稱為 `V7__backfill_entry_index` 的類別，會被 `locations("classpath:db/migration")`（也是 Spring Boot 的預設）當成版本 7 執行 | V7 | `flyway-core-11.7.2.jar` 的類別清單；預演 `Migrating schema "public" to version "7 - backfill entry index"`，`EntryIndexBackfillTests` 綠 |
| spring-test 6.2.19 有 `org.springframework.test.context.bean.override.mockito.MockitoSpyBean`，可把 `@SpringBootTest` 的 bean 換成 Mockito spy | `ListQueryCountTests` | `spring-test-6.2.19.jar` 的類別清單；預演執行 |
| spring-tx／spring-jdbc 6.2.19 的 `TransactionTemplate` 搭配 `DataSourceTransactionManager(dataSource)`：同一個 `DataSource` 上的 `JdbcTemplate` 操作會在同一個交易內 | `JdbcContentStore` 的寫入加索引 | 預演：`B09_*` 在 PostgreSQL 上綠 |
| PostgreSQL 16：`ORDER BY <輸出欄別名> DESC NULLS LAST` 可用；`COLLATE "C"` 以位元組排序；`~` 是 POSIX 正規表示式比對；`ILIKE ... ESCAPE '\'`；`CASE WHEN ... THEN CAST(x AS uuid) END` 只有條件成立時才轉型 | `JdbcContentStore.queryEntries` | 預演：PostgreSQL 16.13 上 `ContentStoreContract` 40 個案例全綠，含字串二進位排序、UUID 大寫與非 UUID 文字的案例 |
| Java text block 去掉的共同縮排，以內容行與結尾 `"""` 所在行的最小縮排計算；結尾 `"""` 與最後一行同一行時，第一行開頭的空白也會被去掉 | `JdbcContentStore.where`：每段 text block 前面一律 `.append(" ")` | 預演：未加空白時 PostgreSQL 回 `bad SQL grammar [... IS NOT NULLAND EXISTS ...]` |

---

## 3. 檔案清單

路徑相對於 `apps/cms-scaffold/services/cms-api/`，另有註明者除外。**實作者不得碰清單以外的檔案。**

| 路徑 | 動作 | 用途 | 任務卡 |
| --- | --- | --- | --- |
| `src/main/resources/db/migration/V6__entry_index_scope.sql` | 新增 | `scope` 欄、CHECK、查詢索引 | T02 |
| `src/main/java/com/fallrising/cms/content/index/IndexRow.java` | 新增 | 一筆索引列 | T02 |
| `src/main/java/com/fallrising/cms/content/index/IndexScope.java` | 新增 | `work`／`published` | T02 |
| `src/main/java/com/fallrising/cms/content/index/EntryIndexer.java` | 新增 | 由 entry 算出索引列（兩種 store 與 V7 共用） | T02 |
| `src/main/java/com/fallrising/cms/content/store/ContentStore.java` | 修改 | T02：`indexRowsOf`；T04：`queryEntries`；T10：移除 `listEntries` | T02、T04、T10 |
| `src/main/java/com/fallrising/cms/content/store/InMemoryContentStore.java` | 修改 | 同上 | T02、T04、T10 |
| `src/main/java/com/fallrising/cms/content/store/JdbcContentStore.java` | 修改 | 同上；寫入與索引在同一個交易 | T02、T04、T10 |
| `src/main/java/com/fallrising/cms/content/query/AccessFilter.java` | 新增 | 下推的授權條件 | T04 |
| `src/main/java/com/fallrising/cms/content/query/EntryPage.java` | 新增 | 一頁結果與總筆數 | T04 |
| `src/main/java/com/fallrising/cms/content/query/EntryQuery.java` | 新增 | 一個列表查詢 | T04 |
| `src/main/java/com/fallrising/cms/content/query/FieldFilter.java` | 新增 | 欄位條件 | T04 |
| `src/main/java/com/fallrising/cms/content/query/RefFilter.java` | 新增 | 關聯條件 | T04 |
| `src/main/java/com/fallrising/cms/content/query/SortKey.java` | 新增 | 排序鍵 | T04 |
| `src/main/java/db/migration/V7__backfill_entry_index.java` | 新增 | 回填索引 | T06 |
| `src/main/java/com/fallrising/cms/content/query/ListQueryParser.java` | 新增 | 查詢參數文法 | T08 |
| `src/main/java/com/fallrising/cms/identity/service/FieldEqualsPredicate.java` | 新增 | predicate 解析 | T08 |
| `src/main/java/com/fallrising/cms/identity/service/PredicateIndexCheck.java` | 新增 | 啟動時檢查 predicate | T08 |
| `src/main/java/com/fallrising/cms/identity/service/AuthorizationService.java` | 修改 | `listAccess` | T08 |
| `src/main/java/com/fallrising/cms/identity/service/ContentTypeDirectory.java` | 修改（整檔取代） | `predicateFieldCompilable` | T08 |
| `src/main/java/com/fallrising/cms/content/web/StoreContentTypeDirectory.java` | 修改（整檔取代） | 同上的實作 | T08 |
| `src/main/java/com/fallrising/cms/identity/service/PrincipalAdminService.java` | 修改 | 修改權限時拒絕無法編譯的 predicate | T08 |
| `src/main/java/com/fallrising/cms/content/service/EntryService.java` | 修改 | `listWork`、`publicList` 改用查詢；移除 `publicOrder` | T10 |
| `src/main/java/com/fallrising/cms/content/web/EntryController.java` | 修改 | 工作列表回應 | T10 |
| `src/main/java/com/fallrising/cms/content/web/PublicContentController.java` | 修改 | 公開列表回應 | T10 |
| `src/main/java/com/fallrising/cms/content/web/ContentProjection.java` | 修改 | 分頁回應 | T10 |
| `src/main/resources/openapi/openapi.yaml` | 修改（整檔取代） | 等於 `docs/v2/contracts/BW1b.openapi.yaml` | T10 |
| `src/test/java/com/fallrising/cms/contract/ContentStoreContract.java` | 修改 | T01：索引案例；T03：查詢案例，既有 4 個列表案例改用 `queryEntries` | T01、T03 |
| `src/integrationTest/java/com/fallrising/cms/contract/PostgresFixture.java` | 修改 | 新增 `emptyDataSource()` | T05 |
| `src/integrationTest/java/com/fallrising/cms/contract/EntryIndexBackfillTests.java` | 新增 | V7 | T05 |
| `src/test/java/com/fallrising/cms/content/query/ListQueryParserTests.java` | 新增 | 查詢參數文法 | T07 |
| `src/test/java/com/fallrising/cms/identity/service/ListAccessTests.java` | 新增 | `listAccess` | T07 |
| `src/test/java/com/fallrising/cms/identity/service/PredicateIndexCheckTests.java` | 新增 | predicate 檢查 | T07 |
| `src/test/java/com/fallrising/cms/IdentityHardeningTests.java` | 修改 | `PrincipalAdminService` 建構子多一個參數 | T08 |
| `src/test/java/com/fallrising/cms/ListQueryApiTests.java` | 新增 | 列表 API（MockMvc） | T09 |
| `src/test/java/com/fallrising/cms/ListQueryCountTests.java` | 新增 | 每個列表請求的 store 呼叫數 | T09 |
| `src/test/java/com/fallrising/cms/content/service/PublicOrderTests.java` | 刪除 | `publicOrder` 移除；規則改由 `ListQueryParserTests` 與 store 契約固定 | T10 |
| `src/integrationTest/java/com/fallrising/cms/contract/ListQueryPerformanceTests.java` | 新增 | 02 §5.4 效能量測 | T11 |
| `apps/cms-scaffold/docs/v2/README.md` | 修改 | 路線圖 BW1b 狀態改 `VERIFIED` | T12 |

不會碰：`build.gradle.kts`、`gradle.lockfile`、V1～V5、`ContentTypeSeed.java`、`DemoContentSeed.java`、`SeedService.java`、`MediaService.java`、上表以外的既有測試類別、前端、`e2e/`、workflow。

---

## 4. 契約

### 4.1 OpenAPI

完整契約是 [`docs/v2/contracts/BW1b.openapi.yaml`](../contracts/BW1b.openapi.yaml)，`info.version` 0.6.0。合併方式同 BW0：T10 整檔取代 `openapi.yaml`。撰寫規則沿用 [BW0 §4.1](BW0.md#41-openapi) 的 R1～R10。

相對於 BW1a 契約的變更（沒有新的 operation、沒有新的錯誤代碼、沒有移除欄位）：

| schema／operation | 變更 |
| --- | --- |
| `WorkEntryPage`、`PublicEntryPage` | 新增必填 `page`、`size`；`total` 改為「所有頁的筆數」；`offset`＝`(page-1)*size`、`limit`＝`size` |
| 參數 `Page`、`Size`、`Sort`（新） | `listWorkEntries`、`listPublicEntries` 都加上 |
| 參數 `State` | 描述改為「預設 `draft,published`」 |
| 參數 `Q` | 描述改為「titleField 值的字面子字串」 |
| `listWorkEntries` | 描述：預設排序、授權下推、`filter.<field>`、`ref.<field>` 可重複、錯誤清單 |
| `listPublicEntries` | 描述：已發布副本、可見性、必要關聯、授權下推、`filter.<field>`、`ref.<field>` 限公開關聯欄位、錯誤清單 |
| `replaceRolePermissions` | 400 `VALIDATION_FAILED` 多兩種原因：predicate 沒有 `contentType`；predicate 欄位無法下推 |

`filter.<field>` 與 `ref.<field>` 是以欄位名組成的參數名，OpenAPI 3.0.3 無法逐一列舉，所以寫在 operation 的描述裡。

Operation 一覽（surface、action 與錯誤都在契約的描述中；本表只摘要）：

| 方法與路徑 | surface | 需要的 action | 新參數 | 錯誤 |
| --- | --- | --- | --- | --- |
| `GET /api/v1/content-types/{typeKey}/entries` | Back、Admin | 狀態含 `draft` 或 `archived` 時 `read_draft`，否則 `read_published` | `page`、`size`、`sort`、`filter.*`、可重複的 `ref.*` | 400 `VALIDATION_FAILED`；403 `SURFACE_FORBIDDEN`（Front）；403 `FORBIDDEN`；404 `CONTENT_TYPE_NOT_FOUND` |
| `GET /api/v1/public/content-types/{typeKey}/entries` | 全部（匿名可） | `read_published`（Front 規則） | 同上，不含 `state` | 400 `AUDIENCE_PARAM_REJECTED`；400 `VALIDATION_FAILED`；403 `FORBIDDEN`；404 `ENTRY_NOT_FOUND` |
| `PUT /api/v1/roles/{code}/permissions` | Admin | `manage_principals` | — | 400 `VALIDATION_FAILED`（新增兩種原因）；其餘不變 |

### 4.2 行為變更（API 可觀察）

| 項目 | 以前 | 以後 |
| --- | --- | --- |
| 列表分頁 | 一次回全部；`offset` 0、`limit`＝筆數 | 預設第 1 頁 20 筆；`page`、`size`、`offset`、`limit` 依請求 |
| `total` | 本頁筆數 | 所有頁的筆數 |
| 工作列表沒帶 `state` | `draft`、`published`、`archived` 全部 | `draft`、`published`（02 §4.1）；要看封存的帶 `state=archived` |
| 工作列表的授權 | 只有帶 predicate 的 grant 時 403 | 列出符合任一 predicate 的 entry（B-10）；`seed-member-clinic` 在 Back 帶 `state=published` 只看到自己的寵物 `Leo` |
| 工作列表沒帶 `state` 的 action | `read_draft` | 不變（預設狀態含 `draft`）；`state=published` 時 `read_published` |
| 工作列表 `q` | 比對工作副本 payload | 比對工作副本 titleField 的索引值（值相同；空白字串不再算有值） |
| 公開列表 `q`、排序 | `q` 比對工作副本的標題；排序讀已發布副本 | 全部讀已發布副本 |
| 公開列表排序 | `sortField` 的數字值遞增（沒有數字的最後），再依 `updatedAt` 遞減；否則 `publishedAt` 遞減 | 相同；另外可以用 `sort` 指定；最後再依 id 文字遞增，讓分頁穩定 |
| 工作列表排序 | `updatedAt` 遞減 | 預設相同；可以用 `sort`；最後依 id 文字遞增 |
| `ref.<field>` | 帶多個時只套用其中一個 | 可重複，全部都要符合；公開列表只接受可見性 `public` 的關聯欄位，否則 400 |
| `sort`、`filter.<field>`、`page`、`size` 錯誤 | 參數被忽略 | 400 `VALIDATION_FAILED`（§4.3） |
| 同名參數重複（`ref.<field>` 除外） | 用第一個 | 400 `VALIDATION_FAILED` |
| 修改角色權限時 predicate 欄位無法下推 | 接受 | 400 `VALIDATION_FAILED` |
| 啟動時資料庫裡有無法下推的 predicate | 正常啟動 | 啟動失敗（`IllegalStateException`，列出角色、動作與原因） |

### 4.3 查詢參數文法

由 `ListQueryParser.parse(type, fields, scope, params)` 實作（§5.4）。`scope` 是 `WORK`（工作列表）或 `PUBLISHED`（公開列表）。所有錯誤都是 400 `VALIDATION_FAILED`，`message` 以參數名開頭。

先定義兩個集合：

- **有索引列的欄位**＝`EntryIndexer.indexedKeys(type, fields)`：啟用中、型別可索引（`string`、`markdown`、`enum`、`int`、`boolean`、`datetime`、`ref`、`principal-ref`），且符合下列之一：`indexed=true`、是類型的 `titleField`／`sortField`／`visibilityField`／`ownerField`、列在 `publicRequiresPublishedRefs`。
- **公開欄位**＝`visibility` 是 `public` 的欄位。

| 參數 | 文法 | 預設 | 錯誤（`message`） |
| --- | --- | --- | --- |
| `page` | 十進位整數，1 以上（前後空白會去掉） | 1 | `page must be a positive integer` |
| `size` | 十進位整數，1～100 | 20 | `size must be an integer from 1 to 100` |
| `state`（只有 `WORK`） | 逗號分隔；每段去空白、去掉空段、去重，保留第一次出現的順序；值只能是 `draft`、`published`、`archived` | 空或全是空段時 `draft,published` | `state: unknown value <值>` |
| `state`（`PUBLISHED`） | 不接受 | — | 400 `AUDIENCE_PARAM_REJECTED`（控制器在解析前檢查，沿用 `rejectAudienceParams`） |
| `q` | 任意字串，原樣傳給 store；空白字串視為沒有條件 | 無 | — |
| `sort` | `[-]<鍵>`；`-` 表示遞減。鍵是 `updatedAt`、`createdAt`、`publishedAt`（entry 欄位），`title`（類型的 `titleField`，種類取該欄位的索引種類，欄位不存在時當成 `string`），或「有索引列、種類不是 `ref`、（`PUBLISHED` 時）是公開欄位」的欄位 | `WORK`：`-updatedAt`。`PUBLISHED`：類型有 `sortField` 且該欄位有索引列時，以它遞增；否則 `-publishedAt` | `sort: <鍵> is not sortable` |
| `filter.<欄位>` | 非 datetime 欄位的等值比對 | 無 | 值空白：`filter.<欄位> must not be blank`；欄位不存在、停用、`filterable=false`、沒有索引列、（`PUBLISHED`）不是公開欄位：`filter.<欄位>: field is not filterable`；欄位是 datetime：`filter.<欄位>: use filter.<欄位>.from or filter.<欄位>.to`；`int` 不是 `Long.parseLong` 能解析的值：`filter.<欄位> must be an integer`；`boolean` 不是 `true`／`false`：`filter.<欄位> must be true or false` |
| `filter.<欄位>.from`、`filter.<欄位>.to` | datetime 欄位的範圍；值是 ISO-8601 instant（`2026-01-01T00:00:00Z`）或帶時區位移的時間（`2026-01-01T08:00:00+08:00`）；`from` 含、`to` 不含；可以只給一個 | 無 | 值空白、欄位條件同上；值無法解析：`filter.<欄位>.from must be an ISO-8601 date-time with offset`；非 datetime 欄位：`filter.<欄位>.from: .from and .to apply to datetime fields only` |
| `ref.<欄位>` | 目標 entry 的 UUID；**可以重複**（同名或不同名），全部都要符合；空白值忽略 | 無 | 值不是 UUID：`ref.<欄位> must be a UUID`；`PUBLISHED` 時欄位不存在、停用、型別不是 `ref`／`media-ref`／`principal-ref` 或不是公開欄位：`ref.<欄位>: field is not a public ref field` |
| 其他參數 | 忽略（包括 v1 的 `offset`、`limit`，以及本波次還沒做的 `publishRequested`、`include`） | — | — |

補充規則：

1. 除了 `ref.<欄位>`，任何參數重複出現都是錯誤：`<參數> must not repeat`。
2. `filter.<欄位>` 的欄位名是參數名去掉 `filter.` 後的全部；以 `.from` 或 `.to` 結尾時，欄位名是再去掉這個後綴的部分。
3. `enum`、`string`、`ref` 的等值比對是區分大小寫的完整字串比對；`enum` 的值不檢查是否在 `enumValues` 內（不在就沒有結果）。
4. `WORK` 的 `ref.<欄位>` 不檢查欄位是否存在（與 BW1a 相同；不存在的欄位沒有結果）。
5. 解析在授權之後、store 查詢之前執行（§5.5 的步驟）；所以沒有權限的呼叫者帶錯參數時得到 403，不是 400。

### 4.4 predicate 下推規則

predicate 只有一種形式：`{"type":"fieldEquals","field":"<欄位>","value":"<值>"}`；`value` 可以是 `$currentPrincipalId`。

**列表授權（`AuthorizationService.listAccess`，§5.4）：**

1. surface 是 Front 且動作在 `FRONT_HARD_DENY`，或 surface 是 Back 且動作在 `BACK_HARD_DENY`：丟 403 `SURFACE_FORBIDDEN`。
2. 取呼叫者的 grant（BW1a 的請求內快取），留下「忽略 predicate 時符合動作、類型與 surface」的 grant（`matchesGrant`，與 `capabilities` 相同）。沒有任何一個：丟 403 `FORBIDDEN`。
3. 其中任何一個 grant 沒有 predicate（null 或空白）：不加條件（unrestricted）。
4. 否則逐一處理 grant 的 predicate：
   - 無法解析（不是 JSON、`type` 不是 `fieldEquals`、`field` 或 `value` 空白）：跳過，不產生條件（與 `allow()` 對單筆 entry 一律拒絕一致）。
   - `value` 是 `$currentPrincipalId`：呼叫者是匿名時跳過；否則換成呼叫者 id 的文字（小寫 UUID）。
   - 產生條件 `(field, value)`；相同的條件只保留一個，保留第一次出現的順序。
5. 回傳條件清單（清單可以是空的）。空清單表示「一筆都不符合」：store 回傳空頁、`total` 0，**不是** 403。

**store 如何套用（§5.2）：** entry 符合任一條件，就是「該 entry 在查詢 scope 的索引列中，`field_key`＝條件的欄位、`value_string`＝條件的值」存在。SQL：

```sql
AND EXISTS (SELECT 1 FROM cms_entry_index a WHERE a.entry_id = e.id AND a.scope = ? AND (
      (a.field_key = ? AND a.value_string = ?) OR (a.field_key = ? AND a.value_string = ?)))
```

綁定：`scope`（`work` 或 `published`），接著每個條件的欄位與值。空清單寫成 `AND FALSE`。

**可以下推的 predicate（`PredicateIndexCheck.problem`）：** 沒有 predicate 永遠可以。否則依序檢查，第一個不符合的就是原因：

| # | 條件 | 不符合時的原因文字 |
| --- | --- | --- |
| 1 | 可以解析（同上） | `unsupported or malformed predicate` |
| 2 | permission 有 `contentTypeCode`（非空白） | `a predicate requires contentType` |
| 3 | 該類型存在；欄位是該類型有索引列的欄位；欄位型別是 `string`、`enum`、`ref` 或 `principal-ref`（`ContentTypeDirectory.predicateFieldCompilable`） | `predicate field <欄位> is not an indexed string, enum or ref field of <類型>` |

**什麼時候檢查：**

- 啟動時：`PredicateIndexCheck.check()` 監聽 `ApplicationReadyEvent`，`@Order(150)`，在 identity 種子（0）與類型種子（100）之後、demo 內容種子（200）之前。檢查所有角色的所有 permission；有任何問題就丟 `IllegalStateException("Predicates that cannot be pushed into list queries: [<角色>/<動作>: <原因>, ...]")`，應用程式啟動失敗。
- `PUT /roles/{code}/permissions`：每個 permission 在既有的 `validatePredicate` 之後檢查；有問題回 400 `VALIDATION_FAILED`，`message` 是原因文字；任何一個失敗都不寫入（驗證在寫入前完成，BW0 行為）。

**邊界案例（全部有測試，見 §7）：**

| 案例 | 結果 | 測試 |
| --- | --- | --- |
| 兩個 predicate grant（`ownerPrincipalId=$currentPrincipalId`、`clinic=north`） | 兩個條件，OR | `ListAccessTests.B10_predicateGrantsBecomeClausesWithCurrentPrincipalSubstituted`、`ContentStoreContract.B10_accessFilterKeepsEntriesMatchingAnyClause` |
| 同一個 predicate 出現兩次 | 只保留一個條件 | 同上 |
| predicate grant 加一個沒有 predicate 的 grant | 不加條件 | `ListAccessTests.B10_anyGrantWithoutPredicateIsUnrestricted` |
| 匿名，predicate 用 `$currentPrincipalId`；另有壞掉的 predicate | 空條件清單 → 空頁 | `ListAccessTests.B10_anonymousGetsNoClauseForCurrentPrincipalPredicate`、`ContentStoreContract.B10_accessFilterKeepsEntriesMatchingAnyClause`（空清單） |
| 沒有符合的 grant；Front 上的 `read_draft` | 403 `FORBIDDEN`；403 `SURFACE_FORBIDDEN` | `ListAccessTests.B10_noMatchingGrantIsForbiddenAndHardDenyIsSurfaceForbidden` |
| 公開列表的條件讀已發布副本，工作列表讀工作副本 | 兩者各自獨立 | `ContentStoreContract.B10_accessFilterReadsRowsOfTheQueryScope` |
| 會員在 Front 與 Back 列寵物 | 只有 `Leo`；Back 不帶 `state` 時 403（預設狀態含 `draft`，需要 `read_draft`） | `ListQueryApiTests.B10_memberListsOnlyOwnPetsOnBothSurfaces` |
| 沒有 predicate 的 operator | 全部寵物 | `ListQueryApiTests.B10_unscopedGrantListsEveryPet` |
| 修改權限：predicate 欄位沒有索引列（`pet.notes`）；predicate 沒有 `contentTypeCode` | 400 `VALIDATION_FAILED`，權限不變 | `ListQueryApiTests.B10_predicateOnFieldWithoutIndexRowsIsRejected` |
| 啟動時資料庫有無法下推的 predicate | `IllegalStateException`，訊息列出角色與原因 | `PredicateIndexCheckTests.B10_startupCheckFailsOnAStoredPredicateThatCannotBePushedDown` |
| 各種原因文字 | 同上表 | `PredicateIndexCheckTests.B10_problemNamesTheReason` |

種子的三個 member predicate（`pet`、`visit`、`owner` 的 `ownerPrincipalId`）都可以下推：這三個類型的 `ownerField` 是 `ownerPrincipalId`（BW1a），所以該欄位有索引列，型別是 `principal-ref`。

### 4.5 資料表：V6、V7 全文

`src/main/resources/db/migration/V6__entry_index_scope.sql`：

```sql
-- BW1b: cms_entry_index gets a scope (work = working copy, published = published copy) and lookup indexes (02 §3.2).
-- Rows are written by the content store on every entry insert and update; V7 backfills existing entries.

ALTER TABLE cms_entry_index ADD COLUMN scope VARCHAR(12) NOT NULL DEFAULT 'work';
ALTER TABLE cms_entry_index ADD CONSTRAINT cms_entry_index_scope_chk CHECK (scope IN ('work', 'published'));
ALTER TABLE cms_entry_index ADD CONSTRAINT cms_entry_index_kind_chk
    CHECK (value_kind IN ('string', 'enum', 'int', 'bool', 'datetime', 'ref'));
CREATE INDEX cms_entry_index_str_idx ON cms_entry_index (field_key, scope, value_string);
CREATE INDEX cms_entry_index_ts_idx  ON cms_entry_index (field_key, scope, value_ts);
CREATE INDEX cms_entry_index_int_idx ON cms_entry_index (field_key, scope, value_int);
CREATE INDEX cms_entry_index_entry_idx ON cms_entry_index (entry_id, scope);
DROP INDEX cms_entry_index_lookup_idx;
```

- 既有列（BW1a 以前不會寫入，所以正常情況下是空表）拿到預設值 `scope='work'`；V7 會把整張表清掉重建，所以不用管它們的內容。
- `cms_entry_index_lookup_idx`（V3）被 `cms_entry_index_str_idx` 取代，所以刪除。
- `value_kind` 的 CHECK 在 V6 才加上：V3 沒有限制，但 BW1a 以前沒有任何程式寫入這張表，所以不會有不符合的舊列（萬一有，V6 會失敗，照下面的向前修正處理）。

CHECK 的正例與反例（`EntryIndexer` 只會寫出正例）：

| CHECK | 正例 | 反例（`INSERT` 失敗） |
| --- | --- | --- |
| `cms_entry_index_scope_chk` | `scope='work'`、`scope='published'` | `scope='draft'`、`scope='WORK'` |
| `cms_entry_index_kind_chk` | `value_kind` 是 `string`、`enum`、`int`、`bool`、`datetime`、`ref` | `value_kind='boolean'`、`value_kind='media'` |

V7 是 Java migration（Flyway 以類別名稱決定版本，§2.3）：

`src/main/java/db/migration/V7__backfill_entry_index.java`：

```java
package db.migration;

import com.fallrising.cms.content.domain.ContentTypeRecord;
import com.fallrising.cms.content.domain.EntryRecord;
import com.fallrising.cms.content.domain.FieldRecord;
import com.fallrising.cms.content.domain.PublicationState;
import com.fallrising.cms.content.index.EntryIndexer;
import com.fallrising.cms.content.index.IndexRow;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.flywaydb.core.api.migration.BaseJavaMigration;
import org.flywaydb.core.api.migration.Context;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;

import java.sql.Timestamp;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * BW1b: rebuilds cms_entry_index for every existing entry with EntryIndexer (02 §3.2), so rows written before V6
 * (scope-less, never maintained) are replaced by the same rows the content store writes from now on.
 */
public class V7__backfill_entry_index extends BaseJavaMigration {

    private static final TypeReference<Map<String, Object>> MAP = new TypeReference<>() {};
    private static final TypeReference<List<String>> STRINGS = new TypeReference<>() {};

    private final ObjectMapper mapper = new ObjectMapper();

    @Override
    public void migrate(Context context) {
        JdbcTemplate jdbc = new JdbcTemplate(new SingleConnectionDataSource(context.getConnection(), true));
        jdbc.update("DELETE FROM cms_entry_index");
        List<ContentTypeRecord> types = jdbc.query(
                "SELECT id, type_key, title_field, public_requires_published_refs, sort_field, visibility_field, owner_field FROM cms_content_type",
                (rs, n) -> new ContentTypeRecord(
                        rs.getObject("id", UUID.class), rs.getString("type_key"), "", "", null,
                        rs.getString("title_field"), "none", false, true, false,
                        read(rs.getString("public_requires_published_refs"), STRINGS), null, null,
                        rs.getString("sort_field"), rs.getString("visibility_field"), rs.getString("owner_field")));
        for (ContentTypeRecord type : types) {
            List<FieldRecord> fields = jdbc.query(
                    "SELECT id, field_key, field_type, indexed, enabled FROM cms_field WHERE content_type_id = ?",
                    (rs, n) -> new FieldRecord(
                            rs.getObject("id", UUID.class), type.id(), rs.getString("field_key"), rs.getString("field_type"),
                            false, false, rs.getBoolean("indexed"), "public", 0, null, "restrict", List.of(),
                            rs.getBoolean("enabled"), false),
                    type.id());
            List<EntryRecord> entries = jdbc.query(
                    "SELECT id, payload, published_payload FROM cms_entry WHERE content_type_id = ?",
                    (rs, n) -> new EntryRecord(
                            rs.getObject("id", UUID.class), type.id(), type.typeKey(), null, PublicationState.DRAFT, 1,
                            read(rs.getString("payload"), MAP),
                            rs.getString("published_payload") == null ? null : read(rs.getString("published_payload"), MAP),
                            null, null, null, null, null, null, null),
                    type.id());
            for (EntryRecord entry : entries) {
                List<IndexRow> rows = EntryIndexer.rows(type, fields, entry);
                jdbc.batchUpdate(
                        """
                        INSERT INTO cms_entry_index
                          (entry_id, field_key, scope, value_kind, value_string, value_int, value_bool, value_ts)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        rows.stream().map(row -> new Object[] {
                                row.entryId(), row.fieldKey(), row.scope().wire(), row.kind(), row.stringValue(),
                                row.intValue(), row.boolValue(),
                                row.tsValue() == null ? null : Timestamp.from(row.tsValue())}).toList());
            }
        }
    }

    private <T> T read(String raw, TypeReference<T> type) {
        try {
            return mapper.readValue(raw == null ? "null" : raw, type);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
```

- 步驟：刪除 `cms_entry_index` 全部列 → 逐一讀出類型（只讀索引需要的欄位）→ 讀出該類型的欄位 → 讀出該類型的全部 entry（含軟刪與封存）→ 對每筆 entry 以 `EntryIndexer.rows` 算出兩個 scope 的列，批次寫入。
- 在 Flyway 為這個 migration 開的交易內執行（PostgreSQL 支援 DDL 與 DML 同一個交易）；失敗時整個 V7 回滾，資料庫停在 V6。
- 用 `new ObjectMapper()` 解析 JSONB，數字會是 `Integer`／`Long`／`Double`，與 `JdbcContentStore` 用的 Spring `ObjectMapper` 對 `Map<String,Object>` 的結果相同（索引只看 `Number`、`Boolean`、`String`）。
- 不會刪除任何 entry 資料；可以重跑（先刪後建）。

**向前修正：** V6、V7 合併之後不能修改。若之後發現索引規則要改（例如多一種可索引型別），做法是：改 `EntryIndexer`，再新增一個 `V<n>__reindex_entries.java`，內容與 V7 相同（它呼叫的是當時的 `EntryIndexer`）。若 V6 在某個環境因舊的不合法 `value_kind` 列失敗，先手動 `DELETE FROM cms_entry_index`（V7 反正會重建），再重跑 `flywayMigrate`；不要修改 V6。

### 4.6 型別

`IndexRow`、`IndexScope` 見 §5.1；`EntryQuery`、`FieldFilter`、`RefFilter`、`SortKey`、`AccessFilter`、`EntryPage` 見 §5.2；`ListQueryParser.Parsed`、`AuthorizationService.ListAccess`、`FieldEqualsPredicate`、`EntryService.ListResult` 見 §5.4、§5.5。全部是 Java record 或 enum，全文或 diff 都在該節。

### 4.7 範例

成功：`GET /api/v1/content-types/album/entries?q=tb3c1&size=2&page=2&sort=title`（`seed-operator-album`，Back；先建立標題為 `tb3c1 album 1`～`tb3c1 album 5` 的五筆草稿），節錄每筆的三個屬性：

```json
{
  "items": [
    { "id": "…", "title": "tb3c1 album 3", "publicationState": "draft" },
    { "id": "…", "title": "tb3c1 album 4", "publicationState": "draft" }
  ],
  "total": 5,
  "page": 2,
  "size": 2,
  "offset": 2,
  "limit": 2
}
```

成功：`GET /api/v1/public/content-types/pet/entries`（`seed-member-clinic`，Front）：

```json
{ "items": [ { "id": "…", "contentType": "pet", "slug": "leo", "title": "Leo", "payload": { "…": "…" }, "publishedAt": "…" } ],
  "total": 1, "page": 1, "size": 20, "offset": 0, "limit": 20 }
```

失敗：`GET /api/v1/content-types/photo/entries?sort=cover`（`seed-operator-album`，Back，`400`）：

```json
{ "error": { "code": "VALIDATION_FAILED", "message": "sort: cover is not sortable" }, "requestId": "…" }
```

失敗：`PUT /api/v1/roles/member/permissions`，body `[{"action":"read_published","contentTypeCode":"pet","predicateJson":"{\"type\":\"fieldEquals\",\"field\":\"notes\",\"value\":\"$currentPrincipalId\"}"}]`（`seed-admin`，Admin，`400`）：

```json
{ "error": { "code": "VALIDATION_FAILED",
             "message": "predicate field notes is not an indexed string, enum or ref field of pet" }, "requestId": "…" }
```

---

## 5. 模組規格

本節是每張實作卡要套用的程式碼。diff 的基準是前一張實作卡完成後的檔案（§6 標明）。

### 5.1 索引寫入（T02）

**`IndexRow`、`IndexScope`、`EntryIndexer`**（全文）：

`src/main/java/com/fallrising/cms/content/index/IndexRow.java`：

```java
package com.fallrising.cms.content.index;

import java.time.Instant;
import java.util.UUID;

/**
 * One row of cms_entry_index. Exactly one of the value components is non-null, chosen by kind:
 * string, enum and ref use stringValue; int uses intValue; bool uses boolValue; datetime uses tsValue.
 */
public record IndexRow(
        UUID entryId,
        String fieldKey,
        IndexScope scope,
        String kind,
        String stringValue,
        Long intValue,
        Boolean boolValue,
        Instant tsValue) {}
```

`src/main/java/com/fallrising/cms/content/index/IndexScope.java`：

```java
package com.fallrising.cms.content.index;

import java.util.Locale;

/** WORK indexes the working copy (payload); PUBLISHED indexes the published copy (publishedPayload). */
public enum IndexScope {
    WORK,
    PUBLISHED;

    public String wire() {
        return name().toLowerCase(Locale.ROOT);
    }

    public static IndexScope fromWire(String raw) {
        return valueOf(raw.toUpperCase(Locale.ROOT));
    }
}
```

`src/main/java/com/fallrising/cms/content/index/EntryIndexer.java`：

```java
package com.fallrising.cms.content.index;

import com.fallrising.cms.content.domain.ContentTypeRecord;
import com.fallrising.cms.content.domain.EntryRecord;
import com.fallrising.cms.content.domain.FieldRecord;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

/**
 * Computes the cms_entry_index rows of an entry (02 §3.2). Pure: the content stores and the V7 backfill both use it,
 * so every store indexes identically.
 *
 * <p>Indexed fields: enabled fields with indexed=true, plus the type's titleField, sortField, visibilityField,
 * ownerField and every field in publicRequiresPublishedRefs. Value kind by field type:
 * string and markdown → string; enum → enum; int → int (JSON numbers only, truncated to long);
 * boolean → bool (JSON booleans only); datetime → datetime (ISO-8601 instant or offset date-time);
 * ref and principal-ref → ref (the value's text). Other types and media-ref are not indexed.
 * Null values, blank strings and values of the wrong JSON type produce no row.
 */
public final class EntryIndexer {

    private EntryIndexer() {}

    /** Field keys that get index rows, in key order. Only enabled fields that exist on the type are returned. */
    public static Set<String> indexedKeys(ContentTypeRecord type, List<FieldRecord> fields) {
        Set<String> wanted = new TreeSet<>();
        for (FieldRecord field : fields) {
            if (field.enabled() && field.indexed()) wanted.add(field.fieldKey());
        }
        addIfPresent(wanted, type.titleField());
        addIfPresent(wanted, type.sortField());
        addIfPresent(wanted, type.visibilityField());
        addIfPresent(wanted, type.ownerField());
        type.publicRequiresPublishedRefs().forEach(key -> addIfPresent(wanted, key));
        Set<String> enabled = new TreeSet<>();
        for (FieldRecord field : fields) {
            if (field.enabled() && kind(field.fieldType()) != null) enabled.add(field.fieldKey());
        }
        wanted.retainAll(enabled);
        return wanted;
    }

    /** Index kind of a field type, or null when the type is not indexable. */
    public static String kind(String fieldType) {
        return switch (fieldType) {
            case "string", "markdown" -> "string";
            case "enum" -> "enum";
            case "int" -> "int";
            case "boolean" -> "bool";
            case "datetime" -> "datetime";
            case "ref", "principal-ref" -> "ref";
            default -> null;
        };
    }

    /** Rows for both scopes: WORK from payload, PUBLISHED from publishedPayload (none when it is null). */
    public static List<IndexRow> rows(ContentTypeRecord type, List<FieldRecord> fields, EntryRecord entry) {
        Map<String, FieldRecord> byKey = new LinkedHashMap<>();
        fields.forEach(field -> byKey.put(field.fieldKey(), field));
        List<IndexRow> rows = new ArrayList<>();
        for (String key : indexedKeys(type, fields)) {
            FieldRecord field = byKey.get(key);
            addRow(rows, entry, field, IndexScope.WORK, entry.payload());
            addRow(rows, entry, field, IndexScope.PUBLISHED, entry.publishedPayload());
        }
        return rows;
    }

    private static void addRow(List<IndexRow> rows, EntryRecord entry, FieldRecord field, IndexScope scope,
            Map<String, Object> payload) {
        if (payload == null) return;
        Object value = payload.get(field.fieldKey());
        if (value == null) return;
        String kind = kind(field.fieldType());
        switch (kind) {
            case "string", "enum", "ref" -> {
                if (value instanceof Map<?, ?> || value instanceof List<?>) return;
                String text = String.valueOf(value);
                if (text.isBlank()) return;
                rows.add(new IndexRow(entry.id(), field.fieldKey(), scope, kind, text, null, null, null));
            }
            case "int" -> {
                if (value instanceof Number number) {
                    rows.add(new IndexRow(entry.id(), field.fieldKey(), scope, kind, null, number.longValue(), null, null));
                }
            }
            case "bool" -> {
                if (value instanceof Boolean bool) {
                    rows.add(new IndexRow(entry.id(), field.fieldKey(), scope, kind, null, null, bool, null));
                }
            }
            case "datetime" -> {
                Instant instant = value instanceof String text ? parseInstant(text) : null;
                if (instant != null) {
                    rows.add(new IndexRow(entry.id(), field.fieldKey(), scope, kind, null, null, null, instant));
                }
            }
            default -> {
            }
        }
    }

    /** ISO-8601 instant ("2026-01-01T09:00:00Z") or offset date-time ("2026-01-01T17:00:00+08:00"); otherwise null. */
    public static Instant parseInstant(String text) {
        try {
            return Instant.parse(text);
        } catch (DateTimeParseException e) {
            try {
                return OffsetDateTime.parse(text).toInstant();
            } catch (DateTimeParseException e2) {
                return null;
            }
        }
    }

    private static void addIfPresent(Set<String> keys, String key) {
        if (key != null && !key.isBlank()) keys.add(key);
    }
}
```

索引規則（`EntryIndexer`，兩種 store 與 V7 共用，所以一致）：

| 欄位型別 | `value_kind` | 寫入的值 | 不寫入 |
| --- | --- | --- | --- |
| `string`、`markdown` | `string` | `String.valueOf(value)` | null、空白字串、JSON 物件或陣列 |
| `enum` | `enum` | 同上 | 同上 |
| `ref`、`principal-ref` | `ref` | 同上（不檢查是否為 UUID） | 同上 |
| `int` | `int` | `Number.longValue()` | 不是 JSON 數字（例如字串 `"7"`） |
| `boolean` | `bool` | 布林值 | 不是 JSON 布林（例如字串 `"true"`） |
| `datetime` | `datetime` | `Instant.parse`，失敗再試 `OffsetDateTime.parse(...).toInstant()` | 不是字串，或兩者都無法解析（例如 `2026-01-01`、`next friday`） |
| 其他（`media-ref`、`date` 等） | — | 不索引 | — |

- `WORK` 的列來自 `payload`，`PUBLISHED` 的列來自 `publishedPayload`；`publishedPayload` 是 null（草稿、封存、取消發布）時沒有 `PUBLISHED` 列。
- 哪些欄位：§4.3 的「有索引列的欄位」。與 02 §3.2 相比多了 `publicRequiresPublishedRefs` 的欄位，因為公開列表的「必要關聯必須公開」要在 SQL 裡判斷（§5.2）；本 PR 在 02 §3.2 補註。
- 軟刪除的 entry 仍有索引列（查詢以 `deleted_at IS NULL` 排除）；硬刪除時刪掉。

**store 的索引維護：**

| 時機 | in-memory | JDBC |
| --- | --- | --- |
| `insertEntry`、`updateEntry` | `synchronized`；寫入 entry 後以 `EntryIndexer.rows` 取代該 entry 的列 | `TransactionTemplate` 內：寫 entry → `DELETE FROM cms_entry_index WHERE entry_id = ?` → 批次 `INSERT` |
| `updateTypeSettings`、`insertField` | 寫入後重建該類型全部 entry 的列（`sortField` 等設定、新欄位都會改變索引集合） | 同一個交易內：寫入 → 讀類型、欄位、該類型全部 entry → `DELETE ... WHERE entry_id IN (SELECT id FROM cms_entry WHERE content_type_id = ?)` → 批次 `INSERT` |
| `hardDeleteEntry` | 移除該 entry 的列 | 同一個交易內刪除索引、關聯、revision、entry（順序不變） |
| `updateFieldMetadata` | 不重建（中繼資料不影響索引集合；`filterable` 只影響查詢參數的檢查） | 同左 |

`indexRowsOf(entryId)` 回傳該 entry 的全部列，依 `scope`（`published` 在 `work` 前）、再依 `field_key` 排序；JDBC 以 `COLLATE "C"` 排序，與 Java 字串比較一致。

T02 的 store diff（基準：BW1a 完成後；`listEntries` 在本卡保留）：

`src/main/java/com/fallrising/cms/content/store/ContentStore.java`：

```diff
--- a/src/main/java/com/fallrising/cms/content/store/ContentStore.java
+++ b/src/main/java/com/fallrising/cms/content/store/ContentStore.java
@@ -6,6 +6,7 @@
 import com.fallrising.cms.content.domain.FieldRecord;
 import com.fallrising.cms.content.domain.NavigationRecord;
 import com.fallrising.cms.content.domain.RevisionRecord;
+import com.fallrising.cms.content.index.IndexRow;
 
 import java.util.List;
 import java.util.Optional;
@@ -21,11 +22,12 @@
 
     void updateType(ContentTypeRecord type);
 
-    /** Writes only sortField, visibilityField, ownerField and updatedAt of the type with type.id(). */
+    /** Writes only sortField, visibilityField, ownerField and updatedAt of the type with type.id(), then reindexes its entries. */
     void updateTypeSettings(ContentTypeRecord type);
 
     List<FieldRecord> fieldsOf(UUID typeId);
 
+    /** Inserts the field, then reindexes the entries of its type. */
     void insertField(FieldRecord field);
 
     /** Writes only label, groupKey, listable, filterable, enumLabels, placeholder and helpText of the field with field.id(). */
@@ -41,10 +43,15 @@
     List<EntryRecord> listEntries(
             UUID typeId, List<String> states, boolean includeDeleted, String titleField, String q, String refField, UUID refTarget);
 
+    /** Index rows of one entry, both scopes, ordered by scope, then field key (for tests and diagnostics). */
+    List<IndexRow> indexRowsOf(UUID entryId);
+
     long countEntries(UUID typeId, boolean includeDeleted);
 
+    /** Inserts the entry and its index rows (EntryIndexer) atomically. */
     EntryRecord insertEntry(EntryRecord entry);
 
+    /** Updates the entry and replaces its index rows (EntryIndexer) atomically. */
     EntryRecord updateEntry(EntryRecord entry);
 
     void hardDeleteEntry(UUID id);
```

`src/main/java/com/fallrising/cms/content/store/InMemoryContentStore.java`：

```diff
--- a/src/main/java/com/fallrising/cms/content/store/InMemoryContentStore.java
+++ b/src/main/java/com/fallrising/cms/content/store/InMemoryContentStore.java
@@ -6,6 +6,8 @@
 import com.fallrising.cms.content.domain.FieldRecord;
 import com.fallrising.cms.content.domain.NavigationRecord;
 import com.fallrising.cms.content.domain.RevisionRecord;
+import com.fallrising.cms.content.index.EntryIndexer;
+import com.fallrising.cms.content.index.IndexRow;
 
 import java.util.ArrayList;
 import java.util.Comparator;
@@ -24,6 +26,7 @@
     private final ConcurrentHashMap<UUID, List<RevisionRecord>> revisions = new ConcurrentHashMap<>();
     private final ConcurrentHashMap<UUID, List<EntryRefRecord>> refs = new ConcurrentHashMap<>();
     private final ConcurrentHashMap<String, NavigationRecord> menus = new ConcurrentHashMap<>();
+    private final ConcurrentHashMap<UUID, List<IndexRow>> index = new ConcurrentHashMap<>();
 
     @Override
     public Optional<ContentTypeRecord> findTypeByKey(String typeKey) {
@@ -64,10 +67,11 @@
     }
 
     @Override
-    public void updateTypeSettings(ContentTypeRecord type) {
+    public synchronized void updateTypeSettings(ContentTypeRecord type) {
         types.computeIfPresent(type.typeKey(), (key, current) -> current.id().equals(type.id())
                 ? current.withSettings(type.sortField(), type.visibilityField(), type.ownerField(), type.updatedAt())
                 : current);
+        reindexType(type.id());
     }
 
     @Override
@@ -78,8 +82,9 @@
     }
 
     @Override
-    public void insertField(FieldRecord field) {
+    public synchronized void insertField(FieldRecord field) {
         fields.computeIfAbsent(field.contentTypeId(), ignored -> new CopyOnWriteArrayList<>()).add(field);
+        reindexType(field.contentTypeId());
     }
 
     @Override
@@ -125,6 +130,13 @@
     }
 
     @Override
+    public List<IndexRow> indexRowsOf(UUID entryId) {
+        return index.getOrDefault(entryId, List.of()).stream()
+                .sorted(Comparator.comparing((IndexRow r) -> r.scope().wire()).thenComparing(IndexRow::fieldKey))
+                .toList();
+    }
+
+    @Override
     public List<EntryRecord> listEntries(
             UUID typeId, List<String> states, boolean includeDeleted, String titleField, String q, String refField, UUID refTarget) {
         return entries.values().stream()
@@ -146,22 +158,25 @@
     }
 
     @Override
-    public EntryRecord insertEntry(EntryRecord entry) {
+    public synchronized EntryRecord insertEntry(EntryRecord entry) {
         entries.put(entry.id(), entry);
+        reindex(entry);
         return entry;
     }
 
     @Override
-    public EntryRecord updateEntry(EntryRecord entry) {
+    public synchronized EntryRecord updateEntry(EntryRecord entry) {
         entries.put(entry.id(), entry);
+        reindex(entry);
         return entry;
     }
 
     @Override
-    public void hardDeleteEntry(UUID id) {
+    public synchronized void hardDeleteEntry(UUID id) {
         entries.remove(id);
         revisions.remove(id);
         refs.remove(id);
+        index.remove(id);
     }
 
     @Override
@@ -206,6 +221,21 @@
         menus.put(menu.menuKey(), menu);
     }
 
+    // ---- index maintenance ----
+
+    private void reindex(EntryRecord entry) {
+        ContentTypeRecord type = typeById(entry.contentTypeId());
+        index.put(entry.id(), type == null ? List.of() : EntryIndexer.rows(type, fieldsOf(type.id()), entry));
+    }
+
+    private void reindexType(UUID typeId) {
+        entries.values().stream().filter(e -> e.contentTypeId().equals(typeId)).forEach(this::reindex);
+    }
+
+    private ContentTypeRecord typeById(UUID typeId) {
+        return types.values().stream().filter(t -> t.id().equals(typeId)).findFirst().orElse(null);
+    }
+
     private boolean matchesQ(EntryRecord entry, String titleField, String q) {
         if (q == null || q.isBlank()) {
             return true;
```

`src/main/java/com/fallrising/cms/content/store/JdbcContentStore.java`：

```diff
--- a/src/main/java/com/fallrising/cms/content/store/JdbcContentStore.java
+++ b/src/main/java/com/fallrising/cms/content/store/JdbcContentStore.java
@@ -7,10 +7,15 @@
 import com.fallrising.cms.content.domain.NavigationRecord;
 import com.fallrising.cms.content.domain.PublicationState;
 import com.fallrising.cms.content.domain.RevisionRecord;
+import com.fallrising.cms.content.index.EntryIndexer;
+import com.fallrising.cms.content.index.IndexRow;
+import com.fallrising.cms.content.index.IndexScope;
 import com.fasterxml.jackson.core.type.TypeReference;
 import com.fasterxml.jackson.databind.ObjectMapper;
 import org.springframework.jdbc.core.JdbcTemplate;
 import org.springframework.jdbc.core.RowMapper;
+import org.springframework.jdbc.datasource.DataSourceTransactionManager;
+import org.springframework.transaction.support.TransactionTemplate;
 
 import javax.sql.DataSource;
 import java.sql.ResultSet;
@@ -32,10 +37,12 @@
 
     private final JdbcTemplate jdbc;
     private final ObjectMapper mapper;
+    private final TransactionTemplate tx;
 
     public JdbcContentStore(DataSource dataSource, ObjectMapper mapper) {
         this.jdbc = new JdbcTemplate(dataSource);
         this.mapper = mapper;
+        this.tx = new TransactionTemplate(new DataSourceTransactionManager(dataSource));
     }
 
     @Override
@@ -93,6 +100,13 @@
 
     @Override
     public void updateTypeSettings(ContentTypeRecord type) {
+        tx.executeWithoutResult(status -> {
+            writeTypeSettings(type);
+            reindexType(type.id());
+        });
+    }
+
+    private void writeTypeSettings(ContentTypeRecord type) {
         jdbc.update(
                 "UPDATE cms_content_type SET sort_field = ?, visibility_field = ?, owner_field = ?, updated_at = ? WHERE id = ?",
                 type.sortField(),
@@ -112,6 +126,13 @@
 
     @Override
     public void insertField(FieldRecord field) {
+        tx.executeWithoutResult(status -> {
+            writeField(field);
+            reindexType(field.contentTypeId());
+        });
+    }
+
+    private void writeField(FieldRecord field) {
         jdbc.update(
                 """
                 INSERT INTO cms_field
@@ -192,6 +213,22 @@
     }
 
     @Override
+    public List<IndexRow> indexRowsOf(UUID entryId) {
+        return jdbc.query(
+                "SELECT * FROM cms_entry_index WHERE entry_id = ? ORDER BY scope COLLATE \"C\", field_key COLLATE \"C\"",
+                (rs, n) -> new IndexRow(
+                        rs.getObject("entry_id", UUID.class),
+                        rs.getString("field_key"),
+                        IndexScope.fromWire(rs.getString("scope")),
+                        rs.getString("value_kind"),
+                        rs.getString("value_string"),
+                        rs.getObject("value_int") == null ? null : rs.getLong("value_int"),
+                        rs.getObject("value_bool") == null ? null : rs.getBoolean("value_bool"),
+                        instant(rs, "value_ts")),
+                entryId);
+    }
+
+    @Override
     public List<EntryRecord> listEntries(
             UUID typeId, List<String> states, boolean includeDeleted, String titleField, String q, String refField, UUID refTarget) {
         StringBuilder sql = new StringBuilder(
@@ -242,6 +279,14 @@
 
     @Override
     public EntryRecord insertEntry(EntryRecord entry) {
+        tx.executeWithoutResult(status -> {
+            writeNewEntry(entry);
+            reindex(entry);
+        });
+        return entry;
+    }
+
+    private void writeNewEntry(EntryRecord entry) {
         jdbc.update(
                 """
                 INSERT INTO cms_entry
@@ -263,11 +308,18 @@
                 entry.updatedBy(),
                 ts(entry.createdAt()),
                 ts(entry.updatedAt()));
-        return entry;
     }
 
     @Override
     public EntryRecord updateEntry(EntryRecord entry) {
+        tx.executeWithoutResult(status -> {
+            writeEntry(entry);
+            reindex(entry);
+        });
+        return entry;
+    }
+
+    private void writeEntry(EntryRecord entry) {
         jdbc.update(
                 """
                 UPDATE cms_entry SET slug = ?, publication_state = ?, version = ?, payload = CAST(? AS jsonb),
@@ -286,15 +338,16 @@
                 entry.updatedBy(),
                 ts(entry.updatedAt()),
                 entry.id());
-        return entry;
     }
 
     @Override
     public void hardDeleteEntry(UUID id) {
-        jdbc.update("DELETE FROM cms_entry_index WHERE entry_id = ?", id);
-        jdbc.update("DELETE FROM cms_entry_ref WHERE from_entry_id = ?", id);
-        jdbc.update("DELETE FROM cms_entry_revision WHERE entry_id = ?", id);
-        jdbc.update("DELETE FROM cms_entry WHERE id = ?", id);
+        tx.executeWithoutResult(status -> {
+            jdbc.update("DELETE FROM cms_entry_index WHERE entry_id = ?", id);
+            jdbc.update("DELETE FROM cms_entry_ref WHERE from_entry_id = ?", id);
+            jdbc.update("DELETE FROM cms_entry_revision WHERE entry_id = ?", id);
+            jdbc.update("DELETE FROM cms_entry WHERE id = ?", id);
+        });
     }
 
     @Override
@@ -405,6 +458,46 @@
         }
     }
 
+    // ---- index maintenance ----
+
+    private void reindex(EntryRecord entry) {
+        List<ContentTypeRecord> type = jdbc.query("SELECT * FROM cms_content_type WHERE id = ?", typeMapper(), entry.contentTypeId());
+        jdbc.update("DELETE FROM cms_entry_index WHERE entry_id = ?", entry.id());
+        if (type.isEmpty()) return;
+        insertRows(EntryIndexer.rows(type.getFirst(), fieldsOf(type.getFirst().id()), entry));
+    }
+
+    private void reindexType(UUID typeId) {
+        List<ContentTypeRecord> type = jdbc.query("SELECT * FROM cms_content_type WHERE id = ?", typeMapper(), typeId);
+        if (type.isEmpty()) return;
+        List<FieldRecord> fields = fieldsOf(typeId);
+        List<EntryRecord> all = jdbc.query(
+                """
+                SELECT e.*, t.type_key FROM cms_entry e
+                JOIN cms_content_type t ON t.id = e.content_type_id
+                WHERE e.content_type_id = ?
+                """,
+                entryMapper(),
+                typeId);
+        jdbc.update("DELETE FROM cms_entry_index WHERE entry_id IN (SELECT id FROM cms_entry WHERE content_type_id = ?)", typeId);
+        List<IndexRow> rows = new ArrayList<>();
+        all.forEach(entry -> rows.addAll(EntryIndexer.rows(type.getFirst(), fields, entry)));
+        insertRows(rows);
+    }
+
+    private void insertRows(List<IndexRow> rows) {
+        if (rows.isEmpty()) return;
+        jdbc.batchUpdate(
+                """
+                INSERT INTO cms_entry_index
+                  (entry_id, field_key, scope, value_kind, value_string, value_int, value_bool, value_ts)
+                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
+                """,
+                rows.stream().map(row -> new Object[] {
+                        row.entryId(), row.fieldKey(), row.scope().wire(), row.kind(), row.stringValue(),
+                        row.intValue(), row.boolValue(), ts(row.tsValue())}).toList());
+    }
+
     private RowMapper<ContentTypeRecord> typeMapper() {
         return (rs, n) -> new ContentTypeRecord(
                 rs.getObject("id", UUID.class),
```

### 5.2 查詢求值（T04）

**查詢型別**（全文）：

`src/main/java/com/fallrising/cms/content/query/EntryQuery.java`：

```java
package com.fallrising.cms.content.query;

import com.fallrising.cms.content.index.IndexScope;

import java.util.List;
import java.util.UUID;

/**
 * A list query that a ContentStore evaluates in one pass (02 BD-04). All filters are combined with AND.
 *
 * @param typeId            content type of the entries
 * @param scope             WORK lists working copies; PUBLISHED lists published copies and applies the public rules
 * @param states            publication states to include (WORK only; PUBLISHED always means "published")
 * @param titleField        field searched by q
 * @param q                 case-insensitive literal substring of the titleField index value; null or blank = no filter
 * @param filters           field conditions on index rows of the scope
 * @param refs              relation conditions on cms_entry_ref (field key and target id)
 * @param access            authorization restriction from predicate grants; unrestricted() = none
 * @param visibilityField   PUBLISHED only: entries with an index row for this field whose value is not "public" are excluded
 * @param requiredRefs      PUBLISHED only: every listed ref field that has a value must point to a publicly readable entry
 * @param sort              primary sort key; ties are broken by updatedAt descending, then id text ascending
 * @param page              1-based page
 * @param size              page size, 1..100
 */
public record EntryQuery(
        UUID typeId,
        IndexScope scope,
        List<String> states,
        String titleField,
        String q,
        List<FieldFilter> filters,
        List<RefFilter> refs,
        AccessFilter access,
        String visibilityField,
        List<String> requiredRefs,
        SortKey sort,
        int page,
        int size) {

    public EntryQuery {
        states = List.copyOf(states);
        filters = List.copyOf(filters);
        refs = List.copyOf(refs);
        requiredRefs = List.copyOf(requiredRefs);
    }

    public int offset() {
        return (page - 1) * size;
    }
}
```

`src/main/java/com/fallrising/cms/content/query/FieldFilter.java`：

```java
package com.fallrising.cms.content.query;

import java.time.Instant;

/**
 * A condition on the index rows of one field. EQUALS compares by the field's index kind (value is String for
 * string/enum/ref, Long for int, Boolean for bool). RANGE applies to datetime: from inclusive, to exclusive,
 * either bound may be null.
 */
public record FieldFilter(String fieldKey, String kind, Op op, Object value, Instant from, Instant to) {

    public enum Op { EQUALS, RANGE }

    public static FieldFilter equalsValue(String fieldKey, String kind, Object value) {
        return new FieldFilter(fieldKey, kind, Op.EQUALS, value, null, null);
    }

    public static FieldFilter range(String fieldKey, Instant from, Instant to) {
        return new FieldFilter(fieldKey, "datetime", Op.RANGE, null, from, to);
    }
}
```

`src/main/java/com/fallrising/cms/content/query/RefFilter.java`：

```java
package com.fallrising.cms.content.query;

import java.util.UUID;

/** Keeps entries whose cms_entry_ref has (fieldKey, targetId). */
public record RefFilter(String fieldKey, UUID targetId) {}
```

`src/main/java/com/fallrising/cms/content/query/SortKey.java`：

```java
package com.fallrising.cms.content.query;

/**
 * Primary sort. SYSTEM sorts by an entry column (updatedAt, createdAt or publishedAt); FIELD sorts by the index value of
 * fieldKey in the query scope using kind's column. Entries without a value sort last in both directions.
 */
public record SortKey(Source source, String key, String kind, boolean descending) {

    public enum Source { SYSTEM, FIELD }

    public static SortKey system(String key, boolean descending) {
        return new SortKey(Source.SYSTEM, key, null, descending);
    }

    public static SortKey field(String key, String kind, boolean descending) {
        return new SortKey(Source.FIELD, key, kind, descending);
    }
}
```

`src/main/java/com/fallrising/cms/content/query/AccessFilter.java`：

```java
package com.fallrising.cms.content.query;

import java.util.List;

/**
 * Authorization pushed into the query (02 §4.1, B-10). unrestricted = no condition. Otherwise an entry matches when
 * any clause matches: the index row of clause.fieldKey (in the query scope, kind string/enum/ref) equals clause.value.
 * An empty clause list with unrestricted=false matches nothing.
 */
public record AccessFilter(boolean unrestricted, List<Clause> anyOf) {

    public record Clause(String fieldKey, String value) {}

    public AccessFilter {
        anyOf = List.copyOf(anyOf);
    }

    public static AccessFilter none() {
        return new AccessFilter(true, List.of());
    }

    public static AccessFilter anyOf(List<Clause> clauses) {
        return new AccessFilter(false, clauses);
    }
}
```

`src/main/java/com/fallrising/cms/content/query/EntryPage.java`：

```java
package com.fallrising.cms.content.query;

import com.fallrising.cms.content.domain.EntryRecord;

import java.util.List;

/** One page of a query and the number of matching entries on all pages. */
public record EntryPage(List<EntryRecord> items, long total) {

    public EntryPage {
        items = List.copyOf(items);
    }
}
```

**語意（兩種 store 必須一致，BD-10）。** 所有條件以 AND 連接。「列」指該 entry 在查詢 scope（`WORK`→`work`、`PUBLISHED`→`published`）、指定欄位的索引列。

| # | 條件 | in-memory（`InMemoryContentStore.matches`） | SQL 片段（`JdbcContentStore.where`）與綁定 |
| --- | --- | --- | --- |
| 1 | 類型、未刪除 | `contentTypeId` 相同且 `deletedAt` 為 null | `e.content_type_id = ? AND e.deleted_at IS NULL`；`typeId` |
| 2 | `WORK` 狀態 | `states` 含 `publicationState.wire()`；空清單不符合 | `AND e.publication_state IN (?, …)`；每個狀態。空清單：`AND FALSE` |
| 3 | `PUBLISHED` 狀態 | 狀態是 `PUBLISHED` 且 `publishedPayload` 不是 null | `AND e.publication_state = 'published' AND e.published_payload IS NOT NULL` |
| 4 | `PUBLISHED` 可見性（`visibilityField` 不是 null 時） | 有列且值不是 `public` 就排除（沒有列＝公開，與 `PublicVisibility.indexable` 相同） | `AND NOT EXISTS (SELECT 1 FROM cms_entry_index v WHERE v.entry_id = e.id AND v.scope = 'published' AND v.field_key = ? AND v.value_string <> 'public')`；`visibilityField` |
| 5 | `PUBLISHED` 必要關聯（每個 `requiredRefs` 欄位） | 有列時，列值必須是小寫標準格式的 UUID，指向存在、未刪除、已發布（`publishedPayload` 不是 null）的 entry，且目標類型有 `visibilityField` 時，目標的已發布列不是 `private`；沒有列＝不檢查 | 見下方 SQL；每個欄位綁定一次欄位名 |
| 6 | `q`（非 null 且非空白） | titleField 的列存在，且 `toLowerCase(Locale.ROOT)` 後包含 `q.toLowerCase(Locale.ROOT)`；titleField 是 null 時不符合 | `AND EXISTS (SELECT 1 FROM cms_entry_index x WHERE x.entry_id = e.id AND x.scope = ? AND x.field_key = ? AND x.value_string ILIKE ? ESCAPE '\')`；scope、titleField、`%` + 跳脫後的 `q` + `%`（`\`、`%`、`_` 前加 `\`，沿用 BW0 的 `escapeLike`） |
| 7 | `FieldFilter` `EQUALS` | 列存在，且依種類比較：`int` 比 `intValue`（`Long`）、`bool` 比 `boolValue`，其他比 `stringValue` | `AND EXISTS (SELECT 1 FROM cms_entry_index f WHERE f.entry_id = e.id AND f.scope = ? AND f.field_key = ? AND f.value_int = ?)`（`bool` 用 `value_bool`，其他用 `value_string`）；scope、欄位、值 |
| 8 | `FieldFilter` `RANGE` | 列的 `tsValue` 存在，`from` 為 null 或 `ts >= from`，`to` 為 null 或 `ts < to` | 同上，但條件是 `AND f.value_ts IS NOT NULL`；`from` 不是 null 時再加 `AND f.value_ts >= ?`，`to` 不是 null 時再加 `AND f.value_ts < ?` |
| 9 | `RefFilter` | `cms_entry_ref`（in-memory 的 `refs`）有 `(fieldKey, targetId)` | `AND EXISTS (SELECT 1 FROM cms_entry_ref rf WHERE rf.from_entry_id = e.id AND rf.field_key = ? AND rf.to_id = ?)` |
| 10 | `AccessFilter` | §4.4 | §4.4 |

條件 5 的 SQL（每個欄位一段）：

```sql
AND NOT EXISTS (SELECT 1 FROM cms_entry_index r WHERE r.entry_id = e.id AND r.scope = 'published'
  AND r.field_key = ? AND NOT EXISTS (
    SELECT 1 FROM cms_entry te JOIN cms_content_type tt ON tt.id = te.content_type_id
    WHERE te.id = (CASE WHEN r.value_string ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                        THEN CAST(r.value_string AS uuid) END)
      AND te.deleted_at IS NULL AND te.publication_state = 'published'
      AND te.published_payload IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM cms_entry_index tv WHERE tv.entry_id = te.id
        AND tv.scope = 'published' AND tv.field_key = tt.visibility_field
        AND tv.value_string = 'private')))
```

`CASE` 保證不是 UUID 的文字不會被轉型（否則 PostgreSQL 會丟錯）；正規表示式只接受小寫，與 in-memory 的「`UUID.fromString(text).toString().equals(text)`」一致。目標 `unlisted` 仍算公開（與 `PublicVisibility.gettable` 相同，02 BQ-02）。

**排序。** 主鍵依 `SortKey`，之後一律依 `updatedAt` 遞減、再依 id 文字遞增：

| 主鍵 | in-memory 取值 | SQL `sort_value` |
| --- | --- | --- |
| `SYSTEM updatedAt`／`createdAt`／`publishedAt` | entry 欄位 | `e.updated_at`／`e.created_at`／`e.published_at` |
| `FIELD`，種類 `int`／`bool`／`datetime` | 列的 `intValue`／`boolValue`／`tsValue` | `(SELECT s.value_int … FROM cms_entry_index s WHERE s.entry_id = e.id AND s.scope = ? AND s.field_key = ? LIMIT 1)` |
| `FIELD`，其他種類 | 列的 `stringValue`，Java `String.compareTo` | 同上，但取 `s.value_string COLLATE "C"`（位元組順序，與 Java 在 BMP 字元上的順序一致） |

- 沒有值（null 或沒有列）的 entry 在遞增、遞減時**都排最後**：SQL 寫成 `ORDER BY sort_value ASC|DESC NULLS LAST, e.updated_at DESC, e.id::text COLLATE "C" ASC`。
- 分頁：in-memory `skip((page-1)*size).limit(size)`；SQL `LIMIT ? OFFSET ?`。
- `total`：in-memory 是符合條件的筆數；SQL 是 `SELECT COUNT(*) FROM cms_entry e WHERE <條件>`（同一組條件與綁定）。
- **一次 `queryEntries` 在 JDBC 正好執行 2 個 SQL**（COUNT 與分頁 SELECT），與筆數、頁大小無關（`ListQueryPerformanceTests` 以計數的 `DataSource` 驗證）。

分頁 SELECT 的完整形狀（綁定依序是：排序子查詢的 scope 與欄位（`FIELD` 時）、條件的綁定、`size`、`offset`）：

```sql
SELECT e.*, t.type_key, <sort_value 運算式> AS sort_value FROM cms_entry e
  JOIN cms_content_type t ON t.id = e.content_type_id
 WHERE <條件 1～10>
 ORDER BY sort_value <ASC|DESC> NULLS LAST, e.updated_at DESC, e.id::text COLLATE "C" ASC
 LIMIT ? OFFSET ?
```

T04 的 store diff（基準：T02 完成後；`listEntries` 仍保留，T10 才移除）：

`src/main/java/com/fallrising/cms/content/store/ContentStore.java`：

```diff
--- a/src/main/java/com/fallrising/cms/content/store/ContentStore.java
+++ b/src/main/java/com/fallrising/cms/content/store/ContentStore.java
@@ -7,6 +7,8 @@
 import com.fallrising.cms.content.domain.NavigationRecord;
 import com.fallrising.cms.content.domain.RevisionRecord;
 import com.fallrising.cms.content.index.IndexRow;
+import com.fallrising.cms.content.query.EntryPage;
+import com.fallrising.cms.content.query.EntryQuery;
 
 import java.util.List;
 import java.util.Optional;
@@ -43,6 +45,9 @@
     List<EntryRecord> listEntries(
             UUID typeId, List<String> states, boolean includeDeleted, String titleField, String q, String refField, UUID refTarget);
 
+    /** Evaluates a list query (02 BD-04). Soft-deleted entries never match. */
+    EntryPage queryEntries(EntryQuery query);
+
     /** Index rows of one entry, both scopes, ordered by scope, then field key (for tests and diagnostics). */
     List<IndexRow> indexRowsOf(UUID entryId);
 
```

`src/main/java/com/fallrising/cms/content/store/InMemoryContentStore.java`：

```diff
--- a/src/main/java/com/fallrising/cms/content/store/InMemoryContentStore.java
+++ b/src/main/java/com/fallrising/cms/content/store/InMemoryContentStore.java
@@ -5,14 +5,24 @@
 import com.fallrising.cms.content.domain.EntryRefRecord;
 import com.fallrising.cms.content.domain.FieldRecord;
 import com.fallrising.cms.content.domain.NavigationRecord;
+import com.fallrising.cms.content.domain.PublicationState;
 import com.fallrising.cms.content.domain.RevisionRecord;
 import com.fallrising.cms.content.index.EntryIndexer;
 import com.fallrising.cms.content.index.IndexRow;
+import com.fallrising.cms.content.index.IndexScope;
+import com.fallrising.cms.content.query.AccessFilter;
+import com.fallrising.cms.content.query.EntryPage;
+import com.fallrising.cms.content.query.EntryQuery;
+import com.fallrising.cms.content.query.FieldFilter;
+import com.fallrising.cms.content.query.RefFilter;
+import com.fallrising.cms.content.query.SortKey;
 
+import java.time.Instant;
 import java.util.ArrayList;
 import java.util.Comparator;
 import java.util.List;
 import java.util.Locale;
+import java.util.Objects;
 import java.util.Optional;
 import java.util.UUID;
 import java.util.concurrent.ConcurrentHashMap;
@@ -130,6 +140,16 @@
     }
 
     @Override
+    public EntryPage queryEntries(EntryQuery query) {
+        List<EntryRecord> matching = entries.values().stream()
+                .filter(e -> matches(e, query))
+                .sorted(order(query))
+                .toList();
+        List<EntryRecord> page = matching.stream().skip(query.offset()).limit(query.size()).toList();
+        return new EntryPage(page, matching.size());
+    }
+
+    @Override
     public List<IndexRow> indexRowsOf(UUID entryId) {
         return index.getOrDefault(entryId, List.of()).stream()
                 .sorted(Comparator.comparing((IndexRow r) -> r.scope().wire()).thenComparing(IndexRow::fieldKey))
@@ -236,6 +256,128 @@
         return types.values().stream().filter(t -> t.id().equals(typeId)).findFirst().orElse(null);
     }
 
+    // ---- query evaluation; must match JdbcContentStore.queryEntries ----
+
+    private boolean matches(EntryRecord e, EntryQuery query) {
+        if (!e.contentTypeId().equals(query.typeId()) || e.deleted()) return false;
+        IndexScope scope = query.scope();
+        if (scope == IndexScope.WORK) {
+            if (!query.states().contains(e.publicationState().wire())) return false;
+        } else {
+            if (e.publicationState() != PublicationState.PUBLISHED || e.publishedPayload() == null) return false;
+            if (query.visibilityField() != null) {
+                IndexRow visibility = row(e.id(), scope, query.visibilityField());
+                if (visibility != null && !"public".equals(visibility.stringValue())) {
+                    return false;
+                }
+            }
+            for (String refField : query.requiredRefs()) {
+                IndexRow ref = row(e.id(), scope, refField);
+                if (ref != null && !publiclyReadable(ref.stringValue())) return false;
+            }
+        }
+        if (query.q() != null && !query.q().isBlank()) {
+            IndexRow title = query.titleField() == null ? null : row(e.id(), scope, query.titleField());
+            if (title == null || title.stringValue() == null
+                    || !title.stringValue().toLowerCase(Locale.ROOT).contains(query.q().toLowerCase(Locale.ROOT))) {
+                return false;
+            }
+        }
+        for (FieldFilter filter : query.filters()) {
+            if (!matches(row(e.id(), scope, filter.fieldKey()), filter)) return false;
+        }
+        for (RefFilter ref : query.refs()) {
+            boolean found = refs.getOrDefault(e.id(), List.of()).stream()
+                    .anyMatch(r -> ref.fieldKey().equals(r.fieldKey()) && ref.targetId().equals(r.toId()));
+            if (!found) return false;
+        }
+        AccessFilter access = query.access();
+        if (!access.unrestricted()) {
+            boolean allowed = access.anyOf().stream().anyMatch(clause -> {
+                IndexRow row = row(e.id(), scope, clause.fieldKey());
+                return row != null && clause.value().equals(row.stringValue());
+            });
+            if (!allowed) return false;
+        }
+        return true;
+    }
+
+    private static boolean matches(IndexRow row, FieldFilter filter) {
+        if (row == null) return false;
+        if (filter.op() == FieldFilter.Op.RANGE) {
+            Instant ts = row.tsValue();
+            if (ts == null) return false;
+            return (filter.from() == null || !ts.isBefore(filter.from())) && (filter.to() == null || ts.isBefore(filter.to()));
+        }
+        return switch (filter.kind()) {
+            case "int" -> Objects.equals(row.intValue(), filter.value());
+            case "bool" -> Objects.equals(row.boolValue(), filter.value());
+            default -> Objects.equals(row.stringValue(), filter.value());
+        };
+    }
+
+    /** Target id text of a required ref: the entry exists, is not deleted, is published and is not private. */
+    private boolean publiclyReadable(String targetText) {
+        UUID targetId;
+        try {
+            targetId = UUID.fromString(targetText);
+        } catch (IllegalArgumentException e) {
+            return false;
+        }
+        if (!targetId.toString().equals(targetText)) return false;
+        EntryRecord target = entries.get(targetId);
+        if (target == null || target.deleted() || target.publicationState() != PublicationState.PUBLISHED
+                || target.publishedPayload() == null) {
+            return false;
+        }
+        ContentTypeRecord targetType = typeById(target.contentTypeId());
+        if (targetType == null || targetType.visibilityField() == null) return true;
+        IndexRow visibility = row(targetId, IndexScope.PUBLISHED, targetType.visibilityField());
+        return visibility == null || !"private".equals(visibility.stringValue());
+    }
+
+    private IndexRow row(UUID entryId, IndexScope scope, String fieldKey) {
+        return index.getOrDefault(entryId, List.of()).stream()
+                .filter(r -> r.scope() == scope && r.fieldKey().equals(fieldKey))
+                .findFirst()
+                .orElse(null);
+    }
+
+    private Comparator<EntryRecord> order(EntryQuery query) {
+        SortKey sort = query.sort();
+        Comparator<EntryRecord> primary = (a, b) -> {
+            Comparable<Object> va = sortValue(a, sort, query.scope());
+            Comparable<Object> vb = sortValue(b, sort, query.scope());
+            if (va == null && vb == null) return 0;
+            if (va == null) return 1;
+            if (vb == null) return -1;
+            int result = va.compareTo(vb);
+            return sort.descending() ? -result : result;
+        };
+        return primary
+                .thenComparing(EntryRecord::updatedAt, Comparator.reverseOrder())
+                .thenComparing(e -> e.id().toString());
+    }
+
+    @SuppressWarnings("unchecked")
+    private Comparable<Object> sortValue(EntryRecord e, SortKey sort, IndexScope scope) {
+        if (sort.source() == SortKey.Source.SYSTEM) {
+            return (Comparable<Object>) (Comparable<?>) switch (sort.key()) {
+                case "createdAt" -> e.createdAt();
+                case "publishedAt" -> e.publishedAt();
+                default -> e.updatedAt();
+            };
+        }
+        IndexRow row = row(e.id(), scope, sort.key());
+        if (row == null) return null;
+        return (Comparable<Object>) (Comparable<?>) switch (sort.kind()) {
+            case "int" -> row.intValue();
+            case "bool" -> row.boolValue();
+            case "datetime" -> row.tsValue();
+            default -> row.stringValue();
+        };
+    }
+
     private boolean matchesQ(EntryRecord entry, String titleField, String q) {
         if (q == null || q.isBlank()) {
             return true;
```

`src/main/java/com/fallrising/cms/content/store/JdbcContentStore.java`：

```diff
--- a/src/main/java/com/fallrising/cms/content/store/JdbcContentStore.java
+++ b/src/main/java/com/fallrising/cms/content/store/JdbcContentStore.java
@@ -10,6 +10,12 @@
 import com.fallrising.cms.content.index.EntryIndexer;
 import com.fallrising.cms.content.index.IndexRow;
 import com.fallrising.cms.content.index.IndexScope;
+import com.fallrising.cms.content.query.AccessFilter;
+import com.fallrising.cms.content.query.EntryPage;
+import com.fallrising.cms.content.query.EntryQuery;
+import com.fallrising.cms.content.query.FieldFilter;
+import com.fallrising.cms.content.query.RefFilter;
+import com.fallrising.cms.content.query.SortKey;
 import com.fasterxml.jackson.core.type.TypeReference;
 import com.fasterxml.jackson.databind.ObjectMapper;
 import org.springframework.jdbc.core.JdbcTemplate;
@@ -213,6 +219,26 @@
     }
 
     @Override
+    public EntryPage queryEntries(EntryQuery query) {
+        List<Object> args = new ArrayList<>();
+        String where = where(query, args);
+        Long total = jdbc.queryForObject("SELECT COUNT(*) FROM cms_entry e WHERE " + where, Long.class, args.toArray());
+        List<Object> pageArgs = new ArrayList<>();
+        String sortColumn = sortColumn(query, pageArgs);
+        pageArgs.addAll(args);
+        SortKey sort = query.sort();
+        String direction = sort.descending() ? "DESC" : "ASC";
+        String sql = "SELECT e.*, t.type_key, " + sortColumn + " AS sort_value FROM cms_entry e"
+                + " JOIN cms_content_type t ON t.id = e.content_type_id WHERE " + where
+                + " ORDER BY sort_value " + direction + " NULLS LAST, e.updated_at DESC, e.id::text COLLATE \"C\" ASC"
+                + " LIMIT ? OFFSET ?";
+        pageArgs.add(query.size());
+        pageArgs.add(query.offset());
+        List<EntryRecord> items = jdbc.query(sql, entryMapper(), pageArgs.toArray());
+        return new EntryPage(items, total == null ? 0 : total);
+    }
+
+    @Override
     public List<IndexRow> indexRowsOf(UUID entryId) {
         return jdbc.query(
                 "SELECT * FROM cms_entry_index WHERE entry_id = ? ORDER BY scope COLLATE \"C\", field_key COLLATE \"C\"",
@@ -498,6 +524,121 @@
                         row.intValue(), row.boolValue(), ts(row.tsValue())}).toList());
     }
 
+    // ---- query translation; must match InMemoryContentStore.queryEntries ----
+
+    private static final String UUID_TEXT = "'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'";
+
+    private String where(EntryQuery query, List<Object> args) {
+        String scope = query.scope().wire();
+        StringBuilder sql = new StringBuilder("e.content_type_id = ? AND e.deleted_at IS NULL");
+        args.add(query.typeId());
+        if (query.scope() == IndexScope.WORK) {
+            if (query.states().isEmpty()) {
+                sql.append(" AND FALSE");
+            } else {
+                sql.append(" AND e.publication_state IN (")
+                        .append(String.join(", ", query.states().stream().map(s -> "?").toList()))
+                        .append(")");
+                args.addAll(query.states());
+            }
+        } else {
+            sql.append(" AND e.publication_state = 'published' AND e.published_payload IS NOT NULL");
+            if (query.visibilityField() != null) {
+                sql.append(" ").append("""
+                         AND NOT EXISTS (SELECT 1 FROM cms_entry_index v WHERE v.entry_id = e.id AND v.scope = 'published'
+                           AND v.field_key = ? AND v.value_string <> 'public')""");
+                args.add(query.visibilityField());
+            }
+            for (String refField : query.requiredRefs()) {
+                sql.append(" ").append("""
+                         AND NOT EXISTS (SELECT 1 FROM cms_entry_index r WHERE r.entry_id = e.id AND r.scope = 'published'
+                           AND r.field_key = ? AND NOT EXISTS (
+                             SELECT 1 FROM cms_entry te JOIN cms_content_type tt ON tt.id = te.content_type_id
+                             WHERE te.id = (CASE WHEN r.value_string ~ %s THEN CAST(r.value_string AS uuid) END)
+                               AND te.deleted_at IS NULL AND te.publication_state = 'published'
+                               AND te.published_payload IS NOT NULL
+                               AND NOT EXISTS (SELECT 1 FROM cms_entry_index tv WHERE tv.entry_id = te.id
+                                 AND tv.scope = 'published' AND tv.field_key = tt.visibility_field
+                                 AND tv.value_string = 'private')))""".formatted(UUID_TEXT));
+                args.add(refField);
+            }
+        }
+        if (query.q() != null && !query.q().isBlank()) {
+            sql.append(" ").append("""
+                     AND EXISTS (SELECT 1 FROM cms_entry_index x WHERE x.entry_id = e.id AND x.scope = ?
+                       AND x.field_key = ? AND x.value_string ILIKE ? ESCAPE '\\')""");
+            args.add(scope);
+            args.add(query.titleField());
+            args.add("%" + escapeLike(query.q()) + "%");
+        }
+        for (FieldFilter filter : query.filters()) {
+            sql.append(" AND EXISTS (SELECT 1 FROM cms_entry_index f WHERE f.entry_id = e.id AND f.scope = ? AND f.field_key = ?");
+            args.add(scope);
+            args.add(filter.fieldKey());
+            if (filter.op() == FieldFilter.Op.RANGE) {
+                sql.append(" AND f.value_ts IS NOT NULL");
+                if (filter.from() != null) {
+                    sql.append(" AND f.value_ts >= ?");
+                    args.add(ts(filter.from()));
+                }
+                if (filter.to() != null) {
+                    sql.append(" AND f.value_ts < ?");
+                    args.add(ts(filter.to()));
+                }
+            } else {
+                sql.append(switch (filter.kind()) {
+                    case "int" -> " AND f.value_int = ?";
+                    case "bool" -> " AND f.value_bool = ?";
+                    default -> " AND f.value_string = ?";
+                });
+                args.add(filter.value());
+            }
+            sql.append(")");
+        }
+        for (RefFilter ref : query.refs()) {
+            sql.append(" AND EXISTS (SELECT 1 FROM cms_entry_ref rf WHERE rf.from_entry_id = e.id AND rf.field_key = ? AND rf.to_id = ?)");
+            args.add(ref.fieldKey());
+            args.add(ref.targetId());
+        }
+        AccessFilter access = query.access();
+        if (!access.unrestricted()) {
+            if (access.anyOf().isEmpty()) {
+                sql.append(" AND FALSE");
+            } else {
+                sql.append(" AND EXISTS (SELECT 1 FROM cms_entry_index a WHERE a.entry_id = e.id AND a.scope = ? AND (");
+                args.add(scope);
+                List<String> clauses = new ArrayList<>();
+                for (AccessFilter.Clause clause : access.anyOf()) {
+                    clauses.add("(a.field_key = ? AND a.value_string = ?)");
+                    args.add(clause.fieldKey());
+                    args.add(clause.value());
+                }
+                sql.append(String.join(" OR ", clauses)).append("))");
+            }
+        }
+        return sql.toString();
+    }
+
+    private static String sortColumn(EntryQuery query, List<Object> args) {
+        SortKey sort = query.sort();
+        if (sort.source() == SortKey.Source.SYSTEM) {
+            return switch (sort.key()) {
+                case "createdAt" -> "e.created_at";
+                case "publishedAt" -> "e.published_at";
+                default -> "e.updated_at";
+            };
+        }
+        String column = switch (sort.kind()) {
+            case "int" -> "s.value_int";
+            case "bool" -> "s.value_bool";
+            case "datetime" -> "s.value_ts";
+            default -> "s.value_string COLLATE \"C\"";
+        };
+        args.add(query.scope().wire());
+        args.add(sort.key());
+        return "(SELECT " + column + " FROM cms_entry_index s WHERE s.entry_id = e.id AND s.scope = ? AND s.field_key = ? LIMIT 1)";
+    }
+
     private RowMapper<ContentTypeRecord> typeMapper() {
         return (rs, n) -> new ContentTypeRecord(
                 rs.getObject("id", UUID.class),
```

### 5.3 V7 回填（T06）

V7 的全文在 §4.5。T05 為了在 V6 與 V7 之間插入資料，`PostgresFixture` 多一個不跑 migration 的 `emptyDataSource()`；`cleanDataSource()` 改成呼叫它再 migrate，行為不變：

`src/integrationTest/java/com/fallrising/cms/contract/PostgresFixture.java`：

```diff
--- a/src/integrationTest/java/com/fallrising/cms/contract/PostgresFixture.java
+++ b/src/integrationTest/java/com/fallrising/cms/contract/PostgresFixture.java
@@ -6,7 +6,7 @@
 
 import javax.sql.DataSource;
 
-/** One PostgreSQL 16 container for all store contract tests; every call returns a freshly migrated schema. */
+/** One PostgreSQL 16 container for all store contract tests; every call returns a fresh schema. */
 final class PostgresFixture {
 
     private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
@@ -17,13 +17,20 @@
 
     private PostgresFixture() {}
 
+    /** An empty schema migrated to the latest version. */
     static DataSource cleanDataSource() {
+        DataSource dataSource = emptyDataSource();
+        Flyway.configure().dataSource(dataSource).locations("classpath:db/migration").load().migrate();
+        return dataSource;
+    }
+
+    /** An empty schema without any migration applied (for migration tests such as EntryIndexBackfillTests). */
+    static DataSource emptyDataSource() {
         PGSimpleDataSource dataSource = new PGSimpleDataSource();
         dataSource.setURL(POSTGRES.getJdbcUrl());
         dataSource.setUser(POSTGRES.getUsername());
         dataSource.setPassword(POSTGRES.getPassword());
         Flyway.configure().dataSource(dataSource).locations("classpath:db/migration").cleanDisabled(false).load().clean();
-        Flyway.configure().dataSource(dataSource).locations("classpath:db/migration").load().migrate();
         return dataSource;
     }
 }
```

### 5.4 查詢參數與授權（T08）

**`ListQueryParser`**（全文；文法見 §4.3）：

`src/main/java/com/fallrising/cms/content/query/ListQueryParser.java`：

```java
package com.fallrising.cms.content.query;

import com.fallrising.cms.content.ContentException;
import com.fallrising.cms.content.domain.ContentTypeRecord;
import com.fallrising.cms.content.domain.FieldRecord;
import com.fallrising.cms.content.index.EntryIndexer;
import com.fallrising.cms.content.index.IndexScope;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Parses the query parameters of the work and public list endpoints (02 §4.1). Every rejected input throws
 * 400 VALIDATION_FAILED whose message names the parameter. Parameters not listed here are ignored.
 *
 * <ul>
 *   <li>page: integer ≥ 1, default 1. size: integer 1..100, default 20.</li>
 *   <li>sort: one key, optional "-" prefix for descending. Keys: updatedAt, createdAt, publishedAt, title
 *       (the type's titleField), or a sortable field. Default: work -updatedAt; public sortField ascending when the
 *       type has one, otherwise -publishedAt.</li>
 *   <li>state (work only): comma-separated subset of draft, published, archived; default draft,published.</li>
 *   <li>q: substring of the titleField value; blank means no filter.</li>
 *   <li>filter.&lt;field&gt;: equality on a filterable field; datetime fields take filter.&lt;field&gt;.from
 *       (inclusive) and filter.&lt;field&gt;.to (exclusive) instead. Each name at most once.</li>
 *   <li>ref.&lt;field&gt;: target entry id; may repeat, all must match. Blank values are ignored.</li>
 * </ul>
 *
 * A field is sortable or filterable when it is enabled and gets index rows (EntryIndexer.indexedKeys); filterable
 * additionally requires filterable=true; sortable excludes ref kinds. In public lists only fields with
 * visibility public qualify, and ref.&lt;field&gt; must name a public ref field.
 */
public final class ListQueryParser {

    public static final int DEFAULT_SIZE = 20;
    public static final int MAX_SIZE = 100;
    public static final List<String> DEFAULT_WORK_STATES = List.of("draft", "published");

    private static final Set<String> STATES = Set.of("draft", "published", "archived");
    private static final Set<String> SYSTEM_SORTS = Set.of("updatedAt", "createdAt", "publishedAt");
    private static final Set<String> REF_TYPES = Set.of("ref", "media-ref", "principal-ref");

    /** Parsed parameters; the service adds type, scope, access and the public rules to build an EntryQuery. */
    public record Parsed(
            List<String> states,
            String q,
            List<FieldFilter> filters,
            List<RefFilter> refs,
            SortKey sort,
            int page,
            int size) {}

    private ListQueryParser() {}

    public static Parsed parse(ContentTypeRecord type, List<FieldRecord> fields, IndexScope scope, Map<String, String[]> params) {
        Map<String, FieldRecord> byKey = new LinkedHashMap<>();
        fields.forEach(f -> byKey.put(f.fieldKey(), f));
        Set<String> indexed = EntryIndexer.indexedKeys(type, fields);
        boolean publicScope = scope == IndexScope.PUBLISHED;

        int page = intParam(params, "page", 1, 1, Integer.MAX_VALUE);
        int size = intParam(params, "size", DEFAULT_SIZE, 1, MAX_SIZE);
        List<String> states = publicScope ? List.of("published") : states(params);
        String q = single(params, "q");
        SortKey sort = sort(type, byKey, indexed, publicScope, single(params, "sort"));

        List<FieldFilter> filters = new ArrayList<>();
        Map<String, Instant[]> ranges = new LinkedHashMap<>();
        List<RefFilter> refs = new ArrayList<>();
        for (Map.Entry<String, String[]> param : params.entrySet()) {
            String name = param.getKey();
            if (name.startsWith("filter.")) {
                String value = single(params, name);
                if (value == null || value.isBlank()) throw ContentException.invalidParameter(name + " must not be blank");
                String rest = name.substring("filter.".length());
                String suffix = rest.endsWith(".from") ? "from" : rest.endsWith(".to") ? "to" : null;
                String key = suffix == null ? rest : rest.substring(0, rest.length() - suffix.length() - 1);
                FieldRecord field = byKey.get(key);
                if (field == null || !field.enabled() || !field.filterable() || !indexed.contains(key)
                        || (publicScope && !"public".equals(field.visibility()))) {
                    throw ContentException.invalidParameter(name + ": field is not filterable");
                }
                String kind = EntryIndexer.kind(field.fieldType());
                if ("datetime".equals(kind) != (suffix != null)) {
                    throw ContentException.invalidParameter("datetime".equals(kind)
                            ? name + ": use filter." + key + ".from or filter." + key + ".to"
                            : name + ": .from and .to apply to datetime fields only");
                }
                if (suffix != null) {
                    Instant instant = EntryIndexer.parseInstant(value);
                    if (instant == null) throw ContentException.invalidParameter(name + " must be an ISO-8601 date-time with offset");
                    ranges.computeIfAbsent(key, k -> new Instant[2])["from".equals(suffix) ? 0 : 1] = instant;
                } else {
                    filters.add(FieldFilter.equalsValue(key, kind, filterValue(name, kind, value)));
                }
            } else if (name.startsWith("ref.")) {
                String key = name.substring("ref.".length());
                if (publicScope) {
                    FieldRecord field = byKey.get(key);
                    if (field == null || !field.enabled() || !REF_TYPES.contains(field.fieldType())
                            || !"public".equals(field.visibility())) {
                        throw ContentException.invalidParameter(name + ": field is not a public ref field");
                    }
                }
                for (String raw : param.getValue()) {
                    if (raw == null || raw.isBlank()) continue;
                    refs.add(new RefFilter(key, uuid(name, raw)));
                }
            }
        }
        ranges.forEach((key, bounds) -> filters.add(FieldFilter.range(key, bounds[0], bounds[1])));
        return new Parsed(states, q, filters, refs, sort, page, size);
    }

    private static List<String> states(Map<String, String[]> params) {
        String raw = single(params, "state");
        if (raw == null || raw.isBlank()) return DEFAULT_WORK_STATES;
        List<String> states = Arrays.stream(raw.split(",")).map(String::trim).filter(s -> !s.isEmpty()).distinct().toList();
        if (states.isEmpty()) return DEFAULT_WORK_STATES;
        for (String state : states) {
            if (!STATES.contains(state)) throw ContentException.invalidParameter("state: unknown value " + state);
        }
        return states;
    }

    private static SortKey sort(ContentTypeRecord type, Map<String, FieldRecord> byKey, Set<String> indexed,
            boolean publicScope, String raw) {
        if (raw == null || raw.isBlank()) {
            if (!publicScope) return SortKey.system("updatedAt", true);
            FieldRecord sortField = type.sortField() == null ? null : byKey.get(type.sortField());
            if (sortField != null && indexed.contains(sortField.fieldKey())) {
                return SortKey.field(sortField.fieldKey(), EntryIndexer.kind(sortField.fieldType()), false);
            }
            return SortKey.system("publishedAt", true);
        }
        boolean descending = raw.startsWith("-");
        String key = descending ? raw.substring(1) : raw;
        if (SYSTEM_SORTS.contains(key)) return SortKey.system(key, descending);
        if ("title".equals(key)) {
            FieldRecord title = byKey.get(type.titleField());
            String kind = title == null || EntryIndexer.kind(title.fieldType()) == null ? "string" : EntryIndexer.kind(title.fieldType());
            return SortKey.field(type.titleField(), kind, descending);
        }
        FieldRecord field = byKey.get(key);
        String kind = field == null ? null : EntryIndexer.kind(field.fieldType());
        if (field == null || !indexed.contains(key) || kind == null || "ref".equals(kind)
                || (publicScope && !"public".equals(field.visibility()))) {
            throw ContentException.invalidParameter("sort: " + key + " is not sortable");
        }
        return SortKey.field(key, kind, descending);
    }

    private static Object filterValue(String name, String kind, String value) {
        return switch (kind) {
            case "int" -> {
                try {
                    yield Long.parseLong(value);
                } catch (NumberFormatException e) {
                    throw ContentException.invalidParameter(name + " must be an integer");
                }
            }
            case "bool" -> {
                if (!"true".equals(value) && !"false".equals(value)) {
                    throw ContentException.invalidParameter(name + " must be true or false");
                }
                yield Boolean.parseBoolean(value);
            }
            default -> value;
        };
    }

    private static int intParam(Map<String, String[]> params, String name, int fallback, int min, int max) {
        String raw = single(params, name);
        if (raw == null || raw.isBlank()) return fallback;
        try {
            int value = Integer.parseInt(raw.trim());
            if (value < min || value > max) throw new NumberFormatException();
            return value;
        } catch (NumberFormatException e) {
            throw ContentException.invalidParameter(max == Integer.MAX_VALUE
                    ? name + " must be a positive integer"
                    : name + " must be an integer from " + min + " to " + max);
        }
    }

    /** The only value of a parameter, or null when absent; a repeated parameter is rejected. */
    private static String single(Map<String, String[]> params, String name) {
        String[] values = params.get(name);
        if (values == null || values.length == 0) return null;
        if (values.length > 1) throw ContentException.invalidParameter(name + " must not repeat");
        return values[0];
    }

    private static UUID uuid(String name, String raw) {
        try {
            return UUID.fromString(raw);
        } catch (IllegalArgumentException e) {
            throw ContentException.invalidParameter(name + " must be a UUID");
        }
    }
}
```

**`FieldEqualsPredicate`、`PredicateIndexCheck`**（全文；規則見 §4.4）：

`src/main/java/com/fallrising/cms/identity/service/FieldEqualsPredicate.java`：

```java
package com.fallrising.cms.identity.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * The only predicate form: {"type":"fieldEquals","field":"...","value":"..."}. value may be the placeholder
 * $currentPrincipalId, which stands for the id of the calling principal.
 */
public record FieldEqualsPredicate(String field, String value) {

    public static final String CURRENT_PRINCIPAL = "$currentPrincipalId";

    /** Parsed predicate, or null when the JSON is malformed, of another type, or has a blank field or value. */
    public static FieldEqualsPredicate parse(ObjectMapper mapper, String json) {
        if (json == null || json.isBlank()) return null;
        try {
            JsonNode node = mapper.readTree(json);
            if (!"fieldEquals".equals(node.path("type").asText())) return null;
            String field = node.path("field").asText();
            String value = node.path("value").asText();
            if (field.isBlank() || value.isBlank()) return null;
            return new FieldEqualsPredicate(field, value);
        } catch (Exception e) {
            return null;
        }
    }
}
```

`src/main/java/com/fallrising/cms/identity/service/PredicateIndexCheck.java`：

```java
package com.fallrising.cms.identity.service;

import com.fallrising.cms.identity.domain.Permission;
import com.fallrising.cms.identity.domain.Role;
import com.fallrising.cms.identity.store.IdentityStore;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

/**
 * Fail fast (02 §4.1 step 3): after the identity seed (order 0) and the content type seed (order 100), every stored
 * permission that carries a predicate must name a content type and a field whose predicate can be pushed into list
 * queries. Otherwise startup fails, instead of list queries silently returning too much or too little.
 */
@Component
@Order(150)
public class PredicateIndexCheck {

    private final IdentityStore store;
    private final ContentTypeDirectory contentTypes;
    private final ObjectMapper objectMapper;

    public PredicateIndexCheck(IdentityStore store, ContentTypeDirectory contentTypes, ObjectMapper objectMapper) {
        this.store = store;
        this.contentTypes = contentTypes;
        this.objectMapper = objectMapper;
    }

    @Order(150)
    @EventListener(ApplicationReadyEvent.class)
    public void check() {
        List<String> problems = new ArrayList<>();
        for (Role role : store.listRoles()) {
            for (Permission permission : store.permissionsOfRole(role.id())) {
                String problem = problem(objectMapper, contentTypes, permission.contentTypeCode(), permission.predicateJson());
                if (problem != null) problems.add(role.code() + "/" + permission.action() + ": " + problem);
            }
        }
        if (!problems.isEmpty()) {
            throw new IllegalStateException("Predicates that cannot be pushed into list queries: " + problems);
        }
    }

    /** Null when the permission has no predicate or its predicate is compilable; otherwise the reason. */
    static String problem(ObjectMapper mapper, ContentTypeDirectory contentTypes, String contentTypeCode, String predicateJson) {
        if (predicateJson == null || predicateJson.isBlank()) return null;
        FieldEqualsPredicate predicate = FieldEqualsPredicate.parse(mapper, predicateJson);
        if (predicate == null) return "unsupported or malformed predicate";
        if (contentTypeCode == null || contentTypeCode.isBlank()) return "a predicate requires contentType";
        if (!contentTypes.predicateFieldCompilable(contentTypeCode, predicate.field())) {
            return "predicate field " + predicate.field() + " is not an indexed string, enum or ref field of " + contentTypeCode;
        }
        return null;
    }
}
```

**`ContentTypeDirectory`、`StoreContentTypeDirectory`**（整檔取代）：

`src/main/java/com/fallrising/cms/identity/service/ContentTypeDirectory.java`：

```java
package com.fallrising.cms.identity.service;

import java.util.List;

/** Content type facts that identity needs. Implemented by the content module so identity does not depend on it. */
public interface ContentTypeDirectory {

    /** Enabled content type keys in key order. */
    List<String> enabledTypeKeys();

    /**
     * True when a fieldEquals predicate on fieldKey can be pushed into list queries of typeKey (02 §4.1 step 3):
     * the type exists and the field is enabled, gets index rows (EntryIndexer.indexedKeys) and is of type
     * string, enum, ref or principal-ref.
     */
    boolean predicateFieldCompilable(String typeKey, String fieldKey);
}
```

`src/main/java/com/fallrising/cms/content/web/StoreContentTypeDirectory.java`：

```java
package com.fallrising.cms.content.web;

import com.fallrising.cms.content.domain.ContentTypeRecord;
import com.fallrising.cms.content.domain.FieldRecord;
import com.fallrising.cms.content.index.EntryIndexer;
import com.fallrising.cms.content.store.ContentStore;
import com.fallrising.cms.identity.service.ContentTypeDirectory;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Set;

@Component
public class StoreContentTypeDirectory implements ContentTypeDirectory {

    private static final Set<String> PREDICATE_FIELD_TYPES = Set.of("string", "enum", "ref", "principal-ref");

    private final ContentStore store;

    public StoreContentTypeDirectory(ContentStore store) {
        this.store = store;
    }

    @Override
    public List<String> enabledTypeKeys() {
        return store.listTypes().stream().filter(ContentTypeRecord::enabled).map(ContentTypeRecord::typeKey).toList();
    }

    @Override
    public boolean predicateFieldCompilable(String typeKey, String fieldKey) {
        ContentTypeRecord type = store.findTypeByKey(typeKey).orElse(null);
        if (type == null) return false;
        List<FieldRecord> fields = store.fieldsOf(type.id());
        if (!EntryIndexer.indexedKeys(type, fields).contains(fieldKey)) return false;
        return fields.stream().anyMatch(f -> f.fieldKey().equals(fieldKey) && PREDICATE_FIELD_TYPES.contains(f.fieldType()));
    }
}
```

`predicateFieldCompilable` 每次呼叫讀一次 `findTypeByKey` 與 `fieldsOf`；只在啟動時與修改權限時呼叫，不在列表請求路徑上。

**`AuthorizationService.listAccess`** 與 **`PrincipalAdminService`**：

`src/main/java/com/fallrising/cms/identity/service/AuthorizationService.java`：

```diff
--- a/src/main/java/com/fallrising/cms/identity/service/AuthorizationService.java
+++ b/src/main/java/com/fallrising/cms/identity/service/AuthorizationService.java
@@ -79,6 +79,44 @@
     }
 
     /**
+     * Authorization of a list query (02 §4.1 "授權如何下推到 SQL"). Hard-deny sets apply first and throw
+     * SURFACE_FORBIDDEN. Grants are matched ignoring predicates: none → FORBIDDEN; any grant without a predicate →
+     * unrestricted; otherwise one clause per compilable fieldEquals predicate, with $currentPrincipalId replaced by
+     * the caller's id. A predicate on $currentPrincipalId yields no clause for an anonymous caller, and a malformed
+     * predicate yields no clause, matching allow(), which rejects both.
+     */
+    public ListAccess listAccess(Principal principal, CmsAction action, String contentType, Surface surface) {
+        Surface resolved = surface == null ? Surface.FRONT : surface;
+        if (hardDenied(resolved, action)) throw IdentityException.surfaceForbidden(action.wire(), contentType, resolved.wire());
+        List<Grant> matching = collectGrants(principal).stream().filter(g -> matchesGrant(g, action, contentType, resolved)).toList();
+        if (matching.isEmpty()) throw IdentityException.forbidden(action.wire(), contentType, resolved.wire());
+        List<ListAccess.Clause> clauses = new ArrayList<>();
+        for (Grant grant : matching) {
+            String json = grant.permission.predicateJson();
+            if (json == null || json.isBlank()) return ListAccess.all();
+            FieldEqualsPredicate predicate = FieldEqualsPredicate.parse(objectMapper, json);
+            if (predicate == null) continue;
+            String value = predicate.value();
+            if (FieldEqualsPredicate.CURRENT_PRINCIPAL.equals(value)) {
+                if (principal == null) continue;
+                value = principal.id().toString();
+            }
+            ListAccess.Clause clause = new ListAccess.Clause(predicate.field(), value);
+            if (!clauses.contains(clause)) clauses.add(clause);
+        }
+        return new ListAccess(false, List.copyOf(clauses));
+    }
+
+    /** Result of listAccess: unrestricted, or entries whose field equals the value of at least one clause. */
+    public record ListAccess(boolean unrestricted, List<Clause> anyOf) {
+        public record Clause(String field, String value) {}
+
+        static ListAccess all() {
+            return new ListAccess(true, List.of());
+        }
+    }
+
+    /**
      * Capabilities of the principal on the surface (02 §4.2). Hard-deny sets are applied first; an action is listed
      * when at least one grant matches it ignoring predicates; scoped is true when every matching grant of some listed
      * action carries a predicate.
```

`src/main/java/com/fallrising/cms/identity/service/PrincipalAdminService.java`：

```diff
--- a/src/main/java/com/fallrising/cms/identity/service/PrincipalAdminService.java
+++ b/src/main/java/com/fallrising/cms/identity/service/PrincipalAdminService.java
@@ -41,14 +41,16 @@
     private final AuthService authService;
     private final AuthorizationService authorizationService;
     private final ObjectMapper objectMapper;
+    private final ContentTypeDirectory contentTypes;
 
     public PrincipalAdminService(IdentityStore store, PasswordHasher passwordHasher, AuthService authService,
-            AuthorizationService authorizationService, ObjectMapper objectMapper) {
+            AuthorizationService authorizationService, ObjectMapper objectMapper, ContentTypeDirectory contentTypes) {
         this.store = store;
         this.passwordHasher = passwordHasher;
         this.authService = authService;
         this.authorizationService = authorizationService;
         this.objectMapper = objectMapper;
+        this.contentTypes = contentTypes;
     }
 
     public List<Principal> list(IdentityRequest request) { authService.requireManagePrincipals(request); return store.listPrincipals(); }
@@ -167,6 +169,8 @@
             List<String> surfaces = p.allowedSurfaces() == null || p.allowedSurfaces().isEmpty() ? defaultSurfaces(action.wire()) : p.allowedSurfaces().stream().distinct().toList();
             if (surfaces.stream().anyMatch(s -> !SURFACES.contains(s))) throw IdentityException.validation("unknown surface");
             validatePredicate(p.predicateJson());
+            String predicateProblem = PredicateIndexCheck.problem(objectMapper, contentTypes, p.contentTypeCode(), p.predicateJson());
+            if (predicateProblem != null) throw IdentityException.validation(predicateProblem);
             String key = action.wire() + "|" + (p.contentTypeCode() == null ? "" : p.contentTypeCode()) + "|" + (p.predicateJson() == null ? "" : p.predicateJson()) + "|" + surfaces;
             if (!seen.add(key)) throw IdentityException.validation("duplicate permission");
             next.add(new Permission(UUID.randomUUID(), role.id(), action.wire(), p.contentTypeCode(), p.predicateJson(), surfaces, now));
```

`PrincipalAdminService` 的建構子多了 `ContentTypeDirectory`；Spring 以唯一的實作 `StoreContentTypeDirectory` 注入。`IdentityHardeningTests` 手動建構它的兩處要跟著改（§7.3）。

### 5.5 列表服務、控制器與契約（T10）

`EntryService.listWork(principal, surface, typeKey, params)` 的步驟：

1. `findTypeByKey`；不存在丟 404 `CONTENT_TYPE_NOT_FOUND`。（停用的類型仍可列出，與 BW1a 相同。）
2. `fieldsOf(type.id())`。
3. `ListQueryParser.parse(type, fields, WORK, params)`；錯誤丟 400。
4. 狀態含 `draft` 或 `archived` 時動作是 `read_draft`，否則 `read_published`；`authorization.listAccess(...)`，轉成 `AccessFilter`。
5. `store.queryEntries(EntryQuery(type.id(), WORK, states, type.titleField(), q, filters, refs, access, null, [], sort, page, size))`。
6. 回傳 `ListResult(type, fields, page, pageNo, size)`。

`EntryService.publicList(principal, typeKey, params)` 的步驟：

1. `findTypeByKey`；不存在或停用丟 404 `ENTRY_NOT_FOUND`。
2. `authorization.listAccess(principal, read_published, typeKey, FRONT)`；轉成 `AccessFilter`。
3. `fieldsOf`；`ListQueryParser.parse(type, fields, PUBLISHED, params)`。
4. `store.queryEntries(EntryQuery(type.id(), PUBLISHED, [published], type.titleField(), q, filters, refs, access, type.visibilityField(), type.publicRequiresPublishedRefs(), sort, page, size))`。

兩個方法都不是交易（只讀）。控制器用 `ListResult` 裡的類型與欄位做投影，**不再逐筆查類型或欄位**；所以一個列表請求的 content store 呼叫固定是 `findTypeByKey`、`fieldsOf`、`queryEntries`（JDBC 共 4 個 SQL）。identity store 的呼叫數也與筆數無關（BW1a 的請求內快取）。

`publicOrder` 刪除：公開列表的預設排序改由 `ListQueryParser`（§4.3 `sort` 預設）決定，規則與 BW1a 相同，由 `ListQueryParserTests.B03_publicDefaultSortIsSortFieldAscendingElseNewestPublished` 與 store 契約的 `B02_fieldSortPutsMissingValuesLastInBothDirections` 固定。

`src/main/java/com/fallrising/cms/content/service/EntryService.java`：

```diff
--- a/src/main/java/com/fallrising/cms/content/service/EntryService.java
+++ b/src/main/java/com/fallrising/cms/content/service/EntryService.java
@@ -9,6 +9,11 @@
 import com.fallrising.cms.content.domain.FieldRecord;
 import com.fallrising.cms.content.domain.PublicationState;
 import com.fallrising.cms.content.domain.RevisionRecord;
+import com.fallrising.cms.content.index.IndexScope;
+import com.fallrising.cms.content.query.AccessFilter;
+import com.fallrising.cms.content.query.EntryPage;
+import com.fallrising.cms.content.query.EntryQuery;
+import com.fallrising.cms.content.query.ListQueryParser;
 import com.fallrising.cms.content.store.ContentStore;
 import com.fallrising.cms.identity.IdentityException;
 import com.fallrising.cms.identity.domain.AuditEvent;
@@ -24,7 +29,6 @@
 
 import java.time.Instant;
 import java.util.ArrayList;
-import java.util.Comparator;
 import java.util.LinkedHashMap;
 import java.util.List;
 import java.util.Map;
@@ -126,23 +130,23 @@
         return entry;
     }
 
-    public List<EntryRecord> listWork(
-            Principal principal,
-            Surface surface,
-            String typeKey,
-            List<String> states,
-            String q,
-            String refField,
-            UUID refTarget) {
+    /** One list page with the type and fields used to build it, so callers project items without further store reads. */
+    public record ListResult(ContentTypeRecord type, List<FieldRecord> fields, EntryPage page, int pageNo, int size) {}
+
+    /**
+     * Work list (02 §4.1). Needs read_draft when the states include draft or archived, otherwise read_published;
+     * predicate grants become an AccessFilter evaluated by the store (B-10).
+     */
+    public ListResult listWork(Principal principal, Surface surface, String typeKey, Map<String, String[]> params) {
         ContentTypeRecord type = store.findTypeByKey(typeKey).orElseThrow(ContentException::typeNotFound);
-        List<String> wanted = states == null || states.isEmpty() ? List.of("draft", "published", "archived") : states;
-        boolean needsDraft = wanted.stream().anyMatch(s -> !"published".equals(s));
-        if (needsDraft) {
-            authorization.require(principal, CmsAction.READ_DRAFT, typeKey, null, surface);
-        } else {
-            authorization.require(principal, CmsAction.READ_PUBLISHED, typeKey, null, surface);
-        }
-        return store.listEntries(type.id(), wanted, false, type.titleField(), q, refField, refTarget);
+        List<FieldRecord> fields = store.fieldsOf(type.id());
+        ListQueryParser.Parsed parsed = ListQueryParser.parse(type, fields, IndexScope.WORK, params);
+        boolean needsDraft = parsed.states().stream().anyMatch(s -> !"published".equals(s));
+        AccessFilter access = accessFilter(authorization.listAccess(
+                principal, needsDraft ? CmsAction.READ_DRAFT : CmsAction.READ_PUBLISHED, typeKey, surface));
+        EntryPage page = store.queryEntries(new EntryQuery(type.id(), IndexScope.WORK, parsed.states(), type.titleField(),
+                parsed.q(), parsed.filters(), parsed.refs(), access, null, List.of(), parsed.sort(), parsed.page(), parsed.size()));
+        return new ListResult(type, fields, page, parsed.page(), parsed.size());
     }
 
     public EntryRecord patch(Principal principal, Surface surface, UUID id, String slug, Map<String, Object> payload, Integer version) {
@@ -387,23 +391,29 @@
         return entry;
     }
 
-    public List<EntryRecord> publicList(Principal principal, String typeKey, String q, String refField, UUID refTarget) {
+    /**
+     * Public list (02 §4.1): published copies only; visibility, publicRequiresPublishedRefs and predicate grants are
+     * evaluated by the store in the same query (B-02).
+     */
+    public ListResult publicList(Principal principal, String typeKey, Map<String, String[]> params) {
         ContentTypeRecord type = store.findTypeByKey(typeKey).orElseThrow(ContentException::notFound);
         if (!type.enabled()) {
             throw ContentException.notFound();
         }
-        if (!authorization.hasAction(principal, CmsAction.READ_PUBLISHED, typeKey, Surface.FRONT)) {
-            throw IdentityException.forbidden(CmsAction.READ_PUBLISHED.wire(), typeKey, Surface.FRONT.wire());
-        }
-        return store.listEntries(type.id(), List.of("published"), false, type.titleField(), q, refField, refTarget).stream()
-                .filter(e -> e.publishedPayload() != null)
-                .filter(e -> PublicVisibility.indexable(type, e.publishedPayload()))
-                .filter(e -> authorization.allow(
-                                principal, CmsAction.READ_PUBLISHED, typeKey, e.publishedPayload(), Surface.FRONT)
-                        .allowed())
-                .filter(e -> publishedRefsPublic(e, type))
-                .sorted(publicOrder(type))
-                .toList();
+        AccessFilter access = accessFilter(authorization.listAccess(principal, CmsAction.READ_PUBLISHED, typeKey, Surface.FRONT));
+        List<FieldRecord> fields = store.fieldsOf(type.id());
+        ListQueryParser.Parsed parsed = ListQueryParser.parse(type, fields, IndexScope.PUBLISHED, params);
+        EntryPage page = store.queryEntries(new EntryQuery(type.id(), IndexScope.PUBLISHED, parsed.states(), type.titleField(),
+                parsed.q(), parsed.filters(), parsed.refs(), access, type.visibilityField(), type.publicRequiresPublishedRefs(),
+                parsed.sort(), parsed.page(), parsed.size()));
+        return new ListResult(type, fields, page, parsed.page(), parsed.size());
+    }
+
+    private static AccessFilter accessFilter(AuthorizationService.ListAccess access) {
+        if (access.unrestricted()) return AccessFilter.none();
+        return AccessFilter.anyOf(access.anyOf().stream()
+                .map(clause -> new AccessFilter.Clause(clause.field(), clause.value()))
+                .toList());
     }
 
     private boolean publishedRefsPublic(EntryRecord entry, ContentTypeRecord type) {
@@ -428,24 +438,6 @@
         return true;
     }
 
-    /**
-     * Public list order (02 §3.1): with a sortField, numeric value ascending (entries without a number last),
-     * then updatedAt descending; without a sortField, publishedAt descending, then updatedAt descending.
-     */
-    static Comparator<EntryRecord> publicOrder(ContentTypeRecord type) {
-        Comparator<EntryRecord> newestUpdate = Comparator.comparing(EntryRecord::updatedAt, Comparator.nullsLast(Comparator.reverseOrder()));
-        String sortField = type.sortField();
-        if (sortField == null) {
-            return Comparator.comparing(EntryRecord::publishedAt, Comparator.nullsLast(Comparator.reverseOrder()))
-                    .thenComparing(newestUpdate);
-        }
-        return Comparator.comparingDouble((EntryRecord e) -> {
-                    Object value = e.publishedPayload() == null ? null : e.publishedPayload().get(sortField);
-                    return value instanceof Number number ? number.doubleValue() : Double.MAX_VALUE;
-                })
-                .thenComparing(newestUpdate);
-    }
-
     public List<RevisionRecord> revisions(Principal principal, Surface surface, UUID id) {
         EntryRecord entry = store.findEntry(id).orElseThrow(ContentException::notFound);
         authorization.require(principal, CmsAction.READ_DRAFT, entry.contentTypeKey(), entry.payload(), surface);
```

`src/main/java/com/fallrising/cms/content/web/ContentProjection.java`：

```diff
--- a/src/main/java/com/fallrising/cms/content/web/ContentProjection.java
+++ b/src/main/java/com/fallrising/cms/content/web/ContentProjection.java
@@ -3,6 +3,7 @@
 import com.fallrising.cms.content.domain.ContentTypeRecord;
 import com.fallrising.cms.content.domain.EntryRecord;
 import com.fallrising.cms.content.domain.FieldRecord;
+import com.fallrising.cms.content.service.EntryService;
 
 import java.util.LinkedHashMap;
 import java.util.List;
@@ -111,4 +112,16 @@
         }
         return payload.get(titleField);
     }
+
+    /** List response (02 §4.1): page and size, plus offset and limit kept for v1 clients. */
+    static Map<String, Object> page(List<Map<String, Object>> items, EntryService.ListResult result) {
+        Map<String, Object> json = new LinkedHashMap<>();
+        json.put("items", items);
+        json.put("total", result.page().total());
+        json.put("page", result.pageNo());
+        json.put("size", result.size());
+        json.put("offset", (result.pageNo() - 1) * result.size());
+        json.put("limit", result.size());
+        return json;
+    }
 }
```

`src/main/java/com/fallrising/cms/content/web/EntryController.java`：

```diff
--- a/src/main/java/com/fallrising/cms/content/web/EntryController.java
+++ b/src/main/java/com/fallrising/cms/content/web/EntryController.java
@@ -18,11 +18,9 @@
 import org.springframework.web.bind.annotation.PostMapping;
 import org.springframework.web.bind.annotation.RequestBody;
 import org.springframework.web.bind.annotation.RequestMapping;
-import org.springframework.web.bind.annotation.RequestParam;
 import org.springframework.web.bind.annotation.ResponseStatus;
 import org.springframework.web.bind.annotation.RestController;
 
-import java.util.Arrays;
 import java.util.List;
 import java.util.Map;
 import java.util.UUID;
@@ -55,29 +53,14 @@
     }
 
     @GetMapping("/content-types/{typeKey}/entries")
-    public Map<String, Object> list(
-            @PathVariable String typeKey,
-            @RequestParam(required = false) String state,
-            @RequestParam(required = false) String q,
-            HttpServletRequest request) {
+    public Map<String, Object> list(@PathVariable String typeKey, HttpServletRequest request) {
         IdentityRequest identity = work(request, CmsAction.READ_DRAFT, typeKey);
-        List<String> states = state == null || state.isBlank()
-                ? List.of()
-                : Arrays.stream(state.split(",")).map(String::trim).filter(s -> !s.isEmpty()).toList();
-        String refField = null;
-        UUID refTarget = null;
-        for (String name : request.getParameterMap().keySet()) {
-            if (name.startsWith("ref.") && request.getParameter(name) != null && !request.getParameter(name).isBlank()) {
-                refField = name.substring(4);
-                refTarget = parseRefTarget(name, request.getParameter(name));
-            }
-        }
-        List<Map<String, Object>> items = entries.listWork(
-                        identity.principal(), identity.surface(), typeKey, states, q, refField, refTarget)
-                .stream()
-                .map(this::workJson)
+        EntryService.ListResult result = entries.listWork(
+                identity.principal(), identity.surface(), typeKey, request.getParameterMap());
+        List<Map<String, Object>> items = result.page().items().stream()
+                .map(entry -> ContentProjection.work(entry, result.type()))
                 .toList();
-        return Map.of("items", items, "total", items.size(), "offset", 0, "limit", items.size());
+        return ContentProjection.page(items, result);
     }
 
     @PostMapping("/content-types/{typeKey}/entries")
@@ -186,12 +169,4 @@
         }
         return identity;
     }
-
-    private static UUID parseRefTarget(String name, String raw) {
-        try {
-            return UUID.fromString(raw);
-        } catch (IllegalArgumentException e) {
-            throw com.fallrising.cms.content.ContentException.invalidParameter(name + " must be a UUID");
-        }
-    }
 }
```

`src/main/java/com/fallrising/cms/content/web/PublicContentController.java`：

```diff
--- a/src/main/java/com/fallrising/cms/content/web/PublicContentController.java
+++ b/src/main/java/com/fallrising/cms/content/web/PublicContentController.java
@@ -17,7 +17,6 @@
 import org.springframework.web.bind.annotation.GetMapping;
 import org.springframework.web.bind.annotation.PathVariable;
 import org.springframework.web.bind.annotation.RequestMapping;
-import org.springframework.web.bind.annotation.RequestParam;
 import org.springframework.web.bind.annotation.RestController;
 
 import java.util.LinkedHashMap;
@@ -60,25 +59,13 @@
     }
 
     @GetMapping("/content-types/{typeKey}/entries")
-    public Map<String, Object> list(
-            @PathVariable String typeKey,
-            @RequestParam(required = false) String q,
-            HttpServletRequest request) {
+    public Map<String, Object> list(@PathVariable String typeKey, HttpServletRequest request) {
         rejectAudienceParams(request);
-        String refField = null;
-        UUID refTarget = null;
-        for (String name : request.getParameterMap().keySet()) {
-            if (name.startsWith("ref.") && request.getParameter(name) != null && !request.getParameter(name).isBlank()) {
-                refField = name.substring(4);
-                refTarget = parseRefTarget(name, request.getParameter(name));
-            }
-        }
-        ContentTypeRecord type = store.findTypeByKey(typeKey).orElseThrow(ContentException::notFound);
-        List<EntryRecord> found = entries.publicList(principal(request), typeKey, q, refField, refTarget);
-        List<Map<String, Object>> items = found.stream()
-                .map(e -> ContentProjection.published(e, type, store.fieldsOf(type.id()), this::expandMedia))
+        EntryService.ListResult result = entries.publicList(principal(request), typeKey, request.getParameterMap());
+        List<Map<String, Object>> items = result.page().items().stream()
+                .map(e -> ContentProjection.published(e, result.type(), result.fields(), this::expandMedia))
                 .toList();
-        return page(items);
+        return ContentProjection.page(items, result);
     }
 
     @GetMapping("/content-types/{typeKey}/entries/{id}")
@@ -119,10 +106,6 @@
         return media.resolvePublic(raw).map(Object.class::cast).orElse(raw);
     }
 
-    private static Map<String, Object> page(List<Map<String, Object>> items) {
-        return Map.of("items", items, "total", items.size(), "offset", 0, "limit", items.size());
-    }
-
     private static void rejectAudienceParams(HttpServletRequest request) {
         if (request.getParameter("state") != null
                 || request.getParameter("includeDraft") != null
@@ -135,12 +118,4 @@
         IdentityRequest identity = AuthController.current(request);
         return identity == null ? null : identity.principal();
     }
-
-    private static UUID parseRefTarget(String name, String raw) {
-        try {
-            return UUID.fromString(raw);
-        } catch (IllegalArgumentException e) {
-            throw com.fallrising.cms.content.ContentException.invalidParameter(name + " must be a UUID");
-        }
-    }
 }
```

T10 同時從三個 store 檔移除 `listEntries`（T02、T04 保留它，讓 `EntryService` 在 T10 以前仍可編譯）：

`src/main/java/com/fallrising/cms/content/store/ContentStore.java`：

```diff
--- a/src/main/java/com/fallrising/cms/content/store/ContentStore.java
+++ b/src/main/java/com/fallrising/cms/content/store/ContentStore.java
@@ -41,10 +41,6 @@
 
     Optional<EntryRecord> findBySlug(UUID typeId, String slug);
 
-    /** q matches payload[titleField] case-insensitively as a literal substring; blank q means no filter. */
-    List<EntryRecord> listEntries(
-            UUID typeId, List<String> states, boolean includeDeleted, String titleField, String q, String refField, UUID refTarget);
-
     /** Evaluates a list query (02 BD-04). Soft-deleted entries never match. */
     EntryPage queryEntries(EntryQuery query);
 
```

`src/main/java/com/fallrising/cms/content/store/InMemoryContentStore.java`：

```diff
--- a/src/main/java/com/fallrising/cms/content/store/InMemoryContentStore.java
+++ b/src/main/java/com/fallrising/cms/content/store/InMemoryContentStore.java
@@ -157,19 +157,6 @@
     }
 
     @Override
-    public List<EntryRecord> listEntries(
-            UUID typeId, List<String> states, boolean includeDeleted, String titleField, String q, String refField, UUID refTarget) {
-        return entries.values().stream()
-                .filter(e -> e.contentTypeId().equals(typeId))
-                .filter(e -> includeDeleted || !e.deleted())
-                .filter(e -> states == null || states.isEmpty() || states.contains(e.publicationState().wire()))
-                .filter(e -> matchesQ(e, titleField, q))
-                .filter(e -> matchesRef(e.id(), refField, refTarget))
-                .sorted(Comparator.comparing(EntryRecord::updatedAt).reversed())
-                .toList();
-    }
-
-    @Override
     public long countEntries(UUID typeId, boolean includeDeleted) {
         return entries.values().stream()
                 .filter(e -> e.contentTypeId().equals(typeId))
@@ -377,20 +364,4 @@
             default -> row.stringValue();
         };
     }
-
-    private boolean matchesQ(EntryRecord entry, String titleField, String q) {
-        if (q == null || q.isBlank()) {
-            return true;
-        }
-        Object title = entry.payload() == null || titleField == null ? null : entry.payload().get(titleField);
-        return title != null && title.toString().toLowerCase(Locale.ROOT).contains(q.toLowerCase(Locale.ROOT));
-    }
-
-    private boolean matchesRef(UUID fromId, String field, UUID target) {
-        if (field == null || target == null) {
-            return true;
-        }
-        return refs.getOrDefault(fromId, List.of()).stream()
-                .anyMatch(r -> field.equals(r.fieldKey()) && target.equals(r.toId()));
-    }
 }
```

`src/main/java/com/fallrising/cms/content/store/JdbcContentStore.java`：

```diff
--- a/src/main/java/com/fallrising/cms/content/store/JdbcContentStore.java
+++ b/src/main/java/com/fallrising/cms/content/store/JdbcContentStore.java
@@ -255,46 +255,6 @@
     }
 
     @Override
-    public List<EntryRecord> listEntries(
-            UUID typeId, List<String> states, boolean includeDeleted, String titleField, String q, String refField, UUID refTarget) {
-        StringBuilder sql = new StringBuilder(
-                """
-                SELECT e.*, t.type_key FROM cms_entry e
-                JOIN cms_content_type t ON t.id = e.content_type_id
-                WHERE e.content_type_id = ?
-                """);
-        List<Object> args = new ArrayList<>();
-        args.add(typeId);
-        if (!includeDeleted) {
-            sql.append(" AND e.deleted_at IS NULL");
-        }
-        if (states != null && !states.isEmpty()) {
-            sql.append(" AND e.publication_state IN (");
-            sql.append(String.join(",", states.stream().map(s -> "?").toList()));
-            sql.append(")");
-            args.addAll(states);
-        }
-        if (q != null && !q.isBlank()) {
-            sql.append(" AND e.payload->>? ILIKE ? ESCAPE '\\'");
-            args.add(titleField);
-            args.add("%" + escapeLike(q) + "%");
-        }
-        if (refField != null && refTarget != null) {
-            sql.append(
-                    """
-                     AND EXISTS (
-                       SELECT 1 FROM cms_entry_ref r
-                       WHERE r.from_entry_id = e.id AND r.field_key = ? AND r.to_id = ?
-                     )
-                    """);
-            args.add(refField);
-            args.add(refTarget);
-        }
-        sql.append(" ORDER BY e.updated_at DESC");
-        return jdbc.query(sql.toString(), entryMapper(), args.toArray());
-    }
-
-    @Override
     public long countEntries(UUID typeId, boolean includeDeleted) {
         String sql = includeDeleted
                 ? "SELECT COUNT(*) FROM cms_entry WHERE content_type_id = ?"
```

`openapi.yaml`：`cp docs/v2/contracts/BW1b.openapi.yaml services/cms-api/src/main/resources/openapi/openapi.yaml`。

### 5.6 效能量測方法（T11）

02 §5.4 的四個目標，量測方式：

| 目標 | 量測 | 門檻 | 預演結果 |
| --- | --- | --- | --- |
| 工作列表，一頁 20 筆，含 `q` 與一個 `filter` | `queryEntries(WORK, states=[draft,published], q="harbour", filter status=open, sort -updatedAt, size 20)`；符合 334 筆 | p95 ≤ 150 ms | 43 ms |
| 公開列表，一頁 20 筆 | `queryEntries(PUBLISHED, visibilityField=visibility, sort rank 遞增, size 20)`；符合 4,500 筆 | p95 ≤ 100 ms | 40 ms |
| 單筆 PATCH（含索引重建） | `updateEntry`（隨機一筆，改 4 個欄位；交易內寫 entry、刪除與重寫索引列） | p95 ≤ 80 ms | 8 ms |
| 一次請求內的 SQL 數（列表） | `queryEntries` 的 SQL 數（計數 `DataSource`，數 `prepareStatement` 與 `createStatement`）＝2；加上服務層的 `findTypeByKey`、`fieldsOf`＝4；`ListQueryCountTests` 驗證服務層的 store 呼叫在 1 筆與 6 筆時相同 | ≤ 5，與筆數無關 | 4 |

- 資料：`ListQueryPerformanceTests` 在 PostgreSQL 16（`integrationTest` 的 Testcontainers）建立類型 `perf_item`（`title` string、`status` enum 有索引、`rank` int 是 `sortField`、`visibility` enum 是 `visibilityField`），以 `store.insertEntry` 逐筆插入 10,000 筆（偶數筆已發布；每 10 筆一筆標題含 `harbour`；每 3 筆一筆 `status=open`；每 20 筆一筆 `unlisted`；`rank` 由 `new Random(42)` 產生）。
- 每個操作先跑 10 次暖機，再量 100 次，排序後取第 95 個（p95）；以 `System.nanoTime()` 量，換算成毫秒後比較。
- 結果印在標準輸出（`BW1b perf (10000 entries): work list p95 … ms, public list p95 … ms, patch p95 … ms`），PR 說明貼上 CI 的這一行。
- 範圍界定：只量 store 層（02 §5.4 的「測試資料用一個只在 `integrationTest` 使用的產生器」）。HTTP、JSON 序列化與授權的時間不在內；SQL 數以 content store 計算，identity 查詢由請求內快取保證與筆數無關，媒體展開的逐筆查詢是 02 BQ-11。
- 門檻未達時：這是 `integrationTest` 的一個失敗測試，PR 不能合併。先在本機用同樣的測試重現，檢查 `EXPLAIN ANALYZE`（例如缺索引），修正 SQL 或索引；不得調高門檻或跳過測試。若確定是 CI 機器的瞬時負載，依 AGENTS.md 只重跑一次。

`src/integrationTest/java/com/fallrising/cms/contract/ListQueryPerformanceTests.java`：

```java
package com.fallrising.cms.contract;

import com.fallrising.cms.content.domain.ContentTypeRecord;
import com.fallrising.cms.content.domain.EntryRecord;
import com.fallrising.cms.content.domain.FieldRecord;
import com.fallrising.cms.content.domain.PublicationState;
import com.fallrising.cms.content.index.IndexScope;
import com.fallrising.cms.content.query.AccessFilter;
import com.fallrising.cms.content.query.EntryPage;
import com.fallrising.cms.content.query.EntryQuery;
import com.fallrising.cms.content.query.FieldFilter;
import com.fallrising.cms.content.query.SortKey;
import com.fallrising.cms.content.store.JdbcContentStore;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import javax.sql.DataSource;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Proxy;
import java.sql.Connection;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Supplier;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 02 §5.4 on PostgreSQL 16 with 10,000 entries of one type. Each operation runs 10 warm-up times, then 100 measured
 * times; the 95th percentile (the 95th of 100 sorted durations) must meet the target. queryEntries must issue exactly
 * 2 SQL statements (COUNT and page SELECT) for any page size.
 */
class ListQueryPerformanceTests {

    static final int ENTRIES = 10_000;
    static final Instant T0 = Instant.parse("2026-01-01T00:00:00Z");

    final AtomicInteger statements = new AtomicInteger();

    @Test
    void BW1b_listAndPatchMeetTargetsWithTenThousandEntries() {
        JdbcContentStore store = new JdbcContentStore(counting(PostgresFixture.cleanDataSource()), new ObjectMapper());
        ContentTypeRecord type = new ContentTypeRecord(UUID.randomUUID(), "perf_item", "Item", "Items", null, "title",
                "optional", false, true, true, List.of(), T0, T0, "rank", "visibility", null);
        store.insertType(type);
        store.insertField(field(type, "title", "string", false, List.of()));
        store.insertField(field(type, "status", "enum", true, List.of("open", "closed")));
        store.insertField(field(type, "rank", "int", false, List.of()));
        store.insertField(field(type, "visibility", "enum", false, List.of("public", "unlisted")));
        Random random = new Random(42);
        List<EntryRecord> all = new ArrayList<>();
        for (int i = 0; i < ENTRIES; i++) {
            Map<String, Object> payload = Map.of(
                    "title", "Item " + i + (i % 10 == 0 ? " harbour" : ""),
                    "status", i % 3 == 0 ? "open" : "closed",
                    "rank", random.nextInt(1000),
                    "visibility", i % 20 == 0 ? "unlisted" : "public");
            boolean published = i % 2 == 0;
            EntryRecord entry = new EntryRecord(UUID.randomUUID(), type.id(), "perf_item", "item-" + i,
                    published ? PublicationState.PUBLISHED : PublicationState.DRAFT, 1, payload, published ? payload : null,
                    published ? T0.plusSeconds(i) : null, null, null, null, null, T0, T0.plusSeconds(i));
            store.insertEntry(entry);
            all.add(entry);
        }

        EntryQuery work = new EntryQuery(type.id(), IndexScope.WORK, List.of("draft", "published"), "title", "harbour",
                List.of(FieldFilter.equalsValue("status", "enum", "open")), List.of(), AccessFilter.none(), null, List.of(),
                SortKey.system("updatedAt", true), 1, 20);
        EntryQuery pub = new EntryQuery(type.id(), IndexScope.PUBLISHED, List.of("published"), "title", null, List.of(),
                List.of(), AccessFilter.none(), "visibility", List.of(), SortKey.field("rank", "int", false), 1, 20);

        statements.set(0);
        EntryPage workPage = store.queryEntries(work);
        assertThat(statements.get()).isEqualTo(2);
        assertThat(workPage.items()).hasSize(20);
        assertThat(workPage.total()).isEqualTo(334);
        statements.set(0);
        EntryPage publicPage = store.queryEntries(pub);
        assertThat(statements.get()).isEqualTo(2);
        assertThat(publicPage.total()).isEqualTo(4500);

        long workP95 = p95(() -> store.queryEntries(work));
        long publicP95 = p95(() -> store.queryEntries(pub));
        long patchP95 = p95(() -> {
            EntryRecord e = all.get(random.nextInt(ENTRIES));
            return store.updateEntry(new EntryRecord(e.id(), e.contentTypeId(), e.contentTypeKey(), e.slug(),
                    e.publicationState(), e.version(), Map.of("title", "Patched " + random.nextInt(), "status", "open",
                    "rank", random.nextInt(1000), "visibility", "public"), e.publishedPayload(), e.publishedAt(), null,
                    null, null, null, e.createdAt(), Instant.now()));
        });
        System.out.printf("BW1b perf (%d entries): work list p95 %d ms, public list p95 %d ms, patch p95 %d ms%n",
                ENTRIES, workP95, publicP95, patchP95);
        assertThat(workP95).isLessThanOrEqualTo(150);
        assertThat(publicP95).isLessThanOrEqualTo(100);
        assertThat(patchP95).isLessThanOrEqualTo(80);
    }

    private static long p95(Supplier<?> operation) {
        for (int i = 0; i < 10; i++) operation.get();
        long[] millis = new long[100];
        for (int i = 0; i < millis.length; i++) {
            long start = System.nanoTime();
            operation.get();
            millis[i] = (System.nanoTime() - start) / 1_000_000;
        }
        java.util.Arrays.sort(millis);
        return millis[94];
    }

    private static FieldRecord field(ContentTypeRecord type, String key, String fieldType, boolean indexed, List<String> enums) {
        return new FieldRecord(UUID.randomUUID(), type.id(), key, fieldType, false, false, indexed, "public", 0, null,
                "restrict", enums, true, false);
    }

    /** Counts prepareStatement and createStatement calls on every connection of the data source. */
    private DataSource counting(DataSource target) {
        return (DataSource) Proxy.newProxyInstance(DataSource.class.getClassLoader(), new Class<?>[] {DataSource.class},
                (proxy, method, args) -> {
                    Object result = invoke(target, method, args);
                    if (result instanceof Connection connection) {
                        return Proxy.newProxyInstance(Connection.class.getClassLoader(), new Class<?>[] {Connection.class},
                                (p, m, a) -> {
                                    if (m.getName().equals("prepareStatement") || m.getName().equals("createStatement")) {
                                        statements.incrementAndGet();
                                    }
                                    return invoke(connection, m, a);
                                });
                    }
                    return result;
                });
    }

    private static Object invoke(Object target, java.lang.reflect.Method method, Object[] args) throws Throwable {
        try {
            return method.invoke(target, args);
        } catch (InvocationTargetException e) {
            throw e.getCause();
        }
    }
}
```

---

## 6. 任務卡

大小：S ≤ 150 行、M ≤ 400 行（只算手寫或手改的行；整檔複製算 1 行）。所有指令在 `apps/cms-scaffold` 執行。預期紅燈是預演實測的結果；某個預期紅燈的測試若已經綠了，照樣繼續。

### BW1b-T01 【測試先行】store 契約：索引列

- **目標**：把 §5.1 的索引規則寫成契約案例。
- **輸入**：BW1a `VERIFIED`。
- **步驟**：套用 §7.1 的第一段 `ContentStoreContract.java` diff（5 個 `B09_*` 案例與輔助方法 `insertType(key, FieldSpec...)`、`field(key, type)`、`indexed(...)`、`published(...)`、`row(...)`）。
- **完成條件**：預期紅燈：`src/test` 編譯失敗（套件 `com.fallrising.cms.content.index` 不存在）。
- **驗證**：`./gradlew :services:cms-api:compileTestJava`（預期失敗）
- **對應 ID**：B-09
- **大小**：S

### BW1b-T02 V6 與索引寫入

- **目標**：§4.5 的 V6、§5.1。
- **輸入**：T01。
- **步驟**：
  1. 建立 §4.5 的 `V6__entry_index_scope.sql`。
  2. 建立 §5.1 的 `IndexRow.java`、`IndexScope.java`、`EntryIndexer.java`（套件 `com.fallrising.cms.content.index`）。
  3. 套用 §5.1 的三段 store diff。
- **完成條件**：`./gradlew :services:cms-api:test` 144 個全綠；`./gradlew :services:cms-api:integrationTest` 54 個全綠（`JdbcContentStoreContractTests` 29 個）。
- **驗證**：`./gradlew :services:cms-api:test`；`./gradlew :services:cms-api:integrationTest`
- **對應 ID**：B-09
- **大小**：S

### BW1b-T03 【測試先行】store 契約：查詢

- **目標**：把 §5.2 的語意寫成契約案例。
- **輸入**：T02。
- **步驟**：套用 §7.1 的第二段 `ContentStoreContract.java` diff（既有 4 個列表案例改用 `queryEntries`；新增 9 個 `B02_*`、2 個 `B10_*`；輔助方法 `QueryBuilder`、`query(...)`、`publicQuery(...)`、`withCreated(...)`、`type(key, titleField[, requiredRefs])`）。
- **完成條件**：預期紅燈：`src/test` 編譯失敗（套件 `com.fallrising.cms.content.query` 不存在）。
- **驗證**：`./gradlew :services:cms-api:compileTestJava`（預期失敗）
- **對應 ID**：B-02、B-10
- **大小**：M

### BW1b-T04 查詢型別與 `queryEntries`

- **目標**：§5.2。
- **輸入**：T03。
- **步驟**：
  1. 建立 §5.2 的 `EntryQuery.java`、`FieldFilter.java`、`RefFilter.java`、`SortKey.java`、`AccessFilter.java`、`EntryPage.java`（套件 `com.fallrising.cms.content.query`）。
  2. 套用 §5.2 的三段 store diff。
- **完成條件**：`./gradlew :services:cms-api:test` 155 個全綠；`./gradlew :services:cms-api:integrationTest` 65 個全綠（`JdbcContentStoreContractTests` 40 個）。
- **驗證**：`./gradlew :services:cms-api:test`；`./gradlew :services:cms-api:integrationTest`
- **對應 ID**：B-02、B-10
- **大小**：M

### BW1b-T05 【測試先行】V7 回填

- **目標**：固定 V7 的結果。
- **輸入**：T04。
- **步驟**：套用 §5.3 的 `PostgresFixture.java` diff；建立 §7.2 的 `EntryIndexBackfillTests.java`。
- **完成條件**：預期紅燈正好 1 個：`EntryIndexBackfillTests.B09_v7BackfillsWorkAndPublishedRowsAndDropsStaleRows`（實際值只有舊的 `caption`／`stale` 一列）；其餘 65 個綠。
- **驗證**：`./gradlew :services:cms-api:integrationTest`（需要 Docker；沒有 Docker 時在 PR 註明只在 CI 驗證，依 02 BQ-09）
- **對應 ID**：B-09
- **大小**：S

### BW1b-T06 V7

- **目標**：§4.5 的 V7。
- **輸入**：T05。
- **步驟**：建立 `src/main/java/db/migration/V7__backfill_entry_index.java`（§4.5 全文；套件是 `db.migration`，不是 `com.fallrising...`）。
- **完成條件**：`./gradlew :services:cms-api:integrationTest` 66 個全綠；`./gradlew :services:cms-api:test` 155 個全綠（`test` 不跑 Flyway，數量不變）。
- **驗證**：`./gradlew :services:cms-api:integrationTest`；`./gradlew :services:cms-api:test`
- **對應 ID**：B-09
- **大小**：S

### BW1b-T07 【測試先行】查詢參數與授權下推

- **目標**：把 §4.3、§4.4 寫成單元測試。
- **輸入**：T06。
- **步驟**：建立 §7.3 的 `ListQueryParserTests.java`（`src/test/java/com/fallrising/cms/content/query/`）、`ListAccessTests.java` 與 `PredicateIndexCheckTests.java`（`src/test/java/com/fallrising/cms/identity/service/`）。
- **完成條件**：預期紅燈：`src/test` 編譯失敗（`ListQueryParser`、`listAccess`、`PredicateIndexCheck`、`predicateFieldCompilable` 不存在）。
- **驗證**：`./gradlew :services:cms-api:compileTestJava`（預期失敗）
- **對應 ID**：G-02、B-10
- **大小**：S

### BW1b-T08 查詢參數、`listAccess` 與 predicate 檢查

- **目標**：§5.4。
- **輸入**：T07。
- **步驟**：
  1. 建立 §5.4 的 `ListQueryParser.java`、`FieldEqualsPredicate.java`、`PredicateIndexCheck.java`。
  2. 以 §5.4 全文取代 `ContentTypeDirectory.java`、`StoreContentTypeDirectory.java`。
  3. 套用 §5.4 的兩段 diff（`AuthorizationService`、`PrincipalAdminService`）與 §7.3 的 `IdentityHardeningTests.java` diff。
- **完成條件**：`ListQueryParserTests` 10 個、`ListAccessTests` 4 個、`PredicateIndexCheckTests` 2 個綠；`./gradlew :services:cms-api:test` 171 個全綠（包括 `@SpringBootTest` 的測試：證明種子的 predicate 通過啟動檢查）；`./gradlew :services:cms-api:integrationTest` 66 個全綠。
- **驗證**：`./gradlew :services:cms-api:test`；`./gradlew :services:cms-api:integrationTest`
- **對應 ID**：G-02、B-10
- **大小**：S

### BW1b-T09 【測試先行】列表 API

- **目標**：把 §4.2 的 API 行為與列表的既有防護寫成 MockMvc 測試。
- **輸入**：T08。
- **步驟**：建立 §7.4 的 `ListQueryApiTests.java` 與 `ListQueryCountTests.java`（`src/test/java/com/fallrising/cms/`）。
- **完成條件**：預期紅燈正好 8 個：`ListQueryApiTests` 的 `G02_workListPagesAndCountsAllMatches`、`G02_workListDefaultStatesLeaveOutArchived`、`G02_workListFiltersByFilterableField`、`G02_invalidListParametersAre400`、`G02_publicPhotosFollowSortFieldAndSortParameter`、`B10_memberListsOnlyOwnPetsOnBothSurfaces`，以及 `ListQueryCountTests` 的 2 個。`G02_listGuardsForSessionSurfaceAndUnknownType`、`B10_unscopedGrantListsEveryPet`（回歸保護）與 `B10_predicateOnFieldWithoutIndexRowsIsRejected`（T08 已實作）已綠。
- **驗證**：`./gradlew :services:cms-api:test --tests 'com.fallrising.cms.ListQueryApiTests' --tests 'com.fallrising.cms.ListQueryCountTests'`
- **對應 ID**：G-02、B-02、B-10
- **大小**：S

### BW1b-T10 列表服務、控制器與契約

- **目標**：§5.5，並換上 BW1b 契約。三者必須同一張卡：新的回應有 `page`、`size`，BW1a 契約不允許額外屬性，而全域回應驗證（BW0）會檢查每一個回應。
- **輸入**：T09。
- **步驟**：
  1. 套用 §5.5 的四段 diff（`EntryService`、`ContentProjection`、`EntryController`、`PublicContentController`）。
  2. 套用 §5.5 的三段 store diff（移除 `listEntries`）。
  3. 刪除 `src/test/java/com/fallrising/cms/content/service/PublicOrderTests.java`。
  4. `cp docs/v2/contracts/BW1b.openapi.yaml services/cms-api/src/main/resources/openapi/openapi.yaml`，並以 `cmp` 確認相同。
  5. 執行 `grep -rn "listEntries\|publicOrder" services/cms-api/src`，沒有輸出。
- **完成條件**：`ListQueryApiTests` 9 個、`ListQueryCountTests` 2 個綠；`./gradlew :services:cms-api:test` 180 個全綠；`./gradlew :services:cms-api:integrationTest` 66 個全綠。
- **驗證**：`./gradlew :services:cms-api:test`；`./gradlew :services:cms-api:integrationTest`
- **對應 ID**：G-02、B-02、B-10
- **大小**：M

### BW1b-T11 效能量測

- **目標**：§5.6，確認 02 §5.4 達標。
- **輸入**：T10。
- **步驟**：建立 §5.6 的 `ListQueryPerformanceTests.java`（`src/integrationTest/java/com/fallrising/cms/contract/`）。
- **完成條件**：`./gradlew :services:cms-api:integrationTest` 67 個全綠；輸出含 `BW1b perf (10000 entries): work list p95 … ms, public list p95 … ms, patch p95 … ms`，三個數字分別不超過 150、100、80。
- **驗證**：`./gradlew :services:cms-api:integrationTest --tests 'com.fallrising.cms.contract.ListQueryPerformanceTests' -i | grep 'BW1b perf'`
- **對應 ID**：B-02（02 §5.4）
- **大小**：S

### BW1b-T12 完整閘門、狀態與 PR

- **目標**：交付。
- **輸入**：T11。
- **步驟**：
  1. 執行 §9 的完整閘門。
  2. `docs/v2/README.md` 路線圖中 BW1b 那一列的狀態從 `DOC_READY` 改成 `VERIFIED`。
  3. 逐項勾選 §9，貼進 PR 說明。PR 標題：`feat(cms-scaffold): BW1b 列表查詢下推`；說明列出 B-02、B-09、B-10、G-02，§4.2 的行為變更，以及 T11 的量測結果。
- **完成條件**：§9 全部打勾；CI 的 `java`、`java-integration` 全綠；`web` 全綠，或只有 §2.1 所說的 codegen 新鮮度／fixture 型別失敗並已在 PR 說明。
- **驗證**：§9 的指令。
- **對應 ID**：全部
- **大小**：S

---

## 7. 測試規格

測試名稱以 ID 開頭。層級：`ContentStoreContract` 是 store 契約（`test` 用 in-memory、`integrationTest` 用 PostgreSQL 各跑一次）；`EntryIndexBackfillTests`、`ListQueryPerformanceTests` 只在 `integrationTest`；其餘是 `test` 的 JUnit（`*ApiTests`、`*CountTests` 是 `@SpringBootTest` + MockMvc）。MockMvc 測試的回應都經過 BW0 的全域 OpenAPI 驗證。帳號密碼一律用 `@Value("${cms.identity.seed-password}")`。

### 7.1 `ContentStoreContract`（store 契約）

T01 新增的案例：

| 案例 | 前置資料 | 固定的行為 |
| --- | --- | --- |
| `B09_insertWritesWorkAndPublishedRowsByKind` | 類型 `event`：`title` string、有索引的 `status` enum、`rank` int、`featured` boolean、`startsAt` datetime、`venue` ref、`host` principal-ref、`cover` media-ref，沒有索引的 `notes` markdown；一筆已發布 entry，工作副本 9 個欄位都有值，已發布副本只有 `title`=`Old Title`、`rank`=2 | 9 列：`published` 的 `rank`(int 2)、`title`；`work` 的 `featured`(bool)、`host`(ref)、`rank`(int 7)、`startsAt`(`+08:00` 換成 UTC)、`status`(enum)、`title`、`venue`(ref)；`cover`、`notes` 沒有列；順序依 scope 再依欄位名 |
| `B09_nullBlankAndWrongJsonTypesGetNoRow` | `title` 空白、`rank`=`"7"`、`featured`=`"true"`、`startsAt`=`next friday`、`status`=null | 沒有任何列 |
| `B09_updateReplacesRowsAndUnpublishDropsPublishedRows` | 已發布 `First` → 更新為草稿 `Second`、`publishedPayload` null | 只剩 `work` 的 `title`=`Second` |
| `B09_typeSettingsAndNewFieldsReindexExistingEntries` | `photo` 有 `title`、沒索引的 `sortOrder`；entry 的 payload 也有 `caption` | 起初只有 `title`；`updateTypeSettings(sortField=sortOrder)` 後多 `sortOrder`；`insertField(有索引的 caption)` 後多 `caption` |
| `B09_hardDeleteRemovesRows` | 一筆已發布 entry | 硬刪除後沒有列 |

`src/test/java/com/fallrising/cms/contract/ContentStoreContract.java`：

```diff
--- a/src/test/java/com/fallrising/cms/contract/ContentStoreContract.java
+++ b/src/test/java/com/fallrising/cms/contract/ContentStoreContract.java
@@ -7,6 +7,8 @@
 import com.fallrising.cms.content.domain.NavigationRecord;
 import com.fallrising.cms.content.domain.PublicationState;
 import com.fallrising.cms.content.domain.RevisionRecord;
+import com.fallrising.cms.content.index.IndexRow;
+import com.fallrising.cms.content.index.IndexScope;
 import com.fallrising.cms.content.store.ContentStore;
 import org.junit.jupiter.api.BeforeEach;
 import org.junit.jupiter.api.Test;
@@ -330,6 +332,98 @@
         assertThat(store.listEntries(profile.id(), List.of(), false, null, "cedar", null, null)).isEmpty();
     }
 
+    // ---- BW1b: index rows (B-09) ----
+
+    @Test
+    void B09_insertWritesWorkAndPublishedRowsByKind() {
+        ContentTypeRecord event = insertType("event",
+                field("title", "string"),
+                indexed(field("status", "enum")),
+                indexed(field("rank", "int")),
+                indexed(field("featured", "boolean")),
+                indexed(field("startsAt", "datetime")),
+                indexed(field("venue", "ref")),
+                indexed(field("host", "principal-ref")),
+                indexed(field("cover", "media-ref")),
+                field("notes", "markdown"));
+        UUID venue = UUID.randomUUID();
+        UUID host = UUID.randomUUID();
+        Map<String, Object> working = new LinkedHashMap<>();
+        working.put("title", "Night Market");
+        working.put("status", "open");
+        working.put("rank", 7);
+        working.put("featured", true);
+        working.put("startsAt", "2026-03-01T18:00:00+08:00");
+        working.put("venue", venue.toString());
+        working.put("host", host.toString());
+        working.put("cover", UUID.randomUUID().toString());
+        working.put("notes", "not indexed");
+        EntryRecord e = published(entry(event, "m", PublicationState.PUBLISHED, working, t(5)), Map.of("title", "Old Title", "rank", 2));
+        store.insertEntry(e);
+
+        assertThat(store.indexRowsOf(e.id())).containsExactly(
+                row(e, "rank", IndexScope.PUBLISHED, "int", null, 2L, null, null),
+                row(e, "title", IndexScope.PUBLISHED, "string", "Old Title", null, null, null),
+                row(e, "featured", IndexScope.WORK, "bool", null, null, true, null),
+                row(e, "host", IndexScope.WORK, "ref", host.toString(), null, null, null),
+                row(e, "rank", IndexScope.WORK, "int", null, 7L, null, null),
+                row(e, "startsAt", IndexScope.WORK, "datetime", null, null, null, Instant.parse("2026-03-01T10:00:00Z")),
+                row(e, "status", IndexScope.WORK, "enum", "open", null, null, null),
+                row(e, "title", IndexScope.WORK, "string", "Night Market", null, null, null),
+                row(e, "venue", IndexScope.WORK, "ref", venue.toString(), null, null, null));
+    }
+
+    @Test
+    void B09_nullBlankAndWrongJsonTypesGetNoRow() {
+        ContentTypeRecord event = insertType("event",
+                field("title", "string"), indexed(field("rank", "int")), indexed(field("featured", "boolean")),
+                indexed(field("startsAt", "datetime")), indexed(field("status", "enum")));
+        Map<String, Object> payload = new LinkedHashMap<>();
+        payload.put("title", "  ");
+        payload.put("rank", "7");
+        payload.put("featured", "true");
+        payload.put("startsAt", "next friday");
+        payload.put("status", null);
+        EntryRecord e = entry(event, "x", PublicationState.DRAFT, payload, t(1));
+        store.insertEntry(e);
+        assertThat(store.indexRowsOf(e.id())).isEmpty();
+    }
+
+    @Test
+    void B09_updateReplacesRowsAndUnpublishDropsPublishedRows() {
+        ContentTypeRecord album = insertType("album", field("title", "string"));
+        EntryRecord e = entry(album, "a", PublicationState.PUBLISHED, Map.of("title", "First"), t(1));
+        store.insertEntry(e);
+        EntryRecord unpublished = new EntryRecord(e.id(), album.id(), "album", "a", PublicationState.DRAFT, 2,
+                Map.of("title", "Second"), null, null, null, null, null, null, T0, t(2));
+        store.updateEntry(unpublished);
+        assertThat(store.indexRowsOf(e.id())).containsExactly(
+                row(e, "title", IndexScope.WORK, "string", "Second", null, null, null));
+    }
+
+    @Test
+    void B09_typeSettingsAndNewFieldsReindexExistingEntries() {
+        ContentTypeRecord photo = insertType("photo", field("title", "string"), field("sortOrder", "int"));
+        EntryRecord e = entry(photo, "p", PublicationState.DRAFT, Map.of("title", "P", "sortOrder", 3, "caption", "C"), t(1));
+        store.insertEntry(e);
+        assertThat(store.indexRowsOf(e.id())).extracting(IndexRow::fieldKey).containsExactly("title");
+
+        store.updateTypeSettings(photo.withSettings("sortOrder", null, null, t(2)));
+        assertThat(store.indexRowsOf(e.id())).extracting(IndexRow::fieldKey).containsExactly("sortOrder", "title");
+
+        store.insertField(indexed(field(photo.id(), "caption", "string", 5)));
+        assertThat(store.indexRowsOf(e.id())).extracting(IndexRow::fieldKey).containsExactly("caption", "sortOrder", "title");
+    }
+
+    @Test
+    void B09_hardDeleteRemovesRows() {
+        ContentTypeRecord album = insertType("album", field("title", "string"));
+        EntryRecord e = entry(album, "a", PublicationState.PUBLISHED, Map.of("title", "A"), t(1));
+        store.insertEntry(e);
+        store.hardDeleteEntry(e.id());
+        assertThat(store.indexRowsOf(e.id())).isEmpty();
+    }
+
     // ---- fixtures ----
 
     protected static Instant t(int seconds) {
@@ -370,6 +464,46 @@
                 e.contentTypeKey());
     }
 
+    /** Inserts the type and one field per spec; FieldSpec.typeId is filled in here. */
+    protected ContentTypeRecord insertType(String key, FieldSpec... specs) {
+        return insertType(type(key), specs);
+    }
+
+    protected ContentTypeRecord insertType(ContentTypeRecord type, FieldSpec... specs) {
+        store.insertType(type);
+        int order = 0;
+        for (FieldSpec spec : specs) {
+            FieldRecord f = field(type.id(), spec.key(), spec.fieldType(), order++);
+            store.insertField(spec.indexed() ? indexed(f) : f);
+        }
+        return type;
+    }
+
+    protected record FieldSpec(String key, String fieldType, boolean indexed) {}
+
+    protected static FieldSpec field(String key, String fieldType) {
+        return new FieldSpec(key, fieldType, false);
+    }
+
+    protected static FieldSpec indexed(FieldSpec spec) {
+        return new FieldSpec(spec.key(), spec.fieldType(), true);
+    }
+
+    protected static FieldRecord indexed(FieldRecord f) {
+        return new FieldRecord(f.id(), f.contentTypeId(), f.fieldKey(), f.fieldType(), f.required(), f.uniqueInType(), true,
+                f.visibility(), f.sortOrder(), f.refTargetTypeKey(), f.onDelete(), f.enumValues(), f.enabled(), f.publicBytes());
+    }
+
+    protected static EntryRecord published(EntryRecord e, Map<String, Object> publishedPayload) {
+        return new EntryRecord(e.id(), e.contentTypeId(), e.contentTypeKey(), e.slug(), e.publicationState(),
+                e.version(), e.payload(), publishedPayload, e.publishedAt(), e.archivedAt(), e.deletedAt(), e.createdBy(),
+                e.updatedBy(), e.createdAt(), e.updatedAt());
+    }
+
+    protected static IndexRow row(EntryRecord e, String key, IndexScope scope, String kind, String s, Long i, Boolean b, Instant ts) {
+        return new IndexRow(e.id(), key, scope, kind, s, i, b, ts);
+    }
+
     private List<String> slugs(ContentTypeRecord type, String q) {
         return store.listEntries(type.id(), List.of(), false, "title", q, null, null).stream().map(EntryRecord::slug).toList();
     }
```

T03 改寫與新增的案例：

| 案例 | 固定的行為 |
| --- | --- |
| `B08_queryWorkFiltersStatesAndExcludesDeletedNewestFirst`（取代 `B08_listEntriesFiltersStatesAndDeletedNewestFirst`） | 三種狀態 → `p, a, d`；預設 `draft,published` → `p, d`；空狀態清單 → 空；軟刪除永遠不出現（原本的「含已刪除」查詢已沒有呼叫者，刪除） |
| `B08_querySearchIsCaseInsensitiveLiteralOnTitle`（取代 `B08_listEntriesSearch…`） | 與 BW0 相同，但類型要有 `title` 欄位（索引只為存在的欄位建立） |
| `B08_queryFiltersByRef`（取代 `B08_listEntriesFiltersByRef`） | 單一 `ref`；不存在的欄位；兩個 `ref` 同時符合；兩個 `ref` 只有一個符合 → 空 |
| `B03_searchUsesGivenTitleField`（改寫） | 類型的 `titleField` 是 `name`；`q` 比對 `name`，不比對沒索引的 `title`；`titleField` null → 空 |
| `B02_pagesReportTotalOfAllPages` | 5 筆、`size` 2：第 2 頁 `e3, e2`、`total` 5；第 3 頁 `e1`；第 4 頁空、`total` 仍是 5 |
| `B02_sortsBySystemColumnsWithNullsLastAndTieBreaks` | `updatedAt` 遞增；`createdAt` 遞增（相同時依 `updatedAt` 遞減）；`publishedAt` 遞增與遞減時草稿都在最後 |
| `B02_fieldSortPutsMissingValuesLastInBothDirections` | `rank` 遞增 `r2, r10`、遞減 `r10, r2`，沒有值的兩筆都在最後且依 `updatedAt` 遞減；`title` 以位元組順序：`B` < `a` < `b` < `é` |
| `B02_equalTiesAreOrderedByUpdatedAtThenIdText` | 4 筆標題與 `updatedAt` 都相同 → 依 id 文字遞增（欄位排序與預設排序都是） |
| `B02_fieldFiltersCompareByKind` | enum、int（`Long`）、bool 等值；兩個條件 AND；enum 區分大小寫 |
| `B02_datetimeRangeIsFromInclusiveToExclusive` | `[1 月, 2 月)` 只有 `jan`；只給 `from`；只給 `to`；沒有值的不出現 |
| `B02_publishedScopeUsesPublishedCopyForSearchFilterAndSort` | 公開查詢的 `q`、`filter`、`sort` 讀已發布副本；工作查詢讀工作副本 |
| `B02_publishedScopeKeepsOnlyPublishedPublicEntries` | 有 `visibilityField` 時只有 `public` 與沒有值的；沒有時 `unlisted`、`private` 也出現；草稿、封存、軟刪除都不出現 |
| `B02_requiredRefsMustPointToPubliclyReadableEntries` | 目標公開、`unlisted`、沒有關聯值 → 出現；目標 `private`、草稿、已刪除、不存在、不是 UUID、大寫 UUID → 不出現 |
| `B10_accessFilterKeepsEntriesMatchingAnyClause` | 不限制；一個條件；兩個條件 OR；空清單 → 空頁、`total` 0 |
| `B10_accessFilterReadsRowsOfTheQueryScope` | 已發布副本的 owner 是我、工作副本不是 → 公開查詢有、工作查詢沒有 |

`src/test/java/com/fallrising/cms/contract/ContentStoreContract.java`：

```diff
--- a/src/test/java/com/fallrising/cms/contract/ContentStoreContract.java
+++ b/src/test/java/com/fallrising/cms/contract/ContentStoreContract.java
@@ -9,6 +9,12 @@
 import com.fallrising.cms.content.domain.RevisionRecord;
 import com.fallrising.cms.content.index.IndexRow;
 import com.fallrising.cms.content.index.IndexScope;
+import com.fallrising.cms.content.query.AccessFilter;
+import com.fallrising.cms.content.query.EntryPage;
+import com.fallrising.cms.content.query.EntryQuery;
+import com.fallrising.cms.content.query.FieldFilter;
+import com.fallrising.cms.content.query.RefFilter;
+import com.fallrising.cms.content.query.SortKey;
 import com.fallrising.cms.content.store.ContentStore;
 import org.junit.jupiter.api.BeforeEach;
 import org.junit.jupiter.api.Test;
@@ -142,7 +148,7 @@
     }
 
     @Test
-    void B08_listEntriesFiltersStatesAndDeletedNewestFirst() {
+    void B08_queryWorkFiltersStatesAndExcludesDeletedNewestFirst() {
         ContentTypeRecord album = insertType("album");
         ContentTypeRecord page = insertType("page");
         EntryRecord draft = entry(album, "d", PublicationState.DRAFT, Map.of("title", "d"), t(10));
@@ -152,31 +158,29 @@
         EntryRecord other = entry(page, "o", PublicationState.DRAFT, Map.of("title", "o"), t(50));
         List.of(draft, published, archived, gone, other).forEach(store::insertEntry);
 
-        assertThat(store.listEntries(album.id(), List.of(), false, "title", null, null, null))
-                .extracting(EntryRecord::slug).containsExactly("p", "a", "d");
-        assertThat(store.listEntries(album.id(), List.of("draft", "published"), false, "title", null, null, null))
-                .extracting(EntryRecord::slug).containsExactly("p", "d");
-        assertThat(store.listEntries(album.id(), List.of(), true, "title", null, null, null))
-                .extracting(EntryRecord::slug).containsExactly("x", "p", "a", "d");
+        assertThat(workSlugs(query(album).states(List.of("draft", "published", "archived"))))
+                .containsExactly("p", "a", "d");
+        assertThat(workSlugs(query(album))).containsExactly("p", "d");
+        assertThat(workSlugs(query(album).states(List.of()))).isEmpty();
     }
 
     @Test
-    void B08_listEntriesSearchIsCaseInsensitiveLiteralOnTitle() {
-        ContentTypeRecord album = insertType("album");
+    void B08_querySearchIsCaseInsensitiveLiteralOnTitle() {
+        ContentTypeRecord album = insertType("album", field("title", "string"));
         store.insertEntry(entry(album, "s1", PublicationState.DRAFT, Map.of("title", "Coast 50% Off"), t(10)));
         store.insertEntry(entry(album, "s2", PublicationState.DRAFT, Map.of("title", "Coast 500 off"), t(11)));
         store.insertEntry(entry(album, "s3", PublicationState.DRAFT, Map.of("title", "Beach_1"), t(12)));
         store.insertEntry(entry(album, "s4", PublicationState.DRAFT, Map.of("title", "BeachX1"), t(13)));
         store.insertEntry(entry(album, "s5", PublicationState.DRAFT, Map.of("name", "Coast"), t(14)));
 
-        assertThat(slugs(album, "COAST")).containsExactly("s2", "s1");
-        assertThat(slugs(album, "50%")).containsExactly("s1");
-        assertThat(slugs(album, "h_1")).containsExactly("s3");
-        assertThat(slugs(album, " ")).containsExactly("s5", "s4", "s3", "s2", "s1");
+        assertThat(workSlugs(query(album).q("COAST"))).containsExactly("s2", "s1");
+        assertThat(workSlugs(query(album).q("50%"))).containsExactly("s1");
+        assertThat(workSlugs(query(album).q("h_1"))).containsExactly("s3");
+        assertThat(workSlugs(query(album).q(" "))).containsExactly("s5", "s4", "s3", "s2", "s1");
     }
 
     @Test
-    void B08_listEntriesFiltersByRef() {
+    void B08_queryFiltersByRef() {
         ContentTypeRecord album = insertType("album");
         ContentTypeRecord photo = insertType("photo");
         EntryRecord a1 = entry(album, "a1", PublicationState.DRAFT, Map.of("title", "a1"), t(1));
@@ -184,12 +188,17 @@
         EntryRecord p1 = entry(photo, "p1", PublicationState.DRAFT, Map.of("album", a1.id().toString()), t(3));
         EntryRecord p2 = entry(photo, "p2", PublicationState.DRAFT, Map.of("album", a2.id().toString()), t(4));
         List.of(a1, a2, p1, p2).forEach(store::insertEntry);
-        store.replaceRefs(p1.id(), List.of(new EntryRefRecord(p1.id(), "album", a1.id(), "entry", 0)));
+        store.replaceRefs(p1.id(), List.of(
+                new EntryRefRecord(p1.id(), "album", a1.id(), "entry", 0),
+                new EntryRefRecord(p1.id(), "related", a2.id(), "entry", 0)));
         store.replaceRefs(p2.id(), List.of(new EntryRefRecord(p2.id(), "album", a2.id(), "entry", 0)));
 
-        assertThat(store.listEntries(photo.id(), List.of(), false, "title", null, "album", a1.id()))
-                .extracting(EntryRecord::slug).containsExactly("p1");
-        assertThat(store.listEntries(photo.id(), List.of(), false, "title", null, "cover", a1.id())).isEmpty();
+        assertThat(workSlugs(query(photo).refs(List.of(new RefFilter("album", a1.id()))))).containsExactly("p1");
+        assertThat(workSlugs(query(photo).refs(List.of(new RefFilter("cover", a1.id()))))).isEmpty();
+        assertThat(workSlugs(query(photo).refs(List.of(new RefFilter("album", a1.id()), new RefFilter("related", a2.id())))))
+                .containsExactly("p1");
+        assertThat(workSlugs(query(photo).refs(List.of(new RefFilter("album", a2.id()), new RefFilter("related", a2.id())))))
+                .isEmpty();
     }
 
     @Test
@@ -324,12 +333,11 @@
 
     @Test
     void B03_searchUsesGivenTitleField() {
-        ContentTypeRecord profile = insertType("clinic_profile");
+        ContentTypeRecord profile = insertType(type("clinic_profile", "name"), field("name", "string"), field("title", "string"));
         store.insertEntry(entry(profile, "c1", PublicationState.DRAFT, Map.of("name", "Cedar Clinic", "title", "zzz"), t(1)));
         store.insertEntry(entry(profile, "c2", PublicationState.DRAFT, Map.of("name", "Oak", "title", "Cedar"), t(2)));
-        assertThat(store.listEntries(profile.id(), List.of(), false, "name", "cedar", null, null))
-                .extracting(EntryRecord::slug).containsExactly("c1");
-        assertThat(store.listEntries(profile.id(), List.of(), false, null, "cedar", null, null)).isEmpty();
+        assertThat(workSlugs(query(profile).titleField("name").q("cedar"))).containsExactly("c1");
+        assertThat(workSlugs(query(profile).titleField(null).q("cedar"))).isEmpty();
     }
 
     // ---- BW1b: index rows (B-09) ----
@@ -424,6 +432,190 @@
         assertThat(store.indexRowsOf(e.id())).isEmpty();
     }
 
+    // ---- BW1b: paging, sorting, filters, public rules (B-02) ----
+
+    @Test
+    void B02_pagesReportTotalOfAllPages() {
+        ContentTypeRecord album = insertType("album", field("title", "string"));
+        for (int i = 1; i <= 5; i++) {
+            store.insertEntry(entry(album, "e" + i, PublicationState.DRAFT, Map.of("title", "E" + i), t(i)));
+        }
+        EntryPage second = store.queryEntries(query(album).page(2).size(2).build());
+        assertThat(second.total()).isEqualTo(5);
+        assertThat(second.items()).extracting(EntryRecord::slug).containsExactly("e3", "e2");
+        assertThat(workSlugs(query(album).page(3).size(2))).containsExactly("e1");
+        EntryPage beyond = store.queryEntries(query(album).page(4).size(2).build());
+        assertThat(beyond.items()).isEmpty();
+        assertThat(beyond.total()).isEqualTo(5);
+    }
+
+    @Test
+    void B02_sortsBySystemColumnsWithNullsLastAndTieBreaks() {
+        ContentTypeRecord album = insertType("album", field("title", "string"));
+        EntryRecord old = withCreated(entry(album, "old", PublicationState.PUBLISHED, Map.of("title", "O"), t(30)), t(-10));
+        EntryRecord draft = entry(album, "draft", PublicationState.DRAFT, Map.of("title", "D"), t(20));
+        EntryRecord fresh = entry(album, "fresh", PublicationState.PUBLISHED, Map.of("title", "F"), t(10));
+        List.of(old, draft, fresh).forEach(store::insertEntry);
+
+        assertThat(workSlugs(query(album).sort(SortKey.system("updatedAt", false)))).containsExactly("fresh", "draft", "old");
+        assertThat(workSlugs(query(album).sort(SortKey.system("createdAt", false)))).containsExactly("old", "draft", "fresh");
+        assertThat(workSlugs(query(album).sort(SortKey.system("publishedAt", true)))).containsExactly("old", "fresh", "draft");
+        assertThat(workSlugs(query(album).sort(SortKey.system("publishedAt", false)))).containsExactly("fresh", "old", "draft");
+    }
+
+    @Test
+    void B02_fieldSortPutsMissingValuesLastInBothDirections() {
+        ContentTypeRecord photo = insertType("photo", field("title", "string"), indexed(field("rank", "int")));
+        store.insertEntry(entry(photo, "r2", PublicationState.DRAFT, Map.of("title", "b", "rank", 2), t(1)));
+        store.insertEntry(entry(photo, "r10", PublicationState.DRAFT, Map.of("title", "B", "rank", 10), t(2)));
+        store.insertEntry(entry(photo, "none-old", PublicationState.DRAFT, Map.of("title", "a"), t(3)));
+        store.insertEntry(entry(photo, "none-new", PublicationState.DRAFT, Map.of("title", "é"), t(4)));
+
+        assertThat(workSlugs(query(photo).sort(SortKey.field("rank", "int", false))))
+                .containsExactly("r2", "r10", "none-new", "none-old");
+        assertThat(workSlugs(query(photo).sort(SortKey.field("rank", "int", true))))
+                .containsExactly("r10", "r2", "none-new", "none-old");
+        assertThat(workSlugs(query(photo).sort(SortKey.field("title", "string", false))))
+                .containsExactly("r10", "none-old", "r2", "none-new");
+    }
+
+    @Test
+    void B02_equalTiesAreOrderedByUpdatedAtThenIdText() {
+        ContentTypeRecord photo = insertType("photo", field("title", "string"));
+        List<EntryRecord> same = new java.util.ArrayList<>();
+        for (int i = 0; i < 4; i++) {
+            EntryRecord e = entry(photo, "s" + i, PublicationState.DRAFT, Map.of("title", "same"), t(7));
+            store.insertEntry(e);
+            same.add(e);
+        }
+        List<String> byId = same.stream().sorted(java.util.Comparator.comparing(e -> e.id().toString()))
+                .map(EntryRecord::slug).toList();
+        assertThat(workSlugs(query(photo).sort(SortKey.field("title", "string", false)))).containsExactlyElementsOf(byId);
+        assertThat(workSlugs(query(photo))).containsExactlyElementsOf(byId);
+    }
+
+    @Test
+    void B02_fieldFiltersCompareByKind() {
+        ContentTypeRecord event = insertType("event", field("title", "string"), indexed(field("status", "enum")),
+                indexed(field("rank", "int")), indexed(field("featured", "boolean")));
+        store.insertEntry(entry(event, "a", PublicationState.DRAFT, Map.of("title", "A", "status", "open", "rank", 1, "featured", true), t(1)));
+        store.insertEntry(entry(event, "b", PublicationState.DRAFT, Map.of("title", "B", "status", "closed", "rank", 1, "featured", false), t(2)));
+        store.insertEntry(entry(event, "c", PublicationState.DRAFT, Map.of("title", "C", "status", "open", "rank", 2), t(3)));
+
+        assertThat(workSlugs(query(event).filters(List.of(FieldFilter.equalsValue("status", "enum", "open"))))).containsExactly("c", "a");
+        assertThat(workSlugs(query(event).filters(List.of(FieldFilter.equalsValue("rank", "int", 1L))))).containsExactly("b", "a");
+        assertThat(workSlugs(query(event).filters(List.of(FieldFilter.equalsValue("featured", "bool", false))))).containsExactly("b");
+        assertThat(workSlugs(query(event).filters(List.of(
+                FieldFilter.equalsValue("status", "enum", "open"), FieldFilter.equalsValue("rank", "int", 1L))))).containsExactly("a");
+        assertThat(workSlugs(query(event).filters(List.of(FieldFilter.equalsValue("status", "enum", "Open"))))).isEmpty();
+    }
+
+    @Test
+    void B02_datetimeRangeIsFromInclusiveToExclusive() {
+        ContentTypeRecord event = insertType("event", field("title", "string"), indexed(field("startsAt", "datetime")));
+        store.insertEntry(entry(event, "jan", PublicationState.DRAFT, Map.of("title", "J", "startsAt", "2026-01-01T00:00:00Z"), t(1)));
+        store.insertEntry(entry(event, "feb", PublicationState.DRAFT, Map.of("title", "F", "startsAt", "2026-02-01T00:00:00Z"), t(2)));
+        store.insertEntry(entry(event, "none", PublicationState.DRAFT, Map.of("title", "N"), t(3)));
+        Instant jan = Instant.parse("2026-01-01T00:00:00Z");
+        Instant feb = Instant.parse("2026-02-01T00:00:00Z");
+
+        assertThat(workSlugs(query(event).filters(List.of(FieldFilter.range("startsAt", jan, feb))))).containsExactly("jan");
+        assertThat(workSlugs(query(event).filters(List.of(FieldFilter.range("startsAt", feb, null))))).containsExactly("feb");
+        assertThat(workSlugs(query(event).filters(List.of(FieldFilter.range("startsAt", null, feb))))).containsExactly("jan");
+    }
+
+    @Test
+    void B02_publishedScopeUsesPublishedCopyForSearchFilterAndSort() {
+        ContentTypeRecord album = insertType("album", field("title", "string"), indexed(field("rank", "int")));
+        EntryRecord a = published(entry(album, "a", PublicationState.PUBLISHED, Map.of("title", "Draft words", "rank", 1), t(1)),
+                Map.of("title", "Live words", "rank", 9));
+        EntryRecord b = entry(album, "b", PublicationState.PUBLISHED, Map.of("title", "Live too", "rank", 5), t(2));
+        List.of(a, b).forEach(store::insertEntry);
+
+        assertThat(publicSlugs(publicQuery(album).q("live"))).containsExactly("b", "a");
+        assertThat(publicSlugs(publicQuery(album).q("draft"))).isEmpty();
+        assertThat(workSlugs(query(album).q("draft"))).containsExactly("a");
+        assertThat(publicSlugs(publicQuery(album).filters(List.of(FieldFilter.equalsValue("rank", "int", 9L))))).containsExactly("a");
+        assertThat(publicSlugs(publicQuery(album).sort(SortKey.field("rank", "int", false)))).containsExactly("b", "a");
+    }
+
+    @Test
+    void B02_publishedScopeKeepsOnlyPublishedPublicEntries() {
+        ContentTypeRecord album = insertType(type("album").withSettings(null, "visibility", null, T0),
+                field("title", "string"), field("visibility", "enum"));
+        EntryRecord pub = entry(album, "pub", PublicationState.PUBLISHED, Map.of("title", "P", "visibility", "public"), t(1));
+        EntryRecord missing = entry(album, "missing", PublicationState.PUBLISHED, Map.of("title", "M"), t(2));
+        EntryRecord unlisted = entry(album, "unlisted", PublicationState.PUBLISHED, Map.of("title", "U", "visibility", "unlisted"), t(3));
+        EntryRecord secret = entry(album, "private", PublicationState.PUBLISHED, Map.of("title", "S", "visibility", "private"), t(4));
+        EntryRecord draft = entry(album, "draft", PublicationState.DRAFT, Map.of("title", "D"), t(5));
+        EntryRecord archived = entry(album, "archived", PublicationState.ARCHIVED, Map.of("title", "A"), t(6));
+        EntryRecord gone = deleted(entry(album, "gone", PublicationState.PUBLISHED, Map.of("title", "G"), t(7)), t(8));
+        List.of(pub, missing, unlisted, secret, draft, archived, gone).forEach(store::insertEntry);
+
+        assertThat(publicSlugs(publicQuery(album).visibilityField("visibility"))).containsExactly("missing", "pub");
+        assertThat(publicSlugs(publicQuery(album))).containsExactly("private", "unlisted", "missing", "pub");
+    }
+
+    @Test
+    void B02_requiredRefsMustPointToPubliclyReadableEntries() {
+        ContentTypeRecord album = insertType(type("album").withSettings(null, "visibility", null, T0),
+                field("title", "string"), field("visibility", "enum"));
+        ContentTypeRecord photo = insertType(type("photo", "title", List.of("album")), field("title", "string"), field("album", "ref"));
+        EntryRecord open = entry(album, "open", PublicationState.PUBLISHED, Map.of("title", "O", "visibility", "public"), t(1));
+        EntryRecord unlisted = entry(album, "unlisted", PublicationState.PUBLISHED, Map.of("title", "U", "visibility", "unlisted"), t(2));
+        EntryRecord secret = entry(album, "secret", PublicationState.PUBLISHED, Map.of("title", "S", "visibility", "private"), t(3));
+        EntryRecord draft = entry(album, "draft", PublicationState.DRAFT, Map.of("title", "D"), t(4));
+        EntryRecord gone = deleted(entry(album, "gone", PublicationState.PUBLISHED, Map.of("title", "G"), t(5)), t(6));
+        List.of(open, unlisted, secret, draft, gone).forEach(store::insertEntry);
+        store.insertEntry(entry(photo, "in-open", PublicationState.PUBLISHED, Map.of("title", "1", "album", open.id().toString()), t(11)));
+        store.insertEntry(entry(photo, "in-unlisted", PublicationState.PUBLISHED, Map.of("title", "2", "album", unlisted.id().toString()), t(12)));
+        store.insertEntry(entry(photo, "in-secret", PublicationState.PUBLISHED, Map.of("title", "3", "album", secret.id().toString()), t(13)));
+        store.insertEntry(entry(photo, "in-draft", PublicationState.PUBLISHED, Map.of("title", "4", "album", draft.id().toString()), t(14)));
+        store.insertEntry(entry(photo, "in-gone", PublicationState.PUBLISHED, Map.of("title", "5", "album", gone.id().toString()), t(15)));
+        store.insertEntry(entry(photo, "in-missing", PublicationState.PUBLISHED, Map.of("title", "6", "album", UUID.randomUUID().toString()), t(16)));
+        store.insertEntry(entry(photo, "in-garbage", PublicationState.PUBLISHED, Map.of("title", "7", "album", "not-a-uuid"), t(17)));
+        store.insertEntry(entry(photo, "in-upper", PublicationState.PUBLISHED, Map.of("title", "8", "album", open.id().toString().toUpperCase()), t(18)));
+        store.insertEntry(entry(photo, "loose", PublicationState.PUBLISHED, Map.of("title", "9"), t(19)));
+
+        assertThat(publicSlugs(publicQuery(photo).requiredRefs(List.of("album")))).containsExactly("loose", "in-unlisted", "in-open");
+    }
+
+    // ---- BW1b: authorization pushdown (B-10) ----
+
+    @Test
+    void B10_accessFilterKeepsEntriesMatchingAnyClause() {
+        ContentTypeRecord pet = insertType(type("pet").withSettings(null, null, "ownerPrincipalId", T0),
+                field("title", "string"), field("ownerPrincipalId", "principal-ref"), indexed(field("clinic", "string")));
+        UUID me = UUID.randomUUID();
+        store.insertEntry(entry(pet, "mine", PublicationState.DRAFT, Map.of("title", "M", "ownerPrincipalId", me.toString()), t(1)));
+        store.insertEntry(entry(pet, "branch", PublicationState.DRAFT, Map.of("title", "B", "ownerPrincipalId", UUID.randomUUID().toString(), "clinic", "north"), t(2)));
+        store.insertEntry(entry(pet, "other", PublicationState.DRAFT, Map.of("title", "O", "ownerPrincipalId", UUID.randomUUID().toString()), t(3)));
+
+        assertThat(workSlugs(query(pet).access(AccessFilter.none()))).containsExactly("other", "branch", "mine");
+        assertThat(workSlugs(query(pet).access(AccessFilter.anyOf(List.of(new AccessFilter.Clause("ownerPrincipalId", me.toString()))))))
+                .containsExactly("mine");
+        assertThat(workSlugs(query(pet).access(AccessFilter.anyOf(List.of(
+                new AccessFilter.Clause("ownerPrincipalId", me.toString()), new AccessFilter.Clause("clinic", "north"))))))
+                .containsExactly("branch", "mine");
+        assertThat(workSlugs(query(pet).access(AccessFilter.anyOf(List.of())))).isEmpty();
+        EntryPage none = store.queryEntries(query(pet).access(AccessFilter.anyOf(List.of())).build());
+        assertThat(none.total()).isZero();
+    }
+
+    @Test
+    void B10_accessFilterReadsRowsOfTheQueryScope() {
+        ContentTypeRecord pet = insertType(type("pet").withSettings(null, null, "ownerPrincipalId", T0),
+                field("title", "string"), field("ownerPrincipalId", "principal-ref"));
+        UUID me = UUID.randomUUID();
+        EntryRecord moved = published(entry(pet, "moved", PublicationState.PUBLISHED,
+                Map.of("title", "M", "ownerPrincipalId", UUID.randomUUID().toString()), t(1)),
+                Map.of("title", "M", "ownerPrincipalId", me.toString()));
+        store.insertEntry(moved);
+        AccessFilter mine = AccessFilter.anyOf(List.of(new AccessFilter.Clause("ownerPrincipalId", me.toString())));
+        assertThat(publicSlugs(publicQuery(pet).access(mine))).containsExactly("moved");
+        assertThat(workSlugs(query(pet).access(mine))).isEmpty();
+    }
+
     // ---- fixtures ----
 
     protected static Instant t(int seconds) {
@@ -464,6 +656,15 @@
                 e.contentTypeKey());
     }
 
+    protected static ContentTypeRecord type(String key, String titleField) {
+        return type(key, titleField, List.of());
+    }
+
+    protected static ContentTypeRecord type(String key, String titleField, List<String> requiredRefs) {
+        return new ContentTypeRecord(UUID.randomUUID(), key, key + " one", key + " many", null, titleField, "optional",
+                false, true, true, requiredRefs, T0, T0);
+    }
+
     /** Inserts the type and one field per spec; FieldSpec.typeId is filled in here. */
     protected ContentTypeRecord insertType(String key, FieldSpec... specs) {
         return insertType(type(key), specs);
@@ -500,11 +701,70 @@
                 e.updatedBy(), e.createdAt(), e.updatedAt());
     }
 
+    protected static EntryRecord withCreated(EntryRecord e, Instant createdAt) {
+        return new EntryRecord(e.id(), e.contentTypeId(), e.contentTypeKey(), e.slug(), e.publicationState(),
+                e.version(), e.payload(), e.publishedPayload(), e.publishedAt(), e.archivedAt(), e.deletedAt(), e.createdBy(),
+                e.updatedBy(), createdAt, e.updatedAt());
+    }
+
     protected static IndexRow row(EntryRecord e, String key, IndexScope scope, String kind, String s, Long i, Boolean b, Instant ts) {
         return new IndexRow(e.id(), key, scope, kind, s, i, b, ts);
     }
 
-    private List<String> slugs(ContentTypeRecord type, String q) {
-        return store.listEntries(type.id(), List.of(), false, "title", q, null, null).stream().map(EntryRecord::slug).toList();
+    /** Work query on the type: states draft+published, newest update first, page 1 of 100, no other condition. */
+    protected static QueryBuilder query(ContentTypeRecord type) {
+        return new QueryBuilder(type, IndexScope.WORK);
+    }
+
+    /** Published query on the type: no visibilityField and no requiredRefs unless set. */
+    protected static QueryBuilder publicQuery(ContentTypeRecord type) {
+        return new QueryBuilder(type, IndexScope.PUBLISHED);
+    }
+
+    private List<String> workSlugs(QueryBuilder query) {
+        return store.queryEntries(query.build()).items().stream().map(EntryRecord::slug).toList();
+    }
+
+    private List<String> publicSlugs(QueryBuilder query) {
+        return workSlugs(query);
+    }
+
+    protected static final class QueryBuilder {
+        private final ContentTypeRecord type;
+        private final IndexScope scope;
+        private List<String> states = List.of("draft", "published");
+        private String titleField;
+        private String q;
+        private List<FieldFilter> filters = List.of();
+        private List<RefFilter> refs = List.of();
+        private AccessFilter access = AccessFilter.none();
+        private String visibilityField;
+        private List<String> requiredRefs = List.of();
+        private SortKey sort = SortKey.system("updatedAt", true);
+        private int page = 1;
+        private int size = 100;
+
+        QueryBuilder(ContentTypeRecord type, IndexScope scope) {
+            this.type = type;
+            this.scope = scope;
+            this.titleField = type.titleField();
+        }
+
+        QueryBuilder states(List<String> v) { states = v; return this; }
+        QueryBuilder titleField(String v) { titleField = v; return this; }
+        QueryBuilder q(String v) { q = v; return this; }
+        QueryBuilder filters(List<FieldFilter> v) { filters = v; return this; }
+        QueryBuilder refs(List<RefFilter> v) { refs = v; return this; }
+        QueryBuilder access(AccessFilter v) { access = v; return this; }
+        QueryBuilder visibilityField(String v) { visibilityField = v; return this; }
+        QueryBuilder requiredRefs(List<String> v) { requiredRefs = v; return this; }
+        QueryBuilder sort(SortKey v) { sort = v; return this; }
+        QueryBuilder page(int v) { page = v; return this; }
+        QueryBuilder size(int v) { size = v; return this; }
+
+        EntryQuery build() {
+            return new EntryQuery(type.id(), scope, states, titleField, q, filters, refs, access, visibilityField,
+                    requiredRefs, sort, page, size);
+        }
     }
 }
```

### 7.2 `EntryIndexBackfillTests`（`integrationTest`）

| # | 動作 | 斷言 |
| --- | --- | --- |
| 1 | `emptyDataSource()`，migrate 到版本 6 | — |
| 2 | 以 SQL 插入類型 `photo`（`sort_field='rank'`）、三個沒索引的欄位 `title`、`rank`、`caption`；一筆已發布 entry（工作 `New`／2／`c`，已發布 `Old`／1）；一筆草稿 `Draft`；一筆舊的索引列 `caption`=`stale` | — |
| 3 | migrate 到最新 | 已發布 entry 的列正好是 `published` 的 `rank` 1、`title` `Old`，`work` 的 `rank` 2、`title` `New`（`caption` 沒有索引，舊列被刪）；草稿只有 `work` 的 `title` `Draft` |

`src/integrationTest/java/com/fallrising/cms/contract/EntryIndexBackfillTests.java`：

```java
package com.fallrising.cms.contract;

import com.fallrising.cms.content.index.IndexRow;
import com.fallrising.cms.content.index.IndexScope;
import com.fallrising.cms.content.store.JdbcContentStore;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

import javax.sql.DataSource;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/** V7 rebuilds cms_entry_index for entries written before BW1b (02 §3.2). */
class EntryIndexBackfillTests {

    @Test
    void B09_v7BackfillsWorkAndPublishedRowsAndDropsStaleRows() {
        DataSource dataSource = PostgresFixture.emptyDataSource();
        Flyway.configure().dataSource(dataSource).locations("classpath:db/migration").target("6").load().migrate();
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        UUID type = UUID.randomUUID();
        UUID entry = UUID.randomUUID();
        UUID draft = UUID.randomUUID();
        jdbc.update("INSERT INTO cms_content_type (id, type_key, display_name, plural_display_name, title_field, sort_field) "
                + "VALUES (?, 'photo', 'Photo', 'Photos', 'title', 'rank')", type);
        jdbc.update("INSERT INTO cms_field (id, content_type_id, field_key, field_type, indexed) VALUES (?, ?, 'title', 'string', false)",
                UUID.randomUUID(), type);
        jdbc.update("INSERT INTO cms_field (id, content_type_id, field_key, field_type, indexed) VALUES (?, ?, 'rank', 'int', false)",
                UUID.randomUUID(), type);
        jdbc.update("INSERT INTO cms_field (id, content_type_id, field_key, field_type, indexed) VALUES (?, ?, 'caption', 'string', false)",
                UUID.randomUUID(), type);
        jdbc.update("INSERT INTO cms_entry (id, content_type_id, slug, publication_state, payload, published_payload) "
                + "VALUES (?, ?, 'a', 'published', CAST(? AS jsonb), CAST(? AS jsonb))",
                entry, type, "{\"title\":\"New\",\"rank\":2,\"caption\":\"c\"}", "{\"title\":\"Old\",\"rank\":1}");
        jdbc.update("INSERT INTO cms_entry (id, content_type_id, slug, publication_state, payload) "
                + "VALUES (?, ?, 'b', 'draft', CAST(? AS jsonb))", draft, type, "{\"title\":\"Draft\"}");
        jdbc.update("INSERT INTO cms_entry_index (entry_id, field_key, value_kind, value_string) VALUES (?, 'caption', 'string', 'stale')", entry);

        Flyway.configure().dataSource(dataSource).locations("classpath:db/migration").load().migrate();

        JdbcContentStore store = new JdbcContentStore(dataSource, new ObjectMapper());
        assertThat(store.indexRowsOf(entry)).containsExactly(
                new IndexRow(entry, "rank", IndexScope.PUBLISHED, "int", null, 1L, null, null),
                new IndexRow(entry, "title", IndexScope.PUBLISHED, "string", "Old", null, null, null),
                new IndexRow(entry, "rank", IndexScope.WORK, "int", null, 2L, null, null),
                new IndexRow(entry, "title", IndexScope.WORK, "string", "New", null, null, null));
        assertThat(store.indexRowsOf(draft)).containsExactly(
                new IndexRow(draft, "title", IndexScope.WORK, "string", "Draft", null, null, null));
    }
}
```

### 7.3 `ListQueryParserTests`、`ListAccessTests`、`PredicateIndexCheckTests`（單元）

`ListQueryParserTests` 的欄位固定資料：`title` string（沒有 `indexed`，但它是 `titleField`）、`status` enum、`rank` int、`featured` boolean、`startsAt` datetime、`venue` ref（以上都 `indexed`、`filterable`、公開）；`secretNote` string（`indexed`、`filterable`、`internal`）；`staffRef` ref（`back`，沒有索引）；`color` string（`indexed`，不可篩選）；`loose` string（可篩選但沒有索引）。

| 測試 | 斷言 |
| --- | --- |
| `G02_workDefaults` | 只有 `offset`、`unknown` → 預設值（`draft,published`、`-updatedAt`、1、20） |
| `B03_publicDefaultSortIsSortFieldAscendingElseNewestPublished` | 有 `sortField=rank` → `rank` 遞增；沒有 → `-publishedAt`；狀態是 `published` |
| `G02_pageAndSizeBounds` | `3`／`100` 可以；`page` 0、`two`；`size` 0、101；重複的 `page` → 各自的訊息 |
| `G02_states` | 去空白、去重；全空 → 預設；未知值 → 400 |
| `G02_sortKeys` | 系統鍵；`title`；datetime 欄位遞減；不可篩選但有索引的 `color` 可以排序；沒索引的 `loose`、ref 的 `venue`、不存在的欄位 → 400；`internal` 欄位工作可以、公開不行 |
| `G02_equalityFiltersParseByKind` | enum、int（`-3`→`-3L`）、bool、ref；`1.5`、`yes`、空白、重複 → 400 |
| `G02_onlyFilterableIndexedFieldsQualify` | `color`、`loose`、不存在 → 400；`internal` 工作可以、公開不行 |
| `G02_datetimeFiltersUseFromAndTo` | `+08:00` 換成 UTC；只給 `to`；沒有後綴、日期沒有時間、非 datetime 欄位加後綴 → 400 |
| `G02_refFiltersRepeatAndSkipBlank` | 同名兩個都保留；空白忽略；工作不檢查欄位；非 UUID → 400；公開只接受公開的 ref 欄位 |
| `G02_searchIsPassedThrough` | 原樣保留（含前後空白）；重複 → 400 |

`src/test/java/com/fallrising/cms/content/query/ListQueryParserTests.java`：

```java
package com.fallrising.cms.content.query;

import com.fallrising.cms.api.error.ErrorCode;
import com.fallrising.cms.content.ContentException;
import com.fallrising.cms.content.domain.ContentTypeRecord;
import com.fallrising.cms.content.domain.FieldRecord;
import com.fallrising.cms.content.index.IndexScope;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ListQueryParserTests {

    static final Instant T0 = Instant.parse("2026-01-01T00:00:00Z");
    static final UUID TYPE = UUID.randomUUID();

    static ContentTypeRecord type(String sortField) {
        return new ContentTypeRecord(TYPE, "event", "Event", "Events", null, "title", "optional", false, true, true,
                List.of(), T0, T0, sortField, null, null);
    }

    static FieldRecord field(String key, String fieldType, boolean indexed, boolean filterable, String visibility) {
        return new FieldRecord(UUID.randomUUID(), TYPE, key, fieldType, false, false, indexed, visibility, 0, null,
                "restrict", List.of(), true, false, null, null, false, filterable, Map.of(), null, null);
    }

    static final List<FieldRecord> FIELDS = List.of(
            field("title", "string", false, false, "public"),
            field("status", "enum", true, true, "public"),
            field("rank", "int", true, true, "public"),
            field("featured", "boolean", true, true, "public"),
            field("startsAt", "datetime", true, true, "public"),
            field("venue", "ref", true, true, "public"),
            field("secretNote", "string", true, true, "internal"),
            field("staffRef", "ref", false, false, "back"),
            field("color", "string", true, false, "public"),
            field("loose", "string", false, true, "public"));

    static ListQueryParser.Parsed work(String... pairs) {
        return ListQueryParser.parse(type(null), FIELDS, IndexScope.WORK, params(pairs));
    }

    static ListQueryParser.Parsed pub(ContentTypeRecord type, String... pairs) {
        return ListQueryParser.parse(type, FIELDS, IndexScope.PUBLISHED, params(pairs));
    }

    static Map<String, String[]> params(String... pairs) {
        Map<String, List<String>> grouped = new LinkedHashMap<>();
        for (int i = 0; i < pairs.length; i += 2) {
            grouped.computeIfAbsent(pairs[i], k -> new java.util.ArrayList<>()).add(pairs[i + 1]);
        }
        Map<String, String[]> out = new LinkedHashMap<>();
        grouped.forEach((k, v) -> out.put(k, v.toArray(String[]::new)));
        return out;
    }

    static void rejected(Runnable parse, String messagePart) {
        assertThatThrownBy(parse::run)
                .isInstanceOf(ContentException.class)
                .hasMessageContaining(messagePart)
                .satisfies(e -> assertThat(((ContentException) e).code()).isEqualTo(ErrorCode.VALIDATION_FAILED));
    }

    @Test
    void G02_workDefaults() {
        ListQueryParser.Parsed parsed = work("offset", "40", "unknown", "x");
        assertThat(parsed).isEqualTo(new ListQueryParser.Parsed(List.of("draft", "published"), null, List.of(), List.of(),
                SortKey.system("updatedAt", true), 1, 20));
    }

    @Test
    void B03_publicDefaultSortIsSortFieldAscendingElseNewestPublished() {
        assertThat(pub(type("rank")).sort()).isEqualTo(SortKey.field("rank", "int", false));
        assertThat(pub(type(null)).sort()).isEqualTo(SortKey.system("publishedAt", true));
        assertThat(pub(type(null)).states()).containsExactly("published");
    }

    @Test
    void G02_pageAndSizeBounds() {
        assertThat(work("page", "3", "size", "100")).extracting(ListQueryParser.Parsed::page, ListQueryParser.Parsed::size)
                .containsExactly(3, 100);
        rejected(() -> work("page", "0"), "page must be a positive integer");
        rejected(() -> work("page", "two"), "page must be a positive integer");
        rejected(() -> work("size", "0"), "size must be an integer from 1 to 100");
        rejected(() -> work("size", "101"), "size must be an integer from 1 to 100");
        rejected(() -> work("page", "1", "page", "2"), "page must not repeat");
    }

    @Test
    void G02_states() {
        assertThat(work("state", " draft , archived,draft").states()).containsExactly("draft", "archived");
        assertThat(work("state", " , ").states()).containsExactly("draft", "published");
        rejected(() -> work("state", "draft,deleted"), "state: unknown value deleted");
    }

    @Test
    void G02_sortKeys() {
        assertThat(work("sort", "-createdAt").sort()).isEqualTo(SortKey.system("createdAt", true));
        assertThat(work("sort", "title").sort()).isEqualTo(SortKey.field("title", "string", false));
        assertThat(work("sort", "-startsAt").sort()).isEqualTo(SortKey.field("startsAt", "datetime", true));
        assertThat(work("sort", "color").sort()).isEqualTo(SortKey.field("color", "string", false));
        rejected(() -> work("sort", "loose"), "sort: loose is not sortable");
        rejected(() -> work("sort", "venue"), "sort: venue is not sortable");
        rejected(() -> work("sort", "missing"), "sort: missing is not sortable");
        assertThat(work("sort", "secretNote").sort()).isEqualTo(SortKey.field("secretNote", "string", false));
        rejected(() -> pub(type(null), "sort", "secretNote"), "sort: secretNote is not sortable");
    }

    @Test
    void G02_equalityFiltersParseByKind() {
        assertThat(work("filter.status", "open", "filter.rank", "-3", "filter.featured", "false", "filter.venue", "v1").filters())
                .containsExactly(
                        FieldFilter.equalsValue("status", "enum", "open"),
                        FieldFilter.equalsValue("rank", "int", -3L),
                        FieldFilter.equalsValue("featured", "bool", false),
                        FieldFilter.equalsValue("venue", "ref", "v1"));
        rejected(() -> work("filter.rank", "1.5"), "filter.rank must be an integer");
        rejected(() -> work("filter.featured", "yes"), "filter.featured must be true or false");
        rejected(() -> work("filter.status", " "), "filter.status must not be blank");
        rejected(() -> work("filter.status", "a", "filter.status", "b"), "filter.status must not repeat");
    }

    @Test
    void G02_onlyFilterableIndexedFieldsQualify() {
        rejected(() -> work("filter.color", "red"), "filter.color: field is not filterable");
        rejected(() -> work("filter.loose", "x"), "filter.loose: field is not filterable");
        rejected(() -> work("filter.nothing", "x"), "filter.nothing: field is not filterable");
        assertThat(work("filter.secretNote", "x").filters()).hasSize(1);
        rejected(() -> pub(type(null), "filter.secretNote", "x"), "filter.secretNote: field is not filterable");
    }

    @Test
    void G02_datetimeFiltersUseFromAndTo() {
        assertThat(work("filter.startsAt.from", "2026-01-01T08:00:00+08:00", "filter.startsAt.to", "2026-02-01T00:00:00Z").filters())
                .containsExactly(FieldFilter.range("startsAt", Instant.parse("2026-01-01T00:00:00Z"), Instant.parse("2026-02-01T00:00:00Z")));
        assertThat(work("filter.startsAt.to", "2026-02-01T00:00:00Z").filters())
                .containsExactly(FieldFilter.range("startsAt", null, Instant.parse("2026-02-01T00:00:00Z")));
        rejected(() -> work("filter.startsAt", "2026-01-01T00:00:00Z"), "filter.startsAt: use filter.startsAt.from or filter.startsAt.to");
        rejected(() -> work("filter.startsAt.from", "2026-01-01"), "filter.startsAt.from must be an ISO-8601 date-time with offset");
        rejected(() -> work("filter.rank.from", "1"), "filter.rank.from: .from and .to apply to datetime fields only");
    }

    @Test
    void G02_refFiltersRepeatAndSkipBlank() {
        UUID a = UUID.randomUUID();
        UUID b = UUID.randomUUID();
        assertThat(work("ref.venue", a.toString(), "ref.venue", b.toString(), "ref.other", "").refs())
                .containsExactly(new RefFilter("venue", a), new RefFilter("venue", b));
        assertThat(work("ref.staffRef", a.toString()).refs()).containsExactly(new RefFilter("staffRef", a));
        rejected(() -> work("ref.venue", "abc"), "ref.venue must be a UUID");
        assertThat(pub(type(null), "ref.venue", a.toString()).refs()).containsExactly(new RefFilter("venue", a));
        rejected(() -> pub(type(null), "ref.staffRef", a.toString()), "ref.staffRef: field is not a public ref field");
        rejected(() -> pub(type(null), "ref.status", a.toString()), "ref.status: field is not a public ref field");
    }

    @Test
    void G02_searchIsPassedThrough() {
        assertThat(work("q", " Coast ").q()).isEqualTo(" Coast ");
        rejected(() -> work("q", "a", "q", "b"), "q must not repeat");
    }
}
```

`ListAccessTests`、`PredicateIndexCheckTests` 的案例見 §4.4 的邊界案例表。

`src/test/java/com/fallrising/cms/identity/service/ListAccessTests.java`：

```java
package com.fallrising.cms.identity.service;

import com.fallrising.cms.api.error.ErrorCode;
import com.fallrising.cms.identity.IdentityException;
import com.fallrising.cms.identity.domain.CmsAction;
import com.fallrising.cms.identity.domain.Permission;
import com.fallrising.cms.identity.domain.Principal;
import com.fallrising.cms.identity.domain.PrincipalRoleAssignment;
import com.fallrising.cms.identity.domain.PrincipalStatus;
import com.fallrising.cms.identity.domain.Role;
import com.fallrising.cms.identity.domain.Surface;
import com.fallrising.cms.identity.store.InMemoryIdentityStore;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ListAccessTests {

    static final Instant T0 = Instant.parse("2026-01-01T00:00:00Z");
    static final String OWN = "{\"type\":\"fieldEquals\",\"field\":\"ownerPrincipalId\",\"value\":\"$currentPrincipalId\"}";
    static final String NORTH = "{\"type\":\"fieldEquals\",\"field\":\"clinic\",\"value\":\"north\"}";
    static final List<String> ALL = List.of("front", "back", "admin");

    InMemoryIdentityStore store;
    AuthorizationService authorization;
    Role member;
    Principal anna;

    @BeforeEach
    void setUp() {
        store = new InMemoryIdentityStore();
        member = new Role(UUID.randomUUID(), "member", "Member", true, T0);
        store.insertRole(member);
        anna = new Principal(UUID.randomUUID(), "anna", "anna", null, PrincipalStatus.ACTIVE, 0, null, null, T0, T0, null);
        store.insertPrincipal(anna);
        store.replacePrincipalRoles(anna.id(), List.of(new PrincipalRoleAssignment(anna.id(), member.id(), "member", List.of())));
        authorization = new AuthorizationService(store, new ObjectMapper());
    }

    void grant(String type, String predicate) {
        store.insertPermission(new Permission(UUID.randomUUID(), member.id(), "read_published", type, predicate, ALL, T0));
    }

    @Test
    void B10_predicateGrantsBecomeClausesWithCurrentPrincipalSubstituted() {
        grant("pet", OWN);
        grant("pet", NORTH);
        grant("pet", OWN);
        assertThat(authorization.listAccess(anna, CmsAction.READ_PUBLISHED, "pet", Surface.FRONT))
                .isEqualTo(new AuthorizationService.ListAccess(false, List.of(
                        new AuthorizationService.ListAccess.Clause("ownerPrincipalId", anna.id().toString()),
                        new AuthorizationService.ListAccess.Clause("clinic", "north"))));
    }

    @Test
    void B10_anyGrantWithoutPredicateIsUnrestricted() {
        grant("pet", OWN);
        grant("pet", null);
        assertThat(authorization.listAccess(anna, CmsAction.READ_PUBLISHED, "pet", Surface.BACK).unrestricted()).isTrue();
    }

    @Test
    void B10_anonymousGetsNoClauseForCurrentPrincipalPredicate() {
        Role anonymous = new Role(UUID.randomUUID(), "anonymous", "Anonymous", true, T0);
        store.insertRole(anonymous);
        store.insertPermission(new Permission(UUID.randomUUID(), anonymous.id(), "read_published", "pet", OWN, ALL, T0));
        store.insertPermission(new Permission(UUID.randomUUID(), anonymous.id(), "read_published", "pet", "{broken", ALL, T0));
        assertThat(authorization.listAccess(null, CmsAction.READ_PUBLISHED, "pet", Surface.FRONT))
                .isEqualTo(new AuthorizationService.ListAccess(false, List.of()));
    }

    @Test
    void B10_noMatchingGrantIsForbiddenAndHardDenyIsSurfaceForbidden() {
        grant("pet", OWN);
        assertThatThrownBy(() -> authorization.listAccess(anna, CmsAction.READ_PUBLISHED, "visit", Surface.FRONT))
                .isInstanceOf(IdentityException.class)
                .satisfies(e -> assertThat(((IdentityException) e).code()).isEqualTo(ErrorCode.FORBIDDEN));
        assertThatThrownBy(() -> authorization.listAccess(anna, CmsAction.READ_DRAFT, "pet", Surface.FRONT))
                .isInstanceOf(IdentityException.class)
                .satisfies(e -> assertThat(((IdentityException) e).code()).isEqualTo(ErrorCode.SURFACE_FORBIDDEN));
    }
}
```

`src/test/java/com/fallrising/cms/identity/service/PredicateIndexCheckTests.java`：

```java
package com.fallrising.cms.identity.service;

import com.fallrising.cms.identity.domain.Permission;
import com.fallrising.cms.identity.domain.Role;
import com.fallrising.cms.identity.store.InMemoryIdentityStore;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatNoException;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class PredicateIndexCheckTests {

    static final Instant T0 = Instant.parse("2026-01-01T00:00:00Z");
    static final ObjectMapper MAPPER = new ObjectMapper();
    static final String OWN = "{\"type\":\"fieldEquals\",\"field\":\"ownerPrincipalId\",\"value\":\"$currentPrincipalId\"}";

    /** Compilable pairs: pet.ownerPrincipalId only. */
    static final ContentTypeDirectory DIRECTORY = new ContentTypeDirectory() {
        @Override
        public List<String> enabledTypeKeys() {
            return List.of("pet");
        }

        @Override
        public boolean predicateFieldCompilable(String typeKey, String fieldKey) {
            return Set.of("pet/ownerPrincipalId").contains(typeKey + "/" + fieldKey);
        }
    };

    @Test
    void B10_problemNamesTheReason() {
        assertThat(PredicateIndexCheck.problem(MAPPER, DIRECTORY, "pet", null)).isNull();
        assertThat(PredicateIndexCheck.problem(MAPPER, DIRECTORY, "pet", OWN)).isNull();
        assertThat(PredicateIndexCheck.problem(MAPPER, DIRECTORY, null, OWN)).isEqualTo("a predicate requires contentType");
        assertThat(PredicateIndexCheck.problem(MAPPER, DIRECTORY, "visit", OWN))
                .isEqualTo("predicate field ownerPrincipalId is not an indexed string, enum or ref field of visit");
        assertThat(PredicateIndexCheck.problem(MAPPER, DIRECTORY, "pet", "{\"type\":\"anyOf\"}"))
                .isEqualTo("unsupported or malformed predicate");
    }

    @Test
    void B10_startupCheckFailsOnAStoredPredicateThatCannotBePushedDown() {
        InMemoryIdentityStore store = new InMemoryIdentityStore();
        Role member = new Role(UUID.randomUUID(), "member", "Member", true, T0);
        store.insertRole(member);
        store.insertPermission(new Permission(UUID.randomUUID(), member.id(), "read_published", "pet", OWN, List.of("front"), T0));
        PredicateIndexCheck check = new PredicateIndexCheck(store, DIRECTORY, MAPPER);
        assertThatNoException().isThrownBy(check::check);

        store.insertPermission(new Permission(UUID.randomUUID(), member.id(), "read_published", "visit", OWN, List.of("front"), T0));
        assertThatThrownBy(check::check)
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("member/read_published: predicate field ownerPrincipalId is not an indexed string, enum or ref field of visit");
    }
}
```

`IdentityHardeningTests`（T08；只改建構子，測試內容不變）：

`src/test/java/com/fallrising/cms/IdentityHardeningTests.java`：

```diff
--- a/src/test/java/com/fallrising/cms/IdentityHardeningTests.java
+++ b/src/test/java/com/fallrising/cms/IdentityHardeningTests.java
@@ -14,6 +14,7 @@
 import com.fallrising.cms.identity.domain.Surface;
 import com.fallrising.cms.identity.service.AuthService;
 import com.fallrising.cms.identity.service.AuthorizationService;
+import com.fallrising.cms.identity.service.ContentTypeDirectory;
 import com.fallrising.cms.identity.service.PrincipalAdminService;
 import com.fallrising.cms.identity.store.IdentityStore;
 import com.fallrising.cms.identity.store.InMemoryIdentityStore;
@@ -113,7 +114,7 @@
         ObjectMapper mapper = new ObjectMapper();
         AuthorizationService authz = new AuthorizationService(store, mapper);
         AuthService auth = new AuthService(store, hasher, props, authz);
-        PrincipalAdminService admin = new PrincipalAdminService(store, hasher, auth, authz, mapper);
+        PrincipalAdminService admin = new PrincipalAdminService(store, hasher, auth, authz, mapper, NO_TYPES);
         Principal principal = store.findPrincipalByUsername("admin").orElseThrow();
         IdentityRequest request = adminRequest(principal);
 
@@ -140,7 +141,7 @@
         ObjectMapper mapper = new ObjectMapper();
         AuthorizationService authz = new AuthorizationService(store, mapper);
         AuthService auth = new AuthService(store, hasher, props, authz);
-        PrincipalAdminService admin = new PrincipalAdminService(store, hasher, auth, authz, mapper);
+        PrincipalAdminService admin = new PrincipalAdminService(store, hasher, auth, authz, mapper, NO_TYPES);
         Principal principal = store.findPrincipalByUsername("admin").orElseThrow();
         IdentityRequest request = adminRequest(principal);
         Role adminRole = store.findRoleByCode("admin").orElseThrow();
@@ -152,6 +153,18 @@
         assertThat(store.permissionsOfRole(adminRole.id())).containsExactlyElementsOf(before);
     }
 
+    private static final ContentTypeDirectory NO_TYPES = new ContentTypeDirectory() {
+        @Override
+        public List<String> enabledTypeKeys() {
+            return List.of();
+        }
+
+        @Override
+        public boolean predicateFieldCompilable(String typeKey, String fieldKey) {
+            return false;
+        }
+    };
+
     private static IdentityProperties props() {
         IdentityProperties props = new IdentityProperties();
         props.setArgon2MemoryKb(8);
```

### 7.4 `ListQueryApiTests`、`ListQueryCountTests`（MockMvc）

前置資料：demo 種子（`seed-member-clinic` 擁有 `Leo`；`Basil`、`Jewel` 屬於別人）。每個測試另外以 `seed-operator-album` 建立自己的 entry，標題含一個隨機的 8 碼 token（`t` 或 `c` 開頭），再以 `q=<token>` 只列出自己的資料，所以與其他測試類別共用的 Spring context 互不干擾。

| 測試 | # | 動作 | 斷言 |
| --- | --- | --- | --- |
| `G02_workListPagesAndCountsAllMatches` | 1 | 建立 5 筆相簿草稿 | — |
| | 2 | `GET …/album/entries?q=<token>&size=2&page=2&sort=title` | `total` 5、`page` 2、`size` 2、`offset` 2、`limit` 2；標題是第 3、4 筆 |
| `G02_workListDefaultStatesLeaveOutArchived` | 1 | 建立兩筆，封存其中一筆 | — |
| | 2 | 不帶 `state`；帶 `state=archived` | 只有未封存的；只有封存的 |
| `G02_workListFiltersByFilterableField` | 1 | `visibility` 分別是 `public`、`unlisted` | — |
| | 2 | `filter.visibility=unlisted` | `total` 1，是 `unlisted` 那筆 |
| `G02_listGuardsForSessionSurfaceAndUnknownType` | 1 | 沒有 session 的工作列表；Front 的工作列表；Back 列 `nope`；公開列 `nope` | 401 `UNAUTHENTICATED`；403 `SURFACE_FORBIDDEN`；404 `CONTENT_TYPE_NOT_FOUND`；404 `ENTRY_NOT_FOUND` |
| `G02_invalidListParametersAre400` | 1 | 工作列表 `size=0`、`page=x`、`state=gone`、`sort=cover`、`filter.title=a`、`ref.album=not-a-uuid` | 每一個 400 `VALIDATION_FAILED` |
| | 2 | 公開 `size=101`；公開 `state=draft` | 400 `VALIDATION_FAILED`；400 `AUDIENCE_PARAM_REJECTED` |
| `G02_publicPhotosFollowSortFieldAndSortParameter` | 1 | 發布一本公開相簿與三張照片（`sortOrder` 3、1、2） | — |
| | 2 | 匿名 `ref.album=<id>` | `total` 3；`p1, p2, p3` |
| | 3 | 加 `sort=-sortOrder&size=2` | `total` 3；`p3, p2` |
| `B10_memberListsOnlyOwnPetsOnBothSurfaces` | 1 | 會員在 Front 列公開寵物 | `total` 1、`Leo` |
| | 2 | 會員在 Back `state=published` | `Leo` |
| | 3 | 會員在 Back 不帶 `state` | 403 `FORBIDDEN` |
| `B10_unscopedGrantListsEveryPet` | 1 | `seed-operator-clinic` 在 Back 列寵物 | 含 `Basil`、`Jewel`、`Leo` |
| `B10_predicateOnFieldWithoutIndexRowsIsRejected` | 1 | `seed-admin` 在 Admin 對 `member` 設 predicate 欄位 `notes`；再設沒有 `contentTypeCode` 的 predicate | 兩次都 400 `VALIDATION_FAILED`（權限不變，所以不影響其他測試） |
| `ListQueryCountTests.B02_workListStoreCallsDoNotGrowWithItems` | 1 | 建立 6 筆；清除 spy 的呼叫紀錄；`size=1` 列表；再清除；`size=6` 列表 | content store 呼叫都是 `[findTypeByKey, fieldsOf, queryEntries]`；identity store 的呼叫序列相同 |
| `ListQueryCountTests.B02_publicListStoreCallsDoNotGrowWithItems` | 1 | 發布 6 筆公開相簿；匿名 `size=1` 與 `size=6` | 同上 |

`ListQueryCountTests` 用 `@MockitoSpyBean` 包住 `ContentStore` 與 `IdentityStore`，所以它有自己的 Spring context（啟動一次種子）。

`src/test/java/com/fallrising/cms/ListQueryApiTests.java`：

```java
package com.fallrising.cms;

import com.fallrising.cms.support.TestSession;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.hamcrest.Matchers.equalTo;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** BW1b list queries through the HTTP API (02 §4.1). Each test creates its own entries under a unique token. */
@SpringBootTest
@AutoConfigureMockMvc
class ListQueryApiTests {

    @Autowired
    MockMvc mockMvc;

    @Autowired
    ObjectMapper mapper;

    @Value("${cms.identity.seed-password}")
    String password;

    @Test
    void G02_workListPagesAndCountsAllMatches() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        String token = token();
        for (int i = 1; i <= 5; i++) {
            create(op, "album", Map.of("title", token + " album " + i));
        }
        mockMvc.perform(op.apply(get("/api/v1/content-types/album/entries")
                        .param("q", token).param("size", "2").param("page", "2").param("sort", "title")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(5))
                .andExpect(jsonPath("$.page").value(2))
                .andExpect(jsonPath("$.size").value(2))
                .andExpect(jsonPath("$.offset").value(2))
                .andExpect(jsonPath("$.limit").value(2))
                .andExpect(jsonPath("$.items[*].title").value(equalTo(List.of(token + " album 3", token + " album 4"))));
    }

    @Test
    void G02_workListDefaultStatesLeaveOutArchived() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        String token = token();
        create(op, "album", Map.of("title", token + " kept"));
        String archived = create(op, "album", Map.of("title", token + " archived"));
        mockMvc.perform(op.apply(post("/api/v1/entries/{id}/archive", archived))).andExpect(status().isOk());

        mockMvc.perform(op.apply(get("/api/v1/content-types/album/entries").param("q", token)))
                .andExpect(jsonPath("$.items[*].title").value(equalTo(List.of(token + " kept"))));
        mockMvc.perform(op.apply(get("/api/v1/content-types/album/entries").param("q", token).param("state", "archived")))
                .andExpect(jsonPath("$.items[*].title").value(equalTo(List.of(token + " archived"))));
    }

    @Test
    void G02_workListFiltersByFilterableField() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        String token = token();
        create(op, "album", Map.of("title", token + " open", "visibility", "public"));
        create(op, "album", Map.of("title", token + " hidden", "visibility", "unlisted"));
        mockMvc.perform(op.apply(get("/api/v1/content-types/album/entries")
                        .param("q", token).param("filter.visibility", "unlisted")))
                .andExpect(jsonPath("$.total").value(1))
                .andExpect(jsonPath("$.items[0].title").value(token + " hidden"));
    }

    @Test
    void G02_invalidListParametersAre400() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        for (String[] bad : List.of(
                new String[] {"size", "0"},
                new String[] {"page", "x"},
                new String[] {"state", "gone"},
                new String[] {"sort", "cover"},
                new String[] {"filter.title", "a"},
                new String[] {"ref.album", "not-a-uuid"})) {
            mockMvc.perform(op.apply(get("/api/v1/content-types/photo/entries").param(bad[0], bad[1])))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"));
        }
        mockMvc.perform(get("/api/v1/public/content-types/album/entries").param("size", "101"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"));
        mockMvc.perform(get("/api/v1/public/content-types/album/entries").param("state", "draft"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("AUDIENCE_PARAM_REJECTED"));
    }

    @Test
    void G02_listGuardsForSessionSurfaceAndUnknownType() throws Exception {
        mockMvc.perform(get("/api/v1/content-types/album/entries").header("Origin", TestSession.BACK))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("UNAUTHENTICATED"));
        TestSession front = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.FRONT);
        mockMvc.perform(front.apply(get("/api/v1/content-types/album/entries")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("SURFACE_FORBIDDEN"));
        TestSession back = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        mockMvc.perform(back.apply(get("/api/v1/content-types/nope/entries")))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("CONTENT_TYPE_NOT_FOUND"));
        mockMvc.perform(get("/api/v1/public/content-types/nope/entries"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("ENTRY_NOT_FOUND"));
    }

    @Test
    void G02_publicPhotosFollowSortFieldAndSortParameter() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        String token = token();
        String album = create(op, "album", Map.of("title", token, "visibility", "public"), token);
        publish(op, album);
        for (int rank : List.of(3, 1, 2)) {
            publish(op, create(op, "photo", Map.of("title", token + " p" + rank, "album", album, "sortOrder", rank)));
        }
        mockMvc.perform(get("/api/v1/public/content-types/photo/entries").param("ref.album", album))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(3))
                .andExpect(jsonPath("$.items[*].title").value(equalTo(List.of(token + " p1", token + " p2", token + " p3"))));
        mockMvc.perform(get("/api/v1/public/content-types/photo/entries").param("ref.album", album)
                        .param("sort", "-sortOrder").param("size", "2"))
                .andExpect(jsonPath("$.total").value(3))
                .andExpect(jsonPath("$.items[*].title").value(equalTo(List.of(token + " p3", token + " p2"))));
    }

    @Test
    void B10_memberListsOnlyOwnPetsOnBothSurfaces() throws Exception {
        TestSession front = TestSession.login(mockMvc, "seed-member-clinic", password, TestSession.FRONT);
        mockMvc.perform(front.apply(get("/api/v1/public/content-types/pet/entries")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(1))
                .andExpect(jsonPath("$.items[*].title").value(equalTo(List.of("Leo"))));

        TestSession back = TestSession.login(mockMvc, "seed-member-clinic", password, TestSession.BACK);
        mockMvc.perform(back.apply(get("/api/v1/content-types/pet/entries").param("state", "published")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[*].title").value(equalTo(List.of("Leo"))));
        mockMvc.perform(back.apply(get("/api/v1/content-types/pet/entries")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
    }

    @Test
    void B10_unscopedGrantListsEveryPet() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-clinic", password, TestSession.BACK);
        mockMvc.perform(op.apply(get("/api/v1/content-types/pet/entries").param("sort", "title")))
                .andExpect(jsonPath("$.items[*].title").value(org.hamcrest.Matchers.hasItems("Basil", "Jewel", "Leo")));
    }

    @Test
    void B10_predicateOnFieldWithoutIndexRowsIsRejected() throws Exception {
        TestSession admin = TestSession.login(mockMvc, "seed-admin", password, TestSession.ADMIN);
        String notIndexed = "{\"type\":\"fieldEquals\",\"field\":\"notes\",\"value\":\"$currentPrincipalId\"}";
        String typeless = "{\"type\":\"fieldEquals\",\"field\":\"ownerPrincipalId\",\"value\":\"$currentPrincipalId\"}";
        for (String body : List.of(
                "[{\"action\":\"read_published\",\"contentTypeCode\":\"pet\",\"predicateJson\":%s}]".formatted(mapper.writeValueAsString(notIndexed)),
                "[{\"action\":\"read_published\",\"predicateJson\":%s}]".formatted(mapper.writeValueAsString(typeless)))) {
            mockMvc.perform(admin.apply(put("/api/v1/roles/member/permissions")
                            .contentType(MediaType.APPLICATION_JSON).content(body)))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"));
        }
    }

    private String create(TestSession session, String type, Map<String, Object> payload) throws Exception {
        return create(session, type, payload, null);
    }

    private String create(TestSession session, String type, Map<String, Object> payload, String slug) throws Exception {
        String body = mapper.writeValueAsString(Map.of("slug", slug == null ? token() : slug, "payload", payload));
        String json = mockMvc.perform(session.apply(post("/api/v1/content-types/{type}/entries", type)
                        .contentType(MediaType.APPLICATION_JSON).content(body)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        JsonNode node = mapper.readTree(json);
        return node.get("id").asText();
    }

    private void publish(TestSession session, String id) throws Exception {
        mockMvc.perform(session.apply(post("/api/v1/entries/{id}/publish", id))).andExpect(status().isOk());
    }

    private static String token() {
        return "t" + UUID.randomUUID().toString().substring(0, 8);
    }
}
```

`src/test/java/com/fallrising/cms/ListQueryCountTests.java`：

```java
package com.fallrising.cms;

import com.fallrising.cms.content.store.ContentStore;
import com.fallrising.cms.identity.store.IdentityStore;
import com.fallrising.cms.support.TestSession;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.mockito.invocation.Invocation;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 02 §5.4 "SQL per list request, independent of the number of entries": one list request makes the same store calls
 * for 1 item as for 6. ContentStore: findTypeByKey, fieldsOf, queryEntries (JdbcContentStore runs COUNT and page
 * SELECT for queryEntries, so 4 SQL statements). Identity store calls are the same for both page sizes (B-12 cache).
 */
@SpringBootTest
@AutoConfigureMockMvc
class ListQueryCountTests {

    @Autowired
    MockMvc mockMvc;

    @Autowired
    ObjectMapper mapper;

    @MockitoSpyBean
    ContentStore contentStore;

    @MockitoSpyBean
    IdentityStore identityStore;

    @Value("${cms.identity.seed-password}")
    String password;

    @Test
    void B02_workListStoreCallsDoNotGrowWithItems() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        String token = createAlbums(op, 6, false);
        Calls one = calls(op.apply(get("/api/v1/content-types/album/entries").param("q", token).param("size", "1")), 1);
        Calls six = calls(op.apply(get("/api/v1/content-types/album/entries").param("q", token).param("size", "6")), 6);
        assertThat(one.content()).containsExactly("findTypeByKey", "fieldsOf", "queryEntries");
        assertThat(six.content()).isEqualTo(one.content());
        assertThat(six.identity()).isEqualTo(one.identity());
    }

    @Test
    void B02_publicListStoreCallsDoNotGrowWithItems() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        String token = createAlbums(op, 6, true);
        Calls one = calls(get("/api/v1/public/content-types/album/entries").param("q", token).param("size", "1"), 1);
        Calls six = calls(get("/api/v1/public/content-types/album/entries").param("q", token).param("size", "6"), 6);
        assertThat(one.content()).containsExactly("findTypeByKey", "fieldsOf", "queryEntries");
        assertThat(six.content()).isEqualTo(one.content());
        assertThat(six.identity()).isEqualTo(one.identity());
    }

    /** Creates count albums titled token + i (published with visibility public when publish is true); returns token. */
    private String createAlbums(TestSession op, int count, boolean publish) throws Exception {
        String token = "c" + UUID.randomUUID().toString().substring(0, 8);
        for (int i = 0; i < count; i++) {
            String json = mockMvc.perform(op.apply(post("/api/v1/content-types/album/entries").contentType(MediaType.APPLICATION_JSON)
                            .content(mapper.writeValueAsString(Map.of("slug", token + i,
                                    "payload", Map.of("title", token + i, "visibility", "public"))))))
                    .andExpect(status().isCreated())
                    .andReturn().getResponse().getContentAsString();
            if (publish) {
                mockMvc.perform(op.apply(post("/api/v1/entries/{id}/publish", mapper.readTree(json).get("id").asText())))
                        .andExpect(status().isOk());
            }
        }
        return token;
    }

    record Calls(List<String> content, List<String> identity) {}

    private Calls calls(MockHttpServletRequestBuilder request, int expectedItems) throws Exception {
        Mockito.clearInvocations(contentStore, identityStore);
        mockMvc.perform(request).andExpect(status().isOk()).andExpect(jsonPath("$.items.length()").value(expectedItems));
        return new Calls(names(contentStore), names(identityStore));
    }

    private static List<String> names(Object spy) {
        return Mockito.mockingDetails(spy).getInvocations().stream().map(Invocation::getMethod).map(m -> m.getName()).toList();
    }
}
```

### 7.5 `ListQueryPerformanceTests`（`integrationTest`）

全文與方法在 §5.6。

### 7.6 故障注入

- 資料庫失敗：沿用 BW0（`ApiExceptionHandlerTests`，500 `INTERNAL_ERROR`）；`JdbcContentStore` 的寫入與索引在同一個交易，任一 SQL 失敗時兩者都回滾（`TransactionTemplate` 預設遇到 `RuntimeException` 回滾）。本波次沒有另外的故障注入測試：交易邊界由 §2.3 的查證與 `B09_*` 在 PostgreSQL 上的結果保證。
- 無法下推的 predicate：`PredicateIndexCheckTests` 直接在 identity store 放入壞的 permission。

---

## 8. 失敗模式對照

| FM ID | 失敗情境 | 期望行為 | 由哪個測試覆蓋 | 任務卡 |
| --- | --- | --- | --- | --- |
| BW1b-FM01 | 未登入呼叫工作列表 | 401 `UNAUTHENTICATED`（不變） | `ListQueryApiTests.G02_listGuardsForSessionSurfaceAndUnknownType` | T09 |
| BW1b-FM02 | 在 Front 呼叫工作列表 | 403 `SURFACE_FORBIDDEN`（不變） | `ListQueryApiTests.G02_listGuardsForSessionSurfaceAndUnknownType` | T09 |
| BW1b-FM03 | 沒有需要的 action | 403 `FORBIDDEN` | `ListQueryApiTests.B10_memberListsOnlyOwnPetsOnBothSurfaces`（第 3 步）、`ListAccessTests.B10_noMatchingGrantIsForbiddenAndHardDenyIsSurfaceForbidden` | T07～T10 |
| BW1b-FM04 | 只有帶 predicate 的 grant | 只列出符合 predicate 的 entry，`total` 也只算它們 | `ListQueryApiTests.B10_memberListsOnlyOwnPetsOnBothSurfaces`、`ContentStoreContract.B10_*` | T03、T04、T09、T10 |
| BW1b-FM05 | 匿名只有 `$currentPrincipalId` predicate | 空頁，不是 403 | `ListAccessTests.B10_anonymousGetsNoClauseForCurrentPrincipalPredicate`、`ContentStoreContract.B10_accessFilterKeepsEntriesMatchingAnyClause` | T03、T04、T07、T08 |
| BW1b-FM06 | 參數錯誤（`page`、`size`、`state`、`sort`、`filter`、`ref`、重複） | 400 `VALIDATION_FAILED`，`message` 以參數名開頭 | `ListQueryParserTests.*`、`ListQueryApiTests.G02_invalidListParametersAre400` | T07～T10 |
| BW1b-FM07 | 公開列表帶 `state` | 400 `AUDIENCE_PARAM_REJECTED`（不變） | `ListQueryApiTests.G02_invalidListParametersAre400` | T09、T10 |
| BW1b-FM08 | 公開列表篩選或排序非公開欄位、用非公開的關聯欄位 | 400 `VALIDATION_FAILED`（不洩漏非公開欄位的值） | `ListQueryParserTests.G02_sortKeys`、`G02_onlyFilterableIndexedFieldsQualify`、`G02_refFiltersRepeatAndSkipBlank` | T07、T08 |
| BW1b-FM09 | 類型不存在 | 工作 404 `CONTENT_TYPE_NOT_FOUND`、公開 404 `ENTRY_NOT_FOUND`（不變） | `ListQueryApiTests.G02_listGuardsForSessionSurfaceAndUnknownType` | T09 |
| BW1b-FM10 | 驗證失敗、版本衝突 | 本波次沒有改寫入的驗證；行為不變 | 既有 `ErrorEnvelopeTests`、`DemoPackTests` | — |
| BW1b-FM11 | 資料庫在寫 entry 或索引時失敗 | 整個交易回滾，500 `INTERNAL_ERROR`；不會留下「entry 已改、索引沒改」 | §7.6（交易邊界由預演的 PostgreSQL 契約測試與 §2.3 保證；沒有專門的注入測試，理由見 §7.6） | T02 |
| BW1b-FM12 | V7 在既有資料庫執行 | 兩個 scope 的列都重建；舊列刪除 | `EntryIndexBackfillTests.B09_v7BackfillsWorkAndPublishedRowsAndDropsStaleRows` | T05、T06 |
| BW1b-FM13 | payload 值型別不符（數字寫成字串等） | 不寫索引列；該 entry 在該欄位的篩選與排序中當成沒有值 | `ContentStoreContract.B09_nullBlankAndWrongJsonTypesGetNoRow` | T01、T02 |
| BW1b-FM14 | 修改類型設定或新增欄位後，舊 entry 的索引過期 | 同一個操作內重建該類型的索引 | `ContentStoreContract.B09_typeSettingsAndNewFieldsReindexExistingEntries` | T01、T02 |
| BW1b-FM15 | 必要關聯指向不公開的目標 | 不出現在公開列表 | `ContentStoreContract.B02_requiredRefsMustPointToPubliclyReadableEntries` | T03、T04 |
| BW1b-FM16 | 排序值相同、跨頁 | 以 `updatedAt`、id 決定順序，同一份資料每次分頁結果相同 | `ContentStoreContract.B02_equalTiesAreOrderedByUpdatedAtThenIdText` | T03、T04 |
| BW1b-FM17 | 無法下推的 predicate：啟動時已存在／修改權限時送入 | 啟動失敗／400 `VALIDATION_FAILED` 且不寫入 | `PredicateIndexCheckTests.*`、`ListQueryApiTests.B10_predicateOnFieldWithoutIndexRowsIsRejected` | T07～T09 |
| BW1b-FM18 | 列表筆數變多時查詢數增加（N+1） | store 呼叫數與筆數無關；JDBC 一次查詢 2 個 SQL | `ListQueryCountTests.*`、`ListQueryPerformanceTests` | T09～T11 |
| BW1b-FM19 | 1 萬筆時列表或更新太慢 | 未達 §5.6 門檻時 `integrationTest` 失敗 | `ListQueryPerformanceTests` | T11 |
| BW1b-FM20 | 公開列表展開 `media-ref` 時逐筆查詢媒體 | 本波次不處理 | 沒有測試：已記為 02 BQ-11 | — |
| BW1b-FM21 | 公開列表的 `ref.<field>` 在已發布副本與工作副本的關聯不同時 | 以工作副本的關聯為準 | 沒有測試：已記為 02 BQ-10 | — |
| BW1b-FM22 | 回應多了契約沒有的屬性，或 W0 已合併時契約改變 | 全域 OpenAPI 驗證讓 MockMvc 測試失敗；`web` 的 codegen 新鮮度失敗依 §2.1 處理 | 全部 MockMvc 測試；`codegen.test.ts`（W0） | T10、T12 |

---

## 9. 交付檢查表

- [ ] T01～T12 全部完成。
- [ ] `./gradlew test` 全綠（預期 180 個＝BW1a 的 139＋本波 43－刪除的 `PublicOrderTests` 2）。
- [ ] `./gradlew integrationTest` 全綠（67 個）；本機沒有 Docker 時勾「只在 CI 跑過」並附連結（02 BQ-09）。
- [ ] `ListQueryPerformanceTests` 的輸出行已貼進 PR 說明，三個 p95 分別 ≤ 150、100、80 ms。
- [ ] `npm ci && npm run lint && npm run typecheck && npm test && npm run build` 全綠；或只有 §2.1 所說的 codegen 新鮮度／fixture 型別失敗，並已在 PR 說明列出（01 Q-10）。
- [ ] `cmp docs/v2/contracts/BW1b.openapi.yaml services/cms-api/src/main/resources/openapi/openapi.yaml` 沒有輸出。
- [ ] `grep -rn "listEntries\|publicOrder" services/cms-api/src` 沒有輸出。
- [ ] B-02：`ListQueryApiTests.G02_workListPagesAndCountsAllMatches`、`ListQueryCountTests` 綠。
- [ ] B-09：`ContentStoreContract.B09_*`（兩種 store）、`EntryIndexBackfillTests` 綠。
- [ ] B-10：`ListQueryApiTests.B10_*`、`ListAccessTests`、`PredicateIndexCheckTests` 綠。
- [ ] G-02：`ListQueryParserTests`、`ListQueryApiTests.G02_*` 綠。
- [ ] `gradle.lockfile` 沒有變動（`git diff --stat origin/main -- services/cms-api/gradle.lockfile` 沒有輸出）。
- [ ] 沒有秘密或密碼（新測試只用 `@Value("${cms.identity.seed-password}")`）。
- [ ] `docs/v2/README.md` 的 BW1b 狀態已改成 `VERIFIED`。
- [ ] PR 說明列出 §4.2 的行為變更，以及實際跑過的指令與結果。

---

## 10. BW1b 必寫內容索引

| REFINE-PROMPT 要求 | 位置 |
| --- | --- |
| 查詢參數的文法（含錯誤輸入的處理） | §4.3 |
| predicate 編譯成 SQL 的規則與全部邊界案例 | §4.4 |
| V6、V7 migration 全文 | §4.5 |
| 效能量測方法 | §5.6 |

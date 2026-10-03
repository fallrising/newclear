# BW0 施工圖 — 契約與品質基礎

[回 v2 索引](../README.md) ・ 框架：[02 §7 BW0](../02-backend-sdd.md#7-後端波次) ・ 契約：[contracts/BW0.openapi.yaml](../contracts/BW0.openapi.yaml)

狀態：**DOC_READY**（本檔合併即生效）  
日期：2026-09-25  
讀者：實作 BW0 的 agent。只讀本檔、`contracts/BW0.openapi.yaml` 與本檔引用的檔案就能完成，不需要做任何設計決定。

> **預演紀錄。** 本檔所有 Java 程式碼、YAML 與測試，已在一份 `services/cms-api` 的一次性副本上逐字套用並執行過（2026-09-25）：`./gradlew :services:cms-api:test` 共 111 個測試，唯一失敗的是 `CmsApiApplicationTests.runtimeIsJava25`（預演環境只有 JDK 21，把 toolchain 暫改成 21；實作時維持 25，該測試會綠）；`integrationTest` 共 44 個測試全綠，但預演用的是本機 PostgreSQL 16.13 而不是 Testcontainers（預演環境沒有 Docker daemon）。所以 `PostgresFixture` 的 Testcontainers 路徑、CI 新 job 都**只在實作 PR 的 CI 上第一次真正執行**。

---

## 1. 範圍

### 1.1 解決的 ID

| ID | 來源 | 本波次做到什麼程度 |
| --- | --- | --- |
| B-01 | 02 §1.2 | 全部 55 個 operation 都有 request／response schema 與錯誤回應；每個 MockMvc 回應都用 OpenAPI 驗證（BD-03） |
| B-08 | 02 §1.2 | Content、Media、Identity 三種 store 各一組契約測試，in-memory 在 `test` 跑、JDBC 在 `integrationTest` 跑；CI 新增 `java-integration` job（BD-10）；修掉契約測試找出的 9 處行為不一致 |
| B-14 | 02 §1.2 | 三個 `@RestControllerAdvice` 合併成一個；`ErrorCode` enum 與 OpenAPI `ErrorCode` 由測試保證一致；框架層錯誤（壞 JSON、壞 UUID、錯的 method、錯的 Content-Type、未知路由、未預期例外）全部回傳 `ErrorEnvelope` |
| B-15 | 02 §1.2（本波細化時新增） | `JdbcIdentityStore` 的 last-admin guard 在真實 PostgreSQL 上一律失敗，修正 |
| BD-03 | 02 §2 | 全部 |
| BD-08 | 02 §2 | 只做「統一成一個 handler」；`error.fields` 與一次收集所有欄位錯誤屬於 BW1（02 §4.4） |
| BD-10 | 02 §2 | 全部 |
| 02 §5.5 | Proposed | 只做 dependency locking |

稽核 `F/S/C/U/E-xx`、缺口 `G-xx`、`V2-AC-xx`、surface 規格的 `AC-xx`：本波次都不直接解決。W0 依賴本波次的 OpenAPI 產生前端型別（01 D-04、E-02）。

### 1.2 不做

- 01 §1.2 的全部非目標；AGENTS.md「不要做」全部。
- **不改任何 API 行為**，只有下列例外，全部是「原本回 500 或 Spring 預設錯誤頁，改成回 `ErrorEnvelope`」：§5.3 的三項 400、§5.1 的框架錯誤對應。
- 不新增 migration、不改資料表。
- 不做 02 §4.4 的三項破壞性變更（PATCH 必帶 `version`、公開投影不回媒體 id、`error.fields`）：BW1。
- 不修正本波次**記載但保留**的既有行為：`GET/PATCH /principals/{id}` 找不到時回 400（BQ-06）、媒體錯誤代碼是小寫（BQ-07）、管理端輸入沒驗證導致的 500（BQ-08）、工作投影的 `title` 讀 `payload.title`（B-03，BW1）、`string` 欄位不驗證型別（B-06，BW1）。
- 不改前端、`packages/*`、`e2e/`、`compose.yaml`、`docker/`。
- 不做 Gradle dependency verification（`gradle/verification-metadata.xml`），也不鎖 plugin／settings classpath（`buildscript-gradle.lockfile`、`settings-gradle.lockfile`）。
- 不升級 OpenAPI 到 3.1：維持 `openapi: 3.0.3`（現行檔案第 1 行就是 3.0.3；前端 codegen 用的 `openapi-typescript` 7.13.0 支援 3.0 與 3.1，見 §2.3）。
- 不做效能量測（BW4）。

---

## 2. 先決條件

### 2.1 前置波次

無。BW0 是第一個波次。

### 2.2 環境

| 項目 | 值 |
| --- | --- |
| 工作目錄 | `apps/cms-scaffold`（以下指令都在這裡執行） |
| JDK | 25（Temurin；toolchain 釘死，不要改 `build.gradle.kts` 的 25） |
| Gradle | 用 wrapper `./gradlew`（9.7.1，`gradle/wrapper/gradle-wrapper.properties`） |
| Docker | 跑 `./gradlew :services:cms-api:integrationTest` 必須有可用的 Docker daemon。本機沒有 Docker 時，這個指令一定失敗（Testcontainers 找不到 Docker）；改看 CI 的 `java-integration` job |
| Node | 24.18.0（只為了跑完整閘門的前端部分；本波不改前端） |
| 網路 | 需要 Maven Central。遇到 HTTP 429 時等幾分鐘再試；不要改 `settings.gradle.kts` 的 repository |
| 環境變數 | 無。測試用的 seed 密碼在 `services/cms-api/src/test/resources/application.yaml` 的 `cms.identity.seed-password`；新測試一律用 `@Value("${cms.identity.seed-password}")` 讀，**不要**把它的值抄進任何新檔案 |

### 2.3 查證過的外部事實

| 事實 | 來源 | 查閱日 |
| --- | --- | --- |
| `com.atlassian.oai:swagger-request-validator-mockmvc` 3.0.0 的 POM 宣告 relocation 到 `com.atlassian.oai:openapi-request-validator-mockmvc` 3.0.0 | <https://repo1.maven.org/maven2/com/atlassian/oai/swagger-request-validator-mockmvc/3.0.0/swagger-request-validator-mockmvc-3.0.0.pom> | 2026-09-25 |
| `openapi-request-validator-core` 3.0.0 依賴 `swagger-parser` 2.1.41、`networknt json-schema-validator`；以 Java 21 bytecode 發佈；公開 API 有 `OpenApiInteractionValidator.createForInlineApiSpecification(String)`、`validateResponse(String, Request.Method, Response)`、`SimpleResponse.Builder`、`ValidationReport`、`SimpleValidationReportFormat`（以 `javap` 讀 jar 確認） | <https://repo1.maven.org/maven2/com/atlassian/oai/openapi-request-validator-core/3.0.0/> | 2026-09-25 |
| `openapi-request-validator-mockmvc` 3.0.0 的 POM 以 `javax.servlet-api` 與 Spring 5.3.26 建置。**所以本波不用 mockmvc 模組**，只用 core，自己寫 30 行的 MockMvc 轉接（§5.5） | 同上目錄的 `openapi-request-validator-mockmvc-3.0.0.pom` | 2026-09-25 |
| 驗證器的訊息代碼 `validation.request.path.missing`、`validation.request.operation.notAllowed`、`validation.response.status.unknown`、`validation.response.contentType.notAllowed` | core 3.0.0 jar 內 `swagger/validation/messages.properties` | 2026-09-25 |
| 在 Spring Boot 3.5.16 BOM 下解析的版本：spring-test 6.2.19、testcontainers 1.21.4、flyway 11.7.2、postgresql 42.7.11、jackson-databind 2.21.4、networknt json-schema-validator 2.0.1、swagger-parser 2.1.41 | 預演時 `./gradlew :services:cms-api:dependencies --write-locks` 產生的 lockfile | 2026-09-25 |
| Testcontainers 1.21.4 相容 Docker Engine 29（1.21.3 以前在 Docker 29 會出現 `client version 1.32 is too old`） | <https://github.com/testcontainers/testcontainers-java/issues/11235> | 2026-09-25 |
| GitHub `ubuntu-24.04` runner 內建 Docker（Client 與 Server 28.0.4） | <https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md> | 2026-09-25 |
| Gradle dependency locking：在專案加 `dependencyLocking { lockAllConfigurations() }`，執行 `./gradlew :services:cms-api:dependencies --write-locks` 會寫出 `services/cms-api/gradle.lockfile`（涵蓋 `integrationTest*` 設定）；加入 lockfile 沒有的依賴後，未帶 `--write-locks` 的解析會失敗 | 以 Gradle 9.7.1 在預演副本上實測；docs.gradle.org 在查證環境被網路政策擋下，未能讀取官方頁面 | 2026-09-25 |
| PostgreSQL 的 `LIKE`／`ILIKE` 可以用 `ESCAPE '\'` 指定跳脫字元，被跳脫的 `%`、`_` 當成字面字元 | 預演時以 PostgreSQL 16.13 執行 `B08_listEntriesSearchIsCaseInsensitiveLiteralOnTitle` 驗證；官方頁面 <https://www.postgresql.org/docs/16/functions-matching.html> 未讀取（未查證原文） | 2026-09-25 |
| `pg_advisory_xact_lock(bigint)` 回傳 `void`；以 `queryForObject(..., Long.class)` 讀取會丟 `DataIntegrityViolationException: Bad value for type long` | 預演時以 PostgreSQL 16.13 執行既有的 `JdbcIdentityStoreIntegrationTests.lastAdminGuardRejectsRemovingAdministrativeCapability` 重現 | 2026-09-25 |
| `openapi-typescript` 最新版 7.13.0，說明為 “Convert OpenAPI 3.0 & 3.1 schemas to TypeScript” | `npm view openapi-typescript version description` | 2026-09-25 |

---

## 3. 檔案清單

路徑相對於 `apps/cms-scaffold/services/cms-api/`，另有註明者除外。**實作者不得碰清單以外的檔案。**

| 路徑 | 動作 | 用途 | 任務卡 |
| --- | --- | --- | --- |
| `build.gradle.kts` | 修改 | 加驗證器依賴、`integrationTest` 看得到 `test` 的類別、dependency locking | T01、T16 |
| `gradle.lockfile` | 新增 | 依賴鎖定檔；**只能**由 `--write-locks` 產生 | T16 |
| `src/main/resources/openapi/openapi.yaml` | 修改（整檔取代） | 完整契約，內容等於 `docs/v2/contracts/BW0.openapi.yaml` | T04 |
| `src/main/java/com/fallrising/cms/api/error/ErrorCode.java` | 新增 | 全部錯誤代碼 | T07 |
| `src/main/java/com/fallrising/cms/api/error/CmsApiException.java` | 新增 | 三種例外的共同父類別 | T07 |
| `src/main/java/com/fallrising/cms/api/error/ErrorBody.java` | 新增 | 產生 `ErrorEnvelope` JSON | T07 |
| `src/main/java/com/fallrising/cms/api/error/ApiExceptionHandler.java` | 新增 | 唯一的 `@RestControllerAdvice` | T08 |
| `src/main/java/com/fallrising/cms/content/ContentException.java` | 修改（整檔取代） | 改繼承 `CmsApiException` | T08 |
| `src/main/java/com/fallrising/cms/media/MediaException.java` | 修改（整檔取代） | 改繼承 `CmsApiException` | T08 |
| `src/main/java/com/fallrising/cms/identity/IdentityException.java` | 修改（整檔取代） | 改繼承 `CmsApiException` | T08 |
| `src/main/java/com/fallrising/cms/identity/web/IdentityErrorWriter.java` | 修改（整檔取代） | filter 層錯誤也走 `ErrorBody` | T08 |
| `src/main/java/com/fallrising/cms/identity/web/IdentitySecurityConfig.java` | 修改 | `AuthErrorCode` → `ErrorCode` | T08 |
| `src/main/java/com/fallrising/cms/content/service/EntryService.java` | 修改 | 錯誤代碼改用 enum | T08 |
| `src/main/java/com/fallrising/cms/content/web/AdminContentController.java` | 修改 | 錯誤代碼改用 enum | T08 |
| `src/main/java/com/fallrising/cms/content/web/ContentExceptionHandler.java` | 刪除 | 併入 `ApiExceptionHandler` | T08 |
| `src/main/java/com/fallrising/cms/media/web/MediaExceptionHandler.java` | 刪除 | 同上 | T08 |
| `src/main/java/com/fallrising/cms/identity/web/IdentityExceptionHandler.java` | 刪除 | 同上 | T08 |
| `src/main/java/com/fallrising/cms/identity/domain/AuthErrorCode.java` | 刪除 | 由 `ErrorCode` 取代 | T08 |
| `src/main/java/com/fallrising/cms/content/web/EntryController.java` | 修改 | `ref.*` 不是 UUID 時回 400 | T09 |
| `src/main/java/com/fallrising/cms/content/web/PublicContentController.java` | 修改 | 同上 | T09 |
| `src/main/java/com/fallrising/cms/identity/service/PrincipalAdminService.java` | 修改 | 未知 `status` 回 400 | T09 |
| `src/main/java/com/fallrising/cms/content/store/InMemoryContentStore.java` | 修改 | 對齊 JDBC 行為 | T12 |
| `src/main/java/com/fallrising/cms/media/store/InMemoryMediaStore.java` | 修改 | 對齊 JDBC 行為 | T12 |
| `src/main/java/com/fallrising/cms/identity/store/InMemoryIdentityStore.java` | 修改 | 對齊 JDBC 行為 | T12 |
| `src/main/java/com/fallrising/cms/content/store/JdbcContentStore.java` | 修改 | `q` 字面比對；NULL jsonb 讀成 null | T14 |
| `src/main/java/com/fallrising/cms/media/store/JdbcMediaStore.java` | 修改 | `listAvailable` 排除 `deleted_at` 非空 | T14 |
| `src/main/java/com/fallrising/cms/identity/store/JdbcIdentityStore.java` | 修改 | 修 B-15 | T14 |
| `src/test/java/com/fallrising/cms/support/OpenApiResponseValidator.java` | 新增 | MockMvc 回應 → OpenAPI 驗證 | T02 |
| `src/test/java/com/fallrising/cms/OpenApiResponseValidatorSelfTests.java` | 新增 | 證明驗證器真的會擋 | T02 |
| `src/test/java/com/fallrising/cms/OpenApiCompletenessTests.java` | 新增 | 每個 operation 的結構規則 | T03 |
| `src/test/java/com/fallrising/cms/support/OpenApiValidationConfig.java` | 新增 | 讓所有 MockMvc 測試自動驗證回應 | T05 |
| `src/test/java/com/fallrising/cms/support/TestSession.java` | 新增 | 新測試共用的登入 helper | T06 |
| `src/test/java/com/fallrising/cms/ErrorEnvelopeTests.java` | 新增 | 錯誤信封的 API 級測試 | T06 |
| `src/test/java/com/fallrising/cms/ErrorCodeContractTests.java` | 新增 | Java enum ＝ OpenAPI enum | T06 |
| `src/test/java/com/fallrising/cms/ApiExceptionHandlerTests.java` | 新增 | 500 不洩漏細節 | T06 |
| `src/test/java/com/fallrising/cms/contract/ContentStoreContract.java` | 新增 | Content store 契約 | T10 |
| `src/test/java/com/fallrising/cms/contract/InMemoryContentStoreContractTests.java` | 新增 | 以 in-memory 執行 | T10 |
| `src/test/java/com/fallrising/cms/contract/MediaStoreContract.java` | 新增 | Media store 契約 | T11 |
| `src/test/java/com/fallrising/cms/contract/InMemoryMediaStoreContractTests.java` | 新增 | 以 in-memory 執行 | T11 |
| `src/test/java/com/fallrising/cms/contract/IdentityStoreContract.java` | 新增 | Identity store 契約 | T11 |
| `src/test/java/com/fallrising/cms/contract/InMemoryIdentityStoreContractTests.java` | 新增 | 以 in-memory 執行 | T11 |
| `src/integrationTest/java/com/fallrising/cms/contract/PostgresFixture.java` | 新增 | 單一 Testcontainers PostgreSQL、每次重建 schema | T13 |
| `src/integrationTest/java/com/fallrising/cms/contract/JdbcContentStoreContractTests.java` | 新增 | 以 JDBC 執行 | T13 |
| `src/integrationTest/java/com/fallrising/cms/contract/JdbcMediaStoreContractTests.java` | 新增 | 以 JDBC 執行 | T13 |
| `src/integrationTest/java/com/fallrising/cms/contract/JdbcIdentityStoreContractTests.java` | 新增 | 以 JDBC 執行 | T13 |
| `.github/workflows/cms-scaffold-ci.yml`（repo 根目錄） | 修改 | 新增 `java-integration` job | T15 |
| `apps/cms-scaffold/README.md` | 修改 | 「測試」一節加 `integrationTest` | T15 |
| `apps/cms-scaffold/docs/v2/README.md` | 修改 | 路線圖 BW0 狀態改 `VERIFIED` | T17 |

不會碰：`package.json`、`package-lock.json`、`.gitignore`、任何 migration、`src/test/resources/application.yaml`、既有的 10 個測試類別、`JdbcIdentityStoreIntegrationTests.java`。

---

## 4. 契約

### 4.1 OpenAPI

完整契約是 [`docs/v2/contracts/BW0.openapi.yaml`](../contracts/BW0.openapi.yaml)。因為本波次改到每一個 operation，**合併方式是整檔取代**：T04 把它複製成 `services/cms-api/src/main/resources/openapi/openapi.yaml`，兩者內容必須逐位元相同。

契約的撰寫規則（之後的波次沿用，不重複定義）：

| # | 規則 | 由誰保證 |
| --- | --- | --- |
| R1 | `openapi: 3.0.3`；`info.version` 每個改動契約的波次加一個 minor（BW0 是 `0.4.0`） | 人工審查 |
| R2 | 每個 operation 至少一個 `2xx`；`204` 以外的 `2xx` 都有 `content` 與 `schema` | `OpenApiCompletenessTests` |
| R3 | 每個 `4xx`／`5xx` 都寫成 `$ref: "#/components/responses/Error<狀態碼>"`，內容一律是 `ErrorEnvelope`（`/actuator/health` 的 503 例外，那是 Spring Actuator 的格式） | `OpenApiCompletenessTests` |
| R4 | 每個 operation 都有 `500`；不是 `security: []` 的 operation 都有 `401` | `OpenApiCompletenessTests` |
| R5 | 有 UUID／整數／enum 型別的 path 或 query 參數、或有 request body 的 operation 都有 `400`；有 request body 的都有 `415` | 本檔 §4.2 表格（人工） |
| R6 | 回應的物件 schema 一律 `additionalProperties: false`；例外只有 `EntryPayload`、`NavigationDocument`（內容由內容類型決定）與 `Health`（Spring 擁有） | `OpenApiResponseValidatorSelfTests.BW0_undocumentedPropertyFails` |
| R7 | 值允許為 JSON `null` 的屬性寫 `nullable: true`，而且仍列在 `required`（屬性一定存在）；時間一律 `type: string, format: date-time`（UTC ISO-8601） | 全體 MockMvc 測試（§5.5 全域驗證） |
| R8 | 每個 operation 的 `description` 以 `Errors:` 開頭逐條列出「狀態 代碼: 何時發生」；所有 operation 都適用的錯誤寫在 `info.description` 的 Common errors | 人工審查 |
| R9 | `error.code` 的所有值集中在 `components.schemas.ErrorCode`，與 Java `ErrorCode.wire()` 完全相同 | `ErrorCodeContractTests` |
| R10 | 只驗證**回應**，不驗證請求（請求 schema 給前端 codegen 用）。沒記載的路徑或 method（例如測 405、未知路由）不驗證 | `OpenApiResponseValidator.UNDOCUMENTED_KEYS` |

### 4.2 全部 operation

下表由 `BW0.openapi.yaml` 產生（55 個 operation，`OpenApiContractTests` 保證與實作的路由一一對應）。「本操作特有的錯誤代碼」之外，所有 operation 另有 `info.description` 的共通錯誤：非公開 operation 的 401 `UNAUTHENTICATED`／`SESSION_EXPIRED`；帶 cookie 的 POST／PUT／PATCH／DELETE 的 403 `CSRF_FAILED`；參數型別錯誤或 JSON 無法解析的 400 `VALIDATION_FAILED`；405 `METHOD_NOT_ALLOWED`；415 `MEDIA_TYPE_NOT_SUPPORTED`；500 `INTERNAL_ERROR`。surface 由 `Origin` 決定（02 BD-13）；「需要的 action」是現行授權邏輯，細節見 [kernel-identity](../../specs/kernel-identity.md)。

| # | 方法與路徑 | operationId | 認證；surface | 需要的 action | 參數 | request schema | 成功回應 schema | 已記載的錯誤狀態 | 本操作特有的錯誤代碼 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `GET /actuator/health` | `getHealth` | 公開；任何 | — | — | — | 200 Health（application/vnd.spring-boot.actuator.v3+json）、Health | 503 | 見共通錯誤 |
| 2 | `GET /openapi.yaml` | `getOpenApi` | 公開；任何 | — | — | — | 200 `string`（text/yaml） | 500 | 見共通錯誤 |
| 3 | `POST /api/v1/auth/login` | `login` | 公開；任何（Origin 決定 session 的 surface） | — | — | LoginRequest | 200 LoginResponse | 400, 401, 403, 415, 500 | 400 VALIDATION_FAILED；401 INVALID_CREDENTIALS；403 ACCOUNT_DISABLED；403 ACCOUNT_LOCKED；403 CSRF_FAILED |
| 4 | `POST /api/v1/auth/logout` | `logout` | 需登入；任何 | 已登入 | — | — | 204 | 401, 403, 500 | 見共通錯誤 |
| 5 | `GET /api/v1/auth/me` | `me` | 需登入；任何 | 已登入 | — | — | 200 Me | 401, 500 | 見共通錯誤 |
| 6 | `GET /api/v1/auth/csrf` | `csrf` | 公開；任何 | — | — | — | 200 CsrfToken | 500 | 見共通錯誤 |
| 7 | `POST /api/v1/auth/password/change` | `changePassword` | 需登入；任何 | 已登入 | — | PasswordChangeRequest | 204 | 400, 401, 403, 415, 500 | 400 VALIDATION_FAILED；401 INVALID_CREDENTIALS |
| 8 | `GET /api/v1/principals` | `listPrincipals` | 需登入；Admin | manage_principals | — | — | 200 PrincipalList | 401, 403, 500 | 403 SURFACE_FORBIDDEN；403 FORBIDDEN |
| 9 | `POST /api/v1/principals` | `createPrincipal` | 需登入；Admin | manage_principals | — | CreatePrincipalRequest | 201 CreatedPrincipal | 400, 401, 403, 415, 500 | 400 VALIDATION_FAILED；403 SURFACE_FORBIDDEN, FORBIDDEN |
| 10 | `GET /api/v1/principals/{id}` | `getPrincipal` | 需登入；Admin | manage_principals | path:`id` | — | 200 Principal | 400, 401, 403, 500 | 400 VALIDATION_FAILED；403 SURFACE_FORBIDDEN, FORBIDDEN |
| 11 | `PATCH /api/v1/principals/{id}` | `patchPrincipal` | 需登入；Admin | manage_principals | path:`id` | PatchPrincipalRequest | 200 Principal | 400, 401, 403, 415, 500 | 400 VALIDATION_FAILED；403 LAST_ADMIN；403 SURFACE_FORBIDDEN, FORBIDDEN |
| 12 | `POST /api/v1/principals/{id}/disable` | `disablePrincipal` | 需登入；Admin | manage_principals | path:`id` | — | 200 Principal | 400, 401, 403, 500 | 400 VALIDATION_FAILED；403 LAST_ADMIN；403 SURFACE_FORBIDDEN, FORBIDDEN |
| 13 | `POST /api/v1/principals/{id}/unlock` | `unlockPrincipal` | 需登入；Admin | manage_principals | path:`id` | — | 200 Principal | 400, 401, 403, 500 | 400 VALIDATION_FAILED；403 ACCOUNT_DISABLED；403 SURFACE_FORBIDDEN, FORBIDDEN |
| 14 | `PUT /api/v1/principals/{id}/roles` | `replacePrincipalRoles` | 需登入；Admin | manage_principals | path:`id` | `array` 陣列：RoleAssignmentInput | 204 | 400, 401, 403, 415, 500 | 400 VALIDATION_FAILED；403 LAST_ADMIN；403 SURFACE_FORBIDDEN, FORBIDDEN |
| 15 | `POST /api/v1/principals/{id}/password` | `setPrincipalPassword` | 需登入；Admin | manage_principals | path:`id` | TemporaryPasswordRequest | 200 TemporaryPassword | 400, 401, 403, 415, 500 | 400 VALIDATION_FAILED；403 SURFACE_FORBIDDEN, FORBIDDEN |
| 16 | `GET /api/v1/principals/{id}/effective-permissions` | `effectivePermissions` | 需登入；Admin | manage_principals | path:`id` | — | 200 EffectivePermissionList | 400, 401, 403, 500 | 403 SURFACE_FORBIDDEN, FORBIDDEN |
| 17 | `GET /api/v1/roles` | `listRoles` | 需登入；Admin | manage_principals | — | — | 200 RoleList | 401, 403, 500 | 403 SURFACE_FORBIDDEN, FORBIDDEN |
| 18 | `GET /api/v1/roles/{code}/permissions` | `getRolePermissions` | 需登入；Admin | manage_principals | path:`code` | — | 200 PermissionList | 400, 401, 403, 500 | 400 VALIDATION_FAILED；403 SURFACE_FORBIDDEN, FORBIDDEN |
| 19 | `PUT /api/v1/roles/{code}/permissions` | `replaceRolePermissions` | 需登入；Admin | manage_principals | path:`code` | `array` 陣列：PermissionInput | 204 | 400, 401, 403, 415, 500 | 400 VALIDATION_FAILED；403 LAST_ADMIN；403 SURFACE_FORBIDDEN, FORBIDDEN |
| 20 | `GET /api/v1/public/content-types` | `listPublicContentTypes` | 公開；任何 | read_published（逐類型過濾，不報錯） | — | — | 200 PublicContentTypeList | 500 | 見共通錯誤 |
| 21 | `GET /api/v1/public/content-types/{typeKey}/entries` | `listPublicEntries` | 公開；任何（以 Front 判定） | read_published | path:`typeKey`, query:`q`, query:`ref.<fieldKey>` | — | 200 PublicEntryPage | 400, 403, 404, 500 | 400 AUDIENCE_PARAM_REJECTED；400 VALIDATION_FAILED；403 FORBIDDEN；404 ENTRY_NOT_FOUND |
| 22 | `GET /api/v1/public/content-types/{typeKey}/entries/{id}` | `getPublicEntry` | 公開；任何（以 Front 判定） | read_published | path:`typeKey`, path:`id` | — | 200 PublicEntry | 400, 403, 404, 500 | 400 AUDIENCE_PARAM_REJECTED；403 FORBIDDEN；404 ENTRY_NOT_FOUND |
| 23 | `GET /api/v1/public/content-types/{typeKey}/slugs/{slug}` | `getPublicEntryBySlug` | 公開；任何（以 Front 判定） | read_published | path:`typeKey`, path:`slug` | — | 200 PublicEntry | 400, 403, 404, 500 | 400 AUDIENCE_PARAM_REJECTED, 403 FORBIDDEN, 404 ENTRY_NOT_FOUND |
| 24 | `GET /api/v1/public/navigation/{menuKey}` | `getPublicNavigation` | 公開；任何 | — | path:`menuKey` | — | 200 NavigationDocument | 404, 500 | 404 NAVIGATION_NOT_FOUND |
| 25 | `GET /api/v1/content-types` | `listWorkContentTypes` | 需登入；Back、Admin | 已登入 | — | — | 200 WorkContentTypeList | 401, 403, 500 | 403 SURFACE_FORBIDDEN |
| 26 | `GET /api/v1/content-types/{typeKey}` | `getWorkContentType` | 需登入；Back、Admin | 已登入 | path:`typeKey` | — | 200 WorkContentType | 401, 403, 404, 500 | 403 SURFACE_FORBIDDEN；404 CONTENT_TYPE_NOT_FOUND |
| 27 | `GET /api/v1/content-types/{typeKey}/entries` | `listWorkEntries` | 需登入；Back、Admin | read_draft（`state=published` 時 read_published） | path:`typeKey`, query:`q`, query:`state`, query:`ref.<fieldKey>` | — | 200 WorkEntryPage | 400, 401, 403, 404, 500 | 400 VALIDATION_FAILED；403 SURFACE_FORBIDDEN；403 FORBIDDEN；404 CONTENT_TYPE_NOT_FOUND |
| 28 | `POST /api/v1/content-types/{typeKey}/entries` | `createEntry` | 需登入；Back、Admin | create | path:`typeKey` | EntryWriteRequest | 201 WorkEntry | 400, 401, 403, 404, 409, 415, 422, 500 | 403 SURFACE_FORBIDDEN；403 FORBIDDEN；404 CONTENT_TYPE_NOT_FOUND；409 TYPE_DISABLED；409 SINGLETON_EXISTS；409 SLUG_CONFLICT；422 FIELD_VALIDATION；422 REF_TARGET_NOT_FOUND, REF_TARGET_WRONG_TYPE, PRINCIPAL_REF_UNRESOLVED |
| 29 | `GET /api/v1/entries/{id}` | `getWorkEntry` | 需登入；Back、Admin | read_draft；已發布者 read_draft 或 read_published | path:`id` | — | 200 WorkEntry | 400, 401, 403, 404, 500 | 403 SURFACE_FORBIDDEN；403 FORBIDDEN；404 ENTRY_NOT_FOUND |
| 30 | `PATCH /api/v1/entries/{id}` | `patchEntry` | 需登入；Back、Admin | update | path:`id` | EntryWriteRequest | 200 WorkEntry | 400, 401, 403, 404, 409, 415, 422, 500 | 403 SURFACE_FORBIDDEN, FORBIDDEN；404 ENTRY_NOT_FOUND；409 INVALID_STATE_TRANSITION；409 VERSION_CONFLICT；409 SLUG_CONFLICT |
| 31 | `DELETE /api/v1/entries/{id}` | `softDeleteEntry` | 需登入；Back、Admin | delete | path:`id` | — | 204 | 400, 401, 403, 404, 409, 500 | 403 SURFACE_FORBIDDEN, FORBIDDEN；404 ENTRY_NOT_FOUND；409 REF_CONSTRAINT |
| 32 | `POST /api/v1/entries/{id}/publish` | `publishEntry` | 需登入；Back、Admin | publish | path:`id` | — | 200 WorkEntry | 400, 401, 403, 404, 409, 422, 500 | 403 SURFACE_FORBIDDEN, FORBIDDEN；404 ENTRY_NOT_FOUND；409 INVALID_STATE_TRANSITION；409 TYPE_DISABLED；422 SLUG_REQUIRED；422 FIELD_VALIDATION；422 REF_TARGET_NOT_FOUND, REF_TARGET_WRONG_TYPE, PRINCIPAL_REF_UNRESOLVED |
| 33 | `POST /api/v1/entries/{id}/unpublish` | `unpublishEntry` | 需登入；Back、Admin | unpublish | path:`id` | — | 200 WorkEntry | 400, 401, 403, 404, 409, 500 | 403 SURFACE_FORBIDDEN, FORBIDDEN；404 ENTRY_NOT_FOUND；409 INVALID_STATE_TRANSITION |
| 34 | `POST /api/v1/entries/{id}/archive` | `archiveEntry` | 需登入；Back、Admin | archive | path:`id` | — | 200 WorkEntry | 400, 401, 403, 404, 409, 500 | 403 SURFACE_FORBIDDEN, FORBIDDEN；404 ENTRY_NOT_FOUND；409 INVALID_STATE_TRANSITION |
| 35 | `POST /api/v1/entries/{id}/restore` | `restoreEntry` | 需登入；Back、Admin | archive | path:`id` | — | 200 WorkEntry | 400, 401, 403, 404, 409, 500 | 403 SURFACE_FORBIDDEN, FORBIDDEN；404 ENTRY_NOT_FOUND；409 INVALID_STATE_TRANSITION |
| 36 | `GET /api/v1/entries/{id}/revisions` | `listRevisions` | 需登入；Back、Admin | read_draft | path:`id` | — | 200 RevisionList | 400, 401, 403, 404, 500 | 403 SURFACE_FORBIDDEN, FORBIDDEN；404 ENTRY_NOT_FOUND |
| 37 | `POST /api/v1/entries/{id}/revisions/{revisionNo}/revert` | `revertRevision` | 需登入；Back、Admin | update | path:`id`, path:`revisionNo` | — | 200 WorkEntry | 400, 401, 403, 404, 500 | 403 SURFACE_FORBIDDEN, FORBIDDEN；404 ENTRY_NOT_FOUND |
| 38 | `GET /api/v1/preview/entries/{id}` | `previewEntry` | 需登入；Back、Admin | 同 getWorkEntry | path:`id` | — | 200 WorkEntry | 400, 401, 403, 404, 500 | 見共通錯誤 |
| 39 | `GET /api/v1/admin/content-types` | `adminListContentTypes` | 需登入；Admin | manage_types | — | — | 200 AdminContentTypeList | 401, 403, 500 | 403 SURFACE_FORBIDDEN；403 FORBIDDEN |
| 40 | `POST /api/v1/admin/content-types` | `adminCreateContentType` | 需登入；Admin | manage_types | — | CreateContentTypeRequest | 201 AdminContentType | 400, 401, 403, 415, 422, 500 | 403 SURFACE_FORBIDDEN, FORBIDDEN；422 FIELD_VALIDATION |
| 41 | `POST /api/v1/admin/content-types/{typeKey}/disable` | `disableContentType` | 需登入；Admin | manage_types | path:`typeKey` | — | 200 AdminContentType | 401, 403, 404, 500 | 403 SURFACE_FORBIDDEN, FORBIDDEN；404 CONTENT_TYPE_NOT_FOUND |
| 42 | `POST /api/v1/admin/content-types/{typeKey}/enable` | `enableContentType` | 需登入；Admin | manage_types | path:`typeKey` | — | 200 AdminContentType | 401, 403, 404, 500 | 403 SURFACE_FORBIDDEN, FORBIDDEN；404 CONTENT_TYPE_NOT_FOUND |
| 43 | `GET /api/v1/admin/navigation/{menuKey}` | `adminGetNavigation` | 需登入；Admin | manage_settings | path:`menuKey` | — | 200 Navigation | 401, 403, 404, 500 | 403 SURFACE_FORBIDDEN；403 FORBIDDEN；404 NAVIGATION_NOT_FOUND |
| 44 | `PATCH /api/v1/admin/navigation/{menuKey}` | `adminPatchNavigation` | 需登入；Admin | manage_settings | path:`menuKey` | NavigationPatchRequest | 200 Navigation | 400, 401, 403, 404, 415, 500 | 見共通錯誤 |
| 45 | `POST /api/v1/admin/navigation/{menuKey}/publish` | `adminPublishNavigation` | 需登入；Admin | manage_settings | path:`menuKey` | — | 200 Navigation | 401, 403, 404, 500 | 見共通錯誤 |
| 46 | `POST /api/v1/admin/entries/{id}/purge` | `purgeEntry` | 需登入；Admin | admin 角色 | path:`id` | — | 204 | 400, 401, 403, 404, 409, 500 | 403 SURFACE_FORBIDDEN；403 FORBIDDEN；404 ENTRY_NOT_FOUND；409 REF_CONSTRAINT |
| 47 | `GET /api/v1/admin/audit` | `listAudit` | 需登入；Admin | read_audit | query:`action`, query:`targetId` | — | 200 AuditEventList | 400, 401, 403, 500 | 403 SURFACE_FORBIDDEN；403 FORBIDDEN |
| 48 | `GET /api/v1/media` | `listMedia` | 需登入；Back、Admin | manage_media | — | — | 200 MediaAssetList | 401, 403, 500 | 403 SURFACE_FORBIDDEN；403 FORBIDDEN |
| 49 | `POST /api/v1/media` | `uploadMedia` | 需登入；Back、Admin | manage_media | — | MediaUploadRequest（multipart/form-data） | 201 MediaAsset | 400, 401, 403, 409, 413, 415, 500 | 400 VALIDATION_FAILED；403 SURFACE_FORBIDDEN, FORBIDDEN；409 quota_exceeded；413 file_too_large；415 unsupported_media_type |
| 50 | `GET /api/v1/media/quota` | `mediaQuota` | 需登入；Back、Admin | manage_media | — | — | 200 MediaQuota | 401, 403, 500 | 403 SURFACE_FORBIDDEN, FORBIDDEN |
| 51 | `GET /api/v1/media/{id}` | `getMedia` | 需登入；Back、Admin | manage_media | path:`id` | — | 200 MediaAsset | 400, 401, 403, 404, 500 | 403 SURFACE_FORBIDDEN, FORBIDDEN；404 not_found |
| 52 | `DELETE /api/v1/media/{id}` | `softDeleteMedia` | 需登入；Back、Admin | manage_media | path:`id` | — | 204 | 400, 401, 403, 404, 500 | 403 SURFACE_FORBIDDEN, FORBIDDEN；404 not_found |
| 53 | `GET /api/v1/media/{id}/file/{variant}` | `privateMediaFile` | 需登入；Back、Admin | manage_media，或附著 entry 的 read_draft | path:`id`, path:`variant` | — | 200 `string binary`（image/jpeg）、`string binary`（image/png）、`string binary`（application/pdf）、`string binary`（application/octet-stream） | 400, 401, 403, 404, 410, 500 | 403 SURFACE_FORBIDDEN；403 FORBIDDEN；404 not_found；404 variant_not_available；410 gone |
| 54 | `GET /api/v1/public/media/{id}` | `publicMediaMeta` | 公開；任何 | —（媒體須附著於已發布的公開欄位） | path:`id` | — | 200 MediaAsset | 400, 404, 500 | 404 not_found |
| 55 | `GET /api/v1/public/media/{id}/file/{variant}` | `publicMediaFile` | 公開；任何 | 同 publicMediaMeta | path:`id`, path:`variant` | — | 200 `string binary`（image/jpeg）、`string binary`（image/png）、`string binary`（application/pdf）、`string binary`（application/octet-stream） | 400, 404, 500 | 404 not_found |

### 4.3 與舊 `openapi.yaml` 的差異（契約改成符合程式，程式不變）

| operation | 舊文件 | 實際行為（新契約） | 證據 |
| --- | --- | --- | --- |
| `replacePrincipalRoles` | 200 | 204 | `PrincipalController.java:85` `@ResponseStatus(NO_CONTENT)` |
| `replaceRolePermissions` | 200 | 204 | `PrincipalController.java:126` |
| `setPrincipalPassword` | 204 | 200，body `{ temporaryPassword }` | `PrincipalController.java:96-102` |
| `getPrincipal` | 404 | 400 `VALIDATION_FAILED`（message `not found`） | `PrincipalAdminService.java:58`；見 BQ-06 |
| `uploadMedia` | 422 | 409 `quota_exceeded`、413 `file_too_large`、415 `unsupported_media_type` | `MediaException.java:24-46` |
| `listPublicEntries` 等公開讀取 | 未寫 | 類型不存在或停用回 404 `ENTRY_NOT_FOUND`（不是 `CONTENT_TYPE_NOT_FOUND`） | `PublicContentController.java:76`、`EntryService.java:363,390` |
| 所有 operation | 回應沒有 schema | 有 schema | — |

### 4.4 範例

成功（`GET /api/v1/entries/{id}`，`200 WorkEntry`）：

```json
{
  "id": "6f1c2f2e-3a52-4c55-9d0e-1f4f0a3b9c11",
  "contentType": "album",
  "slug": "coast-light",
  "publicationState": "published",
  "version": 3,
  "title": "Coast Light",
  "payload": { "title": "Coast Light", "visibility": "public", "cover": null },
  "dirty": false,
  "publishedAt": "2026-09-25T01:02:03.456789Z",
  "updatedAt": "2026-09-25T01:02:03.456789Z"
}
```

失敗（controller 層，`GET /api/v1/public/content-types/album/entries/{不存在的 id}`，`404`）：

```json
{ "error": { "code": "ENTRY_NOT_FOUND", "message": "Entry not found" }, "requestId": "bw0-request-id-2" }
```

失敗（service 層權限，`POST /api/v1/entries/{id}/publish` 由 `seed-editor-album`，`403`）：

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "Missing permission publish on content type album",
    "action": "publish",
    "contentType": "album",
    "surface": "back"
  },
  "requestId": "6e0d6a4e-2d0b-4c8e-9a53-0f4b1f0b7c55"
}
```

失敗（框架層，`PATCH /api/v1/entries/{id}` 的 body 是 `{`，`400`）：

```json
{ "error": { "code": "VALIDATION_FAILED", "message": "Invalid request" }, "requestId": "…" }
```

`requestId`：請求帶 `X-Request-Id` 時原樣回傳，否則是伺服器產生的 UUID；回應標頭 `X-Request-Id` 同值（`IdentityRequestFilter.java:49-64`，不變）。

### 4.5 `ErrorCode` 全清單

盤點範圍：`ContentException`、`IdentityException`、`MediaException` 的所有工廠方法與 `new` 呼叫（`grep -rn "ContentException\.\|new ContentException\|MediaException\.\|IdentityException\." src/main`），加上本波新增的框架層代碼。`TYPE_IN_USE` 目前沒有任何呼叫點，但工廠方法存在，保留。

| Java 常數 | wire 值 | HTTP | 丟出位置 | 何時 |
| --- | --- | --- | --- | --- |
| `UNAUTHENTICATED` | `UNAUTHENTICATED` | 401 | `IdentitySecurityConfig`（entry point）、`AuthService`、`MediaService.canReadPrivate` | 沒有 session |
| `INVALID_CREDENTIALS` | `INVALID_CREDENTIALS` | 401 | `AuthService.login`、`changePassword` | 帳號不存在或密碼錯 |
| `SESSION_EXPIRED` | `SESSION_EXPIRED` | 401 | entry point、`AuthService.me`、`touch` | session 過期或被撤銷 |
| `ACCOUNT_DISABLED` | `ACCOUNT_DISABLED` | 403 | `AuthService.login`、`PrincipalAdminService.unlock` | 帳號停用 |
| `ACCOUNT_LOCKED` | `ACCOUNT_LOCKED` | 403 | `AuthService.login` | 連續登入失敗被鎖 |
| `CSRF_FAILED` | `CSRF_FAILED` | 403 | `CookieCsrfFilter`、`AuthService.login` | CSRF header 不符，或登入的 Origin 不在允許清單 |
| `FORBIDDEN` | `FORBIDDEN` | 403 | `AuthorizationService.require`、`EntryService`、`MediaService`、access denied handler | 缺權限 |
| `SURFACE_FORBIDDEN` | `SURFACE_FORBIDDEN` | 403 | `AuthorizationService.require`、各 controller 的 surface 檢查 | 在不允許的 surface 呼叫 |
| `VALIDATION_FAILED` | `VALIDATION_FAILED` | 400 | `IdentityException.validation`、`ContentException.invalidParameter`、`ApiExceptionHandler.badRequest` | 請求本身不合法 |
| `LAST_ADMIN` | `LAST_ADMIN` | 403 | `*KeepingUsableAdmin` | 會讓系統沒有可用的 admin |
| `ENTRY_NOT_FOUND` | `ENTRY_NOT_FOUND` | 404 | `ContentException.notFound` | entry（或公開讀取的類型）不存在 |
| `CONTENT_TYPE_NOT_FOUND` | `CONTENT_TYPE_NOT_FOUND` | 404 | `ContentException.typeNotFound` | 工作面與 admin 找不到類型 |
| `NAVIGATION_NOT_FOUND` | `NAVIGATION_NOT_FOUND` | 404 | `ContentException.navNotFound` | 導覽不存在或未發布 |
| `AUDIENCE_PARAM_REJECTED` | `AUDIENCE_PARAM_REJECTED` | 400 | `PublicContentController.rejectAudienceParams` | 公開 API 帶了 `state`／`includeDraft`／`asOf` |
| `INVALID_STATE_TRANSITION` | `INVALID_STATE_TRANSITION` | 409 | `ContentException.invalidTransition` | 狀態機不允許 |
| `SLUG_CONFLICT` | `SLUG_CONFLICT` | 409 | `ContentException.slugConflict` | 同類型 slug 重複 |
| `VERSION_CONFLICT` | `VERSION_CONFLICT` | 409 | `ContentException.versionConflict` | PATCH 的 `version` 不符 |
| `TYPE_DISABLED` | `TYPE_DISABLED` | 409 | `ContentException.typeDisabled` | 類型已停用 |
| `TYPE_IN_USE` | `TYPE_IN_USE` | 409 | `ContentException.typeInUse`（目前無呼叫點） | 保留 |
| `REF_CONSTRAINT` | `REF_CONSTRAINT` | 409 | `ContentException.refConstraint` | 仍被其他 entry 引用 |
| `SINGLETON_EXISTS` | `SINGLETON_EXISTS` | 409 | `ContentException.singletonExists`（本波新增的工廠方法） | singleton 類型已有 entry |
| `SLUG_REQUIRED` | `SLUG_REQUIRED` | 422 | `EntryService.publish` | slug policy 為 required 而 slug 空白 |
| `FIELD_VALIDATION` | `FIELD_VALIDATION` | 422 | `EntryService.validatePayload`、`AdminContentController.createType` | 欄位值不合法；類型 key 不合法或重複 |
| `REF_TARGET_NOT_FOUND` | `REF_TARGET_NOT_FOUND` | 422 | `EntryService.validatePayload` | ref 指向不存在的 entry |
| `REF_TARGET_WRONG_TYPE` | `REF_TARGET_WRONG_TYPE` | 422 | 同上 | ref 指向錯的類型 |
| `PRINCIPAL_REF_UNRESOLVED` | `PRINCIPAL_REF_UNRESOLVED` | 422 | 同上 | principal-ref 不存在 |
| `MEDIA_NOT_FOUND` | `not_found` | 404 | `MediaException.notFound` | 媒體不存在或不可公開讀 |
| `MEDIA_VARIANT_NOT_AVAILABLE` | `variant_not_available` | 404 | `MediaException.variantNotAvailable` | 變體名稱不對或未產生 |
| `MEDIA_UNSUPPORTED_TYPE` | `unsupported_media_type` | 415 | `MediaException.unsupportedType` | 空檔或不允許的格式 |
| `MEDIA_QUOTA_EXCEEDED` | `quota_exceeded` | 409 | `MediaException.quota` | 超過配額 |
| `MEDIA_FILE_TOO_LARGE` | `file_too_large` | 413 | `MediaException.tooLarge`、`ApiExceptionHandler.tooLarge` | 檔案過大（含超過 `spring.servlet.multipart.max-file-size`） |
| `MEDIA_GONE` | `gone` | 410 | `MediaException.gone` | 媒體已軟刪 |
| `ROUTE_NOT_FOUND` | `ROUTE_NOT_FOUND` | 404 | `ApiExceptionHandler.noRoute`（新） | 沒有這個路由 |
| `METHOD_NOT_ALLOWED` | `METHOD_NOT_ALLOWED` | 405 | `ApiExceptionHandler.methodNotAllowed`（新） | 路由存在但 method 不支援 |
| `MEDIA_TYPE_NOT_SUPPORTED` | `MEDIA_TYPE_NOT_SUPPORTED` | 415 | `ApiExceptionHandler.mediaType`（新） | JSON 端點收到其他 Content-Type |
| `INTERNAL_ERROR` | `INTERNAL_ERROR` | 500 | `ApiExceptionHandler.unexpected`（新） | 其他所有未預期例外；message 固定 `Internal error`，不含例外內容 |

一個代碼只對應一個 HTTP 狀態（`ErrorCode.status()`）。以後新增代碼：同時改 `ErrorCode.java` 與 `openapi.yaml` 的 `ErrorCode` enum，否則 `ErrorCodeContractTests` 失敗。

### 4.6 資料表

本波次沒有 DDL、沒有 migration、沒有回填。store 契約測試依賴下列既有約束，實作時不得移除：

| 約束 | 位置 | 被哪個契約案例使用 | 正例 | 反例 |
| --- | --- | --- | --- | --- |
| `cms_content_type_key_uq UNIQUE (type_key)` | V3 | `B08_duplicateTypeKeyIsRejected` | 插入 `album`、`page` | 第二次插入 `album` → 例外 |
| `cms_principal_username_ci UNIQUE (LOWER(username))` | V2 | `B08_duplicateUsernameIsRejected` | 插入 `anna`、`bert` | 第二次插入 `anna` → 例外 |
| `cms_entry_ref.from_entry_id … ON DELETE CASCADE` | V3 | `B08_hardDeleteRemovesEntryRevisionsAndOutgoingRefs` | — | — |
| `cms_media_status_chk CHECK (status IN ('available','deleted'))` | V4 | `MediaStoreContract` 的 fixture 只用這兩個值 | `available` | 其他字串 → 例外 |

### 4.7 型別

- **Java**：`ErrorCode`（enum）、`CmsApiException`（abstract class）全文在 §5.1。沒有新的 record。
- **TypeScript**：本波次不寫。W0 以 `openapi-typescript` 從 `openapi.yaml` 產生；型別名稱就是 `components.schemas` 的鍵（`WorkEntry`、`PublicEntry`、`ErrorEnvelope`、`ErrorCode`…）。

---

## 5. 模組規格

本波次沒有前端、沒有畫面、沒有文案：API 的 `error.message` 是給開發者看的英文，不是 copy key，前端不得直接顯示（01 §5.1-4）。以下全部是後端。transaction 邊界：本波次沒有新增或改變任何 transaction（`JdbcIdentityStore` 的 `tx.execute` 範圍不變）。

### 5.1 `com.fallrising.cms.api.error`（新套件）

**`ErrorCode`**：每個常數有 `wire()`（對外字串）與 `status()`（HTTP 狀態）。媒體代碼的 wire 值維持小寫（BQ-07）。

`src/main/java/com/fallrising/cms/api/error/ErrorCode.java`：

```java
package com.fallrising.cms.api.error;

import org.springframework.http.HttpStatus;

/**
 * Every error.code the API returns. The wire value is what clients see; it must match
 * components.schemas.ErrorCode in openapi.yaml (checked by ErrorCodeContractTests).
 */
public enum ErrorCode {
    UNAUTHENTICATED("UNAUTHENTICATED", HttpStatus.UNAUTHORIZED),
    INVALID_CREDENTIALS("INVALID_CREDENTIALS", HttpStatus.UNAUTHORIZED),
    SESSION_EXPIRED("SESSION_EXPIRED", HttpStatus.UNAUTHORIZED),
    ACCOUNT_DISABLED("ACCOUNT_DISABLED", HttpStatus.FORBIDDEN),
    ACCOUNT_LOCKED("ACCOUNT_LOCKED", HttpStatus.FORBIDDEN),
    CSRF_FAILED("CSRF_FAILED", HttpStatus.FORBIDDEN),
    FORBIDDEN("FORBIDDEN", HttpStatus.FORBIDDEN),
    SURFACE_FORBIDDEN("SURFACE_FORBIDDEN", HttpStatus.FORBIDDEN),
    VALIDATION_FAILED("VALIDATION_FAILED", HttpStatus.BAD_REQUEST),
    LAST_ADMIN("LAST_ADMIN", HttpStatus.FORBIDDEN),
    ENTRY_NOT_FOUND("ENTRY_NOT_FOUND", HttpStatus.NOT_FOUND),
    CONTENT_TYPE_NOT_FOUND("CONTENT_TYPE_NOT_FOUND", HttpStatus.NOT_FOUND),
    NAVIGATION_NOT_FOUND("NAVIGATION_NOT_FOUND", HttpStatus.NOT_FOUND),
    AUDIENCE_PARAM_REJECTED("AUDIENCE_PARAM_REJECTED", HttpStatus.BAD_REQUEST),
    INVALID_STATE_TRANSITION("INVALID_STATE_TRANSITION", HttpStatus.CONFLICT),
    SLUG_CONFLICT("SLUG_CONFLICT", HttpStatus.CONFLICT),
    VERSION_CONFLICT("VERSION_CONFLICT", HttpStatus.CONFLICT),
    TYPE_DISABLED("TYPE_DISABLED", HttpStatus.CONFLICT),
    TYPE_IN_USE("TYPE_IN_USE", HttpStatus.CONFLICT),
    REF_CONSTRAINT("REF_CONSTRAINT", HttpStatus.CONFLICT),
    SINGLETON_EXISTS("SINGLETON_EXISTS", HttpStatus.CONFLICT),
    SLUG_REQUIRED("SLUG_REQUIRED", HttpStatus.UNPROCESSABLE_ENTITY),
    FIELD_VALIDATION("FIELD_VALIDATION", HttpStatus.UNPROCESSABLE_ENTITY),
    REF_TARGET_NOT_FOUND("REF_TARGET_NOT_FOUND", HttpStatus.UNPROCESSABLE_ENTITY),
    REF_TARGET_WRONG_TYPE("REF_TARGET_WRONG_TYPE", HttpStatus.UNPROCESSABLE_ENTITY),
    PRINCIPAL_REF_UNRESOLVED("PRINCIPAL_REF_UNRESOLVED", HttpStatus.UNPROCESSABLE_ENTITY),
    MEDIA_NOT_FOUND("not_found", HttpStatus.NOT_FOUND),
    MEDIA_VARIANT_NOT_AVAILABLE("variant_not_available", HttpStatus.NOT_FOUND),
    MEDIA_UNSUPPORTED_TYPE("unsupported_media_type", HttpStatus.UNSUPPORTED_MEDIA_TYPE),
    MEDIA_QUOTA_EXCEEDED("quota_exceeded", HttpStatus.CONFLICT),
    MEDIA_FILE_TOO_LARGE("file_too_large", HttpStatus.PAYLOAD_TOO_LARGE),
    MEDIA_GONE("gone", HttpStatus.GONE),
    ROUTE_NOT_FOUND("ROUTE_NOT_FOUND", HttpStatus.NOT_FOUND),
    METHOD_NOT_ALLOWED("METHOD_NOT_ALLOWED", HttpStatus.METHOD_NOT_ALLOWED),
    MEDIA_TYPE_NOT_SUPPORTED("MEDIA_TYPE_NOT_SUPPORTED", HttpStatus.UNSUPPORTED_MEDIA_TYPE),
    INTERNAL_ERROR("INTERNAL_ERROR", HttpStatus.INTERNAL_SERVER_ERROR);

    private final String wire;
    private final HttpStatus status;

    ErrorCode(String wire, HttpStatus status) {
        this.wire = wire;
        this.status = status;
    }

    public String wire() {
        return wire;
    }

    public HttpStatus status() {
        return status;
    }
}
```

**`CmsApiException`**：`ContentException`、`MediaException`、`IdentityException` 的共同父類別。`status()` 一律由 `code.status()` 決定，不能另外指定。`action`、`contentType`、`surface` 可以是 null，null 時不輸出該鍵。

`src/main/java/com/fallrising/cms/api/error/CmsApiException.java`：

```java
package com.fallrising.cms.api.error;

import org.springframework.http.HttpStatus;

/** Base class of every exception that is rendered as an ErrorEnvelope with a known ErrorCode. */
public abstract class CmsApiException extends RuntimeException {

    private final ErrorCode code;
    private final String action;
    private final String contentType;
    private final String surface;

    protected CmsApiException(ErrorCode code, String message, String action, String contentType, String surface) {
        super(message);
        this.code = code;
        this.action = action;
        this.contentType = contentType;
        this.surface = surface;
    }

    public ErrorCode code() {
        return code;
    }

    public HttpStatus status() {
        return code.status();
    }

    public String action() {
        return action;
    }

    public String contentType() {
        return contentType;
    }

    public String surface() {
        return surface;
    }
}
```

**`ErrorBody`**：唯一產生錯誤 JSON 的地方。controller 層（`ApiExceptionHandler`）與 filter 層（`IdentityErrorWriter`）都呼叫它，所以兩層的形狀一定相同。

`src/main/java/com/fallrising/cms/api/error/ErrorBody.java`：

```java
package com.fallrising.cms.api.error;

import java.util.LinkedHashMap;
import java.util.Map;

/** Builds the ErrorEnvelope JSON body: { "error": { code, message, action?, contentType?, surface? }, "requestId" }. */
public final class ErrorBody {

    private ErrorBody() {}

    public static Map<String, Object> of(ErrorCode code, String message, String action, String contentType,
            String surface, String requestId) {
        Map<String, Object> error = new LinkedHashMap<>();
        error.put("code", code.wire());
        error.put("message", message == null ? "" : message);
        if (action != null) {
            error.put("action", action);
        }
        if (contentType != null) {
            error.put("contentType", contentType);
        }
        if (surface != null) {
            error.put("surface", surface);
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("error", error);
        body.put("requestId", requestId == null ? "" : requestId);
        return body;
    }

    public static Map<String, Object> of(CmsApiException ex, String requestId) {
        return of(ex.code(), ex.getMessage(), ex.action(), ex.contentType(), ex.surface(), requestId);
    }
}
```

**`ApiExceptionHandler`**：唯一的 `@RestControllerAdvice`。對應規則：

| 例外 | ErrorCode | message |
| --- | --- | --- |
| `CmsApiException`（含三個子類別） | 例外自帶 | 例外自帶 |
| `MethodArgumentNotValidException`、`HttpMessageNotReadableException`、`MethodArgumentTypeMismatchException`、`MissingServletRequestParameterException`、`MissingServletRequestPartException` | `VALIDATION_FAILED` | `Invalid request` |
| `MaxUploadSizeExceededException` | `MEDIA_FILE_TOO_LARGE` | `File exceeds max size` |
| `NoHandlerFoundException`、`NoResourceFoundException` | `ROUTE_NOT_FOUND` | `No such route` |
| `HttpRequestMethodNotSupportedException` | `METHOD_NOT_ALLOWED` | `Method not allowed` |
| `HttpMediaTypeNotSupportedException` | `MEDIA_TYPE_NOT_SUPPORTED` | `Content-Type not supported` |
| 其他所有 `Exception` | `INTERNAL_ERROR` | `Internal error`；以 `log.error` 記錄 method、URI 與例外 |

Spring 對同一個 advice 內的多個 `@ExceptionHandler` 選最接近的例外型別，所以 `Exception` 只接住沒被列出的例外。**不要**再新增第二個 `@RestControllerAdvice`：Spring 會依 advice 的順序找第一個能處理的 advice，而兩個 advice 的順序沒有定義，第二個 advice 的專用 handler 會被這裡的 `Exception` 搶走。

`src/main/java/com/fallrising/cms/api/error/ApiExceptionHandler.java`：

```java
package com.fallrising.cms.api.error;

import com.fallrising.cms.identity.web.IdentityErrorWriter;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.support.MissingServletRequestPartException;
import org.springframework.web.servlet.NoHandlerFoundException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import java.util.Map;

/** The only @RestControllerAdvice. Every error leaving a controller becomes an ErrorEnvelope (B-14). */
@RestControllerAdvice
public class ApiExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);

    @ExceptionHandler(CmsApiException.class)
    public ResponseEntity<Map<String, Object>> cms(CmsApiException ex, HttpServletRequest request) {
        return ResponseEntity.status(ex.status()).body(ErrorBody.of(ex, IdentityErrorWriter.requestId(request)));
    }

    @ExceptionHandler({
        MethodArgumentNotValidException.class,
        HttpMessageNotReadableException.class,
        MethodArgumentTypeMismatchException.class,
        MissingServletRequestParameterException.class,
        MissingServletRequestPartException.class
    })
    public ResponseEntity<Map<String, Object>> badRequest(Exception ex, HttpServletRequest request) {
        return respond(ErrorCode.VALIDATION_FAILED, "Invalid request", request);
    }

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    public ResponseEntity<Map<String, Object>> tooLarge(Exception ex, HttpServletRequest request) {
        return respond(ErrorCode.MEDIA_FILE_TOO_LARGE, "File exceeds max size", request);
    }

    @ExceptionHandler({NoHandlerFoundException.class, NoResourceFoundException.class})
    public ResponseEntity<Map<String, Object>> noRoute(Exception ex, HttpServletRequest request) {
        return respond(ErrorCode.ROUTE_NOT_FOUND, "No such route", request);
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    public ResponseEntity<Map<String, Object>> methodNotAllowed(Exception ex, HttpServletRequest request) {
        return respond(ErrorCode.METHOD_NOT_ALLOWED, "Method not allowed", request);
    }

    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
    public ResponseEntity<Map<String, Object>> mediaType(Exception ex, HttpServletRequest request) {
        return respond(ErrorCode.MEDIA_TYPE_NOT_SUPPORTED, "Content-Type not supported", request);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, Object>> unexpected(Exception ex, HttpServletRequest request) {
        log.error("Unhandled exception for {} {}", request.getMethod(), request.getRequestURI(), ex);
        return respond(ErrorCode.INTERNAL_ERROR, "Internal error", request);
    }

    private static ResponseEntity<Map<String, Object>> respond(ErrorCode code, String message, HttpServletRequest request) {
        return ResponseEntity.status(code.status())
                .body(ErrorBody.of(code, message, null, null, null, IdentityErrorWriter.requestId(request)));
    }
}
```

### 5.2 三種例外改繼承 `CmsApiException`

公開的工廠方法名稱與參數維持不變（`ContentException.validation` 例外：第一個參數從 `String` 改成 `ErrorCode`）。`IdentityException.code()` 的回傳型別從 `AuthErrorCode` 改成 `ErrorCode`；既有測試 `IdentityHardeningTests.java:59` 呼叫 `code().name()`，常數名稱沒變，所以不用改。

`content/ContentException.java`（整檔取代；新增 `invalidParameter`、`singletonExists` 兩個工廠方法）：

`src/main/java/com/fallrising/cms/content/ContentException.java`：

```java
package com.fallrising.cms.content;

import com.fallrising.cms.api.error.CmsApiException;
import com.fallrising.cms.api.error.ErrorCode;

public class ContentException extends CmsApiException {

    public ContentException(ErrorCode code, String message) {
        super(code, message, null, null, null);
    }

    public static ContentException notFound() {
        return new ContentException(ErrorCode.ENTRY_NOT_FOUND, "Entry not found");
    }

    public static ContentException typeNotFound() {
        return new ContentException(ErrorCode.CONTENT_TYPE_NOT_FOUND, "Content type not found");
    }

    public static ContentException navNotFound() {
        return new ContentException(ErrorCode.NAVIGATION_NOT_FOUND, "Navigation not found");
    }

    public static ContentException audienceParam() {
        return new ContentException(
                ErrorCode.AUDIENCE_PARAM_REJECTED, "Public API does not accept state or draft parameters");
    }

    public static ContentException invalidTransition() {
        return new ContentException(ErrorCode.INVALID_STATE_TRANSITION, "Invalid publication state transition");
    }

    public static ContentException slugConflict() {
        return new ContentException(ErrorCode.SLUG_CONFLICT, "Slug already used in this type");
    }

    public static ContentException versionConflict() {
        return new ContentException(ErrorCode.VERSION_CONFLICT, "Entry version does not match");
    }

    public static ContentException validation(ErrorCode code, String message) {
        return new ContentException(code, message);
    }

    public static ContentException invalidParameter(String message) {
        return new ContentException(ErrorCode.VALIDATION_FAILED, message);
    }

    public static ContentException typeDisabled() {
        return new ContentException(ErrorCode.TYPE_DISABLED, "Content type is disabled");
    }

    public static ContentException typeInUse() {
        return new ContentException(ErrorCode.TYPE_IN_USE, "Content type still has entries");
    }

    public static ContentException refConstraint() {
        return new ContentException(ErrorCode.REF_CONSTRAINT, "Entry is still referenced");
    }

    public static ContentException singletonExists() {
        return new ContentException(ErrorCode.SINGLETON_EXISTS, "Singleton already exists");
    }
}
```

`media/MediaException.java`（整檔取代）：

`src/main/java/com/fallrising/cms/media/MediaException.java`：

```java
package com.fallrising.cms.media;

import com.fallrising.cms.api.error.CmsApiException;
import com.fallrising.cms.api.error.ErrorCode;

public class MediaException extends CmsApiException {

    public MediaException(ErrorCode code, String message) {
        super(code, message, null, null, null);
    }

    public static MediaException notFound() {
        return new MediaException(ErrorCode.MEDIA_NOT_FOUND, "Media not found");
    }

    public static MediaException variantNotAvailable() {
        return new MediaException(ErrorCode.MEDIA_VARIANT_NOT_AVAILABLE, "Variant is not available");
    }

    public static MediaException unsupportedType() {
        return new MediaException(ErrorCode.MEDIA_UNSUPPORTED_TYPE, "File type is not allowed");
    }

    public static MediaException quota() {
        return new MediaException(ErrorCode.MEDIA_QUOTA_EXCEEDED, "Media library quota exceeded");
    }

    public static MediaException tooLarge() {
        return new MediaException(ErrorCode.MEDIA_FILE_TOO_LARGE, "File exceeds max size");
    }

    public static MediaException gone() {
        return new MediaException(ErrorCode.MEDIA_GONE, "Media has been deleted");
    }
}
```

`identity/IdentityException.java`（整檔取代）：

`src/main/java/com/fallrising/cms/identity/IdentityException.java`：

```java
package com.fallrising.cms.identity;

import com.fallrising.cms.api.error.CmsApiException;
import com.fallrising.cms.api.error.ErrorCode;

public class IdentityException extends CmsApiException {

    public IdentityException(ErrorCode code, String message, String action, String contentType, String surface) {
        super(code, message, action, contentType, surface);
    }

    public static IdentityException unauthenticated() {
        return new IdentityException(ErrorCode.UNAUTHENTICATED, "Authentication required", null, null, null);
    }

    public static IdentityException invalidCredentials() {
        return new IdentityException(ErrorCode.INVALID_CREDENTIALS,
                "Invalid username or password",
                null,
                null,
                null);
    }

    public static IdentityException sessionExpired() {
        return new IdentityException(ErrorCode.SESSION_EXPIRED, "Session expired or revoked", null, null, null);
    }

    public static IdentityException accountDisabled() {
        return new IdentityException(ErrorCode.ACCOUNT_DISABLED, "Account is disabled", null, null, null);
    }

    public static IdentityException accountLocked() {
        return new IdentityException(ErrorCode.ACCOUNT_LOCKED, "Account is locked", null, null, null);
    }

    public static IdentityException csrfFailed() {
        return new IdentityException(ErrorCode.CSRF_FAILED, "CSRF validation failed", null, null, null);
    }

    public static IdentityException forbidden(String action, String contentType, String surface) {
        return new IdentityException(ErrorCode.FORBIDDEN,
                "Missing permission " + action + (contentType == null ? "" : " on content type " + contentType),
                action,
                contentType,
                surface);
    }

    public static IdentityException surfaceForbidden(String action, String contentType, String surface) {
        return new IdentityException(ErrorCode.SURFACE_FORBIDDEN,
                "Action " + action + " is not allowed on surface " + surface,
                action,
                contentType,
                surface);
    }

    public static IdentityException lastAdmin() {
        return new IdentityException(ErrorCode.LAST_ADMIN,
                "Cannot disable the last active admin",
                "manage_principals",
                null,
                "admin");
    }

    public static IdentityException validation(String message) {
        return new IdentityException(ErrorCode.VALIDATION_FAILED, message, null, null, null);
    }
}
```

`identity/web/IdentityErrorWriter.java`（整檔取代；第二個 `write` 的簽名從 `(request, response, AuthErrorCode, int, String)` 改成 `(request, response, ErrorCode, String)`）：

`src/main/java/com/fallrising/cms/identity/web/IdentityErrorWriter.java`：

```java
package com.fallrising.cms.identity.web;

import com.fallrising.cms.api.error.ErrorBody;
import com.fallrising.cms.api.error.ErrorCode;
import com.fallrising.cms.identity.IdentityException;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.util.Map;

@Component
public class IdentityErrorWriter {

    public static final String ATTR = IdentityErrorWriter.class.getName() + ".request";

    private final ObjectMapper objectMapper;

    public IdentityErrorWriter(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public Map<String, Object> body(IdentityException ex, String requestId) {
        return ErrorBody.of(ex, requestId);
    }

    public void write(HttpServletRequest request, HttpServletResponse response, IdentityException ex) throws IOException {
        if (response.isCommitted()) {
            return;
        }
        String requestId = requestId(request);
        response.setStatus(ex.status().value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        objectMapper.writeValue(response.getOutputStream(), body(ex, requestId));
    }

    public void write(HttpServletRequest request, HttpServletResponse response, ErrorCode code, String message)
            throws IOException {
        write(request, response, new IdentityException(code, message, null, null, null));
    }

    public static String requestId(HttpServletRequest request) {
        IdentityRequest identity = (IdentityRequest) request.getAttribute(ATTR);
        if (identity != null && identity.requestId() != null) {
            return identity.requestId();
        }
        Object raw = request.getAttribute("requestId");
        return raw == null ? "" : raw.toString();
    }
}
```

其餘修改，逐 hunk 套用（等價於在 `services/cms-api` 目錄執行 `git apply`）：

`src/main/java/com/fallrising/cms/identity/web/IdentitySecurityConfig.java`：

```diff
--- a/src/main/java/com/fallrising/cms/identity/web/IdentitySecurityConfig.java
+++ b/src/main/java/com/fallrising/cms/identity/web/IdentitySecurityConfig.java
@@ -2,7 +2,7 @@
 
 import com.fallrising.cms.identity.IdentityException;
 import com.fallrising.cms.identity.IdentityProperties;
-import com.fallrising.cms.identity.domain.AuthErrorCode;
+import com.fallrising.cms.api.error.ErrorCode;
 import org.springframework.boot.context.properties.EnableConfigurationProperties;
 import org.springframework.context.annotation.Bean;
 import org.springframework.context.annotation.Configuration;
@@ -47,8 +47,7 @@
                                 errorWriter.write(
                                         request,
                                         response,
-                                        AuthErrorCode.FORBIDDEN,
-                                        403,
+                                        ErrorCode.FORBIDDEN,
                                         "Forbidden")))
                 .authorizeHttpRequests(auth -> auth.requestMatchers("/actuator/health", "/openapi.yaml")
                         .permitAll()
```

`src/main/java/com/fallrising/cms/content/service/EntryService.java`：

```diff
--- a/src/main/java/com/fallrising/cms/content/service/EntryService.java
+++ b/src/main/java/com/fallrising/cms/content/service/EntryService.java
@@ -1,5 +1,6 @@
 package com.fallrising.cms.content.service;
 
+import com.fallrising.cms.api.error.ErrorCode;
 import com.fallrising.cms.content.ContentException;
 import com.fallrising.cms.content.PublicVisibility;
 import com.fallrising.cms.content.domain.ContentTypeRecord;
@@ -76,7 +77,7 @@
         ContentTypeRecord type = requireType(typeKey);
         authorization.require(principal, CmsAction.CREATE, typeKey, payload, surface);
         if (type.singleton() && store.countEntries(type.id(), true) > 0) {
-            throw new ContentException(org.springframework.http.HttpStatus.CONFLICT, "SINGLETON_EXISTS", "Singleton already exists");
+            throw ContentException.singletonExists();
         }
         ensureSlugFree(type.id(), slug, null);
         Instant now = Instant.now();
@@ -201,7 +202,7 @@
             return current;
         }
         if ("required".equals(type.slugPolicy()) && (current.slug() == null || current.slug().isBlank())) {
-            throw ContentException.validation("SLUG_REQUIRED", "Slug is required to publish");
+            throw ContentException.validation(ErrorCode.SLUG_REQUIRED, "Slug is required to publish");
         }
         validatePayload(type, current.payload(), true);
         Instant now = Instant.now();
@@ -494,13 +495,13 @@
         List<FieldRecord> fields = store.fieldsOf(type.id());
         for (String key : payload.keySet()) {
             if (RESERVED.contains(key)) {
-                throw ContentException.validation("FIELD_VALIDATION", "Reserved field: " + key);
+                throw ContentException.validation(ErrorCode.FIELD_VALIDATION, "Reserved field: " + key);
             }
         }
         for (FieldRecord field : fields) {
             Object value = payload.get(field.fieldKey());
             if (publish && field.required() && isBlank(value)) {
-                throw ContentException.validation("FIELD_VALIDATION", "Missing required field " + field.fieldKey());
+                throw ContentException.validation(ErrorCode.FIELD_VALIDATION, "Missing required field " + field.fieldKey());
             }
             if (isBlank(value)) {
                 continue;
@@ -508,38 +509,38 @@
             switch (field.fieldType()) {
                 case "int" -> {
                     if (!(value instanceof Number)) {
-                        throw ContentException.validation("FIELD_VALIDATION", field.fieldKey() + " must be a number");
+                        throw ContentException.validation(ErrorCode.FIELD_VALIDATION, field.fieldKey() + " must be a number");
                     }
                 }
                 case "boolean" -> {
                     if (!(value instanceof Boolean)) {
-                        throw ContentException.validation("FIELD_VALIDATION", field.fieldKey() + " must be boolean");
+                        throw ContentException.validation(ErrorCode.FIELD_VALIDATION, field.fieldKey() + " must be boolean");
                     }
                 }
                 case "enum" -> {
                     if (field.enumValues() != null
                             && !field.enumValues().isEmpty()
                             && !field.enumValues().contains(String.valueOf(value))) {
-                        throw ContentException.validation("FIELD_VALIDATION", field.fieldKey() + " is not a valid enum value");
+                        throw ContentException.validation(ErrorCode.FIELD_VALIDATION, field.fieldKey() + " is not a valid enum value");
                     }
                 }
                 case "ref" -> {
                     UUID targetId = parseUuid(value, field.fieldKey());
                     EntryRecord target = store.findEntry(targetId).orElseThrow(() ->
-                            ContentException.validation("REF_TARGET_NOT_FOUND", "Referenced entry not found"));
+                            ContentException.validation(ErrorCode.REF_TARGET_NOT_FOUND, "Referenced entry not found"));
                     if (field.refTargetTypeKey() != null && !field.refTargetTypeKey().equals(target.contentTypeKey())) {
-                        throw ContentException.validation("REF_TARGET_WRONG_TYPE", "Referenced entry is the wrong type");
+                        throw ContentException.validation(ErrorCode.REF_TARGET_WRONG_TYPE, "Referenced entry is the wrong type");
                     }
                 }
                 case "principal-ref" -> {
                     UUID principalId = parseUuid(value, field.fieldKey());
                     if (identityStore.findPrincipalById(principalId).isEmpty()) {
-                        throw ContentException.validation("PRINCIPAL_REF_UNRESOLVED", "Principal not found");
+                        throw ContentException.validation(ErrorCode.PRINCIPAL_REF_UNRESOLVED, "Principal not found");
                     }
                 }
                 case "media-ref" -> {
                     if (MediaService.parseMediaId(value) == null) {
-                        throw ContentException.validation("FIELD_VALIDATION", field.fieldKey() + " must be a media UUID");
+                        throw ContentException.validation(ErrorCode.FIELD_VALIDATION, field.fieldKey() + " must be a media UUID");
                     }
                 }
                 default -> {
@@ -592,7 +593,7 @@
         try {
             return UUID.fromString(String.valueOf(value));
         } catch (IllegalArgumentException e) {
-            throw ContentException.validation("FIELD_VALIDATION", field + " must be a UUID");
+            throw ContentException.validation(ErrorCode.FIELD_VALIDATION, field + " must be a UUID");
         }
     }
```

`src/main/java/com/fallrising/cms/content/web/AdminContentController.java`：

```diff
--- a/src/main/java/com/fallrising/cms/content/web/AdminContentController.java
+++ b/src/main/java/com/fallrising/cms/content/web/AdminContentController.java
@@ -1,5 +1,6 @@
 package com.fallrising.cms.content.web;
 
+import com.fallrising.cms.api.error.ErrorCode;
 import com.fallrising.cms.content.ContentException;
 import com.fallrising.cms.content.domain.ContentTypeRecord;
 import com.fallrising.cms.content.domain.FieldRecord;
@@ -72,10 +73,10 @@
     public Map<String, Object> createType(@RequestBody TypeBody body, HttpServletRequest request) {
         manageTypes(request);
         if (body.key() == null || !body.key().matches("^[a-z][a-z0-9_]{1,62}$")) {
-            throw ContentException.validation("FIELD_VALIDATION", "Invalid type key");
+            throw ContentException.validation(ErrorCode.FIELD_VALIDATION, "Invalid type key");
         }
         if (store.findTypeByKey(body.key()).isPresent()) {
-            throw ContentException.validation("FIELD_VALIDATION", "Type already exists");
+            throw ContentException.validation(ErrorCode.FIELD_VALIDATION, "Type already exists");
         }
         Instant now = Instant.now();
         ContentTypeRecord type = new ContentTypeRecord(
```

刪除這四個檔案：`content/web/ContentExceptionHandler.java`、`media/web/MediaExceptionHandler.java`、`identity/web/IdentityExceptionHandler.java`、`identity/domain/AuthErrorCode.java`。刪除後以 `grep -rn "AuthErrorCode\|ContentExceptionHandler\|MediaExceptionHandler\|IdentityExceptionHandler" src` 確認沒有殘留。

### 5.3 原本回 500 的三個輸入錯誤

| 輸入 | 以前 | 以後 | 位置 |
| --- | --- | --- | --- |
| 工作列表或公開列表的 `ref.<field>` 不是 UUID | `IllegalArgumentException` → 500（Spring 預設錯誤） | 400 `VALIDATION_FAILED`，message `ref.<field> must be a UUID` | `EntryController.java:72`、`PublicContentController.java:73` |
| `PATCH /principals/{id}` 的 `status` 不是 `active`／`disabled`／`locked` | `IllegalArgumentException` → 500 | 400 `VALIDATION_FAILED`，message `unknown status` | `PrincipalAdminService.java:83` |

`src/main/java/com/fallrising/cms/content/web/EntryController.java`：

```diff
--- a/src/main/java/com/fallrising/cms/content/web/EntryController.java
+++ b/src/main/java/com/fallrising/cms/content/web/EntryController.java
@@ -69,7 +69,7 @@
         for (String name : request.getParameterMap().keySet()) {
             if (name.startsWith("ref.") && request.getParameter(name) != null && !request.getParameter(name).isBlank()) {
                 refField = name.substring(4);
-                refTarget = UUID.fromString(request.getParameter(name));
+                refTarget = parseRefTarget(name, request.getParameter(name));
             }
         }
         List<Map<String, Object>> items = entries.listWork(
@@ -200,4 +200,12 @@
         }
         return identity;
     }
+
+    private static UUID parseRefTarget(String name, String raw) {
+        try {
+            return UUID.fromString(raw);
+        } catch (IllegalArgumentException e) {
+            throw com.fallrising.cms.content.ContentException.invalidParameter(name + " must be a UUID");
+        }
+    }
 }
```

`src/main/java/com/fallrising/cms/content/web/PublicContentController.java`：

```diff
--- a/src/main/java/com/fallrising/cms/content/web/PublicContentController.java
+++ b/src/main/java/com/fallrising/cms/content/web/PublicContentController.java
@@ -70,7 +70,7 @@
         for (String name : request.getParameterMap().keySet()) {
             if (name.startsWith("ref.") && request.getParameter(name) != null && !request.getParameter(name).isBlank()) {
                 refField = name.substring(4);
-                refTarget = UUID.fromString(request.getParameter(name));
+                refTarget = parseRefTarget(name, request.getParameter(name));
             }
         }
         ContentTypeRecord type = store.findTypeByKey(typeKey).orElseThrow(ContentException::notFound);
@@ -135,4 +135,12 @@
         IdentityRequest identity = AuthController.current(request);
         return identity == null ? null : identity.principal();
     }
+
+    private static UUID parseRefTarget(String name, String raw) {
+        try {
+            return UUID.fromString(raw);
+        } catch (IllegalArgumentException e) {
+            throw com.fallrising.cms.content.ContentException.invalidParameter(name + " must be a UUID");
+        }
+    }
 }
```

`src/main/java/com/fallrising/cms/identity/service/PrincipalAdminService.java`：

```diff
--- a/src/main/java/com/fallrising/cms/identity/service/PrincipalAdminService.java
+++ b/src/main/java/com/fallrising/cms/identity/service/PrincipalAdminService.java
@@ -80,7 +80,7 @@
         authService.requireManagePrincipals(request);
         Principal current = store.findPrincipalById(id).orElseThrow(() -> IdentityException.validation("not found"));
         Instant now = Instant.now();
-        PrincipalStatus nextStatus = status == null ? current.status() : PrincipalStatus.fromWire(status);
+        PrincipalStatus nextStatus = status == null ? current.status() : parseStatus(status);
         Principal updated = current.withProfile(displayName == null ? current.displayName() : displayName,
                 email == null ? current.email() : email, now);
         if (nextStatus != current.status()) updated = updated.withStatus(nextStatus, now);
@@ -205,4 +205,12 @@
         store.insertAudit(new AuditEvent(UUID.randomUUID(), Instant.now(), request.principal() == null ? null : request.principal().id(),
                 "AUTH", action, "principal", targetId, request.surface().wire(), "ok", request.ip(), null));
     }
+
+    private static PrincipalStatus parseStatus(String status) {
+        try {
+            return PrincipalStatus.fromWire(status);
+        } catch (IllegalArgumentException e) {
+            throw IdentityException.validation("unknown status");
+        }
+    }
 }
```

### 5.4 Store 行為對齊（02 BD-10）

契約測試（§7.6）逐一比對兩種實作，找到下列 9 處不一致。**原則：以 JDBC（正式環境）的行為為準修 in-memory；JDBC 自己的行為錯了（第 6、7、8、9 項）才改 JDBC。**

| # | store | 方法 | 以前 | 以後（兩種 store 一致） | 由哪個契約案例抓到 |
| --- | --- | --- | --- | --- | --- |
| 1 | InMemoryContentStore | `updateType` | 整筆取代 | 只更新 `displayName`、`pluralDisplayName`、`description`、`enabled`、`updatedAt`（JDBC `UPDATE` 只寫這五欄） | `B08_updateTypeChangesOnlyMutableColumns` |
| 2 | InMemoryContentStore | `insertType` | 同 key 覆寫 | 同 key 丟 `IllegalStateException`（JDBC 違反 UNIQUE） | `B08_duplicateTypeKeyIsRejected` |
| 3 | InMemoryContentStore | `fieldsOf` | 插入順序 | `sortOrder` 遞增，再依 `fieldKey` | `B08_fieldsOrderedBySortOrderThenKey` |
| 4 | InMemoryMediaStore | `update` | 整筆取代 | 只更新 `title`、`altText`、`status`、`deletedAt`、`updatedAt`、`storedBytes` | `B08_updateChangesOnlyMutableColumns` |
| 5 | InMemoryIdentityStore | `listPrincipals`、`listRoles`、`permissionsOfRole`、`listAudits` | 無序或插入順序；`listAudits("")` 過濾成空 | 依 `username`、`code`、`action` 遞增；審計依 `at` 遞減；空白 action 視為不過濾 | `B08_listPrincipalsOrderedByUsername`、`B08_rolesOrderedByCode`、`B08_permissionsOrderedByActionAndPredicatePreserved`、`B08_auditNewestFirstAndFilters` |
| 6 | JdbcContentStore | `listEntries` 的 `q` | `ILIKE '%' + q + '%'`：`%`、`_` 變成萬用字元 | 字面比對：跳脫 `\`、`%`、`_`，加 `ESCAPE '\'` | `B08_listEntriesSearchIsCaseInsensitiveLiteralOnTitle` |
| 7 | JdbcContentStore | entry 與導覽的 mapper | `published_payload`、`published_document` 為 SQL NULL 時讀成空 Map | 讀成 `null`（與 in-memory 相同；`EntryService`、`NavigationService` 本來就檢查 null） | `B08_draftHasNullPublishedPayload`、`B08_navigationUpsertAndFind` |
| 8 | JdbcMediaStore | `listAvailable` | 只看 `status = 'available'` | 另加 `deleted_at IS NULL`（與 `MediaAsset.available()` 相同） | `B08_listAvailableExcludesDeletedNewestFirst` |
| 9 | JdbcIdentityStore | `acquireAdminGuard`（B-15） | `queryForObject("SELECT pg_advisory_xact_lock(?)", Long.class, …)`：函式回傳 void，一律丟例外，所以所有 `*KeepingUsableAdmin` 在 PostgreSQL 上都失敗 | 以 `RowCallbackHandler` 執行、忽略結果 | `B08_lastAdminGuard`；既有 `JdbcIdentityStoreIntegrationTests.lastAdminGuardRejectsRemovingAdministrativeCapability` |

已知而**接受**的差異（契約測試刻意不比對）：PostgreSQL `jsonb` 會正規化 JSON 文字（例如加空白），所以 `Permission.predicateJson` 與 `AuditEvent.detailJson` 比對的是解析後的 JSON，不比字串；`Credential.rotatedAt` 由 JDBC 的 `now()` 決定，不比對；變體（`variantsOf`）與附件（`attachmentsOfMedia`）沒有定義順序，以集合比對。

In-memory 修改（T12）：

`src/main/java/com/fallrising/cms/content/store/InMemoryContentStore.java`：

```diff
--- a/src/main/java/com/fallrising/cms/content/store/InMemoryContentStore.java
+++ b/src/main/java/com/fallrising/cms/content/store/InMemoryContentStore.java
@@ -37,17 +37,34 @@
 
     @Override
     public void insertType(ContentTypeRecord type) {
-        types.put(type.typeKey(), type);
+        if (types.putIfAbsent(type.typeKey(), type) != null) {
+            throw new IllegalStateException("type key taken: " + type.typeKey());
+        }
     }
 
     @Override
     public void updateType(ContentTypeRecord type) {
-        types.put(type.typeKey(), type);
+        types.computeIfPresent(type.typeKey(), (key, current) -> new ContentTypeRecord(
+                current.id(),
+                current.typeKey(),
+                type.displayName(),
+                type.pluralDisplayName(),
+                type.description(),
+                current.titleField(),
+                current.slugPolicy(),
+                current.singleton(),
+                type.enabled(),
+                current.previewable(),
+                current.publicRequiresPublishedRefs(),
+                current.createdAt(),
+                type.updatedAt()));
     }
 
     @Override
     public List<FieldRecord> fieldsOf(UUID typeId) {
-        return List.copyOf(fields.getOrDefault(typeId, List.of()));
+        return fields.getOrDefault(typeId, List.of()).stream()
+                .sorted(Comparator.comparingInt(FieldRecord::sortOrder).thenComparing(FieldRecord::fieldKey))
+                .toList();
     }
 
     @Override
```

`src/main/java/com/fallrising/cms/media/store/InMemoryMediaStore.java`：

```diff
--- a/src/main/java/com/fallrising/cms/media/store/InMemoryMediaStore.java
+++ b/src/main/java/com/fallrising/cms/media/store/InMemoryMediaStore.java
@@ -43,7 +43,23 @@
 
     @Override
     public void update(MediaAsset asset) {
-        assets.put(asset.id(), asset);
+        assets.computeIfPresent(asset.id(), (id, current) -> new MediaAsset(
+                current.id(),
+                current.ownerPrincipalId(),
+                asset.title(),
+                asset.altText(),
+                current.originalFilename(),
+                current.contentType(),
+                current.byteSize(),
+                asset.storedBytes(),
+                current.width(),
+                current.height(),
+                current.checksumSha256(),
+                asset.status(),
+                asset.deletedAt(),
+                current.createdAt(),
+                asset.updatedAt(),
+                current.variants()));
     }
 
     @Override
```

`src/main/java/com/fallrising/cms/identity/store/InMemoryIdentityStore.java`：

```diff
--- a/src/main/java/com/fallrising/cms/identity/store/InMemoryIdentityStore.java
+++ b/src/main/java/com/fallrising/cms/identity/store/InMemoryIdentityStore.java
@@ -14,6 +14,7 @@
 import java.time.Instant;
 import java.util.ArrayList;
 import java.util.Arrays;
+import java.util.Comparator;
 import java.util.List;
 import java.util.Locale;
 import java.util.Optional;
@@ -50,7 +51,10 @@
 
     @Override
     public List<Principal> listPrincipals() {
-        return principals.values().stream().filter(p -> !p.deleted()).toList();
+        return principals.values().stream()
+                .filter(p -> !p.deleted())
+                .sorted(Comparator.comparing(Principal::username))
+                .toList();
     }
 
     @Override
@@ -83,7 +87,7 @@
 
     @Override
     public List<Role> listRoles() {
-        return List.copyOf(roles.values());
+        return roles.values().stream().sorted(Comparator.comparing(Role::code)).toList();
     }
 
     @Override
@@ -108,7 +112,9 @@
 
     @Override
     public List<Permission> permissionsOfRole(UUID roleId) {
-        return List.copyOf(permissions.getOrDefault(roleId, List.of()));
+        return permissions.getOrDefault(roleId, List.of()).stream()
+                .sorted(Comparator.comparing(Permission::action))
+                .toList();
     }
 
     @Override
@@ -181,8 +187,9 @@
     @Override
     public List<AuditEvent> listAudits(String action, UUID targetId) {
         return audits.stream()
-                .filter(event -> action == null || action.equals(event.action()))
+                .filter(event -> action == null || action.isBlank() || action.equals(event.action()))
                 .filter(event -> targetId == null || targetId.equals(event.targetId()))
+                .sorted(Comparator.comparing(AuditEvent::at).reversed())
                 .toList();
     }
```

JDBC 修改（T14）。`escapeLike` 的替換順序不可改：先跳脫 `\`，再跳脫 `%`、`_`。SQL 字串在 Java 原始碼裡寫成 `ESCAPE '\\'`，送到 PostgreSQL 時是 `ESCAPE '\'`。

`src/main/java/com/fallrising/cms/content/store/JdbcContentStore.java`：

```diff
--- a/src/main/java/com/fallrising/cms/content/store/JdbcContentStore.java
+++ b/src/main/java/com/fallrising/cms/content/store/JdbcContentStore.java
@@ -170,8 +170,8 @@
             args.addAll(states);
         }
         if (q != null && !q.isBlank()) {
-            sql.append(" AND e.payload->>'title' ILIKE ?");
-            args.add("%" + q + "%");
+            sql.append(" AND e.payload->>'title' ILIKE ? ESCAPE '\\'");
+            args.add("%" + escapeLike(q) + "%");
         }
         if (refField != null && refTarget != null) {
             sql.append(
@@ -406,7 +406,7 @@
                 PublicationState.fromWire(rs.getString("publication_state")),
                 rs.getInt("version"),
                 readMap(rs.getString("payload")),
-                readMap(rs.getString("published_payload")),
+                readNullableMap(rs.getString("published_payload")),
                 instant(rs, "published_at"),
                 instant(rs, "archived_at"),
                 instant(rs, "deleted_at"),
@@ -436,7 +436,7 @@
                 rs.getString("publication_state"),
                 rs.getInt("version"),
                 readMap(rs.getString("document")),
-                readMap(rs.getString("published_document")),
+                readNullableMap(rs.getString("published_document")),
                 rs.getObject("updated_by", UUID.class),
                 instant(rs, "updated_at"));
     }
@@ -464,6 +464,14 @@
         }
     }
 
+    private Map<String, Object> readNullableMap(String raw) {
+        return raw == null ? null : readMap(raw);
+    }
+
+    static String escapeLike(String raw) {
+        return raw.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
+    }
+
     private List<String> readStrings(String raw) {
         if (raw == null || raw.isBlank() || "null".equals(raw)) {
             return List.of();
```

`src/main/java/com/fallrising/cms/media/store/JdbcMediaStore.java`：

```diff
--- a/src/main/java/com/fallrising/cms/media/store/JdbcMediaStore.java
+++ b/src/main/java/com/fallrising/cms/media/store/JdbcMediaStore.java
@@ -62,7 +62,7 @@
     @Override
     public List<MediaAsset> listAvailable() {
         return jdbc.query(
-                        "SELECT * FROM cms_media WHERE status = 'available' ORDER BY created_at DESC",
+                        "SELECT * FROM cms_media WHERE status = 'available' AND deleted_at IS NULL ORDER BY created_at DESC",
                         assetMapper())
                 .stream()
                 .map(this::withVariants)
```

`src/main/java/com/fallrising/cms/identity/store/JdbcIdentityStore.java`：

```diff
--- a/src/main/java/com/fallrising/cms/identity/store/JdbcIdentityStore.java
+++ b/src/main/java/com/fallrising/cms/identity/store/JdbcIdentityStore.java
@@ -10,6 +10,7 @@
 import com.fallrising.cms.identity.domain.Role;
 import com.fallrising.cms.identity.domain.SessionRecord;
 import org.springframework.jdbc.core.JdbcTemplate;
+import org.springframework.jdbc.core.RowCallbackHandler;
 import org.springframework.jdbc.core.RowMapper;
 import org.springframework.transaction.support.TransactionTemplate;
 
@@ -293,7 +294,7 @@
     }
 
     private void acquireAdminGuard() {
-        jdbc.queryForObject("SELECT pg_advisory_xact_lock(?)", Long.class, ADMIN_GUARD_KEY);
+        jdbc.query("SELECT pg_advisory_xact_lock(?)", (RowCallbackHandler) rs -> {}, ADMIN_GUARD_KEY);
     }
 
     private void ensureUsableAdmin() {
```

### 5.5 OpenAPI 回應驗證（測試支援）

- `OpenApiResponseValidator`：啟動時讀一次 classpath 的 `openapi/openapi.yaml`，對每個回應呼叫 `validateResponse(path, method, response)`。只驗證 `/api/v1/**`、`/openapi.yaml`、`/actuator/health`；報告只有 `UNDOCUMENTED_KEYS` 時視為通過（R10）。
- `OpenApiValidationConfig`：一個一般的 `@Configuration`（不是 `@TestConfiguration`），放在 `com.fallrising.cms.support`，所以會被 `@SpringBootApplication` 的 component scan 掃到，對所有 `@AutoConfigureMockMvc` 建出的 MockMvc 呼叫 `alwaysExpect(...)`。既有 10 個測試類別不用改，就全部受到驗證。
- 驗證失敗時，AssertionError 訊息的格式是 `Response does not match openapi.yaml: <METHOD> <URI> -> <status>` 加上驗證器的報告。

`src/test/java/com/fallrising/cms/support/OpenApiResponseValidator.java`：

```java
package com.fallrising.cms.support;

import com.atlassian.oai.validator.OpenApiInteractionValidator;
import com.atlassian.oai.validator.model.Request;
import com.atlassian.oai.validator.model.SimpleResponse;
import com.atlassian.oai.validator.report.SimpleValidationReportFormat;
import com.atlassian.oai.validator.report.ValidationReport;
import org.springframework.core.io.ClassPathResource;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.ResultMatcher;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Set;

/** Validates every MockMvc response against the handwritten OpenAPI document (BD-03). */
public final class OpenApiResponseValidator {

    /** Report keys that mean "this request is not a documented operation"; such responses are not validated. */
    static final Set<String> UNDOCUMENTED_KEYS = Set.of(
            "validation.request.path.missing",
            "validation.request.operation.notAllowed");

    private static final OpenApiInteractionValidator VALIDATOR = create();

    private OpenApiResponseValidator() {}

    public static ResultMatcher conformsToOpenApi() {
        return result -> {
            ValidationReport report = validate(result.getRequest(), result.getResponse());
            if (report.hasErrors()) {
                throw new AssertionError("Response does not match openapi.yaml: "
                        + result.getRequest().getMethod() + " " + result.getRequest().getRequestURI()
                        + " -> " + result.getResponse().getStatus() + "\n"
                        + SimpleValidationReportFormat.getInstance().apply(report));
            }
        };
    }

    public static ValidationReport validate(MockHttpServletRequest request, MockHttpServletResponse response) {
        String path = request.getRequestURI();
        if (!path.startsWith("/api/v1/") && !path.equals("/openapi.yaml") && !path.equals("/actuator/health")) {
            return ValidationReport.empty();
        }
        SimpleResponse.Builder builder = SimpleResponse.Builder.status(response.getStatus());
        if (response.getContentType() != null) {
            builder.withContentType(response.getContentType());
        }
        byte[] body = response.getContentAsByteArray();
        if (body.length > 0) {
            builder.withBody(body);
        }
        ValidationReport report = VALIDATOR.validateResponse(
                path, Request.Method.valueOf(request.getMethod()), builder.build());
        List<ValidationReport.Message> messages = report.getMessages();
        if (!messages.isEmpty() && messages.stream().allMatch(m -> UNDOCUMENTED_KEYS.contains(m.getKey()))) {
            return ValidationReport.empty();
        }
        return report;
    }

    private static OpenApiInteractionValidator create() {
        try {
            String spec = new ClassPathResource("openapi/openapi.yaml").getContentAsString(StandardCharsets.UTF_8);
            return OpenApiInteractionValidator.createForInlineApiSpecification(spec).build();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}
```

`src/test/java/com/fallrising/cms/support/OpenApiValidationConfig.java`：

```java
package com.fallrising.cms.support;

import org.springframework.boot.test.autoconfigure.web.servlet.MockMvcBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** Applies OpenAPI response validation to every MockMvc built by @AutoConfigureMockMvc. */
@Configuration(proxyBeanMethods = false)
public class OpenApiValidationConfig {

    @Bean
    MockMvcBuilderCustomizer openApiResponseValidation() {
        return builder -> builder.alwaysExpect(OpenApiResponseValidator.conformsToOpenApi());
    }
}
```

`TestSession`（新測試共用；既有測試不改）：

`src/test/java/com/fallrising/cms/support/TestSession.java`：

```java
package com.fallrising.cms.support;

import org.springframework.http.MediaType;
import org.springframework.mock.web.MockCookie;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** A logged-in seed account for MockMvc tests. The password comes from cms.identity.seed-password. */
public record TestSession(String origin, String token, String csrf) {

    public static final String FRONT = "http://localhost:5173";
    public static final String BACK = "http://localhost:5174";
    public static final String ADMIN = "http://localhost:5175";

    public static TestSession login(MockMvc mockMvc, String username, String password, String origin) throws Exception {
        MvcResult result = mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Origin", origin)
                        .content("{\"username\":\"%s\",\"password\":\"%s\"}".formatted(username, password)))
                .andExpect(status().isOk())
                .andReturn();
        return new TestSession(origin, cookie(result, "cms_session"), cookie(result, "cms_csrf"));
    }

    /** Adds Origin, both cookies and the CSRF header. */
    public MockHttpServletRequestBuilder apply(MockHttpServletRequestBuilder request) {
        MockCookie session = new MockCookie("cms_session", token);
        session.setPath("/");
        session.setHttpOnly(true);
        MockCookie csrfCookie = new MockCookie("cms_csrf", csrf);
        csrfCookie.setPath("/");
        return request.header("Origin", origin).header("X-CSRF-Token", csrf).cookie(session, csrfCookie);
    }

    private static String cookie(MvcResult result, String name) {
        return result.getResponse().getHeaders("Set-Cookie").stream()
                .filter(v -> v.startsWith(name + "="))
                .map(v -> v.substring(name.length() + 1).split(";", 2)[0])
                .findFirst()
                .orElseThrow();
    }
}
```

### 5.6 `build.gradle.kts`（T01、T16 後的全文）

T01 做前三項，T16 做第四項：

1. `testImplementation("com.atlassian.oai:openapi-request-validator-core:3.0.0")`。
2. `integrationTest` 的 `compileClasspath` 加上 `sourceSets.test.get().output`，讓 JDBC 契約測試能繼承 `src/test` 的抽象類別。
3. `integrationTest` task 的 description 改成 `Runs PostgreSQL-backed store contract and integration tests (Testcontainers).`。
4. 檔尾加 `dependencyLocking { lockAllConfigurations() }`。

`build.gradle.kts`：

```kotlin
plugins {
    java
    id("org.springframework.boot")
    id("io.spring.dependency-management")
}

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(25))
    }
}

tasks.withType<JavaCompile>().configureEach {
    options.encoding = "UTF-8"
    options.release.set(25)
}

tasks.withType<Test>().configureEach {
    useJUnitPlatform()
}

tasks.named<Jar>("jar") {
    enabled = false
}

val integrationTest by sourceSets.creating {
    java.srcDir("src/integrationTest/java")
    resources.srcDir("src/integrationTest/resources")
    compileClasspath += sourceSets.main.get().output + sourceSets.test.get().output +
        configurations.testRuntimeClasspath.get()
    runtimeClasspath += output + compileClasspath
}

configurations[integrationTest.implementationConfigurationName].extendsFrom(configurations.testImplementation.get())
configurations[integrationTest.runtimeOnlyConfigurationName].extendsFrom(configurations.testRuntimeOnly.get())

tasks.register<Test>("integrationTest") {
    description = "Runs PostgreSQL-backed store contract and integration tests (Testcontainers)."
    group = "verification"
    testClassesDirs = integrationTest.output.classesDirs
    classpath = integrationTest.runtimeClasspath
    useJUnitPlatform()
    shouldRunAfter(tasks.test)
}

dependencies {
    implementation("org.springframework.boot:spring-boot-starter-web")
    implementation("org.springframework.boot:spring-boot-starter-actuator")
    implementation("org.springframework.boot:spring-boot-starter-jdbc")
    implementation("org.springframework.boot:spring-boot-starter-security")
    implementation("org.springframework.boot:spring-boot-starter-validation")
    implementation("org.flywaydb:flyway-core")
    implementation("org.flywaydb:flyway-database-postgresql")
    implementation("org.bouncycastle:bcprov-jdk18on:1.81")
    runtimeOnly("org.postgresql:postgresql")

    testImplementation("org.springframework.boot:spring-boot-starter-test")
    testImplementation("org.springframework.security:spring-security-test")
    testImplementation("com.atlassian.oai:openapi-request-validator-core:3.0.0")

    add(integrationTest.implementationConfigurationName, "org.springframework.boot:spring-boot-starter-test")
    add(integrationTest.implementationConfigurationName, "org.testcontainers:junit-jupiter")
    add(integrationTest.implementationConfigurationName, "org.testcontainers:postgresql")
    add(integrationTest.runtimeOnlyConfigurationName, "org.postgresql:postgresql")
}

dependencyLocking {
    lockAllConfigurations()
}
```

### 5.7 CI：`.github/workflows/cms-scaffold-ci.yml` 新 job

在 `java:` job 與 `web:` job 之間插入下面這段（縮排兩格，與 `java:` 對齊）。action 的 SHA 與 `java` job 完全相同，不要換版本。`--no-parallel` 與既有 job 一致。

```yaml
  java-integration:
    runs-on: ubuntu-24.04
    timeout-minutes: 25
    defaults:
      run:
        working-directory: apps/cms-scaffold
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-java@b6effb05e454b25005698d916606bdc6ffcbf961 # v5
        with:
          distribution: temurin
          java-version: "25"
      - uses: gradle/actions/setup-gradle@0723195856401067f7a2779048b490ace7a47d7c # v5
      - run: ./gradlew integrationTest --no-daemon --no-parallel
```

`java` job 不變（仍然只跑 `./gradlew test`，不需要 Docker）。

### 5.8 Dependency locking（T16）

1. 確認 T01～T15 都完成（T16 必須在最後加入依賴之後才產生 lockfile）。
2. 在 `services/cms-api/build.gradle.kts` 檔尾加入 §5.6 的 `dependencyLocking` 區塊。
3. 在 `apps/cms-scaffold` 執行 `./gradlew :services:cms-api:dependencies --write-locks`。
4. 確認產生 `services/cms-api/gradle.lockfile`，第 4 行是 `# To regenerate this file, run: ./gradlew :services:cms-api:dependencies --write-locks`；檔內有 `com.atlassian.oai:openapi-request-validator-core:3.0.0=` 與 `org.testcontainers:postgresql:` 開頭的行；最後一行以 `empty=` 開頭。
5. 不要手改 lockfile。以後要改依賴：先改 `build.gradle.kts`，再重跑第 3 步，兩個檔案同一個 commit。
6. 把 lockfile 加進 Git。

### 5.9 `apps/cms-scaffold/README.md`（T15）

把「## 測試」一節的程式碼區塊改成下面這樣（只多一行），並在區塊後面、「等價模組指令」那句之前加一段：

```bash
./gradlew test
./gradlew integrationTest   # 需要 Docker（Testcontainers PostgreSQL 16）
npm test
npm run lint
npm run typecheck
npm run build
```

加的那段文字：

```markdown
`./gradlew test` 會用 `openapi.yaml` 驗證每一個 MockMvc 回應；`./gradlew integrationTest` 對 PostgreSQL 跑同一組 store 契約測試（`src/test/.../contract/`）。兩者都是 CI 閘門。
```

---

## 6. 任務卡

大小：S ≤ 150 行、M ≤ 400 行（只算實作者手寫或手改的行；整檔複製算 1 行）。所有指令在 `apps/cms-scaffold` 執行。「預期紅燈」是在實作卡之前應該失敗的測試；如果某個預期紅燈的測試已經是綠的，照樣繼續下一步。

### BW0-T01 建置設定：驗證器依賴與 integrationTest classpath

- **目標**：讓 `src/test` 能用 OpenAPI 驗證器，`src/integrationTest` 能繼承 `src/test` 的類別。
- **輸入**：無。
- **步驟**：
  1. 在 `services/cms-api/build.gradle.kts` 的 `dependencies` 區塊，`testImplementation("org.springframework.security:spring-security-test")` 那一行後面加 `testImplementation("com.atlassian.oai:openapi-request-validator-core:3.0.0")`。
  2. 在 `val integrationTest by sourceSets.creating { … }` 內，把 `compileClasspath += sourceSets.main.get().output + configurations.testRuntimeClasspath.get()` 改成 §5.6 全文中的兩行寫法（加上 `sourceSets.test.get().output`）。
  3. 把 `tasks.register<Test>("integrationTest")` 的 description 改成 §5.6 第 3 項的字串。
  4. 這一步**不要**加 `dependencyLocking`（T16 才加）。
- **完成條件**：`./gradlew :services:cms-api:test` 仍然 53 個測試全綠。
- **驗證**：`./gradlew :services:cms-api:test`
- **對應 ID**：B-01、B-08
- **大小**：S

### BW0-T02 【測試先行】OpenAPI 回應驗證器與自我測試

- **目標**：建立驗證器，並證明它會擋下不符合契約的回應。
- **輸入**：T01。
- **步驟**：
  1. 建立 `src/test/java/com/fallrising/cms/support/OpenApiResponseValidator.java`，內容與 §5.5 相同。
  2. 建立 `src/test/java/com/fallrising/cms/OpenApiResponseValidatorSelfTests.java`，內容與 §7.1 相同。
- **完成條件**：編譯通過；預期紅燈：`BW0_undocumentedPropertyFails`（舊 YAML 沒有 `WorkEntry` schema，所以多一個屬性也不會被擋）。
- **驗證**：`./gradlew :services:cms-api:test --tests 'com.fallrising.cms.OpenApiResponseValidatorSelfTests'`
- **對應 ID**：B-01
- **大小**：S

### BW0-T03 【測試先行】OpenAPI 結構規則

- **目標**：把 §4.1 的 R2～R4 寫成測試。
- **輸入**：T01。
- **步驟**：建立 `src/test/java/com/fallrising/cms/OpenApiCompletenessTests.java`，內容與 §7.2 相同。
- **完成條件**：預期紅燈：`B01_everyOperationHasSuccessSchemaAndErrors`（舊 YAML 幾乎沒有 schema）。
- **驗證**：`./gradlew :services:cms-api:test --tests 'com.fallrising.cms.OpenApiCompletenessTests'`
- **對應 ID**：B-01
- **大小**：S

### BW0-T04 換上完整契約

- **目標**：`openapi.yaml` 等於 `contracts/BW0.openapi.yaml`。
- **輸入**：T02、T03。
- **步驟**：
  1. `cp docs/v2/contracts/BW0.openapi.yaml services/cms-api/src/main/resources/openapi/openapi.yaml`
  2. `cmp docs/v2/contracts/BW0.openapi.yaml services/cms-api/src/main/resources/openapi/openapi.yaml` 沒有輸出。
- **完成條件**：T02、T03 的測試全綠；`OpenApiContractTests` 綠。
- **驗證**：`./gradlew :services:cms-api:test --tests 'com.fallrising.cms.OpenApiResponseValidatorSelfTests' --tests 'com.fallrising.cms.OpenApiCompletenessTests' --tests 'com.fallrising.cms.OpenApiContractTests'`
- **對應 ID**：B-01
- **大小**：S

### BW0-T05 全部 MockMvc 回應都驗證

- **目標**：既有與新增的 MockMvc 測試都自動檢查回應符合契約。
- **輸入**：T04。
- **步驟**：建立 `src/test/java/com/fallrising/cms/support/OpenApiValidationConfig.java`，內容與 §5.5 相同。
- **完成條件**：`./gradlew :services:cms-api:test` 全綠（預演時既有 53 個測試在這一步全部通過）。若有測試以 `Response does not match openapi.yaml` 失敗：**不要改 YAML**，照 §8 的 BW0-FM12 處理。
- **驗證**：`./gradlew :services:cms-api:test`
- **對應 ID**：B-01、BD-03
- **大小**：S

### BW0-T06 【測試先行】錯誤信封

- **目標**：寫下錯誤信封的所有預期。
- **輸入**：T05。
- **步驟**：
  1. 建立 `src/test/java/com/fallrising/cms/support/TestSession.java`（§5.5）。
  2. 建立 `src/test/java/com/fallrising/cms/ErrorEnvelopeTests.java`（§7.3）。
  3. 建立 `src/test/java/com/fallrising/cms/ErrorCodeContractTests.java`（§7.4）。
  4. 建立 `src/test/java/com/fallrising/cms/ApiExceptionHandlerTests.java`（§7.5）。
- **完成條件**：預期紅燈：`ErrorCodeContractTests`、`ApiExceptionHandlerTests` 編譯失敗（`com.fallrising.cms.api.error` 還不存在）。為了能跑 `ErrorEnvelopeTests`，先執行 `mkdir -p /tmp/bw0-hold && mv services/cms-api/src/test/java/com/fallrising/cms/ErrorCodeContractTests.java services/cms-api/src/test/java/com/fallrising/cms/ApiExceptionHandlerTests.java /tmp/bw0-hold/`，跑完驗證指令後執行 `mv /tmp/bw0-hold/*.java services/cms-api/src/test/java/com/fallrising/cms/`。`ErrorEnvelopeTests` 的預期紅燈正好是這 8 個：`B14_malformedJsonIsValidationFailed`、`B14_malformedUuidPathIsValidationFailed`、`B14_malformedRefFilterIsValidationFailed`、`B14_wrongMethodIsMethodNotAllowed`、`B14_unknownRouteIsRouteNotFound`、`B14_wrongContentTypeIsMediaTypeNotSupported`、`B14_uploadWithoutFileIsValidationFailed`、`B14_unknownPrincipalStatusIsValidationFailed`；其餘 3 個（`B14_filterErrorEchoesRequestId`、`B14_controllerErrorEchoesRequestId`、`B14_staleVersionIsVersionConflict`）已經綠，是回歸保護。
- **驗證**：`./gradlew :services:cms-api:test --tests 'com.fallrising.cms.ErrorEnvelopeTests'`
- **對應 ID**：B-14
- **大小**：M

### BW0-T07 `api.error` 的三個基礎類別

- **目標**：建立 `ErrorCode`、`CmsApiException`、`ErrorBody`。這一步還不建 `ApiExceptionHandler`（見 §5.1 最後一段：兩個 advice 並存會互搶）。
- **輸入**：T06。
- **步驟**：建立 §5.1 的 `ErrorCode.java`、`CmsApiException.java`、`ErrorBody.java`，放在 `src/main/java/com/fallrising/cms/api/error/`。
- **完成條件**：`ErrorCodeContractTests` 綠。`ApiExceptionHandlerTests` 仍然編譯失敗（`ApiExceptionHandler` 在 T08 才建立），所以跑驗證指令前同樣先 `mkdir -p /tmp/bw0-hold && mv services/cms-api/src/test/java/com/fallrising/cms/ApiExceptionHandlerTests.java /tmp/bw0-hold/`，跑完再 `mv /tmp/bw0-hold/ApiExceptionHandlerTests.java services/cms-api/src/test/java/com/fallrising/cms/`。
- **驗證**：`./gradlew :services:cms-api:test --tests 'com.fallrising.cms.ErrorCodeContractTests'`
- **對應 ID**：B-14
- **大小**：S

### BW0-T08 統一錯誤處理

- **目標**：三種例外改繼承 `CmsApiException`，只留一個 advice。
- **輸入**：T07。
- **步驟**：
  1. 建立 `ApiExceptionHandler.java`（§5.1）。
  2. 以 §5.2 的全文取代 `ContentException.java`、`MediaException.java`、`IdentityException.java`、`IdentityErrorWriter.java`。
  3. 套用 §5.2 的三段 diff（`IdentitySecurityConfig`、`EntryService`、`AdminContentController`）。
  4. 刪除 §5.2 列出的四個檔案，並執行該節的 `grep` 確認沒有殘留。
- **完成條件**：`ApiExceptionHandlerTests` 綠；`ErrorEnvelopeTests` 只剩 `B14_malformedRefFilterIsValidationFailed`、`B14_unknownPrincipalStatusIsValidationFailed` 兩個紅燈；其他既有測試全綠。
- **驗證**：`./gradlew :services:cms-api:test`
- **對應 ID**：B-14
- **大小**：M

### BW0-T09 三個原本回 500 的輸入錯誤

- **目標**：§5.3。
- **輸入**：T08。
- **步驟**：套用 §5.3 的三段 diff（`EntryController`、`PublicContentController`、`PrincipalAdminService`）。
- **完成條件**：`ErrorEnvelopeTests` 11 個全綠；`./gradlew :services:cms-api:test` 全綠。
- **驗證**：`./gradlew :services:cms-api:test --tests 'com.fallrising.cms.ErrorEnvelopeTests'`，再跑 `./gradlew :services:cms-api:test`
- **對應 ID**：B-14
- **大小**：S

### BW0-T10 【測試先行】Content store 契約

- **目標**：Content store 契約（19 個案例）以 in-memory 執行。
- **輸入**：T09。
- **步驟**：建立 `src/test/java/com/fallrising/cms/contract/ContentStoreContract.java` 與 `InMemoryContentStoreContractTests.java`（§7.6）。
- **完成條件**：預期紅燈正好 3 個：`B08_updateTypeChangesOnlyMutableColumns`、`B08_duplicateTypeKeyIsRejected`、`B08_fieldsOrderedBySortOrderThenKey`。
- **驗證**：`./gradlew :services:cms-api:test --tests 'com.fallrising.cms.contract.InMemoryContentStoreContractTests'`
- **對應 ID**：B-08
- **大小**：M

### BW0-T11 【測試先行】Media 與 Identity store 契約

- **目標**：Media（7 個）與 Identity（13 個）契約以 in-memory 執行。
- **輸入**：T10。
- **步驟**：建立 `MediaStoreContract.java`、`InMemoryMediaStoreContractTests.java`、`IdentityStoreContract.java`、`InMemoryIdentityStoreContractTests.java`（§7.6），都放在 `src/test/java/com/fallrising/cms/contract/`。
- **完成條件**：預期紅燈：Media 的 `B08_updateChangesOnlyMutableColumns`；Identity 的 `B08_rolesOrderedByCode`、`B08_permissionsOrderedByActionAndPredicatePreserved`、`B08_auditNewestFirstAndFilters`。`B08_listPrincipalsOrderedByUsername` 的結果取決於 `ConcurrentHashMap` 的迭代順序，紅或綠都算符合預期。
- **驗證**：`./gradlew :services:cms-api:test --tests 'com.fallrising.cms.contract.InMemoryMediaStoreContractTests' --tests 'com.fallrising.cms.contract.InMemoryIdentityStoreContractTests'`
- **對應 ID**：B-08
- **大小**：M

### BW0-T12 In-memory store 對齊

- **目標**：§5.4 第 1～5 項。
- **輸入**：T11。
- **步驟**：套用 §5.4「In-memory 修改」的三段 diff。
- **完成條件**：`contract` 套件的三個 `InMemory*ContractTests` 共 39 個全綠；`./gradlew :services:cms-api:test` 全綠。
- **驗證**：`./gradlew :services:cms-api:test`
- **對應 ID**：B-08
- **大小**：S

### BW0-T13 【測試先行】JDBC store 契約

- **目標**：同一組契約以 PostgreSQL 執行。
- **輸入**：T12。
- **步驟**：建立 `src/integrationTest/java/com/fallrising/cms/contract/` 下的 `PostgresFixture.java`、`JdbcContentStoreContractTests.java`、`JdbcMediaStoreContractTests.java`、`JdbcIdentityStoreContractTests.java`（§7.7）。
- **完成條件**（需要 Docker）：預期紅燈（預演實測）：Content 的 `B08_listEntriesSearchIsCaseInsensitiveLiteralOnTitle`、`B08_draftHasNullPublishedPayload`、`B08_findBySlugIsScopedToTypeAndIncludesDeleted`、`B08_navigationUpsertAndFind`；Media 的 `B08_listAvailableExcludesDeletedNewestFirst`；Identity 的 `B08_lastAdminGuard`；以及既有的 `JdbcIdentityStoreIntegrationTests.lastAdminGuardRejectsRemovingAdministrativeCapability`。沒有 Docker 時只確認 `./gradlew :services:cms-api:compileIntegrationTestJava` 成功。
- **驗證**：`./gradlew :services:cms-api:integrationTest`
- **對應 ID**：B-08、B-15
- **大小**：S

### BW0-T14 JDBC store 修正

- **目標**：§5.4 第 6～9 項。
- **輸入**：T13。
- **步驟**：套用 §5.4「JDBC 修改」的三段 diff。
- **完成條件**：`./gradlew :services:cms-api:integrationTest` 44 個全綠（既有 5 個＋契約 39 個）。沒有 Docker 時，在 PR 說明寫明「integrationTest 只在 CI 跑過」。
- **驗證**：`./gradlew :services:cms-api:integrationTest`
- **對應 ID**：B-08、B-15
- **大小**：S

### BW0-T15 CI job 與 README

- **目標**：CI 跑 `integrationTest`；README 記載。
- **輸入**：T14。
- **步驟**：
  1. 依 §5.7 修改 repo 根目錄的 `.github/workflows/cms-scaffold-ci.yml`。
  2. 依 §5.9 修改 `apps/cms-scaffold/README.md`。
  3. `python3 -c "import yaml; yaml.safe_load(open('../../.github/workflows/cms-scaffold-ci.yml'))"` 沒有錯誤。
- **完成條件**：PR 的 CI 出現 `java-integration` job 並且綠。
- **驗證**：上面的 `python3` 指令；PR 開出後看 CI。
- **對應 ID**：B-08
- **大小**：S

### BW0-T16 Dependency locking

- **目標**：02 §5.5 的 locking。
- **輸入**：T15。
- **步驟**：§5.8 第 1～6 步。
- **完成條件**：`services/cms-api/gradle.lockfile` 存在並符合 §5.8 第 4 步；`./gradlew :services:cms-api:test` 仍全綠。
- **驗證**：`./gradlew :services:cms-api:dependencies --configuration testRuntimeClasspath` 沒有 `FAILED`，再跑 `./gradlew :services:cms-api:test`
- **對應 ID**：02 §5.5
- **大小**：S（lockfile 是產生的，不算行數）

### BW0-T17 完整閘門、狀態與 PR

- **目標**：交付。
- **輸入**：T16。
- **步驟**：
  1. 執行 §9 的完整閘門。
  2. `docs/v2/README.md` 路線圖表格中，BW0 那一列的狀態從 `DOC_READY` 改成 `VERIFIED`（合併後生效）。
  3. 逐項勾選 §9 交付檢查表，貼進 PR 說明。
  4. PR 標題：`feat(cms-scaffold): BW0 契約與品質基礎`；說明列出 B-01、B-08、B-14、B-15。
- **完成條件**：§9 全部打勾；CI 的 `java`、`java-integration`、`web` 三個 job 全綠。
- **驗證**：§9 的指令。
- **對應 ID**：B-01、B-08、B-14、B-15
- **大小**：S

---

## 7. 測試規格

層級：「MockMvc」＝ JUnit 5 + `@SpringBootTest` + `@AutoConfigureMockMvc`，在 `./gradlew test` 執行，使用 in-memory store 與種子資料（`ContentTypeSeed`、`DemoContentSeed`、`SeedService`）；「單元」＝不啟動 Spring；「store 契約」＝ 同一個抽象類別在 `test`（in-memory）與 `integrationTest`（PostgreSQL）各跑一次。本波次沒有 Vitest 與 Playwright。

### 7.1 `OpenApiResponseValidatorSelfTests`（單元）

前置資料：無；手工組 `MockHttpServletResponse`。

| # | 測試 | 動作 | 斷言 |
| --- | --- | --- | --- |
| 1 | `BW0_validWorkEntryPasses` | 驗證一個合法的 `WorkEntry` | `hasErrors()` 為 false |
| 2 | `BW0_undocumentedPropertyFails` | 同上但多一個 `"extra":1` | `hasErrors()` 為 true（R6 生效） |
| 3 | `BW0_undocumentedStatusFails` | 狀態 418 | true（沒記載的狀態會被擋） |
| 4 | `BW0_unknownErrorCodeFails` | 404，`error.code` 為 `NOPE` | true（R9 生效） |
| 5 | `BW0_undocumentedPathIsSkipped` | `/api/v1/no-such-route` | false（R10） |

`src/test/java/com/fallrising/cms/OpenApiResponseValidatorSelfTests.java`：

```java
package com.fallrising.cms;

import com.fallrising.cms.support.OpenApiResponseValidator;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.assertThat;

class OpenApiResponseValidatorSelfTests {

    static final String ENTRY = """
            {"id":"6f1c2f2e-3a52-4c55-9d0e-1f4f0a3b9c11","contentType":"album","slug":"a","publicationState":"draft",
             "version":1,"title":"A","payload":{"title":"A"},"dirty":false,"publishedAt":null,
             "updatedAt":"2026-09-25T00:00:00Z"%s}
            """;

    @Test
    void BW0_validWorkEntryPasses() throws Exception {
        assertThat(report("GET", "/api/v1/entries/6f1c2f2e-3a52-4c55-9d0e-1f4f0a3b9c11", 200, ENTRY.formatted("")).hasErrors()).isFalse();
    }

    @Test
    void BW0_undocumentedPropertyFails() throws Exception {
        assertThat(report("GET", "/api/v1/entries/6f1c2f2e-3a52-4c55-9d0e-1f4f0a3b9c11", 200, ENTRY.formatted(",\"extra\":1")).hasErrors()).isTrue();
    }

    @Test
    void BW0_undocumentedStatusFails() throws Exception {
        assertThat(report("GET", "/api/v1/entries/6f1c2f2e-3a52-4c55-9d0e-1f4f0a3b9c11", 418,
                "{\"error\":{\"code\":\"FORBIDDEN\",\"message\":\"x\"},\"requestId\":\"r\"}").hasErrors()).isTrue();
    }

    @Test
    void BW0_unknownErrorCodeFails() throws Exception {
        assertThat(report("GET", "/api/v1/entries/6f1c2f2e-3a52-4c55-9d0e-1f4f0a3b9c11", 404,
                "{\"error\":{\"code\":\"NOPE\",\"message\":\"x\"},\"requestId\":\"r\"}").hasErrors()).isTrue();
    }

    @Test
    void BW0_undocumentedPathIsSkipped() throws Exception {
        assertThat(report("GET", "/api/v1/no-such-route", 404,
                "{\"error\":{\"code\":\"ROUTE_NOT_FOUND\",\"message\":\"x\"},\"requestId\":\"r\"}").hasErrors()).isFalse();
    }

    private static com.atlassian.oai.validator.report.ValidationReport report(String method, String path, int status, String body)
            throws java.io.UnsupportedEncodingException {
        MockHttpServletRequest request = new MockHttpServletRequest(method, path);
        MockHttpServletResponse response = new MockHttpServletResponse();
        response.setStatus(status);
        response.setContentType("application/json");
        response.setCharacterEncoding("UTF-8");
        response.getWriter().write(body);
        return OpenApiResponseValidator.validate(request, response);
    }
}
```

### 7.2 `OpenApiCompletenessTests`（單元）

一個測試 `B01_everyOperationHasSuccessSchemaAndErrors`，對每個 operation 檢查 R2、R3、R4，把所有違規收集後一次斷言為空（失敗訊息會列出全部違規）。

`src/test/java/com/fallrising/cms/OpenApiCompletenessTests.java`：

```java
package com.fallrising.cms;

import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.yaml.snakeyaml.Yaml;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

class OpenApiCompletenessTests {

    static final Set<String> METHODS = Set.of("get", "post", "put", "patch", "delete");

    @Test
    void B01_everyOperationHasSuccessSchemaAndErrors() throws Exception {
        List<String> problems = new ArrayList<>();
        for (Op op : operations()) {
            Map<String, Object> responses = op.responses();
            List<String> success = responses.keySet().stream().filter(k -> k.startsWith("2")).toList();
            if (success.isEmpty()) {
                problems.add(op.name() + ": no 2xx response");
            }
            for (String status : success) {
                Map<String, Object> response = response(responses.get(status));
                if (!"204".equals(status) && !hasSchema(response)) {
                    problems.add(op.name() + ": " + status + " has no content schema");
                }
            }
            if (responses.keySet().stream().noneMatch(k -> k.startsWith("4") || k.startsWith("5"))) {
                problems.add(op.name() + ": no error response");
            }
            if (!op.path().equals("/actuator/health") && !responses.containsKey("500")) {
                problems.add(op.name() + ": no 500 response");
            }
            if (!op.isPublic() && !responses.containsKey("401")) {
                problems.add(op.name() + ": authenticated operation without 401");
            }
            for (String status : responses.keySet()) {
                if ((status.startsWith("4") || status.startsWith("5")) && !op.path().equals("/actuator/health")) {
                    Object raw = responses.get(status);
                    if (!(raw instanceof Map<?, ?> map && String.valueOf(map.get("$ref")).equals("#/components/responses/Error" + status))) {
                        problems.add(op.name() + ": " + status + " must reference #/components/responses/Error" + status);
                    }
                }
            }
        }
        assertThat(problems).isEmpty();
    }

    record Op(String path, String method, Map<String, Object> operation) {
        String name() {
            return method.toUpperCase() + " " + path;
        }

        @SuppressWarnings("unchecked")
        Map<String, Object> responses() {
            return (Map<String, Object>) operation.get("responses");
        }

        boolean isPublic() {
            Object security = operation.get("security");
            return security instanceof List<?> list && list.isEmpty();
        }
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> response(Object raw) throws Exception {
        Map<String, Object> map = (Map<String, Object>) raw;
        if (map.containsKey("$ref")) {
            String name = String.valueOf(map.get("$ref")).substring("#/components/responses/".length());
            return (Map<String, Object>) ((Map<String, Object>) ((Map<String, Object>) document().get("components")).get("responses")).get(name);
        }
        return map;
    }

    @SuppressWarnings("unchecked")
    private static boolean hasSchema(Map<String, Object> response) {
        Object content = response.get("content");
        if (!(content instanceof Map<?, ?> types) || types.isEmpty()) {
            return false;
        }
        return types.values().stream().allMatch(v -> v instanceof Map<?, ?> m && m.get("schema") != null);
    }

    @SuppressWarnings("unchecked")
    private static List<Op> operations() throws Exception {
        List<Op> ops = new ArrayList<>();
        Map<String, Object> paths = (Map<String, Object>) document().get("paths");
        for (Map.Entry<String, Object> path : paths.entrySet()) {
            for (Map.Entry<String, Object> item : ((Map<String, Object>) path.getValue()).entrySet()) {
                if (METHODS.contains(item.getKey())) {
                    ops.add(new Op(path.getKey(), item.getKey(), (Map<String, Object>) item.getValue()));
                }
            }
        }
        return ops;
    }

    private static Map<String, Object> document() throws Exception {
        try (InputStream in = new ClassPathResource("openapi/openapi.yaml").getInputStream()) {
            return new Yaml().load(in);
        }
    }
}
```

### 7.3 `ErrorEnvelopeTests`（MockMvc）

前置資料：種子帳號 `seed-operator-album`（Back，Origin `http://localhost:5174`）、`seed-admin`（Admin，Origin `http://localhost:5175`）；密碼 `@Value("${cms.identity.seed-password}")`。`B14_staleVersionIsVersionConflict` 自己建一筆 `album`（slug `bw0-<隨機 UUID>`、payload `{"title":"BW0"}`）。不需要額外種子。所有回應同時經過 §5.5 的全域 OpenAPI 驗證（405 那一筆依 R10 略過）。

| # | 測試 | 動作 | 斷言 |
| --- | --- | --- | --- |
| 1 | `B14_malformedJsonIsValidationFailed` | operator `PATCH /api/v1/entries/{隨機}`，body `{` | 400、`VALIDATION_FAILED` |
| 2 | `B14_malformedUuidPathIsValidationFailed` | operator `GET /api/v1/entries/not-a-uuid` | 400、`VALIDATION_FAILED` |
| 3 | `B14_malformedRefFilterIsValidationFailed` | operator `GET /api/v1/content-types/photo/entries?ref.album=nope`；匿名 `GET /api/v1/public/content-types/photo/entries?ref.album=nope` | 兩者 400、`VALIDATION_FAILED` |
| 4 | `B14_wrongMethodIsMethodNotAllowed` | operator `PUT /api/v1/entries/{隨機}` | 405、`METHOD_NOT_ALLOWED` |
| 5 | `B14_unknownRouteIsRouteNotFound` | operator `GET /api/v1/no-such-route` | 404、`ROUTE_NOT_FOUND` |
| 6 | `B14_wrongContentTypeIsMediaTypeNotSupported` | operator `PATCH /api/v1/entries/{隨機}`，`Content-Type: text/plain` | 415、`MEDIA_TYPE_NOT_SUPPORTED` |
| 7 | `B14_uploadWithoutFileIsValidationFailed` | operator multipart `POST /api/v1/media`，只有 `title` | 400、`VALIDATION_FAILED` |
| 8 | `B14_unknownPrincipalStatusIsValidationFailed` | admin 取得自己的 id，`PATCH /api/v1/principals/{id}` body `{"status":"bogus"}` | 400、`VALIDATION_FAILED` |
| 9 | `B14_filterErrorEchoesRequestId` | 匿名 `GET /api/v1/auth/me`，`X-Request-Id: bw0-request-id` | 401、`UNAUTHENTICATED`、body 與標頭的 request id 都是 `bw0-request-id` |
| 10 | `B14_controllerErrorEchoesRequestId` | 匿名 `GET /api/v1/public/content-types/album/entries/{隨機}`，`X-Request-Id: bw0-request-id-2` | 404、`ENTRY_NOT_FOUND`、`requestId` 相同、沒有 `error.action` |
| 11 | `B14_staleVersionIsVersionConflict` | operator 建 album 後以 `version: 99` PATCH | 409、`VERSION_CONFLICT` |

`src/test/java/com/fallrising/cms/ErrorEnvelopeTests.java`：

```java
package com.fallrising.cms;

import com.fallrising.cms.support.TestSession;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class ErrorEnvelopeTests {

    @Autowired
    MockMvc mockMvc;

    @Value("${cms.identity.seed-password}")
    String password;

    @Test
    void B14_malformedJsonIsValidationFailed() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        mockMvc.perform(op.apply(patch("/api/v1/entries/" + UUID.randomUUID()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"));
    }

    @Test
    void B14_malformedUuidPathIsValidationFailed() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        mockMvc.perform(op.apply(get("/api/v1/entries/not-a-uuid")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"));
    }

    @Test
    void B14_malformedRefFilterIsValidationFailed() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        mockMvc.perform(op.apply(get("/api/v1/content-types/photo/entries").param("ref.album", "nope")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"));
        mockMvc.perform(get("/api/v1/public/content-types/photo/entries").param("ref.album", "nope"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"));
    }

    @Test
    void B14_wrongMethodIsMethodNotAllowed() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        mockMvc.perform(op.apply(put("/api/v1/entries/" + UUID.randomUUID()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isMethodNotAllowed())
                .andExpect(jsonPath("$.error.code").value("METHOD_NOT_ALLOWED"));
    }

    @Test
    void B14_unknownRouteIsRouteNotFound() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        mockMvc.perform(op.apply(get("/api/v1/no-such-route")))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("ROUTE_NOT_FOUND"));
    }

    @Test
    void B14_wrongContentTypeIsMediaTypeNotSupported() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        mockMvc.perform(op.apply(patch("/api/v1/entries/" + UUID.randomUUID()))
                        .contentType(MediaType.TEXT_PLAIN)
                        .content("x"))
                .andExpect(status().isUnsupportedMediaType())
                .andExpect(jsonPath("$.error.code").value("MEDIA_TYPE_NOT_SUPPORTED"));
    }

    @Test
    void B14_uploadWithoutFileIsValidationFailed() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        mockMvc.perform(op.apply(multipart("/api/v1/media").param("title", "x")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"));
    }

    @Test
    void B14_unknownPrincipalStatusIsValidationFailed() throws Exception {
        TestSession admin = TestSession.login(mockMvc, "seed-admin", password, TestSession.ADMIN);
        MvcResult me = mockMvc.perform(admin.apply(get("/api/v1/auth/me"))).andExpect(status().isOk()).andReturn();
        String id = me.getResponse().getContentAsString().replaceAll("(?s).*\"principal\":\\{\"id\":\"([^\"]+)\".*", "$1");
        mockMvc.perform(admin.apply(patch("/api/v1/principals/" + id))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"bogus\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"));
    }

    @Test
    void B14_filterErrorEchoesRequestId() throws Exception {
        mockMvc.perform(get("/api/v1/auth/me").header("X-Request-Id", "bw0-request-id"))
                .andExpect(status().isUnauthorized())
                .andExpect(header().string("X-Request-Id", "bw0-request-id"))
                .andExpect(jsonPath("$.requestId").value("bw0-request-id"))
                .andExpect(jsonPath("$.error.code").value("UNAUTHENTICATED"));
    }

    @Test
    void B14_controllerErrorEchoesRequestId() throws Exception {
        mockMvc.perform(get("/api/v1/public/content-types/album/entries/" + UUID.randomUUID())
                        .header("X-Request-Id", "bw0-request-id-2"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.requestId").value("bw0-request-id-2"))
                .andExpect(jsonPath("$.error.code").value("ENTRY_NOT_FOUND"))
                .andExpect(jsonPath("$.error.action").doesNotExist());
    }

    @Test
    void B14_staleVersionIsVersionConflict() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        MvcResult created = mockMvc.perform(op.apply(post("/api/v1/content-types/album/entries"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"slug\":\"bw0-%s\",\"payload\":{\"title\":\"BW0\"}}".formatted(UUID.randomUUID())))
                .andExpect(status().isCreated())
                .andReturn();
        String id = created.getResponse().getContentAsString().replaceAll("(?s).*\"id\":\"([^\"]+)\".*", "$1");
        mockMvc.perform(op.apply(patch("/api/v1/entries/" + id))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"version\":99,\"payload\":{\"title\":\"Stale\"}}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("VERSION_CONFLICT"));
    }
}
```

### 7.4 `ErrorCodeContractTests`（單元）

`B14_errorCodeEnumMatchesOpenApi`：Java 的 wire 值與 YAML 的 enum 各自沒有重複，而且集合相等。

`src/test/java/com/fallrising/cms/ErrorCodeContractTests.java`：

```java
package com.fallrising.cms;

import com.fallrising.cms.api.error.ErrorCode;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.yaml.snakeyaml.Yaml;

import java.io.InputStream;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class ErrorCodeContractTests {

    @Test
    @SuppressWarnings("unchecked")
    void B14_errorCodeEnumMatchesOpenApi() throws Exception {
        Map<String, Object> doc;
        try (InputStream in = new ClassPathResource("openapi/openapi.yaml").getInputStream()) {
            doc = new Yaml().load(in);
        }
        Map<String, Object> schemas = (Map<String, Object>) ((Map<String, Object>) doc.get("components")).get("schemas");
        List<String> documented = (List<String>) ((Map<String, Object>) schemas.get("ErrorCode")).get("enum");
        List<String> implemented = Arrays.stream(ErrorCode.values()).map(ErrorCode::wire).toList();
        assertThat(implemented).doesNotHaveDuplicates();
        assertThat(documented).doesNotHaveDuplicates();
        assertThat(implemented).containsExactlyInAnyOrderElementsOf(documented);
    }
}
```

### 7.5 `ApiExceptionHandlerTests`（單元）

`B14_unexpectedExceptionIsInternalErrorWithoutDetails`：直接呼叫 `unexpected(new IllegalStateException("secret detail"), request)`；斷言 500、`INTERNAL_ERROR`、message 是 `Internal error`、`requestId` 取自 request attribute、整個 body 不含 `secret detail`。

`src/test/java/com/fallrising/cms/ApiExceptionHandlerTests.java`：

```java
package com.fallrising.cms;

import com.fallrising.cms.api.error.ApiExceptionHandler;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletRequest;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class ApiExceptionHandlerTests {

    @Test
    @SuppressWarnings("unchecked")
    void B14_unexpectedExceptionIsInternalErrorWithoutDetails() {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/entries");
        request.setAttribute("requestId", "rid-500");
        ResponseEntity<Map<String, Object>> response =
                new ApiExceptionHandler().unexpected(new IllegalStateException("secret detail"), request);
        assertThat(response.getStatusCode().value()).isEqualTo(500);
        Map<String, Object> error = (Map<String, Object>) response.getBody().get("error");
        assertThat(error).containsEntry("code", "INTERNAL_ERROR").containsEntry("message", "Internal error");
        assertThat(response.getBody()).containsEntry("requestId", "rid-500");
        assertThat(response.getBody().toString()).doesNotContain("secret detail");
    }
}
```

### 7.6 Store 契約（`src/test/.../contract/`）

規則：

- 抽象類別名稱以 `Contract` 結尾（不是 `Tests`），宣告 `protected abstract <Store> newStore()`，`@BeforeEach` 取得一個**空的** store。
- 時間一律用 `T0 = 2026-01-01T00:00:00Z` 加整數秒，避免 PostgreSQL `timestamptz` 的微秒截斷造成不相等。
- 排序斷言只用 ASCII 字母開頭、在任何 collation 下順序都相同的字串（`anna`／`bert`／`carl`、`admin`／`editor`／`member`、`create`／`publish`／`read_draft`）。
- 以後修改任何 store 行為，先在這裡加案例（02 §5.2）。

案例清單（測試名稱中的 B08 是稽核 ID）：

| 契約 | 案例 | 固定的行為 |
| --- | --- | --- |
| Content | `B08_typeRoundTrip` | 插入後讀回相等 |
| Content | `B08_unknownTypeIsEmpty` | 不存在的類型與欄位為空 |
| Content | `B08_listTypesOrderedByKey` | `listTypes` 依 key 遞增 |
| Content | `B08_updateTypeChangesOnlyMutableColumns` | §5.4 第 1 項 |
| Content | `B08_duplicateTypeKeyIsRejected` | §5.4 第 2 項 |
| Content | `B08_fieldsOrderedBySortOrderThenKey` | §5.4 第 3 項 |
| Content | `B08_markMediaRefsPublicOnlyTouchesMediaRefFields` | 只有 `media-ref` 欄位變成 `publicBytes=true` |
| Content | `B08_entryRoundTripKeepsPayloadTypesAndNulls` | payload 的字串、整數、布林、巢狀物件、陣列、`null` 值都原樣保存（G-07 的 store 層前提） |
| Content | `B08_draftHasNullPublishedPayload` | §5.4 第 7 項 |
| Content | `B08_findBySlugIsScopedToTypeAndIncludesDeleted` | slug 查詢限定類型，包含已軟刪的 entry；null slug 為空（整筆比對，所以也受 §5.4 第 7 項影響） |
| Content | `B08_listEntriesFiltersStatesAndDeletedNewestFirst` | 空的 states 表示全部；預設排除軟刪；依 `updatedAt` 遞減 |
| Content | `B08_listEntriesSearchIsCaseInsensitiveLiteralOnTitle` | §5.4 第 6 項；只搜 `payload.title`；空白 `q` 不過濾 |
| Content | `B08_listEntriesFiltersByRef` | `ref.<field>` 過濾 |
| Content | `B08_countEntriesHonoursDeleted` | 計數是否含軟刪 |
| Content | `B08_updateEntryReplacesMutableColumns` | 更新後讀回相等 |
| Content | `B08_hardDeleteRemovesEntryRevisionsAndOutgoingRefs` | 硬刪連同 revision 與外連 ref |
| Content | `B08_revisionsNewestFirstAndPruned` | revision 依編號遞減；只保留最新 N 筆 |
| Content | `B08_replaceRefsAndRefsTo` | ref 以來源 entry 為單位整批取代 |
| Content | `B08_navigationUpsertAndFind` | 導覽新增與更新；未發布時 `publishedDocument` 為 null |
| Media | `B08_mediaRoundTripWithVariants` | 讀回相等；變體以集合比對 |
| Media | `B08_unknownMediaIsEmpty` | 不存在的媒體、變體、附件為空 |
| Media | `B08_listAvailableExcludesDeletedNewestFirst` | §5.4 第 8 項；依 `createdAt` 遞減 |
| Media | `B08_updateChangesOnlyMutableColumns` | §5.4 第 4 項 |
| Media | `B08_attachmentsReplacedPerEntry` | 附件以 entry 為單位整批取代 |
| Media | `B08_countsAndSumsIncludeDeleted` | 檔案數與位元組數包含已刪除；可依擁有者計數 |
| Media | `B08_defaultQuota` | 預設配額 15728640／2147483648／10000／2000 |
| Identity | `B08_principalRoundTripAndCaseInsensitiveUsername` | 帳號查詢不分大小寫 |
| Identity | `B08_deletedPrincipalIsHidden` | `deletedAt` 非空的帳號查不到、不列出 |
| Identity | `B08_listPrincipalsOrderedByUsername` | §5.4 第 5 項 |
| Identity | `B08_duplicateUsernameIsRejected` | 重複帳號丟例外 |
| Identity | `B08_updatePrincipalPersistsMutableColumns` | 更新後讀回相等 |
| Identity | `B08_passwordCredentialUpsert` | upsert 保留 credential id、更新 hash |
| Identity | `B08_rolesOrderedByCode` | §5.4 第 5 項 |
| Identity | `B08_roleAssignmentsRoundTrip` | 角色指派與 allowlist 整批取代 |
| Identity | `B08_permissionsOrderedByActionAndPredicatePreserved` | §5.4 第 5 項；predicate 以解析後的 JSON 比對 |
| Identity | `B08_sessionTouchAndRevoke` | 過期或撤銷後 `touchSession` 回 false |
| Identity | `B08_revokeAllForPrincipalKeepsException` | 保留指定的 session |
| Identity | `B08_auditNewestFirstAndFilters` | §5.4 第 5 項；action 與 targetId 過濾 |
| Identity | `B08_lastAdminGuard` | §5.4 第 9 項；三種 `*KeepingUsableAdmin` 都丟 `IdentityException` 且狀態不變 |

`src/test/java/com/fallrising/cms/contract/ContentStoreContract.java`：

```java
package com.fallrising.cms.contract;

import com.fallrising.cms.content.domain.ContentTypeRecord;
import com.fallrising.cms.content.domain.EntryRecord;
import com.fallrising.cms.content.domain.EntryRefRecord;
import com.fallrising.cms.content.domain.FieldRecord;
import com.fallrising.cms.content.domain.NavigationRecord;
import com.fallrising.cms.content.domain.PublicationState;
import com.fallrising.cms.content.domain.RevisionRecord;
import com.fallrising.cms.content.store.ContentStore;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Behaviour every ContentStore must have (BD-10). Subclasses return an empty store from newStore().
 * InMemoryContentStoreContractTests runs it in ./gradlew test; JdbcContentStoreContractTests runs it in integrationTest.
 */
public abstract class ContentStoreContract {

    protected static final Instant T0 = Instant.parse("2026-01-01T00:00:00Z");

    protected ContentStore store;

    protected abstract ContentStore newStore();

    @BeforeEach
    void setUpStore() {
        store = newStore();
    }

    @Test
    void B08_typeRoundTrip() {
        ContentTypeRecord album = type("album");
        store.insertType(album);
        assertThat(store.findTypeByKey("album")).contains(album);
    }

    @Test
    void B08_unknownTypeIsEmpty() {
        assertThat(store.findTypeByKey("missing")).isEmpty();
        assertThat(store.fieldsOf(UUID.randomUUID())).isEmpty();
    }

    @Test
    void B08_listTypesOrderedByKey() {
        store.insertType(type("photo"));
        store.insertType(type("album"));
        store.insertType(type("page"));
        assertThat(store.listTypes()).extracting(ContentTypeRecord::typeKey).containsExactly("album", "page", "photo");
    }

    @Test
    void B08_updateTypeChangesOnlyMutableColumns() {
        ContentTypeRecord album = type("album");
        store.insertType(album);
        ContentTypeRecord changed = new ContentTypeRecord(album.id(), "album", "Albums!", "Many albums", "desc",
                "name", "none", true, false, false, List.of("cover"), t(50), t(60));
        store.updateType(changed);
        ContentTypeRecord expected = new ContentTypeRecord(album.id(), "album", "Albums!", "Many albums", "desc",
                album.titleField(), album.slugPolicy(), album.singleton(), false, album.previewable(),
                album.publicRequiresPublishedRefs(), album.createdAt(), t(60));
        assertThat(store.findTypeByKey("album")).contains(expected);
    }

    @Test
    void B08_duplicateTypeKeyIsRejected() {
        store.insertType(type("album"));
        assertThatThrownBy(() -> store.insertType(type("album"))).isInstanceOf(RuntimeException.class);
    }

    @Test
    void B08_fieldsOrderedBySortOrderThenKey() {
        ContentTypeRecord album = type("album");
        store.insertType(album);
        store.insertField(field(album.id(), "zeta", "string", 1));
        store.insertField(field(album.id(), "beta", "string", 1));
        store.insertField(field(album.id(), "alpha", "string", 2));
        store.insertField(field(album.id(), "omega", "string", 0));
        assertThat(store.fieldsOf(album.id())).extracting(FieldRecord::fieldKey)
                .containsExactly("omega", "beta", "zeta", "alpha");
    }

    @Test
    void B08_markMediaRefsPublicOnlyTouchesMediaRefFields() {
        ContentTypeRecord album = type("album");
        store.insertType(album);
        store.insertField(field(album.id(), "cover", "media-ref", 0));
        store.insertField(field(album.id(), "title", "string", 1));
        store.markMediaRefsPublic();
        assertThat(store.fieldsOf(album.id())).extracting(FieldRecord::fieldKey, FieldRecord::publicBytes)
                .containsExactly(org.assertj.core.groups.Tuple.tuple("cover", true), org.assertj.core.groups.Tuple.tuple("title", false));
    }

    @Test
    void B08_entryRoundTripKeepsPayloadTypesAndNulls() {
        ContentTypeRecord album = insertType("album");
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("title", "Coast");
        payload.put("count", 3);
        payload.put("flag", true);
        payload.put("nested", Map.of("k", "v"));
        payload.put("list", List.of("a", "b"));
        payload.put("cleared", null);
        EntryRecord entry = entry(album, "coast", PublicationState.PUBLISHED, payload, t(10));
        store.insertEntry(entry);
        EntryRecord found = store.findEntry(entry.id()).orElseThrow();
        assertThat(found).isEqualTo(entry);
        assertThat(found.payload()).containsEntry("cleared", null).containsEntry("count", 3);
    }

    @Test
    void B08_draftHasNullPublishedPayload() {
        ContentTypeRecord album = insertType("album");
        EntryRecord draft = entry(album, "draft", PublicationState.DRAFT, Map.of("title", "D"), t(10));
        store.insertEntry(draft);
        assertThat(store.findEntry(draft.id()).orElseThrow().publishedPayload()).isNull();
    }

    @Test
    void B08_findBySlugIsScopedToTypeAndIncludesDeleted() {
        ContentTypeRecord album = insertType("album");
        ContentTypeRecord page = insertType("page");
        EntryRecord a = entry(album, "same", PublicationState.DRAFT, Map.of("title", "A"), t(10));
        EntryRecord p = deleted(entry(page, "same", PublicationState.DRAFT, Map.of("title", "P"), t(11)), t(12));
        store.insertEntry(a);
        store.insertEntry(p);
        assertThat(store.findBySlug(album.id(), "same")).contains(a);
        assertThat(store.findBySlug(page.id(), "same")).contains(p);
        assertThat(store.findBySlug(album.id(), null)).isEmpty();
        assertThat(store.findBySlug(album.id(), "other")).isEmpty();
    }

    @Test
    void B08_listEntriesFiltersStatesAndDeletedNewestFirst() {
        ContentTypeRecord album = insertType("album");
        ContentTypeRecord page = insertType("page");
        EntryRecord draft = entry(album, "d", PublicationState.DRAFT, Map.of("title", "d"), t(10));
        EntryRecord published = entry(album, "p", PublicationState.PUBLISHED, Map.of("title", "p"), t(30));
        EntryRecord archived = entry(album, "a", PublicationState.ARCHIVED, Map.of("title", "a"), t(20));
        EntryRecord gone = deleted(entry(album, "x", PublicationState.DRAFT, Map.of("title", "x"), t(40)), t(41));
        EntryRecord other = entry(page, "o", PublicationState.DRAFT, Map.of("title", "o"), t(50));
        List.of(draft, published, archived, gone, other).forEach(store::insertEntry);

        assertThat(store.listEntries(album.id(), List.of(), false, null, null, null))
                .extracting(EntryRecord::slug).containsExactly("p", "a", "d");
        assertThat(store.listEntries(album.id(), List.of("draft", "published"), false, null, null, null))
                .extracting(EntryRecord::slug).containsExactly("p", "d");
        assertThat(store.listEntries(album.id(), List.of(), true, null, null, null))
                .extracting(EntryRecord::slug).containsExactly("x", "p", "a", "d");
    }

    @Test
    void B08_listEntriesSearchIsCaseInsensitiveLiteralOnTitle() {
        ContentTypeRecord album = insertType("album");
        store.insertEntry(entry(album, "s1", PublicationState.DRAFT, Map.of("title", "Coast 50% Off"), t(10)));
        store.insertEntry(entry(album, "s2", PublicationState.DRAFT, Map.of("title", "Coast 500 off"), t(11)));
        store.insertEntry(entry(album, "s3", PublicationState.DRAFT, Map.of("title", "Beach_1"), t(12)));
        store.insertEntry(entry(album, "s4", PublicationState.DRAFT, Map.of("title", "BeachX1"), t(13)));
        store.insertEntry(entry(album, "s5", PublicationState.DRAFT, Map.of("name", "Coast"), t(14)));

        assertThat(slugs(album, "COAST")).containsExactly("s2", "s1");
        assertThat(slugs(album, "50%")).containsExactly("s1");
        assertThat(slugs(album, "h_1")).containsExactly("s3");
        assertThat(slugs(album, " ")).containsExactly("s5", "s4", "s3", "s2", "s1");
    }

    @Test
    void B08_listEntriesFiltersByRef() {
        ContentTypeRecord album = insertType("album");
        ContentTypeRecord photo = insertType("photo");
        EntryRecord a1 = entry(album, "a1", PublicationState.DRAFT, Map.of("title", "a1"), t(1));
        EntryRecord a2 = entry(album, "a2", PublicationState.DRAFT, Map.of("title", "a2"), t(2));
        EntryRecord p1 = entry(photo, "p1", PublicationState.DRAFT, Map.of("album", a1.id().toString()), t(3));
        EntryRecord p2 = entry(photo, "p2", PublicationState.DRAFT, Map.of("album", a2.id().toString()), t(4));
        List.of(a1, a2, p1, p2).forEach(store::insertEntry);
        store.replaceRefs(p1.id(), List.of(new EntryRefRecord(p1.id(), "album", a1.id(), "entry", 0)));
        store.replaceRefs(p2.id(), List.of(new EntryRefRecord(p2.id(), "album", a2.id(), "entry", 0)));

        assertThat(store.listEntries(photo.id(), List.of(), false, null, "album", a1.id()))
                .extracting(EntryRecord::slug).containsExactly("p1");
        assertThat(store.listEntries(photo.id(), List.of(), false, null, "cover", a1.id())).isEmpty();
    }

    @Test
    void B08_countEntriesHonoursDeleted() {
        ContentTypeRecord album = insertType("album");
        store.insertEntry(entry(album, "a", PublicationState.DRAFT, Map.of(), t(1)));
        store.insertEntry(deleted(entry(album, "b", PublicationState.DRAFT, Map.of(), t(2)), t(3)));
        assertThat(store.countEntries(album.id(), false)).isEqualTo(1);
        assertThat(store.countEntries(album.id(), true)).isEqualTo(2);
    }

    @Test
    void B08_updateEntryReplacesMutableColumns() {
        ContentTypeRecord album = insertType("album");
        EntryRecord draft = entry(album, "d", PublicationState.DRAFT, Map.of("title", "old"), t(10));
        store.insertEntry(draft);
        UUID actor = UUID.randomUUID();
        EntryRecord next = new EntryRecord(draft.id(), album.id(), "album", "d2", PublicationState.PUBLISHED, 2,
                Map.of("title", "new"), Map.of("title", "new"), t(20), null, null, draft.createdBy(), actor,
                draft.createdAt(), t(20));
        store.updateEntry(next);
        assertThat(store.findEntry(draft.id())).contains(next);
    }

    @Test
    void B08_hardDeleteRemovesEntryRevisionsAndOutgoingRefs() {
        ContentTypeRecord album = insertType("album");
        EntryRecord target = entry(album, "t", PublicationState.DRAFT, Map.of(), t(1));
        EntryRecord source = entry(album, "s", PublicationState.PUBLISHED, Map.of("title", "s"), t(2));
        store.insertEntry(target);
        store.insertEntry(source);
        store.replaceRefs(source.id(), List.of(new EntryRefRecord(source.id(), "related", target.id(), "entry", 0)));
        store.insertRevision(revision(source, 1, t(2)));

        store.hardDeleteEntry(source.id());

        assertThat(store.findEntry(source.id())).isEmpty();
        assertThat(store.revisionsOf(source.id())).isEmpty();
        assertThat(store.refsTo(target.id())).isEmpty();
        assertThat(store.findEntry(target.id())).isPresent();
    }

    @Test
    void B08_revisionsNewestFirstAndPruned() {
        ContentTypeRecord album = insertType("album");
        EntryRecord e = entry(album, "e", PublicationState.PUBLISHED, Map.of("title", "e"), t(1));
        store.insertEntry(e);
        for (int no = 1; no <= 5; no++) {
            store.insertRevision(revision(e, no, t(no)));
        }
        assertThat(store.revisionsOf(e.id())).extracting(RevisionRecord::revisionNo).containsExactly(5, 4, 3, 2, 1);
        assertThat(store.revisionsOf(e.id()).getFirst()).usingRecursiveComparison().ignoringFields("id")
                .isEqualTo(revision(e, 5, t(5)));
        store.deleteOldestRevisions(e.id(), 2);
        assertThat(store.revisionsOf(e.id())).extracting(RevisionRecord::revisionNo).containsExactly(5, 4);
        store.deleteOldestRevisions(e.id(), 5);
        assertThat(store.revisionsOf(e.id())).hasSize(2);
    }

    @Test
    void B08_replaceRefsAndRefsTo() {
        ContentTypeRecord album = insertType("album");
        EntryRecord target = entry(album, "t", PublicationState.DRAFT, Map.of(), t(1));
        EntryRecord s1 = entry(album, "s1", PublicationState.DRAFT, Map.of(), t(2));
        EntryRecord s2 = entry(album, "s2", PublicationState.DRAFT, Map.of(), t(3));
        List.of(target, s1, s2).forEach(store::insertEntry);
        UUID media = UUID.randomUUID();
        store.replaceRefs(s1.id(), List.of(
                new EntryRefRecord(s1.id(), "related", target.id(), "entry", 0),
                new EntryRefRecord(s1.id(), "cover", media, "media", 0)));
        store.replaceRefs(s2.id(), List.of(new EntryRefRecord(s2.id(), "related", target.id(), "entry", 0)));

        assertThat(store.refsTo(target.id())).extracting(EntryRefRecord::fromEntryId)
                .containsExactlyInAnyOrder(s1.id(), s2.id());

        store.replaceRefs(s1.id(), List.of());
        assertThat(store.refsTo(target.id())).extracting(EntryRefRecord::fromEntryId).containsExactly(s2.id());
        assertThat(store.refsTo(media)).isEmpty();
    }

    @Test
    void B08_navigationUpsertAndFind() {
        assertThat(store.findNavigation("front.primary")).isEmpty();
        NavigationRecord draft = new NavigationRecord(UUID.randomUUID(), "front.primary", "front", "draft", 1,
                Map.of("items", List.of(Map.of("label", "A", "href", "/a"))), null, null, t(1));
        store.upsertNavigation(draft);
        assertThat(store.findNavigation("front.primary")).contains(draft);

        NavigationRecord published = new NavigationRecord(draft.id(), "front.primary", "front", "published", 2,
                draft.document(), draft.document(), UUID.randomUUID(), t(2));
        store.upsertNavigation(published);
        assertThat(store.findNavigation("front.primary")).contains(published);
    }

    // ---- fixtures ----

    protected static Instant t(int seconds) {
        return T0.plusSeconds(seconds);
    }

    protected static ContentTypeRecord type(String key) {
        return new ContentTypeRecord(UUID.randomUUID(), key, key + " one", key + " many", null, "title", "optional",
                false, true, true, List.of(), T0, T0);
    }

    protected ContentTypeRecord insertType(String key) {
        ContentTypeRecord type = type(key);
        store.insertType(type);
        return type;
    }

    protected static FieldRecord field(UUID typeId, String key, String fieldType, int sortOrder) {
        return new FieldRecord(UUID.randomUUID(), typeId, key, fieldType, false, false, false, "public", sortOrder,
                null, "restrict", List.of(), true, false);
    }

    protected static EntryRecord entry(ContentTypeRecord type, String slug, PublicationState state,
            Map<String, Object> payload, Instant updatedAt) {
        boolean published = state == PublicationState.PUBLISHED;
        return new EntryRecord(UUID.randomUUID(), type.id(), type.typeKey(), slug, state, 1, payload,
                published ? payload : null, published ? updatedAt : null, null, null, null, null, T0, updatedAt);
    }

    protected static EntryRecord deleted(EntryRecord e, Instant at) {
        return new EntryRecord(e.id(), e.contentTypeId(), e.contentTypeKey(), e.slug(), e.publicationState(),
                e.version(), e.payload(), e.publishedPayload(), e.publishedAt(), e.archivedAt(), at, e.createdBy(),
                e.updatedBy(), e.createdAt(), e.updatedAt());
    }

    protected static RevisionRecord revision(EntryRecord e, int no, Instant at) {
        return new RevisionRecord(UUID.randomUUID(), e.id(), no, e.slug(), Map.of("title", "rev" + no), at, null,
                e.contentTypeKey());
    }

    private List<String> slugs(ContentTypeRecord type, String q) {
        return store.listEntries(type.id(), List.of(), false, q, null, null).stream().map(EntryRecord::slug).toList();
    }
}
```

`src/test/java/com/fallrising/cms/contract/InMemoryContentStoreContractTests.java`：

```java
package com.fallrising.cms.contract;

import com.fallrising.cms.content.store.ContentStore;
import com.fallrising.cms.content.store.InMemoryContentStore;

class InMemoryContentStoreContractTests extends ContentStoreContract {

    @Override
    protected ContentStore newStore() {
        return new InMemoryContentStore();
    }
}
```

`src/test/java/com/fallrising/cms/contract/MediaStoreContract.java`：

```java
package com.fallrising.cms.contract;

import com.fallrising.cms.media.domain.MediaAsset;
import com.fallrising.cms.media.domain.MediaAttachment;
import com.fallrising.cms.media.domain.MediaVariant;
import com.fallrising.cms.media.store.MediaStore;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/** Behaviour every MediaStore must have (BD-10). */
public abstract class MediaStoreContract {

    protected static final Instant T0 = Instant.parse("2026-01-01T00:00:00Z");

    protected MediaStore store;

    protected abstract MediaStore newStore();

    @BeforeEach
    void setUpStore() {
        store = newStore();
    }

    @Test
    void B08_mediaRoundTripWithVariants() {
        MediaAsset asset = asset(UUID.randomUUID(), "available", null, T0);
        store.insert(asset);
        MediaVariant original = variant(asset.id(), "original", "image/png", 100, 640, 480);
        MediaVariant thumb = variant(asset.id(), "thumbnail", "image/jpeg", 10, 320, 240);
        store.insertVariant(original);
        store.insertVariant(thumb);

        MediaAsset found = store.find(asset.id()).orElseThrow();
        assertThat(found).usingRecursiveComparison().ignoringFields("variants").isEqualTo(asset);
        assertThat(found.variants()).containsExactlyInAnyOrder(original, thumb);
        assertThat(store.variantsOf(asset.id())).containsExactlyInAnyOrder(original, thumb);
    }

    @Test
    void B08_unknownMediaIsEmpty() {
        assertThat(store.find(UUID.randomUUID())).isEmpty();
        assertThat(store.variantsOf(UUID.randomUUID())).isEmpty();
        assertThat(store.attachmentsOfMedia(UUID.randomUUID())).isEmpty();
    }

    @Test
    void B08_listAvailableExcludesDeletedNewestFirst() {
        UUID owner = UUID.randomUUID();
        MediaAsset older = asset(owner, "available", null, T0.plusSeconds(1));
        MediaAsset newer = asset(owner, "available", null, T0.plusSeconds(2));
        MediaAsset deleted = asset(owner, "deleted", T0.plusSeconds(4), T0.plusSeconds(3));
        MediaAsset inconsistent = asset(owner, "available", T0.plusSeconds(6), T0.plusSeconds(5));
        List.of(older, newer, deleted, inconsistent).forEach(store::insert);
        assertThat(store.listAvailable()).extracting(MediaAsset::id).containsExactly(newer.id(), older.id());
    }

    @Test
    void B08_updateChangesOnlyMutableColumns() {
        MediaAsset asset = asset(UUID.randomUUID(), "available", null, T0);
        store.insert(asset);
        MediaAsset changed = new MediaAsset(asset.id(), UUID.randomUUID(), "New title", "New alt", "renamed.png",
                "application/pdf", 1, 999, 1, 1, "f".repeat(64), "deleted", T0.plusSeconds(9), T0.plusSeconds(8),
                T0.plusSeconds(9), List.of());
        store.update(changed);
        MediaAsset expected = new MediaAsset(asset.id(), asset.ownerPrincipalId(), "New title", "New alt",
                asset.originalFilename(), asset.contentType(), asset.byteSize(), 999, asset.width(), asset.height(),
                asset.checksumSha256(), "deleted", T0.plusSeconds(9), asset.createdAt(), T0.plusSeconds(9), List.of());
        assertThat(store.find(asset.id()).orElseThrow()).isEqualTo(expected);
    }

    @Test
    void B08_attachmentsReplacedPerEntry() {
        MediaAsset a = asset(UUID.randomUUID(), "available", null, T0);
        MediaAsset b = asset(UUID.randomUUID(), "available", null, T0);
        store.insert(a);
        store.insert(b);
        UUID entry1 = UUID.randomUUID();
        UUID entry2 = UUID.randomUUID();
        store.replaceAttachments(entry1, List.of(new MediaAttachment(a.id(), entry1, "cover", T0)));
        store.replaceAttachments(entry2, List.of(new MediaAttachment(a.id(), entry2, "media", T0)));
        assertThat(store.attachmentsOfMedia(a.id())).extracting(MediaAttachment::entryId)
                .containsExactlyInAnyOrder(entry1, entry2);

        store.replaceAttachments(entry1, List.of(new MediaAttachment(b.id(), entry1, "cover", T0)));
        assertThat(store.attachmentsOfMedia(a.id())).containsExactly(new MediaAttachment(a.id(), entry2, "media", T0));
        assertThat(store.attachmentsOfMedia(b.id())).containsExactly(new MediaAttachment(b.id(), entry1, "cover", T0));
    }

    @Test
    void B08_countsAndSumsIncludeDeleted() {
        UUID owner = UUID.randomUUID();
        store.insert(asset(owner, "available", null, T0));
        store.insert(asset(owner, "deleted", T0.plusSeconds(1), T0));
        store.insert(asset(UUID.randomUUID(), "available", null, T0));
        assertThat(store.countFiles()).isEqualTo(3);
        assertThat(store.sumStoredBytes()).isEqualTo(3 * 150L);
        assertThat(store.countByOwner(owner)).isEqualTo(2);
    }

    @Test
    void B08_defaultQuota() {
        assertThat(store.quota()).isEqualTo(new MediaStore.Quota(15_728_640L, 2_147_483_648L, 10_000, 2_000));
    }

    protected static MediaAsset asset(UUID owner, String status, Instant deletedAt, Instant createdAt) {
        return new MediaAsset(UUID.randomUUID(), owner, "Title", "Alt", "shot.png", "image/png", 100, 150, 640, 480,
                "a".repeat(64), status, deletedAt, createdAt, createdAt, List.of());
    }

    protected static MediaVariant variant(UUID mediaId, String name, String contentType, long bytes, Integer w, Integer h) {
        return new MediaVariant(mediaId, name, contentType, bytes, w, h, "media/" + mediaId + "/" + name);
    }
}
```

`src/test/java/com/fallrising/cms/contract/InMemoryMediaStoreContractTests.java`：

```java
package com.fallrising.cms.contract;

import com.fallrising.cms.media.store.InMemoryMediaStore;
import com.fallrising.cms.media.store.MediaStore;

class InMemoryMediaStoreContractTests extends MediaStoreContract {

    @Override
    protected MediaStore newStore() {
        return new InMemoryMediaStore();
    }
}
```

`src/test/java/com/fallrising/cms/contract/IdentityStoreContract.java`：

```java
package com.fallrising.cms.contract;

import com.fallrising.cms.identity.IdentityException;
import com.fallrising.cms.identity.domain.AuditEvent;
import com.fallrising.cms.identity.domain.Permission;
import com.fallrising.cms.identity.domain.Principal;
import com.fallrising.cms.identity.domain.PrincipalRoleAssignment;
import com.fallrising.cms.identity.domain.PrincipalStatus;
import com.fallrising.cms.identity.domain.Role;
import com.fallrising.cms.identity.domain.SessionRecord;
import com.fallrising.cms.identity.store.IdentityStore;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Behaviour every IdentityStore must have (BD-10). */
public abstract class IdentityStoreContract {

    protected static final Instant T0 = Instant.parse("2026-01-01T00:00:00Z");

    protected IdentityStore store;

    protected abstract IdentityStore newStore();

    @BeforeEach
    void setUpStore() {
        store = newStore();
    }

    @Test
    void B08_principalRoundTripAndCaseInsensitiveUsername() {
        Principal anna = principal("anna");
        store.insertPrincipal(anna);
        assertThat(store.findPrincipalById(anna.id())).contains(anna);
        assertThat(store.findPrincipalByUsername("ANNA")).contains(anna);
        assertThat(store.findPrincipalByUsername("nobody")).isEmpty();
    }

    @Test
    void B08_deletedPrincipalIsHidden() {
        Principal gone = principal("gone");
        store.insertPrincipal(gone);
        store.updatePrincipal(new Principal(gone.id(), "gone", "gone", null, PrincipalStatus.ACTIVE, 0, null, null,
                T0, T0.plusSeconds(1), T0.plusSeconds(1)));
        assertThat(store.findPrincipalById(gone.id())).isEmpty();
        assertThat(store.findPrincipalByUsername("gone")).isEmpty();
        assertThat(store.listPrincipals()).isEmpty();
    }

    @Test
    void B08_listPrincipalsOrderedByUsername() {
        store.insertPrincipal(principal("carl"));
        store.insertPrincipal(principal("anna"));
        store.insertPrincipal(principal("bert"));
        assertThat(store.listPrincipals()).extracting(Principal::username).containsExactly("anna", "bert", "carl");
    }

    @Test
    void B08_duplicateUsernameIsRejected() {
        store.insertPrincipal(principal("anna"));
        assertThatThrownBy(() -> store.insertPrincipal(principal("anna"))).isInstanceOf(RuntimeException.class);
    }

    @Test
    void B08_updatePrincipalPersistsMutableColumns() {
        Principal anna = principal("anna");
        store.insertPrincipal(anna);
        Principal changed = new Principal(anna.id(), "anna", "Anna B", "anna@example.test", PrincipalStatus.LOCKED, 3,
                T0.plusSeconds(60), T0.plusSeconds(5), T0, T0.plusSeconds(6), null);
        store.updatePrincipal(changed);
        assertThat(store.findPrincipalById(anna.id())).contains(changed);
    }

    @Test
    void B08_passwordCredentialUpsert() {
        Principal anna = principal("anna");
        store.insertPrincipal(anna);
        assertThat(store.findPasswordCredential(anna.id())).isEmpty();
        store.upsertPasswordCredential(anna.id(), "hash-1", "argon2id");
        UUID firstId = store.findPasswordCredential(anna.id()).orElseThrow().id();
        store.upsertPasswordCredential(anna.id(), "hash-2", "argon2id");
        var credential = store.findPasswordCredential(anna.id()).orElseThrow();
        assertThat(credential.id()).isEqualTo(firstId);
        assertThat(credential.principalId()).isEqualTo(anna.id());
        assertThat(credential.type()).isEqualTo("password");
        assertThat(credential.secretHash()).isEqualTo("hash-2");
        assertThat(credential.algo()).isEqualTo("argon2id");
    }

    @Test
    void B08_rolesOrderedByCode() {
        store.insertRole(role("member"));
        store.insertRole(role("admin"));
        store.insertRole(role("editor"));
        assertThat(store.listRoles()).extracting(Role::code).containsExactly("admin", "editor", "member");
        assertThat(store.findRoleByCode("admin")).isPresent();
        assertThat(store.findRoleByCode("missing")).isEmpty();
    }

    @Test
    void B08_roleAssignmentsRoundTrip() {
        Principal anna = principal("anna");
        store.insertPrincipal(anna);
        Role editor = role("editor");
        store.insertRole(editor);
        PrincipalRoleAssignment assignment = new PrincipalRoleAssignment(anna.id(), editor.id(), "editor", List.of("album", "photo"));
        store.replacePrincipalRoles(anna.id(), List.of(assignment));
        assertThat(store.rolesOf(anna.id())).containsExactly(assignment);
        store.replacePrincipalRoles(anna.id(), List.of());
        assertThat(store.rolesOf(anna.id())).isEmpty();
    }

    @Test
    void B08_permissionsOrderedByActionAndPredicatePreserved() throws Exception {
        Role editor = role("editor");
        store.insertRole(editor);
        String predicate = "{\"type\":\"fieldEquals\",\"field\":\"ownerPrincipalId\",\"value\":\"$currentPrincipalId\"}";
        store.replaceRolePermissions(editor.id(), List.of(
                permission(editor.id(), "read_draft", "pet", predicate, List.of("back")),
                permission(editor.id(), "create", "pet", null, List.of("back", "admin")),
                permission(editor.id(), "publish", null, null, List.of("admin"))));
        List<Permission> found = store.permissionsOfRole(editor.id());
        assertThat(found).extracting(Permission::action).containsExactly("create", "publish", "read_draft");
        assertThat(found.get(0).allowedSurfaces()).containsExactly("back", "admin");
        assertThat(found.get(1).contentTypeCode()).isNull();
        ObjectMapper json = new ObjectMapper();
        assertThat(json.readTree(found.get(2).predicateJson())).isEqualTo(json.readTree(predicate));
    }

    @Test
    void B08_sessionTouchAndRevoke() {
        Principal anna = principal("anna");
        store.insertPrincipal(anna);
        SessionRecord session = session(anna.id(), new byte[] {1, 2, 3}, T0.plusSeconds(3600));
        store.insertSession(session);
        assertThat(store.findSessionByTokenHash(new byte[] {1, 2, 3})).isPresent();
        assertThat(store.findSessionByTokenHash(new byte[] {9})).isEmpty();

        assertThat(store.touchSession(session.id(), T0.plusSeconds(10), T0.plusSeconds(7200), T0.plusSeconds(10))).isTrue();
        SessionRecord touched = store.findSessionByTokenHash(new byte[] {1, 2, 3}).orElseThrow();
        assertThat(touched.lastSeenAt()).isEqualTo(T0.plusSeconds(10));
        assertThat(touched.expiresAt()).isEqualTo(T0.plusSeconds(7200));

        assertThat(store.touchSession(session.id(), T0.plusSeconds(8000), T0.plusSeconds(9000), T0.plusSeconds(8000))).isFalse();

        store.revokeSession(session.id(), T0.plusSeconds(20));
        assertThat(store.findSessionByTokenHash(new byte[] {1, 2, 3}).orElseThrow().revokedAt()).isEqualTo(T0.plusSeconds(20));
        assertThat(store.touchSession(session.id(), T0.plusSeconds(21), T0.plusSeconds(7200), T0.plusSeconds(21))).isFalse();
    }

    @Test
    void B08_revokeAllForPrincipalKeepsException() {
        Principal anna = principal("anna");
        store.insertPrincipal(anna);
        SessionRecord keep = session(anna.id(), new byte[] {1}, T0.plusSeconds(3600));
        SessionRecord drop = session(anna.id(), new byte[] {2}, T0.plusSeconds(3600));
        store.insertSession(keep);
        store.insertSession(drop);
        store.revokeAllForPrincipal(anna.id(), T0.plusSeconds(5), keep.id());
        assertThat(store.findSessionByTokenHash(new byte[] {1}).orElseThrow().revokedAt()).isNull();
        assertThat(store.findSessionByTokenHash(new byte[] {2}).orElseThrow().revokedAt()).isEqualTo(T0.plusSeconds(5));
        store.revokeAllForPrincipal(anna.id(), T0.plusSeconds(6), null);
        assertThat(store.findSessionByTokenHash(new byte[] {1}).orElseThrow().revokedAt()).isEqualTo(T0.plusSeconds(6));
    }

    @Test
    void B08_auditNewestFirstAndFilters() {
        UUID target = UUID.randomUUID();
        AuditEvent first = audit("LOGIN_SUCCESS", target, T0.plusSeconds(1));
        AuditEvent second = audit("LOGOUT", target, T0.plusSeconds(2));
        AuditEvent third = audit("LOGIN_SUCCESS", UUID.randomUUID(), T0.plusSeconds(3));
        store.insertAudit(first);
        store.insertAudit(second);
        store.insertAudit(third);
        assertThat(store.listAudits(null, null)).extracting(AuditEvent::id).containsExactly(third.id(), second.id(), first.id());
        assertThat(store.listAudits("", null)).hasSize(3);
        assertThat(store.listAudits("LOGIN_SUCCESS", null)).extracting(AuditEvent::id).containsExactly(third.id(), first.id());
        assertThat(store.listAudits(null, target)).extracting(AuditEvent::id).containsExactly(second.id(), first.id());
        assertThat(store.listAudits("LOGOUT", target)).containsExactly(second);
    }

    @Test
    void B08_lastAdminGuard() {
        Role admin = role("admin");
        store.insertRole(admin);
        store.insertPermission(permission(admin.id(), "manage_principals", null, null, List.of("admin")));
        Principal root = principal("root");
        store.insertPrincipal(root);
        store.replacePrincipalRoles(root.id(), List.of(new PrincipalRoleAssignment(root.id(), admin.id(), "admin", List.of())));
        assertThat(store.countUsableAdmins()).isEqualTo(1);

        assertThatThrownBy(() -> store.replacePrincipalRolesKeepingUsableAdmin(root.id(), List.of()))
                .isInstanceOf(IdentityException.class);
        assertThatThrownBy(() -> store.updatePrincipalKeepingUsableAdmin(
                new Principal(root.id(), "root", "root", null, PrincipalStatus.DISABLED, 0, null, null, T0, T0, null)))
                .isInstanceOf(IdentityException.class);
        assertThatThrownBy(() -> store.replaceRolePermissionsKeepingUsableAdmin(admin.id(), List.of()))
                .isInstanceOf(IdentityException.class);

        assertThat(store.countUsableAdmins()).isEqualTo(1);
        assertThat(store.rolesOf(root.id())).hasSize(1);
        assertThat(store.findPrincipalById(root.id()).orElseThrow().status()).isEqualTo(PrincipalStatus.ACTIVE);
        assertThat(store.permissionsOfRole(admin.id())).hasSize(1);
    }

    protected static Principal principal(String username) {
        return new Principal(UUID.randomUUID(), username, username, null, PrincipalStatus.ACTIVE, 0, null, null, T0, T0, null);
    }

    protected static Role role(String code) {
        return new Role(UUID.randomUUID(), code, code, true, T0);
    }

    protected static Permission permission(UUID roleId, String action, String contentType, String predicate, List<String> surfaces) {
        return new Permission(UUID.randomUUID(), roleId, action, contentType, predicate, surfaces, T0);
    }

    protected static SessionRecord session(UUID principalId, byte[] hash, Instant expiresAt) {
        return new SessionRecord(UUID.randomUUID(), principalId, hash, T0, expiresAt, T0, null, "back", null, null);
    }

    protected static AuditEvent audit(String action, UUID target, Instant at) {
        return new AuditEvent(UUID.randomUUID(), at, null, "AUTH", action, "principal", target, "admin", "ok", null, null);
    }
}
```

`src/test/java/com/fallrising/cms/contract/InMemoryIdentityStoreContractTests.java`：

```java
package com.fallrising.cms.contract;

import com.fallrising.cms.identity.store.IdentityStore;
import com.fallrising.cms.identity.store.InMemoryIdentityStore;

class InMemoryIdentityStoreContractTests extends IdentityStoreContract {

    @Override
    protected IdentityStore newStore() {
        return new InMemoryIdentityStore();
    }
}
```

### 7.7 JDBC 契約（`src/integrationTest/.../contract/`）

`PostgresFixture` 用 Testcontainers 的 singleton container 寫法：整個 `integrationTest` 只啟動一個 `postgres:16-alpine`（與既有 `JdbcIdentityStoreIntegrationTests` 相同的映像），每次 `cleanDataSource()` 都以 Flyway `clean` + `migrate` 重建 schema，所以每個案例都拿到空資料庫。既有的 `JdbcIdentityStoreIntegrationTests` 不改，仍自己啟動一個 container。

`src/integrationTest/java/com/fallrising/cms/contract/PostgresFixture.java`：

```java
package com.fallrising.cms.contract;

import org.flywaydb.core.Flyway;
import org.postgresql.ds.PGSimpleDataSource;
import org.testcontainers.containers.PostgreSQLContainer;

import javax.sql.DataSource;

/** One PostgreSQL 16 container for all store contract tests; every call returns a freshly migrated schema. */
final class PostgresFixture {

    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    static {
        POSTGRES.start();
    }

    private PostgresFixture() {}

    static DataSource cleanDataSource() {
        PGSimpleDataSource dataSource = new PGSimpleDataSource();
        dataSource.setURL(POSTGRES.getJdbcUrl());
        dataSource.setUser(POSTGRES.getUsername());
        dataSource.setPassword(POSTGRES.getPassword());
        Flyway.configure().dataSource(dataSource).locations("classpath:db/migration").cleanDisabled(false).load().clean();
        Flyway.configure().dataSource(dataSource).locations("classpath:db/migration").load().migrate();
        return dataSource;
    }
}
```

`src/integrationTest/java/com/fallrising/cms/contract/JdbcContentStoreContractTests.java`：

```java
package com.fallrising.cms.contract;

import com.fallrising.cms.content.store.ContentStore;
import com.fallrising.cms.content.store.JdbcContentStore;
import com.fasterxml.jackson.databind.ObjectMapper;

class JdbcContentStoreContractTests extends ContentStoreContract {

    @Override
    protected ContentStore newStore() {
        return new JdbcContentStore(PostgresFixture.cleanDataSource(), new ObjectMapper());
    }
}
```

`src/integrationTest/java/com/fallrising/cms/contract/JdbcMediaStoreContractTests.java`：

```java
package com.fallrising.cms.contract;

import com.fallrising.cms.media.store.JdbcMediaStore;
import com.fallrising.cms.media.store.MediaStore;

class JdbcMediaStoreContractTests extends MediaStoreContract {

    @Override
    protected MediaStore newStore() {
        return new JdbcMediaStore(PostgresFixture.cleanDataSource());
    }
}
```

`src/integrationTest/java/com/fallrising/cms/contract/JdbcIdentityStoreContractTests.java`：

```java
package com.fallrising.cms.contract;

import com.fallrising.cms.identity.store.IdentityStore;
import com.fallrising.cms.identity.store.JdbcIdentityStore;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import javax.sql.DataSource;

class JdbcIdentityStoreContractTests extends IdentityStoreContract {

    @Override
    protected IdentityStore newStore() {
        DataSource dataSource = PostgresFixture.cleanDataSource();
        return new JdbcIdentityStore(dataSource, new TransactionTemplate(new DataSourceTransactionManager(dataSource)));
    }
}
```

### 7.8 故障注入

本波次沒有 MSW 情境與 `page.route`。故障以輸入構造（§7.3）與直接呼叫 handler（§7.5）注入；資料庫故障不另外模擬，由 §7.5 保證任何未預期例外都變成 500 `INTERNAL_ERROR`。

---

## 8. 失敗模式對照

| FM ID | 失敗情境 | 期望行為 | 由哪個測試覆蓋 | 任務卡 |
| --- | --- | --- | --- | --- |
| BW0-FM01 | 未登入呼叫需登入的 API | 401 `UNAUTHENTICATED`，`ErrorEnvelope`，`requestId` 回傳 | `ErrorEnvelopeTests.B14_filterErrorEchoesRequestId`；既有 `IdentityAuthTests.meWithoutSessionIs401` | T06、T08 |
| BW0-FM02 | 錯誤 surface（Front 呼叫工作 API、Back 呼叫治理 API） | 403 `SURFACE_FORBIDDEN`，含 `action`、`surface` | 既有 `IdentityAuthTests.adminGovernanceRejectedOnFront`、`IdentitySurfaceHardeningTests`、`WaveEAcceptanceTests.tRbacFFrontCannotReadDrafts`，並經全域契約驗證 | T05 |
| BW0-FM03 | 權限不足 | 403 `FORBIDDEN`，含 `action`、`contentType`、`surface` | 既有 `IdentityAuthTests.editorPublishIsForbidden`，並經全域契約驗證 | T05 |
| BW0-FM04 | CSRF header 缺漏 | 403 `CSRF_FAILED` | 既有 `IdentityAuthTests.csrfRequiredForCookieMutatingRequests` | T05 |
| BW0-FM05 | 驗證失敗：JSON 無法解析、UUID 格式錯、`ref.*` 不是 UUID、未知 principal status、缺上傳檔 | 400 `VALIDATION_FAILED` | `ErrorEnvelopeTests` #1、#2、#3、#7、#8 | T06、T08、T09 |
| BW0-FM06 | 欄位驗證失敗 | 422 `FIELD_VALIDATION` | 既有 `DemoPackTests`（`FIELD_VALIDATION`），並經全域契約驗證 | T05 |
| BW0-FM07 | 版本衝突 | 409 `VERSION_CONFLICT` | `ErrorEnvelopeTests.B14_staleVersionIsVersionConflict` | T06 |
| BW0-FM08 | 資源不存在 | 404 `ENTRY_NOT_FOUND`（controller 層）；未知路由 404 `ROUTE_NOT_FOUND` | `ErrorEnvelopeTests` #10、#5 | T06、T08 |
| BW0-FM09 | 錯的 method、錯的 Content-Type | 405 `METHOD_NOT_ALLOWED`；415 `MEDIA_TYPE_NOT_SUPPORTED` | `ErrorEnvelopeTests` #4、#6 | T06、T08 |
| BW0-FM10 | 依賴服務失敗（資料庫錯誤或任何未預期例外） | 500 `INTERNAL_ERROR`，message 固定、不洩漏例外內容，伺服器端 `log.error` | `ApiExceptionHandlerTests.B14_unexpectedExceptionIsInternalErrorWithoutDetails` | T06、T08 |
| BW0-FM11 | 新增錯誤代碼卻沒更新 OpenAPI | `ErrorCodeContractTests` 失敗 | `ErrorCodeContractTests.B14_errorCodeEnumMatchesOpenApi` | T06、T07 |
| BW0-FM12 | 實作回應與契約不符（多了屬性、少了必填、沒記載的狀態） | 該 MockMvc 測試以 `Response does not match openapi.yaml` 失敗。**處理方式**：本檔的契約已在預演中通過全部既有測試，所以先檢查是不是自己的程式改錯；若確定是契約漏記既有行為，停止並在 PR 說明提出（附驗證器訊息），不要自行改 YAML | `OpenApiResponseValidatorSelfTests`；全部 MockMvc 測試 | T02、T05 |
| BW0-FM13 | 某個 operation 缺 schema、缺 401／500、錯誤回應沒用 `$ref` | `OpenApiCompletenessTests` 失敗 | `OpenApiCompletenessTests.B01_everyOperationHasSuccessSchemaAndErrors` | T03 |
| BW0-FM14 | in-memory 與 JDBC 行為不一致 | 同一個契約案例在 `test` 綠、在 `integrationTest` 紅（或相反） | §7.6 全部案例 | T10～T14 |
| BW0-FM15 | 在 PostgreSQL 上移除最後一個 admin | 403 `LAST_ADMIN`／`IdentityException`，資料不變（B-15） | `B08_lastAdminGuard`（JDBC）；既有 `JdbcIdentityStoreIntegrationTests.lastAdminGuardRejectsRemovingAdministrativeCapability` | T13、T14 |
| BW0-FM16 | 本機沒有 Docker | `integrationTest` 以 Testcontainers 找不到 Docker 失敗；這是環境限制，不是程式錯誤。以 CI 的 `java-integration` job 為準，並在 PR 說明寫明 | 無（環境）；CI job | T13～T15 |
| BW0-FM17 | 依賴改了但 lockfile 沒更新 | 依賴解析失敗，`./gradlew test` 無法編譯 | Gradle 本身（T16 步驟 3 實測） | T16 |
| BW0-FM18 | Maven Central 回 HTTP 429 | 依賴下載失敗；等候後重試，不改 repository 設定 | 無（環境） | T01、T16 |

BW0-FM16、FM18 是環境問題，沒有自動測試，登記為 [BQ-09](../02-backend-sdd.md#8-開放問題)。

---

## 9. 交付檢查表

實作者開 PR 前逐項打勾，貼進 PR 說明：

- [ ] T01～T17 全部完成。
- [ ] `./gradlew test` 全綠（在 `apps/cms-scaffold`；預期 53 個既有＋58 個新增＝111 個）。
- [ ] `./gradlew integrationTest` 全綠（44 個）；本機沒有 Docker 時勾「只在 CI 跑過」並附 CI job 連結。
- [ ] `npm ci && npm run lint && npm run typecheck && npm test && npm run build` 全綠（本波不改前端，仍依 AGENTS.md 閘門執行）。
- [ ] `cmp docs/v2/contracts/BW0.openapi.yaml services/cms-api/src/main/resources/openapi/openapi.yaml` 沒有輸出。
- [ ] B-01：`OpenApiCompletenessTests` 綠，且 §5.5 的全域驗證已啟用（`OpenApiValidationConfig` 存在）。
- [ ] B-08：三個 `InMemory*ContractTests` 與三個 `Jdbc*ContractTests` 綠；CI 有 `java-integration` job。
- [ ] B-14：`src/main` 只剩一個 `@RestControllerAdvice`（`grep -rln "@RestControllerAdvice" services/cms-api/src/main` 只輸出 `ApiExceptionHandler.java`）；`ErrorCodeContractTests` 綠。
- [ ] B-15：`JdbcIdentityStoreIntegrationTests` 全綠。
- [ ] `services/cms-api/gradle.lockfile` 由 `--write-locks` 產生並已 commit。
- [ ] 沒有秘密或密碼：`git diff origin/main --stat` 中沒有 `local/`、`.env`；新檔案沒有出現 seed 密碼的值（`grep -rn "seed-password" services/cms-api/src/test/java` 只出現 `@Value("${cms.identity.seed-password}")`）。
- [ ] 相對連結有效（README 的修改只有程式碼區塊與一段文字）。
- [ ] `docs/v2/README.md` 的 BW0 狀態已改成 `VERIFIED`。
- [ ] PR 說明列出實際跑過的指令與結果（測試數、失敗數），以及沒跑的項目與原因。

---

## 10. BW0 必寫內容索引

| REFINE-PROMPT 要求 | 位置 |
| --- | --- |
| 現有每一個 operation 的完整 schema，逐一列出 | §4.2 表格；全文在 `contracts/BW0.openapi.yaml` |
| `ErrorCode` 全清單（盤點所有 `ContentException`、`IdentityException`、`MediaException`） | §4.5 |
| store 契約測試的案例清單 | §7.6 |
| CI 新 job 的完整 YAML | §5.7 |
| dependency locking 的步驟 | §5.8 |

# BW6 前端缺口的後端收尾施工圖

日期：2026-10-06。文件交付候選；DOC_READY 隨本波文件 PR 通過必要 CI／審查並合併生效。基準 `28282404d07a7898d48b9ec3ac8fb79c8711c9d9`；CMS source 與 W5 #300 的 `147f3cde4a5dad653a46ebc0dbfa89fd8ccefefb` 相同。本次只交付文件，沒有實作以下 API 或 migration。

## 1 範圍

承接 [01 §13](../01-frontend-sdd.md#13-開放問題與已知衝突) 的 Q-12、Q-14、Q-17、Q-20、Q-23、Q-24、Q-25、Q-26 與 [02 §8 BQ-14](../02-backend-sdd.md#8-開放問題)。八題此前均已選 A；BQ-14 於2026-10-06另批准B：現有模型逐類型 operator grants，標準種子精確匹配轉換、客製保留並回報未套用、未來類型明確授權。Q-12 使用最新批准regex，Q-25 SELF使用最新批准403，不以較早kernel/surface文字覆蓋。對應 V2-AC-15（使用者文案）與V2-AC-16（品質閘門）延續既有規則；本波不重定已完成的驗收ID。

不做：W6畫面、新增角色/assignment action cap、自訂角色CRUD、media硬刪/配額編輯、type defaultVisibility/surfaces編輯、PrincipalPicker新端點、token預覽、批次UI、深色模式、Front prerender、新依賴、demo專用kernel/API/資料表、部署/release/正式生產可用宣告。clinic只是demo，CMS仍為通用kernel與三個獨立操作面。

## 2 先決條件

BW0～BW5、P0與W0～W5（含W3b）已VERIFIED，依[路線圖](../README.md#路線圖)。保留P0交易/CAS/媒體公開隔離、BW4 usable-admin advisory lock與審计交易、BW5公開published-ref索引/批次媒體與錯誤代碼、W5的runner/品質證據。不得重寫歷史migration V1～V9或Java V10。

JDK25；Node24.18.0；PostgreSQL16（integrationTest由既有Testcontainers啟動）。從 `apps/cms-scaffold` 執行以下命令；Gradle test不用Docker，integrationTest需Docker可用。密碼只讀 `CMS_E2E_PASSWORD`／gitignore local seed檔；文件不填任何值。無新增runtime/test依賴或環境權限。細化只寫docs/v2；下列檔案清單是未來實作者scope。

## 3 檔案清單

以下root-owned清單與兩份附錄的逐檔清單共同構成完整允許路徑，無清單外寫入。`新增`測試與Java record的精確檔名以附錄為準。兩份附錄指向同一wave；實作cards在§6全局編號。ContentTypeSeed由pack卡修改；SeedService/finalizer由身份卡修改，依序整合，不平行寫同一產品檔。

| 路徑（component根） | 動作 | 用途 | 對應任務卡 |
| --- | --- | --- | --- |
| `services/cms-api/src/main/resources/openapi/openapi.yaml` | 修改 | 各Green同步subset，BW6-T28整檔核對 | BW6-T28 |
| `packages/api/src/generated/schema.d.ts` | 修改 | codegen（BW6-T28） | BW6-T28 |
| `packages/api/src/schema.ts` | 修改 | 新generated aliases（BW6-T28） | BW6-T28 |
| `packages/api/src/work.ts` | 修改 | mediaPage與整庫adapter（BW6-T28） | BW6-T28 |
| `packages/api/src/keys.ts` | 修改 | MediaListParams與page cachekey（BW6-T28） | BW6-T28 |
| `packages/api/src/admin.ts` | 修改 | 明確purge body（BW6-T28） | BW6-T28 |
| `packages/api/src/client.test.ts` | 修改 | client Red/Green（BW6-T27/BW6-T28） | BW6-T27 |
| `packages/api/src/keys.test.ts` | 新增 | querykey Red/Green（BW6-T27/BW6-T28） | BW6-T27 |
| `packages/mocks/src/fixture-integrity.test.ts` | 修改 | typedprojection來源測試（BW6-T27/BW6-T29） | BW6-T27 |
| `packages/mocks/src/handlers/admin.ts` | 修改 | requiredprincipal投影（BW6-T29） | BW6-T29 |
| `packages/mocks/src/handlers/work.ts` | 修改 | MediaAssetPage與deletedAt投影（BW6-T29） | BW6-T29 |
| `packages/mocks/src/fixtures.gen.ts` | 修改 | 由原gen script產生（BW6-T29） | BW6-T29 |
| `packages/mocks/fixtures/principals.json` | 修改 | 向前projection更新（BW6-T29） | BW6-T29 |
| `packages/mocks/fixtures/admin-content-types.json` | 修改 | 向前projection更新（BW6-T29） | BW6-T29 |
| `packages/mocks/fixtures/public-content-types.json` | 修改 | public enum labels由work schema同key取得 | BW6-T29 |
| `packages/mocks/fixtures/media-assets.json` | 修改 | 向前projection更新（BW6-T29） | BW6-T29 |
| `packages/mocks/fixtures/work-entries.json` | 修改 | 向前projection更新（BW6-T29） | BW6-T29 |
| `packages/mocks/fixtures/public-entries.json` | 修改 | 向前projection更新（BW6-T29） | BW6-T29 |
| `packages/mocks/fixtures/member-entries.json` | 修改 | 向前projection更新（BW6-T29） | BW6-T29 |
| `packages/mocks/fixtures/revisions.json` | 修改 | 向前projection更新（BW6-T29） | BW6-T29 |
| `.team/BW6-PLAN.md` | 新增 | 本波實作計畫，保留W5 PLAN | BW6-T30 |
| `.team/reports/BW6-DELIVERY.md` | 新增 | 實作evidence gate | BW6-T30 |
| `.team/reports/BW6-PUBLICATION.md` | 新增 | 遠端核對收據 | BW6-T30 |
| `docs/v2/bw6-remaining-work.md` | 修改 | 完成數與下一步 | BW6-T30 |
| `docs/v2/README.md` | 修改 | 實作狀態（BW6-T30） | BW6-T30 |
| `docs/v2/waves/BW6.md` | 修改 | 驗收證據指向（BW6-T30） | BW6-T30 |

| 路徑（component根） | 動作 | 用途 | 對應任務卡 |
| --- | --- | --- | --- |
| `services/cms-api/src/main/java/com/fallrising/cms/content/web/AdminContentController.java` | 修改 | key驗證、bulk counts接線 | BW6-T06/BW6-T04 |
| `services/cms-api/src/test/java/com/fallrising/cms/AdminInputValidationApiTests.java` | 修改 | key格式／Unicode其他欄位／無部分寫入 | BW6-T05 |
| `services/cms-api/src/main/java/com/fallrising/cms/media/query/MediaListQuery.java` | 新增 | parser與long offset | BW6-T07/BW6-T08 |
| `services/cms-api/src/main/java/com/fallrising/cms/media/query/MediaPage.java` | 新增 | store/service分頁record | BW6-T07/BW6-T08 |
| `services/cms-api/src/main/java/com/fallrising/cms/media/store/MediaStore.java` | 修改 | queryMedia介面 | BW6-T07/BW6-T08 |
| `services/cms-api/src/main/java/com/fallrising/cms/media/store/JdbcMediaStore.java` | 修改 | SQL count/page/batch variants | BW6-T08 |
| `services/cms-api/src/main/java/com/fallrising/cms/media/store/InMemoryMediaStore.java` | 修改 | 同契約filter/order/page | BW6-T08 |
| `services/cms-api/src/main/java/com/fallrising/cms/media/MediaException.java` | 修改 | existing VALIDATION_FAILED factory | BW6-T08 |
| `services/cms-api/src/test/java/com/fallrising/cms/media/query/MediaListQueryTests.java` | 新增 | parser案例 | BW6-T07 |
| `services/cms-api/src/test/java/com/fallrising/cms/contract/MediaStoreContract.java` | 修改 | same tests兩種store | BW6-T07 |
| `services/cms-api/src/main/java/com/fallrising/cms/media/service/MediaService.java` | 修改 | 授權先行、page回應、deletedAt投影 | BW6-T10 |
| `services/cms-api/src/main/java/com/fallrising/cms/media/web/MediaController.java` | 修改 | list envelope、metadata授權不掃整庫 | BW6-T10 |
| `services/cms-api/src/test/java/com/fallrising/cms/MediaListApiTests.java` | 新增 | list/default/validation/授權 | BW6-T09 |
| `services/cms-api/src/test/java/com/fallrising/cms/MediaErrorCodeApiTests.java` | 修改 | deleted metadata200和nullable欄位 | BW6-T09 |
| `services/cms-api/src/test/java/com/fallrising/cms/media/service/MediaListServiceTests.java` | 新增 | 授權先於parser/store與store failure | BW6-T09 |
| `services/cms-api/src/integrationTest/java/com/fallrising/cms/contract/MediaBatchQueryCountTests.java` | 修改 | list SQL數與metadata無library掃描 | BW6-T09 |
| `services/cms-api/src/main/java/com/fallrising/cms/content/web/PublicContentController.java` | 修改 | public enum labels | BW6-T12 |
| `services/cms-api/src/test/java/com/fallrising/cms/TypeSchemaTests.java` | 修改 | public visibility與Admin counts | BW6-T11/BW6-T03 |
| `services/cms-api/src/main/java/com/fallrising/cms/content/domain/ContentTypeRecord.java` | 修改 | 17-component record與相容constructor | BW6-T01/BW6-T02 |
| `services/cms-api/src/main/java/com/fallrising/cms/content/store/ContentStore.java` | 修改 | conditional pack與bulk counts | BW6-T01/BW6-T02/BW6-T03/BW6-T04 |
| `services/cms-api/src/main/java/com/fallrising/cms/content/store/JdbcContentStore.java` | 修改 | insert/mapper pack、conditionalupdate、aggregate | BW6-T02/BW6-T04 |
| `services/cms-api/src/main/java/com/fallrising/cms/content/store/InMemoryContentStore.java` | 修改 | preserve pack與same store契約 | BW6-T02/BW6-T04 |
| `services/cms-api/src/main/resources/db/migration/V11__content_type_pack.sql` | 新增 | 只新增nullable通用欄位 | BW6-T02 |
| `services/cms-api/src/main/java/com/fallrising/cms/content/service/ContentTypeSeed.java` | 修改 | seed-only mapping與null backfill | BW6-T02 |
| `services/cms-api/src/test/java/com/fallrising/cms/contract/ContentStoreContract.java` | 修改 | pack/counters共用契約 | BW6-T01/BW6-T03 |
| `services/cms-api/src/test/java/com/fallrising/cms/content/service/ContentTypeSeedTests.java` | 修改 | new/old/custom pack保存 | BW6-T01 |
| `services/cms-api/src/integrationTest/java/com/fallrising/cms/contract/TypePackMigrationTests.java` | 新增 | V10→V11無內容改寫 | BW6-T01 |
| `services/cms-api/src/main/java/com/fallrising/cms/content/query/TypeEntryCounts.java` | 新增 | long counters | BW6-T03/BW6-T04 |
| `services/cms-api/src/main/java/com/fallrising/cms/content/web/ContentProjection.java` | 修改 | adminTypeSchema | BW6-T04 |
| `services/cms-api/src/integrationTest/java/com/fallrising/cms/contract/TypeEntryCountsQueryCountTests.java` | 新增 | 1/12 type固定一次SQL | BW6-T03 |
| `services/cms-api/src/main/resources/openapi/openapi.yaml` | 修改 | 各API Green卡同步當次operation/schema，不能延到最末共享卡 | BW6-T06/BW6-T10/BW6-T12/BW6-T04 |

| 路徑（component根） | 動作 | 用途 | 對應任務卡 |
| --- | --- | --- | --- |
| `services/cms-api/src/main/java/com/fallrising/cms/identity/domain/PrincipalAdminView.java` | 新增 | HTTP角色投影 | BW6-T13/BW6-T14 |
| `services/cms-api/src/main/java/com/fallrising/cms/identity/domain/IdentitySeedChange.java` | 新增 | 條件式seed輸入／結果record | BW6-T21 |
| `services/cms-api/src/main/java/com/fallrising/cms/identity/service/OperatorSeedPolicy.java` | 新增 | 精確canonical比對與typed grants | BW6-T20/BW6-T21 |
| `services/cms-api/src/main/java/com/fallrising/cms/identity/service/OperatorPermissionSeed.java` | 新增 | Order200 finalization | BW6-T20/BW6-T25 |
| `services/cms-api/src/main/java/com/fallrising/cms/identity/service/GovernanceDenialAudit.java` | 新增 | 一次獨立denied audit | BW6-T18 |
| `services/cms-api/src/main/java/com/fallrising/cms/identity/service/PrincipalAdminService.java` | 修改 | view/filter、email、SELF與denied | BW6-T14/BW6-T16/BW6-T18 |
| `services/cms-api/src/main/java/com/fallrising/cms/identity/service/SeedService.java` | 修改 | 新角色初始化與clinic保護 | BW6-T25 |
| `services/cms-api/src/main/java/com/fallrising/cms/identity/store/IdentityStore.java` | 修改 | role-filter／batch與CAS介面 | BW6-T13/BW6-T14/BW6-T22/BW6-T23 |
| `services/cms-api/src/main/java/com/fallrising/cms/identity/store/JdbcIdentityStore.java` | 修改 | 查詢與條件轉換／共同row locks | BW6-T14/BW6-T23 |
| `services/cms-api/src/main/java/com/fallrising/cms/identity/store/InMemoryIdentityStore.java` | 修改 | 查詢與synchronized snapshot rollback | BW6-T14/BW6-T23 |
| `services/cms-api/src/main/java/com/fallrising/cms/identity/web/PrincipalController.java` | 修改 | role query與全部投影 | BW6-T14 |
| `services/cms-api/src/main/java/com/fallrising/cms/identity/IdentityException.java` | 修改 | SELF403／CONFIRMATION_REQUIRED400 | BW6-T18 |
| `services/cms-api/src/main/java/com/fallrising/cms/api/error/ErrorCode.java` | 修改 | SELF403／CONFIRMATION_REQUIRED400 | BW6-T18 |
| `services/cms-api/src/main/java/com/fallrising/cms/content/web/AdminContentController.java` | 修改 | purge確認及單次拒絕審計 | BW6-T18 |
| `services/cms-api/src/main/java/com/fallrising/cms/content/service/EntryService.java` | 修改 | purge確認及單次拒絕審計 | BW6-T18 |
| `services/cms-api/src/test/java/com/fallrising/cms/PrincipalGovernanceApiTests.java` | 新增 | Q23、SELF與授權 | BW6-T13/BW6-T17 |
| `services/cms-api/src/test/java/com/fallrising/cms/AdminInputValidationApiTests.java` | 修改 | Q24紅綠回歸 | BW6-T15 |
| `services/cms-api/src/test/java/com/fallrising/cms/contract/IdentityStoreContract.java` | 修改 | Q23兩store一致 | BW6-T13 |
| `services/cms-api/src/test/java/com/fallrising/cms/EntryPurgeConfirmationApiTests.java` | 新增 | Q25確認與拒絕 | BW6-T17 |
| `services/cms-api/src/test/java/com/fallrising/cms/OperatorSeedPolicyTests.java` | 新增 | canonical／custom／restart | BW6-T20 |
| `services/cms-api/src/test/java/com/fallrising/cms/OperatorPermissionSeedTests.java` | 新增 | listener流程、seed-disabled | BW6-T20/BW6-T25 |
| `services/cms-api/src/test/java/com/fallrising/cms/contract/IdentitySeedStoreContract.java` | 新增 | CAS／rollback／race共用案例與memory adapter | BW6-T22 |
| `services/cms-api/src/test/java/com/fallrising/cms/contract/InMemoryIdentitySeedStoreContractTests.java` | 新增 | CAS／rollback／race共用案例與memory adapter | BW6-T22 |
| `services/cms-api/src/integrationTest/java/com/fallrising/cms/contract/JdbcIdentitySeedStoreContractTests.java` | 新增 | 同shared contract PostgreSQL adapter | BW6-T22 |
| `services/cms-api/src/integrationTest/java/com/fallrising/cms/contract/IdentitySeedConcurrencyTests.java` | 新增 | JDBC與管理寫入競爭／query數 | BW6-T22 |
| `services/cms-api/src/integrationTest/java/com/fallrising/cms/contract/IdentityAuditAtomicWriteTests.java` | 修改 | success／denied rollback與更新合法purge呼叫 | BW6-T19 |
| `services/cms-api/src/integrationTest/java/com/fallrising/cms/contract/EntryAtomicWriteTests.java` | 修改 | success／denied rollback與更新合法purge呼叫 | BW6-T19/BW6-T18 |
| `services/cms-api/src/main/java/com/fallrising/cms/content/service/DemoContentSeed.java` | 修改 | pending demo寫入前授權預檢與skip | BW6-T25 |
| `services/cms-api/src/test/java/com/fallrising/cms/content/service/DemoContentSeedTests.java` | 新增 | custom startup／predicate／兩順序／DB失敗 Red | BW6-T24 |
| `services/cms-api/src/test/java/com/fallrising/cms/ClinicAppointmentOperatorApiTests.java` | 新增 | 真實API Q26矩陣 | BW6-T26 |
| `services/cms-api/src/test/java/com/fallrising/cms/IdentityHardeningTests.java` | 修改 | SELF業務拒絕斷言同步、其他guard保留 | BW6-T18 |
| `services/cms-api/src/test/java/com/fallrising/cms/IdentityAuthTests.java` | 修改 | 舊sole-admin SELF斷言同步 | BW6-T26/BW6-T18 |
| `services/cms-api/src/test/java/com/fallrising/cms/WaveEAcceptanceTests.java` | 修改 | 原合法purge補body | BW6-T26/BW6-T18 |
| `services/cms-api/src/main/resources/openapi/openapi.yaml` | 修改 | BW6-T02同步Principal／CreatedPrincipal與list query、BW6-T04同步Patch email description、BW6-T06同步PurgeEntryRequest／operation／3 errors；先於各API綠燈。 | BW6-T14/BW6-T16/BW6-T18/BW6-T28 |

## 4 契約

完整 [BW6.openapi.yaml](../contracts/BW6.openapi.yaml) 是runtime `services/cms-api/src/main/resources/openapi/openapi.yaml` 的**整檔取代**：52 paths、保留全部原operation，沒有刪除舊endpoint。`x-bw6-source-sha256` 釘住實作前runtime契約；來源不同時先比較增量與已合併功能，不盲目覆寫。移除這個文件證據extension後複製進runtime；保留所有未改契約。現行operation的session/csrf/Origin gate仍以runtime controller/filter為準。

| operation | surface／action | 變更與錯誤 | 成功／失敗例 |
| --- | --- | --- | --- |
| POST /admin/content-types | ADMIN/manage_types | Q12新field key regex，422 FIELD_VALIDATION；Q20回pack/counts，既有其他400/401/403/415/500保留 | fields.key=a_0可建；a.b回fields[0].key INVALID_FORMAT且無寫入 |
| GET /media | BACK或ADMIN/manage_media | Q14 page=0,size=24(1..100),q；400 VALIDATION_FAILED重複/非法page,size；401/403/500保留 | 契約內空頁200；size=0回400 |
| POST /media；GET /media/{id}；公開metadata／嵌入 | 沿用每個operation授權 | 所有MediaAsset新增required nullable deletedAt；私有deleted metadata200/file410、公開deleted404或embedded null不變 | 已刪私有metadata有時間；Front不能讀私有GET |
| GET /public/content-types | FRONT/read_published或anonymous既有規則 | Q17只在public enabled enum輸出enumLabels；保留原錯誤 | 契約內public enum labels；internal/disabled欄位完全省略 |
| GET/POST /admin/content-types、enable/disable | ADMIN/manage_types | Q20 required pack nullable、entryCount/publishedCount int64≥0；bulk counts | custom空type:null/0/0；非admin403，無計數外洩 |
| GET /principals | ADMIN/manage_principals | Q23 role optional，blank不篩；重複/未知非空400 VALIDATION_FAILED；投影roles/lastLoginAt | 契約內roles admin,lastLoginAt null；role=unknown400 |
| GET/POST/PATCH principal、disable/unlock回應 | ADMIN/manage_principals | Principal/CreatedPrincipal新增required roles與nullable lastLoginAt；不回credential | 新建roles[]/lastLoginAt null；missing404 PRINCIPAL_NOT_FOUND |
| PATCH /principals/{id} | ADMIN/manage_principals | Q24 email省略/null不變、空字串清除；Q25自停用403 SELF_DISABLE_FORBIDDEN | email空字串回null；非空duplicate400 |
| POST /principals/{id}/disable；PUT /principals/{id}/roles | ADMIN/manage_principals | Q25 SELF_*403在LAST_ADMIN前；非self LAST_ADMIN403不變 | 保留admin的合法role修改204；自移除403 SELF_DEMOTION_FORBIDDEN |
| POST /admin/entries/{id}/purge | ADMIN且admin角色（沿用原gate） | Q25JSON confirmPhrase DELETE＋confirmId UUID/非空slug；缺/錯400 CONFIRMATION_REQUIRED；415非JSON；404/409/500保留 | 正確確認204；缺body400且只記denied |
| Q26 seed／既有content operations與capabilities | 沿用現有matcher與surface | clinic operator appointment_request只有read_draft/update；create/publish/unpublish/delete/archive403；其他demo既有動作保留 | member建draft→operator讀/patch200；operator直接publish403 |

prefix皆 `/api/v1`。未登入401、錯surface403 SURFACE_FORBIDDEN、缺action403 FORBIDDEN先於參數／資源查詢；錯誤格式沿用ErrorEnvelope。新ErrorCode只有CONFIRMATION_REQUIRED、SELF_DISABLE_FORBIDDEN、SELF_DEMOTION_FORBIDDEN。非法JSON/UUID由既有全局400處理，不存未驗證原文。DB/audit失敗沿用500 INTERNAL_ERROR，拒絕審計失敗不能吞掉成成功。

完整DDL、Java records、SQL與transaction分支見[內容／媒體附錄](../contracts/BW6-content-media.md)及[身份／治理附錄](../contracts/BW6-identity.md)。唯一schema migration是V11 nullable pack；deleted_at/last_login_at已存在，不重複新增。operator標準轉換使用身份store條件原子替換，不以Flyway硬編demo seed密碼或全體資料覆寫。

## 5 模組與元件規格

後端每個類別方法／store一致性／projection的精確規格由上述兩份附錄逐條定義。兩份附錄不得引用舊的通配operator初始化當作Q26完成，也Grant列表必須與標準九項完整match，不得只比對部分資料。

### 5.1 共用契約相容性（不提前實作W6畫面）

`packages/api/src/schema.ts`新增generated alias `MediaAssetPage=S["MediaAssetPage"]`、`PurgeEntryRequest=S["PurgeEntryRequest"]`。RoleAssignment/permission shape不變，不新增actionLimits。保留現有mediaList(signal?)與query factory供W2消費者；不能讓現有client分頁突然只讀server第一頁。

新增完整TypeScript型別及簽名：

```ts
export type MediaListParams = { page?: number; size?: number; q?: string };
// workApi returned object:
mediaPage(params: MediaListParams = {}, signal?: AbortSignal): Promise<MediaAssetPage>;
mediaList(signal?: AbortSignal): Promise<MediaAssetList>;
// workQueries:
mediaPage: (api: WorkApi, params: MediaListParams = {}) =>
  queryOptions({ queryKey: keys.media.page(params),
    queryFn: ({ signal }) => api.mediaPage(params, signal) });
// keys.ts exports normalizeMediaParams(params: MediaListParams = {}):
// { page: number; size: number; q: string } with defaults0/24/trimmed q.
// keys.media: keep all(), list(), detail(id), add:
page: (params: MediaListParams = {}) => ["media", "page", normalizeMediaParams(params)] as const;
// adminApi (old callers compile; server rejects absent confirmation):
purgeEntry(id: string, body?: PurgeEntryRequest): Promise<void>;
```

keys.media.page規格：page省略0、size省略24、q省略空字串且`trim()`；query與key用相同normalized params，讓q不同不共用cache。前端不校驗server的數值邊界，400由server處理；只保留server accepted q，不在前端執行name filter。mediaPage以generated GET `/api/v1/media` query傳params、signal。`purgeEntry`只送呼叫端提供的body，永不替使用者生成DELETE確認；舊UI的real purge會收到CONFIRMATION_REQUIRED直到W6送body。此安全收緊是已批准Q25，不以維持舊無確認成功降低backendgate；W4 mock的完整治理行為在W6同步，不能把BW6的fixture型別相容宣稱為W6完成。

mediaList相容adapter直接迭代mediaPage({page:0,size:100},signal)，固定同一total，page依次+1，所有返回items逐筆驗證id不重複。每頁items≤100；page/size回傳須等於request；total為safe nonnegative整數。累積達total即返回{items}；中途total改變、empty page但未達total、duplicates、超total或bad metadata拋Error，沿既有QueryBoundary error分支顯示／可重試，不靜默截斷。每次call前檢查signal.aborted並throw signal.reason或DOMException AbortError。不得使用Content1-based `completeList`。size100下，0筆1request、100筆1request、101筆2requests；server最新排序保留，並發變動明確error不宣稱快照隔離。

### 5.2 Fixture與MSW型別相容性

不改已完成波次的歷史docs fixture；在runtime `packages/mocks/fixtures`與generated fixtures作向前更新：public-content-types中每個enum field的enumLabels取work-content-types同type/key值，找不到時{}，nonenum省略；不新增field。principals每item的roles取me.json同id roles.code去重排序，未知id為[]，lastLoginAt=null；AdminContentType按本波seed mapping加pack並從work-entries未deleted計數；遞迴遇到MediaAsset形狀（id＋mediaId＋variants）加deletedAt=null，原有nonnull值保留，roles/counts也保留原內容來源。只對§3列出的JSON新增projection欄位，不改entryid/payload/status/version或會員owner。

`handlers/admin.ts` principalOf回傳的roles由db.principalRoles動態投影，新建principal初始化roles[]/lastLoginAt null；`handlers/work.ts` POST media初始化deletedAt null、privateGET已deleted提供固定fixture clock時間、公開GET保留404。GET media改成與server相同的0-basedpage/size/q/page metadata，搜title/originalFilename；fixture沒有originalFilename時以title為原檔名測試資料，不暴露新storage欄位。只補頁面與projection，不提前實作W6角色filter、SELF拒絕畫面、確認Dialog或clinic側欄；MSW與live差異明列於W6輸入，不以mock成功當real安全驗收。

文案表（W6接上新增錯誤的使用者copy key；沿用API message為開發診斷、不直接顯示的契約）：

| key | zh-Hant | 出現位置 |
| --- | --- | --- |
| error.CONFIRMATION_REQUIRED | 請確認要永久刪除的內容。 | entry purge400 |
| error.SELF_DISABLE_FORBIDDEN | 無法停用自己的帳號。 | SELF403 |
| error.SELF_DEMOTION_FORBIDDEN | 無法移除自己的管理員角色。 | SELF403 |
| error.media.invalidPage | 頁數必須是零或正整數。 | mediaquery400 |
| error.media.invalidSize | 每頁數量必須介於1與100。 | mediaquery400 |

seed未套用通知為operator維護log，不塞入產品畫面工程詞；只包含固定原因code、role code及seed username，不含密碼/token/permissions原文。

## 6 任務卡

共30張，S≤150/M≤400，含test-first功能卡、契約相容性與最終驗證；整檔YAML搬運與generated schema/fixture輸出另記artifact大小；實際手寫runtime OpenAPI subset與source/test差異計入卡大小，手寫source/test差異仍受400限制。實作卡不得標完成而只寫測試；Red卡保留意圖失敗命令與證據，實作卡再轉綠。若實際手寫差異超400，先回報重新拆卡，不能用大卡避開30張上限。

BW6-T01～BW6-T12的§引用指[內容／媒體附錄](../contracts/BW6-content-media.md)。

### BW6-T01 pack保存／migration Red

- **目標**：generic pack與新舊資料保留先有store/seed/migration測試。
- **輸入**：§7.1～7.3/§8.5，ContentStoreContract、ContentTypeSeedTests、PostgresFixture。
- **步驟**：1加17-component與13/16 constructor bridge以保留舊callers，withPack可先compile-only；2新增setTypePackIfAbsent default throw；3新增§8.5五具名case與TypePackMigrationTests；4保存pack conditional/seed mapping與V11 column missing的行為失敗，確認V7/V10仍可執行。
- **完成條件**：每種store、new/old/custom seed與V10upgrade都有case，不先改DDL使migrationRed消失。
- **驗證**：`./gradlew test --tests '*InMemoryContentStoreContractTests' --tests '*ContentTypeSeedTests' --no-daemon --no-parallel`；`./gradlew integrationTest --tests '*JdbcContentStoreContractTests' --tests '*TypePackMigrationTests' --no-daemon --no-parallel`。
- **對應 ID**：Q-20。
- **預估大小**：M（估360行；上限400行）。

### BW6-T02 pack保存／migration Green

- **目標**：通用column與seed回填保持客製資料。
- **輸入**：BW6-T01。
- **步驟**：1新增V11全文；2完成record三copy methods；3JDBC insert/mapper與memory updateType保存pack；4兩store atomic conditional寫；5seed-only十一項mapping與Order100保持；6移除scaffold，§8.5轉綠。
- **完成條件**：非nullpack/legacy key/payload/revision/ref/index/updatedAt保存，historyV10/V11成功；seed重跑不改值。
- **驗證**：`./gradlew test --tests '*InMemoryContentStoreContractTests' --tests '*ContentTypeSeedTests' --no-daemon --no-parallel`；`./gradlew integrationTest --tests '*JdbcContentStoreContractTests' --tests '*TypePackMigrationTests' --no-daemon --no-parallel`。
- **對應 ID**：Q-20。
- **預估大小**：M（估210行；上限400行）。

### BW6-T03 bulk counters／Admin Red

- **目標**：治理counts不使用public total、不逐type查詢。
- **輸入**：BW6-T02、§7.4/§8.6。
- **步驟**：1新增TypeEntryCounts宣告與entryCounts default throw；2新增兩ContentStoreContract tests；3TypeSchemaTests新增counts/error/response case；4新增TypeEntryCountsQueryCountTests；5§8.6記錄缺counts或未實作aggregate的行為失敗。
- **完成條件**：0entry、disabled、private/unlisted、deleted、transitions與固定SQL數均有assertion。
- **驗證**：`./gradlew test --tests '*InMemoryContentStoreContractTests' --tests '*TypeSchemaTests' --no-daemon --no-parallel`；`./gradlew integrationTest --tests '*JdbcContentStoreContractTests' --tests '*TypeEntryCountsQueryCountTests' --no-daemon --no-parallel`。
- **對應 ID**：Q-20。
- **預估大小**：M（估350行；上限400行）。

### BW6-T04 bulk counters／Admin Green

- **目標**：一次aggregate回所有requested types並維持所有Admin回應完整。
- **輸入**：BW6-T03。
- **步驟**：1實作兩store的singlebulk counts；2adminTypeSchema只加三治理欄；3AdminController list一次取得map，create/enable/disable取單ID同projection；4runtime openapi.yaml AdminContentType新增required pack(nullable string)、entryCount/publishedCount(integer int64 minimum0)；5移除scaffold；6§8.6轉綠。此卡在BW6-T06完整AdminInputValidationApiTests Green前完成。
- **完成條件**：§8.6綠、工作/公開schema不增治理欄位、500不回假0。
- **驗證**：`./gradlew test --tests '*InMemoryContentStoreContractTests' --tests '*TypeSchemaTests' --no-daemon --no-parallel`；`./gradlew integrationTest --tests '*JdbcContentStoreContractTests' --tests '*TypeEntryCountsQueryCountTests' --no-daemon --no-parallel`。
- **對應 ID**：Q-20。
- **預估大小**：M（估200行；上限400行）。

### BW6-T05 Q12拒絕案例

- **目標**：先證明不安全field key可被舊API接受的缺口。
- **輸入**：基準AdminInputValidationApiTests，§4/§8.1。
- **步驟**：1新增四具名case；2只替換舊emoji-key成功fixture而保留其他Unicodecase；3執行§8.1命令，保存Q12_rejectsUnsafeKeysBeforeAnyWrite的422 expectation失敗。
- **完成條件**：目標case在舊實作失敗，其他既有驗證case未被刪除。
- **驗證**：`./gradlew test --tests '*AdminInputValidationApiTests' --no-daemon --no-parallel`。
- **對應 ID**：Q-12。
- **預估大小**：S（估120行；上限150行）。

### BW6-T06 Q12 regex

- **目標**：完整收集fields[i].key格式錯誤。
- **輸入**：BW6-T05與BW6-T04已完成。counts/Admin Green須先完成，避免完整class中的新建type成功回應缺少required pack/counts。
- **步驟**：1按§4在length後、duplicate前加regex分支；2保持其他驗證與write boundary；3runtime openapi.yaml的CreateFieldRequest.key加入pattern；4focused命令轉綠，不在此卡改生成檔。
- **完成條件**：§8.1全綠且legacy資料快照不變。
- **驗證**：`./gradlew test --tests '*AdminInputValidationApiTests' --no-daemon --no-parallel`。
- **對應 ID**：Q-12。
- **預估大小**：S（估30行；上限150行）。

### BW6-T07 Media query/store Red

- **目標**：兩種store的filtered total與stable paging先有失敗契約。
- **輸入**：§5與§8.2，現有MediaStoreContract/兩runner。
- **步驟**：1新增MediaListQuery、MediaPage宣告與parse scaffold、新queryMedia default scaffold；2新增parser與四store case；3分別執行§8.2兩命令，記錄未實作queryMedia/parse造成指定case失敗，不以編譯失敗代替。
- **完成條件**：parser default/strip與storepages失敗證據可辨认；舊listAvailable/配額契約仍可跑。
- **驗證**：`./gradlew test --tests '*MediaListQueryTests' --tests '*InMemoryMediaStoreContractTests' --no-daemon --no-parallel`；`./gradlew integrationTest --tests '*JdbcMediaStoreContractTests' --no-daemon --no-parallel`。
- **對應 ID**：Q-14。
- **預估大小**：M（估310行；上限400行）。

### BW6-T08 Media query/store Green

- **目標**：SQL與memory有同一分頁／搜尋行為。
- **輸入**：BW6-T07。
- **步驟**：1新增MediaException.invalidParameter；2完成parser固定分支；3兩store實作§5 count/page/hydration；4移除interface/scaffold throw；5focused轉綠，review不逐asset查variants。
- **完成條件**：§8.2全部綠，沒有unknown token、page overflow或wildcard擴張。
- **驗證**：`./gradlew test --tests '*MediaListQueryTests' --tests '*InMemoryMediaStoreContractTests' --no-daemon --no-parallel`；`./gradlew integrationTest --tests '*JdbcMediaStoreContractTests' --no-daemon --no-parallel`。
- **對應 ID**：Q-14。
- **預估大小**：M（估270行；上限400行）。

### BW6-T09 Media API與SQL上限 Red

- **目標**：先揭示API仍回items-only與metadata缺deletedAt。
- **輸入**：BW6-T08、§8.3、既有query-count counting helper。
- **步驟**：1新增MediaListApiTests/MediaListServiceTests；2在MediaErrorCodeApiTests擴充具名metadata/null案例；3在MediaBatchQueryCountTests加入pageSQL數；4用§8.3命令保存missing total/page/deletedAt的assertion failure。新service signatures如需編譯，先只加同名throw scaffold。
- **完成條件**：授權、400、nullable與SQL數每一項都有指定test，而非只happy path。
- **驗證**：`./gradlew test --tests '*MediaListApiTests' --tests '*MediaErrorCodeApiTests' --tests '*MediaListServiceTests' --tests '*MediaApiTests' --tests '*MediaBatchTests' --no-daemon --no-parallel`；`./gradlew integrationTest --tests '*MediaBatchQueryCountTests' --no-daemon --no-parallel`。
- **對應 ID**：Q-14。
- **預估大小**：M（估330行；上限400行）。

### BW6-T10 Media API／DTO Green

- **目標**：authorized page與deleted metadata正確投影。
- **輸入**：BW6-T09。
- **步驟**：1MediaService新增requireManage與三參數list；2MediaController list/get依§5接線；3json加nullable deletedAt，public固定null；4runtime openapi.yaml同步MediaAsset.required deletedAt及nullable date-time、MediaAssetPage schema、listMedia page/size/q參數與400 Error400回應；5刪舊list二參數與所有scaffold throw；6focused轉綠，不改bytes/public判斷。
- **完成條件**：§8.3綠、metadata不掃library、private410/public404保留。
- **驗證**：`./gradlew test --tests '*MediaListApiTests' --tests '*MediaErrorCodeApiTests' --tests '*MediaListServiceTests' --tests '*MediaApiTests' --tests '*MediaBatchTests' --no-daemon --no-parallel`；`./gradlew integrationTest --tests '*MediaBatchQueryCountTests' --no-daemon --no-parallel`。
- **對應 ID**：Q-14。
- **預估大小**：S（估115行；上限150行）。

### BW6-T11 Public enum Red

- **目標**：公開labels與visibility閘門先有失敗case。
- **輸入**：§6/§8.4與TypeSchemaTests。
- **步驟**：1建立完整六field fixture；2新增三具名test；3執行§8.4，visible labels assertion在舊投影失敗。
- **完成條件**：nonenum省略與back/internal/disabled排除的assertions存在。
- **驗證**：`./gradlew test --tests '*TypeSchemaTests' --no-daemon --no-parallel`。
- **對應 ID**：Q-17。
- **預估大小**：S（估140行；上限150行）。

### BW6-T12 Public enum Green

- **目標**：只公開合格enum labels。
- **輸入**：BW6-T11。
- **步驟**：1publicType保持filters；2新增publicField投影如§6；3runtime openapi.yaml PublicField新增optional enumLabels object、additionalProperties string，不改required三欄；4§8.4轉綠，不重用WorkField投影。
- **完成條件**：labels改名即讀新值，非public/disabled沒有metadata洩漏。
- **驗證**：`./gradlew test --tests '*TypeSchemaTests' --no-daemon --no-parallel`。
- **對應 ID**：Q-17。
- **預估大小**：S（估25行；上限150行）。


BW6-T13～BW6-T26的§引用指[身份／治理附錄](../contracts/BW6-identity.md)。

### BW6-T13 Q23測試先紅

- **目標**：先證明role filter／roles來源／lastLogin語義，Q-23。
- **輸入**：§3.1、test ApiFixture、IdentityStoreContract既有fixture；源碼PrincipalController當前投影。
- **步驟**：①新增PrincipalGovernanceApiTests的§7 R23-A/B；②shared IdentityStoreContract新增R23-S（本卡建立兩新store接口default throw UnsupportedOperationException與PrincipalAdminView宣告供編譯，API先觀察舊投影缺欄失敗；BW6-T14移除store scaffold，兩store同斷言）；③先跑API R23-A，記錄缺roles／role忽略導致的意圖失敗，不把編譯錯誤當行為紅燈。
- **完成條件**：`./gradlew test --tests 'com.fallrising.cms.PrincipalGovernanceApiTests'` R23-A為預期紅；store測試最終須在BW6-T14轉綠；保存exact失敗斷言。對應BW6-FM41、BW6-FM42、BW6-FM43。
- **驗證**：`./gradlew test --tests 'com.fallrising.cms.PrincipalGovernanceApiTests'`
- **對應 ID**：Q-23。
- **預估大小**：M（估360行，包含本卡測試／Java／runtime OpenAPI subset；超上限必拆卡）。

### BW6-T14 role SQL與投影

- **目標**：§3.1兩新store方法、view、service/controller全部Principal projection，Q-23。
- **輸入**：BW6-T13；已完成設計的full BW6契約Principal／CreatedPrincipal新schema（唯讀）。
- **步驟**：①新增PrincipalAdminView；②IdentityStore／兩store按SQL實現，空batch不查詢；③service驗證role、batch投影；④controller全回應改view（不能只有list）；⑤從full BW6契約同步runtime OpenAPI的Principal／CreatedPrincipal、GET principals query與400回應；⑥運行BW6-T13 API＋shared memory contract，JDBC斷言由BW6-T22的query數／store任務執行。
- **完成條件**：`./gradlew test --tests 'com.fallrising.cms.PrincipalGovernanceApiTests' --tests 'com.fallrising.cms.contract.InMemoryIdentityStoreContractTests'` 全綠；無domain/migration變更。BW6-FM41、BW6-FM42、BW6-FM43。
- **驗證**：`./gradlew test --tests 'com.fallrising.cms.PrincipalGovernanceApiTests' --tests 'com.fallrising.cms.contract.InMemoryIdentityStoreContractTests'`
- **對應 ID**：Q-23。
- **預估大小**：M（估390行，包含本卡測試／Java／runtime OpenAPI subset；超上限必拆卡）。

### BW6-T15 email清除先紅

- **目標**：Q-24，§7 R24。
- **輸入**：AdminInputValidationApiTests既有BQ08 fixture。
- **步驟**：①創建two accounts帶不同email；②missing/null keep、empty clears、second empty clears、Unicode／duplicate回歸；③以現程式先跑empty斷言確認為`""`非null失敗。
- **完成條件**：`./gradlew test --tests 'com.fallrising.cms.AdminInputValidationApiTests'` 新case意圖紅、既有case保留。BW6-FM44。
- **驗證**：`./gradlew test --tests 'com.fallrising.cms.AdminInputValidationApiTests'`
- **對應 ID**：Q-24。
- **預估大小**：S（估90行，包含本卡測試／Java／runtime OpenAPI subset；超上限必拆卡）。

### BW6-T16 email正規化

- **目標**：按§3.2在patch clear／validate／store，Q-24。
- **輸入**：BW6-T15；full BW6設計契約Patch schema description（唯讀）。
- **步驟**：①先compute clearEmail／validatedEmail；②validateProfile使用normalized；③withProfile用三個分支区別clear/null；④同步runtime OpenAPI PatchPrincipalRequest.email description；⑤運行BW6-T15。
- **完成條件**：`./gradlew test --tests 'com.fallrising.cms.AdminInputValidationApiTests'` 全綠；create與nonempty原樣行為不變。BW6-FM44。
- **驗證**：`./gradlew test --tests 'com.fallrising.cms.AdminInputValidationApiTests'`
- **對應 ID**：Q-24。
- **預估大小**：S（估40行，包含本卡測試／Java／runtime OpenAPI subset；超上限必拆卡）。

### BW6-T17 SELF與purge先紅

- **目標**：§7 R25-A/B，Q-25。
- **輸入**：ApiFixture／TestSession、WaveE purge flow、§3.3/3.4。
- **步驟**：①PrincipalGovernanceApiTests新增兩個admin／nonself soleadmin情境；②EntryPurgeConfirmationApiTests按參數向量覆盖缺／錯／UUID／slug／空slug；③先以第二admin存在時self disable與無confirm purge現状200/204，記錄要求403/400的紅燈；④每拒絕assert數據/session unchanged與一次audit。
- **完成條件**：`./gradlew test --tests 'com.fallrising.cms.PrincipalGovernanceApiTests' --tests 'com.fallrising.cms.EntryPurgeConfirmationApiTests'` 至少這兩case正確失敗。BW6-FM45、BW6-FM46、BW6-FM47、BW6-FM48、BW6-FM49、BW6-FM50。
- **驗證**：`./gradlew test --tests 'com.fallrising.cms.PrincipalGovernanceApiTests' --tests 'com.fallrising.cms.EntryPurgeConfirmationApiTests'`
- **對應 ID**：Q-25。
- **預估大小**：M（估330行，包含本卡測試／Java／runtime OpenAPI subset；超上限必拆卡）。

### BW6-T18 危險閘門與單次denied

- **目標**：§3.3/3.4、§4，Q-25。
- **輸入**：BW6-T17；full BW6設計契約錯誤enum／PurgeEntryRequest（唯讀）。
- **步驟**：①加三個ErrorCode與SELF factories；②新增GovernanceDenialAudit；③principal self-before-guard並保持成功transaction；④EntryService新增確認參數、constructor注入、去舊purge簽名；⑤controller JSON body與唯一servicegate；⑥更新兩既有atomic直接調用及WaveE合法purge body（保留成功斷言）；IdentityHardeningTests self patch／demotion及IdentityAuthTests sole-admin self-disable同步SELF且資料不變；⑦從full BW6契約同步runtime PurgeEntryRequest／purge operation含415、ErrorCode三新值與SELF描述；⑧BW6-T17轉綠。
- **完成條件**：`./gradlew test --tests 'com.fallrising.cms.PrincipalGovernanceApiTests' --tests 'com.fallrising.cms.EntryPurgeConfirmationApiTests' --tests 'com.fallrising.cms.IdentityHardeningTests'` 全綠；無media/type-confirm端點。BW6-FM45、BW6-FM46、BW6-FM47、BW6-FM48、BW6-FM49、BW6-FM50、BW6-FM55。
- **驗證**：`./gradlew test --tests 'com.fallrising.cms.PrincipalGovernanceApiTests' --tests 'com.fallrising.cms.EntryPurgeConfirmationApiTests' --tests 'com.fallrising.cms.IdentityHardeningTests'`
- **對應 ID**：Q-25、BD-09。
- **預估大小**：M（估395行，包含本卡測試／Java／runtime OpenAPI subset；超上限必拆卡）。

### BW6-T19 PostgreSQL原子/拒絕證據

- **目標**：§7 R25-P，Q-25、BD-09。
- **輸入**：BW6-T18、原IdentityAuditAtomicWriteTests／EntryAtomicWriteTests。
- **步驟**：①在原fixture注入同DataSource helper；②新增SELF／confirmation／LAST_ADMIN ambient rollback persisted one audit；③success audit failure rollback原test保留；④新增獨立denied audit fault→500內部異常而沒有partial mutation；⑤鎖定不同admin竞争保留至少一個usableadmin。
- **完成條件**：`./gradlew integrationTest --tests 'com.fallrising.cms.contract.IdentityAuditAtomicWriteTests' --tests 'com.fallrising.cms.contract.EntryAtomicWriteTests'` 全綠，snapshot status/roles/session/entry dependents不變。BW6-FM45、BW6-FM46、BW6-FM47、BW6-FM48、BW6-FM49、BW6-FM50、BW6-FM55。
- **驗證**：`./gradlew integrationTest --tests 'com.fallrising.cms.contract.IdentityAuditAtomicWriteTests' --tests 'com.fallrising.cms.contract.EntryAtomicWriteTests'`
- **對應 ID**：Q-25、BD-09。
- **預估大小**：M（估290行，包含本卡測試／Java／runtime OpenAPI subset；超上限必拆卡）。

### BW6-T20 seed政策／listener先紅

- **目標**：§7 R26-U/L，Q-26/BQ-14 B。
- **輸入**：舊9／舊5／typed91 fixture、SeedService properties／ContentTypeSeed。
- **步驟**：①OperatorSeedPolicyTests比較舊canonical9／duplicate／surface/type/predicate差異；②OperatorPermissionSeedTests標準fresh／old／restart／custom／seed-disabled/order；③先只新增既有SeedService的customclinic保存case並跑到紅，再建立新policy/listener宣告與throw scaffold供其餘case編譯；測試existing clinic customrole在SeedService.seed後原樣保留，現whole-replace導致意圖紅；④再按新policy接入其他case，不把缺class編譯錯誤聲稱行為失敗。
- **完成條件**：`./gradlew test --tests 'com.fallrising.cms.OperatorSeedPolicyTests' --tests 'com.fallrising.cms.OperatorPermissionSeedTests'` 保留named紅燈／其後BW6-T21/BW6-T25轉綠。BW6-FM51、BW6-FM52、BW6-FM53、BW6-FM54、BW6-FM56、BW6-FM57。
- **驗證**：`./gradlew test --tests 'com.fallrising.cms.OperatorSeedPolicyTests' --tests 'com.fallrising.cms.OperatorPermissionSeedTests'`
- **對應 ID**：Q-26、BQ-14 B。
- **預估大小**：M（估350行，包含本卡測試／Java／runtime OpenAPI subset；超上限必拆卡）。

### BW6-T21 canonical model／pure policy

- **目標**：§5.1–5.3 new model與immutable policy，BQ-14 B。
- **輸入**：BW6-T20；本附錄舊9表。
- **步驟**：①新增IdentitySeedChange；②OperatorSeedPolicy新增legacyDefaults／expandedDefaults／isConvertedShape／isLegacyDefault／isLegacyClinicAssignment五方法（簽名按本節定義；後三方法完整簽名為 `boolean isConvertedShape(List<Permission> grants)`、`boolean isLegacyDefault(UUID roleId,List<Permission> grants)`、`boolean isLegacyClinicAssignment(UUID principalId,UUID roleId,List<PrincipalRoleAssignment> assignments)`；不得讓generic store引用OperatorSeedPolicy常數）；③duplicates嚴格拒絕、canonical sorting只忽略順序和指定metadata；④converted recognition絕不看當前new types來追加grants。
- **完成條件**：`./gradlew test --tests 'com.fallrising.cms.OperatorSeedPolicyTests'` pure cases全綠；無AuthorizationService變更。BW6-FM51、BW6-FM52、BW6-FM53、BW6-FM57。
- **驗證**：`./gradlew test --tests 'com.fallrising.cms.OperatorSeedPolicyTests'`
- **對應 ID**：Q-26、BQ-14 B。
- **預估大小**：M（估210行，包含本卡測試／Java／runtime OpenAPI subset；超上限必拆卡）。

### BW6-T22 CAS／兩store／競爭先紅

- **目標**：§7 R26-S/P、R23-P，BQ-14 B／BD-10。
- **輸入**：BW6-T21；PostgresFixture；兩store adapters。
- **步驟**：①新增shared IdentitySeedStoreContract＋memory/JDBC adapters；②CAS old9／customassign／mismatch／第3insert故障（memory override、JDBC PreparedStatement代理，依身份附錄§5.3）／two simultaneous calls；③IdentitySeedConcurrencyTests兩connection下Admin修改搶先／CAS搶先與Q23 query-count；④先建立IdentityStore.applyConditionalSeedChange default throw UnsupportedOperationException供編譯；memory測試BW6-T23前期待新store方法意圖失敗，正式行為紅優先從BW6-T20已存在覆盖；⑤故障後比對原完整物件而不只row count。
- **完成條件**：`./gradlew test --tests 'com.fallrising.cms.contract.InMemoryIdentitySeedStoreContractTests'`；`./gradlew integrationTest --tests 'com.fallrising.cms.contract.JdbcIdentitySeedStoreContractTests' --tests 'com.fallrising.cms.contract.IdentitySeedConcurrencyTests'`；紅綠證據分別標註接口編譯與行為失敗，不混為一類。BW6-FM51、BW6-FM52、BW6-FM53、BW6-FM54、BW6-FM56。
- **驗證**：`./gradlew test --tests 'com.fallrising.cms.contract.InMemoryIdentitySeedStoreContractTests'`；`./gradlew integrationTest --tests 'com.fallrising.cms.contract.JdbcIdentitySeedStoreContractTests' --tests 'com.fallrising.cms.contract.IdentitySeedConcurrencyTests'`
- **對應 ID**：Q-26、BQ-14 B、BD-10。
- **預估大小**：M（估390行，包含本卡測試／Java／runtime OpenAPI subset；超上限必拆卡）。

### BW6-T23 CAS與共同lock

- **目標**：§5.3，BQ-14 B。
- **輸入**：BW6-T22；IdentityStore new signature。
- **步驟**：①JDBC實現CAS同tx／advisory／role→principal rowlock並條件assignment；②原3mutators加同rowlock與private unlocked writes；③memory相關read/write共用adminGuard，CASsnapshot rollback；④跑shared memory/Postgres以及現IdentityStoreContract與guard回歸。
- **完成條件**：BW6-T22命令全綠；`./gradlew integrationTest --tests 'com.fallrising.cms.contract.JdbcIdentityStoreContractTests' --tests 'com.fallrising.cms.JdbcIdentityStoreIntegrationTests'` 全綠；不新增表或權限primitive。BW6-FM51、BW6-FM52、BW6-FM53、BW6-FM54、BW6-FM56。
- **驗證**：`./gradlew test --tests 'com.fallrising.cms.contract.InMemoryIdentitySeedStoreContractTests'`；`./gradlew integrationTest --tests 'com.fallrising.cms.contract.JdbcIdentitySeedStoreContractTests' --tests 'com.fallrising.cms.contract.IdentitySeedConcurrencyTests'`；`./gradlew integrationTest --tests 'com.fallrising.cms.contract.JdbcIdentityStoreContractTests' --tests 'com.fallrising.cms.JdbcIdentityStoreIntegrationTests'`
- **對應 ID**：Q-26、BQ-14 B。
- **預估大小**：M（估340行，包含本卡測試／Java／runtime OpenAPI subset；超上限必拆卡）。

### BW6-T24 Demo seed授權預檢 Red

- **目標**：先證明客製empty／predicate權限且demo未建立時啟動會失敗，保留正常Admin。
- **輸入**：§5.5；CmsApiApplication、SeedService、ContentTypeSeed、DemoContentSeed、測試application.yaml；BW6-T23。
- **步驟**：1. 新增content/service/DemoContentSeedTests.java與§7 R26-D三個具名case。2. 在空資料／custom permission case以真實Spring ApplicationReady啟動記錄既有Demo seed授權exception；不以缺constructor編譯錯誤作Red。3. 若5參constructor未存在，先用既有4參constructor；Green新增DI後更新唯一新test callsite。4. 保留standard demo、predicate-only、DB失敗與Admin登入管理斷言。
- **完成條件**：custom empty/predicate-only case預期context正常但實際因Demo seed denied失敗；exact stack位置可查，其餘assertions保留。
- **驗證**：`./gradlew test --tests '*DemoContentSeedTests' --no-daemon --no-parallel`。
- **對應 ID**：Q-26、BQ-14 B、BW6-FM58。
- **預估大小**：M（估200行；test fixture／assertions≤400行）。

### BW6-T25 兩階段seed接線

- **目標**：§5.4，Q-26/BQ-14 B。
- **輸入**：BW6-T21/BW6-T23/BW6-T24、BW6-T20listener紅燈。
- **步驟**：①SeedService ensureRoles返回newlyInserted與fresh-only legacy init；②existing clinic bypassreplace；③新增Order200 OperatorPermissionSeed與固定notice；④exact9才CAS，typed只觀察，conflict只重讀一次；⑤DemoContentSeed依§5.5新增五參DI／preflight／單筆notice；⑥跑BW6-T24；⑦跑BW6-T20覆盖ContentTypeSeed在兩階段之間、DemoContentSeed仍可讀principals。
- **完成條件**：`./gradlew test --tests 'com.fallrising.cms.OperatorPermissionSeedTests' --tests 'com.fallrising.cms.OperatorSeedPolicyTests' --tests 'com.fallrising.cms.content.service.ContentTypeSeedTests' --tests '*DemoContentSeedTests'` 全綠；未移動Order0/100，無無conditionalwhole-role replacement。BW6-FM51、BW6-FM52、BW6-FM53、BW6-FM54、BW6-FM57。
- **驗證**：`./gradlew test --tests 'com.fallrising.cms.OperatorPermissionSeedTests' --tests 'com.fallrising.cms.OperatorSeedPolicyTests' --tests 'com.fallrising.cms.content.service.ContentTypeSeedTests' --tests '*DemoContentSeedTests'`
- **對應 ID**：Q-26、BQ-14 B。
- **預估大小**：M（估340行，包含本卡測試／Java／runtime OpenAPI subset；超上限必拆卡）。

### BW6-T26 API安全與歷史回歸

- **目標**：§7 R26-A、根完整契約對齊，Q-23～26。
- **輸入**：BW6-T14/BW6-T16/BW6-T18/BW6-T19/BW6-T25；root最終BW6契約。
- **步驟**：①新ClinicAppointmentOperatorApiTests：fresh member建draft、clinic operator read/update且五種不得動作、其他demo動作；②WaveE合法purge加body並assert原404/audit；③既有Capabilities／Member／OpenAPI／ErrorCodeContract運行；④不移除SELF歷史tests，soleadmin自停用舊LAST_ADMIN斷言更新為新SELF_DISABLE_FORBIDDEN並assert禁用失敗語義保留。
- **完成條件**：§8 focused組全綠；不得將custom保存測試判為Q26已套用。BW6-FM41、BW6-FM42、BW6-FM43、BW6-FM44、BW6-FM45、BW6-FM46、BW6-FM47、BW6-FM48、BW6-FM49、BW6-FM50、BW6-FM51、BW6-FM52、BW6-FM53、BW6-FM54、BW6-FM55、BW6-FM56、BW6-FM57。
- **驗證**：逐字執行§8的三條完整focused命令，分別記錄結果。
- **對應 ID**：Q-23～Q-26。
- **預估大小**：M（估260行，包含本卡測試／Java／runtime OpenAPI subset；超上限必拆卡）。


### BW6-T27 契約與媒體client相容入口 Red

- **目標**：用行為測試釘住server page與舊整庫入口，避免第一頁截斷與自動危險確認。
- **輸入**：§4/§5；packages/api/src/client.test.ts、keys.test.ts、packages/mocks/src/fixture-integrity.test.ts；BW6-T01～BW6-T26各功能測試。
- **步驟**：1. client.test新增Q14_mediaPageSendsZeroBasedParams、Q14_legacyMediaListReads101AcrossTwoPages（MSW精確page0/1，100+1個固定UUID）、Q14_legacyMediaListRejectsChangingTotalDuplicateOrEarlyEmpty與Q14_legacyMediaListAbortStopsNextPage、Q25_purgeSendsOnlyExplicitConfirmation。2. keys.test新增Q14_mediaPageKeysIncludeNormalizedParams。3. fixture-integrity新增Q23_principalProjectionMatchesAssignments、Q20_adminCountsMatchLiveWorkRows、Q14_embeddedMediaHasDeletedAt測新required欄位；新增Q17_publicEnumFixtureLabelsMatchWorkMetadata比對public enum與work labels且nonenum省略。
- **完成條件**：舊介面缺mediaPage／keys.page而失敗，或missing metadata斷言失敗；記錄確切失敗位置。不刪除既有api/mock斷言。
- **驗證**：`npm test --workspace @cms/api -- src/client.test.ts src/keys.test.ts`；`npm test --workspace @cms/mocks -- src/fixture-integrity.test.ts`。
- **對應 ID**：Q-14、Q-20、Q-23、Q-25、V2-AC-16。
- **預估大小**：M（手寫測試≤300行）。

### BW6-T28 完整契約與共用client Green

- **目標**：整檔對齊BW6契約，產生型別並保留media整庫相容。
- **輸入**：BW6-T27；全部後端實作卡；完整BW6.openapi.yaml及§5.1。
- **步驟**：1. 比較runtime sourcehash，保留所有已合併增量後以本波契約整檔取代、移除x-bw6-source-sha256。2. `npm run gen --workspace @cms/api`，schema.ts加入兩alias；keys.ts加入MediaListParams與media.page，work.ts加入mediaPage/query、明定0-base loop；保留mediaList／舊query入口；admin.ts purgeEntry接可選明確body。3. 不手改schema.d.ts、不修改package依賴。4. 後端OpenApiCompleteness/Contract及BW6-T27client/key測試轉綠。
- **完成條件**：完整52paths不缺漏，所有新error/schema/response一致；101asset完整返回且未代填confirm。
- **驗證**：`./gradlew test --tests '*OpenApiContractTests' --tests '*OpenApiCompletenessTests' --no-daemon --no-parallel`；`npm test --workspace @cms/api -- src/client.test.ts src/keys.test.ts`；`npm run typecheck --workspace @cms/api`。
- **對應 ID**：全部八題、BQ-14、V2-AC-16。
- **預估大小**：M（手寫client/schema alias≤220行；YAML/generated型別另列artifact）。

### BW6-T29 Fixture／MSW頁面投影相容 Green

- **目標**：generated required欄位與MediaAssetPage不使現有W5画面/mock suite失效。
- **輸入**：BW6-T27/BW6-T28；§5.2；原runtime fixture JSON與gen-fixtures.mjs；runtime public fixture只補已有public enabled enum的labels。
- **步驟**：1. 按§5.2更新表列JSON的projection，不改原content/身份資料。2. handlers/admin.ts與work.ts補role/deletedAt投影、mediaGET page/q metadata與授權先行，保留private file410/public404界線。3. `npm run gen --workspace @cms/mocks`。4. BW6-T27fixture integrity、既有handlers/media/mock tests轉綠；沒有W6畫面變更。
- **完成條件**：fixture角色來自assignments、counts來自未deletedwork rows、MediaAsset都有nullable deletedAt，GETpage與compatibilityloop可取得完整原庫。
- **驗證**：`npm test --workspace @cms/mocks -- src/fixture-integrity.test.ts src/handlers.test.ts`；`npm run typecheck`；`npm test --workspace @cms/fields -- src/pickers.test.tsx`；`npm test --workspace @cms/web-back -- src/media.test.tsx`。
- **對應 ID**：Q-14、Q-20、Q-23、V2-AC-16。
- **預估大小**：M（手寫handler/projection≤200行，原JSON/generatedfixture是機器資料）。

### BW6-T30 完整閘門、獨立審查與交付

- **目標**：證明所有30卡及安全/資料保留條件成立，再發布實作PR。
- **輸入**：BW6-T01～BW6-T30完成；兩附錄全部test/FM及Demo preflight三case；§9。
- **步驟**：1. Root逐條diff/source/RedGreen與FM evidence审查。2. 執行§9完整native gates與新增query-count/seed原子性tests；保留失敗/跳過。3. 獨立review修正後evidencegate映射全部check；保留既有worktree/BW1a。4. 按owner standingauthorization commit→push→PR→必要latestheadCI/review→merge→遠端核對→帳本/交接，只記可用真實ledger，不捏造ID。5. README BW6 VERIFIED只隨實作合併；本文件PR只DOC_READY。沒有deploy。
- **完成條件**：所有必要CI/review通過、遠端實作tree核對、差異與限制/下一步W6清楚，沒有未執行命令偽裝passed。
- **驗證**：§9完整命令；`git diff --check`；`gh pr view <number> --json state,mergeCommit,headRefOid,statusCheckRollup`及遠端main。
- **對應 ID**：全部八題、BQ-14、V2-AC-16。
- **預估大小**：S（文件/證據同步≤150行；無產品功能實作）。

## 7 測試規格

兩附錄給出每個named test的source path、層級、fixtures與step/assertions；§6T26的client/mock tests是共用邊界。API測試用MockMvc有效session/csrf/Origin，別把CSRF403當作SELF／action拒絕測通。每個Red有意圖失敗，新增API/store tests分開，JDBC與in-memory共用契約。

BW6-T27成功case MSW handler必須比對URL.searchParams page/size/q且返回相符page/size/total；100asset UUID按canonical數字後12位固定產生，同createdAt排序按id。失敗case依次提供total變100→101、兩頁同id、total101第二頁空；每例獨立reset不互相依賴。Abort以AbortController在第1頁resolved後abort、斷言後續handler零次，不能拿網路失敗代替。Purge沒有body時post body空，explicitbody逐字等於傳入；缺confirm的真實拒絕由後端Q25test驗證。

本波沒有新增瀏覽器畫面，不另造Playwrightspec；既有93mock仍為完整閘門。W6接上新畫面後才進行Q14/17/20/23～26真實新流程驗收與所需響應式/axe/bundle影響檢查，不能把W5real14舊報告當成新endpoint接受證據。

## 8 失敗模式對照

| FM ID | 失敗情境 | 期望行為 | 由哪個測試覆蓋 | 對應任務卡 |
| --- | --- | --- | --- | --- |
| BW6-FM01 | key非法422 FIELD_VALIDATION、fields[i].key INVALID_FORMAT，無type/field/audit部分寫入 | 422 FIELD_VALIDATION；非法key為INVALID_FORMAT，type／field／audit均不寫入 | Q12_rejectsUnsafeKeysBeforeAnyWrite | BW6-T05/BW6-T06 |
| BW6-FM02 | Unicode文字邊界、長度、duplicate及legacykey不可錯誤改寫 | 非key Unicode界線保留；length與duplicate錯誤順序不變；legacy key及內容不改寫 | Q12_lengthAndDuplicateErrorsStayOrdered、Q12_preservesLegacyKeysAndUnicodeText | BW6-T05/BW6-T06 |
| BW6-FM03 | page/size/q格式、重複或overflow400 VALIDATION_FAILED；size預設24/page0 | page預設0／size24；非法或重複page／size／q400 VALIDATION_FAILED，沒有store讀取 | Q14_rejectsInvalidAndRepeatedParameters、Q14_invalidQueryAndDeniedSurface | BW6-T07～BW6-T10 |
| BW6-FM04 | filtered total錯誤、最後頁或巨大page、同時間戳順序飄動 | filtered total正確；空頁仍echo request page；createdAt降序、id文字升序固定 | Q14_pagesHaveFilteredTotalAndStableTies、Q14_emptyAndBeyondLastPageKeepTotal、Q14_newestBeforeTextTieBreak | BW6-T07/BW6-T08 |
| BW6-FM05 | q中的%/_/backslash成wildcard，或只title漏原檔名 | title OR originalFilename字面不分大小寫包含；%／_／backslash都不是wildcard | Q14_queriesTitleOrFilenameLiterally | BW6-T07/BW6-T08 |
| BW6-FM06 | 匿名／FRONT／無MANAGE_MEDIA不能看庫或total；授權先於queryvalidation/store | 匿名401；FRONT403 SURFACE_FORBIDDEN；無action403 FORBIDDEN，先於parser／store，沒有total洩漏 | Q14_invalidQueryAndDeniedSurface、Q14_authorizationPrecedesParsingAndStore | BW6-T09/BW6-T10 |
| BW6-FM07 | 已刪private metadata錯誤410、公開洩漏deleted、upload缺nullable欄 | deleted private metadata200且有時間、privatebytes410 MEDIA_GONE；public404／embedded null；upload deletedAt=null | Q14_deletedMetadataRemainsReadable、Q14_uploadAndPublicProjectionHaveNullDeletion | BW6-T09/BW6-T10 |
| BW6-FM08 | DB失敗500 INTERNAL_ERROR不能回空成功；page逐列variants N+1 | store失敗500 INTERNAL_ERROR；非空page固定3 SQL／空page2 SQL，不逐筆取variants | Q14_storeFailureUsesExistingEnvelope、Q14_listUsesThreeQueriesIndependentOfPageSize | BW6-T09/BW6-T10 |
| BW6-FM09 | public nonenum/back/internal/disabled labels外洩，或metadata改名不反映 | 只輸出enabled public enum labels；nonenum省略；back／internal／disabled排除；改名即回新值 | Q17_onlyPublicEnabledEnumLabelsAreProjected、Q17_metadataChangesAreReflected | BW6-T11/BW6-T12 |
| BW6-FM10 | V11占用V10、舊資料被改寫、歷史constructor不相容 | 新增V11 nullable TEXT；保留13／16constructors及V1～V10；舊內容完整快照不變 | Q20_v11AddsNullablePackWithoutRewritingContent | BW6-T01/BW6-T02 |
| BW6-FM11 | seed覆蓋nonnull客製pack/settings，generic updates清掉pack | 非null客製pack與metadata／updatedAt保留；conditional只填null；兩store128字元pack回讀相同 | Q20_seedPreservesCustomMetadataAndNonNullPack、Q20_packRoundTripsAndCopiesPreserveIt | BW6-T01/BW6-T02 |
| BW6-FM12 | deleted被算入、private/unlisted漏計、disabled/0entry漏列、逐typecount | 所有live狀態都計入entryCount，published含private／unlisted；deleted排除；disabled／empty type仍列；一次bulk SQL | Q20_countsIncludeAllLiveStatesAndAllPublishedVisibility、Q20_countsUseOneSqlForOneAndTwelveTypes | BW6-T03/BW6-T04 |
| BW6-FM13 | create/enable/disable無三欄、資料庫失敗回0假成功 | create／enable／disable三欄完整；計數失敗500 INTERNAL_ERROR，不能回假0 | Q20_adminResponsesHavePackAndLiveCounts、Q20_countsFailureDoesNotBecomeSuccess | BW6-T03/BW6-T04 |
| BW6-FM41 | 未登入/CSRF | 401UNAUTHENTICATED／403CSRF_FAILED | R23-B/R25-B及existingIdentityAuthTests（身份附錄§7具名case） | BW6-T13/BW6-T17/BW6-T26 |
| BW6-FM42 | wrong surface/no action | 403SURFACE_FORBIDDEN/FORBIDDEN | 已有governance-denied一筆而不重複；R23-B/R25-B（身份附錄§7具名case） | BW6-T13/BW6-T17/BW6-T18 |
| BW6-FM43 | role無效／deleted／zero-grant | 400VALIDATION_FAILED／deleted隱藏、role真實仍列 | R23-B/S/P（身份附錄§7具名case） | BW6-T13/BW6-T14/BW6-T22 |
| BW6-FM44 | emailclear／duplicate | empty200null、nullmissing不變、重複400、無partial | R24（身份附錄§7具名case） | BW6-T15/BW6-T16 |
| BW6-FM45 | SELF disable 兩入口 | 403SELF_DISABLE_FORBIDDEN、status/session不變、denied1 | R25-A/P（身份附錄§7具名case） | BW6-T17/BW6-T18/BW6-T19 |
| BW6-FM46 | SELF demotion | 403SELF_DEMOTION_FORBIDDEN、roles不變、denied1 | R25-A/P（身份附錄§7具名case） | BW6-T17/BW6-T18/BW6-T19 |
| BW6-FM47 | nonself lastadmin | 403LAST_ADMIN及atomicguard | R25-A/P/shared既有guard（身份附錄§7具名case） | BW6-T17/BW6-T18/BW6-T19/BW6-T23 |
| BW6-FM48 | 缺／錯確認 | 400CONFIRMATION_REQUIRED、無mutation、denied1 | R25-B/P（身份附錄§7具名case） | BW6-T17/BW6-T18/BW6-T19 |
| BW6-FM49 | missing target/malformed | 404 ENTRY_NOT_FOUND／PRINCIPAL_NOT_FOUND、400VALIDATION_FAILED | R25-B/既有PrincipalNotFoundApiTests（身份附錄§7具名case） | BW6-T17/BW6-T26 |
| BW6-FM50 | ref/version conflict | 409REF_CONSTRAINT/VERSION_CONFLICT、denied1且無partial | R25-B/P原EntryAtomicWriteTests（身份附錄§7具名case） | BW6-T17/BW6-T18/BW6-T19 |
| BW6-FM51 | customgrants | startup正常、unappliednotice、grants/assignments不變 | R26-U/L/S（身份附錄§7具名case） | BW6-T20/BW6-T21/BW6-T22/BW6-T23/BW6-T25 |
| BW6-FM52 | customassignment | exact9可轉換但assignment完全保留、notice | R26-L/S（身份附錄§7具名case） | BW6-T20/BW6-T21/BW6-T22/BW6-T23/BW6-T25 |
| BW6-FM53 | restart/newtype | typed不重寫IDs、不補newtypegrant | R26-U/L/S（身份附錄§7具名case） | BW6-T20/BW6-T21/BW6-T22/BW6-T23/BW6-T25 |
| BW6-FM54 | simultaneous edit | CAS recheck、rowlocks/no overwrites、最多一次converted | R26-S/P（身份附錄§7具名case） | BW6-T22/BW6-T23 |
| BW6-FM55 | DB/audit failure | 500INTERNAL_ERROR、success全部回滾、denied自身failed不會partialmutation | R25-P/R26-S（身份附錄§7具名case） | BW6-T19/BW6-T22/BW6-T23 |
| BW6-FM56 | duplicates/trailingcustom | exact9 compare嚴格mismatch、no writes | R26-U/S（身份附錄§7具名case） | BW6-T20/BW6-T21/BW6-T22/BW6-T23 |
| BW6-FM58 | custom空／窄／predicate-only grant使Demo seed拒絕並阻止startup | 全部pending demo預檢先行、欠權限單筆notice／零writes／Admin可用，DB異常仍throw | BQ14B_customDemoSeedDoesNotBlockApplicationReady、BQ14B_standardDemoSeedWorksOnBothOrder200Permutations、BQ14B_demoPreflightPropagatesDatabaseFailure | BW6-T24/BW6-T25 |
| BW6-FM57 | order/disabled/type missing | principals Order0／types100／final200；disabled不套用；缺type拋啟動失敗且無轉換 | R26-L（身份附錄§7具名case） | BW6-T20/BW6-T25 |

| FM ID | 失敗情境 | 期望行為 | 由哪個測試覆蓋 | 對應任務卡 |
| --- | --- | --- | --- | --- |
| BW6-FM90 | legacy整庫adapter錯用1-based或截斷第一頁 | 101筆完整0/1page，順序不變 | Q14_legacyMediaListReads101AcrossTwoPages | BW6-T27/BW6-T28 |
| BW6-FM91 | 分頁total改變／duplicates／提前空頁 | 顯式error，可重試，不返回部分成功 | Q14_legacyMediaListRejectsChangingTotalDuplicateOrEarlyEmpty | BW6-T27/BW6-T28 |
| BW6-FM92 | Abort後繼續抓所有頁 | AbortError/既有reason，後續request0 | Q14_legacyMediaListAbortStopsNextPage | BW6-T27/BW6-T28 |
| BW6-FM93 | client自動填DELETE確認 | 只送explicitbody，missing保留server400 | Q25_purgeSendsOnlyExplicitConfirmation | BW6-T27/BW6-T28 |
| BW6-FM94 | fixture僅有型別占位、role/count來源錯 | integrity斷言明確失敗，不cast掩飾 | Q23_principalProjectionMatchesAssignments、Q20_adminCountsMatchLiveWorkRows | BW6-T27/BW6-T29 |

## 9 交付檢查表

本次文件交付只驗證docs-only保護hash、Markdownlinks/anchors、YAML/ref/examples完整性、精確source/path/method、卡大小/ID/FM、五卡weak-model walk、獨立review；不重跑無source變動的已通過本地整套產品測試。必要remoteCI照常跑，不跳過或以舊CI替代。

未來實作者在component根逐項打勾，所有完整native gates：

```bash
./gradlew test --no-daemon --no-parallel
./gradlew integrationTest --no-daemon --no-parallel
npm test
npm run lint
npm run typecheck
npm run build
npm run test:bundle
npm run measure:bundle
node --test scripts/record-frontend.test.mjs e2e/runner.test.mjs e2e/helpers.test.mjs
npx eslint e2e playwright.config.ts
npx tsc --noEmit --allowImportingTsExtensions --target es2022 --module esnext --moduleResolution bundler --esModuleInterop --skipLibCheck --types node e2e/*.ts playwright.config.ts
npm run e2e:mock
```

- [ ] BW6-T01～BW6-T30完成且Red/Green证據可查，所有範圍ID與FM有實際測試結果。
- [ ] 全部閘門／必要latestheadCI/review通過；只在CI跑的項目明列來源。
- [ ] API52paths/所有operation/schema/error與完整契約一致，codegen及typedfixtures新鮮。
- [ ] Q26新庫／舊標準／客製／restart／newtype／seed-disabled／競爭與失敗回滾／custom demo startup skip均有證據，無偷偷覆寫客製或新類型自動授權。
- [ ] Q25拒絕不改資料、denied audit單筆跨rollback持久，successatomic及usable-admin並發guard不退化。
- [ ] 無秘密／token／明文密碼，相對連結有效，PR逐條實測／failed/skipped，遠端合併核對。
- [ ] BW1a/既有工作保留，未部署，通用CMS/demo區分清楚；W6與操作維護驗收尚未完成不得宣稱全部完成。

外部查證（2026-10-06）：PostgreSQL16 [pattern matching](https://www.postgresql.org/docs/16/functions-matching.html)定義ILIKE按locale與ESCAPE；[row locks](https://www.postgresql.org/docs/16/explicit-locking.html)定義FOR UPDATE與transaction advisory locks；Spring [listener ordering](https://docs.spring.io/spring-framework/reference/core/beans/context-introduction.html#context-functionality-events-annotation)支援事件listener以@Order控制。細節依兩附錄的可執行SQL/store tests，不將來源閱讀視為本產品已跑測試。

補充外部查證（2026-10-06）：Spring Boot3.5 [Jackson mapper defaults](https://docs.spring.io/spring-boot/3.5/how-to/spring-mvc.html#howto.spring-mvc.customize-jackson-objectmapper)關閉FAIL_ON_UNKNOWN_PROPERTIES；本專案未覆寫該設定。PurgeEntryRequest沿用忽略未知欄位，仍只用兩個明確確認值核對target，不新增mapper或全域JSON政策。

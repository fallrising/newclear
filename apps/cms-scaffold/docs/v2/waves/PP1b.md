# PP1b 本地正式帳號與 Q25 施工圖

日期2026-10-09；狀態 **DOC_READY（本文件 PR 必要 CI 通過並正常合併後生效），未產品實作／驗收**。獨立五卡審查及來源／契約核對通過；本文件合併前不得據此施工。產品來源基線main `343c825cbace9b6c5dbbfc6d52486831ba395dd4`（PP1a產品已合併、必要PR/main CI通過，local scope已VERIFIED）；本地maintenance adapter仍是本波新設計，不能把PP1a或工具probe的通過當成它已通過。完整PP1／正式host恢復仍未完成。

## 1 範圍

對應既有[PP1](PP1.md) PP1-AC02／PP1-AC06、PP1-FM04～07及帳號旅程PP1-FM15；Q25權威為[BW6 identity §3.3/3.4/4](../contracts/BW6-identity.md)，沿BD-09成功原子性與BD-10双store契約，不新增產品功能或內容模型ID。

交付local fresh-init／正式Admin／distinct日常operator／reset契約、ownedproject maintenance guard、Q25 SELF／purge確認／一次denial audit及最小client/UI。recover-admin交core兩store/PG驗證與host missing-backup fail-closed；**host recover成功与完整restore驗收依PP1c verified rollback bundle，不能以PP1b稱已完成**。首批真public types由owner後續Admin配置；本波anonymous初始空、page只synthetic旅程fixture。

不做：部署、正式DNS/TLS／全機CA信任、DB published ports／hostnetwork、清資料或catalog、demo帳號/內容/navigation、任意promotion/grantrepair、bootstrappublicgrant旗標、備份mini實作／pruning／upgrade／正式維運、Q23/Q24／完整BW6role政策、UI重設計、新runtime dependency／migration／build/lock/workflow。Back/Front既有畫面只用於旅程，不新增產品路徑。

## 2 先決條件

- [PP1a](PP1a.md) 必須由root確認VERIFIED；需要其normalprod validator、no-demo seed gate、12catalog/5roles、ownedrun metadata/image-source-jar-base/ingress hashes、兩internalnetworks與無DB/APIports、scopedTLS/browser工具。PP1a前進時保留增量，不blindcopy舊文件。
- 既有Node24.18.0、Java25、Docker/Compose/OpenSSL；不安裝新app dependency。所有下列Java/npm/node命令在**component root**執行，gradlew就在此根，PGcontract只用existingPostgresFixture/Testcontainers。
- 四origin恰`https://{front,back,admin,api}.cms.test:8443`；ownedproject `cms-pp1-local-<32lowerhex>`，reuse本次新DB/media namedvolumes。hostJDK只連currentinspect派生PG privatebridge IP；DBcms/usercms_local，沒有127.0.0.1:15432或其他published DBport。
- prod秘密只從existingprivate configtree檔讀到受保護childenvironment；**bootstrap password只能真TTY**，不接argv/env/file/echo stdin。正式username/displayName與實際tool paths只留private操作紀錄。公開示例中的pp1.root/pp1.operator是合成fixture。
- 後續hostrecover需要PP1c matching verified DB+media rollback bundle；本波無verifier所以hostrecover exit6，coretest fakeverifiedguard不代替host。

## 3 檔案清單

所有路徑相對component。main=`services/cms-api/src/main/java/com/fallrising/cms/`；unit=`services/cms-api/src/test/java/com/fallrising/cms/`；PG=`services/cms-api/src/integrationTest/java/com/fallrising/cms/`。表內prefix展開後是完整白名單；同路徑跨卡由前卡交接，不能並行改同檔。D01共享PP1.md由root寫，本文件worker不擴寫。

| 路徑 | 新增/修改/生成 | 用途 | 卡 |
| --- | --- | --- | --- |
| `main CmsApiApplication.java` | 修改 | maintenance最先分流 | B03 |
| `main identity/maintenance/IdentityMaintenanceCommand.java` | 新增 | argv/退出碼/context/commit Result | B01/B03/B08/B10 |
| `main identity/maintenance/IdentityMaintenanceConfiguration.java` | 新增 | explicitbeans/prodvalidator/唯一pool | B01/B03/G06 |
| `main identity/maintenance/MaintenanceGuard.java` | 新增 | lease接口；無adapter拒絕 | B01/B03 |
| `main identity/maintenance/ConsoleSecretInput.java` | 新增 | 真TTY兩次密碼/ownedbuffer清除 | B01/B02/B03 |
| `main identity/maintenance/ProductionIdentityService.java` | 新增 | fresh/recover原子核心 | B01/B08/B10 |
| `main identity/maintenance/LocalMaintenanceGuard.java` | 新增 | local attachment/liveassert/exactbackendpin | G05/G06 |
| `main identity/crypto/PasswordPolicy.java` | 新增 | 既有政策CharSequence共享 | B02 |
| `main identity/crypto/PasswordHasher.java` | 修改 | char[]hash overload | B02 |
| `main identity/service/AuthService.java` | 修改 | 既有HTTPpolicy委派 | B02 |
| `main identity/store/IdentityStore.java` | 修改 | 三maintenance方法 | B04 |
| `main identity/store/JdbcIdentityStore.java` | 修改 | rawexists/operationquery/sameguardtx | B04/B06/B10 |
| `main identity/store/InMemoryIdentityStore.java` | 修改 | rawsnapshot/rollback/fullJSONquery | B04/B07/B10 |
| `unit identity/maintenance/IdentityMaintenanceCommandTests.java` | 新增 | CLI/context/password/guard負例 | B01/B02/B03/B09/G05/G06 |
| `unit contract/IdentityMaintenanceContract.java` | 新增 | 雙store共同fresh/recover/fault/race契約 | B04/B05/B08/B09 |
| `unit contract/InMemoryIdentityMaintenanceContractTests.java` | 新增 | memoryrunner | B04/B05/B07/B08/B09/B10 |
| `PG contract/JdbcIdentityMaintenanceContractTests.java` | 新增 | PG契約runner | B04/B05/B06/B08/B09/B10 |
| `PG contract/ProductionIdentityIntegrationTests.java` | 新增 | 真hash/login/rebuildcontext | B05/B08/B09/B10 |
| `scripts/local/maintenance-target.mjs` | 新增 | ownedtuple/hash/privateJDBC | G01/G02 |
| `scripts/local/maintenance-target.test.mjs` | 新增 | target負向fixtures | G01/G02 |
| `scripts/local/maintenance-media-probe.mjs` | 新增 | readonlyno-networkvolumeempty | G02 |
| `scripts/local/maintenance-guard.mjs` | 新增 | sharedlease/stop/pin/phase | G03/G04 |
| `scripts/local/maintenance-guard.test.mjs` | 新增 | writer/pid/lock/crash負例 | G03/G04 |
| `scripts/local/maintenance.mjs` | 新增 | TTYhostJDKwrapper | G05/G06 |
| `scripts/local/maintenance.test.mjs` | 新增 | 順序/secret/exit/restart負例 | G05/G06 |
| `scripts/local/verify-accounts.mjs` | 新增 | initializedgraph獨立驗證 | G07 |
| `scripts/local/verify-accounts.test.mjs` | 新增 | 精確graph與false-positive拒絕 | G07 |
| `main identity/service/GovernanceDenialAudit.java` | 新增 | REQUIRES_NEWdenial白名單 | Q02 |
| `main identity/service/PrincipalAdminService.java` | 修改 | SELF-before-LAST_ADMIN/wrapper | Q02 |
| `main identity/IdentityException.java` | 修改 | 兩SELF工廠 | Q02 |
| `main api/error/ErrorCode.java` | 修改 | 三Q25code | Q02 |
| `main content/service/EntryService.java` | 修改 | 唯一purge確認入口/6參DI | Q04 |
| `main content/web/AdminContentController.java` | 修改 | PurgeBody/current交service | Q04 |
| `unit PrincipalGovernanceApiTests.java` | 新增 | SELFAPI行為Red | Q01/Q02 |
| `unit EntryPurgeConfirmationApiTests.java` | 新增 | purgebody/order/errorRed | Q03/Q04 |
| `unit IdentityAuthTests.java` | 修改 | 既有SELF期望更新 | Q02 |
| `unit IdentityHardeningTests.java` | 修改 | 保留硬化asserts並更新SELF | Q02 |
| `unit WaveEAcceptanceTests.java` | 修改 | 合法purge callers有確認 | Q04 |
| `PG contract/IdentityAuditAtomicWriteTests.java` | 修改 | SELF/denial/rollback新連線 | Q05 |
| `PG contract/EntryAtomicWriteTests.java` | 修改 | 合法caller與denial/fault | Q04/Q05 |
| `services/cms-api/src/main/resources/openapi/openapi.yaml` | 修改 | Q02三枚舉、Q04其餘Q25增量 | Q02/Q04 |
| `packages/api/src/schema.ts` | 修改 | PurgeEntryRequest alias | Q07 |
| `packages/api/src/generated/schema.d.ts` | 生成 | 只由runtimeOAScodegen | Q07 |
| `packages/api/src/admin.ts` | 修改 | callerbody/purge-onlyretry=false | Q07 |
| `packages/api/src/core.ts` | 修改 | typedoptionalCSRF重送開關 | Q07 |
| `packages/api/src/client.test.ts` | 修改 | 真JSONbody/CSRFPOST次數 | Q06/Q07 |
| `packages/mocks/src/handlers/admin.ts` | 修改 | Q25gate/denialstate不變 | Q07 |
| `packages/mocks/src/handlers.test.ts` | 修改 | SELF/body/order | Q06/Q07 |
| `apps/web-admin/src/confirm.tsx` | 修改 | rawtarget/word/ack/callback | Q09 |
| `apps/web-admin/src/confirm.test.tsx` | 新增 | exact/reset/pending | Q08/Q09 |
| `apps/web-admin/src/pages/entries.tsx` | 修改 | key/capturedpayload/alive/inFlight | Q10 |
| `apps/web-admin/src/copy.ts` | 修改 | 五zh-Hantkeys | Q09 |
| `apps/web-admin/src/errors.ts` | 修改 | 新code優先 | Q10 |
| `apps/web-admin/src/entries.test.tsx` | 修改 | stale/StrictMode/doubleclick | Q08/Q10 |
| `apps/web-admin/src/principals.test.tsx` | 修改 | SELF具體errorcopy | Q08/Q10 |
| `apps/web-admin/src/safety.test.tsx` | 修改 | consumer/安全回歸 | Q08/Q09/Q10 |
| `e2e-pp1-local/accounts.spec.ts` | 新增 | ownedlocal正式帳號/Q25旅程 | G07/E01 |
| `playwright.pp1-local.config.ts` | 修改 | 只增accountstestmatch/安全讀credential | E01 |
| `docs/v2/waves/PP1b.md` | 新增/交付同步 | 本施工圖/證據 | D01 |
| `docs/v2/contracts/PP1-accounts.md` | 修改 | localadapter/retiredseedcards | D01 |
| `docs/v2/contracts/PP1-governance.md` | 修改 | purge-onlyretry與新卡路由 | D01 |
| `docs/v2/waves/PP1.md` | root修改 | 局部狀態/PP1c依賴 | D01 |

沒有表外helper檔／額外caller／package/lock/build/workflow/compose/migration變更。source-ref查出表外caller時先交root具體scope拆卡，不留unsafe overload或刪assertions。PP1a seedfiles、verify.mjs零freshasserts只讀，不能放寬。generated檔只由codegen產生。

## 4 契約

### 4.1 帳號命令與交易

完整CLI/Options/Result/FailureCode/TTY/beans/SQL/grants在[帳號附約§4–6與§10](../contracts/PP1-accounts.md)。localwrapper：

```text
node scripts/local/maintenance.mjs --run-id <id> --java-bin <verified-JDK25-java> --jar <matching-bootJar> -- fresh-init --username <name> --display-name <label> --target-id pp1-local:<id> --operation-id <UUID> --confirm FRESH_INIT
node scripts/local/maintenance.mjs --run-id <id> --java-bin <verified-JDK25-java> --jar <matching-bootJar> -- recover-admin --principal-id <UUID> --target-id pp1-local:<id> --operation-id <UUID> --confirm RECOVER_ADMIN [--reenable]
```

argv只有nonsecretflags。parse/type/TTY失敗2、state3、commonlock/advisorytimeout4、DB/schema/hash/audit/commitreceipt/restart失敗5、guard未配置／停止未證明／缺verifiedbackup6。沒有default weak guard、Springpropertyargv或maintenanceHTTP；unknown/duplicateflag、operation不適用、confirmation whitespace/非canonicalUUID均拒。無principal歷史才fresh；已deleted也拒，role/catalog-only容許保留。原13adminmatrix與anonymous/member/editor/operator空grants沿附約；recover不promote、不修grants、不寫lastLoginAt。

success Result例（合成ID，不含profile/password/hash）：
```json
{"operationId":"10000000-0000-0000-0000-000000000001","operation":"FRESH_INIT","principalId":"10000000-0000-0000-0000-000000000002","completedAt":"2026-10-01T00:00:00Z","releaseId":"sha256:<matching-jar-digest>","targetId":"pp1-local:<runId>"}
```
失敗stderr是`{"code":"NOT_FRESH","operationId":"10000000-0000-0000-0000-000000000001"}`，exit3、原snapshot全不變。receipt只在commit後；commit後restore/closefault不得說rollback或auto重試。

### 4.2 Q25 HTTP與型別

完整operation/body/ErrorEnvelope與授權優先序沿[BW6 §3.3/3.4/4](../contracts/BW6-identity.md)及[治理附約](../contracts/PP1-governance.md)；OAS用既有[PP1.openapi.yaml](../contracts/PP1.openapi.yaml)的**僅Q25增量**合入runtime，先比基準checksum與current增量、移x-pp1-source-sha256，不整檔蓋掉後續source。

| operation | surface/action | request/成功 | 本波錯誤／先後 |
| --- | --- | --- | --- |
| PATCH /api/v1/principals/{id} | Admin/manage_principals | 原PatchPrincipalRequest→原Principal200 | 原auth/validation/notfound先；nextStatusdisabled＋self→SELF_DISABLE_FORBIDDEN403；nonself最後usableadmin→LAST_ADMIN403 |
| POST /api/v1/principals/{id}/disable | Admin/manage_principals | 原無新增body→Principal200 | self即SELF_DISABLE_FORBIDDEN403；nonselfLAST_ADMIN403；不先撤sessions |
| PUT /api/v1/principals/{id}/roles | Admin/manage_principals | RoleAssignmentInput[]→204 | role/duplicate/allowlist validation先；self目前有admin且移除→SELF_DEMOTION_FORBIDDEN403；nonselfLAST_ADMIN403 |
| PUT /api/v1/roles/{code}/permissions | Admin/manage_principals | PermissionInput[]→204 | 原inputvalidation；非SELF，removeslastusableadmin→LAST_ADMIN403；denial一次 |
| POST /api/v1/admin/entries/{id}/purge | Admin且adminrole；沿既有rolegate，非DELETEgrant | PurgeEntryRequest可missing→合法204無body | anonymous401→surface403→role403→target404→confirmation400→refs/CAS409→transaction/audit500 |

PurgeBody Java record兩String無@NotBlank；required=false；unknownkey忽略；confirmation onlyJSON，不接headers。no/{}body/missingkey/wrongword/target→CONFIRMATION_REQUIRED400；word必须rawDELETE、confirmId为canonicalUUID或targetnonemptyslug exact。malformedJSON/pathUUID400 VALIDATION_FAILED、nonJSON415 MEDIA_TYPE_NOT_SUPPORTED，target404 ENTRY_NOT_FOUND；CSRFfilter403 CSRF_FAILED仍先於service，均非businessdenialaudit。合法body例`{"confirmPhrase":"DELETE","confirmId":"10000000-0000-0000-0000-000000000009"}`；錯phrase固定message不回raw文本。SELF/CONFIRMATIONcode加ErrorCode/OAS枚舉，其他schema/email/projection與52paths不變。

無新DDL／migration／回填。V2 usernameUNIQUE含softdeleted仍沿原DB；fresh判rawstate不是filteredlist。maintenance同adminadvisorykey/sameDStx；success mutation+audit一起commit，白名單businessdenial在attempt tx退出後REQUIRES_NEW恰一次。memory維護rollbacksnapshot只限maintenance，不宣稱普通memory通用rollback。

### 4.3 前端型別與CSRF

```ts
export type PurgeEntryRequest = S["PurgeEntryRequest"];
export interface CallOptions { retryCsrf?: boolean }
// core.call<T>(run:()=>Promise<FetchResult<T>>, options?:CallOptions):Promise<T>
// admin.purgeEntry(id:string, body?:PurgeEntryRequest):Promise<void>
type Action = "unpublish" | "archive" | "purge";
type MutationInput = { action: Action; id: string; contentType: string;
  confirmation?: PurgeEntryRequest };
```

purge只送callerrawbody，不自填；calloptions defaulttrue，purge false。403CSRF_FAILED先clearcachedtoken，false throw、不refresh／重送；nextmanual正常middleware新取token。一般unsafeoperations沿S-03exactly-one retry，network/timeout/businesserror不重試purge。generatedschema只由runtimeOAScodegen。

## 5 模組與元件規格

### 5.1 維護context／localadapter

[帳號附約§10](../contracts/PP1-accounts.md)為完整moduleexports/privateJSONschema/CLIargv/steps/SQL來源。順序不能改：parse→ownedtuple→TTY→backupgate→exclusivecommonlease/opreservation→stop exactAPI→liveDocker/PGzero→Javaattachment→prodMapPropertySource＋既有platform.ProductionEnvironmentValidator→唯一pool max1/minIdle0→自身pid/backendStartEpoch逐字bind→完整exactbackendassert→Flywayvalidate→serviceguard/tx/reassert→txcommit→lease.recordCommitted(Result)→close→commandstdout→wrapper sameAPIstart/health。

沒有scan/autoconfig/seed/job/listener/HTTP/memory。DB前無attachmentexit6；poolreplace、額外偽同name、0backend均拒，不自動bind2。fixedpsql每次排除自身，不能只以appname/count認writer。privatecommonlock/registry無TTL／forceunlock，fault/crash維護停住、只readonlyinspect。readonlymedia probe只exactownedvolume/no-network/capdrop/verifiedbinaryscript，無hostroot讀volume假設。未知container/volume/network/session拒；advisory與localcooperativelease不宣稱能凍結不合作root/DBwriter。

### 5.2 Q25後端與最小UI

GovernanceDenialAudit與SELF/purge流程逐分支沿治理附約/BW6；EntryService唯一5參purge，刪3參；6參sameDSDI保留legacy4/5ctors委派。不更改Q23projection、email或rolepolicy。

ConfirmDialog完整Props：

```ts
interface ConfirmDialogProps {
  open: boolean; title: string; description: string; confirmLabel: string;
  phrase?: string; destructive?: boolean; pending: boolean;
  confirmationWord?: "DELETE"; acknowledgementLabel?: string;
  onConfirm: (typed: string, word?: string) => void;
  onCancel: () => void;
}
```

defaulttyped/word空、ackfalse，非purge保留trim舊語義。purge rawword/targetexact＋ack；pendinginputs/checkbox/cancel/submit全disabled；close清三state；error在原頁toast後dialog關閉，manualreopen重新輸入；notfound/forbidden detailredirect沿既有，不新增UI。testids confirm-input/confirm-word/confirm-acknowledgement/confirm-submit/confirm-cancel，labels htmlFor、只用existing@cms/uiCheckbox、原tokens不新增裸色/px。

Inspector key id:version:slug，dialogkeyaction；phrase非emptyslugelsecanonicalid；payload捕action/id/contentType/rawconfirmation，querykeys keys.entries.lists(payload.contentType)、exact keys.admin.audit({targetId:payload.id,action:'entry.',size:20})與keys.entries.detail(payload.id)。inFlight在mutate前同步設true防同tickdoubleclick；onSettled只alivegeneration清。alive effect固定setup=true/cleanup=false deps[]，保留StrictMode；所有完成都只先invalidate captured list＋exact captured targetaudit；stale則return，不auditAll/nav/toast/setPending。alive才保留keys.admin.auditAll()全域刷新與UI；nonpurge可setQueryData captured detail，purge仍不invalidate detail防404閃頁。same-slugdifferentid/version/slug/action/cancel重開全部reset；rawtyped不用trim，callbackclosure不能傳MouseEvent。

| copy key | zh-Hant | 位置 |
| --- | --- | --- |
| confirm.deletionWordLabel | 請輸入 DELETE | 第二欄 |
| confirm.irreversible | 我了解永久刪除後無法復原。 | acknowledgement |
| error.confirmationRequired | 請重新確認要永久刪除的內容。 | 400toast |
| error.selfDisable | 無法停用自己的帳號。 | 403toast |
| error.selfDemotion | 無法移除自己的管理員角色。 | 403toast |

errors.ts新code先LAST_ADMIN/generic403；existingselfbutton/rolelock與GETdetail403redirect維持。MSW只SELF/body/precedence與denialstate0mutate，不用mock宣稱PGatomicity。

### 5.3 現行source核對

| source（main/unit等prefix見§3） | 行號／事實 |
| --- | --- |
| main platform/ProductionEnvironmentValidator.java | 19–21 hook；43–46 seedfalse/securetrue/非cmsuser；60–89canonicalorigins/mediaabsolute |
| main identity/service/SeedService.java | 66disabledensureRoles；82–135五roles/demo/adminmatrix；不作productionbootstrap |
| main identity/service/AuthService.java／identity/crypto/PasswordHasher.java | 137–139existingpasswordpolicy；22hash(String) |
| main identity/store/JdbcIdentityStore.java | 34admin key；308–358usableadmin/guard sameDS |
| main platform/TransactionRunner.java | 46independently REQUIRES_NEW |
| main identity/service/PrincipalAdminService.java | 125patch/146disable/165roles/187reset；SELF尚未實作 |
| main content/service/EntryService.java／content/web/AdminContentController.java | 460old3argpurge；220controllerprematuresurfacegate |
| packages/api/src/core.ts／admin.ts | 79unconditionalCSRF retry；86purgeonlyid |
| apps/web-admin/src/confirm.tsx／pages/entries.tsx | 26voidcallback/36trim；307closureid/422nokey |
| compose.pp1-local.yaml／scripts/local/verify.mjs | 15/44cms_local；46–135ownership/provenance/freshzero；不得放寬 |
| playwright.pp1-local.config.ts | 20ignoreHTTPS=false/21traceoff，workers1/retries0 |

## 6 任務卡

順序編號PP1b-T01–T30；B/G/Q/E/D保留語義標籤，引用卡號以語義label為準。每張含tests手寫S≤150/M≤400，B03為group別名，代表B03a/B03b兩張串行卡；原B03依賴須等兩張完成。數字為設計估算不是實測diff；generatedartifact另列，不省測試湊上限。超限停止交root拆，不delegate。Red保存named行為失敗；必要signaturethrow scaffold可編譯，但缺class編譯錯誤不能算Red。所有指令在component root；本施工圖中的產品命令**未執行**。

<a id="b01"></a>

### PP1b-T01：B01 CLI Red

- **目標**：CLI Red，交付下列可觀察行為。
- **輸入**：main `identity/maintenance/{IdentityMaintenanceCommand,IdentityMaintenanceConfiguration,MaintenanceGuard,ConsoleSecretInput,ProductionIdentityService}.java` signature scaffold；unit `identity/maintenance/IdentityMaintenanceCommandTests.java`；依PP1a；精確完整檔名依§3同卡標籤，不使用表外路徑。
- **步驟**：
  1. 建立§3的五個maintenance class signatures、MaintenanceGuard.ConnectionPhase/defaultDeny/Lease.recordCommitted與nested Options/Result/FailureCode，service scaffold只throw，不先實作Green。
  2. 新增parser／noTTY／secret cleanup／defaultguard／headlessabsence測試；對unknown、duplicate、非首字maintenance各assert exit2。
  3. 保存至少一個parser/guard行為Red，另列scaffold UnsupportedOperationException，不以缺class當Red。
- **完成條件**：parse/duplicate/mode/TTY/defaultguard/contextabsence行為Red，非compile缺類；secret/output capture，service ctor先可編譯。；Red卡保留意圖失敗，Green卡對應namedcase轉綠。
- **驗證**：

```sh
./gradlew test --tests '*IdentityMaintenanceCommandTests' --no-daemon --no-parallel
```

- **對應 ID**：PP1-AC02、PP1-FM04。
- **預估大小**：M（360手寫行，含tests；上限400）。

<a id="b02"></a>

### PP1b-T02：B02 password Green

- **目標**：password Green，交付下列可觀察行為。
- **輸入**：main `identity/crypto/PasswordPolicy.java`新、`PasswordHasher.java`、`identity/service/AuthService.java`；unit CommandTests；依B01；精確完整檔名依§3同卡標籤，不使用表外路徑。
- **步驟**：
  1. 新增PasswordPolicy.validate(CharSequence,CharSequence)，AuthService.validateNewPassword委派且HTTP錯誤相同。
  2. PasswordHasher新增hash(char[])用CharBuffer，ConsoleSecretInput兩次readPassword及finally清buffer；禁止env/file/stdin echo fallback。
  3. 在hash/guardfault與mismatch時capturestdout/stderr，assert沒有raw/hash且ownedbuffer清零。
- **完成條件**：舊政策結果一致、char[] owned cleanup，hash/guardfault無secret輸出。；Red卡保留意圖失敗，Green卡對應namedcase轉綠。
- **驗證**：

```sh
./gradlew test --tests '*IdentityMaintenanceCommandTests' --tests '*IdentityAuthTests' --no-daemon --no-parallel
```

- **對應 ID**：PP1-AC02、PP1-FM04。
- **預估大小**：S（140手寫行，含tests；上限150）。

<a id="b03"></a>
<a id="b03a"></a>

### PP1b-T03：B03a context Green

- **目標**：完成獨立maintenance context與DB前guard，保留全部原B03斷言。
- **輸入**：main `IdentityMaintenanceConfiguration.java`；unit `IdentityMaintenanceCommandTests.java` 的context部分；依B02，精確路徑依§3。
- **步驟**：
  1. 按accounts§4.2/§10 explicitbeans與MapPropertySource；只依B01 ConnectionPhase接口及package-private fake Dependencies，不引用G05才存在的LocalGuard。
  2. requiredkey缺漏拒絕；DB前assertPreConnection，唯一max1/minIdle0 pool讀pid/epoch並bind，assertBound後才Flyway.validate。
  3. fake context測sameDS、無HTTP/seed/purgejob/memory、有AuditLog、backend拒絕及contextclose關pool。
- **完成條件**：context具名Red後Green；noDS/defaultguard6早拒、schema validate-only、exactbackend／生命週期斷言完整。
- **驗證**：

```sh
./gradlew test --tests '*IdentityMaintenanceCommandTests' --no-daemon --no-parallel
```

- **對應 ID**：PP1-AC02、PP1-FM04。
- **預估大小**：M（320手寫行，含tests；上限400）。

<a id="b03b"></a>

### PP1b-T04：B03b route/command Green

- **目標**：完成原B03入口、parser與command lifecycle；與B03a串行修改共同測試檔。
- **輸入**：main `CmsApiApplication.java`／`IdentityMaintenanceCommand.java`，B01 console/guard，unit `IdentityMaintenanceCommandTests.java` 的入口與command部分；依B03a，精確路徑依§3。
- **步驟**：
  1. argv[0] maintenance分流，其他位置maintenance拒絕；普通server不改。maintenance在context/Hikari/Flyway之前用existingBoot LoggingSystem rootOFF。
  2. 完成精確flags／exit／真TTY／buffer清除與contextclose接線，guard未配置仍exit6，service保持B08前明確未實作。
  3. 真入口capture無JDBC/frameworklogs／stack；固定TTY prompts之外僅固定JSON。保留parser/cleanup/failure regressions。
- **完成條件**：完整CommandTests與既有IdentityAuthTests Green；沒有為了拆卡刪掉原B03測試或新增權限／依賴。
- **驗證**：

```sh
./gradlew test --tests '*IdentityMaintenanceCommandTests' --tests '*IdentityAuthTests' --no-daemon --no-parallel
```

- **對應 ID**：PP1-AC02、PP1-FM04。
- **預估大小**：M（260手寫行，含tests；上限400）。

<a id="b04"></a>

### PP1b-T05：B04 freshness Red

- **目標**：freshness Red，交付下列可觀察行為。
- **輸入**：main `identity/store/IdentityStore.java`三method scaffold、Jdbc/InMemory同signature throw；unit `contract/IdentityMaintenanceContract.java`／`InMemoryIdentityMaintenanceContractTests.java`新；PG `contract/JdbcIdentityMaintenanceContractTests.java`新；依B03；精確完整檔名依§3同卡標籤，不使用表外路徑。
- **步驟**：
  1. 三store方法signature先throw；sharedcontract在newcase store建立完整角色only及rawdirtyfixture。
  2. 每rawtable各插一筆（principal含softdeleted），snapshotIDs/state/audit，fresh-init拒絕且不寫入。
  3. memory與PGrunner使用同sharedcontract，驗admin13矩陣與anonymousempty named行為Red。
- **完成條件**：softdeleted及任一rawtable不空拒絕、role-onlyIDs保留、freshgrant/anonymous狀態，named assertions Red。；Red卡保留意圖失敗，Green卡對應namedcase轉綠。
- **驗證**：

```sh
./gradlew test --tests '*InMemoryIdentityMaintenanceContractTests' --no-daemon --no-parallel
./gradlew integrationTest --tests '*JdbcIdentityMaintenanceContractTests' --no-daemon --no-parallel
```

- **對應 ID**：PP1-AC02、PP1-FM04。
- **預估大小**：M（280手寫行，含tests；上限400）。

<a id="b05"></a>

### PP1b-T06：B05 fault/race Red

- **目標**：fault/race Red，交付下列可觀察行為。
- **輸入**：unit shared contract；PG `contract/ProductionIdentityIntegrationTests.java`新；依B04；精確完整檔名依§3同卡標籤，不使用表外路徑。
- **步驟**：
  1. 在credential/assignment/audit delegate寫後throw，完整snapshot比roleIDs/credentialhash/assignments/session/audit。
  2. race同caseDS兩connection、CountDownLatch、Future.get(10s)；另持admin advisory鎖測5s timeout4。
  3. ProductionIdentityIntegrationTests先assert真Argon2/newlogin及匿名grant前拒絕，未完成serviceRed可查。
- **完成條件**：credential/assignment/audit已寫後throw全snapshot、latch兩connection最多一commit、locktimeout4；有界Future.get(10s)無sleep。；Red卡保留意圖失敗，Green卡對應namedcase轉綠。
- **驗證**：

```sh
./gradlew test --tests '*InMemoryIdentityMaintenanceContractTests' --no-daemon --no-parallel
./gradlew integrationTest --tests '*JdbcIdentityMaintenanceContractTests' --tests '*ProductionIdentityIntegrationTests' --no-daemon --no-parallel
```

- **對應 ID**：PP1-AC02、PP1-FM04。
- **預估大小**：M（280手寫行，含tests；上限400）。

<a id="b06"></a>

### PP1b-T07：B06 JDBC primitive Green

- **目標**：JDBC primitive Green，交付下列可觀察行為。
- **輸入**：main `identity/store/JdbcIdentityStore.java`；PG JDBC contract；依B05；精確完整檔名依§3同卡標籤，不使用表外路徑。
- **步驟**：
  1. JDBC rawexists與duplicate全target非分頁SQL按accounts§5；sameDSmaintenanceTransaction SET LOCAL5s＋既有key。
  2. 同tx內資格讀/寫/audit，SQLSTATE55P03映exit4；保持普通KeepingUsableAdmin methods。
  3. 只跑PG runner.PP1FM04_primitive*與既有storecontract；freshservice依B08，wholecontract此階段仍Red明确保留，不假Green。
- **完成條件**：fixedraw/duplicateSQL、same-key5slock、rollback；其他store契約維持。；Red卡保留意圖失敗，Green卡對應namedcase轉綠。
- **驗證**：

```sh
./gradlew integrationTest --tests '*JdbcIdentityMaintenanceContractTests.PP1FM04_primitive*' --tests '*JdbcIdentityStoreContractTests' --no-daemon --no-parallel
```

- **對應 ID**：PP1-AC02、PP1-FM04。
- **預估大小**：M（240手寫行，含tests；上限400）。

<a id="b07"></a>

### PP1b-T08：B07 memory primitive Green

- **目標**：memory primitive Green，交付下列可觀察行為。
- **輸入**：main `identity/store/InMemoryIdentityStore.java`；unit memory/sharedcontract；依B05；精確完整檔名依§3同卡標籤，不使用表外路徑。
- **步驟**：
  1. memory方法在同adminGuard內raw讀完整map/auditJSON。
  2. snapshot所有maintenance state及lists，RuntimeException/Error直接還原private structures，不調faultwriter。
  3. 只跑memory runner.PP1FM04_primitive*與既有storecontract；freshservice依B08，wholecontract仍Red，B08/B10必全跑。
- **完成條件**：rawsnapshot/restore＋完整auditJSON查詢，deleted/race/fault不漏物件。；Red卡保留意圖失敗，Green卡對應namedcase轉綠。
- **驗證**：

```sh
./gradlew test --tests '*InMemoryIdentityMaintenanceContractTests.PP1FM04_primitive*' --tests '*InMemoryIdentityStoreContractTests' --no-daemon --no-parallel
```

- **對應 ID**：PP1-AC02、PP1-FM04。
- **預估大小**：M（280手寫行，含tests；上限400）。

<a id="b08"></a>

### PP1b-T09：B08 bootstrap Green

- **目標**：bootstrap Green，交付下列可觀察行為。
- **輸入**：main ProductionIdentityService＋Command wiring；unitshared／PG ProductionIdentityIntegrationTests；依B06/B07；精確完整檔名依§3同卡標籤，不使用表外路徑。
- **步驟**：
  1. ProductionIdentityService.freshInit按accounts§5固定順序補roles/admin13/grant/principal/credential/assignment/audit，不調seedUser。
  2. guard兩次assert包qualification與寫入，countUsableAdmins!=1 rollback，Result在commit後。
  3. command接真service，repeat NOT_FRESH不重置；PGnewconnection驗唯一admin／rolecatalogIDs與anonymousempty。
- **完成條件**：13grant exact、一正式admin、角色catalogIDs保留、repeat3不重置、新真Argon2 login，anonymous grant前拒絕。；Red卡保留意圖失敗，Green卡對應namedcase轉綠。
- **驗證**：

```sh
./gradlew test --tests '*InMemoryIdentityMaintenanceContractTests' --no-daemon --no-parallel
./gradlew integrationTest --tests '*JdbcIdentityMaintenanceContractTests' --tests '*ProductionIdentityIntegrationTests' --no-daemon --no-parallel
```

- **對應 ID**：PP1-AC02、PP1-FM04。
- **預估大小**：M（260手寫行，含tests；上限400）。

<a id="b09"></a>

### PP1b-T10：B09 recover Red

- **目標**：recover Red，交付下列可觀察行為。
- **輸入**：unit sharedcontract／CommandTests、PG ProductionIdentityIntegrationTests；依B08；精確完整檔名依§3同卡標籤，不使用表外路徑。
- **步驟**：
  1. sharedcontract新增active/locked/disabled±reenable、nonadmin/deleted/missing/damagedgrant fixture。
  2. 原lastLoginAt=T0−1day，該principal2active/1revoked sessions、另一principal sessions作negative；credential/principal/revoke/audit已寫後throw。
  3. operationId跨targetduplicate/race及recoveractualusernamepassword同字/大小寫exit2先有行為Red，CommandTests旗標/secret/Result不洩漏。
- **完成條件**：active/locked/disabled±flag/nonadmin/deleted/missing/damagedgrant、四writefault、跨targetopidduplicate、lastLogin/session/otherprincipal快照Red。；Red卡保留意圖失敗，Green卡對應namedcase轉綠。
- **驗證**：

```sh
./gradlew test --tests '*IdentityMaintenanceCommandTests' --tests '*InMemoryIdentityMaintenanceContractTests' --no-daemon --no-parallel
./gradlew integrationTest --tests '*JdbcIdentityMaintenanceContractTests' --tests '*ProductionIdentityIntegrationTests' --no-daemon --no-parallel
```

- **對應 ID**：PP1-AC02、PP1-FM04。
- **預估大小**：M（330手寫行，含tests；上限400）。

<a id="b10"></a>

### PP1b-T11：B10 recover Green

- **目標**：recover Green，交付下列可觀察行為。
- **輸入**：main ProductionIdentityService＋Command／兩store必要修正；unit/PG上述tests；依B09；精確完整檔名依§3同卡標籤，不使用表外路徑。
- **步驟**：
  1. recoverAdmin鎖內重讀duplicate與真admin資格，不能promote/create/repair。
  2. 鎖內資格重讀後PasswordPolicy.validate(target.username,CharBuffer(password))，才能hash/write；recoverConsole nullusername不能代替。targetusername≥12及大小寫同字密碼exit2零mutation，hashfaultrollback；再upsert→withLock0/null/active保留lastLoginAt→revoke→同txaudit。
  3. PG重建context回讀舊hash/session失效、新login成功、其他rows完整；fakeverifiedguard只能core。
- **完成條件**：newcredential、revoke、lastLogin保持、role/grant不動、rebuildcontext回讀；fakeverifiedguard只core，不稱hostrecover。；Red卡保留意圖失敗，Green卡對應namedcase轉綠。
- **驗證**：

```sh
./gradlew test --tests '*IdentityMaintenanceCommandTests' --tests '*InMemoryIdentityMaintenanceContractTests' --no-daemon --no-parallel
./gradlew integrationTest --tests '*JdbcIdentityMaintenanceContractTests' --tests '*ProductionIdentityIntegrationTests' --tests '*IdentityAuditAtomicWriteTests' --tests '*JdbcIdentityStoreIntegrationTests' --no-daemon --no-parallel
```

- **對應 ID**：PP1-AC02、PP1-FM04。
- **預估大小**：M（330手寫行，含tests；上限400）。

<a id="g01"></a>

### PP1b-T12：G01 target Red

- **目標**：target Red，交付下列可觀察行為。
- **輸入**：`scripts/local/maintenance-target.mjs`export scaffold、`maintenance-target.test.mjs`新；依PP1a；精確完整檔名依§3同卡標籤，不使用表外路徑。
- **步驟**：
  1. target.mjs先有export scaffold；test注入完整Docker/receipt/image/filesystem fixture。
  2. 逐項改jar/source/base/ingress/hash、network/containerID/privateIP/ports、extra mount、symlink/uid/mode，assert failclosed。
  3. 保存PP1FM04_targetProvenanceMustMatch namedRed，不執行產品Docker。
- **完成條件**：image/source/jar/base、unknownmount/network、noports/privateIP/containerreplacement、symlink/metadata/oldIP攻擊named Red。；Red卡保留意圖失敗，Green卡對應namedcase轉綠。
- **驗證**：

```sh
node --test scripts/local/maintenance-target.test.mjs
```

- **對應 ID**：PP1-AC02、PP1-FM04。
- **預估大小**：M（300手寫行，含tests；上限400）。

<a id="g02"></a>

### PP1b-T13：G02 target Green

- **目標**：target Green，交付下列可觀察行為。
- **輸入**：target.mjs/test＋`scripts/local/maintenance-media-probe.mjs`新；依G01；精確完整檔名依§3同卡標籤，不使用表外路徑。
- **步驟**：
  1. inspectTarget完整read-only核對PP1a三service/twointernalnetwork/volumes/imageIDs和三labels。
  2. deriveJDBC只由current inspectedPG-IP，正確cms_local與gateway，無userIP/DBport。
  3. 新增readonly no-network media probe按accounts§10，exactownedvolume、empty/file/symlink負例；無hostvolume直接讀假設。
- **完成條件**：fixedDocker socket、完整tuple/hash、derivedJDBC/databaseOID live證據，receipt自身不能過；owned readonly no-network media probe空樹/檔案/symlink拒絕；不改verify.mjs原freshzero。；Red卡保留意圖失敗，Green卡對應namedcase轉綠。
- **驗證**：

```sh
node --test scripts/local/maintenance-target.test.mjs
```

- **對應 ID**：PP1-AC02、PP1-FM04。
- **預估大小**：M（350手寫行，含tests；上限400）。

<a id="g03"></a>

### PP1b-T14：G03 quiescence Red

- **目標**：quiescence Red，交付下列可觀察行為。
- **輸入**：`scripts/local/maintenance-guard.mjs`export scaffold、`maintenance-guard.test.mjs`新；依G02；精確完整檔名依§3同卡標籤，不使用表外路徑。
- **步驟**：
  1. guard scaffold acquire/assert/bind/finish；同instance兩op、registryduplicate/UNKNOWN、APIrestart/idlePG/unknowncontainer負例。
  2. PRE_CONNECTION只容許0；BOUND恰1exactpid/epochtext，合法1＋偽同appname1拒絕、0/replacedbackend拒絕。
  3. recover verifierabsent/receipt-only先exit6，任何root/metadata錯不spawnJava。
- **完成條件**：兩operation互斥、duplicate/UNKNOWN拒絕、API restart/writer session/額外container/PGidle session拒絕、recover absentverifier6 Red。；Red卡保留意圖失敗，Green卡對應namedcase轉綠。
- **驗證**：

```sh
node --test scripts/local/maintenance-guard.test.mjs
```

- **對應 ID**：PP1-AC02、PP1-FM04。
- **預估大小**：M（280手寫行，含tests；上限400）。

<a id="g04"></a>

### PP1b-T15：G04 quiescence Green

- **目標**：quiescence Green，交付下列可觀察行為。
- **輸入**：guard.mjs/test；依G03；精確完整檔名依§3同卡標籤，不使用表外路徑。
- **步驟**：
  1. exclusivecommonlock＋O_EXCLop reservation，atomicprivatephasejournal；不TTLcleanup/forceunlock。
  2. fixedAPI-ID stop/inspect restart=no，全containers/PGclientbackend枚舉與live reassert；backendpin不可重綁。
  3. fail/signal/unknown保持停止/lock；missingPP1cbackup failclosed不mini backup；boundedcommandtime。
- **完成條件**：O_EXCL、fixed stop/API ID/noautoRestart、全部containers/PGsessions、reassert漂移fail，crash保留lock、noforceunlock；timeout bounded。；Red卡保留意圖失敗，Green卡對應namedcase轉綠。
- **驗證**：

```sh
node --test scripts/local/maintenance-guard.test.mjs
```

- **對應 ID**：PP1-AC02、PP1-FM04。
- **預估大小**：M（350手寫行，含tests；上限400）。

<a id="g05"></a>

### PP1b-T16：G05 TTY bridge Red

- **目標**：TTY bridge Red，交付下列可觀察行為。
- **輸入**：`scripts/local/maintenance.mjs`scaffold／`maintenance.test.mjs`新；main `identity/maintenance/LocalMaintenanceGuard.java`scaffold；unit CommandTests；依G04/B10；精確完整檔名依§3同卡標籤，不使用表外路徑。
- **步驟**：
  1. wrapper與LocalMaintenanceGuard先有scaffold，fakecommand/TTY/environment capture。
  2. 測Java前stop、DB前attach/zero、binduniqueconnection後fullassert/validate、samelease/target；新增1合法＋1偽backend負例。
  3. noTTY2、unknownflag2、matchingjar不符6、missingbackup6、secret不argv與ownedfinallycleanup行為Red。
- **完成條件**：Java前quiesce、sameleaseattach、liveassert、未configured不開DS、missingbackup無mutation、stdioinherit/argv白名單；非TTY2。；Red卡保留意圖失敗，Green卡對應namedcase轉綠。
- **驗證**：

```sh
node --test scripts/local/maintenance.test.mjs
./gradlew test --tests '*IdentityMaintenanceCommandTests' --no-daemon --no-parallel
```

- **對應 ID**：PP1-AC02、PP1-FM04。
- **預估大小**：M（310手寫行，含tests；上限400）。

<a id="g06"></a>

### PP1b-T17：G06 bridge Green

- **目標**：bridge Green，交付下列可觀察行為。
- **輸入**：maintenance.mjs／LocalMaintenanceGuard／config＋wrappertest；依G05；精確完整檔名依§3同卡標籤，不使用表外路徑。
- **步驟**：
  1. wrapperparse只固定三flags＋unique --，對匹配JDK/node/script/jar核對，不用shell。
  2. LocalGuard固定ProcessBuilder helperargv，attachment/preconnection/bind/quiesced，config不autoconfig；password由真TTY。
  3. exit0commit→journalCOMMITTED→sameAPI-ID start/30shealth→COMPLETE；close/restartfail5留COMMITTED，其他fail停止/lock、無mutationreplay。
- **完成條件**：JDK/node/script/jar固定核對、secret env不argv、close與commit/restart5分類、phase journaling與sameAPI-ID resume，訊號不auto replay。；Red卡保留意圖失敗，Green卡對應namedcase轉綠。
- **驗證**：

```sh
node --test scripts/local/maintenance.test.mjs
./gradlew test --tests '*IdentityMaintenanceCommandTests' --no-daemon --no-parallel
```

- **對應 ID**：PP1-AC02、PP1-FM04。
- **預估大小**：M（380手寫行，含tests；上限400）。

<a id="g07"></a>

### PP1b-T18：G07 account verifier/guard實測

- **目標**：account verifier/guard實測，交付下列可觀察行為。
- **輸入**：`scripts/local/verify-accounts.mjs`／`verify-accounts.test.mjs`新；`e2e-pp1-local/accounts.spec.ts`新的setup前置小段；依G06/B08；精確完整檔名依§3同卡標籤，不使用表外路徑。
- **步驟**：
  1. verifyAccounts單獨exports/CLI，initializedgraph精確assert，原PP1a verify.mjs不放寬。
  2. 用rootownedrun真TTYfresh-init保留code-onlyreceipt；額外PGidle/APIrestart/target漂移的負例新ownedrun各獨立。
  3. 初始化前freshverifier／後accountsverifier分開；noDBports與正常prodhealth、guardfailure零state改動。
- **完成條件**：N verifier exact initializedcounts與identitygraph；root執行ownrun fresh-init真TTY，停止中額外PG session/API restart拒絕、target漂移拒絕；ownedruntime恢復health。禁止硬編碼IP／測試容器混進productionproject。；Red卡保留意圖失敗，Green卡對應namedcase轉綠。
- **驗證**：

```sh
node --test scripts/local/verify-accounts.test.mjs
node scripts/local/verify-accounts.mjs --run-root <owned-run-root> --stage initialized --operation-id <operation-uuid>
```

- **對應 ID**：PP1-AC02、PP1-FM04。
- **預估大小**：M（340手寫行，含tests；上限400）。

<a id="q01"></a>

### PP1b-T19：Q01 SELF Red

- **目標**：SELF Red，交付下列可觀察行為。
- **輸入**：unit `PrincipalGovernanceApiTests.java`新增；依PP1a；精確完整檔名依§3同卡標籤，不使用表外路徑。
- **步驟**：
  1. PrincipalGovernanceApiTests使用ApiFixture valid session/Origin/CSRF、twoadmins。
  2. PATCHdisabled/POSTdisable/roles移除selfadmin各expectSELF403且session/role/status不變、恰一denial reason；nonselfLASTADMIN維持。
  3. 保存source200對期待403的行為Red，validation先SELF及retainadmin成功一起保留。
- **完成條件**：twoadmins時selfdisable/patch/selfdemotion403、session/roles不變；現source200產生行為Red，nonselfLAST_ADMIN回歸。；Red卡保留意圖失敗，Green卡對應namedcase轉綠。
- **驗證**：

```sh
./gradlew test --tests '*PrincipalGovernanceApiTests' --no-daemon --no-parallel
```

- **對應 ID**：Q25、PP1-FM05/06/07、PP1-AC02/06。
- **預估大小**：S（150手寫行，含tests；上限150）。

<a id="q02"></a>

### PP1b-T20：Q02 SELF/helper Green

- **目標**：SELF/helper Green，交付下列可觀察行為。
- **輸入**：main `identity/service/GovernanceDenialAudit.java`新、PrincipalAdminService／IdentityException／api/error/ErrorCode；unit PrincipalGovernanceApiTests／IdentityAuthTests／IdentityHardeningTests；runtime `services/cms-api/src/main/resources/openapi/openapi.yaml`僅三ErrorCode枚舉；依Q01；精確完整檔名依§3同卡標籤，不使用表外路徑。
- **步驟**：
  1. 新增三ErrorCode/factories與GovernanceDenialAudit sameTransactionRunner/AuditLog，不新建第二AuditLog；同步runtimeOAS的三枚舉（由Q04前移），讓既有MockMvc即時OAS驗證保持啟用。
  2. PrincipalAdminService先授權/target/inputs，再SELF-before-lastadminwrapper；6/8ctor相容，無Q23投影。
  3. denial白名單一次reason、unexpected不二記；同步舊auth/hardeningSELF期望，不移除securityassertions。
- **完成條件**：SELF先guard、validation先SELF、denial一次、unexpected不添denial、成功仍ok；不改Q23返回投影。；Red卡保留意圖失敗，Green卡對應namedcase轉綠。
- **驗證**：

```sh
./gradlew test --tests '*PrincipalGovernanceApiTests' --tests '*IdentityAuthTests' --tests '*IdentityHardeningTests' --no-daemon --no-parallel
```

- **對應 ID**：Q25、PP1-FM05/06/07、PP1-AC02/06。
- **預估大小**：M（260手寫行，含tests；上限400）。

<a id="q03"></a>

### PP1b-T21：Q03 purge Red

- **目標**：purge Red，交付下列可觀察行為。
- **輸入**：unit `EntryPurgeConfirmationApiTests.java`新；依Q02；精確完整檔名依§3同卡標籤，不使用表外路徑。
- **步驟**：
  1. EntryPurgeConfirmationApiTests valid auth/session/CSRF，no/body{}、missingkeys/wrongcase/space/空slug各400。
  2. 先surface/role再target再確認，再ref/CAS；anonymous401/target404/malformed400/nonJSON415各不businessaudit。
  3. source無body204產生Red；合法slug及canonicalUUID成功、未知JSONkey忽略。
- **完成條件**：no/{}body、wrongword/id/空slug400、wrong surface/role403先於confirmation、合法slug/UUID204、404/ref409、nonJSON415，validsession/CSRF；source204是意圖Red。；Red卡保留意圖失敗，Green卡對應namedcase轉綠。
- **驗證**：

```sh
./gradlew test --tests '*EntryPurgeConfirmationApiTests' --no-daemon --no-parallel
```

- **對應 ID**：Q25、PP1-FM05/06/07、PP1-AC02/06。
- **預估大小**：M（220手寫行，含tests；上限400）。

<a id="q04"></a>

### PP1b-T22：Q04 purge/OAS Green

- **目標**：purge/OAS Green，交付下列可觀察行為。
- **輸入**：main content/service/EntryService、content/web/AdminContentController；unit新purgetest／WaveEAcceptanceTests；PG contract/EntryAtomicWriteTests既有合法caller；`services/cms-api/src/main/resources/openapi/openapi.yaml`；依Q03；精確完整檔名依§3同卡標籤，不使用表外路徑。
- **步驟**：
  1. EntryService唯一5參purge刪3參overload，4/5ctor委派6參DI，controllerPurgeBody required=false取得current而不提前adminSurface。
  2. 按BW6唯一wrapper與writeTransaction順序，harddelete/detach/successaudit同tx，合法舊callers補DELETE/id。
  3. runtimeOAS僅Q25subset/52paths/原schemas，使用PP1.openapi增量合併移checksumextension，不blindcopy。所有4xx/5xx回應沿既有OpenApiCompletenessTests使用Error<status>共用$ref；確認錯誤範例留本文§4.2，不以inline400繞過原契約。
- **完成條件**：U purge＋WaveE/OpenApiContract/OpenApiCompleteness/ErrorCodeContract；3argoverload消失、6argDI同DS，合法callers不弱化CAS/ref/audit；OAS仅Q2552paths，保留原schemas。；Red卡保留意圖失敗，Green卡對應namedcase轉綠。
- **驗證**：

```sh
./gradlew test --tests '*EntryPurgeConfirmationApiTests' --tests '*WaveEAcceptanceTests' --tests '*OpenApiContractTests' --tests '*OpenApiCompletenessTests' --tests '*ErrorCodeContractTests' --no-daemon --no-parallel
```

- **對應 ID**：Q25、PP1-FM05/06/07、PP1-AC02/06。
- **預估大小**：M（330手寫行，含tests；上限400）。

<a id="q05"></a>

### PP1b-T23：Q05 PG denial/fault

- **目標**：PG denial/fault，交付下列可觀察行為。
- **輸入**：PG `contract/IdentityAuditAtomicWriteTests.java`、`EntryAtomicWriteTests.java`；依Q04；精確完整檔名依§3同卡標籤，不使用表外路徑。
- **步驟**：
  1. 兩atomicPGtests同DataSource及6參EntryService injecteddenialhelper；ambienttx rollback後用新connection讀denial。
  2. successaudit寫後throw回滾所有dependencies，denialaudit寫後throw500無partialaudit；unexpected不補denial。
  3. nonselfLAST_ADMIN並發回歸；denialaction/category/reason/once與state0mutate逐項assert。
- **完成條件**：ambientrollback後denial新連線恰1；denial寫後throw500無mutation/partialaudit；successauditfaultrollback；sameDS6arg並發LAST_ADMIN。；Red卡保留意圖失敗，Green卡對應namedcase轉綠。
- **驗證**：

```sh
./gradlew integrationTest --tests '*IdentityAuditAtomicWriteTests' --tests '*EntryAtomicWriteTests' --tests '*JdbcIdentityStoreIntegrationTests' --no-daemon --no-parallel
```

- **對應 ID**：Q25、PP1-FM05/06/07、PP1-AC02/06。
- **預估大小**：M（350手寫行，含tests；上限400）。

<a id="q06"></a>

### PP1b-T24：Q06 client/mock Red

- **目標**：client/mock Red，交付下列可觀察行為。
- **輸入**：`packages/api/src/client.test.ts`、`packages/mocks/src/handlers.test.ts`；依Q04；精確完整檔名依§3同卡標籤，不使用表外路徑。
- **步驟**：
  1. client實際fetch捕JSON，explicitbody exact/missingbody送出讓server400，沒有DELETE/idautofill。
  2. CSRF_FAILED purge一POST，下一次manualfetchfreshCSRF，其他PATCHS03一次retry保持。
  3. mockSELF/body/order及unknownkeys；拒絕不改roles/status/sessions/entries，namedRed。
- **完成條件**：explicitrawbody、missing400、不autofill、SELFpriorities、CSRF_FAILED purge僅一POST且nextmanual取新token，othersS03 unchanged Red。；Red卡保留意圖失敗，Green卡對應namedcase轉綠。
- **驗證**：

```sh
npm test --workspace @cms/api -- src/client.test.ts
npm test --workspace @cms/mocks -- src/handlers.test.ts
```

- **對應 ID**：Q25、PP1-FM05/06/07、PP1-AC02/06。
- **預估大小**：M（280手寫行，含tests；上限400）。

<a id="q07"></a>

### PP1b-T25：Q07 client/mock Green

- **目標**：client/mock Green，交付下列可觀察行為。
- **輸入**：`packages/api/src/{schema,admin,core}.ts`、`generated/schema.d.ts`生成；`packages/mocks/src/handlers/admin.ts`；上述tests；依Q06；精確完整檔名依§3同卡標籤，不使用表外路徑。
- **步驟**：
  1. api新增PurgeEntryRequest alias/generatedschema，purgeEntry(id,body?)只sendcallerbody。
  2. core.call optionaltypedretryCsrf defaulttrue，403先clearcache，purgefalse throw不refresh/retry；其他client不改。
  3. MSW只Q25增量；runtimeOAScodegen兩次fresh、typecheck，noQ23/Q24/rolepolicy。
- **完成條件**：typedoptionalretry defaulttrue、purgefalse/cacheclear、noextraAPIpaths/unknownkeyignore、mockdenial不改state；generated第二次無diff。；Red卡保留意圖失敗，Green卡對應namedcase轉綠。
- **驗證**：

```sh
npm test --workspace @cms/api -- src/client.test.ts
npm test --workspace @cms/mocks -- src/handlers.test.ts
npm run gen --workspace @cms/api
npm run typecheck --workspace @cms/api
```

- **對應 ID**：Q25、PP1-FM05/06/07、PP1-AC02/06。
- **預估大小**：M（280手寫行，含tests；上限400）。

<a id="q08"></a>

### PP1b-T26：Q08 dialog/Inspector Red

- **目標**：dialog/Inspector Red，交付下列可觀察行為。
- **輸入**：`apps/web-admin/src/confirm.test.tsx`新、`entries.test.tsx`、`principals.test.tsx`、`safety.test.tsx`；依Q07；精確完整檔名依§3同卡標籤，不使用表外路徑。
- **步驟**：
  1. 新增confirm.test exactword/target/ack/whitespace/case/pending/reset矩陣，發出請求數assert0。
  2. entries same-slugdifferentID/version/slug/action、null/emptyslugUUID、payloadcapture與manualreopen，deferredpromise無sleep。
  3. same-tickdoubleclick1POST、StrictModevalidcallback、oldresolve不能newnavigate/toast、SELF/confirmationcopy namedRed。
- **完成條件**：raw whitespace/case/empty、checkbox/pending、sameSlug-ID/version/slug/action/reset、capturedbody、same-tickdoubleclick一次、StrictMode合法callback、oldresolve不跳新頁、三新code文案Red。；Red卡保留意圖失敗，Green卡對應namedcase轉綠。
- **驗證**：

```sh
npm test --workspace @cms/web-admin -- src/confirm.test.tsx src/entries.test.tsx src/principals.test.tsx src/safety.test.tsx
```

- **對應 ID**：Q25、PP1-FM05/06/07、PP1-AC02/06。
- **預估大小**：M（390手寫行，含tests；上限400）。

<a id="q09"></a>

### PP1b-T27：Q09 dialog Green

- **目標**：dialog Green，交付下列可觀察行為。
- **輸入**：`apps/web-admin/src/confirm.tsx`、`copy.ts`；confirmtest必要修正；依Q08；精確完整檔名依§3同卡標籤，不使用表外路徑。
- **步驟**：
  1. ConfirmDialog新增optionalword/acklabel与rawcallback，nonpurge保留trim。
  2. purge兩rawexact＋ack，buttonclosure傳typed/word而非MouseEvent，pendinginputs/checkbox/cancel/submit全disabled。
  3. close清三state、copykeys與existinguiCheckbox，其他consumer零參相容；Q09只confirm全檔＋safety具名nonpurgeconsumerfilter，Q10全四檔必Green。
- **完成條件**：typed+word callback closure、purgeexact/ack、所有pendingcontrols、close3stateclear；其他零參consumer/trim確認照舊。；Red卡保留意圖失敗，Green卡對應namedcase轉綠。
- **驗證**：

```sh
npm test --workspace @cms/web-admin -- src/confirm.test.tsx
npm test --workspace @cms/web-admin -- src/safety.test.tsx -t PP1FM07_nonPurgeConsumersRemainCompatible
```

- **對應 ID**：Q25、PP1-FM05/06/07、PP1-AC02/06。
- **預估大小**：M（200手寫行，含tests；上限400）。

<a id="q10"></a>

### PP1b-T28：Q10 Inspector/error Green

- **目標**：Inspector/error Green，交付下列可觀察行為。
- **輸入**：`apps/web-admin/src/pages/entries.tsx`、`errors.ts`、entries/principals/safetytests；依Q09；精確完整檔名依§3同卡標籤，不使用表外路徑。
- **步驟**：
  1. Inspector外key id:version:slug、dialogkeyaction，null/emptyslugfallbackid。
  2. 實際EntryInspectorPage回傳處<Inspector key={id:version:slug}>；payload捕id/type/rawbody/inFlight/alive。完成先invalidate captured list＋exact keys.admin.audit({targetId:payload.id,action:'entry.',size:20})；stale return，不auditAll/nav/toast/setPending；alive才auditAll＋UI。nonpurge可更新captured detail；purge不invalidate detail。
  3. error匹配新codes先LASTADMIN/403，error關dialogmanualreopen，成功導航/StrictMode保留；GETdetailredirect不改。
- **完成條件**：key世代／payloadid/type＋inFlight/alive refs、rawJSONbody、manualreopen、UUIDfallback、copy順序；Front/Back介面不擴scope。；Red卡保留意圖失敗，Green卡對應namedcase轉綠。
- **驗證**：

```sh
npm test --workspace @cms/web-admin -- src/confirm.test.tsx src/entries.test.tsx src/principals.test.tsx src/safety.test.tsx
npm run typecheck
```

- **對應 ID**：Q25、PP1-FM05/06/07、PP1-AC02/06。
- **預估大小**：M（280手寫行，含tests；上限400）。

<a id="e01"></a>

### PP1b-T29：E01 localjourney acceptance

- **目標**：localjourney acceptance，交付下列可觀察行為。
- **輸入**：`e2e-pp1-local/accounts.spec.ts`完成、`playwright.pp1-local.config.ts`必要testmatch擴展；依G07/Q05/Q10；精確完整檔名依§3同卡標籤，不使用表外路徑。
- **步驟**：
  1. 在PP1a既有scopedtrustedbrowser工具執行新accounts.spec，retries0/trace/video/screenshotoff，run/CA/paths只私有tool紀錄。
  2. 正式admin登入→existingAdminUI建distinctoperator/allowlistpage/explicitgrants→BackCRUDpublish；anonymousgrant前拒、明示pagefrontgrant後published200/draft404。
  3. twoadminsSELF/DELETEtargetack/refs/CAS/resetoldsessions；unit/PG故障原子證據與browserobservable分層，不把corefakeguard說hostrecover成功。
- **完成條件**：existing scopedCA browser真API：formaladmin登入／既有UI建operator/roles/permissions、Back登入workpagecreate/publish、explicitanonymouspagegrant前拒後200、draft404、SELF403、DELETE+target/ack purge204；passwordreset oldsessions失效；完整fresh verifier不拿來驗initialized。；Red卡保留意圖失敗，Green卡對應namedcase轉綠。
- **驗證**：

```sh
CMS_PP1_SUITE=accounts CMS_PP1_TLS_MODE=trusted npm run e2e:pp1-local -- accounts.spec.ts
```

- **對應 ID**：PP1-AC02/06、PP1-FM04–07/15。
- **預估大小**：M（350手寫行，含tests；上限400）。

<a id="d01"></a>

### PP1b-T30：D01 rootdoc/review

- **目標**：rootdoc/review，交付下列可觀察行為。
- **輸入**：`docs/v2/waves/PP1b.md`新、`contracts/PP1-accounts.md`／`PP1-governance.md`、`waves/PP1.md`；依以上29卡；精確完整檔名依§3同卡標籤，不使用表外路徑。
- **步驟**：
  1. root逐張mapfailure/test/diff，同步三附約/主PP1狀態；本波implementationPR需approvedDOC_READY先合併。
  2. 完整原生gates/CI與獨立review，不因localbrowserpass跳過；compaction/provider未知統計記private不公開。
  3. PP1b可完成fresh/Q25，hostrecover/restore維持PP1c未完成；回讀遠端後root才能宣告VERIFIED。
- **完成條件**：root independentreview＋git diff --check＋必要nativefullgates/CI；刪過時ctorbridge、寫localguard白名單/CSRF補充與證據；PP1c dependency明列，未hostrecover不得寫fullrestore verified。；Red卡保留意圖失敗，Green卡對應namedcase轉綠。
- **驗證**：

```sh
git diff --check
./gradlew test integrationTest --no-daemon --no-parallel
npm run lint
npm run typecheck
npm test
npm run build
npm run test:bundle
npm run e2e:mock
```

- **對應 ID**：PP1-AC02/06、Q25。
- **預估大小**：S（150手寫行，含tests；上限150）。

## 7 測試規格

所有namedcase prefix包含既有AC/FM/Q25 ID。每case新store；unit不連Docker；PG uses `contract/PostgresFixture.cleanDataSource()`：每case新已migration schema，race threads共用該caseDS，不在thread再clean。T0=2026-10-01T00:00:00Z；formal fixture username=pp1.root/displayName=PP1 root/email=null，五systemroles固定T0与UUID（當case內比較）；密碼用當次randomownedchar[]符合既有政策，不寫literal秘密。

### 7.1 CLI／fresh／recovery（B01–B10）

| namedcase／檔案 | 前置／步驟 | 斷言／故障注入 |
| --- | --- | --- |
| PP1FM04_optionsAndSecretsAreRejectedWithoutEcho；unit CommandTests | fakeConsole兩ownedbuffers；固定New password/Confirm password prompts，capture真入口Hikari/Flyway rootOFF；unknown/duplicateflag、mode錯、confirm空白、UUID大小寫、username seed-、display81codepoints、noTTY | exit2、零DB/stop；各failure finally buffers0，stdout/stderr不含raw/hash/JDBC/profile；framewiring非missingclassRed |
| PP1AC02_maintenanceContextContainsOnlyExplicitBeans；unit CommandTests | mockmatchinglocalattachment与livezero；buildcontext正常canonicalprops | AuditLog/JDBC/sameDS存在，HTTP/controller/seeds/job/listeners/memory不存在；缺requiredprop、bind0/replacement、same-nameextra全拒 |
| PP1AC02_freshCreatesOnlyFormalAdmin；shared IdentityMaintenanceContract | role-only五標準，principal/grants/session/audit空；fresh-init | roleIDs/T0保留，admin13exact、oneactiveprincipal/credential/assignment/audit、session0，其他rolesgrants0；type/predicate真正null |
| PP1FM04_rawDeletedDataRejectsFresh／repeatPreservesEveryObject；shared | 逐rawtable單筆dirty，principal含softdeleted；snapshot後fresh/repeat | exit3，完整objects/IDs/hash/roles/session/audit不變；不靠filteredlist |
| PP1FM04_freshFaultsRestoreFullSnapshot；shared | credential/assignment/audit override先super後throw | RuntimeException/Error後snapshot恢復，PG新connection零partialcommit；memory直接private restore，不用faultwriter |
| PP1FM04_concurrentFreshCommitsOnce／lockTimeoutDoesNotWrite；shared＋PG | two threads/two conns/latch；Future.get10s；另一conn先持同advisorykey | 一commit、一NOT_FRESH；5slocktimeout exit4無write；不能sleep或用兩次串行當race |
| PP1AC02_anonymousRemainsDeniedUntilExplicitGrant；PG ProductionIdentityIntegrationTests | trueArgon2login admin，匿名grants空；合法pagepublished fixture後由Admin明示frontreadgrant | grant前403、後published200；draft404，無anonymousglobal或任意futuretypegrant |
| PP1FM04_recoveryDoesNotPromoteOrRepairGrants／disabledRecoveryRequiresExplicitFlag；shared | active=(2,null,T0−1day)、locked=(5,T0+15min,T0−1day)、disabled=(0,null,T0−1day)；nonadmin/deleted/missing/damagedgrant | active/locked可core恢復；disabled無flag3、有flagactive/0/null；lastLogin保持；非admin/grantdamage不創建／提升／修grants |
| PP1FM04_recoveryRejectsPasswordEqualToActualUsername；shared/CommandTests | targetusername取合成≥12字；matching/casevariantpassword作char[]，Console先nullusername，core再鎖內fullpolicy | exit2、無hash/write/audit/receipt，guardclose後維護停止；recoverhashfault同txrollback |
| PP1FM04_recoveryFaultsRestoreFullSnapshot／duplicateRecoveryCommitsOnce；shared | target兩active/一已撤sessions，otherprincipal/session；credential/principal/revoke/audit各super後throw；跨target同operationId | 所有hash/status/session/audit角色原樣；同operationId audit1，nonpaged全targetduplicate；malformedmemoryaudit internal5 |
| PP1AC02_recoveredIdentitySurvivesRestart；PG ProductionIdentityIntegrationTests | fakeverifiedguard只core；回復後close/reopen sameDScontext | newpassword真login、oldhash/session失效，allroles/grants/otherprincipal原值；不等同hostrecover通過 |

B04/B05另有直接store的四個primitive namedtests：PP1FM04_primitiveRawChecksDeleted/primitiveOperationLookupIsComplete/primitiveTransactionRollsBack/primitiveGuardSerializesOrTimesOut；B06/B07filter只暫時隔離service尚Red，B08/B10必全sharedcontract。

raw dirty vectors包括principal/credential/principal_role/permission/session/audit；角色非standard或system=false拒；恢復missingpasswordcredential可補，無其他credential種類。regular test fixture的locked nonself使用directIdentityRequest/validactor，不以被authfilter拒掉代替SELF業務assert。service/checkgroups指令逐卡§6。

### 7.2 local工具（G01–G07）

syntheticNodefixture：runId=32個a、sourceCommit=40個b、jarSHA=64個c；三service/container/network/image IDs使用各不相同的64hex字串，project/service labels完整；gateway=172.30.0.1/PGIP=172.30.0.2；DBcms/usercms_local；來源是fakeinspect資料，不是可用hostIP常數。metadatafiles0600/nlink1、root0700、無symlink；正常caseapi stopped/restart=no，PRE_CONNECTION0backend；BOUND只有pid101/backendStartEpoch字串、sameopappname/role/db/gateway，SQL每次currentpsqlpid排除。正式run IP/pid/start一律liveinspect/Javaquery導出。

| namedcase／檔案 | 動作／等待 | 斷言 |
| --- | --- | --- |
| it('PP1-FM04 target provenance must match')；maintenance-target.test.mjs | 改label/source/localjar/base/ingress/nodehash、container/network/volumeID | exit6/固定code，無write/stop；receipt自述不替代live來源 |
| it('PP1-FM04 target never publishes DB ports')；targettest | positivePortBindings={}、negative127.0.0.1binding/hostnetwork/extraalias/mount/container | negatives拒，privateIP/currentgateway必exact，不接受人工IP／publicIPv4 |
| it('PP1-FM04 metadata and media probe fail closed')；targettest | symlink/mode/uid/hardlink/missingfile；readonlyprobeempty/file/symlink/permissionerror | onlyexactownedvolume＋verifiednode/probe、no-network/RO/capdrop可讀；notempty/readerror拒、無刪除cleanup |
| it('PP1-FM04 lock and operation reservation are exclusive')；maintenance-guard.test.mjs | concurrentop用deferredcommand；existingop/UNKNOWN | onlyonelease，其他exit4/duplicate3；crashmetadata/lock保留，無TTL/forceunlock |
| it('PP1-FM04 backend pin is exact')；guardtest＋unit CommandTests | 合法1conn＋sameappname偽1conn、pidreuse不同epoch、bound0、clientnull或/32suffix | 每個拒；epochString逐字比較，不parseNumber/ISO；host(client_addr)裸RFC1918 IPv4必equalgateway |
| it('PP1-FM04 writers cannot restart during maintenance')；guardtest | 每assert injection APIrunning/restartpolicy/extraPGidle/container/targetdrift | exit6、沒有mutation；allcontainers包括stopped，只有exactreadonlyprobe額外白名單 |
| it('PP1-FM04 recover requires verified rollback backup')；guard/wrappertest | verifierabsent、receipt-only、wrongtarget/schema/artifact | exit6 RECOVERY_BACKUP_REQUIRED、Java未spawn／API未stop，無mini backup |
| it('PP1-FM04 TTY bridge preserves commit boundaries')；maintenance.test.mjs | fakechild2/3/4/5/6/0，commitresultwrite/leaseclose/APIstart/healthfault | stdioinherit、secretneverargv；非0停止/lock，commit後failure5標COMMITTED而非rollback/replay；readonlyinspect不unlock |
| it('PP1-AC02 initialized graph is exact')；verify-accounts.test.mjs | matchingop/result與rowgraph；一欄count/assignment/grant/successaudit錯 | fullinitializedgraphpass、任何mismatch非0，不能以partialcount代替roles/permissionsexact |

G07真正localguard負向run每case新ownedproject或同一未commit狀態、fixture工具不能改其他資源。live額外PG session與APIrestart後assert拒並查DBsnapshot不變；pool一合法＋一偽同name由existingPG16實測，pid/start/clientAddr以實際查詢取得，不因network格式問題擴許可。

### 7.3 Q25 API／PG（Q01–Q05）

| namedcase／檔案 | 前置／動作 | 斷言 |
| --- | --- | --- |
| PP1FM05_selfCannotDisableOrDemoteWithSecondAdmin；PrincipalGovernanceApiTests | ApiFixture twoactiveadmins＋validcookie/AdminOrigin/CSRF；patchdisabled/disable/rolesremoveadmin | SELF403，target/session/roles不變、denial1reason；retainadmin與profilesuccess；wrongrole/inputvalidation先SELF |
| PP1FM05_nonSelfLastAdminGuardStillHolds；same＋JdbcIdentityStoreIntegrationTests回歸 | nonself最後usableadmin、adminpermissionmatrix變更＋race | LAST_ADMIN403／count語義和同鎖不變，沒有新LAST_ADMIN_FORBIDDEN |
| PP1FM06_purgeRequiresRawWordAndTarget；EntryPurgeConfirmationApiTests | existingentry slug=purge-page；no/{}body/missingvalue、delete/DELETE空白、id大小寫、emptyslug/emptyid、unknownkey | wrong確認400 CONFIRMATION_REQUIRED＋denial1；正canonicalUUID或slug204；unknownkey不替確認 |
| PP1FM06_purgeGateOrderIsStable；same | anonymous、Back、nonadmin、missingentry、referenced、faultCAS、malformedJSON/pathUUID/nonJSON | 401/403/403/404/409/409/400/415優先序精確；404/JSON/input不businessdenialaudit；role不是grantshortcut |
| PP1FM06_successAuditFaultRollsBackAndDenialSurvivesAmbientRollback；PG兩atomictests | EntryService6參sameds；successaudit先insert後throw、outerambientrollback；denialaudit自身insert後throw | success全rollback、denial獨立新conn恰1；denial自身fault500/0partialaudit、mutation0；unexpected不補denial |

ApiFixture也逐一保留wrongOrigin/noCSRF/noGrant原securitycases。refs/CAS rejection不得刪dependencies；legalpurge更新WaveE/PG callers携帶DELETE/id，沒有3參bypass。PGsnapshot包含principal/status/roles/sessions與entry/revision/ref/index/mediaattachment/audit；測count外亦比較ID和值。

### 7.4 client／dialog／Inspector（Q06–Q10）

每test reset MSW/fixtures，deferredPromise控制pending不sleep；QueryClient設定mutations.retry=false（existingdefault不另增重試）。clienttest捕實際fetchpath/body/POSTcount，不只snapshotdisabledbutton；mock只驗contract，不算PG交易證據。

| namedcase | 前置／動作／等待 | 斷言 |
| --- | --- | --- |
| it('PP1-FM06 purge sends exact caller confirmation')；api client.test.ts | purgeEntry(id,rawbody)、purgeEntry(id) | JSONraw全等；missingbody送server400，不autofillDELETE/id |
| it('PP1-FM07 purge never retries CSRF failures')；clienttest | firstPOST403CSRF_FAILED；nextmanual；普通PATCH403CSRF_FAILED | firstpurgePOST1/noimmediatefreshCSRF；cachedtoken已clear，nextmanual新取token；PATCH原一次refreshretry |
| it('PP1-FM05 mock SELF and purge order preserve state')；mocks handlers.test.ts | twoadminsSELF/invalidroles/wrongsurface/missingtarget/confirm | 同APIorder/code；roles/status/sessions/entries原樣 |
| it('PP1-FM07 purge requires two raw values and acknowledgement')；confirm.test.tsx | 每missing/space/case/empty＋ackfalse/true，confirm-input/word/checkbox | notready0requests、readycallback實際rawtyped/word，無MouseEvent；pending所有controlsdisabled |
| it('PP1-FM07 confirmation resets with target and action')；entries.test.tsx | A(idA,slug=s,v1)→B(idB,s,v1)；A v2；A slug=t；action/cancel/reopen | 3state全部空，null/emptyslug只canonicalUUID；rawwrong不mutate |
| it('PP1-FM07 same tick double click submits once')；entries.test.tsx | 同act兩click、deferredrequest未resolve | 同步inFlight只一POST、pending不能cancel/改確認；error關dialog、manualreopen空 |
| it('PP1-FM07 StrictMode and stale completion are safe')；entries.test.tsx | StrictMode setup/cleanup/setup；validpurge；pending切B後Aresolve | validcallback全域auditAll/導航toast照舊；oldpayload仍targetA，只invalidate captured list/exacttargetaudit，assert未invalidate B audit／auditAll，B不navigate/toast/setPending，B確認空 |
| it('PP1-FM05 SELF and confirmation errors use specific copy')；principals/safety/entries tests | 三newcodes及LAST_ADMIN/generic403 | copykey優先，無404導航；existingGET403redirect/selfbutton/rolelock保持 |

### 7.5 本地可見旅程（E01）

config新增**test-only** CMS_PP1_SUITE=runtime|accounts（default runtime；unknown拒），runtime testMatch僅runtime.spec.ts，保留PP1a無參數trusted/untrustedrunner；accounts testMatch僅accounts.spec.ts且TLS_MODE必trusted，錯mode直接拒、不skip。credential socket只trustedaccounts worker beforeAll讀，--list/runtime/untrusted不連socket或要求secret；--list仍列accountscase但不連socket。E01命令必帶CMS_PP1_SUITE=accounts，沒有新的產品配置。

檔案`e2e-pp1-local/accounts.spec.ts`；唯一case `PP1-AC02 formal accounts and explicit grants`，以下Q25/reset使用`test.step('PP1-FM05/06 minimum Q25 journey')`與`test.step('PP1-FM15 password reset invalidates old sessions')`，此case timeout120s。單一case新ownedrun／oncecredential，不依賴其他test執行順序。所有case在**root已初始化的ownedrun**执行且非untrustedmode；untrusted仍只runtime.spec。正式owner操作仍是真TTY人工輸入。root的owned本地驗收使用既有Python stdlib PTY private driver：當次randompassword只在driverprocess記憶體，真PTY供Console兩次輸入，不放argv/env/file/chat/trace、不放寬產品System.console。這是新owned本地正式principal，非seed／非替owner選正式主機密碼。Playwrightworker與driver不共享記憶體：driver於owned0700目錄建0600一次性Unixsocket；browsercontainer只readonly掛該socket／非secretCA/receipt，env僅`CMS_PP1_CREDENTIAL_SOCKET=/run/pp1/credential.sock`與run/op等nonsecret值。accounts.spec在trusted beforeAll用existingnode:net讀一次bounded JSON `{runId,operationId,username,password}` 到worker變數，核對run/op與receipt、單response≤4096bytes／10s timeout、關socket；driver只回一次後close/unlink本次socket。secret不經HTTP或env，rootprivate driver不是產品runtime工具／dependency，其exactargv/hash/redaction evidence只留private驗收artifact。driver與worker使用後清ownedbuffers／reference，不聲稱JS/provider沒有String副本；trace/video/screenshotoff、不consolebody/credential、失敗只fixedcode。--list不讀socket；untrustedmode不宣告帳號測試；缺socket／timeout／secondread直接fail，不fallbackseed。

合成journey新principal：distinct pp1.operator（API回temporarypassword只memory）、secondadmin pp1.guard（只testtwoadmins，不是bootstrappromotion）；fixturepage slug=pp1-page、title=PP1 page、body=fixture、draftpage slug=pp1-draft、title=PP1 draft；IDs使用API回傳UUID不硬編。operatorroleassignmentallowlist[page]、八typeactions與globalmanage_media沿accounts§5.1，匿名initialgrants空，只在此case明示pagefrontreadgrant。唯一case資料命名suffix≤8lowerhex，cleanup只經合法API本case rows；不dropDB/deletevolume。該case入口要求fresh初始化graph／anonymousempty；重跑要新ownedrun與新operation，不能清空既有rolepermissions绕過防誤清空規則。

| # | 動作／定位 | 等待 | 斷言 |
| --- | --- | --- | --- |
| 1 | Admin /login 用角色/name帳號與登入，existingoncepassworddialog取得operatorpassword | me/querysettled | adminnormalprod登入、exactAPIorigin、securecontext，零localhost8080 |
| 2 | existingAdmin principals/roles UI建立operator/explicitpageallowlist与permissions | 真API成功且readback | distinctprincipal/operatoronly、無manage_principals/types/settings/read_audit；otherroles/catalog不變 |
| 3 | Back /sign-in登入operator，existinggenericpageform create/update/publish | response200/201與list/detailsettled | contentType=page、slug/title/body保存，operatorAdmingovernance403 |
| 4 | Front origin page.evaluate fetch `https://api.cms.test:8443/api/v1/public/content-types/page/entries/<id>` withcredentialsinclude | request完成 | anonymousgrant前403；Admin明示frontpagegrant後published200、draft/deleted404；不新增FrontpageUIroute |
| 5 | secondadmin testSELF API與Admintoast；Inspector開purgedialog用confirm-input/word/ack | result/disabledstate可見 | self兩admin仍403、missing/wrong400／UI0request、refs409；合法DELETE+target204並導航lookup |
| 6 | deferredpage.route限定本testexactpurgepath一次回CSRF_FAILED，manualreopen後unroute | firstresponse403與dialogclosed | firstPOST1、reopen確認空；不使用route模擬PG原子證據 |
| 7 | Admin resetoperatorpassword、oncepassworddialog新值，再用oldsession與old/newpassword | 真API401/新login200 | 舊targetsession全部無效、otherprincipalsessions保持，unlockdisabled仍拒 |

新增route故障限定`page.route('https://api.cms.test:8443/api/v1/admin/entries/<captured-id>/purge', route=>route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({error:{code:'CSRF_FAILED',message:'CSRF check failed'},requestId:'pp1-case'})}))`，只clienttransportcase且finallyunroute；成功／SELF／確認／ref／reset必真API。用role+name或既有data-testid，不加新產品testid或magicCSSlocator。

## 8 失敗模式對照

沿既有PP1 IDs，不新建產品功能ID。各matrixcase都有§7namedtest與§6focusedcommand；沒有未覆蓋FM被當成功。

| FM ID | 情境 | 期望 | 測試／卡 |
| --- | --- | --- | --- |
| PP1-FM04 | invalid/duplicateCLI、confirmation空白、非TTY | exit2零stop/DB、ownedbuffer清零／無secrettext | optionsAndSecrets／B01–B03/G05 |
| PP1-FM04 | 無adapter/attachment、錯target/hash/IP/ports/metadata | exit6零mutation、不fallback | targetProvenance／G01/G02/G05 |
| PP1-FM04 | commonleasebusy／DBadvisorytimeout | exit4、零write，noauto retry | lockReservation/lockTimeout／B05/B06/G03/G04 |
| PP1-FM04 | rawdirty/softdeleted/customroles/repeat | exit3 NOT_FRESH，原objects不變 | rawDeleted/repeat／B04/B08 |
| PP1-FM04 | fresh/recover hash/DB/schema/auditfault | exit5同tx全rollback；commit後receipt/closefault另標COMMITTED | faultSnapshot/TtyCommitBoundary／B05–B10/G06 |
| PP1-FM04 | active/locked/disabled recover／nonadmin/grantdamage | 合法core新credential/session撤；disabled無flag3，非admin不提權 | recoveryQualification／B09/B10 |
| PP1-FM04 | recover duplicateopID／cross-targetold audit | exit3 DUPLICATE_OPERATION、audit1、不重寫 | duplicateRecovery／B09/B10 |
| PP1-FM04 | missingverifiedrollbackbundle/receipt-only | exit6 RECOVERY_BACKUP_REQUIRED、API未stop/Java未spawn | recoverBackupGate／G03/G05/G06；hostsuccess待PP1c |
| PP1-FM04 | activewriter/PGidle/unknowncontainer | exit6停止保留、零DB/mediawrite | writersCannotRestart／G03/G04/G07 |
| PP1-FM04 | exactbackendmissing/replaced／合法1+偽同name1／addr格式/null | exit6不可rebind、privateepochtext精確、host(addr)exactgateway | backendPin／B03/G03/G05/G07 |
| PP1-FM05 | 未登入/wrongsurface/noGrant | 原401/403原code，授權deny一次、不SELF二記 | ApiFixturesecuritycases／Q01–Q05 |
| PP1-FM05 | selfdisable/demotion、有第二admin | SELF403、state/session0change、denial1 | selfCannotDisableOrDemote／Q01/Q02/Q05 |
| PP1-FM05 | nonselflastusableadmin/adminmatrix | LAST_ADMIN403，既有guard/count不變 | nonSelfLastAdmin／Q02/Q05 |
| PP1-FM06 | purge無body／wrongword/id/emptyslug | 400 CONFIRMATION_REQUIRED、denial1、zero mutation | purgeRawWordAndTarget／Q03/Q04 |
| PP1-FM06 | missingtarget／malformedJSON/path／nonJSON | 404 ENTRY_NOT_FOUND／400 VALIDATION_FAILED／415 MEDIA_TYPE_NOT_SUPPORTED、不businessaudit | purgeGateOrder／Q03/Q04 |
| PP1-FM06 | refs/CASconflict／successauditfault／denialauditfault | 409 REF_CONSTRAINT/VERSION_CONFLICT zerochange；fault500無partial | PGatomic／Q04/Q05 |
| PP1-FM07 | missingack/whitespace/case／pending | UI0requests、exactrawpayload、allcontrolsdisabled | dialogExact／Q08/Q09 |
| PP1-FM07 | id/version/slug/action/cancel切換／oldresolve | reset空、capturedid不漂、newpage無oldtoast/nav | reset/StrictMode／Q08/Q10 |
| PP1-FM07 | same-tickdoubleclick／CSRF_FAILED/networktimeout | 一POST，error後manualreconfirm，nextmanual新CSRF，其他S03不變 | clientNoRetry/doubleClick／Q06–Q10 |
| PP1-FM15 | operator越權／公開draft／reset/restart | governance403、draft404、oldsessions401/newlogin200、同版重啟回讀 | localjourney／B10/E01 |

## 9 交付檢查表

以下為產品交付檢查表，目前一律未勾；由root根據實際證據更新。施工圖審查通過與文件PR合併僅使DOC_READY生效，不代表產品VERIFIED。

- [ ] PP1a VERIFIED與本PP1b DOC_READY前置已由root回讀已合併main；30carddiff各≤400且獨立review通過。
- [ ] B/G/Q focused Red意圖與Green結果有compactevidence；regularJUnit不需Docker，PGcontract真PostgreSQL、sameDS/fault/race通過。
- [ ] localadapter真正停寫/epochpin/ownedmedia負例已觀察；沒有以receipt/mock/PP1aprobe替代、沒有DBports/hostnetwork/docker.sock掛app。
- [ ] fresh-init trueTTY／initializedverifier／normalprodrestart／distinctoperator／explicitpublicgrant／Q25/reset scopedTLS真browser旅程有觀察結果，privatecredential無trace/log。
- [ ] OAS僅Q25增量、52paths、原projection/email/schema不變；codegen第二次無diff，relative links與source refs有效。
- [ ] `./gradlew test integrationTest --no-daemon --no-parallel`、`npm run lint`、`npm run typecheck`、`npm test`、`npm run build`、`npm run test:bundle`、`npm run e2e:mock`、`git diff --check` 與requiredCI全通過；失敗或未跑明列。
- [ ] root更新主PP1/readiness/README與privatehandoff，正常PR/CI/review/合併/遠端回讀後才宣告本子波VERIFIED；文件worker只寫三個授權文件，不代操作。
- [ ] **hostrecover-success/完整restore依PP1c仍未完成**；formalhost/TLS、backup/upgrade/ops不被本地fresh/Q25通過代替。

查閱2026-10-09：backend網路/epoch序列化官方來源與精確SQL見[帳號附約§10.3](../contracts/PP1-accounts.md)。外部查證不是產品runtime證據。

2026-10-09施工校正：既有MockMvc會即時驗證runtimeOAS，所以三個已批准ErrorCode枚舉前移Q02；purge400沿原生共用Error400引用，HTTP行為不變。原B03實作估算超400，拆B03a/B03b而不省斷言，總30卡；原來源白名單與產品範圍不擴。此校正經獨立文件審查、必要CI並正常合併後才生效，未完成產品驗收。

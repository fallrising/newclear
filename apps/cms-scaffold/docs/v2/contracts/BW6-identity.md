# BW6 身份與治理施工附錄

日期：2026-10-06。狀態：文件交付候選；DOC_READY 隨根施工圖必要 CI／審查與合併生效，沒有宣稱產品已實作。範圍：Q-23、Q-24、Q-25、Q-26 與 owner 同日批准的 BQ-14 B。W6畫面及治理mock語義另波；本波shared卡只補required fixture欄位與媒體page相容性。

## 1. 權威、基準與不做

依 [01 §13](../01-frontend-sdd.md#13-開放問題與已知衝突) 最新 A、[02 §7／8](../02-backend-sdd.md#7-後端波次) 與 [BQ-14 B 決定](../02-backend-sdd.md#8-開放問題)。保留五系統角色、現有加性 matcher／predicate／surface hard-deny、usable-admin 判斷、P0 樂觀鎖與跨 store 原子寫入。確認僅套用既有 entry purge；不新增 media purge、角色 CRUD、type disable 的 DELETE 確認、新 assignment primitive、migration、依賴、UI或clinic專用command。

來源基準為 W5 合併來源；本附錄所在文件分支 HEAD `28282404d07a7898d48b9ec3ac8fb79c8711c9d9`，CMS 程式未變。下文 main／test／it 路徑簡寫分別展開為 `services/cms-api/src/main/java/com/fallrising/cms/`、`services/cms-api/src/test/java/com/fallrising/cms/`、`services/cms-api/src/integrationTest/java/com/fallrising/cms/`；resource 展開為 `services/cms-api/src/main/resources/`。所有「新增」方法在本波實作，不能當作既有 API。

| 來源 | 本波依據 |
| --- | --- |
| main `identity/domain/Principal.java:6–17,33–35`；resource `db/migration/V2__identity.sql:12,46–50` | lastLoginAt、role assignments 已存在，不新增資料欄位。 |
| main `identity/service/AuthService.java:83–94,142–145` | login 更新真實 lastLoginAt；manage_principals gate。 |
| main `identity/web/PrincipalController.java:46–50,154–161` | 現有列表與 Principal 投影缺新欄位。 |
| main `identity/service/PrincipalAdminService.java:125–184,249–259` | email null保留；disable兩入口與roles已有atomic guard。 |
| main `identity/store/JdbcIdentityStore.java:308–358`；main `identity/store/InMemoryIdentityStore.java:240–295` | usable admin含active、非deleted、admin assignment與admin面manage_principals；保留advisory／synchronized guard。 |
| main `identity/service/AuthorizationService.java:69–77,179–191,243–250` | governance缺grant既有獨立denied audit；授權為OR聯集，沒有deny。 |
| main `identity/service/SeedService.java:62–85,124–133,174–194` | Order0先建principals；舊operator標準九列；existing seedUser原本whole-role replace。 |
| main `content/service/ContentTypeSeed.java:25–40,130–135`；main `content/service/DemoContentSeed.java:27–51` | 類型Order100，entry資料Order200依賴seed principals；appointment_request已註冊。 |
| main `content/service/EntryService.java:57–74,460–478`；main `content/web/AdminContentController.java:218–236` | purge已檢查admin角色與surface、refs／version／attachments／audit。 |
| main `platform/TransactionRunner.java:12–57`；main `identity/service/AuditLog.java:21–36` | JDBC同DataSource交易；independently為REQUIRES_NEW；in-memory runner沒有通用rollback。 |
| [surface-admin §8](../../specs/surface-admin.md#8-危險操作)；[surface-front §3.5](../../specs/surface-front.md) | DELETE＋id／slug；SELF禁止；會員申請由Back接手而不publish申請。 |

## 2. 實作檔案白名單

根施工圖將本表與其他 BW6 子集合併；本附錄本輪只寫文件。根持有完整BW6設計契約；身份API實作卡須先把自己影響的runtime OpenAPI subset同步後跑response validator，根最後契約卡只做完整一致性／codegen／client。無任何身份卡依賴根最後卡完成。

| 檔案（依上文前綴展開） | 動作 | 用途／卡 |
| --- | --- | --- |
| main `identity/domain/PrincipalAdminView.java` | 新增 | HTTP角色投影及Red宣告，BW6-T13/BW6-T14 |
| main `identity/domain/IdentitySeedChange.java` | 新增 | 條件式seed輸入／結果record，BW6-T21 |
| main `identity/service/OperatorSeedPolicy.java` | 新增 | 精確canonical比對與typed grants及Red宣告，BW6-T20/BW6-T21 |
| main `identity/service/OperatorPermissionSeed.java` | 新增 | Order200 finalization及Red宣告，BW6-T20/BW6-T25 |
| main `identity/service/GovernanceDenialAudit.java` | 新增 | 一次獨立denied audit，BW6-T18 |
| main `identity/service/PrincipalAdminService.java` | 修改 | view/filter、email、SELF與denied，BW6-T14/BW6-T16/BW6-T18 |
| main `identity/service/SeedService.java` | 修改 | 新角色初始化與clinic保護，BW6-T25 |
| main `identity/store/IdentityStore.java` | 修改 | role-filter／batch與CAS介面及Red scaffold，BW6-T13/BW6-T14/BW6-T22/BW6-T23 |
| main `identity/store/JdbcIdentityStore.java` | 修改 | 查詢與條件轉換／共同row locks，BW6-T14/BW6-T23 |
| main `identity/store/InMemoryIdentityStore.java` | 修改 | 查詢與synchronized snapshot rollback，BW6-T14/BW6-T23 |
| main `identity/web/PrincipalController.java` | 修改 | role query與全部投影，BW6-T14 |
| main `identity/IdentityException.java`；main `api/error/ErrorCode.java` | 修改 | SELF403／CONFIRMATION_REQUIRED400，BW6-T18 |
| main `content/web/AdminContentController.java`；main `content/service/EntryService.java` | 修改 | purge確認及單次拒絕審計，BW6-T18 |
| test `PrincipalGovernanceApiTests.java` | 新增 | Q23、SELF與授權，BW6-T13/BW6-T17 |
| test `AdminInputValidationApiTests.java` | 修改 | Q24紅綠回歸，BW6-T15 |
| test `contract/IdentityStoreContract.java` | 修改 | Q23兩store一致，BW6-T13 |
| test `EntryPurgeConfirmationApiTests.java` | 新增 | Q25確認與拒絕，BW6-T17 |
| test `OperatorSeedPolicyTests.java` | 新增 | canonical／custom／restart，BW6-T20 |
| test `OperatorPermissionSeedTests.java` | 新增 | listener流程、seed-disabled，BW6-T20/BW6-T25 |
| test `contract/IdentitySeedStoreContract.java`；test `contract/InMemoryIdentitySeedStoreContractTests.java` | 新增 | CAS／rollback／race共用案例與memory adapter，BW6-T22 |
| it `contract/JdbcIdentitySeedStoreContractTests.java` | 新增 | 同shared contract PostgreSQL adapter，BW6-T22 |
| it `contract/IdentitySeedConcurrencyTests.java` | 新增 | JDBC與管理寫入競爭／query數，BW6-T22 |
| it `contract/IdentityAuditAtomicWriteTests.java`；it `contract/EntryAtomicWriteTests.java` | 修改 | success／denied rollback與更新合法purge呼叫，BW6-T18/BW6-T19 |
| main `content/service/DemoContentSeed.java` | 修改 | 寫入前整組授權預檢與skip notice，BW6-T25 |
| test `content/service/DemoContentSeedTests.java` | 新增 | custom startup／predicate／兩種listener次序／DB失敗，BW6-T24 |
| test `ClinicAppointmentOperatorApiTests.java` | 新增 | 真實API Q26矩陣，BW6-T26 |
| test `IdentityHardeningTests.java` | 修改 | SELF業務拒絕斷言同步、其他guard保留，BW6-T18 |
| test `IdentityAuthTests.java` | 修改 | 舊sole-admin SELF斷言同步，BW6-T18/BW6-T26 |
| test `WaveEAcceptanceTests.java` | 修改 | 原合法purge補body，BW6-T18/BW6-T26 |
| resource `openapi/openapi.yaml` | 修改 | BW6-T14同步Principal／CreatedPrincipal與list query、BW6-T16同步Patch email description、BW6-T18同步PurgeEntryRequest／operation／3 errors；先於各API綠燈。 |
| `docs/v2/contracts/BW6.openapi.yaml` | 根唯讀輸入 | 完整設計契約，根最後卡做整份對齊／gen，不是身份API卡綠燈前置。 |

main `identity/service/AuthorizationService.java`、`content/service/ContentTypeSeed.java`、migration、web-app、packages程式與workflow均不在本子集實作白名單。

## 3. HTTP 與 Java 契約

### 3.1 Q-23 帳號投影／查詢

新增 `identity.domain.PrincipalAdminView`：

```java
public record PrincipalAdminView(Principal principal, List<String> roles) {
    public PrincipalAdminView {
        roles = roles.stream().distinct().sorted().toList();
    }
}
```

內部 `Principal` 不改。新增 `PrincipalAdminService.list(IdentityRequest request, List<String> roleValues)` 回 `List<PrincipalAdminView>`；新增 `view(Principal)` 回 `PrincipalAdminView`，供get/create/patch/disable/unlock的HTTP投影；create保留existing `CreatedPrincipal`、temporaryPassword只回一次，由controller對 `created.principal()` 呼叫view。

1. controller以 `request.getParameterValues("role")` 取得原始多值，null傳空list，否則 `Arrays.asList(values)`；service `list`先requireManagePrincipals。值數>1（包含重複空值）→400 VALIDATION_FAILED；無值或唯一值 `isBlank()`＝不篩選；非空值不trim，須 `store.findRoleByCode(value).isPresent()`，未知code→400 VALIDATION_FAILED；目前標準庫有五系統code，不能因role有零grant而當未知，也不私自刪除既存其他role資料。
2. `store.listPrincipals(role)`只依真實assignment篩選；不另外限定active；排除deleted、username升序、多role不重複principal。空結果batch不發SQL。
3. 一次 `store.rolesOfPrincipals(List<UUID>)`，由assignment code建立roles。零grant角色仍輸出；禁止從effectivePermissions推roles。資料投影SQL為1＋非空時1；非空role另有findRoleByCode驗證1次。排除授權查詢後，無role非空列表2次、有效role非空列表3次；相應空列表1／2次，與列數無關。
4. controller `principalJson(PrincipalAdminView)`明列 `id,username,displayName,email,status,roles,lastLoginAt`；lastLoginAt轉 `toString()`或null。所有Principal回應一致，包括create與兩個status入口；`page=0,size=total=過濾後items.size`不變。
5. `GET /auth/me` 的MePrincipal不改。`countUsableAdmins`不改，也不以roles篩選列表替代安全guard。

新增IdentityStore簽名（舊無參list仍保留）：

```java
List<Principal> listPrincipals(String roleCode); // null＝全部
List<PrincipalRoleAssignment> rolesOfPrincipals(List<UUID> principalIds);
```

JDBC兩條完整SQL，參數順序依`?`由左至右：

```sql
SELECT p.* FROM cms_principal p
WHERE p.deleted_at IS NULL
  AND (CAST(? AS text) IS NULL OR EXISTS (
    SELECT 1 FROM cms_principal_role pr JOIN cms_role r ON r.id = pr.role_id
    WHERE pr.principal_id = p.id AND r.code = ?))
ORDER BY p.username;
-- bind roleCode兩次；null用PreparedStatement.setNull(Types.VARCHAR)，避免unknown參數型別

SELECT pr.principal_id, pr.role_id, r.code AS role_code, pr.content_type_codes
FROM cms_principal_role pr JOIN cms_role r ON r.id = pr.role_id
WHERE pr.principal_id = ANY(?::uuid[])
ORDER BY pr.principal_id, r.code;
-- bind Connection.createArrayOf("uuid", principalIds.toArray())；empty先回List.of()
```

in-memory篩principal後按username排，batch以輸入UUID set選assignment並按principalId.toString()／roleCode排；view再sort roles，所以不依SQL／ConcurrentHashMap順序。

OpenAPI `Principal` required新增`roles,lastLoginAt`；roles為array/string（不設enum；真實已指派role code排序，空array合法），lastLoginAt為string/date-time/nullable。獨立`CreatedPrincipal`同步兩欄與required。GET principals新增optional role string query（不設enum；缺省或blank不篩選、重複或未知非空400）；本波根契約避免把其他schema的role assignment誤改為字串array。

成功例：`GET /principals?role=member`→200 `{"items":[{"id":"10000000-0000-0000-0000-000000000002","username":"bw6.member","displayName":"BW6 member","email":null,"status":"active","roles":["editor","member"],"lastLoginAt":null}],"page":0,"size":1,"total":1}`。Admin以外surface／缺grant沿用403 SURFACE_FORBIDDEN／FORBIDDEN；未登入401 UNAUTHENTICATED；無效role400 VALIDATION_FAILED。

### 3.2 Q-24 email

`PrincipalAdminService.patch`先授權、查target；在validateProfile前建立 `boolean clearEmail = email != null && email.isEmpty()`；供驗證的值為 `clearEmail ? null : email`；供儲存的值為 `clearEmail ? null : email == null ? current.email() : email`。缺key與顯式null不變；只有長度0字串清除；非空字串（含空白）不trim。create不改。清除後多帳號email為null，不受partial unique index互相衝突；先清除再驗證，不能拿空字串查其他帳號duplicates。

PatchPrincipalRequest.email description逐字語義：「缺省或 null 保留原值；空字串清除為 null；非空字串原樣保存。」成功 `PATCH /principals/{id} {"email":""}`→200 Principal.email=null。既有長度／Unicode／case-insensitive uniqueness仍400 VALIDATION_FAILED，未變更資料。

### 3.3 Q-25 error與purge body

ErrorCode新增且同步兩份OpenAPI enum：`SELF_DISABLE_FORBIDDEN`403、`SELF_DEMOTION_FORBIDDEN`403、`CONFIRMATION_REQUIRED`400。保留非self `LAST_ADMIN`403，不新增／替換LAST_ADMIN_FORBIDDEN。所有錯誤維持ErrorEnvelope（requestId在top-level）：`{"error":{"code":"SELF_DISABLE_FORBIDDEN","message":"You cannot disable yourself.","action":"manage_principals","surface":"admin"},"requestId":"bw6-example-request"}`；不能把requestId放error內。新增IdentityException工廠 `selfDisable()`、`selfDemotion()`，action=manage_principals、contentType=null、surface=admin；內容確認以 `ContentException.validation(ErrorCode.CONFIRMATION_REQUIRED,"Purge confirmation does not match")`，訊息不含未驗證原文。

AdminContentController新增record `PurgeBody(String confirmPhrase, String confirmId)`。既有POST `/api/v1/admin/entries/{id}/purge`：新增 `@RequestBody(required=false) PurgeBody body`，不加@NotBlank（缺key須用業務錯誤碼）；缺body映射兩值null。body只由JSON傳，不接受header確認；未知JSON欄位沿用Spring Boot mapper忽略，不會替代兩個確認欄位。新增EntryService簽名：

```java
public void purge(Principal principal, Surface surface, UUID id,
                  String confirmPhrase, String confirmId);
```

刪除舊三參purge簽名，不留繞過確認的公開overload。原兩個atomic tests與WaveE合法呼叫加 `"DELETE",entry.id().toString()`／body。保留EntryService既有4參與5參建構子，委派至新增6參 `@Autowired(..., AuditLog audit, GovernanceDenialAudit denialAudit)`；非Spring的舊建構子建立 `new GovernanceDenialAudit(TransactionRunner.withoutDatabase(), audit)`。PostgreSQL新denial tests用6參注入相同DataSource的TransactionRunner，不能誤用withoutDatabase聲稱獨立交易成立。

Purge流程逐步固定：

1. controller取得`AuthController.current`，不在controller呼叫adminSurface（否則拒絕會繞過下述唯一audit）；登入/CSRF/filter仍現況。service無principal→401，不記匿名mutation審計。
2. 在§4的單次拒絕wrapper內執行`store.writeTransaction`。非Admin→403 SURFACE_FORBIDDEN；沒有admin角色→403 FORBIDDEN。保留角色檢查，不改成DELETE grant或manage_types。
3. 查target（含既有軟刪entry）；不存在404 ENTRY_NOT_FOUND；未核對target前不接受slug。
4. `"DELETE".equals(confirmPhrase)`且 `id.toString().equals(confirmId) || (current.slug()!=null && !current.slug().isEmpty() && current.slug().equals(confirmId))`；精確case、無trim／UUID大小寫正規化；任一不符400 CONFIRMATION_REQUIRED。UUID僅接受Java標準toString。空slug不能匹配空confirmId。
5. refsTo非空409 REF_CONSTRAINT；hardDeleteEntry(id,current.version())維持409 VERSION_CONFLICT；media replaceAttachments空、`entry.purge`成功audit與刪除同writeTransaction；成功204。現存公開讀在軟刪/硬刪後404。
6. target404、malformed JSON/type／path UUID400 VALIDATION_FAILED保留現有HTTP mapping，不由業務wrapper加audit。JSON object裡缺值／錯phrase/id則400 CONFIRMATION_REQUIRED且記一次denied。

OpenAPI PurgeEntryRequest：object、`additionalProperties:true`（未知欄位忽略，不參與確認）、required兩欄、confirmPhrase string enum[DELETE]、confirmId string minLength1。requestBody.required=false（缺body走業務400確認碼），成功204無body，列401/403/404/400/409/415/500；兩個confirmation欄位之schema不以BeanValidation提前攔截。範例 `{"confirmPhrase":"DELETE","confirmId":"10000000-0000-0000-0000-000000000009"}`。非JSON body維持415 MEDIA_TYPE_NOT_SUPPORTED；不更動media與type-disable operation。

### 3.4 SELF與最後管理員

所有principal mutation先requireManagePrincipals（缺grant既有audit，不另catch加一筆），查target並驗證輸入。以下業務步驟包於§4wrapper，SELF在寫入交易guard之前：

- `patch`解析nextStatus為disabled且target.id等於actor.id→selfDisable（即使當前已disabled仍拒絕）；displayName／email一般修改不觸發SELF。
- `disable` target.id等於actor.id→selfDisable，不撤session、不改status。
- `replaceRoles`輸入schema／duplicate／role存在／editor-operator allowlist先驗證；target等於actor、目前真實assignments有admin且新集合無admin→selfDemotion。保留admin時可合法改其他role。
- 其餘寫入維持 `transactions.inTransaction`／`run`＋三個KeepingUsableAdmin方法；SELF禁用不以「尚有另一admin」放行。非自己停用最後usable-admin或去除其admin→現有LAST_ADMIN403。replaceRolePermissions對admin全體安全仍同guard；將其LAST_ADMIN業務拒絕包wrapper，成功action保持`role.permissions_update`。
- advisory lock／active／deleted／admin-role＋admin面manage_principals計數語義不變。UI在W6可用roles/status警告，不是後端安全判定。

## 4. 成功原子性與拒絕審計

PrincipalAdminService保留既有6／8參數constructors；8參constructor增加private final GovernanceDenialAudit denialAudit，以傳入的transactions／auditLog建立helper，6參仍委派8參，不建立第二份AuditLog。get/create/patch/disable/unlock回Principal的既有Java返回型別不變，controller以view投影；舊list(request)委派新list(request,List.of())再取principal保持內部call相容。

新增 `identity.service.GovernanceDenialAudit`，建構子 `(TransactionRunner transactions, AuditLog audit)`；公開方法：

```java
public <T> T execute(Principal actor, Surface surface, String category,
        String action, String targetType, UUID targetId, Supplier<T> attempt);
```

attempt必須包含並退出成功mutation的交易塊後才拋到wrapper；wrapper僅catch CmsApiException，下列白名單reason等於error.code.wire()。以 `transactions.independently(() -> audit.record(actor,surface,category,action,targetType,targetId,AuditLog.DENIED,Map.of("reason",reason)))` 一次寫入，再原樣throw。不得finally記錄；unexpected/injected audit failure不是業務denial，不補一筆denied。獨立audit自身失敗→現有500 INTERNAL_ERROR；不吞錯、不轉成功、不重試mutation。未登入、一般404、JSON解析400／字段驗證400不在此audit白名單。

| attempt／audit action | category／target | 白名單reason |
| --- | --- | --- |
| patch status／POST disable：`PRINCIPAL_DISABLED` | AUTH／principal／targetId | SELF_DISABLE_FORBIDDEN、LAST_ADMIN |
| PUT principal roles：`ROLE_ASSIGNED` | AUTH／principal／targetId | SELF_DEMOTION_FORBIDDEN、LAST_ADMIN |
| PUT role permissions：`role.permissions_update` | AUTH／role／roleId | LAST_ADMIN |
| purge：`entry.purge` | CONTENT／entry／id | SURFACE_FORBIDDEN、FORBIDDEN、CONFIRMATION_REQUIRED、REF_CONSTRAINT、VERSION_CONFLICT |

缺manage_principals grant的AuthorizationService既有GOVERNANCE action=manage_principals、target=null記錄原樣保留，wrapper從其後開始；不得catch該分支再記一次。purge只走本helper，不另外 `authorization.require`（DELETE不是治理action）；role/surface與confirmation每次拒絕僅一筆。detail_json完整為 `{"reason":"SELF_DISABLE_FORBIDDEN"}`等固定碼，不放confirm原文、密碼、cookie、token或payload。成功仍原audit outcome=ok，不能改成舊surface文件的success字串。

## 5. BQ-14 B：精確角色轉換政策

### 5.1 canonical、fresh與restart

新增 `OperatorSeedPolicy` 位於identity.service（demo seed owns約定，matcher/store無demo字串）。private常數OLD_CLINIC_TYPES順序為`clinic_profile,owner,pet,vet,visit`。標準型別基數十二個由ContentTypeSeed實際註冊，不寫入AuthorizationService。下列比對只忽略Permission.id／createdAt與list排序；roleId必須是目標role；type/predicate必須**真正null**，empty/blank不當null；surface list排序不影響語義，但重複surface或重複permission signature視mismatch。canonical signature = `(action,contentTypeCode,predicateJson,sortedSurfaces)`。

舊標準完整九列（所有type、predicate=null）：

| action | allowedSurfaces |
| --- | --- |
| read_published | admin,back,front |
| read_draft | admin,back |
| create | admin,back |
| update | admin,back |
| publish | admin,back |
| unpublish | admin,back |
| delete | admin,back |
| archive | admin,back |
| manage_media | admin,back |

len必須9且九個signature各一次；欠一、多一、重複、predicate／type／surface不同均CUSTOM_GRANTS，禁止把list轉set後丟重複再說相等。

`legacyDefaults(UUID roleId, Instant now)`建立上述9 Permission。`expandedDefaults(UUID roleId,List<String> registeredTypes,Instant now)`對**全部已登錄**type（含disabled，distinct字典序）建立：appointment_request僅read_draft/update、surface[back,admin]；其他type各八type actions（read_published三面，其餘back/admin），各predicate=null；global manage_media僅一列type=null/back/admin。預設十二type時91列；在首次轉換已登錄custom type各增加8列。每列新UUID與now；manage_media原列ID/createdAt可保留，實作固定保留原manage_media物件。之後新增type不自動補grants，即使operator allowlist新增該type，也只可用既有matching grants；Admin角色矩陣須顯式新增type grants。

**fresh**：Order0的ensureRoles改為回傳本次真正insert的RoleCode集合。operator只有本次新建role時用CAS expected-empty初始化完整legacy9；已有role即使grants空亦是custom，不能恢複九列。初始化用§5.3同CAS方法、principalId=null，權限列寫入同交易。Order200再按完整legacy9轉換；不是Order0建立typed空grants。fresh CAS若因同時Admin寫入而PERMISSIONS_CHANGED，保留當前資料並交Order200回報未套用；只有DB／內部初始化異常傳出exception，不能宣告ready；已存在role空grants重啟仍保留、發unapplied通知，交Admin明確設定，不猜測fresh來源。

**restart辨識**：`isConvertedShape(List<Permission> grants)`只辨識，**不作轉換／補grants／改assignment**。要求：一列標準global manage_media；appointment_request恰好read_draft/update；其餘每個非空type組恰好全部八standard type actions／標準surfaces／null predicate、無重複／wildcard type動作；至少包含舊demo十一type組（從seed policy的immutable list `album,photo,page,clinic_profile,owner,pet,vet,visit,project,issue,milestone`）；額外typed組允許。與「目前全部registered types」不作相等比較，避免新增type後被誤認CUSTOM或自動授權。此shape辨識無mutation，即使客製清單恰好同shape也不改其IDs/timestamps/assignments。

已经typed shape而clinic assignment恰好標準六type→ALREADY_APPLIED、沒有通知；shape但clinic為五type或其他集合→UNAPPLIED CUSTOM_CLINIC_ASSIGNMENTS、**不再加type**，因為初次標準轉換已原子一起更新；不能藉重啟再次修改後續管理者的資料。typed list做任何移除／額外非標準grant則CUSTOM_GRANTS原樣保留。

### 5.2 assignment獨立判斷與結果

標準舊clinic assignments必須總length1，該列principalId為clinic、roleId為operator、roleCode逐字operator，contentTypeCodes length5且無duplicate，集合恰為OLD_CLINIC_TYPES；允許五code順序不同。下一份assignment保留原5順序並append appointment_request，其他字段不動。更多role／不同範圍／重複code／不同role均custom。

| locked grants状態 | locked clinic assignments | 寫入／結果 |
| --- | --- | --- |
| exactly舊9（fresh也先初始化9） | exactly舊5 | 替換typed grants與append clinic type同交易；APPLIED，assignmentUpdated=true。 |
| exactly舊9 | 客製／缺clinic | 只轉換標準grants；所有assignment原樣保留；APPLIED、assignmentUpdated=false，notice CUSTOM_CLINIC_ASSIGNMENTS／MISSING_CLINIC_SEED。 |
| 非標準grants（含existing空） | 任意 | 兩者都不寫；UNAPPLIED CUSTOM_GRANTS；不替該账户加入預約。 |
| 已converted shape | exact六／任意 | §5.1僅觀察；ALREADY_APPLIED或UNAPPLIED，無mutation。 |
| seed-disabled | 任意 | Order0沿用ensureRoles only；Order200直接SKIPPED_DISABLED，不查types／不convert／不改assignment。 |

固定WARN碼 `OPERATOR_APPOINTMENT_SEED_UNAPPLIED`、reason僅上述固定值，訊息「新預約權限種子未套用；請由管理者檢查 operator 權限與診所帳號類型範圍。」不輸出raw grants、credential或個人email。seed-disabled以INFO `OPERATOR_APPOINTMENT_SEED_DISABLED`說明，未套用不是啟動exception。轉換後custom assignment仍未套用，不能在Q26產品驗收聲稱該客製庫已取得新能力；正常session與Admin GET/PUT角色／assignment路徑仍可使用；缺demo初始化權限按§5.5整組skip，不讓舊DemoContentSeed中止啟動。

### 5.3 store CAS、SQL與同時寫入

新增 `identity.domain.IdentitySeedChange`（單一檔含nested records／enum）：

```java
public record IdentitySeedChange(UUID roleId, List<Permission> expectedPermissions,
        List<Permission> replacementPermissions, UUID principalId,
        List<PrincipalRoleAssignment> expectedAssignments,
        List<PrincipalRoleAssignment> replacementAssignments) {
    public enum State { APPLIED, PERMISSIONS_CHANGED }
    public record Result(State state, boolean assignmentsUpdated) {}
}
```

輸入所有lists copyOf、不得null；principalId=null只可用expected／replacementAssignments=[]（fresh legacy初始化），不是wildcard任何principal。新增IdentityStore `IdentitySeedChange.Result applyConditionalSeedChange(IdentitySeedChange change)`。IdentitySeedChange再宣告 `public record PermissionKey(UUID roleId,String action,String type,String predicate,List<String> surfaces)`、`public record AssignmentKey(UUID principalId,UUID roleId,String code,List<String> types)`，以及 `public static Optional<List<PermissionKey>> permissionKeys(List<Permission> values)`／`public static Optional<List<AssignmentKey>> assignmentKeys(List<PrincipalRoleAssignment> values)`，供policy與兩store共用。permissionKeys遇重複surface或完整key重複回Optional.empty；其餘surface排序、key依roleId.toString/action/type/predicate/surfaces字典序（null排最前）排序；assignmentKeys遇重複type或重複(principalId,roleId)回empty，types排序、rows依principalId.toString/roleId.toString/code排序。預期與actual皆Optional.present且lists.equals才match；empty不是「空清單相等」。真正[]回Optional.of(List.of())。這是**generic compare-and-replace**；不認operator或demo type，使用canonical Permission／assignment比對與duplicate規則。caller的expected必須exact9，或fresh初始化exact[]；不得把讀到的客製權限當expected再強行轉換。replacement對應註冊type快照；store不自行發展type grants。

JDBC：`tx.execute`包完整方法，加入外層TransactionRunner同DataSource；先既有 `acquireAdminGuard()`，再role row lock、再可選principal row lock；在鎖內重新讀取現在grants／assignments，不能用service早先讀取快照當已比較結果。role不存在→IllegalStateException（seed內部失敗、非吞錯啟動）；principal不存在→不作assignment update，轉換標準grants仍可成功。SQL：

```sql
SELECT pg_advisory_xact_lock(?); -- existing ADMIN_GUARD_KEY
SELECT id FROM cms_role WHERE id = ? FOR UPDATE; -- roleId
SELECT id FROM cms_principal WHERE id = ? FOR UPDATE; -- principalId非null
SELECT * FROM cms_permission WHERE role_id = ? ORDER BY action, id;
SELECT pr.principal_id,pr.role_id,r.code AS role_code,pr.content_type_codes
FROM cms_principal_role pr JOIN cms_role r ON r.id=pr.role_id
WHERE pr.principal_id=? ORDER BY r.code;
-- 以上鎖定後重新canonical compare。permissions不同：return PERMISSIONS_CHANGED,false，無DELETE。
DELETE FROM cms_permission WHERE role_id=?;
INSERT INTO cms_permission(id,role_id,action,content_type_code,predicate_json,allowed_surfaces,created_at)
VALUES(?,?,?,?,CAST(? AS jsonb),?,?);
-- 每個replacement固定绑定id/roleId/action/type/predicate/text-array/createdAt
-- assignments恰相等且principal存在時才以下寫入，otherwise原樣保留：
DELETE FROM cms_principal_role WHERE principal_id=?;
INSERT INTO cms_principal_role(principal_id,role_id,content_type_codes) VALUES(?,?,?);
```

在鎖內把replacement中canonical signature仍等於actual某唯一列的Permission替換為actual原物件，因此global manage_media ID／createdAt保留；clinic assignment若exact old5，依locked actual的原codes順序append新增code（replacement減expected的唯一差值），不採service舊順序。JDBC建構子的tx參數為null時建立同DataSource的 `new TransactionTemplate(new DataSourceTransactionManager(dataSource))`，保留既有audit-only fixture合法性。guard／role／principal所有鎖皆同交易釋放；同時兩個標準轉換至多一個APPLIED，另一個PERMISSIONS_CHANGED後service重新讀並識別ALREADY，不再重試mutation。永久性失敗／DB constraint異常不重試，throw啟動失敗且rollback，兩份列表／IDs完全恢複。

為防止Admin客製寫入介於CAS比較與替換間被覆蓋：現存 `replaceRolePermissions`與`insertPermission`新增同role `FOR UPDATE`，`replacePrincipalRoles`新增同principal `FOR UPDATE`；三個plain方法本身皆用existing `tx.executeWithoutResult`，第一步都acquireAdminGuard，再row locks；replacePrincipalRoles取得principal lock後寫assignment，FK取role KEY SHARE也位於同advisory guard內。再呼叫private unlocked寫方法，避免逐行reacquire事務。KeepingUsableAdmin繼續先advisory guard再row，lock順序統一；seedCAS也同順序。Admin actor校驗／audit的外層TransactionRunner仍包原mutation。若Admin先完成custom寫，CAS重讀→PERMISSIONS_CHANGED無寫；若CAS先完成，Admin隨後正常write其明確提交的客製資料，不丟其後寫。不能以service `synchronized`冒充跨process安全。

in-memory：複用existing `adminGuard`；將 `rolesOf`／`permissionsOfRole`／`replacePrincipalRoles`／`replaceRolePermissions`／`insertPermission` 的讀取或寫入包同 `synchronized(adminGuard)`（Java监視器可重入）。CAS在同监視器讀compare、copy原permission/assignment lists、寫replacement；catch RuntimeException或Error時直接還原兩map的舊存在状態與舊lists再throw，不能通過會被故障注入的public writer還原。missing map需remove，不造空entry。普通CAS mismatch不寫。這個snapshot只解决此seed兩map原子性，不聲稱memory已有通用transaction。InMemory adapter讓CAS循環呼叫可重入的public insertPermission；測試override在第3個replacement寫入後拋RuntimeException。JDBC adapter不override public insertPermission：以test-only DataSource／Connection／PreparedStatement代理包同一交易DataSource，在CAS測試窗口計數SQL為INSERT INTO cms_permission的executeUpdate；第3次先delegate成功寫入，再拋SQLException("test seed insert failure")。setup資料寫入後才arm counter，其他SQL不計，JdbcTemplate仍轉譯錯誤並使同交易rollback。兩adapter共用contract的fault hook，但各自按以上方式注入；斷言兩份原完整lists／IDs／createdAt恢復，JDBC再用新connection讀取。

### 5.4 listener與方法執行順序

`SeedService.seed()`保持Order0：prod seed password條件不變；ensureRoles→非operator existing default權限→seed principals／credentials。ensureRoles回傳新插入role set，operator本次新role才CAS初始化legacy9；existing role標準9、typed、自訂／空均不動。existing `seed-operator-clinic`在seedUser找到後**立即return而不whole-role replace**；fresh clinic仍建立old5 assignment。其他seed流程維持現況，Q26不修改其他demo帳號範圍。

新增 `OperatorPermissionSeed` 注入 `(IdentityStore identity, ContentStore content, IdentityProperties properties, OperatorSeedPolicy policy, TransactionRunner transactions)`；公開 `public SeedOutcome finalizePermissions()`（nested `SeedOutcome(String state,String reason,boolean assignmentsUpdated)`）；`onReady()`使用 `@Order(200) @EventListener(ApplicationReadyEvent.class)` 呼叫finalize。類也標@Order(200)。ContentTypeSeed Order100未變；DemoContentSeed Order200未變，兩個Order200 listener先後均可行，但DemoContentSeed並非直寫store：它經EntryService.create／publish、MediaService.upload受授權。legacy9與轉換後typed grants都保留現有demo的create／publish與global manage_media，故標準庫在兩種次序都能建立資料；新測試分別用真實服務證明。不得把整份SeedService搬到Order200。

finalize固定流程：

1. !seedEnabled→SKIPPED_DISABLED；無讀content、無write。
2. roleByCode(operator)缺→IllegalStateException；讀clinic principal（缺可為null）；讀grants供分類，已converted→僅觀察assignment並返回§5.1状態／notice；非legacy9→UNAPPLIED CUSTOM_GRANTS；不運行CAS。
3. `content.listTypes()`取得全部registered type keys，distinct字典序；預約type不存在→IllegalStateException `appointment_request is not registered before operator finalization`，不產生空/部分grants、不ready；ContentTypeSeed正常必有十二type。disabled也納入，不改變type enabled。
4. 構造expected exactlegacy9、replacement typed；expected clinic old5、replacementold5+appointment_request；actualclinic順序不同但集合相同時replacement保留實際原5順序；store再次完整compare，不能依service判斷跳過CAS。
5. `transactions.inTransaction(() -> identity.applyConditionalSeedChange(change))`；APPLIED後若assignment未改發§5.2reason通知；PERMISSIONS_CHANGED只重新讀一次進行converted/custom觀察，不再次寫（bounded conflict處理），返回ALREADY或UNAPPLIED；日志一次。DB異常原樣throw並rollback。

new/fresh、old標準、repeat、custom grant、customassignment、seed-disabled每種路徑皆有§7測試；forward修複使用現有store，無migration。新類型加入allowlist但無explicit grant時create/update/read_draft等403；其可有anonymous public read的聯集不應誤斷為全部讀拒絕。


### 5.5 DemoContentSeed：客製權限下正常啟動

此修改兌現已批准B的custom庫正常startup承諾；不改一般API、角色matcher或Demo payload。DemoContentSeed的public constructor改為 `(ContentStore store, EntryService entries, MediaService media, IdentityStore identity, AuthorizationService authorization)`，沒有既有直接new callsite；Spring用此五參constructor。seed／onReady簽名與Order200不變。

seed保留album principal不存在即return。其餘在原try內先讀三個現有sentinel：album/coast-light-2026、clinic_profile/home、project/cms-scaffold；不存在才是pending pack。無pending即return。先對全部pending packs做side-effect-free preflight，所有preflight成功後才調原seedAlbum／seedClinic／seedProjects，不改sentinel既有跳過規則。

新增private `boolean preflight(Principal actor, List<String> createTypes, List<String> publishTypes, boolean needsMedia)`：needsMedia時先 `authorization.allow(actor,MANAGE_MEDIA,null,null,BACK).allowed()`；按表列type順序對CREATE、PUBLISH各呼叫 `allow(actor,action,type,null,BACK).allowed()`。此處entry=null是**保守要求初始化使用無條件matching grant**；predicate-only grant會被既有predicateAllows拒絕，整組skip，普通API的predicate語義完全不變。不使用忽略predicate的hasAction，不呼叫require寫denied audit，不給暫時grant、不切admin、不繞過EntryService。

| pending pack／actor | createTypes | publishTypes | needsMedia |
| --- | --- | --- | --- |
| album／seed-operator-album | album,photo | album,photo | true |
| clinic／seed-operator-clinic | clinic_profile,owner,pet,vet,visit | clinic_profile,owner,pet,vet,visit | false |
| projects／seed-operator-projects | project,milestone,issue | project,milestone | false |

actor由既有requireUser取得；缺seed principal／clinic member仍是內部初始化錯誤，不能吞掉。任一allow返回不allowed：只記一次WARN `DEMO_CONTENT_SEED_UNAPPLIED` reason=`AUTHORIZATION_UNAVAILABLE`，返回、不執行任何pending pack的create／publish／upload、不改permission／assignment／既有內容；訊息不輸出raw權限、credential或個資。custom partial/predicate-only權限下也可正常啟動、Admin管理可用。store讀取或DB／object-store／驗證／其他異常仍沿原catch包IllegalStateException，不把任何Exception當「缺權限」。預檢後才發生的真正服務失敗照舊傳出，不能宣稱原demo建立流程已成為跨檔案交易。

來源核對：DemoContentSeed:54–61、113–118、226–230、328–337；AuthorizationService:78–97、198–211。create/publish的seed type集合如表；issue全為draft，因此不多要求issue publish。

## 6. 任務卡（本子集14卡，2 S／12 M）

全部大小按本卡新增／修改Java與測試行估算；S≤150、M≤400，OpenAPI subset同步計入BW6-T14/BW6-T16/BW6-T18估算，不把完整YAML複製當成葉卡工作量；根最後卡不重複後端實作。每卡完成條件必須有已觀察focused結果；本文件只指定命令，未執行產品測試。本文採主施工圖全波編號。若實施實際diff超400行，根拆卡而不稱M。

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
- **步驟**：①新增shared IdentitySeedStoreContract＋memory/JDBC adapters；②CAS old9／customassign／mismatch／第3insert故障（memory override、JDBC PreparedStatement代理，依§5.3）／two simultaneous calls；③IdentitySeedConcurrencyTests兩connection下Admin修改搶先／CAS搶先與Q23 query-count；④先建立IdentityStore.applyConditionalSeedChange default throw UnsupportedOperationException供編譯；memory測試BW6-T23前期待新store方法意圖失敗，正式行為紅優先從BW6-T20已存在覆盖；⑤故障後比對原完整物件而不只row count。
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

## 7. 精確測試規格與數據

store fixture時間 `T0=2026-10-01T00:00:00Z`、UUID末尾1=rootA、2=subject、3=rootB、4=editor/member role可由shared現有fixture隨機創建但每test只依自有IDs；HTTP用ApiFixture.token隔離username與隨機測試password，僅從測試properties讀取seed password，不寫入本文／Git。每test new store或PostgresFixture.cleanDataSource；Spring API測試mutation只改新建principals，seed策略測另建store，避免改變全局角色。故障注入／two-writer各test重置並最長等待10s，CountDownLatch不靠sleep猜先後。

| case／檔案 | 前置、動作與確切斷言 | cards |
| --- | --- | --- |
| R23-A `PrincipalGovernanceApiTests.Q23_rolesAndLastLoginAppearOnEveryPrincipalResponse` | create subject未登入→roles=[]、lastLoginAt=null；指派member+editor但editor零grant→roles=[editor,member]；get／patch／disable／unlock字段一致；login後再次GET lastLoginAt非null且store值相同；CreatedPrincipal含兩欄與temporaryPassword。 | BW6-T13/BW6-T14 |
| R23-B 同類`Q23_roleFilterUsesAssignmentsAndKeepsInactiveAccounts` | subjects: member-only、member+editor、editor-only、disabled member；member filter只前三中member兩位＋disabled，each once，size=total，username升序；未傳全部、role空／空白不篩選、重複／foo400；Front/Back403、未登入401。 | BW6-T13/BW6-T14 |
| R23-S `IdentityStoreContract.Q23_roleQueryAndBatchAssignmentsAgree` | 3 principals各username順序逆插，1deleted/1disabled/multi-role/zero-permission role；斷言deleted不見、disabled保留、role過濾不重複、batch empty=[]、真實zero-grant仍assignment。 | BW6-T13/BW6-T14 |
| R23-P `IdentitySeedConcurrencyTests.Q23_principalListQueriesDoNotGrowWithRows` | JDBC創建1與30principals；計數僅調用service.list期間的SELECT，分別測無role及有效role；1／30principal都為無role2次、有role3次（auth require計算另以已驗證IdentityRequest／Mock AuthService.requireManagePrincipals固定允許排除授權SQL，必須計數窗口說明）；empty結果為無role1次、有role2次；role驗證SQL計入，不計setupSQL。 | BW6-T22/BW6-T23 |
| R24 `AdminInputValidationApiTests.Q24_emailEmptyClearsButNullOrMissingKeeps` | A/B email分別a/b@test.invalid；PATCH omitted/null保留；A空→store/JSON null；B空→null且200；已有legacy empty account不阻清除；非空duplicate400、254字界/255字拒絕、Unicode code point回歸、create空原行為不改。 | BW6-T15/BW6-T16 |
| R25-A `PrincipalGovernanceApiTests.Q25_selfGuardsPrecedeLastAdminWithoutMutating` | 兩admin時A PATCH/POST自disabled各403SELF，roles去admin403SELF_DEMOTION；每attempt一次denied reason；roles/status/session未改；保留admin改otherrole成功；sole A自disable仍SELF；另有locked admin B的nonself LAST_ADMIN只在service／store fixture測：IdentityRequest.principal=B且Mock AuthService.requireManagePrincipals明確允許，直接call admin.disable(A)→LAST_ADMIN；不是HTTP情境，locked B無法登入。guards仍按usable定義。 | BW6-T17/BW6-T18/BW6-T19 |
| R25-B `EntryPurgeConfirmationApiTests.Q25_purgeRequiresExactPhraseAndTarget` | newalbum draft帶slug，向量缺body/{}／只phrase／只id／delete小寫／前後空白／別UUID／空id400CONFIRMATION，每次entry版本與attachments/auditOK不動、denied+1；UUID成功204／另entry非空slug成功204；無slugentry＋emptyid400；refs存在409；missing404；未登入401，Back403，非admin403；malformed JSON400VALIDATION無业務audit。 | BW6-T17/BW6-T18 |
| R25-P 兩原atomic類新增`Q25_businessDenialAuditSurvivesAmbientRollback`／`Q25_deniedAuditFailureLeavesMutationUntouched` | 同DBtransactions.run內執行SELF／LAST_ADMIN／confirmation失敗，catch後外層仍rollback；獨立denied恰1，原状態不變；override insertAudit在寫後throw，audit獨立交易也rollback並拋InternalError路由500；原success auditfailure status/roles/sessions／entry refs/revisions/attachments回滾tests不弱化。 | BW6-T19 |
| R26-U `OperatorSeedPolicyTests.BQ14B_exactLegacyAndConvertedShape` | 從舊9逐列變type/predicate/surface，刪除／添加／duplicate；僅排列IDs/timestamp/surface次序變化仍legacy；extra重複surface拒絕；12types→91列，預約僅2；添加customtype首次→99；shape＋未來newtype仍recognize且不補新grant；不是shape保持custom。 | BW6-T20/BW6-T21 |
| R26-L `OperatorPermissionSeedTests.BQ14B_freshOldRestartCustomAndDisabled` | newstore Order0 principals／legacy9存在→ContentTypeSeed→Order200後91與clinic6；old標準同結果；重複finalize保存IDs/timestamps，增加newtype＋allowlist不產生typedgrant；existing customclinic額外member／不同scope按原list全等保留並notice；grants單差／空／duplicate不寫；seed-disabled沒有finalizerstore calls；缺type明確throw而無partial。 | BW6-T20/BW6-T25 |
| R26-S `IdentitySeedStoreContract.BQ14B_atomicConditionalConversion` | 完整舊9＋old5→APPLIED/true；old9＋customassign→APPLIED/false但assign完整相同；customgrants→PERMISSIONS_CHANGED/false且permission/assignment原對象列表不變；第3replacement寫後fault（memory public insertPermission override；JDBC同DataSource PreparedStatement代理executeUpdate，setup後arm）→兩list原IDs/T0恢複；futuretyped再次舊9CAS→mismatch不write；fresh-empty CAS principalnull只改grants。 | BW6-T22/BW6-T23 |
| R26-P `IdentitySeedConcurrencyTests.BQ14B_racingSeedAndAdminWritesPreserveTheWinner` | 兩seed同舊state，屏障同時進入→exact一個APPLIED，最終91/6無duplicate；Admin connection先role lock並commit custom grants，CAS隨後mismatch完整custom保留；CAS先持鎖commit，Admin等待後提交其custom全部保留；assignment同race：custom多role先寫→轉換grants但不覆寫role。 | BW6-T22/BW6-T23 |
| R26-A `ClinicAppointmentOperatorApiTests.Q26_operatorCanReadAndUpdateRequestsButCannotPublish` | fresh member own pet創建預約draft（pet/preferredAt/reason、ownerField由server寫）；clinic operator GET列表/detail200、PATCH version與reason200→version+1；POST create預約、publish、unpublish、archive、DELETE分別403 FORBIDDEN；publish-request／cancel僅require update，按現有流程成功且publicationState仍draft，不增grant；capabilities預約恰read_draft/update；原visit create/publish正常，album/project operators原allowlistactions正常；會員讀他人403、Front draft隱藏、Back治理403不變。 | BW6-T26 |

R25-A非self LAST_ADMIN：locked B持有existing request principal且授權身份可在service層fixture測試（HTTPlocked帳號無法登錄）；HTTP case只測試實際可登錄actors。不得為了造HTTPsoleadmin nonself強行繞過login state；store／service斷言與HTTP斷言層級分開。


R26-D新增 `services/cms-api/src/test/java/com/fallrising/cms/content/service/DemoContentSeedTests.java`（JUnit，regular test不需Docker），三個methods：

| 名稱 | #／動作 | 等待條件 | 斷言 |
| --- | --- | --- | --- |
| BQ14B_customDemoSeedDoesNotBlockApplicationReady | 1. 每case用新的SpringApplicationBuilder(CmsApiApplication.class,PreparedSeedConfig.class)，server.port=0、cms.media.root指向@TempDir，以測試application.yaml排除DataSource/Flyway；seed password只讀IdentityProperties。PreparedSeedConfig為本測試nested @TestConfiguration，僅明確sources加入；其test-only ApplicationReadyEvent listener標@Order(150)，用AtomicBoolean只一次，在真實SeedService Order0與ContentTypeSeed Order100完成後，把operator permissions改為empty／缺publish／全部type action有不匹配fieldEquals predicate三個參數case；此時DemoContentSeed／OperatorPermissionSeed Order200尚未執行。不先在ContextRefreshed寫empty，避免舊Order0重新播九列掩蓋Red。2. 記錄permission/clinic assignments完整快照，保持零entries/media。3. run到ApplicationReady返回。4. AuthService.login(seed-admin,properties.seedPasswordFor(seed-admin),MockHttpServletRequest)；Origin=http://localhost:5175，取得store admin建IdentityRequest ADMIN，PrincipalAdminService.list正常。 | SpringApplicationBuilder.run同步返回；finally close context；每case新tempdir／store，沒有sleep | context active；custom permissions/assignments原快照相等；entries/media/object files0且preflight沒有denied audit；一筆DEMO_CONTENT_SEED_UNAPPLIED與operator未套用notice；admin login與治理list成功。predicateJSON為fieldEquals/title/never-seed-title，無明文密碼記錄。 |
| BQ14B_standardDemoSeedWorksOnBothOrder200Permutations | 1. 同新context的PreparedSeedConfig在test-only ApplicationReadyEvent @Order(150)一次執行；真實SeedService Order0與ContentTypeSeed Order100已完成。2. 兩case分別DemoContentSeed.seed→OperatorPermissionSeed.finalizePermissions，以及finalize→Demo seed；真實EntryService／MediaService，不mock授權。3. 同一ApplicationReady事件繼續正式Order200兩listener，驗證既有sentinel與typed grants重跑保持idempotent。 | 相同同步context啟動；close；兩case完全隔離 | 三pack原sentinel存在、published demo可讀、media有原seed assets；最終91 grants／clinic6；無DEMO_CONTENT_SEED_UNAPPLIED，第二次ready不重建資料，兩種次序都成功。 |
| BQ14B_demoPreflightPropagatesDatabaseFailure | 1. Mockito identity提供三seed principals、store sentinel均empty；AuthorizationService.allow第一call拋DataAccessResourceFailureException。2. 新五參DemoContentSeed.seed。 | 同步assertThatThrownBy | 原IllegalStateException包DB cause；沒有skip notice、沒有EntryService.create/publish或MediaService.upload，不能吞DB錯誤成成功。 |

使用Spring Boot test OutputCaptureExtension觀察固定notice；新增nested PreparedSeedConfig／Scenario enum／ThreadLocal<Scenario>僅在此test檔，JUnit每casefinally remove且close，不進main source，不與其他測試共用靜態mutable database。準備listener只屬測試，保留真實seedEnabled=true及正式Order0/100/200 listeners，與seed-disabled測試不同；不人工呼叫第二次Order0、不發布第二次ready事件。標準case的兩種排列只作測試，不改正式listenerOrder。empty／predicate-onlycase回歸直接檢查普通API授權仍拒絕，不把demo skip當Q26套用。

R26-P另在IdentitySeedConcurrencyTests加 `BQ14B_plainAssignmentWriterCannotDeadlockSeed`：plain replacePrincipalRoles取得advisory／principal鎖後用latch暫停，CAS另一connection不得持role鎖跨過advisory；釋放writer後兩者10秒內完成，custom assignment原樣保留、grant轉換最多一次。反向CAS先guard時plainwriter等待後正常提交；同樣測plain replaceRolePermissions／insertPermission，資料庫deadlock exception不是預期成功。此測試歸BW6-T22／T23，不把HTTPguard當plain writer證明。

## 8. FM 與 focused命令

| FM | expected／測試／卡 |
| --- | --- |
| BW6-FM41 未登入/CSRF | 401UNAUTHENTICATED／403CSRF_FAILED；R23-B/R25-B及existingIdentityAuthTests；BW6-T13/BW6-T17/BW6-T26 |
| BW6-FM42 wrong surface/no action | 403SURFACE_FORBIDDEN/FORBIDDEN；已有governance-denied一笔而不重複；R23-B/R25-B；BW6-T13/BW6-T17/BW6-T18 |
| BW6-FM43 role無效／deleted／zero-grant | 400VALIDATION_FAILED／deleted隱藏、role真實仍列；R23-B/S/P；BW6-T13/BW6-T14/BW6-T22 |
| BW6-FM44 emailclear／duplicate | empty200null、nullmissing不變、重複400、無partial；R24；BW6-T15/BW6-T16 |
| BW6-FM45 SELF disable 兩入口 | 403SELF_DISABLE_FORBIDDEN、status/session不變、denied1；R25-A/P；BW6-T17/BW6-T18/BW6-T19 |
| BW6-FM46 SELF demotion | 403SELF_DEMOTION_FORBIDDEN、roles不變、denied1；R25-A/P；BW6-T17/BW6-T18/BW6-T19 |
| BW6-FM47 nonself lastadmin | 403LAST_ADMIN及atomicguard；R25-A/P/shared既有guard；BW6-T17/BW6-T18/BW6-T19/BW6-T23 |
| BW6-FM48 缺／錯確認 | 400CONFIRMATION_REQUIRED、無mutation、denied1；R25-B/P；BW6-T17/BW6-T18/BW6-T19 |
| BW6-FM49 missing target/malformed | 404ENTRY/PRINCIPAL_NOT_FOUND、400VALIDATION_FAILED；R25-B/既有PrincipalNotFoundApiTests；BW6-T17/BW6-T26 |
| BW6-FM50 ref/version conflict | 409REF_CONSTRAINT/VERSION_CONFLICT、denied1且無partial；R25-B/P原EntryAtomicWriteTests；BW6-T17/BW6-T18/BW6-T19 |
| BW6-FM51 customgrants | startup正常、unappliednotice、grants/assignments不變；R26-U/L/S；BW6-T20/BW6-T21/BW6-T22/BW6-T23/BW6-T25 |
| BW6-FM52 customassignment | exact9可轉換但assignment完全保留、notice；R26-L/S；BW6-T20/BW6-T21/BW6-T22/BW6-T23/BW6-T25 |
| BW6-FM53 restart/newtype | typed不重寫IDs、不補newtypegrant；R26-U/L/S；BW6-T20/BW6-T21/BW6-T22/BW6-T23/BW6-T25 |
| BW6-FM54 simultaneous edit | CAS recheck、rowlocks/no overwrites、最多一次converted；R26-S/P；BW6-T22/BW6-T23 |
| BW6-FM55 DB/audit failure | 500INTERNAL_ERROR、success全部回滾、denied自身failed不會partialmutation；R25-P/R26-S；BW6-T19/BW6-T22/BW6-T23 |
| BW6-FM56 duplicates/trailingcustom | exact9 compare嚴格mismatch、no writes；R26-U/S；BW6-T20/BW6-T21/BW6-T22/BW6-T23 |
| BW6-FM58 demo seed缺權限／predicate | 正常ApplicationReady、單筆skip notice、零pending writes；DB失敗仍throw；R26-D；BW6-T24/BW6-T25 |
| BW6-FM57 order/disabled/type missing | principals Order0／types100／final200；disabled不套用；缺type拋內部啟動失敗而無轉換；R26-L；BW6-T20/BW6-T25 |

根完整gate仍依AGENTS；實現期間從component根只跑相關子集，以下為規劃未實跑命令：

```bash
./gradlew test --tests 'com.fallrising.cms.PrincipalGovernanceApiTests' --tests 'com.fallrising.cms.AdminInputValidationApiTests' --tests 'com.fallrising.cms.EntryPurgeConfirmationApiTests' --tests 'com.fallrising.cms.OperatorSeedPolicyTests' --tests 'com.fallrising.cms.OperatorPermissionSeedTests' --tests 'com.fallrising.cms.contract.InMemoryIdentityStoreContractTests' --tests 'com.fallrising.cms.contract.InMemoryIdentitySeedStoreContractTests' --tests 'com.fallrising.cms.ClinicAppointmentOperatorApiTests'
./gradlew integrationTest --tests 'com.fallrising.cms.contract.JdbcIdentityStoreContractTests' --tests 'com.fallrising.cms.contract.JdbcIdentitySeedStoreContractTests' --tests 'com.fallrising.cms.contract.IdentitySeedConcurrencyTests' --tests 'com.fallrising.cms.contract.IdentityAuditAtomicWriteTests' --tests 'com.fallrising.cms.contract.EntryAtomicWriteTests' --tests 'com.fallrising.cms.JdbcIdentityStoreIntegrationTests'
./gradlew test --tests 'com.fallrising.cms.IdentityAuthTests' --tests 'com.fallrising.cms.IdentityHardeningTests' --tests 'com.fallrising.cms.CapabilitiesTests' --tests 'com.fallrising.cms.MemberApiTests' --tests 'com.fallrising.cms.WaveEAcceptanceTests' --tests 'com.fallrising.cms.OpenApiContractTests' --tests 'com.fallrising.cms.ErrorCodeContractTests' --tests 'com.fallrising.cms.PrincipalNotFoundApiTests'
```

補充外部查證（2026-10-06）：[SpringApplicationBuilder](https://docs.spring.io/spring-boot/3.5/api/java/org/springframework/boot/builder/SpringApplicationBuilder.html)支援指定sources與run參數；[TestConfiguration](https://docs.spring.io/spring-boot/3.5/api/java/org/springframework/boot/test/context/TestConfiguration.html)用作明確載入的測試設定。

## 9. 子集交付檢查

- 14卡明確輸入／steps／commands／S-M／FM；新record與所有SQL／CAS順序按本文，無新產品選擇。全波數量由root合並盘點，超過30須按REFINE-PROMPT處理。
- role projection無N+1，空roles與null lastLoginAt所有回應一致；email語義僅patch。
- SELF／confirmation不改變資料、denied一筆、外層rollback仍persist；原成功atomic／LAST_ADMIN concurrency／entryversion語義留證。
- fresh／完整old／restart／customgrants／customassignments／disabled／duplicate／race全有證據；custom未套用明說而不故意失敗startup。
- exact類型grants與capabilities／API一致；appointment_request只有read_draft/update；新增type明確授權。沒有matcher、role數量或UI權限替代修改。
- 根整份BW6 OpenAPI與ErrorCode schema一致；W6消费新Principal／filter／confirm／seed fixture另波，不能冒稱UI完成。

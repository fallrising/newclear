# PP1 DB／media 恢復內核草稿

日期：2026-10-09。狀態：**DRAFT，非DOC_READY，不可據此施工**。配合[PP1施工圖](../waves/PP1.md)。來源 `216643eb3f566b82b4747256034e94eb1844ebc4`；已核對 `a6ea2af92469ae82091dde394c8d62e2227128a1` 的CMS無增量。本文列出內核設計；主機adapter、session撤銷adapter、真實演練與卡片大小仍待封板。

## 1 範圍

本內核承接 PP1-AC03／04 與 PP1-FM08～13；每日停寫、RPO 24h、RTO 4h、daily 7＋weekly 4 是 owner 2026-10-09 已批准目標，不再當作未答政策。fresh DB、不帶 demo 帳號／內容、獨立日常 operator 是帳號卡前置；same-site distinct origins 由 runtime 卡整合。數值批准不等於已達標。

只封定 manifest／媒體盤點／受控狀態機／保留選取；Node stdlib 與 Java25／既有 JDBC/Jackson/ImageIO 供 repo 內純測試。沒有新 npm／Java 依賴。Node／JDK／PG tools 在正式主機的可用性、執行包裝與安裝授權仍未知；抽象 adapter 不是已批准的工具替代品。沒有 archive extractor、PG shell、container、proxy、encryption、transfer、notification 或 scheduler 實作。

12 卡只是環境無關內核。host adapter、實際離機解密／空白還原／升級三故障演練、正式配置旅程與整合交付須額外卡；不得宣稱整個 PP1 在 30 卡內。automatic pruning 不在本子集：只輸出 keep/candidate/protected 清單，不刪備份、卷或資料。

## 2 先決條件與已核實來源

| 來源（Java 前綴 services/cms-api/src/main/java/com/fallrising/cms/） | 契約依據 |
| --- | --- |
| compose.yaml:15–16、29–31；resource V4__media.sql:1、6–42 | DB 与 bytes 分開；cms_media／variant／attachment 需同批。 |
| media/service/MediaService.java:83–138 | original→可解碼 image thumbnail/web→DB asset→variant inserts，不跨檔案原子；配額失敗才補償。 |
| media/ImageVariants.java:18–39 | 同版 ImageVariants.read(bytes) 才決定 image 是否可解碼；不能只看 MIME。 |
| media/store/LocalDiskMediaObjectStore.java:17–24、49–57 | 直接 Files.write；normalize 檢查不是 symlink 安全盤點。 |
| identity/web/IdentityRequestFilter.java:66–105、AuthService.java:147–154 | 有效session的GET也touch DB。 |
| AuditPurgeJob.java:23–27、SchedulingConfig.java:7–9 | API背景purge也是writer。 |
| SeedService.java:66–74、ContentTypeSeed.java:34–40/136–151、DemoContentSeed.java:44–59 | 關demo帳號seed不代表startup完全不寫；fresh/no-demo契約需帳號卡實作。 |
| integrationTest contract/PostgresFixture.java:20–34；ApplicationPersistenceIntegrationTests.java:49–167 | 真PG fixture可重用；前者package-private且清整個schema，不用作production restore；同DB context重啟不是blank restore。 |

實作與試驗需先完成 runtime／accounts／Q25；core測試fixture可以獨立，不需HTTP服務。inventory Java main 不啟動 CmsApiApplication，沒有 SeedService、Flyway自動migration或scheduler。DB保持運行、所有 API與維護writer停止；執行只讀inventory不提供mutation權限。既有歷史 migration 不改。

## 3 精確候選檔案清單

所有路徑以 component 根為準；以下皆未新增，僅未來卡scope。

| 路徑 | 動作／用途 | 卡 |
| --- | --- | --- |
| scripts/ops/protocol.mjs | 新／manifest、receipt、輸入與錯誤碼schema驗證 | R01/R02 |
| scripts/ops/protocol.test.mjs | 新／純Node契約Red/Green | R01/R02 |
| services/cms-api/src/main/java/com/fallrising/cms/ops/RecoveryInventory.java | 新／只讀SQL snapshot、ImageIO/file盤點與nested records | R03/R04 |
| services/cms-api/src/main/java/com/fallrising/cms/ops/RecoveryInventoryMain.java | 新／非Boot offline main，JSON檔輸入/輸出 | R05/R06 |
| services/cms-api/src/test/java/com/fallrising/cms/ops/RecoveryInventoryMainTests.java | 新／CLI輸入、秘密處理與輸出契約 | R05/R06 |
| services/cms-api/src/test/java/com/fallrising/cms/ops/RecoveryInventoryTests.java | 新／TempDir＋純metadata fixture | R03/R04 |
| services/cms-api/src/integrationTest/java/com/fallrising/cms/contract/RecoveryInventoryIntegrationTests.java | 新／同package PostgresFixture＋只讀真DB snapshot | R03/R04 |
| services/cms-api/build.gradle.kts | 修改／明定Boot mainClass並新增repo限定JavaExec opsInventory任務 | R06 |
| scripts/ops/journal.mjs | 新／共同lock與append-only狀態journal，無container操作 | R07/R08 |
| scripts/ops/backup.mjs | 新／依adapter契約執行backup狀態機 | R07/R08 |
| scripts/ops/backup.test.mjs | 新／fake adapter次序／故障／restartpolicy | R07/R08 |
| scripts/ops/recovery.mjs | 新／restore及upgrade三階段失敗匹配恢復狀態機 | R09/R10 |
| scripts/ops/recovery.test.mjs | 新／blank target／mismatch／停寫／三故障 | R09/R10 |
| scripts/ops/selection.mjs | 新／保留selection與RPO/RTO status；零delete | R11/R12 |
| scripts/ops/selection.test.mjs | 新／UTC日/ISO週與age邊界測試 | R11/R12 |

不需要 package.json、lockfile、OpenAPI、error enums、migration 或前端變更。正式主機CLI與container/runtime/extractor/transfer adapter白名單留在PD01／03／04決策表，未冒充完整PP1清單。

## 4 資料契約

### 4.1 統一序列化與敏感界線

UTF-8 JSON、無BOM、最後一個 LF。canonical(v)：object keys 按 Unicode codepoint排序；array保持已規定排序；JSON primitive不改。禁止NaN／Infinity／duplicate keys／unknown fields。原始JSON入口統一 `parseStrictJson(rawBytes)`：UTF-8解碼→JSON.parse→canonicalBytes(value)逐byte與輸入比較；輸入必須本契約canonical格式，重複key、非canonical空白／key順序／多文件／非法encoding都拒絕。重複key被JSON.parse覆蓋後重序列化不可能等於原bytes，故不是validateManifest(value)單獨宣稱能檢出。Java main也先解析再canonical bytes逐byte比對。size/count/monotonic elapsed 都是十進位字串 `0|[1-9][0-9]*`，避免JS精度截斷；hash為64位lowercase hex；sourceCommit為40位lowercase hex；digest為 `sha256:`＋64位hex；UTC RFC3339固定 `YYYY-MM-DDTHH:mm:ss.SSSZ`；UUID用lowercase canonical形式。clock不得倒退；duration使用 injected monotonic clock測量，UTC供跨artifact對帳。artifact路徑只允許固定相對file names。

manifest本身不包含自身hash。`local-complete.json` 綁定manifest最終bytes的SHA256；manifest禁止其artifact list列自己／complete marker，避免hash循環。archive、inventory、DB snapshot含內容／帳號／token hash，整批都為私有敏感artifact，不因「manifest沒有secret」而公開。收據不保留username／hostname／origin值／objectKey原文／sql／stderr／cookie／password／credential hash，只有固定code／opaque IDs／hash／count／時間／exit。private manifest可保存非secret完整配置或opaque configRef；公開文件只有變數名稱。

### 4.2 manifestVersion=1（required且additionalProperties=false）

| 欄位 | 精確型別／約束 |
| --- | --- |
| manifestVersion | integer literal 1 |
| backupId / instanceId | backupId=`pp1-`＋UTCcompact `YYYYMMDDTHHMMSSmmmZ`＋`-`＋32位random hex；instanceId為private配置的opaque UUID，不是hostname |
| release | `{sourceCommit, apiImageDigest, postgresImageDigest, javaRuntimeVersion, postgresServerVersion, frontend:{front,back,admin}, configSha256}`；每面frontend為`{artifactSha256,apiBaseConfigSha256}`；版本非空字串，PGmajor必須16，Java major25 |
| migration | sorted `[{installedRank:string,version:string|null,description:string,type:string,script:string,checksum:string|null,success:boolean}]`，按rank整數升序；任何success=false拒絕；不假設版本永遠V10 |
| scope | `{dbSchema:'public',tableNames:string[], dbRoleRef:string,secretRefs:string[]}`；tableNames按codepoint升序且不能漏§5的20tables；secretRefs去重升序，只opaque恢復來源，不含值 |
| times | `{startedAt,quiescedAt,capturedAt,verifiedLocalAt}`；順序不下降；quiescedAt是此批資料時間點，不能改為離機完成時間 |
| toolchain | `{inventorySourceCommit,inventoryJavaVersion,pgDumpVersion,pgRestoreVersion,mediaPackageAdapterId,mediaPackageAdapterVersion}`；inventory同release source與Java版本；工具adapter版本待host回答後填實值，空白拒絕 |
| artifacts | 恰三項，按path排序：`db.dump`、`inventory.json`、`media.package`，每項`{path,byteSize:string,sha256}`；格式/media.package的實際封装由host adapter決定，不能假設已採tar |
| inventory | `{sha256,dbSnapshotSha256,assetCount:string,referencedFileCount:string,orphanFileCount:string,fileCount:string,fileBytes:string}`；sha256須等於artifact inventory.json；fileCount=referenced+orphan |
| source | `{projectRef:string,dbVolumeRef:string,mediaVolumeRef:string,writerSetSha256}`；volumeRefs不同，與restore target不同，只opaque identifiers |

local-complete：`{version:1,backupId,manifestSha256,verifiedLocalAt}`，immutable。offsite receipt：`{version:1,backupId,manifestSha256,packagePlaintextSha256,ciphertextSha256,byteSize:string,destinationRef,keyRecoveryRef,adapterId,adapterVersion,verifiedAt,verification:'retrieved-decrypted-hashed'}`。plaintext package必須包含manifest、complete與三artifacts，packagePlaintextSha256綁定外層包；獨立保護ciphertext hash。其他receipt verification值不接受；若provider只提供server-side checksum，須修改PD03協定並独立審查，不能本內核偷偷放行。hash只證完整性，不證來源可信／加密安全；指定受保護來源與加密key程序仍需adapter。

`restore-verified.json`：`{version:1,runId,backupId,manifestSha256,targetRef,rawSnapshotSha256,mediaInventorySha256,smokeReceiptSha256,environment:'isolated-drill'|'production',incidentStartedAt,startedAt,availableAt,elapsedMs:string,rtoBudgetMs:'14400000',withinRto:boolean}`。只在raw、啟動後契約與真實服務smoke全通過才產生，不能由fake adapter測試輸出當作真演練證據。

### 4.3 函式／CLI契約

Node export signatures（JS＋JSDoc，沒有TS runtime）：

```js
parseStrictJson(rawBytes) // canonical UTF-8 JSON only; rejects duplicate keys before schema acceptance
validateManifest(value) // schema only, after parseStrictJson; returns frozen value; throws OpsError
validateOffsiteReceipt(value, manifestSha256, backupId)
canonicalBytes(value) // Uint8Array UTF-8, trailing LF
runBackup(request, adapters, journal, clock) // Promise<Outcome>
runRecovery(request, adapters, journal, clock) // Promise<Outcome>
selectBackups(catalog, pins, now) // {keepIds,candidateIds,protectedIds,reasons}
evaluateObjectives(catalog, restoreReceipt, now) // {rpoAgeMs,rpoStatus,rtoStatus}
```

OpsError：`{code,phase,operationId}`，code為§8固定enum，message只等於code；不攜帶cause/message/argv/env。`Outcome={operationId,backupId|null,phase,serviceState:'running'|'stopped'|'maintenance',exitCode:number,code:null|string}`。CLI核心前置schema only；未將命令adapter當installed工具：

- `node scripts/ops/backup.mjs --request <private-json-file>`：request=`{version:1,operationId:UUID,instanceId:UUID,sourceRef,releaseManifestRef,stagingRootRef,deadlineMs:string,adapterConfigRef}`，unknown flags／重复request／secret值一律拒絕；deadline由維護窗口決定，無隱含default。
- `node scripts/ops/recovery.mjs --request <private-json-file>`：request=`{version:1,operationId,instanceId,mode:'restore'|'upgrade-drill',backupId,targetRef,environment:'isolated-drill'|'production',incidentStartedAt,deadlineMs:string,adapterConfigRef}`。不得在args傳password／connection-string含密碼。只在所有host adapter具名已批准／預檢可用後才允許非fake execution；本子集CLI未具名adapter回ADAPTER_UNSEALED/7。
- `node scripts/ops/selection.mjs --catalog <private-json-file> --pins <private-json-file> --at <UTC>`：純selection，stdout僅IDs/reason，不提供prune/delete flag。

Java（records置於RecoveryInventory.java，package `com.fallrising.cms.ops`）：

```java
public static Inventory inspect(Connection connection, Path mediaRoot) throws SQLException, IOException;
public static Inventory inspectAssets(List<AssetRow> assets, List<VariantRow> variants, Path mediaRoot) throws IOException;
public static void main(String[] args); // RecoveryInventoryMain, calls run, then System.exit
public static int run(String[] args, Map<String,String> environment, PrintStream receiptOut);
```

單一完整nested records（皆public record，不追加未列欄位）：

```java
public record AssetRow(UUID id, String contentType, long byteSize, long storedBytes,
    String checksumSha256, Integer width, Integer height, String status) {}
public record VariantRow(UUID mediaId, String variant, String contentType, long byteSize,
    Integer width, Integer height, String objectKey) {}
public record FileRow(String objectKey, String byteSize, String sha256, String classification) {}
public record ColumnInfo(String name, String sqlType) {}
public record TableSnapshot(String tableName, List<ColumnInfo> columns,
    List<Map<String,String>> rows, String snapshotSha256) {}
public record Inventory(int version, List<FileRow> files, List<TableSnapshot> tables,
    List<AssetRow> assets, List<VariantRow> variants, String dbSnapshotSha256) {}
```

classification恰referenced/orphan；TableSnapshot.rows每Map恰columns所有name，cell是nullable PGtext，無額外header/dbRows欄位；tables按tableName排序、columns按name排序、rows按canonical bytes排序。JSON輸出AssetRow/VariantRow所有long欄位必須轉十進位字串，UUID轉canonical字串；record不直接用Jackson預設long-number輸出。table rowCount由rows.size計算，用manifest/countreceipt時轉字串。所有lists與maps immutable defensive copy；nullable cell不可用拒絕null的Map.copyOf，使用unmodifiable copy。records output按§4.1canonical序列化，receiptOut只写count/hash。

Main只接受`--request <path>`，private request=`{version:1,mediaRootRef,outputRef,dbUrlRef,dbUserRef,passwordFileRef,expectedReleaseSourceCommit}`；Refs由受保護配置解成值，不能直接放秘密到argv。DB_URL／USER等從經批准adapter傳輸，在repo invocation以`CMS_OPS_JDBC_URL`／`CMS_OPS_DB_USER`／`CMS_OPS_DB_PASSWORD_FILE`提供，password只讀private file，空／symlink／非regular／可被其他使用者讀取拒絕。密碼不印log，不啟動Spring context。build.gradle.kts須明定 `springBoot { mainClass.set("com.fallrising.cms.CmsApiApplication") }`，避免新增第二個public static main造成Boot主入口推斷歧義；另新增JavaExec `opsInventory`，mainClass=`com.fallrising.cms.ops.RecoveryInventoryMain`、classpath=`sourceSets.main.runtimeClasspath`；repo指令 `./gradlew :services:cms-api:opsInventory --args='--request <private-request.json>' --no-daemon --no-parallel`。正式host不得默認裝Gradle/JDK；可執行image/JRE包裝由PD01 adapter另卡封定。

## 5 模組與狀態機

### 5.1 DB／檔案inventory（只讀）

Connection：autoCommit=false、readOnly=true、REPEATABLE_READ；固定session timezone UTC、DateStyle ISO；任何transaction／query失敗不輸出complete。事務只SELECT，finally rollback/close；不設定表／role／schema。固定tables：`cms_principal,cms_credential,cms_role,cms_principal_role,cms_permission,cms_session,cms_audit_event,cms_content_type,cms_field,cms_entry,cms_entry_revision,cms_entry_ref,cms_entry_index,cms_navigation_menu,cms_media,cms_media_variant,cms_media_attachment,cms_media_settings,cms_audit_settings`與`flyway_schema_history`共20table。§4 tableNames不得漏這20項；tableName字串來自此常數白名單，不接受CLI SQL identifier。table/schema與columns應由snapshot列header完整比對，不允許額外cms_*table靜默漏掉；有額外table回SCHEMA_UNSUPPORTED，root先更新契約。

SQL：`SELECT * FROM public.<constant_table>`，20固定語句由白名單展開，無用戶SQL插入；ResultSetMetadata列出每個column name/SQL type，按column name排序。每cell以PG JDBC getString取完整text，null保留null，不能經JS number處理numeric；row按canonical rowbytes排序。JSONB／array保存PG16輸出，不重排array。TableSnapshot包含全部rows與columns（SQLtypes）；包含敏感credential/session/data，禁止輸出到stdout。每table hash=canonical `{columns,rows}`，dbSnapshot hash=canonical tableName/hash列表。restore rawsnapshot必須20tables+columns+rows完全match，Flyway version/checksum不能只核最新version。

另取固定media query：`SELECT id,content_type,byte_size,stored_bytes,checksum_sha256,width,height,status FROM public.cms_media ORDER BY id`；variants query=`SELECT media_id,variant,content_type,byte_size,width,height,object_key FROM public.cms_media_variant ORDER BY media_id,variant`。DB metadata所有deleted rows仍包含；hash為original bytes。

檔案演算法：

1. mediaRoot本身必須real directory非symlink；walk不FOLLOW_LINKS。逐path component檢查symlink、拒絕absolute／`.`／`..`／backslash／NUL/drive prefix，root-relative POSIX objectKey。非regular文件、hardlink（link count>1）、unsafe path或無法確認link count時回UNSAFE_MEDIA_PATH，不跟到root外；link-count需host支持，未知adapter待封板，不能跨平台假設。
2. 所有file計size/SHA256並記before/after attrs（size/mtime/file identity）；變動回WRITER_NOT_QUIESCED。異常不刪檔，檔案key唯一；variants同asset的名稱唯一且只有original/thumbnail/web，objectKey不能被兩個DBvariant共用。每declared variant需file存在且size相等。
3. 每asset恰一個original，original.size=asset.byteSize、original.sha256=checksum；storedBytes=該asset全部variant.size總和；status只能available/deleted。original缺／checksum錯／size錯分別固定code。image original依同版ImageVariants.read解碼：非null時variant集合恰original/thumbnail/web且asset與originalwidth/height=decode尺寸；thumbnail/web都需可解碼JPEG，尺寸依既有fit的320／1600等比計算；不重新生成bytes或比較ImageIO encoder輸出。decode null：width/height均null且只有original，否則IMAGE_VARIANTS_INCOMPLETE。PDF只original且dims null。不引入新image decoder。
4. 不被任何declared variant引用的regular file分類orphan，完整保留。無DB asset的檔案不自動造asset；soft-deleted媒體也全部驗證。未知contentType回SCHEMA_UNSUPPORTED，不猜file extension。asset/variant缺owner/attachment歷史索引不是disk完整性證明，raw DBsnapshot與§5.4 API隔離fixture還必須驗。
5. pre/post inventory與writer proof一致，文件／rows改變時拒絕capture。拒絕任何incomplete inventory發local-complete；Main可写private failure JSON但不包含raw key／secret/cause。

### 5.2 lock／journal與adapter執行邊界

整個單實例backup/restore/upgrade/selection catalog寫入共用local-private lockRoot/instanceId。Node mkdir(nonrecursive)取得不可重入lock；已存在回LOCK_BUSY，不用PID/TTL判斷可刪。lock內owner.json=`{version:1,operationId,instanceId,startedAt,releaseSha256}`，mode0600；root/dirs0700。lock files/parent須非symlink且localfilesystem adapter已批准；跨host/NFS lock不宣稱安全，不支持多實例。所有已批准maintenance writer也遵此lock；其他未知writer由quiesce proof拒絕。

journal append records=`{seq:string,operationId,phase,at,receiptSha256,code:null|string}`；seq嚴格+1，fsync後才執行下個adapter。artifact用exclusive新檔，先同步bytes再同目錄rename marker並sync parent；主機不支持此durability保證時ADAPTER_UNSEALED。每phase的begin與end receipt分開；發生crash留下begin無end時，重進只讀inspect，不自動重跑capture／restore／migration。operator經另一受控卡顯式處理遺留lock；本內核不提供force-unlock、自動刪或resume mutation。正常結束只owner operationId能release自己的lock；SIGINT/SIGTERM寫failure/phase，不啟動無條件finally restart。

adapter均async、無shell string拼接，由具名function接受Refs/IDs，輸出固定schema receipt；共用deadline AbortSignal，未設定deadline拒絕。每invoke先write BEGIN再call，結果schema驗證后write END。任何raw stdout/stderr只存private redacted evidence由adapter負責；核心只記exit/status/hash，不信任process exit0，還必須檢查receipt assertions。

固定adapter表：

| 方法 | 輸入／required輸出 |
| --- | --- |
| precheck | request→`{releaseSha256,writerSetSha256,originalServiceState,sourceVolumeRefs,capacityOk:true,toolsSealed:true}` |
| enterMaintenance / stopWriters | instanceId→maintenance receipt；writerSet→`{allStopped:true,forced:false,appDbSessions:'0',unclassifiedDbSessions:'0',sourceIdentitySha256}` |
| inventory / captureDb / captureMedia | immutable source/proof→inventory sha；dump artifact；media package artifact。package沒有宣告extractor前拒絕 |
| verifyLocal | 三artifacts+manifest→`{allHashesMatch:true,dumpReadable:true,inventoryComplete:true,writerProofUnchanged:true}`；dumpReadable只較低層驗證，不代表可restore |
| resumeOriginal / healthOriginal | 原running狀態／release→`{sameTuple:true,healthy:true,smokePassed:true}`；原stopped不callresume，不解掉原本維護gate |
| protectOffsite | local-complete→§4offsite receipt，必須實際回取/解密/hash；固定verify不能由stdout成功替代 |
| retrieve / prepareBlank | backupId→完整私有package；targetRef→`{owned:true,dbEmpty:true,mediaEmpty:true,isolated:true,distinctSource:true}` |
| restoreDb / restoreMedia / rawVerify | 新target/artifacts→DB restore receipt；media receipt；`{allTablesEqual:true,allFilesEqual:true,flywayEqual:true}` |
| revokeRestoredSessions | raw-verified target/backupId/operationId→同交易撤銷與AUTH審計receipt（§5.4）；無成功receipt不得start |
| startMatched / smokeMatched | exact release/target→啟動receipt；真實帳號+API/media/private/revision/restart fixture receipt |
| migrateCandidate / smokeCandidate | target/candidate release→各receipt；migration stage=`before|during|after`以test-only adapter注入；不能mutate sourcebackup |
| notifyFailure | opaque reason/phase→`{delivered:true,notificationRef}`；故障時primary reason保留，notification failure另記，不降級success |

PG真adapter語義固定custom dump完整DB、restore `--single-transaction --exit-on-error --no-owner --no-acl`到已建立的空DB，由已封定DBrole所有；不含`--clean`／`--create`／paralleljobs／Flywayrepair，不自動還原server-superuserglobals。角色／DB建立、權限與secrets由runtime/accounts adapter另卡，不假設當前admin權限可執行。此段定required effects，不聲稱主機pg工具已批准或已執行。

### 5.3 backup狀態（集合與服務兩個軸）

集合axis只forward：`PRECHECK→QUIESCED→CAPTURED→VERIFIED_LOCAL→VERIFIED_OFFSITE`；另serviceAxis=`ORIGINAL→MAINTENANCE→STOPPED→ORIGINAL_RESTORED`，不能把resume誤寫為backup完成。

PRECHECK取得lock與sourceidentity/容量/toolseal；enterMaintenance→stopWriters全部成功且forced=false/appDBsession零才QUIESCED；然後inventory→captureDb→captureMedia→post inventory/writerproof。任何不一致failure。不把API停機標準放寬成禁止HTTP mutation。

CAPTURED寫三artifact+manifest到新staging backupId；verifyLocal全部assertion→atomic local-complete且VERIFIED_LOCAL。此時封存集合不再可變，先按原running狀態resumeOriginal/health/smoke；過後才protectOffsite，減少停機窗口。原stopped狀態保持stopped。offsite回取verified後才VERIFIED_OFFSITE並atomic last-success.json=`{backupId,manifestSha256,quiescedAt,verifiedOffsiteAt}`。沒有remote成功不更新last-success；傳輸超期/fail會通知，服務可已恢復但backup仍failed。

任何backup failure：若未mutation來源、sourceidentity與oldrelease完全一致、不是forced stop或未知寫入，允許有界resume original running服務；若identity未知、inventory發現不停寫或restarthealthfailed，保持maintenance/stopped。已停止前是stopped則不啟動。CAPTURE／OFFSITE fail不刪staging、previouscomplete或原卷；failure receipt不污染last-success。resume失敗與backupprimary failure分開記錄，始終非零。

### 5.4 restore／upgrade recovery狀態

restore：`PRECHECK→RETRIEVED→VERIFIED_PACKAGE→BLANK_READY→DB_RESTORED→MEDIA_RESTORED→RAW_VERIFIED→SESSIONS_REVOKED→MATCHED_STARTED→SERVICE_VERIFIED`。

在任何target寫入前驗backupId/manifest/3artifacts/localcomplete/offsite receipt hash、release tuple與源可信；prepareBlank target distinct且owned、DB沒有userrelation/Flywaytable、media無檔（唯target基礎empty mount dirs可以），拒絕existing/populated採用，沒有`down -v`清空步驟。restoreDb complete才restoreMedia；restoreDb/media中斷不重跑到部分target，新run必須另fresh target。rawsnapshot/files/Flywayallmatch才啟動同版app。服務始終隔離，沒有自動productionroute切換。

RAW_VERIFIED先比較全部sessions與credentials原始備份。之後固定執行revokeRestoredSessions adapter，再啟動API；隔離drill與未來正式恢復都使用相同政策。此adapter在同一DB transaction執行 `UPDATE cms_session SET revoked_at = ? WHERE revoked_at IS NULL`（綁單一恢復時間），並在呼叫端先產生auditEventId，用同DataSource的既有JdbcIdentityStore.insertAudit寫一筆AUTH事件（不使用void AuditLog.record來取得ID），at與撤銷時間相同，targetType=restore、targetId=null、ip=null，action=`PRODUCTION_SESSIONS_INVALIDATED_AFTER_RESTORE`、actor=null、surface=admin、outcome=ok，detail僅operationId/backupId/targetRef/revokedCount，不存token；audit失敗全rollback且不得啟動。保留已撤銷列原值、principal/credentials/roles/grants原樣。輸出 `{operationId,backupId,revokedCount:string,auditEventId,committed:true}`，phase才成SESSIONS_REVOKED。這是恢復必要的明示狀態差異，不把它混入raw snapshot比對；前後只允許上述session欄位與一筆AUTH新增。所有舊恢復token在啟動後必須被拒絕，然後以正式測試管理員/operator重新login。不得靠不同API host當session失效證明。adapter的Java檔案／CLI／交易故障測試卡仍需與host維護接線共同封板；未有它就不得越過RAW_VERIFIED。

若SESSIONS_REVOKED已commit但API啟動前程序中斷，或之後啟動／smoke失敗，本波不提供就地resume／重做撤銷。target保持隔離且停止，保留失敗卷與journal；下一次人工重試必須使用新operationId與另一組owned空白target，從原immutable backup重新完整還原。不得把已變更的target當blank，原incidentStartedAt不重設，額外重試時間納入同一次事故RTO。R09增加「session撤銷commit後crash」fault：start0、舊target重試拒絕、只有newtarget/newoperation可重新跑，且原target保持。

MATCHED_STARTED前snapshot與啟動後snapshot分開核對：fresh/no-demo契約不允許principal/permission/demoentry意外補建。smoke只允許具名test-owned rows／AUTH事件／sessiontouch等精確預期差異，不許忽略整table。真正smoke要求新帳號login、公開已發布snapshot原三variantbytes/hash、private/draft／工作替換未發布媒體匿名404或embeddednull、deletedprivate410/public404、revision回讀、staleversion409與重啟後同資料；重用既有MediaApiTests／EntryAtomicWriteTests斷言。傳入smokeReceipt只包含各固定assertion true與產物hash，不含secret。

RTO起点incidentStartedAt為request中由owner/操作流程宣告的服務中斷時間，receipt逐字保留；startedAt只記本命令開始，不能代替incidentStartedAt。elapsedMs=(startedAt UTC−incidentStartedAt UTC)+本命令monotonic經過毫秒；前項不得負數，任何UTC倒退／與本命令monotonic跨度不相容回OBJECTIVE_UNKNOWN，不用較短數值宣稱達標。environment欄位必須與request相等。RTO起點，不以下載或pg_restore開始重新起算；若純演練，用取回命令開始時間並标`environment=isolated-drill`。需保留等待人員/secret/image取回／解密時間，clock欄位倒退或未知回OBJECTIVE_UNKNOWN，不能宣稱達標。SERVICE_VERIFIED且elapsed<=14400000ms才withinRto=true；超時成功恢復仍記withinRto=false、exit非零/OBJECTIVE_MISSED，不能重新啟計時掩蓋。

upgrade-drill只在同lock與已RESTORE_VERIFIED oldbackup下執行：`OLD_RAW_VERIFIED→CANDIDATE_MIGRATING→CANDIDATE_SMOKE→CANDIDATE_VERIFIED`。任一before/during/after故障停止candidate，neveropenwrites，再呼叫restore核心至第二組fresh target／oldtuple，產生RECOVERED_OLD或RECOVERY_FAILED；原卷／失敗candidate卷保留。拒絕backupId與release/media不匹配、onlyimage rollback或新app自動migration oldrestoretarget。公開開寫後不進這條自動回復路徑，回WRITES_ALREADY_OPEN，需要owner事故決策，不丟newwrites。source backupimmutable、faultmigration只有test-onlyclasspath不改V1–V10。

### 5.5 保留selection與RPO

catalog entry=`{backupId,manifestSha256,quiescedAt,verifiedOffsiteAt|null,restoreVerifiedAt|null,integrity:'valid'|'failed'|'unknown',inUse:boolean}`。pins是opaque backupId list，去重排序。valid且verifiedOffsiteAt存在才eligible；failed/incomplete/unknown/inUse與pins全部protected，不被candidate刪除清單吸納。

daily=每UTC日期最新eligible一份，取最近7個日期；weekly=ISO8601週（星期一00:00Z起）每週最新eligible一份，取最近4週，包括當週；時間相同以backupId字典序較小者穩定勝出。keep為daily∪weekly∪pins∪最新eligible∪最近restoreVerified且integrityvalid那一份，union可重疊、不強行複製11份。candidate=其餘eligible且notprotected，僅分類、沒有任何delete方法。沒有validoffsite或restoreverified保底也不自動刪任何資料，code=NO_RECOVERABLE_BASELINE；baselineunknown只能給diagnosticselection，不能交付pruning。weekly細節是本草稿確定提案，root審查封板，不擅自宣稱owner已批准此ISO週實作細節。

RPO age=`now - max(valid VERIFIED_OFFSITE quiescedAt)`，<=86400000為within-target；無成功集合unknown、負值clock-error，超時stale並必須通知。latest-success的verifiedOffsiteAt不能代替quiescedAt；若新capture成功但傳輸失敗，仍用舊snapshot計算。每日24h排程與非零capture/transferlatency會在下一批尚未verified時短暫超24h：因此每日once不是連續RPO保證。PD04需以實測latency封定窗口/提前量／失敗處置並由owner確認可承受exposure；不擅自增加頻率，也不將goal改為寬鬆SLA。scheduleadapter未定，沒有排程檔存在即達標的證據。

## 6 十二張環境無關卡

以下所有command是未來實作時執行，本文件階段未跑。每卡先測試Red再Green依序整合；scaffold只供測試可compile/import，throw NOT_IMPLEMENTED導致行為紅，不能以missingclass/compilererror當Red。估量為全部handwrittenchanges含測試／buildsubset；任何實際diff>400回報root拆卡，不壓入上限。

### PP1-R01 Manifest Red

- 目標：釘住batch/hash/schema與secretreceipt邊界。
- 輸入：§4；現有Node24工具測試慣例。
- 步驟：1建protocol.test與protocol.mjs scaffold；2加入FM08 manifestVersion、duplicate/unknownkey、unsafeartifactpath、sizeoverflowstring、wrongbackupId、future/orderclock、hash循環、wrongreceiptcontext案例；3只取serialized fixture不執行host命令；4保存指定assertion Red。
- 完成条件：PP1_manifestRejectsMismatchedBatchAndUnsafeInput、PP1_receiptNeverSerializesSecrets意圖Red，import成功。
- 驗證：`node --test scripts/ops/protocol.test.mjs`。
- 對應ID：PP1-AC03、PP1-FM08/11/12。
- 大小：M，估220行，上限400。

### PP1-R02 Manifest Green

- 目標：完成版本1schema、canonicalbytes與receipt驗證。
- 輸入：R01。
- 步驟：1實作§4schema與fixederrorenum；2排序／decimalstring驗證；3completionmarker不含selfhash；4跨batch/offsiteplaintext/ciphertext綁定驗證；5移除scaffold轉綠。
- 完成条件：R01所有正負向量綠，secretfixture不進receipt，無新dependency。
- 驗證：`node --test scripts/ops/protocol.test.mjs`。
- 對應ID：同R01。
- 大小：M，估260行，上限400。

### PP1-R03 Inventory Red

- 目標：先暴露缺original/variantrow、hash/path/DB故障及decode分支。
- 輸入：§5.1，MediaService/ImageVariants，PostgresFixture。
- 步驟：1建nested records與inspectscaffold；2純JUnit TempDir建可解碼PNG（ImageIO生成）＋thumbnail/webJPEG、PDForiginal、sniffedimage但decode-null、softdeleted、orphan；3新contract IT使用cleanDataSource且只讀query，snapshotsetup外後armedDBfailure；4保存missingoriginal与decodableMissingWeb的assertionRed，不是compileRed。
- 完成条件：PP1_missingOriginalOrDecodableVariantFails、PP1_unsafePathOrChangedBytesFails、PP1_dbFailureProducesNoComplete與schema/readOnly病例具名存在。
- 驗證：`./gradlew test --tests '*RecoveryInventoryTests' --no-daemon --no-parallel`；`./gradlew integrationTest --tests '*RecoveryInventoryIntegrationTests' --no-daemon --no-parallel`。
- 對應ID：PP1-AC03、PP1-FM08/10/12。
- 大小：M，估360行，上限400；完整20tablefixtures由已migratedPostgresFixture提供，無抄整DDL。

### PP1-R04 Inventory Green

- 目標：完成同版decode判斷、safe fileinventory與20table只讀snapshot。
- 輸入：R03。
- 步驟：1固定20tablemetadata＋mediaSQL；2§5.1驗所有declared/decodeexpectedvariants，orphankeep；3只提供inspect方法與canonical inventory輸出值，CLI／秘密／打包移至R05/R06；4Red轉綠。
- 完成条件：所有raw snapshot可跨順序一致，missingwebrow仍拒絕，PNG/PDF/decode-null相容；sourcebytes與DB不變。
- 驗證：R03兩條完整command；`./gradlew :services:cms-api:classes --no-daemon --no-parallel`（本輪不跑，CLI／封裝另由R06驗證）。
- 對應ID：同R03。
- 大小：M，估300行，上限400；CLI與打包已移至R05/R06。若純inventory仍超限，繼續拆卡，不能刪負向驗證省行。

### PP1-R05 Inventory CLI Red

- 目標：獨立釘住非Boot入口、private request與秘密／輸出邊界。
- 輸入：R04、§4.3；只讀inventory內核已綠。
- 步驟：1新增RecoveryInventoryMain與MainTests，run暫拋NOT_IMPLEMENTED；2測unknown/duplicate flag、canonical JSON、缺secret／symlink／other-readable secretfile、未知Ref、錯sourceCommit、DB連線失败；3注入連線／Ref resolver測fail不出complete、stdout無secret而僅count/hash；4驗Main不建立Spring context、主程式finally close connection且不修改來源。
- 完成條件：PP1_inventoryCliRejectsUnsafeInputWithoutSecrets意圖Red，類別可編譯；無正式主機工具假設。
- 驗證：`./gradlew test --tests '*RecoveryInventoryMainTests' --no-daemon --no-parallel`。
- 對應ID：PP1-AC03、PP1-FM08/10/12。
- 大小：M，估220行，上限400；Ref resolver接實際host仍待adapter卡。

### PP1-R06 Inventory CLI Green

- 目標：完成repo內入口接線與明確主類封裝。
- 輸入：R05、§4.3。
- 步驟：1Main實作§4.3 private request/ref/secret拒絕與固定receipt，不記錄raw exceptions；2只呼叫R04只讀inspect，close所有資源；3build.gradle.kts明釘springBoot.mainClass為CmsApiApplication，opsInventory JavaExec mainClass為RecoveryInventoryMain；4R05轉綠並構建bootJar，核對manifest Start-Class仍為CmsApiApplication。
- 完成條件：CLI focused測試綠，bootJar仍啟動API主類；沒有正式host安裝或還原成功主張。
- 驗證：`./gradlew test --tests '*RecoveryInventoryMainTests' --tests '*RecoveryInventoryTests' --no-daemon --no-parallel`；`./gradlew :services:cms-api:classes :services:cms-api:bootJar --no-daemon --no-parallel`；以本節下列Node24＋JDK jar命令回讀manifest確認Start-Class；此命令未在文件階段執行。
- 對應ID：PP1-AC03、PP1-FM08/10/12。
- 大小：M，估220行，上限400。Main依賴之Ref resolver實際配置方式仍待host adapter；本卡不能聲稱正式CLI可用。

R06 manifest完整查核命令（component根執行，已完成bootJar之後）：

```bash
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { readdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
const libs = resolve('services/cms-api/build/libs');
const jars = readdirSync(libs).filter(name => name.endsWith('.jar'));
assert.equal(jars.length, 1, 'expected one bootJar');
const proofDir = mkdtempSync(join(tmpdir(), 'pp1-manifest-'));
const result = spawnSync('jar', ['xf', join(libs, jars[0]), 'META-INF/MANIFEST.MF'], { cwd: proofDir, encoding: 'utf8' });
assert.equal(result.status, 0, 'jar manifest extraction must succeed');
assert.match(readFileSync(join(proofDir, 'META-INF/MANIFEST.MF'), 'utf8'), /^Start-Class: com\.fallrising\.cms\.CmsApiApplication\r?$/m);
console.log('PP1 bootJar Start-Class passed; isolated manifest receipt: ' + proofDir);
JS
```

只向新建臨時目錄擷取單一manifest，保留作檢查證據，不對既有檔案做清理。此repo驗證使用既有Node/JDK，不表示正式主機需安裝它們。

### PP1-R07 Backup Red

- 目標：以可控adapter證明停寫／concurrency／crash與最後成功保留。
- 輸入：R02/R04/R06、§5.2/3。
- 步驟：1建backup.test、journal/backupscaffold；2每caseTempDir與fakeclock/fakeadapters，不啟動Docker；3promisebarrier構造同instance第二callLOCK_BUSY；4injectstopforced/sessionnonzero/dumpnonzero/discfull/inventorychanged/offsitewronghash/notifyfail/resumehealthfail；5驗BEGIN無ENDcrash只inspect不重跑。
- 完成条件：PP1_backupCannotCaptureBeforeAllWritersStop與PP1_failedCaptureOrOffsitePreservesLastSuccess意圖Red；無secretlog／cleanupmutation。
- 驗證：`node --test scripts/ops/backup.test.mjs scripts/ops/protocol.test.mjs`。
- 對應ID：PP1-AC03、PP1-FM09/10/11。
- 大小：M，估340行，上限400。

### PP1-R08 Backup Green

- 目標：完成journal、lock與backup雙axis協定。
- 輸入：R07。
- 步驟：1實作exclusiveownerlock／appendfsync/journalseq；2按phase逐一adapterinvoke，不pipeline吞failure；3localcomplete後resume再offsite，originalstopped不啟動；4lastsuccess只在verifiedoffsite更新；5中斷/unknownstate不autoretry，故障boundedresume按§5.3，通知失敗可見；6R07全綠。
- 完成条件：全部faulttrace序列/last-success/source保留斷言通過；unsealedadapter拒絕非fakeexecution。
- 驗證：`node --test scripts/ops/backup.test.mjs scripts/ops/protocol.test.mjs`。
- 對應ID：同R07。
- 大小：M，估380行，上限400。PG/容器/傳輸/通知實作不藏在此卡。

### PP1-R09 Restore／Upgrade Red

- 目標：先釘空白target／匹配tuple／三upgradefailure與deadline。
- 輸入：R08、§5.4。
- 步驟：1建recovery.test/scaffold；2fakeproof分別existingDB／populatedmedia／samevolumes／wrongrelease／missingartifact；3before/during/aftermigration failure各case，assertnoopenwrites、oldrecover呼叫secondfreshtarget；4raw mismatch/sessionadapterunsealed/sessioncommit後crash/smokefailure/RTOexpiry；5以spy禁止sourcewrite/delete/onlyimagerollback。
- 完成条件：PP1_restoreRejectsPopulatedTargetBeforeWrites、PP1_upgradeFailuresRequireMatchedFreshRecovery、PP1_restoreIncludesRetrievalInRto意圖Red。
- 驗證：`node --test scripts/ops/recovery.test.mjs scripts/ops/backup.test.mjs`。
- 對應ID：PP1-AC03/04、PP1-FM10/12/13/15。
- 大小：M，估350行，上限400。

### PP1-R10 Restore／Upgrade Green

- 目標：完成restore／upgrade兩狀態機及fixedreceipt。
- 輸入：R09。
- 步驟：1逐phase驗package/target/tuplebeforewrites；2restoreDb→media→raw→revoke sessions→matchedstart→truesmokereceipt；3upgrade三failure停candidate保持maintenance後oldbackup/freshtargetrecover；4deadline涵蓋retrieval與secret/image取得，不重啟時計；5未知target/sessionactivationcontract與alreadyopenwrites拒絕；6R09綠。
- 完成条件：所有fakeadaptertrace正確、original/faultvolumes留存。只標核心Green，沒有RESTORE_VERIFIED真演練或productionactivation主張。
- 驗證：`node --test scripts/ops/recovery.test.mjs scripts/ops/backup.test.mjs scripts/ops/protocol.test.mjs`。
- 對應ID：同R09。
- 大小：M，估360行，上限400；不包括真PGrestore、packageextractor／proxy操作。

### PP1-R11 Selection Red

- 目標：釘daily7/weekly4、overlap/pins與RPO/RTO邊界。
- 輸入：§5.5、R02。
- 步驟：1建selection.test/scaffold；2固定30天catalog含跨年ISOweek、同日multiple、hashfailed/offsitepending/unknown/inuse/pinned/oldrestoreverified；3now最新quiesced+86400000／+1、futureclock、無eligible；4固定restoreelapsed14400000／+1與missingstart；5assertmodule無delete/adaptersideeffect。
- 完成条件：PP1_daily7Weekly4UnionPreservesRecoveryBaseline與PP1_rpoUsesSnapshotNotTransferTime意圖Red。
- 驗證：`node --test scripts/ops/selection.test.mjs`。
- 對應ID：PP1-AC03/05、PP1-FM11/14。
- 大小：M，估200行，上限400。

### PP1-R12 Selection Green

- 目標：完成deterministic保留selection與objective狀態，禁止pruning。
- 輸入：R11。
- 步驟：1按UTCday/ISOweeksort/tiebreakunion；2protected/incomplete/latestoffsite/restorebaseline不成candidate；3onlyIDsreasonstdout且no-delete；4RPO/RTO用資料時間/全程時計；5全內核命令與diffscope自查。
- 完成条件：R11綠、candidate永不執行delete、noadapterinstalledclaim；root須另提host與真演練卡。
- 驗證：`node --test scripts/ops/protocol.test.mjs scripts/ops/backup.test.mjs scripts/ops/recovery.test.mjs scripts/ops/selection.test.mjs`；R03兩條Gradlefocusedcommands；`git diff --check`。
- 對應ID：同R11及整合PP1-AC03/04。
- 大小：M，估220行，上限400；完整nativegates/CI/independentreview另由root整合交付卡。

## 7 精確測試fixture與證據層

Node每case新TempDir；fakeclock UTC=`2026-10-09T00:00:00.000Z`、monotonic0；operationId用固定不同UUID；fakeadapterreceipt由§5.2schema產生，spy只recordmethod/opaque IDs。faultcase每次只改一個field或throw固定OpsError，不靠真網路/diskfill；concurrency用Promisebarrier，不sleep猜先後；abortcase第一BEGIN已persist後cancel，檢查下一adapter零calls。bytes fixturecontains secretcanary，檢查receipt和stdout均無canary；private inventory含canary可保留。

Java tests用@TempDir与explicitrecords；ImageIO生成32×16 PNG original，既有ImageVariants.fit產320/1600 variant（小圖不放大，兩variant32×16），PDF bytes `%PDF-1.4\n`；decode-nullimage bytes僅合法sniffheader且ImageIO=null。orphan `orphan.bin`一份hash記錄，不刪。deletedasset完全samefiles；一case刪webrow卻留webfile，需IMAGE_VARIANTS_INCOMPLETE，不能只檢declaredrows而pass。另一case保留webrow刪webfile→MISSING_MEDIA_OBJECT；symlink在TempDir指到第二TempDir（只能支援symlink環境測，必需CIhost明列），hardlink同inode→UNSAFE_MEDIA_PATH。第三case alteredoriginalsamebytecount→MEDIA_HASH_MISMATCH。SQLfaultmock Connection/JDBC執行窗口aftersetup，assertalloutputcompleteabsent。

真PG IT置於contract package以用既有PostgresFixture；setup新schema/migratedtables，插asset/variant與一份raw entry/revision/permissions／sessionsfixture，將dbmetadata與media每筆一致。inspect兩次hash同、故障不mutate；此IT只證真DBinventory。完整restoredrill需要另外两个獨立PGdatabase/mediaRoots、真offsiteadapter與customdump，不能重用PostgresFixture.emptyDataSource的全schema clean作restore到新庫。

精確步驟pattern：建立fixture→記sourceDB/fileshash→callcore→等待同步返回或fakepromisebarrier→assertcode/phase/adaptertrace/unchangedoriginal/lastsuccess；所有command結果必須另收actualreceipt。fakeexit0不等於PGdump可還原；單元測試schemaGreen不等於filesystemdurability支援；所有未跑gates保留未跑狀態。

## 8 失敗模式與固定退出

| code／FM | 精確行為／測試／卡 |
| --- | --- |
| INPUT_INVALID / MANIFEST_MISMATCH / PP1-FM08/12 | exit2，無targetwrites；manifestwrongbatchunsafeinput R01/02 |
| MISSING_MEDIA_OBJECT / MEDIA_HASH_MISMATCH / MEDIA_SIZE_MISMATCH / IMAGE_VARIANTS_INCOMPLETE / PP1-FM08 | exit3，完整集合不成功、不修檔/DB；inventorytests R03/04 |
| UNSAFE_MEDIA_PATH / SCHEMA_UNSUPPORTED / PP1-FM08/12 | exit3，未知path/link/table/type拒絕；inventorytests R03/04 |
| LOCK_BUSY / WRITER_NOT_QUIESCED / SOURCE_CHANGED / PP1-FM09 | exit4，capture0，不偷unlock，不forcedstop；backuptrace R07/R08 |
| CAPTURE_FAILED / LOCAL_VERIFY_FAILED / PP1-FM10 | exit5，無localcomplete、lastsuccess不動、有界safe恢復原state；R07/R08 |
| OFFSITE_FAILED / OFFSITE_VERIFY_FAILED / NOTIFY_FAILED / PP1-FM11 | exit6，local保留、不更新success，通知雙failure；R07/R08 |
| TARGET_NOT_BLANK / TARGET_NOT_OWNED / ADAPTER_UNSEALED / PP1-FM12 | exit7，所有restorewrites0；R09/R10 |
| RESTORE_FAILED / RAW_MISMATCH / STARTUP_MUTATION / SMOKE_FAILED / PP1-FM10/15 | exit8，target停隔離、保留原卷，不出verifiedreceipt；R09/R10 |
| UPGRADE_FAILED / RECOVERY_FAILED / WRITES_ALREADY_OPEN / PP1-FM13 | exit9，noopenwrites，oldtuplefreshrestore或hold；R09/R10 |
| INTERRUPTED / JOURNAL_INCOMPLETE | exit10，記phase保留lock等待受控inspect；R07/R08/R09/R10 |
| OBJECTIVE_MISSED / OBJECTIVE_UNKNOWN / NO_RECOVERABLE_BASELINE / PP1-FM14 | exit11，能用仍記RTO超時／RPOstale，selection不刪；R11/R12 |

primarycode不被notifyfailure覆蓋；Outcome保留primaryexit，notificationreceipt另有failed。phase不得以OpsError.message猜測，從journal目前phase記錄。未登入／wrong surface／versionConflict由既有APIassertions及正式smokeadapter覆蓋，不把coreerrorenum新增到HTTPErrorCode。

## 9 整合檢查表與殘餘依賴

- [x] PP1正文與PD04已更新批准數值，不寫已達SLA。
- [ ] weeklybucket細節與RPOlatencyexposure審查；R04原390行高風險估算已拆成R04盤點、R05/R06 CLI與封裝Red/Green；各卡仍需實作前大小與接口walk，不能靠省略安全驗證壓行數。
- [ ] PD01：hostOS/localfilesystem、Node/JRE工具與permissions、包裝命令、Compose版本、容器停止deadline／restartmanager／DBsession識別、空白DBrole、media readonlymount、archiveformat及safeextractor封板。
- [ ] PD02/runtime：實际URL／HTTPS／隔離route／frontendartifacts與來源releasehash固定，no-secretconfigschema由runtime卡提供。
- [ ] PD03：離機目的地、加密/傳輸tool版本／金鑰恢復／受保護來源驗證／回取解密hash／通知receipt具體adapter與故障；沒有provider工具 অনুম認。
- [ ] PD04：每日實際維護窗口、capture/offsite耗時與RPOmargin、scheduler故障catchup／notification、容量門檻；不額外批准频率或pruning。
- [ ] accounts：正式首批publictypegrants、operator與恢復帳號／session撤銷adapter（政策已固定，接線與精確卡未完成）；startupno-demo精確raw/post差異白名單。
- [ ] 真環境measure：offsite回取到服務可用<=4h、snapshotage<=24h；三upgradefailurefreshmatchedrestore、媒體隔離/revision重啟等真證據。R01～12無法代替此閘門。
- [ ] root做五卡weakmodelwalk、独立review、精確檔案／20table計數等契約一致性與必要CI；實際超400拆卡；整體>30提拆波。

外部一次來源查證2026-10-09：[PostgreSQL16 pg_restore](https://www.postgresql.org/docs/16/app-pgrestore.html)確認single-transaction implying exit-on-error、不能與paralleljobs一起；[Node24 fs](https://nodejs.org/docs/latest-v24.x/api/fs.html)為mkdir/open/fsync/rename的stdlib來源，未承諾任意主機filesystemdurability。Java媒體decode全部依上述同版source，不新增依賴。這些唯讀查證不是產品測試通過或主機工具安裝證據。

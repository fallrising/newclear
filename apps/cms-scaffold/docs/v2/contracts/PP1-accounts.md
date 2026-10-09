# PP1 帳號維護與 demo seed 分離契約草稿

日期2026-10-09；配合[PP1b本地施工圖](../waves/PP1b.md)。狀態 **隨 PP1b 文件 PR 通過必要 CI 並正常合併後 DOC_READY，未實作**。Q25已批准規則沿[治理附約](PP1-governance.md)；本附約的local adapter是本輪已通過獨立文件審查的新設計，正式host adapter仍待環境查验。不能把接口/mock或PP1a網路/TLS可行性probe視為維護adapter通過。

Seed分離屬[PP1a](../waves/PP1a.md)，PP1b不重作、不恢復unsafe舊constructor。local freshness允許同版Flyway、既有12catalog/fields與5system roles；identity歷史、entries/media/navigation須空。實作起點要求PP1a已VERIFIED；正式host待答不阻本地子波。非空庫host recover成功依PP1c verified rollback bundle，本波只交core與missing-backup fail-closed。

## 1 範圍與已批准邊界

Owner 2026-10-09批准全新DB、不帶demo帳號／內容、獨立日常operator、同HTTPS site不同origins、每日停寫備份RPO24h/RTO4h、daily7＋weekly4。實際host／工具／URL／離機位置／通知／每日窗口／首批公開types仍未知。此子集對應PP1-AC02、PP1-FM04；Q25另沿PP1-governance，不在本子集重作。

固定選擇：一位正式admin由fresh-init建立；日常operator由正式Admin API建立與明列權限；anonymous grants初始化為空。既有12個pack schema保留，無新模型；demo navigation與schema分開gate。cli不提供--public-type、任意提升帳號、全角色覆寫或無認證HTTP入口。無新的migration、依賴、部署、秘密寫檔、資料清理。備份保留僅選定完整可恢復集合；automatic pruning／實際刪除不在本次。

## 2 來源與既有可沿用契約

以下全部相對component `apps/cms-scaffold`，main前綴=`services/cms-api/src/main/java/com/fallrising/cms/`，test=`services/cms-api/src/test/java/com/fallrising/cms/`，it=`services/cms-api/src/integrationTest/java/com/fallrising/cms/`。本輪核對PP1a產品候選commit `343c825cbace9b6c5dbbfc6d52486831ba395dd4`；PP1a產品已合併至此main、必要PR/main CI通過，local scope已VERIFIED；不代替本地guard與PP1b驗收。實作前root回讀已合併main與PP1a狀態，保留任何增量。

| 來源 | 事實與設計限制 |
| --- | --- |
| main `CmsApiApplication.java:6–10` | 普通main直接完整component scan；不能只加web=NONE便稱沒有demo listener。需要先分流到獨立configuration，不能把maintenance configuration掃進普通app。 |
| `services/cms-api/build.gradle.kts:46–63` | JDBC／Flyway／PostgreSQL／Spring test與Testcontainers已存在；沒有CLI parser新依賴需要。 |
| main `identity/web/IdentityStoreConfig.java:18–23` | 沒DS/TM會fallback memory；正式maintenance必須拒絕這種fallback，不能使用此factory作headless正式wiring。 |
| main `identity/service/SeedService.java:66–85,88–140,174–194` | seed=false只五角色；seed=true建立九demo帳號與grants，既有帳號whole-replace assignment；不是正式bootstrap。 |
| main `content/service/ContentTypeSeed.java:25–40,130–152,167–226` | PP1a已保留12schemas/fields/metadata/markMediaRefsPublic，draft front.primary demo navigation只在DemoSeedPolicy.enabled時建立。 |
| main `content/service/DemoContentSeed.java:27–60` | PP1a已在Order200 seed入口先DemoSeedPolicy gate；prod即使有舊seedactor也不執行demo內容。 |
| main `identity/service/PrincipalAdminService.java:103–122,157–199` | 現有Admin建帳號／roles／reset需認證，reset撤sessions，unlock不接受disabled。適合建立日常帳號，無首位救援功能。 |
| main `identity/service/AuthService.java:137–139`、`identity/crypto/PasswordHasher.java:13–34` | 原密碼規則UTF-16 length≥12且不等於username（ignoreCase）；既有Argon2id可沿用。原hash(String)需要 immutable string，新增char[] overload不影響舊API。 |
| main `identity/domain/Principal.java:23–35` | withLock可清failed/lockedUntil；withLoginSuccess會寫lastLoginAt，恢復不得調此方法假裝成功登入。 |
| main `identity/store/JdbcIdentityStore.java:34,308–358` | 已有private admin guard key `0x434d5341444d494eL`；usable-admin含active/nondeleted/admin assignment/admin面manage_principals。新增maintenance primitive沿同鎖。 |
| main `identity/store/InMemoryIdentityStore.java:30–40,43–61,240–295` | filtered list排除deleted，不能用它判fresh；已有maps與adminGuard；無通用交易rollback。新增primitive只覆蓋maintenance使用maps／audit snapshot。 |
| main `platform/TransactionRunner.java:30–55` | 同DS transaction可合併store與audit；independent為REQUIRES_NEW。本子集success audit全部同交易，不新增business-denial HTTP audit。 |
| resource `db/migration/V2__identity.sql:4–92` | 既有principal/credential/roles/grants/sessions/audit全部足夠；username全局unique包含softdeleted。fresh必須raw讀非filtered state。 |
| it `contract/PostgresFixture.java:20–34`、`contract/IdentityAuditAtomicWriteTests.java:53–73` | cleanDataSource是真PG16已migration fixture；既有audit fault在insert後throw，使用相同DS transaction。有界test不使用sleep，race以latch。 |

## 3 未來精確檔案白名單

此表是設計，不是本worker寫入權限。

| 路徑（按§2前綴） | 動作／用途 | 卡 |
| --- | --- | --- |
| main `CmsApiApplication.java` | 修改；argv首字maintenance才分流，不進普通scan | B02/B03 |
| main `identity/maintenance/IdentityMaintenanceCommand.java` | 新增；解析／exit／context lifecycle／receipt；內含nested Options、Result、FailureCode | B01/B03/B10 |
| main `identity/maintenance/IdentityMaintenanceConfiguration.java` | 新增；普通类，無@Configuration／@Component／scan；由maintenance runner明確register beans | B01/B03 |
| main `identity/maintenance/MaintenanceGuard.java` | 新增；host lease interface；預設拒絕adapter；無主機操作實作 | B01/B03 |
| main `identity/maintenance/ConsoleSecretInput.java` | 新增；Console密碼兩次輸入與清除；tests注入fake | B01/B03 |
| main `identity/crypto/PasswordPolicy.java` | 新增；CharSequence純驗證，原Auth規則不變 | B01/B03 |
| main `identity/crypto/PasswordHasher.java` | 修改；新增hash(char[])接受owned buffer，保留舊hash(String)；不保證encoder無String副本 | B02/B03 |
| main `identity/service/AuthService.java` | 修改；validateNewPassword委派PasswordPolicy，保持原HTTP結果 | B02/B03 |
| main `identity/store/IdentityStore.java`、`JdbcIdentityStore.java`、`InMemoryIdentityStore.java` | 修改；raw-state＋maintenance guarded transaction | B04–B08 |
| main `identity/maintenance/ProductionIdentityService.java` | 新增；B01先只有constructor／public signatures throw scaffold供CLI編譯；freshInit／recoverAdmin、固定grant矩陣、原子receipt | B01/B03/B08/B10 |
| test `identity/maintenance/IdentityMaintenanceCommandTests.java` | 新增；parser、秘密與hostguard拒絕、context wiring | B01/B03/B10 |
| test `contract/IdentityMaintenanceContract.java`、`InMemoryIdentityMaintenanceContractTests.java` | 新增；fresh/recovery相同state契約、memory fault/race | B04/B05/B09 |
| it `contract/JdbcIdentityMaintenanceContractTests.java` | 新增；相同契約PG adapter、rollback/race | B04/B05/B09 |
| it `contract/ProductionIdentityIntegrationTests.java` | 新增；真hash/login/admin grant／recovery重啟回讀 | B04/B05/B09 |

本帳號核心無package/build/lock/workflow/resource/migration修改；local工具增加路徑只依PP1b G卡白名單。maintenance configuration使用已有classpath，source/artifact名稱不分第二個jar；本帳號子集不新增第二main。恢復附約可另有RecoveryInventoryMain入口並在其scope明釘springBoot.mainClass=CmsApiApplication及獨立JavaExec，不能把此局部選擇當整波限制。localguard逐檔scope在PP1b G01–G07與本附約§10；正式host adapter仍待PD01/03/04封板。

## 4 命令、型別、輸入與退出

```text
java -jar <matching-app.jar> maintenance fresh-init --username <name> --display-name <label>
  --target-id <opaque-config-id> --operation-id <UUID> --confirm FRESH_INIT
java -jar <matching-app.jar> maintenance recover-admin --principal-id <canonical UUID>
  --target-id <opaque-config-id> --operation-id <UUID> --confirm RECOVER_ADMIN [--reenable]
```

命令參數只有非secret，正式username/displayName僅private操作紀錄，不進公開示例。各flag恰一次；未知／重複／缺值／flag不適用當前operation回exit2；username正規化lowerCase(ROOT)後沿`^[a-z0-9._-]{3,32}$`，禁止`seed-`前綴；displayName非空且Unicode codepoints≤80。target-id非空、operation-id canonical UUID；confirmation逐字，無trim。recover UUID不可從username猜。無--password、任意Spring --property、--public-type、--repair-role選項；不把CLIargs加入Spring Environment。普通server若任何位置出现maintenance而非argv[0]也拒絕，不誤啟server。所有退出先closecontext/lease、清password char[]。maintenance分流第一步使用既有Boot `LoggingSystem.get(CmsApiApplication.class.getClassLoader()).setLogLevel(LoggingSystem.ROOT_LOGGER_NAME,LogLevel.OFF)`，在任何Hikari/Flyway/context/formatter之前關root logs，不改普通server或新增logback檔。真maintenance入口capture確證沒有JDBCURL/schema/frameworklogs／stack。固定兩個Console TTY prompts是stdout固定JSON以外唯一TTY輸出例外，不能插username/profile；PTYdriver以此同步。

退出碼：0成功；2參數／密碼／console輸入錯；3state不安全（NOT_FRESH、TARGET_NOT_ADMIN、TARGET_DISABLED、ADMIN_GRANTS_DAMAGED）；4鎖busy/timeout；5DB/schema/hash/audit等內部失敗；6HOST_GUARD_NOT_CONFIGURED／quiescence未證明。error只輸出固定code與operation-id，不輸出exception.getMessage、stack、jdbcurl、options、password/hash。

固定型別（nested在Command，無secret record）：

```java
enum Operation { FRESH_INIT, RECOVER_ADMIN }
record Options(Operation operation, String username, String displayName, UUID principalId,
               String targetId, UUID operationId, boolean reenable) {}
record Result(UUID operationId, Operation operation, UUID principalId,
              Instant completedAt, String releaseId, String targetId) {}
// 以上字段皆非密碼；username/label僅Options，不進公開stdout receipt。
public static int run(String[] args); // entry；只接剩餘maintenance參數
public static Options parse(String[] args);
```

`ConsoleSecretInput.readAndConfirm(String username): char[]`：System.console()==null即exit2，不fallback echoed stdin／環境密碼／input file。readPassword兩次，固定TTY prompts `New password: `／`Confirm password: `，逐字相同，PasswordPolicy驗證，錯誤立即擦兩buffer；返回owned第一buffer，第二bufferfinally擦。CLI将成功buffer在所有退出finally Arrays.fill，hash overload用CharBuffer傳入既有encoder，但不聲稱因此避免password String：encoder/provider可建立不可擦除的內部副本。測試只保證本程式不把raw secret寫入log／record／exception與清除app-owned buffers；沒有零副本或完整記憶體擦除保證。

`PasswordPolicy.validate(CharSequence username, CharSequence password): void`（username可null）：保留原UTF-16 length≥12及username case-insensitive不相等的規則，抛原IdentityException.validation。由AuthService現有String函式委派，CLI用CharBuffer。`PasswordHasher.hash(char[] raw): String`用existingencoder.encode(CharBuffer.wrap(raw))，結果只在credential儲存，不出receipt。

### 4.1 真正停止保證與host adapter邊界

```java
public interface MaintenanceGuard {
  ConnectionPhase connectionPhase(); // defaultDeny實作此與acquire皆拋HOST_GUARD_NOT_CONFIGURED
  interface ConnectionPhase {
    void assertPreConnection();
    void bindBackend(int pid, String backendStartEpoch);
    void assertBound();
  }
  Lease acquire(String targetId, UUID operationId, IdentityMaintenanceCommand.Operation operation);
  interface Lease extends AutoCloseable {
    String targetId(); String releaseId(); String backupId();
    void assertQuiesced();
    void recordCommitted(IdentityMaintenanceCommand.Result result);
    @Override void close();
  }
}
```

預設guard的acquire永遠拋固定HOST_GUARD_NOT_CONFIGURED（exit6）。headlessconfiguration不得讀receipt就當已quiesced。正式adapter須持有與backup/upgrade/recovery共用的host互斥lease，實測API、scheduler與所有可寫DB/media程序已停止、其DBsessions结束、auto-restart不會重新起writer，並反覆assertQuiesced直到DBcommit。lease target/release須与所選DBconnection及matching artifact绑定，host上的原狀態復原／失敗留維護狀態由adapter負責。fresh-init要求owned新DB/media及完整已migration schema驗證；recovery additionally需要非空verified可恢復backupId。外層receipt提供追溯，不是停止證明。

本interface關閉core呼叫形狀，沒有聲稱可用production adapter。host/tool unknown不能先安裝flock/systemd/Compose或靠PID猜無writer；實測adapter未封板時這整條正式維護接線不可施工。

### 4.2 獨立context與schema

`IdentityMaintenanceConfiguration.open(Options options, MaintenanceGuard guard): ConfigurableApplicationContext`使用AnnotationConfigApplicationContext明確registerBean：DataSource、PlatformTransactionManager/TransactionTemplate、JdbcIdentityStore、TransactionRunner、IdentityProperties、PasswordHasher、ObjectMapper、AuditLog、ProductionIdentityService、MaintenanceGuard。它是無annotation普通class，不被CmsApiApplication scan發現；不使用普通SpringApplication的autoconfiguration/component scan。open的exact framework wiring／DataSource shutdown與schema-validation fixture仍需root独立審查，本文不把未編譯API簽名當已驗證實作。

DataSource由現有Spring DataSourceBuilder建立，要求SPRING_DATASOURCE_URL/USERNAME/PASSWORD皆非空且URL是jdbc:postgresql:；無localhost/defaultcredentials fallback，值只從外部受保護environment提供，URL／credentials不放argv。IdentityProperties只用prod既有Argon2設定值，不讀demo密碼。硬性assert store是JDBC且transactionmanager用同DS；沒有memory fallback。只create/validate既有Flyway配置`classpath:db/migration`，呼叫validate，不migrate；migration provisioning屬已停止的新庫host流程，缺表／migration mismatch即exit5、零業務寫入。沒有HTTPserver、controller、SeedService、ContentTypeSeed、DemoContentSeed、AuditPurgeJob或ApplicationReady listeners；constructor/wiring測試逐項斷言bean absent，而非只看port0。

## 5 fresh-init狀態、grant矩陣與交易

新增IdentityStore methods：

```java
boolean hasIdentityDataIncludingDeleted();
boolean hasMaintenanceOperation(UUID operationId);
<T> T maintenanceTransaction(Supplier<T> attempt);
```

JDBC raw-state完整SQL：

```sql
SELECT EXISTS(SELECT 1 FROM cms_principal)
 OR EXISTS(SELECT 1 FROM cms_credential)
 OR EXISTS(SELECT 1 FROM cms_principal_role)
 OR EXISTS(SELECT 1 FROM cms_permission)
 OR EXISTS(SELECT 1 FROM cms_session)
 OR EXISTS(SELECT 1 FROM cms_audit_event);

-- hasMaintenanceOperation：非分頁查詢，所有target都查，bind operationId.toString()。
SELECT EXISTS(SELECT 1 FROM cms_audit_event
 WHERE category = 'AUTH'
   AND action IN ('PRODUCTION_ADMIN_INITIALIZED', 'PRODUCTION_ADMIN_RECOVERED')
   AND detail_json ->> 'operationId' = ?);
```

`hasMaintenanceOperation`在共同guard持有的transaction內呼叫；不靠listAudit/page size。memory在同monitor遍歷完整audits，category/action同SQL，detailJson以Jackson readTree取文字operationId比較canonicalUUID；null detail跳過，malformed detail拋固定內部失敗，不記secret。此方法在B04先有可編譯signature scaffold，B06/B07完成兩store實作；B09只增加recovery行為Red，不因缺method/class而編譯失敗。JDBC/memory duplicatecase皆包含operationId存在於不同target的既有successaudit、相同target、其他action同id不算duplicate，不能只查正在recover的target。

hasIdentityData不靠listPrincipals，softdeleted也拒絕。角色單獨允許空表或五標準system-role subset，非標準code／system=false即NOT_FRESH；既有角色IDs/displayNames/createdAt保留，其餘補齊與原seed相同五role名稱。audit/media/settings singleton與content catalog既有初始化不當身份業務資料；空content/media／導航、schema/disk新目標由freshhostguard驗證，core身份rawcheck不冒充完整DB/磁碟fresh證明。

`ProductionIdentityService` ctor `(IdentityStore store, PasswordHasher hasher, TransactionRunner transactions, AuditLog audit, MaintenanceGuard guard)`。公開：`Result freshInit(Options options, char[] password)`、`Result recoverAdmin(Options options, char[] password)`。fresh固定順序：驗Options/password→hash（無DBsideeffect）→guard.acquire→assertQuiesced→`store.maintenanceTransaction`→rawstate／target重讀→所有寫入＋audit→再次lease.assertQuiesced→txcommit返回→建Result→lease.recordCommitted(Result)→lease.close→回Result；失敗finally關lease。recordCommitted只能在commit後，command只是收到service Result後輸出stdout，不自行提前close或寫receipt；leaseclose失敗若DB已commit需report固定COMMITTED_HOST_RESTORE_FAILED與operationId（exit5），不可重試mutation或說rollback。

maintenanceTransaction JDBC用既有同DS tx，先`SET LOCAL lock_timeout='5s'`，`SELECT pg_advisory_xact_lock(?)`綁同ADMIN_GUARD_KEY，attempt/reads/writes在同tx；SQLSTATE55P03映exit4，其餘5。不得在lock外檢查fresh，再用upsert。兩個fresh命令即使hostadapter fake允許都最多一個commit；第二取得鎖後NOT_FRESH。production hostguard應先拒第二writer，DBguard是第二道資料保護。

memory使用同adminGuard監視器，snapshot principals、usernameIndex、credentials、roles、principalRoles、permissions、兩session maps與audits（lists deep-copy），同步attempt；RuntimeException或Error時直接restore私有maps/list原presence/物件，不能透過fault-injected public writer還原。hasIdentityData讀rawmaps含deleted。這只是maintenance範圍原子性，不更改一般memory store交易宣告。普通source變更writer需遵守已停止host保證；不聲稱這monitor/advisory已阻止未合作SQL。

固定fresh寫入：補角色→admin grants→一位active principal（email=null、failed=0、lockedUntil/lastLoginAt/deletedAt=null）→password credential argon2id→admin assignment contentTypeCodes=[]→successaudit。admin13動作沿SeedService既有矩陣：read_published allowedSurfaces=[front,back,admin]；manage_types/manage_principals/manage_settings/read_audit=[admin]；read_draft/create/update/publish/unpublish/delete/archive/manage_media=[back,admin]。所有type/predicate=null。admin標準治理身份保持既有語義；anonymous/member/editor/operator grants全部[]，不替operator建wildcardgrant。建完countUsableAdmins()==1，否則rollback。

Audit `category=AUTH, action=PRODUCTION_ADMIN_INITIALIZED, actor=null, targetType=principal, targetId=<new>, surface=admin, outcome=ok`，detail僅operationId/releaseId/targetId（opaque)/mode=FRESH_INIT。row與帳號同tx，沒有密碼／hash／displayName／permission原文；拒絕fresh不寫DBaudit，stderr固定code作操作拒絕receipt。任一寫入或audit失敗rollback；原roles／IDs仍完整保留。重跑即非零NOT_FRESH，不重置credential、不產生第二audit；與上次同operationId亦不把拒絕改成功。

### 5.1 日常operator與公開讀取

初始化無日常operator，正式admin正常登入後使用既有POST principals＋PUT roles＋PUT operator permissions配置。API會回temporaryPassword一次；由受保護操作取得／交付，不進chat/report；日常與admin username不同、無seed-前綴。

固定最小operatormatrix：每個**明列首批日常type**八個type actions（read_published/read_draft/create/update/publish/unpublish/delete/archive），無predicate；read_published surfaces=[front,back,admin]、其餘[back,admin]；global manage_media type=null，[back,admin]恰一列。assignment的contentTypeCodes是同一明列清單；無manage_*治理/read_audit、无未来type自動擴展；appointment_request不在第一批允許list，若投入仍要完整Q26/BQ14。這不是新增role或回寫通配舊operatorseed。

anonymous公開清單預設空；每個明列publictype配置read_published,type=該code,predicate=null,surfaces=[front]，沒有wildcard。先建立首批catalogtype，再以正式Admin配置permissions，不用bootstrap猜types。operator grant為global role的明確替換，僅在fresh角色空列表且owner首批清單已給定的配置步驟執行；不是每次ready重置。不清空既有客製庫。安全初始化可通過且anonymous403；公開旅程必須有實際type清單，不能用沒有publicgrant的新庫說完整旅程通過。

## 6 recover-admin確定政策

recover Console只有nullusername可先驗minlength/mismatch；**完整passwordpolicy必在maintenanceTransaction內重讀target資格後**呼叫PasswordPolicy.validate(target.username(),CharBuffer.wrap(password))，不等於actualusername（ignoreCase）才hash，再write/audit。fresh仍可tx前hash；recover hashfailure亦在tx內rollback。targetusername≥12字測同字/大小寫變體：exit2 SECRET_INPUT_INVALID、零mutation/receipt，不能只驗nullusername。只接受已有nondeleted target UUID且真assignment roleCode=admin；role存在但target沒admin仍TARGET_NOT_ADMIN。adminrole必須已有action=manage_principals、allowedSurfaces含admin的grant（沿usable定義）；不符合ADMIN_GRANTS_DAMAGED，原資料不改。不提供role-repair、創建替代admin或任意提升普通帳號；此狀態走受控已驗證備份還原，沒有可用集合則停止並由root列外部阻擋，不能現場SQL或seed救援。

active／locked可恢復；disabled僅有explicit --reenable才可恢復，無flag TARGET_DISABLED；--reenable对active/locked是允许但detail記requested=true，不授其他權限。缺credential可為已有admin補password credential；其它非passwordcredentialschema不允许。target在共同guard內重讀，所有資格與state檢查先於第一write。

寫入：password credential→current.withLock(0,null,ACTIVE,now)（保留username/displayName/email/createdAt/lastLoginAt/deletedAt）→revokeAllForPrincipal(id,now,null)→AUDIT `PRODUCTION_ADMIN_RECOVERED`同transaction；detail固定operationId/releaseId/targetId/backupId/reenable。保留全局rolepermissions及全部assignments、其他principal與sessions；新密碼hash不同，舊session revoked後不能用，成功audit恰一筆。hash／任何store／audit／第二assertQuiesced失敗全部rollback，不能因撤session較早就留部分效果。

維護operationId的DB去重只涵蓋仍保留的AUTH審計；既有審計保留工作可能移除舊事件，不能宣稱這是永久去重。正式host guard還必須在首次mutation前持久化reserve該operationId，拒絕重用已完成或結果未知的ID，且不得隨一般audit／backup保留輪替刪除此registry。此去重範圍明確限於該host guard registry仍完整存在的實例世代，不宣稱跨主機損毀永久有效；registry遺失時舊實例維護命令拒絕，不能以空registry續跑。替換主機只准走新的owned target／實例世代與新operationId的受控完整還原，禁止自動重播舊命令或收據；原DB審計仍作另一道拒絕檢查，不當跨災難去重保證。crash或commit結果未知只准inspect，不自動重送；精確registry／共同journal接線歸host adapter卡。

recover非idempotent mutation：每次新人工恢復都有新operationId與audit；同operationId若已有該successaudit即exit3 DUPLICATE_OPERATION、零寫入。duplicatecheck在共同guard內，只比detail的operationId並限定兩maintenanceactions；不用新表／migration。fresh首次audit已有同id亦依NOT_FRESH。兩個相同operationId恢復race最多一次，兩個不同operationId按共同lease排他／DBguard順序，後者是明確第二次恢復，不自動重試。

## 7 PP1a seed分離引用

本波不修改DemoSeedPolicy／SeedService／ContentTypeSeed／DemoContentSeed／ProductionSeedSeparationTests。PP1a候選source：ContentTypeSeed只有 `(ContentStore,DemoSeedPolicy)`；DemoContentSeed只有帶DemoSeedPolicy的五參constructor；不新增一參／四參development bridge。保留12schemas/fields/catalog metadata，只禁用demo navigation／帳號／內容，既有資料不清除。[PP1a §4.2與§5.2](../waves/PP1a.md)是此子集的施工與驗收來源。

## 8 有界卡路由

原六張A01–A06卡由[PP1b §6](../waves/PP1b.md#6-任務卡)的B01–B10／G01–G07取代；不得照舊卡重作PP1a seed或略過local guard。B01先建立command/config/guard/console/service可編譯signatures；B02密碼；B03a context／B03b routing-command兩張串行（原B03group）；B04/B05fresh狀態與fault/race Red；B06/B07兩store Green；B08bootstrap；B09/B10recoverycore；G01–G07獨立local adapter與驗收。每卡含test S≤150/M≤400，超限由root重新拆卡，不減斷言。core fakeguard不得稱host停止驗收。

## 9 fixtures、FM與證據要求

sharedcontract每case新store；JDBC用PostgresFixture.cleanDataSource一次/case，race共用該case DS兩connection，不在race thread再clean。T0=2026-10-01T00:00:00Z；principal.username pp1.root、label PP1 root、email=null；roles系統五code與T0、newUUID只在當case內比較；secret取unit test本機randomchar[]或既有測試properties，文件不列密碼。fresh roleonlyraw列表保持原IDs/T0。recovertarget status/failedCount/lockedUntil/lastLoginAt各明列：active(2,null,T0-1d)、locked(5,T0+15min,T0-1d)、disabled(0,null,T0-1d)，success變active/0/null、lastLoginAt原值。

故障採memory publicwriter override已delegate後throw；JDBC同DS Store subclass override相同publicwriter先super後throw，audit原模式沿用。所有snapshot涵蓋原principals/username索引/credentialhash/roles/grants/assignments/sessionrevokedAt/audit IDs。race CountDownLatch與Future.get(10s)，無sleep。Consolefake提供ownedchar[]並捕stdout/stderr；測missingconsole／confirmmismatch／policyfail／hashfail／guardfail／DBfail最後buffers全0，捕获文字無secret/encodedhash/DBURL。

| FM | 固定結果／namedcase | 卡 |
| --- | --- | --- |
| PP1-FM04 badoptions/secret | exit2，零DB，PP1FM04_optionsAndSecretsAreRejectedWithoutEcho | B01/B03 |
| PP1-FM04 hostguard未配置／仍writer | exit6，無mutation，PP1FM04_guardIsRequiredBeforeAnyMutation；fake只測core，真hostcase留adapter | B01/B03＋root adapter |
| PP1-FM04 maintenance一般scan | 無HTTP/seed/purgejob，PP1AC02_maintenanceContextContainsOnlyExplicitBeans | B01/B03 |
| PP1-FM04 rawdirty/repeat | exit3 NOT_FRESH零改，PP1FM04_rawDeletedDataRejectsFresh／PP1FM04_repeatPreservesEveryObject | B04–B08 |
| PP1-FM04 fresh標準grant／anonymous | PP1AC02_freshCreatesOnlyFormalAdmin／PP1AC02_anonymousRemainsDeniedUntilExplicitGrant | B04–B08 |
| PP1-FM04 concurrent／locktimeout | 一fresh成功／一拒絕、timeout exit4，PP1FM04_concurrentFreshCommitsOnce／PP1FM04_lockTimeoutDoesNotWrite | B04–B08 |
| PP1-FM04 DB/schema/auditfault | exit5、allrollback，PP1FM04_freshFaultsRestoreFullSnapshot／PP1FM04_recoveryFaultsRestoreFullSnapshot | B04–B10 |
| PP1-FM04 recover資格／re-enable | exit3無提權，PP1FM04_recoveryDoesNotPromoteOrRepairGrants／PP1AC02_disabledRecoveryRequiresExplicitFlag | B09/B10 |
| PP1-FM04 recoveryduplicate | exit3 DUPLICATE_OPERATION audit1，PP1FM04_duplicateRecoveryCommitsOnce | B09/B10 |
| PP1-FM04 revoke／lastLogin | 原roles/grants與lastLogin保留，PP1AC02_recoveryRevokesSessionsAtomically／PP1AC02_recoveredIdentitySurvivesRestart | B09/B10 |
| PP1-FM04 prod舊demoactor | 已由PP1a覆蓋；PP1b只引用，無seedfiles變更 | PP1a T03/T04 |

CLI無HTTP401/403/session，不能臆造對應APIcodes；日常Admin權限沿原HTTP contract/IdentityAuth tests。沒有newpublicendpoint/OAS變動。hostguard停止、new-volume所有DB/mediafresh證據、DBidentity binding／postcommit服務復原／RPO/RTO必須root adaptercase，這些沒有已完成覆蓋。


## 10 本地adapter（隨PP1b文件合併生效）

精確CLI外殼：

```text
node scripts/local/maintenance.mjs --run-id <32 lowercase hex> --java-bin <existing JDK25 java> --jar <matching bootJar> -- fresh-init --username <name> --display-name <label> --target-id pp1-local:<runId> --operation-id <UUID> --confirm FRESH_INIT
node scripts/local/maintenance.mjs --run-id <32 lowercase hex> --java-bin <existing JDK25 java> --jar <matching bootJar> -- recover-admin --principal-id <canonical UUID> --target-id pp1-local:<runId> --operation-id <UUID> --confirm RECOVER_ADMIN [--reenable]
```

wrapper順序：parse2→ownedtarget inspect6→確認stdin/stdout/stderr真TTY2→recover PP1c verifier6→commonlock4/reserve→stop/livePRE_CONNECTION→spawnJava；noTTY／缺backup不先停API。wrapper只接受上述三個flags與唯一`--`；末段第一字operation，Java argv自行補maintenance。JDK/node/script/jar來源均由ownedtarget核對，無user任意command／Spring property／password／IP旗標。Java stdin/stdout/stderr inherit真TTY；System.console null仍exit2。

headless沒有ConfigData autoconfiguration，不能假設CMS_SITE_DOMAIN自動變成 `cms.runtime.site-domain`：configuration在StandardEnvironment明設active profile prod，以受控MapPropertySource填 `cms.runtime.production-required/site-domain/api-origin`、`cms.identity.cors-origins/surface-origins/seed-enabled/cookie-secure`、`cms.media.root`、`spring.datasource.url/username/password`，值與owned API設定一致，唯JDBC host為inspect派生privateIP。直接呼叫既有 main `platform/ProductionEnvironmentValidator.postProcessEnvironment`（不改validator），驗完再建DS。IdentityProperties明設相同nonsecret值，Argon2沿existing16384KiB/3iterations；seedPassword不綁、不讀。B03測少任一requiredkey即fail，而非以裸defaultproperties假Green。JDBC pool max1/minIdle0、ApplicationName當次UUID由configuration設定；不接受user額外query參數。

### 10.1 attachment與pool精確次序

command parser先拒不合法args；configuration在DB之前先讀local privateattachment並執行live PRE_CONNECTION停止檢查（完整Docker／0額外PG sessions），才建立pool。DataSourceBuilder只建existing HikariDataSource，maxPoolSize1/minIdle0；用自身connection bind pid/backend_start，完整assert恰一合法backend，再Flyway.validate與explicitbeans。缺attachment或錯target直接exit6、不得開DS。ProductionIdentityService的guard.acquire只attach此lease并再assert，不重新createinstance lock。維護同一pool保持開啟；連線replace立即fail-closed，不重綁。B01在MaintenanceGuard.java內建立ConnectionPhase完整接口與defaultDeny：connectionPhase/acquire都拋固定HOST_GUARD_NOT_CONFIGURED，B03只呼叫interface，**不引用未存在LocalMaintenanceGuard類**。B03 configuration有package-private nested `record Dependencies(Supplier<DataSource> dataSourceFactory,Consumer<DataSource> schemaValidator)`與同package測試overload `open(Options,MaintenanceGuard,Dependencies)`，CLI只用固定production factory，不能由argv選fake；unit MockitoHikariDataSource/Connection＋fakeConnectionPhase/schemaValidator記錄順序，同DSbean/noDS早拒不連Docker。G05才建立LocalMaintenanceGuard scaffold，G06接實作並在command固定localattachment來源選adapter。

`LocalMaintenanceGuard(Path leaseFile,Path nodeBinary,Path guardScript,String targetId,UUID operationId)` implements MaintenanceGuard,ConnectionPhase，connectionPhase()回this；public assertPreConnection()/bindBackend(int,String)/assertBound()/acquire，lease有recordCommitted/close。Path為fixedowned environment來源、realpath/uid/mode/hash核對，不能從任意CLI導入。



新增 `scripts/local/maintenance-target.mjs`（只讀 target inspector）、`maintenance-media-probe.mjs`（只讀 named-volume 空樹探針）、`maintenance-guard.mjs`（lease/quiescence）、`maintenance.mjs`（TTY wrapper），及 main `identity/maintenance/LocalMaintenanceGuard.java`。Java 只執行已核對固定 node binary＋guard script，ProcessBuilder argv list、無 shell；guard 不引入 Docker client到 app、不向 container 掛 docker.sock。本附約與主施工圖合併DOC_READY、PP1a VERIFIED後才可施工；adapter仍須G卡實測。

private writable 範圍：現有 `local/pp1/<runId>/maintenance/` 0700；`target.json`、`operations/<operationId>.json`、`operations/<operationId>.result.json`、`lease.json` 為 owned uid 的 regular file 0600、nlink=1，parent／檔案不得 symlink；exclusive `operation.lock/` 0700。registry 用 O_EXCL reservation，atomic rename 同目錄 update，不寫 media/DB volume。既有 receipt/artifacts/secrets/tls 不覆寫；DS secret 僅從既有 private 0600 file 讀入 child environment。public報告不得放 username/displayName、secret、token、hash。guard metadata version=1；target欄位runId/targetId/project/sourceCommit/apiBuild（三欄sourceCommit/jarSha256/baseImage）/images（三service imageIDs）/containerIds（postgres/cms-api/ingress）/networkIds（web/data）/volumeNames（db-data/media-data）/databaseOid/ingressScriptSha256/nodeBinarySha256/mediaProbeSha256；lease另operationId/operation/releaseId/phase/boundBackend（pid/backendStartEpoch/db/role/clientAddr/applicationName；PRE_CONNECTION時null）/createdAt；journal僅operationId/operation/targetId/releaseId/phase/at/failureCode；Result沿§4。各schema所有欄位必需、unknown key拒絕，phase只有RESERVED/PRE_CONNECTION/BOUND/COMMITTED/COMPLETE/FAILED_OR_UNKNOWN；initialtarget建立後不重bind artifact或generation。releaseId=`sha256:<jarSha256>`。private journal 不作公開 telemetry。

acquire流程：

1. reject 非 local-isolated PP1a receipt；校驗三份 API provenance label、local matching jar SHA-256、ingress/node/dist hashes、fixed Docker socket/context、完整 project container tuple。先建立 exclusive shared instance lock；在停止或 Java之前 O_EXCL reserve operationId。此 lock 後續 PP1c backup/restore/upgrade也必須沿用，不能各用不同鎖。
2. `docker inspect` 每次重讀 PostgreSQL containerID/ImageID/project/service labels、networkID/private IPv4、db/media volumeID與完整mounts/aliases。`PortBindings={}` 且 NetworkMode 非 host、無任何 DB ports。固定 DB= cms／user= cms_local（PP1a actual設定），URL僅由已核對 private bridge IP 派生；不沿用歷史 IP、hostname猜測或 receipt IP 當證明。PP1a已有host bridge可達的可行性觀察；本adapter尚未執行，G卡逐次inspect與真連線驗收。
3. 只對 own API containerID 停止 `docker stop --time 30 <exact ID>`；預先確認 RestartPolicy=no，停止後 `.State.Running=false`。scheduler在這 API process；ingress可保留，API upstream 維護期間502不作 health通過。不得 stop project filter擴散／kill arbitrary PID／清除容器或volume。
4. 枚舉**全部** containers（含 stopped）再 inspect：任何非白名單 container 加入 target network 或 mount target DB/media volumes即 exit6；owned API 必須保持 stopped且restart=no。未知mount/network tuple、container重建／IP換掉／多alias、inspect錯誤均拒絕。不能只查 receipt3筆。
5. guard在DB之前的PRE_CONNECTION階段須觀察client backends為0（排除fixed psql自身）。Java attachment/live停止檢查通過才建立**唯一Hikari pool max1/minIdle0**。用自身pool connection讀 `pg_backend_pid()` 與pg_stat_activity.backend_start，以 `LocalMaintenanceGuard.bindBackend(int pid, String backendStartEpoch)` 綁private lease；bind helper核對pid/start/db=cms/role=cms_local/client_addr=當次network gateway/application_name=當次UUID，且沒有任何額外backend。完整assert只允許這一個exact backend tuple；0個、replacement、新PID、同名額外1個也exit6，不自动重綁。binding在schema validate之前，validate及交易共用same pool並持有其lifecycle。外部psql每次查全database包括idle，排除自身pg_backend_pid，不能用appname/count≤2冒充身份。
6. fresh額外檢查§4完整 DB raw empty＋media檔案樹空；fixed mounts來源與volume ID匹配才可枚舉。不要假設非root host可讀 `/var/lib/docker/volumes`：host Docker啟一個本次operation標記的拋棄式 probe，使用receipt已核對Node image＋readonly verifiedNode binary/script，`--network none --read-only --cap-drop ALL --security-opt no-new-privileges`，只將**exact owned media volume** readonly掛 `/media`。probe只lstat/readdir，任何檔案／symlink／讀取失敗即拒絕，允許空directory；固定30s期限、輸出只有EMPTY／NOT_EMPTY，退出移除exact本次probe ID。此sole probe是額外明確白名單，必須label/runId/operation/image/no-network/ROmount全部相符；其他ROmount也不默認授權。新probe-script SHA綁target metadata，每次使用前重驗；不更動既有artifacts/receipt。沒有 media根強制刪除／mkdir新資料夾來讓空判斷過。正常 schema catalog/settings 可保留。Java `LocalMaintenanceGuard.acquire` 僅 attach 到 wrapper已持有、target/op完全相同的private lease，且呼叫live assert helper；file只能授權追蹤，**不能代替Docker/PG/disk重验**。每次 assert 重做2–5，fresh precommit不再查identity empty（當次tx已寫），只保持quiescence与target。
7. Java lease close做最後live assert并detach；service在maintenanceTransaction返回（已commit）後呼叫lease.recordCommitted(Result)，localguard以wx/atomicrename寫當次operations/<operationId>.result.json（Result欄位），然後close；command只在service回傳後stdout/exit。receipt寫/close失敗已commit→COMMITTED_HOST_RESTORE_FAILED exit5留停止、不能重跑。Result.completedAt以Instant.toString寫wire string，operation enum.name與UUID.toString，固定Map序列化，不依賴裸ObjectMapper自動序列化JavaTime。wrapper讀regular0600 result並比對target/release/operationId/mode：有效receipt存在即journal COMMITTED，無receipt且非0則FAILED_OR_UNKNOWN，不能從exit5猜已rollback；僅exit0與有效commitreceipt再對同一API ID／同版image/原prod env `docker start <ID>`，有界30s health检查，完成写 COMPLETE且release lock。restart/close failure：COMMITTED_HOST_RESTORE_FAILED exit5、保留COMMITTED和維護lock，不自動重做。非0／signal／crash依有效receipt存在保留COMMITTED或FAILED_OR_UNKNOWN與lock、writer保持停止；只提供 readonly `inspect --run-id`，不提供force-unlock／TTL cleanup／自動resume。

```sql
SELECT pid, extract(epoch FROM backend_start)::text AS backend_start_epoch,
       usename, datname, application_name, host(client_addr) AS client_addr, state
FROM pg_stat_activity
WHERE datname = current_database()
  AND backend_type = 'client backend'
  AND pid <> pg_backend_pid();
SELECT oid FROM pg_database WHERE datname = current_database();
-- Java唯一pool在bind時讀自己的backend；pid綁定值不接受caller猜測
SELECT pid, extract(epoch FROM backend_start)::text AS backend_start_epoch
FROM pg_stat_activity WHERE pid = pg_backend_pid();
```

此 local lease 針對單 owner owned project、合作操作遵守共用lock。不能宣稱能阻止具 Docker/root/DB credential 權限的不合作 host 程式在 assert 後再寫；advisory lock也不是全DB freeze。未知writer或target漂移一律拒絕；不改私網可達、PG ACL、host網路或TLS驗證來繞過拒絕。G03/G04 必須用額外連線與重啟writer實測負向 cases；adapter未完成不能把 interface/mock當runtime成功。

PP1b host recover一律先要求 matching nonempty verified rollback bundle，由 **尚未實作的PP1c verifier** 綁定target/schema/jar/DB+media完整集合。PP1b `recover-admin` 在 verifier absent／receipt-only／backup mismatch時 exit6 RECOVERY_BACKUP_REQUIRED、零Java mutation。不新做mini backup、不只查一個backupId檔案。core recovery tests的fake verified guard明示只是store contract。operationId registry永久保留到該instance退出；遺失registry／UNKNOWN不得自動補或重跑。DB成功audit duplicate檢查在現有retention範圍內，host registry承擔跨retention防重；兩者不是冪等重試機制。


### 10.2 local狀態驗證

fresh允許12type codes album/photo/page/clinic_profile/owner/pet/vet/visit/project/issue/milestone/appointment_request；同版10Flyway（8SQL＋JavaV7/V10）成功、fields/catalog保留，audit/media settings singleton允許。固定raw內容SQL如下，guard只在mutation前查empty；precommit只assert停止與samebackend，不對當次已寫identity再判empty。

```sql
SELECT EXISTS(SELECT 1 FROM cms_entry)
 OR EXISTS(SELECT 1 FROM cms_entry_revision)
 OR EXISTS(SELECT 1 FROM cms_entry_ref)
 OR EXISTS(SELECT 1 FROM cms_entry_index)
 OR EXISTS(SELECT 1 FROM cms_navigation_menu)
 OR EXISTS(SELECT 1 FROM cms_media)
 OR EXISTS(SELECT 1 FROM cms_media_variant)
 OR EXISTS(SELECT 1 FROM cms_media_attachment);
```

`verify-accounts.mjs --run-root <owned root> --stage initialized --operation-id <UUID>`只在bootstrap後、登入前驗：principal1/credential1/adminassignment1/adminpermission13/audit1/session0、其他rolesgrants0、所有內容/media/navigation0、12types/5roles/10migrations；核對successaudit operation/release/target graph。既有PP1a verify.mjs的freshzero不得放寬；登入/operator配置後由journey關係與allowlist斷言，不用初始化count。verifyAccounts exports `parseArgs(argv)`、`verifyAccounts(runRoot,operationId,deps)`，unknown/stage錯/uuid錯非0固定PP1_ACCOUNT_VERIFICATION_FAILED，不輸出DBrow/secret。

node模組公开export固定：target `inspectTarget(runRoot,deps,{apiState:"running"|"stopped"})`；guard `acquire(target,operation,deps)`、`assertQuiesced(lease,deps)`、`bindBackend(lease,pid,backendStartEpoch,deps)`、`finish(lease,exitCode,deps)`；wrapper `parseArgs(argv)`、`run(options,deps)`；media probe `isEmpty(root)`，CLI只固定`/media`。deps仅tests注入exec/read/clock，CLI沒有動態command字串入口。guard helper CLI `assert --run-id <id> --operation-id <uuid> --phase pre-connection|bound`、`bind-backend --run-id <id> --operation-id <uuid> --pid <int> --backend-start-epoch <decimal text>`、`inspect --run-id <id>`；flags唯一、unknown拒、bind僅允許一次PRE_CONNECTION→BOUND。runRoot固定component的local/pp1/id，不接受任意path寫入。


### 10.3 backend序列化與官方查證

backend pin的Java/String、Node/JSON與fixedpsql都使用上列**同SQL** `extract(epoch FROM backend_start)::text`，欄位名backend_start_epoch／metadata backendStartEpoch；逐字保存／比較，不轉Instant、Timestamp、JS Number或ISO，不去尾零／時區轉換。pid為int>0；epoch為非null非空十進制text，match `^[1-9][0-9]*\\.[0-9]+$`；完整tuple每欄必存在，null/0/missing拒絕。只有首次PRE_CONNECTION→BOUND可bind，此後不同pid/epoch或0合法backend皆exit6。schema validate與交易必同pool，不能close pool後重新validate。

client_addr使用`host(client_addr)`去netmask，null拒絕；必canonical RFC1918 IPv4（四decimal octets0–255、無leadingzeros，10/8或172.16/12或192.168/16），再與currentinspectGateway逐字相等。不能用client_addr::text直接比裸IP、不可strip arbitrarysuffix來放行。

查閱2026-10-09：[PostgreSQL16 Network functions](https://www.postgresql.org/docs/16/functions-net.html)確認host(inet)只取地址、text(inet)包含netmask；[Date/time EXTRACT](https://www.postgresql.org/docs/16/functions-datetime.html#FUNCTIONS-DATETIME-EXTRACT)確認epoch的numeric意義。這是source查證，不是adapter/JDBC實跑通過證據。


### 10.4 CLI固定failure枚舉

Command nested FailureCode只包含：INPUT_INVALID=2、SECRET_INPUT_INVALID=2、NOT_FRESH=3、TARGET_NOT_ADMIN=3、TARGET_DISABLED=3、ADMIN_GRANTS_DAMAGED=3、DUPLICATE_OPERATION=3、MAINTENANCE_BUSY=4、MAINTENANCE_INTERNAL_ERROR=5、COMMITTED_HOST_RESTORE_FAILED=5、HOST_GUARD_NOT_CONFIGURED=6、QUIESCENCE_NOT_PROVEN=6、RECOVERY_BACKUP_REQUIRED=6；enum有`exitCode():int`。parser/flag/UUID/profile錯INPUT_INVALID；noConsole/mismatch/passwordpolicy錯SECRET_INPUT_INVALID；missing/deleted/nonadmin target同TARGET_NOT_ADMIN；commonleasebusy/55P03同MAINTENANCE_BUSY；schema/hash/DB/未知錯只MAINTENANCE_INTERNAL_ERROR，不揭例外原文。commit後已知result的close/restartfault用COMMITTED_HOST_RESTORE_FAILED。Nodewrapper沿相同碼／exit，helper錯只QUIESCENCE_NOT_PROVEN，讀metadata錯不印來源內容。


### 10.5 分階段測試与receipt順序

B04/B05 runner內新增named primitive tests `PP1FM04_primitiveRawChecksDeleted`、`PP1FM04_primitiveOperationLookupIsComplete`、`PP1FM04_primitiveTransactionRollsBack`、`PP1FM04_primitiveGuardSerializesOrTimesOut`；它們直接操作store primitive、不呼叫尚未Green的fresh/recover service。B06/B07只跑runner.PP1FM04_primitive*＋既有storecontract；B08必跑全freshsharedcontract，B10全fresh/recoverysharedcontract，不以filter永久省scope。service fakelease.recordCommitted捕捉呼叫時storetransaction已退出且audit完成，leaseclose前receipt；PG用新connectionreadback確認已commit。receiptfault已commit不得回滾或retry，wrapper有有效receipt→COMMITTED，無→FAILED_OR_UNKNOWN；所有非0保持停止/lock，不auto replay。


## 11 殘餘正式環境依賴與root整合

local工具/lease/freshness/TTY/secret來源已由§10與PP1b G/E卡固定，正式host問題不阻本地子波；localadapter仍須真實G卡驗證，不能以interface或receipt代替。正式OS/service manager、writer/schedulerinventory／restart抑制、正式artifact與secret取得、matchingtarget/backup/upgrade共同lease仍待正式adapter查验。恢復成功依PP1c完整verified DB+media rollback bundle與restore演練；本波hostrecover只有缺bundleexit6，不造mini backup。owner首批真publictypes未選，初始化anonymous空集合安全、page僅localfixture。正式RPO/RTO、offsite、pruning/upgrade/ops不由本波測試代替；未完成層級明列主PP1帳本，由root續作。

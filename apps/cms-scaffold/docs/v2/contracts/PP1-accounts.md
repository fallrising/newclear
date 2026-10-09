# PP1 帳號維護與 demo seed 分離契約草稿

日期2026-10-09；配合[PP1施工圖](../waves/PP1.md)。狀態 **DRAFT，未 DOC_READY、未實作**。本文关闭與主機無關的選擇；正式維護命令的停止／排程／跨操作互斥 adapter 未查驗，該接線在 adapter 實測且 PP1 正常文件合併前不可施工。所有未來命令與測試均為規格，沒有執行成功主張。

Seed分離已移至[PP1a](../waves/PP1a.md)先行實作；本附約A01/A02的seed路徑與測試只引用PP1a，不重作。PP1b freshness允許同版Flyway、既有12catalog/fields與標準roles；identity歷史、內容entries、media、navigation仍須空。主機guard的正式環境待答不阻本地guard細化，但本附約整體仍DRAFT。

## 1 範圍與已批准邊界

Owner 2026-10-09批准全新DB、不帶demo帳號／內容、獨立日常operator、同HTTPS site不同origins、每日停寫備份RPO24h/RTO4h、daily7＋weekly4。實際host／工具／URL／離機位置／通知／每日窗口／首批公開types仍未知。此子集對應PP1-AC02、PP1-FM04；Q25另沿PP1-governance，不在本子集重作。

固定選擇：一位正式admin由fresh-init建立；日常operator由正式Admin API建立與明列權限；anonymous grants初始化為空。既有12個pack schema保留，無新模型；demo navigation與schema分開gate。cli不提供--public-type、任意提升帳號、全角色覆寫或無認證HTTP入口。無新的migration、依賴、部署、秘密寫檔、資料清理。備份保留僅選定完整可恢復集合；automatic pruning／實際刪除不在本次。

## 2 來源與既有可沿用契約

以下全部相對component `apps/cms-scaffold`，main前綴=`services/cms-api/src/main/java/com/fallrising/cms/`，test=`services/cms-api/src/test/java/com/fallrising/cms/`，it=`services/cms-api/src/integrationTest/java/com/fallrising/cms/`。來源HEAD `216643eb3f566b82b4747256034e94eb1844ebc4`；已核對main `a6ea2af92469ae82091dde394c8d62e2227128a1` 的CMS無增量。

| 來源 | 事實與設計限制 |
| --- | --- |
| main `CmsApiApplication.java:6–10` | 普通main直接完整component scan；不能只加web=NONE便稱沒有demo listener。需要先分流到獨立configuration，不能把maintenance configuration掃進普通app。 |
| `services/cms-api/build.gradle.kts:46–63` | JDBC／Flyway／PostgreSQL／Spring test與Testcontainers已存在；沒有CLI parser新依賴需要。 |
| main `identity/web/IdentityStoreConfig.java:18–23` | 沒DS/TM會fallback memory；正式maintenance必須拒絕這種fallback，不能使用此factory作headless正式wiring。 |
| main `identity/service/SeedService.java:66–85,88–140,174–194` | seed=false只五角色；seed=true建立九demo帳號與grants，既有帳號whole-replace assignment；不是正式bootstrap。 |
| main `content/service/ContentTypeSeed.java:25–40,130–152,167–226` | 12 schemas＋fields＋metadata與markMediaRefsPublic；末段另外seed draft front.primary demo navigation。原本未看identity seed flag。 |
| main `content/service/DemoContentSeed.java:27–60` | Order200檢查seed-operator-album而非seed flag；旧seed actor在prod仍可能寫demo內容。 |
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
| main `CmsApiApplication.java` | 修改；argv首字maintenance才分流，不進普通scan | A02 |
| main `identity/maintenance/IdentityMaintenanceCommand.java` | 新增；解析／exit／context lifecycle／receipt；內含nested Options、Result、FailureCode | A01/A02/A06 |
| main `identity/maintenance/IdentityMaintenanceConfiguration.java` | 新增；普通类，無@Configuration／@Component／scan；由maintenance runner明確register beans | A01/A02 |
| main `identity/maintenance/MaintenanceGuard.java` | 新增；host lease interface；預設拒絕adapter；無主機操作實作 | A01/A02 |
| main `identity/maintenance/ConsoleSecretInput.java` | 新增；Console密碼兩次輸入與清除；tests注入fake | A01/A02 |
| main `identity/crypto/PasswordPolicy.java` | 新增；CharSequence純驗證，原Auth規則不變 | A01/A02 |
| main `identity/crypto/PasswordHasher.java` | 修改；新增hash(char[])接受owned buffer，保留舊hash(String)；不保證encoder無String副本 | A02 |
| main `identity/service/AuthService.java` | 修改；validateNewPassword委派PasswordPolicy，保持原HTTP結果 | A02 |
| main `identity/service/DemoSeedPolicy.java` | 新增；Environment＋IdentityProperties，production或seed=false均不啟用demo | A01/A02 |
| main `identity/service/SeedService.java` | 修改；以policy判demo，disabled仍只ensureRoles | A02 |
| main `content/service/ContentTypeSeed.java` | 修改；schema不變，只有navigation由policy控制 | A02 |
| main `content/service/DemoContentSeed.java` | 修改；seed最前policy gate，不能查sentinel才決定 | A02 |
| main `identity/store/IdentityStore.java`、`JdbcIdentityStore.java`、`InMemoryIdentityStore.java` | 修改；raw-state＋maintenance guarded transaction | A03/A04 |
| main `identity/maintenance/ProductionIdentityService.java` | 新增；A01先只有constructor／public signatures throw scaffold供CLI編譯；freshInit／recoverAdmin、固定grant矩陣、原子receipt | A01/A02/A03/A04/A06 |
| test `identity/maintenance/IdentityMaintenanceCommandTests.java` | 新增；parser、秘密與hostguard拒絕、context wiring | A01/A02/A06 |
| test `identity/maintenance/ProductionSeedSeparationTests.java` | 新增；prod舊seedactor零demo寫入＋dev回歸 | A01/A02 |
| test `contract/IdentityMaintenanceContract.java`、`InMemoryIdentityMaintenanceContractTests.java` | 新增；fresh/recovery相同state契約、memory fault/race | A03/A05 |
| it `contract/JdbcIdentityMaintenanceContractTests.java` | 新增；相同契約PG adapter、rollback/race | A03/A05 |
| it `contract/ProductionIdentityIntegrationTests.java` | 新增；真hash/login/admin grant／recovery重啟回讀 | A03/A05 |

本帳號子集無package/build/lock/workflow/resource/migration修改。maintenance configuration使用已有classpath，source/artifact名稱不分第二個jar；本帳號子集不新增第二main。恢復附約可另有RecoveryInventoryMain入口並在其scope明釘springBoot.mainClass=CmsApiApplication及獨立JavaExec，不能把此局部選擇當整波限制。hostguard實作逐檔scope在PD01/03/04封板後另卡，不藏在上述六卡。

## 4 命令、型別、輸入與退出

```text
java -jar <matching-app.jar> maintenance fresh-init --username <name> --display-name <label>
  --target-id <opaque-config-id> --operation-id <UUID> --confirm FRESH_INIT
java -jar <matching-app.jar> maintenance recover-admin --principal-id <canonical UUID>
  --target-id <opaque-config-id> --operation-id <UUID> --confirm RECOVER_ADMIN [--reenable]
```

命令參數只有非secret，正式username/displayName僅private操作紀錄，不進公開示例。各flag恰一次；未知／重複／缺值／flag不適用當前operation回exit2；username正規化lowerCase(ROOT)後沿`^[a-z0-9._-]{3,32}$`，禁止`seed-`前綴；displayName非空且Unicode codepoints≤80。target-id非空、operation-id canonical UUID；confirmation逐字，無trim。recover UUID不可從username猜。無--password、任意Spring --property、--public-type、--repair-role選項；不把CLIargs加入Spring Environment。普通server若任何位置出现maintenance而非argv[0]也拒絕，不誤啟server。所有退出先closecontext/lease、清password char[]。

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

`ConsoleSecretInput.readAndConfirm(String username): char[]`：System.console()==null即exit2，不fallback echoed stdin／環境密碼／input file。readPassword兩次，逐字相同，PasswordPolicy驗證，錯誤立即擦兩buffer；返回owned第一buffer，第二bufferfinally擦。CLI将成功buffer在所有退出finally Arrays.fill，hash overload用CharBuffer傳入既有encoder，但不聲稱因此避免password String：encoder/provider可建立不可擦除的內部副本。測試只保證本程式不把raw secret寫入log／record／exception與清除app-owned buffers；沒有零副本或完整記憶體擦除保證。

`PasswordPolicy.validate(CharSequence username, CharSequence password): void`（username可null）：保留原UTF-16 length≥12及username case-insensitive不相等的規則，抛原IdentityException.validation。由AuthService現有String函式委派，CLI用CharBuffer。`PasswordHasher.hash(char[] raw): String`用existingencoder.encode(CharBuffer.wrap(raw))，結果只在credential儲存，不出receipt。

### 4.1 真正停止保證與host adapter邊界

```java
public interface MaintenanceGuard {
  Lease acquire(String targetId, UUID operationId, IdentityMaintenanceCommand.Operation operation);
  interface Lease extends AutoCloseable {
    String targetId(); String releaseId(); String backupId();
    void assertQuiesced();
    @Override void close();
  }
}
```

預設guard的acquire永遠拋固定HOST_GUARD_NOT_CONFIGURED（exit6）。headlessconfiguration不得讀receipt就當已quiesced。正式adapter須持有與backup/upgrade/recovery共用的host互斥lease，實測API、scheduler與所有可寫DB/media程序已停止、其DBsessions结束、auto-restart不會重新起writer，並反覆assertQuiesced直到DBcommit。lease target/release須与所選DBconnection及matching artifact绑定，host上的原狀態復原／失敗留維護狀態由adapter負責。fresh-init要求owned新DB/media及完整已migration schema驗證；recovery additionally需要非空verified可恢復backupId。外層receipt提供追溯，不是停止證明。

本interface關閉core呼叫形狀，沒有聲稱可用production adapter。host/tool unknown不能先安裝flock/systemd/Compose或靠PID猜無writer；實測adapter未封板時這整條正式維護接線不可施工。

### 4.2 獨立context與schema

`IdentityMaintenanceConfiguration.open(): ConfigurableApplicationContext`使用AnnotationConfigApplicationContext明確registerBean：DataSource、PlatformTransactionManager/TransactionTemplate、JdbcIdentityStore、TransactionRunner、IdentityProperties、PasswordHasher、ObjectMapper、AuditLog、ProductionIdentityService、MaintenanceGuard。它是無annotation普通class，不被CmsApiApplication scan發現；不使用普通SpringApplication的autoconfiguration/component scan。open的exact framework wiring／DataSource shutdown與schema-validation fixture仍需root独立審查，本文不把未編譯API簽名當已驗證實作。

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

`hasMaintenanceOperation`在共同guard持有的transaction內呼叫；不靠listAudit/page size。memory在同monitor遍歷完整audits，category/action同SQL，detailJson以Jackson readTree取文字operationId比較canonicalUUID；null detail跳過，malformed detail拋固定內部失敗，不記secret。此方法declaration在A03、實現在A06；A05使用它製造compile-ready意圖Red，A04不需要呼叫未實作方法。JDBC/memory duplicatecase皆包含operationId存在於不同target的既有successaudit、相同target、其他action同id不算duplicate，不能只查正在recover的target。

hasIdentityData不靠listPrincipals，softdeleted也拒絕。角色單獨允許空表或五標準system-role subset，非標準code／system=false即NOT_FRESH；既有角色IDs/displayNames/createdAt保留，其餘補齊與原seed相同五role名稱。audit/media/settings singleton與content catalog既有初始化不當身份業務資料；空content/media／導航、schema/disk新目標由freshhostguard驗證，core身份rawcheck不冒充完整DB/磁碟fresh證明。

`ProductionIdentityService` ctor `(IdentityStore store, PasswordHasher hasher, TransactionRunner transactions, AuditLog audit, MaintenanceGuard guard)`。公開：`Result freshInit(Options options, char[] password)`、`Result recoverAdmin(Options options, char[] password)`。固定順序：驗Options/password→hash（無DBsideeffect）→guard.acquire→assertQuiesced→`store.maintenanceTransaction`→rawstate／target重讀→所有寫入＋audit→再次lease.assertQuiesced→commit→回Result；try/finally關lease。receipt必須於commit之後才輸出；leaseclose失敗若DB已commit需report固定COMMITTED_HOST_RESTORE_FAILED與operationId（exit5），不可重試mutation或說rollback。

maintenanceTransaction JDBC用既有同DS tx，先`SET LOCAL lock_timeout='5s'`，`SELECT pg_advisory_xact_lock(?)`綁同ADMIN_GUARD_KEY，attempt/reads/writes在同tx；SQLSTATE55P03映exit4，其餘5。不得在lock外檢查fresh，再用upsert。兩個fresh命令即使hostadapter fake允許都最多一個commit；第二取得鎖後NOT_FRESH。production hostguard應先拒第二writer，DBguard是第二道資料保護。

memory使用同adminGuard監視器，snapshot principals、usernameIndex、credentials、roles、principalRoles、permissions、兩session maps與audits（lists deep-copy），同步attempt；RuntimeException或Error時直接restore私有maps/list原presence/物件，不能透過fault-injected public writer還原。hasIdentityData讀rawmaps含deleted。這只是maintenance範圍原子性，不更改一般memory store交易宣告。普通source變更writer需遵守已停止host保證；不聲稱這monitor/advisory已阻止未合作SQL。

固定fresh寫入：補角色→admin grants→一位active principal（email=null、failed=0、lockedUntil/lastLoginAt/deletedAt=null）→password credential argon2id→admin assignment contentTypeCodes=[]→successaudit。admin13動作沿SeedService既有矩陣：read_published allowedSurfaces=[front,back,admin]；manage_types/manage_principals/manage_settings/read_audit=[admin]；read_draft/create/update/publish/unpublish/delete/archive/manage_media=[back,admin]。所有type/predicate=null。admin標準治理身份保持既有語義；anonymous/member/editor/operator grants全部[]，不替operator建wildcardgrant。建完countUsableAdmins()==1，否則rollback。

Audit `category=AUTH, action=PRODUCTION_ADMIN_INITIALIZED, actor=null, targetType=principal, targetId=<new>, surface=admin, outcome=ok`，detail僅operationId/releaseId/targetId（opaque)/mode=FRESH_INIT。row與帳號同tx，沒有密碼／hash／displayName／permission原文；拒絕fresh不寫DBaudit，stderr固定code作操作拒絕receipt。任一寫入或audit失敗rollback；原roles／IDs仍完整保留。重跑即非零NOT_FRESH，不重置credential、不產生第二audit；與上次同operationId亦不把拒絕改成功。

### 5.1 日常operator與公開讀取

初始化無日常operator，正式admin正常登入後使用既有POST principals＋PUT roles＋PUT operator permissions配置。API會回temporaryPassword一次；由受保護操作取得／交付，不進chat/report；日常與admin username不同、無seed-前綴。

固定最小operatormatrix：每個**明列首批日常type**八個type actions（read_published/read_draft/create/update/publish/unpublish/delete/archive），無predicate；read_published surfaces=[front,back,admin]、其餘[back,admin]；global manage_media type=null，[back,admin]恰一列。assignment的contentTypeCodes是同一明列清單；無manage_*治理/read_audit、无未来type自動擴展；appointment_request不在第一批允許list，若投入仍要完整Q26/BQ14。這不是新增role或回寫通配舊operatorseed。

anonymous公開清單預設空；每個明列publictype配置read_published,type=該code,predicate=null,surfaces=[front]，沒有wildcard。先建立首批catalogtype，再以正式Admin配置permissions，不用bootstrap猜types。operator grant為global role的明確替換，僅在fresh角色空列表且owner首批清單已給定的配置步驟執行；不是每次ready重置。不清空既有客製庫。安全初始化可通過且anonymous403；公開旅程必須有實際type清單，不能用沒有publicgrant的新庫說完整旅程通過。

## 6 recover-admin確定政策

只接受已有nondeleted target UUID且真assignment roleCode=admin；role存在但target沒admin仍TARGET_NOT_ADMIN。adminrole必須已有action=manage_principals、allowedSurfaces含admin的grant（沿usable定義）；不符合ADMIN_GRANTS_DAMAGED，原資料不改。不提供role-repair、創建替代admin或任意提升普通帳號；此狀態走受控已驗證備份還原，沒有可用集合則停止並由root列外部阻擋，不能現場SQL或seed救援。

active／locked可恢復；disabled僅有explicit --reenable才可恢復，無flag TARGET_DISABLED；--reenable对active/locked是允许但detail記requested=true，不授其他權限。缺credential可為已有admin補password credential；其它非passwordcredentialschema不允许。target在共同guard內重讀，所有資格與state檢查先於第一write。

寫入：password credential→current.withLock(0,null,ACTIVE,now)（保留username/displayName/email/createdAt/lastLoginAt/deletedAt）→revokeAllForPrincipal(id,now,null)→AUDIT `PRODUCTION_ADMIN_RECOVERED`同transaction；detail固定operationId/releaseId/targetId/backupId/reenable。保留全局rolepermissions及全部assignments、其他principal與sessions；新密碼hash不同，舊session revoked後不能用，成功audit恰一筆。hash／任何store／audit／第二assertQuiesced失敗全部rollback，不能因撤session較早就留部分效果。

維護operationId的DB去重只涵蓋仍保留的AUTH審計；既有審計保留工作可能移除舊事件，不能宣稱這是永久去重。正式host guard還必須在首次mutation前持久化reserve該operationId，拒絕重用已完成或結果未知的ID，且不得隨一般audit／backup保留輪替刪除此registry。此去重範圍明確限於該host guard registry仍完整存在的實例世代，不宣稱跨主機損毀永久有效；registry遺失時舊實例維護命令拒絕，不能以空registry續跑。替換主機只准走新的owned target／實例世代與新operationId的受控完整還原，禁止自動重播舊命令或收據；原DB審計仍作另一道拒絕檢查，不當跨災難去重保證。crash或commit結果未知只准inspect，不自動重送；精確registry／共同journal接線歸host adapter卡。

recover非idempotent mutation：每次新人工恢復都有新operationId與audit；同operationId若已有該successaudit即exit3 DUPLICATE_OPERATION、零寫入。duplicatecheck在共同guard內，只比detail的operationId並限定兩maintenanceactions；不用新表／migration。fresh首次audit已有同id亦依NOT_FRESH。兩個相同operationId恢復race最多一次，兩個不同operationId按共同lease排他／DBguard順序，後者是明確第二次恢復，不自動重試。

## 7 demo分離固定規格

`DemoSeedPolicy(Environment env, IdentityProperties properties)`；`boolean enabled()`返回 `!Arrays.asList(env.getActiveProfiles()).contains("prod") && properties.isSeedEnabled()`。不增加新properties。normalprod seed=false仍只補systemroles；即使误設seed=true也沒有demo資料補建，runtime別卡仍應在HTTP前拒絕錯誤配置。不擅自停用／刪除試用庫既有demoactors。

SeedService保持Order0與development既有password/permission/seedUser規則；policy=false執行ensureRoles後return。DemoContentSeed保持Order200，方法第一步policy=false立即return，不能先查seedactor／sentinel，不授臨時權限、不寫media/entry。ContentTypeSeed保持Order100、原12schemas/fields/metadata/markMediaRefsPublic；只有來源137–152的draft demo導航塊包在policy.enabled()內。既有draft/published navigation一律不刪不改。這是分離既有示範導航，非要求建立新導航UI／新產品功能。

ContentTypeSeed舊一參constructor與DemoContentSeed舊四參constructor保留供既有directnew測試，委派新增注入DemoSeedPolicy的@Autowired constructor；舊ctor使用明示development測試policy，不由Spring選用。normalprod context test驗實際@Autowired ctor的policy。MaintenanceConfiguration完全不register三seed類，不能靠policy暫時false當listener未載入。

## 8 六張有界卡（與PP1 root編號分離，root再映射）

每卡S≤150/M≤400；以下手寫大小是設計估算，非實測diff。若實作前或duringdiff超400，停止並報root重新拆卡；六張上限不能用縮掉測試／generic巨大fixture藏差異。卡A01/A03需要compile-only公開signature scaffold，紅燈必須是指定行為assertion／UnsupportedOperationException，不能把缺class編譯錯誤當Red。

### PP1-A01 CLI／秘密／seed隔離Red

- **目標**：證明prod旧seedactors仍寫demo與CLIparser／hostguard／秘密輸入尚無行為。
- **輸入**：§3/4/7、舊SeedService/ContentTypeSeed/DemoContentSeed；本卡建立必要command/policy/guard/console/passwordpolicy及ProductionIdentityService constructor/freshInit/recoverAdmin signatures供編譯，只有throw scaffold，不先做Green。A02可用mock該service且不先要求A03。
- **步驟**：①新增CommandTests parser/console假源/ownedbuffer clear與normalapp分流契約；②新增ProductionSeedSeparationTests新freshprod與有seed-operator-album且sentinel缺失，真inmemorycontent/media tempfile，assert無principal/grant/entry/media/navigation新增但12schemas存在；③devseed=true保留現有demo旅程、seed=false零demo導航／內容；④先保存舊prod DemoContentSeed進入EntryService的Red（spy verifies invocation），不是假DB錯誤。
- **完成條件**：ProdSeedDisabledNeverWritesExistingDemoActors或ProdDoesNotCreateDemoNavigation意圖失敗；parser unsupported scaffold分類記錄；所有原test保留。
- **驗證**：`./gradlew test --tests '*IdentityMaintenanceCommandTests' --tests '*ProductionSeedSeparationTests' --no-daemon --no-parallel`
- **對應ID**：PP1-AC02／PP1-FM04。
- **預估大小**：M，360行，含test/compile-only declarations；若源fixture需更大報拆。

### PP1-A02 CLI／秘密／seed隔離Green

- **目標**：固定headlesswiring、defaultguard拒絕與prodseed分離，不啟用host操作。
- **輸入**：A01；§3/4/7。
- **步驟**：①完成parser/console/char[]hash/policy與Auth委派；②CmsApiApplication先maintenance分流；③明確register無scancontext、schema validate-only、sameDS/JDBC與defaultguard拒絕；④接三seedpolicy與navigationgate；⑤CommandTests用注入fake service/guard檢查路由，productiondefaultguard exit6，不直接呼叫尚未實作fresh/recover來假Green。
- **完成條件**：A01轉綠、普通IdentityAuth／ContentTypeSeed回歸綠；maintenancebeanabsence完整斷言；無seed或listener sideeffects。
- **驗證**：`./gradlew test --tests '*IdentityMaintenanceCommandTests' --tests '*ProductionSeedSeparationTests' --tests '*IdentityAuthTests' --tests '*IdentitySeedPasswordTests' --tests '*ContentTypeSeedTests' --no-daemon --no-parallel`
- **對應ID**：PP1-AC02／PP1-FM04。
- **預估大小**：M，390行source＋test修正；defaultguard留拒絕不是全PP1驗收完成。

### PP1-A03 fresh／store Red

- **目標**：空庫、rawdeleted拒絕、rolesonly、race及fault先有相同memory/JDBC失敗契約。
- **輸入**：A02；沿用A01 Service scaffold並新增三個store methods signature scaffolds；§5。
- **步驟**：①新sharedcontract八freshnamedcases與memory/JDBCrunner；②rolesonly fixture用原systemroles、固定T0，freshidentities[]；③softdeletedprincipal／已有grant/credential/assignment/session/audit任一拒絕且快照原樣；④fault在credential、assignment、audit「已寫後」throw，snapshot比IDs/state/hash/audit不只count；⑤race兩thread兩connectionlatch、10s有界；⑥integration真Argon2 login/admin require與匿名無grant403。
- **完成條件**：PP1AC02_freshCreatesOnlyFormalAdmin與PP1FM04_rawDeletedDataRejectsFresh意圖Red；noDocker regular test仍可跑；JDBC不可用時保留skipped，不聲稱Green。
- **驗證**：`./gradlew test --tests '*InMemoryIdentityMaintenanceContractTests' --no-daemon --no-parallel`；`./gradlew integrationTest --tests '*JdbcIdentityMaintenanceContractTests' --tests '*ProductionIdentityIntegrationTests' --no-daemon --no-parallel`
- **對應ID**：PP1-AC02／PP1-FM04。
- **預估大小**：M，390行test與scaffold；若rawtable數據向量／faultadapter超大小必須拆卡。

### PP1-A04 fresh／store Green

- **目標**：共同guard、rawstate與固定bootstrap交易成立。
- **輸入**：A03；§5與原store實作。
- **步驟**：①JDBC rawquery＋同tx5slock／memory監視器snapshot；②fresh資格／標準roles/grants/principal/credential/assignment/audit；③Result只在commit後回，CLI接真service；④faultrollback與重入race轉綠；⑤fixture freshanonymous拒絕與正式Admin配置publictype後published200，沒有猜測真hosttypes。
- **完成條件**：A03memory/PG全部綠、原identitystore回歸不弱化；只rolecatalog狀態可建、任何歷史identity資料皆拒絕。
- **驗證**：`./gradlew test --tests '*InMemoryIdentityMaintenanceContractTests' --tests '*InMemoryIdentityStoreContractTests' --no-daemon --no-parallel`；`./gradlew integrationTest --tests '*JdbcIdentityMaintenanceContractTests' --tests '*ProductionIdentityIntegrationTests' --tests '*JdbcIdentityStoreContractTests' --no-daemon --no-parallel`
- **對應ID**：PP1-AC02／PP1-FM04。
- **預估大小**：M，380行source＋test修正；snapshot不能泛化成改全部memory寫入模式。

### PP1-A05 recover Red

- **目標**：無賦予權限、explicitreenable、session/audit原子性先有失敗斷言。
- **輸入**：A04；§6，原IdentityAuditAtomicWriteTests故障模式。
- **步驟**：①sharedcontract加active/locked/disabled±flag/nonadmin/deleted/missing/damagedgrants；②原principal固定lastLoginAt=T0-1d，session2個未撤/1個已撤，其他principal/session做negative快照；③credential後／principal後／session撤後／audit後throw全snapshot不變；④相同operationId重跑/race只audit1；⑤integration重建context後舊hash與session失效、新login正常、allroles/grants原物件相等。
- **完成條件**：PP1AC02_recoveryRevokesSessionsAtomically與PP1FM04_recoveryDoesNotPromoteOrRepairGrants意圖Red，unsupported scaffolds與行為failure分列。
- **驗證**：`./gradlew test --tests '*InMemoryIdentityMaintenanceContractTests' --no-daemon --no-parallel`；`./gradlew integrationTest --tests '*JdbcIdentityMaintenanceContractTests' --tests '*ProductionIdentityIntegrationTests' --no-daemon --no-parallel`
- **對應ID**：PP1-AC02／PP1-FM04。
- **預估大小**：M，300行test。

### PP1-A06 recover Green與子集整合

- **目標**：recover原子更新與固定error／receipt，原successrollback和LAST_ADMIN不退化。
- **輸入**：A05；§4/6。
- **步驟**：①實作兩store hasMaintenanceOperation完整非分頁SQL/memory JSON比較；共同guard內重讀資格/duplicateoperation；②沿withLock/upsert/revoke+AUTHaudit，保留lastLoginAt；③CLI recovery option與commit後fixedreceipt、finallyclear、closefailure分類；④跑子集命令，review每個rawstate／fault／race證據；⑤明列hostadapter仍pending，不標整波DOC_READY/productionready。
- **完成條件**：A05全綠＋existingatomic/usableadmin regressions綠；本機test evidence不代替host停止／TLS／備份演練；必要完整gates與CI由root最後整合卡執行。
- **驗證**：`./gradlew test --tests '*IdentityMaintenanceCommandTests' --tests '*ProductionSeedSeparationTests' --tests '*InMemoryIdentityMaintenanceContractTests' --tests '*IdentityAuthTests' --no-daemon --no-parallel`；`./gradlew integrationTest --tests '*JdbcIdentityMaintenanceContractTests' --tests '*ProductionIdentityIntegrationTests' --tests '*IdentityAuditAtomicWriteTests' --tests '*JdbcIdentityStoreIntegrationTests' --no-daemon --no-parallel`
- **對應ID**：PP1-AC02／PP1-FM04。
- **預估大小**：M，280行source＋test修正；root需要獨立hostadapter卡與必要completegates，此六卡不包含它們。

## 9 fixtures、FM與證據要求

sharedcontract每case新store；JDBC用PostgresFixture.cleanDataSource一次/case，race共用該case DS兩connection，不在race thread再clean。T0=2026-10-01T00:00:00Z；principal.username pp1.root、label PP1 root、email=null；roles系統五code與T0、newUUID只在當case內比較；secret取unit test本機randomchar[]或既有測試properties，文件不列密碼。fresh roleonlyraw列表保持原IDs/T0。recovertarget status/failedCount/lockedUntil/lastLoginAt各明列：active(2,null,T0-1d)、locked(5,T0+15min,T0-1d)、disabled(0,null,T0-1d)，success變active/0/null、lastLoginAt原值。

故障採memory publicwriter override已delegate後throw；JDBC同DS Store subclass override相同publicwriter先super後throw，audit原模式沿用。所有snapshot涵蓋原principals/username索引/credentialhash/roles/grants/assignments/sessionrevokedAt/audit IDs。race CountDownLatch與Future.get(10s)，無sleep。Consolefake提供ownedchar[]並捕stdout/stderr；測missingconsole／confirmmismatch／policyfail／hashfail／guardfail／DBfail最後buffers全0，捕获文字無secret/encodedhash/DBURL。

| FM | 固定結果／namedcase | 卡 |
| --- | --- | --- |
| PP1-FM04 badoptions/secret | exit2，零DB，PP1FM04_optionsAndSecretsAreRejectedWithoutEcho | A01/A02 |
| PP1-FM04 hostguard未配置／仍writer | exit6，無mutation，PP1FM04_guardIsRequiredBeforeAnyMutation；fake只測core，真hostcase留adapter | A01/A02＋root adapter |
| PP1-FM04 maintenance一般scan | 無HTTP/seed/purgejob，PP1AC02_maintenanceContextContainsOnlyExplicitBeans | A01/A02 |
| PP1-FM04 rawdirty/repeat | exit3 NOT_FRESH零改，PP1FM04_rawDeletedDataRejectsFresh／PP1FM04_repeatPreservesEveryObject | A03/A04 |
| PP1-FM04 fresh標準grant／anonymous | PP1AC02_freshCreatesOnlyFormalAdmin／PP1AC02_anonymousRemainsDeniedUntilExplicitGrant | A03/A04 |
| PP1-FM04 concurrent／locktimeout | 一fresh成功／一拒絕、timeout exit4，PP1FM04_concurrentFreshCommitsOnce／PP1FM04_lockTimeoutDoesNotWrite | A03/A04 |
| PP1-FM04 DB/schema/auditfault | exit5、allrollback，PP1FM04_freshFaultsRestoreFullSnapshot／PP1FM04_recoveryFaultsRestoreFullSnapshot | A03/A04/A05/A06 |
| PP1-FM04 recover資格／re-enable | exit3無提權，PP1FM04_recoveryDoesNotPromoteOrRepairGrants／PP1AC02_disabledRecoveryRequiresExplicitFlag | A05/A06 |
| PP1-FM04 recoveryduplicate | exit3 DUPLICATE_OPERATION audit1，PP1FM04_duplicateRecoveryCommitsOnce | A05/A06 |
| PP1-FM04 revoke／lastLogin | 原roles/grants與lastLogin保留，PP1AC02_recoveryRevokesSessionsAtomically／PP1AC02_recoveredIdentitySurvivesRestart | A05/A06 |
| PP1-FM04 prod舊demoactor | accounts/entries/media/nav零新增，schema12存在，PP1AC02_prodDoesNotWriteDemoData | A01/A02 |

CLI無HTTP401/403/session，不能臆造對應APIcodes；日常Admin權限沿原HTTP contract/IdentityAuth tests。沒有newpublicendpoint/OAS變動。hostguard停止、new-volume所有DB/mediafresh證據、DBidentity binding／postcommit服務復原／RPO/RTO必須root adaptercase，這些沒有已完成覆蓋。

## 10 殘餘外部依賴與root整合

1. OS／service主管、Compose與工具實際版本、maintenanceTTY／受保護DBsecret來源、正式artifact取得，未驗安裝；Console不在非TTY擅自改echo輸入。
2. 所有writer／scheduler完整inventory、auto-restart抑制、DBsession觀測權限、matchingtargetbinding、lease生命週期及backup/upgrade/recovery共同互斥；hostadapter驗證前formalCLI不可施工。這是實質依賴，不能用空receipt或flag替代。
3. 新庫schema provisioning的matchingversion migration步驟、owned空DB/media證據、guard可讀來源與現在實體cluster對應；本core只validate和身份rawcheck。
4. 四actualURLs、DNS/TLS、static服務、首批operatortypes與publictypes、正式username/秘密，仍由rootprivateops參數補齊；公開grant預設空不阻安全初始化但阻完整公開旅程驗收。
5. verifiedofflinebackup來源、保留集合選擇（daily7＋weekly4）、通知與每日窗口、恢复至matchingrelease／failure receipt。此子集不做pruning/刪除/安裝排程。
6. 角色grants損壞或無existingadmin無法由recover改善；受控備份還原流程由PP1 recovery附錄負責；若無verifiedbackup，停止列阻擋，不賦予普通帳號admin、不重跑demo seed。

root應把本候選整合至PP1 accounts附錄、更新owner已批准狀態與六卡dependency；其他host章節保持DRAFT。DB＋媒體還原後的啟用政策固定為raw一致性核對完成後、API啟動前，在同一交易撤銷全部恢復的sessions並寫一筆AUTH恢復事件；與此处單一admin密碼恢復區分，見[恢復附約](PP1-recovery.md)。source/model/catalog未改、W5 VERIFIED／BW6 DOC_READY保留；六卡只是設計，不把DOC_READY／VERIFIED／正式可用混為同義。

外部API查閱2026-10-09：[Java25 Console](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/io/Console.html) 的readPassword與nullconsole；[PostgreSQL16 locking](https://www.postgresql.org/docs/16/explicit-locking.html) 的transaction advisory lock；[Spring builder](https://docs.spring.io/spring-boot/3.5/api/java/org/springframework/boot/builder/SpringApplicationBuilder.html) 區分headless與web。本文選explicit AnnotationConfig context而不把headless=true誤當web=NONE或無listener；API compilation與beanabsence仍屬未來focused檢查，未聲稱已驗。

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

## 3 檔案責任

本文件只擁有跨波canonical bundle/session-revoke policy。PP1c local implementation whitelist and card dependencies are authoritative in [PP1c §3、§6](../waves/PP1c.md); do not use the superseded R01–R10 path table formerly in this section as implementation authorization. PP1d alone may later define selection/scheduler/offsite adapters. This DRAFT itself authorizes no source edits.

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
| artifacts | 恰三項，按path排序：`db.dump`、`inventory.json`、`media.package`，每項`{path,byteSize:string,sha256}`；media.package格式唯一PP1c候選為PP1CMEDIA1（參PP1c §4.1），root review前不授權施工；不可假設已有archive adapter |
| inventory | `{sha256,dbSnapshotSha256,assetCount:string,referencedFileCount:string,orphanFileCount:string,fileCount:string,fileBytes:string}`；sha256須等於artifact inventory.json；fileCount=referenced+orphan |
| source | `{projectRef:string,dbVolumeRef:string,mediaVolumeRef:string,writerSetSha256}`；volumeRefs不同，與restore target不同，只opaque identifiers |

local-complete：`{version:1,backupId,manifestSha256,verifiedLocalAt}`，immutable。offsite receipt：`{version:1,backupId,manifestSha256,packagePlaintextSha256,ciphertextSha256,byteSize:string,destinationRef,keyRecoveryRef,adapterId,adapterVersion,verifiedAt,verification:'retrieved-decrypted-hashed'}`。plaintext package必須包含manifest、complete與三artifacts，packagePlaintextSha256綁定外層包；獨立保護ciphertext hash。其他receipt verification值不接受；若provider只提供server-side checksum，須修改PD03協定並独立審查，不能本內核偷偷放行。hash只證完整性，不證來源可信／加密安全；指定受保護來源與加密key程序仍需adapter。

`restore-verified.json`：`{version:1,runId,backupId,manifestSha256,targetRef,rawSnapshotSha256,mediaInventorySha256,smokeReceiptSha256,environment:'isolated-drill'|'production',incidentStartedAt,startedAt,availableAt,elapsedMs:string,rtoBudgetMs:'14400000',withinRto:boolean}`。只在raw、啟動後契約與真實服務smoke全通過才產生，不能由fake adapter測試輸出當作真演練證據。

### 4.3 函式／CLI契約

此parent contract定canonical bundle與跨波不變量；local runtime commands/lease/adapter只以PP1c §4.2、§4.4、§6為唯一施工來源。不得在此另定一套backup/restore CLI、lock或JavaExec。Java現有main保留`contains("maintenance")`舊路由及其錯位拒絕；PP1c只可在該分支之後新增精確首token offline `ops-inventory`／`ops-revoke-restored-sessions`，於Spring前執行，錯位或重複token拒絕。無新Java Operation、HTTP endpoint、runtime dependency或Compose公開port。詳細request/result/ready/permit與密碼界線由PP1c固定。

## 5 模組與狀態機

### 5.1 DB／檔案inventory（只讀）

Raw inventory恰含PP1c §4.1列明的20 relations及其migration驗證的column allowlist。缺失/多餘table或column為`SCHEMA_UNSUPPORTED`，不能因兩端動態schema相同而接受drift。允許欄完整catalog/constraint/index metadata仍需逐項比較。每個固定column以PG `::text`輸出，採單一REPEATABLE_READ、read-only JDBC transaction及UTC/ISO/hex/extra-float固定設定；source schema metadata從catalog取，cell經`getString`取nullable PG text；不能依賴driver-specific bytea conversion或cast後ResultSet metadata。table row maps/canonical ordering/hash與media walk詳見PP1c §4.1/4.3，parent不另造第二個inventory算法。

### 5.2 lock／journal與adapter執行邊界

唯一source-owned registry是PP1b maintenance registry。Local workflow以同目錄strict LeaseV2與v1 version-discriminated loader共存，沿用一把operation lock、永久operation IDs、完整journal與opaque source+at-most-one-child capability；不建第二lock/journal、不巢狀acquire、不TTL/force unlock/auto replay。v1 FRESH_INIT、Java Operation enum及六欄principal Result保持既有契約。LeaseV2欄位、terminal behavior、helper full-ID inspect及source/child life cycle只以PP1c §4.2為準。RECOVER_ADMIN完成保持原服務stopped狀態。

Helper需先full inspect再start，依exact ID確認running/exit/remove；identity包括完整container ID/image/network/mount/UID/GID/security policy。JDBC inventory/revoke使用同一connection ready→host full-ID/network/IP/backend核驗→private permit；不得reconnect或PID replacement。pg_dump/restore為無JDBC握手的限定觀察例外，須唯一精確tool process+backend且結束零backend；application_name不是ownership proof。Host-private 0600 materials需image numeric UID/GID preflight；unsupported即fail closed，不chmod/chown。所有source/target工具不共掛網路/卷。adapter schemas、limits及secret delivery僅PP1c §4.2具體封板後施工。

### 5.3 backup狀態

Parent集合狀態仍是`PRECHECK→QUIESCED→CAPTURED→VERIFIED_LOCAL→VERIFIED_OFFSITE`；service state獨立記錄。PP1c只實作local capture與local restore verification；不實作offsite、retention、schedule、notification或pruning。Source原stopped就保持stopped；若workflow本身要求 `KEEP_STOPPED`，不得因成功或失敗默默start。Raw session/audit均納入snapshot，不在capture前忽略。local copy只能標`LOCAL_COPY_VERIFIED_NOT_OFFSITE`，不能更新`last-success`為offsite成功。具體local operation phases由PP1c §4.4控制。

### 5.4 restore／upgrade recovery狀態

恢復證明流程為capture→private copy→fresh isolated target→DB/media restore→完整raw/files/Flyway/source-release equality→同transaction session revoke + 恰一AUTH event→同版API health→child-only browser smoke→target stop→durable proof。Startup delta預設為零；任何未明列owner decision的seed/catalog/purge/scheduler或其他row變更為`STARTUP_MUTATION`，停止隔離並退回設計，不能先設全表忽略清單。只允許revoke transaction明列的session revoked_at差異與一筆AUTH新增。revoke commit後任何crash/health/smoke failure，保留停機target；重試須新operationId、新blank target及原immutable backup完整重還原，RTO起點不變。

正式RECOVER_ADMIN前，fixed `recovery-candidate.json`只作locator；在停止或Java attach前預檢bundle+完整成功/released proof。取得同一registry的新operationId後，持lease重新hash所有bundle/proof bytes、核對完整source identity和所有原始rows/files equality；prior proof可使用但receipt-only或stale raw不可通過。完成保持原stopped。local-only證據永不滿足`VERIFIED_OFFSITE`。upgrade rollback、offsite restore、production switching、retention selection仍非PP1c scope，依PP1d另設卡，不借用本地restore流程自動mutation。


### 5.5 保留selection與RPO

catalog entry=`{backupId,manifestSha256,quiescedAt,verifiedOffsiteAt|null,restoreVerifiedAt|null,integrity:'valid'|'failed'|'unknown',inUse:boolean}`。pins是opaque backupId list，去重排序。valid且verifiedOffsiteAt存在才eligible；failed/incomplete/unknown/inUse與pins全部protected，不被candidate刪除清單吸納。

daily=每UTC日期最新eligible一份，取最近7個日期；weekly=ISO8601週（星期一00:00Z起）每週最新eligible一份，取最近4週，包括當週；時間相同以backupId字典序較小者穩定勝出。keep為daily∪weekly∪pins∪最新eligible∪最近restoreVerified且integrityvalid那一份，union可重疊、不強行複製11份。candidate=其餘eligible且notprotected，僅分類、沒有任何delete方法。沒有validoffsite或restoreverified保底也不自動刪任何資料，code=NO_RECOVERABLE_BASELINE；baselineunknown只能給diagnosticselection，不能交付pruning。weekly細節是本草稿確定提案，root審查封板，不擅自宣稱owner已批准此ISO週實作細節。

RPO age=`now - max(valid VERIFIED_OFFSITE quiescedAt)`，<=86400000為within-target；無成功集合unknown、負值clock-error，超時stale並必須通知。latest-success的verifiedOffsiteAt不能代替quiescedAt；若新capture成功但傳輸失敗，仍用舊snapshot計算。每日24h排程與非零capture/transferlatency會在下一批尚未verified時短暫超24h：因此每日once不是連續RPO保證。PD04需以實測latency封定窗口/提前量／失敗處置並由owner確認可承受exposure；不擅自增加頻率，也不將goal改為寬鬆SLA。scheduleadapter未定，沒有排程檔存在即達標的證據。

## 6 PP1c與PP1d任務歸屬

原R01–R10中local bundle、inventory、backup、blank restore、session revoke、recover attachment實作卡由PP1c §6的C/L/H/T/R卡完整取代；worker只能按PP1c卡實作，禁止再從本文件派生平行R卡。對照如下：

| 舊草稿卡 | 唯一當前責任 |
|---|---|
| R01–R02 manifest/canonical bundle | PP1c C01–C02 + shared §4.1 schema |
| R03–R04 inventory/media raw | PP1c C03–C04b + H03 transport |
| R05–R06 offline Java dispatch | PP1c C05–C06 + R04; 保留舊maintenance語義，不加JavaExec |
| R07–R08 local capture/lease | PP1c C07–C08 + L01–L03 + H01–H02 |
| R09–R10 restore/revoke/recover | PP1c C09–C18 + R01–R03 + T01–T03 |
| R11–R12 selection/retention | PP1d future-only，未授權PP1c實作 |

舊R01–R10的段落是被此crosswalk取代的歷史拆卡草案，不得當作第二份接口或驗收依據；施工依PP1c的actual path whitelist/card dependencies。Retention daily/weekly selector、pruning、schedule、offsite/KMS/notifications、upgrade fault recovery及正式host acceptance均保留在PP1d/owner環境決策，local completion不會關閉它們。

## 7 精確測試fixture與證據層

Node每case新TempDir；fakeclock UTC=`2026-10-09T00:00:00.000Z`、monotonic0；operationId用固定不同UUID；fakeadapterreceipt由§5.2schema產生，spy只recordmethod/opaque IDs。faultcase每次只改一個field或throw固定OpsError，不靠真網路/diskfill；concurrency用Promisebarrier，不sleep猜先後；abortcase第一BEGIN已persist後cancel，檢查下一adapter零calls。bytes fixturecontains secretcanary，檢查receipt和stdout均無canary；private inventory含canary可保留。

Java tests用@TempDir与explicitrecords；ImageIO生成32×16 PNG original，既有ImageVariants.fit產320/1600 variant（小圖不放大，兩variant32×16），PDF bytes `%PDF-1.4\n`；decode-nullimage bytes僅合法sniffheader且ImageIO=null。orphan `orphan.bin`一份hash記錄，不刪。deletedasset完全samefiles；一case刪webrow卻留webfile，需IMAGE_VARIANTS_INCOMPLETE，不能只檢declaredrows而pass。另一case保留webrow刪webfile→MISSING_MEDIA_OBJECT；symlink在TempDir指到第二TempDir（只能支援symlink環境測，必需CIhost明列），hardlink同inode→UNSAFE_MEDIA_PATH。第三case alteredoriginalsamebytecount→MEDIA_HASH_MISMATCH。SQLfaultmock Connection/JDBC執行窗口aftersetup，assertalloutputcompleteabsent。

真PG IT置於contract package以用既有PostgresFixture；setup新schema/migratedtables，插asset/variant與一份raw entry/revision/permissions／sessionsfixture，將dbmetadata與media每筆一致。inspect兩次hash同、故障不mutate；此IT只證真DBinventory。完整local restore drill需要另外兩個獨立PG database/media roots與真custom dump restore；不要求offsite adapter，也不能重用PostgresFixture.emptyDataSource的全schema clean作restore到新庫。Offsite是不同PP1d/formal gate。

精確步驟pattern：建立fixture→記sourceDB/fileshash→callcore→等待同步返回或fakepromisebarrier→assertcode/phase/adaptertrace/unchangedoriginal/lastsuccess；所有command結果必須另收actualreceipt。fakeexit0不等於PGdump可還原；單元測試schemaGreen不等於filesystemdurability支援；所有未跑gates保留未跑狀態。

## 8 失敗模式與固定退出

| code／FM | 精確行為／測試／卡 |
| --- | --- |
| INPUT_INVALID / MANIFEST_MISMATCH / PP1-FM08/12 | exit2，無targetwrites；manifestwrongbatchunsafeinput C01–02 |
| MISSING_MEDIA_OBJECT / MEDIA_HASH_MISMATCH / MEDIA_SIZE_MISMATCH / IMAGE_VARIANTS_INCOMPLETE / PP1-FM08 | exit3，完整集合不成功、不修檔/DB；inventorytests C03–C04b |
| UNSAFE_MEDIA_PATH / SCHEMA_UNSUPPORTED / PP1-FM08/12 | exit3，未知path/link/table/type拒絕；inventorytests C03–C04b |
| LOCK_BUSY / WRITER_NOT_QUIESCED / SOURCE_CHANGED / PP1-FM09 | exit4，capture0，不偷unlock，不forcedstop；backuptrace C07–C08 |
| CAPTURE_FAILED / LOCAL_VERIFY_FAILED / PP1-FM10 | exit5，無localcomplete、lastsuccess不動、有界safe恢復原state；C07–C08 |
| OFFSITE_FAILED / OFFSITE_VERIFY_FAILED / NOTIFY_FAILED / PP1-FM11 | exit6，local保留、不更新success，通知雙failure；C07–C08 |
| TARGET_NOT_BLANK / TARGET_NOT_OWNED / ADAPTER_UNSEALED / PP1-FM12 | exit7，所有restorewrites0；C09–C18 |
| RESTORE_FAILED / RAW_MISMATCH / STARTUP_MUTATION / SMOKE_FAILED / PP1-FM10/15 | exit8，target停隔離、保留原卷，不出verifiedreceipt；C09–C18 |
| UPGRADE_FAILED / RECOVERY_FAILED / WRITES_ALREADY_OPEN / PP1-FM13 | exit9，noopenwrites，oldtuplefreshrestore或hold；C09–C18 |
| INTERRUPTED / JOURNAL_INCOMPLETE | exit10，記phase保留lock等待受控inspect；C07–C08/C09–C18 |
| OBJECTIVE_MISSED / OBJECTIVE_UNKNOWN / NO_RECOVERABLE_BASELINE / PP1-FM14 | exit11，能用仍記RTO超時／RPOstale，selection不刪；PP1d |

primarycode不被notifyfailure覆蓋；Outcome保留primaryexit，notificationreceipt另有failed。phase不得以OpsError.message猜測，從journal目前phase記錄。未登入／wrong surface／versionConflict由既有APIassertions及正式smokeadapter覆蓋，不把coreerrorenum新增到HTTPErrorCode。

## 9 整合檢查表與殘餘依賴

- [x] PP1正文與PD04已更新批准數值，不寫已達SLA。
- [ ] weeklybucket細節與RPOlatencyexposure審查；R04原390行高風險估算已拆成R04盤點、R05/R06 CLI與封裝Red/Green；各卡仍需實作前大小與接口walk，不能靠省略安全驗證壓行數。
- [ ] PD01：hostOS/localfilesystem、Node/JRE工具與permissions、包裝命令、Compose版本、容器停止deadline／restartmanager／DBsession識別、空白DBrole、media readonlymount、archiveformat及safeextractor封板。
- [ ] PD02/runtime：實际URL／HTTPS／隔離route／frontendartifacts與來源releasehash固定，no-secretconfigschema由runtime卡提供。
- [ ] PD03：離機目的地、加密/傳輸tool版本／金鑰恢復／受保護來源驗證／回取解密hash／通知receipt具體adapter與故障；沒有provider工具 অনুম認。
- [ ] PD04：每日實際維護窗口、capture/offsite耗時與RPOmargin、scheduler故障catchup／notification、容量門檻；不額外批准频率或pruning。
- [ ] accounts：正式首批publictypegrants、operator與恢復帳號／session撤銷adapter（政策已固定，接線與精確卡未完成）；startupno-demo精確raw/post差異白名單。
- [ ] 真環境measure：offsite回取到服務可用<=4h、snapshotage<=24h；三upgradefailurefreshmatchedrestore、媒體隔離/revision重啟等真證據。PP1c/PP1d cards cannot substitute for this environment gate.
- [ ] root做五卡weakmodelwalk、独立review、精確檔案／20table計數等契約一致性與必要CI；實際超400拆卡；整體>30提拆波。

外部一次來源查證2026-10-09：[PostgreSQL16 pg_restore](https://www.postgresql.org/docs/16/app-pgrestore.html)確認single-transaction implying exit-on-error、不能與paralleljobs一起；[Node24 fs](https://nodejs.org/docs/latest-v24.x/api/fs.html)為mkdir/open/fsync/rename的stdlib來源，未承諾任意主機filesystemdurability。Java媒體decode全部依上述同版source，不新增依賴。這些唯讀查證不是產品測試通過或主機工具安裝證據。

# PP1c 本地 DB／媒體一致備份與空白還原施工圖

日期：2026-10-09。狀態：**DRAFT；不授權施工，不是 DOC_READY、offsite 或正式可用聲明**。依賴已合併 PP1a 的 local-isolated runtime，以及 PP1b 的帳號／Q25／同實例維護 lease 實作與驗收。設計承接 [PP1](PP1.md) §4.4–5.2 與 [PP1-recovery](../contracts/PP1-recovery.md)；本文件只把 PP1c 範圍、local adapter 接合與 blank-restore 驗收收斂。已選定的設計proposal與未驗收的implementation/environment gates列於 §9；本文件仍待root獨立review。

本波目標是可重現地從一個停寫、同批、私有本地 bundle 建立第二個**全新且隔離** DB/media target，驗證 raw rows、Flyway history、媒體檔案與匹配 release，撤銷恢復 session 後啟動同版 API並通過必要 smoke。第二個目錄仍與來源同主機／磁碟，僅為 local protected-copy fixture，不能計入 `VERIFIED_OFFSITE`、RPO離機成功或災難存活。正式離機／金鑰保管、排程、通知及 PP1-AC03 全項驗收仍未完成。

## 1 範圍

解決 PP1-AC03 中「本地同批 DB＋media 一致性備份與空白隔離還原」的可測子集；覆蓋既有 `PP1-FM08`、`PP1-FM09`、`PP1-FM10`、`PP1-FM12`，及 raw restore/session revoke 的 PP1-AC02 前置。只有取得可重現 local blank-restore 證據才可標記本地子集完成；PP1-AC03 的離機／每日排程／保留／RPO-RTO目標仍未達成。

固定不做：真正式主機、真正離機或外部通知、正式部署、production credentials、排程安裝、automatic pruning、upgrade／三故障回復（PP1d）、資料搬移、source volume 覆寫、舊卷刪除、`down -v`、image-only rollback、改既有 migration、HTTP 備份 endpoint、額外 npm／Java runtime dependency、向外部服務傳資料。不得用同 DB context restart、fake adapter exit 0、單一 image 回退、空 inventory 或 mock API 冒充 blank restore。

政策已批准：停寫備份；PostgreSQL 16；RPO 24h、RTO 4h目標；daily 7＋weekly 4保留目標；fresh/no-demo；日常獨立 operator；正式還原 raw一致後、API啟動前同交易撤銷所有恢復 session 並寫一筆 AUTH audit。政策批准不代表本地或正式環境已達標。PP1c不實作選取／刪除保留候選、scheduler及upgrade；daily/weekly保留計算移 PP1d，不因本波就緒而刪任何 bundle。

## 2 先決條件與實際來源

施工前置：PP1a local runtime 已 VERIFIED；PP1b merged account authority依 `PP1-accounts.md` §10.1a；G06/G07 shared lease implementation必須先完成並獨立驗收，未驗收前本圖僅是施工提案。**PP1b沒有rollback-bundle verifier**：`PP1-accounts.md` §10明列 verifier 尚待PP1c，且verifier缺席時host recover-admin固定exit 6 `RECOVERY_BACKUP_REQUIRED`、零Java mutation；PP1c C18只交付本地可驗證bundle整合，不把同主機local copy改稱正式verified/offsite backup。PP1c不得另建mutex/lock/operation registry；採 §4.2 所列同一 source-owned registry strict v2 lease，不擴Java `Operation`。`PP1b` Java `Operation` enum僅列`FRESH_INIT`、`RECOVER_ADMIN`；本圖採用root選定的shared-v2 lease/helper/target proposal；G06/G07與adapter freeze是實作先決門檻，不是尚待回答的架構問題。未封板adapter固定`ADAPTER_UNSEALED` fail closed。

本地已批准／PP1a固定輸入（每次採當次 run receipt，不複製舊值）：host Node 24.18.0 binary與既有 Linux工具 image、JDK 25、PostgreSQL 16 image；三個 image 為完整 immutable image ID 並透過 PP1a 新增的 run-scoped local refs，`pull_policy: never`；獨立 compose project，DB/media 不發布 host ports；owned API jar及 source commit/dirty state、API image labels、三個 dist hash、ingress hash均有PP1a receipt來源。所有命令使用 PP1a 固定 local Docker socket/context policy；不可 pull/install。DB password仍由該次 run 私有 secret file提供，不出 argv/env/log/receipt。

| 來源 | 本文採用的事實 |
| --- | --- |
| `compose.pp1-local.yaml`、`scripts/local/prepare.mjs`、`verify.mjs`、`forward.mjs`、`docker/pp1-api.Dockerfile`；PP1a §4.3–5.4 | run-scoped refs、immutable IDs、同次 release provenance、既有 Node/JDK/PG tool image、private run root及local network邊界；不得重新定義 Compose 或弱化 verify。 |
| `PP1b.md` §5.1、`PP1-accounts.md` §10 | 同一 instance lease、O_EXCL operation reservation、fresh owned target inspect、API停機／DB writer quiescence、commit receipt後才close／restart；不准分立 lock、TTL、force unlock或自動 replay。 |
| `PP1-recovery.md` §4–5.4、`PP1.md` §4.4–5.2 | 同批 manifest/dump/media、20-table raw snapshot、完整 asset/variant/object hash、non-destructive blank target、matched release、raw verification後session revoke及smoke。 |
| `MediaService.java:83–138`、`ImageVariants.java:18–39`、`LocalDiskMediaObjectStore.java:17–57`、`V4__media.sql` | object bytes與SQL不是單一原子交易；可解碼 image 才有 thumbnail/web；store normalize 不足以防 symlink；盤點必須檢查 DB 與檔案兩側，不修補/刪 orphan。 |
| `IdentityRequestFilter.java:66–105`、`AuthService.java:147–154`、`AuditPurgeJob.java:23–27`、`SchedulingConfig.java:7–9` | GET session touch、audit purge和排程亦會寫 DB；只擋 HTTP POST 不足以保證停寫。 |
| `SeedService.java:66–74`、`ContentTypeSeed.java:34–40,136–151`、`DemoContentSeed.java:44–59` | seed=false不代表 startup零寫入；同版API啟動前後要以 PP1a/PP1b freshness/account verifier及精確 allowlist 判斷，不把正常 catalog/Flyway誤報為污染。 |
| `PostgresFixture.java:20–34`、`ApplicationPersistenceIntegrationTests.java:49–167` | test fixture的schema clean或同context重啟不是獨立 blank target；real restore需另一個 fresh DB與 media root。 |
| migration目錄 | 已存在 V1–V6、V8、V9 SQL與 Java migration V7/V10；實際 release 的 complete `flyway_schema_history` rows/checksum須綁 manifest，不能只記最高版本。 |

以上是來源核對，不是本波產品測試或備份演練結果。PP1b/PP1a source hash observation記於T-002 evidence；root仍需在文件freeze時重新核對。

## 3 精確候選檔案清單

以下 component-root paths 是PP1c未來施工白名單草案；L/H/T/R補充路徑依§6表補列；不是本次文件階段已存在的產品變更。超出表格先停工更新圖紙。PP1c cards明列的少量PP1a/PP1b接線檔需先獲root批准其文件白名單；此文件本身不授權產品修改。不得改migration、OpenAPI、public runtime/browser API、既有Java account policy或G06未凍結檔案。

| 路徑 | 動作／用途 | 卡 |
| --- | --- | --- |
| `scripts/ops/recovery-protocol.mjs` | 新；canonical manifest、bundle receipt、artifact/release binding和固定 error schema | C01/C02 |
| `scripts/ops/recovery-protocol.test.mjs` | 新；strict JSON、hash/size、unknown/duplicate/path及secret boundary測試 | C01/C02 |
| `services/cms-api/src/main/java/com/fallrising/cms/ops/RecoveryInventory.java` | 新；read-only 20-table與media metadata/file inventory；只純核心 | C03/C04a/C04b |
| `services/cms-api/src/main/java/com/fallrising/cms/ops/RecoveryInventoryMain.java` | 新；offline subcommand runner，不建立Spring context | C05/C06 |
| `services/cms-api/src/main/java/com/fallrising/cms/CmsApiApplication.java` | 修改；精確首參`ops-inventory`在Spring前分流；保留現行maintenance相容路由 | C05/C06 |
| `services/cms-api/src/test/java/com/fallrising/cms/ops/RecoveryInventoryTests.java` | 新；TempDir、decode/unsafe path/byte drift cases | C03/C04a/C04b |
| `services/cms-api/src/test/java/com/fallrising/cms/ops/RecoveryInventoryMainTests.java` | 新；輸入、mode、secret、no-Spring/no-write契約 | C05/C06 |
| `services/cms-api/src/integrationTest/java/com/fallrising/cms/contract/RecoveryInventoryIntegrationTests.java` | 新；真PG16 read-only snapshot；不重用作 restore target | C04a/C04b |
| `scripts/ops/local-bundle.mjs` | 新；沿 PP1b existing lease運行本地停寫、dump/copy、重驗；不提供新 lock | C07/C08 |
| `scripts/ops/local-bundle.test.mjs` | 新；fake command/adapter Red-Green及staging保留 | C07/C08 |
| `scripts/ops/local-restore.mjs` | 新；fresh target restore/raw compare/session-revoke/API lifecycle orchestrator | C11–C16 |
| `scripts/ops/local-restore.test.mjs` | 新；preflight／phase／fault／second-fresh-target contract tests | C11–C16 |
| `services/cms-api/src/main/java/com/fallrising/cms/ops/RestoreSessionRevoker.java` | 新；RAW_VERIFIED後同DB transaction revoke＋AUTH audit adapter | C13/C14 |
| `services/cms-api/src/test/java/com/fallrising/cms/ops/RestoreSessionRevokerTests.java` | 新；rollback/audit failure/only-session-delta contract | C13/C14 |
| `services/cms-api/src/integrationTest/java/com/fallrising/cms/contract/RestoreSessionRevokerIntegrationTests.java` | 新；real PG atomic revoke/audit test | C13/C14 |
| `scripts/ops/local-recovery-verify.mjs` | 新；bundle/release preflight及post-start exact allowlist verifier | C09/C10/C15/C16 |
| `scripts/ops/local-recovery-verify.test.mjs` | 新；altered/missing receipt、release drift、smoke failure | C09/C10/C15/C16 |
| `e2e-pp1-local/recovery.spec.ts` | 新；隔離runtime browser smoke由root-controlled owned旅程執行 | C17 |

不新增套件／lockfile／workflow／compose overlay／migration／OAS／正式scheduler；使用既有 node:test、JUnit、Gradle、Playwright與PP1a local image/tool roots。若實際需要額外檔案，先由root批准更新scope，不在 worker 中擴張。

Shared lease/helper/target補充白名單（PP1a/PP1b接線仍須root另行核准；這是候選精確路徑，不授權擴scope）：

| 路徑 | 卡 |
|---|---|
| `scripts/local/maintenance-guard.mjs`, `scripts/local/maintenance-guard.test.mjs` | L01–L03（v1 behavior preserve） |
| `scripts/local/maintenance-store.mjs`, `scripts/local/maintenance-store.test.mjs` | L01–L02 |
| `scripts/local/maintenance-workflow.mjs`, `scripts/local/maintenance-workflow.test.mjs` | L02–L03、R01–R02 |
| `scripts/local/maintenance-helper.mjs`, `scripts/local/maintenance-helper.test.mjs`, `scripts/local/maintenance-helper-session.test.mjs` | H01–H02 |
| `scripts/ops/local-media.mjs`, `scripts/ops/local-media.test.mjs` | H03 |
| `scripts/local/prepare.mjs`, `scripts/local/prepare.test.mjs`, `scripts/local/restore-target.mjs`, `scripts/local/restore-target.test.mjs` | T01–T02 |
| `scripts/local/maintenance-target.mjs`, `scripts/local/maintenance-target.test.mjs` | L03、T02 |
| `scripts/ops/local-restore-smoke.mjs`, `scripts/ops/local-restore-smoke.test.mjs` | T03；`scripts/local/forward.mjs`及其tests不改 |
| `scripts/ops/local-recovery-verify.mjs`, `scripts/ops/local-recovery-verify.test.mjs`, `scripts/local/maintenance.mjs`, `scripts/local/maintenance.test.mjs` | R01–R02 |
| `services/cms-api/src/main/java/com/fallrising/cms/identity/maintenance/LocalMaintenanceGuard.java`, `services/cms-api/src/test/java/com/fallrising/cms/identity/maintenance/IdentityMaintenanceCommandTests.java` | R03（只在G06已接受後；施工前核凍結source） |
| `services/cms-api/src/main/java/com/fallrising/cms/CmsApiApplication.java`, `services/cms-api/src/test/java/com/fallrising/cms/CmsApiApplicationTests.java` | C05–C06、R04 |
| `services/cms-api/src/main/java/com/fallrising/cms/ops/RestoreSessionRevokerMain.java`, `services/cms-api/src/main/java/com/fallrising/cms/ops/RestoreSessionRevokerMainTests.java` | R04 |

PP1a compose/Docker/browser support不變：無Compose overlay/ports/host forwarder改動；如 T01無法在現有 `prepare.mjs` 以private internal API安全建立no-forwarder child target，停止並請root另開scope，不能改既有public prepare/verify語義。

## 4 資料、命令與錯誤契約

### 4.1 私有本地 bundle schema

所有JSON嚴格遵循[PP1-recovery §4.1](../contracts/PP1-recovery.md)：UTF-8無BOM＋LF；object key依Unicode codepoint排序；array在hash前按本章欄位規則定序；拒duplicate/unknown、NaN/Infinity、非法encoding及非canonical bytes。Node與Java raw-byte入口必須先strict UTF-8 decode/parse，再比較`canonicalBytes(parsed)`與原輸入逐byte相等；schema-only validation不夠。此canonical-byte比較本身會拒絕重複key與非canonical bytes，不要求第二套duplicate-aware parser。count/size/elapsed及DB large integer以十進位字串，SHA-256 lowercase 64 hex；private inventory/dump/media含帳號、credential/session、內容和object key，全部是敏感資料。

local bundle layout固定為單一新建、非symlink目錄：

```text
<private-run-root>/bundles/<backupId>/
  manifest.json
  inventory.json
  db.dump
  media.package                  # exactly one parent-contract media artifact; format is proposed as PP1CMEDIA1 in PP1c §4.1 and remains DRAFT pending root review
  local-complete.json
  failure.json                   # 只有失敗時；不含cause、argv、SQL、路徑外洩或secret
```

第二目錄 fixture為 `<private-run-root>/protected-copy/<backupId>/`，必須在 root 0700、全部檔0600、所有祖先非symlink/non-hardlink；來源與copy使用不同run-scoped directory且hash逐檔重驗。它是同host local fixture，不能設 `verifiedOffsiteAt`，不能變更PP1b `backupGate` 的 formal/verified-bundle語義，只有root封板的local-isolated PP1b verifier可用matching verified bundle滿足該owned target的`RECOVERY_BACKUP_REQUIRED`前置；仍不能聲稱offsite／正式災難還原或PP1-AC03全項。實際外部加密／傳輸／回取未設計為已可用 adapter。

Bundle manifest、`local-complete.json`、restore receipt一律使用[PP1-recovery §4.1–4.2](../contracts/PP1-recovery.md)所列canonical bytes及required/no-unknown schema；輸入用strict UTF-8 decode後parse，再要求`canonicalBytes(parsed)`逐byte等於原bytes，此比較會拒重複key／非canonical bytes；不需要第二套parser規則。PP1c不另造 `version`／`manifestVersion`、artifact名或restore-verified欄位。父契約的manifest含`release`、完整Flyway `migration`、20-table `scope`、`times`、`toolchain`、恰三個`artifacts`（`db.dump`、`inventory.json`、`media.package`）與inventory counts；local-complete receipt與restore receipt均逐欄相同。PP1a完整owned run receipt只在本機私有驗收資料夾重驗，不把未允許的新property塞進父manifest；API image digest/labels須回指API jar/source/base，frontend hashes、config hash及source/target IDs照父契約綁定。

`inventory.json`是`artifacts.inventory.json`的完整私有payload。table及column name必須符合此版已核migration的明確allowlist；未知table/column先以`SCHEMA_UNSUPPORTED`拒絕，不以「動態發現後兩側剛好相等」默認接受schema drift。允許column的完整catalog metadata仍動態讀取並保存`ordinalPosition,name,dataType,udtSchema,udtName,isNullable,characterMaximumLength,numericPrecision,numericScale,datetimePrecision,columnDefault,isIdentity,identityGeneration,isGenerated,generationExpression`（不適用值為null），並比較PK/unique/FK/check/index定義；此metadata及完整Flyway history在snapshot與restore target必須逐項相等。

現行V2–V9 SQL與V7/V10 Java migration所形成的20個relation欄位名稱固定如下（`flyway_schema_history`依使用的Flyway版本契約另行精確封板；實際migration history仍須完整比對）：

| Relation | Allowed columns |
| --- | --- |
| `cms_principal` | `id,username,display_name,email,status,failed_login_count,locked_until,last_login_at,created_at,updated_at,deleted_at` |
| `cms_credential` | `id,principal_id,type,secret_hash,algo,rotated_at` |
| `cms_role` | `id,code,display_name,system,created_at` |
| `cms_principal_role` | `principal_id,role_id,content_type_codes` |
| `cms_permission` | `id,role_id,action,content_type_code,predicate_json,allowed_surfaces,created_at` |
| `cms_session` | `id,principal_id,token_hash,created_at,expires_at,last_seen_at,revoked_at,created_surface,ip,user_agent` |
| `cms_audit_event` | `id,at,actor_principal_id,category,action,target_type,target_id,surface,outcome,ip,detail_json` |
| `cms_content_type` | `id,type_key,display_name,plural_display_name,description,title_field,slug_policy,singleton,enabled,previewable,public_requires_published_refs,created_at,updated_at,sort_field,visibility_field,owner_field` |
| `cms_field` | `id,content_type_id,field_key,field_type,required,unique_in_type,indexed,visibility,sort_order,default_value,validations,ref_target_type_key,on_delete,enum_values,help_text,enabled,public_bytes,label,group_key,listable,filterable,enum_labels,placeholder` |
| `cms_entry` | `id,content_type_id,slug,publication_state,version,payload,published_payload,published_at,archived_at,deleted_at,created_by,updated_by,created_at,updated_at,publish_requested_at,publish_requested_by` |
| `cms_entry_revision` | `id,entry_id,revision_no,slug,payload,published_at,published_by,content_type_key` |
| `cms_entry_ref` | `from_entry_id,field_key,to_id,to_kind,sort_position` |
| `cms_entry_index` | `entry_id,field_key,value_kind,value_string,value_int,value_bool,value_ts,scope` |
| `cms_navigation_menu` | `id,menu_key,surface,publication_state,version,document,published_document,updated_by,updated_at` |
| `cms_media` | `id,owner_principal_id,title,alt_text,original_filename,content_type,byte_size,stored_bytes,width,height,checksum_sha256,status,deleted_at,created_at,updated_at` |
| `cms_media_variant` | `media_id,variant,content_type,byte_size,width,height,object_key` |
| `cms_media_attachment` | `media_id,entry_id,field_key,attached_at` |
| `cms_media_settings` | `id,max_file_bytes,max_library_bytes,max_files,max_files_per_principal,updated_at` |
| `cms_audit_settings` | `id,retention_days,updated_at,updated_by` |
| `flyway_schema_history` (locked Flyway 11.7.2) | `installed_rank,version,description,type,script,checksum,installed_by,installed_on,execution_time,success` |

每個row map恰含該relation所有allowlisted column，cell為nullable PostgreSQL text；canonical object key依父契約Unicode codepoint排序，rows依canonical row UTF-8 bytes排序；per-table hash輸入為`{schema,rows}`，DB hash輸入為排序後`[{tableName,schemaSha256,rowsSha256,rowCount}]`。`rowCount`、manifest所有count/size、big integer與elapsed全為十進位字串，不能經JavaScript number。對象以null-preserving defensive unmodifiable copy保存，不得用拒null的`Map.copyOf`。

JDBC inventory transaction固定`REPEATABLE_READ`、read-only、`autoCommit=false`；在同一transaction先`SET LOCAL TIME ZONE 'UTC'`、`DateStyle='ISO, YMD'`、`IntervalStyle='iso_8601'`、`bytea_output='hex'`、`extra_float_digits=3`。SQL只由table/column constant allowlist產生，逐欄使用`SELECT "column"::text AS "column"`，再以JDBC `getString`保留nullable PG text；binary/timestamp/large integer/array/jsonb等cell的文字形式以PostgreSQL cast及上列session設定定義，不依賴PG JDBC對bytea等型別的driver-specific `getString`行為。原始SQL type/schema一律由catalog metadata取得，不以cast後ResultSet metadata作schema。migration source若新增/刪除欄位必須先更新allowlist與審查契約；未知或額外relation/column拒絕。finally rollback/close。Flyway每一完整history row排序、checksum/null/success精確核對，不只highest version。`media.package`採父契約恰一artifact。PP1c提案使用Node內建stream的`PP1CMEDIA1\n` framed format：magic後為8-byte unsigned big-endian header length、canonical UTF-8 JSON header `{version:1,files:[{objectKey,byteSize,sha256,classification}]}`（依objectKey排序），接著按同序串接未壓縮raw object bytes；無padding，EOF必須正好等於header＋declared payload。reader先驗strict header、總長度/capacity/hash及path，再串流重算每object hash，不解壓、不覆寫既有路徑。header在inventory artifact重複留hash/count；bundle manifest `artifacts`仍只有`media.package`一項。toolchain adapter id/version候選為`pp1c-node-framed-media`/`1`。這是本波唯一具體DRAFT format proposal，仍須root review後才能施工；不得改用tar/未核helper。manifest不放URL、hostname、DB URL/user/password、secret、token、stderr或raw session；inventory及package全視為敏感私有artifact。

`local-complete.json`保持父契約欄位並只在來源停寫snapshot、DB dump、media package與release provenance均重驗成功後以新名子目錄建立；不把local-complete叫offsite receipt。protected local-copy state固定`LOCAL_COPY_VERIFIED_NOT_OFFSITE`，不擴充父manifest/receipt欄位。失敗保留新staging、source project/volumes、舊bundles及lock，無自動cleanup或overwrite。

### 4.2 命令、lease與離線helper

Host API僅提供以下受控 workflow；它們是候選內部 exports，不新增使用者CLI flags：

```js
beginWorkflow(inspection, { operationId, purpose, completionPolicy }, deps)
assertWorkflow(token, { side, stage }, deps)
reserveRestoreTarget(token, { runId }, deps)
runOwnedHelper(token, { side, kind }, deps)
verifyRecoveryProof(token, deps)
attachRecovery(token, accountOptions, deps)
finishWorkflow(token, outcome, deps)
```

`purpose` 僅 `BACKUP_LOCAL | RESTORE_VERIFY_LOCAL | RECOVER_ADMIN`；完成政策由 workflow 固定為 `RESTORE_ORIGINAL | KEEP_STOPPED`，不是CLI可選值。沿用 PP1b 唯一 `maintenance/{operation.lock,target.json,lease.json,operations/<operationId>.json}` registry。v1 `FRESH_INIT` exports、持久格式、Java `Operation {FRESH_INIT, RECOVER_ADMIN}`、六欄 principal Result 及其 regression tests 保持原樣；只抽取內部共用 store primitives。v2 loader 嚴格接受完整 v1 或 v2 schema，未知版本/key、部分寫入、未知/COMMITTED/FAILED 狀態、現存lock皆 fail closed；不自動migration、不刪歷史、不TTL、不force unlock、不重播。每個operationId永久拒重用；unknown結果保留lock及證據待人工唯讀處置。

LeaseV2所有鍵必填（不適用為null）：`{version:2,operationId,purpose,releaseId,phase,createdAt,source,sourceConnection,originalApiState,completionPolicy,target,helper,proof,account}`。`source`為原封不動TargetV1；`target`僅一個RestoreTargetV1（runId/targetId/project/sourceOperationId、creationPhase、identity、connection、preparationSha256、createdResourceSetSha256）；`helper`僅一個HelperV1（kind/side/fullContainerId/policySha256/state/endpoint/backend/startedAt）；`proof`為backup/manifest/bundle/source-inventory/source-identity/restore-target/raw-compare/revoke/smoke各SHA與完整operation lineage；`account`僅RECOVER_ADMIN的PRE_CONNECTION/BOUND/COMMITTED與pinned BackendV1。sourceConnection恰含jdbcUrl及dataGateway且不可含password。RestoreTargetV1恰含version,runId,targetId,project,sourceOperationId,creationPhase,identity,connection,preparationSha256,createdResourceSetSha256；connection為null或恰含jdbcUrl,dataGateway。HelperV1恰含kind,side,fullContainerId,policySha256,state,endpoint,backend,startedAt；endpoint為null或恰含networkId,address。BackendV1恰含pid,backendStartEpoch,db,role,clientAddr,applicationName。ProofV1恰含backupId,manifestSha256,bundleSetSha256,sourceInventorySha256,sourceIdentitySha256,restoreOperationId,restoreTargetId,rawComparisonSha256,sessionCommitSha256,smokeSha256,proofSha256。account恰為null或含operation=RECOVER_ADMIN、phase及boundBackend。每一nested key required/no-unknown；hash lowercase 64-hex、IDs canonical UUID、時間UTC RFC3339毫秒，enum與null位置固定。JournalV2恰為 `{version,operationId,purpose,sourceTargetId,releaseId,phase,at,failureCode,leaseSha256,proofSha256}`。同一lock inode/device、source與唯一child的不可序列化WeakMap capability授權動作；token不可重建。一次只准source或child一個owned helper；不巢狀 acquire。

`beginWorkflow`記原API running/stopped狀態並取得既有lock；來源與child身份在全流程持續pin。`reserveRestoreTarget`在同lease下專用新runId/project、exclusive建立 ownership marker及資源；它不呼叫 PP1a normal `prepare/verify`，不啟動Compose全服務、不碰8443、不接host forwarder，也不刪/重用失敗target。子target永標RESTORE-only，舊entrypoints拒絕adopt。backup完成依原狀態恢復；local restore proof用 `KEEP_STOPPED` 完成，recover-admin完成亦維持來源原本stopped，絕不在成功/錯誤路徑默默start。

`recovery-candidate.json`是bundle/proof locator，不是授權；RECOVER_ADMIN在任何停止/Java連線前檢查完整backup+proof，取得同一registry新operationId後，在lease內重新hash所有manifest/artifact/proof、核實完整source identity及20-table+files原始snapshot完全相等，再attach現有Java帳號流程。prior complete/released proof只有完整durable lineage且目前raw相等才可用；不要求巢狀/永久佔鎖，不接受receipt-only、舊session/audit忽略或local-as-offsite。backupId僅由已驗proof綁入lease供原audit，不擴六欄Result。

`runOwnedHelper`只接受workflow固定kind，不接受任意argv/path/image/network/UID。Docker每次create後、start前完整inspect；running、exit後與cleanup再以當次full container ID核對 exact name/imageID/platform/release labels/argv/env/uid:gid/read-only rootfs/restart=no/privileged=false/cap-drop ALL/no-new-privileges/no ports/socket/devices/host namespaces/精確mount+network。只有該full ID可移除，重新inspect證明不存在；不以labels/application_name豁免任意container。helper與PG工具分清：inventory/revoker在唯一JDBC connection公開ready tuple `{operationId,side,pid,backendStartEpoch,db,role,clientAddr,applicationName,readOnly:true}`，host用完整container/network/IP及pg_stat_activity核對後才送private permit；同connection、固定transaction、不換PID、不多backend。`pg_dump/pg_restore`無JDBC handshake，只接受觀察到的唯一精確tool process/container/IP/application_name與backend，結束後證明零backend；application_name單獨不算證據。不得同時掛source/target網路/卷。

Host 0600 request/secret/output由numeric host UID擁有；需在固定image bounded no-network preflight核對API UID/GID、JRE/JDBC/media read/write權限及工具路徑，不chmod/chown舊media，不增capability。media-restore以匹配API numeric UID/GID寫新空卷，package由已驗open FD/stdin串流，不能把host secret/root bundle掛進去。無法證明即 `ADAPTER_UNSEALED`。固定保守限制：request 64KiB、manifest 1MiB、ready/permit 4KiB、helper receipt/stdout 16KiB、stderr evidence 4MiB、package header 64MiB、object count 1,000,000、key 1..4096 UTF-8 bytes；aggregate package不超private filesystem可用空間扣除max(512MiB,10%)。30s Docker管理、15s JDBC connect、30s ready-permit、10min inventory、120s API health、10min browser stage、各dump/restore/media最多2h、全workflow最多6h；RTO仍從原incidentStartedAt計算，4h是目標非強制kill deadline。

Java離線分流僅新增exact first-token `ops-inventory`與`ops-revoke-restored-sessions`，位於原 `contains("maintenance")`分支之後、任何Spring啟動之前；原maintenance contains/錯位拒絕語義與Java Operation enum全保留。錯位/重複ops token在Spring前拒絕。用既有API image `/app/app.jar`，不新增Boot main/classifier/runtime依賴、不新增build.gradle JavaExec。Inventory/revoke request有固定schema、private secret path；DB password不在request/argv/env/log/artifact。啟動前僅已有明確 `RAW_VERIFIED`證據的revoke mode可進，成功同一DB transaction寫sessions+AUTH後phase `SESSIONS_REVOKED`；audit/commit失敗不start。

Child smoke只用child `web` network中的sealed ephemeral Chromium helper，alias固定 `front/back/admin/api.cms.test:8443`，只掛child CA至一次性NSS；Compose三services均無published ports，禁止改host forwarder/forward.mjs。child ingress只有在raw相等、session撤銷commit、同版API health及identity核對後才啟。browser無DB network/volume、無secret mount；一次性private Unix socket傳送合成管理員密碼，不使用argv/env/log/artifact。合成帳號密碼只在root orchestrator記憶體跨capture/restore保留，分別交付browser各stage；PP1b舊session不可作可恢復密碼。smoke後stop child ingress/API，保留child失敗資料與lease證據。

Offline request/ready/permit/result均strict UTF-8 canonical JSON、LF、required keys且拒unknown/duplicate；request/ref不構成ownership證明。`instanceId`只能由32 lowercase hex runId決定性格式化為UUID，不生成隱藏random metadata。所有工具shell:false、fixed argv、bounded timeout；stdout只有固定phase/code/count/hash receipt，private artifact不得上普通log。

### 4.3 Raw inventory與媒體完整性

DB必須恰為以下20個relation，缺失/額外relation或column均`SCHEMA_UNSUPPORTED`；column allowlist與完整catalog metadata見本節表與 §4.1。所有query只從已核准常數組成，逐欄執行 `SELECT "column"::text AS "column"`；同一唯讀 `REPEATABLE_READ` transaction先固定UTC、DateStyle ISO YMD、IntervalStyle iso_8601、bytea_output hex、extra_float_digits=3，再以`getString`讀nullable PostgreSQL text。原SQL schema/type/constraints/index仍從catalog取得，不能用cast後ResultSet metadata。此設計不依賴JDBC bytea/timestamp特例，array/jsonb/large numeric按PostgreSQL text與固定session設定序列化；來源及還原端使用相同PG16設定。每table row map恰含allowlist columns；rows按canonical UTF-8 bytes排序；schema hash與rows hash分開，比完整Flyway history rows/checksum/null/success，不只最高版本。

精確20 relation/column allowlist即 §4.1 表格（19 cms tables + locked Flyway 11.7.2 `flyway_schema_history`）。migration新增/刪欄前必先更新此allowlist及測試；不得用「capture/restore兩側動態欄位剛好相等」接受manual drift。完整metadata包括ordinal/name/dataType/udt/nullability/length/precision/scale/time precision/default/identity/generated expression及PK/unique/FK/check/index；snapshot與target須完全相等。`cms_media`與variant內容另按 §4.1固定query驗DB；全檔案walk no-follow，path component、hardlink、regular file、before/after identity/hash均核對；declared variants、soft-deleted objects、orphans均保留及比較，從不修復或刪除source。

PP1a matched API image需在實際封板前以bounded no-network probe證明JRE、JDBC、ImageIO與media numeric UID/GID；目前image User未封定，不能假稱host 0600可讀。unsupported UID/GID/PG text edge/host filesystem link identity即 `ADAPTER_UNSEALED`，不得加權限或動態放寬allowlist。

### 4.4 Local capture與restore phase

Local proof由單次 `RESTORE_VERIFY_LOCAL` v2 lease串起：PRECHECK→SOURCE_QUIESCED→LOCAL_CAPTURED→LOCAL_VERIFIED→TARGET_RESERVED→TARGET_BLANK→DB_RESTORED→MEDIA_RESTORED→RAW_VERIFIED→SESSIONS_REVOKED→API_HEALTHY→INGRESS_STARTED→BROWSER_VERIFIED→TARGET_STOPPED→COMPLETE。每個phase durable BEGIN/END均綁lease/proof hash；unknown/crash停在原phase、保留lock/target，不自動重試。source在capture、restore、browser期間一直stopped及identity/raw一致；local proof完成後保持stopped。普通backup若原始API為running，僅依 `RESTORE_ORIGINAL` 在原容器/同版可證明健康後恢復；若原本stopped則永不start。

Target流程不走normal PP1a prepare/verify；受控adapter只create fresh project/DB/media/network/container並持有RESTORE marker，無port映射、無自動cleanup。PG先建立且證明schema/Flyway均空；API與ingress先create但stopped。restore DB與media成功後完整RAW_VERIFIED（20 tables/schema/Flyway/files/source lineage），只允許同一revoke transaction所產生的具名session revoked_at變更與一筆AUTH event。startup delta預設**零**；任何未預先指定的seed/catalog/purge/scheduler寫入為`STARTUP_MUTATION`，停止target並回root決策，不預先加入例外。任何既有table不可忽略。API exact image/jar/frontend/config provenance與health通過後才啟child ingress/browser。smoke完整成功後停止child API/ingress，出完整proof；target仍RESTORE-only。

若revoke已commit後crash，舊target永久不可當blank/重試；保持停隔離，原incidentStartedAt不重設，下一次需新operationId、新target與原immutable backup完整重還原。失敗不刪source、target、bundle、volume、lock或receipt。正式recover-admin只接受proof locator指向完整成功/released proof，再以新同registry operation revalidate proof bytes、bundle及source完整raw/files；保持原stopped狀態，不將同host local proof冒充offsite。

### 4.5 Observable acceptance、錯誤與安全

Local evidence需由root保存實際 run ID、命令（無secret）、完整 image/container/network/volume IDs的私有摘要、manifest/bundle hashes、20-table row/hash比較、media count/hash比較、exit codes與elapsed time。commit／clean worktree狀態不冒充本地證據；dirty build需以PP1a labels與jar SHA明示。

固定 error codes：`INPUT_INVALID, LOCK_BUSY, ADAPTER_UNSEALED, WRITER_NOT_QUIESCED, SOURCE_CHANGED, SCHEMA_UNSUPPORTED, UNSAFE_MEDIA_PATH, MISSING_MEDIA_OBJECT, MEDIA_HASH_MISMATCH, MEDIA_SIZE_MISMATCH, IMAGE_VARIANTS_INCOMPLETE, CAPTURE_FAILED, LOCAL_VERIFY_FAILED, COPY_FAILED, BUNDLE_MISMATCH, TARGET_NOT_BLANK, TARGET_NOT_OWNED, RESTORE_FAILED, RAW_MISMATCH, SESSION_REVOKE_FAILED, STARTUP_MUTATION, SMOKE_FAILED, INTERRUPTED, OBJECTIVE_UNKNOWN`。`OpsError={code,phase,operationId}`，message恆等於code；不攜帶cause/argv/env/SQL/secret。CLI exit 2 input; 3 state/ownership/format; 4 lock/quiescence; 5 IO/hash/dump/copy failure; 6 adapter or lease unsealed; 7 restore/raw/session/startup/smoke failure; 10 interrupted/unknown outcome。通知失敗不在PP1c假設；primary code不被後續記錄覆蓋。unknown/crash只read-only inspect，沒有auto resume、force unlock或重播。

測試需逐一有named cases，至少：unsafe/missing/orphan/hash/path/link/media variant failures；source changed during inventory；additional DB writer/session／API restart；dump nonzero與zero-exit truncated dump；disk full/copy/hash mismatch；manifest-release mismatch；blank-target rejection before writes；wrong tuple/missing artifact before writes；restore DB/media crash；20-table raw mismatch；Flyway checksum mismatch；session update/audit rollback；session-commit-before-API crash；API start health/smoke failure；同批重新建立fresh second target；root source/volume never mutated。成功restore smoke重用既有 API/entry/media contract：正式測試admin login；published media original/thumbnail/web hashes；private/draft/replaced unpublished media anonymous denial；revision/ref/index/attachment readback；restart前後不變；新audit/session變化只在上述 allowlist。測試不能只assert adapter invocation；PG integration需真PostgreSQL16，local restore root acceptance須真不同DB/media volumes與PP1a isolated runtime。

FM對照：

| FM | 情境／期望 | 覆蓋 |
| --- | --- | --- |
| PP1-FM08 | missing file、incorrect hash、partial image、unsafe/orphan drift：拒 complete、不改source、診斷碼固定 | `PP1cInventoryTests`、`PP1cBackupFaultTests`，C03–C08 |
| PP1-FM09 | second operation / live writer / maintenance restart：拒 capture，lease保留且不開新writer | `PP1cLeaseQuiescenceTests`，C07–C08 |
| PP1-FM10 | dump/media/disk/restore/API smoke故障：nonzero、舊bundle/source不變、失敗target隔離保留 | backup/restore fault suites，C07–C15 |
| PP1-FM12 | nonblank target、wrong batch/release/hash：第一次write之前拒絕、不刪除任何資源 | `PP1cRestorePreflightTests`，C09–C10 |
| PP1-FM11 | 真正離機、key custody、通知receipt：不在PP1c證明；local copy不得當pass | PP1d / owner environment acceptance |
| PP1-FM13/14/15 | upgrade, scheduler/notifications, complete production journey | PP1d / PP1-AC06; 不屬本波 |

## 5 檔案型別與執行元件

所有Java public records放 `com.fallrising.cms.ops.RecoveryInventory`，新 records只有：`AssetRow(UUID id,String contentType,String byteSize,String storedBytes,String checksumSha256,Integer width,Integer height,String status)`；`VariantRow(UUID mediaId,String variant,String contentType,String byteSize,Integer width,Integer height,String objectKey)`；`FileRow(String objectKey,String byteSize,String sha256,String classification)`；`ColumnInfo(String ordinalPosition,String name,String dataType,String udtSchema,String udtName,boolean isNullable,String characterMaximumLength,String numericPrecision,String numericScale,String datetimePrecision,String columnDefault,boolean isIdentity,String identityGeneration,boolean isGenerated,String generationExpression)`；`TableSnapshot(String tableName,List<ColumnInfo> columns,List<Map<String,String>> rows,String snapshotSha256)`；`Inventory(int version,List<FileRow> files,List<TableSnapshot> tables,String dbSnapshotSha256)`。nullable cells原樣表示null；immutable defensive copies，不用拒絕null的`Map.copyOf`。所有byte counts以十進位字串，UUID canonical lowercase，排序規則固定。Inventory API不回DB content到log/stdout。

`RecoveryInventory.inspect(Connection,Path): Inventory`純read-only；`RecoveryInventoryMain.run(String[],Map<String,String>,PrintStream): int`解析strict request、接明確ref/credential supplier、開關connection；不啟動Spring/seed/flyway/scheduler。Node adapter methods只接受immutable owned references與operation object，不接任意command/SQL path。Pure tests可inject假的process/filesystem/database；實際 acceptance必透過PP1a existing immutable tool images與PP1b lease，不允許test fake替代real artifact restore。

Copy/encryption boundary：PP1c核心不新增archive工具／dependency；`media.package`是父契約唯一media artifact，payload需保持每個POSIX objectKey與原始bytes逐file還原相等。封裝格式唯一候選為PP1CMEDIA1，仍須root review後才能施工；目前沒有可直接copy的已實作artifact。受保護copy fixture僅同host權限＋hash核驗；若root決定要求本地加密fixture，僅可提出已版本固定的 Node 24 stdlib `crypto` envelope作獨立提案，精確format、nonce/tag/keyfile permissions與readback test待root核准；本草案沒有把它列為實作前置或安全能力。真正加密外送與金鑰災難恢復必須等PD03選定已存在工具並封板，不新增S3/套件/服務。

## 6 順序任務卡（候選；DRAFT，subwave ≤30、每卡估算含手寫測試）

33張候選卡：19張C核心（C04拆a/b）、3張L、3張H、3張T、4張R、1張E。四個子波分別7/7/9/10。所有estimate包含手寫測試，未經實測；每卡實際超400行須拆分且不可刪安全斷言。Root選定的架構為DRAFT proposal，等待獨立review及先決implementation acceptance，不是仍待回答的architecture question。

### PP1c C01 — strict manifest Red
- 目標：canonical/schema拒絕行為先紅。
- 輸入：§4.1與parent §4.1–4.2。
- 精確可寫路徑：scripts/ops/recovery-protocol.mjs; scripts/ops/recovery-protocol.test.mjs。
- 步驟：建安全scaffold；測duplicate/unknown/noncanonical UTF-8、batch/hash/order/size/path/secret canary。
- 可觀察完成條件：named assertion Red、無compile/import錯。
- 驗證命令：node --test scripts/ops/recovery-protocol.test.mjs（Red卡須保留named預期行為失敗；此DRAFT author task未執行產品命令）。
- AC/FM：AC03 FM08/12。
- 預估：240 handwritten lines，含tests，上限400。


### PP1c C02 — manifest Green
- 目標：strict parser/schema/hash與receipt。
- 輸入：C01；parent canonical schema。
- 精確可寫路徑：同C01兩檔。
- 步驟：canonical byte equality後schema；綁artifact/release；固定failure輸出。
- 可觀察完成條件：所有invalid拒絕、合法bytes穩定、無canary。
- 驗證命令：node --test scripts/ops/recovery-protocol.test.mjs（Red卡須保留named預期行為失敗；此DRAFT author task未執行產品命令）。
- AC/FM：AC03 FM08/10/12。
- 預估：280 handwritten lines，含tests，上限400。


### PP1c C03 — inventory Red
- 目標：暴露media/raw unsafe/path/schema錯誤。
- 輸入：MediaService、ImageVariants、LocalDiskMediaObjectStore、migration allowlist。
- 精確可寫路徑：RecoveryInventory.java; RecoveryInventoryTests.java。
- 步驟：PNG/PDF/decode-null/orphan/deleted fixtures；missing/unsafe/changed/extra-column行為。
- 可觀察完成條件：預期安全assertion Red、source不變。
- 驗證命令：./gradlew test --tests *RecoveryInventoryTests --no-daemon --no-parallel（Red卡須保留named預期行為失敗；此DRAFT author task未執行產品命令）。
- AC/FM：AC03 FM08/12。
- 預估：340 handwritten lines，含tests，上限400。


### PP1c C04a — DB inventory Green
- 目標：20 relation固定column/catalog/raw snapshot。
- 輸入：C03；V2–V9、V7/V10、Flyway 11.7.2。
- 精確可寫路徑：RecoveryInventory.java; RecoveryInventoryTests.java; RecoveryInventoryIntegrationTests.java。
- 步驟：逐欄::text、固定session、REPEATABLE_READ；metadata另取；完整Flyway逐row compare。
- 可觀察完成條件：PG16證query-only與schema/raw equality；unknown relation/column拒絕。
- 驗證命令：./gradlew test --tests *RecoveryInventoryTests --no-daemon --no-parallel; ./gradlew integrationTest --tests *RecoveryInventoryIntegrationTests --no-daemon --no-parallel（Red卡須保留named預期行為失敗；此DRAFT author task未執行產品命令）。
- AC/FM：AC03 FM08/12。
- 預估：380 handwritten lines，含tests，上限400。


### PP1c C04b — media composition Green
- 目標：同snapshot組合DB與逐檔media完整性。
- 輸入：C04a與ImageVariants、PP1CMEDIA1 header。
- 精確可寫路徑：RecoveryInventory.java; RecoveryInventoryTests.java; RecoveryInventoryIntegrationTests.java。
- 步驟：核original/variant/hash/size/dimensions；no-follow files；orphan/deleted保留；null-safe records。
- 可觀察完成條件：兩側完整一致；unsafe/missing/change拒絕且不變source。
- 驗證命令：同C04a Gradle focused命令（Red卡須保留named預期行為失敗；此DRAFT author task未執行產品命令）。
- AC/FM：AC03 FM08。
- 預估：360 handwritten lines，含tests，上限400。


### PP1c C05 — offline inventory dispatch Red
- 目標：精確首token、maintenance優先及Spring前拒絕。
- 輸入：現有CmsApiApplication.main路由與測試。
- 精確可寫路徑：CmsApiApplication.java; CmsApiApplicationTests.java; RecoveryInventoryMain.java; RecoveryInventoryMainTests.java。
- 步驟：建立compile-safe seam；測first/repeated/misplaced tokens、legacy maintenance、Spring spy=0。
- 可觀察完成條件：行為測試Red而非compile Red；舊測試不退化。
- 驗證命令：./gradlew test --tests *CmsApiApplicationTests --tests *RecoveryInventoryMainTests --no-daemon --no-parallel（Red卡須保留named預期行為失敗；此DRAFT author task未執行產品命令）。
- AC/FM：AC03 FM08。
- 預估：240 handwritten lines，含tests，上限400。


### PP1c C06 — offline inventory dispatch Green
- 目標：用既有API image跑offline JDBC inventory。
- 輸入：C05、C04a/b、request/ready/permit/result schema。
- 精確可寫路徑：上述Java四檔。
- 步驟：maintenance後新增exact ops-inventory；strict refs/secret file；single JDBC read-only；固定receipt。
- 可觀察完成條件：Spring不啟動、DB rollback/close、無JavaExec。
- 驗證命令：同C05命令（Red卡須保留named預期行為失敗；此DRAFT author task未執行產品命令）。
- AC/FM：AC03 FM08/12。
- 預估：320 handwritten lines，含tests，上限400。


### PP1c L01 — v1 store extraction
- 目標：抽取持久registry primitives保留v1行為。
- 輸入：PP1b frozen v1 source/tests。
- 精確可寫路徑：maintenance-guard.mjs/.test.mjs; maintenance-store.mjs/.test.mjs。
- 步驟：移private reserve/load/fsync/release；比較原fixture bytes與所有v1回歸。
- 可觀察完成條件：API/schema/ordering/errors不變。
- 驗證命令：node --test scripts/local/maintenance-guard.test.mjs scripts/local/maintenance-store.test.mjs（Red卡須保留named預期行為失敗；此DRAFT author task未執行產品命令）。
- AC/FM：AC02 FM09。
- 預估：350 handwritten lines，含tests，上限400。


### PP1c L02 — LeaseV2 registry
- 目標：同registry strict versioned union和永久operation ID。
- 輸入：L01、T002 schema proposal、G06/G07 freeze。
- 精確可寫路徑：maintenance-store.mjs/.test.mjs; maintenance-workflow.mjs/.test.mjs。
- 步驟：required/null schema；journal BEGIN/END hash；unknown/partial/duplicate/lock cases；no replay/migrate。
- 可觀察完成條件：v1全綠；V2 invalid fail closed並保留lock。
- 驗證命令：node --test scripts/local/maintenance-store.test.mjs scripts/local/maintenance-workflow.test.mjs（Red卡須保留named預期行為失敗；此DRAFT author task未執行產品命令）。
- AC/FM：AC02/03 FM09/10。
- 預估：390 handwritten lines，含tests，上限400。


### PP1c L03 — source/child capability
- 目標：Opaque token綁inode/device、source及單一child。
- 輸入：L02、target ownership rules。
- 精確可寫路徑：maintenance-workflow.mjs/.test.mjs; maintenance-target.mjs/.test.mjs。
- 步驟：WeakMap capability；reserve marker；forgery/second-child/adoption/state tests。
- 可觀察完成條件：無token仿造或target adoption；v1 assertions不變。
- 驗證命令：node --test scripts/local/maintenance-workflow.test.mjs scripts/local/maintenance-target.test.mjs（Red卡須保留named預期行為失敗；此DRAFT author task未執行產品命令）。
- AC/FM：AC02/03 FM09/12。
- 預估：390 handwritten lines，含tests，上限400。


### PP1c H01 — full-ID helper lifecycle
- 目標：安全create/inspect/start/wait/remove。
- 輸入：L02/L03、既有probe生命周期。
- 精確可寫路徑：maintenance-helper.mjs/.test.mjs。
- 步驟：固定kind policy；start前/運行/退出完整inspect；限owned full ID cleanup；Docker故障注入。
- 可觀察完成條件：錯image/argv/env/mount/network/security不start。
- 驗證命令：node --test scripts/local/maintenance-helper.test.mjs（Red卡須保留named預期行為失敗；此DRAFT author task未執行產品命令）。
- AC/FM：AC03 FM09/10/12。
- 預估：390 handwritten lines，含tests，上限400。


### PP1c H02 — JDBC/tool session proof
- 目標：Ready/permit與PG工具observational proof分流。
- 輸入：H01、PG16 inspect/activity contracts。
- 精確可寫路徑：maintenance-helper.mjs/.test.mjs; maintenance-helper-session.test.mjs。
- 步驟：同connection固定PID tuple；full container/network/IP核驗；PG tool唯一process/backend、結束零backend。
- 可觀察完成條件：拒PID change/extra backend/wrong IP/application-name-only。
- 驗證命令：node --test scripts/local/maintenance-helper.test.mjs scripts/local/maintenance-helper-session.test.mjs（Red卡須保留named預期行為失敗；此DRAFT author task未執行產品命令）。
- AC/FM：AC03 FM09/10。
- 預估：390 handwritten lines，含tests，上限400。


### PP1c C07 — backup Red
- 目標：暴露writer race/partial capture failure。
- 輸入：L01–L03、PP1a receipt、C01–C06。
- 精確可寫路徑：local-bundle.mjs; local-bundle.test.mjs。
- 步驟：scaffold + barrier faults：restart/writer/partial dump/media change/cancel/old bundle。
- 可觀察完成條件：行為斷言Red，不是缺class compile紅。
- 驗證命令：node --test scripts/ops/local-bundle.test.mjs（Red卡須保留named預期行為失敗；此DRAFT author task未執行產品命令）。
- AC/FM：AC03 FM08/09/10。
- 預估：320 handwritten lines，含tests，上限400。


### PP1c C08 — lease capture Green
- 目標：同一source LeaseV2產immutable local bundle。
- 輸入：C07、H01–03、C02/C04b、PP1a receipt。
- 精確可寫路徑：local-bundle.mjs; local-bundle.test.mjs。
- 步驟：停寫；dump/media stream；pre/post DB/files compare；atomic marker；依原service state finish。
- 可觀察完成條件：完整lineage/writer proof才LOCAL_VERIFIED；failure留lock/staging。
- 驗證命令：node --test scripts/ops/local-bundle.test.mjs（Red卡須保留named預期行為失敗；此DRAFT author task未執行產品命令）。
- AC/FM：AC03 FM08–10。
- 預估：390 handwritten lines，含tests，上限400。


### PP1c H03 — framed media transport
- 目標：PP1CMEDIA1 bounded stream與UID安全。
- 輸入：C04b、PP1a Node24.18/API UID constraints。
- 精確可寫路徑：scripts/ops/local-media.mjs; local-media.test.mjs。
- 步驟：header/EOF/path/count/capacity/hash驗證；verified FD/stdin restore；拒chmod/chown。
- 可觀察完成條件：trailing/truncated/link/hash/permission均拒絕，bytes相同。
- 驗證命令：node --test scripts/ops/local-media.test.mjs（Red卡須保留named預期行為失敗；此DRAFT author task未執行產品命令）。
- AC/FM：AC03 FM08/10。
- 預估：390 handwritten lines，含tests，上限400。


### PP1c C09 — proof verifier Red
- 目標：測試locator/artifact/source錯配不寫target。
- 輸入：schema、PP1a source hashes、L02。
- 精確可寫路徑：local-recovery-verify.mjs; local-recovery-verify.test.mjs。
- 步驟：改一個proof/artifact/source/raw field；receipt-only/stale sessions/audit。
- 可觀察完成條件：所有preflight fail且stop/helper/write=0。
- 驗證命令：node --test scripts/ops/local-recovery-verify.test.mjs（Red卡須保留named預期行為失敗；此DRAFT author task未執行產品命令）。
- AC/FM：AC02/03 FM08/12。
- 預估：300 handwritten lines，含tests，上限400。


### PP1c C10 — proof verifier Green
- 目標：完整artifact/source/20-table/files proof。
- 輸入：C09、C02/C04a/b、H03、PP1a provenance。
- 精確可寫路徑：同C09兩檔。
- 步驟：重hash每bytes與lineage；比完整source/target schema/raw/files；固定proof receipt。
- 可觀察完成條件：只有完整匹配成功；locator不能授權。
- 驗證命令：node --test scripts/ops/local-recovery-verify.test.mjs（Red卡須保留named預期行為失敗；此DRAFT author task未執行產品命令）。
- AC/FM：AC02/03 FM08/12。
- 預估：390 handwritten lines，含tests，上限400。


### PP1c T01 — private restore prepare
- 目標：新增不走正常prepare/verify的內部child prepare。
- 輸入：PP1a source、L03。
- 精確可寫路徑：scripts/local/prepare.mjs/.test.mjs; restore-target.mjs/.test.mjs。
- 步驟：private mode略8443/host forwarder；綁receipt/ref；normal prepare unchanged；不start services。
- 可觀察完成條件：無publish/pull/source mutation；無法證明則ADAPTER_UNSEALED。
- 驗證命令：node --test scripts/local/prepare.test.mjs scripts/local/restore-target.test.mjs（Red卡須保留named預期行為失敗；此DRAFT author task未執行產品命令）。
- AC/FM：AC03 FM12。
- 預估：380 handwritten lines，含tests，上限400。


### PP1c T02 — create-only blank target
- 目標：建立distinct fresh PG/media與stopped API/ingress。
- 輸入：T01、L03、H01。
- 精確可寫路徑：restore-target.mjs/.test.mjs; maintenance-target.mjs/.test.mjs。
- 步驟：exclusive project；PG first blank query；API/ingress create-stopped；full inspect。
- 可觀察完成條件：existing/nonblank/shared target在write前拒絕。
- 驗證命令：node --test scripts/local/restore-target.test.mjs scripts/local/maintenance-target.test.mjs（Red卡須保留named預期行為失敗；此DRAFT author task未執行產品命令）。
- AC/FM：AC03 FM12。
- 預估：390 handwritten lines，含tests，上限400。


### PP1c C11 — restore Red
- 目標：證明restore順序/故障target不可重用。
- 輸入：T02、C09/C10、C04a/b、H03。
- 精確可寫路徑：local-restore.mjs; local-restore.test.mjs。
- 步驟：phase scaffold；fault dump/media/raw/revoke/API；assert source unchanged/isolation。
- 可觀察完成條件：named behavior Red、非compile error。
- 驗證命令：node --test scripts/ops/local-restore.test.mjs（Red卡須保留named預期行為失敗；此DRAFT author task未執行產品命令）。
- AC/FM：AC03 FM10/12。
- 預估：340 handwritten lines，含tests，上限400。


### PP1c C12 — restore core Green
- 目標：還原至空target並驗RAW_VERIFIED。
- 輸入：C11、T02、H01–03、C10、C04a/b。
- 精確可寫路徑：local-restore.mjs; local-restore.test.mjs。
- 步驟：PG16 single transaction restore; no clean/create/jobs；media restore；full raw/files/release compare。
- 可觀察完成條件：只有全等到RAW_VERIFIED；retry需new target/ID。
- 驗證命令：node --test scripts/ops/local-restore.test.mjs scripts/ops/local-recovery-verify.test.mjs（Red卡須保留named預期行為失敗；此DRAFT author task未執行產品命令）。
- AC/FM：AC03 FM10/12。
- 預估：390 handwritten lines，含tests，上限400。


### PP1c C13 — revoke Red
- 目標：暴露sessions/audit半提交。
- 輸入：C12、JdbcIdentityStore.insertAudit。
- 精確可寫路徑：RestoreSessionRevoker.java; unit/PG integration tests。
- 步驟：audit/update/commit faults；API-start=0；非session tables unchanged。
- 可觀察完成條件：rollback assertion Red而非compile error。
- 驗證命令：./gradlew integrationTest --tests *RestoreSessionRevokerIntegrationTests --no-daemon --no-parallel（Red卡須保留named預期行為失敗；此DRAFT author task未執行產品命令）。
- AC/FM：AC02/03 FM10/12。
- 預估：280 handwritten lines，含tests，上限400。


### PP1c C14 — revoke Green
- 目標：atomic revoke + exact AUTH receipt。
- 輸入：C13、parent §5.4。
- 精確可寫路徑：同C13 Java/test paths。
- 步驟：同transaction single timestamp；preallocated ID；revoke all active；insert exact AUTH；commit receipt。
- 可觀察完成條件：PG證session delta + 1 AUTH；fault rollback/no API。
- 驗證命令：同C13 PG integration command（Red卡須保留named預期行為失敗；此DRAFT author task未執行產品命令）。
- AC/FM：AC02/03 FM10。
- 預估：360 handwritten lines，含tests，上限400。


### PP1c R01 — proof locked revalidation
- 目標：Locator轉完整lineage，lease內驗source。
- 輸入：C10、L02/L03、accounts §10.1a。
- 精確可寫路徑：local-recovery-verify.mjs/.test.mjs; maintenance-workflow.mjs/.test.mjs。
- 步驟：preflight before stop；under lock rehash proof/bundle/source raw/files；reject stale/receipt-only。
- 可觀察完成條件：只有complete released proof/current equality接受。
- 驗證命令：node --test scripts/ops/local-recovery-verify.test.mjs scripts/local/maintenance-workflow.test.mjs（Red卡須保留named預期行為失敗；此DRAFT author task未執行產品命令）。
- AC/FM：AC02 FM09/12。
- 預估：390 handwritten lines，含tests，上限400。


### PP1c R02 — recover CLI attachment
- 目標：接現有recover命令，不改六欄result或狀態。
- 輸入：R01、accepted G06/G07。
- 精確可寫路徑：maintenance.mjs/.test.mjs; maintenance-workflow.mjs/.test.mjs。
- 步驟：proof before connection/stop；single registry attach；finish KEEP_STOPPED；no nested lock。
- 可觀察完成條件：v1 FRESH_INIT全回歸；stopped recovery不restart。
- 驗證命令：node --test scripts/local/maintenance.test.mjs scripts/local/maintenance-workflow.test.mjs（Red卡須保留named預期行為失敗；此DRAFT author task未執行產品命令）。
- AC/FM：AC02 FM09。
- 預估：380 handwritten lines，含tests，上限400。


### PP1c R03 — Java guard projection
- 目標：Java只接受host驗證的proof projection。
- 輸入：accepted G06、accounts policy、R01/R02。
- 精確可寫路徑：LocalMaintenanceGuard.java; IdentityMaintenanceCommandTests.java。
- 步驟：strict V2 proof projection；backupId僅供原audit；不擴Operation。
- 可觀察完成條件：六欄result及v1 predicate不變；無bypass。
- 驗證命令：./gradlew test --tests *IdentityMaintenanceCommandTests --no-daemon --no-parallel（Red卡須保留named預期行為失敗；此DRAFT author task未執行產品命令）。
- AC/FM：AC02 FM09/12。
- 預估：390 handwritten lines，含tests，上限400。


### PP1c R04 — offline revoke dispatch
- 目標：精確第一token在Spring前進transaction core。
- 輸入：C13/C14、existing maintenance routing。
- 精確可寫路徑：CmsApiApplication.java/CmsApiApplicationTests.java; RestoreSessionRevokerMain.java/tests。
- 步驟：maintenance branch先保留；精確首token；strict request/handshake；reject misplaced/repeated。
- 可觀察完成條件：Spring不啟動；舊路由不變；只commit success。
- 驗證命令：./gradlew test --tests *CmsApiApplicationTests --tests *RestoreSessionRevokerMainTests --no-daemon --no-parallel（Red卡須保留named預期行為失敗；此DRAFT author task未執行產品命令）。
- AC/FM：AC02/03 FM10。
- 預估：360 handwritten lines，含tests，上限400。


### PP1c T03 — child Chromium/socket smoke
- 目標：child web network內一次性Chromium與密碼傳遞。
- 輸入：T02/C14/matched health、PP1a CA/browser。
- 精確可寫路徑：scripts/ops/local-restore-smoke.mjs/.test.mjs; 不改forward.mjs。
- 步驟：eligibility gates；NSS trust；one-use Unix socket；no argv/env/mount/host route；teardown。
- 可觀察完成條件：premature run拒絕；source/DB不可達；browser/child stopped。
- 驗證命令：node --test scripts/ops/local-restore-smoke.test.mjs（Red卡須保留named預期行為失敗；此DRAFT author task未執行產品命令）。
- AC/FM：AC03/06 FM10/15。
- 預估：390 handwritten lines，含tests，上限400。


### PP1c C15 — lifecycle Red
- 目標：暴露release/startup/smoke前置不足。
- 輸入：C14/T03/PP1a receipts；zero startup delta。
- 精確可寫路徑：local-restore.mjs/.test.mjs; local-recovery-verify.mjs/.test.mjs。
- 步驟：fault image/jar/dist/config/flyway/revoke/startup/health/privacy；route spy=0。
- 可觀察完成條件：behavior Red、target retained/stopped。
- 驗證命令：node --test scripts/ops/local-restore.test.mjs scripts/ops/local-recovery-verify.test.mjs（Red卡須保留named預期行為失敗；此DRAFT author task未執行產品命令）。
- AC/FM：AC03/06 FM10/12/15。
- 預估：350 handwritten lines，含tests，上限400。


### PP1c C16 — lifecycle Green
- 目標：依序API health→child ingress→browser smoke。
- 輸入：C15/T03、release and revoke receipts。
- 精確可寫路徑：same C15 paths。
- 步驟：assert gate order；post-start raw delta；unexpected startup mutation fail；stop child。
- 可觀察完成條件：exact source provenance and smoke proof; RESTORE-only target。
- 驗證命令：same C15 Node command（Red卡須保留named預期行為失敗；此DRAFT author task未執行產品命令）。
- AC/FM：AC03/06 FM10/12/15。
- 預估：390 handwritten lines，含tests，上限400。


### PP1c C17 — root local drill
- 目標：真實第二copy+不同空target閉環。
- 輸入：C16、PP1a verified、accepted PP1b guards。
- 精確可寫路徑：root evidence only; no added product paths。
- 步驟：root runs stopped source capture, fresh project/volumes restore/raw/revoke/API/child browser; preserve IDs/hashes。
- 可觀察完成條件：actual identities/proof recorded; local only, no SLA claim。
- 驗證命令：root-approved runtime+PG+browser commands with captured outputs（Red卡須保留named預期行為失敗；此DRAFT author task未執行產品命令）。
- AC/FM：AC03/06 FM08–12/15。
- 預估：300 handwritten lines，含tests，上限400。


### PP1c C18 — handoff/evidence
- 目標：獨立檢查、CI、文件交接。
- 輸入：C01–C17 and root evidence。
- 精確可寫路徑：no additional product paths。
- 步驟：scope/secret/hash checks; required tests and real evidence mapped; preserve PD follow-ups。
- 可觀察完成條件：all required evidence visible; no offsite claim。
- 驗證命令：root required repo gates and CI（Red卡須保留named預期行為失敗；此DRAFT author task未執行產品命令）。
- AC/FM：AC02/03 FM08–12。
- 預估：250 handwritten lines，含tests，上限400。


### PP1c E01 — independent evidence gate
- 目標：由root完成獨立交付證據審核，不新增產品功能。
- 輸入：C01–C18、L01–L03、H01–H03、T01–T03、R01–R04及實際run receipts。
- 精確可寫路徑：root-owned coordination report/evidence；無產品路徑。
- 步驟：逐項映射CI、unit/PG/integration/browser與真restore輸出；核source hashes、scope、secret scan、停機狀態及正式未決gate。
- 可觀察完成條件：required checks均有可追溯證據；明列failed/skipped/unrun；不把local copy說成offsite。
- 驗證命令：root依task evidence-gate及repo-required CI執行，結果逐項記錄於root evidence。
- AC/FM：PP1-AC02/03；FM08–FM15。
- 預估：0 product lines，含root review；驗收工作不是零成本。

#### 子波與依賴
- A（7）：C01→C02；C03→C04a→C04b；C05→C06。
- B（7）：L01→L02→L03；H01→H02；C07→C08；H03依C04b。
- C（9）：T01→T02；C09→C10；C11→C12；C13→C14；H03。
- D（10）：R01→R02→R03；R04依C14；T03依T02/C14；C15→C16；C17依C16；C18→E01。G06/G07先接受。

## 7 測試規格與驗收命令

| 測試／層級 | Fixture／斷言 | 卡 |
| --- | --- | --- |
| `RecoveryProtocolTests.PP1c_*` node:test | strict manifests、all artifact hashes、wrong release/batch、unknown/duplicate keys、secret canary output exclusion | C01/C02 |
| `RecoveryInventoryTests.PP1c_*` JUnit | TempDir PNG/PDF/decode-null, symlink/hardlink/orphan/deleted media, object bytes and DB metadata stay unchanged | C03/C04b |
| `RecoveryInventoryIntegrationTests.PP1c_*` PostgreSQL16 | 20-table raw rows, full Flyway/checksum, REPEATABLE_READ, query-only behavior, DB failure no completion receipt | C04a/C04b |
| `RecoveryInventoryMainTests.PP1c_*` JUnit | request refs, unreadable/unsafe secret file, no Boot context, no raw row output | C05/C06 |
| `local-bundle.test.mjs PP1c_*` node:test | fake barrier, writer/session/API restart, pg dump command nonzero/truncated, disk full, media change, interrupted transaction; source/older bundle unchanged | C07/C08 |
| `local-recovery-verify.test.mjs PP1c_*` node:test | exact PP1a image/jar/dist/ingress and matching manifest dump/media/Flyway hashes | C09/C10/C15/C16 |
| `local-restore.test.mjs PP1c_*` node:test | no write before preflight; fake transaction/adapter order; fault after each stage; source never touched | C11–C16 |
| `RestoreSessionRevokerIntegrationTests.PP1c_*` PG integration | all old sessions revoked and one AUTH event atomic; injected audit/commit failure rolls back; no API start | C13/C14 |
| `e2e-pp1-local/recovery.spec.ts PP1cFM15_isolatedRestoreJourney` Playwright | root-owned restored project only; login via test-owned account, public/private distinction, revision/version, API process restart; no skip treated success | C17 |

Focused commands (future implementation only; not executed while authoring):

```bash
node --test scripts/ops/recovery-protocol.test.mjs
./gradlew test --tests '*RecoveryInventoryTests' --tests '*RecoveryInventoryMainTests' --no-daemon --no-parallel
./gradlew integrationTest --tests '*RecoveryInventoryIntegrationTests' --tests '*RestoreSessionRevokerIntegrationTests' --no-daemon --no-parallel
node --test scripts/ops/local-bundle.test.mjs scripts/ops/local-recovery-verify.test.mjs scripts/ops/local-restore.test.mjs
```

Actual local drill command composition still must be frozen against PP1b G07 tool wrapper/API and PP1a prepare/verify APIs before DOC_READY; C17 does not run commands through a fake `docker` implementation. Full root gate at integration PR includes existing `./gradlew test`, `./gradlew integrationTest`, npm test/lint/typecheck/build/test:bundle/measure:bundle, e2e:mock and PP1a scoped real runtime/browsers; these are not run or claimed in this document phase. A root-owned real drill must separately capture command/output receipts and independent evidence review; unit/PG tests alone cannot mark PP1-AC03 complete.

## 8 Failure modes and phase receipts

| Failure | Result | Card |
| --- | --- | --- |
| bad schema/secret ref/wrong run ID | exit 2/3, no spawn/write, fixed error only | C01–06 |
| lease unavailable, duplicate operation, live API/PG session, startup/restart writer | exit 4/6, no capture; common lock/reservation follows PP1b UNKNOWN retention rule | C07–08 |
| missing/changed/orphan unsafe bytes, image partial variants, SQL/read failure | no local-complete marker; retain all source files/rows | C03–08 |
| dump process failure despite partial output, copy/disk/hash failure | staging retained as failure evidence, old success immutable, no destructive cleanup | C07–08 |
| altered/mismatched manifest, dump, media, image, jar, dist, Flyway row | reject before target writes | C09–10 |
| nonblank, source-equal, shared/unknown target project/volume | reject before first mutating command; no rm/down-v | C11–12 |
| partial pg restore, media hash mismatch, raw 20-table difference | target remains isolated; no session revoke/API start; don't resume into same target | C12–14 |
| revoke/audit/commit fault | same transaction rollback; API start 0; no verified receipt | C13–14 |
| revoke committed then crash, matched API start/smoke fails | preserve target stopped/isolated; same incident time; next attempt requires new operation ID+fresh target+original complete bundle | C15–17 |
| genuine offsite/key/notification/scheduler failure | PP1c makes no success claim; PP1d/owner decision required; current evidence remains local-only | PP1d |

## 9 Open decisions and weaker-implementer walk

These are not silently assumed; until root resolves the design/API questions this document stays DRAFT and PP1c cannot be handed to product workers.

| Decision/blocker | Proposal for root review | Blocks |
| --- | --- | --- |
| Shared LeaseV2 implementation/API | Architecture is specified in §4.2 but remains unimplemented and unaccepted. Root must verify G06/G07 freeze, preserve v1 regression semantics, exact registry paths/schema and account attachment hooks before C07/L/R cards. | L01–L03, C07 onward |
| Bundle has raw DB credentials/session/content, private inventory rows, media | local root/run/artifact roots0700; files0600; no raw inventory stdout/log; path/link checks, fixed owned copy; keep local-copy state separate from external/offsite gate. | all artifact cards |
| Restore identity state intentionally changes sessions and app may make normal startup writes | raw all-20-table match before session transaction; after it allow only changed session revoked_at values and exactly one specified AUTH row. Startup allowance defaults to zero; any other write is STARTUP_MUTATION and returns for a new decision. PP1a/PP1b verifiers provide freshness truth. | C14–17 |
| Session revocation helper/API ownership unclear | The event action/detail/surface is fixed in PP1-recovery §5.4; implementation must use one datasource transaction, pre-generated audit ID and `JdbcIdentityStore.insertAudit`, with real PG rollback evidence. Adapter/class/test wiring remains unimplemented. | C13–14 |
| custom dump validity/version compatibility | use PG16 pinned image ID from same PP1a run; require `pg_dump --version` and `pg_restore --version` major16 and actual server `server_version_num` major16; full dump parse/restore into fresh target, not only dump command exit 0. Confirm exact invocation/mount/UID and single-backend observations against the frozen shared helper API; no unapproved guard exemption. | C07–12 |
| filesystem file identity / hardlink proof portability | component Linux PP1a scope; use `lstat`, no-follow open and link-count check; if host API cannot prove no hardlink or directory durability, reject ADAPTER_UNSEALED, do not relax on unsupported fs. | C03–08 |
| encryption format/key source | no encryption invented for a same-host fixture. PD03 must name existing offsite tool, recipient/key custody and disaster-retrievable key proof. Any Node crypto envelope is a separate root-approved proposal with versioned format and key lifecycle; no key in source host alone. | Offsite PP1d/formal gate |
| PP1c acceptance vs approved daily/offsite/RPO/RTO AC03 | Root must record two distinct states: local DB/media restore verified vs full AC03 not satisfied until external destination, key recovery, schedule and real measured RPO/RTO evidence. Local second directory is never marked `VERIFIED_OFFSITE`. | C17/whole PP1 |
| RTO start and timing | use PP1 owner's incidentStartedAt; isolated drill start equals retrieval start; monotonic elapsed plus UTC consistency, include operator/tool/artifact acquisition. No reset timer across fresh-target retry. Root confirms exact receipt math before code. | C17 |
| actual startup mutations | default allowed startup delta is zero; same-version `Flyway validate` only and no schema upgrade. Any observed non-revoke write leaves isolated and returns for a new owner decision; no prefilled allowlist. | C15–17 |

Five-card weaker-worker walk:

1. **C04a/C04b inventory Green:** implementer knows the exact relation/column-name allowlists from the pinned migration release, catalog metadata and full Flyway checksums; C04a owns DB rows/schema, C04b composes those rows with media files/variants. Unsupported extra table/column fails before hashing. A missing declared web variant fails even if original exists; a file without DB row is copied/classified, never deleted.
2. **C08 capture:** writer proof comes from PP1b lease/session inspector—not HTTP method filtering. A DB or API restart race invalidates quiescence. Dump, media, manifest and all PP1a artifact provenance share one backupId and release binding. Existing last bundle remains untouched; local copy cannot upgrade itself to offsite success.
3. **C10 verifier:** checksum equality alone is not sufficient: target/source IDs, image labels/actual jar, dist/ingress, Flyway rows, dump, inventory and every media object must bind to same run/release. Corrupt marker or a different worktree dirty build rejects before restore.
4. **C12/C14 restore:** target is newly created and distinct; never empty an existing one. Restore full DB then media, compare all 20 raw tables and file hashes. Only afterward execute one atomic session revoke+AUTH row; audit failure leaves API stopped. API never starts before commit receipt.
5. **C17 local real drill:** second directory remains on source host, so report it as local protected-copy fixture; use fresh project/DB/media volumes and same release. Keep source ingress disconnected; only after RAW_VERIFIED, committed revoke and matched API health may isolated child ingress start for the required browser smoke. Preserve all volumes/evidence; record real duration without turning it into offsite/RPO/RTO acceptance.

PP1d must separately detail upgrade failure before/during/after migration with matched old app+DB+media on new volumes; retention daily7/weekly4 selector with zero pruning absent explicit authorization; scheduler/capacity/log/restart/notification; complete PP1-AC06; and dependencies on PD01–05. PD01/02/03/04/05 remain formal-host/environment gates; local PP1c does not request or fabricate their values.

## 10 Delivery checklist and status

- [x] Task scope limited to PP1c and parent PP1-recovery DRAFT documents plus own report/evidence; no product tests/code/deployment/offsite action.
- [x] Source-mapped media write/decode, session-touch/scheduler writers, migration set, PP1a tool/runtime receipt and PP1b common lease/recovery gate.
- [x] Defined candidate local bundle/release/hash/schema and full raw DB+media blank restore order; local copy explicitly not offsite.
- [x] 33 candidate cards in four ≤30-card subwaves; all individual estimates ≤400 including tests; C04 split before implementation because the combined scope exceeded a credible single-card estimate.
- [ ] Root freezes shared v2 lease/helper/target API, exact ownership boundaries, and account-authority prerequisite before implementation.
- [ ] Root independently reviews final card map/weak walk, source hashes and exact local interfaces before assigning any implementation work.
- [ ] Required docs CI/PR merge occurs; only root changes document state. This DRAFT never marks itself DOC_READY.
- [ ] Product implementation, unit/PG/integration checks and real isolated local restore evidence completed; not performed by this author.
- [ ] Genuine offsite/key recovery/scheduling/notification and RPO/RTO; separate future acceptance, outside local PP1c.

## 11 Documentation and evidence boundary

這是施工圖候選；本輪同步修改PP1c與PP1-recovery兩份DRAFT，其他PP1、README、owner operations文件未修改。本文中命令、schemas、test names與行數皆為未實作設計，不是實跑結果。PP1a/PP1b的既有描述只作來源依賴；只有PP1c root保存的本地実際閉環才能支持本地能力聲明；只有獨立外部目的地回取與金鑰證據才能支持offsite。文件作者沒有執行產品測試、DB/volume/container操作或離機服務。

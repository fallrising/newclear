# PP1c local adapter and verification proposal

2026-11-01。**DRAFT：本文件把 D01–D03 的選項收斂為單一可審查方案，尚未取得新協定封板批准。** 與 [PP1c](../waves/PP1c.md) §4–6 一起閱讀；本附約只細化 local-isolated 邊界，不改父 [PP1-recovery](PP1-recovery.md) 的媒體完整性、session 撤銷、RTO／offsite 政策。v1 bytes、Java Operation、六欄 account Result 保持原樣。文件與 no-network synthetic probe 不代表 backup/restore 產品已執行。

## 1 D01：已觀察工具與固定參數

PP1b PR334 的 local acceptance 及 [本輪工具探針](../../../.team/pp1c-seal-20261101/TOOL-PROBES.json) 是 prerequisite evidence。API image `sha256:f5d7b5ac800f7191e23b041d664fa3c865a92521d93d28a5ce25d17630f04241` 的 `/opt/java/openjdk/bin/java` 可在 numeric uid:gid `1000:1000` 讀 synthetic0600、寫 owned0700 output、載入其 jar 的 PostgreSQL JDBC driver、用 ImageIO PNG decode，Java25.0.5+8。這個舊 image **沒有**未來 ops commands；實作後必須從同版 reviewed source 重新 build API image，記錄完整 ID、jar/hash/labels，不可把舊 probe 當新 runner 成功。

Node/browser image `sha256:6a8ca4b22705adf7134d2220ab8aadff634a6b76c816dba55e0409f8e5c180dc` 加 PP1a verified Node binary readonly bind `/opt/pp1-node`：Node24.18.0、uid1000/gid1000、file/directory fsync 與 private read/write probe 通過。PG image `sha256:6a2e324ebe59af6031c4c1cd96c1d5072c2ebc36563d2196365e43b8297c062d` 有 `/usr/local/bin/pg_dump`、`/usr/local/bin/pg_restore`，均16.15，在uid1000/gid1000可執行。Image Config.User 為空，不把它誤寫成已證明 application media owner；追加無網路probe已觀察同API image實際default user為0:0，Chromium153.0.8010.12與NSS新DB在1000:1000執行成功；每個新run仍需 numeric API user/media readability preflight。

符號只由已驗 PP1a receipt 與 fresh inspect 派生，不能由 CLI 任選：`A`=本次 matched API full image ID，`N`=本次已批准 Node/browser full image ID，`P`=同次 PG16 full image ID；`U:G`=實際 orchestrator numeric uid/gid，必與私有 run root owner 相同；`M:Gm`=matched API 實際 numeric user/group。本文已測的 host profile 是 U:G=1000:1000；其他 profile 必須重做同一個 probe，失敗 ADAPTER_UNSEALED，不 chmod/chown 既有資料。`D(side)`=該 side inspected data network full ID；`W`=child web network full ID；`V(side)`=該 side exact media volume；`S(side)`=該 side private password regular0600/nlink1 file；`Q(seq)`=source registry 的 helper seq directory。變數值保留在私有 run material，公開 receipt 只保留 hashes/opaque IDs。

每個 `docker` argv 的第一段固定 `['--host','unix:///var/run/docker.sock']`；沿 PP1a 清除 DOCKER_CONTEXT/TLS/CERT 外部選項，無 remote daemon。shell=false。create argv 依序：

```text
create --pull=never --name cms-pp1c-<operationId>-<seq>
 --label org.cms.pp1c.operation=<operationId> --label org.cms.pp1c.seq=<seq>
 --label org.cms.pp1c.kind=<kind> --label org.cms.pp1c.policy=<policySha256>
 --restart=no --read-only --cap-drop=ALL --security-opt=no-new-privileges
 --log-driver=none --user=<specified uid:gid> --network=<one network or none>
 --tmpfs=/tmp:rw,nosuid,nodev,size=67108864 --interactive
 <exact mounts below> --entrypoint=<absolute executable> <full image ID> <exact args>
```

不加 tty、privileged、device、extra network、host PID/IPC、docker.sock、host port、shell wrapper 或 `--rm`。Image inherited labels/env 先以 immutable image inspect 取得，expected labels=原labels加上述四個無衝突鍵；expected env=原env加下表明列覆寫，其他 env/key拒絕。`policySha256` 對 `{version:1,kind,side,imageId,user,entrypoint,args,env,mounts,networkId,readOnlyRootfs:true,capDrop:['ALL'],noNewPrivileges:true,restart:'no',logDriver:'none'}` canonical bytes；env 按完整 `KEY=value` 字串排序，mounts按destination排序且明列type/source/destination/readOnly。policy preimage 不含自身label/fullContainerId；image來源已核 labels 另逐欄比，不能用hash循環補出 policy。

create→inspect exact full ID及所有policy→start attached (`start --attach --interactive <fullID>`)→running/endpoint核對→exit inspect→同fullID cleanup 的次序固定。network=none時HostConfig.NetworkMode恰none，NetworkSettings僅允Docker的none項且無可路由IP/endpoint；有network恰一個，IP來自fresh inspect。stdin/stdout pipe 由host持有；不用docker logs。create/inspect/stop/wait/rm管理呼叫各30s；start attached以spawn啟動後30s內確認running，attached process等exit沿kind runtime期限（dump/restore/media2h、inventory10min、browser10min），不能30s截斷正常dump；kill只針對已核身的本次helper，在正常stop deadline後使用同fullID，不掃name/label。只有已核身stopped helper才rm，隨後inspect證明不存在；unknown identity不猜測清理。既有source/child容器、volume、registry、failed artifacts不刪。

| kind/side | image / executable + args | user / network | mounts (RO除明列RW) / added env / pipe |
| --- | --- | --- | --- |
| INVENTORY/source或target | A `/opt/java/openjdk/bin/java` `-jar /app/app.jar ops-inventory --request /run/pp1/request.json` | U:G / D(side) | Q/request.json→/run/pp1/request.json；S(side)→/run/secrets/spring.datasource.password；V(side)→/media RO；Q/output→/run/pp1/output RW；無added env；stdin Permit、stdout Ready+Result |
| REVOKE_SESSIONS/target | A 同上，token=`ops-revoke-restored-sessions` | U:G / D(target) | request與S同上，無media/output mount；無added env；stdin Permit、stdout Ready+父session receipt |
| PG_DUMP/source | P `/usr/local/bin/pg_dump` `--host=postgres --port=5432 --username=cms_local --dbname=cms --format=custom --no-owner --no-privileges --no-password --lock-wait-timeout=30000` | U:G / D(source) | Q/pgpass→/run/pp1/pgpass；env `PGPASSFILE=/run/pp1/pgpass`,`PGAPPNAME=<operationId>`,`PGCONNECT_TIMEOUT=15`；stdin EOF，stdout直接pipe到exclusive私有db.dump |
| PG_RESTORE/target | P `/usr/local/bin/pg_restore` `--host=postgres --port=5432 --username=cms_local --dbname=cms --format=custom --single-transaction --exit-on-error --no-owner --no-privileges --no-password` | U:G / D(target) | Q/pgpass→/run/pp1/pgpass；同三env；stdin為已驗dump的open FD串流，無archive path mount；stdout不得含dump |
| MEDIA_PACK/source | N `/opt/pp1-node` `/tool/local-media.mjs pack` | U:G / none | verified Node→/opt/pp1-node；本次source-hashed script→/tool/local-media.mjs；V(source)→/media RO；無added env；stdin為已驗 Inventory 的canonical bytes，stdout raw PP1CMEDIA1直接到exclusive artifact |
| MEDIA_RESTORE/target | N `/opt/pp1-node` `/tool/local-media.mjs restore` | M:Gm / none | Node/script同上；**只**V(target)→/media RW；無host secret/output/package mount；stdin已驗media.package FD，stdout固定 `{version:1,operationId:null,fileCount,fileBytes,mediaHeaderSha256}`；operation由host封裝綁定，child不猜ID |
| BROWSER/target | N `/opt/pp1-node` `/work/scripts/ops/local-restore-smoke.mjs browser-child` | U:G / W | §4完整browser向量；只child web，不掛DB/volume/secret root |

PGPASSWORD、password-bearing URI、Java password env、stdin secret行與DB密碼stdout全部禁止。PG tools原生不支援本契約的plain secret檔：host從已驗S的open FD在記憶體讀值，建立本seq專用0600/nlink1 `pgpass`，唯一行 `postgres:5432:cms:cms_local:<escaped-password>\n`，先把反斜線變雙反斜線，再把冒號前置反斜線；拒CR/LF/NUL密碼。只把此檔RO掛入helper，**不得把整個Q或secrets目錄掛入**。helper退出/確認不再讀取後unlink該次衍生pgpass；不刪原S、不聲稱安全抹除磁碟。不把其值/hash納入public evidence或inventory。stdout raw streams用背壓、有界磁碟空間與pipeline error handling；不能把raw stdout套16KiB receipt限制，也不能丟到Docker json-file。PG原生stderr可能含SQL/object names，僅保留最大4MiB於本seq私有0600診斷檔，對上層只報固定code；Java新增runner仍只准fixed code，不外洩cause。不能宣稱PG原生stderr本來已redacted。

PG helper不是JDBC握手：source/target API均stopped；observer由既有host inspector獨立查pg_stat_activity（observer自己的pid只在其query中排除，不能豁免其他client）。在helper alive期間每100ms最多取得一次snapshot；除observer外，只能有唯一matching db/role/applicationName/IP且exact container command/top process對應之backend，第一次記pid+backend_start。後續同一tuple，任何extra/replaced/missing-while-live後重現拒絕。helper至少被觀察到一次matching live backend，短命工具若一次都未觀察到則不可出成功proof。工具結束後該tuple為零，pre/post source Inventory完全相等；observe failure不自動retry。pg_dump不用parallel jobs；restore不用clean/create/disable-triggers/filter/data-only/schema-only或任意SQL。上述觀察是同UID/Docker-owner合作邊界，不宣稱能阻止惡意host在sampling之間插入writer。

MEDIA script的owner是依序執行的H03a/H03b；`scripts/ops/local-media.mjs`及`.test.mjs`加入白名單。pack/restore只有兩個exact首token，錯位／額外args拒絕。source由stdin Inventory指定files，但先strict schema/completehash/path核對，不能任選host路徑；pack逐一open O_NOFOLLOW、before/after dev/ino/nlink/size/mtime重驗後stream；restore目的/media必先空，mkdir新父目錄0755、檔CREATE_NEW/O_NOFOLLOW0644、逐filehash/bytecount/EOF核對並fsync檔與父目錄，任何重複key／尾隨bytes拒絕，不解tar、不覆寫、不chmod/chown來源。所有API-owned新檔使用M:Gm，inventory UID可讀性在成功前驗證。M:Gm無法以cap-dropALL寫新空volume即ADAPTER_UNSEALED，不能臨時加cap。

## 2 D02：raw comparison receipt

選定「完整20-table逐項比較＋receipt記摘要」；不能用兩個top-level hash或adapter true取代逐列比較。所有以下schema恰列鍵、required/no-unknown、canonical＋LF；hash/ID/count使用父型別。receipt位於source registry `operations/<operationId>/raw-comparison.json`，CREATE_NEW0600＋fsync，不放進父manifest三artifacts。`rawProofSha256`、`rawComparisonSha256`都指向這個完整檔案hash，不是dbSnapshotSha256。獨立失敗receipt同schema、`equal:false`，只作證據，不允許revoke/proof。

```text
RawComparisonV1 = {
 version:1, operationId, backupId, manifestSha256, releaseId,
 sourceTargetId, targetTargetId, sourceInventorySha256, targetInventorySha256,
 sourceIdentitySha256, targetIdentitySha256,
 schemaVersion:'pp1c-inventory-v1', comparedAt,
 tables:TableComparisonV1[20], files:FileComparisonV1,
 assetsEqual:boolean, variantsEqual:boolean, flywayEqual:boolean, equal:boolean
}
TableComparisonV1 = {
 tableName, sourceSchemaSha256, targetSchemaSha256, sourceRowsSha256, targetRowsSha256,
 sourceRowCount, targetRowCount, schemaEqual:boolean, rowsEqual:boolean
}
FileComparisonV1 = {
 sourceHeaderSha256, targetHeaderSha256, sourceCount, targetCount,
 sourceBytes, targetBytes, missingCount, extraCount, changedCount, equal:boolean
}
```

tableName恰wave§4.1已列20names、升序、一名一次；bytes/count為十進位字串。sourceInventory是manifest artifact及停寫source再次capture所得完整同bytes；targetInventory是在DB/media restore完成、API/ingress停止、任何revoke之前，由target同版INVENTORY helper取得。其private檔固定 `operations/<op>/inventories/{source-before,source-after,target-raw}.json`，其內容只可在私有比較器記憶體／檔案，不輸出rows/keys。source-before/source-after必逐byte等於bundle inventory；manifest、local-complete、threeartifactshashes、release、source target identity各自重驗。

比較器先對兩份Inventory重算所有derived table/schema/rows/db/header hashes及counts，再比schema的所有catalog attributes/constraint/index definitions、全rows的nullable PG text/順序、整份assets/variants及完整Flyway table。不能接受兩個自報hash相同但payload不同。files採雙向key集合merge，每個相同key都比classification/byteSize/hash並對實際還原檔重新讀bytes核hash；missing/extra/changed必全0。objectKey不放receipt；檔案hash/equality不省略orphan/deleted。tables及files的boolean必由完整比較結果派生，不能接受輸入receipt宣稱true；same-count錯FK、row、permission、session、Flyway checksum、same-size檔錯bytes都必拒絕。

成功例：20rows的schemaEqual/rowsEqual全true、兩count/hash對相同，files三差異count='0'且equal=true、assets/variants/flyway/equal全true。失敗例：cms_permission sourceRowsSha256與targetRowsSha256不同、rowCount相同，該rowsEqual=false及總equal=false，其他項仍列滿；只寫failure receipt並回RAW_MISMATCH，Java revoke starts=0、API starts=0。invalid inventory schema/hash先拒SCHEMA_UNSUPPORTED或BUNDLE_MISMATCH，不偽造一份「完成比較」receipt。

## 3 Phase與獨立停寫檢查

先決：C17只使用明確準備的合成source。一般BACKUP_LOCAL不需要／不得登入fixture帳號。RESTORE_VERIFY_LOCAL在任何stop/capture之前必須已取得§4的memory-only RecoverySecrets和SmokeFixtureInputV1；缺一即INPUT_INVALID，不能從credential/session hashes逆推，也不能reset密碼或重新login來偷偷修fixture。

Restore序列替換wave§4.4為：PRECHECK→SOURCE_QUIESCED→LOCAL_CAPTURED→LOCAL_VERIFIED→TARGET_RESERVED→TARGET_BLANK→DB_RESTORED→MEDIA_RESTORED→RAW_VERIFIED→SESSIONS_REVOKED→STARTUP_VERIFIED→API_HEALTHY→INGRESS_STARTED→BROWSER_VERIFIED→TARGET_STOPPED→RESTART_VERIFIED→COMPLETE。新增phase屬本次明示proposal，需同時加入LeaseV2/Journal validator及faulttests；不改v1phase。

1. RAW_VERIFIED使用§2receipt。revoke仍同一connection、同交易、單一revoke timestamp＋恰一指定AUTH，完全沿父§5.4。helper退出後API仍stop，再inventory為`target-revoked.json`。與raw相比只允raw.revoked_at=null的session改成同一timestamp，原revoked列原值；恰一AUTH row各欄完全符合父政策，auditEventId/operation/backup/target/revokedCount與父receipt相同。其他columns/rows/files完全等；失敗SESSION_REVOKE_FAILED，不start。
2. STARTUP_VERIFIED：fresh inspect後start exact child API，ingress保持stop；120s內health通過後stop exactAPI、等待stopped且client backend零，再INVENTORY `target-startup.json`。它與target-revoked的全部20tables/schema/media必完全相等；不同STARTUP_MUTATION。不能在API仍有pool時用strict inventory假稱quiesced。
3. API_HEALTHY：同容器再次start、同health/identity檢查；然後INGRESS_STARTED，才放行唯一browser。這個start到browser之間不執行inventory；其所有變動最後仍必符合§4的逐列predicate，額外seed/purge/catalog變化不能被掩蓋。source全程保持stop及同raw；child之外不開route。
4. BROWSER_VERIFIED記瀏覽器assertions但尚不發完整proof。browser exit→stop exact child ingress/API→確認backend零→`target-after-browser.json`，對target-startup執行§4 exact delta verifier；無API/helper並行。
5. RESTART_VERIFIED：ingress與browser保持stop，重啟同API health→再stop→backend零→`target-after-restart.json`；它與target-after-browser全20tables/media完全一致。此階段不再發authenticated HTTP。target保持RESTORE-only/stopped，source前後raw/files再核一致，才寫父restore-verified、ProofV1、COMPLETE/END後release。任何failure保留target/lock，無same-target重跑。

每個inventory使用新的seq但同workflow；不存在兩個同時helper。Read-only inspector只排除自身查詢backend，不放寬API pool存在。startup/full restart零delta與browser允許authdelta是不同receipt、不同baseline，不忽略整張表。

## 4 D03：credential、browser及具名delta

### 4.1 合成fixture來源與memory-only輸入

C17先在本次獨立合成source、取得backup lease之前完成fixture；不使用舊failed run或正式資料。以PP1b trueTTY bootstrap建立admin，再沿既有Admin principal API建立operator並指派operator role，兩者ACTIVE/failed_login_count=0/locked_until=null/deleted_at=null；沒有demo credentials。operator只需album/photo的read_published、read_draft兩action，各allowedSurfaces=[back,admin]、predicateJson=null；anonymous只需album/photo的read_published，各allowedSurfaces=[front]。admin沿既有admin權限完成fixture。entry/media/principal IDs由真API回傳，raw revision以entry_id與revision_no=1定位，所有payload/版本沿既有API驗證；以下步驟固定，不由worker選替代類型：

1. Admin multipart POST `/api/v1/media`上傳五個彼此不同的有效PNG（public A、replacement B、draft、private、deleted），另上傳PDF；格式/限制沿MediaApiTests現有真fixture：PNG由ImageIO產32×16並給五份不同像素；PDF採現有MediaApiTests接受的`%PDF-1.4\n`bytes（PDF只依現有sniff，不宣稱有PDF renderer）。核image的original/thumbnail/web與PDF original皆可讀；DELETE deleted ID使其soft-deleted，保留物理bytes。
2. POST `/api/v1/content-types/album/entries`，body `{slug:'pp1c-<sourceRunId>',payload:{title:'PP1c restore album',visibility:'public'}}`；publish無body，POST `/api/v1/entries/<albumId>/publish`。album只有public/unlisted，不能發明private enum。
3. POST photo entries body `{payload:{title:'PP1c published',album:albumId,media:publicImageId,sortOrder:0}}`；publish；核revision list含revisionNo=1（公開給work的list沒有revision UUID）。再PATCH同photo，body `{version:<current>,payload:{title:'PP1c published',album:albumId,media:replacedImageId,sortOrder:0}}`但不publish。A仍public；**replacedImageId是未發布payload中的新B**，匿名必404，不把仍published的A誤判private。
4. 另建photo `{payload:{title:'PP1c draft',album:albumId,media:draftImageId,sortOrder:1}}`不publish；建PDF photo `{payload:{title:'PP1c PDF',album:albumId,media:publicPdfId,sortOrder:2}}`並publish。private image完全不attach；deleted image刪前也不attach。
5. 以Admin GET `/api/v1/entries/<publishedEntryId>?include=refs`與`/api/v1/entries/<publishedEntryId>/revisions`、匿名GET `/api/v1/public/content-types/photo/entries/<publishedEntryId>`保存canonical response hashes（不包含HTTP headers）。operator亦以Back session讀同一entry?include=refs保存獨立operatorEntrySha256，不假設不同角色的ref投影必相同；target逐角色比各自hash。refs/index/attachments與revision原始rows由LOCAL_CAPTURED的C04 Inventory完整保存，RAW及browser後逐列全比；不要求live API另造DB讀取endpoint。保存三private與四public byte hashes。最後只在本次新source media volume以CREATE_NEW寫`pp1c-orphan.bin`（bytes UTF8 `PP1C orphan\n`），核regular/nlink1，不更新DB、不刪它。C17 fixture helper只能掛本次已核身source volume，不提供任意path，create/inspect/stop規則同H01。
6. fixture完成後各actor最後一次source login，保留兩cookie到同root process memory；此前產生的session/audit是raw baseline，不屬還原後允許delta。capture前核public/private狀態、ACTIVE profiles、oldSession哈希與期限；欄位/版本/權限不合即INPUT_INVALID，不能改expected來讓fixture通過。全部fixture建立動作在backup前，restore後只允§4.3所列兩次login與讀取。

C17 root task明列fixture driver與evidence可寫位置；driver依本固定序列呼叫現有API，不能新添產品endpoint或runtime dependency。

`SmokeFixtureV1` private JSON固定路徑`<registry>/operations/<operationId>/smoke-fixture.json`（0700 ancestors/0600/nlink1），恰 `{version:1,sourceRunId,adminPrincipalId,operatorPrincipalId,oldSessionIds:{admin,operator},publishedEntryId,revisionNo:1,refEntryId,media:{publicImageId,publicPdfId,draftImageId,privateImageId,replacedImageId,deletedImageId},expected:{privateEntrySha256,operatorEntrySha256,publicEntrySha256,revisionListSha256,publicOriginalSha256,publicThumbnailSha256,publicWebSha256,publicPdfSha256,draftOriginalSha256,privateOriginalSha256,replacedOriginalSha256},sessionAbsoluteSeconds,sessionMaxSeconds}`。UUID型IDs、revisionNo恰整數1、hashes、十進位seconds；所有references均需出現在capture Inventory，讀actual配置核seconds；不可把default12h/7d當觀察值。它是derived fixture，不是驗收成功receipt；不含username/password/cookie/objectKey/raw row。

`SmokeFixtureInputV1`恰上述SmokeFixtureV1刪去`oldSessionIds`，其餘keys完全相同；由root在capture前把API response/bytes/config期望寫入`<source-run-root>/recovery-smoke-input.json`，同0700/0600/nlink1。CLI在任何stop前讀取/驗schema及持有RecoverySecrets。LOCAL_CAPTURED首次完整source Inventory取得後，以每actor principalId與memory SHA256(oldSessionToken)在raw cms_session找恰一個未revoked且未expired row，導出兩oldSessionIds；核其餘entry/media/principal refs與revisionNo=1存在，再CREATE_NEW完整SmokeFixtureV1並算fixtureSha256。若少/多匹配則INPUT_INVALID、保留source stopped/lock、不create target；不能先假造session ID或live讀DB。C08產Inventory，C12負責導出/持久fixture；後續所有階段僅用完整SmokeFixtureV1。

`RecoverySecrets`只在root memory：`{admin:{principalId,username,password,oldSessionToken},operator:{principalId,username,password,oldSessionToken}}`。由合成fixture準備時保留兩次成功source login的cookies（每actor一次），密碼也在同process持有；source login結果所對應兩個session在capture時必revoked_at=null且expires_at仍在未來。C17可直接呼叫module `restoreLocal(inspection,request,{...deps,recoverySecrets,smokeFixtureInput})`；固定export由C11/C12擁有。一般local-restore CLI在beginWorkflow之前需要trueTTY，只顯示固定prompt `Restore drill credentials (private JSON): `，在raw mode/echo off讀一行≤16KiB strictUTF8 JSON，按上述exact keys驗證；無TTY/EOF/超限/重複key/invalid則INPUT_INVALID、零stop/create。不得用argv/env/file承載RecoverySecrets；CLI不自動生成帳號或收集新source session。source SmokeFixtureInputV1尚未備妥就先回C17 fixture準備，不開始backup。API passwords長度沿PP1bpolicy、token為非空且不含控制字；final callback/root finally清Buffer/移除引用，不宣稱已清除OS/JS所有副本。

在target啟動前，host用raw Inventory核每個oldSessionId的principalId與SHA256(oldSessionToken)相符且raw.revoked_at=null；不能只相信cookie的自報ID。瀏覽器舊token401的實際時間必早於該raw.expires_at，超時則SMOKE_FAILED，不把expiry當撤銷證據。source credentials/session資料不寫receipt或一般log。

### 4.2 one-use socket與browser向量

T03以host `mkdtemp` 建立短private目錄（固定prefix `/tmp/cms-pp1c-`，總socket pathname UTF8≤100bytes），0700 ownerU:G；socket唯一檔名 `credential.sock`、0600。目錄與socket lstat/dev/ino/uid/gid/nlink/type每次重驗，拒symlink。socket只RO bind單一檔至child `/run/pp1/credential.sock`；不掛parent或host run root。這不修改host信任、HOME或外部network。只有host收到已核身running browserfullID、唯一W endpoint、精確socket mount之後才接受request；服務只接受第一個connection，任何wrong/second/timeout均使stage失敗，不重新發密碼。

Peer界線明確採PP1b既有same-UID/Docker-owner合作模型：fullID/網路/mount由host fresh inspect證明，socket請求只做operation/target/fixture綁定，**不聲稱**Node payload驗出SO_PEERCRED或能抵抗同UID/root惡意程序。Node24只用公開net API，不讀private `_handle`、不加native addon/新runtime dependency。若未來要求OS peer credentials或敵對host隔離，屬另外安全設計，不能在實作時自行擴權。

唯一協定使用Node net `allowHalfOpen:true` 的單一duplex connection。每frame為4-byte unsigned big-endian length＋canonical JSON bytes（含尾LF），length 1..16384；依序恰四frame：client `CredentialRequestV1={version:1,operationId,targetRunId,fixtureSha256}`；server `CredentialResponseV1={version:1,operationId,targetRunId,fixtureSha256,admin:{principalId,username,password,oldSessionToken},operator:{principalId,username,password,oldSessionToken}}`；client §4.4 AuthObservationsV1；client §4.3 BrowserAssertionsV1。client最後end，server驗EOF及exactframes後end。request/credential各10s期限；後兩frame在browser stage10min內。wrong order、duplicate、overflow、earlyEOF、額外bytes/connection均SMOKE_FAILED，不重新發送。host `deliveredOnce` 在唯一credential frame write callback成功後置true；這不能代替browser最後receipt與exit0。list-only不連socket。socket與本次empty目錄在helper停止後unlink/rmdir；不刪其他runtime/tmp。

Browser mounts恰：verified Node→`/opt/pp1-node`；本次immutable browser worktree snapshot→`/work` RO（只所需config/spec、鎖定node_modules與package files，不含local/pp1或root）；已核Chromium directory→`/chromium` RO；已核NSS tools directory→`/nss-tools` RO；**child**CA單檔→`/fixture/ca.crt` RO；本次`BrowserInputV1`→`/fixture/browser.json` RO；socket→上述固定path RO。額外tmpfs `/tmp`改為rw,nosuid,nodev,size=536870912供child profile/NSS/results；所有child寫入只在此tmpfs，無output bind。browser config固定workers1/retries0/timeout120s、stage最多10min、trace/video/screenshots off、ignoreHTTPSErrors=false、reporter list只允sanitized fixed error；不要dump request/response/body/cookies。

BrowserInputV1恰 `{version:1,stage:'RESTORE_SMOKE_READY',operationId,sourceRunId,targetRunId,releaseId,rawComparisonSha256,sessionCommitSha256,startupInventorySha256,fixtureSha256,fixture:SmokeFixtureV1}`。T03只在§3 gate完成後建；privateinput hash與slot綁定，**不偽裝成PP1a PREPARED receipt**。added env僅 `CMS_PP1_SUITE=recovery`,`CMS_PP1_TLS_MODE=trusted`,`CMS_PP1_RECOVERY_INPUT=/fixture/browser.json`,`CMS_PP1_CREDENTIAL_SOCKET=/run/pp1/credential.sock`,`CMS_PP1_CHROMIUM=/chromium/chrome`,`CMS_PP1_RUN_ROOT=/fixture`,`HOME=/tmp/browser-home`,`XDG_CACHE_HOME=/tmp/browser-cache`；HOME只屬一次性container profile，host不改。T03 launcher在同owned browser container內初始化0700 profile與NSS DB，用 `/nss-tools/certutil -N --empty-password -d sql:/tmp/browser-home/.pki/nssdb` 及 `-A -d sql:/tmp/browser-home/.pki/nssdb -n pp1c-child -t C,, -i /fixture/ca.crt`，然後spawn固定Playwright child：executable=`/opt/pp1-node`，args=`["/work/node_modules/@playwright/test/cli.js","test","--config","/work/playwright.pp1-local.config.ts","--workers=1","--retries=0","--timeout=120000","--reporter=list"]`，cwd=`/work`，env恰本節fixedenv與已驗image inheritedenv，shell=false，stdin=ignore、stdout/stderr為bounded pipes；launcher只回傳固定診斷碼與exit，不轉錄runner原文到host。不得先啟CLI後才裝信任；入口具體launcher由T03 `scripts/ops/local-restore-smoke.mjs` 的精確 `browser-child` token分支提供，Docker實際entrypoint `/opt/pp1-node`，args=`/work/scripts/ops/local-restore-smoke.mjs browser-child`，它只接受本節固定env並spawn本段唯一CLI向量，exit保留原primary failure。該分支不提供任意shell/命令參數。

Config只新增suite=recovery且要求trusted；runtime/accounts行為與list-only前置不變。recovery.spec獨立讀BrowserInput，不import accounts的PREPARED前提。三origins固定front/back/admin.cms.test:8443、API固定api.cms.test:8443；全是child ingress在W的aliases，不使用host8443/forward.mjs。source W/D皆不掛childbrowser，無DNS任意override、無page.route成功替身。

### 4.3 固定瀏覽器步驟及結果

單一test `PP1-AC03 restored media and sessions remain isolated`；所有API呼叫由相應origin page.evaluate same-site fetch，credentials按角色隔離。四個fresh contexts：old-admin、old-operator、new-admin、new-operator，加一個匿名Front；oldtokens只設cms_session在API的Secure cookie，其他session/csrf留空。所有secrets作evaluate/HttpOnly cookie參數，不用帶值assertion/locator.fill/log/trace。每context pageerror或錯origin/APIbase皆fixed SMOKE_FAILED。

| 次序 | 行為與等待 | 必要斷言 |
| --- | --- | --- |
| 1 | old-admin與old-operator各從其合法surface發GET /api/v1/auth/me | 兩次401且error.code=SESSION_EXPIRED；時間仍早於raw expires_at，前後不touch舊session |
| 2 | new-admin在Admin、new-operator在Back各依現行CSRF＋login API成功登入一次，接auth/me | principal IDs精確、surface/role正確；無wrong password、logout、reset、第二次login或automaticretry |
| 3 | Admin GET /api/v1/entries/<publishedEntryId>?include=refs及 /api/v1/entries/<publishedEntryId>/revisions | 與fixture canonical response hash相同；沒有公開API的index/attachment精確rows由host raw/post Inventory檢查，不能虛構新endpoint |
| 4 | 匿名Front GET /api/v1/public/media/<publicImageId>/file/{original,thumbnail,web} 與publicPdfId/original | 各200且response bytes SHA等fixture，MIME/variant符合existingcontract |
| 5 | 匿名Front取draft/private/replaced/deleted四個媒體ID的original | 各404；同一new-admin的private GET /api/v1/media/<id>/file/original對前三個200且精確bytes，deleted精確410/MEDIA_GONE；不把空白404當bytes成功 |
| 6 | new-operator從Back GET同entry?include=refs、兩actor auth/me；匿名GET /api/v1/public/content-types/photo/entries/<publishedEntryId> | 真API授權與各自operatorEntrySha256/publicEntrySha256；無POST/PUT/PATCH/DELETE內容／media／role／principal mutation，僅步驟2兩次login POST |
| 7 | 全部contexts close；fixture/secret references清空 | 確認無未完成request；沒有logout；host按§3停API再驗delta及重啟 |

成功browser經同一socket發canonical `BrowserAssertionsV1={version:1,operationId,targetRunId,fixtureSha256,startedAt,finishedAt,checks:{oldAdminRejected:true,oldOperatorRejected:true,adminLogin:true,operatorLogin:true,publishedBytes:true,privateIsolation:true,restoredContent:true,originTls:true},loginCount:'2',credentialDeliveries:'1'}`。recovery.spec持有connection直到contexts都關閉、先送AuthObservations再送此frame並end。Playwright人類輸出只准固定sanitized診斷，不能承載receipt、cookie或hash；host直接接socket frames，不經Playwright worker IPC或Docker stdout。無frame、重複frame、非0exit或未完成EOF均SMOKE_FAILED，不能只看runner exit0。

### 4.4 逐列允許差異與final smoke receipt

host在source捕獲時保存兩principal及oldSession IDs；target-after-browser與target-startup比較：

- 17張其他table、schema/Flyway、全部content/entry/revision/ref/index/media/variant/attachment/files完全相等。改動table恰cms_principal、cms_session、cms_audit_event，不代表整表豁免。
- cms_principal恰上述兩個ID可變，且只last_login_at/updated_at變成該actor唯一LOGIN_SUCCESS session.created_at同一timestamp；兩值相等、位於對應login請求start/end UTC範圍。status=ACTIVE、failed_login_count=0、locked_until=null及其他全部欄位與baseline相同。其他principal完全相同。
- cms_session舊rows全部與target-startup相同（包含所有已revoke timestamps），沒有delete；恰新增兩row且各actor一個。新增id唯一UUID、principal_id與actor相同、created_surface為admin/back、revoked_at=null，created_at在對應login時間範圍；token_hash為PG bytea text，須嚴格解析`\x`加64lowerhex再與browser cookie SHA256比對（**hash也只進private delta input，不進public browser receipt**）。從最終inventory以精確cookiehash/principal綁定唯一row，不在live API旁額外讀DB。其last_seen_at≥created_at且≤browserfinish；expires_at精確等min(last_seen_at+fixture.sessionAbsoluteSeconds,created_at+fixture.sessionMaxSeconds)。ip須等本次child ingress在web網路的fresh-inspected IP（IdentityRequestFilter使用request.getRemoteAddr，現有proxy不轉寫該欄）；user_agent恰固定`CMS-PP1C-RESTORE/<operationId>`。所有五個context都明設該userAgent；不可接受任意字串。
- cms_audit_event舊rows完全相同，恰新增兩AUTH LOGIN_SUCCESS/ok rows；actor各一次、target_type=principal、target_id=actor、detail=null；at介於各session.created_at與對應loginFinishedAt，因AuthService.audit另取Instant.now而非共用login instant、surface=admin/back、ip與該session一致。無其他audit、沒有revoke receipt之外的額外AUTH。

成功login立即由T04在browser memory取得cookie並計SHA256，登入前後記UTC。最後經§4.2的第三frame送 `AuthObservationsV1={version:1,operationId,targetRunId,admin:{principalId,sessionTokenSha256,loginStartedAt,loginFinishedAt,oldRejectedAt},operator:{principalId,sessionTokenSha256,loginStartedAt,loginFinishedAt,oldRejectedAt}}`。所有keys required/no-unknown；hash為64lowerhex，times為UTCms且loginStart≤loginFinish、oldRejectedAt在loginStart前，全位於browser區間。此frame只進root memory，禁止stdout/log/artifact；不可把cookiehash當非敏感。browser child與host使用同一clock domain；不靠client自報IP認證。觀察值必與最終private Inventory逐欄交叉核對。DB TIMESTAMPTZ先無損解析為微秒整數；browser UTC毫秒區間解為[start×1000,(finish+1)×1000)，不能先把DB時間截為毫秒掩蓋差異。相同login instant的principal/session欄位以PG值精確相等；expiry計算也以微秒整數。

host獨立完成所有delta、source unchanged與restartzero檢查後，產生 `SmokeReceiptV1={version:1,operationId,backupId,targetTargetId,fixtureSha256,rawComparisonSha256,sessionCommitSha256,startupInventorySha256,afterBrowserInventorySha256,afterRestartInventorySha256,browserAssertionsSha256,deltaProofSha256,checks:{startupZero:true,oldSessionsRejected:true,authDeltaExact:true,contentMediaUnchanged:true,restartZero:true,sourceUnchanged:true},availableAt}`，恰此keys。deltaProofSha256指向私有`operations/<op>/auth-delta.json`完整canonical bytes，其`AuthDeltaProofV1`恰 `{version:1,operationId,targetRunId,baselineInventorySha256,afterInventorySha256,fixtureSha256,authObservationsSha256,browserAssertionsSha256,ingressWebAddress,expectedUserAgent,actors:[ActorDeltaV1,ActorDeltaV1],changedPrincipalCount:'2',insertedSessionCount:'2',insertedAuditCount:'2',otherRowsEqual:true,filesEqual:true}`。ActorDeltaV1恰 `{actor,principalId,oldSessionId,sessionId,auditEventId,loginStartedAt,loginFinishedAt,oldRejectedAt}`，順序恰admin、operator；oldSessionId必等fixture.oldSessionIds中對應actor；IDs/時間皆由已交叉核對的memory observations與Inventory取得，不能任選。ingressWebAddress取當次host fresh inspect，expectedUserAgent由operationId決定。此私有檔同0700/0600/CREATE_NEW/fsync，不寫cookie或原始tokenHash；authObservationsSha256只存整份memory AuthObservations的hash。

為使離線重驗有完整輸入，BrowserAssertionsV1另存`operations/<op>/browser-assertions.json`同private/canonical/fsync。verifier讀兩份inventory、fixture、delta proof與assertions，從delta actors指定的精確session rows嚴格decode token_hash，以bytea的32bytes轉64lowerhex，重建相同AuthObservationsV1 canonical bytes（沿wave§4.1 UTF8/key排序/LF，不以PG反斜線text直接hash）再比authObservationsSha256；重新執行全部欄位、兩次login時間界線、oldRejectedAt早於rawoldsession.expires_at、sourceunchanged與startup/restartzero predicates。它依賴同UID合作邊界內原host驗證的browser observations，不能宣稱hash是遠端簽章或能防惡意host改整份證據。只有最初cookie跨channel傳遞與hash對應成功才可寫delta proof；不能離線從DB先偽造observation來產生新proof。底層private Inventory本來含session token_hash；原cookie/password及完整AuthObservations從不持久化。

SmokeReceipt寫`operations/<op>/smoke.json`CREATE_NEW0600/fsync；`smokeSha256`、父restore-verified.smokeReceiptSha256同指此完整byteshash。availableAt是所有必要browser、stopped/restart/source檢查完成的UTC；不得提早取browser完成時間，elapsed/RTO仍按父公式且不能縮短到工具時間。receipt verification依上述derived-input規則重新讀private inventories、fixture、auth-delta與browser-assertions，recompute raw/phase/delta hashes及predicates，不能只驗boolean。

## 5 卡片責任、反例與批准邊界

D01用已批准image/Node工具；不pull、不安裝、不擴host permissions。新增fixedhelperfile/phase/derivedpgpass/duplexsocket均在本提案明列，尚待封板批准。H01做image/policy/create/inspect/lifecycle，H02做JDBC handshake，H04做PG觀察及pgpass，C06/R04做offline dispatch。H03a/H03b分pack/restore；T03a/T03b分hostsocket/NSS-containerlauncher；T04a/T04b分spec auth與content/media assertion；C10a/C10b分schema-lineage/fullraw comparison；C16a/C16b分lifecycle/exactauthdelta。各卡含tests估算≤400，實際超出先回root拆卡。波次卡表是唯一派工來源，附約不暗生平行卡。

必寫named regressions：`PP1C_D01_privateUidCannotRead`, `PP1C_D01_rawStdoutNeverLogged`, `PP1C_D01_pgpassEscaping`, `PP1C_D01_extraBackendRejected`, `PP1C_D02_equalHashesWrongPayload`, `PP1C_D02_sameCountRowDrift`, `PP1C_D02_orphanAndDeletedCompared`, `PP1C_D03_wrongSocketFrame`, `PP1C_D03_secondCredentialDelivery`, `PP1C_D03_expiredOldCookieNotRevocationProof`, `PP1C_D03_extraPrincipalOrAuditDelta`, `PP1C_D03_sessionTouchExactExpiry`, `PP1C_D03_apiRunningInventoryRejected`, `PP1C_D03_restartZeroDelta`。每個先用能import/compile的scaffold形成named行為Red，再Green；失敗不能只測mock called。真PG／media restore／socket／TLS／browser完整驗收由C17，文檔probe不能代替。

外部事實查閱2026-11-01：[PG16 password file](https://www.postgresql.org/docs/16/libpq-pgpass.html)（file格式、escaping、0600）、[pg_dump](https://www.postgresql.org/docs/16/app-pgdump.html)、[pg_restore](https://www.postgresql.org/docs/16/app-pgrestore.html)（custom stdin、single transaction/no parallel）、[Docker logging](https://docs.docker.com/engine/logging/configure/)（per-container none）。[Node24.18.0 net](https://nodejs.org/download/release/v24.18.0/docs/api/net.html)提供Unix socket、allowHalfOpen與手動timeout處理；deadline必顯式destroy，不能只監聽timeout不結束；沒有查到的SO_PEERCRED能力不宣稱存在。未引用第三方文章推導產品行為。

## 6 封板決策（單一提案）

待owner確認的是PR333整份PP1c施工圖：沿同一maintenance registry新增strict LeaseV2/journal/ProofV1與PP1CMEDIA1，採本附約D01工具/私有pgpass/UID向量、D02完整raw receipt、D03四frame socket與具名authdelta；按44卡分A/B/C/D四個依序子波（9/12/9/14，每波≤30）施工。不是再次詢問一般commit/push/PR權限。T0351明訂新規格先審查批准，desk運作方法§0也保留SDD重審；目前只接受文件與工具probe工作，沒有據此執行新backup/restore protocol。

批准後，root才在必要CI與審查通過下正常合併施工圖、同步DOC_READY並按已授權範圍安排implementation。仍保留父媒體完整性、同交易全session撤銷、原RTO起點及local不等於offsite；不改v1/Java Operation/六欄Result，不擴dependency、host權限、正式部署或舊資料清理。未來真probe/PG/browser失敗須修正或回報，不因規格批准而豁免。

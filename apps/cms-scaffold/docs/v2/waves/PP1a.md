# PP1a 本地 prod runtime 施工圖

2026-10-09。**基線DOC_READY已由PR324合併；本次loopback修訂只有文件PR獨立審查、必要CI並合併後才可實作。PP1a實作與本地驗收仍未完成。**
來源main `6a01bd31ad36c60c69838e2a915953a80c9b6d23`。本波是[PP1六項總計畫](PP1.md)的第一個有界子波，不代表個人正式使用或整個BW6完成。

## 1 範圍

Owner已批准先在本地跑。先把真正API以prod啟動、三面dist透過隔離HTTPS工具服務，DB/API零host ports，停用demo帳號／內容／導覽。對應既有AUTH面別／cookie斷言、PP1-AC01的本地子集及PP1-AC02的seed子集；不新增產品功能ID。入口只作本地驗證工具，正式靜態伺服器與正式憑證驗收仍待正式環境配置。

不做：正式部署、DNS、全機CA信任、登入／管理員初始化或恢復、Q25、DB/media備份、升級、排程通知、日誌／重啟正式維運驗收。後三組不是取消，依PP1b帳號/Q25→PP1c備份還原→PP1d升級/維運/旅程續作。後續每波另有施工圖、CI、審查、合併；不能依本頁實作DRAFT附約。帳號維護guard與獨立schema provisioning不塞進runtime，避免不必要循環依賴。

## 2 先決條件

W5實作與BW6文件已合併。Node24.18.0、JDK25、Docker Engine、Compose、OpenSSL現有工具可用；測試不安裝app runtime dependency。所有操作於新`cms-pp1-local-<32 lowercase hex>` project；拒絕既有同名資源，不接既有DB/media。

四origin固定為`https://{front,back,admin,api}.cms.test:8443`。TLS SAN恰四名；私有CA只放本run與拋棄browser容器。三個Compose服務都不publish host ports；主機上既有Node24的有界TCP forwarder只listen `127.0.0.1:8443`，轉送原始TLS至已核對owned ingress的web bridge IP:8443；API內部8080、PostgreSQL內部5432。兩個Docker網路保持internal，不授予入口outbound網路。API資料卷與DB資料卷均為新project-owned named volumes。服務restart=no，避免本波維護時另有manager啟writer；自動restart在PP1d驗收。

本機已觀察Docker29.1.3、Compose5.6、Node24.18、JDK25.0.4.1。主機→新PG私有bridge可達、無PortBindings的可行性probe通過；容器NSSDB信任probe通過（不信任與錯名仍拒絕）。這些不是CMS產品測試。無權限或磁碟不足時保留原資料、停止該次執行，不清理其他資源。

## 3 檔案清單

所有路徑相對`apps/cms-scaffold`；main=`services/cms-api/src/main/java/com/fallrising/cms/`，test=`services/cms-api/src/test/java/com/fallrising/cms/`。

| 路徑 | 動作／用途 | 卡 |
| --- | --- | --- |
| main `platform/ProductionEnvironmentValidator.java` | 新增，早於context/DB的prod安全驗證 | T01/02 |
| `services/cms-api/src/main/resources/META-INF/spring.factories` | 新增，註冊EnvironmentPostProcessor | T02 |
| `services/cms-api/src/main/resources/application-prod.yaml` | 修改，明示runtime required配置 | T02 |
| test `platform/ProductionEnvironmentValidatorTests.java` | 新增，安全設定負例及先於context啟動 | T01 |
| main `identity/service/DemoSeedPolicy.java` | 新增，prod或seed=false均不seed | T03/04 |
| main `identity/service/SeedService.java` | 修改，disabled仍只ensureRoles | T04 |
| main `content/service/ContentTypeSeed.java` | 修改，只gate demo navigation，保留12schema | T04 |
| main `content/service/DemoContentSeed.java` | 修改，最前policy gate，舊sentinel不能開啟 | T04 |
| test `identity/maintenance/ProductionSeedSeparationTests.java` | 新增，prod/dev/舊actor回歸 | T03 |
| test `content/service/ContentTypeSeedTests.java`；`services/cms-api/src/integrationTest/java/com/fallrising/cms/contract/MemberPostgresTests.java` | 修改，已核對的ContentTypeSeed constructor callers注入dev-enabled policy | T04 |
| `scripts/local/ingress.mjs`、`ingress.test.mjs` | 新增，固定四host static/API工具與node tests | T05/06/07 |
| `scripts/local/forward.mjs`、`forward.test.mjs` | 新增，僅本機loopback的raw TLS轉送與有界tests | T09a/09b |
| `scripts/local/prepare.mjs`、`prepare.test.mjs` | 新增，建立新私有run、秘密／TLS／config／compose env | T08/09 |
| `compose.pp1-local.yaml` | 新增，完全獨立於dev compose | T09 |
| `docker/pp1-api.Dockerfile` | 新增，以本機已建jar及既有JRE local reference建立本地測試image | T09 |
| `scripts/local/verify.mjs`、`verify.test.mjs` | 新增，真環境唯讀inspect/health/DB狀態驗證＋contract tests | T10/11 |
| `e2e-pp1-local/runtime.spec.ts`、`playwright.pp1-local.config.ts` | 新增，scoped trust browser本地旅程 | T10/11 |
| `package.json` | 修改，`test:pp1-local`、`e2e:pp1-local`及npm test追加node純測試；不改dependencies/lock | T11 |
| `docs/v2/waves/PP1a.md`、`docs/v2/waves/PP1.md`、`docs/v2/README.md`、`docs/v2/03-personal-use-readiness.md` | 同步狀態與證據 | T12 |

constructor callers已用rg全test/integrationTest核對，恰上列兩檔。禁止為少改tests加入繞過prod gate的public constructor。原dev compose/web.Dockerfile、OpenAPI、migration、既有W5runner與畫面均不改。

## 4 契約

沒有HTTP API、OAS、DDL、產品copy key變更。所有新增CLI只本地操作，輸出固定錯誤code，不含secret或原始exception message。

### 4.1 早期prod檢查

`ProductionEnvironmentValidator implements EnvironmentPostProcessor, Ordered`：
`public void postProcessEnvironment(ConfigurableEnvironment env, SpringApplication app)`；order=`ConfigDataEnvironmentPostProcessor.ORDER+1`。spring.factories key=`org.springframework.boot.env.EnvironmentPostProcessor`，value為此完整類名。

若`cms.runtime.production-required=true`但activeProfiles不含prod，throw `IllegalStateException("PP1_PROD_PROFILE_REQUIRED")`。若無prod且flag不為true，完全不影響既有dev/tests。含prod則以下所有條件都必須通過；失敗只用`PP1_PROD_CONFIG_INVALID`，不可把輸入拼入message或cause。此hook在建立DataSource/Flyway/HTTP/listeners前執行；不能用ApplicationRunner事後才拒絕。

- `cms.identity.seed-enabled=false`、`cms.identity.cookie-secure=true`；runtime required若設false也不能關閉prod的驗證。
- `spring.datasource.url`必為`jdbc:postgresql://`，含非空host及database；不得userinfo、password query。username非空且非開發預設`cms`；password至少32字元且不是全空白，不記值。此為本地生成secret的最小檢查，不宣稱密碼熵可由長度證明。
- `cms.runtime.site-domain`是明示小寫DNS parent（至少兩label、label依DNS字母數字/中間hyphen規則，不是IP、末尾dot或空白）；本地固定`cms.test`。`cms.runtime.api-origin`是canonical HTTPS origin、host必`api.<site-domain>`，無path（包含尾斜線）、query、fragment、userinfo，port若明示須1～65535。由API origin的同scheme/port派生恰`front/back/admin.<site-domain>`，不把cms.test硬編進Java。所有host須不同。這驗證明示配置的一致性，不宣稱有PSL或DNS所有權驗證；正式parent受控/不是public suffix及TLS/site-cookie仍必有正式環境驗收。
- cors-origins split CSV後必恰上述派生的三個精確origin；不許duplicate、空項、wildcard、http、URLpath/query/userinfo、尾斜線。surface-origins以最後冒號切開，必恰三對`<origin>:front|back|admin`各一，不許額外面或錯配。
- `cms.media.root`必絕對路徑；local compose固定`/data/media`；此hook不建立或清理檔案。缺值/default不算明示正確配置。

prod yaml補`cms.runtime.production-required: true`、site-domain=`${CMS_SITE_DOMAIN:}`、api-origin=`${CMS_API_ORIGIN:}`。Compose也設`CMS_RUNTIME_PRODUCTION_REQUIRED=true`以偵測profile被誤拔。秘密用configtree掛入，prod yaml不放值。

### 4.2 seed隔離

`DemoSeedPolicy(IdentityProperties properties, Environment environment)`與`public boolean enabled()`：`!acceptsProfiles(Profiles.of("prod")) && properties.isSeedEnabled()`。作為Spring component注入三個seed。SeedService false仍ensureRoles；ContentTypeSeed的12type/fields/catalog metadata保留，只在`enabled()`時執行front.primary demo navigation那一段；DemoContentSeed.seed第一行false立即return，連sentinel查詢也不執行。直接手動呼叫seed()也適用。普通dev seed=true保持原值；不自動刪除或覆寫舊demo資料。

### 4.3 本地工具輸入與資料

run root=`local/pp1/<runId>`，runId恰32lowerhex，新建wx/mkdir exclusive。prepare CLI：
`node scripts/local/prepare.mjs --run-id <id> --api-image <image-id> --node-image <image-id> --postgres-image <image-id>`。
每flag恰一次，image-id均`sha256:`加64hex且已存在本地Docker daemon，禁止pull。prepare對三個ID建立全新run-scoped本地reference `cms-pp1-local-<runId>-api:verified`、`-node:verified`、`-postgres:verified`；任何同名reference已存在即拒絕，不覆寫tag。使用固定argv `docker image tag <checked-id> <new-reference>`後inspect確認reference仍resolve至同ID；這些只新增本地引用，不是release tag、不推registry。Compose用reference且每service `pull_policy: never`；啟動與verify都比對container.Image完整ID等於receipt.images，不能只比tag。receipt另含imageRefs三個reference。所有工具命令用spawn/execFile固定argv、shell=false；Docker只接受本機socket，拒絕遠端DOCKER_HOST/context。compose executable由`CMS_DOCKER_COMPOSE`絕對路徑或`docker compose`選取，記實際版本；不改Docker_CONFIG／credentials／HOME。

prepare在寫檔前檢查repo根與三面dist存在、project沒有既有container/network/volume、8443未占用。檔案/祖先不准symlink；root0700、secret/key/config0600。已有run直接exit3，失敗留下private partial檔但不啟服務、不改既有資料。

輸出`compose.env`只含絕對非secret路徑、image references、project、APIorigin、NODE_BINARY（process.execPath）；`spring.datasource.password`為crypto.randomBytes(32).toString('base64url')；DB與API只讀共用此檔。`ingress.json`精確schema：`{version:1,origins:{front,back,admin,api},dist:{front,back,admin},certPath,keyPath,upstream}`；origins恰§2，container dist paths固定`/dist/front`等，leaf path`/tls/leaf.crt`和`/tls/leaf.key`，upstream固定`http://cms-api:8080`。unknown/missing keys全部拒絕。公開receipt=`{version:1,environment:"local-isolated",runId,project,sourceCommit,images:{api,node,postgres},apiOrigin,preparedAt,phase:"PREPARED"}`，無secret/privatekey。

`prepare.mjs`exports `parseArgs(argv)`, `prepare(options, deps)`；deps可注入固定command runner/random/clock供測試，產品CLI預設真實依賴，不提供命令字串可配置入口。sourceCommit由git讀，receipt另記worktreeDirty=true/false，不能以sourceCommit冒充未提交build。dist先由同worktree、固定APIenv建置；prepare對三dist的每個regular檔sha256形成`artifacts.json`（排序相對路徑），拒絕symlink、缺index、bundle含`http://localhost:8080`，並記建置APIorigin；真正bundle生效仍由browser network驗證。

TLS OpenSSL fixed argv產生RSA2048 CA+leaf，SHA256，days2，SAN精確四名。只leaf cert/key掛入口，browser只CA cert；CA key不進任何container。不安裝系統信任。測試browser工具由本地既有Playwright image、Chromium及certutil唯讀掛入拋棄容器，記版本/hash；工具paths只留私有run紀錄。

## 5 模組與執行規格

### 5.1 ingress

`loadConfig(path)`嚴格parse／檔案regular，`createIngress(config)`回`https.Server`；CLI=`node scripts/local/ingress.mjs --config /config/ingress.json`。listen0.0.0.0:8443僅容器內；主機forwarder固定loopback，Compose不publish。TLS至少1.2。Host須`<known-name>:8443`且TLS SNI與Host name一致；未知或錯配421。

三靜態面GET/HEAD；其他405。先對rawpath去query後decode一次，拒絕decode錯誤400、NUL、backslash、任何`.`/`..`segment、symlink或逃出dist；拒絕400/403。只regularfile；`.html`text/html、`.js`text/javascript、`.css`text/css、`.json`application/json、`.svg`image/svg+xml、`.png`image/png、`.ico`image/x-icon、`.woff2`font/woff2，其餘application/octet-stream；加nosniff。missing asset或帶extension404；extensionless且Accept含text/html時才SPA index fallback。HEAD與GET同status/headers無body。HTML no-store，其餘public,max-age=3600。禁止directory listing；不掛media。

API host僅`/api/v1/`前綴與精確`/actuator/health`轉至固定upstream。其他404；不接受absolute-form URL/CONNECT/upgrade。轉送所有端到端headers（包含Authorization、Content-Type、X-CMS-Surface、X-Request-Id、Origin、Cookie、X-CSRF-Token與回應Set-Cookie），只剝雙向hop-by-hop／Connection-token headers；保留method/query/body，不增surface header、不改cookie。移除雙向hop headers及Connection指定的headers，Host改固定upstream；不把forwarded headers當身份。所有APIresponse no-store。15s timeout回504，upstream錯誤502；不自動重試寫入；client斷線終止upstream。error前已送headers就destroy而非第二次writeHead。不記URLquery/header/body／秘密，只固定status和requestId。

### 5.2 Compose與啟動

全新獨立`compose.pp1-local.yaml`；不能`-f compose.yaml -f ...`合併。services恰postgres/cms-api/ingress；兩個internal bridge`web`與`data`，postgres只data、API兩者、ingress只web且四DNSaliases。postgres image用已核對run-scoped reference（pull_policy: never），DBcms/usercms_local，POSTGRES_PASSWORD_FILE=/run/secrets/spring.datasource.password。API image用已核對run-scoped reference（pull_policy: never）、SPRING_PROFILES_ACTIVE=prod、required=true、site-domain/origins明示、JDBC=`jdbc:postgresql://postgres:5432/cms`、usernamecms_local、configtree=/run/secrets/，seedfalse/securetrue，media卷/data/media。只讀secret file掛載，不用envpassword；不log renderedsecret。postgres/API health沿既有pg_isready/curl；API依postgreshealthy，ingress依APIhealthy。

ingress使用已驗證可執行host Node24.18 binary的既有Linux工具image（本機為既有Playwright工具image，不pull）；prepare要求process.version=v24.18.0，記process.execPath/sha256，唯讀掛至/opt/pp1-node，command固定/opt/pp1-node /tool/ingress.mjs；readonly掛script、config、leafcert/key及三dist。無docker socket、privileged或hostnetwork。三services restart=no；本波先設json-file max-size=10m/max-file=3限制測試產物，但正式輪替故障驗收留PP1d。Compose預期資源帶project label；啟動／restart的Compose也必用命令層`env -u DOCKER_CONTEXT -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH DOCKER_HOST=unix:///var/run/docker.sock`，不可依賴CLI目前context；不改全機設定。所有命令帶`--project-name <receipt.project> --env-file <root>/compose.env -f compose.pp1-local.yaml`，CLI中沒有密碼。

`docker/pp1-api.Dockerfile`只ARG BASE_IMAGE（既有含JRE25/curl的本地API image完整sha256 ID，build前後核對其完整ID，不pull）FROM它，WORKDIR/app，COPY services/cms-api/build/libs/*.jar /app/app.jar，EXPOSE8080與ENTRYPOINT java -jar。健康檢查不用假設新base含curl：沿現有API image有curl作BASE_IMAGE並確認JRE25。本波固定沿現有API runtime image為BASE_IMAGE（含JRE25/curl），覆蓋app.jar；不改base package或安裝curl。Dockerfile用PP1_SOURCE_COMMIT／PP1_JAR_SHA256與唯一BASE_IMAGE參數寫org.cms.pp1.source-commit／jar-sha256／base-image labels；BASE_IMAGE必完整sha256 ID，同一值直接用於FROM與base-image label，沒有第二份base ID輸入；prepare要求source等於HEAD、jarSHA等於本工作樹唯一bootJar、base是本機Linuximage。receipt與artifacts保存apiBuild，verify比對labels且對owned API固定exec sha256sum /app/app.jar核對實際jar；ingressscript也記hash並核对。dirty=true仍明示未提交建置，不宣稱HEAD已包含dirty內容。build後記新imageID、jarSHA與baseID。正式rebuild供應链與base更新留後續正式runtime規格，不能聲稱已封存正式release。

API正常Flyway migrate全新庫，再seed catalog/roles；無principal/permission/session/entry/media/navigation，允許catalog。bootstrap未做，匿名受限端點應拒絕且Admin可見登入畫面；不能靠demo登入驗收。PP1b fresh-init的raw identity freshness可接受catalog已存在；不得沿用早期「所有content catalog也空」的host草案限制來誤認衝突。

### 5.3 實跑與browser

逐字命令（在component root，image/tool值從私有盤點填入，不將示例當已執行）：

```sh
./gradlew :services:cms-api:bootJar --no-daemon --no-parallel
VITE_API_BASE=https://api.cms.test:8443 npm run build
# 以現有含JRE25/curl API runtime image建立本次jar；不pull
# 既有 .dockerignore 排除 **/build，使用只含 Dockerfile 與本次 bootJar 的最小 context：
# set -o pipefail
# tar -cf - docker/pp1-api.Dockerfile services/cms-api/build/libs/<matching-bootJar>.jar | docker --host unix:///var/run/docker.sock build --pull=false --build-arg BASE_IMAGE=<verified-full-local-image-id> --build-arg PP1_SOURCE_COMMIT=<source-head> --build-arg PP1_JAR_SHA256=<matching-jar-sha256> -f docker/pp1-api.Dockerfile -t <owned-local-tag> -
node --test scripts/local/*.test.mjs
# prepare CLI見§4.3，接著由root對owned project啟動
# env -u DOCKER_CONTEXT -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH DOCKER_HOST=unix:///var/run/docker.sock <compose> --project-name <project> --env-file <root>/compose.env -f compose.pp1-local.yaml up -d
# 另一個前景terminal啟動，結束以SIGINT/SIGTERM；不建立全機daemon：
# node scripts/local/forward.mjs --run-root <root>
node scripts/local/verify.mjs --run-root <root>
# browser驗收使用下文trusted及untrusted兩次Docker命令；不可直接在未隔離host執行npm script
```

`verify.mjs`exports `verify(runRoot, deps)`、CLI只有--run-root。讀receipt核對projectlabel/imageIDs/network IDs/ports：DB/API/ingress PortBindings為空，三者皆無有效NetworkSettings.Ports；另外必由主機loopback8443以本run CA/SNI驗health成功；無unknownservice、extra mount或network，所有APIenv符合配置，秘密只mountpath。用owned PG固定psql SQL核對`cms_principal`/`cms_credential`/`cms_permission`/`cms_session`/`cms_entry`/`cms_media`/`cms_navigation_menu`各count(*)=0、`cms_content_type`=12、`cms_role`=5，`flyway_schema_history`總數10（8SQL＋JavaV7/V10），`WHERE NOT success` count(*)=0，不以輸出空字串當0。驗health UP，secretcanary不出dockerlogs（只記boolean，失敗不輸出命中行）。receipt包含所有bool、source/image/dists、環境local-isolated；任何錯誤非零，不自動stop/delete。重啟API後再跑同驗證，資料／schema數不變。

browser config獨立，不import W5 globalSetup（其localhost/demo假設不適用）。workers1/retries0、trace/video off、忽略HTTPS=false。`CMS_PP1_RUN_ROOT`由runner/operator設定，只讀ownedreceipt，container內固定mount位置不暴露host秘密。browser連web network、以DockerDNS四aliases訪問；scopedcertutil導入CA後執行。無信任單獨context/process先驗ERR_CERT_AUTHORITY_INVALID；錯SAN以NodeTLS client明示ca但servername=wrong.cms.test必拒絕。正式browsercase三面shell/deeplink200且JS/CSS MIME正確、missing asset404、ApihealthUP、API請求origin精確且沒有localhost8080。前端可能因無資料／未登入顯示拒絕，屬預期；不得新建demo帳號消除該狀態。

Browser啟動契約：由root先verify讀出owned web network ID；`CMS_PP1_RUN_ROOT`在容器恆為`/run/pp1`，只掛receipt.json及ca.crt，不能掛整個host run root（內有secret）。現有tools的具體path/hash在私有receipt外記錄；下面變數都由已核對ownedrun／tool inventory賦值，無secret值，缺任一就停止，不自動下載。BROWSER_IMAGE必已存在的完整image ID，NODE_BIN為實測24.18，CHROMIUM_DIR與NSS_TOOLS都是既有工具。工作樹自己的node_modules（npm ci由既有lock建立）不可指向舊worktree程式。

```sh
# NODE_BIN, BROWSER_IMAGE, WEB_NETWORK, RUN_ROOT, NSS_TOOLS, CHROMIUM_DIR已從私有盤點核對
# PWD為本次component；未信任case用同一命令但移除certutil兩步且CMS_PP1_TLS_MODE=untrusted
# trusted與untrusted必各執行一次，不以skip計成功。
docker --host unix:///var/run/docker.sock run --rm --network "$WEB_NETWORK" --shm-size 256m \
  --mount "type=bind,src=$NODE_BIN,dst=/opt/pp1-node,readonly" \
  --mount "type=bind,src=$PWD/node_modules,dst=/work/node_modules,readonly" \
  --mount "type=bind,src=$PWD/e2e-pp1-local,dst=/work/e2e-pp1-local,readonly" \
  --mount "type=bind,src=$PWD/playwright.pp1-local.config.ts,dst=/work/playwright.pp1-local.config.ts,readonly" \
  --mount "type=bind,src=$RUN_ROOT/receipt.json,dst=/run/pp1/receipt.json,readonly" \
  --mount "type=bind,src=$RUN_ROOT/tls/ca.crt,dst=/run/pp1/ca.crt,readonly" \
  --mount "type=bind,src=$NSS_TOOLS,dst=/tools,readonly" \
  --mount "type=bind,src=$CHROMIUM_DIR,dst=/browser,readonly" \
  -e CMS_PP1_RUN_ROOT=/run/pp1 -e CMS_PP1_CHROMIUM=/browser/chrome \
  -e CMS_PP1_TLS_MODE=trusted -w /work --entrypoint /bin/sh "$BROWSER_IMAGE" -c '
    mkdir -p /root/.pki/nssdb &&
    /tools/usr/bin/certutil -N --empty-password -d sql:/root/.pki/nssdb &&
    /tools/usr/bin/certutil -A -d sql:/root/.pki/nssdb -n pp1-local -t "C,," -i /run/pp1/ca.crt &&
    exec /opt/pp1-node /work/node_modules/@playwright/test/cli.js test --config playwright.pp1-local.config.ts'
```

`e2e:pp1-local` script精確為`playwright test --config playwright.pp1-local.config.ts`，只代表容器內Playwright入口，不建立信任或啟容器。唯一完整驗收入口為上面兩次Docker invocation（trusted/untrusted），其node CLI等同此script；不得把host直接npm成功當完成。config使用CMS_PP1_CHROMIUM作launchOptions.executablePath；outputDir=`/tmp/pp1-results`（container內），list reporter stdout由root保存。`CMS_PP1_TLS_MODE`只准trusted/untrusted，missing/其他拒絕；untrusted只宣告一個明確TLS拒絕test，trusted宣告runtimecases，報告各自mode與case count，不能呈現skip當通過。stdout不含network headers/secrets；失敗安全screenshot若要取回由ownedcontainer精確path另取，不掛run secret dir。錯nameTLS純Nodecase已由ingress.test驗。此指令只啟disposable test container，不部署正式服務。

本波不覆蓋登入cookie發放，但Nodeproxy fixture必驗Set-Cookie原值；真正Secure/HttpOnly/SameSite＋CSRF三面登入於PP1b執行。CORS真API：允許三origin OPTIONS回精確ACAO/credentials；未知origin不得回ACAO，直接受限Admin路徑無session回401/403（不可200）。無Origin公開health正常；不是用X-CMS-Surface偽裝。

### 5.4 Docker internal network 的loopback修訂

真Docker29.1.3實跑：容器只接internal network時，即使HostConfig.PortBindings宣告127.0.0.1:8443，NetworkSettings.Ports仍是null，主機連線ECONNREFUSED；ownedbridgeIP可連、scopedbrowser4/4成功。不能只檢查宣告或改掉internal安全邊界。修訂移除compose ports，使用既有Node stdlib在主機做有界rawTCP轉送，沒有新runtime dependency、hostnetwork、daemon/firewall/globaltrust改動。正式環境入口仍待獨立驗收。

`forward.mjs` exports `resolveTarget(runRoot,deps)`、`createForwarder(target,deps)`；CLI只接受`--run-root <root>`。使用與prepare相同本機socket固定Docker argv，拒絕remote DOCKER_HOST/context，讀runroot0700、receipt0600regular/nlink1、祖先無symlink。receipt須local-isolated/PREPARED、project與runId嚴格匹配、nodeimage完整ID。固定inspect `<project>-ingress-1`；恰一runningcontainer、project/service=ingress labels、Image等於receipt.images.node，無任何有效publishedports、無privileged/hostnetwork，network恰`<project>_web`。inspect該network要求internal/projectlabel/name/ID一致；container IPv4為有效RFC1918地址，network.Containers內相同fullcontainerID的IPv4Address必一致。endpoint固定該IP:8443，無使用者hostname/port或任意command選項。錯誤只固定PP1_LOCAL_FORWARD_INPUT_INVALID／PP1_LOCAL_FORWARD_TARGET_INVALID，不輸出inspect或原始例外。

`createForwarder`回net.Server；CLI恰listen127.0.0.1:8443。每accepted socket建立一次fixedtarget連線，雙向pipe保留TLSbytes/backpressure；不解TLS、不讀secret／CAkey、不重試。最多64同時連線、30秒idle timeout；任一端error/close/timeout銷毀配對端，upstream失效不崩server。SIGINT/SIGTERM關閉listener與activepairs後結束；啟動失敗只PP1_LOCAL_FORWARD_START_FAILED。只有固定listening/stopped狀態可輸出，不記流量。入口container被recreate/換IP時先停forwarder再重新resolve/啟動；不自動跟隨未知endpoint。API單獨restart不改ingress endpoint。

測試deps允許fake command runner、connect與clock／timeout（非CLI；CLI固定30000ms），loopback測試可由test對回傳server.listen(0,127.0.0.1)取得臨時port；產品CLI不提供bind/port override。tests驗證陌生project/image/noninternal/多network/非RFC1918/remote socket/ symlink／ports宣告及實際published值全部拒絕；真loopbackecho binarybytes雙向與backpressure、upstream拒絕不重試/下一連線可用、clientabort/idle/兩端結束cleanup，秘密canary不log。

verify需比對三containers HostConfig.PortBindings為空、NetworkSettings.Ports所有值null或空，並仍透過127.0.0.1:8443＋明示CA/servername=api.cms.test取得healthUP；不能以直連bridgeIP替代此acceptance。browser仍只連ownedwebnetwork，信任模式不變。驗收先forwarder→verify→兩browsermodes→同APIcontainerrestart→healthready→verify，停forwarder後loopback8443必不再可連。紀錄forwarderPID/實際fixedlisten、socketclosed與before/afterreceipt；本波不自動背景常駐。沒有能力監管主機process時留PARTIAL，不改外網隔離換綠燈。

## 6 任務卡

依次T01→T02，T03→T04；T05→T06→T07；T08→T09；T09→T09a→T09b；上述完成→T10→T11→T12。平行worker只有Java與Node disjoint paths；root整合Compose/真環境與全部檢查。每張含handwritten tests≤400行，超過即拆卡並更新文件，不壓缩程式湊額度。

| 卡／大小 | 目標、輸入與步驟 | 完成條件／驗證 | ID |
| --- | --- | --- | --- |
| PP1a-T01 M280 | 依§4.1新增validator tests與可編譯throw scaffold；缺profile/secret/origin/secure/seed與敏感錯誤Red；真SpringApplication缺設定在context initializer前失敗 | `./gradlew test --tests '*ProductionEnvironmentValidatorTests' --no-daemon --no-parallel`因預期行為失敗，不因compile | AC01/FM01 |
| PP1a-T02 M240 | 完成earlyhook、spring.factories及prod yaml，dev保留 | 同T01全綠，無DB啟動 | AC01/FM01 |
| PP1a-T03 M280 | 依§4.2新增ProductionSeedSeparationTests，沿§3兩個constructorcallers；prod舊seedactor不能触demo，catalog保留的Red | `./gradlew test --tests '*ProductionSeedSeparationTests' --no-daemon --no-parallel`行為Red | AC02/FM02 |
| PP1a-T04 M160 | 注入policy、三seed分支、調整已核對callers，無新模型 | 同T03綠＋既有seed tests | AC02/FM02 |
| PP1a-T05 M350 | ingress可import scaffold＋四host/static/proxy fixture行為Red，TLSfixture由testtemp生成 | `node --test scripts/local/ingress.test.mjs`Red非importerror | AC01/FM03–05 |
| PP1a-T06 M250 | static/SNI/Host/path/MIME/fallback/HEAD，依§5.1 | 同命令static subset綠 | AC01/FM03/04 |
| PP1a-T07 M250 | fixedupstream/body/header/timeout/no retry，依T06 | ingress全部綠，secretcanary無log | AC01/FM05 |
| PP1a-T08 M280 | prepare tests＋scaffold，舊run/resource/symlink/flag/image/private/TLSfail Red，fakecommands不冒充Docker驗收 | `node --test scripts/local/prepare.test.mjs`行為Red | AC01/FM06 |
| PP1a-T09 M380 | prepare/TLS/receipt/standalone compose/Dockerfile，依T08，建立新owned實例 | 同T08全綠；compose config解析且三services皆無ports映射，秘密不輸出 | AC01/FM06 |
| PP1a-T09a M250 | 依§5.4新增forward tests與importable scaffold；owned endpoint／loopback／socket lifecycle的Red | `node --test scripts/local/forward.test.mjs`行為Red，非importerror | AC01/FM06/07 |
| PP1a-T09b M230 | 實作fixedlocal Docker endpoint lookup及rawTLS relay，不新增依賴或外網 | 同T09a全綠，真loopback TLS health通過；verify必驗所有containers實際零publishedports | AC01/FM06/07 |
| PP1a-T10 M320 | verify tests＋scaffold＋browsercases，wrongports/seedleak/image差異/health故障Red | `node --test scripts/local/verify.test.mjs`行為Red；`npx playwright test --config playwright.pp1-local.config.ts --list`可列 | AC01/02/FM07 |
| PP1a-T11 M350 | verify實作/套件scripts、真prod Compose與scoped browser、restart後回讀 | §5.3/5.4真命令與browser全綠，三container零publishedports且hostloopback TLS可連、demo rows0 | AC01/02/FM07 |
| PP1a-T12 S120 | 全diff/文件/原生gates/独立review/PR/CI/main回讀 | §9全滿足；無formal claim | 全scope |

## 7 測試規格

| 檔案／測試名稱 | 層级／前置／步驟與斷言 |
| --- | --- |
| ProductionEnvironmentValidatorTests `PP1aFM01_rejectUnsafeBeforeContext` | JUnit noDocker；validMockEnvironment全字段，逐欄移除/改值，拒絕固定code且canary不出message；真实SpringApplication開required但無prod，initializer sentinel不可執行；dev不拒絕。 |
| ProductionSeedSeparationTests `PP1aFM02_prodDisablesAllDemoWriters` | JUnit memory/mock；prod＋seedtrue/false、devseedfalse、devseedtrue各case；oldsentinel存在仍零demo entry/media/nav/帳號更動；catalog12/roles5保留；dev回歸。 |
| ingress.test.mjs `PP1aFM03_hostAndTls` | node:test，tempCA/leaf/three disjointdist/fakeAPI；NodeHTTPS驗ca成功、wrongname/unknownCA拒絕；SNI/Host mismatch421。 |
| ingress.test.mjs `PP1aFM04_staticIsolation` | 每面index唯一canary、assets存在/缺失、deepAcceptHTML、nonHTML無fallback、HEAD/POST、encoded traversal/symlink/其他面/媒體path，不可讀出secretcanary。 |
| ingress.test.mjs `PP1aFM05_proxyPreservesAuth` | fakeAPI回原SetCookie，收Authorization/Content-Type/X-CMS-Surface/X-Request-Id/Origin/Cookie/CSRF及binarybody；精確相等、hopheader不傳、502/504、write只一次、斷線與alreadyheaders不崩server；不記secret。 |
| prepare.test.mjs `PP1aFM06_ownedFreshPrivateInputs` | tempdirs/fakeDocker；flags/既有project/image缺/非本機daemon/unsafe paths/TLSfail；零啟服務、秘密模式、receipt不含secret、拒絕symlink與舊run。 |
| forward.test.mjs `PP1aFM06_loopbackOnlyOwnedTarget` | node:test，fakeDocker＋loopbackTCP；§5.4列出的ownedtarget負例與bytes/lifecycle驗證，不碰真Docker。 |
| verify.test.mjs `PP1aFM07_denyFalseRuntimeSuccess` | fake固定inspect/SQL/health；逐一wrongport/image/label/network/seedrow/sqlerror/emptyoutput/secretlog拒絕，不刪卷。 |
| runtime.spec.ts `PP1aFM07_realProdRuntime` | 真ownedPG/API/dist，TLS有效，三面shell/deeplink/asset、四origin/CORS、health、未認證拒絕、restart後readonlyverify；Front登入頁本身不送API，另開既有/album列表驗builtclient；新庫預期401/403及既有未提供favicon.ico的404列為精確已知例外（不忽略其他asset錯誤）；error console與pageerror需零非預期，無login主張。 |

測試fixture密碼只random/private temporary；Nodepuretest不需Docker，真runtime在root有界local驗證單独執行，不塞進npm test。Browser定位role/name或data-testid；既有login表單依現行copy讀測試，不能新增產品copy。

## 8 失敗模式對照

| FM | 情境→預期 | 測試／卡 |
| --- | --- | --- |
| PP1a-FM01 | 缺prod/config或unsafecookie/origin/secret→context前拒絕，不log值 | validator/T01/02 |
| PP1a-FM02 | prod有舊seedactor→不再生成demo；catalog仍可用 | seed/T03/04 |
| PP1a-FM03 | 未信任/錯名TLS→TLS拒絕；Host錯421 | ingress/T05/06 |
| PP1a-FM04 | path/面别/媒體/缺asset→400/403/404，不讀secret，不以HTML掩飾asset404 | ingress/T05/06 |
| PP1a-FM05 | proxy下游失效→502/504，無重試；未登入/錯origin仍拒絕 | ingress/T05/07及runtime/T11 |
| PP1a-FM06 | 非新project/secretpermissions/工具不在本機→prepare拒絕，不動舊資料 | prepare/T08/09 |
| PP1a-FM07 | 任一container publishedports／主機loopback TLS失敗／seedleak／health／database失敗／重啟資料變動→驗收失敗留卷 | verify/runtime/T10/11 |

版本衝突、purge確認與SELF權限屬PP1b既有Q25契約，PP1a未新增寫入API所以不重做其FM；不可因此把BW6安全斷言刪掉。

## 9 交付檢查表

- [ ] 文件逐卡獨立review及五卡walk、relative links/diff/OAS既有契約不變；文件PR必要CI合併才DOC_READY。
- [ ] T01～12及T09a/09b實作、Red/Green證據、無秘密、source/built artifact tuple可回讀。
- [ ] `./gradlew test --no-daemon --no-parallel`、`./gradlew integrationTest --no-daemon --no-parallel`。
- [ ] `npm test`、`npm run lint`、`npm run typecheck`、`npm run build`、`npm run test:bundle`、`npm run measure:bundle`。
- [ ] 既有CI tooling tests、e2e lint/types、`npm run e2e:mock`、quality必要CI照既有workflow；新增`npx eslint e2e-pp1-local playwright.pp1-local.config.ts`與同既有flags的tsc。
- [ ] §5.3真本地prod/HTTPS/noports/no-demo／restart驗證；失敗/未跑分列，不用工具probe或CI mock冒充。
- [ ] 實作PR独立review/必要CI正常合併、遠端main回讀，才PP1a VERIFIED（local scope）。PP1整體與正式可用仍未完成。

外部來源查閱2026-10-09：[Spring Boot3.5 EnvironmentPostProcessor](https://docs.spring.io/spring-boot/3.5/api/java/org/springframework/boot/env/EnvironmentPostProcessor.html)（context前hook/註冊）；[Boot3.5 configtree](https://docs.spring.io/spring-boot/3.5/reference/features/external-config.html)（secret檔配置）；[Node24.18 HTTPS](https://nodejs.org/download/release/v24.18.0/docs/api/https.html)（TLSserver）；[Chromium Linux cert management](https://chromium.googlesource.com/chromium/src/+/master/docs/linux/cert_management.md)（NSS trust）。本地container信任機制另有真probe；上述文件不替代產品驗證。

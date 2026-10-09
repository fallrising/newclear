# PP1 個人／內部正式使用準備施工圖

日期：2026-10-08；2026-10-09 本地先行。狀態：**總計畫／後續子波 DRAFT；各子波獨立封板，本頁不是整體實作授權**。
來源：`6a01bd31ad36c60c69838e2a915953a80c9b6d23`（2026-10-09 fetched main；原盤點來源 `216643eb3f566b82b4747256034e94eb1844ebc4`）；CMS／其 CI 與 BW6 文件 PR #310 沒有增量。W5 #300 VERIFIED、BW6 #310 DOC_READY 保持。本文文件、程式、隔離演練、正式環境驗收四層狀態分開記錄。

2026-10-09最新指示「先在本地跑」優先於本文較早的正式環境待答規則。以下PD01～05未定的正式環境事實只阻擋正式環境配置／驗收，不阻擋已封板的本地子波。採新的隔離project／資料卷、容器內測試CA信任、DB零host ports；不部署、不覆寫試用資料。本地副本／通知capture不得冒充真正離機／送達。各子波的DOC_READY、實作、local verification與formal acceptance分開記錄。

## 1 範圍

Owner 2026-10-08 指定：單站、單實例、個人／內部少量內容、允許維護停機。沿用 [個人使用標準](../03-personal-use-readiness.md) 與 [BW6 身份契約](../contracts/BW6-identity.md) §3.3～4 的 Q-25。診所、相簿、專案均為 demo，不是三個正式產品。

本波操作驗收編號 PP1-AC01～06 是本次 owner 六項要求的追蹤編號，不替換既有 F/S/C/U/E/B/G、AUTH、M、V2-AC 或 BW6-FM 安全斷言。

| 順序／ID | 本波必要能力 | 可觀察完成條件 |
| --- | --- | --- |
| 1／PP1-AC01 | HTTPS、prod、正式靜態服務、API／三面 origin、正式憑證、DB 不對外 | 指定版本可重建；瀏覽器驗證 TLS、cookie、CORS、surface；DB 無 host binding，media 只有授權 API；錯誤設定拒絕啟動。 |
| 2／PP1-AC02 | 安全建立／恢復正式管理員、日常關 demo seed、Q25 与最小介面接線 | 空庫可初始化並登入；重跑不覆寫；恢復撤銷舊 session 且有審計；SELF／確認拒絕不改資料；原 LAST_ADMIN／原子性保留。 |
| 3／PP1-AC03 | DB＋media 一致性備份、排程、保留、受保護離機副本、空白隔離還原 | 同批 manifest、DB、媒體、程式版本；離機 receipt 可驗；空白新卷還原並核對實際 API／檔案與私密隔離；實測 RPO／RTO。 |
| 4／PP1-AC04 | 指定版本升級與失敗回復 | 停寫前備份完整；新版本驗收後才開寫；故障時恢復相匹配 app／DB／media，原卷留存且可核對。 |
| 5／PP1-AC05 | health、自動重啟、容量／備份失敗通知、log rotation | API/DB health 實際變化、process crash 自動重啟、容量與失敗注入有通知 receipt、日誌有容量上限。 |
| 6／PP1-AC06 | 正式設定與正式帳號的必要旅程 | 登入→草稿／媒體→發布→私密拒絕→衝突保留輸入→revision→重啟→還原／升級回復全部有該環境證據。 |

後移：媒體搜尋／分頁、類型／列表統計、最近登入展示、清除 email、enum 顯示、額外視覺／效能優化、第一批不用的預約與 Q26。批准契約仍保留；日後啟用預約須完成 Q26/BQ14。不能以 PP1 的 Q25 子集將整個 BW6 標 VERIFIED。

不做：部署、release、runtime dependency 自動新增、S3、叢集、多租戶、身份／路由重寫、清理舊資料或 worktree、強推或繞過審查。正式域名、主機、備份目的地與個資留在私有操作紀錄，公開倉庫只放變數名與 `.invalid` 範例。

## 2 先決條件與未決表

工程基準：P0、BW0～BW5、W0～W5（含 W3b）既有成果；Java25、Node24.18.0、PostgreSQL16。沿現有 npm lock／Gradle locking；沒有新 runtime dependency 授權。一般 test 不需 Docker；integrationTest 需要 Docker。本地已查驗Linux、Docker29.1.3、Compose5.6.0、Node24.18.0與JDK25.0.4.1；正式主機尚未查驗。

2026-10-09 owner「按你建議執行，不能做的告訴我，我來操作」批准先前提案中的政策預設。已批准與仍缺的環境事實分列如下；空白不當作主機已存在或已設定。本地子波使用已查驗的本地環境；正式環境資料仍保留下面門檻。PP1全體不因子波完成而標VERIFIED。

| 決策 | 尚需的實際資料 | 已批准政策／影響 |
| --- | --- | --- |
| PD01 主機與入口 | OS、Compose 版本、既有 HTTPS 代理／靜態伺服器、管理權限；公開或 VPN/內網 | 優先接既有入口；若沒有，須先提出具名軟體、精確版本與必要依賴授權，不能逕裝 Nginx/Caddy。主機 scheduler／日誌 adapter 隨答案固定。 |
| PD02 四 URL／憑證 | Front、Back、Admin、API 的 URL；DNS／TLS 簽發／更新責任 | 已批准四個不同 origin、同 HTTPS site，沿用 host-only SameSite=Lax。不同 site 或同 origin 不同 path 會影響身份設計，須另定規格，不以 header 偽造 surface。 |
| PD03 備份與通知 | 離機位置、加密與傳輸既有工具、金鑰保管與可恢復方式、通知目的地 | 已批准先加密再離機；不能只把備份放同一 host volume。工具／金鑰／回執規則待選，不建立外部服務或发送真通知。 |
| PD04 恢復服務目標 | 每日維護起始時間、時區、可停機長度 | 已批准 RPO24h、RTO4h、每日停寫一次、每日7份＋每週4份；屬目標，尚未實測達成。排程成功時間間隔及失敗補備須納入RPO驗證。 |
| PD05 首次資料來源 | 第一批公開類型、日常帳號需編輯的類型 | 已批准全新庫、不帶demo帳號／內容，日常獨立限類型帳號；現有試用庫保持，不搬移／覆寫／刪除。首批類型未指定前不給anonymous通配公開grant。 |

正式帳號實際 username／密碼不進文件。本次使用全新庫且保留舊試用庫；若之後改為沿用舊庫，需另記明示決策並先保留資料，不能當fresh-init覆寫。初始化入口須由有本機維護權限者顯式執行，日常程序不自動建／重置管理員；恢復操作具有提權效果，只在受控維護流程執行，不是 HTTP 無認證端點。[帳號附約](../contracts/PP1-accounts.md)已列CLI與seed分離候選；host guard仍待實際環境封板。

正式環境準備時由owner執行的唯讀盤點、回覆模板與之後的環境操作分工見[owner操作清單](../contracts/PP1-owner-operations.md)。清單沒有部署／安裝命令，也不要求傳秘密。

## 3 來源盤點與預定檔案邊界

### 3.1 已核實現況

| 來源（component 相對路徑） | 已有行為／缺口 |
| --- | --- |
| `compose.yaml:3–29,43–76` | PostgreSQL16；DB/API host ports；開發 credentials；localhost API build 值；沒有 prod profile／restart／log rotation。 |
| `docker/web.Dockerfile:1–17` | Node24＋npm install＋Vite preview；不能作正式靜態服務驗收。 |
| `services/cms-api/Dockerfile` | Java25 build/JRE，bootJar，curl health 探測工具；基底 tag 尚未按交付版本封存。 |
| `services/cms-api/src/main/resources/application-prod.yaml` | seed false、secure cookie true、Argon2參數；需確實啟用 profile，不能只因檔案存在就認定正式設定。 |
| `services/cms-api/src/main/resources/application.yaml` | DB／origin 開發 fallback；media root；health exposure only；audit 定時清理。 |
| `identity/service/SeedService.java:66–103` | seed-disabled 只 ensureRoles，空庫沒有正式管理員與可用 admin grant；普通 seed 會建多個 demo 帳號。 |
| `identity/web/IdentityRequestFilter.java:111–118` | Origin 決定 surface；cookie 無 Origin 回 Front；不實作代理 path audience。 |
| `identity/web/CookieSupport.java`、`IdentitySecurityConfig.java` | host-only Secure（依設定）／HttpOnly session／SameSite=Lax；credentials CORS、明確 origin。 |
| `packages/api/src/core.ts` | credentials include；CSRF 從 API JSON 取得，不跨 host 讀 document.cookie；CSRF拒絕最多一次重試。 |
| `content/service/EntryService.java:460–478` | purge 有 Admin role/surface、引用、版本、attachments、success audit；尚無 Q25確認。 |
| `apps/web-admin/src/pages/entries.tsx:296–401`、`confirm.tsx` | UI 已有 slug/id 確認，但 purge client 不送 body；ConfirmDialog callback 無輸入值、使用 trim。 |
| `media/service/MediaService.java:83–138`、`media/store/LocalDiskMediaObjectStore.java:17–24` | 先寫物件再寫 DB/variants；不是涵蓋磁碟與 DB 的原子交易。停寫備份需要額外完整性盤點，不自動修／刪既有孤立物件。 |

Java 路徑前綴為 `services/cms-api/src/main/java/com/fallrising/cms/`。完整盤點報告保留於本波私有協作紀錄；此表是 source facts，不是本波實跑產品驗收。

### 3.2 文件階段可寫範圍

只有 `docs/v2/contracts/PP1-owner-operations.md`、`docs/v2/contracts/PP1-accounts.md`、`docs/v2/contracts/PP1-recovery.md`、`docs/v2/contracts/PP1-governance.md`、`docs/v2/contracts/PP1.openapi.yaml`、`docs/v2/waves/PP1.md`、`docs/v2/README.md`、`docs/v2/03-personal-use-readiness.md` 與必要框架連結。團隊 PLAN/task/report/evidence 在本波獨立協作目錄，保留所有 W5／BW6 原檔。未定案的 runtime／運維檔案名稱不冒充完整允許清單。

未來實作預定採獨立 `compose.prod.yaml`，不以簡單 overlay 繼承開發 ports；保留開發 compose。正式 frontend artifact、proxy adapter、ops 腳本、維護 CLI、tests 的逐檔白名單與大小，須在 PD01～05 決定後完成。本節未完成前不能將本文標 DOC_READY。

## 4 契約

### 4.1 正式設定契約

- `SPRING_PROFILES_ACTIVE=prod`；日常 seed 關閉；prod 錯誤配置須於開 HTTP listener 前報错，不默默沿用開發 fallback。
- DB user/password 由受保護檔案或主機 secret 來源提供；不寫 Git／image／build args／操作日誌。只 DB/API service 能使用；不能把 `docker compose config` 展開的 secrets 保存成證據。
- DB 無 `ports`，API 只給受控入口連接；若主機代理需 loopback binding，僅核准 host network 範圍，不能發佈 `0.0.0.0:8080`。
- 明列三個允許 origin 與一一對應 surface，禁 wildcard／重複／未知映射。`VITE_API_BASE` 是三面建置輸入，必須与同批 release manifest 的 API URL 一致；修改 URL 必須重建，不把 runtime env 當 Vite 已重綁。
- 三個 dist 靜態根分開；未知前端路由回本 app index，缺 JS/CSS 檔返回404而非 HTML；index 不長期 cache、hash assets 可 immutable；不服務 source map／env／media root。API 路徑不落入 SPA fallback。
- HTTPS 憑證、renewal、HTTP redirect 由選定入口負責。不得以 `ignoreHTTPSErrors`／curl `-k` 產生 TLS 成功證據。隔離演練可用受測試 browser 信任的測試 CA，正式主機另驗真實鏈。
- session 保留單一 API host-only `cms_session`、Secure、HttpOnly、SameSite=Lax；三面與API同 site 已批准，跨 site 需先重開 cookie 決策。代理不能把 Front Origin 改成 Admin，不能以 `X-CMS-Surface` 繞過。

### 4.2 正式初始化／恢復契約（內核候選已細化，host guard未封板）

日常服務不提供初始化 endpoint。離線維護命令必須先驗證 API 與 scheduler 已停止、目標 DB 是已明示的實例，僅使用既有 Argon2/store/transaction。操作鎖與失敗退出不能依賴 UI。

初始化僅允許全新身份資料狀態，建立必要五角色、明列 admin 權限與一位正式 admin；不得呼叫一般 seed 建 demo 帳號／內容。已存在身份資料時拒絕，不用 upsert 覆寫帳號／grant。密碼輸入不得經 argv 或日誌。成功 receipt 只記 principal ID、操作、時間、source release，不記 hash／secret。

恢復用精確 principal UUID，僅對既有 admin 身份；不把任意普通帳號自動提升、不重寫全域客製 permission。重置 credential、解除 lockout、啟用被明確選定的 admin、撤銷其全部 session、AUTH審計同 DB transaction；任何寫入或 audit 失敗全部 rollback。若全域 admin grants 本身被破壞而無法登入，須顯式且另記恢復權限動作，不能在密碼重設時偷偷 whole-role replace。無可恢復 admin 的受控重建政策須封板，不能臨場自行 SQL。

來源補充：`ContentTypeSeed`未受seed-enabled控制，`DemoContentSeed`只檢查既有seed-operator-album。正式日常路徑必須禁止demo帳號／內容自動補建；內建demo類型是否保留要獨立明列，不把類型註冊與示範內容混為同一開關。`EntryService.publicRead`仍要求anonymous read_published grant；空庫只給admin角色不足以完成公開閱讀，fresh-init固定anonymous grants為空，不在bootstrap開放任何類型；正式Admin登入後才依owner明列首批公開類型設定最小grants，不賦予所有未來類型通配公開權限。

一般角色／類型權限由正式 Admin 操作配置；第一批不授預約。若需要從現有 demo 資料庫移轉，先盤點並備份，不删除帳號／資料；日常 seed=false 不表示已停用舊 demo credentials。正式驗收須查既存 demo 帳號仍否可登入，並按核准切換流程處理。

### 4.3 Q25 增量契約

沿用 [BW6-identity](../contracts/BW6-identity.md) §3.3、§3.4、§4、§7 R25-A/B/P 全部語義：

| 操作 | 成功／拒絕與順序 |
| --- | --- |
| `POST /api/v1/admin/entries/{id}/purge` | Admin surface＋admin role先於查詢／確認；JSON `confirmPhrase=DELETE` 且 `confirmId` 精確 UUID 或非空 slug；缺／錯400 CONFIRMATION_REQUIRED；不存在404；refs/version409；成功204。malformed JSON400、非JSON415保持。 |
| `PATCH /principals/{id}` disabled；`POST /principals/{id}/disable` | SELF403 SELF_DISABLE_FORBIDDEN 先於 LAST_ADMIN，status/session原樣。 |
| `PUT /principals/{id}/roles` | 先驗輸入／role，再 SELF403 SELF_DEMOTION_FORBIDDEN；保留 admin 的其他role修改可行；非self LAST_ADMIN保留。 |
| 拒絕審計 | 指定白名單 reason 一次獨立交易，ambient rollback仍保留；grant拒絕沿既有 audit 不重複；audit自身失敗500且原 mutation無部分改動。 |

不得整份套用 BW6.openapi.yaml，否則會要求未實作的 Q14/Q20/Q23 投影。PP1 只同步上述 operation、PurgeEntryRequest 與三個 ErrorCode，保留其餘 runtime OpenAPI；codegen 從 runtime 產生，重複執行無 diff。未來 BW6 實作應先比較 PP1 已合併增量，而非盲目覆蓋。

最小 client：`purgeEntry(id: string, body?: PurgeEntryRequest): Promise<void>` 只送呼叫端明示 body，不在 API 層生成確認。使用者在確認介面輸入 DELETE 與目標值，兩值精確符合且勾選不可恢復後才送出；傳值、DELETE第二欄／不可恢復勾選、與舊確認元件的相容方式已列在[Q25附錄](../contracts/PP1-governance.md)，已完成本地獨立文件審查；PP1整體仍為DRAFT，不依賴Q23 roles列表擴充。空slug使用UUID；切換target或關閉dialog清空確認；重複點擊只一個pending mutation。

SELF／confirmation三個錯誤用 zh-Hant copy，保持頁面並顯示具體提示，不能落成未知403／404。預定文案沿 BW6：請確認要永久刪除的內容／無法停用自己的帳號／無法移除自己的管理員角色。所有既有 success／denial／ref／rollback斷言保留。

### 4.4 備份集合與恢復狀態契約

[恢復附約](../contracts/PP1-recovery.md)列出manifest、20表／檔案盤點、狀態機、selection與測試候選；不是實作或實際還原證據。

備份 state：`PRECHECK → QUIESCED → CAPTURED → VERIFIED_LOCAL → VERIFIED_OFFSITE`；每階段失敗留 failure receipt，不更新 last-success。`VERIFIED_OFFSITE` 也不等於 `RESTORE_VERIFIED`，後者只能由空白環境實際還原取得。

每個 immutable backup ID 同批包含：PostgreSQL16 custom-format dump、所有媒體物件（含軟刪與已記錄孤立檔案）、逐檔 SHA256/size/object key 清單、版本化 manifest、應用與各前端 artifact digest、source commit、Flyway已套用版本／checksum、必要非secret配置、受保護secret恢復來源的識別（不存值於公開manifest）、開始/停寫/結束時間、scope與工具版本。DB dump含credentials/session/內容，整個集合視為敏感資料。

RPO24h／RTO4h、每日停寫與每日7＋每週4份保留已批准；維護時間、加密／傳輸工具／receipt 仍由 PD03/04 實際資料封板；不能以排程檔存在替代排程執行證據。只有完整且離機驗證的集合才可計入成功；RPO以最近這種集合的停寫資料時間點計，不以傳輸完成時間或排程檔存在計。每日一次是排程政策，不能自動推論任何時間點都滿足24h目標；延遲／失敗必須可觀察並計入驗收。RTO包含取回、解密、驗證、還原與必要登入／資料隔離smoke。保留輪替不能刪除最後一份可恢復集合。本波不在真實主機執行刪除或排程安裝。

## 5 模組與操作設計

### 5.1 停寫與備份（不引入新維護 HTTP endpoint）

1. 取得本實例 backup/upgrade/recovery 共用互斥鎖，記錄原服務狀態、來源release、具體 Compose project與volume ID。拒絕未知／共享volume、備份目的地位於來源volume、磁碟不足；不自動清理。
2. 入口進維護狀態，停止 API 及所有可寫 DB/media 的排程／維護命令。HTTP只擋POST不夠：session touch、審計等亦寫DB。確認程序退出與其 DB sessions 結束；若容器被強制終止，先作完整性檢查，不聲稱有graceful保證。
3. DB保持運行；停止 app 後匯出 DB metadata 與物件關係。所有 DB引用 object_key 必須位於 media root，拒絕 path traversal／symlink／非regular檔；比對 size、original checksum；所有asset都須有original；既有程式對可解碼image才產生thumbnail/web，不能以MIME開頭image就判三份必備。已知可解碼影像fixture必須核對三份，PDF fixture只original；歷史可解碼性與缺variant-row檢查器須在具體CLI封板時確定，不能只驗已宣告variant就稱完整。未知或不完整資料不自動補／刪，報錯且集合不成功。磁碟有無DB對應檔都保留並分類。
4. 執行 pg_dump、複製整個media tree、寫manifest與hash；任何非零退出／未完成檔不得成為latest。只向新的 staging/backup ID 寫入。
5. 在封存副本內重驗檔案hash、dump可讀與manifest關係，原子發布完成標記；不靠shell pipeline末端成功掩蓋pg_dump失敗。
6. 按原服務狀態恢復 API，health與必要資料smoke成功後解除入口維護；備份前已停止的服務不擅自啟動。恢復服務失敗保持維護並通知。failure trap不刪volume／不假成功。
7. 加密並傳離機，回讀驗證或依核准協定取得可驗證receipt；失敗通知且last-success不變。離機耗時是否含停機窗口由所選工具在PD04封板，不能臨場選。

### 5.2 空白隔離還原

使用新的唯一 Compose project、空白 DB/media 卷及隔離URL；驗證目標卷不存在資料，不允許覆寫既有卷，也不以 `down -v` 清理他人stack。從受保護離機集合取回，先驗解密、manifest版本、整批hash與匹配artifacts；故意換錯批次／缺檔要在啟動前拒絕。

先還原DB與media，DB dump以單一交易／exit-on-error restore；開機前核對Flyway資料，使用備份記錄的同版app與前端。演練不得讓較新app自動migration改寫恢復來源。服務隔離保持到資料／權限／media盤點完成。raw一致性驗證完成後、啟動API前，必須同交易撤銷全部恢復的session並寫AUTH事件；審計失敗不啟動。隔離演練也走相同政策，重新登入驗收；精確adapter與故障卡尚待封板，見恢復附約，不以不同API host假定舊cookie已失效。

驗證內容工作／發布副本、revision、refs/index/attachment、principals/roles/grants、審計設定與事件、media original/variants逐檔hash；再用API/瀏覽器證明已發布可讀、私密/草稿/未發布替換媒體不可匿名讀。記錄取回→驗證→restore→可服務耗時，不捏造RTO。演練完成保留receipt與產物；清理由另有授權的精確owned清單處理。

### 5.3 升級與失敗回復

同互斥鎖下先停寫、取得可恢復同批集合、保留舊app/artifact/digests及原卷；新版本在隔離複本演練migration。正式執行不在本次授權內。

測試三種故障：migration前、migration進行中、migration完成後smoke失敗。每種都不得開放寫入；無可靠前向修復時，用匹配的舊app＋備份DB＋media還原到全新卷，核對後才切換；不能只換回舊image。保留故障卷供調查。新版本已對外寫入後的回復會有資料分歧，停止並由owner決定，不自動丟掉新寫入。演練fixture可用test-only故障遷移，不改已合併V1～V10。

### 5.4 基本維運

既有 `/actuator/health` 只回必要狀態。內部DB health、API health與入口TLS可達性分別驗證；健康檢查失敗不等於Docker自動restart，必須分開觀察process退出與unhealthy狀態。正式compose設restart policy與有容量界線的log driver；排程失敗、容量不足、最近成功離機備份過舊均需送指定管道且記receipt。通知工具、閾值與去重間隔在PD01/03/04封板；不得只寫stdout後宣稱通知成功。基礎文件記查health、查看受限日誌、維護停寫、恢復與通知故障的操作步驟。

## 6 任務依賴與待封板工作卡

最新可施工邊界依[PP1a](PP1a.md)：runtime與no-demo 14卡（含loopback修訂T09a/09b），文件PR #324／#326已合併DOC_READY；實作 PR #327 已合併，必要 PR／main CI、獨立審查與本地runtime验收通過，VERIFIED local scope。[PP1b](PP1b.md)以父里程碑31張有界卡（帳號／維護19、治理／旅程／交付12兩子波，各≤30）接帳號/Q25及本地maintenanceguard（獨立文件審查通過，必要CI及本文件PR正常合併後DOC_READY生效）；PP1c接一致備份/空白還原；PP1d接升級故障/排程/維運/完整旅程。各波≤30卡，後續精確卡片仍DRAFT，下一波先細化再施工。原24張候選與新adapter工作量超過30，不壓成單波；以下總體工作組是依賴圖，不是首波白名單。


施工順序嚴格為 runtime → accounts/Q25 → backup/restore → upgrade recovery → operations → formal-settings acceptance。文件／純測試設計可並行；共享source writer依序整合。下列是**工作拆分草案**，不是可領取實作卡；精確逐檔白名單、方法簽名／CLI參數、fixtures與S/M行數仍須依owner環境答案補齊。未封板卡不得派給worker實作。

| 工作組 | 前置 | Red先證明的失敗 | Green內容與完成訊號 |
| --- | --- | --- | --- |
| P1 prod設定 | PD01/02 | prod缺secret／origin仍接受；DB port外露 | 獨立compose、startup config驗證、秘密輸入；rendered config檢查與invalid-config cases通過。 |
| P2 靜態／TLS | P1、已核准入口 | preview／deep link／missing asset／TLS無效 | 既有入口adapter、3個dist、精確API build；browser deep links與cookie/CORS矩陣通過。 |
| P3 初始化 | P1、maintenance CLI設計 | seed=false空庫無可登入管理員 | 本機受控新庫bootstrap；重跑拒絕且無改動，正式登入與最小權限可用。 |
| P4 恢復管理員 | P3、明示恢復政策 | credential/session/audit故障造成部分狀態 | 同交易重設／撤銷與審計；JDBC故障注入、重啟回讀通過。 |
| P5 Q25 backend | P3、BW6 R25 | 第二admin存在時SELF仍成功、無確認purge成功 | 依BW6-T17/18/19抽取Q25；單次denied、success rollback、LAST_ADMIN競爭全通過。 |
| P6 Q25 client/UI | P5 | dialog確認值未送／舊target輸入可重用／SELF generic提示 | 增量OAS+codegen+client+MSW+既有Admin UI與copy；不能帶入Q23/Q14投影。 |
| P7 媒體與備份manifest | P1～P6 | 缺檔/錯hash/部分variant錯當成功 | 固定版本manifest與只讀盤點；不刪孤立物件，缺必要物件中止。 |
| P8 停寫備份 | P7、PD03/04 | concurrent backup、pg_dump失敗、disk full、停機失敗 | 有鎖狀態機、dump+media、failure receipt、原狀態恢復；故障注入全部符合§5.1。 |
| P9 排程／離機 | P8、PD01/03/04 | 加密/transfer/receipt失敗仍更新last-success | scheduler及受保護副本adapter；實際取回與失敗通知證據。 |
| P10 空白還原 | P9 | wrong batch、nonempty目標、restore失敗、孤立URL | 離機→新卷→同版app→data/browser；實測耗時与RPO。 |
| P11 升級回復 | P10 | 只回退image、錯配schema或開放失敗版本寫入 | 三故障點演練，原卷保留與同批restore，不丟已開寫新資料。 |
| P12 維運 | P9/P11 | crash不重啟、unhealthy無提示、容量/過期備份無通知 | restart/health/log limits/capacity/backup age checks與通知receipt。 |
| P13 正式設定旅程 | P1～P12 | prod下登入/寫入/隔離/重啟/恢復斷線 | 正式命名帳號、seed=false、HTTPS、真DB+media；全流程證據。 |
| P14 整合／交付 | P13 | 新契約與client不同步、未跑項目當passed | 原生gates、獨立審查、PR必要CI／merge／遠端核對；正式主機驗收保持另列。 |

原帳號六卡與Q25六卡已由[PP1b的31卡／兩子波](PP1b.md)細分取代（bootstrap/recover核心11（B03拆兩張）、local guard8（G04拆兩張）、Q25 10、journey1、交付1）；[恢復內核十二卡](../contracts/PP1-recovery.md)仍為PP1c候選。PP1b host recover成功依賴PP1c完整匹配且已驗證的rollback backup，缺verifier時必須exit6且零mutation；不形成「先恢復才做備份」的循環。各子波≤30張且每卡≤400行手寫（含tests），超出即再拆，不削弱必要驗證。52～58張v2功能卡不是本次上線的全部前置。

## 7 測試規格與證據分層

- Q25 使用 BW6 R25-A/B/P fixtures，真實 session/Origin/CSRF，不能以CSRF403代替SELF403；純JUnit/API、memory/JDBC、client/Vitest各守其邊界。
- 既有 `IdentityAuditAtomicWriteTests`／`EntryAtomicWriteTests` 保留成功rollback與refs/version斷言。Q25 codegen僅增量runtime契約，回歸 `OpenApiContractTests`／`OpenApiCompletenessTests`／`ErrorCodeContractTests`。
- ops測試先用隔離temp目錄與可控命令fault injection證明狀態機，再用真PostgreSQL16與媒體驗restore。fake命令exit0不算實際備份演練。
- 新prod-like browser只覆蓋受正式設定影響的必要旅程；重用W5已過功能證據，不能把W5 real14/14當成新prod設定測過。正式主機未部署不得標production-ready。
- 每份receipt記 source commit/image digest、時間、環境別、精確命令、exit、斷言、failed/skipped原因；不保留password/cookie/token。

未來實作在component根需要的既有完整閘門（本文件階段沒有重跑）：

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

新ops與maintenance CLI、prod-like browser命令必須在封板時逐字補齊；不能以「手動測試」三字替代。既有quality CI仍必跑；新疑慮才增加對應局部測試。文件階段只驗文件與來源保存，不重跑未變的完整產品套件。

## 8 失敗模式對照

| FM | 期望行為 | 測試／工作組 |
| --- | --- | --- |
| PP1-FM01 prod缺profile、secret或origin | 啟動拒絕；無敏感值log；不降級dev | invalid-config／P1 |
| PP1-FM02 DB/API對外、static media暴露 | compose／入口安全測試失敗，不能交付 | topology negative／P1/P2 |
| PP1-FM03 TLS過期/不可信、CORS錯配、Front偽裝 | 真browser拒絕或surface403；不關驗證換成功 | TLS/CORS/AUTH矩陣／P2 |
| PP1-FM04 bootstrap重複或custom庫 | 零覆写、非零退出；顯式恢復入口 | maintenance tests／P3/P4 |
| PP1-FM05 SELF／LAST_ADMIN | 403指定code、單次denied、零狀態變更 | BW6 R25-A/P／P5 |
| PP1-FM06 purge缺/錯確認、ref/version衝突 | 400/409、零變更、單次denied；audit故障500 | BW6 R25-B/P／P5/P6 |
| PP1-FM07 確認殘留/重複點擊 | target切換重置；pending一次請求；無自動填值 | Admin Vitest／P6 |
| PP1-FM08 DB有物件但磁碟缺檔／checksum錯／partial image | 集合不成功；不刪原資料；可診斷failure receipt | manifest negatives／P7 |
| PP1-FM09 backup同時執行／停寫未完成 | 拒絕第二writer；不能開始capture | lock/quiesce faults／P8 |
| PP1-FM10 dump/media copy/disk full/restore失敗 | 非零、無latest-success、原卷留存；按原狀態處理服務 | capture/restore faults／P8/P10 |
| PP1-FM11 離機／解密／receipt失敗 | 不標離機成功，通知，既有可還原備份不移除 | offsite故障與回讀／P9 |
| PP1-FM12 還原非空volume或錯批artifacts | 寫入前拒絕；不得破壞其他環境 | restore preflight／P10 |
| PP1-FM13 upgrade三階段失敗 | 保持停寫，匹配版本restore後smoke才可開放 | upgrade fault drills／P11 |
| PP1-FM14 capacity／backup stale／process crash／unhealthy | 正確restart或通知；log有界，通知失敗亦可見 | ops fault drills／P12 |
| PP1-FM15 login/私密/衝突/revision/restart退化 | 適當401/403/404/409，表單與資料保存；整體驗收不通過 | prod-like journey／P13 |

上述新測試名稱／檔案仍未封板；這是DRAFT的明確缺項，不能由矩陣存在就宣稱有覆蓋。

## 9 交付檢查表與狀態

- [x] 核對最新main、BW6 PR310與CMS增量；保留舊worktrees與歷史報告；建立本波隔離worktree。
- [x] 完整讀取owner指定交接／優先文件／BW6 PLAN／publication與指定規格／設定。
- [x] 六大項範圍、依賴、既有底座與可觀察驗收列明。
- [x] 2026-10-09 將owner接受的政策預設逐項記錄，保留尚無環境驗收的界線。
- [ ] PD01～05剩餘環境資料、維護時間與首批類型補齊；未批准依賴無新增。
- [ ] 完整逐檔白名單、精確契約／CLI／DDL（若需要）、S/M卡／fixtures／commands／FM完成。
- [ ] 五卡弱模型walk與独立審查通過；根evidence gate確認DOC_READY只代表文件。
- [ ] 文件PR必要CI通過、正常合併、回讀遠端後DOC_READY生效。
- [ ] 依DOC_READY完成產品實作、focused Red/Green與必要完整gates、獨立審查與實作PR發布。
- [ ] 隔離prod-like六大項驗收通過；與未授權正式部署／正式主機驗收分開。

本次只在完成必要工程與環境驗收後才可宣稱相應能力；本文DRAFT不替代實作。無新程式／新疑慮時不重跑已過完整套件；必要PR/main CI仍執行。沒有私人帳本工具／task ID時不捏造同步。

外部一次來源查證（2026-10-08）：[Vite static deployment](https://vite.dev/guide/static-deploy.html) 說明 preview用途；[Docker Compose production](https://docs.docker.com/compose/how-tos/production/) 與 [restart policy](https://docs.docker.com/engine/containers/start-containers-automatically/) 支持單機正式設定與process重啟策略；[PostgreSQL16 SQL dump](https://www.postgresql.org/docs/16/backup-dump.html) 說明資料庫dump一致性。停全部writer來協調獨立media是本專案的設計推論，仍須真實演練證明。

# Mithril 四台測試機使用計劃

版本：0.1；日期：2026-09-27；狀態：**文件設計完成，尚未部署或驗收**。

Owner 已確認有四台測試機，要求文檔先行並以 PR 合併。本次授權只涵蓋文件與 GitHub 交付；不是登入、安裝、重灌、故障注入或資料清除授權。主機身分、可用資源與既有服務尚未現場核對。以下拓撲、配額、門檻均是 **DESIGN／INFERENCE**，不是實測事實。

本文件把 [SDD](SDD.md) 落成四機操作路線，不改寫其 MR-R01–09 與 C01–13。任務狀態只在 [STATUS](STATUS.md) 維護；Agent 接手入口是 [EXECUTION_PROMPT](EXECUTION_PROMPT.md)。研究基線仍是 [upstream.lock.json](../upstream.lock.json) 指定的 `9959fe2e5cd466614dc20ef7b710befaaf1d746a`，不悄悄升級。

## 1. 結論與完成定義

先用三台運行 **3 master + 3 replica**，主副本交叉放置；第四台運行 Mithril 和低流量客戶端。先完成「安裝／啟動 → 實際讀寫 → 停止 → 保留資料重啟 → 精確清理」，再做相容性、故障、快取與效能。第一個成果是可以操作的實驗，不是另一套平台。

Redis 官方建議三主三副本；跨機部署還必須處理所有節點的資料／cluster bus 可達性。[R01]、[R02] Mithril 需要可用後端拓撲，本身不負責建立 Redis Cluster，也不是資料儲存引擎。[U01]、[U03]

第一輪完成必須有實測證據：固定 artifact 身分、六節點健康、跨三個 shard 的代理讀寫、未授權拒絕、公網入口不可達、兩輪 lifecycle 及非本項目資源不變。只有文件或 PING 成功都不算完成。

第一輪不做 Web UI、Kubernetes、Eru／OneFleet 整合、共享 Redis 接管、正式流量切換、自動擴縮容或全域主機調優。Mithril 先以 redis-cli、SDK、INFO 和去識別日誌體驗。[U02]、[U03]

## 2. 已知、未知與部署前置

| 類別 | 已知或決策 | 部署前必須補齊 |
| --- | --- | --- |
| 機器 | Owner 提供四台測試機 | H1–H4 到真實 SSH alias／主機身分的私有對照 |
| 系統 | 目標採 Linux；優先使用已安裝的 Docker Engine | OS、架構、版本、cgroup／Compose 能力、是否與其他服務共用 |
| 網路 | 預設用 Tailscale IPv4 承載跨機流量 | 各機是否已加入、有效存取政策、direct／relay、RTT、MTU |
| 容量 | 先小資料、低 QPS、有資源上限 | 可用 CPU／RAM／磁碟／inode、共享 workload、保留配額 |
| 權限 | 用非 root SSH 帳號與既有金鑰 | 已驗證 host key；必要 sudo 範圍；不得放寬 root SSH |
| 隔離 | 不假設測試機是空機 | 容器／服務／volume／port／防火牆／排程任務的保留清單 |
| 版本 | 固定 Mithril 研究 commit | binary 來源與 SHA-256、映像 digest、SDK／壓測器固定版 |
| 操作批准 | 本次只批准文件與 PR 合併 | 首輪實機計劃的目標、變更集與回復範圍需另行批准 |

既有 [Eru 交接文件](../../eru-vps-mvp/docs/HANDOFF.md) 記錄了一組仍有 control plane／worker 與共享 runtime 的四機環境。這只提示重疊風險，**不能據此認定就是本次四台，也不能複製它的 inventory**。若盤點確認相同，保留其 OS、SSH、Tailscale、Docker/containerd、etcd/core/agent、資料與網路規則；不能同時進行另一個實驗的重裝／故障演練。

未知欄位在私有 inventory 標為 UNRESOLVED，planner 必須拒絕產生可執行計劃；文件仍可先交付。不要求 Owner 先手工收集全部資訊：下一輪 Agent 先提供／執行已獲准的唯讀盤點，再一次整理待決事項，不在每個步驟反覆確認。

## 3. 四機拓撲與故障域

### 3.1 基準拓撲

H1–H4 是匿名角色，不是可直接使用的 hostname。每台必須有不同、已核對的主機身分。下面 M1/R1 等表示**初始角色**，故障後實際角色以後端查詢為準。

| 主機 | 初始實例 | 複寫來源 | 工作 |
| --- | --- | --- | --- |
| H1 | M1：17001；R3：17002 | R3 複寫 H3 的 M3 | 第一份 shard 與另一份 shard 的副本 |
| H2 | M2：17001；R1：17002 | R1 複寫 H1 的 M1 | 第二份 shard 與另一份 shard 的副本 |
| H3 | M3：17001；R2：17002 | R2 複寫 H2 的 M2 | 第三份 shard 與另一份 shard 的副本 |
| H4 | Mithril A：17979 | bootstrap 指向 H1/H2/H3：17001 | CLI、SDK、低流量測試與 evidence 協調 |

```text
操作端（既有筆電／controller；不算第五台測試機）
  └─ SSH 管理 H1–H4；私有 inventory／證據留在操作端

H4：測試 client → Mithril A
                   ├─ H1：M1 + R3
                   ├─ H2：M2 + R1
                   └─ H3：M3 + R2

複寫：M1 → H2/R1；M2 → H3/R2；M3 → H1/R3
```

先只建立三個空 master、分配全部 16,384 slots，再依**實際 master node ID** 明確加入指定的三個 replica；不要依賴 create 指令的自動配對剛好符合本表。每個 master 與其 replica 必須在不同主機，六個實例使用獨立資料目錄與 nodes.conf。[R01]、[R02]

設計推論：在副本健康且多數 master 可達時，這個初始配置具備測試「失去任一台 Redis 主機後，由其他主機副本接任」的條件；**不是尚未測試就宣稱 HA 通過**。同機房四台不能證明跨機房／可用區容災；若是同一 Proxmox 宿主機的四台 VM，也不能證明實體宿主機故障容忍。[R02]

### 3.2 代理入口是另一個故障域

第一輪只有 H4 一個代理；H4 故障會使代理入口中斷，即使 Redis 叢集正常。不得稱整體高可用。

C13 階段才在 H1 加第二個 Mithril B（17979），獨立配額、相同固定版／ACL 設定、各自正確的 announce-addr。先測 client 明確改連 B，再驗證選定 SDK 的多入口／重連行為；不假設設定兩個 seed 就自動完成代理 failover，也不在第一輪加入 LB／VIP。

WATCH、MULTI、Pub/Sub、連線認證與未完成請求不能隨連線無縫搬移。切到 B 要重新認證、重新訂閱、重建應用狀態並分類不確定結果。[U02] B 共用 H1 的 Redis 主機，所以此模式也不是專用代理層的獨立容量驗證。

## 4. 安裝方式、版本與資源基準

### 4.1 採用容器，不要求先在四台安裝 Rust

首選現有 Linux Docker Engine + 每台獨立 Compose project，使用 SSH 協調；不用 Swarm、共享遠端 Docker API 或新的常駐 agent。Redis 六實例與 Mithril 均以固定映像運行。若 Docker 不存在或版本不合，P0 輸出缺口；安裝／升級 runtime 屬另列的 host 變更，不能暗中執行。

Mithril 上游有容器、release binary 與 source build 三條安裝路徑。[U01] Artifact 決策順序：

1. 核對 release／映像是否能對應研究 commit、正確 CPU 架構與可驗證 checksum／digest；符合才使用。
2. 無法證明來源 commit 時，在操作端的隔離 builder 建置固定 commit，再包成實驗映像；不要在 H1–H3 邊服務邊編譯。
3. 固定 source 要求 Rust 1.98.0；build/test/clippy/fmt 留在 builder。使用 binary 啟動不依賴四台各裝 Rust，但使用預編譯 artifact 也不等於原生測試已通過。[U04]

`upstream.lock.json` 保留研究來源；未來另產生 runtime.lock.json，記錄完整 Redis patch tag、所有 image index／平台 digest、binary SHA-256、architecture、SDK／generator 版本、設定 revision。**本次不捏造 digest，也不提供以 latest 取代 pin 的後門。**

第一組後端選 Redis 7.4 系列作相容性基線，確切可取得 patch／digest 與安全風險在 P1 核對；若有不可接受風險，提出明示版本修訂，不默默更換。Atomic migration 不是此基線的必過項，需另立支援版本的實驗 profile。Valkey 留後續獨立矩陣。[U02]

### 4.2 起始配額（設計值，P0 可依實測下修）

| 元件 | 初始設定 | 限制與調整原則 |
| --- | --- | --- |
| 每個 Redis | maxmemory 256 MiB；noeviction；container memory 1 GiB | 兩實例共 2 GiB 硬配額；另保留 OS／既有服務與複寫、AOF rewrite 餘裕 |
| Redis 持久化 | appendonly yes；appendfsync everysec；獨立持久 volume | 只用合成資料；記錄磁碟與 rewrite；AOF 不等於備份或 RPO=0 |
| Mithril A | 2 workers、backend-conns 1、maxclients 256、query-buffer-limit 4 MiB | container memory 起始 1 GiB；cache=no、slave-mode=off、backend-sharding=no |
| Client | 起始總 10 ops/s、1–4 connections、小於 1 KiB value | 先不跑飽和；所有操作有 deadline／總筆數／run ID |
| 主機餘裕 | H1–H3 各至少可保留 4 GiB RAM／10 GiB 磁碟作實驗預算 | 是規劃門檻，不是 Mithril 官方最低規格；不足則縮量或停止 |
| H4 | 功能先小流量；效能需不重疊的 client/proxy CPU set | 資源不足時只交付功能，不能標為獨立效能比較 |

`maxmemory` 不是 Redis process RSS 上限；proxy cache 預算也不是 process RSS 上限。[U03] 持續記錄 cgroup memory、OOM、磁碟與共享服務 health；不為跑完測試而提高全機 ulimit、sysctl 或交換區配置。需要調整時另列精確變更與回復。

## 5. 網路、認證與最小暴露面

### 5.1 一條可解釋的資料路徑

跨機預設走已核對的 Tailscale IPv4，服務只 bind 該實驗私網位址；不監聽 0.0.0.0 或 ::。Mithril 無原生 TLS；Tailscale 提供跨節點 WireGuard 傳輸保護，但不代替 Redis／proxy ACL，也不隔離同主機程序。[U02]、[T01]

跨機容器採 Linux host networking，避免 Redis 宣告容器內部位址或 NAT port mapping。代價是失去容器 network namespace 隔離：必須明確 bind、設定資源配額、以非 root user 運行、移除不必要 capabilities、不掛 Docker socket／host root；不得當成強安全 sandbox。[R01]、[D01]

Redis 的 cluster-announce-ip 使用該主機核准的 Tailscale IP；announce data port 與 bus port 都要符合下表。Mithril 的 announce-addr 使用 client 真正可達的 H4 私網 endpoint；不寫 wildcard、Docker bridge IP 或跨機 loopback。**bootstrap 可連通不等於每個 advertised node address 都可達。**[U01]、[R01]

沒有合適 Tailscale 網路時，先停止此 profile；可另批准具路由與加密保護的私網方案，但不可退回公網明文。不得自動新增 Funnel、Cloudflare Tunnel、subnet router 或改 tailnet 全域政策。

### 5.2 Port 與存取矩陣

所有 port 都是候選保留值，P0 必須檢查六個 Redis data/bus listeners 與代理 port 是否衝突；衝突就修改受審 inventory，不搶占或停止既有服務。

| 來源 → 目的 | TCP port | 目的與權限 |
| --- | --- | --- |
| 核准操作端 → H1–H4 | 既有 SSH port | 沿用金鑰、host-key 驗證與既有管理路徑 |
| H1–H3 彼此 | 17001、17002 | Redis 複寫、資料／migration；必須雙向可達 |
| H1–H3 彼此 | 27001、27002 | cluster bus；分別對應 data port + 10000 |
| H4 → H1–H3 | 17001、17002 | Mithril backend 與受控 direct baseline／管理 client |
| 核准實驗 client → H4 | 17979 | 經認證的 Mithril A 入口 |
| 核准實驗 client → H1 | 17979 | 僅 C13 profile 啟用的 Mithril B |
| 公網、未核准 tailnet client → 所有實驗 listener | 全部拒絕 | 分別驗證 IPv4／IPv6 與 tailnet 負向存取 |

H4／client 不需連 cluster bus。Bus 是 node-to-node 協定，不是 Redis ACL 所保護的應用命令入口；必須靠私網存取控制與 host firewall 限定 H1–H3。[R01]、[R02]

核對**有效** Tailscale grants／ACL，不能只加一條窄規則卻保留既有全允許而宣稱隔離。Host networking 不使用 Compose ports 或 -p；若未來改 bridge 模式，必須重審 Docker firewall 與 UFW 的互動，不能只看 ufw status 就宣稱 port 安全。[D01]、[D02]

### 5.3 身分與 secrets

Proxy app user 只允許本 run 的 key prefix 和核准命令；proxy admin 與 app user 分離。Backend 使用專用 proxy credential、replication credential 及 operator credential，三者用途分離；禁止應用取得 CLUSTER／SHUTDOWN／CONFIG／ACL 管理權。

Backend ACL 必須涵蓋該固定版真正需要的 topology、AUTH、READONLY 等路徑；cache profile 再加入必要 tracking 能力。以正反測例確認，而非用 unrestricted default user 假裝最小權限已完成。Mithril 不轉送所有 Redis 管理命令，六節點管理使用受控 backend operator 入口。[U02]

關閉 passwordless default；私有設定由唯讀 secret 檔掛載，目錄 0700、檔案 0600，對應非 root runtime UID/GID。不得把密碼放 CLI 參數、shell history、Git、PR、可見環境 dump 或日誌；互動 client 用已核對支援的密碼提示方式。不要提交可供離線猜測的 secret hash；公開 evidence 只保留非秘密設定 hash／secret revision ID。

## 6. 分階段路線：依驗收前進，不排日曆日期

| 階段 | 做什麼 | 通過門檻 | 對應任務 |
| --- | --- | --- | --- |
| P0 | 確認 H1–H4、唯讀盤點、保留清單、資源／port／網路與回復路徑 | inventory 無 UNRESOLVED，變更集與實機操作批准明確 | MR-004 |
| P1 | 固定 artifacts、撰寫最小 lifecycle harness、離線測試與 root path-scoped CI | 無 latest／假 digest；parser／ownership／失敗恢復測試有實際 evidence | MR-004 |
| P2 | 六實例 → 三主 → 明確交叉副本 → backend health → Mithril → 基本 smoke | 全部 slots、replication、認證／listener、跨 shard SET/GET 與精確清理通過 | MR-004 |
| P3 | 實際使用、SDK、兩輪 down/up／保留資料驗證、完整核心測例 | C01–C05、C11–C12 與 MR-R02 有記錄，語意差異可重現 | MR-005 |
| P4 | 低流量故障、migration、第二代理與 client 重連 | C06–C08、C13；每項可恢復，不確定結果不被抹除 | MR-006 |
| P5 | cache、慢 client、blocking/PubSub、資源回收 | C09–C11；有 time series、負向測例、已訂明的 stale-read 門檻 | MR-007 |
| P6 | 公平效能比較、成本與採用決策 | A/A、交錯 A/B、原始資料、限制與結論；無業務 SLO 不判 production Go | MR-008 |

P4/P5 都依賴 P3，可分別開發測例，但同一四機 fixture 的實機執行必須互斥。P0–P6 是程序階段，不另建立第二份任務狀態帳。

### P0：先盤點，不先安裝

唯讀輸入包括 OS／CPU 架構、資源餘裕、listen sockets、routes、Tailscale status、runtime 版本、現有服務／容器／volume、有效 firewall、磁碟路徑與 ownership。讀取敏感輸出留在私有工作目錄，不貼公開 PR。

SSH host key 與主機身分必須對得上 Owner 核准目標；名稱相同不能代替身分核對。確認失聯時可用的既有管理／救援路徑。四台可能同 provider／同機房／同宿主機：記錄真實故障域，不猜測。

先回報「本次會新增什麼、保留什麼、可用何種 artifact、何時停止、怎麼回復」。批准後依該範圍連續完成安全的 P1–P3，不逐命令要求重複確認；越界、身分不符或新風險才停止。

### P1：先把啟停工具做小、做對

預期新增的最小產物是 per-host Compose／設定模板、私有 inventory schema、runtime lock、薄的 SSH lifecycle CLI、smoke／contract tests 與 evidence schema。**這些目前尚不存在**，不能在文件中當成已可執行工具。

下列只定義未來介面契約，不是現在可複製執行的命令：

| 介面 | 語意 |
| --- | --- |
| preflight / plan | 唯讀；列精確主機、port、artifact、新增資源、保留項與計劃 hash |
| up | 消費已批准計劃；按階段建立或安全重入；已存在且身分不符即拒絕 |
| status / smoke / report | health、受限合成資料測試、evidence 摘要；smoke 不帶 destructive 選項 |
| down | 停 client／proxy，再停本 run Redis；移除本 run containers，保留資料、設定、manifest 與日誌 |
| up（同 run） | 重用相同資料與 nodes.conf，驗證恢復；不得重新 cluster create 或清空 data |
| purge | 獨立確認精確 run ID／plan hash／待刪物件後，只刪可證明屬於本 run 且無外部引用的資料 |

不建立完整 control plane。最低必要防護是：一個 run ownership manifest、互斥操作、階段 journal、可拒絕未知狀態、精確 ID 清理。程序中斷先 reconcile；不把重跑當作可以覆蓋資料的理由。

CI 只測離線／disposable fixture，不放 VPS SSH keys 或真實 inventory；遵守 root monorepo CI 規範。文件 PR 不新增 executable harness 或 workflow。

### P2：完整但低風險地啟動

啟動順序不可跳過健康閘門：新建且空的 run-owned 資料空間 → 六個 Redis process → 三主分槽 → 依 node ID 加入交叉 replica → 等候 gossip／同步 → 認證與網路負向測試 → 啟動 Mithril → 三個 shard 的 SET/GET／刪除及 direct backend 核對。

Backend health 必須直接查六個 Redis，確認 cluster_state=ok、known_nodes=6、cluster_size=3、slots_assigned/slots_ok=16384、slots_pfail/slots_fail=0、三組 replica link 正常及反親和成立。流量下以明確 replication lag 門檻觀察，不要求變動中的 offset 每次完全相等。Mithril 的虛擬 CLUSTER 回覆不能拿來證明真實六節點健康。[R01]、[U02]

Mithril PING 只是一個檢查；必須有真正轉送的讀寫及後端比對。啟動超時或任一節點不可達時，保留日誌、停止新增變更，先診斷 seed／advertised address／ACL／bus，而不是重建叢集碰碰運氣。

### P3：使用者實際會怎麼用

先在 H4 用 standalone redis-cli／SDK 連 Mithril，不要求應用自行管理 slot。再用 cluster-aware client 直連同一組後端作對照；不要用逐命令 redis-cli -c 的 redirect 成本當正式 direct performance baseline。

在 runtime 交付後，使用者會取得一段不含明文密碼的登入命令、私有 endpoint／app user 與本 run key prefix。登入後的互動示例（**預期，不是本輪實測**）：

```text
PING                                      → PONG
SET <run-prefix>:{demo}:hello world EX 60   → OK
GET <run-prefix>:{demo}:hello              → world
TTL <run-prefix>:{demo}:hello              → 合理的剩餘秒數
DEL <run-prefix>:{demo}:hello              → 1
```

第二組使用不同 hashtag 並核對 slot：MGET 保序／重複 key／nil、跨 slot MSET 的非原子邊界、同 slot MULTI/WATCH、RESP3 的實際 wire type、跨 slot PFCOUNT 語意。負向測試確認越權 key／admin commands 被拒絕；不是只看成功路徑。[U02]

先建議每個功能測例至少重複三次，steady smoke 共至少 10,000 logical operations、非故障窗 value/order mismatch 與非預期 error 均為 0；測例數與總筆數進 evidence。這是實驗門檻，不是可靠度統計保證。資料只使用合成值與 run prefix，不使用個人 session／真實帳務／生產 key。

兩輪 lifecycle 分開驗證：同 run down/up 不丟已靜止且確認落盤的標記資料；purge 後新 run 可以空白重建；非 owner 資源前後不變。前者不是意外斷電或 master failover 的零資料損失證明。

## 7. 故障測試與回復策略

所有 fault 先列 target process/container ID、預期影響、最長窗口、恢復命令與健康門檻；一次只做一個。每個測例預設 60 秒恢復觀察 deadline，來源是設計而非上游保證；timeout 後判失敗／阻塞，停止下一個 fault，不以 reset 掩蓋。

| 測例 | 刺激 | 觀察與恢復 |
| --- | --- | --- |
| F01 / C08 | 停一個 run-owned replica process | 應用低流量影響、replication degraded；啟回同一資料，等同步完成 |
| F02 / C08 | 停一個 run-owned master process | 觀察副本晉升、錯誤窗與代理拓撲刷新；恢復原 process，不強推舊 master role |
| F03 / C08 | 模擬一台 Redis 主機失去其兩個實驗 process | 保留 SSH/runtime/Eru；只驗證本實驗的合成主機故障，不稱真實 OS／網卡故障 |
| F04 / C06 | 在指定 slots 做有限 legacy migration | 記錄 MOVED/ASK/TRYAGAIN、pipeline 及 partial-write 行為；按實際 ownership 完成或修復遷移 |
| F05 / C07 | INCR 已送出但未收到回覆時斷 client 連線 | 分開 acknowledged／rejected／ambiguous；不無條件重試非冪等操作 |
| F06 / C13 | 停 Mithril A process，client 改連 B | 分開入口恢復與 Redis 健康；重新認證／訂閱，記錄未完成 session 狀態 |
| F07 / C08 | 只阻斷實驗 data/bus 流量 | 另行批准；精確規則與本地自動回復預案，不碰 SSH／Tailscale 控制面 |

F01–F06 仍須在獲准的實驗操作範圍內；F07、整機 reboot／斷網、磁碟故障另設明確批准，不拿「四台可用」當 blanket permission。不能停止 tailscaled、Docker daemon 或 containerd 來做網路／程序故障。恢復器不得依賴已被測例切斷的唯一管理通道。

重要：F02 後 master 可能重新分布，原始 M/R 表不再代表現況；先恢復 replica 健康並重新核對故障域。若下一測例要求初始反親和，使用經批准的 controlled failback 或新的乾淨 fixture。**不能在重排後仍假稱任一主機故障可被原配置容忍。**

Redis 非同步複寫可能遺失已確認寫入；Mithril 也不提供 exactly-once，且固定版本不代理 WAIT。[R01]、[U02] 因此回報實際 recovery time、已確認寫入遺失／重複、不確定比例，不預設 RPO=0 或故障零錯誤。測試必須有操作序號與最終資料核對，僅看 INCR 最後數字不夠。

## 8. 快取、效能與四機限制

P5 才開 reply-cache，先設 per-worker 16 MiB 的小預算，觀察真實 RSS／cache_bytes／hit ratio／flips；測外部 writer、TTL、tracker 斷線、topology change、跨 worker 讀取。Replica routing 另立 profile，不能與 cache 同時開再把效果混算。[U02]、[U03]

P6 初始矩陣只選同一 SDK/generator、相同 keyspace 與 master-only GET/SET：direct cluster-aware、Mithril no、yes、auto；cache 全關。從 pipeline 1/16、connections 32/128、64 B value 開始，挑代表格，不先跑完整笛卡兒積。

四機的 H4 同時放 proxy 與 generator，功能測試可接受，但效能有混部偏差：將 CPU sets 分開並保留系統／Tailscale 資源，記錄 CPU steal、throttling、記憶體與網路；direct arm 也使用相同 generator 配額，不能吃到空出的 proxy cores。無法排除 client bottleneck 時，只報「混部端到端觀察」，不宣稱代理極限吞吐。

先 A/A 評估噪音，再至少五輪交錯 A/B、反轉順序；固定模式候選 warm-up 30 秒／量測 60 秒，auto workload-transition 至少觀察 10 分鐘以涵蓋較長冷卻，與 SDD 保持一致。負載型態、ramp、pipeline burst/sliding、重試策略與量測窗一併保存。[U03]

Tailscale 每個 peer pair 記錄 direct／DERP／peer-relay，並在測試前後核對；relay 不一定妨礙功能，但不能拿混合傳輸路徑做公平極限比較。WireGuard／共享 vCPU／同機房條件都須列入報告。[T01]

必報 logical ops/s、backend ops/s、p50/p95/p99/p99.9、錯誤／timeout／ambiguous rate、CPU/RSS/FD、複寫 lag、network bytes、proxy/cache 統計。固定 offered load 與飽和測試分開；client 供給不足或 closed-loop latency 偏差明示。沒有真實工作負載 SLO 時只做相對比較，不先訂任意「一百萬 QPS」或 production 採用承諾。

## 9. 停止條件、保留與清理

立即停止加壓／新變更的條件：目標身分不符、非 owner 資源被改動、公網／未授權 tailnet 可連、資料不符、OOM、失去管理通道、恢復 deadline 到期。共享服務 health 出現新故障時也先停止並調查，不預設與本實驗無關。

起始資源護欄：MemAvailable 低於 max(1 GiB, 主機 RAM 的 20%)，或實驗檔案系統可用低於 20%，先停 generator、保留服務與 evidence；P0 可在批准計劃中修訂。飽和模式可耗盡已核准的專用 CPU 配額，但不能侵入共享服務保留 cores。日誌需 rotation／大小上限，避免觀測本身吃滿磁碟。

所有 runtime/state/secrets/raw evidence 放在 checkout 外的私有目錄；私有 manifest 保存 run ID、主機 identity、批准 plan hash、容器／volume 精確 ID、資料 realpath、UID/GID、版本與階段。公開 repo 不保存真實 IP、SSH alias、主機 fingerprint、密碼、dump、完整 inventory 或 raw 日誌。

正常停止順序：停止 client／壓測 → 停新 proxy 流量 → SIGTERM proxy 並觀察 drain → 停本 run Redis → 保存紀錄。上游 proxy drain 約五秒不是應用請求必定完成的保證。[U03]

清理前先 dry-run 列物件並核對 ownership、reference 與路徑；未知物件保留。禁止 docker system prune、docker volume prune、廣域 rm、killall redis-server、清空他人 keyspace／nodes.conf、重設 firewall 或 provider reimage。資料路徑若有 symlink／unexpected mount／hardlink，拒絕自動刪除，待人工處理。

partial failure 只回復本輪已建立、仍能核對身分的資源；不能清掉前一成功 run 或其他專案。Redis 既有資料不能靠「回切舊 image」就宣稱已回滾；版本變更須另有相容性／restore 設計。本次不涉及版本升級或真實資料搬遷。

## 10. 驗收交付與下一個 session

每輪交付一份去識別 summary：run ID、Git/upstream/artifact 身分、匿名拓撲、非秘密設定 revision、實際命令與 exit status、測例/筆數、PASS/FAIL/SKIPPED/NO RESULT、錯誤與回復、保留服務前後差異、下一個最早未完成 MR 任務。Raw evidence 留私有目錄，公開摘要以匿名角色對應，不暴露主機識別資訊。

首個可用里程碑是 P0–P3：使用者能親自讀寫，能停止與保留資料重啟，能在確認後清掉自己建立的實驗。其後才決定是否值得 P4–P6；不必完成全部效能研究才開始體驗。

下個 session 從 [EXECUTION_PROMPT](EXECUTION_PROMPT.md) 開始。先核對合併後 main 與 [STATUS](STATUS.md)，輸出 P0 盤點／計劃；不要直接執行本文件的故障或清理設計。本次文件合併不會把 MR-004–008 改成 runtime DONE。

## 11. 來源與版本邊界

U01–U04 固定在本研究 commit；R/D/T 是 2026-09-27 查閱的官方動態文件，支援部署原理而非證明候選版本已實測。具體 Redis patch、容器及 SDK 行為在 P1/P3 再按 runtime lock 驗證。原始研究的 16 筆 S 來源與讀取範圍不變。[SOURCES](SOURCES.md)

[U01]: https://github.com/projecteru2/mithril/blob/9959fe2e5cd466614dc20ef7b710befaaf1d746a/docs/installation.md
[U02]: https://github.com/projecteru2/mithril/blob/9959fe2e5cd466614dc20ef7b710befaaf1d746a/docs/compatibility.md
[U03]: https://github.com/projecteru2/mithril/blob/9959fe2e5cd466614dc20ef7b710befaaf1d746a/docs/operations.md
[U04]: https://github.com/projecteru2/mithril/blob/9959fe2e5cd466614dc20ef7b710befaaf1d746a/rust-toolchain.toml
[R01]: https://redis.io/docs/latest/operate/oss_and_stack/management/scaling/
[R02]: https://redis.io/docs/latest/operate/oss_and_stack/reference/cluster-spec/
[D01]: https://docs.docker.com/engine/network/drivers/host/
[D02]: https://docs.docker.com/engine/network/packet-filtering-firewalls/
[T01]: https://tailscale.com/docs/reference/connection-types

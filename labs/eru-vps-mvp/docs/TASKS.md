# ERU VPS MVP：固定編號任務清單

建立：2026-09-23。此清單從目前尚未完成的工作開始編號；首次部署、worker-4 元件重裝 3/3、恢復／patched reapply、背景觀測工具、資料回收分析及本機 SIGKILL 驗證已完成，不重複計入。

**目前剩餘 12 項：近期收尾 1 項，後續驗證／擴充 11 項。此清單內完成 6 項。** 依 owner 指示先完成本機開發，再統一做正式 VPS E2E。ERU-012 本機功能已齊待 E2E；ERU-013 的 v0.1.5 patch 已用 Go 1.27.1 重驗，另對 unreleased master commit 做 forward-compatibility probe；仍等下一個 stable tag 與正式跨版本 evidence；ERU-014 已有 preparation、worker-only install、registration 前 core known_hosts／nft access、fenced registration／smoke／resume、hash-bound inventory／generation commit，以及跨六 stages 的 snapshot/recovery coordinator；全部只用 fake tests 驗證，patch 仍未部署、整體 E2E 未完成，任務數不變。

正式 E2E 待辦首項仍是 **ERU-007**（V11 小流量運行驗收），但暫緩到本機開發收尾後。ERU-006 已完成 worker host-network 私網 HTTP、公網 v4/v6 TCP/80 隔離、core 公網管理埠阻擋、容器 DNS A 查詢與 IPv4 HTTPS egress 驗收；實機結果及限制見 [ERU-006 紀錄](M3-NETWORK-ACCEPTANCE-PREP-2026-09-24.md)。近期 7 項完成仍不等於原 SDD 全部 V01–V11 或完整 HA 已通過。

## 計數與每次回報規則

- 固定 ID 不重排、不重用；新增工作往後追加編號。拆分／取消／範圍變化須留下變更紀錄，回報數量為何變動。
- 表中每列算一項。子步驟、測試案例、提交、PR 或文件更新不另外算任務。
- 狀態使用「待做／進行中／待驗收／完成／延後」。只有達到該列完成標準並留下證據，才能標為完成；延後、等待或受阻仍計入剩餘。
- 「已完成本機程式，尚缺實機驗證」不能將需要實機結果的整項任務減掉。分析報告也不能冒充根因已修復。
- 本檔是計數依據；其他交接／歷史 TODO 的複述不重複計數。完成時更新本表、完成紀錄及 HANDOFF；證據含私有資料時只放私有路徑與可公開摘要。
- **之後每次交付回報：`本次完成：ERU-xxx（名稱）。目前剩餘 N 項（近期 A、後續 B）。下一項：ERU-yyy。`** 若只完成部分步驟，回報「本次完成編號：無；ERU-xxx 仍進行中」，數量不減。

## 近期收尾：7 項（完成 6、剩餘 1）

| 編號 | 任務 | 狀態 | 前置／完成標準 |
| --- | --- | --- | --- |
| ERU-001 | core 更新於替換前中斷的取消／封存 | 完成 | 先在本機實作新的 source-bound 操作；核對 replace-intent 尚未成立、原檔未改變，保留 journal／備份／未知資料；驗證中斷與回覆遺失，且 reapply 不會被錯誤放行。本機測試、操作文件與交付完成；實機 core 故障另列 ERU-005。驗收見 [ERU-001 紀錄](M2-CORE-CANCEL-2026-09-23.md)：167 tests 通過，原 journal 缺失仍拒絕取消，不將缺失視為安全。 |
| ERU-002 | 回收並判讀目前 24h 觀測 | 完成 | run `20260923T112336Z-561e71e7`，共同涵蓋 86,400 秒；01–03 各 2,881 筆、最大間隔 30 秒，完整性錯誤／功能失敗／警告均為零。01 WAL fsync 6,308 observations、p99 桶上界 8 ms；backend commit 僅 2 observations，不能據此穩健估計尾端延遲。末端 snapshot etcd health 成功、workers 可用、兩個原 canary 仍在，隨後另依 ERU-003 清理。此為 30 秒低頻觀測，不是原 SDD V11 PASS，也沒有證實歷史慢 fdatasync 根因；詳見 [回收 TODO](TODO-SOAK-2026-09-23.md)。 |
| ERU-003 | 精確清理本次 canaries 與配額對帳 | 完成 | 原 canary run `20260923T112207Z-99e9508c` 僅由新 plan `20260924T112838Z-4deeeff4` 清理；plan 綁定原 smoke evidence 與 live snapshot，只列 worker-2／3 的兩個 run-owned workloads，執行前重核 owner/run/node。journal complete，post-state 無 workloads、worker-2／3／4 配額皆為零且可用；etcd、core、agents、Docker/containerd 均保留，firewall oneshot 與 proxy socket listener 維持 active。未做 blanket reset；私有 journal 不提交。
| ERU-004 | etcd 慢同步的原因、影響與處理成本分析 | 完成（分析交付；根因未證實） | [分析紀錄](M2-ETCD-ANALYSIS-2026-09-23.md) 已納入歷史 11–23 秒慢 `fdatasync`、後續短窗口、完整 24h 低頻觀測及 etcd v3.6／Linux／Prometheus 官方文件。結論：故障類型最支持暫時性持久化 I/O 長停頓；guest／虛擬磁碟／宿主機／provider 層無法區分。說明控制面影響與低／中／高相對成本；沒有進行儲存變更或宣稱根因修復。證據足以完成分析，但不構成根因修復或排除間歇風險；若復發或取得 provider telemetry，再新增任務做相關性驗證／修復。 |
| ERU-005 | core API 不可用時的實機恢復演練 | 完成 | [ERU-005 演練紀錄](M2-CORE-API-RECOVERY-2026-09-24.md)：12:10:48 UTC 停止 01 的 eru-core；新 recovery plan 從已完成來源 run 備份恢復成功，隨後由獨立新 plan 回切已驗證 patch。core API 可讀、執行中 binary 與驗證 artifact 相符、etcd health 通過；3 workers available 且配額／runtime／workloads／3 個 metadata 前綴皆為零，保留服務狀態未變。單次 core service outage，不代表 VM／磁碟災難已驗收或 etcd 根因已修復。 |
| ERU-006 | 補齊 host network 與管理埠隔離驗收 | 完成 | 最終 plan/run `20260924T174428Z-a6f4feb1`：worker host-network 私網 HTTP 成功，worker 公網 v4/v6 TCP/80 均阻擋，core 六個管理埠探測均阻擋；bridge A query 與 plan 相符，IPv4 HTTPS 回 HTTP 200。execute cleanup complete；read-only reconcile 確認 workload、CNI NAT、forward rule、guard 皆為 0，remote 與 cluster/host baseline restored。操作器對實際 DOCKER-USER/ONEVPS-INGRESS 順序作窄範圍 UDP DNS 例外，無持久 firewall 設定變更；worker 原有 TCP/80 Anywhere allow 仍保留，raw plan／evidence 留在 private。詳見 [驗收與診斷紀錄](M3-NETWORK-ACCEPTANCE-PREP-2026-09-24.md)。 |
| ERU-007 | 正式 V11 小流量運行驗收 | 進行中 | ERU-002 與本項分開。原 SDD 要求 1 req/s、24h、成功率 ≥99%、無 OOM／etcd alarm／磁碟使用 >80%；補齊採樣與判讀後，以獨立 VPS 背景 run 執行並保存結果。現有 30 秒取樣不能直接算本項完成。[本機準備紀錄](M3-V11-PREP-2026-09-23.md) 已交付每秒取樣／離線判讀；短 pilot 與獨立 24h 實機 run 尚未驗收，剩餘數不減。 |

## 後續驗證／擴充：11 項

| 編號 | 任務 | 狀態 | 前置／完成標準 |
| --- | --- | --- | --- |
| ERU-008 | 將元件重裝擴及 worker-2／3 | 進行中 | [唯讀目標核對](M2-WORKER-PEER-PREP-2026-09-23.md) 、[目標外守護配對](M2-WORKER-PEER-GUARDS-2026-09-24.md) 與 [peer 執行器](M2-WORKER-PEER-EXECUTOR-2026-09-24.md) 已完成本機／唯讀驗證；觀測結束並精確清理後仍須逐台完成實機隔離、重裝、HTTP、配額及其他節點保留驗收。 |
| ERU-009 | 非空 worker 的計畫性 drain／重裝／恢復 | 進行中 | [離線 planner、staged executor 與 recovery](M3-WORKER-NONEMPTY-DRAIN-PREP-2026-09-26.md)：planner 產生 ERU-012 完整、owned、stateless revisions 的 review-only 計畫；staged executor 綁定 live preflight、one-shot fence，全部 replacements exact 且 HTTP-ready 後才以 `AppRevisionCleanup` 按 exact IDs 清來源。唯讀 recovery 不重播 fence／deploy／remove；partial cleanup 後 reconcile parent 與 fresh child journals，只為仍存在的 exact source IDs 建一個 app 的新 hash-bound cleanup plan；target metadata、containers、tasks、usage 全零才開一般重裝 gate。共用 `AppRevisionCleanup` 於每次 remove 與最後 readiness probe 後核對全群 workload identities，並在共用 `ClusterLock` 下更新 recovery journals；漂移時停在 `needs_review`。`labctl` 提供離線 plan、唯讀 prepare、明確 execute、唯讀 recover，以及 fresh cleanup plan／execute 六個命令；26 個 drain fake tests、ERU-012 cleanup/reconcile regressions 與目前完整 383-test suite 通過（PR #137 合併時為 381）。遠端命令／API/job 語意與整體 VPS E2E 尚未驗收，任務未完成。 |
| ERU-010 | worker 非計畫失聯恢復（V07） | 待做 | 有界演練偵測時間、先 fence、精確對帳 stale metadata／配額，於健康 worker 人工或一次性工具重建；不宣稱自動維持副本數。 |
| ERU-011 | 可重現 bootstrap 與新 controller 接手 | 進行中 | [本機接手前置檢查](M3-CONTROLLER-PREFLIGHT-2026-09-23.md) 已記錄 runner／OS package／artifact 與外部私有輸入、SSH alias 邊界；仍須從乾淨 controller 使用外部 inventory／keys 重現受控 bootstrap，不依賴目前 B 的暫存工具。乾淨 OS 實機驗收配合 ERU-014／015。 |
| ERU-012 | 應用差異部署與真實無狀態服務 | 進行中 | 已有 v1 spec／digest planner、hash-bound executor、EruCLIAdapter 與 exact-ID cleanup plan／executor；沿用 labctl.Operator、固定 SSH aliases、雙階段 etcd/core/consistency preflight、digest image cache、bodyless worker probe，並在每次 remove 前驗新版 readiness、對照全群 workload identities，包含最後 readiness probe 後的核對。AppExecutor／AppRevisionCleanup 的 public reconcile 也在共用 `ClusterLock` 下讀寫 journal。容量 admission 交由 Eru resource plugin，v1 不含外部 traffic routing。planner／executor／adapter／cleanup 共 54 個離線測試。尚需真實 CLI/API/job 與 VPS E2E 驗證，故任務未完成。詳見 [離線前置](M3-APP-DESIRED-STATE-PREP-2026-09-25.md)。 |
| ERU-013 | patch 發布與跨版本升級／回退 | 進行中 | [provenance／版本 guard](M3-CORE-RELEASE-PROVENANCE-2026-09-25.md) 與 [Go 1.27.1 隔離重驗](M3-GO127-REVALIDATION-2026-09-25.md) 已完成。另以 Go 1.27.1 對未發布的 upstream master `e9b48c12663f18e1356ee29f7ce2ac0963a8ae4d` 做 forward-compatibility probe：兩份 v0.1.5 patch 可套用，基線重現兩個 lock panic，patched regressions／calcium+store／locks tests／build 通過，兩次獨立 source build byte-identical。這不是新 release，不改 artifact lock／release manifest，也不部署；官方最新穩定版 v0.1.5（2026-09-09）與 repo 鎖定版本相同，master 雖領先 5 個 commit，尚無更新的 stable tag。尚無較新 stable tag 的正式 patch build／manifest，也未完成跨版本升級／回退／中斷驗證與最後 VPS E2E；任務維持進行中。詳見 [master candidate probe](M3-CORE-MASTER-CANDIDATE-2026-09-26.md)。 |
| ERU-014 | 單 worker 人工 OS 重灌與重新納管 | 進行中 | Owner-reviewed intent／receipt、hash-bound preparation、replacement host verification、離線 worker plan、worker-only install、registration 前 core known_hosts／firewall source allowlist access preparation、fenced registration、fenced smoke 與 safe-resume executors／read-only reconcile 均以 fake operator 驗證。access stage 僅原子更新 target 的 host-key entries／Tailscale source IP，registration 與 smoke 需核對相同 access proof。registration 核對 running core SHA，AddNode 後維持 bypass=true 並等候 agent available；smoke 在 peer HTTP guards 下清理 target nginx；resume 透過 core SSH alias 單次執行 node up 並核對 available=true／bypass=false，成功停在 `resumed-awaiting-generation-commit`，generation 保持不變。其後的本機 stage 會重驗成功 resume、worker IP 與 OOB host key，將 target IP／core known_hosts／firewall render 寫回 private deployment plan，再把 cluster generation 加一；兩檔以 hash-bound journal／唯讀 reconcile 分段提交，可在精確 partial state 下明確續跑。fake-only 測試通過，未讀寫真實 private data。pinned core v0.1.5 Bypass-at-Add patch 已用 Go 1.27.1 雙環境建置；patch 仍 verified-not-deployed。跨階段 coordinator 核對 predecessor journal hashes／target identity，只選第一個未完成 stage；plan 僅產生下一步指引，recover executor 只呼叫單一既有唯讀 reconciler，stale snapshot 會停止。fake-only 測試通過，沒有連線 VPS 或讀寫真實 private data。仍缺 safe AddNode patch 受控部署與整體 E2E。provider API 不使用，OS reimage 與日常元件重裝分開驗收；見 [safe AddNode](M3-CORE-SAFE-NODE-ADD-2026-09-26.md)、[core access](M3-REIMAGE-WORKER-ACCESS-2026-09-26.md)、[registration](M3-REIMAGE-WORKER-REGISTER-2026-09-26.md)、[smoke](M3-REIMAGE-WORKER-SMOKE-2026-09-26.md)、[resume](M3-REIMAGE-WORKER-RESUME-2026-09-26.md)、[generation commit](M3-REIMAGE-WORKER-GENERATION-2026-09-26.md) 與 [跨階段 recovery](M3-REIMAGE-WORKER-RECOVERY-2026-09-26.md)。 |
| ERU-015 | 全群 fresh 重建連續三次（V08） | 待做 | 獨立範圍計畫、新 generation、外部版本／secrets 可用；三次均重新驗證 V01–V04、舊 metadata／容量無殘留並記錄 RTO。不得以 worker-4 元件重裝 3/3 代替。 |
| ERU-016 | 控制 metadata 備份／還原（V10） | 待做 | 外部取得完整 etcd keyspace snapshot，校驗、保存與還原；隔離舊控制面，對帳 worker／workload／plugin 與 HTTP，記錄 RPO／RTO。不冒充應用 volume 還原。 |
| ERU-017 | 三成員 etcd quorum 驗收（V09） | 待做 | Profile B 以獨立冷重建計畫安排；停止一個 etcd 服務後，其餘成員健康、新寫入／部署成功，恢復後一致。仍只有一個 core，完成本項也不宣稱整體 HA。 |
| ERU-018 | 隔離環境的 VM／磁碟故障恢復邊界 | 待做 | 先定義有界故障矩陣與隔離環境，驗證檔案持久性、journal 與未知資料保護；明列涵蓋／未涵蓋的故障。現有程序 SIGKILL 測試不等於 VM 斷電或磁碟掉寫驗收。 |

第二個 core、線上 etcd 擴容、process/cocoon/GPU、公網 ingress、Web UI、OneFleet adapter 與 provider API 是原設計的延後／選配範圍，不列入這批 18 項；若日後啟動，須明確新增編號。這樣不會因看到歷史文件中的所有延伸構想就持續擴張本輪目標。

## 驗收對照與執行邊界

- 既有首次部署／nginx lifecycle／V04／V05／worker-4 元件重裝等結果見 [HANDOFF](HANDOFF.md)，不重複開新任務。V01–V03 的完整乾淨環境與網路缺口對應 ERU-006、011、014、015；V06 的 OS 版本對應 ERU-014。
- 目前原始 V11 尚未通過；ERU-002 收回的是已明確記錄限制的低頻觀測。ERU-007 保留原始頻率與門檻，不偷偷降低標準或重啟現有 run。
- 實機 mutation 一律使用既有 plan/hash/journal/ownership 邊界；目前 soak 期間可做本機開發及唯讀檢查，需改 VPS 時先處理觀測狀態。任務排入表格本身不代替具體操作範圍審閱。
- 日常保留 OS、SSH、Tailscale、Docker/containerd 與控制面；OS 重灌只走人工控制台後備路徑。raw evidence、實機 inventory 和 credentials 維持私有。

## 完成紀錄與數量變更

| 日期 | 事件 | 本清單完成數 | 剩餘 |
| --- | --- | --- | --- |
| 2026-09-23 | 初次彙整未完成任務 ERU-001～018；已完成歷史工作不重計，整理清單本身不算功能任務完成 | 0 | 18（近期 7、後續 11） |
| 2026-09-23 | ERU-001 本機實作／中斷及回覆遺失驗證／操作文件完成；沒有新增、拆分或取消任務 | 1 | 17（近期 6、後續 11） |
| 2026-09-24 | ERU-002 完成 24h 低頻觀測 evidence 收集、離線判讀及末端 cluster 核對；無新增、拆分或取消任務 | 2 | 16（近期 5、後續 11） |
| 2026-09-24 | ERU-003 依新 hash-bound plan 精確清理原 canaries，驗證 workloads／配額歸零及服務保留；無新增、拆分或取消任務 | 3 | 15（近期 4、後續 11） |
| 2026-09-24 | ERU-004 完成根因候選、影響、成本及 24h 新證據綜合分析；根因未證實，沒有進行儲存變更；無新增、拆分或取消任務 | 4 | 14（近期 3、後續 11） |
| 2026-09-24 | ERU-005 完成一次有界 core API 停止／backup recovery／validated patch 回切及保留服務、workers、配額、runtime／metadata 核對；無新增、拆分或取消任務 | 5 | 13（近期 2、後續 11） |
| 2026-09-24 | ERU-006 完成 host network 私網 HTTP、公網 v4/v6 隔離、core 管理埠阻擋、CNI DNS／HTTPS 與獨立 reconcile；無新增、拆分或取消任務 | 6 | 12（近期 1、後續 11） |

相關紀錄：[Soak 時間與查詢命令](TODO-SOAK-2026-09-23.md)、[core 中斷驗證與限制](M2-CRASH-RECOVERY-2026-09-23.md)、[原始驗收契約](SDD.md)。

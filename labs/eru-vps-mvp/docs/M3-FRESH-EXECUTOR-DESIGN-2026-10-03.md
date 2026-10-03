# ERU-015 fresh executor：執行與恢復設計

日期：2026-10-03。來源基線：`1e4bd8e43bd5fe30cb536e91479e44c9d2beb303`。本文是後續實作契約草案；本次只做 source/contract review，沒有建立執行器、執行 stage、讀取真實 private 資料或操作主機。ERU-015／V08 仍未完成，[SDD](SDD.md) 的驗收不變。

## 後續本機實作進度

[Simulation journal／receipt coordinator](M3-FRESH-SIMULATION-2026-10-03.md) 已接續本設計進行本機實作：immutable record store、stage-level fake actions、no-replay 與 observation-only recovery。這不代表下列 production stages 已實作；實際 host receipts、全域 pending barrier、bootstrap、V01–V04／residue probes 與 generation commit/seal 都仍待完成。本文原始設計及其完整驗收標準保留。

## 已固定的範圍

延續 [fresh prep](M3-FRESH-REBUILD-PREP-2026-09-27.md) 與 [本機收尾](LOCAL-CLOSEOUT-2026-10-03.md)：僅 Profile A，精確四台 provider resource 與所有受影響 volume，一次 `G → G+1`；OS 重灌由 owner 在 provider console 完成，`provider_api_used=false`。fresh 只建立全新 etcd，不匯入 snapshot、舊 data-dir、membership、node/workload/plugin metadata。日常元件重裝、單 worker OS 重灌、控制面還原都不替代這個流程。

一般開發授權允許設計、synthetic fixtures、fake/contract tests 與本機程式開發；真正停止 writer、改隔離規則、重灌、清資料或 bootstrap 四機，必須另有綁定實際 plan/hash、generation、provider/volume scope 與資料處置的操作授權。人工 receipt 證明發生過什麼，不替代事前授權。此區分不要求 owner 再回答已決定的 manual console／fresh-only／Profile A 選項。

現有 review plan 永遠保持 `executable=false`、`execution_implemented=false`；不得改寫既有 envelope 來取得權限。未來 execution envelope 另以新 operation/schema，綁定原始 review-plan digest、執行程式版本、當次授權與即時前置證據。所有新 schema、CLI 與儲存路徑在本文均是**待實作提案**。

## 進入執行前的證據

執行器先取得叢集外 journal 與唯一 controller 的 mutation lock，再重新讀取 bindings。controller report（24 小時內）、source commit／乾淨工作樹、code inputs、inventory 原始 bytes、cluster record、artifact/upstream/core validation、四份 intent、app spec、external material attestation、reviewed data disposition 都必須一致。review 的 30 日期限不能取代即時 writer／host 觀測。

建立 execution envelope 時保存四台目前 machine/boot identity、host key、etcd cluster/member identity 與 token digest，並在私有證據保存全 keyspace 的 key/identity inventory、ERU runtime identities、plugin capacity baseline；不要把 secret value 寫進公開摘要。這些 baseline 只供 residue 比對，不能用來恢復新 etcd。舊 node 的 logical name 可以相同，舊 registration/incarnation、workload ID 或非預期 capacity 不能殘留。

external materials 必須在四台之外可實際讀回且 hash 驗證成功：bootstrap secrets、console access 與持久 evidence store。data disposition 必須逐一覆蓋 boot/additional volume；遇見未列入的掛載、非實驗資料或 ownership 不明就停止，不自動擴張 erase scope。

writer fence 涵蓋所有其他 controller、CI、app writer 與會改 metadata 的服務。先停止外部 mutation 入口、等待在途操作歸零，保存 owner/operator fence 證據，再停止舊服務並觀測隔離生效。`node down` 只禁排程，不足以證明 writer 已停；TCP 暫時不通也不足以證明失聯機已隔離。失聯舊實例必須有 provider/network 層的外部 fence 證據，且新 cluster 啟動前確認舊核心與舊身份不能再連入。

[ClusterLock](../scripts/labops.py) 只協調同 controller checkout；不是跨控制器 lease。此設計限定一個已選定、叢集外 controller，搭配對其他 writer 的外部 fence。controller 故障不得自動 failover 或按 timeout 偷鎖；先明確隔離舊 controller，再由人工審閱的 takeover binding 恢復讀取外部 journal。不能將重複的本機 lock file 當成全群互斥。

## 固定階段與停止邊界

順序沿用 [fresh_rebuild.build_plan](../scripts/fresh_rebuild.py) 的十二個 stage。每個 stage 只接受前一個 sealed receipt 的 exact digest；四台主機各自的子步驟同樣先 durable intent、後 side effect。任一 host 失敗就停止，不自動繼續其他 host。每次下一步都重核 source/artifact/scope、當前 pending generation、writer fence 與該步所需 incarnation；boot ID 改變也必須停止重新對帳。

| Stage | 允許的工作／進入條件 | 通過 receipt 與停止點 |
| --- | --- | --- |
| `controller-ready` | 只讀前述 bindings、外部材料及 controller identity；不得改遠端 | 報告 digest、可讀回的材料證據、source/artifact hashes、空 blockers |
| `scope-reviewed` | 只讀 exact 四 host／volume intents、資料處置及實際操作授權 | 授權 digest、scope digest、四台舊 incarnation／baseline 證據；任一不明停止 |
| `writers-quiesced` | 有授權後依明列範圍停止 writer、建立外部 fence；每個動作都有 intent | writer-stop receipt、在途操作為零、舊 controller/core/worker 隔離證據；不可用 review boolean 代替 |
| `generation-started` | 在叢集外不可覆寫地保留本 run 的 `G+1`，綁定 `G` cluster hash 與 fence | reservation receipt；此時**不更新** accepted cluster generation，不允許另一 run 消費同一 `G+1` |
| `hosts-reimaged` | 每台先寫 console action intent，owner 人工執行精確 OS/volume 重灌；執行器只等待／驗 receipt | 四份 owner receipt，OS image/volume results、新 machine/boot IDs、OOB host fingerprints；少一台、同舊 incarnation、scope 不符皆停止 |
| `network-and-access-ready` | 所有重灌 receipt 通過後，受控設定私網、嚴格 SSH trust、精確管理 firewall 與 core→worker access | 四個不碰撞 endpoint、逐台 host identity、已核對 key、公網管理埠拒絕；此 stage 不啟動 etcd/core/agent |
| `empty-control-plane` | 在新 core 安裝 hash-locked etcd，確認全新允許的 data root，綁定新 token 後建立單成員 etcd；core/plugin writer 仍停 | etcd health、新 cluster/member identity、token digest、無 snapshot/舊 data roots、全 user keyspace 為空；舊狀態存在只報錯，不清除後重試 |
| `cluster-bootstrapped` | 使用已核對的 artifacts 與獨立 fresh render 啟動 core/plugin，註冊 exact 三 workers；每個 install/start/register 子步驟獨立 journal | 三 workers up、role/endpoint/capacity/agent 正確、etcd healthy、core CLI 可讀及 V01 時間；不能靠 exists 視為註冊成功 |
| `apps-replayed` | 從新叢集快照為每個 reviewed desired spec 產生全新 ERU-012 child plan，逐一執行／核對 | exact replicas/labels/spec/image、每 worker V02 lifecycle 全命令結果、V03 bridge/host-network HTTP 與公網拒絕；canary 清理由 run-owned exact IDs 限定 |
| `resources-accepted` | 逐 worker 執行有界超額 memory/storage 拒絕與 remove 實驗；先記錄已知可用量 | V04 明確拒絕證據、失敗/remove 後配額回復、合法 app quota 保留；不做自動 resource fix |
| `residue-audited` | 只讀全 metadata keyspace、每 worker ERU namespace 的 runtime/CNI/ownership、所有啟用 plugin 容量與新 registration | exact desired state 與容量 ledger 一致；無舊 incarnation/workload、未知 node、孤兒 runtime、旧 plugin reservation 或非預期 data roots。不可只查 `/eru` 或只比 count |
| `generation-accepted` | 所有前置 receipt、V01–V04/residue、timing 完整後，執行下節本機 commit/seal | immutable evidence index、exact local generation commit、accepted-run record；本 stage 不發遠端命令 |

`network-and-access-ready` 的 bootstrap 身份取得允許 owner 先在 console 設置 SSH/私網；所有這類操作仍須列入該 stage 的 intent/receipt，不能把自動 `ssh-keyscan` 當 OOB trust。變更 IP 只接受 receipt/觀測明列的新端點，更新 derived inventory，不改 provider/volume scope 或 campaign identity。

## Immutable records 與人工 receipt

提議叢集外私有區 `operations/fresh-rebuild/executions/RUN_ID/` 保存獨立 `execution.json`、`intents/`、`receipts/`、`observations/` 與 `evidence-index.json`，另在 `generation-reservations/` 保存唯一 generation claim。plan/run/stage/substep 都使用 bounded identifiers；拒絕 duplicate JSON keys、非標準數字、超限檔案、路徑穿越與 private 根以下 symlink。沿用可信 private root 可為 symlink 的既有契約，但 recovery 每次核對同一 backing root identity。

每份 intent/receipt 的必要欄位：schema/operation、run ID、review/execution plan hashes、cluster ID、before/target generation、stage/substep/ordinal、predecessor receipt digest、scope/source/artifact bindings、host incarnation binding、action ID、start/end timestamps、result、evidence 的 relative path/raw SHA-256/size。結果只可為明確的 `passed`、`failed` 或 `uncertain`；只有 `passed` 推進。第一份 receipt 綁 execution envelope 作 predecessor。一次 stage 只容許一個 completion receipt；重複或 competing branch 直接報衝突，不能按最新 timestamp 挑一份。

公開 stdout 僅輸出 ID/hash/count/status；完整 provider/volume refs、IP、spec、host identity 留 private。credential/token 原文不进 journal。evidence index 對每個原始檔案驗證 bytes 與類型，不把存在一個 SHA 欄位當成證據已驗證。

寫入順序為：序列化並 fsync 同目錄 temporary file → 原子 no-clobber publish → fsync parent directory → 才允许 side effect。併發同 ID 必須只有一個勝者，既有有效 bytes 不覆寫。可以借 [core_publish](../scripts/core_publish.py) 的不可覆寫發布模式；[atomic_json](../scripts/labops.py) 是可覆寫 current-state writer，不可直接用來發布 sealed receipt。現有 [fresh_rebuild_ops._write_once](../scripts/fresh_rebuild_ops.py) 的 reservation 思路可參考，但執行 receipt 必須另外覆蓋 crash/併發/惡意路徑測試，不能以 planner 測試推論執行 journal 已安全。

人工 console receipt 沿用 [reimage_receipt](../scripts/reimage_receipt.py) 的語意：`provider_api_used=false`、`owner_confirmed=true`、exact reviewed image/provider/erase scope、console action ref、完成/審閱時間、replacement machine/boot/OS、`host_key_verified_via=provider-console` 及 Ed25519 fingerprint。新 fresh schema 另綁 execution/run/generation/host intent/console action intent 與隔離證據；四份 action ref 不重複。保留 action plan→完成不超過 24 小時、owner receipt 最近 7 日的驗證，且進入下一 stage 前須重新觀測 incarnation。現有 validator 拒絕非單 worker `rebuild-node` plan，不能用假的 worker plan 包裝 core receipt；應另外實作 fresh validator，共用純欄位驗證並保持原限制。

receipt 與後續 observations 分開，讀取 recovery 不改舊 receipt hash。observations append-only 且有自己的 predecessor/observed-at；若新觀測發現漂移，保留原成功事實但阻止後續 stage，不重寫歷史為成功。

## Interrupted／lost response 恢復

不宣稱網路 side effect 有 exactly-once delivery。可保證的是：每個 action 先有唯一 durable intent；只 dispatch 一次；未知結果不 dispatch 第二次。

| 停止情形 | 唯讀恢復分類 | 後續規則 |
| --- | --- | --- |
| 還沒有 action intent | `not-started` | 重核 bindings 後可執行首次 action |
| intent 存在，還沒呼叫 adapter 就 crash | `uncertain` | 僅憑本機 log 不推定沒執行；讀取 owner/host/resource 證據，不能重播 |
| side effect 完成、response 或 receipt 遺失 | `observed-complete` 或 `uncertain` | exact identity/scope/content 後置狀態及 action provenance 足夠才追加 recovery observation + sealed completion；不足則停 |
| 只重灌部分主機／install 部分檔案 | `partial` | 已完成子步驟不重播；未發 intent 的後續步驟只能在獨立 resume review 後繼續，不能由 reconcile 呼叫 mutate |
| receipt 後主機 reboot/keys/endpoint 漂移 | `drift` | 停止，保存實際觀測，重新審閱 affected stage；不可把新 incarnation 靜默納入 |
| 找到重複 run/receipt、錯 predecessor、壞 JSON/hash、fence 失效 | `blocked` | 禁止後續 mutation；保留所有 bytes，不自動刪除或「選最新」 |

例如 manual reimage 回覆遺失，只核對原 console action ref、provider/volume 結果與新 incarnation；不能再要求同 intent 重灌。etcd 已健康但 token/cluster identity 無法綁定原 action，也不能判成功。app create 遺失回覆可沿用 [AppExecutor](../scripts/app_executor.py) 對 exact revision/labels/replicas 的 lookup，但仍要通過 HTTP readiness；找不到不代表 create 未發生，不再次 deploy。V02/V04 cleanup 遺失回覆只查 exact owned IDs 與 quota，不重播刪除，不用 prune/flush 修飾結果。

借用 [reimage_worker_recovery](../scripts/reimage_worker_recovery.py) 的 first-incomplete-stage、snapshot digest 與 read-only dispatch 思路；fresh recovery 不照抄 `_latest_plan` 選最新計畫的策略。CLI 應分開 review／首次 stage execute／readonly reconcile／明確的後續 resume；reconcile adapter 根本沒有 mutate 方法。其本機 append evidence 是允許的，`remote_mutation_performed=false` 必須可由 fake call ledger 證明。

失敗 run 的 generation reservation 不釋放，不重用同 plan/run ID，不改名納入三次成功。副作用後的 abort 留在 pending，阻擋其他 cluster mutation；如何走專用 recovery 或新的 owner-reviewed 基線由獨立處置計畫決定，不能自動把失敗 run 推成 `G+1 accepted` 或改成 `G+2` 繞過現有 `G→G+1` 契約。

## Generation 與 acceptance 寫入順序

1. `generation-started` durable reservation 消費 target generation 的執行權；`cluster.json` 仍為 G。重灌後的新系統由 pending execution identity 管理，其他一般 operator 必須因 pending barrier 拒絕 mutation。這個 barrier 需要後續實作，現有 ClusterLock 本身不足以跨 process 結束維持它。
2. V01–V04/residue 均 passed 後，先 sealed evidence index（所有前置 receipt、command result、observations 與 timing hashes），再寫 acceptance-prepared record；它不是 accepted run。index 不包含最終 acceptance，避免循環 hash。
3. 在同一 controller lock 與 pending barrier 下，保存 local commit intent：inventory/host-trust manifest/cluster record 的 exact before/after hashes。inventory 和 trust 先換到已驗證四機；最後把 cluster record G compare-and-swap 成 G+1。每一檔都是原子 write，整組不是一筆 transaction；[worker generation](../scripts/reimage_worker_generation.py) 的 partial-state classifier 可參考，但不得呼叫其單 worker commit。
4. 重新讀回所有 after hashes，發布 immutable generation-commit receipt，再發布 `accepted-runs/PLAN_ID.json`；完整欄位保持 [fresh_rebuild._series](../scripts/fresh_rebuild.py) 現有 accepted record schema：plan/cluster/generation/series/iteration identity、全部 required checks passed、RTO、evidence-index digest。不得先有 accepted record 再做 generation commit。
5. 最後追加 barrier completion。若 crash 在任一點，先只讀分類所有受影響檔案的 exact before/after 組合；只允許符合既定寫入順序的 prefix，未知混合 state 是 drift。獨立 local finalize 可以完成剩餘 local writes／seal，絕不重發 remote commands。cluster 已是 G+1 且 receipt 遺失時只補證據，不再次加一。

cluster 在 G+1 但尚未 seal accepted-run 時不允許下一 iteration。只有 generation commit、accepted record 及完整 evidence index 都可讀回，下一 plan 才能引用 immediate predecessor。未來 execution input loader 必須重驗整份 index 與 commit linkage；目前 planner 驗的是 acceptance 欄位與 digest binding，不能把它誤報為已驗證每份 underlying evidence。

三個獨立成功 iteration 必須維持同 campaign source/artifacts/provider-volume-OS scope/desired manifest，generation 逐次 +1，前次 target token 等於下次 prior token，而每次 target token 都不同。任一失敗不能補一份假的 acceptance 續接 campaign。

RTO 保存 timezone-aware wall timestamps 與可核對 monotonic duration；至少記 total、provider queue、installation 及固定 1800 秒 candidate。total 從本 run 開始 quiesce 到 readiness/residue 完成（包含人工等待），另記 seal 時間；provider queue 使用 console request/start 區間的聯集，平行排隊不雙重扣除；installation 從第一台可開始安裝到 V01 readiness，另記逐 host 時間。缺 provider queue 訊息不填零，標 evidence 不足。V01 安裝及 V08 全流程分別報量測值與 candidate comparison；超過 candidate 明確呈現，不私自把候選門檻改成硬 pass/fail 或隱去耗時。[SDD V08](SDD.md) 的三次 V01–V04 與無殘留要求不變。

## 可重用元件與不能直接重用的部分

| 元件 | 可重用 | 仍須新實作／限制 |
| --- | --- | --- |
| [fresh_rebuild](../scripts/fresh_rebuild.py)、[fresh_rebuild_ops](../scripts/fresh_rebuild_ops.py) | strict schema、scope/campaign/series/token bindings、private path 模式 | review-only；不得用它們的 flags 宣稱 remote stage 已完成 |
| [controller_preflight](../scripts/controller_preflight.py)、[core_release](../scripts/core_release.py) | controller/material/artifact provenance 核對 | fresh 需要 live fence、空控制面與四機 incarnation gates |
| [reimage_review](../scripts/reimage_review.py)、[reimage_receipt](../scripts/reimage_receipt.py)、[reimage_host](../scripts/reimage_host.py) | reviewed erase scope、OOB fingerprints、read-only identity 方法 | receipt／host verifier 僅單 worker；須另寫 core facts、新 OS 尚無 runtime 的 bootstrap 前置階段，不能移除舊 validator 限制 |
| [labops](../scripts/labops.py)、[reimage_worker_recovery](../scripts/reimage_worker_recovery.py)、[reimage_worker_generation](../scripts/reimage_worker_generation.py) | controller lock、durable current-state writes、first incomplete／exact partial-state 模式 | 新 immutable store、pending barrier、多檔 finalize 與四機 orchestration |
| [app_desired](../scripts/app_desired.py)、[app_executor](../scripts/app_executor.py)、[app_cleanup](../scripts/app_cleanup.py) | spec identity、child plan、read-after-timeout、exact owned cleanup | child plan 必須基於新叢集；加 fresh generation binding；V02/V03/V04 不等於 app readiness |
| [deploy-lab](../scripts/deploy-lab.py) | 經隔離抽取並測試的 payload/render 片段 | 現有入口保留既有 runtime，且 etcd token 固定；不是全新 OS bootstrap，不能直接以 `--apply` 充當本流程 |

## 下一個最小可執行切片

建議先交付 **本機 fresh execution journal／receipt coordinator**：新增獨立純 state machine + strict private record store，輸入既有 review envelope、synthetic authorization/fence/host baseline，輸出 execution envelope、stage intent、receipt chain 與 readonly recovery classification。adapter 僅 fake，不接 SSH、provider、subprocess/network；不註冊 production `rebuild-cluster` 或自動解鎖 accepted generation。允許在 temporary fixture 執行完整十二階段模擬以測順序，所有 synthetic evidence 清楚標記，拒絕拿去真實 accepted-runs。

先讓一個「action response 遺失後第二次 execute 不得呼叫 mutate」測試因 coordinator 尚缺而失敗，再完成最小 guard/state transition；下一輪補 durable store 與 crash matrix。實作 check 分為 pure reducer tests、temporary-file integration tests 及 fake-adapter orchestration contract tests，無需 live E2E 就可驗證這個切片，但不表示 ERU-015 已實作完。

| Fake/fixture 場景 | 必要觀察結果 |
| --- | --- |
| 合法 chain、十二 stage、四 host receipt | 嚴格依序，所有 successor 綁 exact predecessor，只有 fake actions，production mutation count 0 |
| blocked review、缺授權、過期 controller、source/inventory/artifact drift | 0 side-effect dispatch；不 reserve generation 或 mark accepted |
| 缺一 host、duplicate provider/volume/action ref、混 OS、舊 incarnation/key | 接受 receipt 失敗；保持舊 bytes，後續 action count 0 |
| 缺 writer fence、未歸零、第二 controller、pending generation 衝突 | 在 action 之前拒絕；timeout 不偷鎖、不自動 failover |
| 同 run ID 併發、同 stage 不同 receipts | 一個 no-clobber 勝者；另一方讀到衝突，不選最新 |
| intent fsync/publish 前後、dispatch 前後、response/receipt 各 crash 點 | intent 未 durable 時 0 dispatch；已 durable 一律不重播，唯讀 reconciliation 分類可靠 |
| 完成後 lost response、not-found、read error、部分結果 | 只觀察；只有 exact action provenance + postcondition 可通過，不見資源不觸發重試 |
| 改 predecessor、重複 key、NaN、超限 JSON、path/symlink drift | fail closed；無 out-of-scope write，原 records 不變 |
| 非空 etcd、舊 token/member、snapshot、plugin 殘留 | 阻擋 bootstrap/acceptance；不呼叫 cleanup 作補救 |
| app 規格/副本不符、HTTP fail、V02 缺命令、V04 配額殘留 | 不進 accepted；不把局部成功縮成總 passed |
| before/prefix-after/all-after/未知混合 local commit fixture | read-only classifier 正確；fake finalize 只做缺的 local write，generation 不重加，接受不得早於 commit |
| 缺 V01–V04/residue、壞 index、錯 iteration/campaign/token lineage | 不 seal accepted、不減正式任務數 |
| RTO 缺值、負數、非有限值、平行 queue、candidate 超時 | 拒絕無效 timing；union 不雙算；超時仍明列 comparison |
| public summary 含 synthetic private sentinel | redaction test 必須失敗，阻止真實 IP/provider/spec 外洩 |

此切片不需新增 runtime dependency，也沒有尚須 owner 選擇的產品方向。需要另行驗證的工程工作已具體列出：fresh bootstrap renderer、OS/runtime 安裝器、四機 receipt/facts validator、所有 mutation 入口的 pending barrier、實際 fence/console 證據匯入、V01–V04 與 residue probes、local commit/seal、最後三次 live generation。真實 destructive run 的授權與當時 receipt/materials 屬操作前提，不是現在本機設計工作的阻礙。

## 本次驗證界線

本文件以 source traceability 對照十二 stages、SDD V01–V04/V08、prep 的三次 generation/token lineage、現有人工 receipt 與 readonly recovery；新增內容都標為待實作。只驗證 Markdown 相對連結、trailing whitespace 與 diff；沒有執行新 coordinator 或任何遠端 stage，也沒有修改 SDD／正式任務狀態。

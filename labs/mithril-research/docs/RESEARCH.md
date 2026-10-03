# Mithril：Redis Cluster 代理的架構與邊界研究

研究日期：2026-09-27。基線：`9959fe2e5cd466614dc20ef7b710befaaf1d746a`。方法：官方文件全文閱讀，加上五個關鍵 Rust 模組的完整或指定範圍核對；不是全庫審計，也沒有獨立效能複現。來源與閱讀範圍見 [SOURCES](SOURCES.md)。

## 1. PREP 摘要

**Point — 結論。** Mithril 適合作為 Redis Cluster 資料面的研究對象；本輪建議建立有界驗證環境，暫不採用於真實業務。判斷重點不是 README 的速度形容詞，而是應用是否能接受它的相容性與故障語意。

**Reason — 理由。** 它集中處理 slot routing、連線複用、pipeline、重導向與多 key fan-out；同時新增一層 session state、佇列、快取與運維責任。把複雜度搬到代理，不代表消除複雜度。[S02], [S03]

**Example — 例子。** `MGET` 可以替非 cluster-aware client 拆成多個 slot 子請求，最後依原始 key 順序合併；但跨 slot 的 `MSET` 不是一個分散式交易，部分子請求成功後別的子請求失敗，沒有全域 rollback。[S11] 因此「命令可執行」和「具單機 Redis 的原子性」是兩件事。

**Point — 行動。** 先在快取關閉、只讀 master、固定 sharding 模式下測語意與故障，再測 auto 與快取；每一項優化都必須單獨說明收益、資源成本與一致性代價。

## 2. 它在系統中負責哪一層

```text
應用／Redis client
  -> Mithril 單一入口
     -> 認證、命令檢查、slot routing、fan-out、保序
        -> Redis / Valkey Cluster 的 master 與 replica
```

Mithril 是 TCP/RESP 代理，不是資料儲存引擎、排程平台或 Redis Cluster 建置工具。資料持久化、複寫和叢集成員管理仍由後端承擔；代理不應被誤當成資料備份層。其虛擬 cluster 回覆把自己呈現為持有所有 slots 的單一節點。[S03], [S04]

**研究推論：** 虛擬單節點讓 client 隱藏後端拓撲，也使代理入口成為新的可用性邊界。多個代理 process 不會自動解決入口故障：還需設計 client seed／LB／重連策略，並確認 `announce-addr` 指向 client 真正可達的端點。跨代理的 ACL runtime 變更、WATCH、MULTI、Pub/Sub 與 cache 是各自的 process/session state，不應假設切換連線時會自動搬移。[S03], [S06], [S07]

## 3. 架構：執行緒、連線與資料流

### 3.1 Thread-per-core 不等於所有模式都無共享

文件描述每個 worker 使用單執行緒 Tokio runtime 與局部連線池；獨立 acceptor 按近期命令活動分配新連線，拓撲以 `ArcSwap` snapshot 更新。已讀 `server.rs` 的 admission ticket 用 Drop 釋放 maxclients 名額，placement 依活動 snapshot 與本輪已分配量選 worker。[S02], [S13]

重要修正：只有 `backend-sharding no` 的主要 request path 保持 worker-local。`yes`／`auto` 會走跨 worker fabric；`src/shard.rs` 可直接看到 `Arc`、`Mutex`、bounded request channel 與 shared reply queue 的使用。`Fabric::owner` 依 node address hash 決定連線 owner，`pipe` 管理每 node/database 的共享通道。[S12]

**不可把它概括為「全程 lock-free」或「每個請求一定不跨核心」。** 它是在 locality 與更深的 batching 之間做可配置取捨。控制通道也存在 unbounded channel；文件對 client admission 的有界性聲明，不等於已完成全程序最壞記憶體證明。[S02], [S12], [S13]

### 3.2 Zero-copy 是局部策略，不是全程序零配置

`resp.rs` 的掃描結果是 frame 長度與參數數量，`Args` 返回借用的 byte slice；支援增量掃描，並對 bulk、argument count、depth 等設上限。這支持「不要先把每個 RESP 值反序列化成物件」的設計。[S14]

文件描述 request/reply 使用 `Bytes` 切片，後端以 vectored write 批次傳送。[S02] 但 `multikey::split` 會重建子請求，`merge_mget` 會建立合併回覆 buffer。[S11] 因此 zero-copy 應理解為常見轉送路徑避免不必要複製，不是任何命令都不複製、不配置，也不代表 TCP 的 kernel/user copy 全部消失。

### 3.3 三種 backend-sharding 模式

| 模式 | 請求主要走法 | 研究重點 |
| --- | --- | --- |
| `no` | worker 自己的後端連線 | locality、跨 worker 成本最低的基準 |
| `yes` | node owner 的程序級共享 pipe | 非 pipeline 流量能否靠 batching 改善吞吐；owner 是否過熱 |
| `auto`（固定版本的預設） | session 訊號加上程序級量測實驗切換 | 遷移前 drain、探測成本、穩態與 workload 變化 |

文件對 auto 的描述不是單純「看到 CPU 高就切換」：還量測 batch 深度、負載穩定性與整體 command rate，僅在實驗有效時保留共享路徑，否則回退並延後再探測。這些是固定版本的文件契約，本輪未逐行審計 auto tuner。[S02], [S06]

**連線容量推估（不是硬上限）：** DB0、無 blocking／Pub/Sub／WATCH／tracker 時，`no` 的普通連線量約隨 worker 數 × contacted nodes × backend-conns 成長；`yes` 的共享部分約隨 node/database 數成長。非零 DB、獨佔連線、tracker 及 replica 都會增加成本，auto 也不能只用其中一條公式估算。[S02], [S06]

## 4. 一次請求的生命週期

### 4.1 單 key 與 pipeline

以同一 session 的 `GET a`、`GET b` 為例：掃描 frame、檢查命令與 ACL、求 slot、選 node、送入後端 pipe；完成時間可以相反，但 writer 依序號回覆，避免 client 把 `b` 的結果誤認為 `a`。此保序機制及重導向的處理依架構文件；已讀的 route 模組證實寫入落在 master，read-only 可依模式選 replica。[S02], [S10]

**研究推論：** 回覆保序不是所有後端 side effect 的全域序列化。慢的前序回覆仍可能形成 session 的 head-of-line blocking；必須以不同 backend 延遲、長 pipeline 與慢 client 驗證，不能只量單 key GET 平均延遲。

### 4.2 多 key：分 slot，而不是只按 node 分組

`src/multikey.rs` 的檔頭使用 per-owner-node 的概括，但 `split` 實際以 `u16 slot` 建 HashMap。這是必要差別：**同一個 master 持有的兩個不同 slot，也不能直接組成需要 same-slot 的後端多 key 命令。** 子請求保存原始 `positions`，`merge_mget` 按位置重建順序；`merge_sum` 加總整數，`merge_ok` 要求所有子回覆為 OK。[S11]

例：令 `a`、`b` 的 slot 不同，`MGET a b a` 不能只靠子請求完成順序拼接回覆；必須回成對應 `a,b,a` 的三個位置，包含重複 key 與 nil。未取得各分片的同一時刻快照，因此也不應宣稱跨 slot 的 snapshot consistency。

### 4.3 重導向、重試與不確定結果

MOVED／ASK 由代理吸收並觸發 debounced topology refresh；遷移期間會依條件有限等待重試。若同 session 已有後續命令 in flight，部分重試路徑會回 TRYAGAIN 或 NOSCRIPT，而不為透明重試破壞順序。持續的 legacy migration TRYAGAIN 可能導致多 key 命令拆成單 key，失去原本 same-slot 操作的整體原子性；PFCOUNT 不走該拆解。[S03], [S04]

**研究推論：** 上述重導向不是 exactly-once 協定。非冪等命令已送出而回覆遺失時，應用可能不知道是否生效，不能把所有 timeout 一律重送。實驗必須同時記錄 acknowledged、failed、ambiguous operation IDs；`INCR` 的計數是特定受控測例，不足以證明所有故障場景零重複／零遺失。

## 5. 相容性不是一句「支援 Redis」

| 能力 | 固定版本的邊界 | 對應驗證 |
| --- | --- | --- |
| `MULTI/EXEC`、`WATCH` | key 必須同 slot；MULTI 不接受所有 Redis 可接受的命令，例如 EVAL/PING | 成功、跨 slot 拒絕、WATCH 失聯不能無保護 EXEC |
| RESP3 | client 可 HELLO 3；一般 backend command pipe 維持 RESP2；aggregate 仍可呈 flat array | 比較實際 SDK 解碼，不僅看 HELLO 成功 |
| tracking connection | reply-cache 使用 RESP3 tracking，與一般 backend pipe 不同 | 不把「backends RESP2」誤解成完全沒有 RESP3 後端連線 |
| 多 key `PFCOUNT` | 跨 slot 是各 slot cardinality 加總，不是集合聯集 cardinality | 讓兩個 slot 的 HLL 都包含同一元素，觀察重複計數 |
| SCAN／DBSIZE | cluster-wide 合成 cursor／加總，不是單節點快照 | 拓撲變化、重複／漏讀容忍與 cursor 行為 |
| `SELECT n` | 對應具 cluster-databases 的 Valkey 功能，非所有 Redis Cluster 都適用；快取只服務 DB0 | Redis 與 Valkey 分開測，不把版本條件抹平 |
| 管理指令 | WAIT、FAILOVER、SHUTDOWN 等不代理；FLUSHDB 也未實作 | 應用所需指令逐項盤點，管理改走獨立受控入口 |
| 安全／監控 | 無原生 TLS、無 Prometheus endpoint；透過 INFO 取統計 | 私網／加密傳輸與 exporter 是外部整合責任 |

上述限制來自上游行為與相容性文件，不代表本地測試已通過。[S03], [S04] 尤其 WAIT 缺失不能靠「proxy 是透明的」略過；有複寫確認需求的應用需重新評估。

## 6. Reply cache：效能模式，也是資料語意選擇

快取預設關閉；啟用後服務 GET/MGET，透過後端 tracking invalidation 維護，proxy 經手的寫入先使本地 key 失效。文件另外描述 fill ticket、invalidation race、tracker coverage loss 會 flush／暫停 fill；這些是重要待驗證契約，而非本輪已逐行確認的 cache 模組結論。[S02], [S06]

它不是只靠 TTL 的過期快取，也不是跨 client 線性一致性保證。上游承認 invalidation 傳遞與 server expiration cycle 造成可觀察延遲；`reply-cache-max-age-secs` 是保護界限之一，不能據此宣稱所有讀取都是最新。Replica read 不做 cache fill；開 read splitting 也不能承諾 read-your-writes。[S03], [S06]

容量要乘上 worker 數：`reply-cache-max-bytes` 是 per-worker 預算，且 two-generation 策略要求活躍 hot set 能裝入半份預算才不易頻繁翻轉。`cache_bytes` 不是程序 RSS 的硬上限；上游量到 eviction churn 的 allocator retained memory。研究必須同時觀察 RSS、cache_flips、hit ratio 與後端 tracking 壓力。[S07]

**本項目的基準設定：cache=no、slave-mode=off。** 先排除一致性模式差異，再單獨測有 locality、無 locality、外部直寫、到期、tracker 中斷與 topology change。

## 7. 如何閱讀上游 benchmark

上游提供多套環境：例如 16-core 裸機的 3-master/3-replica，以及較大主機上的 32-node cluster；不同章節還涉及不同 commit lineage、auto 演進與 client 的 pipeline 行為。這不是一張可任意合併的排行榜。[S05]

上游「代理比 direct 更快」的解釋，是額外 batching 減少後端 per-operation syscall 負擔；在特定負載下合理，但不是代理可以消除網路延遲，也不是所有 workload 都更快。同一文件亦記錄其他 proxy 在部分非 pipeline、tail latency 場景有優勢。[S05]

獨立複現時要守住四件事：

1. 比較相同語意：cache on/off 分開、master-only/replica 分開；相同 logical operations，另外報 backend command amplification。
2. 固定工作量：client 版本、thread、connection、pipeline（burst 或 sliding）、key distribution、value size、SET/GET 比例。
3. 隔離資源並量尾延遲：client、proxy、backend 的 CPU、NUMA、網路位置分開記錄；報 p50/p95/p99/p99.9、error rate、CPU、RSS，不只報 QPS。
4. A/A 先估噪音，A/B 交錯、多輪反轉順序；auto 另外量探測、回退與 1–8 分鐘級冷卻，不以一次短測代表穩態。

上游數值在本項目一律標為 **UPSTREAM-CLAIM**；沒有 LOCAL-RUN 的 Mithril 效能數字。本輪不重貼整份排行榜，避免舊版本結果被誤當作目前 commit 或你的 VPS 能力。

## 8. 與現有專案的關係

| 既有內容 | 可借鏡之處 | 必須保持的邊界 |
| --- | --- | --- |
| [systems/snail（rudis）](../../../systems/snail/README.md) | Rust、RESP、thread-per-core、pipeline 與 backpressure 的對照 | rudis 是記憶體 server，Mithril 是 proxy；不搬程式碼、不恢復 dormant 投資 |
| [labs/eru-vps-mvp](../../eru-vps-mvp/README.md) | 將來可提供 disposable workload 的操作經驗 | 同屬 projecteru2 不代表 Mithril 依賴 Eru；本輪不動其機器 |
| `kernel` 的 host／workload 平台 | 未來可把代理當獨立 workload 做 catalog／監控 | 不是先改 control plane；host 權限與應用生命週期分離 |

前兩項依既有 README；本表第三項是未來整合方向，不是已完成整合。若需要認證隔離、固定 endpoint 或舊 SDK 使用 Cluster，代理有研究價值；若 client 已成熟支援 Cluster 且沒有具體痛點，則多一層代理可能只增加故障與維護成本。

## 9. 初步採用判斷

**Go：** 原始碼閱讀、受控 fixture、相容性／故障／效能驗證。

**尚不批准：** 真實流量切換、公開監聽、預設開快取、以此替代 Redis 持久化／備份、把上游速度聲明當選型結論。

採用前至少回答：應用真正使用哪些指令與 SDK？是否接受跨 slot 非原子性？最大可容忍陳舊讀取是多少？故障時重試由誰負責？代理多副本與憑證如何管理？如何觀測到實際 binary、設定及 cache 模式？驗收設計見 [SDD](SDD.md)。

[S02]: https://github.com/projecteru2/mithril/blob/9959fe2e5cd466614dc20ef7b710befaaf1d746a/docs/architecture.md
[S03]: https://github.com/projecteru2/mithril/blob/9959fe2e5cd466614dc20ef7b710befaaf1d746a/docs/behavior.md
[S04]: https://github.com/projecteru2/mithril/blob/9959fe2e5cd466614dc20ef7b710befaaf1d746a/docs/compatibility.md
[S05]: https://github.com/projecteru2/mithril/blob/9959fe2e5cd466614dc20ef7b710befaaf1d746a/docs/benchmarks.md
[S06]: https://github.com/projecteru2/mithril/blob/9959fe2e5cd466614dc20ef7b710befaaf1d746a/docs/configuration.md
[S07]: https://github.com/projecteru2/mithril/blob/9959fe2e5cd466614dc20ef7b710befaaf1d746a/docs/operations.md
[S10]: https://github.com/projecteru2/mithril/blob/9959fe2e5cd466614dc20ef7b710befaaf1d746a/src/route.rs
[S11]: https://github.com/projecteru2/mithril/blob/9959fe2e5cd466614dc20ef7b710befaaf1d746a/src/multikey.rs
[S12]: https://github.com/projecteru2/mithril/blob/9959fe2e5cd466614dc20ef7b710befaaf1d746a/src/shard.rs
[S13]: https://github.com/projecteru2/mithril/blob/9959fe2e5cd466614dc20ef7b710befaaf1d746a/src/server.rs
[S14]: https://github.com/projecteru2/mithril/blob/9959fe2e5cd466614dc20ef7b710befaaf1d746a/src/resp.rs

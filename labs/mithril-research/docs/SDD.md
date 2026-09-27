# SDD：Mithril 有界研究實驗台

版本：0.1。狀態：設計基線；runtime 尚未實作／驗證。上游基線見 [lock](../upstream.lock.json)，研究結論見 [RESEARCH](RESEARCH.md)。此 SDD 的產品是「可重現的驗證實驗」，不是另一個 Redis proxy。

## 1. 目標、非目標與決策

目標是分別回答：語意是否滿足應用、故障是否可觀測與恢復、效能收益是否在公平配置下存在、部署責任與資源成本是否可接受。

不做 production 部署、自動接管既有 Redis、host bootstrap、Eru／OneFleet 整合或 Mithril 重寫。不修改 upstream、不中途換 commit、不 vendor 上游程式碼。本次 owner 授權是研究，實機操作另行確認 disposable 範圍。

ADR-001：`labs/mithril-research` 是 canonical 研究位置；研究產物與 upstream 分開。

ADR-002：M0 只交付文件與設定範例。M1 才加入可執行 fixture/harness 與 root path-scoped CI。

ADR-003：第一組 baseline 固定 `backend-sharding no`、`reply-cache no`、`slave-mode off`；auto、cache、replica 是獨立變因，而非默認混在同一組成績。

ADR-004：版本 pin 不是可重現環境的全部；還需 image digest、toolchain、client／generator 版本、硬體與完整設定。

## 2. 擬議拓撲與 ownership

```text
測試 coordinator（測例、operation ID、結果分類）
  ├─ direct cluster-aware client ────────────────┐
  └─ standalone / cluster-aware client -> Mithril ─> 3 masters + 3 replicas
                                             └─ INFO / log / RSS evidence
```

功能 fixture 可在一台隔離 Linux VM；這只證明該環境的功能，不代表跨主機網路與生產 HA。效能階段另把 generator、proxy、backend 用 CPU placement 或分機隔離並記錄共享資源。所有容器、network、volume 使用獨一 run ID 與 ownership label；清理只可命中該 run 的資源，不使用全域 prune、FLUSHALL 真實服務或 provider reset。

Mithril 設定與 credentials 分開。首個可信本機 fixture 用 loopback 對外入口，後端只在專用 network；跨主機前須有 proxy/backend 認證與加密傳輸方案。沒有原生 TLS 的限制來自上游，不可把 authenticated TCP 寫成 encrypted TCP。[S04], [S06]

## 3. 需求與驗收契約

| ID | 需求 | 驗收證據 |
| --- | --- | --- |
| MR-R01 | 鎖定上游 commit、toolchain、images、client | manifest、image digests、binary SHA-256、實際啟動 command/config hash；不僅看 version string |
| MR-R02 | lifecycle 可重跑且只清理自己 | create→health→test→stop→cleanup 兩輪；證明非 owner 資源未變 |
| MR-R03 | 基本 RESP2/RESP3 與 SDK 正確 | response type/value/order 與精確 SDK 版本；預期不支援項明示 |
| MR-R04 | multi-key 語意與 same-slot 原則可驗證 | 重複 key、nil、同 master 不同 slot、部分失敗；不將 fan-out 成功當全域交易 |
| MR-R05 | 遷移／斷線不隱藏不確定結果 | operation IDs、acknowledged/failed/ambiguous 分類、時序與最終值核對 |
| MR-R06 | cache 一致性與故障降級有證據 | direct backend writer、TTL、tracker 丟失、topology change、跨 worker read |
| MR-R07 | admission 與資源釋放有界可觀測 | 慢 client、blocking、Pub/Sub、maxclients、query-buffer-limit、RSS／FD time series |
| MR-R08 | benchmark 可公平重跑 | A/A、交錯 A/B、多輪、相同語意與 workload；完整 raw evidence |
| MR-R09 | 決策不跨越證據範圍 | 每條結論連到 run ID／來源；NO RESULT 不轉 PASS；無實測不判 production-ready |

## 4. 功能與故障矩陣（待執行，不是測試結果）

| Case | 刺激／場景 | 正確判讀 |
| --- | --- | --- |
| C01 | RESP2 與 HELLO 3；GET nil、HGETALL、Pub/Sub | 核對實際 wire type 與 SDK value；aggregate 相容不等於 native RESP3 maps |
| C02 | `MGET a b a missing`，a/b 明確不同 slot | 按輸入位置保序、重複與 nil 保留；另構造同 master 的不同 slot |
| C03 | 跨 slot MSET／DEL，單一子請求失敗 | 允許文檔宣告的 partial application；若業務要求全域 atomicity，應判不適用 |
| C04 | 同 hashtag 的 MULTI/WATCH；跨 slot／EVAL/PING | 可支援路徑成功；不支援路徑可辨識拒絕；WATCH socket 失聯不得無保護 EXEC |
| C05 | 兩個 slot 的 HLL 放入重疊元素，再 PFCOUNT | 明示跨 slot 加總不是 global union，不能當估算誤差忽略 |
| C06 | legacy／atomic migration，各做 sequential 和 pipelined traffic | 分別核對重試、TRYAGAIN、same-slot atomicity 降級；需後端版本支援 |
| C07 | 已發送 INCR 後中斷連線；不同時點故障 | 保留 ambiguous 分類；不盲目重送以製造偽 exactly-once |
| C08 | master failover、bootstrap seed 失聯、全部後端不可達 | 有界錯誤與恢復 evidence；記錄 refresh／READONLY／TRYAGAIN，不預設零錯誤 |
| C09 | cache on + backend 直寫、expiration、tracker kill | 測陳舊視窗、coverage-loss flush 與 refill；timeout 閾值須先定義 |
| C10 | 慢 subscriber、blocking client 斷線、WATCH 釋放 | 不阻塞其他 session；FD、memory、exclusive backend connection 能回收 |
| C11 | maxclients／query-buffer-limit；巨大或分片 frame | 明確拒絕、不 OOM、不污染別的連線；觀察有限時間內的資源回落 |
| C12 | 權限不足、跨 key-prefix、ACL runtime 變更與重啟 | 符合配置限制；驗證 runtime ACL 不被誤當成持久配置 |
| C13 | 停一個 proxy，重新連接另一個入口 | 重新認證／訂閱；不聲稱 WATCH/MULTI state 可搬移；檢查 announce-addr |

C03、C05 是刻意暴露語意差異的測例；「觀察到差異」可使相容性描述通過，但不表示滿足特定業務。

M1 可先選一種 digest-pinned Redis backend 做 C01–C05、C11–C12，再逐步加 Valkey 與 migration 矩陣。上游列舉的多版本 98-test 結果是參考，不是本專案的通過證據。[S04]

## 5. 效能設計

第一輪只比較相同 GET/SET 語意：direct cluster-aware baseline、Mithril no/yes/auto；cache 全關、master-only。第二輪才加 cache 並分別測 hot-set、uniform、混合寫入與外部 writer。Replica read 是第三條獨立實驗軸。

固定 workload axes：connections 先選 32/128/512，pipeline 1/4/16，value 64 B/512 B/4 KiB，GET-only 與 SET:GET 1:1，worker 1/2/4（受 CPU 配額限制）。這些是候選設計參數，執行前縮成有明確問題的矩陣，不盲目做全笛卡兒積。記錄 key 數、分布、client 發送方式、timeouts 與 retry policy。

每組先做 warm-up、至少五輪交錯樣本；先跑 A/A 得到本機噪音範圍。建議初始固定模式量測窗 60 秒，auto 另設至少 10 分鐘的負載切換觀察以涵蓋其最長冷卻量級；這些時長是研究設計，不是已取得的結果或通用充分性保證。[S02], [S05]

記錄 logical ops/s、backend ops/s、p50/p95/p99/p99.9、error/timeout/ambiguous rate、CPU、RSS、FD、network bytes、cache hits/flips、redirections、pipe probes/keeps/reverts。大 key、fan-out 與 batching 不可只用不同定義的 QPS 比大小。

**採用閘門：** 執行前由 workload/SLO 定義可接受的 p99、錯誤率、陳舊讀取、額外 memory/CPU 與運維成本；不得測完才挑有利指標。沒有業務 SLO 時只能產出比較報告，不能做 production Go 判定。

## 6. 可觀測性、安全與回滾

INFO／SLOWLOG 是代理提供的觀察面，不等同 exporter 或端到端 tracing；代理 slowlog 的量測範圍包含 backend round trip，不能直接與 Redis server 執行時間混為一談。[S07]

credentials 只放私有 runtime 檔案／secret store；報告保留 hash 與去識別設定，不記錄 password、AUTH payload、真實 key/value 或 production endpoint。權限與 TLS／網路邊界獨立驗證。範例 loopback/nopass 只適用可信、無不信任租戶的 disposable 主機。

將來切換代理必須可退回已驗證的 direct client 路徑。停機先摘除新流量，再發送 SIGTERM 並觀察既有連線；上游 drain deadline 是五秒，不代表所有應用交易必定完成。client 需明確處理重連及未完成請求。[S07]

## 7. 交付順序

M0：來源鎖定、研究、設計與證據邊界（本次）。

M1：固定版本 fixture、build/native tests、核心命令／隔離與精確清理。

M2：故障、cache、資源壓力與 SDK 相容性。

M3：公平 benchmark、成本與採用／不採用 ADR。

任務編號與前置依賴只在 [STATUS](STATUS.md) 維護。順序依證據與依賴，不承諾日曆日期。

[S02]: https://github.com/projecteru2/mithril/blob/9959fe2e5cd466614dc20ef7b710befaaf1d746a/docs/architecture.md
[S04]: https://github.com/projecteru2/mithril/blob/9959fe2e5cd466614dc20ef7b710befaaf1d746a/docs/compatibility.md
[S05]: https://github.com/projecteru2/mithril/blob/9959fe2e5cd466614dc20ef7b710befaaf1d746a/docs/benchmarks.md
[S06]: https://github.com/projecteru2/mithril/blob/9959fe2e5cd466614dc20ef7b710befaaf1d746a/docs/configuration.md
[S07]: https://github.com/projecteru2/mithril/blob/9959fe2e5cd466614dc20ef7b710befaaf1d746a/docs/operations.md

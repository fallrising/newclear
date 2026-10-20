# Prism 任務板

desk 卡：T-0354。本檔是 `platform/prism/docs/tasks/BOARD.md`。

P2-06 已完成。P2-07 實作中。時間是 UTC。已關閉的 P0-01 到 P2-04 只附證據；P0 到 P2-01 當時沒有留下開始時間，不補寫。P2-08 以後只列 backlog，不拆、不做。

P2-04 依 `12-IMPLEMENTATION-PHASES.md`。HTTP 驗收是 `02-COMPATIBILITY-CONTRACT.md` §3.4 的 AC-29 到 AC-41。AC-42 在 `16-LOGQL-GRAMMAR.md` §4.2，與這輪一起做。

## 已關閉

| ID | 任務 | desk | 證據 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| P0-01 | Repo 骨架 | T-0354 | #1，`39246838` | 未知 | 2026-09-09T03:22:40Z | 2026-09-09T03:22:40Z |
| P0-02 | `pkg/utm` | T-0354 | #1，`a654190a` | 未知 | 2026-09-09T03:22:40Z | 2026-09-09T03:22:40Z |
| P0-03 | `pkg/spi` | T-0354 | #1，`7cbe2b2f` | 未知 | 2026-09-09T03:22:40Z | 2026-09-09T03:22:40Z |
| P0-04 | `drivers/memory` | T-0354 | #1，`a4e60603` | 未知 | 2026-09-09T03:22:40Z | 2026-09-09T03:22:40Z |
| P0-05 | conformance | T-0354 | #1，`c6963498` | 未知 | 2026-09-09T03:22:40Z | 2026-09-09T03:22:40Z |
| P0-06 | 依賴方向檢查 | T-0354 | #1，`6dc94165` | 未知 | 2026-09-09T03:22:40Z | 2026-09-09T03:22:40Z |
| P0-07 | `internal/config` | T-0354 | #1，`bfdb4cd1` | 未知 | 2026-09-09T03:22:40Z | 2026-09-09T03:22:40Z |
| P0-08 | `cmd/prismd` 骨架 | T-0354 | #1，`dd45fedc` | 未知 | 2026-09-09T03:22:40Z | 2026-09-09T03:22:40Z |
| P0-09 | ADR-001..010 | T-0354 | #1，`58c49584` | 未知 | 2026-09-09T03:22:40Z | 2026-09-09T03:22:40Z |
| P0-10 | `internal/secret` | T-0354 | #1，`b46d993c` | 未知 | 2026-09-09T03:22:40Z | 2026-09-09T03:22:40Z |
| P0-11 | `internal/telemetry` | T-0354 | #1，`14be84ac` | 未知 | 2026-09-09T03:22:40Z | 2026-09-09T03:22:40Z |
| P1-01 | OTel → UTM | T-0354 | #1，`64934b2f` | 未知 | 2026-09-09T03:22:40Z | 2026-09-09T03:22:40Z |
| P1-02 | ingest limits | T-0354 | #220，`ac955b84` | 未知 | 2026-10-03T16:36:53Z | 2026-10-03T16:36:53Z |
| P1-03 | batcher 與 pipeline | T-0354 | #241，`980656f6` | 未知 | 2026-10-03T19:34:59Z | 2026-10-03T19:34:59Z |
| P1-04 | OTLP receiver | T-0354 | #248，`0deee298` | 未知 | 2026-10-03T20:56:57Z | 2026-10-03T20:56:57Z |
| P1-05 | remote_write | T-0354 | #253，`1f053f81`；後續 #256，`1e398058` | 未知 | 2026-10-04T08:01:10Z | 2026-10-04T08:01:10Z |
| P1-06 | Loki push | T-0354 | #266，`9a0d322c` | 未知 | 2026-10-04T10:06:59Z | 2026-10-04T10:06:59Z |
| P1-07 | PromQL adapter | T-0354 | #275，`9d23ac6a` | 未知 | 2026-10-04T14:35:48Z | 2026-10-04T14:35:48Z |
| P1-08 | Prometheus query API | T-0354 | #290，`80277407` | 未知 | 2026-10-04T16:51:39Z | 2026-10-04T16:51:39Z |
| P1-09 | ClickHouse 寫入 | T-0354 | #301，`aebbdece` | 未知 | 2026-10-05T18:26:03Z | 2026-10-05T18:26:03Z |
| P1-10 | ClickHouse 查詢 | T-0354 | #308，`1b8adbb5` | 未知 | 2026-10-06T14:37:52Z | 2026-10-06T14:37:52Z |
| P1-11 | Phase 1 部署與 E2E | T-0354 | #319，`e2f92627` | 未知 | 2026-10-08T07:33:09Z | 2026-10-08T07:33:09Z |
| P2-01 | LogQL lexer/parser | T-0354 | #325，`7ccc2306` | 未知 | 2026-10-09T11:04:21Z | 2026-10-09T11:04:21Z |

end / last_activity 用該證據 PR 的合併時間。P0-01 到 P1-01 同在 #1。

## P2-02

四張一起做完。預期各 30 分鐘。狀態都是關閉。

| ID | 任務 | desk | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| P2-02a | `ExtractLiteralHint`：§3.4 與 8 個種子 | T-0354 | 關閉 | 2026-10-18T18:22:02Z | 2026-10-18T18:46:53Z | 2026-10-18T18:46:53Z |
| P2-02b | `FuzzLiteralHint` | T-0354 | 關閉 | 2026-10-18T18:22:02Z | 2026-10-18T18:46:53Z | 2026-10-18T18:46:53Z |
| P2-02c | `Compile`：line/field 正則預編譯，正向 line filter 才填 hint | T-0354 | 關閉 | 2026-10-18T18:22:02Z | 2026-10-18T18:46:53Z | 2026-10-18T18:46:53Z |
| P2-02d | 另一個 agent 獨立審查 | T-0354 | 關閉 | 2026-10-18T18:25:24Z | 2026-10-18T18:46:10Z | 2026-10-18T18:46:53Z |

P2-02d 的開始是審查前最後一次記下的時鐘，結束是全模組 `make lint test` 開始前記下的時鐘。審查結論是通過；中間有一項低嚴重度修正：走訪深度或節點上限中斷時改回空 hint，避免沒讀到的 `(?i)` 留下 hint。

## P2-03

四張一起做完。預期各 30 分鐘。狀態都是關閉。

| ID | 任務 | desk | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| P2-03a | AC-1 到 AC-19 的測試；#420 後補 AC-20 到 AC-28 | T-0354 | 關閉 | 2026-10-19T07:14:30Z | 2026-10-19T07:41:24Z | 2026-10-19T09:41:00Z |
| P2-03b | JSON、logfmt、標籤合併、欄位過濾、Limit | T-0354 | 關閉 | 2026-10-19T07:14:30Z | 2026-10-19T07:41:04Z | 2026-10-19T09:40:43Z |
| P2-03c | 範圍聚合、topk/bottomk、序列上限 | T-0354 | 關閉 | 2026-10-19T07:14:30Z | 2026-10-19T07:41:04Z | 2026-10-19T09:40:43Z |
| P2-03d | 十六種下推組合與串流截斷 | T-0354 | 關閉 | 2026-10-19T07:14:30Z | 2026-10-19T07:41:04Z | 2026-10-19T09:40:43Z |

結束時間是第一輪本機 `make lint`、依賴檢查與 `make test` 通過後記下的時鐘。另一個 agent 審查後補了三條 §3.6 規則：JSON 重複鍵留第一個值、抽出欄位依出現順序合併、欄位 `=~`/`!~` 整段比對。P2-03a 的結束時間是 AC-1 到 AC-19 的提交 `2fe6753f`（2026-10-19T07:41:24Z）。AC-20 到 AC-28 是 #420 之後補的，提交 `00893625`（2026-10-19T09:41:00Z），last_activity 對這個提交。

## P2-04 前

兩項一起做完。狀態關閉。P2-04 已另拆。

| ID | 任務 | desk | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| P2-04 前 | `addBucket` 只更新受影響的固定桶；無向量聚合時，一萬輸出序列在 `findBucket` 新建時拒絕 | T-0354 | 關閉 | 2026-10-19T10:18:00Z | 2026-10-19T10:22:27Z | 2026-10-19T10:30:47Z |

開始是 owner 指示這兩項的時鐘。結束是第一輪本機 `make lint` 與 `make test` 通過後的時鐘。審查後改成：輸出序列上限只在 `VectorOp` 為空時於建立時生效，`sum` 等仍在輸出階段檢查；`ts - t0` 溢位回空範圍。last_activity 是這次修正的本機測試通過後的時鐘。

## P2-04

四張一起做完。狀態都是關閉。

| ID | 任務 | desk | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| P2-04a | AC-42：`query.max_agg_input_series` 預設 100000，與輸出上限分開 | T-0354 | 關閉 | 2026-10-19T14:27:00Z | 2026-10-19T15:36:21Z | 2026-10-19T15:55:04Z |
| P2-04b | `query_range` 與 instant `query`：AC-29 到 AC-35 | T-0354 | 關閉 | 2026-10-19T14:27:00Z | 2026-10-19T15:36:21Z | 2026-10-19T15:55:04Z |
| P2-04c | labels、label values、series、index/stats：AC-36 到 AC-39 | T-0354 | 關閉 | 2026-10-19T14:27:00Z | 2026-10-19T15:36:21Z | 2026-10-19T15:55:04Z |
| P2-04d | `GET /ready` 與查詢錯誤信封：AC-40、AC-41 | T-0354 | 關閉 | 2026-10-19T14:27:00Z | 2026-10-19T15:36:21Z | 2026-10-19T15:55:04Z |

開始是 owner 指示繼續 T-0354、實作 AC-42 與 P2-04 的時鐘。結束是第一輪本機 `make lint test` 通過後的時鐘。AC-38 的第二個 `series` body 以 #423 為準：完整 stream 標籤，標籤字典序。審查後補了兩項：`query_range` 與 instant 的統計查詢帶 tenant；每個 `query_range` 都檢查 `direction`。last_activity 是這次修正的本機 `make lint test` 通過後的時鐘。

## P2-05

Owner 已鎖定 AC-43 至 AC-71。已合併。

| ID | 任務 | desk | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| P2-05 | ClickHouse `NativeLogQuerier`：`17` §6.5 的 AC-43 至 AC-71。證據 #428，`dc09beab` | T-0354 | 已合併 | 2026-10-20T00:27:00Z | 2026-10-20T05:02:49Z | 2026-10-20T05:02:49Z |

開始仍是 owner 打開規格的時鐘。實作從 2026-10-20T02:15:00Z 起。允許路徑是 `drivers/clickhouse/**`、`pkg/spi` 的 `Validate`，以及 `pkg/spi/conformance` 的 C-LOG-03/04/05。HTTP 仍不接 `SearchNative`。JSON `Eq` 的 SQL 只做超集粗篩，driver 以與執行器相同的 parseJSON 規則精篩，精篩前不加 `LIMIT`。空字串 `Eq` 是 AC-71：0 列，空字串值不建標籤，與執行器相同。end 與 last_activity 是 #428 合併提交 `dc09beab` 的時鐘。

## P2-06

Owner 已鎖定規格。已完成。

| ID | 任務 | desk | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| P2-06 | 告警規則檔：`07` §10 的 AC-72 至 AC-93。證據 #431，`e22950eb`；#432，`475c36ab` | T-0354 | 已完成 | 2026-10-20T05:27:00Z | 2026-10-20T07:41:31Z | 2026-10-20T07:41:31Z |

開始是 owner 指示寫 P2-06 規格的時鐘。允許路徑是 `internal/alerting/rules/**`，加上 `internal/config/**`（AC-89、AC-90）與 `cmd/prismd/**`（AC-92）。Owner 於 2026-10-20 鎖定 AC-88 至 AC-93。AC-87 用釘選的 promtool 2.53.0，放在 `//go:build integration`，不進預設 `make lint test`。規格是 #431，`e22950eb`。end 與 last_activity 是 #432 合併提交 `475c36ab` 的時鐘。

## P2-07

規格已鎖定。實作中。

| ID | 任務 | desk | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| P2-07 | 告警評估與狀態：`07` §11 的 AC-94 至 AC-109 | T-0354 | 實作中 | 2026-10-20T07:46:00Z | 未完成 | 2026-10-20T10:04:06Z |

開始是 owner 指示寫 P2-07 規格的時鐘。實作從 2026-10-20T08:54:00Z 起。允許路徑見 `12`：`internal/alerting/{eval,state}/**` 與 `internal/compat/promapi/**` 的兩個 GET。Owner 於 2026-10-20 鎖定 AC-94 至 AC-109。`alert_state` 這輪就建，SQL 在 `internal/alerting/state/migrations/`，不等 P5-01。`cmd/prismd` 尚未接上，GET 在 `SetRules` 之前回空列表。last_activity 是本機 `make lint test` 通過的時鐘。

## Backlog

P2-08 以後。不拆、不做。

| ID | 任務 |
| --- | --- |
| P2-08 | 靜默、抑制、分組 |
| P2-09 | Notifier 與六個渠道 |
| P2-10 | 通知投遞、重試、dead letter |
| P2-11 | Alertmanager API v2 子集 |
| P2-12 | 內建規則與 watchdog |
| P3-01 | trace 查詢與組裝 |
| P3-02 | Jaeger API |
| P3-03 | ClickHouse trace index 與 RED |
| P3-04 | APM 服務列表與依賴圖 |
| P3-05 | trace 與 log 關聯 |
| P3-06 | `drivers/vmvl` |
| P3-07 | 查詢路由與 fallback |
| P3-08 | L3 差分測試 |
| P3-09 | Grafana 1860 相容修補 |
| P3-10 | E2E-07 驅動切換 |
| P4-01 | agent WAL |
| P4-02 | host metrics |
| P4-03 | filelog |
| P4-04 | journald 與 docker input |
| P4-05 | 標籤、遮罩、取樣 |
| P4-06 | OTLP export 與 `prism-agent` |
| P4-07 | systemd 安裝 |
| P4-08 | 第三方採集器 |
| P4-09 | Loki `/tail` |
| P5-01 | Postgres schema |
| P5-02 | control plane store |
| P5-03 | 認證 |
| P5-04 | RBAC |
| P5-05 | tenancy |
| P5-06 | control plane REST |
| P5-07 | rules preview |
| P5-08 | agent 註冊與配置下發 |
| P5-09 | 審計日誌 |
| P5-10 | Console UI |
| P5-11 | `prismctl` |
| P5-12 | 磁碟水位熔斷 |
| P5-13 | runbooks |
| P5-14 | 安全測試套件 |
| P5-15 | 威脅模型剩餘對策 |
| P5-16 | security-incident runbook |
| P6 | 加固與擴充（快取、split、原生直方圖、降採樣、Elasticsearch、remote_write v2、分角色部署、Console 儀表板、Profiling / RUM） |

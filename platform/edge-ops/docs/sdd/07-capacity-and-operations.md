# 07 — 容量、成本與平台自身維運

日期：2026-09-27。此章是 sizing model，不是免費或支援台數承諾。官方配額以部署時帳號／套餐為準，來源 [S02–S07](../SOURCES.md)。

## 1. 不沿用上游「60 台免費」結論

Workers Free 官方列 100,000 requests/day，D1 Free 列 5,000,000 rows read/day、100,000 rows written/day、5 GB total storage。D1 的 index 維護、UPDATE、DELETE 與 retention 清理會影響計數，batch 不代表多列只算一次寫入。[S02–S03](../SOURCES.md#s02)

設 N 台主機、上報間隔 T 秒、一天 86,400 秒：

```text
reports/day = N * 86400 / T
control polls/day = enabled_nodes * 86400 / poll_interval
Worker requests >= reports + polls + UI/API + logs/artifacts + admin traffic
D1 rows_written ≈ reports * measured_write_amplification
                  + enrollment/jobs/audit + rollup + retention/index maintenance
```

| 模型 | 10 nodes / 60s | 60 nodes / 60s |
| --- | ---: | ---: |
| 只計 telemetry HTTP requests | 14,400/day | 86,400/day |
| 加同頻率獨立 command polling | 28,800/day | 172,800/day |
| 假設每 report 共 4 rows written 的 telemetry 成本 | 57,600/day | 345,600/day |

4 是**示例放大係數，不是已測值**。即使只上報60台，其他 API 的空間也已有限；加入 logs/job 的系統不能引用另一套 monitoring-only schema 的免費台數。所有值由實作的 `meta.rows_read/rows_written`、平台 requests/storage 指標核對。[S03](../SOURCES.md#s03)

DO 有自己的 request、duration、storage 計費／配額；WebSocket hibernation 可以降低 idle duration，但並非「所有 WebSocket 永遠免費」。每次轉發／喚醒與維護 timer 的成本要驗。[S04–S05](../SOURCES.md#s04) R2 同時考慮 storage 與操作次數，不把 object storage 當零成本無限 log archive。[S07](../SOURCES.md#s07)

Workers Paid 的最低月費與包含額度並非包含所有產品的總帳單上限；付費超量可能另收費，成本 alert 也不是硬性消費封頂。Free 超限時的限制不能當成 Paid 不會收費的保證。[S02–S04](../SOURCES.md#s02)

## 2. 初始資料政策（設計預設）

| 資料 | 保留／限制提案 | 理由 |
| --- | --- | --- |
| 一分鐘 metrics windows | 7 天；bounded per-node payload | 可重演短期故障；避免無界時間序列 |
| 5分鐘 rollup | 30 天，預設關閉；量測後啟用 | rollup/GC 也消耗寫入，不能免費承諾 |
| logs | 每 node 5 MiB/day 原文預算、7 天；oversize 明確丟棄 | 先有可控制的診斷，非完整企業 log 平台 |
| job output | 每 attempt 1 MiB 合計、30 天 | 防輸出洪水；truncated bytes 有計數 |
| audit / job metadata | 90 天；獨立匯出可延長 | 與高流量 logs 分開保存 |
| artifacts | 只清除未被保留 recipe/run 引用且超過寬限期的物件 | hash 固定，不能刪掉仍需對帳的內容 |

log chunk 初始最多 256 KiB 原文或 60 秒 flush，空窗口不上傳；不同來源不應各自每秒產生小物件。壓縮率不作配額安全依賴。報表顯示 billing estimate 與實際平台計量的差异，不把估計值冒充帳單。

## 3. 過載與降級

priority：安全結果／稽核 > heartbeat > metrics history > log details。job durable storage／audit 不可用時拒絕新 mutation；不為省配額關閉安全判斷。telemetry 可以降頻、停止長期 rollup、暫停 logs，並顯示 degraded／missing ranges；已啟動作業按本地 deadline 處理。

本地與 Worker 均有 per-node/workspace rate limit、最大來源數、維度白名單、body size、daily log budget。設定變更只能降低到主機本地安全上限以內，不能逼主機生成不限量內容。驗 schema、大小和 authentication 應盡可能早；拒絕請求本身仍可能有平台計費成本，不宣稱應用限流可消除所有帳單 DoS。

## 4. 平台自身可觀測性

至少量測 ingest accepted/rejected、auth errors、last_seen lag、spool/drop count、DB query rows/latency、R2 bytes/ops、DO reconnect/awake、notification retry、job unknown count、lease reconciliation、GC backlog。

同一個 Worker 無法可靠告警它自己完全不可用；需另行選擇獨立 synthetic watcher／供應商狀態訊息或現有監控通道。此 watcher 不是把控制面搬回常駐 VPS 的理由，但不能用本系統的綠燈證明 Cloudflare 自身可用。

## 5. Backup／restore

D1 schema + 必要資料定期 export，R2 按保留政策維護物件／manifest inventory 與 digest；backup 放在隔離權限域，確認復原演練。平台內建備份能力是補充，不代替跨環境 restore test。初始 recovery 目標 RPO <=24h、RTO <=4h，僅為待驗設計目標。

還原到隔離環境時預設 `dispatch_enabled=false`；revoke／重新註冊節點或變更 generation，pending/running attempts 進 reconciling，不把舊 queue 直接重新送到現役機器。job approval、signer keys 與 node keys 不隨便複製進測試環境；可用合成身份驗還原結構。

schema migration 必須能在 restore fixture 驗證向前升級；重大變更先 export／canary。GC／retention 同樣是可破壞資料的操作，要有 dry-run inventory、scope、寬限期與驗證，不在首次 deployment 自動刪舊來源。

---
project: systems/snail
purpose: 以 Rust 提供多核心純記憶體 RESP2 鍵值服務
kind: service
mainline: incomplete
usable_tag: none
reviewed: 2026-10-21
source_commit: b97319d74f8442b5173ef42be72a0aa757d87df0
---

# Snail / rudis 成功契約

## 主線與範圍

[design](docs/design.md)主線是 Redis 五種核心結構、key/server 語義與多核心 RESP2；C10K 是硬 gate，C1M 是設計上限。
[STATUS](docs/STATUS.md)與 README 列 M0/M1 完成，M2 壓力層及 M3 io_uring/C1M 尚在進行。

純記憶體，重啟即空；沒有 AUTH/ACL/TLS、持久化、cluster、transactions、Pub/Sub 或 eviction。
保留 dormant；2M req/s 是 stress 目標，不能偷換成原 C10K 必過門檻。

本契約核對的是上述來源版本中的文件與程式。
`complete` 只適用明列的主線範圍；沒有延伸為部署或生產保證。

## 驗收條件

下表 `historical` 是既有報告的結果，沒有在 2026-10-21 重跑。
`pending` 保留缺少證據或尚未實作的條件；程式存在不等於通過。

| AC ID | Given / When / Then | 狀態 | 證據或缺少原因 |
| --- | --- | --- | --- |
| AC-01 | Given RESP2 client 與五種資料型別，When 依命令操作、過期與 pipeline，Then 支援的 M1 語義與 FIFO 回覆成立 | historical | [STATUS](docs/STATUS.md)、[README 支援命令](README.md) |
| AC-02 | Given 至少 10000 TCP 連線且 64 active，When GET/SET 8:2 且無 pipeline，Then p99 小於 5ms 且零錯誤 | historical | [README](README.md)：C10K gate 一 worker 約 1.3ms、多 worker 約 1.5–2.4ms |
| AC-03 | Given 100000 連線，When loopback spread hold，Then 可維持連線並保留測量口徑 | historical | [STATUS](docs/STATUS.md)：C100K hold PASS，非全 active 吞吐證明 |
| AC-04 | Given 完整 M2/M3 壓力層與 io_uring 模式，When 執行對應高連線與故障驗收，Then 里程碑全部條件可重現且資源限制明確 | pending | [STATUS](docs/STATUS.md)：M2/M3 未完成；C1M 與完整壓力結果不能由 hold smoke 外推 |

## 現況與缺口

M0/M1 是已完成的可研究切片；專案完整 roadmap 仍有 M2/M3。
跨 shard MSET/DEL 無全域原子性，跨 shard RENAME 回 CROSSSLOT，SCAN 為弱語義。
Memory stats/maxmemory 觸發為近似，跨 shard 已讀 frames 亦無嚴格逐 frame cap。
後續 benchmark 文檔有獨立 placement/fixture 研究，不能替代完整里程碑 gate。

這次僅新增驗收入口，未改變 runtime 或原有驗收 oracle。
歷史結果若與現行 source 有相關差異，必須補驗而不能直接繼承。

## 啟動與驗證

[README](README.md)與[STATUS](docs/STATUS.md)提供 Rust build、環境/CLI 設定、bench 與信任網路限制。

已核對入口：[main.rs](src/main.rs)。
下列是該入口既有的啟動或驗證命令，並非本次執行紀錄；
需先完成連結文件中的依賴、設定及適用環境準備。

```sh
cargo build --release
./target/release/rudis --port 6379
cargo test --locked --release
./scripts/bench-c10k.sh all
```

執行後應保留來源 SHA、必要設定的非秘密摘要、命令與結果，
並將 runtime 證據逐項對回 AC；不得只用 health 或 exit 0 宣告全部完成。

## 可用版本

目前 `usable_tag: none`；本次沒有建立或發布任何 tag。
既有版本號、合併紀錄與歷史驗收不自動轉換為可用版本標記。

須在明確復工範圍完成 M2/M3 或由 owner 正式修訂主線，再對目標 source 重驗語義與連線 gate；不能以 M1 完成標記整個 roadmap。

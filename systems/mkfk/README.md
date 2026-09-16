# mkfk

Kafka-inspired distributed log，透過實作理解分區儲存、複製、冪等生產與消費群組。

**狀態：M0 contracts / testkit 已驗證；M1–M7 尚未實作。** 現有程式固定持久格式、JSON API、靜態 topology、資源上限與可注入測試邊界；目前仍不是可啟動 broker，也不宣稱 durability、replication、production-ready 或 Kafka client 相容。精確狀態見 [implementation status](docs/STATUS.md)。

## 從這裡開始

1. [SDD 主文件](SDD.md)：目標、範圍、架構、不變量與文件優先級。
2. [教學對照、設計決策與來源](docs/sdd/06-decisions-sources.md)：六個教學任務的映射，以及 mkfk 與 Apache Kafka 的刻意差異。
3. [開發里程碑](docs/sdd/05-roadmap.md)：M0–M7，每個階段的輸入、產物、驗收與禁止越界事項。
4. [Agent 工作規則](AGENTS.md)：交接、改規格、測試證據與 monorepo 修改邊界。

## 規格章節

| 文件 | 開發時解決的問題 |
| --- | --- |
| [儲存](docs/sdd/01-storage.md) | append-only WAL、record offset、segment、sparse index、fsync、crash recovery |
| [複製](docs/sdd/02-replication.md) | 每分區 Raft、選主、衝突截斷、ISR、HW、ack 與分裂腦防護 |
| [協定與客戶端](docs/sdd/03-protocol-clients.md) | HTTP/JSON 契約、producer fencing/dedup、consumer group generation 與 offset commit |
| [驗證](docs/sdd/04-validation.md) | requirement → test 對照、故障注入、模型測試、安全界線與量測方法 |

實作語言為 Go；`go.mod` 固定 Go 1.27.1 toolchain。Linux 本機檔案系統為 durability 驗收平台，最低環境與限制記錄於 [ADR-007](docs/adr/007-m0-toolchain-platform.md)。這是設計選擇，不是宣稱教學強制使用 Go。

## M0 可執行內容

- `internal/storage`：WAL frame v1、sparse index v1 codec、CRC32C、長度與 overflow 邊界。
- `internal/config`：strict static topology、exact-byte SHA-256、storage identity 與資源 cap 驗證。
- `internal/protocol`：decimal-string、strict JSON/base64、produce/fetch/group request contracts、batch fingerprint 與 FNV-1a partitioning。
- `internal/adapters` / `internal/testkit`：clock、random、network、filesystem interface，以及 manual clock、scripted random/fault transport。
- `api/schemas` / `testdata/golden`：完整 public endpoint contract、config schema、正反例與固定 binary vectors。

執行 M0 gates：

```bash
make fmt-check
make vet
make test
make test-race
```

目前刻意沒有 `cmd/mkfk`、HTTP handler、WAL filesystem store 或固定成功 stub；這些必須依 milestone 驗收順序加入。

## 範圍提示

- 第一版覆蓋教學的六個核心任務，外加可重現的三 broker 故障驗收。
- 自行實作 log、index、Raft core、producer 去重與 group assignment；不以現成 Kafka broker 或資料庫代理核心能力。
- 自訂 HTTP/JSON API；不使用 Kafka wire protocol。
- 完整 transactions、跨分區 exactly-once、retention/snapshot、動態擴縮及公開網路部署均不在核心版。
- 與同一 monorepo 的 `systems/ojbquay` 分開：本專案學習實作 broker 核心，不依賴該專案。

教學來源：[Build Mini-Kafka](https://builddistributedsystem.com/projects/mini-kafka)。讀取方式與來源限制見 [來源紀錄](docs/sdd/06-decisions-sources.md)。不複製教學全文或未提供的題目程式碼。

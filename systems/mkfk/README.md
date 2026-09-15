# mkfk

Kafka-inspired distributed log，透過實作理解分區儲存、複製、冪等生產與消費群組。

**狀態：SDD baseline / 尚未實作。** 本目錄目前只有開發規格，不是可執行 broker，也不宣稱 production-ready 或 Kafka client 相容。

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

預設實作語言為 Go；Linux 本機檔案系統為 durability 驗收平台。Go patch 版本由 M0 查核支援狀態後固定在 module、工具鏈及 CI。這是設計選擇，不是宣稱教學強制使用 Go。

## 範圍提示

- 第一版覆蓋教學的六個核心任務，外加可重現的三 broker 故障驗收。
- 自行實作 log、index、Raft core、producer 去重與 group assignment；不以現成 Kafka broker 或資料庫代理核心能力。
- 自訂 HTTP/JSON API；不使用 Kafka wire protocol。
- 完整 transactions、跨分區 exactly-once、retention/snapshot、動態擴縮及公開網路部署均不在核心版。
- 與同一 monorepo 的 `systems/ojbquay` 分開：本專案學習實作 broker 核心，不依賴該專案。

教學來源：[Build Mini-Kafka](https://builddistributedsystem.com/projects/mini-kafka)。讀取方式與來源限制見 [來源紀錄](docs/sdd/06-decisions-sources.md)。不複製教學全文或未提供的題目程式碼。

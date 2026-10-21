---
project: systems/mkfk
purpose: 以可重播故障驗證分區日誌、複製與生產消費語義
kind: lab
mainline: complete
usable_tag: usable/mkfk/v0.1.0
qualification: docs/project-success/qualifications/mkfk.md
reviewed: 2026-10-21
source_commit: b97319d74f8442b5173ef42be72a0aa757d87df0
---

# mkfk 成功契約

## 主線與範圍

[SDD](SDD.md)明定核心版完成線為 M0–M7 全部 VERIFIED；[STATUS](docs/STATUS.md)及 evidence 已達此線。
核心是教學用途 Go/Linux distributed log：segmented WAL、per-partition Raft、ISR/HW、冪等 producer 與 durable groups。

不是 Kafka wire/client 相容服務，不提供 TLS/auth、transaction、retention 或動態 membership。
核心 complete 不等於 production-hardened；不能以成熟 Raft/Kafka 外部服務替代本案演算法學習目標。

本契約核對的是上述來源版本中的文件與程式。
`complete` 只適用明列的主線範圍；沒有延伸為部署或生產保證。

## 驗收條件

下表 `historical` 是原有逐項報告；2026-10-21 已補做 [可用版本資格驗證](../../docs/project-success/qualifications/mkfk.md)，區分本次重跑與可沿用的歷史結果。
`pending` 保留缺少證據或尚未實作的條件；程式存在不等於通過。

| AC ID | Given / When / Then | 狀態 | 證據或缺少原因 |
| --- | --- | --- | --- |
| AC-01 | Given durable partition log，When append 後 SIGKILL/restart 或 index 損壞，Then 已確認 record 可讀且索引可重建 | historical | [M1 evidence](docs/evidence/m1-8235294-storage.json)、[M2 evidence](docs/evidence/m2-3dbd61a-segments.json) |
| AC-02 | Given RF3 與舊 leader 隔離，When failover/rejoin，Then committed records 保留且 HW/ISR acknowledgement gate 成立 | historical | [M3 evidence](docs/evidence/m3-af2d7d1-raft.json)、[M4 evidence](docs/evidence/m4-dc75958-isr-hw.json) |
| AC-03 | Given produce 回覆遺失或 group rebalance，When 相同 identity 重試及舊 generation commit，Then 不重複 append 且舊 session 被 fence | historical | [M5 evidence](docs/evidence/m5-002e6cd-producer.json)、[M6 evidence](docs/evidence/m6-8b99818-groups.json) |
| AC-04 | Given 三 broker 與固定 seed，When 執行整合 chaos/model/demo，Then FR/INV 都能追到故障證據且資料承諾成立 | historical | [M7 evidence](docs/evidence/m7-12aa275-integrated.json)、[traceability](docs/traceability.md) |

## 現況與缺口

M0–M7 的完成範圍包括真程序、WAL 故障、三 broker demo 與 seeded model，不只可編譯。
M7 記錄 28 faults/五 seeds、extended 1000×10000 events 與三主機 baseline。
效能結果依既有硬體與 workload，不承諾通用吞吐。
安全與運作 hardening 屬後續；保留無認證與無 retention 的實際使用限制。

本次新增驗收入口並補做可用資格；未改變 runtime 或原有驗收 oracle。
歷史結果若與現行 source 有相關差異，必須補驗而不能直接繼承。

## 啟動與驗證

[README](README.md)的 M7 段與 [Makefile](Makefile)列出 broker、CLI、三 broker Compose demo 與故障 gate。

已核對入口：[demo 程式](cmd/mkfkdemo/main.go)與 [Makefile](Makefile)。
下列提供既有啟動／驗證入口；本次實際執行範圍與結果以資格紀錄為準；
需先完成連結文件中的依賴、設定及適用環境準備。

```sh
make fmt-check vet test test-race
make test-model
make test-integration
make test-chaos
make demo
```

執行後應保留來源 SHA、必要設定的非秘密摘要、命令與結果，
並將 runtime 證據逐項對回 AC；不得只用 health 或 exit 0 宣告全部完成。

## 可用版本

本次資格通過，預定標記 `usable/mkfk/v0.1.0`，範圍與逐命令證據見[資格紀錄](../../docs/project-success/qualifications/mkfk.md)。
必要 PR CI／獨立審查通過並合併後才發布；不外推 production 或原範圍以外能力。

---
project: systems/mkfk
purpose: 以可重播故障驗證分區日誌、複製與生產消費語義
kind: lab
mainline: incomplete
usable_tag: none
qualification: docs/project-success/qualifications/mkfk.md
reviewed: 2026-10-23
source_commit: fdc534bca955fb30cc21d87b2d849b8c4aa05d77
---

# mkfk 成功契約

## 主線與範圍

[SDD](SDD.md)明定核心版完成線為 M0–M7 全部 VERIFIED（[STATUS](docs/STATUS.md)）。
核心是教學用途 Go/Linux distributed log：segmented WAL、per-partition Raft、ISR/HW、冪等 producer 與 durable groups。

不是 Kafka wire/client 相容服務，不提供 TLS/auth、transaction、retention 或動態 membership。
不能以成熟 Raft/Kafka 外部服務替代本案演算法學習目標；完成不等於 production-hardened。

## 驗收條件

2026-10-23 在 `source_commit` 實跑全部通過（[證據](../../docs/project-success/evidence/mkfk-livelock-20261023/README.md)），但合併後的 CI 又出現一次 short chaos 失敗，AC-04 改為 failed。

| AC ID | Given / When / Then | 狀態 | 證據或缺少原因 |
| --- | --- | --- | --- |
| AC-01 | Given durable partition log，When append 後 SIGKILL/restart 或 index 損壞，Then 已確認 record 可讀且索引可重建 | passed | `make test` 與 `make test-race`（M1/M2 storage tests）；歷史 [M1](docs/evidence/m1-8235294-storage.json)、[M2](docs/evidence/m2-3dbd61a-segments.json) |
| AC-02 | Given RF3 與舊 leader 隔離，When failover/rejoin，Then committed records 保留且 HW/ISR acknowledgement gate 成立 | passed | `make test-model`、`make test-integration`（三程序 failover）、`TestM7LaggingFollowerCatchesUpWithSeveralAppendsInFlight` |
| AC-03 | Given produce 回覆遺失或 group rebalance，When 相同 identity 重試及舊 generation commit，Then 不重複 append 且舊 session 被 fence | passed | `make test-integration`（OP-04）、`make test-model`（group model）、`make demo` |
| AC-04 | Given 三 broker 與固定 seed，When 執行整合 chaos/model/demo，Then FR/INV 都能追到故障證據且資料承諾成立 | failed | CI [39954969817](https://github.com/fallrising/newclear/actions/runs/39954969817) seed `1792759189506810350`：broker 1 的 `events/1` healing 後 90 s 未追上；第一個 livelock 修復後仍有第二個原因，診斷中 |

## 現況與缺口

2026-10-21 CI short chaos 失敗的第一個原因已修復：落後 follower 在 heartbeat 與重送同時在途時，新 leader 永不採用其 conflict hint（[SDD 02-replication §4](docs/sdd/02-replication.md)）。
修復後本機 short chaos 30/30，但 2026-10-23 合併後 CI 再現同樣症狀（不同 seed、不同 broker），表示還有第二個原因。broker 未記錄 Raft step 拒絕的原因、測試也分不出副本落後或分歧，已補這兩項診斷，正在 2 CPU 條件下重現。

效能結果依既有硬體與 workload，不承諾通用吞吐。
安全與運作 hardening 屬後續；保留無認證與無 retention 的實際使用限制。

## 啟動與驗證

[README](README.md)的 M7 段與 [Makefile](Makefile)列出 broker、CLI、三 broker Compose demo 與故障 gate。

```sh
make fmt-check vet test test-race
make test-model
make test-integration
make test-chaos CHAOS_PROFILE=short
make test-chaos
make demo
```

`CHAOS_SEED=<seed>` 重播排程；失敗時 seed、違例與時間線在 `.test-output/chaos.log` 與 `chaos-report.json`。

## 可用版本

`usable/mkfk/v0.1.0`（2026-10-23，指向 `8e9b2397`）已發布，但隨即被上述 CI 失敗推翻，**撤回推薦**；tag 依規範保留不刪。修復並重新驗收後發布新版本。

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

2026-10-23 在 `source_commit` 實跑全部通過（[證據](../../docs/project-success/evidence/mkfk-livelock-20261023/README.md)），但合併後的 CI 又出現 short chaos 失敗。之後的修復尚未重新資格，AC-04 為 pending。

| AC ID | Given / When / Then | 狀態 | 證據或缺少原因 |
| --- | --- | --- | --- |
| AC-01 | Given durable partition log，When append 後 SIGKILL/restart 或 index 損壞，Then 已確認 record 可讀且索引可重建 | passed | `make test` 與 `make test-race`（M1/M2 storage tests）；歷史 [M1](docs/evidence/m1-8235294-storage.json)、[M2](docs/evidence/m2-3dbd61a-segments.json) |
| AC-02 | Given RF3 與舊 leader 隔離，When failover/rejoin，Then committed records 保留且 HW/ISR acknowledgement gate 成立 | passed | `make test-model`、`make test-integration`（三程序 failover）、`TestM7LaggingFollowerCatchesUpWithSeveralAppendsInFlight` |
| AC-03 | Given produce 回覆遺失或 group rebalance，When 相同 identity 重試及舊 generation commit，Then 不重複 append 且舊 session 被 fence | passed | `make test-integration`（OP-04）、`make test-model`（group model）、`make demo` |
| AC-04 | Given 三 broker 與固定 seed，When 執行整合 chaos/model/demo，Then FR/INV 都能追到故障證據且資料承諾成立 | pending | 第二個 livelock 與測試 port 衝突已修（[#545](https://github.com/fallrising/newclear/issues/545)、[#546](https://github.com/fallrising/newclear/issues/546)）；本機完整 gate PASS、CI 連續 14 次全綠，尚未完成重新資格 |

## 現況與缺口

CI short chaos 間歇失敗有兩個 Raft liveness 原因，都會讓故障中落後超過一批的 follower 在 healing 後永遠追不上（無資料分歧）：

1. conflict hint 只採用最新 RPC 的 reply（PR #520 修復）；
2. 無法合併的 read barrier 超過 leader 追蹤的 RPC 數，所有 reply 都對應已遺忘的 RPC（修復：read barrier 受 pipelining window 限制）。

規則見 [SDD 02-replication §4](docs/sdd/02-replication.md) 與 [ADR-012](docs/adr/012-replication-flow-control-isr-catchup.md)。另修測試 broker port 取自 ephemeral range 造成的 `bind: address already in use`。
剩餘：更多 CI 次數確認穩定並重新資格（[#545](https://github.com/fallrising/newclear/issues/545)）。

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

## #413 看板與 triage 維護

本次只對齊 #400 已合併 ADR 與 #401 明確暫緩狀態，不改 runtime 或 M0–M7 驗收。
AC-T1：看板保留 PR/owner 決定來源、時間與 issue 開啟界線；AC-T2：其他任務列保持不變。
驗證計畫：對照 GitHub PR/issue，scoped links、42項project contracts、whitespace、獨立審查與 CI；結果見 [本次報告](tasks/413-triage-closeout/report.md)。

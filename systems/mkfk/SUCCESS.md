---
project: systems/mkfk
purpose: 以可重播故障驗證分區日誌、複製與生產消費語義
kind: lab
mainline: incomplete
usable_tag: none
qualification: docs/project-success/qualifications/mkfk.md
reviewed: 2026-10-21
source_commit: b97319d74f8442b5173ef42be72a0aa757d87df0
---

# mkfk 成功契約

## 主線與範圍

[SDD](SDD.md)明定核心版完成線為 M0–M7 全部 VERIFIED；[STATUS](docs/STATUS.md)及既有 evidence 記錄曾達此線，但本次最終 CI 的必要 chaos gate 失敗，現行主線須重新驗收。
核心是教學用途 Go/Linux distributed log：segmented WAL、per-partition Raft、ISR/HW、冪等 producer 與 durable groups。

不是 Kafka wire/client 相容服務，不提供 TLS/auth、transaction、retention 或動態 membership。
歷史核心 complete 不等於 production-hardened；不能以成熟 Raft/Kafka 外部服務替代本案演算法學習目標。

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
| AC-04 | Given 三 broker 與固定 seed，When 執行整合 chaos/model/demo，Then FR/INV 都能追到故障證據且資料承諾成立 | failed | 2026-10-21 [CI short chaos 失敗](https://github.com/fallrising/newclear/actions/runs/39631545715/attempts/1)；seed／違例細節未上傳，待診斷與重播；歷史 [M7 evidence](docs/evidence/m7-12aa275-integrated.json)、[traceability](docs/traceability.md) |

## 現況與缺口

2026-10-21 最終 PR CI 的 `TestM7ChaosOP05RotatingCrashesPartitionsAndPauses` 在 115.59 秒後失敗。原 CI 忽略隱藏 `.test-output`，因此無法取得 seed、違例及時間線。已補 CI 證據保留；失敗原因仍未知，未修改 runtime 或放寬 oracle。

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

`usable_tag: none`。本次本機驗證曾通過，但最終 CI short chaos 失敗，已撤下 `usable/mkfk/v0.1.0` 候選；見[資格紀錄](../../docs/project-success/qualifications/mkfk.md)。
先取得失敗 seed／違例與時間線並釐清原因，完成對應修復或可核對的環境診斷及必要重驗，才可重新提出資格；換 seed 的成功不能消除已知失敗。

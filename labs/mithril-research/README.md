# Mithril research lab

> 主線、驗收條件、剩餘缺口與可用版本：[SUCCESS.md](SUCCESS.md)。


> **Portfolio doc tier: A (active, bounded research)** — 使用入口：[docs/quickstart.md](docs/quickstart.md)。政策：[portfolio-doc-tiers](../../docs/portfolio-doc-tiers.md)。Owner 授權範圍：[PORTFOLIO.md](../../PORTFOLIO.md)。

研究對象是 [projecteru2/mithril](https://github.com/projecteru2/mithril)，不是 Mithril.js。本目錄是原創研究與實驗設計，**不是上游 fork、Redis server 實作或已部署的代理服務**。

**目前：P1a 本機 plan／合成 lifecycle 核心已提供；M1–M3 的 Redis／Mithril runtime 尚未驗證。** 固定研究來源已完成隔離 release build、121 項上游測試、Clippy 與格式檢查，binary hash 記於 [runtime lock](runtime.lock.json)。四機 SSH 唯讀盤點有私有紀錄；本機 fixture 不連 SSH、不啟動 Redis／Mithril，也不批准實機變更。[P1b tools](docs/P1-TOOLS.md) 接續提供 per-host Compose/auth 產生、固定 SSH observe/down/reconcile 與 purge preview。[P1c](docs/P1-BOOTSTRAP.md) 提供六節點離線觀察驗證與綁定 ownership/node IDs 的 bootstrap proposal；完整 startup／cluster 執行、purge apply 與 runtime 驗收仍缺。操作與界線見 [P1a 本機入口](docs/P1-LOCAL.md)／[VALIDATION](docs/VALIDATION.md)。

P1d 新增 [六節點唯讀 collector](docs/P1-COLLECTOR.md)，以固定 helper、RESP framing 與前後身份核對收集回應；本輪只以 mocks 驗證。Complete 不代表健康、新鮮度或 phase admission，P1c 的中間狀態拒絕規則不變。

P1e 的 [離線階段驗證](docs/P1-PHASE.md) 對原始 complete collection 檢查五個明確 barrier；不變更 P1c admission，也不執行或推進階段。

## 從哪裡開始

先讀 **[四台測試機使用計劃](docs/FOUR-NODE-PLAN.md)**：三台承載 Redis 三主三副本，主副本交叉放置；第四台放 Mithril 與低流量 client。第一個成果是「啟動 → 讀寫 → 停止 → 保留資料重啟 → 精確清理」，再做故障、快取與效能。這是設計，不是已驗收拓撲。

上游可用容器、預編譯 binary 或 source build；不必先在四台安裝 Rust。固定 artifact、認證、網路、所有後端 advertised address 與資源 ownership 都要在部署前核對。[U01]

Mithril 集中處理 Redis Cluster 路由、連線與部分協議複雜度，但不提供完整單機 Redis 語意；跨 slot、交易、重試、RESP3 與快取都有明確邊界。目前只支持繼續隔離驗證，不代表已決定採用。[S02]、[S03]、[S04]

## 文件入口

| 文件 | 用途 |
| --- | --- |
| [FOUR-NODE-PLAN](docs/FOUR-NODE-PLAN.md) | 四機角色、安裝、安全、使用、P0–P6 驗收與回復計劃 |
| [EXECUTION_PROMPT](docs/EXECUTION_PROMPT.md) | 下一個 session 的完整路徑、讀取要求與操作授權邊界 |
| [RESEARCH](docs/RESEARCH.md) | PREP、架構、原始碼、相容性、效能判讀與既有專案比較 |
| [SDD](docs/SDD.md) | 需求 MR-R01–09、測例 C01–13、實驗與採用閘門 |
| [quickstart](docs/quickstart.md) | 當前可做／不可做，及固定來源建置參考 |
| [STATUS](docs/STATUS.md) | 唯一固定任務清單與下一步 |
| [SOURCES](docs/SOURCES.md) | 原始研究來源、閱讀範圍與證據分級 |
| [VALIDATION](docs/VALIDATION.md) | 本輪／歷史驗證與未執行項目 |
| [upstream.lock.json](upstream.lock.json) | 研究 commit、toolchain 與來源 blob IDs |
| [mithril.local.conf](examples/mithril.local.conf) | 舊單機可信隔離範例；不是四機部署設定 |
| [P1-BOOTSTRAP](docs/P1-BOOTSTRAP.md) | P1c 私有離線拓撲驗證、bootstrap proposal 與未實作的實機閘門 |
| [P1-COLLECTOR](docs/P1-COLLECTOR.md) | P1d 有界唯讀收集、complete/partial 語意及待驗實機條件 |
| [P1-PHASE](docs/P1-PHASE.md) | P1e 獨立離線五個 barrier predicates 與未滿足的實機閘門 |
| [AGENTS](AGENTS.md) | Agent 接續規則 |

上游固定 commit：`9959fe2e5cd466614dc20ef7b710befaaf1d746a`；Cargo manifest 為 `0.1.7`，不把 manifest 版本等同於已核實 release tag。[S01] P1a 的 `scripts/labctl.py` 只執行明示的 local fixture；P1b 的獨立工具見 P1-TOOLS；完整遠端 lifecycle 與實機 evidence 尚未交付。

## 邊界

不修改或復活 [systems/snail](../../systems/snail/README.md)，不接管 [Eru 實驗](../eru-vps-mvp/README.md) 或 `fallrising/kernel` 的主機／runtime，不修改知識庫。四機是否與既有環境相同，先盤點，不猜測。不提交真實 IP、SSH alias、金鑰、密碼、dump 或 raw evidence。

上游 manifest 標示 `AGPL-3.0-only`；本目錄只交付原創分析與設計，不匯入上游原始碼。後續修改、再散布或產品整合另審授權，不將 newclear 根 MIT 套用到上游。[S01]

[S01]: https://github.com/projecteru2/mithril/blob/9959fe2e5cd466614dc20ef7b710befaaf1d746a/Cargo.toml
[S02]: https://github.com/projecteru2/mithril/blob/9959fe2e5cd466614dc20ef7b710befaaf1d746a/docs/architecture.md
[S03]: https://github.com/projecteru2/mithril/blob/9959fe2e5cd466614dc20ef7b710befaaf1d746a/docs/behavior.md
[S04]: https://github.com/projecteru2/mithril/blob/9959fe2e5cd466614dc20ef7b710befaaf1d746a/docs/compatibility.md
[U01]: https://github.com/projecteru2/mithril/blob/9959fe2e5cd466614dc20ef7b710befaaf1d746a/docs/installation.md

## P1f 本機 intent journal 邊界

[P1-JOURNAL](docs/P1-JOURNAL.md) 與[獨立契約](docs/P1-JOURNAL-CONTRACT.md) 定義本機持久化 intent／uncertainty 基礎。它不執行 action、不推進 phase、不接收新 snapshot 或批准來清除 uncertainty；未知或部分本機狀態拒絕使用。Timeout／lost reply 不等於遠端取消。保護只涵蓋同一保留的 journal root，不能用新 root 或 rollback 取得重送授權。

實機階段前後 authenticated fresh collection、逐效果身分核對、精確獨立批准、durable executor／reconciliation、runtime image provenance、有效 network／ACL、replication health／lag、保留資料 lifecycle 與 proxy smoke 仍須完成。Down 保留資料，purge 必須另有精確條件與批准。完整 P1／MR-004 尚未完成；正式計數以 STATUS 的 4 DONE／1 BLOCKED_ENV／4 TODO 為準。

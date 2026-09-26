# Mithril research lab

> **Portfolio doc tier: A (active, bounded research)** — 使用入口：[docs/quickstart.md](docs/quickstart.md)。政策：[portfolio-doc-tiers](../../docs/portfolio-doc-tiers.md)。Owner 授權範圍：[PORTFOLIO.md](../../PORTFOLIO.md)。

研究對象是 [projecteru2/mithril](https://github.com/projecteru2/mithril)，不是 Mithril.js。本目錄是原創研究與實驗設計，**不是上游 fork、Redis server 實作或已部署的代理服務**。

**目前：M0 研究與四機使用計劃已形成文件；M1–M3 runtime 尚未驗證。** Owner 已確認四台測試機可用，但真實主機映射、盤點與部署批准仍待下一輪；本次只做文件／PR 交付，不安裝或操作四台機器。實際驗證範圍見 [VALIDATION](docs/VALIDATION.md)。

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
| [AGENTS](AGENTS.md) | Agent 接續規則 |

上游固定 commit：`9959fe2e5cd466614dc20ef7b710befaaf1d746a`；Cargo manifest 為 `0.1.7`，不把 manifest 版本等同於已核實 release tag。[S01] 四機 runtime lock、Compose、lifecycle CLI 與實機 evidence 尚未交付；不要執行不存在的 up/smoke/down 腳本。

## 邊界

不修改或復活 [systems/snail](../../systems/snail/README.md)，不接管 [Eru 實驗](../eru-vps-mvp/README.md) 或 `fallrising/kernel` 的主機／runtime，不修改知識庫。四機是否與既有環境相同，先盤點，不猜測。不提交真實 IP、SSH alias、金鑰、密碼、dump 或 raw evidence。

上游 manifest 標示 `AGPL-3.0-only`；本目錄只交付原創分析與設計，不匯入上游原始碼。後續修改、再散布或產品整合另審授權，不將 newclear 根 MIT 套用到上游。[S01]

[S01]: https://github.com/projecteru2/mithril/blob/9959fe2e5cd466614dc20ef7b710befaaf1d746a/Cargo.toml
[S02]: https://github.com/projecteru2/mithril/blob/9959fe2e5cd466614dc20ef7b710befaaf1d746a/docs/architecture.md
[S03]: https://github.com/projecteru2/mithril/blob/9959fe2e5cd466614dc20ef7b710befaaf1d746a/docs/behavior.md
[S04]: https://github.com/projecteru2/mithril/blob/9959fe2e5cd466614dc20ef7b710befaaf1d746a/docs/compatibility.md
[U01]: https://github.com/projecteru2/mithril/blob/9959fe2e5cd466614dc20ef7b710befaaf1d746a/docs/installation.md

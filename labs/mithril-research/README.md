# Mithril research lab

> **Portfolio doc tier: A (active, bounded research)** — 研究入口：[docs/quickstart.md](docs/quickstart.md)。政策：[portfolio-doc-tiers](../../docs/portfolio-doc-tiers.md)。Owner 授權範圍：[PORTFOLIO.md](../../PORTFOLIO.md)。

研究對象是 [projecteru2/mithril](https://github.com/projecteru2/mithril)，不是 Mithril.js 或其他同名專案。本目錄是我們自己的研究與驗證設計，**不是上游 fork、Redis 伺服器實作或已部署的代理服務**。

**狀態：M0 原始碼／文件研究完成；M1 可執行環境與獨立驗證尚未開始。** 本輪沒有編譯 Mithril、執行上游整合測試、建立 Redis Cluster 或取得效能成績。證據與限制見 [VALIDATION](docs/VALIDATION.md)。

## 先看結論

Mithril 值得研究的核心，是如何把 Redis Cluster 的路由、連線與部分相容性複雜度集中到代理層，並在多核心、pipeline、保序和背壓之間取捨。它沒有把叢集變成一個具完整單機語意的 Redis；跨 slot 寫入、交易、RESP3、快取與重試仍有重要邊界。[S02], [S03], [S04]

本輪決策：**繼續做隔離實驗；尚不決定採用或取代現有服務。** 下一個可驗收成果是固定版本的本機叢集 fixture 與功能測試，而不是另一套運維平台。

## 文件入口

| 文件 | 用途 |
| --- | --- |
| [RESEARCH](docs/RESEARCH.md) | PREP 摘要、架構、原始碼發現、相容性、效能判讀、與既有專案的關係 |
| [SDD](docs/SDD.md) | 本研究實驗台的設計、需求、測試矩陣與採用閘門；不是宣稱重寫 Mithril |
| [quickstart](docs/quickstart.md) | 固定版本的接手步驟與明示尚未執行的命令 |
| [STATUS](docs/STATUS.md) | 固定任務編號、完成／待做／阻塞與下一步 |
| [SOURCES](docs/SOURCES.md) | 來源、讀取範圍、事實／上游聲明／推論的區分 |
| [VALIDATION](docs/VALIDATION.md) | 本輪驗證與未執行項目 |
| [upstream.lock.json](upstream.lock.json) | 研究 commit、toolchain 與來源 blob IDs |
| [mithril.local.conf](examples/mithril.local.conf) | 僅供可信隔離本機的範例；不是安全的對外服務設定 |
| [AGENTS](AGENTS.md) | Agent 接續規則 |

上游固定 commit：`9959fe2e5cd466614dc20ef7b710befaaf1d746a`。其 Cargo manifest 版本為 `0.1.7`；這裡不把 manifest 版本等同於已核實的 release tag。[S01]

## 邊界

不修改或復活 [systems/snail](../../systems/snail/README.md)，不變更 [Eru VPS 實驗](../eru-vps-mvp/README.md) 的主機與 runtime，不修改 `fallrising/kernel` 或知識庫。不放入真實 IP、密碼、SSH key、dump 或運維 evidence。Mithril 上游 manifest 標示 `AGPL-3.0-only`；本目錄只交付原創分析與實驗設計，不匯入上游原始碼，後續再散布或產品整合需另審授權。[S01]

[S01]: https://github.com/projecteru2/mithril/blob/9959fe2e5cd466614dc20ef7b710befaaf1d746a/Cargo.toml
[S02]: https://github.com/projecteru2/mithril/blob/9959fe2e5cd466614dc20ef7b710befaaf1d746a/docs/architecture.md
[S03]: https://github.com/projecteru2/mithril/blob/9959fe2e5cd466614dc20ef7b710befaaf1d746a/docs/behavior.md
[S04]: https://github.com/projecteru2/mithril/blob/9959fe2e5cd466614dc20ef7b710befaaf1d746a/docs/compatibility.md

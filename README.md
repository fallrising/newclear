# newclear

`fallrising` 的公開技術作品集。這裡是這些專案的 canonical 位置——先前散落在數十個獨立 repository 的內容,已收斂至此。

根目錄的 [GitHub Actions workflows](.github/workflows/) 是 monorepo 的 canonical CI entry points；component 目錄中保留的 workflow 是原始 repository 歷史，GitHub 不會將其當作 monorepo CI 執行。已接線 component 的範圍與驗證規則見 [Monorepo CI specification](docs/specs/monorepo-ci.md)。

## 目錄

### 產品

| 路徑 | 說明 | 技術 |
| --- | --- | --- |
| [`products/goku`](products/goku/) | 書籤 ingestion 與管理產品:CLI、API、MQTT consumer、Web UI | Go, SQLite, React |
| [`products/phark`](products/phark/) | Social stream deck:帳號、互動、搜尋、media、moderation | Spring, React, SQLite |
| [`products/kith`](products/kith/) | 人機群聊：人類與 LLM agent 同房、MCP、官方 Codex sidecar（SDD baseline，尚未實作） | Cloudflare Workers, D1, React（規劃） |

### Gateway 與系統軟體

| 路徑 | 說明 | 技術 |
| --- | --- | --- |
| [`gateways/pokercase`](gateways/pokercase/) | Multi-provider LLM gateway(thinrouter):routing、subscription import、UI/TUI | Rust, SQLite |
| [`systems/clarkq`](systems/clarkq/) | HTTP FIFO queue:durability、auth、encryption、metrics、SDK | Go |
| [`systems/snail`](systems/snail/) | RESP2 相容 in-memory data server,聚焦 C10K/C100K/io_uring | Rust |
| [`systems/ojbquay`](systems/ojbquay/) | Kafka-based enterprise messaging control/data plane | Java, Kafka, gRPC |
| [`systems/wotar`](systems/wotar/) | MQTT application-layer E2EE client 與 protocol | Python |
| [`systems/mkfk`](systems/mkfk/) | Kafka-inspired distributed log:partition WAL、Raft、ISR、冪等 producer、consumer groups（SDD baseline，尚未實作） | Go（規劃） |

### 平台與應用

| 路徑 | 說明 | 技術 |
| --- | --- | --- |
| [`platform/fanzloud`](platform/fanzloud/) | Cloud coding-agent platform 與 BYOS control layer | Rust |
| [`platform/agent-platform`](platform/agent-platform/) | 以 OpenHands Agent Canvas 為範本的自託管多 agent 工作平台：統一 Web UI、Cocoon 隔離執行（SDD 草案，尚未實作） | React, Python, PostgreSQL, Cocoon（規劃） |
| [`platform/dim-gate`](platform/dim-gate/) | CMDB 核心的企業運維自助平台前端：RD／Ops／Admin 三中心、跨雲資源與互動演示（SDD baseline，尚未實作） | React, TypeScript, shadcn/ui（規劃） |
| [`platform/ice-maker`](platform/ice-maker/) | Local-first 個人工程知識編譯器、文件 ingestion 與可重現發布 | Python |
| [`platform/local-ocr-services`](platform/local-ocr-services/) | 可自行託管的 CPU-first OCR HTTP services | Python, Docker |
| [`apps/loom`](apps/loom/) | AI-native canvas / terminal / document workspace | Tauri, Rust, React |
| [`apps/flowshot`](apps/flowshot/) | Local-first 嚴格唯讀 Markdown annotation desktop app | Python, TS |
| [`apps/cloudform`](apps/cloudform/) | Terraform-schema-driven cloud provisioning 與 WYSIWYG form designer | TypeScript |
| [`apps/cms-scaffold`](apps/cms-scaffold/) | 可重複使用的 CMS kernel：Java API 與 Front／Back／Admin 三個操作面 | Java, React, PostgreSQL |
| [`tools/streaming-converter`](tools/streaming-converter/) | FFmpeg HLS conversion、cleanup、Nginx serving 與 web player | Bash, FFmpeg |

### 規格、範例與實驗

| 路徑 | 說明 |
| --- | --- |
| [`specs/fleet`](specs/fleet/) | Fleet 服務生命週期公開規格(`fleet.yaml`、Compose、outbound agents、Cloudflare) |
| [`examples/bite-pi`](examples/bite-pi/) | Pi agent 公開示範,消費已發佈的 platform contract |
| [`labs/bee-swarm`](labs/bee-swarm/) | AI 角色協作設計與 workflow 模擬的可驗證結論 |

### 外部參考

| 路徑 | 說明 |
| --- | --- |
| [`refs/`](refs/INDEX.md) | 67 個**別人寫的** repository 與 preservation forks 的重點與 tag。原本以 fork 形式存放,現改為索引;需要時依指令重新取得。 |

## 授權

根目錄為 MIT。個別子專案若採用不同授權,以該目錄下的 `LICENSE` 為準
（目前:`systems/ojbquay` 與 `specs/fleet` 為 Apache-2.0）。

## 相關 repository

- **`kernel`**（private）— 私有的技術專案:VPS/fleet 基礎設施、個人工作流、agent 交付協定
- **`knowledge-base`**、**`doc_analysis_study`**（private）— 獨立的知識來源與研究輸出

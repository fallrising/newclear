# newclear

`fallrising` 的公開技術作品集。這裡是這些專案的 canonical 位置——先前散落在數十個獨立 repository 的內容,已收斂至此。

根目錄的 [GitHub Actions workflows](.github/workflows/) 是 monorepo 的 canonical CI entry points；component 目錄中保留的 workflow 是原始 repository 歷史，GitHub 不會將其當作 monorepo CI 執行。已接線 component 的範圍與驗證規則見 [Monorepo CI specification](docs/specs/monorepo-ci.md)。

## 怎麼讀這個倉庫

| 文件 | 用途 |
| --- | --- |
| [PORTFOLIO.md](PORTFOLIO.md) | 投入／休眠／收掉決策與**文檔檔位** |
| [docs/taxonomy.md](docs/taxonomy.md) | 頂層目錄分類規則（含 `specs/` ≠ 純文檔） |
| [docs/portfolio-doc-tiers.md](docs/portfolio-doc-tiers.md) | A/B/C/D 文檔深度政策與模板 |
| [MIGRATION.md](MIGRATION.md) | 收斂遷移紀錄 |

**文檔深度跟檔位走，不跟「有沒有目錄」走。** 只有 A 檔需要 `docs/quickstart.md`；C/D 禁止新開 tutorial。

## 目錄

### 產品

| 路徑 | 說明 | 技術 | 文檔檔 |
| --- | --- | --- | --- |
| [`products/goku`](products/goku/) | 書籤 ingestion 與管理：CLI、API、MQTT consumer、Web UI | Go, SQLite, React | C |
| [`products/phark`](products/phark/) | Social stream deck：帳號、互動、搜尋、media、moderation | Spring, React, SQLite | C |
| [`products/kith`](products/kith/) | 人機群聊：人類與 LLM agent 同房、MCP、Codex sidecar | Cloudflare Workers, D1, React | A |
| [`products/hai-taskboard`](products/hai-taskboard/) | Human–AI delivery control plane（Work Graph / Fake-core） | Go, React | A |

### Gateway 與系統軟體

| 路徑 | 說明 | 技術 | 文檔檔 |
| --- | --- | --- | --- |
| [`gateways/pokercase`](gateways/pokercase/) | Multi-provider LLM gateway（thinrouter） | Rust, SQLite | C |
| [`systems/clarkq`](systems/clarkq/) | HTTP FIFO queue | Go | C |
| [`systems/snail`](systems/snail/) | RESP2 相容 in-memory data server | Rust | C |
| [`systems/ojbquay`](systems/ojbquay/) | Kafka-based messaging control/data plane | Java, Kafka, gRPC | C |
| [`systems/wotar`](systems/wotar/) | MQTT application-layer E2EE client | Python | C |
| [`systems/mkfk`](systems/mkfk/) | Kafka-inspired distributed log（教學／契約實作） | Go | B |

### 平台與應用

| 路徑 | 說明 | 技術 | 文檔檔 |
| --- | --- | --- | --- |
| [`platform/fanzloud`](platform/fanzloud/) | Cloud coding-agent platform 與 BYOS control layer | Rust | C |
| [`platform/agent-platform`](platform/agent-platform/) | 自託管多 agent 工作平台（OpenHands Agent Canvas 範本） | React, Python, PostgreSQL, Cocoon | A |
| [`platform/dim-gate`](platform/dim-gate/) | CMDB 核心企業運維自助平台前端（demo） | React, TypeScript | A |
| [`platform/ice-maker`](platform/ice-maker/) | Local-first 個人工程知識編譯器 | Python | A |
| [`platform/local-ocr-services`](platform/local-ocr-services/) | 可自託管 CPU-first OCR HTTP services | Python, Docker | B |
| [`platform/prism`](platform/prism/) | Storage-pluggable observability compatibility layer | Go | C |
| [`apps/loom`](apps/loom/) | AI-native canvas / terminal / document workspace | Tauri, Rust, React | C |
| [`apps/flowshot`](apps/flowshot/) | Local-first 嚴格唯讀 Markdown annotation desktop app | Python, TS | C |
| [`apps/cloudform`](apps/cloudform/) | Terraform-schema-driven cloud provisioning form designer | TypeScript, Java | D |
| [`apps/cms-scaffold`](apps/cms-scaffold/) | 可重複使用的 CMS kernel（API + Front/Back/Admin） | Java, React, PostgreSQL | C |
| [`tools/streaming-converter`](tools/streaming-converter/) | FFmpeg HLS conversion 與 web player | Bash, FFmpeg | D |

### 契約、範例與實驗

| 路徑 | 說明 | 文檔檔 |
| --- | --- | --- |
| [`specs/fleet`](specs/fleet/) | **可執行**的 Fleet Catalog（`fleet.yaml`、Compose、agents、Cloudflare）。路徑在 `specs/`，但內容是系統元件／公開契約，**不是**根目錄文檔。見 [taxonomy](docs/taxonomy.md)。 | B |
| [`examples/bite-pi`](examples/bite-pi/) | Pi agent 公開示範 | D |
| [`labs/bee-swarm`](labs/bee-swarm/) | AI 角色協作 workflow 模擬（歷史） | D |
| [`labs/aweshore`](labs/aweshore/) | 個人筆記／PKM 早期嘗試（已停止） | D |
| [`labs/eru-vps-mvp`](labs/eru-vps-mvp/) | Project Eru 四機 VPS MVP 實驗 | A |

### 外部參考

| 路徑 | 說明 |
| --- | --- |
| [`refs/`](refs/INDEX.md) | 別人寫的 repository 與 preservation forks 的索引（非自有產品） |

## 授權

根目錄為 MIT。個別子專案若採用不同授權,以該目錄下的 `LICENSE` 為準
（目前:`systems/ojbquay` 與 `specs/fleet` 為 Apache-2.0）。

## 相關 repository

- **`kernel`**（private）— 私有的技術專案:VPS/fleet 基礎設施、個人工作流、agent 交付協定
- **`knowledge-base`**、**`doc_analysis_study`**（private）— 獨立的知識來源與研究輸出

# newclear

`fallrising` 的公開技術作品集。這裡是這些專案的 canonical 位置——先前散落在數十個獨立 repository 的內容,已收斂至此。

給 LLM agent 的入口是 [`llms.txt`](llms.txt)：一次 fetch 取得全部專案索引，各專案自己的 `llms.txt` 再宣告 status、介面型態、entrypoint、auth 與機器可讀契約的位置。格式與必填欄位見 [agent-facing capability files](docs/specs/llms-txt.md)。目前已有 capability file 的是 `systems/clarkq`、`products/kith`、`systems/snail`、`products/goku`、`labs/iris-lab`；iris-lab 為 spec-only，其餘專案仍只有 README。

根目錄的 [GitHub Actions workflows](.github/workflows/) 是 monorepo 的 canonical CI entry points；component 目錄中保留的 workflow 是原始 repository 歷史，GitHub 不會將其當作 monorepo CI 執行。已接線 component 的範圍與驗證規則見 [Monorepo CI specification](docs/specs/monorepo-ci.md)。

## 怎麼讀這個倉庫

| 文件 | 用途 |
| --- | --- |
| [PORTFOLIO.md](PORTFOLIO.md) | 投入／休眠／收掉決策的**公開摘要**（權威在私人項目帳本）與**文檔檔位** |
| [docs/taxonomy.md](docs/taxonomy.md) | 頂層目錄分類規則（含 `specs/` ≠ 純文檔） |
| [docs/portfolio-doc-tiers.md](docs/portfolio-doc-tiers.md) | A/B/C/D 文檔深度政策與模板 |
| [MIGRATION.md](MIGRATION.md) | 收斂遷移紀錄 |

**文檔深度跟檔位走，不跟「有沒有目錄」走。** 只有 A 檔需要 `docs/quickstart.md`；C/D 禁止新開 tutorial。

**兩層。** 大需求的流程依據是 desk（https://github.com/fallrising/desk 的 docs/operating-method.md）§0，這裡不重述。本 repo 技術任務照 [AGENTS.md](AGENTS.md) 的技術任務合約管理。不要求 `Desk-Task`。見 [AGENTS.md](AGENTS.md)。

可選格式在 [docs/work-tracking](docs/work-tracking/README.md)，不是認領依據，也不等於可以 merge。舊任務紀錄在 [archive](archive/README.md)，不要照它做。

本 repo 是公開的：issue、PR、檔案與證據不得放私有內容、主機名稱、路徑或帳號。desk 的 repo 名稱與 `docs/operating-method.md` 這條路徑可以寫。

## 目錄

### 產品

| 路徑 | 說明 | 技術 | 文檔檔 |
| --- | --- | --- | --- |
| [`products/goku`](products/goku/) | 書籤 ingestion 與管理：CLI、API、MQTT consumer、Web UI | Go, SQLite, React | C |
| [`products/phark`](products/phark/) | Social stream deck：帳號、互動、搜尋、media、moderation | Spring, React, SQLite | C |
| [`products/kith`](products/kith/) | 人機群聊：人類與 LLM agent 同房、MCP、Codex sidecar | Cloudflare Workers, D1, React | A |
| [`products/hai-taskboard`](products/hai-taskboard/) | Human–AI delivery control plane（Work Graph / Fake-core） | Go, React | A |
| [`products/history-atlas`](products/history-atlas/) | 繁中歷史時空圖譜：上游分析與獨立實作 SDD；網站未實作 | 原生 JavaScript, SVG（規劃） | 未分級 |

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
| [`platform/agent-workforce`](platform/agent-workforce/) | 跨產品數位工作者：M1 離線核心與有界 M2 原生 adapter；完整 M2／跨產品整合仍有缺口 | Python、SQLite；可替換 adapters | A |
| [`platform/dim-gate`](platform/dim-gate/) | CMDB 核心企業運維自助平台前端（demo） | React, TypeScript | A |
| [`platform/cloud-lab`](platform/cloud-lab/) | 個人 CF 工具框架：知識樹、唯讀節點檢查、持久任務與看板（雲端閉環／恢復撤權與本機瀏覽器子集通過，新版已部署，具授權管理及來源關聯整合、機器／resident短期實際觀測與停止驗證，常態runner政策與恢復已本機驗證，具離線啟用方案與用量估算，七日runner-only服務已啟用並回讀，低頻排程與看板已本機驗證，批准部署因資產API500阻擋且原服務保留，固定bot JSON及本機MCP入口、同ID恢復已本機驗證，獨立Grok已接線，bot短期續權與一筆真實檢查通過並恢復查詢模式，真人瀏覽器流程待驗） | Workers Web APIs、D1、Python、原生網頁 | 未分級 |
| [`platform/edge-ops`](platform/edge-ops/) | Cloudflare 主機監控、受控作業與可選初始化（SDD + M0 契約層，無部署） | TypeScript, Go；Workers, D1, DO, R2, React（規劃） | A |
| [`platform/signal-hub`](platform/signal-hub/) | 個人事件中樞／戰情室：CloudEvents 事件庫、規則生成指標看板、訂閱投遞（M3 runtime） | Go, SQLite, React | A |
| [`platform/ice-maker`](platform/ice-maker/) | Local-first 個人工程知識編譯器 | Python | A |
| [`platform/local-ocr-services`](platform/local-ocr-services/) | 可自託管 CPU-first OCR HTTP services | Python, Docker | B |
| [`platform/prism`](platform/prism/) | Storage-pluggable observability compatibility layer | Go | C |
| [`apps/loom`](apps/loom/) | AI-native canvas / terminal / document workspace | Tauri, Rust, React | C |
| [`apps/flowshot`](apps/flowshot/) | Local-first 嚴格唯讀 Markdown annotation desktop app | Python, TS | C |
| [`apps/cloudform`](apps/cloudform/) | Terraform-schema-driven cloud provisioning form designer | TypeScript, Java | D |
| [`apps/cms-scaffold`](apps/cms-scaffold/) | 可重複使用的 CMS kernel（API + Front/Back/Admin） | Java, React, PostgreSQL | C |
| [`tools/codex-usage`](tools/codex-usage/) | Agent Usage 統一唯讀總覽：重用 Codex／Claude 來源，分清訂閱額度、本機統計與 API 支出 | Python, Codex App Server | A |
| [`tools/motion-prompt`](tools/motion-prompt/) | 繁中／英文動態術語圖鑑：固定 120 項來源與驗收規格，網站待整合 | 原生 JavaScript, Canvas | 未分級 |
| [`tools/streaming-converter`](tools/streaming-converter/) | FFmpeg HLS conversion 與 web player | Bash, FFmpeg | D |

### 契約、範例與實驗

| 路徑 | 說明 | 文檔檔 |
| --- | --- | --- |
| [`specs/fleet`](specs/fleet/) | **可執行**的 Fleet Catalog（`fleet.yaml`、Compose、agents、Cloudflare）。路徑在 `specs/`，但內容是系統元件／公開契約，**不是**根目錄文檔。見 [taxonomy](docs/taxonomy.md)。 | B |
| [`examples/bite-pi`](examples/bite-pi/) | Pi agent 公開示範 | D |
| [`labs/memvid-lab`](labs/memvid-lab/) | 固定 Memvid 的 11 類場景＋PDF／語意／CLIP／Whisper（15 項實跑通過並已合併；繁中筆記評估進行中） | 未分級 |
| [`labs/graphify-lab`](labs/graphify-lab/) | Graphify 開發場景、固定參考程式碼與索引單份共用實驗 | 未分級 |
| [`labs/bee-swarm`](labs/bee-swarm/) | AI 角色協作 workflow 模擬（歷史） | D |
| [`labs/aweshore`](labs/aweshore/) | 個人筆記／PKM 早期嘗試（已停止） | D |
| [`labs/eru-vps-mvp`](labs/eru-vps-mvp/) | Project Eru 四機 VPS MVP 實驗 | A |
| [`labs/open-compute`](labs/open-compute/) | 固定版本的私有 Workers runtime 實驗：SDD、Worker／D1／Workflow 正常重啟驗收 | A |
| [`labs/openmmo-lab`](labs/openmmo-lab/) | 固定版本 MMORPG 試跑工具與驗收 runbook（runtime 待驗） | A |
| [`labs/mithril-research`](labs/mithril-research/) | Mithril Redis Cluster proxy：固定版本研究與驗證設計（runtime 待驗） | A |
| [`labs/zircon-godot`](labs/zircon-godot/) | 傳奇 3 Godot/C# fork 的固定版本研究、SDD 與分階段學習實驗（runtime 未驗證） | A |
| [`labs/pg-jev-router`](labs/pg-jev-router/) | pg-jev 輸入判斷、攔截與模型分流實驗；真 extension + 合成 provider | A |
| [`labs/browser-fingerprint`](labs/browser-fingerprint/) | Go mock CRUD 與瀏覽器設備／操作觀測，支援私人 Quick Tunnel | 未分級 |
| [`labs/iris-lab`](labs/iris-lab/) | 固定 Iris／模型版本的原生生圖實驗 SDD、教學與平台研究；runtime 未實作 | 未分級 |
| [`labs/m4-seat`](labs/m4-seat/) | M4 Max 48GB MacBook Pro 的單人推論座位方案；無 runtime | 未分級 |
| [`labs/retro-economy`](labs/retro-economy/) | 原創復古 RPG 的小鎮經濟、職業分工與交易玩法 SDD；未實作 | 未分級 |
| [`labs/handwired-learning`](labs/handwired-learning/) | 普通 JS 與固定數值圖對照的入門實驗 SDD；未實作 | 未分級 |

### 已封存工具

[cc-quota](tools/cc-quota/) 已封存；既有資料由 Agent Usage 唯讀接入，歷史來源與相容入口保留。

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

## 項目完成度與可用版本

[PROJECTS.md](PROJECTS.md) 列出各項目用途、Category、主線狀態、可用版本及盤點更新日。驗收方法見[共用規範](docs/project-success.md)。

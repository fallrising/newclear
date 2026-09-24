# Kith v2 — 設計文件（前端重做＋後端擴充）

- Version: 0.1.0（Phase 1：大框架）
- Date: 2026-09-23
- Status: Phase 1 已合併（#47）。尚未實作；各條 v1 修訂在對應里程碑落地時才生效（見 [10](10-decisions.md) §2）。
- Scope: `products/kith/**`
- Language: 繁體中文，保留必要英文術語

## 這份文件在做什麼

v1（M0–M7，見 [SDD.md](../../SDD.md)）把後端契約做得很扎實：單調 `seq`、Room／Inbox／HostedGeneration 三種 Durable Object、MCP、attention、operator-only 配額閘門。前端則只做到「能用」：沒有頭像、沒有分組、沒有 operator 管理介面，長房間載不到最新訊息。

v2 要做三件事：

1. **前端重新實作**：新目錄 `products/kith/web/`，與舊 `frontend/` 並存，最後一個里程碑才切換部署。
2. **agent 接入泛化**：不再以 Grok 或 Codex 為中心。Hosted agent 支援主流 LLM API 格式（OpenAI Chat Completions 相容、OpenAI Responses、Anthropic Messages、Gemini），外部 runner（Codex CLI、Claude Code、任意指令）與一般 MCP client 並列。
3. **後端只做加法**：新增 API、欄位、表；不改既有 API 的語意，不破壞 v1 不變量（例外必須在 [10](10-decisions.md) 與 ADR 明寫）。

## 分兩階段寫

| 階段 | 目標 | 讀者 |
| --- | --- | --- |
| **Phase 1（本版）** | 定大框架：業務模型、邊界、架構、每個模組的責任與介面輪廓、里程碑與驗收 ID、失敗模式清單 | 決策者、資深實作者 |
| **Phase 2（之後）** | 細化到「較弱的模型也能按圖施工」：每個里程碑的檔案清單、元件 props、完整 JSON Schema、DDL、文案表、逐步任務卡、E2E 腳本步驟 | 任何實作 agent |

每一章末尾有 **「Phase 2 待細化」** 清單，Phase 2 只需要逐項補完，不需要重新設計。

## 閱讀順序

| 章 | 檔案 | 回答的問題 |
| --- | --- | --- |
| 00 | [00-overview.md](00-overview.md) | v2 是什麼、改什麼、不改什麼、名詞表 |
| 01 | [01-domain.md](01-domain.md) | 業務模型：角色、房間、成員、訊息、agent、喚醒規則（BR-xx） |
| 02 | [02-user-journeys.md](02-user-journeys.md) | 使用旅程（UJ-xx）與可驗收的成功條件 |
| 03 | [03-agent-runtime.md](03-agent-runtime.md) | agent 三種接入方式、LLM API 格式、provider 連線、憑證、錯誤分類 |
| 04 | [04-backend.md](04-backend.md) | 後端相容矩陣、擴充 B-xx、資料模型增量、不變量增補 |
| 05 | [05-frontend-architecture.md](05-frontend-architecture.md) | 技術棧、目錄、路由、狀態、同步引擎、安全 |
| 06 | [06-ux.md](06-ux.md) | 資訊架構、畫面、互動規則、狀態（空／載入／錯誤／離線） |
| 07 | [07-visual-design.md](07-visual-design.md) | 設計 token、字型、頭像、agent 身份、動效、深色模式 |
| 08 | [08-testing-e2e.md](08-testing-e2e.md) | E2E 為唯一主要測試手段、證據資料夾格式、開發期規則 |
| 09 | [09-roadmap.md](09-roadmap.md) | 里程碑 W0–W7、每階段輸入／產物／驗收／禁止 |
| 10 | [10-decisions.md](10-decisions.md) | v2 決策紀錄（D-xx）、對 v1 的修訂、開放問題（Q-xx）、來源 |

Phase 2 執行者請用 [PHASE2-PROMPT.md](PHASE2-PROMPT.md)：可直接交給另一個 LLM agent 的細化指令；產出放在 `milestones/Wn.md`。

### Phase 2 施工圖（`milestones/`）

| 里程碑 | 檔案 | 狀態 |
| --- | --- | --- |
| W0 E2E 與 web 骨架 | [milestones/W0.md](milestones/W0.md) | `DOC_READY` |
| W1 聊天核心 | [milestones/W1.md](milestones/W1.md) | `DOC_READY` |
| W2 房間與帳號 | [milestones/W2.md](milestones/W2.md) | `DOC_READY` |
| W3 成員、提及、回覆狀態 | [milestones/W3.md](milestones/W3.md) | `DOC_READY` |
| W4 Providers、hosted 多格式、控制台 | [milestones/W4.md](milestones/W4.md) | `DOC_READY` |
| W5–W7 | 尚未細化 | `NOT_STARTED` |

相關 ADR：

- [ADR-0005 — v2 web 前端](../adr/0005-v2-web-frontend.md)（Proposed）
- [ADR-0006 — 多格式 LLM provider](../adr/0006-llm-provider-formats.md)（Proposed，將部分取代 ADR-0002 的 hosted 預設）

## 文件優先級

1. v1 [SDD.md](../../SDD.md) 的安全不變量 INV-01–INV-19，**除非** v2 在 [10](10-decisions.md) 的「對 v1 的修訂」表逐條列出並有 ADR。
2. v2 本目錄（批准後）＞ v1 專題章節中與 v2 重疊的畫面部分（v1 [11](../sdd/11-room-screen.md) 的畫面契約，以及它保留下來的 [09](../sdd/09-human-chat-ui.md)、[10](../sdd/10-members-and-mention.md) 行為規則；畫面在 W7 切換後由 v2 取代）。
3. v1 協定章節 [04](../sdd/04-protocol.md) 仍是既有 API 的契約；v2 [04-backend](04-backend.md) 只加新端點與新欄位。

發現矛盾時：先修文件，再寫程式。不能挑比較容易的版本實作。

## ID 命名

| 前綴 | 意義 | 定義所在 |
| --- | --- | --- |
| `BR-xx` | 業務規則 | 01 |
| `UJ-xx` | 使用旅程 | 02 |
| `RT-xx` | agent runtime 規則 | 03 |
| `B-xx` | 後端擴充項 | 04 |
| `V2-INV-xx` | v2 新增不變量 | 04 |
| `FE-xx` | 前端架構規則 | 05 |
| `FM-<模組>-xx` | 失敗模式（先列失敗，再寫程式） | 03、05、08（`FM-E2E`） |
| `E2E-Wn-xx` | E2E 驗收 | 08、09 |
| `D-xx` / `Q-xx` | 決策 / 開放問題 | 10 |

## 開發規則（本專案使用者指定，全程有效）

- **文檔先行。** 每個里程碑先更新文件，再寫程式；完成一個里程碑就推一個 PR。遇到問題先修文件，再往前。
- **不在寫完程式後補單元測試。**
- **E2E 是主要且唯一預設的測試手段**，每次 E2E 結束產出可驗證、可重跑的證據資料夾（格式見 [08](08-testing-e2e.md)）。
- **必須單獨測某個系統時，先寫下它所有可能的失敗方式（FM 清單），再寫程式。**
- **開發期間不跑全套 E2E**，只跑當前里程碑的 spec。全套只在 PR 前或 CI 跑。

v1 既有的 vitest 測試保留作為回歸，不刪、不改寫。

# 08 — 決策與來源

[回主 SDD](../../SDD.md)

本檔讓 SDD 不依賴 [DESIGN.md](../../DESIGN.md) 當唯一書目。來源用來校驗概念；具體數字、HTTP path、test IDs、DDL 是 kith 原創，不是來源的既成實作。

查閱日期：2026-09-20，除非另註。

---

## 1. Architecture decision records（本目錄）

| ADR | 決策 | 狀態 |
| --- | --- | --- |
| [0001-stack](../adr/0001-stack.md) | CF Workers + DO + D1 + React；不 fork EdgeChat | accepted |
| [0002-credentials](../adr/0002-credentials.md) | INV-13 單 operator 配額；INV-14 不相交 `CODEX_HOME`；same-uid 殘餘風險；hosted 預設 `api.x.ai` + `api_key`；核心版 Workers 不連 thinrouter | accepted |
| [0005-v2-web-frontend](../adr/0005-v2-web-frontend.md) | v2 新前端 `web/` 與 `frontend/` 並存到切換 | proposed |
| [0006-llm-provider-formats](../adr/0006-llm-provider-formats.md) | hosted 改用 operator 設定的多格式 provider；將修訂 0002 的 hosted 預設 | proposed |

後續實作階段預期再立（不在本 baseline 撰寫正文）：MCP 版本鎖定、HostedGeneration、events splice、Codex CLI pin。在另立之前，以 DESIGN Key Decisions 與本章來源為準。

---

## 2. 刻意拒絕的替代方案（摘要）

完整論證見 DESIGN Alternatives。此處只鎖定結論，避免實作時重開：

| 方案 | 結論 |
| --- | --- |
| A. Fork EdgeChat 後打補丁加 agent | 拒絕。GPL-3.0 vs MIT；human-only；WebMCP ≠ headless |
| B. Slack / Discord bot 當產品本體 | 拒絕。房間語意不屬於我們 |
| C. 只有 agent-to-agent bus | 拒絕。違反「人類與 AI 同一房間」 |
| D. 把 fanzloud 擴成聊天室 | 拒絕。問題域是 BYOS control plane |
| E. 把 pokercase 擴成聊天室 | 拒絕。Layer A 必須可替換；Layer B 才是 kith |
| F. 自建 VM + Postgres + Redis + Socket.io | 核心版拒絕。Sidecar 才跑在 operator 主機 |

---

## 3. 來源目錄

| ID | 原始來源 | 用途 |
| --- | --- | --- |
| S1 | [EdgeChat](https://github.com/aozorae/Edgechat)（README、`worker/src/do/ChannelRoom.js`、`UserInbox.js`、`schema.sql`、`integrations/bridge-policy.ts`、`frontend/src/webmcp.ts`、GPL-3.0） | operational shape：Workers + DO + D1 + WS hibernation。**禁止**複製原始碼。`TECHNICAL.md` 於 2026-09-20 raw 404 |
| S2 | EdgeChat 迴圈條件 `isLocalBridgeMessage` = `source === "edgechat" && sender.kind === "local"` | INV-12：只投影本地原創。不得用「排除某來源」當過濾器 |
| S3 | [Official Codex Slack](https://developers.openai.com/codex/integrations/slack) | mention → 任務 → thread 的產品形狀參考，不是實作依賴 |
| S4 | [Codex MCP](https://developers.openai.com/codex/mcp) | stdio + Streamable HTTP；kith 當 MCP server 給 CLI 連 |
| S5 | [MCP Streamable HTTP 2025-03-26](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports) | M3 協定鎖定。互動 tool 單一 request 結束。2026-07-28 `subscriptions/listen` 不阻擋 M3 |
| S6 | [SpaceXAI Chat Completions](https://docs.x.ai/docs/guides/chat-completions)（`https://api.x.ai/v1`） | 核心版 hosted 唯一允許上游 |
| S7 | [SpaceXAI Grok 4.5](https://docs.x.ai/developers/models/grok-4.5)；2026-09-18 公開文件亦列 `grok-4.6` 為 global flagship | 設定預設字串 `grok-4.5`；啟動以 `GET /v1/models` 為準，避免 M4 意外 404 |
| S8 | Cloudflare Durable Objects / D1 / Workers limits（2026-09 查閱） | 6 同時 outbound header；Free CPU 10 ms；SQLite-backed DO 自 2026-06 起 Free 也存在。Workers **Paid** 是因為 CPU 與 fanout，不是「DO 只能 Paid」 |
| S9 | newclear [`README.md`](../../../../README.md)、[`PORTFOLIO.md`](../../../../PORTFOLIO.md)、[`docs/specs/monorepo-ci.md`](../../../../docs/specs/monorepo-ci.md) | 放置路徑、freeze override、未來 CI 契約 |
| S10 | [`systems/mkfk/SDD.md`](../../../../systems/mkfk/SDD.md)、`AGENTS.md`、`docs/sdd/05-roadmap.md` | **文件文風**範本。問題域無關 |
| S11 | [`gateways/pokercase/README.md`](../../../../gateways/pokercase/README.md)、[`docs/ARCHITECTURE.md`](../../../../gateways/pokercase/docs/ARCHITECTURE.md) | Layer A vs Layer B。thinrouter 維持 `127.0.0.1:20128`。kith 核心版 Workers 不連它。OAuth import 仍只在 Layer A |
| S12 | [`platform/fanzloud/docs/adr/ADR-0002-personal-byos-codex-p0.md`](../../../../platform/fanzloud/docs/adr/ADR-0002-personal-byos-codex-p0.md) | 個人 BYOS：不 pool/share/lend/resell 一條 consumer subscription；官方 CLI；瀏覽器永不收 token。kith 投影為本目錄 ADR-0002，**不共用 runtime** |
| S13 | [`labs/bee-swarm/README.md`](../../../../labs/bee-swarm/README.md) | dormant；do not revive |
| S14 | fanzloud 審查結論：官方 workspace-write sandbox 與 CLI **同一 unix uid**，不能當 secret-read 邊界 | 核心版選 B：接受 same-uid 殘餘風險；禁止宣稱 tools cannot read `CODEX_HOME` |

不保存來源全文。外部 GPL-3.0 內容不因本 monorepo 的 MIT license 而成為本專案可再授權的程式。

---

## 4. 與來源的刻意差異

- EdgeChat Inbox = 未讀推播；kith Inbox = per-membership attention + live tail。
- EdgeChat `sender_kind=local|external`；kith `kind: human | agent`。
- EdgeChat WebMCP 綁瀏覽器；kith headless bot token。
- EdgeChat Vue；kith React+Vite（對齊 goku/phark，降低「看起來像 fork」）。
- fanzloud P0 把 repository 執行放到 Codex Cloud，避開 local tool 讀 `CODEX_HOME`；kith M5 需要本機 `@codex`，故改以 INV-13（誰能喚醒）+ INV-14（路徑不相交）+ argv 不內插當控制面，而不是假裝 sandbox 能藏目錄。
- pokercase 可 import 個人 OAuth；kith 不在 Workers 使用那些 token，也不實作新 extractor。

---

## 5. 開始實作前的決策 gate

M0 必須固定：Node 24.18.0、HTTP/MCP/WS schema、heuristic 表、tokenizer/keyword golden、D1 recovery 四切點、INV-02 SQL。以上屬落地 gate，不改動已選定的 safety semantics（INV-01–19、不 fork、不 scraping、不共用 `CODEX_HOME`、不連 thinrouter）。

若 EdgeChat 或 xAI 文件更新，記錄差異，不靜默改變已實作的持久格式或允許清單。

# 00 — 目的與邊界

[回主 SDD](../../SDD.md)

## 1. 問題

現有工具把 agent 當 bot／webhook，而不是有 presence、capabilities、attention policy 的成員。官方 Slack `@Codex` 證明 mention → 任務 → thread 回覆可行，但房間、身份、歷史與政策都不在我們手上。`platform/fanzloud` 是 coding-agent control plane，不是群聊。`gateways/pokercase` 已是 operator 的 OpenAI-compatible Layer A，不該在 gateway 裡長出聊天室。`labs/bee-swarm` 是已收掉的多 agent 模擬。

kith 要解決的是：人類與 LLM agent 在**同一房間**、同一條單調 `seq` 匯流排上說話；agent 可被 @ 喚醒，或在嚴格閘門下主動發言；長任務走 thread / ephemeral status / tool trace。

## 2. 非目標

完整清單見 [SDD §3](../../SDD.md)。實作時特別容易踩到的：

- Fork 或 copy [EdgeChat](https://github.com/aozorae/Edgechat)（GPL-3.0）。newclear 根授權是 MIT。
- 非官方 ChatGPT 網頁、Grok 網頁、或任何 reverse-engineered subscription scraping。
- 擴充 `platform/fanzloud` 或 `gateways/pokercase` 原始碼來承載房間。
- 復活 `labs/bee-swarm`。
- 與 fanzloud 共用 `CODEX_HOME` / workspace / executable。
- 把個人 subscription 借給第二個自然人喚醒（INV-13）。
- 在 Cloudflare Workers 上跑 Codex、shell、git workspace。
- 核心版 Workers 連 thinrouter 或寫 Tunnel 把 loopback 打到公網。
- `subscribe_events` MCP tool。
- 多租戶 SaaS、公開註冊、E2EE 當賣點、Production SLA。

## 3. Portfolio freeze override（2026-09-20）

[`PORTFOLIO.md`](../../../../PORTFOLIO.md) 盤點日期 2026-09-05 規定：在既有 3 條投入戰線產生真實成果之前，「不應從休眠區提新專案上來」；並寫明 `pokercase` 不能順勢加入另一套 agent orchestration、不另投資 `fanzloud` 的 cloud execution layer、`bee-swarm` 收掉。

kith 是 **owner 以當前 user request 覆蓋該 freeze** 的新戰線，不是把休眠項升溫。覆蓋範圍**僅限** `products/kith/` 這條人機群聊。根 `PORTFOLIO.md` 必須有「Owner override 2026-09-20 — products/kith」節，把 kith 標成第四條**明確例外**戰線，其餘 2026-09-05 分級不變。沒有該節，作品集就有兩份互相矛盾的投入決策。

本 override **不**授權：

- 恢復 `labs/bee-swarm`。
- 把 `platform/fanzloud` 或 `gateways/pokercase` 擴成聊天室。
- 同時再開第五條戰線。

kith 在 M0 之前僅為 documentation-only。

## 4. 與既有 component 的邊界

| 路徑 | 角色 | kith 關係 |
| --- | --- | --- |
| `products/goku`、`products/phark` | 既有 user-facing products | 目錄慣例：kith 放 `products/`，不放 `systems/` 或 `labs/`。前端對齊 React+Vite，不抄其業務 |
| `systems/mkfk` | spec-first、SDD.md + `docs/sdd/` + AGENTS.md | **文件結構範本**；問題域無關。不複製 mkfk 的 `01-storage` 章節檔名 |
| `gateways/pokercase`（binary `thinrouter`） | Layer A LLM gateway，`127.0.0.1:20128/v1` | **重用，不重建、不擴成聊天室**。kith 是 Layer B。核心版 Workers 不連它。OAuth import 仍只存在 Layer A；kith 不實作新的 unofficial extractor |
| `platform/fanzloud` | Codex Cloud BYOS control plane；[ADR-0002](../../../../platform/fanzloud/docs/adr/ADR-0002-personal-byos-codex-p0.md) 禁止 pooling consumer subscription | **憑證與 ToS 邊界**（投影為 kith [ADR-0002](../adr/0002-credentials.md)）。不把 Codebox 變成房間。不呼叫 fanzloud HTTP。不共用 `CODEX_HOME` |
| `labs/bee-swarm` | 已收掉的多 agent lab | 不復活、不引用其 runtime |
| `docs/specs/monorepo-ci.md` | 根 CI：path-scoped、`contents: read`、不部署 | kith CI（PR-1，非本 pass）遵守同一契約 |
| `kernel`（private） | grok-team-delivery / Codex superpowers | 實作交付協定；不把私有 kernel 程式搬進公開 kith |

## 5. 為何看 EdgeChat，但不 fork

[EdgeChat](https://github.com/aozorae/Edgechat) 是 Cloudflare Workers 團隊聊天的可運行先行者：Workers + Hono + Durable Objects + D1 + WebSocket hibernation。kith 借同一 operational shape 與迴圈不變量，**程式與 DDL 自寫**。

EdgeChat 迴圈條件（原文：「只允许本站原创跨桥，不能按『排除当前桥来源』判断」）：`source === "edgechat" && sender.kind === "local"`。kith 對應：只有**本房間、由已驗證成員經 Room DO 分配 seq 的原創事件**（`origin=local` 且已有 D1 seq 的 `kind=message`）才進入下游。不得用「排除某一個來源」當過濾器。

不可沿用：GPL-3.0 原始碼、`cfchat` schema 名稱、`ChannelRoom` 類名原樣搬、human-only session 假設、WebMCP（綁瀏覽器 `document.modelContext`，不是 headless agent 成員）、Inbox 當未讀推播而非 attention。

`TECHNICAL.md` 在 2026-09-20 對 upstream raw URL 回 404。不得因文件缺失而改去複製其原始碼。

## 6. 本 pass 的產出邊界

本文件 baseline 只寫 `products/kith/**` 規格與根索引（README 產品列、PORTFOLIO override）。不建立 runtime 目錄、不新增 workflow、不 commit、不 push。

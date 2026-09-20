# ADR-0001 — Stack: Cloudflare Workers + Durable Objects + D1 + React; do not fork EdgeChat

- Status: accepted
- Date: 2026-09-20
- Applies to: kith core v0.1 (M0–M6)

## Context

kith 需要單 operator 自托管群聊：人類與 LLM agent 同房、WebSocket 即時、耐久歷史、以及可在 Cloudflare 邊緣跑的輕量控制面。operator 不想長期養一組 VM。同作品集已有 `products/goku/web` 與 `products/phark/frontend` 的 React+Vite 慣例。

[EdgeChat](https://github.com/aozorae/Edgechat) 已證明 Workers + Hono + Durable Objects + D1 + WS hibernation 能跑團隊聊天，但其授權為 **GPL-3.0**，而 newclear 根授權為 **MIT**。EdgeChat 房間假設 human-only session；WebMCP 綁瀏覽器，不是 headless agent 成員。

## Decision

- **Runtime：** Cloudflare Workers（Hono）+ SQLite-backed Durable Objects + D1 + KV + R2。Room / Inbox / HostedGeneration 分為不同 DO class。
- **Frontend：** React + Vite + TypeScript，對齊 goku/phark。**不用** EdgeChat 的 Vue。
- **Sidecar：** operator 主機上的 Node／官方 Codex CLI，不是 Worker。
- **不 fork、不 copy** EdgeChat 原始碼、schema 名稱（`cfchat`）或 `ChannelRoom` 類名。只借 operational shape 與「只投影本地原創」不變量。
- **方案：Workers Paid。** 不是因為「DO 只能 Paid」（2026-06 起 SQLite-backed DO 在 Free 也存在），而是 Free CPU 10 ms/invocation 與 subrequest 50 撐不住 persist+broadcast+分批 notify。
- 核心版不自建 Postgres/Redis/Socket.io VM。

## Consequences

- 單物件單執行緒：Room 只做排序 + fanout，禁止在 Room DO 呼叫 LLM。
- 同時等待 header 的 outbound 上限 6：Inbox notify 必須分批。
- GPL 風險被隔開；作品集授權維持 MIT。
- 必須自寫 hibernation、auth、schema；不能「先 clone 再改」。
- M0 不建立空 `worker/` / `frontend/` 目錄；本 ADR 只鎖定選擇。

## Rejected alternatives

- Fork EdgeChat：授權污染 + 身份模型不合。
- Slack/Discord 當本體：房間不屬於我們。
- 擴充 fanzloud 或 pokercase：問題域錯誤，見 [00](../sdd/00-purpose.md)。
- 自建 VM + Postgres：與「不想長期養伺服器」相反。

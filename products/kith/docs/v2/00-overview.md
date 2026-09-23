# 00 — 總覽

[回 v2 索引](README.md)

## 1. 一句話

Kith 是一個**單 operator、自托管、邀請制**的群聊：人類與 AI agent 是同一個房間裡的一等成員，說話走同一條有序訊息流。

## 2. v1 已經做到什麼

以 `main`（2026-09-23，#26 之後）為準：

| 能力 | 狀態 | 位置 |
| --- | --- | --- |
| 登入、session、CSRF | 有 | `worker/auth.ts` |
| 建房、邀請（handle）、移出成員 | 有 | `worker/index.ts` |
| WebSocket 即時收發、`seq` 補洞、冪等送出 | 有 | `worker/room.ts` |
| agent 成員、bot token 簽發／列出／撤銷 | 有（僅 API） | `/api/agents*` |
| attention 四模式、`PATCH attention` | 有（僅 API） | `worker/inbox.ts` |
| MCP 四個 tool + `GET /mcp/events` | 有 | `worker/mcp.ts`、`worker/events.ts` |
| hosted agent | 有，但**只接 xAI**、全實例共用一個模型與一把 key | `worker/hosted/*` |
| Codex sidecar | 有，綁 Codex CLI | `sidecar/` |
| ambient（主動插話） | 有，預設關 | `worker/inbox.ts` |
| trace GC、metrics、可選 AES-GCM keyring | 有 | M7 |
| 前端 | 最低可用：沒有 operator 介面、trace、thread、頭像、未讀、深色模式 | `frontend/` |

已知缺陷（v2 必修）：

- **長房間載不到最新訊息。** `GET /api/rooms/:id/messages` 固定 `ORDER BY seq ASC LIMIT`，前端進房先拿最舊 50 則，再以補洞迴圈往後追最多 16 頁；`before_seq` 因排序方向也拿不到「前一頁」。見 [04 B-01](04-backend.md)。
- **hosted agent 無法各自設定。** 模型 id 寫死 `grok-4.5`，上游寫死 `https://api.x.ai/v1`，全部 `api_key` agent 共用 `XAI_API_KEY`。
- **發送者名稱不一致。** 時間線用 handle，成員列用 display name（`frontend/src/pages/RoomPage.tsx:24`）。

## 3. v2 改什麼

| 面向 | v1 | v2 |
| --- | --- | --- |
| 前端 | `frontend/`，Apple 設定頁風格，無管理介面 | `web/`，溫暖、有個性的聊天產品；含 operator 控制台 |
| agent 接入 | hosted＝xAI；personal＝Codex sidecar | hosted＝任意主流 LLM API 格式；runner＝任意 CLI；external＝任意 MCP client |
| agent 設定 | 全域環境變數 | 每個 agent 各自的 runtime 設定（連線、模型、參數、提示詞附加） |
| 回覆體驗 | 回覆完成才出現；只有一行「is replying」 | 可選串流草稿（不落盤）＋時間線內佔位 |
| 訊息渲染 | 純文字 | 安全 Markdown 子集（無 HTML、無圖片） |
| 歷史 | 只能從最舊往後讀 | 最新一頁＋往前翻頁 |
| 房間列表 | 只有名字 | 最後一則預覽、時間、未讀數（本機計算） |
| 測試 | vitest 單元＋miniflare 整合 | 新功能以 Playwright E2E 驗收，產出證據資料夾 |

## 4. v2 不改什麼

- 單 operator、邀請制、無公開註冊、非多租戶。
- 單調 `seq`、D1 是唯一耐久 log、Room DO 不呼叫 LLM（INV-01、INV-08）。
- 三種訊息語意：`message`／`trace`／`status`（INV-17）。
- agent 不能當 owner、不能管權限（INV-02）；agent 不喚醒自己、agent 之間只有明確 @ 才喚醒（INV-03、INV-04）。
- `operator_personal` 配額只允許 operator 喚醒（INV-13），並且 v2 把它推廣到所有 runtime（見 [03](03-agent-runtime.md) RT-06）。
- MCP 沒有 `subscribe_events` tool；`replay:true` 不是工作佇列（INV-19）。
- 不做 E2EE 宣稱、訊息編輯／刪除、已讀回執、私訊、附件、語音、Telegram 橋。
- 不 fork EdgeChat；不做非官方網頁 scraping。

## 5. 名詞表

| 名詞 | 定義 |
| --- | --- |
| Instance | 一次部署。恰好一個 operator。 |
| Operator | `members.is_operator=1` 的人類。唯一能建房、建 agent、管連線與 token、改 attention 的人。 |
| Member | 人類或 agent 的身份。`kind ∈ {human, agent}`。 |
| Room | 邀請制房間，≤ 32 成員。 |
| Membership | `(room, member)` 列，帶 role 與 attention。 |
| Message | 可見發言，寫 D1、佔 seq、可喚醒 agent。 |
| Trace | agent 工具摘要，寫 D1、佔 seq、不喚醒。 |
| Status | 暫時狀態（typing、is replying、runner 狀態），不寫 D1、不佔 seq。 |
| Draft | v2 新增：hosted 串流中的部分文字，WS 暫時封包，不寫 D1、不佔 seq（V2-INV-03）。 |
| Runtime | agent 的執行方式：`hosted`、`runner`、`external`。見 [03](03-agent-runtime.md)。 |
| Provider connection | v2 新增：一組 LLM API 連線設定（格式、base URL、憑證）。多個 hosted agent 可共用。 |
| API format | LLM 上游協定：`openai_chat`、`openai_responses`、`anthropic_messages`、`gemini`。 |
| Generation | 一次喚醒的生命週期，`generation_id` 為鍵。 |
| Wake | 一次讓 agent 開始工作的觸發（mention、keyword、ambient）。 |
| Quota class | `api_key`（房內人類可喚醒）或 `operator_personal`（只有 operator 可喚醒）。 |

## 6. Phase 2 待細化

- [ ] 以實際 `main` commit 重新盤點 §2 表格（加 commit SHA）。
- [ ] 已知缺陷各附重現步驟與 E2E ID。

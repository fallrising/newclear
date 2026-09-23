# ADR-0002 — Credential and quota boundary

- Status: accepted
- Date: 2026-09-20
- Applies to: kith core v0.1; projects fanzloud ADR-0002（personal BYOS）
- Note: 「Hosted default」一節將由 [ADR-0006](0006-llm-provider-formats.md)（proposed）修訂；INV-13、INV-14 不變並推廣到所有 runner。

## Context

kith 要讓 operator 在房間裡 `@codex`（個人 ChatGPT/Codex 訂閱）以及 `@grok`（付費 API key）。`platform/fanzloud` 的 [ADR-0002](../../../../platform/fanzloud/docs/adr/ADR-0002-personal-byos-codex-p0.md) 已禁止 pooling／轉售／出借一條 consumer subscription，並要求官方 CLI、瀏覽器永不接收 access token。

官方 Codex workspace-write sandbox 與 CLI **同一 unix uid**。CLI 必須讀 `CODEX_HOME` 才能登入；它 spawn 的 tool 子行程繼承該 uid。`0700` 與「不要 mount」**不能**對同一 uid 隱藏目錄。fanzloud P0 因此把 repository 執行放到 Codex Cloud。kith M5 需要本機執行，不能重蹈「宣稱 tools 讀不到 `CODEX_HOME`」而被拒的設計。

`gateways/pokercase`（thinrouter）可 import 個人 OAuth，但是 Layer A、本機 loopback。把 Workers 打到 `127.0.0.1:20128` 或經 Tunnel 暴露，等於把個人訂閱洗成多人 `@grok`。

## Decision

### INV-13 — operator-only personal quota

- 部署是私人、單一 operator：`members.is_operator=1` 恰好一列。
- `quota_class=operator_personal` 的 agent **只可**被 `operator_member_id` 喚醒。其餘 mention **持久化**但不 dispatch，碼 `subscription_operator_only`。
- Hosted 路徑：Inbox **dispatch 前**檢查。
- Sidecar 路徑：SSE 不做 quota 過濾；sidecar 在啟動 CLI 前**本地**檢查（SEC-013）。
- 這是 API 閘門與測試，不是 README 禁令。

### INV-14 — disjoint CODEX_HOME

- kith sidecar 的 `codex_home`、`workspace`、`codex_executable` 必須與 fanzloud 的 `CODEBOX_CODEX_HOME` / `CODEBOX_WORKING_DIR` / `CODEBOX_CODEX_EXECUTABLE` **不相交、不嵌套、不是同一 inode**。
- kith **不呼叫** fanzloud HTTP API。
- `CODEX_HOME` mode `0700`、不在 git、不在 Worker secret。
- 官方 Codex CLI **必須**能讀它才能登入。

### Same-uid residual risk（核心版選 B）

- **不選 A：** 以第二 uid / bubblewrap / landlock 讓 tool 的 `open(codex_home)` 失敗。等官方 CLI 提供受支援的 tool-uid 分離再立 ADR。
- **選 B：** 接受 **same-uid 殘餘風險**。真實控制面是 INV-13 + INV-14 + argv 不內插房間文字 + workspace 不含 token 檔。
- **禁止**在文件或測試名裡寫「tools cannot read CODEX_HOME」。Canary 是 best-effort：outbound 事件不得**主動**附上 canary；不把 `open()` 失敗當 pass。

### Hosted default

- 核心版 hosted 只直連 `https://api.x.ai/v1`，Worker Secret 名稱預設 `XAI_API_KEY`，`quota_class=api_key`。
- 啟動 `GET /v1/models` 驗證設定 id（預設字串 `grok-4.5`）。
- **核心版不從 Workers 連 thinrouter。** 不寫 Cloudflare Tunnel / 把 `127.0.0.1:20128` 打到公網的說明。
- 非法路徑（ChatGPT 網頁 cookie replay、`cli-chat-proxy.grok.com` 直連、unofficial scraping）不准出現。
- 若未來要經 thinrouter，另立 ADR，且指向個人訂閱 upstream 時強制 `operator_personal`。

### 瀏覽器與其他人類

永不接收 access token、`auth.json`、API key、bot token 明文（建立 agent token 的 operator UI 除外，且只顯示一次）。

## Consequences

- 第二個自然人可以打字 `@codex`，但不會消耗 operator 訂閱。
- 本機 Codex 仍可能被**已喚醒的**官方 CLI 子行程讀到 `CODEX_HOME`；產品不假裝已解決。
- CI 無 xAI / Codex secrets；fake LLM / fake CLI 為正確性證明。
- pokercase 維持 Layer A；kith 是 Layer B client。

## Rejected alternatives

- 與 fanzloud 共用 `CODEX_HOME`：違反路徑隔離，且會讓兩個產品搶同一份登入狀態。
- 宣稱 sandbox 能藏 `CODEX_HOME`：與 fanzloud ADR-0002 已拒絕的設計相同。
- 從 Workers 打 thinrouter：把 Layer A 個人憑證暴露給邊緣多人 mention。
- 非官方網頁 scraping：ToS 與 fragile extractor；明確禁止。
- 多租戶 pooling：超出個人 BYOS。

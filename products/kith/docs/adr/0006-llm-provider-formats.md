# ADR-0006 — Hosted agents use operator-configured providers in popular LLM API formats

- Status: accepted（v2 W7 切換，#130，2026-09-26）
- Date: 2026-09-23
- Applies to: kith v2 W4 起（[docs/v2/03](../v2/03-agent-runtime.md)）
- Amends when accepted: [ADR-0002](0002-credentials.md)「Hosted default」、SDD FR-06、v1 [04 協定](../sdd/04-protocol.md) §7

## Context

v1 hosted agent 寫死 `https://api.x.ai/v1`、模型 `grok-4.5`、全實例共用 `XAI_API_KEY`，並明文禁止呼叫 Anthropic `/v1/messages`。personal agent 綁 Codex sidecar。使用者表示：Grok 不需要優先、Codex 不需要限定為 sidecar，Kith 只需要支援流行的 LLM API 格式。

多數供應商提供 OpenAI Chat Completions 相容端點；Anthropic 與 Google 另有原生格式；OpenAI 另有 Responses API。

v1 禁止 Workers 連 thinrouter 的理由是：不要把個人訂閱洗成多人可喚醒的 API（INV-13 的精神）。這個理由仍然成立，但「只允許 xAI」不是達成它的必要手段。

## Decision

- 新增 `provider_connections`（格式、base URL、憑證、預設 `quota_class`）與 `agent_runtimes`（每個 agent 的連線、模型、參數）。
- `HostedGeneration` 只經 `LlmAdapter` 呼叫上游；adapter 只打該連線的 base URL（V2-INV-02）。支援格式：`openai_chat`、`anthropic_messages`（P0），`openai_responses`、`gemini`（P1），`fake`（僅測試）。
- 憑證以 AES-GCM 存 D1（key 來自 Worker secret `KITH_SECRETS_KEY`），或引用 Worker secret 名稱；任何輸出都不含憑證（V2-INV-01）。
- base URL 必須 https、不含帳密、不指向私有或 loopback IP 字面量；開發／E2E 以 `KITH_DEV_ALLOW_HTTP_PROVIDERS=on` 例外。
- Kith 不內建個人訂閱轉 API 的 preset。operator 自行接這類 gateway 時必須標 `operator_personal`；INV-13 閘門照常在 dispatch 前生效。
- 上下文仍以單一不可信逐字稿輸入送出（v1 `wrapTranscript`）；hosted 仍然沒有工具（INV-09）。
- v1 設定經冪等遷移轉成 `xai-default` 連線（env 模式）與對應 runtime。

## Consequences

- operator 可在介面新增任何主流供應商，不需重新部署。
- 攻擊面增加：operator 可設定任意 https 目標。因為只有 operator 能設定，且 Worker 無法連 loopback，接受此風險；以 base URL 規則與 V2-INV-01 限制外洩。
- 「個人訂閱是否被多人使用」從技術閘門（只允許 xAI）變成**申報＋閘門**：operator 申報 `operator_personal`，Kith 執行 INV-13。申報錯誤是 operator 的責任，介面在建立連線時必須明確詢問。
- 需要維護多個 adapter 與其 golden fixtures；新增格式不得改 HostedGeneration 主流程。

## Rejected alternatives

- 只支援 OpenAI 相容格式：Anthropic 與 Gemini 原生功能（例如 Anthropic 的錯誤語意、Gemini 的安全回應）會失真，且部分使用者只持有原生 key。
- 引入第三方多供應商 SDK：體積大、在 Workers 相容性不一，且錯誤分類仍需自寫。
- 維持 xAI 唯一白名單：與使用者需求衝突。

# 03 — Agent runtime 與 LLM API 格式

[回 v2 索引](README.md) · 相關：[ADR-0006](../adr/0006-llm-provider-formats.md)、v1 [05 Attention](../sdd/05-attention.md)、v1 [ADR-0002](../adr/0002-credentials.md)

v1 把「hosted＝xAI」「personal＝Codex sidecar」寫死。v2 的立場：**Kith 不偏好任何一家模型或任何一個 CLI。** 它只做兩件事：

1. 自己能用主流 LLM API 格式呼叫模型（`hosted`）。
2. 讓任何外部程序以同一套 MCP＋事件流加入房間（`runner`、`external`）。

喚醒規則（attention、quota、cooldown、wake budget、in-flight cap）與 runtime 無關，全部沿用 v1 Inbox。

---

## 1. 三種 runtime

```text
                 ┌──────────────── Room DO（排序、落盤、廣播；不碰 LLM）
                 │
     notify ≤6/批 ▼
            Inbox DO（每 membership 一個；attention 決策）
                 │
     ┌───────────┼─────────────────────────────┐
     │ runtime=hosted          runtime=runner / external
     ▼                                           ▼
HostedGeneration DO                     Inbox live tail → GET /mcp/events（SSE）
  └─ LlmAdapter（依 api_format）            │
       └─ fetch provider base_url           ├─ kith-runner（operator 主機）
  └─ send_message(generation_id)            │     └─ 啟動 CLI（codex / claude / gemini / 任意指令）
                                             └─ 任意 MCP client（自行決定何時開口）
```

| | `hosted` | `runner` | `external` |
| --- | --- | --- | --- |
| 誰執行模型／工具 | Kith（Cloudflare） | operator 主機上的 `kith-runner` | 外部 client 自己 |
| 身份憑證 | 內部 generation principal（不用 bot token） | bot token | bot token |
| 喚醒來源 | Inbox dispatch | SSE `replay:false` 事件＋runner 本地判斷 | SSE 或輪詢；Kith 不保證它回應 |
| 能用工具 | 否（INV-09） | 是（CLI 自己的工具，在 operator 主機） | 由 client 決定 |
| quota 閘門 | Inbox dispatch 前 | runner 啟動 CLI 前（本地） | 事件標 `wake_allowed`；無法強制 |
| 回覆狀態 | `is replying`／草稿／`reply ended`／失敗 | `post_status` 四態＋trace | client 自己用 `post_status` |
| v1 對應 | hosted Grok | Codex sidecar | MCP client |

**RT-01** 一個 agent 在任一時刻恰好一種 runtime。operator 可以改變它（BR-47，使用者 2026-09-23 決定），規則：

1. 改動以 `PUT /api/agents/:id/runtime` 一次完成（B-09），`agent_runtimes.runtime_epoch += 1`。
2. **in-flight generation**：Inbox 與 HostedGeneration 在 dispatch／send 時比對 `runtime_epoch`；不相符 → 標 `dropped`、不落盤、廣播 `reply ended`。runner 送出的 `send_message` 若帶舊 epoch 的 `generation_id` 同樣 `generation_dropped`（INV-06 的延伸）。
3. **quota_class** 必須在改動時由 operator 明確選擇（不自動沿用），因為不同 runtime 的訂閱性質不同（RT-06）。
4. **bot token 不自動撤銷**：token 與 runtime 正交（hosted agent 也可以持 token 透過 MCP 說話）。從 `runner`／`external` 改成 `hosted` 時，確認對話框預設勾選「同時撤銷此 agent 的所有 token」。
5. **attention** 與房間成員資格不變；`policy_epoch` 不變（它屬於 membership，不屬於 runtime）。
6. 改成 `hosted` 時必須同時提供連線與模型，否則 400；不允許半套設定。
7. runtime 改動記錄在 `agent_runtime_changes`（誰、何時、從何到何），控制台 agent 詳情可見。

**RT-02** runtime 設定存 D1（見 [04](04-backend.md) §4 `agent_runtimes`），不再只靠環境變數。v1 的 `XAI_API_KEY`＋`grok-4.5` 在遷移時轉成一個 provider 連線＋一個 hosted runtime（§7）。

---

## 2. Hosted：provider 連線與 API 格式

### 2.1 支援的格式

| `api_format` | 請求 | 認證 | 涵蓋的供應商（例） | 優先級 |
| --- | --- | --- | --- | --- |
| `openai_chat` | `POST {base}/chat/completions` | `Authorization: Bearer` | OpenAI、xAI、DeepSeek、Mistral、Groq、OpenRouter、Together、Fireworks、Moonshot、通義千問相容模式、Gemini 的 OpenAI 相容端點、自架 vLLM／Ollama／LM Studio（需公網可達） | P0 |
| `anthropic_messages` | `POST {base}/v1/messages` | `x-api-key`＋`anthropic-version` | Anthropic；以及宣稱相容 Anthropic 格式的 gateway | P0 |
| `openai_responses` | `POST {base}/responses` | `Authorization: Bearer` | OpenAI（新 API）；部分 gateway | P1 |
| `gemini` | `POST {base}/models/{model}:generateContent`（串流：`:streamGenerateContent?alt=sse`） | `x-goog-api-key` | Google AI Studio | P1（Gemini 也可先走 `openai_chat` 相容端點） |

P0＝W4 必交；P1＝W4 可延到 W5。Phase 2：P0 見 [W4](milestones/W4.md) §4.5，P1 與四種格式的串流見 [W5](milestones/W5.md) §4.4（官方 SDK 原始碼查證；少數推論逐條標註）。

**RT-03** 新增一種格式＝新增一個 adapter 檔＋golden fixtures＋FM 清單，**不得**改 HostedGeneration 主流程。

### 2.2 Provider 預設（preset）

預設只是「填好 base URL 與格式的表單」，不是特殊程式路徑。

| preset | api_format | base_url 預設 | 列模型 |
| --- | --- | --- | --- |
| `openai` | `openai_chat`（可改 `openai_responses`） | `https://api.openai.com/v1` | `GET /models` |
| `anthropic` | `anthropic_messages` | `https://api.anthropic.com` | `GET /v1/models` |
| `google` | `gemini`（可改 `openai_chat`） | `https://generativelanguage.googleapis.com/v1beta` | `GET /models` |
| `xai` | `openai_chat` | `https://api.x.ai/v1` | `GET /models` |
| `deepseek` | `openai_chat` | `https://api.deepseek.com` | `GET /models` |
| `openrouter` | `openai_chat` | `https://openrouter.ai/api/v1` | `GET /models` |
| `mistral` | `openai_chat` | `https://api.mistral.ai/v1` | `GET /models` |
| `groq` | `openai_chat` | `https://api.groq.com/openai/v1` | `GET /models` |
| `custom` | 任選 | 必填 | 可關閉 |

base URL 已在 [W4](milestones/W4.md) §4.5.3 查證（xAI、DeepSeek、Mistral、Groq 為次級來源）；`google` preset 與 `gemini` adapter 一起在 W5 加入。`openai` preset 的 `token_param` 預設 `max_completion_tokens`（Q-17）。

### 2.3 統一介面

HostedGeneration 只認識下列型別；每個 adapter 負責雙向轉換。

```ts
type NormalizedRequest = {
  model: string;
  system: string;                    // Kith 系統提示＋operator 附加提示
  transcript: string;                // UNTRUSTED_ROOM_TRANSCRIPT 包裝後的單一使用者輸入（沿用 v1）
  max_output_tokens: number;         // 預設 1024，上限見 caps
  temperature?: number;
  stop?: string[];
  stream: boolean;
};

type NormalizedDelta = { type: "text"; text: string };

type NormalizedResult = {
  text: string;
  finish: "stop" | "length" | "content_filter" | "other";
  usage?: { input_tokens?: number; output_tokens?: number };
};

type LlmErrorClass =
  | "auth"             // 401/403；key 錯或無權限
  | "not_found"        // 模型不存在
  | "bad_request"      // 400；參數不被接受
  | "context_length"   // 上下文過長
  | "rate_limited"     // 429；帶 retry_after_ms?
  | "overloaded"       // 529/503
  | "content_filter"   // 上游拒答
  | "timeout"          // 超過 generation timeout
  | "network"          // DNS／TLS／連線錯誤
  | "protocol"         // 回應形狀不符（解析失敗、SSE 斷裂）
  | "unknown";

interface LlmAdapter {
  readonly format: ApiFormat;
  listModels?(conn: ResolvedConnection, fetch: FetchLike): Promise<string[]>;
  complete(conn: ResolvedConnection, req: NormalizedRequest, fetch: FetchLike,
           onDelta?: (d: NormalizedDelta) => void): Promise<NormalizedResult>;   // 失敗 throw LlmError{class, status?, retry_after_ms?}
}
```

**RT-04** 上下文仍以**單一使用者輸入**包住整段房間逐字稿（v1 `wrapTranscript`），不把房間訊息映射成多輪 user／assistant。理由：(a) 房間是多人，不是一對一；(b) 各格式的多輪規則不同（Anthropic 要求交替角色）；(c) 不可信內容集中在一處，較好防注入。多輪映射列為 Q-07。

**RT-05** hosted agent 不帶任何工具（`tools` 欄位不送或送空）。這是 INV-09，不因格式不同而放寬。

### 2.4 串流

- adapter 支援 SSE 串流時，HostedGeneration 以 `onDelta` 收文字，**節流**（≥ 250 ms 或累積 ≥ 64 字元）後經 Room 廣播 WS `draft` 封包（見 [04](04-backend.md) B-10）。
- `draft` 不寫 D1、不佔 seq、不喚醒（V2-INV-03）。完成後照 v1 流程 `send_message`，正式訊息事件取代草稿。
- 斷線重連的 client 不補發草稿；它只看到最終訊息。
- 串流是每個 runtime 的設定（`stream: bool`），預設關，W5 才開放。Phase 2：Worker 的 `ff_drafts` 關閉時忽略這個設定；已送出草稿的串流失敗不重試（Q-21）；見 [W5](milestones/W5.md) §4.2、§4.5.3。

### 2.5 回覆後處理

沿用 v1：`NO_REPLY`（trim 後完全相等）不落盤；body 超過 8 KiB 時截斷並附「（已截斷）」；`finish=length` 不額外提示。空字串視為 `NO_REPLY`。

### 2.6 錯誤處理

| 錯誤類別 | 重試 | 房內提示（BR-45） | 對 connection 的影響 |
| --- | --- | --- | --- |
| `rate_limited`、`overloaded` | 最多 1 次，等 `retry_after_ms`（上限 10 s，用 DO alarm，不 sleep） | 「上游忙碌」 | 無 |
| `timeout`、`network` | 最多 1 次 | 「連不上模型服務」 | 無 |
| `auth` | 不重試 | 「模型服務拒絕了憑證」 | 標記 `last_error=auth`，控制台顯示紅點 |
| `not_found` | 不重試 | 「模型不存在」 | 標記 runtime 錯誤 |
| `bad_request`、`context_length`、`protocol`、`unknown` | 不重試 | 「回覆失敗」 | 記錄 |
| `content_filter` | 不重試 | 「模型拒絕回答」 | 無 |

失敗一律：generation 標 `failed`（附 `error_class`）、廣播 `reply failed` status、釋放 ambient lock（INV-05）、不落盤任何部分文字。

### 2.7 FM 清單：LLM adapter（先列失敗，再寫程式）

Adapter 是本專案少數必須單獨測試的模組（純轉換＋協定解析）。以下是 W4 開始寫 adapter 前必須補齊並變成 golden fixtures 的失敗方式；Phase 2 逐條補「輸入 fixture／期望類別」。

- **FM-LLM-01** 回應非 JSON（HTML 錯誤頁、空 body）→ `protocol`。
- **FM-LLM-02** 200 但缺必要欄位（`choices` 空、`content` 為陣列而非字串、Anthropic `content` 只有 `tool_use` 區塊）→ 可解析文字則取，否則 `protocol`。
- **FM-LLM-03** 401／403 → `auth`；錯誤訊息原文**不得**進 log 或房間。
- **FM-LLM-04** 404 模型 → `not_found`；404 路徑（base URL 錯）→ `not_found` 並標 connection。
- **FM-LLM-05** 429 帶 `retry-after`（秒或 HTTP-date）、不帶、帶超大值 → `rate_limited`，`retry_after_ms` 夾在 [0, 10000]。
- **FM-LLM-06** Anthropic 529、OpenAI 503 → `overloaded`。
- **FM-LLM-07** SSE：跨 chunk 切斷的 `data:` 行、`\r\n` 與 `\n` 混用、註解行 `:`、`[DONE]`、Anthropic `event:` 類型（`message_start`、`content_block_delta`、`message_stop`、`error`、`ping`）、Gemini 串流陣列片段。
- **FM-LLM-08** SSE 中途斷線且未收到結束事件 → `protocol`，丟棄已收文字（不落盤半截回覆）。
- **FM-LLM-09** 串流中收到錯誤事件（Anthropic `event: error`）→ 依其 type 對應類別。
- **FM-LLM-10** 超過 generation timeout（沿用 v1 上限 300 s）→ `timeout`，abort fetch。
- **FM-LLM-11** 回應超過 1 MiB → 停止讀取，`protocol`。
- **FM-LLM-12** `finish_reason` 未知值 → `other`，照常落盤。
- **FM-LLM-13** 模型輸出 `NO_REPLY` 前後帶空白或 Markdown 包裝（``` `NO_REPLY` ```）→ 只接受 trim 後完全相等；其他照常落盤。
- **FM-LLM-14** `usage` 缺漏或型別錯 → `usage` 為 undefined，不失敗。
- **FM-LLM-15** base URL 帶或不帶結尾 `/`、帶或不帶 `/v1` → 依 preset 規則正規化，禁止產生 `//`。
- **FM-LLM-16** 憑證含換行或前後空白 → 建立連線時拒絕，不在呼叫時才失敗。

---

## 3. Runner：通用本機執行器

v1 `sidecar/` 綁 Codex。v2 把它泛化成 `kith-runner`，Codex 只是其中一個 adapter。

### 3.1 行為（沿用 v1 sidecar 已驗證的規則）

- 以 bot token 連 `GET /mcp/events`；第一次啟動 `after_seq = MAX(seq)`；重連用持久化的 `last_live_seq`。
- 只對 `replay:false` 且 tokenizer 命中自己的 `message` 啟動；`replay:true` 只推進 cursor（INV-19）。
- 啟動前本地檢查 `quota_class`：`operator_personal` 時觸發者必須是 operator（INV-13）。
- 啟動後 `post_status(accepted)`，執行中 `running`（只走 WS，不寫 D1），工具摘要寫 `trace`，完成後 `send_message`（可在 thread）。
- **房間文字永不插入 argv**；經 stdin 或暫存檔傳入（v1 ARGV-01）。

### 3.2 Adapter 設定

```toml
# runner.toml（示意；Phase 2 鎖定 schema）
kith_url   = "https://kith.example.workers.dev"
bot_token_file = "/var/lib/kith-runner/claude/token"      # 0600；不在 git
state_dir  = "/var/lib/kith-runner/claude/state"
quota_class = "operator_personal"                         # 使用個人訂閱登入時必須

[adapter]
kind = "claude_code"          # codex | claude_code | gemini_cli | command
workdir = "/srv/kith-work/claude"
executable = "/usr/local/bin/claude"
timeout_s = 1800

[adapter.command]             # kind = "command" 時
argv = ["./my-agent", "--json"]   # 固定 argv；房間文字只走 stdin
```

| adapter | 啟動方式 | 輸出解析 |
| --- | --- | --- |
| `codex` | 沿用 v1（`codex exec`，獨立 `CODEX_HOME`，INV-14） | 沿用 v1 |
| `claude_code` | 非互動模式，prompt 經 stdin | 結構化輸出（JSON）優先，否則取最後一段文字 |
| `gemini_cli` | 非互動模式，prompt 經 stdin | 同上 |
| `command` | 固定 argv；stdin 送 JSON `{room_id, trigger, transcript}` | stdout JSON `{reply, traces[]}`，或純文字當 reply |

各 CLI 的旗標與輸出格式在 Phase 2 查官方文件後鎖定（Q-08）。

**RT-06** quota 推廣：任何以**個人帳號登入**的 CLI（Codex device login、Claude 訂閱登入、Gemini 個人帳號）都必須 `quota_class=operator_personal`。runner 啟動時若偵測到 adapter 為訂閱登入卻設定 `api_key`，拒絕啟動（沿用 v1 Codex 規則，推廣到所有 adapter；偵測方法 Phase 2 定義，無法偵測時以設定檔顯式申報為準）。

**RT-07** INV-14 推廣：每個 runner adapter 的 home／workdir／executable 與其他 runner、與 fanzloud 的路徑集合不相交。

### 3.3 FM 清單：runner（W6 前補齊）

- **FM-RUN-01** SSE 斷線 → 指數退避重連，用持久 cursor；不重跑已完成的 trigger。
- **FM-RUN-02** 收到 `gap` → 以 cursor 重新 GET；補回的事件全是 `replay:true`，不執行。
- **FM-RUN-03** CLI 非零退出、逾時、被 kill → `post_status(blocked)`＋一則失敗摘要訊息；釋放 in-flight。
- **FM-RUN-04** CLI 輸出超過 8 KiB → 截斷並把全文寫 trace（≤ 2 KiB 摘要，全文 R2）。
- **FM-RUN-05** 同一 trigger 在 runner 重啟後重送（live 事件重複）→ 以 `(room_id, trigger_seq)` 去重。
- **FM-RUN-06** token 被撤銷 → 401，停止並清楚報錯，不重試風暴。
- **FM-RUN-07** 房間文字含 shell 特殊字元、NUL、超長行 → 不影響 argv；stdin 以 UTF-8 JSON 傳送。
- **FM-RUN-08** 非 operator 觸發 `operator_personal` → 不啟動、不 `post_status(accepted)`、本地 metric +1。

---

## 4. External：任意 MCP client

- 持 bot token，使用 v1 四個 MCP tool（`list_rooms`、`read_history`、`send_message`、`post_status`）與 `GET /mcp/events`。
- Kith 不管理它何時開口；attention 對 external agent 只影響事件上的提示欄位。
- v2 在 `/mcp/events` 的 live 事件加上**選填**提示 `wake: { mentioned: bool, wake_allowed: bool }`（B-12）。`wake_allowed=false` 表示依 quota／attention 不該回應；Kith 無法強制外部 client 遵守，成員格顯示「external：Kith 不保證它遵守喚醒規則」。
- `replay:true` 上的 `wake` 一律省略。

---

## 5. 憑證與安全

**RT-08** provider 憑證存 D1 `provider_connections.secret_ciphertext`，以 AES-GCM（v1 `src/keyring.ts`）加密，key 來自 Worker secret `KITH_SECRETS_KEY`。沒有設定這個 secret 時，控制台不允許建立 `stored` 憑證，只能用 `env` 模式（連線引用一個 Worker secret 名稱，例如 `XAI_API_KEY`）。

**RT-09** 憑證不出現在任何 API 回應、WS 封包、log、trace、錯誤訊息、metrics label。只回 `secret_last4` 與 `secret_updated_at`。

**RT-10** base URL 規則：

- 必須 `https://`。例外：`KITH_DEV_ALLOW_HTTP_PROVIDERS=on`（只在本機 wrangler dev 與 E2E 使用，production 部署檢查拒絕）。
- 拒絕 URL 內含帳密（`user:pass@`）。
- 拒絕 IP 字面量的私有、loopback、link-local 範圍；拒絕 `localhost`。（Cloudflare Workers 本身不能連 loopback，但仍明文拒絕，讓錯誤在建立時出現。）
- 額外 header（例如 OpenRouter 的 `HTTP-Referer`）允許，但 header 名不得是 `authorization`、`x-api-key`、`x-goog-api-key`、`cookie`。

**RT-11** v1「核心版 Workers 不連 thinrouter」改寫為：Kith 不內建任何「個人訂閱轉 API」的 preset；若 operator 自行接這類 gateway，必須標 `operator_personal`（BR-54）。見 D-05 與 ADR-0006。

**RT-12** hosted 的 system prompt 由 Kith 固定前綴（v1 `systemPrompt`：身份、不可信內容、簡短、`NO_REPLY`）＋operator 附加段組成。附加段 ≤ 4 KiB，不能覆蓋或刪除固定前綴。

---

## 6. 限制與配額

沿用 v1 caps（每房 hosted in-flight 1、runner in-flight 1、wake budget 6/分）。v2 新增：

| 項目 | 預設 | 說明 |
| --- | --- | --- |
| `max_output_tokens` | 1024 | runtime 可調，上限 8192 |
| 上下文組裝 | 最近 40 則或 16 KiB | 沿用 v1；runtime 可調小不可調大（Phase 2 可重議） |
| generation timeout | 300 s | 沿用 v1 |
| provider 回應大小上限 | 1 MiB | FM-LLM-11 |
| 每連線每日 token 預算 | 無（選填） | W5 generation 可觀測後才做；超出則該連線的 agent 當日 silent |

---

## 7. v1 → v2 遷移

1. D1 migration 新增 `provider_connections`、`agent_runtimes`，`generations` 加欄位（[04](04-backend.md) §4）。
2. 若 `XAI_API_KEY` 存在：建立連線 `xai-default`（`secret_source=env`、`secret_env=XAI_API_KEY`、`openai_chat`、`https://api.x.ai/v1`）。Phase 2：腳本無法讀 Worker secret，改由 operator 以 `--xai-secret-env XAI_API_KEY`／`--no-xai` 申報（[W4](milestones/W4.md) §4.7）。
3. 每個 `quota_class=api_key` 的既有 agent，若沒有 runtime 列：建立 `runtime=hosted`、連線 `xai-default`、模型 `grok-4.5`。
4. 每個 `operator_personal` 的既有 agent：建立 `runtime=runner`、adapter `codex`。
5. （Phase 2 修訂：不實作 `fake` adapter；E2E 改用 HTTP fake provider，`FAKE_LLM_TEXT` 只留給沒有 runtime 列的 agent，見 [W4](milestones/W4.md) §1.2、Q-15。）原文：`FAKE_LLM_TEXT` 保留為**測試專用** fake adapter（`api_format=fake`，只在 `KITH_DEV_ALLOW_HTTP_PROVIDERS=on` 或測試環境可選）。v1 的 `reply_limit.fixed` 在 v2 改由 fake adapter 產生。
6. 遷移是冪等腳本，重跑不產生重複列。

---

## 8. Phase 2 待細化

- [x] 每個 `api_format` 的請求／回應欄位對照表（含串流事件），並以官方文件查證（附 URL 與查閱日期）→ [W4](milestones/W4.md) §4.5、[W5](milestones/W5.md) §4.4（官方文件網站被網路政策擋下，改用官方 SDK 原始碼；推論逐條標註）。
- [ ] 每條 FM-LLM、FM-RUN 的 fixture 檔名與期望輸出。FM-LLM 全部完成 → [W4](milestones/W4.md) §8、[W5](milestones/W5.md) §8；FM-RUN 在 W6。
- [ ] `runner.toml` 完整 schema（JSON Schema）與錯誤訊息。
- [ ] 各 CLI adapter 的非互動旗標與輸出解析（Q-08）。
- [ ] RT-06「訂閱登入」的偵測方法，或明確改為只靠申報。
- [ ] `kith-runner` 的打包方式（npm 套件？單檔？）與安裝說明。
- [x] RT-01 每種 runtime 轉換的狀態轉移表與 FM 清單（例如改動與 dispatch 同時發生）→ [W4](milestones/W4.md) §4.3.2、§4.6.5（epoch 在呼叫上游前後各比對一次）。

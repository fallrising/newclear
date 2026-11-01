# Provider capabilities：產品、認證與執行契約

查核日期：2026-10-11（UTC）。本文件是規格草稿，依官方公開文件描述候選能力；未執行登入、模型請求、安裝、帳號連結或遠端變更。

涵蓋 OpenAI、Anthropic、Cursor、Google Antigravity、xAI Grok、OpenCode 六個品牌／產品家族，以及 DeepSeek 模型 API。OpenCode 是執行框架及可選服務品牌，不代表新的底層模型供應商。

所有例子皆為合成資料；本文件不聲稱任何實際帳號、訂閱、憑證、安裝版本或模型已經可用。

## 1. 證據狀態與名詞

每個候選 binding 的初始狀態皆為 `documentation_status=documented`、`runtime_status=runtime_unverified`、`actual_entitlement=unknown`，尚未准入執行。

`documented` 僅表示表中明確列出的產品或能力有官方來源；未查得契約的自動介面另標 `automation_contract=unverified`，不得借用產品存在來升格。

`runtime_unverified` 表示尚無指定版本的實機證據；`actual_entitlement=unknown` 表示實際帳號對該產品、路徑、模型、工作區及用量的權益尚未確認。

後文表格 `D / U / ?` 是上述三個完整狀態的縮寫。本文件全部來源的查核日期均為 2026-10-11；來源更新後須重新評估受影響能力。

| 層次 | 必須保存的資料 | 不可混淆的概念 |
|---|---|---|
| Brand | `brand` | 同品牌不表示同產品、相同端點或共用訂閱 |
| Product | `product`、產品版本／方案類型 | Consumer chat、coding agent、模型 API、雲端 Bot 分開 |
| Harness | `harness`、`harness_version`、工具及執行政策 | 執行工具與保存會話的程式；可能使用別家模型 |
| Account | `owner_ref`、`account_ref`、`workspace_ref`、`billing_account_ref` | 邏輯 worker 不是供應商人類帳號，也不是付款主體 |
| Auth | `auth_mode`、`credential_ref`、實際 grant／scope | OAuth、產品 API key、模型 API key 不可互換；不保存明文秘密到規格或事件 |
| Entitlement | `actual_entitlement`、`billing_route`、可用模型／額度證據 | 有登入不等於有推論授權；有訂閱不等於每種呼叫都扣訂閱 |
| Transport | 控制端與推論端各自的 `transport`、端點／協定、schema 版本 | CLI process、stdio JSON-RPC、HTTP、SSE、ACP 各有獨立契約 |
| Session | `native_session_id`、`continuity_mode`、lease／checkpoint | CLI thread、API response、consumer chat 不是相同會話識別碼 |

Binding 必須綁定上述層次及明確 `use_case`。品牌名、指令名、已存在的 token 或可成功連線，都不能單獨證明授權用途與計費路徑。

## 2. 候選能力矩陣

以下 binding 名稱是工程識別碼。CLI／SDK 的產品 API key 不一定是底層模型廠商 API key；每次執行仍須核對實際生效的認證來源。

| 品牌／產品與 binding | Harness／transport 與精確續接 | Auth／entitlement／計費邊界 | 目前證據 | 官方來源 |
|---|---|---|---|---|
| OpenAI Codex；`codex-native` | `codex exec --json`；`exec resume <id>`；Codex SDK／app-server JSON-RPC 的 thread／turn | 原生 ChatGPT 登入或 API key 是不同路徑；legacy app-server authentication 的用途限制須另審 | D / U / ? | [Auth](https://learn.chatgpt.com/docs/auth)、[Exec](https://learn.chatgpt.com/docs/non-interactive-mode)、[SDK](https://learn.chatgpt.com/docs/codex-sdk)、[App-server](https://learn.chatgpt.com/docs/app-server) |
| OpenAI SIWC plan usage；`openai-siwc` | 公開 Responses HTTP／SSE；也可配置 Codex app-server；HTTP 歷史由 client 傳送 | 符合資格的使用者授權自己的 ChatGPT plan usage；app 類型、client、scope 及 preview 限制見第 3 節 | D / U / ? | [Quickstart](https://developers.openai.com/siwc/quickstart)、[Plan usage](https://developers.openai.com/siwc/token-sharing-open-source) |
| OpenAI 模型 API；`openai-api` | 公開模型 API／官方 SDK；模型 API 本身不是本機工具 sandbox | API 專案／組織 key 與用量帳務；不因 ChatGPT 登入而變成訂閱路徑 | D / U / ? | [Authentication](https://learn.chatgpt.com/docs/auth) |
| Anthropic Claude Code；`claude-code-native` | `claude -p`；JSON／stream-json；`--resume <id>` | 終端使用者以自己的訂閱／API／雲端憑證原生登入；含符合官方條件的平台託管未修改 binary，見第 4 節 | D / U / ? | [Headless](https://code.claude.com/docs/en/headless)、[Auth](https://code.claude.com/docs/en/authentication)、[Legal](https://code.claude.com/docs/en/legal-and-compliance) |
| Anthropic Agent SDK；`claude-sdk-api` | 官方 Python／TypeScript SDK；agent loop、tools、sessions、hooks | 第三方產品依 API key／官方支援雲端路徑；Claude.ai login 有明示限制 | D / U / ? | [Overview](https://code.claude.com/docs/en/agent-sdk/overview)、[Quickstart](https://code.claude.com/docs/en/agent-sdk/quickstart) |
| Cursor Agent；`cursor-agent` | `agent -p`／`--resume <chatId>`；ACP；TS／Python Agent SDK | 官方 CLI 登入／Cursor API key；SDK user key 計入 user plan，service-account key 計入 team | D / U / ? | [CLI](https://cursor.com/docs/cli/headless)、[ACP](https://cursor.com/docs/cli/acp)、[TS SDK](https://cursor.com/docs/sdk/typescript)、[Python SDK](https://cursor.com/docs/sdk/python) |
| Google Antigravity CLI；`antigravity-cli` | `agy -p`；JSON／stream-json；`--conversation <id>`；NDJSON 多輪 | Google 帳號產品方案與 direct Gemini API 模式分開；後者另用 `GEMINI_API_KEY` | D / U / ? | [Headless](https://www.antigravity.google/docs/cli/headless/)、[Resume](https://www.antigravity.google/docs/cli/commands/resume)、[Auth](https://www.antigravity.google/docs/cli/install/) |
| Google Antigravity SDK；`antigravity-sdk-api` | Python `google-antigravity`；Agent、chat、tools、policy／lifecycle | Quickstart 使用 Gemini API key；另有 Google Cloud／Vertex 路徑，不預設沿用桌面訂閱 | D / U / ? | [SDK](https://www.antigravity.google/docs/sdk/overview/)、[Gemini billing](https://ai.google.dev/gemini-api/docs/billing) |
| xAI Grok consumer；`grok-consumer` | grok.com／行動 app 及既有聊天；外部投遞 consumer chat 契約未查得 | Consumer 方案與既有登入；不得推定任意 xAI API key 共用同一額度 | D / U / ?；`manual_handoff`，自動契約 unverified | [Overview](https://docs.x.ai/grok/overview)、[FAQ](https://docs.x.ai/grok/faq) |
| xAI Grok Build；`grok-build` | `grok -p`；JSON／streaming-json；`--resume <id>`；`grok agent stdio` ACP | 官方登入／device auth 或 `XAI_API_KEY`；實際 team、權益與計費須另確認 | D / U / ? | [Overview](https://docs.x.ai/build/overview)、[Headless／ACP](https://docs.x.ai/build/cli/headless-scripting)、[CLI](https://docs.x.ai/build/cli/reference) |
| xAI 模型 API；`xai-api` | Responses REST／`xai_sdk`；已文件化 `previous_response_id` | API Console 的 team 預付／月結帳務；不是 consumer chat 或 Build session 的續接 | D / U / ? | [Text／persistence](https://docs.x.ai/developers/model-capabilities/text/generate-text)、[Billing](https://docs.x.ai/console/billing) |
| xAI Grok Bot；`grok-bot` | 持久雲端電腦、背景任務／routines／指定 integration 事件 | FAQ 列付費 Cursor 個人／Teams 或已連結個人 SuperGrok；實際 linked plan 未知 | D / U / ?；`manual_handoff`，通用 event adapter unverified | [FAQ](https://docs.x.ai/grok-bot/faq)、[Routines](https://docs.x.ai/grok-bot/skills-routines-and-automations) |
| OpenCode runtime；`opencode-runtime` | `opencode run`／`--format json`／`--session <id>`；serve HTTP、SDK、ACP | Runtime 與模型服務分開；可接自己的 provider key，不必先購買 OpenCode gateway | D / U / ? | [CLI](https://opencode.ai/docs/cli/)、[Server](https://opencode.ai/docs/server/)、[SDK](https://opencode.ai/docs/sdk/)、[Providers](https://opencode.ai/docs/providers/) |
| OpenCode 模型方案；`opencode-gateway` | Zen 等產品的模型 gateway；與 runtime transport 分開 | 各產品自己的 key、credits／方案；不得由 runtime 可用推定 gateway entitlement | D / U / ? | [Zen](https://opencode.ai/docs/zen/)、[Black](https://opencode.ai/black)、[Providers](https://opencode.ai/docs/providers/) |
| DeepSeek 模型 API；`deepseek-api` | 模型 HTTP API；Chat Completions／Responses 相容格式；context 由 client 保存 | DeepSeek API key、用量餘額；不是帶桌面 session 的 agent runtime | D / U / ? | [Docs](https://api-docs.deepseek.com/)、[Responses](https://api-docs.deepseek.com/guides/responses_api/)、[Balance](https://api-docs.deepseek.com/api/get-user-balance/) |

上述自動契約 unverified 的產品先作人工交付目標；不編造 endpoint。未驗收的網頁自動操作也不能作為已通過 adapter 契約的證據。

## 3. OpenAI：原生 Codex、SIWC 與 API key 分開

### 3.1 SIWC 的適用範圍

SIWC 將登入身分與 ChatGPT plan usage 分開。官方列符合資格的 Plus／Pro 使用者、開源應用／夥伴、本機個人應用及 selected private clients；paid 或 remotely hosted app 需依 interest／partner 路徑確認資格。不是對任意商業託管產品的概括授權。[Quickstart](https://developers.openai.com/siwc/quickstart)；[Overview](https://developers.openai.com/siwc/token-sharing-open-source)；[官方整合文章](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt)

每個動態簽發的 `client_id` 綁定已認證的 user／workspace。同一 user／workspace 的自有裝置可共享註冊設定與額度，每個 host 使用獨立且持久的 `ext_agent_host_id`；多 host 不產生多份方案額度。[Overview](https://developers.openai.com/siwc/token-sharing-open-source)

官方 self-hosted VM 路線要求同一 tool／user／workspace，透過受保護流程轉移該註冊憑證並保留 VM 的 host ID；此類轉移尚無 host-specific usage attribution／plan-access revocation。[Self-hosted VMs](https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms)

該同一擁有者多 host 契約不能推出跨使用者池化、憑證轉售或單一訂閱供不特定客戶使用的許可。本次來源未提供涵蓋這些情境的完整明示結論，將其標為 `policy_review=unresolved`，須另取得適用證據。

### 3.2 認證、scope 與端點

- 使用 system-browser OAuth、PKCE S256、state、nonce 與 loopback callback；首次使用 `dynamic_agent_client` 入口，之後保存並重用正式簽發的 client ID。
- Identity scopes 是 `openid profile email`；plan usage scopes 是 `offline_access resource.invoke chatgpt.tokens.use.direct`；resource 為 `https://api.openai.com/v1`。
- 必須檢查實際 granted scopes；只有身分登入而缺少 direct-usage grant 時，不得呼叫 plan inference。
- 此流程不授予 ChatGPT 對話、其他 account context 或使用者 API key 的存取權。

以上認證要求依 [Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)、[Token reference](https://developers.openai.com/siwc/token-sharing-open-source/token-reference)、[Quickstart](https://developers.openai.com/siwc/quickstart)。

- 模型目錄使用 `GET https://api.openai.com/v1/models`，依當前帳號的 `visibility: list` 結果選擇；帳號切換後重新查詢，bundled model catalog 不作 entitlement 證據。
- 推論使用 `POST https://api.openai.com/v1/responses` 與該 SIWC grant 的 bearer token；官方明示不使用 ChatGPT `backend-api`。
- HTTP 設定 `store:false`、`stream:true`，將需要的 history 放入 `input`。收到串流片段或 HTTP 200 不等於成功，必須解析 `response.completed`／失敗終態。
- 即使模型請求 completed，也只能記錄 provider turn 完成；本層 `execution_completed` 與外部 `acceptance_ref` 仍需各自的成果及驗收證據。

前三項依 [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)；最後一項為本規格的完成語意。

### 3.3 Preview 與 Codex app-server

SIWC HTTP 不支援 `previous_response_id` 的持久續接；`background`、`conversation`、`multi_agent` 等參數及 hosted image generation、file search、Code Interpreter、native computer use、hosted MCP／connectors 有明列限制，完整能力以當時 preview 表為準。[Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)

本機 shell、MCP、child agents 可透過支援的 function／custom tools 運作；這不表示 hosted tools 同時開放。SIWC app-server 可以保存 local thread 並 resume；env token 更新後需重啟 server 再 resume。[Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)；[SIWC app-server](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)

原生 Codex `exec` 可重用已保存登入；app-server 是 thread／turn JSON-RPC。官方 legacy app-server authentication 段明示 commercial／hosted services 從未獲該認證路線許可，既有 local／open-source apps 建議移往 SIWC；不可把這段誤寫為所有 API-key 或 SIWC 組態的概括禁令。[Exec](https://learn.chatgpt.com/docs/non-interactive-mode)；[App-server](https://learn.chatgpt.com/docs/app-server)

Codex 的 advanced ChatGPT-managed auth CI 工作流程明示不適用 public／open-source repositories，並以 API key 作 automation 預設；這是該憑證 CI 工作流程的範圍，不能泛化為不准本機 CLI 處理開源程式碼。[Non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)

app-server WebSocket 標為 experimental／unsupported；本規格不承諾其生產穩定性。SDK／app-server 的真實版本與協定仍須驗收。[App-server](https://learn.chatgpt.com/docs/app-server)；[Codex SDK](https://learn.chatgpt.com/docs/codex-sdk)

SIWC 遇 eligibility、scope、quota 或 route 錯誤，保留 request ID 並停止該請求；不得暗中改用另一身分、backend-api 或付費 API。指定 binding 的 refresh／recovery 依官方流程執行。[Errors and recovery](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery)

## 4. Claude 與 Cursor：同有 SDK，授權契約不同

Claude Code 官方 `claude setup-token` 支援使用者自己的 CI／scripts；這是官方產品使用流程，不代表可收集他人的 Claude.ai OAuth 憑證並代理訂閱。存在 API key 時的 credential precedence 也可能改變實際計費來源。[Authentication](https://code.claude.com/docs/en/authentication)

官方 Legal 的「Can customers offer Claude Code in their products?」明列平台預裝／執行 Claude Code 的條件，包括同意 Commercial Terms、使用 Anthropic 發布的未修改 binary、不得移除／停用／限制內建認證方式，以及每個終端使用者以自己的訂閱、API key 或支援的第三方憑證登入並直接承擔用量；平台不得代付、轉售或中介該使用量。[Legal—產品託管條件](https://code.claude.com/docs/en/legal-and-compliance)

同頁「Authentication and credential use」明文保留終端使用者在上述平台託管的未修改 Claude Code binary 登入自己的訂閱。因此 native route 不限於使用者本機；不能把「第三方託管 binary」直接判為不允許訂閱使用。[Legal—原生登入例外](https://code.claude.com/docs/en/legal-and-compliance)

另一條路徑是開發者自有應用整合 Claude 能力：官方要求使用 API key／支援雲端，不允許產品提供自己的 Claude.ai login、中介 Claude.ai 憑證／session tokens，或替使用者以 Free／Pro／Max 憑證路由產品請求。Agent SDK 亦保留「除預先批准外」的限制；同頁允許客戶替自己的已授權使用者配置自有 API／第三方憑證，且用量直接歸 key owner、不得轉售或中介。[Legal—認證與憑證用途](https://code.claude.com/docs/en/legal-and-compliance)；[Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview)

因此 admission 按「原生執行／產品代理、binary 完整性、保留認證方式、誰登入、誰承擔用量、請求代表誰」核對具體用途。Headless 或 CLI wrapper 的存在本身既不是條款豁免，也不是拒絕託管原生登入的理由；`claude-sdk-api` 的產品契約不能直接覆蓋 `claude-code-native`。[Legal](https://code.claude.com/docs/en/legal-and-compliance)；[Headless](https://code.claude.com/docs/en/headless)；[SDK Quickstart](https://code.claude.com/docs/en/agent-sdk/quickstart)

Cursor 官方具備 CLI、ACP，以及 TypeScript／Python Agent SDK，並列出嵌入產品與 orchestrator 的使用情境；不能只按既有 GUI 印象判斷能力。SDK 的 local agent 指 harness／檔案執行位置，推論仍由 Cursor 託管。[ACP](https://cursor.com/docs/cli/acp)；[TypeScript SDK](https://cursor.com/docs/sdk/typescript)；[Python SDK](https://cursor.com/docs/sdk/python)

SDK user API key 計入使用者方案，service-account key 計入所屬 team，沿用對應 request pools；team admin API key 並非該 SDK 的認證替代品。[TypeScript SDK](https://cursor.com/docs/sdk/typescript)

官方明示 SDK 是 agent 介面，並非 standalone inference／chat-completions API；未提供可供任意 raw inference 的 Router endpoint。Service 轉售限制不能被推論為一律禁止文件明列的 SDK 嵌入情境，但任意訂閱池／raw gateway 也無正向授權證據。[SDK](https://cursor.com/docs/sdk/typescript)；[Terms §1.5](https://cursor.com/terms-of-service)

Cursor resume 不持久保存全部 inline MCP、tool restrictions、system prompt 等設定。恢復 checkpoint 後須重新套用 policy，並用 probe 證明工具拒絕仍生效。[SDK](https://cursor.com/docs/sdk/typescript)

## 5. Antigravity、Grok、OpenCode 與 DeepSeek 的差異

### 5.1 Antigravity

`agy` 的 Google 帳號方案和 `modelProvider: gemini` 的 direct API 模式是不同 route；Plans 的 BYOK 不增加產品 quota，與 Auth 提供 direct Gemini API 並不構成共用額度承諾。SDK quickstart 的 Gemini API 路徑需獨立計費證據。[Plans](https://www.antigravity.google/docs/plans/)；[Auth](https://www.antigravity.google/docs/cli/install/)；[SDK](https://www.antigravity.google/docs/sdk/overview/)

Headless permission soft-deny 可能仍 exit 0，必須解析 result、tool errors 與成果；多輪 stream 的 usage 為累積值，成本帳採相鄰終態差量，不能重複加總累積值。[Headless](https://www.antigravity.google/docs/cli/headless/)

固定 `conversation_id` 續接，NDJSON 多輪輸入需等目前 result 再送下一回合；SDK 跨 process 的持久恢復能力保持未驗收。[Headless](https://www.antigravity.google/docs/cli/headless/)；[Resume](https://www.antigravity.google/docs/cli/commands/resume)

### 5.2 Grok 的四個產品通道

Consumer chat、Build coding harness、xAI model API、Grok Bot 雲端電腦各自有不同 session、工具、帳號連結和 transport；名稱相近不能彼此替換。[Consumer](https://docs.x.ai/grok/overview)；[Build](https://docs.x.ai/build/overview)；[API](https://docs.x.ai/developers/model-capabilities/text/generate-text)；[Bot](https://docs.x.ai/grok-bot/faq)

Consumer FAQ 的共享額度描述與 API Console 的 team 預付／月結帳務不能自動合併。每個 binding 保存實際 `auth_mode`、`billing_account_ref`、`billing_route`，缺少證據時仍是 unknown。[Consumer FAQ](https://docs.x.ai/grok/faq)；[API Billing](https://docs.x.ai/console/billing)

Build 的 CLI Reference 將 `--session-id` 說成新 UUID，Headless 表則稱 create／resume；選用明確 `--resume <verified-id>`，以已安裝版本 help 與 probe 解決差異，不以文件關鍵字投票。[CLI Reference](https://docs.x.ai/build/cli/reference)；[Headless](https://docs.x.ai/build/cli/headless-scripting)

Bot 官方有 routines／integration 事件，但同帳號 Bots 共用電腦、檔案與登入，不能承諾每個邏輯 Bot 都有隔離 sandbox。尚無本次查核可用的通用外部 webhook schema、簽章、receipt／dedup 契約，故先人工交付；將來只能按具體 integration 個別驗收。[Bot FAQ](https://docs.x.ai/grok-bot/faq)；[Routines](https://docs.x.ai/grok-bot/skills-routines-and-automations)

### 5.3 OpenCode 與 DeepSeek

OpenCode runtime 可接自己的模型 provider key；Zen／Black／Go 是另外的服務／方案概念，不能以任一方案的歷史可購買性作實作前提。選 `opencode-runtime + deepseek-api` 是 harness 與 model binding 的組合，不是自動轉移訂閱。[Providers](https://opencode.ai/docs/providers/)；[Zen](https://opencode.ai/docs/zen/)；[DeepSeek integration](https://api-docs.deepseek.com/quick_start/agent_integrations/opencode/)

OpenCode `prompt_async` 的 HTTP 204 表示已接受；需再追蹤 event、session status、message 與 artifact。外部 runner 仍須保護同一 native session 的單一執行 lease。[Server](https://opencode.ai/docs/server/)；[SDK](https://opencode.ai/docs/sdk/)

DeepSeek Responses 明示無狀態：不支援 `previous_response_id`、`conversation`、`store`、`background`，且未支援參數可能被忽略。客戶端每次傳入完整必要歷史；provider response ID 不能當作 server checkpoint。[Guide](https://api-docs.deepseek.com/guides/responses_api/)；[Reference](https://api-docs.deepseek.com/api/create-response/)

DeepSeek 串流具有 completed／incomplete／failed 終態；相容格式不能推論完整 OpenAI 功能相容。模型 alias 也不是不可變版本 pin；驗收應記錄選定 model ID、實際回報模型與 capability catalog。[Responses Reference](https://api-docs.deepseek.com/api/create-response/)；[Models](https://api-docs.deepseek.com/api/list-models/)

DeepSeek guide／reference 的直接全文擷取曾逾時；上述無狀態與忽略參數契約已於同日透過官方頁的搜尋索引交叉確認。這是文件證據，仍無實際 API 驗收。

## 6. Admission evidence gates

以下為工程規格。狀態只由可追溯證據更新，不由模型推測、品牌白名單、條款關鍵字匹配或執行結果碼自動決定政策。

`policy_review` 可為 `unreviewed`、`supported_for_scope`、`restricted`、`unresolved`；每筆評估保存適用產品／route／用途、官方原文定位、查核日、判斷理由與 reviewer 記錄。

只有「這個 use case 有明確適用證據」才可轉為 `supported_for_scope`；缺少條文不直接等於允許或禁止。遇矛盾、預覽資格或需個別批准的用途，維持 unresolved 並保存待補證據。

| Gate | 必須取得的證據 | 未通過時的處理 |
|---|---|---|
| G0 產品與用途 | 明確 brand／product／harness／transport、使用者與服務對象、政策適用範圍 | 停在 documented，不生成自動執行准入 |
| G1 介面與版本 | 已安裝 binary／package version、help／官方 schema，所需方法與參數存在；記錄 evidence 摘要與版本 | 標 runtime_unverified；文件與版本不一致要先收斂契約 |
| G2 身分與權益 | 已授權 owner／account／workspace、實際 auth precedence、granted scopes、billing route、模型及方案證據 | actual_entitlement 保持 unknown；不以本機檔案存在判定 |
| G3 最小回合 | 依已有授權範圍執行受限回合；輸出可解析、native ID／request ID、完整終態、usage／計費來源 | 不升格；不得只靠 stdout 有文字或 exit 0 判成功 |
| G4 恢復方式 | 驗證所宣告 continuity_mode：明確 native ID resume，或舊 turn 停止證據齊備後，以新 session／lineage 從 ContextPack／harness checkpoint reconstruct | 不用 last／continue 隱含選擇；reconstruct 通過不提升 native resume 能力；未知 in-flight 不重建執行 |
| G5 權限拒絕 | 合成 read-only sandbox 中故意請求被規則禁止的動作，確認未執行、可辨識拒絕、未切換工具或身分 | 不繞過 policy；不因同功能另一 CLI 可用而改道 |
| G6 恢復與未知結果 | 中斷／重啟、取消／timeout、scope／quota 失敗；保存 terminal／uncertain，恢復相同 binding 與 policy | 先 reconcile；不能將失聯當成功或無條件重送 |
| G7 交付與並行 | 必要 artifact、review／驗證、native session lease、run／attempt／receipt 關聯 | provider completed、本層 execution_completed、外部 acceptance_ref 各按自己的證據記錄 |

G1 的版本／help 檢查不要求模型推論；G2 優先使用官方唯讀能力。會消耗額度或產生外部作用的 probe 僅在已有相應授權與預算時執行；本文件未執行任何 probe。

Probe 證據須刪除憑證與敏感 prompt，保留版本、合成輸入、結果摘要、實際 ID 的受控引用、錯誤分類、時間與可重現步驟。

只有 G0–G7 對所宣稱的能力均通過後，才能將該「版本＋binding＋用途」升為已驗收；不升格整個品牌或所有帳號。

升級 binary／SDK、變更 transport、scope、owner、workspace、模型能力或有效政策時，失效相關證據並重驗受影響 gates；既有有效證據不必無差別重跑。

## 7. Session、失敗與計費的不變條件

- 精確 native session ID 綁定同一 worker／account／workspace／harness／policy；跨 binding 移交只移交授權的 task context 與成果，不能假裝延續同一原生會話。
- 每個 native session 同時只有一個有效 lease。多 worker 是否可共用底層付款帳號，依該產品的已核定用途；即使共用，也不因此共用可變會話或取得跨人員授權。
- 分開保存 provider accepted、turn completed、本層 execution_completed 與外部 acceptance_ref。HTTP 200／204、process exit 0、通知已送達、模型停止生成，皆不單獨證明任務完成。
- 有送達或執行可能性的 timeout／process crash 進入 uncertain，先讀取供應商狀態或結果。沒有已驗證的 idempotency 契約時，不承諾 exactly-once。
- Auth refresh、resume、retry 只能遵守該 route 的官方語意；拒絕、額度耗盡或帳號未知不觸發身分輪轉、憑證搬用或隱式付費 API fallback。
- 成本分開保存 provider usage、估算及帳務實值；無可驗證數據就標 unknown。累積 usage 必須去重／取差，不能按每次通知重複計入。
- Quota、模型或 policy 判斷變更需更新 evidence；介面成功不是服務條款許可證明，條款許可也不是 runtime 成功證明。

## 8. 合成 Binding 範例

此範例是 SDD 的 InvocationRoute 與 Account／Entitlement 關係的合成展開，不是額外 schema。它僅顯示欄位與初始狀態，沒有可用憑證或真實帳號，也不啟動任何請求。

```yaml
binding_id: worker-alpha-model
brand: DeepSeek
product: model-api
harness: opencode
harness_version: null
owner_ref: owner-example
account_ref: account-example
workspace_ref: workspace-example
auth_mode: provider_api_key
credential_ref: secret-reference-example
billing_account_ref: billing-example
billing_route: deepseek-api-usage
transport:
  control: opencode_http
  inference: deepseek_responses_https
continuity_mode: harness_checkpoint
native_session_id: null
use_case: owner-authorized-local-work
documentation_status: documented
runtime_status: runtime_unverified
actual_entitlement: unknown
policy_review: unreviewed
admission: disabled
checked_at: 2026-10-11
evidence_refs: []
```

## 9. Email 與 SaaS 身分是另外的 binding

Cloudflare Email Routing 的 alias 將入站信轉至已驗證 mailbox／Worker，不等於新增具有獨立登入、IMAP storage 的完整信箱。當前另有 Email Sending Beta 的 REST／Workers／SMTP 能力，outbound 應獨立記錄授權與帳務。[Routing](https://developers.cloudflare.com/email-service/get-started/route-emails/)；[Sending](https://developers.cloudflare.com/email-service/get-started/send-emails/)

能收到驗證信只證明郵件路由成立；SaaS 是否接受註冊、角色與席位需另查。規格不把 email alias 當作自動建立人類 SaaS 帳號的權利。

GitHub App 的 bot／installation token 與 machine-user personal account／PAT 不同；官方條款限制 bot 自動註冊帳號。優先評估已授權 App 的最小資源權限，worker identity 留在內部 audit，不能由每個邏輯 worker 推出一個免費人類帳號。[Apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/differences-between-github-apps-and-oauth-apps)；[Terms](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service)

Notion internal connection 是 capability 與已分享資源範圍內的 bot；PAT 代表建立者。兩者不等於完整人類席位，也不必先為每個 worker 註冊新 email 身分。[Internal connections](https://developers.notion.com/guides/get-started/internal-connections)；[PAT](https://developers.notion.com/guides/get-started/personal-access-tokens)

Email／SaaS 候選同樣是 `documented / runtime_unverified / actual_entitlement unknown`；訊息寄送、資源建立與帳號變更另依任務授權與 adapter 證據准入。

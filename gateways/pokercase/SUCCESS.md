---
project: gateways/pokercase
purpose: 以 thinrouter 提供個人訂閱憑證的多協定 LLM gateway
kind: service
mainline: incomplete
usable_tag: none
reviewed: 2026-10-27
source_commit: 95fdf5f8ef4e548e6854f8838385913dff4877b2
---

# pokercase 成功契約

## 主線與範圍

目錄名為 pokercase，binary／資料目錄為 thinrouter；不是兩個不同產品。
[README](README.md) 定義 Chat Completions、Messages、Responses、routes/fallback/RR、
OAuth/session import、usage、Web admin、TUI 與 SQLite；保留 Tier C dormant。
Layer B 多 agent assembler 是後續獨立工作，不能當作目前 gateway 已完成能力。
MITM、cloud sync、9router.db 相容與媒體 API 排除在外。

## 驗收條件

本表的 passed 依各列列出的來源、隔離 fixture 或歷史實測範圍判定，不等於真實帳戶／全部客戶端驗收。
2026-10-26 已重跑當前完整本機套件；historical 仍是既有紀錄，pending／failed 保留實際缺口。
全部17項原始條件保留；[本輪對帳、剩餘入口及既有用量依賴](docs/tasks/T-0426-mainline-acceptance.md) 不以任務板 done 數量代替產品完成。

| AC ID | Given／When／Then | 狀態 | 證據或缺口 |
| --- | --- | --- | --- |
| AC-01 | Given 設定好的 subscription route，When 執行 provider smoke，Then grok/opencode/agy 可回覆。 | historical | [2026-07-28 P0 紀錄](docs/GOALS_AND_PROGRESS.md) 列 smoke OK（當時也含已移除的 codex）；沒有本次重跑。 |
| AC-02 | Given provider adapter 來源，When 核對 refresh／forwarding，Then 可定位 OAuth refresh、agy 與 Cursor CLI。 | passed | [main.rs](src/main.rs)、[oauth_refresh](src/oauth_refresh.rs)、[cursor_cli](src/cursor_cli.rs)；不採用舊上表「未開始」結論。 |
| AC-03 | Given 無有效 gateway key 或外部 listener 設定，When admission，Then 預設拒絕且 bootstrap 僅限零keys loopback。 | passed | 2026-10-26 當前完整本機套件通過；`cost_auth` 4/4、`admin_security` 5/5、bootstrap unit 2/2。覆蓋無效／停用 key、零總keys明確loopback、轉發與不安全listener；[逐條證據及原始啟動失敗](docs/tasks/T-0426-mainline-acceptance.md)。限隔離 fake upstream，不宣稱所有 transport／proxy。 |
| AC-04 | Given Claude/Cursor 與支援的客戶端工具串流，When 完整訂閱旅程，Then 工具呼叫及錯誤／取消符合契約。 | pending | Claude 工具經 MCP 橋接（AC-11–AC-14，未用真實帳號驗證）；Cursor（AC-17）僅文字。此列工具承諾與 AC-17 text-only 的範圍差異、具名 client/version 矩陣尚待明確決定，不能默默刪除承諾。 |
| AC-05 | Given 任何 listener 或經 Tailscale Serve／tunnel 轉發，When 存取 admin、改 connection base_url 或 keyless bootstrap，Then 一律要 admin token（session＋CSRF、Host／Origin 檢查），轉發請求視為遠端不得 bootstrap，OAuth token 只送官方網域，secrets 一律 AES-GCM 加密（Argon2id 或 0600 key file）並遷移舊資料。 | passed | [security](docs/security.md)；`tests/admin_security.rs`、`src/guard.rs`、`store::secret_storage_tests`；2026-10-22 本機 `cargo +1.99.0 test --locked` 全綠（只用本機假上游）。 |
| AC-06 | Given Responses 上游（siwc，強制串流），When 用 `/v1/chat/completions`、`/v1/messages`、`/v1/responses` 送純文字、工具呼叫、多輪 tool 往返與圖片（串流與非串流），Then 各端點收到自己的協定格式（chat chunk＋`[DONE]`、Anthropic 事件含 tool_use、原生 Responses），call_id 對得上且圖片保留。 | passed | `tests/responses_e2e.rs`（本機腳本化 SSE 假上游）、`responses`／`claude` 單元測試；2026-10-23 本機全綠。 |
| AC-07 | Given 同一段對話的多輪 siwc 請求，When 經任一端點送出，Then 帶穩定的 `prompt_cache_key` 與同值 `session-id`／`thread-id`（用戶端自帶的 key 優先），且不帶任何 Codex 客戶端偽裝標頭。 | passed | `src/prompt_cache.rs` 單元測試、`tests/responses_e2e.rs` 標頭與 key 斷言；2026-10-23 本機全綠。快取命中率需真實帳號驗證，未執行。 |
| AC-08 | Given `thinrouter login-siwc` 取得的官方 Sign in with ChatGPT 憑證，When 經三個端點呼叫 `siwc` provider，Then 打 `api.openai.com/v1/responses` 並強制 `store:false`、`stream:true`，剔除不支援欄位、system→developer、function tools 包進 namespace，`previous_response_id` 與託管工具回 400，額度用盡回 429；refresh 依 issued client_id 輪換並序列化。 | pending | 本機已驗：`siwc` 單元測試（含假 auth server 的完整登入與 refresh）、`tests/responses_e2e.rs::siwc_provider_applies_preview_limits`、`oauth_refresh` 測試。未以真實帳號登入或呼叫；namespace 工具格式未經真實上游確認。 |
| AC-09 | Given 舊版留下的 `codex` 連線，When 開啟資料庫，Then 連線被停用、token 清除，`codex` provider 不再存在；OpenAI 模型只走 `siwc`。 | passed | `store::secret_storage_tests::codex_rows_are_retired`、`providers` 單元測試；2026-10-23 本機全綠。 |
| AC-10 | Given `claude` provider，When 三個端點送純文字或圖片（串流與非串流），Then 由本機 `claude -p`（magpie 參數、清理後環境）回答，呼叫方 system 只放在 `<external_system_instructions>`、不替換 Claude Code 的 system prompt，thinrouter 不持有或傳送 Claude token；thinking 不回傳，額度用盡 429、未登入 401；工具見 AC-11。 | passed | `tests/claude_code_e2e.rs`（假 `claude` 腳本記錄參數、環境與 stdin）、`claude_code` 單元測試；2026-10-22 本機全綠。未用真實帳號。 |
| AC-11 | Given `claude` provider 與客戶端工具，When 三個端點送帶 tools 的請求與工具結果，Then 工具經 MCP helper 以 `mcp__thinrouter__<name>` 提供（只 allow 這些、不跳過權限），tool_use 換回原名轉給客戶端並立即結束 run，帶結果的下一輪以完整對話開新 run，id 對得上。 | passed | `tests/claude_code_e2e.rs::client_tools_are_bridged_through_mcp`、`mcp_helper_speaks_stdio_json_rpc`、`claude_mcp` 單元測試；2026-10-22 本機全綠。此列原文的立即結束／新run為早期設計；目前續輪生命週期依後來 AC-12–AC-14，保留原文供追溯。未用真實 Claude Code 驗證。 |
| AC-12 | Given `claude` provider 的工具呼叫，When 客戶端下一個請求正好帶回這些 tool id 的結果，Then 結果經 MCP helper 回呼（run token 只在 0600 檔與標頭）交給同一個 Claude Code 進程繼續回答，不重送對話；對不上、逾時或名額被讓出時改開新 run。 | passed | `tests/claude_live_e2e.rs`（Python 假 Claude Code 真的啟動 helper 並呼叫 `tools/call`：同進程續答、串流、逾時、讓出名額、回呼需 token）；2026-10-23 本機全綠。未用真實 Claude Code 驗證。 |
| AC-13 | Given `claude` provider 回答完一輪（`end_turn`），When 下一個請求只在同一段對話（相同 model／system／工具、歷史一致）後面多了使用者訊息，Then 寫進同一個閒置的 Claude Code 進程；歷史被改、設定不同或逾時則開新進程，新進程的歷史以 20 則一塊、最後完整區塊加 1h cache 標記。 | passed | `tests/claude_live_e2e.rs::next_user_turn_goes_on_in_the_idle_run`、`idle_runs_expire`，`claude_code` 單元測試（cache 區塊、turn 渲染）；2026-10-23 本機全綠。未用真實 Claude Code 量測 cache 命中。 |
| AC-14 | Given 閒置的 Claude Code run 被結束（逾時、讓出名額或 gateway 關閉），When 同一段對話的下一輪到來（含 gateway 重啟後），Then 以 `--resume <session>` 開進程、只送新訊息；資料庫只存 hash 不存對話；session 不在或載入失敗時改整段重送；過期與遺留的 session 檔會被清除。 | passed | `tests/claude_live_e2e.rs::ended_idle_run_resumes_from_its_saved_session`、`saved_sessions_survive_a_restart`（SIGTERM 重啟、啟動清理）、`unresumable_session_falls_back_to_the_whole_conversation`，`store::secret_storage_tests::claude_shelf_matches_conversation_prefixes`；2026-10-23 本機全綠。未用真實 Claude Code 驗證 session 路徑與 `--resume` 行為。 |
| AC-15 | Given chat 格式上游或 Claude Code，When 客戶端以 `/v1/responses` 串流且回覆含文字與工具呼叫，Then 收到完整的 Responses 事件序列（`response.created`、message 與 `function_call` 的 `output_item.added`／delta／`.done`、帶 output 與 usage 的 `response.completed`，`sequence_number` 遞增，不送 `[DONE]`）；`length` 結束為 `response.incomplete`，錯誤為 `response.failed`。 | passed | `responses::tests::chat_stream_to_responses_*`、`tests/chat_upstream_responses_e2e.rs`、`claude_live_e2e::responses_stream_from_claude_code_carries_the_tool_call`；2026-10-23 本機全綠。 |
| AC-16 | Given `import-local` 匯入的 grok 連線（借用 `~/.grok/auth.json`；xAI refresh token 會輪換），When 呼叫上游、檔案被 Grok CLI 更新或 token 過期，Then 每次重讀檔案、從不自行 refresh 或寫檔，401 時重讀一次後回明確提示；舊資料的 grok refresh token 在開庫時清除。agy（Google，不輪換）照常 refresh。 | passed | `tests/responses_e2e.rs::borrowed_grok_login_is_reread_and_never_refreshed`、`borrowed` 單元測試；2026-10-23 本機全綠。 |
| AC-17 | Given `cursor` provider，When 三個端點送純文字（串流與非串流），Then 僅在 operator 加 `--cursor-accept-account-plugins` 時（否則 503，不啟動 CLI）且提供固定 Docker image／專用 profile volume，由容器內官方 `cursor-agent -p --output-format stream-json --stream-partial-output` 回答，傳入 `--mode ask`、`--sandbox disabled`、臨時工作目錄（這些 CLI 旗標本身不是安全邊界），不加 `--force`／`--approve-mcps`；只採用串流 delta（略過重複 flush），呼叫方 system 放在 `<external_system_instructions>`；thinrouter 不持有 Cursor token、不再使用私有協定；帶 tools 或圖片回 501，未登入回 401。 | passed | `tests/cursor_cli_e2e.rs`（Python 假 `cursor-agent` 照官方 output-format 文件輸出）、`cursor_cli` 單元測試；2026-10-23 本機全綠。2026-10-23 owner 以真實 `cursor-agent` 2026.10.16 跑 `-p --output-format stream-json --stream-partial-output --mode ask --sandbox enabled --trust --workspace /tmp "say hi"`：參數均被接受、delta／flush 判斷與實作一致，另有文件未載的 `thinking` 事件（忽略）與 result 上的 usage（已對應）；假程式依此輸出更新。同日探測：ask 模式下 agent 仍可用帳號的 Cursor plugin（Gmail 等）且 CLI 無法停用，故改為 opt-in；workspace MCP 需 `--approve-mcps` 才載入。後於2026-10-24 corrected-runner 單次非串流 Chat 端到端 HTTP200／5.897s，owned container 清理成功（下方歷史紀錄）；不擴為全部 API／stream／tools/images 驗收。 |

## T-0432 — 本輪一般 Chat 串流結算

目標、設計與固定 SS-1–SS-6 見 [任務](docs/tasks/T-0432-stream-settlement.md)。本輪僅 generic API-key HTTP Chat 串流，先 fake upstream RED，再完成送出前登記、一次結算、終態／usage／時間及管理面一致性；其他協定、CLI、OAuth 與完整 [#698](https://github.com/fallrising/newclear/issues/698) 留待後續。本機279Rusttests/22groups、fmt/Clippy、20Python回歸、九階段離線旅程及repository validators已通過；獨立審查、CI／合併與整輪交接為後續交付gate；不改原17項 AC、mainline incomplete 或 usable_tag none。

## 本次里程碑：T-0377 Cursor 外部隔離

Owner 決定保留 Cursor。目標／範圍／固定 AC 與驗證計畫見 [隔離規格](docs/cursor-isolation.md)，進度見 [任務板](docs/tasks/BOARD.md)。原 ask＋sandbox 的主機隔離假設已被實測否定；AC-17 的假 CLI 協定測試不能當成隔離 PASS。2026-10-23 第二輪修正 PR #566 的 CLI enum lint 與 Docker workspace 權限，CI-1–CI-5 本機驗證已通過；[命令、歷史失敗及限制](docs/tasks/T-0377-handoff.md)。獨立審查與必要 CI 通過，PR #566 已於2026-10-23T18:01:20Z合併，回讀無差異；官方 CLI 映像的無網路 version/help 啟動亦通過。真帳號、完整推論與網路／plugin 隔離不在本次 PASS 範圍內。

## 已授權的真實 Cursor 文字驗收

2026-10-23 owner另行授權專用容器profile登入及一次簡短文字請求；[範圍、限制及結果](docs/cursor-live-smoke.md)。對應AC-17的單次真實文字旅程，不擴大為全協定／工具／圖片或token生命週期驗收。官方登入成功，但唯一一次非串流ChatCompletions請求回HTTP502；容器清理通過，真實文字旅程未通過。根因尚未確定，不重送已消耗的單次額度。

## 現況與缺口

舊進度表的 auto refresh／executor「未開始」已被同檔後半部與實際 source 超越。
已知四個 provider 有歷史 smoke；不能降格成全部 mock，也不能擴為全 provider 完成。
Cursor 改由官方 `cursor-agent` CLI 回答（ask 模式不保證唯讀／主機隔離），目前僅文字；tools 與圖片仍是後續能力。
完整個人多工具客戶端、深層工具串流與 token lifecycle 驗收未齊。
成本 admission 有邊界；disabled keys 不會取消已送出的 provider 請求。

任何provider smoke都須註明模型、協定與憑證時效，不能當永久相容保證。

## 啟動與驗證

依 [README](README.md) 在本目錄 `cargo run -- serve`；loopback 預設埠20128。
資料預設 `~/.thinrouter/thinrouter.db`；由 admin 建 connection、route與gateway key。
[Cargo.toml](Cargo.toml) 和 [main.rs](src/main.rs) 是 binary與serve/doctor/tui入口。
離線回歸可用 `cargo test --locked`；真 subscription smoke需要另外核准的有效憑證。
本次沒有 import-local、refresh 或發出 provider 請求。

管理面與憑證安全規則見 [security](docs/security.md)；admin token 預設在資料目錄的 `admin-token`。
AC-05 只以本機假上游驗證；未對真實 provider 發出請求，未讀取本機 CLI 憑證。
未執行的產品驗收不會因本文件通過格式檢查而轉為通過。

## 可用版本

目前 `usable_tag: none`。
須補限定客戶端／provider／協定矩陣的真實核心旅程及當前安全回歸。
不得將四個歷史 smoke 擴大成所有個人訂閱皆可用；dormant狀態維持。

任何未來可用標記都須對應已合併的目標 SHA、必要 CI／審查與核心流程證據。
較早證據須先比對其後程式與設定差異；有關變更補驗後才能沿用。

## 2026-10-24 diagnostic follow-up

Owner authorized one further attempt. Preserve sandbox enforcement and Docker restrictions. When the CLI reports its known sandbox-unavailable startup error, return503 with a fixed operator message and log a fixed reason code; never emit arbitrary stderr or disable sandbox automatically. Verify red→green integration coverage, existing privacy/status regressions and native gates. RED→GREEN regression,99tests,clippy,fmt and independent review passed. The authorized retry still failed with sandbox-unavailable diagnostics; this improvement cannot establish live inference success.

## 2026-10-24 outer-container compatibility

Goal: remove the nested CLI sandbox startup conflict while retaining the existing Docker boundary. Scope/decision and unchanged CI-1–CI-5: [isolation decision](docs/cursor-isolation.md#2026-10-24-container-compatibility-decision). AC-17 now expects `--sandbox disabled` inside mandatory Docker; no host fallback, outer permission widening or model retry. Plan: focused RED→GREEN argument regression, full Rust tests/clippy/fmt, real Docker fake-CLI canary and independent review. User-reported direct CLI success remains separate from gateway live acceptance. Results: focused regression failed against the old argument, then99tests/clippy/fmt/document checks and credential-free real Docker canary passed. Independent review and required CI remain merge gates.

## Corrected-runner live acceptance

2026-10-24 owner continuation permits the pending AC-17 single text journey using the corrected runner and retained profile. Verify exact expected marker, one request container and cleanup; no automatic retry or new login. Full protocol/tool/image/lifecycle acceptance remains outside this single request. See [live result](docs/cursor-live-smoke.md).

Corrected-runner result: the newly authorized one-request ChatCompletions journey passedHTTP200,expected marker,5.897seconds,one container and0remaining. See source/binary/probe evidence in the live record. This supersedes the latest text-failure status without rewriting either historical502; mainline remains incomplete.

## T-0385 — Cursor terminal failure handling

Goal: enforce the existing AC-04/AC-17 error contract without changing supported capabilities. A terminal Cursor result is successful only when `subtype: success`, `is_error: false` and a string `result` are present, matching the [official output contract](https://cursor.com/docs/cli/reference/output-format). Unknown fields remain compatible. Error-shaped/malformed result events are defensive fixtures, not claimed observations of the official CLI.

- CE-1: Given a non-success or malformed terminal result, when translated before output, then all three APIs return a fixed redacted upstream error; no result payload is emitted as assistant text.
- CE-2: Given partial text followed by a failed result or EOF without a result, then non-stream requests fail and streams emit their protocol's failure event without a success finish (`message_stop`, Chat `finish_reason: stop`, or `response.completed`). Chat may still send its transport `[DONE]` after the error.
- CE-3: Given a documented successful result, then existing text/usage/deduplication behavior remains; normal cleanup and isolation arguments remain unchanged.

Plan: focused RED→GREEN gateway regression, unit malformed-result cases, full Rust tests/fmt/clippy, document gates, independent review and required CI. Only local fake CLI/runtime; no live provider request, login, new dependency, permissions change or release. This slice does not accept the full mainline or Cursor tools/images. Progress/evidence: [task record](docs/tasks/T-0385-cursor-errors.md).

T-0385 local outcome: CE-1–CE-3 regression evidence passed (103tests, fmt/clippy, document gates and credential-free Docker canary). Original RED and the corrected Responses-test assertion are preserved in the task record. Independent review passed; required remote CI/merge/readback are publication gates, tracked by the linked task/desk record.

## T-0386 — Converted stream completion

Goal: enforce existing AC-04/AC-06/AC-15 error semantics when an upstream stream ends before completion. Scope: four converters and the Responses→Chat→Messages / Messages→Chat→Responses chains. EOF alone is not proof of successful text or tool generation. Existing Chat `finish_reason` followed by EOF remains accepted even without `[DONE]`; explicit Chat `[DONE]` remains a terminal marker. Responses requires `response.completed`/`response.incomplete` (or error), and Messages requires `message_stop` (or error).

- SC-1: Given an empty or partial text/tool stream without completion, when converted at EOF, then emit a fixed protocol error, no synthetic success finish or completed tool arguments. Responses `[DONE]` without its typed terminal is treated as premature end.
- SC-2: Given valid completion, length limit or explicit error, when EOF follows, then preserve the original outcome/usage and emit no duplicate terminal. Preserve Chat finish_reason-only compatibility.
- SC-3: Given local HTTP Chat upstream and actual gateway Messages/Responses clients, when text/tool/empty truncation or valid finish-only occurs, then results match SC-1/SC-2. Full Rust/fmt/clippy, document gates, independent review and required CI must pass.

Native protocol passthrough, buffered HTTP collection, transport-error/stall behavior, retry/accounting, credentials, new tools/images support and release/deploy are outside this bounded slice. No real provider calls. Evidence/progress: [T-0386 task](docs/tasks/T-0386-stream-completion.md).

T-0386 local result: SC-1–SC-3 passed (107Rust tests,14HTTP journeys, fmt/clippy,42contracts/index). Independent review passed; historical RED and old EOF-success assertion failure retained in the task record. Required remoteCI/merge/readback remain separate publication gates.

## T-0389 — Buffered Responses completion

Goal: enforce completion evidence while collecting forced-stream Responses for non-stream Chat Completions, Messages and Responses requests. The collector must no longer default an unfinished response to completed.

- BR-1: Given an empty/partial/item-only transcript, bareDONE or malformed/conflicting terminal, when collecting a single response, then return502 and expose neither partial output nor raw upstream errors as a successful answer.
- BR-2: Given `error` or `response.failed`, then fail with a fixed redacted message; preserve429 and only recognized subscription-sharing quota codes. The first terminal event is final: failure cannot be rescued by a later success, and later events do not mutate an accepted success.
- BR-3: Given `response.completed` or `response.incomplete` with matching response status, then preserve output items/text, model, usage and incomplete details/length mapping across all three buffered APIs. Nonempty terminal output is authoritative; only empty/missing final output falls back to intermediate items/text. Existing tool reconstruction remains compatible.

Plan: RED→GREEN localHTTP regression, collector edge cases, fullRust/fmt/clippy/project/index gates, independent review, requiredCI and normalmerge/readback. Native streaming passthrough, directJSON responses, generalSSEframing, retry/timeout/accounting, realproviders/login and release/deploy are excluded. No runtime dependencies or permissions change. Evidence: [T-0389 task](docs/tasks/T-0389-buffered-responses.md).

T-0389 local result: BR-1–BR-3 passed with113Rust tests,45localHTTPjourneys, fmt/clippy and42project/index gates; independent review passed after the terminal-output precedence fix. Prior RED failures retained. Required remoteCI/merge/readback tracked by the task/desk record.

## T-0401 — Native Responses completion

Scope: HTTP `/v1/responses` streaming from a Responses upstream. This completes the native path following T-0389; other passthrough APIs and conversion/collection paths retain their contracts.

- NR-1: Given empty, partial text/tool output, bare `[DONE]`, malformed terminal or an unterminated frame, when native upstream ends without a valid terminal, then emit one fixed `error` SSE event (HTTP headers may already be 200), never synthetic success. Discard incomplete or invalid terminal frames. Transport errors/stalls retain existing body-error behavior.
- NR-2: Given complete `response.completed` / `response.incomplete` / `response.failed` with a response object and matching status, or `error` with a string message, then preserve accepted frames byte-for-byte including output, usage and unknown fields; the first terminal closes this HTTP stream. Completed/incomplete may not contain non-null response.error. An explicit SSE event name must match a terminal JSON type. This is terminal validation, not full schema validation; omitted sequence numbers remain compatible.
- NR-3: Given arbitrary byte boundaries, UTF-8, LF/CRLF/CR line endings, comments and multiline data, then recognize complete SSE events only. One pending event is limited to 16 MiB (including framing); excess produces a fixed error and releases upstream. Generated errors use the next observed sequence number (start 0); supplied sequence numbers must be nonnegative integers below i64::MAX so a successor can be represented. No unbounded pending-event allocation.

Official event shapes: [OpenAI streaming events](https://developers.openai.com/api/reference/resources/responses/streaming-events), checked 2026-10-24. Scope excludes WebSocket successor responses. Validation plan: focused RED/GREEN, byte-fragment and boundary tests, local HTTP native journeys, existing converted/buffered regressions, full Rust/fmt/clippy/docs/index, independent review and CI. Evidence recorded below; no real provider calls or usable-version claim.

Local NR-1–NR-3 evidence: [task and commands](docs/tasks/T-0401-native-responses.md), 122 tests including 11 new native HTTP cases, fmt/clippy and 42 project contracts/index pass. Independent review PASS after R1 correction; remote CI/publication pending.

CR lookahead: retain a pending CR until the next byte or EOF to preserve split CRLF. If the existing idle deadline arrives with a complete valid CR-only terminal, emit that original frame and close rather than returning a stall error. CR-only terminal delivery may therefore wait up to the configured stall window (minimum five seconds); other stalls retain the existing body error. Reviewer R1 reproduced the lost terminal with an upstream that stays pending, then the same body/drop regression passed after this fix.

## T-0380 FE round2: approved M1–M4

Scope and machine verification plan: [T021](fe-review/tasks/round2/T021.md), based on the unchanged approved [DESIGN](fe-review/DESIGN.md). First measure isolated true admin UI/loopback synthetic upstream and read-only TUI; correct only measured presentation defects and obsolete keyless copy. Native offline Rust gates, bounded browser/terminal evidence, independent review and current CI remain required. No real provider/login/CLI credentials, backend/auth changes, full Round3, usable tag or mainline acceptance. Status: original Round2 M1–M4 delivered in [PR603](https://github.com/fallrising/newclear/pull/603) after R31 ACCEPT, both CI checks and normal merge/readback; scoped board item done. [Report](fe-review/tasks/round2/report.md) and [machine result](fe-review/tasks/round2/result.json): native127tests/focused5renderer subset; current18affected Web views plus6source-qualified shared views,14real journeys,12source-qualified TUI captures;13contrast-incomplete sets retained with520computed pairs including one separately corrected desktop observation. Original shared404/login timing/TUI/table regression histories remain explicit. This does not complete gateway mainline, fullRound3, usable tag or owner acceptance.

## T-1102 — LLM 用量正確性修正文件先行

本輪只交付開發／修正規格與兩條獨立文件 PR 中的本條；固定核對來源為 `6b444b00457591996db135e4ec6ab65b1d01ad4c`。
文件整合基準為 `4fc5d9a7b49139115518379bf05e1cfec4fe1bce`；保留其新增交付紀錄，相關計量核心與固定分析來源一致。
規格路徑：[修正規格](../../docs/specs/llm-usage-correctness.md)；進度沿用 [任務板](docs/tasks/BOARD.md)。
保留既有 mainline、usable_tag 與所有未驗 runtime AC；文件通過不代表功能實作或缺陷修復。

| 文件 AC | Given／When／Then | 狀態 | 驗證計畫／證據 |
| --- | --- | --- | --- |
| UC-D01 | Given 本次固定來源與 owner 範圍，When 完成文件審查，Then 以固定來源分類已確認缺陷、待重現問題與實機驗收缺口。 | passed | 文件內容與本地檢查通過；獨立文件審查 ACCEPT，詳見本節紀錄。 |
| UC-D02 | Given 本次固定來源與 owner 範圍，When 完成文件審查，Then 定義串流計量、缺值彙總與相關修正的重現及驗收矩陣。 | passed | 文件內容與本地檢查通過；獨立文件審查 ACCEPT，詳見本節紀錄。 |
| UC-D03 | Given 本次固定來源與 owner 範圍，When 完成文件審查，Then 定義修正順序、相容性、獨立審查與後續交接。 | passed | 文件內容與本地檢查通過；獨立文件審查 ACCEPT，詳見本節紀錄。 |

文件驗證紀錄（2026-10-24；僅文件範圍）：

- `python3 scripts/check_indexes.py`：PASS，42 個 project success contracts／navigation/index；5 個 llms.txt、0 errors。
- 四個變更 Markdown 的本地連結與 code-fence 檢查、`git diff --check`、`git diff --cached --check`：PASS。
- 獨立 agent 文件審查 `usage_verify`：ACCEPT；最終回讀確認固定來源、既有 terminal 契約、UC-R01–08、隱私／有界 observer 及未決資料語意一致。
- 已審規格 SHA256：`ff8fbdb4b298f12da379740e4b7a237a173e01e821835455c547fb16655357b1`。
- 本地未重跑產品 runtime suites，未執行本規格的 RED／GREEN 或 live 驗收；最終 commit、Draft PR、head CI 與遠端回讀由該 PR 描述及 Checks 保存。

## T-0403 — Direct JSON Responses

Scope: non-stream Responses JSON read by the three client APIs, including non-force-stream provider profiles. No changes to forced SSE collection, streaming, accounting or request retry.

- JR-1: Given HTTP-success upstream JSON with failed/cancelled, a non-null error, malformed JSON/object/status/output, unknown/missing status or unexpected pending status, then do not return successful Chat/Messages/Responses output. Return a fixed 502 diagnostic, retaining only recognized subscription usage-limit codes as429 for failed/error-only envelopes. Contradictory success+error is502 even if the error carries a quota code. No arbitrary upstream text or JSON parser detail in generated errors.
- JR-2: Given completed/incomplete with array output and absent/null error, preserve the original native bytes and existing Chat/Messages text/tool/usage/finish conversion. This validates the envelope, not the full nested Responses schema.
- JR-3: Given a native Responses request with literal background:true and an upstream queued/in_progress response with background:true and array output, preserve its original JSON. Chat/Messages and native synchronous requests cannot represent this pending result as completed output and return502. No polling, cancellation endpoint or provider background support is added or claimed.

Background status semantics checked against [OpenAI background mode](https://developers.openai.com/api/docs/guides/background), 2026-10-24. Validation: RED/GREEN HTTP matrix via loopback fake Grok-profile upstream (synthetic stored token, no local credential file), full Rust/fmt/clippy/docs/index, independent review and CI. Local evidence: [task](docs/tasks/T-0403-json-responses.md),130 tests including74new direct JSON HTTP cases, fmt/clippy and43project contracts/index pass. Independent source review PASS; publication follows in the task board. Original whole-product and real-provider gaps remain.

## T-0404 — Client disconnect

Scope: active client requests and their owned HTTP/CLI resources; completed Claude idle/tool sessions retain the existing reuse and expiry policy.

- DC-1: Given a Claude active turn (fresh or resumed via user/tool result), when its client request disappears while the CLI is silent, then observe closure without waiting for another CLI output, stop/reap the process and release its concurrency slot. Cover streamed partial output and collection before downstream headers; a replacement request succeeds with a one-run limit.
- DC-2: Given a normally completed Claude reply/tool call, when that HTTP request ends, then keep the existing idle/waiting run and reuse it for matching follow-up. Monitoring must track the current request sink, including a new sink installed while the reader waits between turns.
- DC-3: Given local HTTP streaming/collection or a fake Cursor runtime, when the downstream request is cancelled, then observe upstream body/process release and (Cursor) container reconciliation/slot reuse within a bounded test deadline. Tests use signals/markers and live loopback connections, not real credentials or model calls.

Validation: reproduce the silent Claude leak RED, fix the underlying receiver-close notification, focused release tests and existing session/reuse regressions, full Rust/fmt/clippy/docs/index, independent review and necessary CI. Fake runtime evidence does not establish actual Docker/provider cancellation; no change to those runtime policies or complete product readiness claim.

Local DC-1–DC-3 evidence: [task and commands](docs/tasks/T-0404-disconnect.md),134tests on Linux including44new disconnect scenarios;fmt/clippy and43project contracts/index pass. Independent review PASS; publication recorded in the board after merge.

## T-0405 — SSE stall

Scope: six translated SSE paths plus native Responses, using the existing per-byte-chunk idle timeout with a five-second minimum. Opaque Chat/Messages passthrough retains transport-error behavior; non-stream collectors, header waits and total execution deadlines are excluded.

- ST-1: Given an empty, partially emitted or unfinished SSE response without a known terminal, when the idle deadline expires, then translated/native Responses streams emit a fixed protocol error instead of breaking the HTTP body or synthesizing successful completion. Drop any unfinished input record; never include buffered upstream fragments in the generated diagnostic.
- ST-2: Given a stalled source, release its owned stream before yielding the final failure frame (or passthrough transport error), even if the consumer does not poll again. Keep the existing minimum timeout and reset on each received byte chunk; heartbeat bytes remain activity, not a total deadline.
- ST-3: Given an already parsed finish/terminal, preserve its existing success/incomplete/failure meaning at idle expiry without a second timeout failure. Preserve native Responses CR-only terminal lookahead behavior. Observe translated/native behavior and source release through loopback HTTP as well as deterministic adapter tests.

Validation: RED/GREEN with controlled virtual time and drop witnesses; loopback HTTP read and upstream lifecycle evidence; existing full Rust/fmt/clippy/docs/index checks, independent review and required CI. No provider/Docker acceptance or whole-product completion claim. Evidence: [task](docs/tasks/T-0405-sse-stall.md).

Local ST-1–ST-3 evidence:138tests/12groups pass, including77new scenarios;fmt/clippy,43project contracts and6llms navigation files pass. Original RED and initial test-fixture expectation failure retained; terminal semantics preserved. Independent review/publication follow in the task and board.

## T-0407 — SSE read errors

Scope: shared SSE body read-I/O failures across six conversion paths, native Responses and opaque passthrough. No change to idle/header/total deadlines, collectors, general framing, accounting or retries.

- IO-1: Given no known terminal and an upstream read error, translated/native Responses streams emit a fixed protocol diagnostic instead of breaking the HTTP body or inventing successful completion. Do not render the source error or copy unfinished buffered records into that diagnostic.
- IO-2: Given a read error, drop both the owned upstream stream and error before yielding final output, even if the consumer does not poll again. Opaque passthrough retains transport failure with a fixed redacted message; already forwarded opaque bytes remain unchanged.
- IO-3: Given an already parsed terminal, preserve its success/incomplete/failure semantics without replacing it with a read error. Preserve a fully delimited native CR-only terminal awaiting lookahead; an unfinished terminal fragment must not become success. Validate protocol wiring through actual loopback HTTP body failure and preserve existing EOF/stall/disconnect coverage.

Verification: RED/GREEN adapter tests with error-format/source/error-drop witnesses, text/tool terminal matrix, CR boundary cases and loopback broken HTTP streams; full native tests/fmt/clippy/docs/index, independent source review and required CI. No live-provider/Docker acceptance or whole-product completion claim. [Task](docs/tasks/T-0407-sse-io.md).

Local IO-1–IO-3 evidence:143tests/13groups including96new scenarios pass;fmt/clippy,43project contracts and6llms navigation files pass. Original RED retained. Source review and publication follow in the task/board; whole-product/provider acceptance remains separate.

## T-0408 — Terminal release

Scope: ownership at recognized translated/native Responses terminals and observed EOF. Keep opaque passthrough byte behavior, existing framing, timeout/error/collector policy and reusable Claude sessions.

- TR-1: Given a converter or native Responses guard emits a final success/incomplete/failure, release the upstream before yielding its final frame and stop reading subsequent bytes. Cover intact/fragmented input and a source which remains open; receiving a final frame must not require one more consumer poll to release ownership.
- TR-2: Given EOF is observed while the source object still owns resources, release it before yielding EOF-generated final output (including existing incomplete-stream errors and buffered final records). Do not change EOF classification or native CR-only lookahead behavior.
- TR-3: Given only Chat finish_reason, continue accepting the usage tail before [DONE]/EOF, and retain existing terminal mappings and idle/tool session reuse. Opaque streams retain their existing byte/EOF behavior. Verify early close through loopback HTTP with a permanently open source, without real providers.

Validation: RED/GREEN with source-drop witnesses and an explicit stream retaining its resource after returning None; fragmented/terminal/EOF and usage-tail tests; real loopback HTTP; existing native/session/disconnect/error/stall regressions; full Rust/fmt/clippy/docs/index, independent review and required CI. [Task](docs/tasks/T-0408-terminal-release.md). No whole-product/provider/Docker acceptance claim.

Local TR-1–TR-3 evidence:148tests/14groups including85new scenarios pass;fmt/clippy,43contracts/6llms indexes pass. Original RED retained; existing Claude session/disconnect and CR/error/stall regressions pass. Independent review/publication follow in task/board; whole-product/provider acceptance remains separate.

## T-0410 — Converted input bound

Scope: the shared line buffer for six translated SSE paths. Limit each input line to16MiB (16×1024×1024 bytes, including its data/field prefix and optional CR, excluding LF). Apply the limit to ignored/comment lines too. This is a retained input-line bound, not a cap on total response, converter state/tool arguments, output aggregation, allocator overhead or transport-owned chunks. Native Responses keeps its existing event bound; opaque passthrough keeps raw bytes.

- IB-1: Given a line that exceeds16MiB, whether unterminated, LF-terminated or fragmented across chunks, fail before copying bytes beyond the limit. Emit the fixed protocol diagnostic `upstream stream line exceeds 16 MiB`, never the offending input, and release the upstream and retained line before final failure output. A prior Chat finish_reason alone cannot rescue over-limit input; no success terminal may follow.
- IB-2: Given an exact-limit or smaller line, preserve existing conversion including UTF-8 splits, LF/CRLF, buffered EOF finalization and usage tails. Process each line separately: a chunk with multiple bounded lines may exceed16MiB in total. Stop at the first recognized terminal; trailing oversized bytes must not replace its result with a size error.
- IB-3: Through real loopback HTTP, oversized converted inputs produce protocol errors and close still-open sources without waiting for EOF/idle timeout. Preserve native Responses and opaque behavior and existing terminal/error/session/disconnect regressions. No real provider/Docker acceptance claim.

Validation: focused RED/GREEN source-drop test, exact-boundary and fragmentation matrices, actual HTTP fixtures, full Rust/fmt/clippy/contracts/index, independent review and required CI. General SSE framing (including multiline-data/CR-only normalization), total budgets, retries/accounting, collectors, sessions and deadlines remain out of scope. [Task](docs/tasks/T-0410-input-bound.md).

Local IB-1–IB-3 evidence:154tests/15groups pass, with125newscenario iterations across six tests. Exact-boundary, oversized data/comments, fragmented input, source-release, first-terminal, UTF-8/CRLF and10loopbackHTTP cases pass;fmt/clippy and43contracts/6llms indexes pass. Original RED retained. Independent review and required publication gates follow in the task/board; total response/tool-state bounds remain separate.

## T-0411 — Retained converter state

Scope: variable-size state retained between events in ChatToResponses, ResponsesToChat and AnthropicToChat, including their chained routes. Each converter has a16MiB cumulative payload allowance and4096collection entries. Count decoded text/arguments and map/set key strings byUTF-8 bytes; retained tool call_id/name JSON values by serialized size. Each output item and each new map/set key consumes a separate entry. Existing keys consume no new entry; moving charged text/arguments into output does not charge twice; clearing/replacement does not refund previously consumed budget. Fixed-count response/model/finish metadata remains bounded separately by the existing16MiB input line guard. These logical budgets are not allocator capacity, total RSS, total wire traffic or one-frame output-allocation limits.

- RS-1: Before accumulating text/arguments or retained tool metadata/output entries, reject any operation exceeding either allowance. Exact-limit state remains valid; interleaved tools/text, closing and moving state preserve existing output, usage and finish mappings. The offending record must not emit its violating delta or synthesize successful done events. Clear retained payload/collections in the failing converter and emit the fixed diagnostic `upstream converter state limit exceeded`.
- RS-2: Bound Responses item-id/output-index maps and argument-dedup ids, including aliases reached by output-index fallback, and Anthropic tool-index maps. Duplicate known keys consume no additional entry or key bytes. A streaming-only converter does not gain a cumulative text/argument traffic cap. Native Responses and opaque paths remain unchanged.
- RS-3: A failed converter ends its response and releases the source before final failure output. A chain whose final stage fails must terminate without waiting for its first stage to finish. Preserve existing terminal precedence, EOF/stall/read-error, line limits, normal usage tails and session/disconnect behavior. Validate with state-boundary tests, source-drop adapter witnesses and actual loopback HTTP sources that stay open.

Validation: focused RED/GREEN, exact/over byte and entry boundaries, metadata/alias/duplicate/empty-tool cases, chain failure and compatibility matrices, loopback HTTP, full Rust/fmt/clippy/docs/index, independent review and required CI. No collector/general framing/deadline/session/accounting/retry change, new runtime dependency/permission, realprovider/Docker/login, release or whole-product acceptance. [Task](docs/tasks/T-0411-state-bound.md).

Local RS-1–RS-3 evidence:165tests/16groups pass,including43newscenario iterations across11tests. Default payload/entry limits and chain ownership, exact reduced-budget boundaries, aliases/metadata/move semantics, streaming-only compatibility and4loopbackHTTP cases pass. OriginalRED retained;fmt/clippy,43contracts/6llms indexes pass. Independent review and required publication gates follow in task/board.


## T-0412 — Bounded response collection

Scope: successful HTTP bodies collected for non-stream Chat/Messages/Responses (JSON or forced SSE), and the shared Claude/Cursor non-stream record collector. HTTP counts actual received bytes before copying, with a16MiB maximum regardless of Content-Length. CLI counts UTF-8 record bytes plus two separator bytes per record, including the first and empty records, with16MiB and65536record maxima. Exact limits are accepted.

- BC-1: Given an HTTP successful body exceeding16MiB, including trailing bytes after a typed terminal in a forced-SSE body, return fixed502 `upstream response collection limit exceeded`, discard partial collection and release the owned source before returning. Whole-body collection remains whole-body; no early-terminal optimization.
- BC-2: Given Claude/Cursor records exceeding either limit, reject before retaining the offending record, return the same fixed502 and close the receiver before returning. Active producer cancellation follows existing policy; completed idle/tool sessions retain their reuse policy. Count the first record, UTF-8 bytes and empty records.
- BC-3: Preserve exact-limit and smaller JSON/SSE text/tool/usage behavior, client cancellation, body read errors and explicit CLI failures. Verify source release with deterministic witnesses, all three client APIs through loopback HTTP, and active fakeCLI process reaping/slot reuse.

Validation: RED/GREEN boundary tests, actual HTTP and fakeCLI checks, full Rust/fmt/clippy/contracts/index, independent review and required CI. Excludes non-success diagnostic/refresh bodies, producer stdout/queues, parsing/output expansion, allocator/RSS, framing/completion policy, deadlines/retries/accounting, dependencies/permissions and live-provider/Docker/release acceptance. [Task](docs/tasks/T-0412-collect-bound.md).

Local BC-1–BC-3 evidence:172tests/17groups,54newscenario iterations across7tests pass;fmt/clippy and43contracts/6llms indexes pass. Original RED retained; exact/over bounds, UTF-8/entry counts, cancellation/readerror/CLI failure,27HTTP and3active fakeCLI reaping/slot reuse cases pass. Independent review/publication follow in task and board. No total-RSS or real-provider/Docker acceptance claim.


## T-0413 — Bounded HTTP diagnostics

Scope: non-200 forwarding diagnostics (all three client APIs, streamed or collected, generic/borrowed401/importedOAuth401), non-success xAI/Google refresh responses and SIWC token-endpoint responses. Limit actual received raw input to64KiB (65536bytes), checking before copying without using Content-Length. Exact-limit bodies are accepted at EOF. Successful token parsing and other HTTP request families are excluded.

- DG-1: Given oversized diagnostic input, return fixed `upstream error body exceeds 64 KiB` in place of its entire body, without retained prefix/tail or parser detail. Drop the source/partial input before returning, even if the source remains open. Preserve smaller/exact UTF-8-lossy diagnostics and existing empty-body read-error fallback. This is a raw retained-input limit; decoded UTF-8/JSON output may expand.
- DG-2: Given any forwarding error, preserve its original status/retryability, cooldown/fallback and borrowed/imported401 refresh eligibility/one-retry rules. Oversize diagnostics must not suppress allowed recovery or turn a non-retryable400 into retryable502. During diagnostic reads, client cancellation returns existing499/non-retryable cancellation classification without initiating refresh/fallback. Observe normal and overflow outcomes through loopbackHTTP.
- DG-3: Given non-success token-endpoint responses, apply the same bound before xAI/Google error-text decoding or SIWC error-code JSON parsing. Preserve existing401/prefixes, SIWC status/error-code selection, malformed/read-failure fallback and successful token response behavior. Validate without real credentials or endpoint calls.

Validation: failing oversized-open-source HTTP regression, boundary/source-drop/read-error/cancellation cases, recovery and token-error fixtures, full Rust/fmt/clippy/contracts/index, bounded independent review and requiredCI. Excludes successful token JSON bounds, totalRSS/transport/parsedoutput, auth semantics/locks, new deadlines/retry budgets, dependencies/permissions/login/live-provider/Docker/release. [Task](docs/tasks/T-0413-diagnostic-bound.md).

Local DG-1–DG-3 evidence:177tests/18groups,285newscenario iterations across5tests;fmt/clippy and43contracts/6llms indexes PASS. Original RED, corrected fixture-path failure and corrected test-assertion lint failure retained.246gatewayHTTP,14SIWC loopback and deterministic bounds/cancel/read-failure/refresh-helper cases pass. Independent review/publication follow in task/board; successful-token parsing and totalRSS remain separate.


## T-0414 — Bounded successful token responses

Scope: successful xAI and Google refresh responses, and the shared SIWC token endpoint used by refresh and authorization-code exchange. Collect at most1MiB (1048576 actual raw bytes), independent of Content-Length, before JSON parsing. This is a local defensive envelope, not a provider maximum: these responses contain credential strings and small metadata rather than model output; SIWC additionally retains ID token/scope.1MiB deliberately leaves room for large credentials/extensions without allowing the16MiB model-response budget. No measured provider-size distribution is available;64KiB diagnostic truncation policy does not determine this limit.

- TK-1: Given successful token input, when actual bytes exceed1MiB, reject before copying beyond the limit with fixed `token response body exceeds 1 MiB`, discard partial bytes and release the source before returning even without EOF. Exact-limit input is accepted only at EOF; count whitespace, ignored JSON fields and split UTF-8 bytes. Dropping a pending collection future releases its source; no new cancellation/deadline policy is introduced.
- TK-2: Given smaller/exact valid token JSON, preserve xAI/Google token fields/expiry and SIWC Value-to-TokenResponse semantics, including absent optional fields. Malformed/invalid UTF-8/read failures remain errors with existing provider context/classification; no partial JSON is parsed. Oversize diagnostics contain no response/request prefix. Non-success64KiB behavior remains unchanged. Observe successful and oversized still-open bodies through loopback HTTP and deterministic source-drop tests.
- TK-3: Given refresh fails collection or parsing, no token update occurs. Complete successful parsing remains before the existing single database token update under the connection lock; optional refresh-token preservation, stale-caller reread, ensure_fresh fallback and401 recovery rules remain unchanged. Successful SIWC code exchange uses the same bound without changing scope/ID-token checks. Validate synthetic token rotation/preservation and existing auth regressions, with no real endpoint/login/model calls.

Validation: focused pre-fix HTTP RED, boundary/fragmentation/error/drop tests, local endpoint and token-update tests, full locked Rust suite, fmt/clippy, contracts/index, independent review and required CI. Bound is retained raw input only, not RSS, transport chunks, parsed JSON allocations or downstream token decoding. No dependencies/permissions/provider/login/release/deploy or other milestone. [Task](docs/tasks/T-0414-token-bound.md).

Local TK-1–TK-3 evidence:183tests/18groups and48newscenario iterations across6tests PASS;fmt/clippy,43contracts/6navigation indexes PASS. OriginalRED and corrected setup/compile/read-fixture failures retained. SIWC14HTTP cases; xAI/Google16shared-parser Response cases; unchanged no-write-before-parse control flow inspected, with direct store/stale-caller regressions. See task for exact evidence limits and remote token-rotation caveat. Independent review/publication follow in task/board.


## T-0415 — Bounded CLI stdout records

Scope: Claude Code and Cursor stdout JSON-line readers, before JSON parsing or protocol conversion. Each raw line has a16MiB limit (16777216 bytes), including JSON framing and optional CR, excluding LF. This independent per-line budget matches the existing upstream SSE input-line scale and leaves room for CLI result envelopes; it is not inferred from provider maxima or the1MiB token envelope. Apply it even to ignored/malformed JSON lines. Limits on queues, total stdout, filter state, stderr and downstream collectors remain separate.

- LB-1: Given any stdout line exceeding16MiB, including fragmented or never-terminated lines, reject before retaining bytes beyond the allowance. Never parse or expose its partial content. Active requests fail with fixed502 `CLI stdout record exceeds 16 MiB`; after partial streamed output emit the client's protocol failure without success completion. Ignore stderr status hints for this known overflow.
- LB-2: Given bounded lines, preserve LF/CRLF handling, final unterminated lines at EOF, split UTF-8 and multiple lines per read. Exact-size lines await LF/EOF without being rejected. Cancelling a next-line future while retaining the reader must not lose already consumed partial bytes; this is required by Claude sink-change notifications. Dropping the reader releases its source and buffered data. Existing I/O/invalid-UTF8 termination behavior remains.
- LB-3: Given overflow, release stdout and partial line, stop/reap the affected child, reconcile the Cursor container through existing policy and release its run slot. Reject the active request without leaving it pending, and permit a replacement with a one-run limit. Healthy Claude idle/tool sessions keep existing reuse semantics; an overflowed run is removed rather than preserved as a resumable healthy idle session. Existing terminal precedence is unchanged: Cursor stops at its accepted result; Claude continues reading its reusable process, so later overflow ends that process without retracting a completed turn.

Validation: failing fake-CLI HTTP regression, deterministic boundary/fragmentation/EOF/UTF-8/cancel/drop tests, all3client APIs stream/nonstream before/after partial output and exact-limit compatibility, Linux PID reaping and fake-container reconciliation, existing session/terminal/disconnect suite; full locked Rust/fmt/clippy/contracts/index, independent review and requiredCI. No realprovider/login/Docker smoke, dependencies/permissions, retry/session redesign,release/deploy or whole-product acceptance. [Task](docs/tasks/T-0415-cli-line-bound.md).

Local LB-1–LB-3 evidence:189tests/18groups;75newscenario iterations/6tests;fmt/clippy,43contracts/6navigation indexes PASS. Original4second no-newline RED retained.36reader cases and39fakeCLI/runtime HTTP/lifecycle cases cover exact/over/cancel/drop/reuse/cleanup;no realDocker/provider orRSS claim. Independent review and publication follow in task/board.


## T-0416 — Concurrent Claude stderr drain

Scope: Claude Code process stderr only. Start draining before the first stdin write and continue through active, idle and waiting-tool turns. Retain only the first4096 raw bytes, discarding subsequent bytes as they arrive. This preserves the existing diagnostic prefix policy; it is not a total output, parsed allocation or RSS limit. Cursor already drains concurrently and is unchanged.

- SD-1: Given a fake Claude process writing more than pipe capacity before reading stdin or before stdout events, when a request is sent, then stderr cannot block input or a normal reply. Preserve all three client APIs, streaming/non-streaming, idle follow-up and tool-result reuse. Stderr never enters successful model output.
- SD-2: Given exit without a reply, when diagnostics are selected, then preserve the existing trim/last300characters of the first4096rawbytes and status classification for valid UTF-8. Decode malformed/truncated UTF-8 lossily within that prefix; never retain or expose bytes after4096. Waiting for stderr EOF is bounded by the existing2second window; an inherited open pipe cannot prevent cleanup. Partial-output, explicit result-error and stdout-overflow precedence remain unchanged.
- SD-3: Given stdin failure, request cancellation, run stop/expiry or process completion, then the owned drain is aborted/joined on explicit cleanup and aborts on owner drop. Release its pipe even if another writer keeps it open. Preserve child reaping, run-slot reuse and healthy session semantics. Use deterministic reader-drop witnesses and fakeCLI process/HTTP checks; no real provider, Docker or credential calls.

Validation: reproduce pipe saturation RED, focused prefix/UTF-8/EOF/cancellation/drop tests and fakeCLI large-stderr HTTP/lifecycle cases, full locked Rust suite, fmt/clippy, contract/index checks, independent review and required CI. No new deadlines, retry/session redesign, total-flow throttling, dependencies/permissions, live-provider/login/Docker/release/deploy or whole-product acceptance. [Task](docs/tasks/T-0416-claude-stderr.md).

Local SD-1–SD-3 evidence:196tests/18groups,27newscenario iterations/7tests;fmt/clippy,43contracts/6navigation indexes PASS. Original4second stderr/stdin deadlock RED retained;13unit scenarios establish raw-prefix bounds/lossyUTF8/open-source/cancellation/drop behavior,14fakeCLI HTTP/lifecycle cases establish API/startup/reuse/error/cleanup wiring. Independent review and publication follow in task/board;no liveprovider/Docker orRSS claim.


## T-0417 — Bounded Claude event state

Scope: the Claude EventFilter's state within one message, independent of the existing stdout line and downstream converter/collector bounds. Use a16MiB cumulative logical payload allowance and4096 content_block_start events per message. This follows the existing model-state scale, not measured provider maxima. Count UTF-8 bytes for retained reply-text deltas, raw partial-JSON argument fragments, two copies of each accepted client-tool id (tools and tool_ids), the retained bridged tool name, and each stop_reason assignment. Every block start counts, including ignored types and repeated indexes. Retained payload replacements/removal/moves do not refund charges; moving arguments into parsed/completed tools is not charged twice. Request-supplied name mappings, cross-message run/session state, output queues, JSON allocation expansion and total RSS are excluded.

- CF-1: Given events that would exceed either allowance, reject before mutating retained state or emitting that event's output. Clear filter-owned text/tools/ids/maps/stop metadata, keep failure sticky until explicit reset, and report fixed502 `Claude event state limit exceeded` through the active request. Do not emit the violating delta or a successful terminal. Charge only payload actually retained by the existing filter; ignored thinking text and unmatched argument deltas do not become a new total-traffic limit.
- CF-2: Given smaller/exact charged state, preserve text/tool forwarding, renumbering, ignored blocks, argument parsing, tool id/name mapping, usage/finish behavior and valid message completion. Reset budget only with the existing healthy message reset, preserving the request's name map. Duplicate/replaced block indexes still consume starts; fragmented UTF-8 strings are charged by decoded byte length. Validate exact/over payload and block counts, metadata, interleaved tools, moves and reset.
- CF-3: Given a filter failure in a fresh or reused active run, drop stdout/filter payload, stop/reap the child and its stderr drain, remove the abnormal session rather than shelving it, and release the slot before failure delivery. A completed reply cannot be retracted; later overflow ends its reusable process. Healthy idle/tool reuse, cancellation and explicit-result/line-overflow behavior remain compatible. Validate all three client APIs using fake CLI/loopback HTTP and Linux process witnesses.

Validation: focused pre-fix RED, unit boundary/compatibility matrices, actual HTTP with a still-open fakeCLI source before/after partial output, exact compatibility and reuse/cleanup cases;full locked Rust/fmt/clippy/contracts/index, bounded independent review and requiredCI. No queue/session total bound, general protocol validation, new deadline/retry/provider capability, dependencies/permissions, realprovider/login/Docker, release/deploy or whole-product acceptance. [Task](docs/tasks/T-0417-claude-state.md).

Local CF-1–CF-3 evidence:203tests/18groups,48newscenario iterations/7tests;fmt/clippy,43contracts/6navigation indexes PASS. Original over-limit forwarded-delta RED retained.24unit cases cover charged payload/start boundaries,metadata,moves/reset/ignored data;24fakeCLI HTTP/lifecycle cases cover all APIs,active/reused/completed failure,PIDreaping andslot reuse. Independent review/publication follow in task/board.


## T-0418 — Claude startup directory cleanup

Scope: ownership of each newly created Claude MCP run directory from setup through background reader cleanup. Use an owned directory guard installed immediately after exclusive directory creation and transferred to the reader. Remove only that owned directory on setup/spawn/initial-input failure or dropped startup future. Do not adopt or delete an existing path. Cleanup remains best effort under filesystem errors, matching the existing runtime policy.

- SC-1: Given a tool request whose setup, process spawn or initial stdin write fails, remove its newly created run directory, including partial tool/config/callback files. Preserve existing status/retry/fallback behavior, parent and sibling paths, and release the slot. A request with no tools creates no run directory.
- SC-2: Given a startup future dropped while a fake child keeps stdin open without reading, remove the owned directory; retain existing child kill-on-drop and stderr-drain ownership. Verify fake process reaping and one-slot replacement. This does not add a stdin timeout or change explicit cancellation-token semantics.
- SC-3: Given healthy tool activity and continuation, retain MCP files while the run owns them, preserve same-process tool reply and idle reuse, and remove the directory at the existing cleanup point after process/stderr stop. Do not change session shelving/deletion or scan historical run directories.

Validation: focused spawn-failure RED, owned-directory collision/partial-setup tests, direct startup-future drop plus fakeCLI HTTP initial-write failure and healthy tool continuation/expiry with direct filesystem assertions and Linux PID witnesses; full locked Rust/fmt/clippy/contracts/index, independent review and required CI. No new dependency/permission, live provider/model/login/Docker, release/deploy or whole-product acceptance. [Task](docs/tasks/T-0418-claude-startup.md).

Local SC-1–SC-3 evidence: 208tests/18groups,10newscenario iterations/5tests;fmt/clippy,43contracts/6indexes PASS. Original RED and initial test-method failures retained. Direct startup-future drop is verified; HTTP client abort did not establish server-future drop and is not claimed fixed. Partial setup coverage is guard/write_private unit injection. See task for scope and publication gates.


T-0418 SC-3 blocker continuation (owner requested deeper tracing): add opt-in debug lifecycle metadata correlated by a nonsecret run number;never log callback auth tokens, session identifiers, request/tool bodies or tool-result text. Trace callback admission/matching/wait/reply, tool-result routing, message completion and run cleanup. Preserve existing client20s/idle2s/cleanup3s regression thresholds. Reproduce and fix the causal continuation-state defect with deterministic regression;an already completed tool phase must not accept a late result into a sink with no future producer. Preserve valid same-process tool/idle continuation, cancellation, limits, fallback and owned-directory cleanup. No independent protocol expansion. Record exact failure/cause and minimum fix in the task before changing product semantics.

SC-3 blocker repair local evidence:214tests/18groups,6newtests/9controlledscenarios,fmt/Clippy/contracts/indexPASS. Callback-before-stdout deterministicRED producednot-registered→unsolicitedend_turn→staleidlecontinuation→20sHTTPtimeout;identicalorderGREEN aftersingledeadlineannouncementwait andatomicturn/sinkhandoff. Completedphasesretirestalewaitingstate;late toolresultsuseexistingfallback. Opt-in `thinrouter::claude_lifecycle` debugmetadata excludesauth/session/body/toolcontent. OriginalCIschedulewasunobserved;controlledreproductionandearlierfailedlogsretained. See task forproofandpublicationgates.


## T-0419 — Claude startup input cancellation

Scope: explicit request cancellation before admission and while writing the initial input to a newly spawned Claude process. Reuse the existing cancellation token, fixed499 `client disconnected` result and non-retryable semantics. Cancellation interrupts a partial write by terminating that new process; never replay the remaining bytes. Use existing SIGTERM grace/kill/reap and stderr-drain cleanup before returning, then owned-directory and slot release. No new timeout.

- IC-1: Given a token already cancelled before start or slot admission, return fixed499/non-retryable without spawning, consuming a waiting tool result, changing an idle run, or evicting a waiting run for capacity. Recheck cancellation at the initial write so cancellation during setup is observed.
- IC-2: Given a fake child that keeps stdin open without reading and an input larger than its pipe capacity, when the request token is cancelled, stop/reap the owned child, stop its stderr drain, remove its owned MCP directory and release its slot before returning fixed499/non-retryable. Cover tools/no-tools, stderr pressure, and a child that ignores SIGTERM using the existing five-second grace. Preserve sibling paths and allow a healthy replacement.
- IC-3: Given no cancellation or an ordinary input error, preserve healthy startup/tool continuation and existing input-error status/retry behavior. Keep direct startup-future drop coverage and all prior lifecycle regressions.

Validation: deterministic blocked-write token-cancel RED→GREEN against the production start path with actual fake processes and Linux procfs; pre-cancel admission/state tests; full locked Rust/fmt/Clippy/contracts/index, independent review and required CI. This does not establish that an HTTP client disconnect cancels its server handler, nor change resumed-idle stdin writes, process groups, session policies, provider behavior, permissions/dependencies, release/deploy or whole-product acceptance. [Task](docs/tasks/T-0419-claude-input-cancel.md).

Local IC-1–IC-3 evidence:218tests/18groups,4newtests/7scenarios,fmt/Clippy,43contracts/six indexes PASS. Explicit blocked-input cancellation RED7.04s; focused fixed tests5.34s including the existing five-second forced-stop grace. Original RED and two fixture corrections retained. See task for coverage limits, independent review and publication gates.


## T-0420 — Claude resumed input cancellation

Scope: the explicit request token while acquiring stdin or writing the next user turn to an existing idle Claude process. Cancelled partial writes must retire that run rather than replaying the conversation in a replacement process. Preserve existing SIGTERM grace/kill, stderr drain, directory ownership and session cleanup; no new runtime deadline.

- RI-1: Given a healthy completed first turn and a matching next user turn whose stdin lock or write is blocked, when that next request token is cancelled, stop the selected run and return fixed499 `client disconnected`, non-retryable, only after its child/drain/owned-directory/slot cleanup completes. Do not enter saved-session or full-conversation fallback for that cancelled request. Cancellation must not remain stuck behind the stdin lock.
- RI-2: Given the resumed-input future is dropped while its write is blocked, the selected active run is retired and resources become reusable through existing cleanup. A run with a partially written cancelled turn must not be offered as idle or shelved as healthy. Validate owned tool-directory/sibling state and one-slot replacement; include a SIGTERM-resistant child using the existing five-second grace.
- RI-3: Given an uncancelled matching continuation, preserve same-process text/tool/session behavior. Given an ordinary resumed-input write error, retain existing whole-conversation fallback rather than treating it as caller cancellation. Preserve pre-cancel admission and initial-input cancellation from T-0419.

Validation: deterministic production start/resume tests with actual fake CLI processes (completed first turn, blocked second write), explicit token and future-drop cases, stdin-lock wait cancellation, no-fallback start count and healthy replacement; full locked Rust/fmt/Clippy/contracts/index, independent review and requiredCI. HTTP client-disconnect detection, general first-record/output waiting cancellation, tool-result protocol redesign, new timeout/dependency/permission, real provider/model/login/Docker, release/deploy and whole-product acceptance are outside scope. [Task](docs/tasks/T-0420-claude-resume-cancel.md).

Local RI-1–RI-3 evidence:222tests/18groups,4newtests/8scenarios,fmt/Clippy,43contracts/six indexes PASS. RED7.10s confirmed ignored resumed-input cancellation; focused fixed cases10.39s include the existing SIGTERM grace. Tests cover mutex/write cancellation, future drop, isolated session/shelf cleanup, no cancelled-request fallback, healthy continuation and ordinary missing-input fallback. See task for validation limits and publication gates.


## T-0421 — Claude first reply cancellation

Scope: explicit current-request cancellation after input admission while waiting for the first Claude reply record, across fresh startup, saved-session startup, idle user continuation and tool-result continuation. Use the existing termination grace and cleanup-completion signal; no new runtime timeout. Cancellation is a caller outcome, not an upstream failure to retry or replay.

- FR-1: Given an admitted request and a fake process that has accepted input/tool result but keeps stdout open without replying, when the current request token is cancelled, retire the selected run and return fixed499 `client disconnected`, non-retryable, only after child/stderr/owned-directory/slot cleanup. Cover fresh/saved startup, idle and tool continuation. Do not fall back or launch/replay a cancelled conversation. A previous completed request's token must not own the next request.
- FR-2: Given the request future is dropped before its first reply, retire the selected run and release resources through existing cleanup. Interrupted work must not become a healthy idle/shelved session. Verify PID, isolated session/shelf, owned-directory/sibling and slot witnesses; include SIGTERM resistance with existing five-second grace. Preserve healthy completed-turn reuse.
- FR-3: Given no cancellation, preserve first-record delivery, startup/continuation errors and existing retry/fallback classifications. Preserve all prior input-cancellation and reuse regressions. A cancellation ready together with a first record takes precedence while this wait owns the request; once the first record is returned, downstream behavior remains unchanged.

Validation: deterministic production start paths with actual fake processes and explicit input/continuation-admission markers, intended RED before fix, focused cancellation/drop/compatibility matrix and complete locked Rust/fmt/Clippy/contracts/index gates, independent source/ledger reviews and requiredCI. Ordinary missing-input and saved-session failure fallback stay compatible. This does not establish HTTP client-disconnect propagation, add cancellation after first-record handoff, change Cursor or tool-result protocols, alter global concurrent-request/session policies, add deadlines/dependencies/permissions or call live provider/model/login/Docker. No release/deploy or whole-product acceptance. [Task](docs/tasks/T-0421-claude-first-cancel.md).

Local FR-1–FR-3 evidence:226tests/18groups,4newtests/18primaryscenarios,31Claude-focusedtests,fmt/Clippy,43contracts/six indexes PASS. Original cancellation→retryable502 RED0.08s retained; fixed cases return499 aftercleanup without fallback/replay, including saved/idle/tool paths and drop. Test-only Debug compile error corrected and retained. See task for exact process/state-fixture boundaries and publication gates.


## T-0422 — Claude active output cancellation

Scope: explicit current-request cancellation after the first reply record while that Claude turn is still active. The pre-fix first-reply handoff released its guard; ClaudeRun collect/into_stream waited only on the receiver. Extend request ownership through active output, without attaching a completed request's token to a reusable process. HTTP client-disconnect propagation is a separate unestablished boundary; server handlers create CancelOnDrop and disarm it at streaming response handoff, while receiver drop is the existing reader cancellation signal.

- OC-1: Given a fake Claude process that has emitted a first reply record but keeps the current turn incomplete, when its current token is cancelled during buffered collection or streaming consumption, terminate the selected run using existing cleanup. Buffered collection returns fixed499 `client disconnected`, never partial success, and is non-retryable in cli_attempt. Streaming emits the existing fixed error form after cleanup and no successful terminal. No fallback, second process or conversation replay. Cover fresh/saved startup, idle and tool-result continuation with explicit admission/first-record witnesses.
- OC-2: Given cancellation of active output, release the child, stderr drain, owned MCP directory and run slot before reporting the cancellation. Do not retain the interrupted session as idle or shelved. Preserve siblings and allow a healthy one-slot replacement; include the existing five-second SIGTERM grace. Dropped consumers retain existing receiver-close cleanup. A current cancellation ready alongside active queued output wins; cleanup completion must remain latched.
- OC-3: Given a turn already completed and detached from its sink, later cancellation or dropping of that old response must not terminate its healthy idle/tool process or a later request. Preserve queued complete responses, ordinary failures, same-process continuation and all prior cancellation regressions. Define completion at the existing finish_turn detachment boundary; serialize cancellation ownership with that boundary rather than inferring it from a global idle flag.

Design: carry request-scoped cancellation ownership from first_reply into the active response path, with an identity/completion boundary that cannot target a later sink. Use the existing run stop and cleaned latch, retain the shared Cursor first_record behavior, and release receiver ownership before awaiting cleanup to avoid backpressure deadlock. Do not keep a sender alive solely in a consumer guard. Cancellation is observed while collect or stream consumption is polled, including a pending receive; a retained response that is never polled has no new autonomous cancellation watcher. No new runtime timeout or protocol/session redesign.

Validation: pre-fix deterministic RED; focused actual-process collect/stream matrix, completed-turn/old-token race controls, cleanup/drop/slot witnesses and existing protocol conversion regressions; full `cargo +1.99.0 test --locked`, fmt, Clippy, project contracts/indexes, independent source/ledger review and required CI. No real model/provider/login/Docker, new dependency/permission, release/deploy or whole-product acceptance. [Task](docs/tasks/T-0422-claude-output-cancel.md).

Local OC-1–OC-3 evidence:232tests/18groups,6newtests/19primaryscenarios (16actual-process/3state),37Claude-focusedtests,fmt/Clippy,43contracts/six indexes PASS. Original active-collection timeout and completed-terminal-drop retryable502 REDs retained, along with a corrected test-only E0382 compilation error. Explicit active-output cancellation now waits for cleanup and cannot target a later sink; completed old-response drop preserves continuation. See task for scope limits and publication gates.


## T-0423 — HTTP startup disconnect

Scope: establish the real HTTP/1 loopback cancellation boundary while Claude's initial stdin write is blocked. T-0418's aborted reqwest future did not establish server-future drop; T-0419–0422 prove explicit token and consumer paths, not this transport case. The current server uses axum::serve, request-scoped CancelOnDrop and streaming guard disarm; startup owns Child kill-on-drop, stderr drain, run directory and slot before handing off to its reader. These source facts are not a claimed current defect.

- HD-1: Given an admitted complete HTTP/1 request whose initial Claude input exceeds pipe capacity and a fake process that signals readiness without reading stdin or producing stdout, when the client actually closes its owned connection, then the selected process is reaped and its owned tool directory removed within the existing normal three-second observation bound, preserving siblings. A healthy replacement succeeds with one run slot and no replay of the cancelled request. Cover Chat/Messages/Responses, stream/nonstream and tools/no-tools at proportionate matrix scope. Establish connection closure explicitly rather than equating aborting a client task with a socket close.
- HD-2: Given the same fixture before the connection closes, demonstrate that the original input remains incomplete; compare deliberate connection closure with the historical client-future-abort method and report the observed boundary. Use a gated healthy-read control to prove admission and distinguish unread stdin from first-reply waiting. Preserve raw baseline failures or baseline PASS. If behavior already meets HD-1, add durable regression coverage without an artificial RED or production fix. If it fails, retain the intended RED and repair only the source-supported bounded cause; never change the acceptance threshold to turn failure green.
- HD-3: Given a healthy large input or completed reply followed by another turn, preserve successful output and existing same-process reuse. Keep first-reply/active-output cancellation, stream/collect conversion and prior cleanup regressions green. Evidence must distinguish TCP/HTTP handling, handler/guard cancellation and externally observed resource cleanup; do not claim direct token observation from PID disappearance alone.

Design/verification: use isolated fake Claude processes and existing real gateway fixture with loopback transport, explicit child/input markers and bounded socket operations. Use existing drop/stop ownership and no new runtime timeout/dependency/permission. Root reviews any proposed production change after the baseline and causal hypothesis; general HTTP server/session redesign is excluded. Required gates: focused baseline and regression checks, full locked Rust 1.99.0 tests, fmt/Clippy, contracts/indexes, independent source/ledger review, necessary CI and normal merge/readback. No real model/provider/login/Docker, HTTP/2 or proxy-wide guarantee, autonomous unpolled-response watcher, release/deploy or whole-product acceptance. [Task](docs/tasks/T-0423-http-disconnect.md).

Causal design update: actual HTTP close already drops startup ownership; the reproduced failure is a terminated child remaining a zombie because pre-reader `kill_on_drop` has no prompt reaping guarantee. Add an abandonment owner that kills and explicitly awaits only that startup child until successful handoff. Existing explicit cancellation/error cleanup and the HTTP server remain unchanged. The original three-second acceptance threshold remains fixed; runtime teardown retains best-effort fallback.

Local HD-1–HD-3 evidence: 236 tests / 18 groups, four new tests / 20 primary scenarios, 37 existing Claude-focused tests, fmt/Clippy, 20 validator tests, 43 project contracts and six indexes passed. Baseline and transport comparisons retained their original reap-timeout failures; the state diagnostic isolated a zombie after startup drop. Test-only E0061 and an initial unused-mut warning were corrected and retained. See the task for exact commands, transport/cleanup distinctions, runtime limits and remaining publication gates.


## T-0424 — Claude reply backpressure

Scope: an existing run-stop signal while the Claude reader is blocked sending to its bounded reply channel. Source inspection found stop is selected while reading stdout, but not during record or failure delivery; finish_turn detaches a completed sink before publishing reuse and delivering its final record. A retained completed response can therefore overlap a new request. This is a testable candidate, not evidence that every retained response or runtime boundary is defective.

- BP-1: Given an actual fake Claude process whose completed old response has filled its reply channel and retains its receiver, when a new matching user/tool continuation is admitted then explicitly cancelled or its first-reply future is dropped, retire that selected run without requiring the old response to be polled or dropped. Explicit cancellation returns fixed499 client disconnected, non-retryable, after cleanup, with no fallback/replay. Prove the old sink is detached, the new sink is installed and the old terminal remains backpressured before cancellation.
- BP-2: Given an active record/failure delivery blocked on a full reply channel, or a detached completed terminal blocked on its old channel, when an existing run-stop owner requests termination, release process, stderr drain, owned tool directory and slot within the existing normal three-second observation bound (seven seconds for a SIGTERM-resistant child with the existing five-second grace). Preserve sibling files and interrupted-session removal; ordinary completed idle termination may retain its existing healthy shelf behavior. Include reachable shutdown and idle expiry/eviction paths at proportionate scope, plus a healthy one-slot replacement. Do not require the retained receiver to be consumed as a cleanup precondition.
- BP-3: Given no run stop, preserve complete queued record/failure delivery and healthy same-process continuation. A completed old response's late request-token cancellation or drop must not stop a newer request. Preserve earlier explicit active-consumer, first-reply, input-cancellation and HTTP startup-disconnect regressions. If baseline passes, publish meaningful regression coverage without artificial RED or unnecessary production change.

Design: retain current sink identity/completion and stop/cleaned ownership. If the fixed baseline demonstrates a defect, make only pre-cleanup reply sends observe the run stop that already governs the reader; a stop during detached old-terminal delivery retires the run, while receiver closure alone still respects the completed-turn boundary. Post-cleanup limit-failure delivery must remain observable even though cleanup has cancelled run.stop. No new channel size, timeout, autonomous request-token watcher, runtime dependency or permission.

Verification: isolated actual fake processes with explicit queue/admission/resource witnesses, RED before any behavior fix, focused compatibility tests, full locked Rust1.99.0 tests/fmt/Clippy, project contracts/indexes, independent source and ledger review, required CI, normal merge and remote readback. This is not HTTP2/proxy-wide cancellation, server graceful-shutdown admission policy or runtime-teardown proof. Retained unpolled active-response tokens retain their documented boundary. No real provider/model/login/Docker, release/deploy or whole-product acceptance. [Task](docs/tasks/T-0424-reply-backpressure.md).

Local BP-1–BP-3 evidence: 241 Rust tests / 18 groups, five new tests / 12 primary scenarios, 42 Claude-focused tests, fmt/Clippy, 20 validator tests, 44 project contracts and seven indexes passed. Original retained-terminal cancellation timeout and setup/fixture failures preserved without relaxed bounds. See task for actual source baseline, independent review/publication gates and unchanged runtime/transport/timer limitations.

## T-0425 — Claude idle expiry

Scope: the existing idle deadline for a completed Claude user/tool phase, including a detached terminal blocked on its retained bounded reply receiver. AC-13/AC-14 reuse and shelf policy remain authoritative. T-0424 stop-aware delivery is already delivered.

- IE-1: Given an actual isolated fake Claude process whose completed user/tool terminal is detached and backpressured on a retained full reply receiver, when the configured idle duration elapses from phase completion with no new continuation, then the existing stop owner releases process, stderr drain, owned tool directory and slot within the normal three-second observation bound without consuming/dropping that receiver. Include a SIGTERM-resistant completed case within seven seconds using the unchanged five-second grace. Preserve sibling files, healthy user shelving and unshelved tool cleanup; admit a healthy one-slot replacement.
- IE-2: Given a completed phase with its idle deadline scheduled, when a matching user/tool continuation acquires that run before expiry, then that old deadline cannot terminate the active continuation, including while the old terminal remains backpressured. A later completed phase receives its own full configured idle duration. Timer expiry and new-sink installation must have a coherent ownership boundary so an old timer cannot stop a newly admitted phase.
- IE-3: Given ordinary completed queue delivery and healthy same-process reuse, preserve complete records, late old-response cancellation/drop protection and existing active/input/first-reply/HTTP-startup regressions. If baseline is already correct, deliver meaningful regression coverage and accurate boundaries without artificial RED or unnecessary product changes.

Design: trace finish_turn, waiting_since, live registry, reader-owned child/receiver/slot and expire_later before changes. Schedule existing idle ownership at completed-phase publication if a fixed baseline proves late scheduling; avoid tying the deadline to delivery of the old terminal. Preserve cancellation/reuse atomicity with the existing locks and phase state. Do not introduce a new timeout policy, channel size, active request-token watcher, dependency, permission or sensitive diagnostic fields.

Verification: fixed baseline before any behavior fix, isolated fake processes with explicit full-queue/detachment/continuation/resource witnesses, focused compatibility tests, full locked Rust1.99.0 tests/fmt/Clippy, validators/contracts/indexes, independent source and ledger review, required CI, normal merge/readback and ledger/backup closure. Actual evidence is Linux fake-process scope, not HTTP2/all-proxy, runtime-teardown or real-provider proof. Server graceful shutdown and retained unpolled active tokens retain their existing boundaries. [Task](docs/tasks/T-0425-idle-expiry.md).

IE-1–IE-3 local evidence:4newtests/8primarycases plus1healthyreplacement, all46Claude tests and full245Rusttests/18groups passed; fmt/Clippy,20validator tests,44contracts/7indexes passed. Original3.09sRED and missing-reactor test-harness failure retained; firstGREEN0.19s. Source/command details and scope limits are in the task document. Independent review, required CI and normal merge/readback are separate gates.

## T-0426 — Mainline acceptance convergence

Scope: reconcile current core acceptance evidence and make the remaining closure work explicit. Preserve existing AC-01–AC-17 requirements, implemented provider limits, prior delivered lifecycle work, mainline: incomplete and usable_tag: none. This is an offline evidence/documentation milestone; it does not authorize live provider/login/Docker/release actions or implement separately tracked milestones.

- MC-1: Given the unchanged AC-03 admission/bootstrap contract and current source, when the named local fake-upstream integration and unit tests run against the recorded baseline, then each requirement has observable evidence for denied credentials/disabled keys, exact-loopback opt-in/zero-total-keys, forwarded requests and unsafe listener startup. Update AC-03 status only to the extent this evidence supports. Baseline PASS is valid; do not manufacture RED or change production unnecessarily.
- MC-2: Given all17 core criteria, existing task records and separately referenced dependencies, when publishing a convergence record, then retain stable IDs, distinguish offline/local evidence, historical real observations, unsupported capabilities and unexecuted live acceptance, and give remaining work exact entry inputs, closure evidence and stop conditions. Do not equate done technical rows with product acceptance, omit existing usage-correctness dependencies, or silently narrow AC-04/AC-17 promises. Candidate timer/shutdown boundaries become required repairs only after a reproducible failure maps to a fixed criterion; unresolved scope decisions remain explicit.
- MC-3: Given the final evidence-only diff, when complete locked Rust1.99.0 tests/fmt/Clippy, project validators/indexes, independent content/evidence and ledger reviews, required CI and normal merge/readback pass, then publish the current evidence, remaining gates and one next action without claiming whole-product acceptance. Preserve original failures, exact commands/source provenance, nullable full usage and owner-controlled desk status; backup before own worktree cleanup.

Verification plan: source/test mapping plus focused AC-03 baseline, full native gates, scoped documentation diff review and all publication/ledger checks. No real credentials/provider/model, login, Docker, new dependencies/permissions, release/deploy, unrelated products or changes to another milestone's tracked plan. [Convergence record](docs/tasks/T-0426-mainline-acceptance.md).

## T-0427 — D-06 error persistence

Scope: implement only the thinrouter error-persistence slice of [T-1102](../../docs/specs/llm-usage-correctness.md) §4.2 / M-15 / UC-R05. Original T-1102 specification and AC-01–AC-17 remain unchanged. D-01–D-05, terminal accounting, historical-row cleanup and real-provider acceptance remain separate work.

- EP-1: Given isolated fake HTTP upstreams with synthetic sensitive markers in arbitrary JSON/plain-text/Unicode/long error bodies and headers, when Chat, Messages and Responses fail in stream-requested or buffered mode, then newly persisted usage errors contain only a fixed classification code, no upstream body or marker. Prove actual baseline persistence before choosing the smallest correction; verify SQLite, authenticated usage JSON, CSV and rendered usage page. Existing historical rows are not rewritten.
- EP-2: Given retryable and non-retryable errors, when fallback runs, then preserve HTTP status, caller-facing error contract, dispatch counts, cooldown and target order. Failed and successful attempts keep their existing separate rows, failure token/cost nulls and success values. Exercise CLI record_failure with an isolated fake CLI; do not change protocol terminal or cancellation behavior.
- EP-3: Given the final bounded diff, then focused RED→GREEN, full locked Rust 1.99.0 suite, fmt, Clippy, project validators/indexes, independent source/evidence and ledger review, required CI, normal merge/readback and ledger/backup/cleanup must pass. Test diagnostics and runtime logs must not contain the synthetic markers. Preserve original failures and unexecuted boundaries without claiming real credential disclosure or whole-product completion.

Verification uses only fake upstream/CLI and disposable synthetic databases. No real credential/private DB/provider/model, login, Docker, dependency/permission change, release/deploy. Mainline incomplete and usable_tag none. [Design and evidence](docs/tasks/T-0427-error-persistence.md).

EP-1–EP-3 local evidence: synthetic HTTP/CLI RED exposed canaries in SQLite/JSON/CSV/HTML; minimal fixed-code persistence GREEN passed, including fallback/cooldown/status/cost/null witnesses. Full247 Rust tests/19groups, fmt/Clippy,20validators,44contracts/7indexes passed. Original cached compiler-query EPERM and actual privacy RED are retained separately; original environment cause unknown. Historical rows and caller error contracts are unchanged, D-01–D-05 and broader UC-R05/M-15 remain open. Independent review/CI/merge/ledger gates are recorded separately in the task.

## T-0428 — D-05 incomplete cost estimates

Scope: the existing two-rate estimator and newly persisted buffered HTTP usage, under [T-1102](../../docs/specs/llm-usage-correctness.md) §4.2 / §5.2. This does not close all D-05 or UC-R03/UC-R04: provider-specific buckets, decimal precision, price revision/currency, aggregate coverage, stream/CLI terminal settlement and historical rows remain separate. Original specification and AC-01–AC-17 stay unchanged.

- CE-1: Given buffered Chat/Responses fake HTTP responses with absent, null or invalid token counts, when any of the three client APIs records usage, then SQLite and per-event JSON/CSV preserve unknown counts and estimated cost as null/empty; rendered event cost is unknown. Observe raw upstream usage before client conversion. Prove baseline persistence with isolated synthetic data before changing runtime. Antigravity raw-count parsing is covered offline; its HTTP persistence remains unverified after the explicitly recorded validation-method correction.
- CE-2: Given the existing two-rate estimator, when either count or configured rate is absent/invalid, then no complete estimate is recorded; when both counts and both finite nonnegative rates are explicit, including zero, preserve the existing arithmetic and known-zero value. Caller response conversions/content/status, dispatch counts, failed-attempt nulls, fallback and native streaming remain unchanged. No historical-row migration.
- CE-3: Given the bounded final diff, then focused RED→GREEN, full locked Rust1.99.0 tests/fmt/Clippy, repository contracts/indexes, independent source/evidence and ledger review, required CI, normal merge/readback and board/journal/desk/verified-backup/cleanup pass. Preserve original failures and unexecuted boundaries.

Final validation uses non-forwarding loopback fake HTTP fixtures and temporary synthetic databases. An initial Antigravity fixture unintentionally reached its hardcoded endpoint with synthetic data and returned401; that HTTP route was removed, original failure retained, and Antigravity HTTP coverage remains unverified. No real credentials, login, dependencies, permissions, Docker, release/deploy. Mainline incomplete; usable_tag none. [Design, correction and evidence](docs/tasks/T-0428-cost-completeness.md).

Local evidence:126buffered cases across3fakeHTTPmodes and3clientAPIs exposed82baseline mismatches per surface; unchanged fixture GREEN plus2unit tests. Full250Rusttests/20groups,fmt/Clippy,20validators,44contracts/7indexes passed. Antigravity is offline-parser coverage only; the original synthetic401 and test-harness failures are retained in the task. Independent review/CI/merge/ledger gates are recorded separately.

## T-0429 — Cost aggregate coverage

Scope: cost coverage in existing stored estimated_cost_usd only, under [T-1102](../../docs/specs/llm-usage-correctness.md) §5.3. The metric is recorded USD estimates, not a bill, subscription consumption, validation of historical provenance or price-basis/currency/provider grouping. Token/latency coverage, terminal outcomes, stream/CLI settlement and broader D-04/D-05 remain separate. Original specification and17core criteria stay unchanged.

- CC-1: Given an isolated synthetic usage table containing no rows, only unknown costs, a mix of known/unknown costs, complete positive costs or explicit zeros (including historical and current day buckets and failed rows), when all-time and daily cost aggregates are read, then no-known-value sums and incomplete legacy totals are null; summaries carry known_sum, known_count, unknown_count, total_count, row coverage, status and stored-estimate basis. Empty has no_data and null coverage; all-unknown has unknown and zero coverage; partial never reports a complete total. Explicit zero remains known. Establish actual baseline RED before the runtime correction.
- CC-2: Given the same synthetic data, when authenticated stats/daily JSON, dashboard, usage totals/daily table and the TUI footer/doctor output render, then they distinguish no data, unknown, partial subtotal and complete estimate with row coverage, and label all-time scope separately from day buckets. Per-event CSV costs remain empty for unknown and retain explicit zero; count/sum checks agree with each matching scope. Reads must not rewrite usage rows, dispatch providers or change event/schema/admission/fallback/stream semantics. Existing token/latency and HTTP-status aggregates remain outside this cost-only slice.
- CC-3: Given the bounded final diff, then focused RED→GREEN, full locked Rust1.99.0 tests/fmt/Clippy, validators/contracts/indexes, independent source/evidence and ledger review, required CI, normal merge/readback and board/journal/desk/verified backup/own-worktree cleanup pass. Preserve original failures and unverified boundaries; no whole-product or full D-04/T-1102 completion claim.

Validation uses synthetic SQLite and local admin reads only, with no provider connections/inference or private database. Mainline incomplete; usable_tag none. [Design and evidence](docs/tasks/T-0429-cost-coverage.md).

T-0429 local evidence (2026-10-28): six-case actual RED (34 mismatches) → unchanged HTTP fixture GREEN;254 Rust tests/21groups,fmt/Clippy,20validator tests and44contracts/7indexes passed. Original E0277 and Cursor fixture401 failures preserved; exact retry and final full suite passed,401 cause unknown. Independent source review accepted the bounded change after correcting TUI scope labeling. PR CI/merge and management delivery are tracked separately; this does not close the original mainline or full D-04.

## T-0430 — Repeatable offline user journey

Goal: an operator can run the full gateway workflow with synthetic loopback upstreams before any real integration. [Design and fixed acceptance](docs/tasks/T-0430-offline-journey.md).

- J-1: Given a built thinrouter binary and a fresh launcher-owned data directory, when the offline walkthrough runs, then it verifies admin/gateway auth, creates synthetic connections/routes/key, exercises exact text and streaming completion plus a two-turn local tool exchange through Chat/Messages/Responses, proves fallback dispatch order, a failed request and downstream cancellation, restarts with preserved configuration/history, and cleans up only owned processes/resources. A broken supported journey fails the command; no real upstream/CLI/account is used.
- J-2: Given the actual walkthrough requests, when inspecting authenticated admin JSON/HTML and event CSV, then buffered observed usage matches the fixture, stored rows/cost summary reconcile for the same scope, unknown streaming/cancelled telemetry remains explicit and is never invented as zero/success. HTTP transport status is not presented by the walkthrough as terminal success. Report existing D-01–D-05 limits with issue links; do not lock tests to missing data if a future valid settlement supplies the fixture's exact values.
- J-3: Given an operator following the short guide, when using --check or --serve, then one entry runs and reports the journey, while --serve leaves only the owned loopback demo available for inspecting existing admin pages until stopped. Diagnostics/report contain stage/status/counts/digests and safe paths, never keys, session IDs or request/tool content. No credentials/private DB are discovered. Use existing Python standard library and pinned locked Rust only; safe bounded startup/cleanup and explicit synthetic labels.
- J-4: Given the final bounded product diff, then full locked Rust tests/fmt/Clippy, focused Python fixture/launcher regressions, the actual --check run, --serve shutdown verification, repository validators/contracts/indexes, independent source review and required product CI/normal merge/readback pass. Original failures remain visible. This does not close original17coreAC, fullT1102 or live provider acceptance.

Mainline incomplete; usable_tag none. Existing live acceptance and T-1102 remain open in issues#698–702. No real provider or account is exercised.

Local evidence (2026-10-28): unchanged Rust baseline completed all nine journey stages. Final walkthrough creates17usage rows,11with exact5/3token counts and synthetic $2 estimates,6unknown; cost coverage stays partial. Twenty Python regressions include actual --serve/admin access/SIGTERM cleanup and negative terminal/cleanup/deadline cases. Full254Rusttests/21groups,fmt,Clippy,20validator tests and44contracts/7indexes passed. No Rust/Cargo changes or runtime bug claimed. Independent review found launcher cleanup exit0, failed-stream acceptance and missing total request deadline; preserved failing regressions now pass. Sandbox sccache/socket EPERM failures remain environment observations; approved execution passed without permission/configuration changes. Required CI/merge/readback and management delivery remain separate gates.

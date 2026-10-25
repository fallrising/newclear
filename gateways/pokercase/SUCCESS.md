---
project: gateways/pokercase
purpose: 以 thinrouter 提供個人訂閱憑證的多協定 LLM gateway
kind: service
mainline: incomplete
usable_tag: none
reviewed: 2026-10-22
source_commit: b97319d74f8442b5173ef42be72a0aa757d87df0
---

# pokercase 成功契約

## 主線與範圍

目錄名為 pokercase，binary／資料目錄為 thinrouter；不是兩個不同產品。
[README](README.md) 定義 Chat Completions、Messages、Responses、routes/fallback/RR、
OAuth/session import、usage、Web admin、TUI 與 SQLite；保留 Tier C dormant。
Layer B 多 agent assembler 是後續獨立工作，不能當作目前 gateway 已完成能力。
MITM、cloud sync、9router.db 相容與媒體 API 排除在外。

## 驗收條件

本表的 passed 僅表示本次已核對的靜態條件；historical 是既有紀錄，
不表示 2026-10-21 重跑產品。pending／failed 保留其實際缺口。

| AC ID | Given／When／Then | 狀態 | 證據或缺口 |
| --- | --- | --- | --- |
| AC-01 | Given 設定好的 subscription route，When 執行 provider smoke，Then grok/opencode/agy 可回覆。 | historical | [2026-07-28 P0 紀錄](docs/GOALS_AND_PROGRESS.md) 列 smoke OK（當時也含已移除的 codex）；沒有本次重跑。 |
| AC-02 | Given provider adapter 來源，When 核對 refresh／forwarding，Then 可定位 OAuth refresh、agy 與 Cursor CLI。 | passed | [main.rs](src/main.rs)、[oauth_refresh](src/oauth_refresh.rs)、[cursor_cli](src/cursor_cli.rs)；不採用舊上表「未開始」結論。 |
| AC-03 | Given 無有效 gateway key 或外部 listener 設定，When admission，Then 預設拒絕且 bootstrap 僅限零keys loopback。 | pending | [cost safety](docs/cost-safety.md) 與 [tests](tests/) 定義契約；本次未跑當前回歸，未據 source 宣稱 runtime PASS。 |
| AC-04 | Given Claude/Cursor 與支援的客戶端工具串流，When 完整訂閱旅程，Then 工具呼叫及錯誤／取消符合契約。 | pending | Claude 工具經 MCP 橋接（AC-11，未用真實帳號驗證）；Cursor（AC-17）僅文字，工具與圖片仍缺。 |
| AC-05 | Given 任何 listener 或經 Tailscale Serve／tunnel 轉發，When 存取 admin、改 connection base_url 或 keyless bootstrap，Then 一律要 admin token（session＋CSRF、Host／Origin 檢查），轉發請求視為遠端不得 bootstrap，OAuth token 只送官方網域，secrets 一律 AES-GCM 加密（Argon2id 或 0600 key file）並遷移舊資料。 | passed | [security](docs/security.md)；`tests/admin_security.rs`、`src/guard.rs`、`store::secret_storage_tests`；2026-10-22 本機 `cargo +1.99.0 test --locked` 全綠（只用本機假上游）。 |
| AC-06 | Given Responses 上游（siwc，強制串流），When 用 `/v1/chat/completions`、`/v1/messages`、`/v1/responses` 送純文字、工具呼叫、多輪 tool 往返與圖片（串流與非串流），Then 各端點收到自己的協定格式（chat chunk＋`[DONE]`、Anthropic 事件含 tool_use、原生 Responses），call_id 對得上且圖片保留。 | passed | `tests/responses_e2e.rs`（本機腳本化 SSE 假上游）、`responses`／`claude` 單元測試；2026-10-23 本機全綠。 |
| AC-07 | Given 同一段對話的多輪 siwc 請求，When 經任一端點送出，Then 帶穩定的 `prompt_cache_key` 與同值 `session-id`／`thread-id`（用戶端自帶的 key 優先），且不帶任何 Codex 客戶端偽裝標頭。 | passed | `src/prompt_cache.rs` 單元測試、`tests/responses_e2e.rs` 標頭與 key 斷言；2026-10-23 本機全綠。快取命中率需真實帳號驗證，未執行。 |
| AC-08 | Given `thinrouter login-siwc` 取得的官方 Sign in with ChatGPT 憑證，When 經三個端點呼叫 `siwc` provider，Then 打 `api.openai.com/v1/responses` 並強制 `store:false`、`stream:true`，剔除不支援欄位、system→developer、function tools 包進 namespace，`previous_response_id` 與託管工具回 400，額度用盡回 429；refresh 依 issued client_id 輪換並序列化。 | pending | 本機已驗：`siwc` 單元測試（含假 auth server 的完整登入與 refresh）、`tests/codex_e2e.rs::siwc_provider_applies_preview_limits`、`oauth_refresh` 測試。未以真實帳號登入或呼叫；namespace 工具格式未經真實上游確認。 |
| AC-09 | Given 舊版留下的 `codex` 連線，When 開啟資料庫，Then 連線被停用、token 清除，`codex` provider 不再存在；OpenAI 模型只走 `siwc`。 | passed | `store::secret_storage_tests::codex_rows_are_retired`、`providers` 單元測試；2026-10-23 本機全綠。 |
| AC-10 | Given `claude` provider，When 三個端點送純文字或圖片（串流與非串流），Then 由本機 `claude -p`（magpie 參數、清理後環境）回答，呼叫方 system 只放在 `<external_system_instructions>`、不替換 Claude Code 的 system prompt，thinrouter 不持有或傳送 Claude token；thinking 不回傳，額度用盡 429、未登入 401；工具見 AC-11。 | passed | `tests/claude_code_e2e.rs`（假 `claude` 腳本記錄參數、環境與 stdin）、`claude_code` 單元測試；2026-10-22 本機全綠。未用真實帳號。 |
| AC-11 | Given `claude` provider 與客戶端工具，When 三個端點送帶 tools 的請求與工具結果，Then 工具經 MCP helper 以 `mcp__thinrouter__<name>` 提供（只 allow 這些、不跳過權限），tool_use 換回原名轉給客戶端並立即結束 run，帶結果的下一輪以完整對話開新 run，id 對得上。 | passed | `tests/claude_code_e2e.rs::client_tools_are_bridged_through_mcp`、`mcp_helper_speaks_stdio_json_rpc`、`claude_mcp` 單元測試；2026-10-22 本機全綠。未用真實 Claude Code 驗證。 |
| AC-12 | Given `claude` provider 的工具呼叫，When 客戶端下一個請求正好帶回這些 tool id 的結果，Then 結果經 MCP helper 回呼（run token 只在 0600 檔與標頭）交給同一個 Claude Code 進程繼續回答，不重送對話；對不上、逾時或名額被讓出時改開新 run。 | passed | `tests/claude_live_e2e.rs`（Python 假 Claude Code 真的啟動 helper 並呼叫 `tools/call`：同進程續答、串流、逾時、讓出名額、回呼需 token）；2026-10-23 本機全綠。未用真實 Claude Code 驗證。 |
| AC-13 | Given `claude` provider 回答完一輪（`end_turn`），When 下一個請求只在同一段對話（相同 model／system／工具、歷史一致）後面多了使用者訊息，Then 寫進同一個閒置的 Claude Code 進程；歷史被改、設定不同或逾時則開新進程，新進程的歷史以 20 則一塊、最後完整區塊加 1h cache 標記。 | passed | `tests/claude_live_e2e.rs::next_user_turn_goes_on_in_the_idle_run`、`idle_runs_expire`，`claude_code` 單元測試（cache 區塊、turn 渲染）；2026-10-23 本機全綠。未用真實 Claude Code 量測 cache 命中。 |
| AC-14 | Given 閒置的 Claude Code run 被結束（逾時、讓出名額或 gateway 關閉），When 同一段對話的下一輪到來（含 gateway 重啟後），Then 以 `--resume <session>` 開進程、只送新訊息；資料庫只存 hash 不存對話；session 不在或載入失敗時改整段重送；過期與遺留的 session 檔會被清除。 | passed | `tests/claude_live_e2e.rs::ended_idle_run_resumes_from_its_saved_session`、`saved_sessions_survive_a_restart`（SIGTERM 重啟、啟動清理）、`unresumable_session_falls_back_to_the_whole_conversation`，`store::secret_storage_tests::claude_shelf_matches_conversation_prefixes`；2026-10-23 本機全綠。未用真實 Claude Code 驗證 session 路徑與 `--resume` 行為。 |
| AC-15 | Given chat 格式上游或 Claude Code，When 客戶端以 `/v1/responses` 串流且回覆含文字與工具呼叫，Then 收到完整的 Responses 事件序列（`response.created`、message 與 `function_call` 的 `output_item.added`／delta／`.done`、帶 output 與 usage 的 `response.completed`，`sequence_number` 遞增，不送 `[DONE]`）；`length` 結束為 `response.incomplete`，錯誤為 `response.failed`。 | passed | `responses::tests::chat_stream_to_responses_*`、`tests/chat_upstream_responses_e2e.rs`、`claude_live_e2e::responses_stream_from_claude_code_carries_the_tool_call`；2026-10-23 本機全綠。 |
| AC-16 | Given `import-local` 匯入的 grok 連線（借用 `~/.grok/auth.json`；xAI refresh token 會輪換），When 呼叫上游、檔案被 Grok CLI 更新或 token 過期，Then 每次重讀檔案、從不自行 refresh 或寫檔，401 時重讀一次後回明確提示；舊資料的 grok refresh token 在開庫時清除。agy（Google，不輪換）照常 refresh。 | passed | `tests/responses_e2e.rs::borrowed_grok_login_is_reread_and_never_refreshed`、`borrowed` 單元測試；2026-10-23 本機全綠。 |
| AC-17 | Given `cursor` provider，When 三個端點送純文字（串流與非串流），Then 僅在 operator 加 `--cursor-accept-account-plugins` 時（否則 503，不啟動 CLI）且提供固定 Docker image／專用 profile volume，由容器內官方 `cursor-agent -p --output-format stream-json --stream-partial-output` 回答，傳入 `--mode ask`、`--sandbox disabled`、臨時工作目錄（這些 CLI 旗標本身不是安全邊界），不加 `--force`／`--approve-mcps`；只採用串流 delta（略過重複 flush），呼叫方 system 放在 `<external_system_instructions>`；thinrouter 不持有 Cursor token、不再使用私有協定；帶 tools 或圖片回 501，未登入回 401。 | passed | `tests/cursor_cli_e2e.rs`（Python 假 `cursor-agent` 照官方 output-format 文件輸出）、`cursor_cli` 單元測試；2026-10-23 本機全綠。2026-10-23 owner 以真實 `cursor-agent` 2026.10.16 跑 `-p --output-format stream-json --stream-partial-output --mode ask --sandbox enabled --trust --workspace /tmp "say hi"`：參數均被接受、delta／flush 判斷與實作一致，另有文件未載的 `thinking` 事件（忽略）與 result 上的 usage（已對應）；假程式依此輸出更新。同日探測：ask 模式下 agent 仍可用帳號的 Cursor plugin（Gmail 等）且 CLI 無法停用，故改為 opt-in；workspace MCP 需 `--approve-mcps` 才載入。未經 thinrouter 端到端實跑。 |

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

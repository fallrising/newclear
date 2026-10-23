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
| AC-17 | Given `cursor` provider，When 三個端點送純文字（串流與非串流），Then 僅在 operator 加 `--cursor-accept-account-plugins` 時（否則 503，不啟動 CLI）由本機官方 `cursor-agent -p --output-format stream-json --stream-partial-output` 回答，限定 `--mode ask`、`--sandbox enabled`、空工作目錄，不加 `--force`／`--approve-mcps`；只採用串流 delta（略過重複 flush），呼叫方 system 放在 `<external_system_instructions>`；thinrouter 不持有 Cursor token、不再使用私有協定；帶 tools 或圖片回 501，未登入回 401。 | passed | `tests/cursor_cli_e2e.rs`（Python 假 `cursor-agent` 照官方 output-format 文件輸出）、`cursor_cli` 單元測試；2026-10-23 本機全綠。2026-10-23 owner 以真實 `cursor-agent` 2026.10.16 跑 `-p --output-format stream-json --stream-partial-output --mode ask --sandbox enabled --trust --workspace /tmp "say hi"`：參數均被接受、delta／flush 判斷與實作一致，另有文件未載的 `thinking` 事件（忽略）與 result 上的 usage（已對應）；假程式依此輸出更新。同日探測：ask 模式下 agent 仍可用帳號的 Cursor plugin（Gmail 等）且 CLI 無法停用，故改為 opt-in；workspace MCP 需 `--approve-mcps` 才載入。未經 thinrouter 端到端實跑。 |

## 本次里程碑：T-0377 Cursor 外部隔離

Owner 決定保留 Cursor。目標／範圍／固定 AC 與驗證計畫見 [隔離規格](docs/cursor-isolation.md)，進度見 [任務板](docs/tasks/BOARD.md)。原 ask＋sandbox 的主機隔離假設已被實測否定；AC-17 的假 CLI 協定測試不能當成隔離 PASS。本次尚未完成，真帳號與網路／plugin 隔離未驗證。

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

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
| AC-01 | Given 設定好的 subscription route，When 執行 provider smoke，Then codex/grok/opencode/agy 可回覆。 | historical | [2026-07-28 P0 紀錄](docs/GOALS_AND_PROGRESS.md) 列四種 smoke OK；沒有本次重跑。 |
| AC-02 | Given provider adapter 來源，When 核對 refresh／forwarding，Then 可定位 OAuth refresh、agy 與 Cursor text chat。 | passed | [main.rs](src/main.rs)、[oauth_refresh](src/oauth_refresh.rs)、[cursor_agent](src/cursor_agent.rs)；不採用舊上表「未開始」結論。 |
| AC-03 | Given 無有效 gateway key 或外部 listener 設定，When admission，Then 預設拒絕且 bootstrap 僅限零keys loopback。 | pending | [cost safety](docs/cost-safety.md) 與 [tests](tests/) 定義契約；本次未跑當前回歸，未據 source 宣稱 runtime PASS。 |
| AC-04 | Given Claude/Cursor 與支援的客戶端工具串流，When 完整訂閱旅程，Then refresh、工具呼叫及錯誤／取消符合契約。 | pending | [進度下半部](docs/GOALS_AND_PROGRESS.md)：Claude 依憑證、Cursor tools及 Anthropic edge cases仍缺完整證據。 |
| AC-05 | Given 任何 listener 或經 Tailscale Serve／tunnel 轉發，When 存取 admin、改 connection base_url 或 keyless bootstrap，Then 一律要 admin token（session＋CSRF、Host／Origin 檢查），轉發請求視為遠端不得 bootstrap，OAuth token 只送官方網域，secrets 一律 AES-GCM 加密（Argon2id 或 0600 key file）並遷移舊資料。 | passed | [security](docs/security.md)；`tests/admin_security.rs`、`src/guard.rs`、`store::secret_storage_tests`；2026-10-22 本機 `cargo +1.99.0 test --locked` 全綠（只用本機假上游）。 |
| AC-06 | Given Codex（Responses 上游，強制串流），When 用 `/v1/chat/completions`、`/v1/messages`、`/v1/responses` 送純文字、工具呼叫、多輪 tool 往返與圖片（串流與非串流），Then 各端點收到自己的協定格式（chat chunk＋`[DONE]`、Anthropic 事件含 tool_use、原生 Responses），call_id 對得上且圖片保留。 | passed | `tests/codex_e2e.rs`（本機腳本化 SSE 假上游）、`responses`／`claude` 單元測試；2026-10-22 本機全綠。chat 上游經 `/v1/responses` 串流仍只轉文字 delta。 |
| AC-07 | Given 同一段對話的多輪 Codex 請求，When 經任一端點送出，Then 帶穩定的 `prompt_cache_key` 與同值 `session-id`／`thread-id`（用戶端自帶的 key 優先），User-Agent 版本取自 `--codex-version`、本機 `codex --version` 或內建值。 | passed | `src/codex.rs` 單元測試、`tests/codex_e2e.rs` 標頭與 key 斷言；2026-10-22 本機全綠。快取命中率需真實帳號驗證，未執行。 |

## 現況與缺口

舊進度表的 auto refresh／executor「未開始」已被同檔後半部與實際 source 超越。
已知四個 provider 有歷史 smoke；不能降格成全部 mock，也不能擴為全 provider 完成。
Cursor text chat 已有實作，舊「501」只能代表早期紀錄；tools仍是後續能力。
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

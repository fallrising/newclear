# codex-usage

> **Portfolio doc tier: A (active)** — Runnable entry: [docs/quickstart.md](docs/quickstart.md).  
> Policy: [docs/portfolio-doc-tiers.md](../../docs/portfolio-doc-tiers.md).  
> Investment notes: [PORTFOLIO.md](../../PORTFOLIO.md).

Codex ChatGPT 訂閱用量的**單次、唯讀、無狀態採集器**。它和 [cc-quota](../cc-quota/) 是平行工具，但目前刻意只做 acquisition：不建立排程、SQLite、通知或自動任務調度。

## Boundary

In scope：

- 使用本機已安裝且已登入目標 ChatGPT 帳號／workspace 的官方 Codex CLI App Server。
- App Server 初始化後只讀 `account/read`、`account/rateLimits/read`、`account/usage/read`。
- 每次執行為短生命週期程序；不建立／恢復 thread，不啟動 model turn。
- JSON 輸出保留 partial failure；缺值為 `null`，不是 0。
- `remaining_percent = clamp(100 - used_percent, 0, 100)`。
- `seconds_until_reset = max(0, resets_at - now)`。
- `cycle_tokens` 只有來源提供與 quota window 完整對齊的 token 統計才可填；目前 adapter 不推測，因此為 `null`。
- 採集時間與來源更新時間分開；來源沒 timestamp 時標 unknown。

Out of scope：

- API Platform usage 替代 ChatGPT/Codex 訂閱用量。
- 私人網頁端點、cookie scraping、JWT/auth file 解析。
- login/logout、購買額度、reset-credit 兌換或帳號 mutation。
- 任意 RPC forwarding、任意 shell MCP。
- scheduler；等真實主機驗收完成後另開切片。

## Status

- 核心計算、缺值、bucket 去重、token 強語義、identity fail-closed 與 CLI 缺失路徑有 offline unit tests。
- 這個 repo 版本由 CI 執行 deterministic tests。
- **真實 Codex CLI/App Server 版本、目標帳號登入與 live schema 尚未在目標主機驗收。**
- 先前對話中的完整 prototype 有 51 項離線測試通過；本 repo 收斂為較小的 maintainable seed，後續應以目標 CLI 實際 schema 補強 adapter，而不是把未驗證 schema 固化成事實。

## Output contract

```json
{
  "collected_at": "...",
  "source": {
    "kind": "official_codex_cli_app_server",
    "codex_version": "..."
  },
  "identity": {
    "account_type": "chatgpt",
    "account_email_verified": true,
    "workspace_identity_verified": false
  },
  "queries": {
    "rate_limits": {"status": "ok|partial|error"},
    "usage": {"status": "ok|partial|error"}
  },
  "quota_buckets": [],
  "token_statistics": {
    "scope": "account_activity_not_quota_cycle",
    "cycle_tokens": null
  }
}
```

帳號 email 只用於本機比對，不輸出到 snapshot。若要求 `expected_workspace_id` 而目前 adapter 無官方可驗證欄位，採集會 fail closed。

## MCP

若未來需要 MCP，只封裝無參數的 `get_codex_usage_snapshot`，由 server 端固定 CLI path / target。不要提供 method、shell command 或任意路徑作為外部輸入。

## Links

- Quickstart: [docs/quickstart.md](docs/quickstart.md)
- Tests: [tests/test_codex_usage.py](tests/test_codex_usage.py)
- CI: [codex-usage-ci.yml](../../.github/workflows/codex-usage-ci.yml)
- OpenAI Codex App Server: https://developers.openai.com/codex/app-server/
- OpenAI Codex authentication: https://developers.openai.com/codex/auth/

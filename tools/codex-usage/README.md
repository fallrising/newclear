# Agent Usage（相容 codex-usage）

> 主線、驗收條件、剩餘缺口與可用版本：[SUCCESS.md](SUCCESS.md)。


> **Portfolio doc tier: A (active)** — Runnable entry: [docs/quickstart.md](docs/quickstart.md).  
> Policy: [docs/portfolio-doc-tiers.md](../../docs/portfolio-doc-tiers.md).  
> Investment notes: [PORTFOLIO.md](../../PORTFOLIO.md).

多工具統一查詢入口：[Agent Usage 使用指南](docs/agent-usage.md)。`agent_usage.py` 整合來源、JSON 與文字表格；原 `codex_usage.py` 仍是下述 Codex ChatGPT 訂閱用量的**單次、唯讀、無狀態採集器**。[cc-quota](../cc-quota/) 已依 owner 指示封存；既有快照與歷史由統一入口唯讀接入，舊安裝的排程／通知保留原狀。原 Codex collector 仍只做 acquisition：不建立排程、SQLite、通知或自動任務調度。

## Claude 歷史查詢

`python3 agent_usage.py history --config /private/path/agent-usage.json --hours 24 --limit 100 --format table`

讀既有 Claude SQLite，提供歷史觀測、缺漏與截斷標示；不採集、不寫 DB。設定與限制見[使用指南](docs/agent-usage.md#claude-歷史與缺漏時段)。

## Codex collector boundary

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

Owner 已授權本次提交與PR合併；最新交付及7項後續來源工作見 [SUCCESS](SUCCESS.md#t-0975--目前成果最終目標與交付)。
下方先前「hosted CI未跑」等為M2/M3本地階段狀態；最終結果見[交付證據](docs/evidence/2026-10-23-delivery.md)。

- M3 封存／歷史查詢：84 項 tests、5 項 CLI smoke、全庫41項目契約通過；獨立審查複驗 ACCEPT。
- 以下 M2 統一來源數字與 live 證據保留歷史，不能當成本次重新呼叫各服務。

- 統一入口本地驗證：63 項 unified／Codex tests 與 35 項 Claude 後端 tests 通過；6 項 CLI smoke 通過。
- Codex 與 OpenCode 本機統計已透過統一入口真讀取成功；其他來源的支援方式與未驗限制見 [使用指南](docs/agent-usage.md)。

- 本次 root 重跑 33 項離線測試通過，含 fake CLI 完整唯讀流程、partial exit2、身份失敗清除資料與程序清理。
- CI 已設定 deterministic tests；本次 hosted CI 尚未執行。
- **AC-03 已通過：目標帳號比對及真 snapshot 採集成功；AC-04 可見 usage/status 對照仍待完成。**
- 早期 prototype 的 51 tests 僅為歷史數字；此 repo 原 seed 有 17 tests，本次結果以 [SUCCESS](SUCCESS.md) 的當前證據為準。

本次主線已依 owner 指示恢復；進度見 [任務板](docs/tasks/BOARD.md)。本機 CLI 0.163.0 已完成目標帳號真採集，exit 0；[去識別 snapshot](docs/evidence/2026-10-23-live-snapshot.json) 與 [live report](docs/evidence/2026-10-23-live-report.md) 已保存。

## Reporting evidence

Offline unit tests and compilation verify the local seed; they do not verify the installed Codex CLI,
account/workspace, live App Server schema, or a real snapshot. Report each command's actual result and
keep hosted CI and independent review separate. Follow the
[delivery report example](docs/quickstart.md#delivery-report-example); record the actual stage as **offline-tested / live-collected / visible-status-unverified**
until the [live acceptance gate](docs/quickstart.md#acceptance-gate) passes.

Required pending checks keep a report `PARTIAL` or `BLOCKED`. Sanitize evidence before sharing; do not
include account data, private paths, or authorization contents. This component does not use desk claims
or a `Desk-Task` trailer. Merge delivers the change; the issue stays open until the owner records
acceptance and closes it. The filled task under `archive/tools/codex-usage/tasks/` is an old record, not
a template.

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

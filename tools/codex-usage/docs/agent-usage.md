# Agent Usage 使用指南

同一個入口查看多工具的額度或使用狀態。沿用 `tools/codex-usage` 路徑與原 Codex collector；
[cc-quota](../../cc-quota/README.md) 已封存，後續開發集中在此；既有 DB 可直接唯讀接入。
舊版排程／通知保留原狀，沒有遷移為新工具功能，不另建重複專案或搬移資料。
需要 Python 3.11+，只有標準函式庫依賴。

## 快速開始

從 `tools/codex-usage` 執行：

```sh
python3 agent_usage.py sources
python3 agent_usage.py snapshot --codex-target /private/path/target.json --provider codex --format table
python3 agent_usage.py snapshot --config /private/path/agent-usage.json --format table
```

Codex target 沿用 [target.example.json](../target.example.json)，由你指定 expected_email 與 workspace 選擇。
`--codex-target` 可與其他來源設定併用，但設定中不能再定義第二個 Codex source。
預設輸出 JSON；可重複 `--provider` 選擇來源。沒有設定的 provider 顯示 unknown，不會自動搜尋憑證。
exit 0＝選定來源完整有效；2＝仍有可用資料的部分結果；1＝無可用資料或設定錯誤。
`ok` 表示該來源的指定資料可用，不表示已取得訂閱額度或通過人工畫面對照。

## 支援範圍

| 工具 | 已實作來源 | 實際查到什麼／限制 |
| --- | --- | --- |
| Codex | `codex` | 官方 App Server 訂閱窗口及獨立帳號統計；前後驗證目標帳號，來源更新時間可能未知。 |
| Claude | `claude-db`、`claude-statusline` | cc-quota 現有快照或官方 statusline；不抽取登入憑證，不獨立驗證快照所屬帳號。 |
| OpenCode Go | `opencode-stats` | OpenCode 全部本機 providers 的活動與成本；**不是 Go 訂閱剩餘額度**，縮寫數字為近似值。 |
| Cursor / cursor-agent | `cursor-admin` | 官方團隊 Admin API 當期帳號支出，需相應權限；不是個人方案剩餘額度。 |
| Grok | `manual` | 人工記錄官方 `/usage` 顯示；尚無已驗證的 headless quota adapter。`grok usage SESSION_ID` 的 token／成本不是訂閱餘額。 |
| Grok Bot | `manual` | 人工觀測；額度是否與其他工具共享依實際方案，不能自動推斷。 |
| Antigravity | `manual` | 人工記錄官方 `/usage`／`/quota`；尚無已驗證的 headless adapter。 |

所有 provider 都可使用 `manual`，但同一份設定每個 provider 只能選一個來源。
支援 source kind、離線測試與真帳號驗收是不同狀態；最新證據見 [SUCCESS M2](../SUCCESS.md#m2--agent-usage-統一查詢owner-2026-10-23-直接授權)。

## 設定

將 [agent-usage.example.json](../agent-usage.example.json) 複製到自己的私有設定目錄，修改路徑並移除不使用的來源。
此範例不是可直接使用的登入設定。完整範例：

```json
{
  "version": 1,
  "sources": [
    {"provider":"codex","kind":"codex","target_file":"/private/path/target.json","timeout":10},
    {"provider":"claude","kind":"claude-db","path":"/private/path/quota.db","max_age_seconds":5400},
    {"provider":"opencode-go","kind":"opencode-stats","days":1,"timeout":20},
    {"provider":"cursor","kind":"cursor-admin","expected_email":"you@example.invalid","token_env":"CURSOR_ADMIN_API_KEY"},
    {"provider":"grok","kind":"manual","path":"/private/path/grok-observation.json"}
  ]
}
```

路徑按執行時工作目錄解析，建議用絕對路徑；`~` 與環境變數不自動展開。
`cli` 可指定 Codex／OpenCode 可執行檔路徑，不是 shell 命令；Codex 另接受 `codex_home`。
OpenCode 固定執行 `opencode --pure stats --days N`，N 為 1–365。
每來源 `max_age_seconds` 預設 5400，允許 1–604800；`timeout` 預設 10，允許 0.05–120 秒。
選填 `pool_id` 僅作你指定的群組標籤，不會加總或證明共享額度。標籤以小寫英文字開頭，
最多 32 字元，只接受英數、底線與連字號；不要放帳號識別資訊。

Cursor 只從 `token_env` 指定的環境變數讀 API key；不要將 key 寫入 JSON 或貼入對話。
固定呼叫官方 `https://api.cursor.com/teams/spend`，不接受自訂網址、不跟隨 redirect。
只接受唯一精確 email 比對（不區分大小寫）；多頁結果拒絕而不猜測身份。
`on_demand_usd` 與 `total_usd` 分開呈現，不能相加，也不能換算成訂閱剩餘百分比。

## Claude 資料

若已有 cc-quota，`claude-db` 指向它現有的 SQLite 檔；缺檔不建立、不遷移。
只讀取最新快照及錯誤狀態，不啟動 cc-quota 採集、不讀 credential files。
預設位置通常是 `~/.local/share/cc-quota/quota.db`，也可能由 `CC_QUOTA_DB` 指定。

也可將既有 Claude session 提供的官方 statusline JSON 傳入：

```sh
python3 agent_usage.py capture-claude --output /private/path/claude-statusline.json < /private/path/existing-statusline-input.json
```

輸出只保留 `rate_limits.five_hour`／`seven_day` 的 `used_percentage` 與 `resets_at`，
加上擷取 UTC 時間；原子寫入權限 0600，拒絕覆寫 symlink。父目錄須事先存在。
將 Claude 來源改為 `{"provider":"claude","kind":"claude-statusline","path":"/private/path/claude-statusline.json"}`。
這個命令不修改 Claude settings。若接入既有 statusline command，應讓它接收原始 JSON；
擷取成功會輸出簡短 JSON，請自行安排原有狀態列顯示。

官方 rate_limits 僅在支援方案與首次 API 回應後提供；缺少時顯示 unknown。
**不要為取得額度而發送新 prompt。** 擷取時間不是上游額度更新時間，舊檔不應反覆重擷取假裝更新。

## 人工觀測

人工檔案必須含實際觀測的 UTC 時間；以下時間只作格式示意，使用時替換成真實讀值時間：

```json
{
  "observed_at": "2026-10-23T07:00:00Z",
  "windows": [
    {"name":"weekly","used_percent":25,"resets_at":"2026-10-30T07:00:00Z","window_duration_minutes":10080}
  ]
}
```

`used_percent`／`resets_at`／`window_duration_minutes` 可為 null，缺值不當成零。
窗口名稱使用與 pool_id 相同的安全標籤格式；最多 32 個不重複窗口。
禁止未來觀測時間、無時區日期、NaN／Infinity 或布林值冒充數字。
人工資料會明示 `source_kind: manual`、`identity_verified: false`，不是即時接口驗收。

## Claude 歷史與缺漏時段

```sh
python3 agent_usage.py history --config /private/path/agent-usage.json --hours 24 --limit 100 --format table
```

此命令只使用設定中 `provider: claude`、`kind: claude-db` 的既有資料庫；
未設定、選擇 statusline/manual 等來源時明示 unknown，不啟動舊採集器或替你建立 DB。
歷史查詢目前拒絕 WAL 模式／WAL 輔助檔（`database_wal_unsupported`），避免 SQLite 在來源目錄建立共享記憶體檔。
cc-quota 原本建立的 rollback-journal DB 可直接讀取；存在 `-journal` 時則回報 `database_sidecar_unsupported`，
可等寫入工作完成後重試。本工具不自動轉換 journal 模式或刪除輔助檔；查詢期間不要另行切換 DB 的 journal 模式。
其他 provider 尚無歷史儲存來源，因此目前不提供跨服務歷史。

`--hours` 為整數 1–8760，以執行時間往前推，預設24小時；不是從最後一筆舊資料回推。
`--limit` 為整數1–500，預設100，計算窗口資料列數（同一時間的不同窗口各算一列）。
先選範圍內最新資料，再按時間由舊到新顯示；超出上限時標 `truncated`，不宣稱已列出完整歷史。
不設 `--format table` 則輸出 JSON。

JSON 是 `metric_scope: quota_history`，含 `hours`、`limit`、`truncated`、`points` 與 `status/errors`。
每個 point 提供 UTC `observed_at`、窗口、`observed_used_percent`／`observed_remaining_percent`、
`resets_at`、獨立的本機 token 欄位及 `historical: true`。所有百分比都是當時觀測，不代表現在剩餘。
本機 tokens 不與其他窗口加總，不當作帳號或 cycle tokens。

每個窗口各自比較相鄰的已返回觀測；`gap_before_seconds` 首筆為 null，之後記錄間隔。
超過5400秒標 GAP，表示缺觀測，不推斷一定是睡眠，也不插值補齊。
截斷結果的首筆沒有前一筆可比較，因此不能由「未標 GAP」推斷範圍完整。
未來觀測、較新採集錯誤、截斷、gap 或缺值會明示，錯誤原文與 raw JSON 不會被讀出。

exit0＝所查範圍內有可用且完整的歷史；2＝有資料但存在上述限制；1＝沒有可用資料／設定或檔案錯誤。
空範圍不會拿範圍之外的舊讀值頂替。`identity_verified` 為 false，因為資料庫本身沒有獨立帳號證明。

## 如何理解輸出

JSON 含 `collected_at` 與各 provider 的 `source_kind`、`metric_scope`、`status`、`identity_verified`、
`observed_at`、`age_seconds`、`stale`、`windows`、`usage`、`errors`。
來源無更新時間時仍為 null，不能拿統一採集時間代替。Codex 另標記 `source_update_time_status: unknown`。
OpenCode／Cursor 的觀測時間代表本次查詢時間，Claude statusline 代表擷取時間。

過期快照或已越過 reset 的窗口，現在的 `used_percent`／`remaining_percent` 清為 null；
`observed_used_percent`／`observed_remaining_percent` 保留歷史讀值，`historical` 為 true。
有用的歷史結果仍可能是 partial／exit 2，不應用於判斷目前可用額度。
`cycle_tokens` 始終為 null：不把 local tokens、累計 tokens 或費用換算成窗口 token。
錯誤使用穩定代碼，不輸出 email、session ID、私有路徑、上游回應或憑證。

## token 與費用

工具用 Python 解析資料、讀本機檔案或查唯讀接口，不呼叫模型產生回答，所以查詢本身不消耗推理 token。
CLI／HTTP 仍會有程序、網路與 API 速率限制成本；既有 Claude session 自己的模型使用仍按原服務計算。
開發這個工具時與 AI 對話的 token，與之後執行此查詢程式是兩回事。

## 開發驗證

從此目錄執行 shared workspace launcher，避免測試暫存污染來源：

```sh
python3 /path/to/agent-workspace/workspace.py run codex-usage agent-usage-check -- python3 -W error::ResourceWarning -m unittest discover -s tests -v
```

新測試涵蓋 fake CLI、固定 HTTP transport、SQLite readonly、過期／錯誤資料、隱私與舊 collector 相容性。
CI 設定同時驗證 unified／Codex 與 cc-quota，實際 hosted CI 結果須另行確認。

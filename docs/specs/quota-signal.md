# Agent Usage：統一額度與使用狀態

Status: owner 於 2026-10-23 直接授權實作多來源統一入口及整合重複能力；實際完成度以
[Codex Usage SUCCESS 的 M2 / AU-01–05](../../tools/codex-usage/SUCCESS.md) 與其任務板為準。
本文件取代 2026-09-28 尚未接受的 quota-signal 提案，沒有表示 Git 已合併或完整 live 驗收。

## 目標與整合決策

單一使用入口為 `tools/codex-usage/agent_usage.py`。沿用現有專案路徑以維持舊指令／證據連結，
產品展示名稱為 Agent Usage。不要新增第三個同質 quota 專案，也不要複製現有 collector。

- Codex：呼叫既有 `codex_usage.collect`，固定唯讀 App Server RPC 與身份驗證不變。
- Claude：讀取既有 cc-quota SQLite 快照或官方 statusline 的精簡擷取資料。
- cc-quota：owner 後續明示封存，原地保留 collect→SQLite、launchd 與通知的歷史來源及既有安裝相容性；
  舊指令和所有原 pending AC 仍有效。原始 SQLite／設定／credential 位置不搬動。
- OpenCode：只透過固定 CLI stats 讀本機活動，明示涵蓋全部本機 providers，不代表 Go 訂閱額度。
- Cursor：可選固定官方 Admin spending API；成本與額度分開，不把金額換算成訂閱剩餘%。
- Grok／Grok Bot／Antigravity／OpenCode Go：缺穩定機器可讀 quota 介面時，顯示 unknown 與具體原因；
  允許明確標記 manual 的人工觀測，不能把人工或 fixture 當成 live adapter 驗收。

## 統一契約

同一份 snapshot 包含七個具名 provider 的來源、scope、status、觀測時間、age／stale、
window 剩餘與 reset，以及獨立的 usage 統計。每個來源獨立失敗；結果仍輸出可用的其他來源。
JSON 與文字表格使用同一份資料，不呼叫模型產生解釋。

- 剩餘：`clamp(100 - used_percent, 0, 100)`；缺值為 null，不能補 0。
- 重置倒數：`max(0, resets_at - now)`；過期或重置後的舊百分比不能當成目前額度。
- stale 門檻明確，可設定但必須有限正數；未來觀測時間與無時區日期拒絕。
- 來源沒有更新時間就維持 unknown。人工觀測、擷取時間、來源更新時間分清。
- local tokens、帳號 tokens、API spend、訂閱 percentage 分別標 scope；不互相推算。
- `pool_id` 若設定，只是使用者給的非敏感本地群組標籤，不是已驗證身份；不自動相加或推斷共享池。
- 真身份驗證只在來源實際比對時成立；Claude DB、statusline、manual 不聲稱獨立驗證帳號。
- 預設 JSON 輸出不包含 email、account/session ID、檔案路徑、raw upstream body、token 或 cookie。
- exit 0 表示選定來源完整有效；exit 2 表示仍有可用結果的 partial；exit 1 表示無可用資料／設定錯誤。
  此規則保留既有 collector 的 partial exit2，取代舊 proposed QS-4 的 partial exit0。

## 命令與來源設定

實際命令及設定 schema 見 [使用指南](../../tools/codex-usage/docs/agent-usage.md)。
`capture-claude` 僅擷取既有 Claude session 的 statusline JSON，刪除 transcript、session、workspace 資訊，
寫入 owner 指定的私有檔案；不自動修改全域 Claude settings，不為填補資料開啟模型 turn。

沒有任意 RPC、shell forwarding 或 endpoint override。新 API credential 僅允許明確環境變數引用，
不掃描或抽取 credential files；舊 cc-quota 自己的憑證邊界仍由其原合約管理，統一入口不呼叫它。
所有輸入和子程序有界；SQLite readonly 開啟，缺檔不建立；HTTP 不跟隨 redirect 外洩授權。

## 非目標與後續

本次不新增 scheduler、資料庫 schema、通知平台、登入／刷新、付費模型呼叫或任務調度。
歷史查詢由 Agent Usage 的唯讀 history 接手；舊告警／排程保留於封存來源，不表示新工具維護或安裝它。
多服務排程／告警可在每個來源取得真實驗收後再開具名里程碑。
消費者不得用 unknown 或過期資料自動中止現有工作。

## 驗證

新入口 RED→GREEN、舊 Codex／Claude 回歸、readonly DB 不變、fake CLI 精確命令、Cursor HTTP 替身、
失敗與過期資料、privacy 與無模型呼叫邊界；接著執行可用真來源（目前 Codex、OpenCode local stats）。
沒有登入環境、API key 或可見讀值的服務逐一保留未驗，不能以 sources 列表的存在當作支援成功。

官方契約參考（2026-10-23 核對）：

- [Claude statusline](https://code.claude.com/docs/en/statusline#rate-limit-usage)：部分方案且首次 API 回應後才提供 rate_limits。
- [OpenCode Go](https://opencode.ai/v2/docs/console/go/)：Console 用量；本機 stats 不等同此訂閱池。
- [Cursor Admin API](https://cursor.com/docs/account/teams/admin-api)：POST /teams/spend 為 current-cycle spend，含授權與身份比對要求。
- [Grok commands](https://docs.x.ai/build/modes-and-commands)：TUI /usage 與 shell grok usage 的用途不同。
- [Grok Bot plans](https://cursor.com/help/grok-bot/plans)：共享／分離額度依方案，不能按工具名稱推斷。
- [Antigravity quota panel](https://antigravity.google/docs/cli/commands/usage)：官方 TUI 顯示，不代表已取得獨立 headless API。

## M3：封存與歷史

2026-10-23 owner 要求封存另一項目並繼續開發；cc-quota 標 archived/not-applicable、Tier D，原驗收狀態不改。
Agent Usage 新增 `history --config FILE --hours 24 --limit 100 --format table`，僅讀已設定 Claude DB；
時間範圍以現在回推，最多500列，固定參數化查詢，UTC歷史觀測／缺漏／截斷清楚標示。
不新建DB、不讀raw或錯誤文字、不改憑證／設定／排程，不把歷史值當成目前剩餘。

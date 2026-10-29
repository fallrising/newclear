# Cloud Lab — M0 合約索引

> 下文保留 M0 設計基線。已授權 M1 開發的實作範圍、協定差異與限制見 [M1 實作契約](../docs/m1-implementation.md)；M0 提案不代表所有 operation 已實作。
狀態：**Proposed／spec-only**，2026-10-26。本文及四份合約是待審設計，沒有可呼叫端點、已部署服務、通過的 runtime 驗收或正式授權機制。

Cloud Lab 提供共用 Cloudflare 控制介面與契約；各元件維持獨立部署、資料及既有 authority。Cloud Lab D1 只擁有本層 command admission、冪等紀錄、outbox 與收到的結果證據。原生 job／程序／session 生命週期由執行器擁有，不複製第二套 job authority。

| 合約 | 設計責任 |
| --- | --- |
| [identity](identity.md) | principal、scoped grant、驗證與撤銷、回呼身分 |
| [commands-runs](commands-runs.md) | 准入、冪等、派送 attempt／lease／fence、外部 run 對帳 |
| [events-artifacts](events-artifacts.md) | 事件去重與順序、結果驗證、有界 artifact |
| [recipes](recipes.md) | 固定 typed recipe、政策、單一健康檢查範例與負向案例 |

## 階段與權威

M0 只審文件；後續需嚴格 schema、相容性向量、故障注入及真實整合證據。M1 的唯一執行切片是單節點、有界、唯讀健康檢查，可用 polling 與交易 outbox。Queues、Workflows、主機 mutation、任意 shell、批次 fleet 操作皆須另過 gate，不能因共用控制介面而自動啟用。

Queue receipt、Workflow progress、派送 ACK 與模型的成功文字都不是執行成功。只有既有執行器的可驗證終態及 recipe 驗證結果可形成成功證據；資料缺漏、失聯、取消未確認都必須可見。

[Edge Ops](../../edge-ops/SDD.md) 仍以自己的 D1 管 durable job state，沿用其獨立批准及主機本地政策；Cloud Lab 透過 adapter 引用，不能覆寫或繞過。[Agent Workforce](../../agent-workforce/README.md) 的原生執行協調與外部工作系統 Done 邊界不變。[Kith 決策](../../../products/kith/docs/v2/10-decisions.md) 的 INV-09（模型無管理工具）、INV-19（replay 不是工作佇列）保留。獨立 bot client 可憑受限 grant 提交 command；Kith 接入須後續 ADR，聊天或 replay 不是授權來源。

## 共同資料規則

本文欄位與 operation 名稱均為擬定語義，不代表 HTTP route。所有 ID、digest、時間與內容範例都是合成資料，沒有真實帳號、主機或外部地址。

合約版本為 `cloudlab.*.v1`，各物件另有整數 `schema_minor`；recipe 版本、adapter 版本、grant revision 分開。接收端只接受明列支援版本；未知 major、未知欄位、重複 JSON key、非有限數值、非法 UTF-8 一律拒絕。v1 不接受浮點參數；新增權限、必要欄位或更寬上限須契約審查及新版本，不用「忽略未知欄位」降級安全。

時間採 UTC RFC3339，durations 為整數秒；ID 是 1–128 UTF-8 bytes 的不透明字串，不含控制字元；digest 是 `sha256:` 加 64 個小寫十六進位字元。request、event、result 的 JSON body 上限均為 32 KiB（artifact bytes 另計）。其他描述字串每項最多 1024 UTF-8 bytes。使用者字串視為不可信資料，純文字呈現，不可插入 shell、HTML 或日誌指令。

所有回應／稽核帶 `request_id`；錯誤語義見 commands-runs。實作前必須固定簽章 byte encoding、嚴格解析器與相容性 fixtures；本輪文件檢查不能代替 schema／驗簽或平台驗收。

## 固定bot CLI介面

[BC adapter](../docs/bot-bridge.md)提供獨立單次stdin／stdout契約：[request schema](bot-request.schema.json)與[response schema](bot-response.schema.json)。僅health.check／health.status，4KiB輸入，沒有任意命令；trusted host配置與server grant共同限制權限。不是新的HTTP route或已接通Grok的宣告。

[MT MCP stdio介面](../docs/mcp-stdio.md)提供固定tools/list與tools/call；input僅UUID request_id，output沿用bot-response schema。MCP RPC ID與持久request_id分離，取消RPC不表示取消遠端命令，無新增HTTP route。

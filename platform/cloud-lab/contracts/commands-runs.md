# Commands、外部 runs 與對帳

> 下文保留 M0 設計基線。已授權 M1 開發的實作範圍、協定差異與限制見 [M1 實作契約](../docs/m1-implementation.md)；M0 提案不代表所有 operation 已實作。
狀態：**Proposed／spec-only**；operation 名稱只描述語義，沒有可呼叫端點。身份見 [identity](identity.md)，結果見 [events-artifacts](events-artifacts.md)。

## 擬定 operation signatures

每項輸入均含版本與 authenticated principal context，輸出均含 request_id；下表省略共同欄位。這些是待審資料操作，不代表已實作的 SDK 或 HTTP API。

| Operation（輸入 → 輸出） | 必要 capability／額外 guard |
| --- | --- |
| SubmitCommand(command bytes) → command_id、admission、revision | commands:submit + recipe 所需 capability；grant／scope／期限／預算 |
| GetCommand(command_id) → CommandRecord、ExternalRunView、evidence metadata | commands:read；workspace／resource ACL，不回 artifact bytes |
| GetCommandByKey(workspace_id, idempotency_key) → 同上或 not_found | commands:read；僅查 authenticated principal 的 key namespace |
| RequestCancel(command_id, reason_code) → cancel_requested、revision | commands:cancel-request；resource ACL，可重複 |
| Claim(command_id, expected_revision) → dispatch_attempt_id、fence、lease_expires_at | dispatch:claim；adapter owner 綁定、CAS、重新驗准入條件 |
| ClaimReconcile(command_id, expected_revision) → coordination attempt、mode=reconcile_only、fence、lease_expires_at | 獨立且目前有效的 runs:reconcile grant；原 owner／workspace／resource 綁定、CAS；不依賴原 submit grant 仍有效 |
| Renew(command_id, dispatch_attempt_id, fence, expected_revision) → 新 lease_expires_at、revision | dispatch mode 用 dispatch:claim；reconcile_only 用 runs:reconcile；同 holder／mode、未過期 lease、CAS，不修改 command deadline |
| BindExternalRun(command_id, dispatch_attempt_id, fence, external_ref) → 綁定 ref、revision | dispatch:claim；當前 lease／fence、CAS、唯一不可換的 ref |
| ReportEvent(Event bytes) → durable ACK、revision | runs:report；callback authentication、scope／fence、完整事件去重 |
| ReportResult(Result bytes, event_id, source_seq) → durable ACK、validation 摘要 | runs:report；視為 run.result 事件，與 ReportEvent 共用同一去重／排序路徑 |
| Reconcile(command_id, current_attempt, fence, owner_snapshot, covered_through_seq) → 投影、revision | runs:reconcile；當前 fence、可驗 owner 證據，不能建替代 native run |
| ReadArtifact(artifact_id) → 有界 bytes 或 evidence_expired | artifact:read；獨立物件 ACL、已驗內容／有效期；commands:read 不足 |

## 准入與冪等

`SubmitCommand` 含 `schema_version: cloudlab.command.v1`、`schema_minor: 0`、`workspace_id`、`resource_ref`（node ID + generation）、`recipe_ref`（ID + version + digest）、`parameters`、`idempotency_key`、`not_before`、`dispatch_deadline`、`execution_deadline`、`timeout_seconds`、`output_budget_bytes`。principal 由 credential 決定，grant 由服務端驗證；client 不能指定 executor credential 或 raw shell。

准入先嚴格驗 schema、身份、scope、recipe、能力及限額，D1 同一交易保存不可變 command bytes／digest、grant revision、admission record 與 outbox。交易失敗不得 ACK accepted；成功只表示已持久接受，不能表示已執行。D1 的唯一約束為 `(workspace_id, principal_id, idempotency_key)`；同 key、同 immutable bytes 返回原 command；同 key、不同 bytes 回 `IDEMPOTENCY_CONFLICT`，不再派送。client 重試須保持原始 JSON bytes；簽章 envelope 可更新。

冪等紀錄及過期 tombstone 至少保留至 `max(execution_deadline, grant expiry) + 7 天`；尚在執行、unknown、conflict 或未完成對帳的 command／submission mapping 不因時間到就清理，仍占用相應 in-flight 容量。逾期 command 即使 key 已清理仍拒絕，不可借重試重新起跑。recipe、scope、參數、預算或期限修改必須用新 command 與新 key，再經准入。

## 單一外部 reference 與派送 attempt

Cloud Lab 的 `CommandRecord` 是 admission／delivery／evidence record；`ExternalRunView` 是帶 freshness 的外部狀態投影。原生 job／attempt／程序生命週期由 executor owner 決定，Cloud Lab 不建立可競爭的 native job state machine。

每個 command 至多綁一個 adapter 擁有的 `external_ref`，欄位為 `owner`、`adapter_id`、`external_id`。綁定以 D1 CAS 固定且不可換 owner／ID。adapter 在呼叫外部系統前 durable 保存 command→external submission key，並以 owner 的冪等鍵或可靠查詢恢復。若無法證明外部是否已建立，停在 unknown，不能盲目再 submit。沒有這種去重／查詢能力的 adapter 不通過 M1 gate。

Cloud Lab `dispatch_attempt_id` 是一次傳輸協調嘗試，包含遞增 `attempt_no`、`mode`（dispatch／reconcile_only）、`lease_holder`、`lease_expires_at`、單調 `fence`。它不是原生 run attempt；原生 attempt ID 僅作 owner 證據。claim 以 CAS 檢查 outbox／revision；同一有效 claim 的重送返回同一 attempt／fence。lease 續租也須 CAS，不可降 fence。dispatch 續租用 dispatch:claim；reconcile_only 續租用目前有效的 runs:reconcile，兩者均限原 holder／mode。

`ClaimReconcile` 僅取得查詢與補證權：在舊協調 lease 已到期／明確釋放或 delivery 已需對帳時，以 CAS 安裝新的 reconcile_only holder／fence，舊 holder 的寫入被拒絕。查詢同一 command 的 submission key／external_ref 不需證明原生程序已停止，也不要求原 submit grant、schedule 或 command deadline 仍有效。它需要另一份目前有效的 adapter 對帳 grant，仍受原 owner／workspace／resource scope 約束；對帳 lease 與原 command 的執行期限分開，有界為 15 秒，單次最多 3 次續租，每次重新驗證該 grant。

reconcile_only 不得 submit、start、修改 owner run、取消程序或改寫原 command／期限；只能查權威 owner 與保存經驗證的證據。external_ref 尚未綁定時，用原 durable submission key 查詢，僅可依 owner 證據 CAS 補綁查得的唯一原 run，不能建立或換成別的 run。需恢復原 submit 時，先釋放對帳 claim，再以普通 Claim 取得新的 dispatch mode／fence，完整重驗原 submit grant、schedule revision、cancel flag、generation、Recipe 與期限；不得原地把對帳權限升級成派送權限。

lease 到期後先進 reconciling，禁止自動重建外部 run。新協調 attempt 可提高 fence 查詢同一 external_ref，只有 owner 證明尚未建立／啟動且期限與授權仍有效時，才允許恢復原 submit。所有有副作用的 owner 操作必須支援 fence 或等價的 durable dedupe；本層 fence 本身不能停止外部程序，也不承諾 exactly-once。

## 可觀察狀態與取消

admission／delivery 狀態限定為 `accepted`、`dispatching`、`awaiting_result`、`reconciling`、`result_recorded`、`expired_before_dispatch`、`cancelled_before_dispatch`；以 revision CAS 更新，保留轉換證據。`cancel_requested` 為獨立旗標。外部投影限定 `not_observed`、`queued`、`running`、`succeeded`、`failed`、`stopped`、`timed_out`、`unknown`，均標記 owner、observed_at、received_at、evidence ref。

`result_recorded` 表示已保存通過身份／scope／schema 檢查的 owner 終態證據；其 recipe validation 可以是 failed 或 incomplete，仍須保存而不能丟棄。它從不單獨代表驗證成功，成功／失敗另看 owner_outcome 與 validation；不是產品工作項目 Done。斷線、lease 到期、callback gap、查詢無法確認皆顯示 `unknown`，delivery 進 reconciling。不能把 unknown 當 failed 重試，也不能用最後一次 running 顯示成新鮮資料。

| 允許的 delivery 轉換 | 必要證據／guard |
| --- | --- |
| accepted → dispatching | 當前 grant／recipe／generation／期限有效，claim CAS 成功 |
| accepted／dispatching／reconciling → cancelled_before_dispatch／expired_before_dispatch | 取消或期限到期；原子封鎖 outbox，證實 never-started 且沒有仍可能起跑的舊 submit；無法證明則留 reconciling |
| dispatching → awaiting_result | 唯一 external_ref 已綁定，owner 已接受；不代表執行成功 |
| dispatching／awaiting_result → reconciling | lease／連線／回呼證據缺漏，保留原 ref，投影 unknown |
| awaiting_result／reconciling → result_recorded | 當前 fence、事件連續或 snapshot 補證、schema-valid 終態；validation 可 failed／incomplete |
| reconciling → awaiting_result | 當前 owner snapshot 證明同一 run queued／running |
| reconciling → dispatching | owner 證明原提交尚未建立或啟動，重新取得 dispatch claim 並證明仍有授權及起跑餘裕；僅恢復原 submission key／ref |
| 任一狀態 → reconciling | authenticated 證據與已存終態或 never-started 證據矛盾；保留兩者並標 conflict，不覆寫歷史 |

同狀態的去重 ACK／lease 續租只增必要 revision；其餘轉換拒絕。派送後的取消／過期須經 owner 對帳，不能直接跳到 before_dispatch 終態。result_recorded 後重送原結果只回原 ACK，不重新執行。

`RequestCancel` 可重複，記錄 actor／時間並通知 owner，只返回取消已要求。派送前取消以 CAS 阻止後續起跑並記錄 never-started 證據，delivery=cancelled_before_dispatch、外部投影=not_observed；派送後仍需 owner 提供程序停止／終態證據。取消與成功競爭時保存兩者時序，採 owner 可驗終態；不能因按下取消就標 stopped。撤銷權限、timeout、Queue ACK、Workflow step completed 同樣不是停止證明。

`not_before ≤ dispatch_deadline ≤ execution_deadline`；M1 admission 到 dispatch 最多 60 秒，總 execution deadline 最多 admission 後 120 秒，timeout ≤30 秒。起跑前 grant、node generation 與 recipe 再驗；必須剩足 timeout 才能開始。dispatch 期限到期時未起跑且可證實無外部 run，標 expired_before_dispatch。已起跑超時則依 owner 的已授權期限／停止政策處理並對帳，未確認維持 unknown；reconcile_only 不因逾時取得停止程序權限。晚到結果在接收端證據 metadata 保存 `late: true` 與原期限，不另建 run、不默默覆寫既有矛盾終態。`late` 由可信 received_at > execution_deadline 推導，不是 Result 的輸入欄位；超期回報不等於執行本身超期，owner 的 finished_at 與驗證判斷分列。

## 錯誤與重試語義

擬定錯誤 envelope 為 `{code, message, retryable, request_id}`，message 不含 secrets、內部 stack 或原始 provider response。若未來映射 HTTP，語義如下；這不是已存在的 route。

| 類別／擬定 HTTP | code | client 行為 |
| --- | --- | --- |
| 401 | UNAUTHENTICATED | 更新合法身份後再試，不變更 command |
| 403 | SCOPE_DENIED／GRANT_REVOKED | 不自動重試，不擴權 |
| 409 | IDEMPOTENCY_CONFLICT／STALE_FENCE／REVISION_CONFLICT | 查原 command／對帳；不建替代 run |
| 413／422 | BODY_TOO_LARGE／SCHEMA_INVALID／RECIPE_UNSUPPORTED | 修正提案，新的 command 才用新 key |
| 422 | DEADLINE_INVALID／DEADLINE_EXPIRED | 不起跑，不以重試刷新期限 |
| 429／503 | QUOTA_EXCEEDED／TEMPORARILY_UNAVAILABLE | 同 key 最多 3 次指數退避，受 deadline 約束 |

暫時無回應先查原 key 的 admission；無法確認即維持 pending／unknown，不把 transport failure 宣告成 execution failure。M1 的 polling 與 outbox 足夠；未來 Queue／Workflow adapter 也不得改這些狀態及 authority 邊界。

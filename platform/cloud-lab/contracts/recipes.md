# Typed recipes 與唯讀健康檢查

狀態：**Proposed／spec-only**。這是待審 recipe 資料契約，不是任意程式執行介面，也沒有已安裝或已部署 recipe。

## RecipeVersion

每版固定 `recipe_id`、`version`、`digest`、`schema_version`、`source_revision`、`owner`、`adapter_version`、`parameter_schema`、`required_capabilities`、`resource_kinds`、`execution_profile`、`timeout_seconds`、`output_budget_bytes`、`verification_policy`、`recovery_policy`。digest 綁定審查後的精確 recipe bytes，版本不可變；內容改動必須新版本、新 digest，grant 重新明確允許。artifact 地址不代替 digest。

`parameter_schema` 限定必需欄位、型別、字串長度、整數上下限、enum、陣列大小，additionalProperties=false，不接受浮點、環境變數、raw shell、動態 entrypoint 或 secret value。adapter 只把已驗參數映射至固定操作，不插值 shell。秘密只能引用受限 server-side credential ref，且 recipe 及 grant 皆須允許；M1 健康檢查不需 provider-wide credential。

`verification_policy` 固定 validator version、必需 checks、freshness／postcondition、可接受 artifact type；`recovery_policy` 固定可重送／重跑條件、最大嘗試、對帳與取消證據。timeout 或 transport retry 不能放寬政策。模型輸出只是 untrusted proposal，經嚴格解析、可信 registry、grant 與 executor policy 驗證後才可准入；模型無權核准自己、擴大 capability 或以文字改寫 recipe。

## ScheduleSpec（擬定，沒有已運作的排程器）

`ScheduleSpec` 含 `schedule_id`、遞增 `revision`、`schema_version: cloudlab.schedule.v1`／schema_minor、workspace／resource_ref、不可變 recipe_ref（version + digest）及嚴格 parameters、`grant_ref`（ID + revision）、`scheduler_principal_id`、`enabled`、`cron_utc`、`overlap_policy`、`misfire_policy`、`max_catch_up`、timeout／output budget 與 dispatch／execution deadline offsets。建立／更新須可信管理邊界驗權；模型只能提案，不因提供 cron 取得權限。

`cron_utc` 擬定為五欄 minute/hour/day-of-month/month/day-of-week，使用 UTC、分鐘精度；M1 若實作僅允許整數／範圍／清單／`*`，day-of-month 與 day-of-week 至少一者為 `*`，不採隱含本地時區或特殊巨集。recipe、parameters、grant 或時程改動產生新 revision；舊 revision 不再新增 firing，已存在 command 仍保留原證據及取消規則。

每次 firing 以 `(workspace_id, schedule_id, revision, scheduled_due_at)` 做唯一鍵，映射至一個持久 command idempotency key。可信 scheduler 使用綁定自己 principal 的受限 grant，不能冒用原建立者身份。第一次處理該 due time 時，在 D1 原子保存 firing、完整 immutable command bytes 及 outbox；以當次 admission 時間一次性構造 not_before 與期限（M1 dispatch offset ≤60 秒、execution offset ≤120 秒，timeout ≤30 秒），同 due time 的重試保留原 bytes／期限，不刷新 deadline 或再建 command。

預設 `overlap_policy=skip`：同 schedule 尚有 in-flight／unknown command 則記錄 skipped_overlap，不累積無界等待。`misfire_policy=skip`、`max_catch_up=0` 為預設；可明確選 bounded_catch_up，max_catch_up 僅 1–3，每次恢復只處理最近最多該數量的 due times，其他明記 skipped_misfire，不跨多輪無限補跑舊歷史。每個補跑仍走相同 grant／recipe／容量准入；不能借補跑繞過 max_in_flight。

disabled、撤銷／到期 grant 或 revision 不符時不建立新 command；派送前重驗同樣條件，已建立但未派送者封鎖 outbox 並保存 never-started／取消證據。在跑的 command 按原取消／對帳規則處理，不能因關閉 schedule 假稱停止。排程只產生一般 command，不直接執行、不持有 owner authority；本契約不授權立即啟用排程或 Workflows。

## M1 唯一 recipe 提案

| 欄位 | 合成值／限制 |
| --- | --- |
| recipe_ref | `node-health@1.0.0` |
| digest | `sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`（合成佔位，不可部署） |
| schema／owner／adapter | `cloudlab.recipe.v1` minor 0／node-check-owner／adapter_demo@1.0.0 |
| source_revision | `synthetic-revision-1`，後續審查需替換為可核對來源 |
| resource kind／profile | node／unprivileged-read-only |
| required capability | node:health:read |
| parameter_schema | 物件只含必需的 `max_sample_age_seconds`：整數 1–60 |
| timeout／output | 30 秒／16384 bytes；grant 可更窄 |
| verification | node-health-validator@1.0.0；schema、freshness、scope 必需 |
| recovery | 同 submission key 可重送，最多 3 次 transport retry；不自動建立另一 run |

adapter 僅向既有 owner 取得指定 node generation 的有界健康資料，不讀任意檔案、不修改服務、不重啟、不更換 authority、不操作管理網關。freshness 以 owner 的 observed_at、取樣年齡及可信接收時間檢查；無法信任時間時為 incomplete。唯讀不等於無敏感資料，仍限制欄位及 artifact ACL。

## 一致的 request → event → result walkthrough

1. `principal_demo_bot` 於 `2026-10-26T00:00:00Z` 以 `grant_demo_1` revision 1 提交合成 request `req_demo_1`。workspace=`ws_demo`，resource=`node_demo_1` generation 1，recipe 如上，parameters=`{"max_sample_age_seconds":30}`，idempotency_key=`health-demo-1`，not_before=`00:00:00Z`、dispatch_deadline=`00:01:00Z`、execution_deadline=`00:02:00Z`（同日完整 UTC 時間），timeout=30、output_budget_bytes=16384。
2. D1 原子保存 `cmd_demo_1`、准入判斷與 outbox，回 accepted。相同原始 body 再送只回原 command；修改 age 為 40 且沿用同 key 必拒絕，不能多派一次。
3. `adapter_demo` 取得 `attempt_demo_1`、fence 1 的 15 秒 lease。adapter durable 固定 submission key 後向 node-check-owner 提交，將唯一 external_ref 綁定 `check_demo_1`。原生 run 由該 owner 擁有；Cloud Lab 不控制其內部 attempts。
4. 依 [events-artifacts](events-artifacts.md) 收到 seq 1 綁定、seq 2 running、seq 3 result；回呼各自驗簽與 nonce，業務 event 去重另算。若重送 seq 3／同 digest，返回原 ACK，不重寫結果。
5. owner 在 `00:00:05Z` 完成，結果為 healthy、sample_age_seconds=2、collector=ok；schema／freshness／scope 三項通過。Cloud Lab 保存結果證據，delivery=result_recorded，外部投影=succeeded，節點觀測=healthy。這是此 command 的成功證據，並非整個 Cloud Lab 或外部工作項目的 Done。
6. 若 callback 丟失，polling 以同一 external_ref 查 owner；無法查清則 reconciling／unknown。若 `00:00:04Z` 請求取消，但取消送達前 owner 於 `00:00:05Z` 完成，保留 cancel_requested 與成功的時間證據；不得捏造 stopped。lease 到期也不可另開 `check_demo_2`。

## 待實作的負向驗收

以下均為設計情境，沒有在 M0 執行 runtime 測試。

| 情境 | 必須可觀察的結果 |
| --- | --- |
| body 加入 shell、admin、額外參數；age 為字串／61／非有限數字；body >32 KiB | 准入拒絕，不寫派送 outbox |
| 錯 workspace／node generation／digest、撤銷 grant、bot 自增 capability | scope／schema 拒絕，保留有界稽核 |
| 相同 key 不同 bytes；外部建立 ACK 丟失 | 前者衝突；後者查原 submission key，不建新 run |
| lease 過期、舊 fence 回報成功、事件 seq 3 先到 seq 2 | 隔離／buffer／對帳，不能直接顯示成功 |
| 重放 callback nonce、event ID 同名不同 digest | authentication 拒絕／EVENT_CONFLICT，不改現有證據 |
| 僅有 Queue receipt、Workflow complete、模型稱完成 | 維持未確認，不生成有效成功 result |
| cancel／timeout 後 owner 無法證明停止 | cancel_requested／unknown，不顯示 stopped |
| artifact 超限／digest 不符／缺 freshness check／證據已到期 | 拒絕或 validation incomplete／failed，清楚顯示證據缺口 |
| recipe 提案要求 restart、批次 mutation、Kith replay 派送 | M1 gate 拒絕；另提 ADR／里程碑，不隱性放行 |
| 只有 commands:read 的 caller 要求 ReadArtifact | 拒絕 artifact bytes，另需 artifact:read 及物件 ACL |
| schedule 同 due time 重試、停用／撤銷、恢復累積大量 missed due times | 原 command／期限不變；不新建工作；只按 0–3 的明確上限補跑並記 skipped |

後續 Workflows 只可作有界多步協調 adapter，Queues 只作至少一次投遞；兩者均須沿用 command key、external_ref、fence、期限與結果驗證，不取代 owner authority。mutation 另需獨立批准、本地政策、停機／重試證據及既有元件審查，本輪沒有批准或實作。

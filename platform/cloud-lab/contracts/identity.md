# Identity 與 scoped grant

> 下文保留 M0 設計基線。已授權 M1 開發的實作範圍、協定差異與限制見 [M1 實作契約](../docs/m1-implementation.md)；M0 提案不代表所有 operation 已實作。
狀態：**Proposed／spec-only**；共同版本與上限見 [索引](README.md)。沒有已提供的登入、token 或回呼端點。

## Principal

`Principal` 含 `principal_id`、`kind`（human／bot／adapter）、`issuer`、`subject`、`audience`、`credential_id`、`credential_generation`、`expires_at` 及 `revoked_at`。服務端從已驗證的 credential 解析身份；body 中自稱的 principal、workspace 或 role 不具授權力。hostname、email header、聊天訊息與模型產出的 JSON 都不是身份證明。

Human 使用已核准的 identity adapter，驗 issuer、audience、signature、expiry 及 workspace membership；瀏覽器採同源 secure session、Origin／CSRF 防護。Bot 使用專屬短效機器 credential；adapter 使用獨立服務身份。credential 不共用於整個 fleet，不把 provider-wide token、長效服務金鑰或批准私鑰交給瀏覽器／bot。

## Grant

`ScopedGrant` 固定 `grant_id`、`revision`、`principal_id`、`workspace_id`、`resource_refs`、`capabilities`、`recipe_refs`（version + digest）、`not_before`、`expires_at`、`max_timeout_seconds`、`max_output_bytes`、`max_in_flight`、`issued_by`、`revoked_at`。資源、recipe 與 capability 使用明確 allowlist；M1 不接受 wildcard 或隱式跨 workspace 繼承。

M1 capabilities 為 `commands:submit`、`commands:read`、`commands:cancel-request`、`node:health:read`、`artifact:read`；adapter 另需 `dispatch:claim`、`runs:report`、`runs:reconcile`。每個 operation 交集檢查 principal、grant、workspace、node、recipe 及限額。`commands:read` 不推導出 `artifact:read`；後者仍須物件 ACL，`commands:submit` 不推導出 mutation。發 grant 的管理流程是獨立可信邊界，模型不能為自己建立或擴大 grant。

准入時保存 grant revision／policy digest 與判斷證據；派送前重新檢查撤銷與期限。執行器仍檢查自己的 authority／本地政策。撤銷後的准入／派送檢查必須拒絕；已交付 owner 的起跑與撤銷競爭須對帳，不能假稱已停止在跑程序。需記錄 cancel request 並按 [對帳契約](commands-runs.md) 取得停止證據。到期後可由仍有證據上報權的 adapter 回報原 run，不能用原 submit grant 另開 run。`ClaimReconcile` 使用獨立、目前有效的 runs:reconcile grant 取得查詢／補證 fence；原 submit grant 過期或撤銷不阻擋這種有界對帳，也不把對帳 grant 升級成 submit／start／cancel 權限。

## 回呼 authentication 與重放

每個 adapter 預先綁定允許的 executor owner、workspace 與 credential generation。擬定回呼採註冊公鑰的 Ed25519 簽章；使用標準實作，不自造密碼演算法。簽章輸入為固定 domain separator `CLOUDLAB-CALLBACK-V1\n` 加原始 UTF-8 envelope bytes；signature 放在 envelope 外。envelope 含 `schema_version`、`purpose`、`credential_id`、`credential_generation`、`audience`、`request_id`、`sent_at`、`nonce`、`body_sha256`。服務端核對實際 body digest，再驗 signature、scope、generation、purpose、時鐘及 nonce。

`purpose` 限定為 events／result／reconcile，不能跨用途重放。`audience` 綁定部署，envelope 時鐘容忍擬定 ±120 秒；body 的舊 `observed_at` 可保留，但重送必須用新 envelope。nonce 至少保存 10 分鐘；傳輸重放拒絕，業務去重另依 event ID／digest，不能混用兩層。撤銷 key、未知 key 或無法驗證時間一律 fail-closed。

回呼身份只是必要條件；還須核對 command、唯一 external reference、attempt／fence 及結果 schema。有效簽章不等於有權回報其他節點。過時 fence 的回呼只能保留為隔離證據，不直接改寫目前投影；由具 `runs:reconcile` 權限的當前 adapter 重新查詢 owner 後提交對帳證據。必須先完成跨實作 golden／negative vectors 才能聲稱可用驗簽。

## 合成 grant 與負向案例

全文件使用 `principal_demo_bot`、`grant_demo_1` revision 1、`ws_demo`、`node_demo_1` generation 1、`adapter_demo`。bot grant 只允許 commands:submit／commands:read／commands:cancel-request／node:health:read，以及 `node-health@1.0.0` 和 [recipe digest](recipes.md)，期限為 `2026-10-26T00:00:00Z` 至 `2026-10-26T01:00:00Z`，timeout ≤30 秒、output ≤16384 bytes、in-flight ≤1。adapter 另有同 workspace／node 範圍的專屬 claim／report／reconcile grant，不能借用 bot grant。

驗收必須拒絕：把 `ws_demo` 換成其他 workspace、過期／撤銷 grant、任意新 recipe digest、以 collector 權限提交 command、模型附帶 admin 欄位、回呼錯誤 audience／purpose／generation／簽章及重放 nonce。這些是待實作測試案例，並非本輪已跑結果。

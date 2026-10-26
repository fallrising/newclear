# 部署設定與 live gate

本輪交付是已驗證的本機實作候選；此文件沒有啟用帳號資源、網域、排程或外部服務。下一步部署前要確定目標 CF account／domain／plan、單一非 root runner、容量／retention、Access 應用與批准的觀測窗口。費用未知，不承諾免費。

## 部署單位

`apps/control/worker/index.mjs` 是 Worker ES module，使用 Web Crypto、Fetch 與 D1，沒有 Node／第三方 runtime 依賴。`apps/control/public` 是同源資產。`apps/control/wrangler.toml` 是公開範本，D1 ID 是故意無法部署的佔位；私有部署設定指向自己的 DB 與 custom domain。migration `0001.sql` 只建立新庫的表／索引，不可套到其他產品資料庫。

- `DB`：本元件獨立 D1 binding；直接主要資料庫讀寫，未啟用 read replica session。
- `ASSETS`：Static Assets binding，`run_worker_first=true`。所有列明資產路徑先經 Worker 身分／grant 檢查。
- `PUBLIC_ORIGIN`：唯一 HTTPS origin，沒有尾斜線。
- `AUDIENCE`：此部署的 HMAC audience，不與其他部署共用。
- `MACHINE_KEYS`：私有 secret JSON，credential ID 對應 principal_id、grant_id、generation、32–64 bytes lowercase secret_hex、UTC expires_at、可選 revoked。每個 bot／runner 獨立金鑰。
- `ACCESS_CONFIG`：私有 secret JSON，issuer=`https://<team>.cloudflareaccess.com`、audience、subjects。subjects 將已驗證 JWT sub 對應 `{principal_id,grant_id}`，不得依 email header 自動放行。

金鑰不得寫 public vars、前端、測試證據或 PR。Worker 未提供發 grant 的 HTTP API；由可信 operator provisioning D1 的 grants 表。更新 policy 必須同時增加 revision；撤權用 revoked=1。Grant policy 欄位為 principal_id、workspace_id、resource_ref、recipe_ref、capabilities、not_before、expires_at、max_timeout_seconds、max_output_bytes。各 principal 配獨立列；此 profile 是固定單節點，沒有 wildcard。

以 [Recipe 精確 bytes](../recipes/node-health.json) 的 SHA-256 填 recipe_ref.digest，與 bootstrap 值核對。`max_timeout_seconds` 至少 10、`max_output_bytes` 至少 16384，但 M1 命令固定這兩個值。operator/bot submit 需 commands:submit＋node:health:read；讀取 commands:read；取消意圖 commands:cancel-request；成果 artifact:read。runner 需 dispatch:claim、runs:report、runs:reconcile，限定同 workspace/resource/recipe。scheduler 使用自己的 principal／grant，不能借 owner 身分。

## Access 與入口

瀏覽器入口以 Access 保護；API 額外驗 JWT signature、issuer、audience、expiry、subject allowlist 與 D1 grant。POST 必須同 Origin 與 X-Cloud-Lab:1。只有外層 Access 登入成功仍不足以執行操作。

Bot／runner 經 Access service-token policy 時，在 [runner private config](../adapters/node-health/README.md) 設配對的 cloudflare_access_client_id／cloudflare_access_client_secret；這與本層 HMAC credentials 分開。純 HMAC 不能自動穿過未配置的 Access policy。

公開範本關閉 workers.dev／preview，不提供 routes。live 驗收逐一驗 custom domain、workers.dev、preview URLs、資產路徑與原主機 port；不要只測單一路徑。即使誤開另一 origin，本 Worker 的 origin allowlist 與驗簽仍應拒絕。

## 排程、保留與復原

沒有 schedule row／Cron trigger 時完全停用。M1 只支援固定 UTC 每分鐘 health-minute，可信 provisioning 新增 schedules row（id、revision、enabled、grant_id、last_due）；先 enabled=0。啟用需部署 gate，設定 Cron `* * * * *` 並將該 row 啟用。同 due time＋revision 原子去重；當前分鐘以外 skipped_misfire；已有 active／unknown skipped_overlap；停用後 dispatch 再驗 enabled／revision。

命令最多 10000 筆、24 小時最多 1440 次准入，全域一個 active。大於配額回429，未知工作保留 slot。成果7天後 API 不再提供 bytes；**此版沒有自動刪除或資料庫清理**。容量／保留運維尚須 live gate，不可把到期讀取拒絕宣稱為實體刪除。

runner journal 是唯一執行證據：先保存 started，再採樣，完成先保存 result，再回報。重啟的 started／missing reconcile 不重跑。不能刪 journal 解決 unknown；應保留並對帳。M1 不提供自動 reset／重派／native stop，也不把取消按鈕當成程序停止。

備份時保留 D1 schema/version、資料與 runner journal，含 SQLite WAL／journal；不要只複製仍在寫入中的單一檔案。還原先停止新准入／停用排程與派送 grant，隔離驗證，再對帳所有未完成 command。此版尚未做真實 CF 還原演練，不能直接宣稱可安全接回既有主機。

## 尚未通過的 live 驗收

1. 使用選定 CF toolchain 的 workerd／本機 D1 bindings，再進真實 D1 的 CAS、batch rollback 與網路故障驗證。
2. 真實 Access human／service token、撤權／金鑰輪替、所有入口與資產保護。
3. 指定 runner、手機瀏覽器與獨立 bot caller 的實際使用；Grok bot 與 agent 平台 adapter 尚未接入。
4. 斷線／重啟／晚到、排程關閉、配額與 unknown；備份、隔離還原及觀測窗口。

以上是完整 M1/產品 AC-06～08 的剩餘門檻；本機測試與 PR 合併不會把它們自動改成通過。

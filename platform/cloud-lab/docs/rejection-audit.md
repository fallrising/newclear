# RA：有界拒絕稽核

補上M1 HTTP拒絕的持久證據；以同一response request_id供operator在D1管理介面查找，不增加公開查詢API、grant或付費服務。既有Worker標準Web API與D1 SQL，無新依賴。

| AC | 驗收 |
| --- | --- |
| RA-01 | Worker產生的4xx在回應前嘗試保存一筆拒絕紀錄；request_id、UTC毫秒、固定route分類、GET/POST/OTHER、status、內部code及完整authenticate是否完成。成功／5xx不寫拒絕表。 |
| RA-02 | 不保存URL、query、command ID、principal、grant、IP、headers、token、signature或body。不由未驗證key/JWT聲稱身份；authenticated=0也可能是有效憑證但grant已撤銷。參數化SQL與表欄位界限。 |
| RA-03 | 獨立rejection_audit最多10000列，單SQL原子容量判斷，不刪除／覆寫舊證據；不占命令quota。回應header X-Cloud-Lab-Audit為persisted/full/unavailable/not_applicable；缺migration、DB失敗或滿額仍保留原錯誤status/code/request_id及retryable，不能冒稱記錄成功。 |
| RA-04 | RED→GREEN、SQLite關閉重開持久性、最後容量競爭、wrong-holder/stale-fence整列保全、原0001升級保全、本機workerd/D1及完整回歸／獨立審查。來源交付與live部署分開，不續權或要求ownerSafari測試。 |

## 記錄與查詢

新增append-only用途的0002 migration；應用沒有UPDATE/DELETE/自動清理。DB管理者仍有改寫能力，並非防竄改帳本。只在原handler catch中的4xx拒絕寫入；外層Cloudflare Access攔截、傳輸／程序失敗、未回應的請求及Cron（已有firings）不在此表。拒絕與稽核之間程序中斷可能沒有紀錄，不能稱完整exactly-once安全日誌；同一請求重送會有新request_id。

供已授權operator經既有D1管理連線唯讀使用（參數綁定，不把值插入SQL）：

```sql
SELECT request_id, observed_at, method, route, status, code, authenticated
FROM rejection_audit WHERE request_id = ?;
SELECT count(*) AS used, 10000 AS capacity FROM rejection_audit;
SELECT request_id, observed_at, method, route, status, code, authenticated
FROM rejection_audit ORDER BY observed_at DESC, request_id DESC LIMIT 20;
```

route只分類authorization-self/bootstrap/health-schedule/usage/commands/command/cancel/artifact/runner-claim/runner-report/assets/other，不保留路徑參數。沒有actor歸屬或command級關聯；只按request_id找單次拒絕。失敗body保持原API契約，新header表示保存結果，不保證客戶端收到response，也不授權自動重送命令。

## 容量、成本與上線

10000是獨立終身保留上限，沒有按天清除或覆寫。每次到達Worker的4xx最多一個額外D1 statement，滿額後仍有read，惡意流量仍會消耗Worker/D1額度；不能把有界儲存等同零費用／防DoS／provider配額監測。沿用Access封閉入口及Workers Free、不新增付費。若用滿，後續回應明示full；清理或歸檔須另訂具體保全／批准，不調高配額掩蓋。

部署先在原D1套用0002，再更新Worker；不改0001、不改業務列、grant、secrets、Access、runner或期限。舊Worker可與新增表並存；回退只回Worker並保留稽核表與資料，禁止DROP。尚未遷移的DB仍拒絕原請求並回unavailable，不能算live稽核已啟用。本輪驗證先用隔離本機資料；實際雲端變更需固定候選／前後保全與具體部署紀錄。

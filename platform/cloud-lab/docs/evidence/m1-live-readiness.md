# M1 真實環境接入前證據

Owner 指示繼續M1接入；基準 `85d934d1c11142cd490f0ecfe26ebb2e5bb65d0e`。本次是同一T-0003的準備交付，**不是M1-LIVE完成**。

## 連線前檢查

2026-10-27（UTC+8）透過已連接Cloudflare API只讀查詢：可列account／zones、現有Worker名稱與Access應用。D1 list回401並指明缺D1 Read／Write scopes；Worker custom-domain list被連線服務拒絕（403）並指明缺Workers Scripts Read／Write。兩個候選子網域沒有查到DNS record，但custom-domain查詢不可用，所以不能宣稱不存在Worker綁定。

真實account／zone IDs、域名、Access組織及既有資源名稱只留在私人操作上下文，不進public repo。沒有重連、授權變更、付費、建立資源、部署、DNS修改或排程啟用。已請owner補scope並指定網域／第一台runner；未得到答案前保持pending。

本機未找到wrangler、workerd、Python3.11或瀏覽器測試binary，沒有擅自安裝。Node/SQLite／Python測試不替代缺少的CF實際binding層。

## 本輪工具與本機驗證

- [離線bundle產生器](../deployment-bundle.md)：精確source、recipe digest、分離HMAC金鑰／grant、私有設定、managed-transaction seed與停用的schedule；從不連網。
- [有界probe](../live-probe.md)：預設read-only；顯式flag才送一次固定命令；送出前持久保存bytes，傳輸retry／resume不刷新key或deadline。
- `T-815-RED`／`T-815-REWORK-RED`保留初始缺實作與rework負向結果；10項bundle tests在`T-815-REWORK-ACCEPT`通過。
- `M1-probe-red`保留初始缺實作；11項probe tests在`M1-probe-http-fixed`通過，含真實loopback簽章及不追redirect。
- 初次整合 `M1-readiness-integrated`執行 `python3 platform/cloud-lab/tools/check.py`：31 Node＋52 Python＝83 tests passed，原始輸出為check-0.log／check-1.log。

測試fixture均為合成資料。此host的launcher storage及`/tmp`上層本身有Git metadata，新增outside-Git防護最初拒絕fixture；測試只隔離fixture根以上的Git-marker可見性，仍實際測nested `.git` file/directory/symlink與descriptor traversal。正式程式沒有放寬防護。worker曾使用小型替代launcher root作失敗診斷，未刪除／清理，詳見T-815原始report；證據保留。

## 審查修正與最終本機檢查

初次獨立審查提出三個P2：送出前缺目錄fsync、失效Git symlink漏判，以及巢狀回應／非字串command ID與capabilities缺型別檢查。`M1-probe-review-red`、`M1-dangling-red`、`M1-id-red`保留失敗結果；已加入六項回歸案例，修正後 `M1-final-source-check` 執行同一check.py，31 Node＋58 Python＝89 tests passed。落盤失敗不送出，異常回應不宣稱成功。初始sandbox loopback限制與錯用M0 audit的失敗、修正後重跑均保留於[獨立report](../../../../.team/reports/T-816.md)。

## 尚未驗收

最終獨立審查ACCEPT僅涵蓋本機準備工具；主導重新執行89項測試並逐檔檢查。`M1-premerge-docs`通過44個專案契約、7份llms、25份文件／191連結／12固定來源與diff檢查。真實CF、實際D1 seed/rollback、Access登入／service token、target runner／手機／bot、備份還原／成本仍pending；scope補足與選定target是下一個必要輸入。公開證據不含私人profile／token／生成bundle。

## 選定目標後的前檢查（2026-10-27 UTC+8）

Owner 在網域／第一台runner提案後指示繼續，採第一個建議網域及目前非root主機；精確帳戶、目標、身分與request JSON保存在Git外的私人持久目錄，未提交公開repo。這是T-0003-4的前檢查，沒有部署或live完成宣告。

- 重新授權後，D1 list、Workers domains、Access apps與目標DNS查詢均成功。新庫／Worker／網域／Access app沒有發現名稱衝突；既有產品資源保持原狀。
- 新憑證含D1／Workers Scripts讀寫scopes；不含建立Access app／policy、service token及查詢Access user所需的scopes。依API schema，下一步需要 `access-app.write`、`access-policy.write`、`access-service-token.read`、`access-service-token.write`、`access-audit-log.read`。最後一項僅用於按既有owner email定位Access身分，不能用Cloudflare帳戶ID替代JWT subject。
- Subscription查詢回403，明示OAuth不支援該endpoint；不重試、不自行升級方案。Workers account settings回傳usage model，但不能據此推定Free／Paid；已詢問owner確認方案，Paid需費用上限。
- 私人準備檔包含新Access app的精確hostname／IdP／現有owner email allowlist、24小時machine service-token建立請求、資源與runner計畫、未決ID清單。目錄0700／檔案0600，沒有產生secret、沒有發出建立請求。新application-scoped policy不修改既有產品的共用policy。
- 原runtime檔案與已驗證M1版本相同；本機固定collector在選定非root環境通過artifact contract，證據為shared-workspace `cloud-lab/M1-target-collector`。這不是雲端命令或看板驗收。

順序仍為：確認方案／範圍與取得必要scope → 準備並回讀Access保護 → CF runtime／獨立D1語義驗證與精確bundle → 部署審查 → 綁定入口 → 有界runner／bot／human驗收。workers.dev、preview與Cron維持關閉；完整恢復／手機／Grok／成本驗收仍pending。

本輪 `M1-target-plan-check` 通過私人檔案權限／目標綁定／精確email政策與未套用gate檢查、44專案契約、7 llms、25文件／196連結／12固定來源與diff檢查。沒有runtime程式變更，因此未重跑整個本機suite；後續部署仍需獨立審查及live證據。

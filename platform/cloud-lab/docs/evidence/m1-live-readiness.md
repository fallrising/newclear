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

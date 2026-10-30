# Delayed Cron window repair — HW01–04

[HW契約](../schedule-window.md)修正[HL首次真實失敗](m1-health-schedule-live.md)：provider在due後23秒建立命令，舊due+60秒期限只餘37秒，原runner下一輪claim正好已過期。原command沒有attempt／result／journal execution，已按原批准停用補償並保留失敗。

## 實作與驗證

只改scheduled handler的派送／執行截止為handler now+60／120秒，並以now+120檢查policy末端。due仍是not_before、idempotency及firing身份；已保存同due的重試保持原bytes／deadline，跨分鐘callback仍skip。既有一般API驗證限制與grant／dispatch／總截止護欄不變；未改runner、輪詢頻率、schema、secrets或其他角色授權。

共用launcher的HW-red以原實作跑14項排程測試，12pass／2fail：延遲callback後整分鐘claim沒有assignment，以及policy剩餘窗口未按實際handler時間拒絕。修正後HW-green14／14通過。新案例涵蓋23秒及59秒延遲→60秒輪詢→真實handler報告validated、同due重送整列不變、下一分鐘misfire、policy／grant剩餘不足與恰好120秒邊界。

HW-full執行`python3 platform/cloud-lab/tools/check.py`，67 Node＋295 Python＝362tests全過、零skip，包含既有SQLite／本機真實HTTP與Python collector閉環；保留Node experimental SQLite提示。這不是新的Cloudflare真實觸發驗收，也沒有重跑未改資產的12組瀏覽器情境；本機Python3.11仍未安裝／未跑。

[T848獨立source審查](../../../../.team/reports/T-848.md)ACCEPT，主導檢查source diff、完整日誌及scope。[T847](../../../../.team/reports/T-847.md)僅接受HL失敗／補償的誠實partial表述，不接受HL完成。

## 接續

此修正不保證任意儲存／網路延遲或runner故障下都能完成，只消除當分鐘provider延遲直接侵蝕派送預算。固定已審source、通過必要CI並合併後，才沿原HL截止重新規劃CAS revision與有傳播餘裕的UTC起點；保留第一筆失敗，新的provider觸發須另驗。原15分鐘頻率、原runner截止與零新增付費限制不變，主線AC-06～08仍pending。

文件檢查47project contracts／8llms索引通過；T847初次report validator因failed後接說明文字而拒絕，已保留失敗並按格式將結果放行末，不改PARTIAL或失敗內容。

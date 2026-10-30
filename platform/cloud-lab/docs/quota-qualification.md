# 應用配額隔離驗收 — QV01–04

Owner要求繼續開發。此輪為AC-08補應用准入邊界證據，使用原Worker與本機SQLiteD1；不是Cloudflare provider額度壓測，不修改live資料、授權、方案或runtime政策。

| AC | 驗收 |
| --- | --- |
| QV-01 | API於保留命令10000筆及滾動24h內1440筆拒絕新ID；最後一格可接受；舊歷史與原命令保持 |
| QV-02 | 滾動窗口使用created_at > now−24h；恰好邊界可釋放近期額度，總保留上限不會隨時間自動解除；讀取、同payload重送及衝突語義保持 |
| QV-03 | Cron和API共享准入上限；超限記skipped_quota且無孤兒命令／結果，重複due不改結果，恢復後只接受新due；本機交錯競爭最多接受一筆 |
| QV-04 | 有鑑別力的focused測試、完整回歸、獨立審查及文件／Git交付；local與provider證據分開，完整AC-08仍pending |

只增加隔離測試及證據文件；若發現runtime缺陷，先保留失敗再在本範圍修正。歷史批量fixture由真實API已取消命令複製，不冒稱10000次真實API／遠端執行。SQLiteD1不是workerd或遠端D1；Promise交錯不是多isolate／provider負載保證。

## 操作含義

10000是保留命令總數的應用護欄，1440是滾動24小時的新命令護欄，另有單active限制，unknown仍占用。它們不是Workers／D1免費方案保證，也不限制所有HTTP、Cron、nonce或查詢用量。取消或完成不退還命令額度；重送同一命令不產生新命令。24h窗口自然移動不刪歷史，總數到頂需另行設計可備份、可還原的retention方案；本輪不刪資料或自動調高上限。

到頂時先讀取／對帳既有command，禁止換idempotency key盲重試。Cron skipped_quota是該due的終局記錄，不能在後續額度恢復時補跑原due。provider用量觀測、完整故障矩陣、真人Access及模型對話仍見[剩餘工作](remaining-work.md)。

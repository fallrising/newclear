# T-0005 heartbeat 驗證與模型 review

2026-10-31。每 5 分鐘 terminal heartbeat；不擷取命令、不重跑命令，單一 in-flight，最終狀態等待 heartbeat 完成後才寫入。

## 實際檢查

- Node check + 43 tests：全部通過，0 skipped。heartbeat 四項測試用可注入 clock／reporter，驗證 300000ms 排程、單一請求、結尾等待、失敗恢復與 timer 清理；不是實際等候 5 分鐘或模型宿主驗收。
- 固定 Wrangler 4.156.0 真 workerd／SQLite smoke 通過，覆蓋實際命令 lifecycle 與重啟持久化；不把它冒充長時間 heartbeat soak。
- 全倉 indexes（50 contracts、8 llms.txt）、success contracts、diff checks 通過。
- production reporter 每次 HTTP 3 秒 timeout、最多三次有界重試；不會無限等待 heartbeat。每次 report 產生新 eventId，core 正常接受同 status 更新並更新時間與 revision。

## 唯讀 Claude review

以 `claude-opus-5-5` 指定模型、safe-mode、無工具、無 session persistence 執行兩次。CLI 回報 canonicalModel 均為 `claude-opus-5-5`。只提供公開程式 diff／測試，未提供憑證；每次 budget 上限 USD 2。CLI 回報兩次合計估算 USD 0.1603396，非帳單保證。

首輪指出：暫時 heartbeat 故障即使最終上報成功，也不應讓成功命令回 125。已修正：最終上報權威；歷史 heartbeat 失敗以 `heartbeatFailed` 與固定警告呈現。新增 heartbeat 與最終上報同時失敗回歸。

第二輪 verdict：PASS，無 blockers。確認單一 in-flight、結尾排序、timer 清理與失敗語意。審查範圍為程式 diff 與 heartbeat tests，未包含文件／實際執行；這是獨立模型 review，不冒充人工批准。文件由主導核對。

AC-07 整體仍 pending：原生宿主 hook、UI 觀察與崩潰恢復未驗收；無部署或 release。

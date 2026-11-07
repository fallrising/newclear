# FQ：故障矩陣與保留邊界

Owner繼續已交付ULR之後的工作。範圍是既有M1故障矩陣的逐列證據盤點、缺少的隔離競爭測試與資料保留設計，不延長授權、不呼叫模型、不部署／刪除／更改原服務或付費方案。

| AC | 驗收 |
| --- | --- |
| FQ-01 | M1十四列矩陣逐列對應具名測試／歷史live證據，標明實際層級與剩餘缺口；不以local代替remote，不要求重測Safari。 |
| FQ-02 | 隔離SQLite驗證取消／完成兩種次序及競爭、deadline/fence邊界、失敗回報不改原紀錄；對原始artifact bytes與digest及到期邊界有可判別斷言。 |
| FQ-03 | 保留方案逐類區分command/dedupe、artifact、firings、journal、grants、nonce及備份；到期不等於刪除，刪除前必須有接替去重／恢復策略。 |
| FQ-04 | focused／完整現有測試、必要mutation、獨立審查、文件檢查與正常PR交付；明示原始失敗與未跑事項。 |

本輪預期不改runtime行為；若測試發現實際缺陷，先保留RED再處理同範圍缺陷。針對既有行為的新增驗證不偽造初始失敗，以隔離source副本mutation檢查oracle鑑別力。SQL邊界是本機SQLite，不是多isolate D1或整機斷電。保留設計不產生DELETE計畫或自動清理工作。

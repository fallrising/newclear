# SDD 閱讀順序

先讀[總綱](../../SDD.md)，再依下列順序閱讀。本文集為 v0.1 設計；實作進度只看 [STATUS](../STATUS.md)。

| 文件 | 解決的問題 |
| --- | --- |
| [01 事件模型與 ingest](01-event-model-and-ingest.md) | 事件長什麼樣、誰能寫、如何去重、API 回應語義 |
| [02 儲存、封存與還原](02-storage-and-retention.md) | 資料表、熱資料期、封存流程、備份與還原 |
| [03 指標規則](03-metric-rules.md) | 規則格式、評估、回填、門檻事件 |
| [04 訂閱與投遞](04-subscriptions-and-delivery.md) | 訂閱模型、投遞狀態機、webhook 簽章、ntfy、決策系統契約 |
| [05 看板與查詢 API](05-board-and-api.md) | 頁面、查詢 API、自我觀測 |
| [06 安全、維運與驗收](06-security-operations-acceptance.md) | 信任邊界、威脅、部署邊界、里程碑驗收 |

官方依據集中在 [SOURCES](../SOURCES.md)。範例中的 ID、時間、網址與數值都是合成資料或明示的設計假設。

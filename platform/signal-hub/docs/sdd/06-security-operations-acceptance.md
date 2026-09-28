# 06 安全、維運與驗收

## 1. 信任邊界

| 角色 | 可以做 | 不可以做 |
| --- | --- | --- |
| 生產者 token | 寫入自己 `source_prefix` 與 `allowed_types` 的事件 | 讀取事件、寫入其他來源、使用 `signalhub.*` 類型 |
| 唯讀 token（AI agent、決策系統查詢用） | 查詢 API | 寫入、重放、重載設定 |
| Owner | 看板、重放、重載設定 | — |
| 中樞 process | 讀寫自己的資料庫與封存目錄；對允許清單內的目標發送 HTTP | 執行任何命令、存取其他主機、以 root 執行 |

## 2. 威脅與對策

| 威脅 | 對策 |
| --- | --- |
| 公網掃描與暴力嘗試 | 只綁定 tailnet 介面；沒有公網入口 |
| token 外洩後冒充來源 | 每個來源獨立 token，只能寫自己的前綴；資料庫只存雜湊；可單獨撤銷 |
| 偽造事件觸發決策系統 | 同上；決策系統只訂閱特定類型，並依 `source` 判斷可信度 |
| 事件中夾帶 secret 或個資 | 生產者負責；業務日誌只送衍生事件；中樞不宣稱能攔截 |
| webhook SSRF | 目標必須在允許清單內 |
| 偽造或重放 webhook | HMAC 簽章、時間戳檢查、delivery ID 去重（接收端） |
| 訂閱或規則迴圈 | 規則不能匹配 `signalhub.rule.*`；訂閱不能匹配自己的投遞失敗事件 |
| 磁碟寫滿 | `/v1/self` 回報可用空間；低於門檻時 ingest 回 `503` 而不是寫壞資料庫 |
| 設定錯誤導致服務失效 | 設定整份驗證，失敗則保留舊設定 |

Secret（token、webhook secret、ntfy token）只以 `*_ref` 指向執行期檔案，不寫入設定 repo、資料庫或日誌。本 public repository 的範例一律使用 `example.invalid` 與合成 ID。

## 3. 部署邊界

- 部署是 M6，需要 owner 另行授權；本 SDD 不授權任何部署或主機變更。
- 預定以 OneFleet 管理的一個 workload 執行，非 root，只掛載資料目錄與 secret 檔案。
- 實際的主機、tailnet 名稱、設定 repo 位置屬於私人資訊，放在 kernel 或私人設定 repo，不寫進本目錄。

## 4. 里程碑與驗收

| 里程碑 | 完成條件 | 對應驗收 |
| --- | --- | --- |
| M0 契約 | 事件 JSON Schema、設定 schema、OpenAPI、正反 fixtures 進 repo；參考 webhook 接收端的簽章 test vectors | schema 驗證所有 fixtures |
| M1 Ingest | ingest 與查詢 API、來源 token、去重、衝突紀錄 | AC-01–AC-06 |
| M2 看板 | 時間線、事件詳情、關聯鏈、來源新鮮度 | AC-40–AC-43 |
| M3 指標 | 規則評估、回填、門檻事件、圖表 | AC-20–AC-26、AC-44 |
| M4 投遞 | webhook、ntfy、摘要、重試、DLQ、重放 | AC-30–AC-37 |
| M5 封存 | 封存、備份、還原演練 | AC-10–AC-14 |
| M6 真實資料 | 三個生產者接入、部署、外部存活檢查 | 見下 |

**M6 驗收（需另行授權才開始）：**

- 發佈、巡檢、Alertmanager 三個來源的真實事件連續 7 天出現在時間線，沒有非預期的 `409`。
- 手動停掉一個生產者，看板在 2 倍預期間隔後標示 `silent`，手機收到通知。
- 手動停掉中樞，外部存活檢查在 5 分鐘內發出通知。
- 從前一天的快照在隔離環境還原成功。

**狀態要分開記錄：** 設計接受、PR 合併、功能驗收、部署、實際運行是不同的狀態，記在 [STATUS](../STATUS.md)。

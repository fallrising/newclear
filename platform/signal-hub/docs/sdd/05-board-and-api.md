# 05 看板與查詢 API

## 1. 看板要回答的問題

1. **某段時間發生了什麼？** → 時間線
2. **這件事的前因後果？** → 事件詳情與關聯鏈
3. **趨勢如何？** → 指標
4. **資料可不可信？** → 來源新鮮度、規則計算狀態
5. **送出去了嗎？** → 投遞

介面原則沿用 knowledge-base `44.02`：資訊密度可以高，但要有優先順序；動態效果不等於可觀測性；「沒有事件」不能被顯示成「一切正常」。

## 2. 頁面

| 頁面 | 內容 | 互動 |
| --- | --- | --- |
| 時間線（首頁） | 依 `time` 倒序的事件列表：時間、嚴重度、來源、類型、subject、summary | 時間範圍（快捷：1h、24h、7d、30d、自訂）；依來源、類型、嚴重度、subject 前綴、`correlationid` 篩選；游標分頁；篩選條件存在 URL，可以分享給自己的其他工具 |
| 事件詳情 | 原始 CloudEvent、`received_at`、時鐘偏差警告、`originurl` 連結 | 同一 `correlationid` 的事件依時間排成一條鏈；列出 `causationid` 指向的事件 |
| 指標 | 每條規則一張圖；版本分隔線；`partial` 桶以虛線表示；門檻線 | 時間範圍與分組選擇；顯示 `recomputable_from` 與最後計算時間 |
| 來源 | 每個來源的最後上報時間、預期間隔、狀態 | 狀態為 `fresh`、`late`（超過預期間隔）、`silent`（超過 2 倍）、`never` |
| 投遞 | 各訂閱的成功、重試中、DLQ 數量；最近嘗試紀錄 | DLQ 重放（需填理由） |
| 設定 | 目前生效的規則、訂閱、來源設定與其版本；最後一次載入結果 | 唯讀；修改走設定 repo 的 PR |

搜尋範圍：MVP 只比對 `type`、`subject`、`summary`；不做 `data` 全文搜尋。需要時再評估 SQLite FTS5。

## 3. 查詢 API

查詢 API 接受 owner 或唯讀 token；重放與重載只接受 owner。healthz／readyz 在 tailnet 內免 token，僅回傳狀態。時間參數為 RFC 3339，範圍 `[from,to)`；列表 API 用 `cursor` 分頁，預設100、單頁最多200筆。每個 endpoint 的欄位、錯誤與回應以 [OpenAPI](../../contracts/openapi.json) 為 M0 機械契約。

| 方法 | 路徑 | 說明 |
| --- | --- | --- |
| GET | `/v1/events?from&to&source&type&severity_min&subject_prefix&correlationid&q&cursor&limit` | 查詢事件；`type` 支援結尾 `*` |
| GET | `/v1/events/{seq}` | 單筆事件與它的關聯鏈 |
| GET | `/v1/metrics/{rule_id}?from&to&group` | rollup 時間序列，含版本與 `partial` 標記 |
| GET | `/v1/sources` | 來源新鮮度 |
| GET | `/v1/subscriptions`、`/v1/deliveries?subscription&state&cursor` | 投遞狀態 |
| POST | `/v1/deliveries/{delivery_id}:replay` | DLQ 重放；body 必須含 `reason` |
| POST | `/v1/config:reload` | 重新載入設定檔；驗證失敗則保留舊設定 |
| GET | `/healthz`、`/readyz` | 存活與就緒 |
| GET | `/v1/self` | 自我觀測數字，見下節 |

查詢 API 也提供給 AI agent 與決策系統使用，例如「過去 24 小時某服務的所有事件」。它們各自使用唯讀 token。

## 4. 自我觀測

中樞本身也是被觀測的對象。

**`/v1/self` 提供：** ingest 次數與錯誤（依錯誤碼）、去重與衝突次數、各訂閱待投遞與 DLQ 數、規則最後成功計算時間、最後一次封存結果、資料庫檔案大小、磁碟可用空間。

**中樞自己產生的事件：**

| 類型 | 何時 |
| --- | --- |
| `signalhub.source.silent`／`recovered` | 來源狀態進入或離開 `silent` |
| `signalhub.delivery.dlq` | 投遞進入 DLQ |
| `signalhub.rule.eval.failed` | 規則連續 3 次評估失敗 |
| `signalhub.archive.succeeded`／`failed` | 每日封存結果 |
| `signalhub.config.reloaded`／`rejected` | 設定重載結果 |

**中樞死掉時誰知道？** 中樞無法回報自己的停機，所以需要一個**中樞以外**的檢查：另一台主機定期請求 `/healthz`，失敗時直接發 ntfy。這在部署階段（M6）實作，屬於部署需求，不在中樞程式內。

## 5. 驗收

- AC-40：時間線在 30 天、約 3 萬筆的 fixtures 上，任一篩選組合的第一頁回應在 1 秒內（目標值，M2 量測）。
- AC-41：篩選條件寫在 URL 中，重新開啟 URL 得到相同結果。
- AC-42：同一 `correlationid` 的事件在詳情頁依時間排成一條鏈。
- AC-43：來源超過預期間隔 2 倍未上報時顯示 `silent`，並產生一次 `signalhub.source.silent` 事件；恢復時產生 `recovered`。
- AC-44：指標圖表正確顯示版本分隔與 `partial` 桶。
- AC-45：設定檔驗證失敗時，`/v1/config:reload` 回錯誤，舊設定繼續生效，並產生 `signalhub.config.rejected`。

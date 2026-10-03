# 04 訂閱與投遞

## 1. 訂閱模型

訂閱是一等物件，寫在設定檔中。「把某些事件交給某個系統」永遠用一條訂閱表達，不另寫推送程式。

```yaml
subscriptions:
  - id: decision-inspection
    filter:                      # 與規則 filter 相同的語法
      types: ["inspection.check.failed", "signalhub.rule.threshold.crossed"]
      severity_min: warning
    channel:
      kind: webhook              # webhook | ntfy
      url: https://decision.example.invalid/v1/signals
      secret_ref: file:/run/secrets/signalhub/decision-webhook.secret
    mode: immediate              # immediate | digest
    start: now                   # now | earliest_hot；預設 now，不補送歷史
  - id: phone-daily
    filter: { types: ["release.deploy.*", "inspection.check.*"], severity_min: notice }
    channel:
      kind: ntfy
      url: https://ntfy.example.invalid/signalhub-daily
      token_ref: file:/run/secrets/signalhub/ntfy.token
    mode: digest
    digest: { every: 24h, at: "08:30", timezone: Asia/Taipei, skip_empty: true }
```

- webhook 目標必須在設定的允許清單內（預設只允許 tailnet 主機），防止 SSRF。
- 新訂閱預設從建立當下開始，不補送歷史；`earliest_hot` 需明確指定。
- 訂閱的 filter 不能匹配該訂閱自己產生的投遞失敗事件（`signalhub.delivery.*` 的 `subject` 等於自己），避免迴圈。

M0 固定 webhook 為 immediate；ntfy 可 immediate 或 daily digest。digest 的時間窗、允許清單與簽章 bytes 規則見 [M0 契約](../../contracts/README.md)。

## 2. 投遞狀態機

```text
pending ──claim──▶ inflight ──2xx──▶ succeeded
   ▲                  │
   │   retryable      │ 逾時／5xx／429／連線失敗
   └──────────────────┤
                      │ 次數用盡或 4xx（非 408/429）
                      ▼
                     dlq ──手動 replay（附理由）──▶ pending
```

- **`delivery_id`** = `<subscription_id>:<event seq>`（摘要模式為 `<subscription_id>:digest:<window_start>`）。重試與重放都沿用同一個 ID。
- **重試：** 指數退避加隨機抖動，起始 30 秒，上限 1 小時，最多 12 次（約一天）。接受 `Retry-After`，但最多 1 小時。
- **claim** 以 lease 實作：`inflight` 超過 2 分鐘沒有結果就回到 `pending`。process 重啟後也依此恢復。這代表**同一個 delivery 可能被送出兩次**，接收端必須依 `delivery_id` 去重。
- **順序：** 同一訂閱依 `seq` 順序嘗試，但重試會打亂順序；不保證有序。接收端應依事件 `time` 或 `seq` 自行排序。
- **DLQ：** 進入 DLQ 時發出 `signalhub.delivery.dlq` 事件。重放需要 owner 操作並填寫理由，寫入 `audit_log`。
- 每次嘗試記錄在 `delivery_attempts`：時間、HTTP 狀態、耗時、錯誤摘要（不含回應 body）。

## 3. Webhook

- `POST`，body 是 CloudEvents 結構化 JSON（`application/cloudevents+json`），與事件庫中的原始事件相同。[S05]
- 標頭：
  - `Signalhub-Delivery-Id`
  - `Signalhub-Timestamp`：Unix 秒
  - `Signalhub-Signature`：`v1=<hex>`，HMAC-SHA256，輸入為 `v1.<timestamp>.<delivery_id>.<body bytes>`
- 接收端必須：驗證簽章；拒絕與自身時鐘相差超過 5 分鐘的請求；依 `Signalhub-Delivery-Id` 去重；**在持久化接受之後**才回 2xx，而不是處理完成之後。

設計沿用 kernel `nats-push-bridge` 規格的 stable delivery ID、簽章與重放規則。

## 4. ntfy

- 以 HTTP POST 發布到 topic；認證用 token。[S06]
- 對映：
  - `X-Title`：`[<severity>] <type>`
  - body：`summary`，沒有時用 `subject`
  - `X-Priority`：`critical`→5、`error`→4、`warning`→3、其他→2
  - `X-Click`：`originurl`，沒有時連回看板的事件詳情頁
  - `X-Tags`：`source` 的最後一段
- 摘要模式：一個視窗內所有匹配事件合成一則訊息，列出前 20 筆與總數，點擊連到看板的對應時段。`skip_empty: true` 時空視窗不送。

## 決策系統契約

決策系統是另一個元件，有自己的 SDD。本節只定義它與中樞之間的約定。

**中樞 → 決策系統：** 一條 `mode: immediate` 的 webhook 訂閱。只送 filter 選中的事件，不是全部事件。

**決策系統的義務：**

1. 依 `Signalhub-Delivery-Id` 去重；同一事件也可能因 Alertmanager 重送等原因以不同 `id` 出現，業務層面的合併由決策系統負責。
2. 收到後先持久化再回 2xx；決策可能要等人選擇，不能讓中樞等待。
3. 以自己的 source token 把過程送回中樞：

| 類型 | 何時 | `correlationid` | `causationid` |
| --- | --- | --- | --- |
| `decision.case.opened` | 建立待處理項 | case ID | 觸發事件的 `<source>#<id>` |
| `decision.proposal.ready` | AI 從策略庫挑出候選並排序 | case ID | `decision.case.opened` |
| `decision.choice.made` | owner 選擇並授權某個策略版本 | case ID | `decision.proposal.ready` |
| `decision.case.expired` | 無人選擇而過期，未執行任何動作 | case ID | `decision.case.opened` |
| `execution.run.started`／`succeeded`／`failed`／`uncertain` | 執行器回報（由執行器自己的 token 送） | case ID | `decision.choice.made` |

中樞不理解這些類型的語義，只依 `correlationid` 在看板上串成一條鏈，並讓它們可以被指標規則統計（例如策略成功率）。

**權限：** 決策系統與執行器各有自己的 token，只能寫入自己的 `source_prefix`，不能冒充其他來源。

## 5. 驗收

- AC-30：接收端回 500 三次後回 200，同一 `delivery_id` 共嘗試四次，最終 `succeeded`。
- AC-31：接收端回 400，直接進 DLQ 並產生 `signalhub.delivery.dlq` 事件。
- AC-32：DLQ 重放沿用原 `delivery_id`，沒有填理由時拒絕。
- AC-33：`inflight` 中 process 被終止，重啟後該投遞在 lease 到期後重送。
- AC-34：簽章錯誤、時間戳超過 5 分鐘、`delivery_id` 重複的 fixtures 都被參考接收端拒絕或去重。
- AC-35：webhook 目標不在允許清單時，設定載入失敗。
- AC-36：摘要模式的空視窗在 `skip_empty: true` 時不送出。
- AC-37：以 fixtures 模擬決策系統送回的六種事件，看板能依 `correlationid` 串成一條鏈。

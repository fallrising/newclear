# 01 事件模型與 ingest

## 1. 事件信封

採用 CloudEvents 1.0 的 JSON 結構化格式。[S01][S05]

| 屬性 | 必填 | 中樞的規則 |
| --- | --- | --- |
| `specversion` | 是 | 必須是 `1.0` |
| `id` | 是 | 生產者產生；在同一個 `source` 內唯一；長度 1–128 |
| `source` | 是 | URI-reference；必須落在該 token 註冊的 source 前綴內 |
| `type` | 是 | 反向網域風格的小寫字串，例如 `release.deploy.succeeded` |
| `time` | 中樞要求必填 | RFC 3339；表示事情發生的時間 |
| `subject` | 否 | 事件描述的對象，例如服務名、主機名、新聞來源 |
| `datacontenttype` | 否 | 只接受 `application/json` 或省略 |
| `data` | 否 | JSON object，序列化後 ≤ 16 KiB |

### Extension attributes

名稱遵守 CloudEvents 規則：只能用小寫字母與數字，建議不超過 20 字元。[S01]

| Extension | 型別 | 用途 |
| --- | --- | --- |
| `severity` | enum | `debug`、`info`、`notice`、`warning`、`error`、`critical`；省略時為 `info` |
| `summary` | string ≤ 280 | 一行人類可讀摘要；時間線與通知直接顯示 |
| `originurl` | URI | 回到原系統的連結（CI run、日誌查詢、新聞原文） |
| `correlationid` | string ≤ 128 | 同一條處理鏈的關聯 ID；決策系統以 case ID 填入 |
| `causationid` | string ≤ 256 | 直接觸發本事件的事件，格式 `<source>#<id>` |

其他 extension 會保存但不索引。

### 事件類型命名

`<領域>.<對象>.<動作或結果>`，全部小寫。M6 首批類型：

| 類型 | 生產者 |
| --- | --- |
| `release.deploy.started`／`succeeded`／`failed` | 發佈管線 |
| `inspection.check.passed`／`failed` | 巡檢腳本 |
| `alertmanager.alert.firing`／`resolved` | Alertmanager adapter |
| `signalhub.rule.threshold.crossed`／`recovered` | 中樞自己的規則 |
| `signalhub.source.silent`／`recovered` | 中樞自我觀測 |

`signalhub.*` 前綴保留給中樞自己，外部 token 不能使用。

### 資料內容的界線

- 業務日誌不送原文，只送由日誌規則產生的事件，附 `originurl` 回查。
- 生產者負責不放 secret、token、個人識別資訊。中樞不做 secret 掃描，也不保證能攔截。
- 大型內容（報告、截圖）放在原系統，事件只帶連結。

## 2. 來源註冊

每個生產者在設定檔中註冊，拿到一個 token。

```yaml
sources:
  - name: release-pipeline
    source_prefix: "urn:signalhub:release"
    allowed_types: ["release.deploy.*"]
    expected_interval: 24h      # 超過未上報就標示為沉默；省略表示不檢查
    retention_days: 90          # 省略時用全域預設
    token_ref: file:/run/secrets/signalhub/release-pipeline.token
```

- token 以 `token_ref` 從執行期檔案讀取，設定檔本身不含 secret。
- 資料庫只存 token 的 SHA-256 雜湊。
- 一個 token 只能寫入自己的 `source_prefix` 與 `allowed_types`。

## 3. Ingest API

| 方法 | 路徑 | Content-Type | 說明 |
| --- | --- | --- | --- |
| POST | `/v1/events` | `application/cloudevents+json` | 單筆 |
| POST | `/v1/events` | `application/cloudevents-batch+json` | 批次，最多 100 筆 |
| POST | `/v1/adapters/alertmanager` | `application/json` | Alertmanager webhook v4 payload |

認證：`Authorization: Bearer <token>`。

### 回應語義

**只有在 SQLite 交易 commit 之後才回 2xx。**

| 情況 | 回應 |
| --- | --- |
| 新事件寫入 | `202`，body 含 `seq` |
| 重複：同 `source + id`，內容雜湊相同 | `200`，body 含原本的 `seq` 與 `duplicate: true` |
| 衝突：同 `source + id`，內容不同 | `409`；原事件保留，衝突寫入 `ingest_conflicts` 供查看 |
| 格式錯誤、超過大小、`type` 不在允許範圍 | `400` 或 `413`，附錯誤碼 |
| token 無效或越權 | `401`／`403` |
| 資料庫忙碌或磁碟錯誤 | `503`，生產者應重試 |

批次請求逐筆回結果；一筆失敗不影響其他筆。內容雜湊以 canonical JSON（排序 key、無空白）計算，不含 `seq` 等中樞自己加的欄位。

### 時間

- `time` 是事件發生時間，時間線依它排序。
- 中樞另記 `received_at`。
- `time` 比 `received_at` 晚超過 5 分鐘：接受，但標記 `clock_skew`，看板顯示警告。
- 遲到事件照常接受。落在已封存日期的事件如何處理，見 [02](02-storage-and-retention.md#遲到事件)。

## 4. Alertmanager adapter

把 webhook v4 payload 拆成每個 alert 一筆事件。[S02]

| CloudEvents 欄位 | 來源 |
| --- | --- |
| `source` | `urn:signalhub:alertmanager:<receiver>` |
| `id` | `<fingerprint>:<startsAt>:<status>` |
| `type` | `alertmanager.alert.firing` 或 `alertmanager.alert.resolved` |
| `time` | firing 用 `startsAt`，resolved 用 `endsAt` |
| `subject` | `labels.alertname` |
| `severity` | `labels.severity`，對映不到時為 `warning` |
| `summary` | `annotations.summary`，沒有時用 alertname |
| `originurl` | `generatorURL` |
| `data` | `labels`、`annotations`、`groupKey` |

Alertmanager 重送同一個 alert 時 `id` 相同，所以由去重吸收。

## 5. 驗收

- AC-01：同一事件連送兩次，只存一筆，第二次回 `200` 並帶 `duplicate: true`。
- AC-02：同一 `source + id` 但內容不同，回 `409`，原事件不變，衝突可查。
- AC-03：token 寫入別的 `source_prefix` 或未允許的 `type`，回 `403`，不寫入。
- AC-04：`data` 超過 16 KiB 回 `413`。
- AC-05：批次中一筆格式錯誤，其他筆仍成功寫入，回應逐筆標明結果。
- AC-06：Alertmanager 對同一 alert 重送 firing，只產生一筆事件；resolved 產生另一筆。

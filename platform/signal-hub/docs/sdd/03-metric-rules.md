# 03 指標規則

## 1. 目的

讓 owner 用設定檔描述「想看的數字」，中樞把事件聚合成時間序列並畫成圖表。範圍包括告警，但不限於告警：例如每日發佈次數、各來源事件量、巡檢失敗率、新聞主題數量、策略執行成功率。

指標是事件的**投影**：規則改了，可以從事件重算。

## 2. 規則格式

```yaml
rules:
  - id: inspection-failures
    version: 3
    title: 巡檢失敗次數
    filter:
      types: ["inspection.check.failed"]
      sources: ["urn:signalhub:inspection*"]
      severity_min: warning
      subject_prefix: ""
      data:                      # 選用；只支援等值比對
        environment: production
    aggregation:
      fn: count                  # count | count_distinct | sum | min | max | avg
      field: ""                  # count 以外必填，例如 data.duration_ms 或 subject
    bucket: 1h                   # 5m | 1h | 1d
    group_by: [subject]          # 最多 2 個：source、type、subject、severity 或 data.<path>
    threshold:                   # 選用
      op: ">="
      value: 3
      for_buckets: 2             # 連續幾個桶成立才觸發
      severity: error
```

限制與理由：

- **不開放 SQL 或任意運算式。** 受限格式可以驗證、可以讓 AI agent 安全修改，也能對應到 LogsQL 的 `stats by (_time:1h) count()` 這類查詢，保留日後改用 VictoriaLogs 投影的路徑。[S03]
- **不支援百分位數。** MVP 不需要，而 SQLite 沒有內建；需要時在 Go 端實作並另行驗收。
- **`group_by` 最多 2 個欄位，每條規則每桶最多 200 個分組。** 超過的分組併入 `__other__`，避免高基數把資料表撐大。
- **`filter.data` 只支援等值比對**，路徑深度最多 3 層。

## 3. 版本

- `version` 由人寫在設定檔中；中樞另外計算規則內容的雜湊。
- 內容變了但 `version` 沒變：拒絕載入整份設定並記錄錯誤，避免同一版本號代表兩種計算方式。
- 每個 rollup 都記錄產生它的 `rule_version`。圖表遇到版本交界時畫出分隔線。

## 4. 評估

- 每分鐘執行一次。
- 對每條規則計算：目前未結束的桶（標記 `partial`），以及最近 **2 個桶或 24 小時內（取較短者）** 已結束的桶。重算已結束的桶是為了吸收遲到事件。
- 結果寫入 `rollups(rule_id, rule_version, bucket_start, group_key, value, sample_count, partial, computed_at)`，以前四個欄位為主鍵覆寫。
- 單條規則評估失敗不影響其他規則；連續失敗時發出 `signalhub.rule.eval.failed` 事件。

## 5. 回填

規則新增或 `version` 改變時，自動從**熱資料期內最早的事件**開始重算。

- 看板顯示每條規則的 `recomputable_from`，也就是目前熱資料最早的時間。
- 更早的舊版本 rollup 保留不動；圖表標示「此段為舊版本規則」。
- 需要重算更早的歷史時，先匯回封存日期（見 [02](02-storage-and-retention.md#5-還原)），再手動觸發 `signalhub rules backfill --rule <id> --from <date>`。

以每天 1000 筆、熱資料 90 天估算，回填一條規則最多掃描約 9 萬筆，SQLite 可以在單次交易內完成。這是推算，M3 需要量測。

## 6. 門檻事件

規則設有 `threshold` 時：

- 連續 `for_buckets` 個已結束的桶成立 → 發出 `signalhub.rule.threshold.crossed`。
- 之後連續 `for_buckets` 個桶不成立 → 發出 `signalhub.rule.threshold.recovered`。
- 事件 `source` 為 `urn:signalhub:rules:<rule_id>`；`id` 為 `<rule_id>:<version>:<group_key>:<bucket_start>:<crossed|recovered>`，重算時不會產生重複事件。
- 門檻事件走正常 ingest 路徑，可以被訂閱，決策系統也可以訂閱它們。

**防止迴圈：** 規則的 `filter` 不能匹配 `signalhub.rule.*` 類型的事件。載入時檢查，違反則拒絕。

## 7. 驗收

- AC-20：一條 count 規則在固定 fixtures 上產生的 rollup 與預期值完全一致。
- AC-21：遲到事件落在最近兩個桶內時，rollup 自動更新。
- AC-22：規則 `version` 改變後自動回填熱資料期，圖表出現版本分隔。
- AC-23：內容變了但 `version` 沒變的設定被拒絕，舊設定繼續生效。
- AC-24：門檻連續成立 `for_buckets` 次只發出一次 crossed 事件；重算不產生重複事件。
- AC-25：匹配 `signalhub.rule.*` 的規則在載入時被拒絕。
- AC-26：分組超過 200 時多出的部分併入 `__other__`。

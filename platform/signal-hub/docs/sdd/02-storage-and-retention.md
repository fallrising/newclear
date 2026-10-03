# 02 儲存、封存與還原

## 1. 原則

- SQLite（WAL 模式）是唯一權威。
- 事件 append-only：寫入後不修改，只會在封存後刪除。
- 所有破壞性步驟（刪除已封存事件）必須在驗證成功之後才執行。

## 2. 主要資料表

欄位為邏輯設計；M1 起以 migration 檔落實。

| 表 | 主要欄位 | 說明 |
| --- | --- | --- |
| `events` | `seq` PK 自增、`source`、`id`、`type`、`subject`、`time`、`received_at`、`severity`、`summary`、`originurl`、`correlationid`、`causationid`、`content_hash`、`raw_json`、`clock_skew` | UNIQUE(`source`,`id`)；索引 (`time`)、(`source`,`time`)、(`type`,`time`)、(`correlationid`) |
| `ingest_conflicts` | `source`、`id`、`received_at`、`content_hash`、`raw_json` | 409 衝突紀錄；保留 30 天 |
| `sources_state` | `name`、`last_received_at`、`last_event_time`、`status` | 新鮮度狀態，由 ingest 與 evaluator 更新 |
| `rules`、`rule_versions` | 見 [03](03-metric-rules.md) | 目前生效與歷史版本 |
| `rollups` | 見 [03](03-metric-rules.md) | 指標結果 |
| `subscriptions`、`deliveries`、`delivery_attempts` | 見 [04](04-subscriptions-and-delivery.md) | 投遞狀態 |
| `archives` | `day`、`part`、`path`、`event_count`、`sha256`、`first_seq`、`last_seq`、`created_at`、`verified_at`、`purged_at` | 封存 manifest |
| `audit_log` | `at`、`actor`、`action`、`target`、`reason` | 手動重放、還原、設定重載等 |

`seq` 是中樞內部的單調序號，用於分頁、投遞游標與封存範圍；它不是事件的業務 ID。

## 3. 熱資料期與封存

**熱資料期：** 預設 90 天，可在來源設定中覆寫。以事件的 `time` 判斷。

**封存流程（每天一次）：**

1. 找出所有「整天都已超過熱資料期」的日期 D（依 UTC 日期）。
2. 將日期 D 的事件依 `seq` 順序寫成 `archive/events/YYYY/MM/DD.part-N.jsonl.gz`，每行一筆原始 CloudEvent。
3. 寫完後重新讀取檔案，核對筆數與 SHA-256，寫入 `archives` 的 `verified_at`。
4. 核對成功後，在一個交易中刪除這些 `seq` 的事件，寫入 `purged_at`。
5. 任何一步失敗：不刪除，發出 `signalhub.archive.failed` 事件，下次再試。

封存檔保留 CloudEvents 原樣，可以被任何工具讀取，也可以匯回中樞。

### 遲到事件

事件落在已封存的日期時，照常寫入熱資料庫。下一次封存把它寫成同一天的新 part（`part-N+1`），不改寫已存在的封存檔。

### 不隨事件刪除的資料

- 指標 rollup：保留 2 年（可設定），趨勢圖因此能看得比原始事件久。
- `archives` manifest：永久保留，用來回答「某天的事件在哪裡」。
- 決策與執行紀錄：屬於決策系統，不在這裡。

## 4. 備份

- 每天以 SQLite online backup（或 `VACUUM INTO`）產生一致的資料庫快照。
- 快照與封存檔一起交給既有的備份工具送到異地。選用哪個工具由部署階段決定；中樞只保證產出一致的檔案並記錄其雜湊。
- 備份不包含 token 等 secret；secret 由部署環境管理。

## 5. 還原

| 情境 | 做法 |
| --- | --- |
| 資料庫損毀 | 停止服務 → 用最新快照取代資料庫 → 啟動；快照後的事件由生產者重試補回（生產者需在收到 2xx 前持續重試） |
| 需要查已封存的日期 | `signalhub archive import --day YYYY-MM-DD`：依 `source + id` 去重匯回，事件標記 `restored`，在設定的天數後再次封存 |
| 需要重算更早的指標 | 先匯回相關日期，再觸發回填，見 [03](03-metric-rules.md#5-回填) |

所有還原動作寫入 `audit_log`。

## 6. 驗收

- AC-10：封存後，`archives` 記錄的筆數等於刪除的筆數，檔案 SHA-256 與 manifest 一致。
- AC-11：封存檔寫入或驗證失敗時，熱資料庫中的事件一筆都不刪。
- AC-12：已封存日期的遲到事件寫成新 part，舊檔案內容不變。
- AC-13：匯回封存日期後，事件可以被查詢；重複匯回不產生重複事件。
- AC-14：從快照還原的演練在隔離環境完成，並記錄在 STATUS。

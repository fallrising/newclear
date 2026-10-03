# 租戶寫入限制（P1-02）

`limits.New(tenant, Options)` 建立單一租戶的限制器；不啟動背景 goroutine、不做 I/O、不等待 token 補充。呼叫端負責限制租戶實例總數與生命週期。此套件處理正規化後的 UTM；P1-03 接 pipeline/batcher adapters；receiver、自身指標填值與告警整合依後續任務實作。

`Resolve` 的順序為內建預設 → `Options.Global` → `Options.Tenant`；pointer override 可明確表達零速率與 false。無效負數或零保護上限回 `spi.ErrBadRequest`。速率未指定時無限制；指定速率但未指定 burst 時，burst 為一秒的速率。byte rate/burst 上限為 2^53，以維持 float64 bucket 的整數 byte 精度。`AllowBytes` 接收實際解壓後 byte 數、立即回覆；拒絕分類為 `spi.ErrThrottled`。超過 burst 的請求無法單靠等待變成可接受，回傳 retry delay 0，呼叫端需縮小請求。

## 輸出與身份

`Metrics`、`Logs`、`Spans` 回傳已接受資料、`Report`、錯誤。單筆超限以 report 表達部分拒絕；取消或整批超過 `MaxRecords` 則回錯誤。取消途中可能已完成較早記錄的限制決策；呼叫端需處理部分結果與 report。所有輸出 map/slice/resource/histogram/exemplar/event/link 為獨立副本，可修改而不影響輸入。限制器不承諾支援呼叫端同時修改同一輸入。

指標在檢查上限與計算 fingerprint 前，注入 `__name__` 與 `__tenant__`；已提供的身份值不一致則拒絕。40 個 labels 的預設上限包含這兩個系統 labels。metric identity 不截斷；超過 `MaxLabelValueLength` 的 metric name 拒絕為 `too_large`。tenant ID 不得為空或超過 2048 bytes。系統 labels 保留身份，較小的使用者長度覆寫不截斷 tenant；其餘系統欄位仍受內建長度上限保護。

使用者 label name/value 依 bytes 截斷；合法 UTF-8 不切斷 rune，非 UTF-8 byte 字串只依 bytes 裁切。截斷碰撞時保留原始 name/value 字典序第一個，report 記錄其餘丟棄。截斷前後都套用 denylist，防止原本允許的名稱被截成 `request_id`。日誌被拒絕的 labels 降為 Attrs；衝突保留既有 Attr 並 report。指標沒有 Attrs，故丟棄該 label 並 report；exemplar 的 trace context 不屬於 series identity，保持原樣。

日誌超長加上 `prism.truncated=true`。Attrs 上限依每個 map 套用，包括 resource、span event/link；保留字典序前 N 個。`prism.truncated=true` 優先保留並占用 N 中的一格，再保留前 N-1 個普通 keys，故最小 cap 1 時仍可保留控制標記。

## 有界狀態與時間窗

| 狀態 | 上限與到期 |
|---|---|
| exact series LRU / per-metric counts | 最多 `MaxActiveSeriesPerTenant`（預設 500000），每個 metric 最多 50000；一小時未見即到期 |
| HLL | 固定 16384 registers + 16384×52 個 uint32 rank counters，總計 3424256 bytes；exact unique admission 上限不得超過 MaxUint32，避免 counter overflow |
| 五分鐘 label value LRU | `MaxCardinalityLabels` 預設 4096、`MaxCardinalityValues` 預設 100000（全實例）；每個 distinct value 五分鐘未见即到期 |
| trace trackers | `MaxTraces` 預設 1024、`MaxTrackedSpans` 預設 100000（全實例），每個 trace 最多 20000 unique span IDs；`TraceTTL` 預設一小時 inactivity |
| batch / nested elements | `MaxRecords` 與 `MaxRecordElements` 各預設 100000；後者包含 labels、Attrs、resource Attrs、histogram arrays、exemplar labels、span events/links 與其 Attrs |
| report events | Alarms + TruncatedTraces 合計最多 `MaxReportEvents`（預設 128），省略數記於 `EventOverflow` |

LRU 只移除已到期的身份，絕不以新身份逐出仍有效的身份；tenant cap 拒絕新 series，既有 series 仍可持續寫入。metric 空計數、空 label tracker 與過期 trace state 都移除。HLL 的 rank-frequency table 可在 exact series 到期時扣除其貢獻，保留其他 colliding series 的 rank，因此不是整點清零的 tumbling window。`Snapshot` 同時提供 exact counts 與 HLL estimate；expire 在 processing/snapshot 時惰性執行，不需背景掃描。clock 回退不倒轉既有狀態時間。

label distinct tracking 在資料通過 series admission 後才 commit；被拒絕資料不占 HLL、active series 或 value tracker 空間。值的身份使用穩定 uint64 fingerprint，因此與 series hash 一樣有極低的 collision 風險。超過 threshold（預設 10000）的首次 crossing 發出 `high_cardinality_label` alarm；回到 threshold 以下後可再次 crossing。auto-drop 預設 false；true 時在計算 series fingerprint 前移除超標 label。unknown tracker/value 到達 supporting capacity 即拒絕 `cardinality`，不以 silent eviction 放過檢查；這些保護可能比資料配額更早觸發。

trace duplicate span IDs 不增長計數，仍允許重複寫入。超過 span cap 拒絕新 span，保留 duplicate，標記同批回傳的該 trace spans，後續已截斷 trace 的 accepted spans 也標記。`TruncatedTraces` 告知下游先前已持久化 spans 可能需要 trace-level metadata；此套件無法回頭修改已儲存資料。aggregate span/trace tracker capacity 拒絕未知身份為 `cardinality`。

所有長迴圈檢查 context；共享狀態使用可取消的一格 channel lock，等待者取消不需等待其他 batch 完成。Attr key 收集保留 `maps.Keys` 的逐項 cancellation 檢查後 `slices.Sort`，因此不使用無 cancellation hook 的 `slices.Sorted`；typed comparison 使用 `cmp.Compare`、report membership 使用 `slices.Contains`。

上述容量是 entry/element 上限。返回的 Attrs 值沒有 SDD 中不存在的額外 byte 限制；receiver 仍須依 SDD 限制解壓後 request bytes。限制器 retained metric/label/trace keys 均與 caller backing buffer 分離；metric/label key 長度受上限保護。多個租戶的總記憶體由未來 owner 管理，不能把單租戶有界當作全行程無條件有界。

## 可觀測性與後續整合

Report 的 `Normalized`/`Rejected` 使用 20 登記的 action/reason；warning、alarm kind 僅供診斷，不可直接當新 telemetry label domain。`Normalized` 記錄已嘗試的轉換，即使該點其後被另一道 quota 拒絕；`Rejected` 計數每個實際拒絕項目。alarm 的 metric/label 與 truncated trace IDs 有共同事件容量；EventOverflow 保留省略證據，下游需另限制其 metrics 的 lifetime label sets。

Normalize 已先裁切 Attrs、移除部分 denied labels。P1-03 必須把租戶有效值同步傳给 normalize，較大的 downstream override 無法還原 upstream 已丟棄資料。本 task 不新增 YAML、SPI、telemetry registry 或 receiver 行為。stdlib token bucket 是不新增 dependency 的內部實作；HTTP 429/Retry-After、gRPC RESOURCE_EXHAUSTED、內建告警路由留給後续任務。

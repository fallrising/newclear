# pg-jev input policy lab — v1

## 目的與責任

以獨立實驗回答「語意輸入判斷、對話攔截、模型分流能不能使用 pg-jev」。固定 upstream `8d9598d87d5ff460998d91ec070226176024a841` / 0.2.1；使用 PostgreSQL 16 + PL/Python。預設只合成資料，provider 為 exact-match oracle。OS image/packages 隨 tag 更新，不能聲稱 bitwise reproducible；測試固定的是 extension source 與 policy contract。

輸入僅是當前單則文字，未納入多輪歷史；跨輪意圖／指代及工具輸出注入尚未評估。

這是控制端的 decision 建議層，不生成回答、不执行工具、不授予權限、不變更既有平台。確定性 byte／schema 驗證在呼叫分類器前完成；真實 user identity、tenant、budget 仍由原平台驗證，lab 不模擬成已完成。

## 流程與資料

1. `classify(text, evaluator)` 檢查非空 UTF-8、無 NUL、最多 4096 bytes；無效輸入 block，零 provider 呼叫。
2. PostgreSQL adapter 用匿名 record 只投影 `text`，避免從共享 conversations 表預讀其他 row。文字以 base64 SQL expression 傳入 stdin，沒有 shell interpolation／psql command injection。
3. 真 pg-jev 分別問 Noul 風險與 Choice 路由；兩個邏輯問題可能產生兩次 API 請求，不宣稱一個 batch 可包這兩種判斷。即使最後 block，這版仍計算兩個訊號。
4. Policy 驗證回覆，只回 action／route／reason／policy revision／dispatch=false。沒有保存原文、model call 或 provider credentials。
5. 每次 psql 為新 session，明確犧牲跨 request cache；設定固定本機 mock URL、fixture model、並行 1、batch 1、statement 最多 2 rows／16384 chars、1.5s statement timeout、0.5s HTTP socket timeout與 8s subprocess timeout。

`jev.max_rows_per_statement` 計算的是對問題送出的 row 數，不是唯一輸入數；同一輸入兩個問題需要兩份額度。這是 lab 上限，不是帳單預算。上游有內部 retry；query timeout 不保證背景 HTTP 即時結束或取消計費，runtime container 在測試結束清理。

## Policy lab-v1

| 條件 | action | route |
| --- | --- | --- |
| 無效／空白／NUL／超過 4096 UTF-8 bytes | block | null |
| 風險值非法或 provider／DB failure | review | null |
| risk >= 0.85 | block | null |
| 0.35 <= risk < 0.85 | review | null |
| risk < 0.35，route 非法／分布不合法 | review | null |
| risk < 0.35，route confidence 或選項 probability < 0.75 | allow | reasoning |
| 其他合法高信心 route | allow | small / coding / reasoning |

Threshold 為合成流程參數，沒有校準證據，不直接用於 production。Probability 不接受 bool、NaN、infinity、字串或範圍外值。Choice 要求三個固定選項、和為 1（容許 1e-6）、choice 為最大機率選項。

風險高時不需要有效 route 就 block；不以高 routing confidence 覆蓋 safety uncertainty。此風險題只問 credential theft／private secret／authorization bypass，不代表通用 moderation taxonomy，也不能保證抵抗 prompt injection。

## pg-jev 的採用限制（固定版本源碼觀察）

- PostgreSQL 14–17 是 upstream 支援範圍；本 lab 僅測 16。需 superuser 安裝 `plpython3u`，多數無此能力的 managed Postgres 不適用。
- `to_json(row)` 會送出所有傳入欄位；base-table read-ahead 可能送相鄰行。不可把共享表 + 外層 WHERE 當資料最小化或 tenant authorization 的保證；正式批次需先建立已授權、只含必要欄位的獨立資料集。
- Cache key 包含 relation type／question／kind／options／row hash，未含 API URL 或 model。不得在同一 session 切模型再相信旧結果；需新 session 或清 cache。Cache 無全域大小上限，`max_prefetch_rows` 不控制總 cache memory。
- Upstream 是 STABLE SQL function 內做網路 I/O；外部錯誤會使 statement 失敗、長查詢會占用 DB connection。不能在長 transaction 裡等待分類器。
- 自訂 GUC 的 endpoint、key、model 不是授權邊界。Lab 使用獨立 network-disabled DB；正式部署須受控 service role／DB egress／固定 endpoint，不能讓不可信 SQL caller 任意修改 URL 來借 DB 網路權限。
- `jev_stats()` 費用使用 TypeSafe 價目常數，即使接 mock/local server 仍如此；本 lab 不用它推算真費用。真實 latency、成本與校準需另做實驗。

## 驗收

| Gate | 實作／證據 |
| --- | --- |
| schema、threshold、優先序、zero-call precheck | `tests/test_policy.py` |
| HTTP request shape、text-only projection、拒絕 key | 同上 MockContractTests |
| 真 extension + 九案例 + 特殊 SQL literal | `tests/integration_pg.py` |
| 422、missing／invalid answer、timeout 都不放行 | 同上 error tests |
| 同 session 第二次 cache hit、表格 batch 與上限 | 同上 cache／batch tests |
| hosted gate | `.github/workflows/pg-jev-router-ci.yml`，只有 read permissions，無 secrets／deploy |

## 真模型評估的下一步（未執行）

用另行核准的 Jev／相容自託管 provider，加上人工標註並拆分 calibration/test 的繁體中文、英文、引用攻擊、角色混淆與灰區資料；記錄 source/model/policy revision。比较直連 API 與 pg-jev 的 cold/warm p50/p95、throughput、成本、誤攔率、漏攔率、review rate、route accuracy。以獨立 test split 報告結果，不能拿 mock oracle 的九題通過當成模型分數。

正式接入 [agent-platform SDD](../../platform/agent-platform/SDD.md) §4、§6、§11 時，將 route 映射到 allowlisted immutable profile，經既有 admission/budget。沒有被核准的 reasoning profile 時必須 review，不可自行新增 provider 或更換執行中 run 的 model。

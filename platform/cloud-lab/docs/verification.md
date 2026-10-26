# 驗收與里程碑

Cloud Lab 產品主線未完成。M0 文件檢查與未來執行驗收分列；不以文件、schema 或 mock 通過推導 live 成功。

## M0：本次文件里程碑

| AC | Given / When / Then | 檢查方法 |
| --- | --- | --- |
| AC-01 | Given 現有能力與來源，When 沿知識樹閱讀，Then 每個能力有責任者、契約、來源／實作與證據或明示缺口 | 逐列檢查知識樹、來源 pin、相對連結及 public boundary |
| AC-02 | Given UI／bot／schedule 與既有 executor，When 追蹤合成命令，Then 准入、去重、attempt、取消、未知及驗證由明確 owner 處理 | 介面 walkthrough、獨立設計審查 |
| AC-03 | Given CF 元件及既有平台，When 分配狀態與部署責任，Then 無雙重 run／host／workload／Done 權威 | 架構責任表對照 Kith／Edge Ops／Workforce 的既有邊界 |
| AC-04 | Given 每個候選來源，When 決定歸位／抽取／adapter／reference，Then 有目標與阻擋，封存必須通過接替及回退 gate | 遷移矩陣與資料／in-flight／rollback 情境審查 |
| AC-05 | Given 完整文件候選，When 跑既有索引驗證與獨立審查，Then 導航一致、沒有 runtime 成功冒稱，所有未實作事項保留 | repo validators、diff／link／scope check、review report |

M0 不需要變更 runtime，因此沒有為文件增加產品行為測試或安裝套件。介面是 prose proposal；機器可讀 schema、OpenAPI 與 executable fixtures 在 M1 開始時依相同契約落地並做 Red-Green-Refactor。

## M1：一台節點的唯讀閉環（未授權執行）

目標：同一種固定 health-check Recipe 可由人／授權 bot 與固定 UTC 排程提交；非 root runner 向外領取；看板呈現來源、時刻、進度、驗證與成果。先實作一個具名 executor，不要求所有現有產品接通。

| 場景 | 必須看見的結果 |
| --- | --- |
| 相同 idempotency key＋相同 payload 重送 | 同一 command ID，不額外啟動工作 |
| 相同 key＋不同 payload | conflict，原命令保持不變 |
| 非授權 caller／resource／Recipe／撤銷 grant | 拒絕且不排程；稽核不含 secret |
| 寫 D1 成功後通知失敗 | outbox 可恢復；重送不多執行 |
| runner 接收後斷線，或結果回報途中斷線 | 保留 unknown／pending reconciliation；先查 journal |
| 過期 attempt/fence 或錯誤來源回報 | 不改現行 run；留可對帳的拒絕紀錄 |
| submit grant 已撤銷／到期、舊 lease 已到期，但原 run 狀態不明 | 獨立有效的對帳 grant 可取得 reconcile_only fence 查詢原 run；不得 start、重送 submit 或刷新期限 |
| 合法結果在 deadline 後才到達 | late 為接收端 metadata；執行完成時間與送達時間分列；payload 偽造 late 被拒絕 |
| deadline 到達、取消請求與完成回報競爭 | 取消意圖和停止證據分開，依明定順序處理 |
| artifact 太大、digest 不符、輸出 schema 錯誤 | 不標 validated success；錯誤及上限可見 |
| 事件重複、亂序、漏 seq | 去重，不倒退投影，缺漏觸發查權威狀態 |
| runner／控制面恢復，schedule 重送 | 原 command 與 due-time 去重仍有效；不自動補跑無界 backlog |
| 手機查看離線節點 | 顯示最後觀測時間與 stale／unknown，不顯示健康零值 |
| 隔離備份還原 | 對齊 schema／artifact digest，未完成命令先對帳 |

驗證順序：domain 正反例 → fake 邊界整合 → local CF 實際 bindings → 經批准的真實 CF＋runner → 手機／bot 使用流程與恢復演練。每層獨立標記版本與結果；fake 不代替後兩層。部署前固定 retention、資源限額、觀測窗口及成本預算；不在此假設已核准帳號。

## M2/M3：後續工作

M2 分別評估 Edge Ops 歸位、事件 adapter、workload 操作與 agent adapter。每個都有獨立驗收及權限；不把唯讀 probe 升級成通用執行器。Queues／Workflows 在具體案例需要時才引入，先通過重試、副作用對帳、長等待與取消測試。

M3 依[遷移 gate](migration.md)抽共用能力、形成 Recipe／應用模板及候選封存清單。模型生成的是可審閱候選；測試、來源授權、預覽及部署決定分開。沒有以 M0 授權開啟上述工作。

## 文件檢查入口

從 repository 根目錄執行；本工作區須用既有共用 launcher 包裝，新產物／日誌放其 evidence 目錄。下面是 repo 內的檢查命令，不是 runtime 啟動方式：

```sh
python3 scripts/check_project_success.py
python3 .github/scripts/validate_llms_txt.py
python3 scripts/check_indexes.py
git diff --check
```

新增能力檔必須進 Git index 才會被 llms validator 發現；staging 不等於 commit。實際結果與候選範圍見[本次證據](evidence/m0-review.md)，未執行的命令不能填 passed。

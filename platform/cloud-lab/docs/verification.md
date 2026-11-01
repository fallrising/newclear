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

## M1：一台節點的唯讀閉環（已授權開發；live gate 尚待驗收）

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
| 一般瀏覽器查看離線節點；實體手機選測 | 顯示最後觀測時間與 stale／unknown，不顯示健康零值 |
| 隔離備份還原 | 對齊 schema／artifact digest，未完成命令先對帳 |

驗證順序：domain 正反例 → fake 邊界整合 → local CF 實際 bindings → 經批准的真實 CF＋runner → 一般瀏覽器真人／bot 使用流程與恢復演練（實體手機依owner指示改為選測）。每層獨立標記版本與結果；fake 不代替後兩層。部署前固定 retention、資源限額、觀測窗口及成本預算；不在此假設已核准帳號。

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

## M1 本機實作檢查

從 repository 根目錄用共用 launcher 執行 `python3 platform/cloud-lab/tools/check.py`。Node 24.14.0 built-in test／SQLite、Python 標準庫涵蓋 domain、SQL、HMAC/JWT、原生 UI 模型、真實 loopback HTTP 與 OS collector。這不是 workerd／D1／Access live 測試。

本輪 [M1-I1～I4](m1-implementation.md) 與證據見 [M1 evidence](evidence/m1-implementation.md)；AC-06～08 的 live 整合與備份門檻仍 pending。

[FR-01～04隔離故障工具](recovery-qualification.md)及[實際結果](evidence/m1-recovery.md)補上程序中斷、回報送達前遺失與保存後ACK遺失。此層已跑真正local workerd／D1 binding，但遠端Cloudflare、撤權、主機重開機與手機流程仍需各自驗收。

[UI-01～04看板瀏覽器驗收](dashboard-qualification.md)及[本機證據](evidence/m1-dashboard.md)區分真實Chromium／workerd／D1、合成JWT與手機尺寸模擬；不取代真正Access登入、實體手機及遠端新版部署。

2026-10-28 owner取消實體手機必測門檻，見[範圍調整](dashboard-rollout.md#owner調整客戶端驗收範圍)。歷史文件的手機pending描述保留作當時狀態；目前只要求一般瀏覽器真人Access流程，裝置相容性另列選測，不阻擋其他功能開發。

BP01–04依[政策契約](bot-policy.md)驗證離線初始化、配置綁定、期限／額度、並行FLOCK、ACK遺失同ID與MCP參數邊界；[本機證據](evidence/m1-bot-policy.md)與live／模型驗收分開。

BR01–04依[續租契約](bot-policy-renewal.md)驗證preview、到期CAS／transaction rollback、歷史／payload保留、重試不補額度、實際MCP／HTTP跨期恢復；[證據](evidence/m1-bot-policy-renewal.md)區分本機與live。

BA01–04以[準備證據](evidence/m1-bot-activation.md)核對候選hash、原資料／設定、管理metadata、self／resident及協議發現。tools/list不等於授權或提交成功；[方案](bot-activation.md)的實際續權／policy初始化／host切換另驗。

BT01–04依[實際啟用證據](evidence/m1-bot-activation-live.md)驗fresh來源、單次窗口／bot-only更新、真實self、原state首次政策、native doctor和一筆MCP→resident→validated，以及最後保全；初始失敗與唯讀對帳保留。

BI01–04依[唯讀查詢契約](bot-inspection.md)驗原state不變、FLOCK、sidecar／損壞拒絕、時間／額度投影及有界pendingIDs；[359tests與原state查詢](evidence/m1-bot-inspection.md)區分local snapshot與遠端授權未知。

## 應用配額子集

[QV01–04](quota-qualification.md)以Worker.handle／scheduled及本機SQLite補AC-08的總保留／滾動窗口、去重保全及Cron終局；[證據](evidence/m1-quota-qualification.md)保留fixture失敗及副本mutation。此層不證明provider耗盡、遠端競爭或帳單；其餘矩陣層級與缺口保持。

## 應用用量觀測子集

[UO01–04](usage-observation.md)補scope聚合、手動看板及過期／撤權競爭，[證據](evidence/m1-usage-observation.md)區分source/local與provider／live。觀測數值不是准入預留或帳單來源。

[UL部分live證據](evidence/m1-usage-live.md)：已發布固定六檔，三modules／settings／歷史保全通過；UL03正向asset HTTP bytes／usage200 pending。runner403、expired bot401及匿名302是拒絕邊界，不能取代成功讀取。原unknown仍佔active槽，未恢復排程。

Owner以Safari回報UL真人登入／手動用量成功，三counter與D1同窗口聚合一致；額外asset hash依owner要求取消，沒有假稱執行。UR新增離線CAS結案與晚到report／競爭／新Cron隔離驗證，原live unknown處置仍pending。

## FQ逐列接續核對

[十四列證據矩陣](failure-matrix.md)列出具名local／歷史workerd／remote證據及尚未實作的事件／稽核／完整性／restore缺口；[保留方案](retention.md)區分七天禁止下載與實際資料保留。本輪[FQ範圍](failure-retention-qualification.md)不新增live故障操作。前段UR原unknown pending已由後續[ULR](evidence/m1-unknown-resolution-live.md)完成單筆結案與新Cron驗證，結果仍unknown，沒有重跑。

## M1 snapshot profile的具體對映

[PS輪詢順序與恢復](snapshot-ordering.md)沿已授權ADR-03／08明列通知／Event提案與現行profile的差異：commit後ACK遺失靠持久command重讀，完整snapshot以command revision防倒退／衝突並可跳版。這不是Event source_seq或covered-through snapshot相容實作，原事件要求沒有被記成passed；採用事件協定時仍須獨立實作與驗證。

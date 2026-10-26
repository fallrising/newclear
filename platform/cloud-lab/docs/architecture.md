# 架構、責任與部署邊界

M0 proposal；所有 Cloud Lab 模組未實作。命令欄位與狀態以[契約](../contracts/README.md)為準，本文定義跨元件責任。

## 唯一責任者

| 資料／行為 | 唯一權威 | 其他元件可以做什麼 |
| --- | --- | --- |
| caller、grant、准入判定 | Cloud Lab identity/admission | bot 提供身分；模型不能產生 grant |
| command、idempotency、路由、outbox | Cloud Lab D1 command store | schedule／UI／bot 共用提交介面 |
| 外部 native job／程序生命週期 | 被選定 executor／原平台 | adapter 保存 external reference、查詢及轉送回報 |
| 執行結果與 postcondition 原始證據 | executor 及指定 verifier | D1 保存來源、摘要、驗證狀態與引用，不自造證據 |
| 多步驟流程 cursor | 後續可選 Workflow driver | 透過命令 API 推進步驟；不直接寫 native run 狀態 |
| 工作是否被業務接受／Done | 既有工作系統／operator | Cloud Lab 顯示引用；run success 不自動 close issue |
| host privileged lifecycle | 既有 host authority | Cloud Lab 僅提交已委派能力；不取得通用 root shell |
| workload lifecycle | 既有 workload authority | 不與另一 controller 同時 reconcile 同一服務 |
| Kith room、seq、membership、replay | Kith | 只經其公開契約整合；不以 seq 作工作隊列 |
| 指標／通知／看板 | 原始事件為來源，讀模型可重建 | freshness、unknown、缺漏及最後觀測時間必須顯示 |

## CF 技術映射

| 元件 | 設計用途 | 首期取捨 |
| --- | --- | --- |
| Workers＋Static Assets | 有界 HTTP API／控制台 | M1 候選部署單位；尚未配置 |
| Access | operator 登入及受限 service caller | 原點驗證、各 URL 與 WebSocket 保護需實測 |
| D1 | 命令、版本／CAS、grant 引用、outbox、證據索引 | 外部 effect 與 D1 之間無跨系統交易；使用 outbox＋對帳 |
| Queues | 去耦／緩衝／重送命令通知 | M1 不必需；通知只帶 command reference，由 store 判斷可執行性 |
| Workflows | 多步驟等待、重試與批准等待 | 後續 ADR 決定；外部副作用仍依命令去重及執行證據 |
| Durable Objects | 即時通知、連線協調 | 可選投影；不成為第二個 command store |
| R2 | 受限成果、日誌片段及備份物件 | 私有 bucket／授權下載；小結果可先存有界 metadata |
| KV | 非權威 cache | 不承擔鎖、批准或命令狀態 |
| Cron | 定時提交固定 Recipe | UTC，schedule ID＋revision＋due time 去重；補跑政策明訂 |
| Containers／Sandbox | 需要 Linux runtime 的候選 executor | 不列 M1 必要；另驗證停止、持久性、資源與成本 |
| Tunnel | 讓既有服務經出站連線提供私人入口 | 非 runner polling 的必要依賴；Tunnel 不代替操作授權 |

產品能力及限制的官方來源見[來源表](sources.md)。本表是選型提案，不表示帳號有相應資源、套餐或配額。

## M1 控制流與失敗恢復

1. 驗證 caller 與 grant，限制 body 大小、Recipe 版本、資源及參數。
2. 原子寫入 command／dedupe 記錄及待分派 outbox；回傳穩定 ID。不能先觸發外部執行再補紀錄。
3. 具 scope 的 runner 出站領取；store 核對 deadline、版本及 claim/fence。每個 command 同時至多一個有效 attempt。
4. runner 保存接收／執行 journal，依固定唯讀 Recipe 執行；重送先查 journal，不盲目重啟。
5. 回報帶 command／attempt／fence／producer identity。過期或不相符回報不得改現行 attempt；原始晚到證據可另記作對帳材料。
6. 驗證有界結果與成果摘要，讀模型呈現來源、驗證結果、時間及缺口。模型的自然語言摘要不直接成為成功判定。

outbox 投遞與回報皆可能重複。逾時或失聯進入待對帳／unknown；新建 **reconcile_only 協調 attempt** 可用獨立目前有效的對帳 grant，以新 fence 查詢同一原生 run，無須等待它停止，也不受原 submit grant 過期阻擋。這不會新建原生 run。只有證明原提交未建立／未起跑，並重新通過原派送授權及期限檢查，才可恢復原 submission key；不得因 lease 過期、原生 run 已停止或對帳權有效，就自動建立替代原生 run。

## 身分與入口

operator 瀏覽器與 bot／runner 使用不同身分和最小 grant。Access token 的有效性與本系統 capability 權限分開檢查；caller 不提供可信的 role／owner 判斷。Browser cookie 的寫入路徑要有 CSRF／origin 約束，機器 token 不暴露給前端。

入口清單覆蓋 custom domain、workers.dev、preview、原主機 port；每條均保護或停用。Access 官方目前提示 Worker 層級政策的 WebSocket 限制，聊天室採用前須驗證 hostname 型政策與其他入口封閉。不要把「能登入」當成 WebSocket／撤權驗收。

## 資料與營運

各應用保留自己的 D1／DO／R2 ownership，不將 Kith schema 與 Cloud Lab command schema 混成一庫。共用 read model 透過事件及引用建立，不跨應用直接改表。

部署前填寫具體 retention、每次／每日請求與輸出上限、artifact 大小、同時執行量及告警門檻。高頻原始指標與完整日誌不全部塞入 D1；先做有界摘要與選定片段。沒有實際 workload 與套餐資料前，費用為 unknown，不承諾免費。

備份 manifest 綁定 schema、來源版本及物件 digest；還原在隔離環境驗證。還原後 runner grant、未完成命令與外部 run 先對帳，不能因 DB 回到舊版重放副作用。CF 或控制面不可達時既有服務繼續按原 authority 運作；離線 runner 的緩衝有界，丟棄／缺漏需可見。

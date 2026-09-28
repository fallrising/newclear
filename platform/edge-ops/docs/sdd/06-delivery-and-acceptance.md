# 06 — 交付、平行開發與驗收

目前交付仅為 SDD draft；下列測試都是待執行的驗收計畫。最新進度僅見 [STATUS](../STATUS.md)。不排日曆日期，以依賴與可驗收結果推進。

## 1. Milestones

| Milestone | 依賴／階段 | 可觀察成果 | 不包含 |
| --- | --- | --- | --- |
| M0 Contract foundation | SDD 經 owner 接受；後續明確授權實作 | OpenAPI/Schema、TS/Go fixtures、D1 CAS/0-row atomicity spike、auth/signature vectors、docs/CI gate | 真實主機與雲端部署 |
| M1 One-node monitoring | M0 / P0 | disposable Linux VM 的 collector → local Worker/D1 → UI snapshot/歷史/失聯/補報 | root jobs、logs |
| M2 Cloud monitoring pilot | M1 + 明確 CF 帳號／資源／預算授權 | 真實 disposable CF 部署；10-node 模擬 + 少量授權節點、DO、告警、費用計數與 restore | 超出預算、正式服務 SLA |
| M3 Bounded logs | M2 / P1a | 選定 source → redact/cursor/chunk → R2 → ACL UI 查閱 | 無界 log ingestion／全文搜尋 |
| M4 Controlled operations | M0 cryptographic gates + M2 / P1b | 單台 disposable VM、獨立批准、typed diagnostic，再到一個明確 privileged fixture | WebSSH、批量主機操作、自動修復 |
| M5 Bootstrap workflow | M4 / P2 | official image + minimal first boot + enrollment + approved recipe + reboot/postchecks | 既有主機重灌／磁碟格式化 |
| M6 Image and integrations | M5 + 獨立授權 | Packer image 簽署/clone identity；單 host authority adapter；dim-gate 契約映射 | 擅自替換 OneVPS/OneFleet／LLM runtime |

M3 與 M4 可在各自安全 gate 滿足後平行，不需先做大規模 logs 才能開始 job 研究；M5 必須等 M4，因初始化不能繞過操作安全。P2 可先寫 fixture／設計，但不得越級在真機 apply。

## 2. 三線平行協作

M0 確定 schema／operation IDs／state machine／golden vectors 後：Frontend 擁有 `web/`；Backend 擁有 `backend/` 和 migration；Agent 擁有 `agent/` 與 packaging。`contracts/` 由整合者維護，任何 wire change 先 contract PR 再三線同步。Bootstrap recipe 與 adapters 可獨立工作包，但不可直接改 Agent 信任根。

各 worktree 從同一固定 contract revision 切出；使用 fake clock、deterministic IDs、同一 fixtures。前端對 mock，後端對 signed fixture client，Agent 對 fake HTTP server；整合者跑端到端串接。不要把各自 unit test 通過當跨線相容性通過。

每個切片定義 touched paths、禁止寫入範圍、input/output、驗收 ID 與 evidence。reviewer 優先審權限、狀態與失敗恢復，不只格式；沒有可用獨立 reviewer 時記錄 pending，不冒充已 review。

## 3. 必要驗收矩陣

| ID | 情境 | 必須觀察到的結果 |
| --- | --- | --- |
| AC-CON-01 | TS/Go 驗同一簽章／schema fixtures | 正向一致；duplicate keys、unknown major、權限欄位竄改全部拒絕 |
| AC-CON-02 | 两個 claim 競爭、CAS 更新 0 行、batch 中途失敗 | 最多一個成功 transition；沒有假 audit/outbox；rollback 不留下半份 job |
| AC-ID-01 | token 同時註冊、同 key lost response、異 key replay | 單一 node identity；同 key 可恢復；異 key 拒絕 |
| AC-ID-02 | revoke、跨 workspace ID、collector claim job | 後端拒絕，不只 UI 隱藏 |
| AC-AG-01 | 未安裝 executor，cloud config 注入 command／updater URL | collector 不執行，不增加權限或 listener |
| AC-AG-02 | 重啟／counter reset／介面換名／不支援欄位 | 沒有負速率；新 boot 基線；null/unsupported 可見 |
| AC-AG-03 | 24h 故障模擬、spool full、429、永久 4xx | 有限磁碟、backoff、缺口計數、沒有 retry storm |
| AC-MON-01 | 一節點上報、duplication、out-of-order、backfill | history 去重且保留時間語義；freshness 不被舊資料誤更新 |
| AC-MON-02 | 10 節點 60 秒上報、24h pilot | 無界資源增長為 0；量測 latency、quota burn、spool 及 ingestion errors |
| AC-LIVE-01 | DO hibernate/restart、WS 斷線、membership revoke | snapshot 收斂；過期連線關閉；不跨 workspace 外洩 |
| AC-ALERT-01 | 短抖動／長失聯／恢復／maintenance | 告警延遲符合設定容忍；去重、恢復通知、不形成通知風暴 |
| AC-LOG-01 | rotation/truncation、redaction、巨行、R2成功D1失敗 | 有界資料、cursor 不提前 ACK、部分失敗可重試且去重 |
| AC-LOG-02 | 任意 path/object key／HTML-ANSI log | 拒絕越權；UI 不執行內容；無 secret fixture 外洩 |
| AC-JOB-01 | 改 script、params、node/generation、profile、expiry | server／execd 至少在各自邊界拒絕，不產生副作用 |
| AC-JOB-02 | Worker 可任意回應，但無 owner approval key | 主機拒絕新增未批准 root 操作；記錄可偽造觀測／DoS 的殘餘風險 |
| AC-JOB-03 | started 後斷電／ACK lost／lease expired | 不自動重跑；由 journal/postcheck 得到 known 或 unknown |
| AC-JOB-04 | 取消／timeout／子程序逃逸嘗試／輸出洪水 | 有終止證據、資源與輸出界限；無法證實停止即 unknown |
| AC-JOB-05 | local policy 拒絕、permit 過期／challenge 不符 | 不執行；雲端 approval 不覆蓋本地上限 |
| AC-BOOT-01 | 兩台 clean VM 用同一 recipe | 相同聲明配置、不同 node keys；ready 有完整 postchecks |
| AC-BOOT-02 | reboot checkpoint／初始化失敗／clone 舊 image | 不重複不可逆步驟；身份不混淆；不確定時停住 |
| AC-AUTH-01 | external host_authority 下送 mutation | 不競爭 OneVPS／其他控制器，不以 flag 跳過交接 |
| AC-OPS-01 | D1/R2 export 到隔離環境還原 | 校驗 metadata/objects；舊 pending job 不直接重發；憑證明確重新註冊 |
| AC-COST-01 | 10／60 nodes、poll開關、log洪水、retention GC | 使用實測 rows與requests算上限；超預算時有界降級／拒絕 |

AC-UI-01–05 定義於 [01](01-frontend.md)，同樣是 acceptance gate，不能漏在只驗後端的清單之外。

## 4. SLO 與資源目標（不是實測）

10-node pilot、60 秒上報：正常網路下 report received → UI 可見 p95 <5 秒；這不代表本地事件發生後五秒就可見。原始新鮮度還有採樣／上報時間。離線偵測初值約 3 分鐘 +30秒 grace + 最多一個 Cron interval。

collector 目標 idle RSS <50 MiB、平均 CPU <1% 的單核；需用指定 VM、採集集合與版本量測，不能跨硬體保證。每節點 mutation concurrency=1；P1b 控制面同時最多 1 個 active mutation node，擴成多機要另過 canary／blast-radius gate。

## 5. Evidence 與停止條件

每次記錄基底 commit、實作 commit、contract revision、平台/OS/arch、命令、exit code、測試摘要、失敗樣本、未驗證事項。不得在 evidence 放真實日誌、token、state 或私人 IP。雲端證據使用匿名資源 ref，成本使用對應 account 的計量值而非擅自公開帳號。

任何 signer/privilege/identity/unknown-retry gate 失敗，禁止進下一個 host mutation 階段。功能方便性與免費額度不能覆蓋此停止條件。SDD merge 僅代表設計接受，不代表這些 gate 已完成。

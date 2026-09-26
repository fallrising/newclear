# ERU-012 離線 desired-state 前置

日期：2026-09-25。ERU-012 仍進行中，固定任務總數不變。依 owner 指示先完成離線開發，再統一做 VPS E2E；此文件記錄的是本機實作，沒有建立／更新／移除任何 VPS workload。

## 本機交付

`scripts/app_desired.py` 定義 v1 stateless HTTP app spec 與唯讀差異規劃：

- 要求版本化 JSON、sha256 固定 image、指定 worker、明確 replicas／CPU／memory／storage、`eru` 私網，以及可核對的 HTTP path／status／body；未知欄位一律拒絕，因此不接受環境變數、secret 或 volume。
- 將正規化 spec 算成穩定 SHA256，並由 logical name + spec hash 產生固定 Eru appname；在相同 revision 查到完整且身分一致的 workloads 時判為 no-op。
- 遇到同 app 未知 owner、錯誤 digest、部分／多出的 replicas、錯誤 node 或 release name 被外部 workload 佔用時封鎖，避免重送 create 造成重複副本。較舊但有明確 owner／digest 的 revision 只列出保留，不自動移除。
- 產生可供審閱的 Eru spec 與 deploy argv；這個 planner 永遠 executable: false。
- scripts/app_executor.py 加上 hash-bound execution state machine。執行計畫綁定 health／consistency preflight 與正規化 snapshot；執行前由 adapter 重新採集 snapshot、etcd health、eru-core.service 狀態及 cluster consistency。plan hash 不符、狀態漂移或 live preflight 失敗時 fail closed。正規化資料只輸出必要的 pod／node／workload 欄位，private host facts 只以 SHA256 綁定，不複製進 plan。
- scripts/app_cli_adapter.py 以既有 labctl.Operator 提供正式 Eru CLI／SSH adapter：只用 ckc-disposable-01 控制面與 02–04 worker aliases，先 cache digest image 作 registry pull 檢查，再經 review 過的 argv deploy；在指定 worker 內查 workload container IP 並執行 bounded HTTP GET，只回傳 status/body-match 摘要。此 adapter 尚未對 VPS 執行。
- 每個計畫只允許一次 create intent。回覆遺失時只做 exact appname 的唯讀 workload query；完整 owner／logical name／spec digest／replica count／node 全部吻合才接續 HTTP probe，否則記為 uncertain 並要求人工檢視，絕不自動重送。create 成功後查詢失敗同樣標 uncertain；journal 已存在時拒絕重用計畫。
- 執行沿用 controller-local mutation lock；journal 以原子 JSON 寫入。HTTP journal 只留 workload ID、status、body-match 與結果，不保存 response body。成功只表示新 revision 通過 readiness，舊 owned revisions 一律保留；`AppExecutor.reconcile` 與 `AppRevisionCleanup.reconcile` 也先取得同一把鎖，再做唯讀遠端查詢與 journal 更新，不 deploy／probe／remove。ERU-009 drain recovery 已持鎖時，改呼叫 child cleanup 的已持鎖 reconciler，避免並行 writer 覆蓋 journal。
- scripts/app_cleanup.py 提供獨立 exact-ID remove plan／executor：來源必須是已完成且 probes 全通過的 ready run，最新 snapshot 必須仍有完整的新 revision 與原先保留的舊 revision。每個舊 workload remove 前再 probe 新版、按 exact ID 核 ownership；移除後除查對 target absence 和一致性，也會將全群 workload 的 ID、node、owner、logical app 與 digest identity 對照初始 snapshot 扣除已確認移除的 exact IDs。若其他 workload 保持同一 ID 但 identity 漂移，executor 停在 `needs_review`，保留尚未移除的 targets；最後一次 readiness probe 後也會再做 identity audit。失聯時先唯讀查詢，plan journal 阻止重播。cleanup reconcile 也只讀。

上游 CLI 的 workload deploy／JSON 查詢與 spec 語法以固定版本來源為基礎，見 [來源基線](SOURCES.md)。

## 尚未完成

planner、executor、CLI adapter 與 exact-ID cleanup 均已在本機實作，尚未連到 VPS 驗證真實 CLI/API/job 語意。容量 admission 刻意交由 Eru resource plugin 在 create 時作權威判斷，不重複解析未固定的 plugin capacity schema；v1 也不含 service discovery／load-balancer caller cutover，只逐 worker 做私網 readiness。剩下需以 VPS E2E 驗證真實 CLI/API/job：確認相同 spec 不累加副本、create/remove 回覆遺失可先對帳、revision 替換先就緒再精確清理舊版。資料持久性與 volume 不屬 v1 stateless contract。

## 本機驗證

ERU-012 planner／executor／CLI adapter／cleanup 共 54 個離線測試，覆蓋 spec 拒絕與穩定 identity、YAML escaping、plan/hash 綁定、快照漂移、雙階段 live preflight gate、fake CLI argv／SSH alias、private host facts 不落入 plan、create 回覆遺失及查詢失敗後不重送、exact revision 驗證、HTTP readiness、exact-ID cleanup／失聯 reconcile、journal 中斷與唯讀 reconcile、cleanup 中途與最後 readiness probe 後的其他 workload identity 漂移，以及兩個 public reconcile 與 execute 共用鎖的回歸。完整本機 suite 現為 383 tests（本切片從 PR #137 合併後的 381 增加 2）；無 VPS E2E。

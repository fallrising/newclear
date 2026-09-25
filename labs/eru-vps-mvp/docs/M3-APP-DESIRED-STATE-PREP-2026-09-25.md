# ERU-012 離線 desired-state 前置

日期：2026-09-25。ERU-012 仍進行中，固定任務總數不變。依 owner 指示先完成離線開發，再統一做 VPS E2E；此文件記錄的是本機實作，沒有建立／更新／移除任何 VPS workload。

## 本機交付

`scripts/app_desired.py` 定義 v1 stateless HTTP app spec 與唯讀差異規劃：

- 要求版本化 JSON、sha256 固定 image、指定 worker、明確 replicas／CPU／memory／storage、`eru` 私網，以及可核對的 HTTP path／status／body；未知欄位一律拒絕，因此不接受環境變數、secret 或 volume。
- 將正規化 spec 算成穩定 SHA256，並由 logical name + spec hash 產生固定 Eru appname；在相同 revision 查到完整且身分一致的 workloads 時判為 no-op。
- 遇到同 app 未知 owner、錯誤 digest、部分／多出的 replicas、錯誤 node 或 release name 被外部 workload 佔用時封鎖，避免重送 create 造成重複副本。較舊但有明確 owner／digest 的 revision 只列出保留，不自動移除。
- 產生可供審閱的 Eru spec 與 deploy argv；這個 planner 永遠 executable: false。
- scripts/app_executor.py 加上離線 hash-bound execution state machine。執行計畫另綁定 caller-supplied health／consistency preflight 與正規化 snapshot，執行前重讀 snapshot；plan hash 不符、狀態漂移、健康不明或 consistency 有問題時 fail closed。正規化資料只輸出必要的 pod／node／workload 欄位，private host facts 只以 SHA256 綁定，不複製進 plan。
- 每個計畫只允許一次 create intent。回覆遺失時只做 exact appname 的唯讀 workload query；完整 owner／logical name／spec digest／replica count／node 全部吻合才接續 HTTP probe，否則記為 uncertain 並要求人工檢視，絕不自動重送。create 成功後查詢失敗同樣標 uncertain；journal 已存在時拒絕重用計畫。
- 執行沿用 controller-local mutation lock；journal 以原子 JSON 寫入。HTTP journal 只留 workload ID、status、body-match 與結果，不保存 response body。成功只表示新 revision 通過 readiness，舊 owned revisions 一律保留；reconcile 只讀、不 deploy／probe／remove。

上游 CLI 的 workload deploy／JSON 查詢與 spec 語法以固定版本來源為基礎，見 [來源基線](SOURCES.md)。

## 尚未完成

目前沒有正式 Eru CLI／SSH API adapter，health 與 consistency 結果仍由呼叫端提供，執行時不會重收證據；也未實作 resource-fit 預估、registry preflight、caller cutover 或 exact-ID cleanup。此狀態機只由記憶體 fake adapter 離線驗證，不能直接操作 VPS。下一步完成 adapter 與可審查的 remove plan，再統一做 VPS E2E：確認相同 spec 不累加副本、create 回覆遺失可先對帳、revision 替換先就緒再精確清理舊版。資料持久性與 volume 不屬 v1 stateless contract。

## 本機驗證

ERU-012 planner／executor 共 32 個測試，覆蓋 spec 拒絕與穩定 identity、YAML escaping、plan/hash 綁定、快照漂移、caller preflight gate、private host facts 不落入 plan、create 回覆遺失及查詢失敗後不重送、exact revision 驗證、HTTP readiness、journal 中斷與唯讀 reconcile。完整套件共 243 tests 通過（此分支相對既有 226 tests 新增 17）；無 VPS E2E。

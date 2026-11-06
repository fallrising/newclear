# PP1c D：第三 verifier CLI 的唯讀觀察機制提案

Desk-Task: T-0351
Status: APPROVED — owner 最新明確批准 PR #1038 的完整提案；必要審查／CI、正常合併與遠端核對後生效。

## 實際缺口

已批准 `docs/v2/waves/PP1c.md:238` 要求第三 CLI「只唯讀驗完整 bundle/proof/current source，無停止／attach／lease mutation」，並不建立 operation。`PP1c.md:156,628–636` 另要求真正 recover 在新 lock 內重新驗完整 source raw/files。現有完整 INVENTORY 只走既有 workflow token→reserve/register/update/clear helper，這些步驟會寫 lease；只讀舊 inventory 或僅 inspect/OID/連線狀態，都不能證明目前20表與實體檔案完全相同。T164 的獨立唯讀審查確認沒有明列可替代的 standalone authority/scratch 機制。

## 建議批准的唯一變更

保留第三 CLI 的完整且唯讀承諾，補上受控、一次性的 readonly inventory observation adapter。它只用於第三 verifier CLI，不授權 account、restore、capture 或恢復服務。

1. 進入前 source API 必須已停止、沒有 operation lock／未完成 operation、沒有其他 client backend；否則拒絕。全程不 stop/start source、不 attach recover/account workflow，不建立 operation，不寫 lease、journal、locator 或 lock。stdout operationId 仍是原 restoreOperationId。
2. host 只在記憶體建立不可由 JSON 仿造的 observation token，綁定已完整重驗的 released restore proof、原 request、固定 source runRoot／完整 identity／release／connection、固定 Node/JAR/image，以及本次依序核身的 helper；同時最多一個 active helper。此 token 無持久帳本狀態，不可轉作 recover 授權。
3. 只在 source `maintenance/verification/<restoreOperationId>/<32lowerhex nonce>/` 以0700/CREATE_NEW 建立本次 scratch；request、inventory 與必要 sanitized receipts 為0600、canonical、fsync。nonce 由 host randomBytes(16) 產生；helper seq 由 host randomBytes(6) 產生非零十進位 safe integer，名稱沿 `cms-pp1c-<restoreOperationId>-<seq>`。碰撞即拒絕，不認領既有 helper、不重用 scratch。不收使用者指定路徑、hash、seq 或 policy。
4. 沿用既有 INVENTORY request/Ready/Permit/receipt schemas、精確 Java/JAR argv、image、只讀 media／secret mounts、權限、network、timeout、無 raw stdout/log 等向量；不新增 SQL、Java Operation、CLI flags、runtime dependency、網段或 host 權限。獨立的私有 token 只讓 inspector 暫時承認這一個 helper 的完整 ID/policy/endpoint/backend，不排除任何其他 writer／mount holder／network member。
5. request/Ready/Permit 全部重新檢查原 restoreOperationId、target/release/JDBC 與 canonical hashes；只能 read-only transaction。一次 helper 結束且 backend 消失後才讀完結果串流，驗完整20表/schema/Flyway/rows及所有實體 media bytes，與 source capture 完全相等；source→target 的9組 CHECK 例外不能用在這個 source→source 比較。前後重新 inspect identity／release／零其他 backend，並重驗 proof/bundle bytes。任何差異失敗，不產生新 proof。
6. 僅於 fresh full-ID/policy 再核對後停止／移除本次已擁有的 ephemeral helper，沿既有 helper 生命週期；失敗若無法證明其 identity 則保留。所有 scratch／失敗證據、既有 runtime/volumes/locks 留存。不得清除舊工作區或修改 host HOME/auth/trust。
7. 真正 recover 仍以新的 operation lock、正常既有 registry INVENTORY 完成第二次完整 source revalidation，再進 ACCOUNT；不使用 observation token、舊 inventory 或 CLI 成功布林作寫入授權。保留 Java V2 guard 與六欄 Result。

## 批准後交付與驗證

先把上述邊界寫入 PP1c wave／local-adapters／必要測試契約，完成獨立文件審查、PR、必要 CI、正常合併及遠端核對，才實作此 adapter。每個 handwritten checkpoint 含測試≤400行。

新增真實 registry 分離測試：CLI 前後 lease/journal/lock/locator bytes 不變；JSON token、錯 proof／source／helper full-ID／endpoint／backend、額外 writer、scratch/path/policy 替換都拒絕；JDBC／容器先結束而 stream 稍後讀完；full20表與實體 files 變更拒絕。最終 C17 必須用真實 PG/Docker，並與新的 recover-under-lock 驗證分開記錄。未完成前第三 CLI 繼續 ADAPTER_UNSEALED，不宣稱 D 完成。

## Owner 決定

Owner 本 session 最新原話「批准。」接受 Draft PR #1038 head a52da0b672a543c704696f4fa9bdff42a8a462b4 的完整提案，包含以下獨立審查補明。精確發言時間未知；首次續作記錄為 2026-11-06T21:14:25.173548+00:00。批准僅涵蓋此唯讀觀察機制；不包含尚未提出請求的失敗 runtime 回收提案。必要文件審查／CI、正常合併及遠端核對完成前不實作 adapter，第三 CLI 仍 ADAPTER_UNSEALED，D 未完成。

## 獨立文件審查補明（包含在本次批准範圍）

本提案包含附約 §7.1 明列的原 D01 六個 fresh network-none profile 探針（Java Profile、Node Profile、pg_dump --version、pg_restore --version、id -u、id -g），前一個移除後才到下一個，最後才一個 INVENTORY；固定角色、原名稱 suffix、argv/env/mount/UID/PGDATA tmpfs 皆沿原向量，編譯／合成 profile artifacts 只進本次 private scratch，不用舊 cached profile 代替。不新增 SQL（保留原 SHOW 兩項）、network、dependency、host 權限或 registry mutation。

無 lock／無未完成 operation／無其他 client 與原 lease/journal/request 集合/locator bytes 身分的連續不變，是每個 preflight、Ready/Permit/result 到 final success 的前提；新 lock、registry 變動或未知 helper/backend 即失效，不為達成前提而建立、移除或改寫 lock。

C17 先第三 CLI 實際驗 current rows/files 成功且 registry/source 不變，再以全新 recover lock、正常 registry fresh revalidation 通過後才 ACCOUNT。此先後次序保存原 proof 的 current-source 驗收，不把 observation token 或布林成功當 account authority。以上均屬 owner 本次明確批准的 PR #1038 內容；實作及實機驗收仍為後續獨立關卡。

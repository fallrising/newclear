# ERU-016 本機 metadata 備份格式與還原計畫

日期：2026-10-09。狀態：本機實作、完整原生驗證與獨立來源審查通過；遠端CI／交付待完成。此切片不完成 ERU-016 或 V10。

## 目標與信任邊界

提供 `labctl metadata-backup verify` 與 `labctl metadata-backup plan-restore`，對操作者已提供的本機 snapshot、manifest 及還原請求做離線校驗，產生不可執行的私有還原計畫。沒有網路、subprocess、etcd 呼叫、服務管理、上傳、排程、刪除、volume 備份或還原執行器；不增加依賴。也不自動取得 snapshot 或聲稱外部備份成功。

本機驗證只建立 exact bytes 的完整性和輸入間一致性。manifest 是未認證的操作者聲明；cluster、generation、捕捉時間、full-keyspace 與版本不是本工具從活叢集查得。呼叫者提供預期 cluster/generation 及已審閱的 manifest SHA256，避免意外混用；這不是簽章、來源真實性或目前活叢集權威。不得接受或產出「可還原」「V10 PASS」的推論。

目前 artifact lock 的 etcd tag 為 `v3.6.14`。只接受這個精確版本，與本機鎖檔一致；lock 漂移需重新審閱。本輪不安裝 etcdutl。公開 `artifacts.amd64.lock.json` 為唯讀來源輸入，不屬於操作者私有檔案；須拒絕 symlink／非 regular／讀取漂移、限制長度並保留 raw digest，既有 public 權限維持。官方 [v3.6.14 snapshot 實作](https://github.com/etcd-io/etcd/blob/v3.6.14/etcdutl/snapshot/v3_snapshot.go) 使用附加的 32-byte SHA256 驗證 snapshot 內容；`snapshot status` 另需開啟並檢查 bbolt，其 status hash 不等於整個檔案 SHA256。本工具只能檢查長度及附加 digest，不能證明 bbolt 可解析或全 keyspace 完備。[官方 recovery 指引](https://etcd.io/docs/v3.6/op-guide/recovery/) 的實際工具、隔離、revision 與對帳要求保留給後續演練。

## 私有輸入格式

操作者提供的 manifest、snapshot、request 必須位於元件的實體 `private/` 目錄下；root 與每層子目錄屬於目前使用者、沒有 group/other 權限，不跟隨 symlink。檔案同樣須 owner-only、regular、單一 hardlink。拒絕 traversal、symlink、FIFO/device、別名、讀取中替換／變動及不合規權限。錯誤不回顯路徑或原始內容。此切片刻意不支援既有部分 fresh 工具接受的外接 private-root symlink；既有工具行為不改，metadata 使用者必須提供實體 private 根目錄。

manifest JSON 上限 64 KiB，精確 schema，拒絕重複／未知欄位、NaN、bool-as-int、不合格式或過深 JSON。所有 hex digest 為小寫 64 hex；ID 為 `[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}`。generation 為 0..2^63-1 的整數。captured_at 為明確 UTC 的 RFC3339 時間（Z 或 +00:00），不推論新鮮度／RPO。

manifest 必須恰有：

```json
{
  "schema": "eru.metadata-backup.v1",
  "backup_id": "example-backup",
  "cluster_id": "example-cluster",
  "generation": 1,
  "etcd_version": "v3.6.14",
  "captured_at": "2026-10-09T00:00:00Z",
  "capture_method": "etcdctl-snapshot-save",
  "scope": "full-keyspace",
  "snapshot": {"file": "snapshot.db", "bytes": 544, "sha256": "<64 lowercase hex>"}
}
```

snapshot 固定為 manifest 同目錄的 `snapshot.db`；manifest 不可自身命名 snapshot.db。檢查 CLI 預期 manifest 原始 bytes digest、預期 cluster/generation、版本與鎖檔、snapshot 原始 bytes digest 和長度。snapshot 至少 544 bytes、至多 8 GiB，長度 % 512 == 32；串流讀取最多 1 MiB 一塊，驗證前段 SHA256 等於末 32 bytes，不提供 skip-hash-check。上限是本機產品限制，不是 etcd 上限。整檔 SHA256 包含末尾 digest。安全檔案 descriptor 與路徑／目錄身分在讀前後及發布前重驗；不能只驗最終檔名。

## 不可執行還原計畫

`verify --manifest private/.../manifest.json --sha256 HEX --cluster ID --generation N` 唯讀。`plan-restore` 使用相同參數，再加 `--request private/.../restore.json --request-sha256 HEX --plan-id ID`。

request 上限 64 KiB、精確 schema：`schema` 固定 `eru.metadata-restore-request.v1`、`recovery_id` ID、`cluster_token` ID、`members` 為 1 或 3 個物件（name ID、peer_url、data_dir）。name／peer_url／data_dir 不重複。peer_url 只接受 https、明確 1..65535 port、合法 DNS/IP host（IPv6 須 brackets），無 userinfo/query/fragment/path；不做 DNS／連線。data_dir 必須恰為 `/var/lib/etcd-recovery/<recovery_id>/<name>`，只為 declarative target，不存取或建立。這是新目錄的計畫值，不能證明遠端不存在。cluster_token 是待審閱的新叢集 token，不證明與舊值相異。

產物固定 `private/metadata/restore-plans/<plan-id>/plan.json`，0700 新目錄永久 claim、0600 file、exclusive create、fsync file 與目錄、不覆寫；失敗留下 claim 並明確拒絕重用，不清除別人的檔案。只建立計畫目錄與 JSON。完整計畫含 schema、plan_id、來源 manifest/request 的相對路徑與 exact raw digest、snapshot raw digest/bytes、artifact lock raw digest、已校驗的來源聲明及 target、`execution_allowed: false`、`status: review-only`。發布前重新驗所有已讀輸入及目錄路由；競爭失敗不可回報成功。成功前必須從 pinned output descriptor 有界回讀計畫的實際 bytes，精確比對預期 raw bytes／digest，並核對回讀及 fsync 前後的檔案與路由身分；同 inode 同長度或不同長度改寫均不得誤報成功。既有計畫不是可復用的權威或 executor 輸入；本切片沒有 execute 或 promote 命令。

固定未驗 gate 清單：authenticated-capture/full-keyspace、bbolt-etcdutl-status、encrypted-offsite-roundtrip、quiesce-inflight-writers、isolate-old-control、preserve-workers、new-member-identities-and-empty-data-dirs、revision-bump-and-compaction-review、restore-tool-and-version、credentials-and-endpoints、node-workload-plugin-reconciliation、http-smoke、RPO-RTO。每項 `UNEXECUTED`；request 不能設定通過。generation 不預留／遞增，不解除任何既有 barrier。

公開成功輸出只含固定 status、完整性結果、execution_allowed=false、manifest/request/snapshot/plan digest、bytes/member_count 與固定未驗 gates；不輸出 ID、URL、私有路徑、token 或內容。失敗非零退出及固定 redact JSON。成功 verify 稱 `integrity-verified`；plan 稱 `review-only`；兩者明確 `bbolt_validated=false`、`live_validated=false`。help 不接觸 private、lock 或網路。metadata 專屬解析錯誤（未知旗標、缺參數、型別／子命令錯誤）也遵守固定遮罩 JSON 和非零退出，不可落入 argparse 預設原值輸出或 labctl 全域 str(exc) 錯誤處理；其他舊命令解析行為不變。

## 驗收與證據

先加入聚焦 RED 再最低實作 GREEN。以明確 synthetic payload+SHA trailer 測試有效和損壞 bytes、長度／checksum、raw manifest/request digest、schema型別、version/cluster/generation錯配、安全路徑／權限／hardlink／FIFO、讀取漂移、不可覆寫與 fsync 失敗、request 注入、stdout/stderr redaction、公開 CLI wiring及無外部呼叫。Synthetic payload 不是 bbolt／實際 snapshot，不算 etcd 整合或 V10。

必要 focused、公開 CLI 整合、原生整體 unittest、workflow靜態、compileall、team validators、diff/privacy 與獨立審查均需實際證據。長測用獨立背景 collector 記錄 PID/start_ticks/source/HEAD、真實 exit 與完整 footer；測試凍結期間不改來源或 HEAD。僅局部成功不等於里程碑完成。正式仍6/18完成、12剩餘、live UNEXECUTED；既有 v0.1.7雙build不重做。

2026-10-09 本機驗收：candidate02修補後focused26與獨立審查通過，完整原生1284／20949.108s／OK／actual exit0且來源／inventory／HEAD一致；最終短gates通過，詳見 [T-297](../.team/reports/T-297.md)。遠端CI／合併及所有V10實機gates未完成；上述契約未因驗收而放寬。

# P1e：離線 bootstrap 階段快照驗證

P1e 依 [p1e-v1 契約](P1-PHASE-CONTRACT.md) 檢查原始六節點 collection
是否符合指定 barrier。它沒有重新收集、執行或推進階段。
`predicate-matched` 只描述輸入資料；實機 runtime 仍是 `UNEXECUTED`。

## 輸入與結果

保留 P1d 原始 `redis-collection` 文件，以及分開保存的 manifest、預期 bundle
digest、ownership 與六角色 node-ID map。所有節點都須 complete；partial、unknown、
foreign、ownership／machine／container／node ID 漂移或 malformed raw response
均拒絕。不能把未知觀察當作 absent、empty 或 healthy。

新 API `validate_phase_snapshot` 在完整 binding 驗證後，重新解析原始回應並比對
指定 barrier。它保留 `ssh`／`mock-ssh` origin；匯入的 `ssh` 宣告仍不能證明真實
來源。API 回傳原始 collection 的 canonical SHA256 與 binding，只供內容比對；
不建立可授權操作的 token，也不提供 result importer 或 writer。

| Barrier | 可比對的離線狀態 |
| --- | --- |
| `pristine-isolated-empty-zero-epochs` | 既有 P1c pristine 條件 |
| `isolated-empty-assigned-epochs` | 六個隔離、空的 master，角色固定 epoch1..6 |
| `six-connected-empty-masters-epoch-six` | 六份一致的六 master 視圖，無 parent／slot，全部空，current epoch6 |
| `exact-slots-with-empty-prospective-replicas` | 全部仍為 master；M1–M3 精確分配 slots、R1–R3 無 slots，六節點全部空 |
| `exact-converged-topology-snapshot` | 既有 P1c exact already-converged 條件，可保留合法非空資料 |

完整 INFO／epoch／keyspace／跨視圖規則見契約與
[T-014](../.team/reports/T-014.md)。中間階段是狹窄的初始 bootstrap profile，
不是 recovery／adoption 演算法。最終狀態不要求初始 epoch1..6，也不證明先前
四個階段確實發生過。原有 P1c 照常拒絕中間 snapshot 與 collection envelope。

## 私有 CLI

從 component 目錄執行，以下是參數形式參考，PRIVATE 路徑須由本機實際私有
檔案替換；不是遠端操作指令，也不是已執行的 transcript：

```text
python3 scripts/phase_validation.py validate
  --manifest PRIVATE_MANIFEST
  --expected-bundle-digest INDEPENDENT_BUNDLE_SHA256
  --ownership PRIVATE_OWNERSHIP
  --node-ids PRIVATE_NODE_IDS
  --collection PRIVATE_COLLECTION
  --barrier isolated-empty-assigned-epochs
```

每個檔案須為 owned0600、single-link regular file，直接父目錄 owned0700；
絕對 normalized path、不含 traversal、不經 symlink、位於 source tree 外。
Manifest／ownership／node map 上限各1MiB，collection 上限2MiB；原始回應的
64／16／4KiB parser limits 不變。檔案 bytes 與 API canonical bytes 分別檢查。

成功 exit0 只印去識別的 barrier／origin／predicate-matched 與固定否定旗標；
拒絕或中斷 exit2 只印固定錯誤。沒有 credentials、transport、execute、output
或任意命令選項，也不寫檔。原始 collection、ID map、主機映射與 raw receipts
留私有 evidence；不要把它們貼入 issue／PR。

## 證據與下一步

實際離線測試、Red–Green、獨立審查及限制見 [VALIDATION](VALIDATION.md)。
這些結果不驗證實機 collection／freshness、原子六節點觀察、loading／quiescence、
process-to-endpoint 或 image/config/storage provenance、有效 host/network/ACL、
replication health／lag、保留資料 lifecycle 或 proxy smoke。

未來執行仍需階段前後重新取得 authenticated fresh observations、逐效果身分
重核、獨立精確批准及 durable intent／uncertainty fencing。Timeout／lost reply
不能視為遠端取消；這個 validator 不讀取或清除既有 uncertainty journal。
正常 down 保留資料，purge 另需精確條件與批准。完整 P1／MR-004 尚未完成。

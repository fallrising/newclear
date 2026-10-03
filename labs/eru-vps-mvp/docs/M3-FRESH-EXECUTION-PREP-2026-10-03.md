# Fresh execution envelope：本機準備與 pending observation

日期：2026-10-03。接續 [fresh executor 設計](M3-FRESH-EXECUTOR-DESIGN-2026-10-03.md) 與 [pending-generation barrier](M3-PENDING-GENERATION-2026-10-03.md)。本輪新增獨立 immutable execution preparation 與專用只讀 inspection。這是 production 格式的本機輸入核對，沒有 destructive stage dispatch；ERU-015 尚未完成，正式剩餘仍為 12 項。

## 操作入口

```bash
python3 scripts/labctl.py prepare-fresh-execution \
  --plan REVIEW_ID --sha256 REVIEW_DIGEST \
  --input private/fresh-execution-inputs/request.json --run-id RUN_ID
python3 scripts/labctl.py inspect-fresh-execution \
  --run RUN_ID --sha256 EXECUTION_DIGEST
```

`prepare-fresh-execution` 取得一般 controller lock，從目前本機 bytes 核對既有 review plan，建立 `private/operations/fresh-rebuild/executions/RUN_ID/execution.json`，回傳公開摘要與 execution digest。原 review 不改寫；新 envelope 的 `executable`、`execution_implemented`、`remote_mutation_performed`、`generation_changed` 都是 false。這個命令不建立 pending reservation、不呼叫 SSH／provider、不更新 cluster generation，不取得 live 操作權限。已有 pending 時拒絕 prepare。

`inspect-fresh-execution` 不取得一般 mutation lock，因此 pending 存在時仍可使用；只用受限本機讀取重核 run、目前 evidence 與 reservation，不寫檔、修復、解除或重播。公開輸出只允許 status、ID、digest、host count、generation 與固定 false flags；不輸出 provider／host／材料內容或原始例外。

## 輸入與證據契約

Request 必須恰有 `schema_version: 1`、`binding` 及四個 evidence refs：`owner_authorization`、`writer_fence`、`host_baseline`、`external_materials`。每個 ref 恰有 private 相對 `path` 與原始 bytes 的 `sha256`。每份 evidence 也必須包含相同 `binding`、自己的 `kind` 和 schema version，不接受 simulation 欄位或未列入的欄位。

Binding 精確包含 `run_id`、`plan_id`、`review_sha256`、`scope_sha256`、`cluster_id`、`generation_before`、`target_generation`。target 必須恰為 G+1，boolean 不當作 generation 或 count。

| Evidence | 必要內容與目前準備政策 |
| --- | --- |
| owner authorization | `authority: owner`、`approved: true`、timezone-aware `issued_at`／`expires_at`；目前時間在授權區間內，區間最多 1 小時 |
| writer fence | `observed_at`、`active: true`、`controller_count: 1`、`in_flight_writers: 0` |
| host baseline | `observed_at`、精確四台且依 review 順序的 alias／node／machine ID；各台 `boot_id_sha256` 與 `host_key_sha256` 必須有效且不重複 |
| external materials | `observed_at`、三種既有材料（bootstrap secrets、provider console access、external evidence store）的 private path／SHA／size；讀回 raw bytes 並核對 review 所綁的 material digest |

Fence／host／material observations 最多 15 分鐘且不得來自未來。這些是保守的本機準備時效，不是已驗證的實機操作 SLA。原 controller report 仍須在 24 小時內，原 reviews／host intents 仍遵循既有時效。舊 execution 不因時間過去而取得豁免；過期 inspection 保留紀錄並回報 blocked。

Review envelope 僅有正確 hash 還不夠：必須從精確目前 input、inventory、cluster、四份 intents、controller report、source／code／artifact hashes 重建原 plan 並逐項比對，另外以現在時間驗證時效。Inventory／cluster 使用原 planner 固定路徑，不接受另一份私有檔案冒充目前狀態。專用程式見 [validation](../scripts/fresh_execution.py) 與 [private lifecycle](../scripts/fresh_execution_ops.py)。

Evidence 是本機 operator 提供的 attestations；hash 保證連結與漂移偵測，不是 owner 簽章、即時 host probe、外部 fence 生效證明或材料災難恢復演練。未來真正 executor 仍須驗證實際授權與當時外部事實，不能直接把 `prepared` 當作可執行。

## Immutable storage 與恢復分類

沿用可信 `private` 根可為 symlink 的契約，固定 backing root 後以 descriptor-relative no-follow 方式處理子路徑。輸入必須是 owner-private 一般檔，拒絕 hardlink、FIFO、descendant symlink、`..`、超限與 duplicate／nonstandard JSON。發布先保留新 run 目錄、fsync 父目錄，再寫入／fsync／no-clobber publish envelope；失敗保留該 run，不能覆寫重用或自動整理 crash 暫存；晚期失敗會盡力留下 `.publication-failed`，但若儲存本身連停止標記都無法保存，後來讀到完整 envelope 不能反推先前 fsync 成功。`prepared` 只表示這次讀到一致且有效的本機快照。

| Inspection 狀態 | 含義 |
| --- | --- |
| `absent` | 安全讀取確認找不到指定 run，且沒有 pending reservation；不是遠端動作未執行的證明 |
| `prepared` | 原 envelope 與目前 local evidence 一致，尚無 pending；不代表 execution 已開始 |
| `reserved` | 同 run 的 reservation 在 run/review/execution/scope/cluster/fence hashes、G/G+1 與 backing root identity 全部一致；不代表任何遠端 stage 成功 |
| `blocked` | 無法安全讀取（包含 private 根缺失）、壞／多餘／中斷紀錄、hash 或當前狀態漂移、過期 evidence、foreign reservation 或觀測前後不一致；保留全部 bytes |

Inspection 的 Git 查詢關閉 optional locks，以免 `git status` 刷新 index。這個契約依賴合作程序與可信穩定檔案系統；同 UID 惡意程序仍可能在 legacy helper 的前置核對與讀取之間競速，不是敵對本機程序的安全沙箱。未來實際 dispatch 前須重新固定並重核資料。Inspection 不是 mutation admission 或鎖的替代品。準備和 observation 都不撤銷已在途 caller；重新指向其他 private backing root 也不是合法 takeover。舊 reservation 不可因輸入過期、missing run 或新 envelope 而釋放。

## 驗證與後續

測試只使用 temporary synthetic fixtures。[Team evidence gate](../.team/reports/T-221.md)：`PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=tests python3 -m unittest -v test_fresh_execution test_fresh_execution_cli test_fresh_execution_review test_fresh_rebuild test_pending_generation` 通過 73 tests／2.164 秒；`PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -v` 通過 550 tests／69.419 秒，沒有 failures／errors／skips。獨立審查通過 73 tests／2.201 秒；原 workflow validation、compileall、team contracts 與 diff checks 通過。原 [v0.1.7 雙次 build](M3-CORE-V017-VALIDATION-2026-10-03.md)、simulation 與 barrier 已有證據，不重做。

後續仍缺 actual authorization／fence／host observation adapters、fresh stage dispatch／bootstrap／probes、barrier 專用後續 stage recovery、generation CAS／commit／accepted-run seal／barrier completion，以及三個獨立 live fresh generations。沒有讀寫真實 private 或操作 VPS，不能將本輪準備與 inspection 當成整體完成。

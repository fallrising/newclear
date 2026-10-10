# Pending-generation：controller 本機 admission barrier

2026-10-03 後續：[execution envelope 準備與 pending inspection](M3-FRESH-EXECUTION-PREP-2026-10-03.md) 新增目前本機 bindings／evidence 重核、immutable preparation 及專用只讀分類；沒有 stage dispatch、自動 reservation、generation acceptance 或 barrier release，ERU-015 與正式剩餘數不變。

日期：2026-10-03。接續 [fresh executor 設計](M3-FRESH-EXECUTOR-DESIGN-2026-10-03.md) 與 [simulation coordinator](M3-FRESH-SIMULATION-2026-10-03.md)。這個切片實作持久 reservation 與既有合作式 controller 入口的攔截；仍不是完整 fresh executor、跨 controller 鎖或實際 writer fence。正式 ERU-015／V08 與剩餘 12 項任務不變。

## API 與持久停止點

[pending_generation](../scripts/pending_generation.py) 的 `reserve(project, bindings)` 在 [ClusterLock](../scripts/labops.py) 下保留 `private/pending-generation/`。bindings 包含 run／cluster identity、G 與恰好 G+1、cluster／review／execution／scope／fence digests。它們是 reservation 的來源連結，不證明 owner 已批准真實操作或外部 writer 已停止。此 API 沒有 production CLI，也沒有從 synthetic simulation 自動呼叫。

任何 pending 路徑的存在都阻擋後續 `ClusterLock` 進入，包括空目錄、壞 JSON、一般檔、symlink 或未完成 publication。先保留目錄並同步父目錄，再發布 immutable reservation；只有全部 durability 步驟成功才返回。發生錯誤保留停止點，不刪除 marker 來恢復可用性。原 accepted `cluster.json` 保持 G，不寫 accepted-run。第二個 run 不能以 G+2 或不同 ID 繞過。

`inspect(project)` 只分類 reservation，不修改、清除或宣告 generation 完成。沒有 timeout、自動釋放、force、跳過 barrier 的環境變數或接受 receipt。即使失敗或放棄，pending 仍保留；未來必須另行實作經審閱的 recovery、commit/seal 與 completion 契約。不要手動刪目錄當作恢復流程。

既有受信任 `private` 根 symlink 可指向 controller 外部持久儲存；鎖與 reservation 使用固定 backing root，根以下不能以 symlink 改道。繼承父程序 lock descriptor 的子程序仍須重新通過 admission。操作中會核對 backing root identity 並拒絕已觀察到的置換，但 controller 重啟後若把 `private` 改指另一個根，沒有根以外的 durable anchor 能找回原 reservation；不得將這種重新指向視為 takeover 或解除方式。跨根／跨 controller 的接手仍須另行 fence 與審閱。這是 admission gate，不會撤銷已在鎖內執行的 caller 權限；未來唯一 fresh coordinator 必須先完成 writers quiescence／in-flight=0，才能 reserve，不能在一般 mutation 途中 reserve 後繼續舊操作。這是合作程序及可信檔案系統下的控制措施；同權限惡意程序可修改檔案，遠端服務也不會自動遵守它。

## 入口盤點與 read-only 影響

| 入口 | pending 時的行為 |
| --- | --- |
| `labctl` 一般 plan／execute／reimage stages；`core_patch`、`recovery` | 既有 ClusterLock 在 operator 建立／遠端工作前拒絕 |
| `deploy-lab`、`smoke-lab`、`network_acceptance` mutation 命令 | 既有 controller CLI 鎖拒絕 |
| app／cleanup／drain／loss public executor 與 recovery wrapper | 其內建 ClusterLock 拒絕，包括 nested／inherited admission |
| `soak start/stop`；`control_health --disk-probe` | 鎖拒絕，包括 scratch 寫入 |
| 已使用鎖的 reconcile／recover、一般 `control_health` | 同樣拒絕；此切片沒有增加特殊 recovery bypass |
| `labctl status`、`plan-fresh-rebuild`、network status、soak status/collect/report、`control_health --concurrent-read-only` | 既有 observation／review 路徑可用；可能寫本機 evidence／review plan，但不改叢集 generation 或遠端狀態 |

直接呼叫 `Operator.execute`、`PatchOperator.apply_plan`、`RecoveryOperator.execute_recovery`、component/network/soak 內部 helpers 或 adapter 的程式，仍有持有 controller lock 的 caller 契約；它們不是可繞過 CLI 任意呼叫的安全沙箱。`remote_install`、`CoreUpdate`、worker reinstall、soak remote payload 在主機端執行，沒有 controller reservation 路徑；外部 CI、其他 controller、原生 SSH／CLI／provider 操作也不在此鎖的範圍內。完整 fresh 流程仍須停止這些 writer 並保存外部 fence 證據。

## 驗證與未完成工作

測試僅使用 temporary synthetic fixture，覆蓋 lock admission、durable reservation、異常 publication、跨程序／inherited lock 與入口副作用前拒絕。`PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=tests python3 -m unittest -v test_pending_generation test_pending_generation_review test_labctl.LockTests`：31 tests／1.478 秒通過；`PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -v`：514 tests／74.501 秒通過，沒有 failures／errors／skips。獨立審查另跑 31 tests／0.671 秒通過；原 workflow AST／JSON／Markdown／tracked private exclusion、compileall 與 diff checks 通過。完整範圍與未驗證部分見 [evidence gate](../.team/reports/T-218.md)。

下一步仍是 production execution envelope 與即時 authorization／fence／host bindings、barrier-aware observation/recovery、四機 bootstrap 與 probes、generation CAS／commit／accepted-run seal。沒有 production executor 呼叫 reserve，也沒有真實 private 資料、VPS、provider、部署或三次 fresh generation 證據。這些缺口不能以本機 barrier 測試取代。

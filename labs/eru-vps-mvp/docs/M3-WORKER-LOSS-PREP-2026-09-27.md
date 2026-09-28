# ERU-010 worker 非計畫失聯：本機 recovery 前置（2026-09-27）

狀態：已交付離線 review planner、不依賴失聯 target SSH 的 live prepare adapter、journaled exact-ID dissociation executor、唯讀 recovery、partial-run fresh exact-ID cleanup，以及依序重用 ERU-012 的 replacement wrapper 與 `labctl` 私有入口；ERU-010 仍進行中。全部只用 fake/temp fixtures 驗證，沒有連 VPS、沒有自行驗證 provider fence，也沒有執行真實 metadata dissociate、quota 修復、node remove 或 replacement deploy。正式 V11 24 小時 run 進行期間不安排失聯演練。

## 目的與邊界

`scripts/worker_loss.py` 只處理一台已從 provider 或工作負載網路層隔離、且控制面已顯示 `available=false`、`bypass=true` 的 worker。它把下列 review facts 固定到一個 plan hash：

- failure 起點與 detection 時間；輸出實際秒數，並另記是否符合 V07 的 180 秒候選值。
- 外部 fence 的方法、確認時間與 evidence SHA256。planner 只綁定 caller attestation，不把 proof digest 當成已自行驗證的 fence。
- 失聯 target 上每個 ERU-012 owned、stateless、digest-pinned app 的 exact workload IDs 與 stale `resource_usage` digest。
- 每個 logical app 明確指定的健康 replacement worker；planner 不自動挑 node 或宣稱容量足夠。
- 控制面健康、健康 workers 與「失聯 target 以外沒有額外 consistency issue」的 caller assertions。

target 上有 unknown workload、partial replicas、舊／foreign revision、模糊或格式錯誤的 quota，或 destination 不可用／仍 bypass，整份 plan 都 blocked。target quota 可已經是零；planner 仍會固定它的 digest，後續 live executor 必須在 exact metadata reconciliation 後重新核對為零。沒有 `resource --fix` 捷徑。

偵測超過 180 秒會留下 `acceptance_gaps`，但不阻止為已發生的事故建立安全 review plan。planner 永遠輸出 `v07_complete: false`、`executable: false`、`execution_implemented: false`；這個本機 plan 不能算 V07 通過。

## 私有輸入與命令

輸入 JSON 必須放在專案 `private/` 下，且剛好包含：

- `snapshot`
- `apps`
- `destinations`
- `detection`
- `fence`
- `control_plane_health_ok`
- `healthy_workers_ok`
- `unexpected_consistency_issues`

其中 `detection` 只含 `failure_started_at`、`detected_at`；`fence` 只含 `confirmed`、`method`、`confirmed_at`、`proof_sha256`。支援的 fence method 為 `provider_power_off` 或能隔絕原 workload 寫入面的 `network_isolation`。時間必須含 timezone；fence confirmation 不得早於 detection。

```bash
python3 scripts/labctl.py plan-worker-loss --target worker-4 \
  --input private/operations/worker-loss-input.json
python3 scripts/labctl.py prepare-worker-loss --plan REVIEW_PLAN_ID \
  --sha256 REVIEW_PLAN_SHA256 \
  --input private/operations/worker-loss-input.json
python3 scripts/labctl.py execute-worker-loss-cleanup \
  --plan EXECUTION_PLAN_ID --sha256 EXECUTION_PLAN_SHA256
python3 scripts/labctl.py recover-worker-loss --run EXECUTION_PLAN_ID
python3 scripts/labctl.py plan-worker-loss-recovery-cleanup \
  --run UNCERTAIN_RUN_ID --plan-id FRESH_CLEANUP_PLAN_ID
python3 scripts/labctl.py execute-worker-loss-recovery-cleanup \
  --plan FRESH_CLEANUP_PLAN_ID --sha256 FRESH_CLEANUP_PLAN_SHA256
python3 scripts/labctl.py plan-worker-loss-replacement \
  --run COMPLETED_CLEANUP_RUN_ID \
  --input private/operations/worker-loss-input.json \
  --plan-id FRESH_REPLACEMENT_PLAN_ID
python3 scripts/labctl.py execute-worker-loss-replacement \
  --plan FRESH_REPLACEMENT_PLAN_ID --sha256 FRESH_REPLACEMENT_PLAN_SHA256 \
  --input private/operations/worker-loss-input.json
python3 scripts/labctl.py recover-worker-loss-replacement \
  --run FRESH_REPLACEMENT_PLAN_ID
```

`labctl` 在共用 `ClusterLock` 下把 review、execution、recovery-cleanup、replacement plans 與各自 run journal 寫到 `private/operations/worker-loss/`；replacement 的逐 app ERU-012 journals 留在 `private/operations/apps/runs/`。所有新 mutation 都要新的 plan ID/hash/journal；已有 journal 的 cleanup 或 replacement plan 永不重播。入口拒絕 private 外路徑、symlink、輸入 drift、錯誤 hash 與重複 plan/run ID。公開 stdout 只列 decision、計數、gate、plan ID/hash 與私有路徑，不列 workload IDs 或 desired specs。完整 plan／journal 仍含 private workload IDs，只能留在 private storage。standalone `worker_loss.py` 會把完整 review plan 印到 stdout，應只導向受保護的本機檔案。

## Live prepare、exact cleanup 與 recovery

`scripts/worker_loss_adapter.py` 的 live snapshot 只經 core CLI 讀 pods／nodes／workloads；健康檢查只連 core 與失聯 target 以外兩台 workers，核對 etcd、core service、固定 inventory endpoint／owner，以及各健康 worker 的 runtime containers／tasks 與 metadata。它不 SSH 失聯 target。兩次 snapshot／preflight 必須穩定，且 control-plane state、exact IDs、quota digest 都仍符合離線 review plan，才保存可執行 plan。外部 fence 仍是 caller attestation 的 proof digest；prepare 不會把它提升成 provider API 驗證。

`scripts/worker_loss_executor.py` 已實作下列有界順序：

1. 執行前重核 live preflight、完整 workload identity set、target `available=false`／`bypass=true` 與 node static digest。
2. 每個 exact ID 先 durable journal intent，再單次送出 `workload dissociate ID`。命令與 adapter 都驗證 deterministic ERU-012 workload ID，不接受 selector 或任意參數。
3. 回覆遺失時只查同一 exact ID：已不存在才記為成功；仍存在或 identity 改變即停在 uncertain。同一 plan 一旦有 journal 就不能重播。
4. 每次 dissociate 後核對全群 control-plane workload identities、健康 worker runtime／metadata、etcd/core 與 target fence；任何額外 drift 都停止。
5. 所有 stale IDs 不存在後，再以兩次穩定 snapshot 核對 target quota 為零。非零時停在 `needs_review`，不呼叫 `resource --fix`。
6. 成功只開 `replacement_plan_allowed` gate 並停止，不部署 replacement、不移除 node、不恢復 target。

`recover-worker-loss` 只查 exact IDs、兩次 control-plane snapshot、健康 workers 與 quota，永遠標示 `dissociate_replayed: false`。它能區分 `present_exact`／`absent`／identity changed，並輸出 `fresh_cleanup_plan_allowed` 或 `replacement_plan_allowed`。

partial run 只能以 `plan-worker-loss-recovery-cleanup` 建立新的 plan：重新載入且核對原 plan/journal，逐 ID 查詢，只收錄仍為 `present_exact` 的完整 identity；再綁定最新兩次穩定 snapshot、完整 workload identity set、fence 與 quota。query、identity、snapshot、fence、quota 或健康 worker 不明即停止。execute 產生新 journal，維持 durable intent／lost-reply exact reconcile 規則，不會接續或重播舊 plan。

只有所有原 stale IDs 已不存在、兩次 snapshot 穩定、target 仍 fenced 且 quota 明確為零，`plan-worker-loss-replacement` 才會保存新的 wrapper plan。它重新讀取原 private input，重建 review hash，核對每個 source／destination spec digest、replicas、owner-bound identity 與明確 destination。execute 在同一把鎖內，每次只針對一個 app 從最新 snapshot 建立全新的 ERU-012 child plan；前一個 replacement exact 且 HTTP-ready 後才處理下一個。所有 app 再次通過 exact identity 與 HTTP readiness 才將 wrapper 標成 complete。任何 child 或 wrapper journal 都不重播；`recover-worker-loss-replacement` 只重新列出 exact revisions，不 deploy、也不重新做 HTTP probe。若結果不確定，保留現場並建立新的 wrapper plan 處理已可證明的狀態。

這個 slice 仍不驗證 provider fence、不自動修 quota、不移除 lost node、不恢復 target，也不宣稱 destination capacity；容量 admission 仍由 ERU create 決定。VPS 有界故障演練仍須等 V11 結束及現場清理完成後另行安排。

## 驗證範圍

目前 30 個 worker-loss focused tests：原 9 個 planner tests、11 個 live prepare／adapter／executor／recovery／ops tests，加上 10 個 fresh cleanup／replacement tests。範圍涵蓋不連 target SSH、stable live binding、exact dissociation、回覆遺失前後、禁止重播、partial subset、quota residue、identity／snapshot／fence／quota／健康 worker drift、重算 hash 後的 source/subset tampering、replacement gate、private path／symlink／重複 plan、HTTP readiness failure、五個新增 `labctl` routes 與多 ID／private spec stdout 遮罩。完整本機 suite 為 413 tests，CI parity 的 AST、JSON、Markdown links、trailing whitespace、private-file exclusion 與 diff check 亦通過。這些全是 temp/fake fixtures；沒有讀取真實 private data 或呼叫遠端介面。

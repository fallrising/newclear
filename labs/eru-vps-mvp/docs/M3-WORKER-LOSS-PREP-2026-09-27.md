# ERU-010 worker 非計畫失聯：本機 recovery 前置（2026-09-27）

狀態：已交付離線 review planner、不依賴失聯 target SSH 的 live prepare adapter、journaled exact-ID dissociation executor、唯讀 recovery 與 `labctl` 私有入口；ERU-010 仍進行中。全部只用 fake/temp fixtures 驗證，沒有連 VPS、沒有自行驗證 provider fence，也沒有執行真實 metadata dissociate、quota 修復、node remove 或 replacement deploy。正式 V11 24 小時 run 進行期間不安排失聯演練。

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
```

`labctl` 在共用 `ClusterLock` 下把 review／execution plans 與 run journal 寫到 `private/operations/worker-loss/`，拒絕 private 外路徑、symlink、輸入 drift、錯誤 hash 與重複 plan/run ID。公開 stdout 只列 decision、計數、gate、plan ID/hash 與私有路徑，不列 workload IDs。完整 plan／journal 仍含 private workload IDs，只能留在 private storage。standalone `worker_loss.py` 會把完整 review plan 印到 stdout，應只導向受保護的本機檔案。

## Live prepare、exact cleanup 與 recovery

`scripts/worker_loss_adapter.py` 的 live snapshot 只經 core CLI 讀 pods／nodes／workloads；健康檢查只連 core 與失聯 target 以外兩台 workers，核對 etcd、core service、固定 inventory endpoint／owner，以及各健康 worker 的 runtime containers／tasks 與 metadata。它不 SSH 失聯 target。兩次 snapshot／preflight 必須穩定，且 control-plane state、exact IDs、quota digest 都仍符合離線 review plan，才保存可執行 plan。外部 fence 仍是 caller attestation 的 proof digest；prepare 不會把它提升成 provider API 驗證。

`scripts/worker_loss_executor.py` 已實作下列有界順序：

1. 執行前重核 live preflight、完整 workload identity set、target `available=false`／`bypass=true` 與 node static digest。
2. 每個 exact ID 先 durable journal intent，再單次送出 `workload dissociate ID`。命令與 adapter 都驗證 deterministic ERU-012 workload ID，不接受 selector 或任意參數。
3. 回覆遺失時只查同一 exact ID：已不存在才記為成功；仍存在或 identity 改變即停在 uncertain。同一 plan 一旦有 journal 就不能重播。
4. 每次 dissociate 後核對全群 control-plane workload identities、健康 worker runtime／metadata、etcd/core 與 target fence；任何額外 drift 都停止。
5. 所有 stale IDs 不存在後，再以兩次穩定 snapshot 核對 target quota 為零。非零時停在 `needs_review`，不呼叫 `resource --fix`。
6. 成功只開 `replacement_plan_allowed` gate 並停止，不部署 replacement、不移除 node、不恢復 target。

`recover-worker-loss` 只查 exact IDs、兩次 control-plane snapshot、健康 workers 與 quota，永遠標示 `dissociate_replayed: false`。它能區分 `present_exact`／`absent`／identity changed，並輸出 `fresh_cleanup_plan_allowed` 或 `replacement_plan_allowed`；目前尚未實作 partial run 的 fresh subset cleanup plan builder，也未建立 replacement plan。replacement 可重用 ERU-012 executor，但必須由新的 hash-bound plan 重新讀取原 desired specs、確認 stale metadata／quota 已清除並再做容量 admission。VPS 有界故障演練仍須等 V11 結束及現場清理完成後另行安排。

## 驗證範圍

目前 20 個 worker-loss focused tests：原 9 個 planner tests 加 11 個 live prepare／adapter／executor／recovery／ops tests。新增範圍涵蓋不連 target SSH、stable live binding、exact dissociation、回覆遺失前後、禁止重播、partial recovery、quota residue、identity／fence drift、重新計算 hash 的 payload tampering、private lifecycle、三個新 `labctl` routes 與 stdout ID 遮罩。這些全是 temp/fake fixture；沒有讀取真實 private data 或呼叫遠端介面。

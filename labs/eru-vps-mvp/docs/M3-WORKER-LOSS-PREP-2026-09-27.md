# ERU-010 worker 非計畫失聯：離線 recovery review plan（2026-09-27）

狀態：已交付離線、review-only planner 與 `labctl` 私有 plan 入口；ERU-010 仍進行中。此切片沒有連 VPS、沒有驗證外部 fence，也沒有執行 metadata dissociate、quota 修復、node remove 或 replacement deploy。正式 V11 24 小時 run 進行期間不安排失聯演練。

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
```

`labctl` 在共用 `ClusterLock` 下把 plan 寫到 `private/operations/worker-loss/review-plans/`，拒絕 private 外路徑、symlink 與重複 plan ID。公開 stdout 只列 decision、blockers、detection summary、plan ID/hash 與私有路徑，不列 workload IDs。完整 plan 仍含 private workload IDs，只能留在 private storage。standalone `worker_loss.py` 會把完整 plan 印到 stdout，應只導向受保護的本機檔案。

## 固定的未執行順序

本切片只把後續順序寫入 plan，沒有實作 mutation：

1. 再次獨立核對外部 fence proof，以及 target 仍為 unavailable/bypassed。
2. journal intent 後只 dissociate plan 綁定的 stale exact IDs；healthy-worker workload 不得套用。
3. 唯讀重查 metadata 與 quota；exact IDs 必須全部不存在、target usage 必須為零。回覆遺失時只 reconcile，不重播。
4. 使用另一份 live、hash-bound plan 在明確的健康 workers 各建立一次 replacement，核對 owner、digest、replica、node 與 HTTP readiness。
5. 保存 detection、fence、reconciliation、replacement 與末端 consistency evidence；不宣稱自動補副本。

下一個本機切片須先定義不依賴失聯 target SSH 的 live control-plane snapshot，再實作 journaled exact dissociation／read-only recovery。replacement 可重用 ERU-012 executor，但必須在 stale metadata／quota 已精確清除後建立 fresh plan。VPS 有界故障演練仍須等 V11 結束及現場清理完成後另行安排。

## 驗證範圍

新增 9 個 focused tests，覆蓋 confirmed fence 正向 plan、未 fence／未 down+bypass 阻擋、偵測超時 evidence、partial／foreign revision、destination 健康、quota／preflight fail-closed、stable hashes、private path／symlink／重複 plan，以及 `labctl` stdout 遮罩。這些全是 temp/fake fixture；沒有讀取真實 private data 或呼叫遠端介面。

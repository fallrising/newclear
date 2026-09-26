# ERU-009 非空 worker drain 前置（2026-09-26）

狀態：離線 planner、多 app staged executor／唯讀 recovery、partial-cleanup fresh exact-ID recovery 與 `labctl` 操作入口均已交付，ERU-009 仍進行中。planner 本身保持 review-only；executor 使用既有 ERU-012 adapter API，操作入口與 executor 都以 fake adapter 驗證。沒有連 VPS、執行 Eru CLI 或跑 E2E。

## 規劃契約

執行：

```sh
python3 scripts/worker_drain.py --target worker-4 --input PATH_TO_LOCAL_DRAIN_INPUT.json
```

輸入 JSON 必須剛好包含：

- `snapshot`：唯讀 cluster snapshot，含 pods／nodes／workloads；host facts 只以摘要雜湊進入輸出 plan。
- `apps`：target 上每個 ERU-012 logical app 的完整當前 desired spec。
- `destinations`：每個 logical app 明確指定一台不同的 worker；不自動挑選或平均分配。
- `health_ok` 與 `consistency_issues`：離線呼叫端的 preflight assertion。它們不是 live evidence；之後的執行器必須重新採集。

planner 要求每個來源 spec 都是 ERU-012 v1、stateless、digest-pinned、replica 數與目前 workload IDs 完全相符，且所有 target workload 恰好被其中一個 spec 認領。來源 app 若有舊 revision、部分 replica、錯誤 owner／digest、未知 workload，或 destination 不可用，整份 plan 都會 blocked。替代 revision 以改變 node 後的 spec digest 與 deterministic Eru appname 綁定。資源容量仍由 Eru core create admission 決定；planner 不宣稱有容量預測。

plan 只包含 review 所需的 IDs、owner／digest、destination、snapshot 摘要與 plan hash，不複製原始 host inventory 或 app command。輸出含 workload IDs，請與輸入 spec 一樣留在本機 private storage。`worker_drain.py` 只寫 stdout；`labctl plan-worker-drain` 會將相同 offline plan 存到 private review-plans。

## 分階段安全順序

`scripts/worker_drain_executor.py` 提供 `execution_plan(...)`、`WorkerDrainExecutor.execute(...)`、`reconcile(...)` 與唯讀 `recover(...)`。它使用 `EruCLIAdapter` 現有的 snapshot／health／consistency／deploy／exact lookup／probe／remove 能力，另新增單次 `fence_node(target)`，只經 core alias 執行 `node down <target>`，從不送 `node up`。

1. 建立執行計畫時重新採集完整 snapshot 與 live preflight；snapshot 必須仍與 review plan 一致，target 與所有 workers 必須可用，target 尚未 fenced。
2. journal 先記錄 fence intent，再單次 fence target。若命令回覆遺失，只查詢目前 fence 狀態；確認不了就停在 uncertain。
3. 逐 app 呼叫既有 `AppExecutor`，每次重核來源 exact IDs、destination、健康與 consistency。任一 replacement create／probe 不確定都不進 cleanup，所有來源 workload 保留。
4. 所有 destination revisions 全部 exact owner／digest／replica／node 符合且 HTTP readiness 再驗成功後，才開始清理來源。
5. 每 app 使用 `AppRevisionCleanup` 產生新 cleanup plan；plan targets 必須等於 review 中來源 ID 集合。遠端 remove 只按 exact workload ID 執行，任何不確定結果保留 fence。共用 cleanup executor 每次 remove 後會比對全群 workload IDs 與正規化 identity（node／owner／logical app／digest），必須等於計畫 snapshot 扣除已確認移除的 exact IDs；最後 readiness probe 後再核對一次。其他 workload 即使 ID 未變，只要 identity 漂移就停止並保留尚未移除的來源。
6. 全部來源清理後，沿用 `component_reinstall.empty_target` 同時核對 target metadata、ERU containers、tasks 與巢狀 resource usage 為零。只有這項完整檢查通過，drain journal 才記錄 `component_reinstall_allowed: true`；executor 隨即停止，由操作員另建一般 component-reinstall plan。

所有 stage 共用 B 的 `ClusterLock`；parent journal 綁定 execution plan hash，child journals 分別沿用 ERU-012 executor／cleanup 格式。`AppExecutor.reconcile` 與 `AppRevisionCleanup.reconcile` 的公開入口也先取得這把鎖，避免和 execute 並行覆寫 journal。drain recovery 已持鎖時，會直接呼叫 child cleanup 的已持鎖 reconciler。reconcile/recover 只讀 snapshot、node fence 狀態、replacement appname 與來源 exact IDs；不 deploy、不 probe、不 remove、不重送 fence，也不會讓失敗 plan 重跑。它先留下 `needs_review` 對帳結果，再給操作員下一步建議。

如果 cleanup 只完成一部分，`recover-worker-drain` 會重新查詢每個來源 exact ID、做穩定的雙 snapshot／preflight，並以唯讀 exact-ID 查詢 reconcile 已執行的 fresh cleanup child journal。child 與 parent 對帳狀態不一致、查詢失敗、identity 不明或 snapshot 有額外 workload 時，fresh cleanup 與一般重裝都會被阻擋。狀態清楚時，`plan-worker-drain-cleanup` 只把仍為 `present_exact` 的來源 IDs 放進一個 app 的新 ERU-012 cleanup plan；不存在的 IDs 不會重播。保存的 recovery wrapper 永遠 `executable: false`，並綁定 parent run、reconciliation hash、child plan hash 及 exact IDs。`execute-worker-drain-cleanup` 需同時提供兩個 hash；ERU-012 cleanup 仍會重核 live snapshot、readiness 與 exact targets，journal 確保 child plan 不可重播。每次 cleanup 後要再唯讀 reconcile，才可替下一個 app 規劃；來源全部確認不存在且 target 完全為空後，才開一般 component-reinstall gate。

## `labctl` 本機操作入口

輸入檔、desired specs、計畫與 journal 都必須留在專案 `private/` 下；輸入檔不能經由 symlink 指向其他路徑。離線輸入 JSON 剛好含 `snapshot`、`apps`、`destinations`、`health_ok`、`consistency_issues` 五個欄位：

```sh
python3 scripts/labctl.py plan-worker-drain --target worker-4 \
  --input private/operations/worker-drain-input.json
python3 scripts/labctl.py prepare-worker-drain --plan PLAN_ID \
  --sha256 REVIEW_SHA256 --apps private/operations/worker-drain-apps.json
python3 scripts/labctl.py execute-worker-drain --plan PLAN_ID \
  --sha256 EXECUTION_SHA256 --apps private/operations/worker-drain-apps.json
python3 scripts/labctl.py recover-worker-drain --run RUN_ID
python3 scripts/labctl.py plan-worker-drain-cleanup --run RUN_ID
python3 scripts/labctl.py execute-worker-drain-cleanup \
  --plan RECOVERY_CLEANUP_PLAN_ID --sha256 RECOVERY_SHA256 \
  --cleanup-sha256 CLEANUP_SHA256
```

`plan-worker-drain` 只建立不可執行的本機 review plan。`prepare-worker-drain` 會以唯讀 live snapshot／health／consistency 核對後，將 execution plan 存入 private storage。`execute-worker-drain` 是明確的遠端 mutation 入口。遇到不確定結果時先用 `recover-worker-drain` 唯讀對帳，不重播失敗計畫；只有 recovery 顯示 `fresh_cleanup_plan_allowed` 才可用 cleanup plan 命令。`plan-worker-drain-cleanup` 會再次先做 recovery，並私下保存單一 app 的新 exact-ID cleanup 計畫；輸出只有計畫 ID／hash 與剩餘數量。`execute-worker-drain-cleanup` 是另一個明確的遠端 mutation 入口，需同時核對 recovery wrapper 與 ERU-012 child plan hash。這些執行入口目前都只以 fake adapter 測試，沒有呼叫；真實 CLI／API／job 語意尚未驗收。

## 限制與下一步

離線 `worker_drain.py` 輸出仍永遠 `executable: false`；執行需先用 live adapter 建立獨立 hash-bound execution plan。partial cleanup recovery 只支援完整、owned、stateless 的 ERU-012 workloads；legacy／foreign／stateful、partial 或 stale revisions 會阻擋，需先人工分類與另案設計。fresh plan 一次涵蓋一個 app；任何新 cleanup 嘗試前都要先做 read-only reconcile。空 target 一律走既有元件重裝路徑。沒有讀寫真實 private inventory，沒有連 VPS，沒有跑 E2E。

26 個 drain fake tests（planner 10、executor／recovery／adapter／操作入口 16）覆蓋完整多 app mapping、未知 owner／workload、partial replica／舊 revision、preflight 與 drift gate、單次 fence 及遺失回覆對帳、所有替代 ready 前來源保留、readiness／create／cleanup 失敗、exact-ID 移除、failed-plan 禁止重播、partial cleanup fresh plan、child journal 唯讀對帳、stale proof／額外 workload 阻擋、私有路徑限制、空 worker gate，以及 `labctl` fresh cleanup plan／execute／recover 命令路由與輸出遮罩。ERU-012 cleanup 回歸涵蓋 fresh subset plan、清理中途與最後 readiness probe 後的其他 workload identity 漂移；AppExecutor／AppRevisionCleanup 另有兩項並行 reconcile 的 lock regression。PR #137 合併時完整 suite 為 381 tests；此切片再新增 2 tests，目前完整 suite 383 tests 通過。ERU-009 仍缺真實 CLI／API/job 語意驗收與整體 VPS E2E。

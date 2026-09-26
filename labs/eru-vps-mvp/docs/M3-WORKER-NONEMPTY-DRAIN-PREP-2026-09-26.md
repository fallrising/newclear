# ERU-009 非空 worker drain 前置（2026-09-26）

狀態：離線 planner、多 app staged executor／唯讀 recovery、`labctl` 本機操作入口均已交付，ERU-009 仍進行中。planner 本身保持 review-only；executor 使用既有 ERU-012 adapter API，操作入口與 executor 都以 fake adapter 驗證。沒有連 VPS、執行 Eru CLI 或跑 E2E。

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
5. 每 app 使用 `AppRevisionCleanup` 產生新 cleanup plan；plan targets 必須等於 review 中來源 ID 集合。遠端 remove 只按 exact workload ID 執行，任何不確定結果保留 fence。
6. 全部來源清理後，沿用 `component_reinstall.empty_target` 同時核對 target metadata、ERU containers、tasks 與巢狀 resource usage 為零。只有這項完整檢查通過，drain journal 才記錄 `component_reinstall_allowed: true`；executor 隨即停止，由操作員另建一般 component-reinstall plan。

所有 stage 共用 B 的 `ClusterLock`；parent journal 綁定 execution plan hash，child journals 分別沿用 ERU-012 executor／cleanup 格式。reconcile/recover 只讀 snapshot、node fence 狀態、replacement appname 與來源 exact IDs；不 deploy、不 probe、不 remove、不重送 fence，也不會讓失敗 plan 重跑。它先留下 `needs_review` 對帳結果，再給操作員下一步建議。

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
```

`plan-worker-drain` 只建立不可執行的本機 review plan。`prepare-worker-drain` 會以唯讀 live snapshot／health／consistency 核對後，將 execution plan 存入 private storage。`execute-worker-drain` 是明確的遠端 mutation 入口，本階段沒有呼叫它；它只接受已保存且 hash 相符的計畫，existing journal 會阻止重播。遇到不確定結果時用 `recover-worker-drain` 只讀對帳，輸出摘要不含 workload IDs。這些命令尚未對真實 CLI／API／job 語意做驗收。

## 限制與下一步

離線 `worker_drain.py` 輸出仍永遠 `executable: false`；執行需先用 live adapter 建立獨立 hash-bound execution plan。若 partial cleanup 之後需要再清理剩餘 IDs，recovery 目前只對帳並停止，不會產生或執行第二個 cleanup plan；需另外人工審查新 plan。planner 只支援 ERU-012 managed stateless apps；legacy／foreign／stateful workloads 會阻擋，需先人工分類與另案設計。空 target 一律走既有元件重裝路徑。沒有讀寫真實 private inventory，沒有連 VPS，沒有跑 E2E。

23 個 drain fake tests（planner 10、executor／adapter／操作入口 13）覆蓋完整多 app mapping、未知 owner／workload、partial replica／舊 revision、preflight 與 drift gate、單次 fence 及遺失回覆對帳、所有替代 ready 前來源保留、readiness／create／cleanup 失敗、exact-ID 移除、failed-plan 禁止重播、私有路徑限制、唯讀 recovery 與空 worker gate。完整本機 suite 共 375 tests 通過，先前基準為 371（ERU-009 前置前的基準為 362）。後續仍須補 partial-cleanup fresh exact-ID plan 規劃，再依整體本機開發順序做 VPS E2E。

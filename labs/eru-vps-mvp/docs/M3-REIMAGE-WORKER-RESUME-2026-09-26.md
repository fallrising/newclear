# ERU-014 safe worker resume stage（2026-09-26）

## 範圍與 gate

此 stage 只接受同一 bootstrap／registration／smoke chain 的 successful `smoked-awaiting-resume` journal。resume plan 綁定 smoke plan 與 journal hash、PASS evidence、兩台 peer canary／HTTP guard proof、safe core release/runtime、replacement machine／boot identity、worker ownership manifest、四台 service state 和 cluster snapshot。任何輸入或 live state 漂移都要先停止並重新評估。

執行前會再次確認目標 `available=true` 且 `bypass=true`、worker 沒有 workload／resource usage，core SHA 和 InvocationID 正確，健康、其他 workers、peer canaries 及服務狀態未變。peer HTTP guards 從 resume 前持續到 node 與 post-check 完成。唯一遠端 mutation 是透過 `ckc-disposable-01` SSH alias 向 core 發出一次 `node up TARGET`；executor 等候 agent ready 並核對 `available=true`、`bypass=false`。

成功狀態為 `resumed-awaiting-generation-commit`。本 stage 不更新 private inventory／worker IP／cluster generation，不更改 core `known_hosts`，不清除或重新建立 workloads，也不使用 provider API。helper 的 standalone CLI 已停用；只有 `labctl` hash-bound plan 可執行 resume。

## 操作介面

只有 safe AddNode patch 已部署並核對 running binary SHA、fenced smoke 已成功且目標仍 available+bypass，才可建立計畫：

```bash
# B 本機唯讀規劃；讀取走 ckc-disposable aliases
python3 scripts/labctl.py plan-reimage-worker-resume --plan SMOKE_PLAN_ID \
  --sha256 SMOKE_PLAN_SHA256
# B -> ckc-disposable-01 執行唯一 node up；peer worker aliases 持續 HTTP guards
python3 scripts/labctl.py resume-reimage-worker --plan RESUME_PLAN_ID --sha256 RESUME_PLAN_SHA256
python3 scripts/labctl.py status --run RESUME_PLAN_ID
# B -> 同 aliases 唯讀對帳；不重播 node up
python3 scripts/labctl.py reconcile --run RESUME_PLAN_ID
```

執行器在 `node up` 前先 durable-write attempted marker。成功回覆後仍要由 core 重新讀取確認節點 identity、capacity／labels、zero usage 與解除 fence；再驗 worker identity／services、core health／binary／invocation、peer canaries 及其他節點。若命令或後續核對不確定，保留 journal 並只做 read-only reconcile。只要曾記錄 `resume_attempted=true`，同一 worker 就禁止再次產生 resume plan；reconcile 不呼叫 `node up`，也不會自動反向 fence。

## 本機驗證與限制

fake-only 測試覆蓋完整 smoke 後經 core SSH alias 單次 resume、generation 不變、canary drift 在 mutation 前阻擋、沒有成功 smoke journal 時拒絕，以及 node-up reply 遺失後 reconcile 不重播。沒有連 VPS，沒有執行 E2E，沒有修改 `private/` 的實機資料。safe core patch 仍為 `verified-not-deployed`，因此此 executor 尚未在真實 core 上驗收。

## 下一步

接上 resume 後 worker IP／host-key 對帳與 private inventory／cluster generation commit，再完成 install、registration、smoke、resume、commit 的跨階段 recovery executor。依 owner 指示，這些本機開發完成後才安排正式 VPS E2E；OS reimage 與日常元件清理重裝分開驗收。

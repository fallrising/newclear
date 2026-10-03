# ERU-014 跨階段 worker recovery（2026-09-26）

此切片加入 install、core access、registration、smoke、resume、generation commit 六階段的本機鏈結檢視與單階段唯讀恢復。它不自動執行下一個安裝／納管動作，也不呼叫 provider API。

## 建立鏈結計畫

```bash
# B 本機：讀取 plan/journal，產生 hash-bound recovery snapshot，不連 VPS
python3 scripts/labctl.py plan-reimage-worker-recovery \
  --plan BOOTSTRAP_PLAN_ID --sha256 BOOTSTRAP_PLAN_SHA256
```

輸出第一個尚未完成或狀態不確定的 stage、`chain_sha256`、下一個既有命令，以及本次讀取範圍。一般 action 是 `plan`、`execute` 或 `input-required`；它只指引操作員，不執行該命令。尚無 smoke plan 時需提供先前 peer canary run：

```bash
# B 本機；使用已存在、run-owned 的 peer canary，不會建立 canary
python3 scripts/labctl.py plan-reimage-worker-recovery \
  --plan BOOTSTRAP_PLAN_ID --sha256 BOOTSTRAP_PLAN_SHA256 \
  --canary-run CANARY_RUN_ID
```

若第一個未完成 stage 有 journal，action 是 `reconcile`，並列出既有 journal ID 與唯讀檢查範圍。執行下面命令只會呼叫該一個 stage 的既有 read-only reconciler，不會重跑 install、registration、smoke、`node up` 或 generation commit：

```bash
# B -> action.host_scope 列出的 ckc-disposable aliases；generation commit 僅讀 B 本機檔案
python3 scripts/labctl.py recover-reimage-worker-chain \
  --plan RECOVERY_PLAN_ID --sha256 RECOVERY_PLAN_SHA256
# B 本機：查看 recovery wrapper journal；不再觸發 stage reconciler
python3 scripts/labctl.py status --run RECOVERY_PLAN_ID-recovery
python3 scripts/labctl.py reconcile --run RECOVERY_PLAN_ID-recovery
```

Recovery wrapper 將既有 stage reconcile summary hash 記入自己的 journal。Stage reconciler 可讀取遠端狀態，但不應執行遠端 mutation；resume reconciler 另明確回報 `node_up_replayed: false`。計畫重驗完整 chain snapshot 和目標 aliases；若 journal／plan 在規劃後改變，executor 會拒絕執行。每次完成 reconcile 後須重新產生 recovery plan，重新審查新的 next action。`complete` 表示 generation plan 的本機 before／after hash 已一致；它不取代 VPS E2E 驗收。

## 驗證邊界

fake-only tests 覆蓋 first-stage selection、無遠端命令的 plan、stale journal 拒絕、只呼叫一個指定 reconciler、歷史 stage mutation flag 與當次唯讀 flag 的區分，以及完整成功鏈判讀。沒有連線 VPS 或讀寫真實 private inventory、credentials、host identity、raw evidence。整體 patch deployment 與人工 OS reimage E2E 仍待統一實機驗收；日常 component reinstall 與全新 OS reimage 分開驗收，provider API 不使用。

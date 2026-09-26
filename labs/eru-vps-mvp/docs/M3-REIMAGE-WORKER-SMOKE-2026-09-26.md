# ERU-014 fenced worker smoke stage（2026-09-26）

## 範圍與順序

此 stage 接在 `registered-awaiting-smoke` 之後，完成指定 worker 的 nginx lifecycle/resource smoke，並全程保留 `bypass=true`。成功停在 `smoked-awaiting-resume`；不執行 `node up`、不更新 inventory／worker IP／cluster generation，也不寫入 core `known_hosts`。

Smoke 使用既有 `scripts/smoke-lab.py --node TARGET`，只在計畫目標上建立 run-owned nginx、驗證 HTTP／stop-start／超額資源拒絕，並依 exact app／labels 清理 workload。原始 smoke evidence 與子程序 log 留在 `private/smoke/`、`private/operations/runs/`。此路徑沿用 component-reinstall 已用過的行為：Bypass=true 時以明確 node 指派做目標驗證，不開放一般排程。

兩台 peer 的 run-owned nginx canaries 必須在 provider-reimage source plan 建立前就存在，因為 source plan 固定了 workload 與 host baseline。smoke plan 只接受其餘兩個 worker 上各一個正確 owner/run/node 的 canary，並以 `HTTPGuards` 在 smoke 與 post-check 全程持續 GET。canary membership／evidence、bootstrap plan、registration journal、replacement identity、safe core artifact/runtime invocation、worker services、cluster snapshot 都綁在 smoke plan hash 中；任何漂移都要重新 plan。

## 使用介面

只有 safe AddNode patch 已部署、registration journal 為 `registered-awaiting-smoke` 且 node 仍 available+bypass，才可規劃：

```bash
# B 本機透過 ckc-disposable aliases 做唯讀健康、host、core 與 cluster checks
python3 scripts/labctl.py plan-reimage-worker-smoke --plan BOOTSTRAP_PLAN_ID \
  --sha256 BOOTSTRAP_PLAN_SHA256 --canary-run CANARY_RUN_ID
# B -> ckc-disposable-01、計畫目標 worker alias 與兩台 peer aliases
python3 scripts/labctl.py smoke-reimage-worker --plan SMOKE_PLAN_ID --sha256 SMOKE_PLAN_SHA256
python3 scripts/labctl.py status --run SMOKE_PLAN_ID
# B -> 同 aliases；失敗或回覆不確定只做唯讀對帳，絕不重播 smoke
python3 scripts/labctl.py reconcile --run SMOKE_PLAN_ID
```

Smoke plan single-use。執行前重核兩台 canaries、HTTP target、core invocation/hash、四台 service state、worker identity／owner manifest、cluster membership。失敗或 smoke cleanup 未確認時 journal 記錄 error，目標仍 fenced；reconcile 只讀 target registration、workload／runtime、services、health 與 evidence，不再次執行 smoke、不 resume、不自動清理。

## 本機驗證

fake-only 測試覆蓋 fenced smoke 成功且清理 workload、peer canary drift 在 smoke 前被拒絕、未證明清理時 target 保持 bypass=true，以及 child response 不確定時 read-only reconcile 不重播。peer guard summary 必須包含兩台 worker 的成功樣本。未連 VPS、未執行 E2E、未改 `private/` 真實資料；safe core patch 仍 verified-not-deployed。

## 下一步

接上單次 `eru_node_resume.py` 安全 resume stage，核對 available=true／bypass=false，再設計 resume 後 inventory／cluster generation commit 與跨階段 recovery。只有本機各階段完成並驗證後才安排正式 VPS E2E。OS reimage 與日常元件重裝分開驗收；不使用 provider API。

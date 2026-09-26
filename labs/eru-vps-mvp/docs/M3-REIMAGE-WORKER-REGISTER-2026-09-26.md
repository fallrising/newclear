# ERU-014 worker fenced registration stage（2026-09-26）

## 範圍

此階段接在同一 hash-bound worker bootstrap plan 的 successful install journal 之後。它只重新加入舊 worker identity；不做 provider 操作、OS 安裝、smoke、resume 或 inventory／generation 更新。safe AddNode core artifact 目前為 `verified-not-deployed`，因此真實 executor 尚未執行；以下只以 fake operator 和假遠端 response 測試。

Plan 內的 `worker_registration` gate 綁定 `patches/core-v0.1.5-safe-node-add.validation.json`。執行器從 core 的 `eru-core.service` MainPID 讀 `/proc/<pid>/exe` SHA256，並要求 service active、PID／InvocationID 有效且 SHA 與 gate 完全相同。AddNode 前後會比對相同 runtime invocation，防止註冊期間 core process／binary 漂移。

執行器先要求 worker install journal 是 `installed-awaiting-registration`，worker machine／boot identity、owner scope、健康、其他主機與 cluster snapshot 未改變，agent inactive／disabled，目標 node 尚不存在。它再以 plan 綁定的舊 node name、pod、endpoint、labels 和 resource capacity，對 `ckc-disposable-01` 執行單次 AddNode。AddNode 回來後立即核對新 node identity／capacity／labels、zero usage 及 `bypass=true`；接著只對 plan 指定的 worker alias 執行 `systemctl enable --now eru-agent.service`，等待 core 回報 `available=true`，並持續要求 `bypass=true`。最後重驗 host identity、services、其他 workers 與 core health，成功狀態為 `registered-awaiting-smoke`。

此階段不執行 `node up`、HTTP smoke、其他 worker smoke、core known_hosts 寫入、private inventory 更新、cluster generation commit 或 cleanup。後續 smoke 與 [safe resume](M3-REIMAGE-WORKER-RESUME-2026-09-26.md) 各有獨立 hash-bound stage；resume helper 只透過 core SSH alias 由其 executor 呼叫。

## 單次執行與 reconcile

在安全 core 已部署且執行中 SHA 已核對後，操作介面為：

```bash
# B -> ckc-disposable-01 core 與 plan 綁定的 ckc-disposable worker alias
python3 scripts/labctl.py register-reimage-worker --plan BOOTSTRAP_PLAN_ID --sha256 BOOTSTRAP_PLAN_SHA256
python3 scripts/labctl.py status --run BOOTSTRAP_PLAN_ID-register
# B -> 同 aliases；只讀檢查結果，絕不重播 AddNode 或 systemctl
python3 scripts/labctl.py reconcile --run BOOTSTRAP_PLAN_ID-register
```

registration journal 在每一個 mutation 前先保存 attempted state。若 AddNode 或 agent-start 的 SSH response 遺失，命令失敗並保留 journal；operator 必須先用 `reconcile` 唯讀讀取 core／worker 實際狀態。reconcile 不新增 node、不呼叫 systemctl、不設 fence／resume，也不修復 cluster。已存在 registration journal 時拒絕再次執行。

## 本機驗證

新增 fake-only tests 驗證：成功新增 fenced node 並等 agent available；core runtime SHA 不符時在 mutation 前拒絕；AddNode 後 core process 改變時不啟動 agent；AddNode response 遺失後 reconcile 發現節點仍 fenced 且不重播；agent-start response 遺失後只讀對帳，不重試或 resume。registration 前後 cluster generation 與 workload set 不變。未連 VPS、未讀寫 `private/`、未做 E2E。

## 後續

registration 之後已有獨立 fenced smoke executor，詳見 [smoke stage](M3-REIMAGE-WORKER-SMOKE-2026-09-26.md)；它以 target-only nginx lifecycle smoke 與兩個 peer 的連續 HTTP guards 驗證並停在 `smoked-awaiting-resume`。ERU-014 尚需受控部署 safe core patch、host-key 對帳、resume 後 private inventory／generation commit，以及跨 install／registration／smoke／resume／commit 階段 recovery executor。正式 VPS E2E 留待本機開發收尾後進行。OS reimage 與日常 ERU 元件重裝分開驗收；不使用 provider API。

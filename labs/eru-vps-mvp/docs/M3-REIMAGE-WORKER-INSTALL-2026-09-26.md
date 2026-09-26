# ERU-014：worker-only 重灌後安裝階段

更新：2026-09-26。此切片接在人工 provider-console OS reimage、owner receipt 與 strict replacement-host verification 之後。它完成 worker 元件安裝 gate 與唯讀 reconcile，尚未連接任何 VPS。

## 範圍

總體 provider-reimage bootstrap plan 仍是 review-only，executable 保持 false。plan 另帶 worker_install gate，只允許執行安裝這一個階段。命令重核來源 plan／成功 preparation journal／owner receipt 與 receipt record hash／專用 host-key trust／replacement observation／pinned code、inventory、cluster generation 與 artifact lock；重新以 strict SSH 核對新 host identity 和空 runtime，讀取 core health／membership，並確認其他 hosts 未變。

真正寫入前，worker 端唯讀檢查 SSH、Tailscale、Docker、containerd 都 active，ERU 與 Docker runtime 都空，owner manifest 和所有安裝目的地都不存在，authorized key 路徑與權限正確，root SSH 仍禁止，runtime 版本與 replacement observation 相同。只傳入鎖定的 agent/CNI artifacts、六個 worker 設定檔與 core 的 Ed25519 公鑰；公鑰需匹配 pinned private/verified-host-public-keys.json，寫入 authorized_keys 時保留 core source IP、forced command 與 no-forwarding 限制。之後只啟動 eru-containerd-proxy.socket；eru-agent 保持 inactive／disabled，core 仍看不到該 node。驗證 worker ownership manifest、檔案 hash、保留服務、Docker/containerd 版本及空 runtime，再確認 core membership 未改變。

install plan 為 single-use。遠端命令一旦開始，任何非零退出、連線中斷或 journal 不確定都不能重播。reconcile 只使用計畫綁定的 ckc-disposable worker alias 和 core alias，讀取 worker ownership／service/runtime 與 core registration／workloads，保留錯誤和部分觀察，不做安裝、node registration、fence／resume 或修復。

## 使用介面

完成人工 OS reimage、記錄 owner receipt 並完成 replacement-host verification 後，先產生 worker bootstrap plan，審閱摘要與 SHA。獨立安裝命令為：

    python3 scripts/labctl.py install-reimage-worker --plan BOOTSTRAP_PLAN_ID --sha256 BOOTSTRAP_PLAN_SHA256

查詢狀態：

    python3 scripts/labctl.py status --run BOOTSTRAP_PLAN_ID

如果安裝回覆遺失或執行程序中斷，先唯讀對帳：

    python3 scripts/labctl.py reconcile --run BOOTSTRAP_PLAN_ID

不得重複呼叫 install 命令。status／reconcile 都不會啟動 agent 或重新註冊 node。

## 離線驗證與未完成項目

本安裝切片的 58 項 test_labctl.py 測試通過，涵蓋 worker-only gate、pinned host key、receipt／plan bindings、worker agent 未啟動、node 未註冊、空 runtime／服務驗證、安裝前 drift 阻擋，以及 lost response 後 read-only reconcile 和禁止重播。embedded remote preflight、post-install verifier 與 installer source 也通過 Python compile 檢查。此切片沒有執行 E2E，沒有連線／修改 worker 或 core，也沒有更改 private inventory。

後續新增的 registration executor 另有 fake-operator 測試，詳見 [重新納管階段](M3-REIMAGE-WORKER-REGISTER-2026-09-26.md)；其後 fenced smoke executor 也有獨立 plan、HTTP peer guards 與 read-only reconcile，詳見 [smoke stage](M3-REIMAGE-WORKER-SMOKE-2026-09-26.md)。剩下的本機工作是接上單次 safe resume、host-key 更新、generation commit 與跨階段恢復 executor。safe AddNode core artifact 尚未部署；全程未做 E2E。provider API 不使用；OS reimage 與日常 component-reinstall 分開驗收。

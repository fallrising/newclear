# ERU-014 worker core access stage（2026-09-26）

## 為什麼需要獨立階段

worker-only install 完成後，目標的新 Tailscale IPv4 與帶外驗證的 host key 已知，但 core 的 `/etc/eru/known_hosts` 和 `/etc/eru/mvp-firewall.nft` 仍保存舊位址。core 透過 SSH engine 連 worker 部署 workload；若等到 registration、smoke 或 resume 後才更新，smoke 可能無法連到替換 worker，agent 的 heartbeat 也可能被 core nft 規則擋下。因此先準備 core access，再 AddNode／啟動 agent。

此 stage 不重啟 core、不改 cluster generation、不註冊 node、不啟動 worker agent，也不觸碰其他 worker。它只將目標 worker 的 known_hosts entries 換成 owner receipt 綁定的帶外 host keys，並把 exact target Tailscale IP 替換到既有 nft source allowlist。nft apply 使用現有 `/etc/eru/mvp-firewall.nft`，不改防火牆政策或規則範圍。

## 安全條件與執行順序

入口接在成功的 `installed-awaiting-registration` worker install journal 之後。read-only planner 經 `ckc-disposable-01` 核對 control health、core runtime／safe AddNode artifact、原 cluster membership、其他 hosts、replacement machine／boot identity、worker owner manifest 與 agent stopped state。它讀 core known_hosts、firewall source 與 `nft list table inet eru_mvp`，要求檔案為 root-owned mode 0600，且目前檔案／live allowlist 只能是 source inventory 的舊狀態或此 target 已完成更新的精確狀態。

pinned core v0.1.5 的成功 `RemoveNode` 會呼叫 `RemoveEngineFromCache(endpoint)`，後續 `GetEngine` 會重新建立 engine；其 SSH config 在新 engine 建立時讀取 `/etc/eru/known_hosts`。所以替換 worker 即使重用原 Tailscale IP，也不需要為了清除舊 host-key cache 重啟 core，前提是 source plan 的 node removal 已成功：[RemoveNode cache eviction](https://github.com/projecteru2/core/blob/v0.1.5/cluster/calcium/node.go#L107-L126)、[engine cache creation](https://github.com/projecteru2/core/blob/v0.1.5/engine/factory/factory.go#L185-L207)、[known_hosts loading](https://github.com/projecteru2/core/blob/v0.1.5/engine/sshrunner/ssh.go#L303-L317)。

新 host key 由 owner receipt 的 SHA256 fingerprints 與本機專用 trust file 再次核對。計畫和 journal 只記錄 fingerprints、檔案 SHA256、目標別名與狀態摘要，不保存或輸出 host key blob。known_hosts 只重寫 target 的舊／新 IP entries，其他行逐行保留；firewall source 必須符合部署器產生的精確模板，僅替換 target IP。任何未知 host、key、規則、模式、檔案 hash、live nft set 或 inventory 衝突都會 fail closed。

```bash
# B -> ckc-disposable-01：唯讀讀取 core access、health、cluster 與目標 worker
python3 scripts/labctl.py plan-reimage-worker-access --plan BOOTSTRAP_PLAN_ID \
  --sha256 BOOTSTRAP_PLAN_SHA256
# B -> ckc-disposable-01：只更新目標 known_hosts 與 firewall allowlist，不重啟 core
python3 scripts/labctl.py prepare-reimage-worker-access --plan ACCESS_PLAN_ID \
  --sha256 ACCESS_PLAN_SHA256
python3 scripts/labctl.py status --run ACCESS_PLAN_ID-access
# B -> ckc-disposable-01：失敗或 SSH 回覆不確定時唯讀核對，不重播原 plan
python3 scripts/labctl.py reconcile --run ACCESS_PLAN_ID-access
```

執行前先把 attempted state 寫入私有 journal。遠端 writer 對兩個檔案做 root-owned、mode-0600、fsync 後 atomic replace，套用 nft source file，然後重讀檔案與 live table 驗證完整 postcondition；不重新啟動 `eru-core.service` 或 firewall service。registration 會要求最新成功的 access journal，並在 AddNode 前再次比對 live known_hosts 與 nft。registration journal 固定 access plan/hash；smoke 與後續 resume validation 也會重核同一份 proof。

若 SSH 回覆不確定，reconcile 只讀檔案 hash 和 live nft allowlist，不寫入或 reload。原 plan／journal 不重播。新的 plan 可接手已知的精確部分狀態；未知 drift 仍拒絕。已完成狀態的 fresh plan 會以 no-op journal 記錄，不再呼叫遠端 writer。

## 本機驗證與剩餘事項

fake-only 測試覆蓋：read-only plan、不洩漏 host-key blob、只變更指定 worker access、AddNode 前拒絕缺少 access proof、檔案 drift 在 mutation 前拒絕、遺失 SSH response 後只讀 reconcile，再由 fresh plan 接手且不重寫。尚未對 VPS 執行此 stage；safe core patch 仍 verified-not-deployed，正式 worker-4 reimage E2E 仍待本機開發收尾後安排。

# ERU-014 resume 後 worker inventory／generation commit（2026-09-26）

本切片完成 safe resume 成功後的本機 commit stage。它把已重灌 worker 的新 Tailscale IPv4、core `known_hosts` host-key entry、core firewall source allowlist render 寫回 private deployment plan，並將 local cluster generation 恰好增加一次。這不是 VPS 驗收，也不會重新執行 `node up`。

## 前置條件與輸出

`plan-reimage-worker-generation --plan RESUME_PLAN_ID --sha256 RESUME_PLAN_SHA256` 只接受 `resumed-awaiting-generation-commit` 成功 journal。規劃時使用既有 `ckc-disposable-01`～`04` aliases 做唯讀 resume reconcile，重核 core health／safe binary、target registration endpoint 與 available／bypass、worker machine／boot identity、服務與 runtime、peer canary／smoke evidence、core access proof 及未變更的 cluster generation。

新 worker IP 來自已核驗的 replacement bootstrap observation，並須與成功 resume plan 的 registration endpoint 和最新 core access proof 相符。本機專用 host-key trust file 會再次以 owner receipt fingerprints 核對。原 deployment plan 必須符合固定四主機拓撲；只變更目標 worker 的 `ip`，以及 core row 內 `/etc/eru/known_hosts` 與 `/etc/eru/mvp-firewall.nft` 的 rendered content。其他 workers、artifact／service config、OS、SSH、Tailscale、Docker/containerd 與 core state 都不改。

計畫只保存來源 plan／journal proof、before／after SHA256、generation 前後值、目標別名與 host-key fingerprints；不複製 rendered deployment plan，也不儲存 host-key blob。CLI 只顯示 worker alias／node、generation 和 hash，不輸出 deployment plan 內容。所有實際值仍在本機 `private/`。

## Commit 與恢復

`commit-reimage-worker-generation` 在任何本機寫入前重新執行 read-only resume reconcile，並核對 code inputs、deployment plan 與 cluster generation 均仍符合 plan。它先 atomic replace `private/deployment-plan.json`，再 atomic replace `private/operations/cluster.json`。兩個檔案無法靠單次 filesystem rename 一起更新，因此 writer 會先保存 hash-bound journal；若程序在兩次寫入間中斷，目標維持可用，inventory 可能已是新 IP 而 generation 尚未增加。

`reconcile --run GENERATION_PLAN_ID-generation` 只比對兩檔案是否為計畫中的 before／after hashes，不連線 VPS、不寫檔。before／before 可重新完整驗證後重跑同一 plan；inventory-after／generation-before 的精確 partial 狀態只允許同一 plan 明確補寫 generation；after／after 記錄完成。任何其他 hash 組合都標示 drift 並停止，不自動復原、重寫 inventory 或增加 generation。

```bash
# B -> 唯讀重驗 01–04 aliases，產生本機 commit plan
python3 scripts/labctl.py plan-reimage-worker-generation --plan RESUME_PLAN_ID \
  --sha256 RESUME_PLAN_SHA256
# B 本機：核對摘要與 SHA 後提交 private inventory 和 generation
python3 scripts/labctl.py commit-reimage-worker-generation --plan GENERATION_PLAN_ID \
  --sha256 GENERATION_PLAN_SHA256
python3 scripts/labctl.py status --run GENERATION_PLAN_ID-generation
# B 本機唯讀 reconcile；partial 狀態只可審閱後重跑同一 hash-bound plan
python3 scripts/labctl.py reconcile --run GENERATION_PLAN_ID-generation
```

## 驗證與限制

新增的 fake-only tests 覆蓋新 IP 與 core render 更新、其他 worker 保留、generation 單次遞增、host-key blob 不進 plan、提交後禁止重播、第一次寫入後中斷的唯讀判讀及同 plan 明確續跑，以及第一個檔案寫入前失敗後 reconcile／重驗。測試使用 tempfile 建立的假 `private/`，沒有讀取或修改真實 inventory、credentials 或 raw evidence；沒有連線 VPS，沒有做 E2E。

ERU-014 仍進行中：跨 install／registration／smoke／resume／generation commit 的恢復器、safe core patch 的受控部署，以及完整 OS-reimage E2E 尚未完成。元件重裝與人工 provider-console OS reimage 仍分開驗收，provider API 不使用；固定任務剩餘數維持 12。

# ERU-014 重灌後 worker-only 計畫器（2026-09-26）

後續狀態更新（2026-09-26）：worker-only 安裝與重新納管各有獨立 hash-bound executor 及 read-only reconcile，均只以 fake operator／response 離線驗證。重新納管會先核對執行中 core binary SHA 與 Bypass-at-Add 驗證 manifest，再 AddNode、啟動 agent，確認 available=true 且 bypass=true；階段停在 `registered-awaiting-smoke`。safe core patch 仍 verified-not-deployed，總 bootstrap plan 保持不可執行；smoke、resume、generation commit、階段恢復 executor 與整體 E2E 未完成。詳見 [worker-only 安裝進度](M3-REIMAGE-WORKER-INSTALL-2026-09-26.md)、[重新納管階段](M3-REIMAGE-WORKER-REGISTER-2026-09-26.md) 與 [safe AddNode patch](M3-CORE-SAFE-NODE-ADD-2026-09-26.md)。

本紀錄交付 owner receipt 與 replacement-host observation 之後的**離線安裝計畫產生器**。它不連 VPS、不安裝、不註冊 node、不改 inventory、不更新 core known_hosts，也不執行 provider API。原 provider-reimage plan 仍保持 review-only。

`plan-reimage-worker --plan PLAN_ID --sha256 PLAN_SHA256` 只接受同一來源 plan 綁定、preparation journal 已完成、receipt／帶外 host key record 有效、replacement observation 由 strict SSH gate 記錄且摘要未變的輸入。它再次核對本機 trust file、舊／新 machine ID 與 boot ID、OS、SSH/Tailscale/Docker/containerd service、空 ERU runtime、控制面 state absence 及 worker/core alias 身分。Observation 變更或 runtime 不空會拒絕。

計畫使用 observation 的新 Tailscale IPv4 建立 worker payload，僅包含 artifact lock 裡的 ERU agent 與 CNI plugins，以及六個 worker 設定檔；不含 core／etcd，也不設定 Docker/containerd。重新註冊意圖沿用舊 node 的 pod、owner labels 與 resource capacity，僅把 endpoint 換成新 Tailscale 位址。另記錄 worker incarnation 完成後預計增加的 cluster generation；本命令不寫入該值。

結果寫入 private `reimage-bootstrap-plans/`，保存 source plan、receipt、preparation、observation 與 artifact lock hashes。CLI 摘要不輸出新 endpoint。總 plan 仍為 `executable: false`，但 install 與 registration 分別有單階段 gate；剩餘 blocker 是 smoke、safe resume、generation commit 與 recovery executor。

`register-reimage-worker` 只接受安裝 journal 已完成、agent inactive／disabled、node 尚不存在的同一 bootstrap plan。它要求執行中 core binary SHA 完全符合 safe AddNode validation record，再以一次 AddNode 建立 bypass=true 的節點、啟動 agent，並等待 available=true 且仍 bypass=true；成功停在 `registered-awaiting-smoke`。每次 mutation 前寫入 journal；若命令結果不確定，禁止重播，先以 registration run 的 `reconcile` 唯讀核對。

後續仍須完成目標 smoke 與其他 worker guards、將既有 `eru_node_resume.py` 接到受控 resume stage、resume 後驗證，再更新 private worker IP／cluster generation。還需安全更新 core `/etc/eru/known_hosts` 中該 worker 的單一 host-key 記錄及分階段恢復流程。patch 目前 verified-not-deployed；此切片只以 fake tests 驗證，未連 VPS、未修改 private inventory、未進行 E2E。

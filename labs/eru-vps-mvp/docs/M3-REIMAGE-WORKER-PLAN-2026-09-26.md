# ERU-014 重灌後 worker-only 計畫器（2026-09-26）

本紀錄交付 owner receipt 與 replacement-host observation 之後的**離線安裝計畫產生器**。它不連 VPS、不安裝、不註冊 node、不改 inventory、不更新 core known_hosts，也不執行 provider API。原 provider-reimage plan 仍保持 review-only。

`plan-reimage-worker --plan PLAN_ID --sha256 PLAN_SHA256` 只接受同一來源 plan 綁定、preparation journal 已完成、receipt／帶外 host key record 有效、replacement observation 由 strict SSH gate 記錄且摘要未變的輸入。它再次核對本機 trust file、舊／新 machine ID 與 boot ID、OS、SSH/Tailscale/Docker/containerd service、空 ERU runtime、控制面 state absence 及 worker/core alias 身分。Observation 變更或 runtime 不空會拒絕。

計畫使用 observation 的新 Tailscale IPv4 建立 worker payload，僅包含 artifact lock 裡的 ERU agent 與 CNI plugins，以及六個 worker 設定檔；不含 core／etcd，也不設定 Docker/containerd。重新註冊意圖沿用舊 node 的 pod、owner labels 與 resource capacity，僅把 endpoint 換成新 Tailscale 位址。另記錄 worker incarnation 完成後預計增加的 cluster generation；本命令不寫入該值。

結果寫入 private `reimage-bootstrap-plans/`，保存 source plan、receipt、preparation、observation 與 artifact lock hashes。CLI 摘要不輸出新 endpoint；計畫現在仍 `executable: false`，blocker 明列遠端 installer、node registration、smoke、resume 與 recovery executor 尚未完成。

下一個實作階段仍須處理 strict alias 遠端安裝、安裝後保持 agent 停止、node add 後先設 Bypass、agent 啟動後驗 available+BYPASS、目標 smoke／其他 worker guards、明確 resume，以及只在成功後更新 private worker IP／cluster generation。還需安全更新 core `/etc/eru/known_hosts` 中該 worker 的單一 host-key 記錄。所有這些功能之後仍要分開做本機 fake tests 與正式 VPS 驗收；本輪未進行 E2E。

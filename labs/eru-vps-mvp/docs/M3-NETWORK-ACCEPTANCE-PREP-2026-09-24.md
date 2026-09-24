# ERU-006：網路驗收準備與 TCP/80 前置風險

開始：2026-09-24 04:06:02 UTC。狀態：進行中，僅本機文件與 VPS 唯讀核對；沒有建立 workload、改防火牆或打斷 soak。剩餘任務總數不變。

## 已核對的缺口

部署報告將 V03 記為 PARTIAL：bridge 內 HTTP 與從 B 對外探測 2379／2380／5001 已驗證，但 host-network 私網 HTTP 與容器出站 NAT 未測。SDD 要求管理端可到指定 worker 的 host-network TCP/80，並由叢集外確認管理服務埠不可達；CNI bridge 和 host-network 是兩條不同路徑。

2026-09-24 04:06 UTC 經 `ckc-disposable-02`、`ckc-disposable-03`、`ckc-disposable-04` 唯讀檢查，三台 UFW 均為 active、預設 deny incoming，但另有明確的 `80/tcp ALLOW IN Anywhere` 與 IPv6 Anywhere 規則；三台當時都沒有主機 TCP/80 listener。私有輸出保存在 `private/diagnostics/eru006-worker{2,3,4}-{ufw,listen}-20260924T0406Z.txt`。worker-4 的 ruleset 與 firewall unit 狀態另存在同目錄。沒有把沒有 listener 時的連線失敗解讀為防火牆已隔離。

程式檢查顯示 `deploy-lab.py` 只在 core 01 安裝 `eru-mvp-firewall`，目前規則只限制 core TCP/5001 的來源；worker 沒有由此專案安裝的 host TCP/80 私網限制。因此，host-network workload 會直接使用 worker 的主機網路；**不可在目前 broad allow 規則下啟動 nginx**，否則服務可能由公網 IPv4／IPv6 存取。現有 02／03 canaries 走 `eru` bridge，並未占用 host TCP/80，這仍不構成隔離證明。

## 執行順序與門檻

1. 等 ERU-002 到期、完整回收及離線判讀；接著依 ERU-003 的原 canary run 建立新精確 cleanup plan，核對 owner、IDs、workloads 與配額歸零。
2. 選定一台空 worker；新建 hash-bound 計畫，記錄該機 private/public address 的私有引用、host identity、UFW 編號規則、預設政策、路由／介面、TCP/80 listener 與 Eru node/workload baseline。確認 TCP/22、Tailscale、Docker/containerd 和 ERU unit 維持原狀。
3. host-network 測試前先建立可回復的**臨時** TCP/80 邊界：只准明確的管理私網來源進入，同時拒絕其餘 IPv4／IPv6 來源，優先序須高於目前 Anywhere allow。保存變更前後完整私有 UFW evidence；若無法確認管理來源、雙棧規則順序或精確回復方式，就停止，不部署 host-network workload。此計畫尚未執行。
4. 在空 worker 固定一個 run-owned nginx，以 host network 對 TCP/80 監聽；從管理私網透過指定 worker 的 private address 驗證 HTTP 200，再從 B 的公網路徑驗證 public IPv4 和 IPv6 的 TCP/80 不可達。另核對 2379／2380／5001 管理埠由外部仍不可達。只以指定 host port 的 listener、workload ID、node、owner/run labels 綁定證據，不把 `publish` 欄位當成 NAT／firewall 證據。
5. 用新的精確 cleanup plan 移除該 workload；確認 host TCP/80 listener 消失、node usage 回到 baseline、ERU／OS／SSH／Tailscale／Docker/containerd 服務狀態不變。按新 plan 移除臨時 allowlist／deny rules，並對照 UFW 回到記錄的 baseline；若既有 broad allow 仍在，報告保留此風險，不宣稱 port 80 持續受保護。
6. 另補 CNI egress NAT evidence：先確認鎖定的測試 image 具備可用的 HTTP client，再以 bridge workload 對固定 HTTPS endpoint 做單次請求並收集 exit／HTTP status；不以宿主機 curl 代替容器出站測試。這項是部署報告標出的 V03 缺口，併入 ERU-006 驗收記錄。

目前 24 小時 soak 將 2026-09-24 11:25:06 UTC 截止。截止前只做本機工作及唯讀核對。新增計畫不取代 ERU-002／003 前置，也不會重播任何過往 plan。

Soak 進度於 2026-09-24 04:09:36 UTC 唯讀查詢：01／02／03 各 2,010 筆、狀態 running；功能失敗與警告摘要為空，預定截止時間未變。原始 status 私有輸出在 `private/diagnostics/soak-status-20260924T0406Z.log`。

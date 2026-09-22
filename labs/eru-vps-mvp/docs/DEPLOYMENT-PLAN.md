# ERU Debian MVP 部署計畫（已批准並完成首次部署）

日期：2026-09-22。四個 `ckc-disposable-*` SSH aliases 均已核對為原先的測試 VPS，登入 `ckc`，`sudo -n id` 返回 uid=0，`sudo -n -l` 為 `NOPASSWD: ALL`。這解除了安裝入口的阻礙。

**owner 於 2026-09-22 明確回覆「批准。」後，首次部署與三台 nginx 測試已完成。** 原先部署曾被自動批准審查拒絕；本次在取得明確批准後才執行。結果見 [部署報告](DEPLOYMENT-RESULT-2026-09-22.md)。之後另提出的「帶運行中容器重複 apply」曾被審查判定超出首次批准；owner 再次明確批准後，已完成且 V05 通過。兩次批准都不包含 OS 重灌。

## 1. 此次新增的主機狀態

| 主機 | 動作 | 持久影響 |
| --- | --- | --- |
| ckc-disposable-01 | 安裝 etcd／etcdctl／etcdutl、core／CLI、storage plugin；啟動 `eru-etcd`、`eru-core`、`eru-mvp-firewall` | root 執行的服務；新 etcd 資料目錄；私網 gRPC listener；專用 firewall table |
| ckc-disposable-02 | 安裝 agent／CNI；新增 worker-2；啟動 agent 與 Unix socket proxy | root agent、可由 ckc 使用的 runtime proxy、core 公鑰與 CNI 設定 |
| ckc-disposable-03 | 同上，worker-3 | 同上 |
| ckc-disposable-04 | 同上，worker-4 | 同上 |

主機上持續運行 Docker／containerd，管理員讀取 `docker ps -a` 已確認目前沒有容器。現有 namespace 僅 `moby`。ERU 使用新 namespace `eru`；它不是安全隔離邊界。containerd 的 native／overlayfs snapshotter、task 與 restart plugin 均健康。

## 2. 權限路徑與風險範圍

B 的所有遠端操作仍透過 `ckc-disposable-*` alias，以 ckc + sudo 執行。core 的新 SSH 私鑰只在 01 生成／保存，不複製 B 的維護私鑰。

02–04 的 ckc 有效 `AuthorizedKeysFile` 是 `/etc/ssh/onevps-personal-admin/ckc.keys`（由 `sshd -T -C user=ckc,...` 核對）。此 root-owned 檔保留原有 entries／權限，新增一把 core 公鑰：只接受 01 的 Tailscale 來源 IP，不提供 PTY／agent forwarding／X11 forwarding。此 key 的 forced command 經由原有 ckc 的 `sudo -n` 執行 Eru 需要的遠端 command 與 SFTP。**它具有 root 等級執行能力；core 或此 key 被控制就能控制三台 worker。** from 限制是縮小可用來源，不能把此權限視為低權限沙箱。

每台 worker 新增 `/run/eru/containerd.sock`，權限 ckc:ckc 0600，由 systemd-socket-proxyd 轉送既有 root-only containerd socket。ckc 本來已有全 sudo；這仍是 root 等級 runtime API，必須作為同一個信任邊界審核。

不修改 sshd／sudoers，不啟用 root SSH，也不把 g1ops 加入 docker group。部署後必須重新核對 `PermitRootLogin no` 與原有 OneVPS access-status。

## 3. 網路與現有服務

- etcd client／peer 僅 bind loopback 的 2379／2380；本輪是單成員控制面。
- core 只 bind 01 的 Tailscale IP:5001；新增獨立 `inet eru_mvp` firewall table，5001 只接受這四台的私網來源。
- agent API 僅 bind 127.0.0.1:12345。
- 既有 Docker／containerd unit、binary、socket 權限與 runtime config 均保留，不對其下 restart。
- workers 新增各自 10.66.2/3/4.0/24 的 CNI bridge。首輪 HTTP 僅由所在 worker 探測容器 IP，外部 ingress 與跨節點容器路由尚未提供。
- 原型尚未驗證容器出站 NAT 與既有 FORWARD policy 的配合；不會以清空防火牆解決問題。

## 4. 程式、檔案與驗證

來源：[部署操作器](../scripts/deploy-lab.py)、[root 安裝器](../scripts/remote_install.py)、[artifact lock](../artifacts.amd64.lock.json)。

預設執行 `python3 scripts/deploy-lab.py` 只生成私有 plan；`--apply` 才會寫入主機。安裝器每個下載都先驗 SHA256、僅解出指定的 regular files。已存在但非本專案追蹤的檔案會拒絕覆寫；owner manifest 位於 `/var/lib/eru-mvp/owner.json`。

本機已通過 Python AST、YAML／JSON、forced-command shell 語法與目的地白名單檢查。**遠端 nft dry-run、systemd unit 驗證、服務啟動、node registration 與三台工作負載 smoke 均已完成。** SSH command 與 Unix forwarding 已由實際容器操作驗證；沒有另做獨立 SFTP 傳檔測試。 此路徑是 MVP 原型，不是完成驗收的通用 `labctl`。

安裝後依序執行：etcd health → core CLI → core 到 worker 的已驗 host key SSH → node registration／agent heartbeat → 每個 worker 的 nginx cache／deploy／get／exec／logs／stop／start／HTTP／remove → 資源回收 → 原服務與 SSH policy 復核。單一階段失敗即停止後續節點操作，保留診斷紀錄。

## 5. 回復範圍

叢集目前保持運行；以下是需另審閱的撤回流程，本次未執行：

1. 停止新部署請求，透過 Eru 列出並移除本 run 的 workload IDs；保留驗收 evidence，確認節點沒有本案 workload。
2. 在各 worker 停止／disable `eru-agent.service`、`eru-containerd-proxy.socket`、`eru-containerd-proxy.service`；在 core 停止／disable `eru-core.service`、`eru-etcd.service`、`eru-mvp-firewall.service`。先停 core，最後移除它的 firewall 限制。
3. 依 owner manifest 的完整公鑰行，只移除本案新增的 ckc authorized_keys entry；不替換整個 authorized_keys。
4. 對照 manifest SHA256 移除未被外部修改的本案檔案／units，再 daemon-reload。未知或已變動的檔案先保留供檢查。
5. `/var/lib/etcd-eru-mvp` 與 `/var/lib/eru*` 等資料先備份，另決定保留或清除。CNI bridge／IPAM 只有在本案 workloads 確認已刪除後才回收。
6. 不清 `/var/lib/containerd`、`moby` namespace、Docker networks／volumes，也不整體 flush firewall。重新核對 Docker／containerd 與 SSH 狀態。

完整 uninstall／rollback 自動化尚未實作，因此不能宣稱已完成「反覆重裝管理」。本次批准範圍是首次隔離部署與功能 smoke，不包含 OS 重灌或全群資料清除。

## 6. 批准範圍

本次 owner 已明確同意：在這四台測試 VPS 新增上述 ERU 服務、只供 core 使用且具 sudo 能力的 worker key／Unix socket proxy，以及 01 的私網 API firewall 規則，並執行可丟棄 nginx 功能測試。

真實 IP、公鑰與完整 rendered plan 保存在 gitignored `private/deployment-plan.json`。批准前計畫 SHA256：`f222efa698917b5e213cfa46321009ab5cecd2325d70f1386c03e3cd10903af2`；實際完成時 plan SHA256：`76d5e6981a1010fd3c40cfbcf7358b9f80c7034ed8a6b1d190803cff8982e4d0`。差異包括從可信 SSH 連線取得完整 worker host key 類型，以適配 core 的 Go SSH 協商；未關閉 host key 驗證。root 安裝器亦改為使用實際生效的 AuthorizedKeysFile，詳見結果報告。

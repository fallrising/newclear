# ERU-006：網路驗收準備與 TCP/80 前置風險

開始：2026-09-24 04:06:02 UTC。狀態：**ERU-006 完成**。前 5 次 hash-bound E2E 先通過 host/public checks，bridge DNS 隨後定位為上游 `DOCKER-USER → ONEVPS-INGRESS` 在 UFW 前 drop UDP；第 6 次 run `20260924T174428Z-a6f4feb1` 通過完整驗收：host-network 私網 HTTP 200、worker 公網 v4/v6 TCP/80 阻擋、core 六個管理埠探測阻擋、容器 DNS A 答案符合 plan、IPv4 HTTPS HTTP 200。唯一新增的臨時規則是 CNI `/32` → resolver `/32` UDP/53 的 run-owned DOCKER-USER ACCEPT；execute 與 read-only reconcile 均確認 cleanup complete、無殘留且 baseline restored。沒有持久 firewall 變更；worker 原有 TCP/80 Anywhere rules 仍保留，本次不構成持續的 port 80 防護。剩餘任務 12 項（近期 1、後續 11），下一項 ERU-007。

## 已核對的缺口

部署報告將 V03 記為 PARTIAL：bridge 內 HTTP 與從 B 對外探測 2379／2380／5001 已驗證，但 host-network 私網 HTTP 與容器出站 NAT 未測。SDD 要求管理端可到指定 worker 的 host-network TCP/80，並由叢集外確認管理服務埠不可達；CNI bridge 和 host-network 是兩條不同路徑。

2026-09-24 04:06 UTC 經 `ckc-disposable-02`、`ckc-disposable-03`、`ckc-disposable-04` 唯讀檢查，三台 UFW 均為 active、預設 deny incoming，但另有明確的 `80/tcp ALLOW IN Anywhere` 與 IPv6 Anywhere 規則；三台當時都沒有主機 TCP/80 listener。私有輸出保存在 `private/diagnostics/eru006-worker{2,3,4}-{ufw,listen}-20260924T0406Z.txt`。worker-4 的 ruleset 與 firewall unit 狀態另存在同目錄。沒有把沒有 listener 時的連線失敗解讀為防火牆已隔離。

程式檢查顯示 `deploy-lab.py` 只在 core 01 安裝 `eru-mvp-firewall`，目前規則只限制 core TCP/5001 的來源；worker 沒有由此專案安裝的 host TCP/80 私網限制。因此，host-network workload 會直接使用 worker 的主機網路；**不可在目前 broad allow 規則下啟動 nginx**，否則服務可能由公網 IPv4／IPv6 存取。現有 02／03 canaries 走 `eru` bridge，並未占用 host TCP/80，這仍不構成隔離證明。

## 執行順序與門檻

1. 等 ERU-002 到期、完整回收及離線判讀；接著依 ERU-003 的原 canary run 建立新精確 cleanup plan，核對 owner、IDs、workloads 與配額歸零。
2. 選定一台空 worker；新建 hash-bound 計畫，記錄該機 private/public address 的私有引用、host identity、UFW 編號規則、預設政策、路由／介面、TCP/80 listener 與 Eru node/workload baseline。確認 TCP/22、Tailscale、Docker/containerd 和 ERU unit 維持原狀。
3. host-network 測試前先建立可回復的**臨時** TCP/80 邊界：只准明確的管理 Tailscale v4/v6 source 進入，同時拒絕其他 v4/v6 來源。已實作的操作器以獨立 `inet` nftables input base chain priority `-10` 先於 UFW／Fail2ban 等現有 input chains；plan 先以 `nft --check` 驗證語法，execute 才加入 run-specific table。它不改 UFW default policy 或設定檔。CNI egress 階段會驗證 `FORWARD → DOCKER-USER → ONEVPS-INGRESS → UFW` 順序；只對 run-owned CNI `/32` 到計畫 DNS IPv4 `/32` 的 UDP/53，在 DOCKER-USER 頭部暫加帶 run tag 的精確 `ACCEPT`；plan 同時確認 ONEVPS-INGRESS 已有 TCP/443 egress allow，故 HTTPS 沿用 baseline 路徑，無需新增 TCP exceptions。每條規則按 comment、來源、目的、protocol、port、chain 和 target 精確移除；plan 先以 TEST-NET 目標對所有涉及的 chain 執行不修改規則的 `iptables -C` 語法檢查。若無法確認管理來源、上游／UFW hook 順序、forward chain／回程允許或精確規則擁有權，就停止，不部署 host-network workload。
4. 在空 worker 固定一個 run-owned 鎖定 nginx，以 host network 對 TCP/80 監聽；核對 image digest、containerd task PID ancestry 與 v4/v6 wildcard listeners。從管理私網透過指定 worker 的 private address 驗證 HTTP 200，並在 listener 仍由 run-owned nginx 持有時，從 B 的公網路徑驗證 public IPv4 和 IPv6 的 TCP/80 不可達。另核對 core 實際可用的公網地址上 2379／2380／5001 管理埠由外部仍不可達。只以指定 host port 的 listener、workload ID、node、owner/run labels 綁定證據，不把 `publish` 欄位當成 NAT／firewall 證據。
5. execute 結尾自動用 run owner/label/ID 清單移除 workload，確認 host TCP/80 listener、ERU container/task 消失、node usage 回到 baseline，再刪除內容完全吻合的唯一 nftables table；對照 UFW/nft ruleset、ERU／OS／SSH／Tailscale／Docker/containerd 服務與 host identity 回到 plan baseline。若 workload 未移除，保留 guard；先 reconcile，再產生新 hash-bound cleanup plan。既有 Anywhere allow 仍在，測試後不宣稱 port 80 持續受保護。
6. 另補 CNI egress NAT evidence：先確認鎖定的測試 image 具備可用的 HTTP client，讀取 bridge workload resolver 並核對它使用 worker 計畫中的 IPv4 resolver，再只對該 CNI `/32` 到固定 DNS／HTTPS 目的地建立暫時例外；UDP DNS 需越過實際較早的 forward hook，但仍由 UFW 精確 allow 控制。以 bridge workload 做一次 IPv4 HTTPS 請求並收集 exit／HTTP status；不以宿主機 curl 代替容器出站測試。這項是部署報告標出的 V03 缺口，併入 ERU-006 驗收記錄。

ERU-006 準備期間，24 小時 soak 已於 2026-09-24 11:25:06 UTC 自然結束，完整回收與限制見 ERU-002 紀錄。新計畫遵守 ERU-003 後置條件，沒有重播任何過往 plan。

Soak 進度於 2026-09-24 04:09:36 UTC 唯讀查詢：01／02／03 各 2,010 筆、狀態 running；功能失敗與警告摘要為空，預定截止時間未變。原始 status 私有輸出在 `private/diagnostics/soak-status-20260924T0406Z.log`。

## E2E 診斷歷程與最終驗收

2026-09-24 14:57 UTC 的一次 worker-4 E2E 已證實 host-network 私網 HTTP 200、worker 公網 IPv4/IPv6 TCP/80 阻擋（listener 仍由測試 nginx 持有），以及 core 公網管理埠阻擋。bridge workload 出站請求在 DNS 階段失敗。唯讀檢查發現 CNI bridge 有 IPv4 masquerade 與 forwarding，但 worker UFW routed policy 和 IPv4 FORWARD policy 都是 deny/drop，故 NAT rule 存在仍無法讓 bridge DNS/HTTPS 通過。

早期操作器曾只在 `ufw-before-forward` 加 DNS/TCP443 規則；17:16 run 證明 UDP query 在較早的 DOCKER-USER/ONEVPS-INGRESS path 被 drop，該規則收不到封包。現在 plan 核實 DOCKER-USER 經 ONEVPS-INGRESS 先於 UFW，ONEVPS chain 有 terminal DROP 及既有 TCP ACCEPT；execute 只在 DOCKER-USER 暫插實際 CNI `/32` 到 plan resolver `/32` 的 UDP/53 `ACCEPT`，HTTPS 使用已核實的既有 TCP egress 路徑，不增加 TCP/443 規則。清理按 tag、來源、目的、protocol、port、chain 與 target 精確移除。container resolver 不符合 worker 計畫時會先停止，不建立 egress 例外；plan 用 TEST-NET 位址執行只讀 `iptables -C` 語法檢查，不插入規則。

第一次清理已精確移除本次 CNI masquerade NAT rule；後續唯讀觀測顯示 worker-4 ruleset 回到當時 baseline，cluster/host snapshot 也相同。core 的 nft policy hash 曾變動，但 Fail2ban file log 在相同時段有 SSH ban/unban，且動態集合是 `inet f2b-table/addr-set-sshd`；這是高度吻合的外部動態變化來源，原始 hash 差異尚未逐筆證明只有該集合。新版穩定 policy digest 只排除這個 set 的成員，保留 set/table/chain 定義與所有規則，並額外核對 Fail2ban service；最終 E2E 會重新驗證 cleanup。

2026-09-24 16:28 UTC 的新 plan/run `20260924T162430Z-e0ea0b9b` 完成 worker host-network 私網 HTTP 200、公網 v4/v6 TCP/80 拒絕與 core 管理埠拒絕；bridge resolver 與 wget executable 檢查成功，四條精確 IPv4 forward exceptions 亦成功安裝／移除。請求在 wget 參數解析階段因 `-4` 不受 BusyBox 1.37 支援而退出，尚無 HTTPS egress 結果。execute 清理成功；唯讀 reconcile 再確認 workloads、CNI NAT、forward exception、guard 均為零，remote baseline 與 cluster/host baseline 已恢復。操作器現在先檢查 `wget --help` 的 `-S/-T/-O/-Y` 能力，並以 worker resolver 核對 `ipv4.icanhazip.com` 至少有 A record 且沒有任何 AAAA answer；HTTPS forwarding 只允許計畫中的 global IPv4 `/32`，不改唯讀容器檔案，也不傳入 `-4`。所有 plan、run、command observation 與 evidence 位於 gitignored `private/operations/network/`；公開紀錄不複製 inventory、credentials、raw addresses 或原始日誌。2026-09-24 16:46 UTC 的新 plan/run `20260924T164500Z-220ed6e7` 再次完成 host-network／public isolation checks。bridge endpoint resolver 與 BusyBox wget flags 檢查通過，四條 run-tagged IPv4 forwarding rules 安裝後也按精確 tuple 移除；請求在修改 workload `/etc/hosts` 時遇到 read-only filesystem，沒有連上外部 endpoint。workload、CNI NAT、forward rules、guard 均已清理；唯讀 reconcile 確認 remote firewall/service/listener 與 cluster/host baseline restored。最新操作器不改 workload filesystem，改用 `ipv4.icanhazip.com`；plan 會要求該 hostname 至少有 global IPv4 A record 且沒有任何 AAAA answer，並只允許 plan 中的 A records 到 TCP/443。request 明確用 `-Y off` 繞過任何 proxy；response body 導向 `/dev/null`。

2026-09-24 17:00 UTC 的新 plan/run `20260924T170055Z-c14d9221` 再次完成 host-network 私網 HTTP 與 worker 公網 v4/v6、core 管理埠 checks。worker plan 有 IPv4 resolver、endpoint 2 個 IPv4／0 個 IPv6 answer；四條 scoped forward rules 安裝與精確移除成功，但 BusyBox wget 回報 `bad address ipv4.icanhazip.com`，因此沒有 HTTPS 結果。run-owned workload、CNI NAT、forward rules 和 nft guard 均已清理，唯讀 reconcile 確認 remote 與 cluster/host baseline restored。程式現於加規則前檢查 nslookup 的 A-query 能力；加規則後先以明確的 worker resolver 發出 A query，只記錄 exit code／答案數／是否完全落在 plan 答案集合，再執行 HTTPS。


2026-09-24 17:16 UTC 的新 plan/run `20260924T171630Z-0d132a89` 通過 host HTTP 200、worker 公網 v4/v6 TCP/80 隔離與 core 公網管理埠檢查。BusyBox `nslookup` A-query 能力檢查通過、容器 resolver 和 worker plan 一致；query exit 1 並顯示 no servers could be reached，HTTPS 未執行。精確四條 UFW forward rules 和 workload/NAT/guard cleanup 均完成；local status 顯示 cleanup complete，後續唯讀 reconcile 再確認所有 run-owned workload／CNI／forward／guard 均為零且 remote、cluster/host baseline restored。worker 同時段 kernel 日誌沒有 UDP/53 UFW block；唯讀 `iptables -S` 顯示 FORWARD 先跳 DOCKER-USER，其唯一規則跳至 ONEVPS-INGRESS；後者最後為不帶條件的 DROP，而 UFW chain 位於它之後。這能解釋 UDP DNS 在 UFW allow 前被丟棄。新程式只對實際 CNI `/32` → plan resolver `/32` UDP/53，在 DOCKER-USER 插入 run-tagged 精確 `ACCEPT`；plan 先驗證該 hook 與 ONEVPS-INGRESS 的 terminal-drop／既有 TCP/443-accept shape。HTTPS 使用已核實的 TCP egress 路徑，不另插規則；cleanup 按完整 tuple 移除。

2026-09-24 17:44 UTC 的新 plan/run `20260924T174428Z-a6f4feb1` 通過：管理私網 host HTTP 200，worker 公網 v4/v6 TCP/80 兩項均阻擋，core 公網管理 ports 2379／2380／5001 在 v4/v6 六項均阻擋。bridge resolver 與 plan 相同，A query exit 0、回傳 1 個 plan 內 IPv4 answer；BusyBox wget IPv4 HTTPS exit 0／HTTP 200。execute 清理移除唯一 run-tagged DNS rule、唯一 run-owned CNI NAT rule、bridge／host workloads 和 nft guard。read-only reconcile 再確認 workload／CNI／forward rule 數皆為 0，remote 與 cluster/host baseline restored。完整 raw plan、journal、命令觀測及 evidence 保存在 gitignored `private/operations/network/`。
本機全套 211 項測試已通過，包含 BusyBox wget／nslookup 能力檢查、DNS A 答案核對及 upstream forward-path readiness。ERU-006 最終實機驗收與獨立 reconcile 均通過；接續項目為 ERU-007。

# Controller B 操作器

最新狀態：[故障恢復與 reapply 驗證](M2-RECOVERY-2026-09-23.md)，操作入口見 [恢復與修補版 reapply](RECOVERY.md)。core 修補已部署，worker-4 的新操作器 smoke 已 PASS；worker-4 元件重裝已完成連續三次實機驗收。下列早期紀錄保留作背景，以最新實測為準。

ERU-001 已補上 core 更新於替換前中斷的 `recovery.py plan --action core-cancel`；來源、封存與回覆遺失規則見 [RECOVERY.md](RECOVERY.md)，剩餘編號見 [TASKS.md](TASKS.md)。

入口：scripts/labctl.py。可執行一般 plan／execute／status／reconcile 與 ERU-014 的獨立 worker-only install 階段。component-reinstall 只作用於通過健康／ownership／HTTP guards 的空 worker；provider-reimage 的總計畫仍唯讀不可執行。重灌前摘除與重灌後安裝都仍未在 VPS 驗收。

最新本機進度與健康诊斷命令見 [接續紀錄](M2-CONTINUATION-2026-09-22.md)。重裝正向流程已接線；最新實測計次與剩餘恢復工作見優先路徑文件。

## 使用方式

在 B 的專案根執行：

```bash
cd /home/ckc/test/codex/newclear-eru-delivery/labs/eru-vps-mvp
python3 scripts/labctl.py plan --operation smoke --node worker-4
```

plan 會透過四個 `ckc-disposable-*` aliases 讀取主機／runtime／Eru 狀態，另做 etcd 健康檢查。輸出實際受影響主機、步驟、blockers、計畫 ID、SHA256 及私有計畫檔位置。不會建立／刪除 workload 或重灌主機；會在 B 寫入私有計畫及觀測紀錄。

審閱計畫後，把輸出的 ID 與 hash 帶入：

```bash
python3 scripts/labctl.py execute --plan PLAN_ID --sha256 PLAN_SHA256
python3 scripts/labctl.py status
python3 scripts/labctl.py status --run PLAN_ID
```

同一 plan 只能嘗試執行一次；成功或失敗都不能直接重播。plan hash 是內容與範圍的綁定，不是使用者授權的替代品。新版本、inventory、generation、主機身分、runtime 或 workload 清單改變時，必須重新 plan。

reapply 計畫：

```bash
python3 scripts/labctl.py plan --operation reapply
```

core 已套用本機 patch；省略 artifact 的 release reapply 仍會阻擋可能的 downgrade。使用 `--core-artifact private/builds/BUILD/eru-core --health private/diagnostics/HEALTH-control-health.json` 可明確驗證並保留修補版，完整範例見 RECOVERY.md。此操作影響四台，執行已驗證的 worker-2 nginx canary + `deploy-lab.py --apply` 流程，核對容器、HTTP、pod／node、配額和服務重啟紀錄後清理。它是同版本部署驗證，不是宣告式應用 desired-state controller，也不會升級 OS。

依既有 smoke run 清理：

```bash
python3 scripts/labctl.py plan --operation cleanup --smoke-run SMOKE_RUN_ID
```

SMOKE_RUN_ID 是 `private/smoke/*.json` 的 run ID，不是外層 plan ID。操作器從該紀錄取得唯一 appname／node，再和 live workload 的 owner、run、node labels 對照，將精確 ID 清單固定在計畫中。建立成功但回覆遺失、原 evidence 沒來得及記住 ID 的情況，可透過唯一 appname + labels 找回；不是依名稱前綴直接刪除。來源 evidence 改變、出現陌生 owner 或新 workload 都會停止。每次 remove 前再核對一次；runtime／metadata 不一致或空節點仍占配額時不執行清理。

不提供全群 workload reset、盲目 `resource --fix`、刪 namespace 或刪 containerd data 的捷徑。

## 失敗後對帳

```bash
python3 scripts/labctl.py reconcile --run PLAN_ID
```

reconcile 只讀遠端，不重播部署、不自動清理。若原控制程序中斷而 journal 停在 running，取得鎖後會標成 interrupted，保留 failed_at 與目前觀測。SSH 無法連線時亦保存部分命令紀錄與 error，不把無法讀取當成空集合。

先檢查私有 run log、smoke evidence、runtime 與配額，再建立新的計畫處理明確範圍。timeout 代表結果不確定，不能以 timeout 直接推論遠端沒執行。

## 鎖、紀錄與適用邊界

- `private/controller.lock` 使用 flock，計畫／執行／reconcile 與直接呼叫的 deploy／smoke 腳本共用。子程序繼承同一 FD；父程序離開後，仍執行中的合作子程序會繼續持鎖。不要刪除 lock file 來解鎖。
- 這是 B 同一 checkout 的合作鎖；不能阻止 controller A、其他 checkout 或直接執行 eru-cli 的操作者。多 controller 協作鎖尚未實作，操作期間應維持 B 為唯一 mutation writer。
- `private/operations/cluster.json` 採納現有 basic 叢集為 generation 1；沒有建立新叢集。generation 不可當作已完成重灌的證明。
- 計畫固定 inventory、artifact/source files 的 SHA256、SSH effective config／trusted host keys、machine ID／boot ID、角色與現有工作負載。Git HEAD 另記為來源參考；未提交腳本以內容 hash 綁定。
- `plans/` 放不可直接重播的計畫；`runs/` 放每階段 journal 與子程序 log；`observations/` 放 plan／reconcile 的私有證據。JSON 以同目錄暫存檔、fsync、atomic replace 寫入，權限 0600。
- 執行前再次檢查 etcd 健康、runtime／metadata IDs、空節點配額與 node availability。檢查是當下的觀測，不能保證下一秒不發生磁碟延遲或網路故障。
- 仍依賴本機 `private/preflight`、已驗證 host public keys 及既有 Debian 環境，尚非新 controller／新 OS 的 bootstrap 工具。

## 人工 provider OS 重灌：前置摘除階段

此後備路徑與日常元件重裝分開。`provider-reimage` 總計畫永遠保持 `executable: false`；只有 `reimage_preparation.executable` 為 true、preparation blockers 為空時，專用 `prepare-reimage` 才能依同一 plan hash fence 並摘除一台已空的 worker。它不呼叫 provider API、不重灌 OS，也不安裝 worker 元件。

```bash
# B -> core ckc-disposable-01 與計畫綁定的 worker alias；先建計畫並人工審查 blockers/hash
python3 scripts/labctl.py plan --operation rebuild-node --node worker-4 \
  --mode provider-reimage --reimage-intent private/reimage-intents/worker-4.json
# B -> SSH 僅使用 ckc-disposable-01～04 aliases；寫入變更只落在 01 與目標 worker alias
python3 scripts/labctl.py prepare-reimage --plan PLAN_ID --sha256 PLAN_SHA256
python3 scripts/labctl.py status --run PLAN_ID
```

命令會再核對健康、ERU workload／runtime／配額、Docker 容器、保留服務、主機身分與叢集 membership；在 core 確認 Bypass，只停止目標 `eru-agent.service`，再次檢查 runtime 後移除精確 node registration，最後停在 `awaiting-owner-console-reimage`。它不會自動 `node up`。timeout／失敗先用 `reconcile --run PLAN_ID` 唯讀檢查 core 狀態，不能重播原 plan。receipt 需同一 plan 的成功 preparation journal；重灌後的 host verification 仍只讀。

有了同 plan 的 owner receipt 與 replacement-host observation 後，可離線產生 worker bootstrap plan：

```bash
# B 本機讀取 private plan/receipt/observation；不連 core/worker
python3 scripts/labctl.py plan-reimage-worker --plan SOURCE_PLAN_ID --sha256 SOURCE_PLAN_SHA256
```

它只準備鎖定的 agent/CNI payload 與舊 node capacity／labels 的 registration 意圖；總 plan 仍不可執行。完成人工 OS 重灌與 strict host verification 後，可對計畫綁定的 ckc-disposable worker alias 執行 install-reimage-worker，並以 status 查看同一 run。安裝前會重核 owner receipt、host key、machine incarnation、core health／membership、其他 hosts、乾淨 install paths、保留服務與空 runtime；只安裝 locked worker artifacts／worker 設定與 core 公鑰，只啟動 eru-containerd-proxy.socket，agent 保持停止／disabled、node 保持未註冊。worker_install gate 只代表這個有限階段，總 plan executable 仍為 false。若中斷或回覆不確定，只對同一 run 執行 read-only reconcile，不能重播安裝。

安裝階段目前只以 fake operator／remote responses 驗證，沒有連線或修改任何 VPS；重新納管、HTTP smoke、resume、恢復 executor 與正式 OS reimage acceptance 仍待本機開發收尾後另行安排。詳見 M3-REIMAGE-WORKER-INSTALL-2026-09-26.md。

## worker-4 重建計畫

```bash
# 日常預設：我們自己的元件清理重裝；保留 OS 和共享 runtime。
python3 scripts/labctl.py plan --operation rebuild-node --node worker-4
# 後備：人工 provider 控制台重灌，不要求 API。
python3 scripts/labctl.py plan --operation rebuild-node --node worker-4 --mode provider-reimage
```

預設 `component-reinstall` 模式會額外在所選 worker 唯讀核對 ownership、SHA256、symlink／hardlink／mount 邊界，列出六個專用檔案、三個本機狀態根與保留項目。只接受空的 worker-2／3／4；不自動搬移應用、不重建 core／etcd。省略健康與 canary evidence 時保持 `executable: false`；provider-reimage 始終不可執行。完整正向流程見下節，恢復底層與完整事故處置 CLI 分開標示。

日常路徑不需要供應商或重灌工具資訊。只有啟用後備 OS 重灌時才需確認 provider 主機身分、OS image、磁碟／volume 範圍、新 host key 與 OneVPS bootstrap。詳細語意、範圍及验收見 [自控重裝](CONTROLLED-REINSTALL.md)。

## 驗證

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -v
```

測試使用暫存目錄和假的遠端介面，覆蓋跨程序互斥、子程序持鎖、檔案權限、漂移拒絕、精確清理、不確定結果與禁止重播；不會刪遠端容器。實機結果與已遇到的 etcd 故障見 [開發紀錄](M2-2026-09-22.md)。

## 選定空 worker 的日常元件重裝

先確保沒有需要保留的 ERU workloads。canary-start 要求全群 ERU workload 空；預設建立一個 worker-2 和一個 worker-3 的測試 nginx，選定 02／03 時用 `--exclude-node` 建立另兩台守護；它們保留到明確 cleanup，供多輪重裝共用。每一個 execute 都使用上一個 plan 顯示的 ID 與 SHA256。

```bash
python3 scripts/labctl.py plan --operation canary-start
python3 scripts/labctl.py execute --plan CANARY_PLAN --sha256 CANARY_HASH
python3 scripts/control_health.py --samples 31 --interval 5
python3 scripts/labctl.py plan --operation rebuild-node --node worker-4 \
  --health private/diagnostics/HEALTH-control-health.json --canary-run CANARY_PLAN
python3 scripts/labctl.py execute --plan REINSTALL_PLAN --sha256 REINSTALL_HASH
```

`canary-start` 預設在 worker-2／3 建立守護。ERU-008 本機準備新增 `--exclude-node worker-2|worker-3|worker-4`，使所選目標保持空白，另兩台各有一個 run-owned nginx；只在全群 workload 空時允許計畫執行。worker-2／3 的重裝與恢復已有本機執行器，但實機尚未驗收；見[配對](M2-WORKER-PEER-GUARDS-2026-09-24.md)與[執行器限制](M2-WORKER-PEER-EXECUTOR-2026-09-24.md)。目前 24h soak 的固定配對仍是 02／03，不能在進行中的觀測期間建立第二組。

canary run ID 就是 canary-start plan ID。健康 evidence 需 complete、至少 20 次／120 秒、相鄰觀測無超過 20 秒的缺口，最後樣本距執行不超過 10 分鐘；並對應目前 core invocation。必要時重新收集。要觀察負載中的 etcd，可另跑 `control_health.py --concurrent-read-only --samples 61 --interval 5`；此模式不拿 mutation lock，禁止搭配 disk probe。

同一組 canaries 可供連續三個新 rebuild plan 使用。每轮都重新核對空 target、綁定來源與 core SHA，備份／重裝後做 target smoke，再檢查其他 worker HTTP、服務 invocation 和身份。節點與 workload 清單按 identity 排序後比較；資料內容有變仍失敗。只在 guard 最終無失敗且 node up 已核對後增加 component revision，OS incarnation／cluster generation 不增加。

完成後按原 canary run 精確清理：

```bash
python3 scripts/labctl.py plan --operation cleanup --smoke-run CANARY_PLAN
python3 scripts/labctl.py execute --plan CLEANUP_PLAN --sha256 CLEANUP_HASH
```

失敗先 reconcile，保留 fencing／quarantine evidence；不要直接重播或把 failed 改成 complete。`recovery.py` 使用新的 source-bound plan 提供 worker-restore／worker-resume，以及 core API 不可用時的 core-rollback。新 agent 狀態不覆蓋；恢復不增加重裝計次。具體條件與有界故障演練見 RECOVERY.md。

## 不依賴 B 連線的長時觀測

使用 [VPS 背景觀測](SOAK.md) 的 `soak.py start/status/stop`。觀測交给 01–03 的有限時長 systemd service，B／Codex 可離線；程序、樣本和退出結果留在各 VPS，回來後再收集與驗收。觀測期間可繼續本機開發與唯讀排查；改動 VPS 前應先明確中止此次觀測。

## ERU-006 host network 與管理埠驗收

入口：[scripts/network_acceptance.py](../scripts/network_acceptance.py)。這是一次性的 worker-4 acceptance run，與 worker 元件重裝及 provider OS 重灌分開。plan 只讀取叢集與 worker-4 狀態，驗證 B 的 Tailscale source、worker 公網 v4/v6 路徑及 TCP/22 control、core 公網路徑、runtime 空狀態、UFW routed policy、Fail2ban、forward chain、worker DNS resolver／鎖定 HTTPS endpoint、nftables hook 順序與鎖定 nginx image；private addresses、完整觀測與命令輸出只寫在 `private/operations/network/`。

```bash
cd /home/ckc/test/codex/newclear-eru-delivery/labs/eru-vps-mvp
python3 scripts/network_acceptance.py plan
python3 scripts/network_acceptance.py status
```

只有 `executable: true` 且 blockers 為空的 plan 才能執行。人工檢查 plan ID、SHA256、目標與步驟後，執行一次：

```bash
python3 scripts/network_acceptance.py execute --plan PLAN_ID --sha256 PLAN_SHA256
```

計畫固定 inventory、專案輸入 hash、cluster generation、workload/runtime snapshot、服務與防火牆 baseline、管理來源及 public route controls。execute 會再次核對健康和計畫；漂移時停止並要求新 plan。它在 worker-4 暫加唯一 `inet` nftables table：priority `-10` 先允許精確的 Tailscale source 到 TCP/80，再 drop 其他 TCP/80；不改 UFW default policy、`/etc/ufw` 設定檔、TCP/22、Tailscale、Docker/containerd 或控制面服務。之後部署鎖定 nginx host-network workload、檢查 containerd image/labels、task PID ancestry 和 v4/v6 listener，依序測管理私網 HTTP 200、worker 公網 v4/v6 TCP/80 阻擋、core 可用公網地址上的 2379／2380／5001 阻擋。為測 bridge egress，執行時讀取容器 resolver 並確認鎖定 image 內的 BusyBox `wget` 支援所需 flags；探測命令用 `-Y off` 明確停用環境 proxy，只有 IPv4 resolver 符合 worker 計畫才繼續；插入臨時規則前也會確認 BusyBox `nslookup` 支援 `-type=QUERY_TYPE`，並核對 worker 的 DOCKER-USER／ONEVPS-INGRESS 先於 UFW 的實際 forward path。plan 也會確認 ONEVPS-INGRESS 對既有 TCP/443 egress 的規則；execute 僅在 DOCKER-USER 頭部暫插 CNI `/32` 到 resolver `/32` 的 UDP/53 `ACCEPT`，HTTPS 沿用已核實的 TCP 路徑。因 BusyBox wget 沒有 GNU wget 的 `-4` 選項，固定使用 IPv4-only hostname `ipv4.icanhazip.com`；plan 同時查詢 A／AAAA，只有至少一個 global IPv4 且沒有 IPv6 DNS answer 才允許執行。先以容器 resolver 明確查詢 A record，要求結果非空且全屬於 plan，再發送 HTTPS request；探測不修改容器 `/etc/hosts` 或 host resolver，response body 導向 `/dev/null`。HTTPS 使用 plan 核實的既有 TCP egress 路徑，不增添 TCP/443 規則。唯一臨時規則不寫入 UFW 設定檔、不放寬 routed default policy；測後依 run comment、完整 tuple 與 `ACCEPT` target 精確刪除。規劃階段用 TEST-NET 位址執行只讀 `iptables -C` 語法檢查，不插入規則。nft policy hash 忽略的只有 `inet f2b-table/addr-set-sshd` 動態成員；該 set 定義、chains、rules 和其餘 ruleset 仍完整比對，Fail2ban service 狀態另外核對。core 沒有公網 IPv6 時只對其實際存在的公網地址驗證；worker 公網 v4 與 v6 都是必要條件。

execute 最後先依 comment 和完整規則欄位移除 run-owned bridge egress 例外，再移除 run-owned workload 與其 CNI NAT rule，最後移除精確的臨時 nft table，然後比對 host/runtime、service、listener 與 nft/UFW policy baseline。若移除 host-network workload 不成功，會保留 TCP/80 guard。發生失敗或程序中斷時先執行唯讀 reconcile，再依當前狀態建立新的清理 plan；禁止重播舊 plan：

```bash
python3 scripts/network_acceptance.py reconcile --run RUN_ID
python3 scripts/network_acceptance.py cleanup-plan --run RUN_ID
python3 scripts/network_acceptance.py cleanup-execute --plan CLEANUP_PLAN_ID --sha256 CLEANUP_PLAN_SHA256
```

reconcile 不重播遠端命令，也不自動清理；只有實際 workload、CNI NAT rule、tagged forward exception 與 guard 都已消失，且原 cluster、host、service、防火牆 policy 回到 baseline 時，才會依讀回狀態補記本機清理 journal。`status` 只讀本機私有摘要。所有遠端連線固定經 `ckc-disposable-01`（core）及 `ckc-disposable-04`（worker-4）；不得改用裸 IP、其他 worker、provider API 或全域 reset。

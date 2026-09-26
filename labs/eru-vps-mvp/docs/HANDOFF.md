# 接續開發交接：ERU VPS MVP

更新：2026-09-26。固定剩餘任務編號以 TASKS.md 為準：仍為 12 項（近期 1、後續 11）；ERU-001～006 已完成，ERU-007 待正式 V11 小流量驗收。依 owner 指示先完成本機開發，再統一進行 VPS E2E。ERU-012 本機 desired-state 功能已齊待 E2E；ERU-013 provenance／版本 guard 已合併，既有 v0.1.5 patch 已以 Go 1.27.1 隔離重驗；ERU-014 已有 worker-only install、core access preparation、fenced registration／smoke／safe-resume，以及 hash-bound inventory／generation commit executors 與唯讀 reconcile；safe AddNode patch 已完成 Go 1.27.1 雙環境建置，仍 verified-not-deployed。generation stage 只以 fake fixtures 測試，未讀寫真實 private data；仍缺跨階段 recovery 與整體 E2E，任務數未減。每完成正式任務須更新清單並回報編號與剩餘數。24h 低頻觀測已於 2026-09-24 11:25:06 UTC 結束，摘要見 TODO-SOAK-2026-09-23.md。

## 目標與固定邊界

日常只清理／重裝指定 worker 的 ERU 元件，保留 OS、SSH、Tailscale、Docker/containerd、控制面與 node 身分。provider 控制台人工重灌僅作最後手段，不接 provider API；元件重裝、全新 OS、全群 fresh 分開驗收。

工作樹 `/home/ckc/test/codex/newclear-eru-delivery`，分支 `work/eru-014-generation-commit`，專案 `labs/eru-vps-mvp`。其他工作樹的 Kith 未提交修改必須保留。Repo 本輪整併見根目錄 `docs/repo-consolidation-2026-09-22.md`；GitHub PR #29–#31 已合併。

B→VPS 一律使用 `ckc-disposable-01`～`04` SSH aliases，命令標示主機。01 是 core／單成員 etcd／CLI／storage plugin，02–04 是 worker-2／3／4。ckc 登入後 sudo，不改 root SSH 禁令；有效公鑰檔是 `/etc/ssh/onevps-personal-admin/ckc.keys`。

`private/` 連回 `/home/ckc/test/newclear/labs/eru-vps-mvp/private/`。真實 inventory、credentials、host identity、artifact 與 raw evidence 不可提交。新工作樹先連回可信資料，不採用 public examples 作實機 inventory。不要 reset 其他工作樹。

## 已交付

- 固定 core source + patch 在隔離 Go 1.27.1 通過原版失敗／修補成功的回歸、calcium／lock tests 與建置；兩次獨立 binary SHA 相同。
- core-only 更新已部署，run `20260922T145650Z-0106bbd2`；執行中的 SHA 為 `1e674e955b6504892d9e7a60807e02e18043ba739787481bbd456cb30ca68363`。只預期重啟 core，保留舊 binary／owner manifest 與遠端更新 journal。
- patch 後 worker-4 新操作器 smoke PASS（`20260922T150023Z-1d1e3892`），包含 HTTP、stop/start、exec/logs、超額 memory/storage 拒絕與配額歸零。
- `labctl` 支援 plan／execute／status／reconcile、精確 cleanup、canary-start，以及具有健康／core SHA／空 target／ownership／連續 HTTP 守護的 worker-4 component-reinstall。
- 六個 ERU 檔案和三個狀態根先備份校驗再 quarantine；worker-only installer 不動共享 runtime。失敗保留 journal，不重播。恢復底層拒絕覆蓋新資料，已有中斷／checksum／link／mount 測試。
- 本機 196 項測試通過。worker-4 元件重裝已連續 3/3 成功，component revision 3、cluster generation 1；詳見優先路徑文件的實測表格。

- 新增 source-bound recovery CLI、patched-core reapply，以及 worker-4 quarantine／start 兩個有界故障演練點。恢復與原成功重裝計次分離，patched reapply 與 worker restore／保留新狀態 resume 的實機驗收通過，最後已清理測試 workload；詳見 2026-09-23 紀錄。

- `soak.py collect/report` 可在程序運行時唯讀回收固定長度／SHA 的 evidence，離線核對完整性與功能錯誤，並對照 guest I/O／CPU 指標；141 tests 通過，三台實機中途回收及離線分析成功。詳見 [SOAK.md](SOAK.md)。

- ERU-002 已完成：run `20260923T112336Z-561e71e7` 三台各 2,881 筆、共同覆蓋 86,400 秒，最大間隔 30 秒；完整性錯誤、功能失敗及警告皆為零。WAL fsync p99 桶上界 8 ms（6,308 observations），backend commit 只有 2 observations，尾端統計證據有限。這不是 V11 PASS；歷史慢 fdatasync 根因仍未證實。[結果與限制](TODO-SOAK-2026-09-23.md)。

- ERU-003 已完成：plan `20260924T112838Z-4deeeff4` 只清理原 run 的兩個 run-owned nginx workloads。執行 journal complete；after snapshot 無 workload，三個 worker 配額歸零且可用；etcd／core／agent／Docker／containerd 服務保留，etcd health 成功。firewall oneshot 處於預期 active/exited，worker proxy socket listener 存在；全程未做 blanket reset。私人 plan／journal 與 host 詳細輸出留在 local `private/`。

- ERU-004 已完成分析交付：[最新紀錄](M2-ETCD-ANALYSIS-2026-09-23.md) 納入完整 24h 低頻結果與官方 etcd v3.6、Linux PSI/diskstats、Prometheus histogram 資料。歷史症狀最支持暫時性持久化 I/O 停頓，但無法歸因 guest、虛擬磁碟、宿主機或 provider；根因仍未證實，沒有進行儲存變更。若復發或取得 provider 同時段 telemetry，再新增明確診斷／修復任務。

- ERU-005 已完成一次受控實機 core API outage／恢復：2026-09-24T12:10:48Z 停止 01 的 eru-core，以獨立新 recovery plan 還原可驗證備份，再以 fresh health-bound plan 隨後回切已驗證 patch。31 筆／149.7 秒的 etcd／服務樣本 health failure 為 0；WAL p99 桶上界 8 ms（60 observations），backend commit 在窗口內無 observation。結束時 core API 可讀、執行 binary 符合驗證記錄、3 workers available、配額／runtime／workloads／三個 etcd metadata 前綴皆為零，受保留服務比對不變；原始 plan、journal、health evidence 留在 private。此演練不證明 VM／磁碟故障恢復，也不解決歷史 fdatasync 根因，詳見 [ERU-005 紀錄](M2-CORE-API-RECOVERY-2026-09-24.md)。

- ERU-006 已完成：run `20260924T174428Z-a6f4feb1` 以鎖定 worker-4 nginx 驗證管理私網 HTTP 200、公網 v4/v6 TCP/80 阻擋；core 公網 2379／2380／5001 各走 v4/v6，共六項皆不可達。bridge workload resolver A query 符合 plan，IPv4 HTTPS 回 200。因 worker `DOCKER-USER → ONEVPS-INGRESS` 先於 UFW 丟棄 UDP，臨時增加一條僅限 CNI `/32` 到 resolver `/32` UDP/53 的 run-owned ACCEPT；沒有更動持久規則；worker 原有 TCP/80 Anywhere allow 仍保留，這次不代表 port 80 持續受保護。清理後 read-only reconcile 確認 workload、CNI NAT、forward rule、guard 為零，worker/core 與 cluster baseline restored；raw evidence 留在 private。詳見 [ERU-006 紀錄](M3-NETWORK-ACCEPTANCE-PREP-2026-09-24.md)。

- 補上 core 更新／rollback 的 32 個程序中斷切點與一次未知後續更動測試（33 次真實 SIGKILL），修正早期 journal 錯誤與權限／hardlink／mount 拒絕條件。均在本機暫存目錄驗證；[本輪交接與剩餘 TODO](M2-CRASH-RECOVERY-2026-09-23.md)。

- ERU-001 已完成：`recovery.py plan --action core-cancel` 可為替換前中斷新增取消 intent／receipt，保留原 journal、部分備份與未知資料；reapply 核對封存後才排除該 pending update。新增 20 tests、12 次 SIGKILL，原 journal 缺失仍拒絕取消。只做本機驗證，沒有實機故障注入；[交付紀錄](M2-CORE-CANCEL-2026-09-23.md)。

- ERU-007 的每秒私網 HTTP 模式與離線核對已在本機完成，另加 8 tests；實機短 pilot 與獨立 24h run 尚未執行，仍為進行中。ERU-002 的 30 秒低頻觀測已完成，不能替代 V11。[準備紀錄](M3-V11-PREP-2026-09-23.md)。
- ERU-012 本機功能已齊：digest-pinned stateless HTTP spec／review planner、hash-bound executor、EruCLIAdapter 與 exact-ID cleanup；沿用 labctl.Operator、固定 SSH aliases、雙階段 etcd/core/consistency preflight、digest image cache、bodyless worker probe，並在每次 remove 前驗新版 readiness。容量 admission 交由 Eru resource plugin，v1 不含外部 traffic routing。planner／executor／adapter／cleanup 共 50 個離線測試。adapter 尚未對 VPS 驗證，仍需真實 CLI/API/job 與 VPS E2E；依 owner 指示，這些整合驗收排在本機開發之後。[前置紀錄](M3-APP-DESIRED-STATE-PREP-2026-09-25.md)。
- ERU-013 本機功能進行中：patch validator 支援選定 patch、revision、精確 Go 版本／archive SHA 與版本專屬 test package；新增雙次 private build manifest publisher 與 versioned validator，綁定 source tag／commit、patch SHA、architecture、toolchain SHA、獨立重建 artifact SHA 及相容版本測試。core patch plan 區分 baseline install、同 artifact reapply、同版本 patch revision、跨版本 upgrade；隱性 downgrade 拒絕，回退仍必須引用原 source run。現有 v0.1.5 patch 已以 Go 1.27.1 隔離重驗：baseline regression tests 重現 panic，patch 後 calcium／locks tests 通過，兩次 clean archive build 與 validator build 都重現原 artifact SHA；沒有改 manifest 或部署。尚無新 upstream 版本的真實 build／compatibility evidence，也未做 VPS upgrade／rollback E2E。[provenance 紀錄](M3-CORE-RELEASE-PROVENANCE-2026-09-25.md)、[Go 1.27.1 重驗紀錄](M3-GO127-REVALIDATION-2026-09-25.md)。
- ERU-014 本機前置進行中：人工控制台 intent／receipt、replacement identity gate、hash-bound preparation／planner、worker-only install、registration 前 core known_hosts／nft access preparation、fenced registration、fenced smoke、safe-resume 與 resume 後 generation commit executors／唯讀 reconcile 均以 fake operator 驗證。generation commit 重驗 successful resume、worker IP／OOB host key 與 core access proof，再只更新 private deployment plan 的 target IP／core known_hosts／firewall render，最後將 generation 加一；journal/reconcile 可辨識精確 partial write 並要求明確續跑。這些測試只用 temp fake fixtures，沒有讀寫真實 private data。各階段不確定時先唯讀 reconcile，不重播遠端 mutation。safe AddNode patch：pinned v0.1.5 新 node 預設 Bypass=true，Go 1.27.1 兩個隔離 build 的 regression／calcium+store／lock tests／build 均通過。patch 仍 verified-not-deployed，未連 VPS。仍缺跨階段 recovery、受控部署與 E2E；總剩餘數仍為 12。詳見 [safe AddNode](M3-CORE-SAFE-NODE-ADD-2026-09-26.md)、[core access](M3-REIMAGE-WORKER-ACCESS-2026-09-26.md)、[registration](M3-REIMAGE-WORKER-REGISTER-2026-09-26.md)、[smoke](M3-REIMAGE-WORKER-SMOKE-2026-09-26.md)、[resume](M3-REIMAGE-WORKER-RESUME-2026-09-26.md) 與 [generation commit](M3-REIMAGE-WORKER-GENERATION-2026-09-26.md)。

- ERU-011 新增 [controller 本機接手檢查](M3-CONTROLLER-PREFLIGHT-2026-09-23.md)：記錄套件／來源／artifact／patch 與外部私有輸入、SSH alias；不連 VPS。乾淨 controller 實際 bootstrap 尚未驗收，總剩餘數不變。

## 尚未完成的工作與殘餘風險

- ERU-004 分析已交付，但歷史 23.53 秒 slow fdatasync 的底層根因仍未證實。完整 24h 低負載 run 沒有重現 slow warning／功能錯誤；WAL fsync p99 桶上界 8 ms，backend commit 僅 2 observations。這不是根因修復或排除間歇性風險；不把 WAL p99 單獨當硬性阻擋，也不以放大 timeout 掩蓋故障。若復發，先採集同時段 guest 與 provider telemetry，再決定是否新增實作／遷移任務。
- ERU-005 已通過單次實機 core service outage 恢復與 patched binary 回切，但這不涵蓋真正 VM／磁碟 power-loss、etcd 資料損壞、未知新檔案歸屬與非空 workload 災難恢復；也未證明歷史慢 fdatasync 根因已修復。程序 SIGKILL 切點另已補驗。replace-intent 前且具備 durable backing-up journal 的顯式取消／封存已完成；原 journal 缺失時仍保留資料並拒絕自動處置。
- 原 release reapply 仍禁止隱性 downgrade；ERU-013 本機 guard 現已為 versioned release 增加 artifact provenance 與版本轉移分類。可部署 catalog 目前只有 v0.1.5；下一個 upstream 版本仍須產生獨立重建與每個相容來源版本的成功測試記錄，並以 fresh plan 完成 upgrade／rollback／interruption 及 VPS 驗收。
- ERU-008 已交付 worker-2／3 身分與空節點的唯讀計畫稽核、[目標外 HTTP 守護配對](M2-WORKER-PEER-GUARDS-2026-09-24.md)及[peer 重裝／恢復執行器本機驗證](M2-WORKER-PEER-EXECUTOR-2026-09-24.md)；[兩台歷史計畫](M2-WORKER-PEER-PREP-2026-09-23.md)。peer 實機重裝與恢復尚未驗收；非空 target 的 drain、OS 重灌、全群 fresh、HA／snapshot restore 尚未驗收。ERU-002／003／004 均已交付；worker-2／3 peer 實機重裝仍待驗收。

## 接手先做

```bash
cd /home/ckc/test/codex/newclear-eru-delivery
 git status --short --branch
 PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s labs/eru-vps-mvp/tests -v
 python3 labs/eru-vps-mvp/scripts/controller_preflight.py
 python3 labs/eru-vps-mvp/scripts/labctl.py status
```

soak TODO 所列 24h observer 已自然結束並完成回收，不需停止或重啟；之後只唯讀讀取最新 journal／runtime／配額／健康。三次重裝的計次只能取 complete run 與 `worker-component-revisions.json`；初次因節點陣列順序而失敗的 run 保留 failed，沒有追認成 PASS。HTTP canaries 用其原 run 的精確 cleanup plan 清理；不 prune、不全群 reset、不刪 controller lock。

新程式、inventory、core revision 或 health evidence 會改變 plan bindings；使用新 plan，不複用失敗計畫。B 的 flock 只涵蓋同一 private 目錄的合作程序，操作期間維持 B 為唯一 mutation writer。

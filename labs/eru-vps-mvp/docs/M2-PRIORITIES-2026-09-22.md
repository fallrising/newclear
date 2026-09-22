# 優先打通元件重裝：故障分析與處理成本

本輪先整併 repo 未合入工作；整併與測試依據見 [主幹紀錄](../../../docs/repo-consolidation-2026-09-22.md)。ERU 的原始 journal、實機 inventory 與診斷仍只保存於 private。

## 已確認、推論與未確認

| 問題 | 證據／確定程度 | 不處理的影響 | 處理優先與成本 |
| --- | --- | --- | --- |
| core 鎖失敗後 nil context panic | 已確認：固定來源、實機 stack、原版回歸失敗、修補版測試通過；兩次獨立建置 SHA 相同 | etcd timeout 會擴大成 core process crash，API EOF／短暫不可用；操作結果不確定 | 第一優先。修補範圍小，現成 artifact；成本以備份、core-only restart 和功能回歸為主 |
| etcd WAL 同步長停頓 | 已確認現象：11:13–11:42 UTC 的 20 次 slow fdatasync，最高約 23.5 秒；當時 I/O wait 升高 | metadata／lease／lock 操作逾時，部署失敗或留下需對帳的配額；修 core 不會讓慢磁碟變快 | 同步調查，先用有界功能試驗判斷 MVP 可否繼續；若負載下再出現秒級停頓，停止該次 mutation 並對帳 |
| guest 外部的虛擬磁碟／宿主機儲存抖動 | 目前主要假說，未證實：KVM virtio root disk、容量僅約 1%、故障後 CPU／記憶體未飽和；kernel 查無 I/O error／OOM，列出的常規 timer 未對上時段 | 若重現，單台控制面的可用性仍不可靠 | 先交叉比對 guest CPU steal、IO PSI、diskstats 與 etcd journal。供應商宿主機／儲存事件可補證，並非開發必須等待的輸入 |
| worker 重裝執行器尚未完成 | 已確認：quarantine/install/restore 底層有本機測試，live wiring／連續 HTTP guard 與三次完整實機驗收已完成 | 已取得連續三次完整成功；後續仍需處理故障恢復與長期觀測 | 接在 core 功能回歸之後；屬中等開發／故障恢復驗證工作，不需 provider API |

這裡的低／中等成本是工程範圍估算，不是供應商報價或交付工時承諾。直接新增多台控制面、snapshot restore／HA 和 OS 重灌驗收成本較高，保留在後續階段。

## 性能建議和功能門檻分開

etcd 官方把硬體配置列為起點而非硬性規則，開發／測試可用較小機器，但需以實際負載驗證。WAL fsync p99 10 ms／backend commit p99 25 ms 是排查磁碟是否足夠快的建議。慢寫入可能造成 heartbeat／請求延遲；拉長 election timeout 也會延後故障偵測，不能當成修好 I/O。[官方硬體建議](https://etcd.io/docs/v3.7/op-guide/hardware/)、[FAQ](https://etcd.io/docs/v3.7/faq/)、[調校說明](https://etcd.io/docs/v3.7/tuning/)。

本輪兩段 31 次／150 秒唯讀觀測都沒有 health 失敗、服務 invocation 改變或新的 slow/panic 日誌。WAL 的 60 筆新 observations 分別落在 p99 bucket upper 128 ms 和 16 ms；這是 histogram 上界，不是精確 p99，反映時段差異。backend commit 沒有新樣本，不能宣稱 backend 性能合格。先前 scratch-file fdatasync p99 約 70 ms 也不是同一種統計。

有界功能試驗要求近期至少 20 次／120 秒完整觀測、四個被觀察服務 active、沒有 timeout／alarm／panic／重啟／counter reset，執行前再次核對健康與 runtime／metadata／配額。性能建議未達與 idle histogram 缺樣本保留為警示；它們不單獨阻擋一次小範圍試驗。這不是 production readiness 或 24h soak 驗收。

01 為單成員 etcd；本機 fdatasync 耗時不能用 worker 到 core 的 Tailscale RTT 解釋。它支持優先查儲存路徑，但沒有足夠證據指定某個供應商故障。既有 nginx 可能繼續服務，控制面操作卻失敗；須以其他 workers 的連續 HTTP guard 實測，不能只由架構推定無影響。

## 本輪 core-only 工具

`scripts/core_patch.py plan --artifact private/builds/BUILD/eru-core --health private/diagnostics/HEALTH.json` 會固定：已驗證 artifact／patch SHA、完整腳本與私有配置 hash、machine／boot identity、owned binary／unit／manifest、服務基線及近期健康。第一版只接受全群 ERU workload 空的情況。

`execute --plan ID --sha256 HASH` 先持有 B 的共同鎖，再於 01 保存舊 binary／manifest，驗證備份後原子替換 binary、更新 owner checksum；只 restart eru-core，核對 `/proc/PID/exe` SHA、API、membership 和所有受保留服務的 invocation。遠端 journal 位於 `/var/lib/eru-mvp/core-updates/ID`；timeout 不重播，失敗不自動 rollback。

低層恢復只接受原版／本次修補的 checksum，遇到備份損壞、後來的新檔案、symlink／hardlink／mount 或 unit 漂移都拒絕覆蓋。健康 API 仍可用時可用新的 `plan --rollback-run ID --health ...` 明確規劃還原；若 core 無法啟動或 binary／owner 更新中斷，先用 SSH 與原 journal 核對，走 `CoreUpdate.rollback` 的精確恢復底層，不能把原失敗 execute 重跑一次。該故障下的完整 CLI 恢復仍待接線。

release reapply 暫時拒絕覆蓋已套用的本機 core patch；固定 upstream release lock 保留原意，不把修補 binary 偽稱 upstream release。worker-only 重裝使用自己的 agent artifact，不受這個保護阻擋。

## 排查的下一個決策

- 功能試驗成功且沒有新的秒級停頓：繼續 worker-4 元件重裝，保留性能追蹤。
- 問題重現：取同一時窗的 WAL／backend delta、proposals pending/failed、IO PSI／diskstats、core／etcd journal；先做唯讀對帳，再開新 plan。
- 若可重現的 guest 內競爭成立：先減少該競爭工作；沒有證據前不任意改 I/O scheduler／優先權。
- 若虛擬磁碟延遲持續、guest 無可調來源：評估只遷移 01 或獨立低延遲儲存，需先驗 snapshot／restore，成本高於小 patch；不重置三個 workers。
- OS 真的失去可信狀態才走 owner 的 provider 控制台重灌；它与元件重裝分開驗收。

## 已取得的實測進展

- core-only 更新 `20260922T145650Z-0106bbd2`：完成。14:58 UTC 只重啟 core，`/proc/PID/exe` SHA 為 `1e674e955b6504892d9e7a60807e02e18043ba739787481bbd456cb30ca68363`；etcd、其他 workers、SSH/Tailscale、Docker/containerd 的受保留 invocation 與叢集狀態不變。
- 第一個更新 plan `20260922T144839Z-0e3f7411` 在大 payload 傳輸／讀取階段達 SSH 90 秒時限；唯讀證據確認 binary 與服務未變、遠端更新 journal 尚不存在。保留失敗並 reconcile，改為 gzip payload 與專用傳輸時限後建立上述新 plan，沒有重播。
- worker-4 smoke `20260922T150138Z-a9784a`（外層 `20260922T150023Z-1d1e3892`）：建立、exec／logs、HTTP、stop/start、超額 memory/storage 拒絕、精確清理與 CPU/memory/storage 回零全部 PASS。
- 14:59–15:04 UTC 的負載觀測：61/61 health 通過，WAL 182 筆、backend commit 17 筆新樣本，兩者 p99 bucket 上界皆 16 ms；没有新 timeout、panic 或 invocation 變化。這是一段功能負載證據，不是長期穩定性保證。
- canary 初次建立後的立即探測得到 URLError；稍後 curl、同一 urllib probe 與同一串流監測器均正常。當次未保留 URLError detail，不能確定更深層原因；流程確實缺少應用 ready 檢查，現已補上有界 HTTP warmup，驗收窗口中的失敗仍不能被重試抹去。該次失敗保留，兩個 workload 已由新的精確 cleanup plan 清理。
- 本機 82 項測試通過，包含真實 HTTP／子程序串流、暫態 HTTP failure 保留、startup readiness、core 中斷恢復及禁止重播。元件重裝計次另記，尚不由以上結果推定通過。

## worker-4 元件重裝驗收：連續 3/3 成功

初次實機 pilot `20260922T152634Z-bab0d40c` 完成安裝與 target smoke，兩台 guard 各 39 次 HTTP 無失敗，但驗證把節點陣列順序交換誤判為漂移，故保留 failed 並維持 fencing。原 journal 證實只是 worker-2/3 順序不同，資料完全相同；修成按 name／ID 比較並補回歸，沒有放寬內容漂移條件，也没有追認舊結果。

其後三個新的 plan 依序完成：

| Plan/run | Component revision | worker-4 nginx／資源回收 | 02 HTTP | 03 HTTP |
| --- | --- | --- | --- | --- |
| `20260922T153356Z-c8c55e95` | 1 | PASS | 45/0 failed | 45/0 failed |
| `20260922T153734Z-abf57a6b` | 2 | PASS | 45/0 failed | 45/0 failed |
| `20260922T154235Z-00d8d123` | 3 | PASS | 47/0 failed | 47/0 failed |

每輪均驗證 OS machine/boot identity、SSH/Tailscale、Docker/containerd、控制面、其他 workers 的服務 invocation、node registration／容量，以及 guard workloads 保留；target 空且配額歸零，恢復排程後才計次。三輪各自的連續 HTTP 窗口每台共 137 次，沒有失敗或超過 5 秒的觀測缺口；不把輪間空檔或此結果宣稱為 24h soak。cluster generation 保持 1，只有 worker component revision 增為 3。

這是同一 OS 的元件重裝驗收。provider-reimage、全群 fresh、HA、完整實機失敗恢復仍未驗收；不需要先接供應商 API。quarantine 備份及歷次失敗 journal 均保留。

最後由 `20260922T155022Z-aa49ec42` 精確清理兩個 guard canaries。最終唯讀核對：全群 workload 0、三台 worker available 且未 fencing、CPU/memory/storage 配額全零、etcd health 通過且無 alarm、worker-4 ownership scope 通過；core SHA 與修補後 invocation 保持一致，NRestarts=0。原始證據位於 private/diagnostics/final-readonly-20260922.json，沒有提交 raw evidence。

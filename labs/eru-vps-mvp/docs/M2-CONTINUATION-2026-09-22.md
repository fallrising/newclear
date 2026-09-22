# M2 接續：隔離修補驗證與重裝底層

分支 `work/eru-vps-mvp-next`，承接 PR #27。開始時工作樹乾淨，原 34 項測試通過，既有三筆失敗 journal 原樣保留。本輪完成 **62 項 Python 測試、core 修補的 Go 回歸與建置**；**未部署修補、未停 worker、未執行三次元件重裝，M2 仍未完成**。

## core 修補已驗證，尚未部署

- 固定來源 `e19ceb7e09d95bedea3eb0c25bec9308101fecc5`，保持 upstream／release locks 不變。
- 使用 `/tmp/eru-go127-validation` 的獨立 GOROOT、GOPATH、GOCACHE；系統 Go 仍為 1.22.2。工具鏈為 [官方 Go 1.27.1](https://go.dev/dl/#go1.27.1)，下載 SHA256 已核對。
- 原草案測試的 `NewTestCluster` 沒有設定 LockTimeout，導致即使 production 修補正確，mock Unlock 的 context 仍立即逾時；已補 30 秒 fixture timeout，沒有修改 production timeout。
- 兩個回歸案例：第一把 lock 回傳 nil/error；先取得 pod/node locks、後續 lock 失敗並取消原 context，仍以有效 context 逆序解鎖。未修補來源兩者均重現 nil-parent panic；修補後通過。
- `go test ./cluster/calcium -count=1`、`go test ./lock/... -count=1`、`go build -trimpath` 成功。沒有宣稱完整 upstream 全套或 live 整合通過。
- binary SHA256：`1e674e955b6504892d9e7a60807e02e18043ba739787481bbd456cb30ca68363`。
- 原始 logs、binary 與工具鏈 metadata：`private/builds/core-lock-context-go1.27.1/`。公開的 [驗證摘要](../patches/core-v0.1.5-lock-context.validation.json) 不含主機 inventory 或原始 evidence。
- 新增 [隔離驗證工具](../scripts/validate_core_patch.py)：讀既有 core Git checkout 的固定 commit，輸出目錄必須是新的；在 Python 3.12+ 可重跑。完整工具入口已在第二個全新隔離目錄通過，artifact SHA256 與第一次建置完全相同。首輪工具入口發現巢狀 monorepo 會讓 git apply 跳過 upstream 路徑，基線測試正確攔下；已加獨立 Git 邊界與真實 Git 回歸測試，失敗 evidence 保留在 `private/builds/core-lock-context-runner-check/`，成功重跑在 `private/builds/core-lock-context-runner-check-2/`。

```bash
# controller B；source 只讀，output 不得存在。
python3 scripts/validate_core_patch.py --source /tmp/eru-core-review \
  --output private/builds/core-lock-context-next
```

## 01 儲存問題尚未解除

所有 B→VPS 操作均使用 `ckc-disposable-01`～`04`。先唯讀檢查四台：workload 0、runtime／配額一致，未重播失敗 plan。

13:27:54–13:37:54 UTC 約十分鐘共 61 次 endpoint health 全部成功，觀測的 core／etcd／Docker／containerd invocation 未變。窗口新增 120 次 WAL fsync，其 p99 所在 bucket 為 **(8 ms, 16 ms]**；backend commit 沒有新增觀測，不能據此判定 commit 延遲合格。原 collector 中途遇到 histogram 換行解析錯誤的一筆不完整 evidence 亦保留，已修正並加入回歸測試。

歷史 journal 再確認 11:42 UTC 尚有 11.46 秒和 3.79 秒的 slow fdatasync。根目錄為 `/dev/vda1` ext4，etcd 與 OS 共用磁碟；空間使用約 1%。本輪 vmstat 顯示 CPU 大多空閒、無 swap I/O，未觀察到先前 17–20% I/O wait。沒有證據足以指認 guest 程序或 provider 宿主機為確定根因；虛擬磁碟的 ROTA flag 亦不能證明底層硬體種類。

唯讀盤點後，另在 `/var/lib/eru-mvp` 建立唯一 4 KiB scratch file，以每次至少間隔 250 ms 做 120 次 `fdatasync`，**p99 69.76 ms、最大 82.67 ms**。測完只移除該檔，未寫 etcd keys／data，未改服務或 timeout。這表示同檔案系統同步寫入延遲仍不理想，但測量規模有限，不等同完整 I/O 壓测或 provider 根因證明。

參照 [etcd FAQ](https://etcd.io/docs/v3.8/faq/) 的 WAL p99 <10 ms／backend commit p99 <25 ms 診斷建議，以及本案既有候選門檻，暫不進入部署或 worker 停機。需要 owner 向 provider 核對 **2026-09-22 11:13–11:43 UTC** 宿主機／儲存事件；若需移機／換儲存，由 owner 決定，沒有實作 provider API 或 OS 重灌。

新工具：

```bash
# controller B → ckc-disposable-01；唯讀窗口，原始輸出只存 private。
python3 scripts/control_health.py --samples 61 --interval 10
# 明確的有限暫存檔寫入診斷；不是唯讀，也不是 etcd 壓測。
python3 scripts/control_health.py --disk-probe
```

私有 evidence：

- `operations/observations/handoff-2026-09-22T13-21-06.886758+00-00.json`
- `diagnostics/20260922T132754Z-control-health.json`
- `diagnostics/host-2026-09-22T13-34-20.074057+00-00.json`
- `diagnostics/fdatasync-2026-09-22T13-43-28.079022+00-00.json`
- `operations/plans/20260922T134728Z-e42e45ff.json`：本輪 worker-4 唯讀 plan；scope verified、workload 0、executable false。其後驗證工具有修改，此舊 plan 不可用於執行。

## 元件重裝開發與界限

[worker_reinstall.py](../scripts/worker_reinstall.py) 完成可在暫存檔案系統驗證的底層：

- 精確六個元件檔案／三個候選狀態根；先備份、核對 checksum、fsync，再按已記錄項目逐一移除。備份與 intent／result journal 保留，不提供 blanket reset。
- 安裝只接受與原 ownership hash 相符的六檔 bytes；共享 runtime、SSH keys、CNI binaries、控制面不在範圍內。
- 恢復先整批驗備份與目前檔案。原 inode 未變的項目可保留；僅填補缺項。對已落盤記錄的本次安裝產物，必須 inode、mode、checksum 全符才可移除後恢復。新 agent 狀態、陌生檔案、未落盤的不確定結果一律阻擋。
- 強化 `worker_scope.py`：檢查可寫父目錄及 `/proc/self/mountinfo` 的同裝置 bind mounts。
- root-side helper 再核對 worker-4 machine ID、manifest、ERU 服務停止及空 runtime，並使用本機 flock。尚未送到 VPS 執行。

[component_reinstall.py](../scripts/component_reinstall.py) 提供已做 fake-controller 測試的狀態機原型：準備 pinned payload、node down、只停 04 的 ERU units、quarantine／install、target smoke、原服務與其他節點不變、node up 及 component revision。**尚未接到 `labctl execute`**。一般排程的 bypass 與指定單 node smoke 的行為是固定 upstream 的原始碼推論，尚無實機確認。

仍缺：控制面 readiness 的完整綁定、其他 workers 的連續 HTTP canaries、對外的 recovery plan／execute／reconcile 接線，以及恢復排程回覆不確定時的狀態處理。兩種 rebuild modes 繼續 `executable: false`；沒有把原型冒充可操作的重裝功能。

新增測試涵蓋 backup 損壞、checksum 漂移、bind mount、不同 inode、安裝／清理中斷、未落盤結果、恢復拒絕覆蓋新狀態，以及 smoke 失敗不得恢復排程。共 62 項 Python tests 通過。元件重裝三次成功仍為 **0/3**；OS 重灌／全群 fresh 繼續分開計算。

## 下一步

1. 取得 provider 說明，重新觀測穩定窗口；不要只因 health 成功就放行。
2. 核對驗證過的 core binary，準備僅更新 core 的 backup／checksum／journal 部署計畫；同步處理舊全群 reapply 可能覆蓋 patch 的版本語意。
3. 控制面通過後，做新 smoke／精確 cleanup；不重用旧 plan。
4. 補齊上述狀態機接線與連續 canaries，再對空 worker-4 連續三次驗收。每輪保持 OS、SSH、Tailscale、Docker／containerd、控制面與原 node 身分。

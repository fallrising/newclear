# 接續開發交接：ERU VPS MVP

保存日期：2026-09-22。最新接續見 [隔離修補驗證與重裝底層](M2-CONTINUATION-2026-09-22.md)：core patch 已通過 Go 1.27.1 回歸與建置、62 項 Python 測試通過，但 01 同檔案系統 fdatasync p99 約 70 ms；未部署或重裝。以下早期交接保留作背景。專案位於 `labs/eru-vps-mvp`。先閱讀 README、SDD、CONTROLLED-REINSTALL、OPERATOR、M2-2026-09-22；以最新實機觀測為準，不能把當天早期 PASS 當作目前健康保證。

## 目標與已定案偏好

4 台 VPS 驗證 Eru 排程與可反覆重建。日常以自控腳本清理／重裝指定 worker 的 ERU 元件，保留 OS、SSH、Tailscale、既有 Docker／containerd 與控制面；provider 控制台人工 OS 重灌僅是後備，不需要先接供應商 API。元件重裝與全新 OS 重灌分開驗收。

## 環境與資料位置

controller B（hzv）只負責協調與收集。B→VPS 一律使用 `ckc-disposable-01`～`04` SSH aliases，登入 ckc、sudo；命令輸出標註主機。`~/.ssh/config` 匯入 `~/.ssh/hzd-vps/config`。原 `disposable-*` aliases 是 g1ops 限權入口。

01 為 core／單成員 etcd／CLI／storage plugin；02–04 為 worker-2／3／4。Debian 13、現有 containerd 2.3.5、Tailscale。每 worker 註冊 2 CPU／2 GiB RAM／10 GiB storage。保留 root SSH 禁令、原 Docker/containerd unit 與 socket 權限。ckc 的有效公鑰檔是 `/etc/ssh/onevps-personal-admin/ckc.keys`，不是 home authorized_keys。

B 的真實配置、evidence 與計畫位於 `/home/ckc/test/newclear/labs/eru-vps-mvp/private/`，Git 忽略，沒有推上 GitHub。新 checkout 必須連回這份私有資料或重新取得可信 preflight／host keys；不能直接拿 public examples 當 inventory。私鑰不可複製到報告或 Git。

保存使用的獨立 worktree 是 `/home/ckc/test/codex/newclear-eru-delivery`；原 `/home/ckc/test/newclear` 可能仍在其他工作的 feature branch。開始前檢查各自的 git status／branch，不 reset 或覆蓋其他人的修改。

## 進度與驗證

- SDD、runbook、固定 upstream commits、release SHA256、nginx digest 已保存。
- 首次 1 core + 3 workers 部署成功；三 worker nginx lifecycle／HTTP／超額 memory-storage 拒絕／清理通過。
- 曾完成一次帶 nginx 的四台同版本 reapply（V05），服務啟動紀錄與 workload 保留。
- `labctl.py` 已實作 plan／execute／status／reconcile，支援 smoke、同版本 reapply、按 smoke evidence 精確 cleanup。共同 flock、hash 綁定、持久 journal；同一 plan 禁止重播。
- `rebuild-node` 預設 component-reinstall；provider-reimage 是人工重灌後備。兩模式目前均 `executable: false`。
- `worker_scope.py` 是唯讀 scope auditor，已在 worker-4 核對六個元件檔案與三個狀態根。quarantine／worker-only installer／恢復執行器尚未實作。
- 34 項 Python 本機測試通過；新操作器實機 smoke 未通過，不能宣稱 M2 完成。M3 的 HA／snapshot restore／24h soak 均未做。

## 先處理的兩個實機故障

1. 01 的 etcd 出現 slow fdatasync（觀察最高約 23.5 秒），health 間歇逾時。當時磁碟只用約 1%，vmstat 有 17–20% I/O wait；底層原因仍未證實。不要靠調大 timeout 或刪資料掩蓋。
2. core v0.1.5 在鎖失敗後 panic：`context.WithoutCancel(nil)`，`cluster/calcium/lock.go:111`。`doLock` 失敗可回傳 nil context，withNodesLocked 先覆寫 ctx，defer cleanup 因此 panic。systemd 曾自動重啟一次。

`patches/core-v0.1.5-lock-context.patch` 已提出保留有效 ctx 的修補及回歸測試，僅通過 git apply --check／gofmt，尚未跑上游 Go tests 或部署。B 系統 Go 1.22.2；upstream go.mod 要求 1.27.0。接續需準備隔離的 Go 1.27 環境、驗證失敗可重現／修補後通過，然後產出可核對 checksum 的建置 artifact；不能把草案當成已驗證 release。

第一次失敗的 worker-4 配額殘留已在確認 runtime／metadata 空、etcd health 恢復、占用恰好等於該測試後，對單節點做過 resource --fix。CPU／memory／storage 已回零、DIFFS 空；這不是自動復原機制。第二次失敗後亦未見容器殘留。最後一次空目標 cleanup 在 execute 前因 etcd health 失敗而正確停止。

## 下一步順序

1. 重讀 private evidence，做唯讀健康／狀態盤點；不重播既有失敗 plan。
2. 隔離驗證 core 修補，查明 01 I/O 延遲並取得穩定性觀測。
3. 控制面穩定後，重新 plan，驗證 labctl smoke／reapply／非空 cleanup。
4. 依 CONTROLLED-REINSTALL.md 實作 worker-only installer、quarantine 備份與可對帳恢復；第一版只作用於空 worker-4，保留共享 runtime、keys、etcd 及其他 workers。
5. 驗證其他 worker 的 HTTP／原服務不受影響，連續三次元件重装成功，再評估擴展。OS 重灌／全群 fresh 另計，不混用驗收。

不要實作 blanket rm -rf、docker/containerd prune、全群 reset 或自動放寬 SSH。鎖目前只涵蓋 B 同一私有目錄的合作程序，並非跨 controller 分散式鎖。

## 開始時的本機命令

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s labs/eru-vps-mvp/tests -v
python3 labs/eru-vps-mvp/scripts/labctl.py status
```

plan／reconcile 會讀遠端；execute／smoke／deploy --apply 會變更遠端。歷次 plan 綁定 script／inventory hash，本次新增文件工具後需重建計畫，不能複用舊 hash。

## 關鍵私有 evidence

- 首次三 worker PASS：`smoke/20260922T095025Z-25f5e7.json`。
- V05 PASS：`smoke/20260922T102059Z-b7b2b5.json`。
- 新操作器失敗 run：`operations/runs/20260922T111212Z-f6e81b67.json`、`20260922T112110Z-ee480f02.json`。
- 執行前健康阻擋：`operations/runs/20260922T112640Z-827ef612.json`。
- 自控重裝 scope plan：`operations/plans/20260922T122547Z-fc1e697c.json`，只有 audit，未清理。
- 詳細錯誤及配額修復 evidence 名稱見 M2-2026-09-22.md。

上游 review checkout 可能仍在 `/tmp/eru-core-review`、`/tmp/eru-cli-review`、`/tmp/eru-quickstart-review`；/tmp 不保證持續存在，需要時按 lock 重新 checkout。不要修改 public lock 假裝等同已部署版本。

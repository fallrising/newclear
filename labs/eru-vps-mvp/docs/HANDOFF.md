# 接續開發交接：ERU VPS MVP

更新：2026-09-22。先讀 [優先路徑與故障分析](M2-PRIORITIES-2026-09-22.md)、[元件重裝契約](CONTROLLED-REINSTALL.md) 和 [操作器](OPERATOR.md)。歷史故障與早期未完成狀態保留於 M2-2026-09-22.md／M2-CONTINUATION-2026-09-22.md；不能把早期 PASS 當成目前健康保證。

## 目標與固定邊界

日常只清理／重裝指定 worker 的 ERU 元件，保留 OS、SSH、Tailscale、Docker/containerd、控制面與 node 身分。provider 控制台人工重灌僅作最後手段，不接 provider API；元件重裝、全新 OS、全群 fresh 分開驗收。

工作樹 `/home/ckc/test/codex/newclear-eru-delivery`，分支 `work/eru-vps-mvp-next`，專案 `labs/eru-vps-mvp`。其他工作樹的 Kith 未提交修改必須保留。Repo 本輪整併見根目錄 `docs/repo-consolidation-2026-09-22.md`；GitHub PR #29–#31 已合併。

B→VPS 一律使用 `ckc-disposable-01`～`04` SSH aliases，命令標示主機。01 是 core／單成員 etcd／CLI／storage plugin，02–04 是 worker-2／3／4。ckc 登入後 sudo，不改 root SSH 禁令；有效公鑰檔是 `/etc/ssh/onevps-personal-admin/ckc.keys`。

`private/` 連回 `/home/ckc/test/newclear/labs/eru-vps-mvp/private/`。真實 inventory、credentials、host identity、artifact 與 raw evidence 不可提交。新工作樹先連回可信資料，不採用 public examples 作實機 inventory。不要 reset 其他工作樹。

## 已交付

- 固定 core source + patch 在隔離 Go 1.27.1 通過原版失敗／修補成功的回歸、calcium／lock tests 與建置；兩次獨立 binary SHA 相同。
- core-only 更新已部署，run `20260922T145650Z-0106bbd2`；執行中的 SHA 為 `1e674e955b6504892d9e7a60807e02e18043ba739787481bbd456cb30ca68363`。只預期重啟 core，保留舊 binary／owner manifest 與遠端更新 journal。
- patch 後 worker-4 新操作器 smoke PASS（`20260922T150023Z-1d1e3892`），包含 HTTP、stop/start、exec/logs、超額 memory/storage 拒絕與配額歸零。
- `labctl` 支援 plan／execute／status／reconcile、精確 cleanup、canary-start，以及具有健康／core SHA／空 target／ownership／連續 HTTP 守護的 worker-4 component-reinstall。
- 六個 ERU 檔案和三個狀態根先備份校驗再 quarantine；worker-only installer 不動共享 runtime。失敗保留 journal，不重播。恢復底層拒絕覆蓋新資料，已有中斷／checksum／link／mount 測試。
- 本機 82 項測試通過。worker-4 元件重裝已連續 3/3 成功，component revision 3、cluster generation 1；詳見優先路徑文件的實測表格。

## 尚未完成的工作

- 歷史 etcd 秒級 fdatasync 根因仍未證實；已知問題當時達 23.5 秒。現在以實際負載和健康觀測推进，不把 WAL p99 建議單獨當硬性阻擋，也不以放大 timeout 掩蓋故障。
- 整合完整故障恢復 CLI／實機故障注入驗收，特別是 core API 不可用、agent 已產生新狀態，以及 resume 回覆遺失的情況。底層 restore 不代表所有事故已實機驗收。
- 原 release reapply 暫時阻擋覆蓋已部署 core patch；需先支援可核對的 patched artifact 再驗證。同版本 worker-only 重裝已使用自己的固定 agent artifact。
- 其他 workers／非空 target 的 drain、OS 重灌、全群 fresh、HA／snapshot restore／24h soak 尚未驗收。

## 接手先做

```bash
cd /home/ckc/test/codex/newclear-eru-delivery
 git status --short --branch
 PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s labs/eru-vps-mvp/tests -v
 python3 labs/eru-vps-mvp/scripts/labctl.py status
```

再唯讀讀取最新 journal／runtime／配額／健康。三次重裝的計次只能取 complete run 與 `worker-component-revisions.json`；初次因節點陣列順序而失敗的 run 保留 failed，沒有追認成 PASS。HTTP canaries 用其原 run 的精確 cleanup plan 清理；不 prune、不全群 reset、不刪 controller lock。

新程式、inventory、core revision 或 health evidence 會改變 plan bindings；使用新 plan，不複用失敗計畫。B 的 flock 只涵蓋同一 private 目錄的合作程序，操作期間維持 B 為唯一 mutation writer。

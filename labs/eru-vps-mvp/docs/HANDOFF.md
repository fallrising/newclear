# 接續開發交接：ERU VPS MVP

更新：2026-09-23。**剩餘任務與固定編號以 [TASKS.md](TASKS.md) 為準：目前 17 項（近期 6、後續 11）；ERU-001 已完成，下一項 ERU-002 到期回收，等待期間可先準備 ERU-007 本機工具。每完成一項必須更新清單，並向 owner 回報完成編號、剩餘數及下一項；新增／拆分需說明數量變化。** **01–03 正執行可離線的 24h 觀測，先讀 [含開始時間的待辦](TODO-SOAK-2026-09-23.md)；期間可做本機開發／唯讀排查，實機 mutation 前先停止並記錄中斷。** 再讀 [恢復與 reapply 最新紀錄](M2-RECOVERY-2026-09-23.md)、[事故恢復操作](RECOVERY.md)，再讀 [優先路徑與故障分析](M2-PRIORITIES-2026-09-22.md)、[元件重裝契約](CONTROLLED-REINSTALL.md) 和 [操作器](OPERATOR.md)。歷史故障與早期未完成狀態保留於 M2-2026-09-22.md／M2-CONTINUATION-2026-09-22.md；不能把早期 PASS 當成目前健康保證。

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
- 本機 175 項測試通過。worker-4 元件重裝已連續 3/3 成功，component revision 3、cluster generation 1；詳見優先路徑文件的實測表格。

- 新增 source-bound recovery CLI、patched-core reapply，以及 worker-4 quarantine／start 兩個有界故障演練點。恢復與原成功重裝計次分離，patched reapply 與 worker restore／保留新狀態 resume 的實機驗收通過，最後已清理測試 workload；詳見 2026-09-23 紀錄。

- `soak.py collect/report` 可在程序運行時唯讀回收固定長度／SHA 的 evidence，離線核對完整性與功能錯誤，並對照 guest I/O／CPU 指標；141 tests 通過，三台實機中途回收及離線分析成功。詳見 [SOAK.md](SOAK.md)。

- 補上 core 更新／rollback 的 32 個程序中斷切點與一次未知後續更動測試（33 次真實 SIGKILL），修正早期 journal 錯誤與權限／hardlink／mount 拒絕條件。均在本機暫存目錄驗證；[本輪交接與剩餘 TODO](M2-CRASH-RECOVERY-2026-09-23.md)。

- ERU-001 已完成：`recovery.py plan --action core-cancel` 可為替換前中斷新增取消 intent／receipt，保留原 journal、部分備份與未知資料；reapply 核對封存後才排除該 pending update。新增 20 tests、12 次 SIGKILL，原 journal 缺失仍拒絕取消。只做本機驗證，沒有實機故障注入；[交付紀錄](M2-CORE-CANCEL-2026-09-23.md)。

- ERU-007 的每秒私網 HTTP 模式與離線核對已在本機完成，另加 8 tests；實機短 pilot 與全新 24h run 尚未執行，故狀態為進行中、總數仍剩 17。既有 30 秒觀測保持原封。[準備紀錄](M3-V11-PREP-2026-09-23.md)。

## 尚未完成的工作

- 歷史 etcd 秒級 fdatasync 根因仍未證實；已知問題當時達 23.5 秒。[ERU-004 階段性分析](M2-ETCD-ANALYSIS-2026-09-23.md) 已對照 2026-09-23 17:45 UTC 的 6 小時 20 分唯讀快照與官方資料，記錄影響、證據缺口及相對成本；完整 24 小時結果未出，不把 WAL p99 建議單獨當硬性阻擋，也不以放大 timeout 掩蓋故障。
- core API 不可用的 rollback 已接到 CLI 並通過本機備份／部分寫入／回覆遺失測試；尚未刻意讓實機 core 故障。程序 SIGKILL 切點已補驗；真正 VM／磁碟 power-loss、未知新檔案歸屬與非空 workload 災難恢復仍未全面驗收。replace-intent 前且具備 durable backing-up journal 的顯式取消／封存已完成；原 journal 缺失時仍保留資料並拒絕自動處置。
- 原 release reapply 仍禁止隱性 downgrade；已支援以 `--core-artifact` 明確核對並保留 patch 的同版本 reapply。後續跨版本升級／patch 發布管理仍分開設計。
- 其他 workers／非空 target 的 drain、OS 重灌、全群 fresh、HA／snapshot restore 尚未驗收。24h soak 已交給 VPS 背景執行，預計 2026-09-24 11:25:06 UTC 結束，尚待回收和判讀，不需維持 B／Codex 連線。

## 接手先做

```bash
cd /home/ckc/test/codex/newclear-eru-delivery
 git status --short --branch
 PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s labs/eru-vps-mvp/tests -v
 python3 labs/eru-vps-mvp/scripts/labctl.py status
```

先依 soak TODO 查閱正在執行的任務，再唯讀讀取最新 journal／runtime／配額／健康。三次重裝的計次只能取 complete run 與 `worker-component-revisions.json`；初次因節點陣列順序而失敗的 run 保留 failed，沒有追認成 PASS。HTTP canaries 用其原 run 的精確 cleanup plan 清理；不 prune、不全群 reset、不刪 controller lock。

新程式、inventory、core revision 或 health evidence 會改變 plan bindings；使用新 plan，不複用失敗計畫。B 的 flock 只涵蓋同一 private 目錄的合作程序，操作期間維持 B 為唯一 mutation writer。

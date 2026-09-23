# 元件事故恢復與修補版 reapply

恢復使用獨立的新 plan／run，固定原始 plan hash、原 journal hash、目前檔案／runtime／健康及程式輸入。舊失敗 run 保留 failed；恢復不增加 worker component revision，也不追認成重裝成功。所有實機命令仍經 `ckc-disposable-01`～`04` aliases，證據留在 private。

## 先對帳

```bash
python3 scripts/labctl.py reconcile --run FAILED_RUN
```

若原 run 停在 running，先在取得 controller lock 後把它對帳成 interrupted。reconcile 不重播、不自動清理；core API 不可用時會保留錯誤，後續 core recovery plan 改走 SSH／etcd 唯讀觀測。較新 deployment／recovery 已取代原操作時，拒絕使用舊來源。

## worker-4：還原備份或保留新狀態

兩種模式均要求近期健康 evidence、02／03 的 run-owned HTTP canaries、空的 worker-4 metadata／container／task、零配額、未改變的 host/boot identity 與 node 註冊。控制面與其他 workers 必須正常。

```bash
# 原 quarantine 備份可完整核對；worker 已 fenced，三個 ERU units 均 inactive。
python3 scripts/recovery.py plan --action worker-restore --source-run FAILED_RUN \
  --health private/diagnostics/HEALTH-control-health.json --canary-run CANARY_RUN

# owned 元件完整、worker available；保留 agent 新產生的狀態，重新驗證後恢復排程。
python3 scripts/recovery.py plan --action worker-resume --source-run FAILED_RUN \
  --health private/diagnostics/HEALTH-control-health.json --canary-run CANARY_RUN

python3 scripts/recovery.py execute --plan NEW_RECOVERY_PLAN --sha256 PLAN_SHA256
```

`worker-restore` 拒絕覆蓋 agent 產生的新 cursor／CNI 狀態或任何未知檔案。它只恢復原六個 ERU 檔案與三個資料根；SSH、Tailscale、Docker/containerd、共享 CNI、控制面與 key 都保留。

`worker-resume` 不還原或覆寫 worker 元件與既有狀態；agent／測試 workload 自身仍會正常更新運行狀態。先核對 ownership、禁止排程，再跑 target nginx lifecycle／清理／配額回零及其他 worker 連續 HTTP guard；核對保留服務後才 node up。若 up 回覆遺失，單獨記錄一次 corrective fence；若 fence 也無法確認，結果是 uncertain。

還原已完成但 SSH 回覆遺失時，新 plan 會驗證遠端 restored journal 及檔案，只接續服務啟動與驗證，不再次還原。若服務已啟動並產生新狀態，使用新的 `worker-resume` 計畫。restore 過程遇到無法判定歸屬的新 inode／檔案會停止，不提供覆蓋選項。

## core API 不可用時的 binary 還原

```bash
python3 scripts/recovery.py plan --action core-rollback --source-run ORIGINAL_CORE_PATCH_RUN
python3 scripts/recovery.py execute --plan NEW_RECOVERY_PLAN --sha256 PLAN_SHA256
```

此路徑不靠 core API 做前置檢查。它透過 SSH 核對四台 identity／空 ERU runtime、etcd health／alarm，以及固定 `/eru/workloads/`、`/eru/deploy/`、`/eru/processing/` 的 count-only 查詢。驗證遠端原始 update journal、備份 checksum、binary／owner manifest 與保留配置；只還原該 run 的原 binary／manifest，必要時 restart core 一次。

core 恢復後才查 API，確認原 node 註冊、空 workload、配額一致與保留服務 invocation。若 binary 已還原，只接續必要的服務恢復；若執行中的 SHA 已正確，不再重啟。回覆遺失後仍須新 plan，不能重播原 execute。

這是 binary／manifest 恢復，不能修復 etcd 資料、OS 或磁碟。早期 core patch 的原備份仍是含已知 lock-context bug 的 upstream binary；還原會明確記錄 core-rollback，worker 重裝的 patched-core gate 因而不通過。後續重新部署修補版必須另建 core-patch plan。

## 保留已部署 core patch 的同版本 reapply

```bash
python3 scripts/control_health.py --samples 31 --interval 5
python3 scripts/labctl.py plan --operation reapply \
  --core-artifact private/builds/BUILD/eru-core \
  --health private/diagnostics/HEALTH-control-health.json
python3 scripts/labctl.py execute --plan REAPPLY_PLAN --sha256 PLAN_SHA256
```

指定的 ELF 必須符合公開建置驗證紀錄，且匹配已完成的 core-patch run、owner manifest 與 `/proc/PID/exe` SHA。遠端 installer 只接受唯一、完整的 installed update journal；遇到其他未完成更新即停止。它保留已安裝的 core binary，跳過 upstream core archive，並拒絕其他 artifact／配置 payload 別名覆寫該路徑。

reapply 仍涵蓋四台相同版本的 ERU 配置與元件，以 worker-2 nginx 驗證 workload、HTTP、服務 invocation／runtime task／metadata／配額保持一致。省略 `--core-artifact` 的 release reapply 仍拒絕覆蓋本機 patch。

## 有界故障演練

僅用於空 worker-4，plan 必須明確綁定中斷點：

```bash
python3 scripts/labctl.py plan --operation rebuild-node --node worker-4 \
  --health private/diagnostics/HEALTH-control-health.json --canary-run CANARY_RUN \
  --fault-after quarantine
# 另一個獨立演練點：--fault-after start
```

`quarantine` 在已備份並隔離六檔／三根後故意失敗；`start` 在元件已重裝、agent 可用且仍 fenced 時故意失敗。兩者保持 failed，不增加重裝計次，必須使用新的 recovery plan。沒有核心 OS／磁碟故障注入，也不做 provider reset。

本機與實機驗證結果見 [2026-09-23 開發紀錄](M2-RECOVERY-2026-09-23.md)。完整災難恢復、非空 worker drain、其他 workers、OS reimage、HA／snapshot restore 與 24h soak 仍分開驗收。

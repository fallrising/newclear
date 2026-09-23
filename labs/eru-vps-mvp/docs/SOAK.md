# 可離線的 VPS 觀測任務

入口為 `scripts/soak.py`。B 只负责啟動與查詢，觀測程序由各 VPS 的 systemd 管理；SSH、Codex 或 B 關閉不影響任務。它使用 transient service，沒有開機自動續跑或失敗重試；VPS 重開機會中斷此次驗收，原資料保留。systemd 的 detached service 語意見 [上游文件](https://github.com/systemd/systemd/blob/main/man/systemd-run.xml)。

01 讀取 etcd health/status/alarms、metrics、core/etcd journal、服務 invocation、`/proc` CPU／磁碟／I/O pressure；02、03 對各自的 run-owned nginx 做 HTTP GET，同時核對 workload task ID 及 agent／proxy socket／共享 runtime 服務。04 保持空閒。預設每 30 秒取樣，journal 從前次取樣時間向前重疊一秒，不使用固定 20 秒視窗留下缺口。重疊日誌的 warning 計數是「含警告的樣本數」，不能當作獨立事故數。

這是兩個小型 nginx 的低負載觀測，涵蓋輕量 etcd 健康請求與既有 agent 活動，不代表部署壓力／容量測試，也不能排除兩個 HTTP 樣本間的短暫故障。HTTP、etcd health、服務 invocation 與 WAL/backend histogram 要一起判讀；單看 p99 桶上界、沒有 backend 寫入，或單看 `systemctl active` 都不能直接宣告 PASS。

## 啟動

在 B 的 `labs/eru-vps-mvp` 執行。先讀 journal、健康與目前 workload；建立全新的 canary plan，不能重播舊的失敗操作。

```bash
# [B → 01–04] 唯讀計畫，再依輸出的新 ID/hash 建立 02、03 canaries
python3 scripts/labctl.py plan --operation canary-start
python3 scripts/labctl.py execute --plan CANARY_PLAN --sha256 CANARY_HASH
# [B → 01–03] 唯讀核對，建立三個有限時長的觀測 service
python3 scripts/soak.py start --canary-run CANARY_PLAN
```

`start` 取得 B 鎖、核對 metadata/runtime、etcd health、部署中的 core SHA、兩個 canary 的 owner/run/node 及 HTTP readiness，將私有 manifest、每個 host 的啟動意圖先存檔，再依序啟動。預設共同開始時間在 90 秒後、持續 86400 秒。B 返回後釋放鎖，不需要維持任何 B 程序。啟動回覆遺失時狀態為 uncertain；先 `status` 對帳，不能重送同一 run。尚未到期且未明確停止的本機 manifest 會阻擋另一個 soak。

每台只新增 `/var/lib/eru-mvp/soak/RUN/` 中的程式、配置和結果，以及一個 `eru-mvp-soak-RUN.service`。不修改 ERU、OS、SSH、Tailscale 或 runtime 配置。遠端不複製 controller credentials；資料目錄 0700，檔案 0600。每台 raw evidence 上限 192 MiB、單筆上限 1 MiB，超額會失敗並保留舊資料。MemoryMax 256 MiB，RuntimeMaxSec 提供截止時間後 120 秒的停止保險。結果採 buffered append／atomic replace，不逐筆 fsync，以免觀測本身製造同步 I/O 負載；重開機後須核對原始檔完整性。

觀測期間 B 不持有跨日 mutation lock，現有其他操作器也不會自動檢查 soak。可以繼續本機開發、測試及唯讀排查；若要改動 VPS，先停止並記錄本次驗收中斷，不要一邊重裝一邊將結果當作未受干擾的穩定性證明。

## 查詢與停止

```bash
# [B → 01–03] 重新連線取回 status、systemd 狀態與 boot ID
python3 scripts/soak.py status --run SOAK_RUN
# [B → 01–03] 必要時提前停止三個觀測程序，保留 evidence/canaries
python3 scripts/soak.py stop --run SOAK_RUN
```

manifest、來源 SHA、初始 snapshot、啟動事件與最新狀態在 B 的 `private/soak/SOAK_RUN/`。遠端資料包括 `config.json`、`status.json`、`samples.jsonl`。下列以 01 為例，02、03 使用各自 alias 和相同 run；不可將 raw evidence 提交 Git。

```bash
# [ckc-disposable-01] 程序、退出碼與最後紀錄
ssh ckc-disposable-01 sudo -n systemctl show eru-mvp-soak-SOAK_RUN.service \
  --property=ActiveState,SubState,MainPID,Result,ExecMainStatus
ssh ckc-disposable-01 sudo -n journalctl -u eru-mvp-soak-SOAK_RUN.service --no-pager -n 80
ssh ckc-disposable-01 sudo -n cat /var/lib/eru-mvp/soak/SOAK_RUN/status.json
# [B ← ckc-disposable-01] 到期或停止後另存原始資料；02、03 同理
umask 077
ssh ckc-disposable-01 sudo -n cat /var/lib/eru-mvp/soak/SOAK_RUN/samples.jsonl \
  > private/soak/SOAK_RUN/ckc-disposable-01.samples.jsonl
```

`active/exited`、MainPID 0 是正常完成後保留的 unit，需同時讀 status。`complete` 只表示收集到截止樣本，仍為 `pending_review`；HTTP／健康失敗、服務變更、取樣缺口及 counter reset 不會被後續成功抹除。重新連線會辨識 reboot、stale、missing evidence。最終須核對三台原始紀錄完整、共同開始／截止與樣本間隔、所有 failures/warnings、服務與 workload 身分，再唯讀檢查叢集。

到期只停止觀測；兩個 canary 保留到下次檢查，以便核對 runtime 與配額。完成檢查後使用 manifest 中原 `canary_run` 建立精確 cleanup plan／execute，再確認 workload 與配額歸零。不會自動刪除樣本、備份或 ERU 狀態。

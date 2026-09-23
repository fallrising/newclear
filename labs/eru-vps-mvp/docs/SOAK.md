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

## 自動回收與離線分析

```bash
# [B ← 01–03] 可在觀測途中或結束後執行，不重啟／停止服務
python3 scripts/soak.py collect --run SOAK_RUN
# [B 本機] 重讀最近一次回收，不發出 SSH 或其他遠端命令
python3 scripts/soak.py report --run SOAK_RUN
# [B 本機] 重讀某一次歷史快照
python3 scripts/soak.py report --run SOAK_RUN --collection COLLECTION_ID
```

每次 collect 都建立 `private/soak/SOAK_RUN/collections/COLLECTION_ID/`，保存 manifest、逐 host 回收進度、當時的 status／systemd／boot ID、原始 JSONL 與 `report.json`。`latest-collection.json` 指向最新嘗試；新回收失敗時不會悄悄退回舊的成功結果。可隨時再次回收，歷史快照不覆蓋。

遠端先讀 atomic status 中已完成樣本的 byte boundary，再計算該 prefix 的 SHA256；串流只讀取這段固定長度，檔尾仍可持續增加。核對 run/config 與兩支部署程式的 SHA；B 收完再核對長度和 SHA 才將 `.partial` 更名為正式 JSONL。SSH 中斷、原始檔少於紀錄長度或內容變化時保留 partial 與錯誤，不記成完整回收。每台最多 192 MiB，傳輸 timeout 180 秒。這些都是檔案讀取，沒有遠端安裝或 service 變更。

report 逐筆重算 HTTP／健康錯誤、服務變更、histogram reset、觀測間隔、時鐘連續性，核對 source/config、JSONL 完整性、筆數、長度、SHA 與原 status 摘要。三台時間取交集顯示共同涵蓋秒數。狀態分為：

| 狀態 | 意義 |
| --- | --- |
| `in_progress` | 回收當下程序仍在執行，不能算完整驗收 |
| `invalid_evidence` | 缺檔、傳輸失敗、身分／hash／筆數／格式不符，或 complete 沒涵蓋截止時間 |
| `observed_failures` | 原始樣本顯示功能、服務或取樣故障，後來成功不會抹除 |
| `incomplete` | 觀測中斷、重開機、程序不在或樣本停滯 |
| `complete_needs_review` | 收集時間完整且未見上述故障，仍須核對警告、負載範圍和最後 cluster 狀態 |

報告是**回收當下**的快照；離線重新分析不會更新遠端狀態。沒有自動 PASS 或自動 cleanup。最終仍用原 canary run 的新 plan 做精確清理。

### 延遲與 guest 指標的時間對照

01 的相鄰樣本轉成 iowait／steal 百分比、I/O PSI stall 比例、各裝置 read/write 平均耗時。slow fdatasync／timeout／panic／服務變更的樣本會帶上相鄰時間窗的 guest 指標，並保留前 100 個異常樣本窗口及剩餘數量；完整資料仍在 JSONL。多個裝置／partition 各別列出，不能將它們相加。

CPU 使用 aggregate counters 的差值，guest 欄位不重複加總。iowait 本身有計量限制，也可能下降；負差值標為 unavailable，不改成 0。欄位限制見 [Linux /proc 文件](https://docs.kernel.org/filesystems/proc.html)。

磁碟平均耗時用相鄰樣本 read/write 的耗時差除以完成數；in-flight 是 gauge，不當累計 counter。沒有 I/O 時平均耗時為 null，不能推論磁碟很快。flush/discard 不包含在這個 read/write 平均值，因此它不是 fdatasync 的直接測量；見 [Linux I/O statistics](https://docs.kernel.org/admin-guide/iostats.html)。PSI 使用 `total` 微秒差值除以觀測間隔，見 [Linux PSI](https://docs.kernel.org/accounting/psi.html)。

所有值都是約 30 秒窗口的平均或摘要，probe 內各來源也非同時讀取；時間相近只能支持相關性，不能單憑 guest 資料歸因到供應商／宿主機。沒有 backend observations 時，backend 延遲未受測；沒有重現故障不表示歷史秒級 fdatasync 根因已解決。

## 正式 V11 的每秒私網 HTTP 模式（本機準備，ERU-007）

目前 30 秒間隔的 run `20260923T112336Z-561e71e7` 保持原樣；其來源與 config 已固定。正式 V11 需待該 run 回收、canaries 依 ERU-003 清理後，用新的 canary-start plan 啟動全新觀測。不能沿用舊 run、把既有 30 秒 HTTP 結果換名，或在仍有觀測時疊加另一個 observer。

```bash
# [B → ckc-disposable-01～04] 到期且完成舊 canary 清理後，另建兩個 owned nginx canaries。
python3 scripts/labctl.py plan --operation canary-start
python3 scripts/labctl.py execute --plan NEW_CANARY_PLAN --sha256 PLAN_SHA256
# [B → ckc-disposable-01～03] 可先用新 run 做短 pilot；report 會標為 incomplete，不是正式 V11。
python3 scripts/soak.py start --canary-run NEW_CANARY_PLAN --acceptance v11 --duration-seconds 30
# [B ← ckc-disposable-01～03] pilot 到期後，依新 run ID 回收與離線判讀。
python3 scripts/soak.py collect --run PILOT_RUN
python3 scripts/soak.py report --run PILOT_RUN
# [B → ckc-disposable-01～03] 確認 pilot evidence 後，結束其 unit／解除觀測重疊門檻。
python3 scripts/soak.py stop --run PILOT_RUN
# [B → ckc-disposable-01～03] 用另一個全新 run 做 24h 正式驗收。
python3 scripts/soak.py start --canary-run NEW_CANARY_PLAN --acceptance v11 --duration-seconds 86400
```

`--acceptance v11` 在 02、03 **各排程每秒一個**私網 GET，共各 86400 個預定秒數；01 仍每 30 秒觀測 core／etcd。HTTP 排程在 observer 的另一條 thread，服務／task 檢查不會刻意擋住每秒請求。每個秒數都留下 slot、實際時間、延遲、HTTP 結果或明確的 skipped 紀錄；單次等待上限約 0.8 秒。排程遲到超過一秒的 slot 不補送，計為失敗。正常 24h 每台需至少 85536 次成功，且 slot 數完整、順序連續；控制與 HTTP 兩側的服務、etcd alarm、OOM kernel 記錄及磁碟使用量也須通過。成功率分母包括漏送的秒數。故障演練窗口目前不自動排除；正式 run 應另行保持無故障注入。

每 30 秒檢查 01 的 `/`、etcd 資料、Docker/containerd 根目錄，及 02／03 的 `/`、Docker/containerd 根目錄；使用 `df -P -B1` 的 Capacity／Use% 欄，超過 80% 會記錄失敗。三台同時讀 `journalctl -k`，檢查 OOM；01 繼續查 etcd alarms。這些離散檢查保留原始輸出，不能聲稱排除了每兩次檢查間所有短暫事件。2026-09-23 已用 01～03 aliases 唯讀驗證這些路徑與 kernel journal 可讀，當時相關檔案系統皆 1%；沒有修改 VPS。

回收仍使用 `soak.py collect` 的固定 byte boundary／SHA；`report` 會逐筆重算每秒 HTTP 結果、連續 slot、99% 門檻及 OOM／disk／etcd 訊號。短 pilot 即使無錯，也只顯示 `incomplete`；滿 86400 秒且無已記錄故障時仍為 `complete_needs_review`，須核對三台完整 evidence 與最後 cluster 狀態。本機驗證見 [ERU-007 準備紀錄](M3-V11-PREP-2026-09-23.md)。

# ERU-001：core 早期更新取消／封存

日期：2026-09-23。固定任務 ERU-001 的本機實作、測試及操作文件完成；[任務清單](TASKS.md) 剩餘 17 項（近期 6、後續 11）。實機 core 故障演練仍屬 ERU-005，本次沒有製造或取消任何實機更新。

## 結果與完成邊界

早期更新停在 backing-up 時，原流程會拒絕 rollback，pending journal 也會持續阻擋 reapply。現在可以用新的 `core-cancel` plan 綁定原 source plan／journal 與目前狀態，核對尚未進入 replace-intent、原 binary／unit／manifest／owned 配置和 core runtime 未變，再新增取消意圖及 receipt。原 journal、部分備份、staged binary、未知 regular files／目錄與來源失敗狀態全部保留；不重啟 core、不變更 revision、不覆寫未知資料。

取消中斷／回覆遺失後，新 plan 會驗證已存在的封存；若已完成，只核對現況，不重複 mutation。reapply 會校驗 receipt、獨立 intent、原 journal 與所有保留 entries；損壞、遺失、新增資料或只有 cancelled 字樣都不能解除阻擋。後來合法的新 patch 可通過其自己的 preserve selection，取消舊更新不會放寬 release downgrade 檢查。

缺失原始 journal 無法證明曾記錄哪些意圖，因此仍拒絕自動取消；更新目錄缺 journal 也會阻擋 reapply。所有 evidence 保留供人工調查，沒有 delete／force 捷徑。操作命令、路徑與 256 entries／512 MiB 清單上限見 [RECOVERY.md](RECOVERY.md)。

## 驗證

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -q
```

完整本機 **167 tests 通過**（基線 147，加上 20）：

- 8 個有 durable backing-up journal 的早期更新中斷切點，驗證可取消且原檔／所有保留 evidence 完全一致。
- 4 個取消切點的真實子程序 SIGKILL，驗證新 attempt 或已完成後只核對；原中斷 attempt 與暫存檔保留。加上原 33 次，整套共 45 次真實 SIGKILL。
- controller plan／execute、來源 hash、狀態漂移、較新操作／reapply、原 runtime invocation、禁止 replay、lost reply 新 plan 收尾與零服務操作。
- partial／unknown 資料保留、權限／symlink／hardlink／mount 拒絕、取消 intent 期間新增資料、receipt 缺失／損壞、缺 journal 阻擋、合法後續 patch 與 downgrade 拒絕。

使用合成暫存目錄與假遠端介面，沒有連 VPS 執行故障操作；不宣稱 VM／磁碟 power-loss 保證。現有舊 plan 的 scripts bindings 已變，後續任何操作都須新 plan。

## 背景觀測與下一項

唯讀查詢截至 `2026-09-23T17:05:06Z`：01／02／03 各 681 筆、均 running，原 PID／invocation 保持，無已記錄功能 failures／逐樣本 warnings。01 WAL 1490 observations 的 p99 桶上界為 16 ms，已超出工具建議門檻；backend 只有 2 observations、p99 桶上界 8 ms。這不是歷史根因已解決，也不是完成 24h 驗收。

ERU-002 仍在 VPS 執行，預計 `2026-09-24T11:25:06Z` 結束；到期回收 raw evidence、分析並唯讀核對 cluster。原 canaries 保留至 ERU-003 的新精確 cleanup plan。等待期間可先準備 ERU-007 的每秒取樣／判讀工具；目前每 30 秒觀測仍不等同正式 V11。B／Codex 可以離線。

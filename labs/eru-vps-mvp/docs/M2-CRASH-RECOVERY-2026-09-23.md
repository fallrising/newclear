# Core 更新／回滾程序中斷驗證：2026-09-23

接續 PR #42。在 B 的合成暫存檔案上補上真正的子程序 SIGKILL 驗證，沒有呼叫 VPS、systemd 或 provider，沒有中斷正在執行的 24h soak。這是程序被終止後的恢復驗證，不代表 VM 停電、磁碟掉寫、filesystem journal replay 或 etcd 資料恢復已通過。

## 覆蓋與結果

新增六個測試，包含 32 個寫入／journal／rename 前後切點，以及一個中斷後出現未知 binary 的情境，共 33 個實際被 SIGKILL 的子程序。測試要求子程序退出碼為 `-SIGKILL`；若沒有到達切點即失敗，不能把一般例外當成強制終止。

| 階段 | 切點數 | 恢復行為 |
| --- | --- | --- |
| replace-intent 寫入前，包括初始 journal、備份與暫存 binary | 9 | binary／unit／manifest 維持原狀；缺少 journal 或完整意圖時拒絕 rollback，保留檔案供對帳 |
| replace-intent 已寫入至 installed，包括 binary／manifest rename 前後 | 9 | 校驗完整原備份與目前檔案後，用新的 recovery ID 回復原 binary／manifest；unit 不變 |
| rollback-intent、還原 binary／manifest、兩份完成 journal 前後 | 14 | 用新的 recovery ID 接續；保留被中斷的 attempt 紀錄；原 journal 已完成時拒絕再次還原 |

另驗證：中斷後有未知 binary、不變內容卻改過執行權限、journal hardlink／mount，都在建立新的恢復目錄或覆寫檔案前停止。原來的回覆遺失、新 plan 接續、core API 不可用及 worker recovery 測試亦持續通過。完整本機 suite 為 147 項。

執行方式（僅 B 本機暫存檔）：

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p test_core_crash.py -v
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -q
```

## 本輪修正

- 先用既有 `entry()` 核對 core update journal 是安全的單一 regular file，拒絕 hardlink／mount；缺少 journal 時給出可判讀的阻擋原因。
- backing-up 階段尚無 durable replace-intent，不直接取用不存在的 `manifest_after_sha256`。明確要求保留不完整備份、唯讀對帳原檔；不自動刪目錄或採納暫存檔。
- rollback 除 binary SHA 之外，也核對原先必須保留的 type／mode／uid／gid／device；內容相同不代表可以覆蓋後來變更的權限或檔案系統。

這些檢查加在 controller 傳送的恢復程式；本輪沒有更新運行中的 core binary，也沒有對實機執行 recovery。既有 plan 的 code bindings 已改變，後續操作必須建立新 plan。

## 本轮交接與 TODO

- [ ] 2026-09-24 11:25:06 UTC 之後，按 [Soak TODO](TODO-SOAK-2026-09-23.md) 回收／分析完整觀測。以三台 raw evidence 及最後 cluster 狀態驗收，不用中途健康結果替代。
- [ ] 完成觀測後，用原 canary run 建立新的精確 cleanup plan，確認全群 workload／配額回零，保留 evidence。
- [ ] 再排 core API 不可用的實機故障／恢復演練。須空 ERU runtime、etcd 健康、原備份可驗證、全新 source-bound plan；原備份可能含已知 lock-context bug，不能將 rollback 當作日常降版路徑。
- [ ] 設計 replace-intent 前中斷的顯式「取消／封存」操作。目前只拒絕不完整備份的 rollback，沒有自動清除此類 pending update 的功能；禁止手動刪 journal 來繞過 reapply 檢查。它不影響目前健康叢集或正在執行的 soak。
- [ ] 非空 worker drain、其他 worker 的重裝驗收、跨版本升級、snapshot restore／HA、OS 重灌仍是分開的後續範圍。OS 重灌維持 owner 到 provider 控制台人工操作，不接供應商 API。

日常 worker-4 ERU 元件清理重裝已通過原先連續 3/3 的主要目標；本輪可在此交接，讓遠端觀測繼續累積。剩餘項目未標記完成，完整 VM／磁碟 power-loss 保證也未宣稱完成。

收尾唯讀核對：截至 `2026-09-23T12:35:36Z`，觀測樣本數為 01：142、02：142、03：142；三台均 running、無已記錄功能錯誤，觀測 unit invocation 與啟動時相同。本輪沒有重啟觀測，結束時間仍為 2026-09-24 11:25:06 UTC。

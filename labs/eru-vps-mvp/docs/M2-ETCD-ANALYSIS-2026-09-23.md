# ERU-004：etcd 慢同步的階段性判讀

更新：2026-09-23 17:45 UTC。**ERU-004 進行中**；24 小時觀測於 2026-09-24 11:25:06 UTC 才截止，不能將目前快照當成穩定性驗收或根因修復。此文只包含可公開的摘要；原始日誌與樣本在 `private/diagnostics/`、`private/soak/20260923T112336Z-561e71e7/`，不可提交。

## 已證實的範圍

- 2026-09-22 11:13–11:14 UTC，01 的 etcd 記錄 11.26、23.53、9.61 秒的 `slow fdatasync`；health／alarm 查詢有 timeout。約 11:16 的 `vmstat` I/O wait 為 17–20%，根磁碟使用量約 1%，CPU／記憶體未飽和。部署曾因 etcd timeout 失敗，且一次留下可精確辨識並已修正的 worker-4 配額帳目。[當時操作與事故紀錄](M2-2026-09-22.md)。
- 同日 11:22 的 core `nil parent` panic 是 etcd lock 失敗處理的獨立軟體缺陷；已用固定來源的 Go 1.27.1 回歸、patch 建置及實機 core 更新驗證。修補消除該 panic 路徑，**沒有證據表示它改善 fdatasync**。[修補與實測](M2-PRIORITIES-2026-09-22.md)。
- 2026-09-23 的固定 run `20260923T112336Z-561e71e7`，17:45 UTC 唯讀回收 `20260923T174523Z-e953611c`，01–03 各 761 筆，覆蓋 11:25:06–17:45:06 UTC，共 6 小時 20 分；原始資料長度／SHA 檢查無誤，30 秒取樣最大缺口約 30.002 秒，三台 HTTP／health／服務檢查未記錄 failure 或 warning。01 的 WAL fsync histogram 新增 1664 次觀測，p99 所在桶上界 16 ms，超過報告的 10 ms 參考線；backend commit 僅新增 2 次，p99 桶上界 8 ms，樣本過少。01 的約 30 秒 guest 窗口峰值：I/O PSI `some` 5.03%、`full` 4.97%，CPU iowait 0.85%、`vda` read/write 平均 6.32 ms。報告狀態仍是 `in_progress`，沒有秒級 fdatasync、功能錯誤或服務重啟紀錄。[取樣與限制](SOAK.md)。

## 原因判斷與缺口

etcd 的 WAL fsync 是資料持久化的關鍵路徑；磁碟同步過慢會拖延請求，嚴重時可影響心跳與選舉。官方也列出共享虛擬磁碟／其他租戶爭用、磁碟本身和 CPU／網路等因素。[etcd metrics](https://etcd.io/docs/v3.6/metrics/)、[etcd FAQ](https://etcd.io/docs/v3.8/faq/)。歷史 `slow fdatasync` 加上隨後的 I/O wait，支持 **01 當時的持久化 I/O 曾嚴重延遲**。它們不能區分 guest 內部 I/O、虛擬磁碟、宿主機或供應商儲存；舊事故期間沒有同步採集的 diskstats／PSI／宿主機資料。磁碟空間充足只能排除「幾乎用滿」這個解釋，不能排除瞬時延遲。

新觀測的 16 ms 是 histogram **p99 桶上界**，不是 16 ms 的單次 fsync，也不是重現 23.53 秒。guest `diskstats` 的 read/write 平均不直接量測 fsync／flush，PSI 是等待時間比例，iowait 亦非每次 I/O 的耗時；這些值與 WAL 概況僅可並列觀察，不可直接推算供應商儲存根因。[Linux I/O statistics](https://docs.kernel.org/admin-guide/iostats.html)、[Linux PSI](https://docs.kernel.org/accounting/psi.html)、[Linux /proc](https://docs.kernel.org/filesystems/proc.html)。目前沒有相同時間窗的失敗事件可做相關性對照。24 小時低負載測試尚未結束，亦不涵蓋部署尖峰或宿主機層級事件。

## 若不處理，及有界處理順序

單成員 etcd 若再次發生秒級同步停頓，控制面的寫入、部署、健康查詢與恢復操作可能 timeout；core 的 panic 雖已修補，API 仍可能在 etcd 不可用時受影響。已運行的 nginx 可能繼續回答 HTTP，但不能將此推廣為部署、故障後重建或資料持久化保證。單成員沒有 quorum 容錯，故障時不可期待另一成員接手。[etcd 磁碟與規模建議](https://etcd.io/docs/v3.5/op-guide/hardware/)。

1. **低成本、無實機變更：**讓現有 24 小時 run 到期，回收 SHA 驗證的 01–03 evidence，核對事件前後 WAL/backend、PSI、diskstats、steal、HTTP、core／etcd invocation；另外唯讀比對 01 當時 journal 及供應商可提供的宿主機／儲存告警。若無再次發生，結論應是「本負載／本期間未重現」，不能宣告根因消失。
2. **中等成本、須另排窗口：**若有復發或 I/O 尖峰，在不覆寫現有 evidence 的前提下，先向供應商查 VM／磁碟延遲與宿主機爭用，再評估隔離時段的有界磁碟基準或遷移磁碟／VM。基準測試可能干擾 etcd，不能在目前 soak 中做；更換磁碟／VM 涉及停機、備份／還原與重新驗收。取得同時段 guest 和 provider 指標，才可能縮小歸因範圍。
3. **較高成本、架構變更：**若單節點故障域不符需求，另規劃三個獨立故障域的 etcd 成員、備份／還原及 quorum 演練（ERU-016／017）。這改善單一 etcd 節點可用性，不能修復共同儲存延遲或唯一 core 的故障域。調大 heartbeat／election timeout 只改變故障偵測取捨，不是 fdatasync 修復。[etcd tuning](https://etcd.io/docs/v3.5/tuning/)。

成本等級是工程時間、停機及風險的相對估計，**不是供應商報價**。目前優先完成 ERU-002／003 及主要應用路徑；若到期結果有失敗或證據不足，先處理具體故障並用新 run 重測，不能以這份階段性分析關閉 ERU-004。

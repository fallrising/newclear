# ERU-004：etcd 慢同步的原因、影響與處理成本

更新：2026-09-24 12:05 UTC。**ERU-004 分析完成；歷史慢 `fdatasync` 的底層根因仍未證實，也沒有更動儲存或放大 timeout。** 本文只包含可公開的彙總；原始日誌與 samples 保存在 `private/diagnostics/`、`private/soak/`，不可提交。

## 證據與觀測結果

- 2026-09-22 11:13–11:14 UTC，01 的 etcd 記錄 11.26、23.53、9.61 秒的 `slow fdatasync`；health／alarm 查詢有 timeout。約 11:16 的 `vmstat` I/O wait 為 17–20%，根磁碟使用量約 1%，CPU／記憶體未飽和。部署曾因 etcd timeout 失敗，且一次留下可精確辨識並已修正的 worker-4 配額帳目。[當時操作與事故紀錄](M2-2026-09-22.md)。
- 同日 11:22 的 core `nil parent` panic 是 etcd lock 失敗處理的獨立軟體缺陷；已用固定來源 Go 1.27.1 回歸、patch 建置及實機 core 更新驗證。修補消除該 panic 路徑，**沒有證據表示它改善了 `fdatasync`**。[修補與實測](M2-PRIORITIES-2026-09-22.md)。
- 後續數分鐘的健康窗口仍曾看到較高 WAL histogram 桶上界（8–128 ms），backend 桶上界（8–32 ms）；多次保守篩選標記越過候選參考線，但 etcd health 沒有失敗。桶上界不是單次操作時間；16 ms 的桶只表示值落在 8–16 ms，當參考線在 10 ms 時，不能由該桶判定精確 p99 位於線的哪一側。少數較高桶表示短窗口有尾延遲訊號，並未重現 10–23 秒級停頓。
- 2026-09-23 17:45 UTC 的 6 小時 20 分觀測，各主機 761 筆、SHA／筆數完整；01 WAL fsync 1,664 observations，p99 桶上界 16 ms；backend commit 只有 2 次、上界 8 ms。三台 HTTP／health／服務檢查沒有 failure 或 warning。[中途回收摘要](TODO-SOAK-2026-09-23.md)。
- 完整 run `20260923T112336Z-561e71e7` 於 2026-09-24 11:25:06 UTC 自然結束。01–03 各 2,881 筆，最大間隔 30 秒、共同覆蓋 86,400 秒；完整性錯誤、功能失敗與警告皆為零。01 WAL fsync 有 6,308 observations、p99 桶上界 8 ms；backend commit 僅 2 observations，雖然上界為 8 ms，樣本數不足以穩健描述分佈。guest 觀測窗口各指標的峰值為 iowait 0.854%、steal 0.145%、I/O PSI some/full 5.032%／4.974%，磁碟 read/write 平均 8.46 ms／operation。這些峰值未必發生在同一窗口。完整結果與限制見 [ERU-002 回收紀錄](TODO-SOAK-2026-09-23.md)。

## 原因判斷

**最有證據支持的是：01 在事故時曾遇到持久化 I/O 路徑的暫時性長停頓。** etcd 的 WAL fsync 是持久化日誌路徑；歷史 `slow fdatasync` 直接記錄同步時間，當時偏高的 I/O wait 也與 I/O 等待相符。這是「故障類型」判斷，不代表已找到哪一層造成停頓。

目前無法區分 guest 內裝置佇列／其他程序爭用、虛擬磁碟或宿主機競爭、供應商儲存抖動。guest 的 `/proc/diskstats`、PSI、iowait 只能描述虛擬機看到的狀態；read/write 平均不量測 `fdatasync`，而不同指標的窗口峰值也不能假設同時發生。事故當刻沒有同步保存 hypervisor／storage telemetry，無法把事件歸因到供應商。磁碟空間充足只能降低「容量用盡」的可能，不能排除 I/O 延遲。

CPU starvation 與網路／客戶端負載仍是 etcd 整體延遲的其他可能因素，但事故快照未顯示 CPU／記憶體飽和，且它們本身不能解釋 etcd 明確記錄的慢 `fdatasync`。core panic 已確認為另一個已修補的軟體問題，不能當成 I/O 問題已修復的證據。最新 24h 低負載觀測沒有重現秒級停頓；這只表示「本負載／本期間未重現」，不能證明間歇問題消失。

本專案鎖定 etcd v3.6.14。官方 v3.6 文件說明 WAL fsync 與 backend commit histogram 分別觀測日誌持久化及增量 backend commit；其 FAQ 將 p99 <10 ms（WAL）、<25 ms（backend）列作排查參考，並指出磁碟爭用／共享虛擬磁碟、CPU starvation 等可能造成慢 apply 或錯過 heartbeat。[etcd v3.6 metrics](https://etcd.io/docs/v3.6/metrics/)、[etcd v3.6 FAQ](https://etcd.io/docs/v3.6/faq/)、[etcd v3.6 performance](https://etcd.io/docs/v3.6/op-guide/performance/)。本次 collector 以固定 bucket 計算桶上界；Prometheus 說明 classic histogram 的 quantile 精度受所在 bucket 寬度限制，因此不能把桶上界寫成精確 p99。[Prometheus histograms](https://prometheus.io/docs/practices/histograms/)。Linux PSI 與 diskstats 欄位的意義及限制見 [kernel PSI](https://docs.kernel.org/accounting/psi.html)、[kernel I/O statistics](https://docs.kernel.org/admin-guide/iostats.html)。

## 不處理的影響

若秒級同步停頓復發，控制面 etcd 操作可能超時，Eru API 的寫入、部署、健康查詢與恢復工作會受影響。單成員 etcd 沒有另一成員維持 quorum；一旦該成員無法提交資料，不能期待另一個 etcd 接手。已運行的 nginx 可能繼續回應既有 HTTP，但不能據此保證新部署、重新排程、狀態持久化或故障後恢復。現有證據沒有顯示資料毀損或永久故障；風險主要是控制面在停頓期間不可用與操作失敗。

## 成本與建議順序

1. **目前低成本：不做推測性 VPS 變更。** 24h observer 已完成，末端 etcd health 成功，清理後 etcd／core 仍健康。繼續 ERU-005 等既定有界驗證；不因單次 `p99 bucket upper` 調整 timeout，也不在 etcd 資料目錄執行 fio。
2. **若復發，低至中等成本：同步保存事件前後的 etcd journal、health／alarm、WAL/backend histogram、CPU steal、iowait、PSI、diskstats 與 workload 時間線，並請 provider 依 UTC 時間查 VM／磁碟／宿主機告警。** guest 端唯讀採樣的工程成本低；provider telemetry 是否可取、回覆時間與支援成本未知。毋須 provider API，可由 owner 使用既有支援管道或控制台。
3. **若同時段證據指向磁碟，才評估受控基準或遷移。** fio 可能干擾同一虛擬磁碟上的 etcd，應另排低負載維護窗口、優先用隔離 scratch device，並預備健康基線與回復方案。更換 VM／磁碟或升級儲存規格屬中至高成本，含停機、備份／還原與重新驗收；實際供應商費用未知。
4. **若需求包含控制面故障容忍，再另做三成員 etcd。** 這是最高工程及資源成本，需要多個故障域、備份／還原及 quorum 演練；能降低單一成員故障影響，但不能修好共用宿主機或共同儲存問題。現有 ERU-016／017 保留這項架構驗證。

**結論：** ERU-004 的分析交付完成，但歷史根因沒有被證實，也沒有修復儲存。證據足以確認事故時持久化 I/O 曾嚴重延遲、描述其控制面影響並排定相對成本；不足以判定 guest、宿主機或供應商哪一層負責。24h 無復發不構成根因修復。若後續出現新事件或取得同時段 provider telemetry，再新增明確任務做因果驗證／實際修復；目前不讓未證實的根因阻塞其他有界驗收。

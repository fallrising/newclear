---
project: labs/m4-seat
purpose: 保存 M4 Max 48GB 單人本機推論座位的有界規劃
kind: reference
mainline: not-applicable
usable_tag: none
reviewed: 2026-10-21
source_commit: b97319d74f8442b5173ef42be72a0aa757d87df0
---

# m4-seat 成功契約

## 主線與範圍

[方案](docs/plan.md) 是文獻與硬體容量規劃，沒有本repo runtime。
保留條件是區分機主確認的配置、外部碼錶、容量推論與本機未驗事項。
座位A為4-bit MoE；B為24GB專家上限Strata；C為單獨Kev-9B；一次只開一種。
不把48GB筆電當24/7伺服器，不借128GB Max或M4 Pro成績冒充本機實測。
`not-applicable`只表示參考文件沒有執行主線，不表示座位已可用。

## 驗收條件

passed 僅表示本次已核對的靜態條件；historical 表示具日期的既有結果。
沒有 runtime 重跑的項目不以文件檢查代替；pending／failed 保留原缺口。

| AC ID | Given／When／Then | 狀態 | 證據或缺口 |
| --- | --- | --- | --- |
| AC-01 | Given 48GB目標筆電，When 閱讀速度與記憶體表，Then 能區分同配置公開碼錶、不同機器與容量推論。 | passed | [方案§2–4](docs/plan.md) 逐項註明來源與限制；本次核對文件。 |
| AC-02 | Given A／B／C選擇，When 判斷同時駐留及切換，Then 一次一座位、B上限24GB且新增swap觸發卸載。 | passed | [README](README.md)、[方案§3與§6](docs/plan.md) 的規劃邊界。 |
| AC-03 | Given 實際M4 Max48GB，When 執行硬體確認、A/B/C與A→B→A，Then 記錄本機速度／RSS／swap與各列結果。 | pending | [方案§6](docs/plan.md) 六列全部尚未執行；外部benchmark不能替代。 |

## 現況與缺口

目前只有README與方案，沒有安裝器、模型服務或runtime adapter。
A的約132tok/s、約20GB峰值來自另一台同配置公開碼錶，非本機結果。
B沒有這台48GB Max的速度目標，不從頻寬倍率推算。
Kev-4B與MoE聯合冷啟動未量測；Kev-9B單獨載入亦待實機。
Jev是託管API，Kev是相容本機替身，不是取得Jev權重。
pg-jev-router接線不在此方案範圍。

本機未測的tok/s、峰值RSS與SSD讀取結果保持未知，不補估算值。

## 啟動與驗證

沒有本repo可啟動的應用命令；依 [方案§6](docs/plan.md) 準備目標Mac驗收。
文件列 `system_profiler SPHardwareDataType`、`sysctl -n hw.memsize` 供硬體核對。
GPU型號仍須取得可辨識40核的硬體證據，不能只憑速度推定。
模型與引擎設定應以所選實際版本補完整命令、hash及上下文紀錄。
本次未下載模型或修改wired limit，也沒有替來源價格／速度做新查證。

本次只核對文件、入口與證據，未執行產品建置、服務或外部整合。
歷史結果的範圍、來源與未執行項均須隨交接保留。

## 可用版本

目前 `usable_tag: none`。
參考方案不建立runtime可用標記。
需要六列目標Mac實測及實際模型／引擎設定，並將觀察值回填後才能另定可用運行範圍。

後續標記須綁已合併的目標 SHA、必要 CI／審查及該範圍核心流程證據。
沿用歷史結果前須比較其後程式與設定差異，相關改動要補驗。

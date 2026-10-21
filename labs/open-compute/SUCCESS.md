---
project: labs/open-compute
purpose: 驗證固定 open-compute release 的有界持久狀態與人工操作生命週期
kind: lab
mainline: incomplete
usable_tag: none
reviewed: 2026-10-21
source_commit: b97319d74f8442b5173ef42be72a0aa757d87df0
---

# open-compute 成功契約

## 主線與範圍

固定上游v0.2.4，以原始release、非root Linux x64與合成Worker驗證M1–M7。
主線從Worker→D1→等待Workflow，延伸正常restart、完整Local冷還原、
資源／磁碟觀測、checkpoint SIGKILL、受控callback retry與retained人工trial。
各里程碑契約見 [SDD](docs/SDD.md) 與 [STATUS](docs/STATUS.md) 的M2–M7連結。
不保證任意Workers相容、host安裝、惡意程式隔離、HA、power loss、capacity或外部exactly-once。

## 驗收條件

passed 僅表示本次已核對的靜態條件；historical 是已有紀錄，並非本次重跑。
產品未驗項與後續失敗均保留；文件格式通過不能代替runtime驗收。

| AC ID | Given／When／Then | 狀態 | 證據或缺口 |
| --- | --- | --- | --- |
| AC-01 | Given 新建owned scope與等待Workflow，When 正常restart及完整備份後刪來源再還原，Then 原D1／R2／Workflow與nonce保持。 | historical | [M1報告](docs/evidence/2026-10-07-m1-ci.json)、[M2報告](docs/evidence/2026-10-08-m2-ci.json)。 |
| AC-02 | Given 固定idle/read workload與冷磁碟狀態，When 採樣程序及三次cold endpoint，Then 輸出有單位與coverage限制的觀測。 | historical | [M3](docs/evidence/2026-10-13-m3-ci.json)、[M4](docs/evidence/2026-10-13-m4-ci.json)；不推導容量。 |
| AC-03 | Given 公開checkpoint與受控callback失敗，When SIGKILL／retry，Then 原狀態可核對且效果計數符合限定oracle。 | historical | [M5](docs/evidence/2026-10-16-m5-ci.json)、[M6](docs/evidence/2026-10-17-m6-ci.json)；非斷電或外部副作用exactly-once。 |
| AC-04 | Given retained trial，When 三個foreground owner跨stop/start操作後顯式cold destroy，Then 保留狀態、單一D1效果及精確清理成立。 | historical | [M7報告](docs/evidence/2026-10-17-m7-ci.json)、[STATUS](docs/STATUS.md)：20回覆、3個daemon generation。 |
| AC-05 | Given 整合後主線版本，When M4 cold_after_writes關閉觀測，Then 所有owned generations退出且cold證據完整。 | failed | [STATUS M7後續驗證](docs/STATUS.md)：2026-10-17紀錄run39048597519遇parent-edge change，cold observation／cleanup被拒；根因未定。 |

## 現況與缺口

M1–M7確實有原始runtime的bounded CI結果，並非只有mock harness。
M7當輪276tests、五個CI jobs成功，仍不能掩蓋其後integrated-main的M4失敗。
退出碼0與無force不足以證明整棵程序樹已停止；既有拒絕guard保留。
因此主線目前incomplete，需先解釋／修復後續失敗並對目標版本補驗。
retained trial不是daemon服務；lease上限不是soak，Workflow仍有270秒同boot操作限制。
RSS可能重複共享頁、磁碟只計regular-file metadata，不提供完整容量或每row成本。

## 啟動與驗證

依 [quickstart](docs/quickstart.md) 與 [Makefile](Makefile) 使用 `make check`。
真runtime閘門為 `make integration`、`make integration-restore`、
`make integration-resources`、`make integration-storage`、`make integration-crash`、
`make integration-retry`、`make integration-trial`，各自遵循fresh非root runner條件。
M7只有精確manifest與clean receipt才可恢復原scope；一般M1–M6禁止採納既有scope。
本次未下載release、建立帳號、啟動daemon或刪除任何runtime資料。

本次只核對文件、程式入口與既有證據；未執行產品建置或外部整合。
歷史命令與結果保留原來源，不以文件盤點日期覆蓋實測日期。

## 可用版本

目前 `usable_tag: none`。
先調查integrated-main M4 parent-edge failure，保留失敗artifact，再完成目標版本對應必要gate。
未來最多可標記M1–M7限定lab能力；不能擴為通用生產平台、長期可靠性或host部署資格。

標記前須核對已合併目標SHA、必要CI／審查與核心流程證據。
沿用較早結果須比較其後程式及設定差異，相關變更必須補驗。

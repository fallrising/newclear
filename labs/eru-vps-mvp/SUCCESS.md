---
project: labs/eru-vps-mvp
purpose: 驗證四台 VPS 的 Eru 排程、受控重建與控制面恢復
kind: lab
mainline: incomplete
usable_tag: none
reviewed: 2026-10-21
source_commit: b97319d74f8442b5173ef42be72a0aa757d87df0
---

# eru-vps-mvp 成功契約

## 主線與範圍

[SDD](docs/SDD.md) 的主線是1core+3worker的V01–V11，含nginx lifecycle、
資源拒絕、重複apply、worker重裝／失聯、三次全群fresh、etcd quorum、還原與24h soak。
[固定任務表](docs/TASKS.md) 是正式計數依據；本機工具完成與VPS實機驗收分開。
一次性controller不擴成常駐fleet；不承諾Kubernetes、分散式儲存或自動補副本。
元件重裝、OS重灌、fresh重建與保留metadata還原是四種不同驗收。

## 驗收條件

passed 僅表示本次已核對的靜態條件；historical 表示具日期的既有結果。
沒有 runtime 重跑的項目不以文件檢查代替；pending／failed 保留原缺口。

| AC ID | Given／When／Then | 狀態 | 證據或缺口 |
| --- | --- | --- | --- |
| AC-01 | Given Debian13實驗叢集，When 三台worker執行nginx lifecycle／HTTP／資源拒絕與清理，Then 各worker完成且重複apply保留工作負載。 | historical | [2026-09-22部署結果](docs/DEPLOYMENT-RESULT-2026-09-22.md)、[README](README.md)：V02–V05歷史實機證據。 |
| AC-02 | Given owned worker-4，When 元件清理重裝，Then 三次連續smoke通過且其他系統保持邊界。 | historical | [M2恢復](docs/M2-RECOVERY-2026-09-23.md)；不是V06 OS重灌或V08全群fresh。 |
| AC-03 | Given synthetic controller inputs，When fresh-run與metadata格式測試，Then journal、recovery及generation等本機契約通過。 | historical | [TASKS](docs/TASKS.md)：2026-10-08共1258；2026-10-09 metadata切片1284項，本機限定。 |
| AC-04 | Given 三個不同真實generation，When 執行完整fresh與worker故障／重灌，Then 原V01–V08及residue／RTO條件成立。 | pending | [E2E操作包](docs/E2E-OPERATIONS-2026-10-06.md) 為UNEXECUTED；正式完成6／剩12。 |
| AC-05 | Given 真實控制面及保留資料，When 備份還原、quorum故障與24h soak，Then metadata／runtime對帳及可用率符合V09–V11。 | pending | [TASKS](docs/TASKS.md)、[備份切片](docs/M3-METADATA-BACKUP-LOCAL-2026-10-09.md)；格式檢查不等於snapshot或restore。 |

## 現況與缺口

### 本次維護範圍：#378 私有 SSH alias 注入

本次只修正 operator inventory 的 alias 邊界：保留四個邏輯 node／role、
既有 plan/hash/generation 與 destructive authorization 檢查，從既有私有
deployment-plan 或其已綁定輸入取得 SSH alias；不在 runtime/test code 留下部署專屬預設。
驗證先用中性 fixture 與缺少／不合法／不一致 inventory 的負向案例，
再跑必要的 recovery、reimage、fresh 相關本機測試及 repository contracts。
本次未授權讀取真實 private inventory、SSH、provider 或實機操作，AC-04/05 保持 pending。

T-057 維護只修正 inventory loader 與既有 trusted `private/` root symlink
政策的相容性；explicit file loader 仍拒絕 symlink，inventory file／record
及 project ancestor 的負向保護不得放寬。先重現完整測試的一個 error，
再驗 inventory／fresh rebuild／entrypoint／bundle 本機回歸；是否重跑完整套件由 parent 決定。

| 維護 AC | Given／When／Then | 狀態 | 證據 |
| --- | --- | --- | --- |
| MA-378 | Given 明確且合法的私有 inventory，When 建立相關 operator／plan，Then 使用注入 alias 並保留邏輯身分；缺少或不一致設定在操作前失敗 | pending | [任務](tasks/378-private-alias-config/task.md)；待本機回歸與獨立審查 |

### 既有主線缺口

已有真實部署與worker元件重裝證據，不能簡化成全部fake。
另一方面新fresh/recovery大部分是synthetic transport／temp roots本機證據。
core v0.1.7兩次build為verified-not-deployed；不可把來源驗證寫成已升級。
2026-10-09固定計數仍完成6／剩12；任務數不隨文件增加而偷偷減少。
歷史etcd停頓根因、live恢復及完整重建仍需實機證據。
Metadata切片只驗提供檔案bytes/checksum，不取得snapshot、不驗bbolt、不連線etcd。

## 啟動與驗證

先讀 [quickstart](docs/quickstart.md)、[OPERATOR](docs/OPERATOR.md)、[HANDOFF](docs/HANDOFF.md)。
[scripts/labctl.py](scripts/labctl.py) 是plan／execute／status／reconcile及fresh-run入口。
完整本機測試：`python3 -m unittest discover -s tests -v`，是長時間手動檢查。
PR CI僅來源／連結／private path檢查，不能代替完整controller或live驗收。
遠端操作需精確private inventory、當次scope／hash／generation授權及恢復計畫。
本次未使用SSH、provider、nft或實驗叢集；不重跑數小時產品測試。

本次只核對文件、入口與證據，未執行產品建置、服務或外部整合。
歷史結果的範圍、來源與未執行項均須隨交接保留。

## 可用版本

目前 `usable_tag: none`。
需依TASKS補正式剩餘12項所需live證據，尤其fresh／重灌、失聯、quorum、還原與soak。
原有local工具切片不具備整個四機MVP的可用標記資格。

後續標記須綁已合併的目標 SHA、必要 CI／審查及該範圍核心流程證據。
沿用歷史結果前須比較其後程式與設定差異，相關改動要補驗。


Owner update 2026-10-24: long Eru verification is deferred to a tracked disposable VPS follow-up. Local broad rerun was explicitly stopped; PR572 remains Draft. Focused correction evidence is retained, with no full-pass or live-acceptance claim.

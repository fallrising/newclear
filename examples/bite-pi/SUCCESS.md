---
project: examples/bite-pi
purpose: 保留 Pi 驅動基礎平台產生器與 9router 接線示範
kind: archived
mainline: not-applicable
usable_tag: none
reviewed: 2026-10-21
source_commit: b97319d74f8442b5173ef42be72a0aa757d87df0
---

# bite-pi 成功契約

## 主線與範圍

[README](README.md) 已列 Tier D retired；保留 demo 來源與角色邊界即為本次結束條件。
示範讓 Pi skill／Bash 產生 Nginx、監控、日誌及 9router Compose 骨架。
Pi 是操作助手，9router 是獨立上游 gateway；本例不取代 Terraform/Kubernetes 或維運責任。
不恢復正式部署、不將示範設定升級成可持續運行的平台保證。

## 驗收條件

本表的 passed 僅表示本次已核對的靜態條件；historical 是既有紀錄，
不表示 2026-10-21 重跑產品。pending／failed 保留其實際缺口。

| AC ID | Given／When／Then | 狀態 | 證據或缺口 |
| --- | --- | --- | --- |
| AC-01 | Given 歷史 demo，When 查閱來源，Then skill、生成器與 platform 產物都可定位且標示封存。 | passed | [README](README.md)、[bootstrap](scripts/bootstrap-platform.sh)、[platform](platform/)。 |
| AC-02 | Given 預設產生器設定，When 靜態檢視 gateway bind，Then 9router 預設 loopback且 API key 不硬寫入範本。 | passed | [bootstrap](scripts/bootstrap-platform.sh)、[clients](platform/clients/README.md)；僅源碼核對。 |
| AC-03 | Given 乾淨環境與合法 upstream 設定，When 起服務並由 Pi/OpenCode 呼叫，Then 各服務健康且 gateway 回覆。 | pending | 沒有本輪 Compose／provider 實測；[README](README.md) 僅提供示範步驟，封存不補做。 |

## 現況與缺口

[bootstrap](scripts/bootstrap-platform.sh) 是實際 Bash 生成器，不是 Pi 的全自動執行紀錄。
它會寫入本目錄 platform，故重跑不是無副作用的閱讀動作。
9router 原始碼不 vendoring；上游版本、登入、外部服務可用性未於本次驗證。
預設示範密碼及基礎設定需要獨立操作審查，不能視為正式部署設定。
封存判定只關閉維護投入，沒有補造歷史 runtime PASS。

APM是可選profile，不是所有示範都已啟動的紀錄。
Compose語法有效只代表設定可解析，不能證明gateway或監控健康。
平台長期持久化與升級責任仍屬各服務及操作者。

## 啟動與驗證

歷史入口依 [README](README.md)：`./scripts/bootstrap-platform.sh`，
再於 platform 執行 `docker compose config`；實際 `up` 另涉及服務與資源變更。
[platform/clients](platform/clients/README.md) 保存 Pi／OpenCode 接線範本。
本次只讀 [生成器](scripts/bootstrap-platform.sh) 與既有設定，未重寫產物或啟動容器。
舊教學中的 standalone 路徑需對照 monorepo 的本目錄。

本次只核對文件、入口與證據連結；未執行產品建置、服務或外部整合。
未執行的產品驗收不會因本文件通過格式檢查而轉為通過。

## 可用版本

目前 `usable_tag: none`。
封存 demo 不建立可用標記。
如另行重啟，先定義限定服務與上游版本，再補 Compose、健康檢查和真實 client/gateway 證據。

任何未來可用標記都須對應已合併的目標 SHA、必要 CI／審查與核心流程證據。
較早證據須先比對其後程式與設定差異；有關變更補驗後才能沿用。

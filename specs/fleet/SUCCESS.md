---
project: specs/fleet
purpose: 以期望狀態協調個人 VPS 的 Compose 工作負載與入口
kind: service
mainline: incomplete
usable_tag: none
reviewed: 2026-10-21
source_commit: b97319d74f8442b5173ef42be72a0aa757d87df0
---

# Fleet Catalog 成功契約

## 主線與範圍

雖位於 specs/，仍是實際 Go 控制面；[SDD](docs/SDD.md)以 fleet.yaml、fleetd 與 outbound fleet-agent 定義 Phase 1 MVP。
主線是註冊工作負載、編譯 Compose、節點 reconcile，並顯示 URL、版本、health 與 public/access/private expose mode。

針對單 owner、2–10 台 pet VPS 與 5–40 個服務；不做 Kubernetes。
不執行相鄰主機 hygiene script，也不使用 ClarkQ 當 control bus。

本契約核對的是上述來源版本中的文件與程式。
`complete` 只適用明列的主線範圍；沒有延伸為部署或生產保證。

## 驗收條件

下表 `historical` 是既有報告的結果，沒有在 2026-10-21 重跑。
`pending` 保留缺少證據或尚未實作的條件；程式存在不等於通過。

| AC ID | Given / When / Then | 狀態 | 證據或缺少原因 |
| --- | --- | --- | --- |
| AC-01 | Given 合法或非法 fleet.yaml，When schema 驗證與 Compose 編譯，Then 只產生符合契約的 runtime 設定 | pending | [Makefile](Makefile)有 validate-schema/test，缺固定候選的完整驗收輸出 |
| AC-02 | Given fleetd 與節點設定，When agent 拉取 desired state 並 start/stop/redeploy，Then 真實工作負載與 catalog 狀態收斂 | pending | [agent main](cmd/fleet-agent/main.go)存在；缺實際 VPS reconcile 證據 |
| AC-03 | Given public/access/private 三模式，When 執行 Cloudflare Tunnel/Access bootstrap，Then 路由與存取政策符合契約且私人服務不可公開 | pending | [bootstrap](docs/bootstrap.md)仍為 operator-side 操作，未找到對應 live 驗收 |
| AC-04 | Given 節點或控制面重啟，When 恢復 desired state 與 health 上報，Then 不錯置 workload 或遺失控制狀態 | pending | [SDD](docs/SDD.md)與程式存在，缺版本化故障／恢復 acceptance record |

## 現況與缺口

README 記錄 Phase 1 code 已在 main、unit tests 由 CI 執行；這不是 live VPS/Cloudflare 驗收。
目錄名稱不能將可執行服務改標為 reference 或 not-applicable。
實際兩個 binary 的配置載入、HTTP 與 reconcile 入口已存在。
不因本次文件工作登入 Cloudflare、建立 Tunnel、註冊真節點或執行部署。

這次僅新增驗收入口，未改變 runtime 或原有驗收 oracle。
歷史結果若與現行 source 有相關差異，必須補驗而不能直接繼承。

## 啟動與驗證

[bootstrap](docs/bootstrap.md)列出第一節點、WARP 與本機配置；先於目標環境確認授權再照 runbook 操作。

已核對入口：[fleetd](cmd/fleetd/main.go)、[fleet-agent](cmd/fleet-agent/main.go)與 [Makefile](Makefile)。
下列是該入口既有的啟動或驗證命令，並非本次執行紀錄；
需先完成連結文件中的依賴、設定及適用環境準備。

```sh
make test
make build
make validate-schema
```

執行後應保留來源 SHA、必要設定的非秘密摘要、命令與結果，
並將 runtime 證據逐項對回 AC；不得只用 health 或 exit 0 宣告全部完成。

## 可用版本

目前 `usable_tag: none`；本次沒有建立或發布任何 tag。
既有版本號、合併紀錄與歷史驗收不自動轉換為可用版本標記。

須記錄固定版本的 schema/contract checks，再完成真節點 desired-state 與三種 ingress 的閉環及恢復驗收；目前尚無可用標記。

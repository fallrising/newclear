---
project: platform/signal-hub
purpose: 將個人來源事件持久化、聚合並可靠投遞至訂閱者
kind: service
mainline: incomplete
usable_tag: none
reviewed: 2026-10-21
source_commit: b97319d74f8442b5173ef42be72a0aa757d87df0
---

# Signal Hub 成功契約

## 主線與範圍

[SDD v0.2](SDD.md)的首次個人閉環是至少一個有用真實來源，經 token ingest/去重、看板查詢、重啟持久與隔離還原。
M1–M5 runtime 已接受；最新 M6 個人使用範圍以[安全運作驗收](docs/sdd/06-security-operations-acceptance.md)為準。

只存事件、算指標、投遞；不評估外部告警語義、不決策或執行動作。
單 owner、tailnet、單實例；三來源七天、手機與獨立停機通知是選用擴展，不重新加成本版門檻。

本契約核對的是上述來源版本中的文件與程式。
`complete` 只適用明列的主線範圍；沒有延伸為部署或生產保證。

## 驗收條件

下表 `historical` 是既有報告的結果，沒有在 2026-10-21 重跑。
`pending` 保留缺少證據或尚未實作的條件；程式存在不等於通過。

| AC ID | Given / When / Then | 狀態 | 證據或缺少原因 |
| --- | --- | --- | --- |
| AC-01 | Given 合法事件與重送，When ingest 後查詢並重啟，Then source+id 永久去重、角色隔離與持久事件成立 | historical | [STATUS M1/M2](docs/STATUS.md) |
| AC-02 | Given 版本化規則與訂閱，When 聚合、回填、投遞失敗與重放，Then 門檻事件不重複且 stable delivery ID/重試/DLQ 可查 | historical | [STATUS M3/M4](docs/STATUS.md) |
| AC-03 | Given 事件庫與指定備份目錄，When 驗證封存、清除、匯回及隔離還原，Then 一致資料與永久去重維持 | historical | [STATUS M5](docs/STATUS.md)、[runtime](docs/runtime.md) |
| AC-04 | Given 實際有用途的生產者與非 root 持久實例，When 送事件、重啟並由備份還原，Then 第一條個人使用閉環有同版證據 | pending | [STATUS M6](docs/STATUS.md)：實際來源接入、持久部署及實例備份仍待驗證 |

## 現況與缺口

目前沒有新核心業務功能阻擋首次個人使用；缺口主要是實際接線與操作驗收。
Docker/resolver 準備包有驗證，測試 fixture 並非真實來源。
未帶 backup-dir 不會自動備份，不能假設現有 launch 已開啟。
/v1/self 與主動低磁碟檢查是後續小型補強；不把它們或手機通知擴張為首次使用硬 gate。

這次僅新增驗收入口，未改變 runtime 或原有驗收 oracle。
歷史結果若與現行 source 有相關差異，必須補驗而不能直接繼承。

## 啟動與驗證

[Quickstart](docs/quickstart.md)與[非 root Docker 包](deployment/docker/README.md)說明私有設定、持久 volume、備份及隔離還原。

已核對入口：[signalhub main](cmd/signalhub/main.go)。
下列是該入口既有的啟動或驗證命令，並非本次執行紀錄；
需先完成連結文件中的依賴、設定及適用環境準備。

```sh
go test ./...
go test -race -count=1 ./...
```

執行後應保留來源 SHA、必要設定的非秘密摘要、命令與結果，
並將 runtime 證據逐項對回 AC；不得只用 health 或 exit 0 宣告全部完成。

## 可用版本

目前 `usable_tag: none`；本次沒有建立或發布任何 tag。
既有版本號、合併紀錄與歷史驗收不自動轉換為可用版本標記。

須在授權的真實單來源實例完成 ingest→看板→重啟→備份還原，核對持久資料與合併版本；不需為此增建 HA 或三來源七天方案。

# 11 — Ops 維運工作台 SDD

版本：WS-SDD revision 1 · 狀態：W1 已驗收合併；W2 已實作、完整驗收待完成，固定證據見 [STATUS](../STATUS.md)；W3–W5 為後續設計；共用模型見 [09](09-shared-workspaces.md)，能力深度見 [13](13-capability-map.md)，驗收見 [14](14-workspace-delivery.md)。

## 1. 使用者與責任

Ops 負責指定資源池的基礎設施與獲授權服務的運行保障。起點是異常、待審、容量與變更，能從資源追到其服務影響。專業資源面板使用同一個 CI／ResourceObject，不為 K8s、雲主機、Redis、MySQL、Kafka 各自建立孤立 inventory。

K8s 管理與 cluster 管理共用「叢集」能力：cluster 是資源身分；K8s 是其技術類型及專業 tabs。雲資源管理是 provider/account/location 的篩選與整合入口，不另造另一份 cloud CMDB。network、資料庫及 middleware 可有專屬行為，但身份、scope、工作單與稽核共用。

## 2. 導航與工作首頁

| 導航組 | 入口 | 首要工作 |
| --- | --- | --- |
| 值勤工作 | `/ops`、`/ops/incidents` | active incidents、待我審批、失敗交付、容量風險、待完成維護。 |
| 審批與變更 | `/ops/requests`、`/ops/releases`、`/ops/jobs` | 沿用已公開路由；W2 增同源 WorkItem 聚合，不改來源 ID。 |
| 資源 | `/ops/cmdb`、`/ops/capacity`、`/ops/topology` | 共用 inventory、來源／pool 篩選、freshness、影響及容量。 |
| 專業面板 | 規劃 `/ops/clusters`、`/ops/databases`、`/ops/caches`、`/ops/messaging`、`/ops/networks`、`/ops/storage` | 對同 CI 的分型查詢與 tabs；按 W2 或後續能力逐一啟用。 |
| 告警運行 | 規劃 `/ops/alerting` | 規則運行狀態、路由結果、事件／抑制／投遞診斷；W4。 |

首頁預設獲授權 scope，不把所有公司資產數當主要工作成果。排序：critical 未處置 → failed execution → 待審 → capacity/staleness；每項有資料時間、scope、來源及合法下一步。只有配置資料而沒有時間序列時不顯示「即時運行正常」。

專業 detail 使用固定 ciId，如 `/ops/clusters/:ciId`；CMDB detail 與它互相連結同一 ID。cluster 與 pool 不強制一對一；一個 CI 沿用目前唯一 poolId，cluster membership 以 Relation/ResourceObject 表達，不能用前端篩選器偷偷遷移 pool。

## 3. 專業資源面板

| 能力 | 列表／detail 主要內容 | 有界操作與階段 |
| --- | --- | --- |
| Compute／雲資源 | provider、account safe label、location、pool、型別、CPU/memory、owner、freshness、placement | v0.1 metadata 納管與容量沿用；VM power/reimage、EMP/CIS executor 留後續。 |
| K8s／cluster | orchestrator/version、nodes、namespace、workload summary、allocatable/requested、健康與採樣時間 | W2 先唯讀與關聯下鑽；後續 drain/upgrade/scale 必須獨立變更流程，不提供任意 kubectl。 |
| Redis／cache | engine、version、allocation、reserved quota、observed usage、連線摘要、可見 consumers | W2 完成 allocation 綁定與 quota 變更 Mock；instance restart/failover/flush 與 key browser 留後續。 |
| MySQL／RDS | instance 與 database objects、版本、容量、replication/backup 摘要、可見使用方 | 當前僅 database CI；專業 DB/backup/change request、SQL review、CDC/DTS 另列後續，未知值不可假裝採集完成。 |
| Kafka／queue | cluster、topic、partitions、retention、quota、consumer binding、lag 的 sample freshness | W2 完成 topic create/bind；lag 未有樣本標 unknown。broker maintenance、topic delete、repartition migration 留後續。 |
| Network／流量 | VPC/subnet、IP allocation、安全規則、LB/listener/route、DNS/cert references、依賴 | W3 先服務流量策略與網路關聯；IPAM、SNAT、NPM/ACL、DNS/cert life cycle 後續。 |
| Storage | pool、class、capacity、volume/bucket object、attachment、backup metadata | 初期沿用 storage CI 唯讀；USS 專業 provision/restore 後續。 |

資源 detail 共用：概要、子資源、使用服務、配置與版本、監控／告警、變更與稽核。高影響操作須先顯示目標版本、capacity delta、consumer impact、維護窗口、回復條件與 reason。未實作的高影響操作不顯示可點擊「成功」按鈕。

## 4. 資源審批中心（W2）

審批列表顯示 sourceType/sourceId、需求類型、app/env/stage、pool/CI/object、requester、差額、風險、等待時間及可執行動作。分為待審、已決策、待執行、失敗、已完成；分類是投影，不把現有 Request/Release state 改寫成統一 enum。

逐筆審批順序：

1. 讀取提交時的 spec/catalog snapshot 與目標版本，核對 requester 和 approver 不同。
2. 顯示業務用途、目前容量、保留量與批准後的 delta；各計量單位獨立，不以 CPU 代替 Kafka partitions、Redis quota 或 DB storage。
3. 顯示可授權的 consumers／依賴及風險；共享變更的完整影響未獲授權時不能批准，交給具足夠 scope 的人處理。
4. 批准或拒絕需 reason。批准原子保留 quota，但尚未改 active 配置；另一張競爭最後容量的單必須失敗。
5. 執行前重驗授權、state、targetVersions、lock。成功後從 receipt 導向同資源／Binding；失敗可見原單及 execution attempt，不留下幽靈綁定。

現有 Request approval 的 project/stage + pool 交集，以及 prod release 的 project/stage 授權保留。新資源 ChangeRequest 的讀寫規則依 09，不透過批准 API 隱式擴張 project。Ops 自發共享維護亦需另一位具足夠 scope 的 Ops 批准；W2 fixture 必須加入第二位 Ops 負向／正向案例，不能拿 Admin 當萬能批准者。

## 5. 告警控制面與處置（W4）

`/ops/alerting` 聚合 infrastructure rules、獲授權 service rules 的生效版本、evaluation freshness、active incidents、Silence、notification delivery status。設定與運行分頁分開，避免把「規則 enabled」視為「監控有資料」。

- Ops 編輯自己 pool 的基礎設施規則；RD 提交的 prod 服務規則可由具 project/stage scope 的 Ops 批准，不能任意改所有服務的閾值。
- Rule evaluation 用 sample-time 順序及連續樣本條件；version 改變開新 evaluation lineage，歷史 incident 保存 ruleRevision，不回寫舊證據。
- Silence 以 target refs、reason、expiry、actor 保存；過期自動恢復通知評估。Silence 不把 incident 設 resolved，也不清除異常證據。
- 控制面明示通知的「已建立／被抑制／模擬投遞成功／失敗」，與 incident 的 open/acknowledged/investigating/resolved 分開。
- Incident detail 沿用 metrics → trace/log → CI/依賴 → 最近變更。時間相近只表示可能相關；健康樣本足夠才恢復。

W4 只模擬通知隊列與固定失敗，不連 Slack、Email、短信或真告警平台；值班排程、跨組 escalation、ITSM SLA 後續另定。

## 6. 共享資源變更與運行安全

Ops 面板須同時呈現 desired revision、已生效 revision、observedAt 及 reconciliation 狀態。配置已批准但尚未執行、執行成功但樣本未到、資料過期都不能合併成單一綠燈。

規劃中的 drain/upgrade/resize/failover 類操作不直接沿用 CI metadata PATCH：需 capability-specific schema、impact、執行鎖、approval、驗證與 rollback/補償邊界。大型 batch、任意腳本、production break-glass 及不可逆刪除不屬於 W1–W5。新增 executor 前先立真實整合 SDD，不由瀏覽器對 cloud API 或 K8s API 直連。

## 7. 失敗、空資料與權限

| 情境 | 要求 |
| --- | --- |
| 有 pool grant，沒有 consumer project grant | 可見物理資源；隱去 consumer identity/payload，不顯示隱藏總數。共享變更不能聲稱影響已完整核對。 |
| 觀測過期／整合中斷 | 顯示最後成功觀測與原因；配置 inventory 仍可讀；不把沒有告警當作 healthy。 |
| 兩人同時批准／不同單搶配額 | version/idempotency/reservation 在同一 domain transaction 核對；只能一個有效決策，不重複消耗。 |
| catalog 已改或停用 | 按來源流程處理 snapshot；不得默默換模板，invalid/stale 顯示明確原因。 |
| 執行失败／重試 | 原 active 保留、attempt 可追；重試依該 domain 流程重新驗證，不清掉前次紀錄。 |
| 容量不足 | 分別展示 physical capacity、reserved、observed usage 與 quota；不可將其他 pool 剩餘量當本 pool 可用。 |

## 8. Ops 的可驗收結果

對應 REQ-WS-01/02/04/05/07/08/09/10；驗收 AC-WS-01～09、11～12、15～18。主線：看到 RD 同一筆 Redis／Kafka 需求 → 查目前容量與可見影響 → 批准／執行 → 在專業面板看到唯一 object/binding → RD 返回服務頁看到同一結果。另一條主線是從 incident 追到共享資源與變更，維持 v0.1 的認領、調查及恢復樣本規則。


W2 固定候選 `a05491c`（2026-09-23）：[W2 contract](../W2-INTEGRATION-CONTRACT.md) 的完整資源／變更模型、API、原子遷移與 UI 已實作。314 項原生測試通過，產品來源 `740a2bc` 的效能及歷史 W1 升級瀏覽器驗證通過；完整 Chromium／Firefox／WebKit、獨立 review 與最終 CI 仍在進行，**NOT_ACCEPTED**。實際證據和最新結果以 [STATUS](../STATUS.md)、[W2 驗證報告](../../../../.team/reports/dim-gate-w2-validation.md) 與 PLAN 為準。W3–W5、後續／待釐清能力尚未實作。

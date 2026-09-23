# 10 — RD 業務研發工作台 SDD

版本：WS-SDD revision 1 · 狀態：W1／W2 已驗收合併；W3 固定產品已驗收，PR37 最終文件 head CI／合併另行對帳；W4／W5 尚未實作。產品行為依本章，當前證據與接受決策見 [STATUS](../STATUS.md) 和 [PLAN](../../../../.team/PLAN.md)。

## 1. 使用者、目標與邊界

使用者是公司內開發業務系統的工程師。主要問題是「我的服務需要什麼、跑在哪裡、如何安全交付、出了什麼狀況」。業務線／專案／服務／環境是資訊主軸；不要求 RD 先辨識 EMP、CIS 或某個雲商控制台才能提出需求。

以 Application 作 UI「服務」，保留現有 applicationId 與 `/rd/apps` 路徑。服務可消費多 provider、多共享資源；關係圖不是硬塞成單一資源樹。RD 可配置服務使用方式與提出資源變更；共享 cluster、DB instance、VPC 的全域管理由 Ops 承擔。Admin 身分不取代 RD 的發布授權。

## 2. 導航與首頁

| 導航組 | 頁面／路由 | 內容與狀態 |
| --- | --- | --- |
| 我的工作 | `/rd` | 我的服務健康、待我補件／失敗申請、近期交付與待批准發布；W1 重整現有資料。 |
| 服務 | `/rd/apps`、`/rd/apps/:appId` | 搜尋、owner、tier、環境、部署版本、資料時間；沿用既有路由。 |
| 交付 | `/rd/pipelines`、`/rd/releases/:releaseId` | 原 runs／release detail；W3 加定義版本與服務內入口。 |
| 自助資源 | `/rd/catalog`、`/rd/requests` | 可申請能力與我的／團隊申請；W2 後按 sourceType 呈現多種變更。 |
| 運行狀況 | `/rd/observability` | RED、trace、log、incident；W4 加監控設定與告警規則入口。 |

每張首頁卡片可下鑽到同 scope 的實際清單。預設「我的服務」是獲授權專案內服務，不因 ownerTeamId 自動授權；可切「我發起的工作」。健康 unknown／stale 不算 healthy；没有服務時說明需取得專案授權，不提示可自行建立 grant。

W1 不新增所有未實作的 tab；後續頁面以下列穩定路由逐段開放：`/rd/apps/:appId/resources`、`/delivery`、`/configuration`、`/traffic`、`/monitoring`、`/alerts`，以 `environmentId` query 表達環境。環境必須屬於 path 的 app；不符合回404，不自動改看別的服務。既有 environment/release 深連結仍可用。

## 3. 服務詳情的資訊骨架

頂部固定：服務名、project、owner、tier、environment/stage、目前 active release、健康及資料時間。主內容 tabs：概覽、資源、交付、服務配置、流量、監控與告警、變更紀錄；僅呈現已實作且有讀權限的項目。

| 分頁 | 主要欄位／互動 | 重要結果 |
| --- | --- | --- |
| 概覽 | 目前版本、最近變更、未完成申請、active incidents、依賴摘要 | 區分配置依賴與 trace 觀察；可跳同一 CI／release／incident。 |
| 資源 | kind、用途、Binding 狀態、容量／quota、object 名稱、來源、可讀 endpoint label、最近工作單 | 以計算、資料庫、快取、訊息、儲存、網路分類；申請／調整自己的消費規格，不操作共享 instance。 |
| 交付 | PipelineDefinition revision、repository ref、artifact、run、approval、release health | 編輯定義不立即觸發 run；run snapshot 保留當時定義。 |
| 配置 | ServiceConfig revision、key、非秘密值／secretRef、環境差異、active/draft | 保存草稿、diff、驗證、申請生效、回復歷史版本；不顯示真實 secret。 |
| 流量 | 服務端點、route match、目的版本、權重、健康门檻 | 只作用於此 env 的目標版本；與平台 gateway 路由分離。 |
| 監控／告警 | 採集設定、服務 RED、SLO、AlertRule、通知訂閱及抑制狀態 | 規則配置成功不等於已有觀測樣本；無資料明示 unknown。 |
| 變更紀錄 | 工作單、批准、執行、事件、actor、correlation、失敗理由 | 同因果鏈導向 Ops 可讀證據；不另生成 RD 專用歷史副本。 |

## 4. 資源自助：最先深入的流程（W2）

入口可從「服務 → staging → 資源 → 申請」或 catalog 開始；後者仍必選 app/env。表單按能力顯示，不能以通用任意 JSON 代替產品交互。

| 選定能力 | 申請欄位 | 成功後 RD 看見 | 限制 |
| --- | --- | --- | --- |
| 現有環境 compute | 沿用模板、provider/pool、CPU、memory、用途 | ready Environment、CI、Placement 與 job | 保留既有 Request／ProvisionJob 流程。 |
| Redis 綁定／配額調整 | app/env、catalog revision、允許的 allocation、quotaMiB、accessProfileRef、用途 | 同 Redis CI 下自己的 Binding、配額與申請紀錄 | 不提供 FLUSHALL、instance restart、其他 consumer keys。W2 不模擬 key/value 內容。 |
| Kafka topic 建立／綁定 | topicName、partitions、retentionHours、throughputKiBPerSecond、producer/consumer profile、用途 | ResourceObject 及 Binding、期望設定、操作結果 | 名稱在 parent cluster/namespace 內唯一；W2 不提供 partition 縮減、topic delete 或真訊息收發。 |
| MySQL database 使用 | database/object、access profile、容量、備份等級 | 授權 object 與安全連線摘要 | 列入後續能力，不能因已有 database CI 就宣稱可建 DB、執行 SQL 或做 DTS。 |
| K8s／容器 | namespace/workload 位置、requests/limits、replicas 的唯讀摘要 | deployment 與所在 cluster 的可讀關聯 | 第一個增量提供讀模型；exec、kubectl、任意 manifest 與 cluster-admin 不在 RD 主線。 |

提交前顯示 scope、期望差異、approval 類型、估計影響及 Demo 標記。容量數據有時間戳，批准時重新核對。目錄停用不能暗中變更已提交 snapshot；不可選其他專案 object。成功必須能在服務資源頁與 Ops 同一資源 detail 中找到相同 object/binding/change IDs。

## 5. CI/CD、服務配置與灰度（W3）

PipelineDefinition 最小配置：applicationId、revision、repositoryRef、允許的 branch/ref pattern（固定安全選項）、recipeRef、artifactRepositoryRef、target environments、approval policy reference。Mock 使用已註冊 recipe，不執行 shell/script，不連真 Git repository 或 runner。Run 保存 definitionRevision／sourceRevision／artifactDigest；修改 definition 不改舊 run。

ServiceConfig：限定 string/number/boolean 與 secretRef 型別、每 key 的名稱／description／valueType／value、environmentId、revision、validationResult。secretRef 只接受已登記的虛構 reference；前端不提供解密或真密鑰輸入。draft → validated → pending approval（prod）→ applying → active/failed；dev/staging 可經同一執行路徑直接 applying，仍需明確確認與稽核。失敗保留上一個 active；回復建立新 revision，不改歷史。

TrafficPolicy：environmentId、已註冊 service endpoint、path/host match、targetReleaseIds、weights、health window、thresholds、revision。W3 只做同環境兩個合格版本的 10% → 50% → 100% 分段演示；權重為非負整數且總和100、target 必須屬此服務環境。健康樣本缺失則等待／超時失敗，不自動放量；異常停止並保留上一個已驗證權重版本。業務 Release 仍以原 health gate 決定 activeReleaseId，TrafficPolicy 只描述流量狀態，不直接改寫 activeReleaseId。

prod 的定義啟用、服務配置與流量變更需不同且具 project/stage grant 的 Ops 批准。Ops 對底層 network/ACL 的變更另走 pool scope，不因批准某服務的流量策略而取得 cluster 改寫權。具體配置 command/approval DTO 在 W3 contract 固定後才實作。

## 6. 服務監控、告警及通知（W4）

MonitorPolicy 定義 app/env、已註冊來源、採樣間隔、指標 allowlist 與啟用狀態；不是任意 PromQL/SQL editor。AlertRule 定義 metric、aggregation/window、comparator、threshold、requiredConsecutiveSamples、severity、notification subscription、enabled/version。SLOPolicy 的 indicator、target、window 有單位；v0.1 RED 指標沿用，不因增加設定而偽造歷史樣本。

RD 可草擬／更新自己 app/env 的規則；prod 啟用遵循配置審批。通知只能選 Admin 核准且 scope 合法的 channel reference，不能輸入任意 webhook。短期 Silence 需 reason、開始／結束、限定 rule/env；上限由平台政策設定。Silence 抑制通知投遞，不刪樣本、incident、稽核或阻止真實狀態轉移；系統顯示抑制剩餘時間。

RD 看服務 incident 與診斷，Ops 負責既有 acknowledge/investigate；不把能編輯服務告警規則等同於 incident 處置權。通知預覽明示模擬，不發送郵件、訊息或外部 HTTP。

## 7. 申請中心與失敗體驗

預設「我發起」，可切「團隊可見」；按環境／能力／原始狀態／時間篩選。列含 source type、編號、服務／環境、用途、申請者、批准者、狀態、等待時間、最後變更；只從來源時間計算等待，不聲稱已實作 SLA／排班。Detail 分開「內容與版本」「決策」「執行結果」「稽核」。

| 情境 | UI 與 domain 結果 |
| --- | --- |
| 無 grant／grant 被撤銷 | 清舊快取；讀回403/404、寫入拒絕；保留未送出的安全草稿但不可跨身分自動帶入。 |
| quota 不足／目標版本已變 | 顯示 requested/available 或差異；重新讀取再確認，不自動提交新版本。 |
| 被拒絕 | 顯示理由；可另建草稿，原單決策保留。 |
| 執行失敗 | 顯示失敗步驟／requestId／合法重試路徑；不顯示 Binding 已生效。 |
| 同名 topic／重複點擊 | 409 或同一 idempotent receipt，不多建 object 或 quota reservation。 |
| provider 不支援能力 | 申請前顯示不支援及原因；不轉成另一 provider 的假成功。 |

## 8. RD 的可驗收結果

對應 REQ-WS-01/02/03/05/07/08/09/10；核心驗收 AC-WS-01～07、09～12、15～18。最小角色故事是：找到服務 → 在合法環境提出 Redis／Kafka 需求 → 查看同張工作單的批准與交付 → 使用實際回傳的 Binding → 從服務頁看變更與運行狀態。CI/CD 配置與監控／告警設定分別在 W3/W4 才加入，不能用既有 Run 或 Incident 頁宣稱已完成配置能力。


W2 歷史本機驗證 checkpoint（2026-09-23；後已由 PR36 驗收合併，詳見 STATUS）：產品 `4a69e07` 通過321項原生測試、77/77 Chromium、2/2隔離；最終修正 `bf3f168` 通過8/8 Firefox／WebKit、實際版面／鍵盤檢查及3/3效能。獨立review關閉F01–04；仍須最終PR head CI、主控接受與實際合併，**尚未宣稱 W2 ACCEPTED/MERGED**。完整AC與歷史失敗以 [STATUS](../STATUS.md)、[W2驗證報告](../../../../.team/reports/dim-gate-w2-validation.md) 和PLAN為準。該歷史checkpoint時W3–W5尚未實作；目前W3固定產品已驗收，PR37最終整合另行對帳，W4／W5與後續／待釐清能力仍未實作。

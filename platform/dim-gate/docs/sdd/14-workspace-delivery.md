# 14 — 三工作區交付、遷移與驗收

版本：WS-SDD revision 1 · 狀態：設計範圍已定義；W1–W5 全部尚未實作／驗證。本文定義新驗收 ID，不修改已 ACCEPTED 的 M0–M5。

## 1. 增量與依賴

先交付能被使用者辨識的工作區，再以同一條服務／資源流程深入；不一次生成能力地圖所有頁面。不承諾日期，不把設計合併視為產品驗收。

| 增量 | 前置 | 最小可交付行為 | 明確不包含 | Exit AC |
| --- | --- | --- | --- | --- |
| W1 三工作區入口與首頁 | M5 | 明顯的工作區 selector、独立 Demo persona 入口、中心內分組導航、三份依角色組成的首頁；使用既有 domain 資料 | 新 resource kinds、重寫舊流程、live integration | AC-WS-01/02/16/17/18 |
| W2 服務—資源—審批閉環 | W1 | ResourceObject/Binding/WorkItem；Redis binding/resize、Kafka topic create/bind；RD 申請、Ops 審批執行、Admin catalog/schema 支援；K8s readonly summary | 任意 SQL、kubectl、VM power、topic delete、MySQL provisioning | AC-WS-03～09/15～18 |
| W3 服務交付與配置 | W2 | PipelineDefinition、版本化 ServiceConfig、同 env 兩版本 TrafficPolicy、有界灰度與失敗保留；prod 審批 | 真 runner、Git webhook、mesh/gateway executor、任意 script | AC-WS-10/11/15～18 |
| W4 監控與告警控制 | W2；W3 若驗證發布關聯主線 | MonitorPolicy/AlertRule/SLO 固定 schema、Ops 告警控制面、Silence、可查模擬通知；沿用 incident 因果鏈 | 真 collector、任意 query DSL、on-call/SLA、自動 remediation | AC-WS-12/15～18 |
| W5 平台治理深化 | W2；W4 用於通知驗收 | Mock user/team lifecycle、平台 feature cohort、registered adapter routes、通知配置與脫敏投遞、registry 診斷 | SSO/SCIM/PAM、平台 code deploy、真訊息投遞、任意插件 | AC-WS-13～18 |

W2 包含自身依賴的 Admin catalog/schema 擴充，不能等 W5 才補；W3/W4 也須在各自增量內完成必要的版本／批准契約。W4 的固定安全 channel 配置可以先 seed，W5 才開完整配置 UI。每個增量的「完整」只指該列能力，不指整個 K8s／Redis／Kafka／SRE 產品完成。

W1 為建議的第一個實作 task；完成本輪 SDD 不自動啟動 W1。下一次開發依 DEVELOPMENT_PROMPT 核對最新 PLAN，再建立有 owner 的 task 與 integration contract。

## 2. 基線差異與遷移

| 既有基線 | 目標增量與遷移規則 |
| --- | --- |
| 共用 CenterOverview、persona selector、依 centers 合併導航 | W1 在 shared Shell 增 activeWorkspace 與角色 home projection；沿用 session/user/grants，保留目前已公開 route。新增多 grant persona 案例，測 workspace switch 不切 user。 |
| Application／Environment／CI／Placement／Relation | W2 沿用 IDs；新增 ResourceObject/Binding，不用另建 Service 或 RD/Ops resource copies。legacy Placement 仍可讀，不虛構 access grant。 |
| Request/ProvisionJob、Release approval | WorkItem 只作 projection；對既有類型 dispatch 原 command；新 ChangeRequest 有獨立 kind/schema/state owner，不重寫舊狀態。 |
| Catalog template 僅 compute | W2 加 discriminated template variants，舊 revision/snapshot 保持 compute 合法；每類 required fields 在版本化 schema 中固定。不可在 attributes 中藏可執行 template。 |
| ResourcePool capacity 僅 CPU/memory | W2 增具單位的 per-resource quota ledger；Redis quotaMiB、Kafka topic/partition quota 與 CPU/memory 分開。observed usage 是量測，不由 reserved quota 偽造。 |
| 單環境 Release lock／activeReleaseId | W3 固定 config/traffic/release 的互斥與 revision guards；每個 target 一次 execution。TrafficPolicy 引用兩個已成功、artifact 仍存在的同 env releases；activeReleaseId 保持「已驗證部署」語義，頁面另明示實際期望流量權重。不把流量比例當成 Release 成功證據。 |
| 固定觀測 scenario、Incident／notifications projection | W4 增 ruleRevision 與 evaluation lineage，保留舊 incident 與證據；silence/delivery 不改健康狀態。 |
| 固定 users、org tree readonly | W5 加 demo-only create/team update；既有 userId/assignment/audit 保留，不把新增 User 自動作為登入。 |

schemaVersion、seedVersion 與 config revision 各有目的。新 store reader 必須辨識舊快照：W1 無 domain schema 變更時沿用；W2/W3/W4/W5 若改 snapshot，實作前明定 versioned migration。能無歧義轉換則驗證後原子另存，保留原 bytes 到轉換成功；不能轉換則明示版本不相容，提供原 bytes 保留與使用者明確選擇的 reset／memory session，禁止靜默清除。重試不得重建同一 Binding/Object；不能把既有 v0.1 session 驗收當作新 schema 已通過。

新的第一份 integration contract 必須列出 affected 01–07 sections、Zod/DTO/OpenAPI operations、route keys、policy actions、selectors、seed IDs、fault scenarios、snapshot compatibility、owner 與測試。shared schema/router/manifest/CI 指定單一 owner；產品增量的最終 gate 仍需獨立唯讀 review。

## 3. 驗收矩陣（新 AC 的唯一來源）

| ID | 需求 | Given / When / Then | 證據層 |
| --- | --- | --- | --- |
| AC-WS-01 | REQ-WS-01 | Given 單 grant／多 grant／無 grant 使用者，When 進站及切工作區，Then 名稱明顯、只列合法入口、sidebar 只屬 active workspace；切 workspace 不改 userId，Demo persona 切換明確獨立 | domain + browser + keyboard |
| AC-WS-02 | REQ-WS-01/06 | Given 三種角色首頁及 scope 篩選，When 從待辦／卡片下鑽、切 scope、返回，Then 顯示角色相關資料、同一 scope/filters、合法筆數與 dataAsOf；沒有樣本不補0、不閃現前身分資料 | contract + browser |
| AC-WS-03 | REQ-WS-02/03/04 | Given 兩服務共用 Redis/queue，When RD 與 Ops 看 Binding/Object/CI，Then canonical IDs 一致、每種物理容量只算一次、同 CI 多 object 不重複 Placement；RD 看不到另一服務及 object | domain + browser |
| AC-WS-04 | REQ-WS-03/05 | Given RD 選服務環境提出 Redis 綁定，When 另一 Ops 批准且執行成功，Then RD/Ops 同 sourceId、snapshot、execution、bindingId 與 correlation；批准未執行時不顯示 ready | UI end-to-end |
| AC-WS-05 | REQ-WS-04/05 | Given Kafka cluster 及合法 catalog，When 建 topic/bind 並重放同 key，Then 只一個 topic/object/binding；同 cluster 同 namespace 同名衝突409，不同 cluster 可同名不同 ID | domain + contract + browser |
| AC-WS-06 | REQ-WS-02/04/05 | Given 兩單競爭最後 quota，When 並行批准與執行／取消，Then 原子 reservation、不負容量、無重複執行；quota 與 observed usage 分開 | domain race + contract |
| AC-WS-07 | REQ-WS-03/05/09 | Given stale version、disabled catalog、撤權、execution failure，When submit/approve/execute/retry，Then 明確拒絕、snapshot/歷史保留、active 不變、無幽靈 Binding、重試用合法新決策 | domain + browser |
| AC-WS-08 | REQ-WS-04/06 | Given 同人多角色、只有 pool 或只有 project grant、Admin，When 申請自批／共享維護／部署，Then 自批拒絕、交集不足拒絕、Admin 無業務執行權；第二位具足夠 scope Ops 可批准 | policy + direct API + browser |
| AC-WS-09 | REQ-WS-02/04/10 | Given 該增量已開放的 cluster/network/database 唯讀面板，When 跨 CMDB/專業頁／服務下鑽，Then 同 CI ID、scope 和 freshness；未實作操作無假按鈕，K8s summary 不聲稱控制叢集 | browser + content inspection |
| AC-WS-10 | REQ-WS-03/07 | Given PipelineDefinition／ServiceConfig draft，When 修改、驗證、生效／失敗／回復，Then 舊 run/config snapshot 不變、prod 需獨立批准、失敗維持 active、secret 僅 reference | domain + browser |
| AC-WS-11 | REQ-WS-07 | Given 同 env 兩個合格 releases，When 10/50/100 灰度與缺樣本／異常／權重不合法，Then 經健康窗口才推進、異常保留上一權重、跨 env target 被拒、release/config/traffic 衝突受鎖保護 | deterministic domain + UI flow |
| AC-WS-12 | REQ-WS-03/04/08 | Given 服務與基礎設施規則、Silence 及固定 samples，When 改規則／觸發／抑制／到期／恢复，Then ruleRevision 可追、無重複 incident、抑制不刪證據或直接 resolved、Ops/RD 寫權分離 | domain + browser |
| AC-WS-13 | REQ-WS-06 | Given Admin 改 menu、template、demo user/team/grant，When RD 重新讀取或舊 dialog 提交，Then menu 不賦權、舊 template snapshot 不變、team 不授權、policy 生效；self/last-admin 防護成立 | contract + browser |
| AC-WS-14 | REQ-WS-06/08 | Given platform feature/route/channel，When cohort 調整、refresh、停用、錯誤路由、重試投遞及撤權，Then cohort 穩定且不提升權限、recovery 可達、無任意外部請求、通知依收件 scope 脫敏去重、舊私有 payload 不重播 | domain + browser network |
| AC-WS-15 | REQ-WS-02/05/06/08 | Given scope 外 app/object、其他專案共享依賴及舊身分 response，When list/detail/search/aggregate/audit/notification/graph，Then 不暴露名稱、總數、原始內容或 stale cache；detail404、action403 | policy + contract + browser race |
| AC-WS-16 | REQ-WS-09 | Given v0.1 舊 session、進行中 execution、corrupt/quota-limited store，When 升級／刷新／reset，Then 不靜默丟棄、無半筆寫入、原 bytes 可保留、無幽靈執行；v0.1 主線依然通過 | persistence + regression |
| AC-WS-17 | REQ-WS-01/09 | Given 新增頁面與所有主要 dialog，When keyboard-only、明暗 axe、1440/768/390、deep refresh 和跨 browser smoke，Then 沿用既有可用性／scope／base-path 契約；效能依 05/AC-27 預算量測 | browser + benchmark |
| AC-WS-18 | REQ-WS-10 | Given 能力 registry/導航/指南，When 比對 spec/implementation/evidence，Then 未實作能力明確標示、無假成功或品牌整合宣稱、需求有測試 refs；Mock 常駐標記、無 real cloud/外部訊息 side effects | docs + browser network + review |

## 4. 代表性故事與測試資料

1. **W1 角色辨識**：新訪客從顯眼 Demo 入口體驗三角色首頁，再以多 grant 的同一 user 切工作區，確認沒有偷換身分。這是新增瀏覽器測試，不能只靠 v0.1 persona smoke 宣稱達標。
2. **W2 共用 Redis**：Commerce RD 提出 staging allocation → Ops 核對共享容量並批准 → execution 成功 → RD 資源頁與 Ops Redis detail 指向同 Binding；Data RD 無法讀此 Binding；Admin 只能管理模板、無法執行。
3. **W2 Kafka**：以同一 cluster 下已存在 topic、同名不同 cluster、容量不足、兩單競爭及執行失敗驗證唯一性與 reservation；原始失敗單、decision、attempt 全保留。
4. **W3/W4 服務運行**：建立新 definition/config revision → prod approval → rollout/traffic health → 異常 rule evaluation → Ops 調查／受控恢復 → RD 查看證據。規則、流量、Release 與 Incident 的狀態各自可查，不能手點「完成」。
5. **W5 平台治理**：調整 menu/feature cohort/adapter route → 確認權限不變、未完成工作仍可追 → 固定通知失敗與重試 → 撤權後舊資料與通知不外洩。

fixture 沿用原60 CI及三 provider regression，新增 deterministic ResourceObjects、兩服務共享關聯、多 grant user、第二 Ops、無 grant user、config/rule revisions。新增 case 的 IDs 另加 prefix，不改已引用的 v0.1 IDs；demo-only user 與 endpoint 都是虛構。支援矩陣不要求每個 Mock 能力假裝在三 provider 都有相同規格；不支援時先拒絕。

## 5. 證據與交付要求

每個產品增量：focused domain/contract tests → clean build → 真 UI happy path + 有代表性的拒絕／失敗 → 受影響的 v0.1 regression → 原生 lint/typecheck/test/docs/contracts/CI/architecture → 相應效能及 browser gates → 未參與實作的固定 commit review。gate 命令依 [07](07-delivery-validation.md) 與當期 task；不為純文件修改重跑所有本地瀏覽器測試，但既有 PR required CI 仍須通過。

文件交付只驗證連結、需求/AC映射、內部一致性、範圍與 Git diff；不算 AC-WS 產品驗收。PLAN 保存 task/owner/decision；STATUS 明確分開「已定義／已實作／已驗證」，來源版本、review、CI 與合併狀態各自記錄。任何真實 adapter、雲端、SSO、網路執行、外部通知或部署另立 integration 工作，不因合併本 SDD 而啟用。

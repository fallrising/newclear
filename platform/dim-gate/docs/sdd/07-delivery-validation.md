# 07 — 分階段交付與驗收

## 1. 交付原則

以下里程碑是交付契約，進度由[主控計畫](../../../../.team/PLAN.md)及[STATUS摘要](../STATUS.md)呈現；不在SDD維護每次run的狀態。以依賴與可觀察成果排程，不承諾日期。每一階段只合併能獨立驗收的增量；不可用預先標記成功的靜態頁面替代 state transition。

需求定義在 [01](01-product-ux.md)，domain invariants 在 [總綱](../../SDD.md)。測試不能只是重新抄 handler；應驗證跨頁結果、拒絕情況、原子性與歷史保留。

## 2. 開發里程碑

| Milestone | 依賴 | 工作與交付 | Exit gate |
| --- | --- | --- | --- |
| M0 — 可運行的基礎 | SDD 基線 | Vite/React/TS、shadcn/Tailwind、版本鎖定、三中心 Shell、persona 與 demo banner、domain/DTO schemas、MSW、session store、reset、docs checks、root CI | AC-01、AC-02、AC-03；clean install/lint/typecheck/test/build；只建立 domain/contract 所需資料，不假裝業務已完成 |
| M1 — CMDB 與應用視圖 | M0 | 60 CI seed、app/env、三來源表格、detail、手動納管與 metadata、relations、bounded topology、scope guards、search | AC-04～AC-08、AC-20；三中心以同 ID 下鑽；尚未完成的導航不顯示為可用 |
| M2 — 自助申請與治理 | M1 | catalog revisions、wizard、Ops approval/provision/retry、capacity、jobs、roles/scopes、navigation、custom fields、audit | AC-09～AC-12、AC-21～AC-23；三來源交付與失敗分支 |
| M3 — CI/CD 與回滾 | M2 | pipeline/stages/logs、artifact/release、prod approval、健康檢查、rollback、同環境鎖 | AC-13～AC-16、AC-24；stable → next → rollback 因果鏈 |
| M4 — 可觀測性與完整故事 | M3 | RED metrics、trace/log correlation、incident lifecycle、impact links、integration metadata、guide scenarios、notifications | AC-17～AC-19、AC-25；角色切換完成演示，全鏈路 audit |
| M5 — 展示驗收與交付 | M4 | 錯誤/空/stale UX、鍵盤與 axe、效能量測、base-path smoke、reload/resume、錄製或截圖證據、使用說明 | AC-26～AC-30 與全部 regression；可按腳本重演，沒有標為可用卻無行為的按鈕 |

每個 milestone 可拆 PR，但不可為趕頁面進度推遲相應資料契約／scope 驗證。M0 的 skeleton 不等於平台 v0.1；只有 M5 全 gates 通過才標示「可展示的 v0.1」。

## 3. 驗收矩陣

| ID | 對應需求／不變量 | Given / When / Then | 層級 |
| --- | --- | --- | --- |
| AC-01 | REQ-01/10、INV-07 | Given clean checkout，When frozen install + production build，Then 可開 Shell、三中心按 persona 顯示、DemoBanner 常駐、無外部雲依賴 | build + browser |
| AC-02 | REQ-09、INV-08 | Given 進行中的 session，When 切中心／persona／刷新，Then 合法 domain 狀態保留；When reset，Then seed/counters/cache/timers 全復原，舊 response 不回寫 | domain + browser |
| AC-03 | REQ-08/10、INV-02/03 | Given 已提交 command，When 同 key/body 重放，Then 同 receipt 無重複 side effects；body 不同回409；撤權後重放回403/404；未提交錯誤不改 domain version | domain + contract |
| AC-04 | REQ-02、INV-01/05 | Given 60 baseline CI，When provider 篩選，Then AWS/Aliyun/onprem 各20；When 手動納管，Then總數與該來源+1，detail 顯示合法 provider 欄位 | browser |
| AC-05 | REQ-02、INV-05 | Given 同 canonical key，When 另一個名稱再次納管，Then409；缺 account/site 或位置與 provider 不符回422；CI metadata 修改不改 identity | domain + form |
| AC-06 | REQ-02、INV-01/05 | Given shared Redis 被兩個環境引用，When 看 app/CI/graph，Then 同一 CI ID、多個 placements；容量只計一次 | domain + browser |
| AC-07 | REQ-02/10、INV-05/06 | Given 有 cycle、大圖與隱藏節點，When impact BFS，Then 終止、3 hops/100nodes/200edges 上限、truncation 可見、hidden 節點及數量不洩漏 | domain + browser |
| AC-08 | REQ-02/10 | Given stale/unknown CI 或0結果，When filter/detail，Then 分別顯示 freshness／health／empty，不用0冒充 unknown | component + browser |
| AC-09 | REQ-03/06、INV-01/03 | Given RD 草稿，When 提交→另一 persona Ops 批准→交付，Then 同 requestId，env ready、CI/placement/job/audit 同步，容量 reservation 轉 used | browser；三 provider 参数化 |
| AC-10 | REQ-03/06、INV-02/03 | Given submitted request，When 拒絕或 requester 撤回，Then 不建立環境；approved 撤回釋放 reservation；無效 transition409且狀態不變 | domain + browser |
| AC-11 | REQ-06、INV-03 | Given 兩張競爭剩餘容量的請求，When 依序進 atomic approve queue，Then 只允許足量的批准；不足回409，available 不為負 | domain property |
| AC-12 | REQ-03/06、INV-03 | Given provision-failure，When job 失敗後 retry，Then reservation 釋放／重建、attempt+1、同環境 ID，最終僅一組 active CI/placement | domain + browser |
| AC-13 | REQ-04、INV-04 | Given ready staging，When pipeline 成功，Then build/test/package/deploy/verify 可查，artifact 有 digest、release succeeded 才更新 activeReleaseId | browser |
| AC-14 | REQ-04、INV-04 | Given build-failure 或 health-failure，When 執行，Then build failure 無 release、health failure 有 failed release；兩者不改原 active；retry 建新 run | domain + browser |
| AC-15 | REQ-04/07、INV-02 | Given prod release，When initiator 自批或 Admin 直接部署，Then403；When 不同且有 scope Ops 批准，Then部署繼續並記兩個 actor | contract + browser |
| AC-16 | REQ-04、INV-03/04 | Given 一個操作佔環境鎖，When 再 trigger/rollback，Then409；終態釋放鎖；pre-deploy cancel 可終止，deploy中cancel409 | domain + browser |
| AC-17 | REQ-05、INV-01 | Given post-release-latency，When 查看 metrics→trace→log→incident→release，Then app/env/IDs/time window 相符，單位正確，無sample不補0 | contract + browser |
| AC-18 | REQ-05、INV-01 | Given incident，When Ops acknowledge/investigate，Then assignee/狀態/稽核更新；RD 寫入被拒；同 rule 重複異常不重複建 incident | domain + browser |
| AC-19 | REQ-04/05、INV-04 | Given 問題 release 的 incident，When 回滾健康成功，Then active 指向新 rollback release；第3筆連續恢復樣本才 resolved；歷史異常保留 | browser |
| AC-20 | REQ-07、INV-06 | Given RD Commerce，When 讀 Data 的列表/detail/search/graph/aggregate/audit，Then無資料或404；角色切換和在途舊 response 不閃現跨 scope 資料 | contract + browser |
| AC-21 | REQ-07、INV-02/06 | Given Admin 撤銷另一使用者的 project grant，When 該使用者舊 dialog 提交，Then handler拒絕；self/last Admin 變更被拒；policyVersion更新 | contract + browser |
| AC-22 | REQ-07 | Given menu reorder/disable，When 保存，Then導航即時反映且 permission不變；非法 routeKey與停用 recovery entry 被拒 | component + browser |
| AC-23 | REQ-03/07 | Given published catalog已有申請，When發布新revision或停用，Then已提交請求維持snapshot、新草稿看新規格／不可申請；custom field不可改核心身分或既有型別 | domain + browser |
| AC-24 | REQ-04、INV-04 | Given無合格回滾target或rollback-failure，When發起操作，Then前者不允許、後者active保持原值且incident持續；不能回滾到別的環境 | domain + browser |
| AC-25 | REQ-08/09、INV-01/07 | Given主腳本，When演示者由guide完成，Then每步由domain selectors判定，不是手點完成；完整因果鏈可查，模擬整合測試明示demo | browser +人工 |
| AC-26 | REQ-10 | Given keyboard only與axe，When主線、dialog、forms、topology替代列表，Then可操作、focus正確、無serious/critical；明暗主題可辨狀態 | axe +人工 |
| AC-27 | REQ-10 | Given [05 的量測條件](05-frontend-architecture.md)，When效能腳本執行，Then回報shell gzip/LCP/query/mutation數據並符合預算；不以一次最快結果報告 | benchmark |
| AC-28 | REQ-09/10、INV-08 | Given 進行中job，When刷新、storage寫入失敗、snapshot損壞或超過command上限，Then無幽靈job／半筆domain寫入，可讀錯誤與重置入口 | domain + browser |
| AC-29 | REQ-01/10 | Given production demo build部署在 `/dim-gate/`，When深連結刷新、MSW載入與另一app請求，Then前者可用、worker只控制此app，另一app不被攔截；live mode不暗中fallback | browser smoke |
| AC-30 | REQ-01～10 | Given乾淨session，When依guide分別選AWS/Aliyun/IDC完成主線，Then均成功；最終交付附commit、測試輸出、主要頁面截圖／錄影與已知限制 | release checklist |

## 4. 測試分層與證據

Domain：以 table-driven transition tests 和 invariants 檢查容量、ID、scope、version、冪等、locks；用 fake clock，不用實際 sleep。至少涵蓋一個 stale version race、一個 double submit、一個失敗重試與一個授權撤銷。

Contract：MSW browser handlers 與 Node handlers 引用同 domain engine／schemas；固定 JSON examples 經 schema 驗證。不得只有 mock snapshot 截圖而沒有 API/state assertion。

Component：測使用者可讀結果、表單 validation、disabled reason、dialog focus；不要把 shadcn 的內部 DOM class 作主要断言。

E2E：真實 UI 點擊 persona switch、表單、審批、pipeline、rollback。允許 demo scenario endpoint 加速時鐘／注入故障，不允許直接設定 request fulfilled 或 incident resolved 來跳過被測流程。主要主線 Chromium，M5 加 Firefox／WebKit shell與主線 smoke；環境不支持時明示未驗，不寫成已通過。

每個階段依[開發恢復協定](../DEVELOPMENT_PROTOCOL.md)，在task/report及PLAN保存commit/PR、被測版本、執行命令、結果與接受決策；STATUS只附摘要、連結與未覆蓋項。截圖／trace/video 放 CI artifacts 或 PR attachments，不大量提交二進位到 repo。規劃中的 `pnpm check:docs` 檢查本component及其引用的dim-gate ledger文件連結，不掃描修復整個 monorepo。

## 5. 歷史 M0 起始任務（保留基線）

M0–M5 現已驗收；以下保留最初起始契約，不是目前進度。後續角色深化的交付與新 AC 見 [14](14-workspace-delivery.md)，目前狀態先核對 PLAN。

第一個 implementation PR 執行 M0：讀總綱與本章 → 選定相容版本并鎖定 → 建立 schema/seed/controller 最小閉環 → 完成shell、persona switch、reset → 建立native scripts與root path-scoped CI → 提交AC-01～03證據。M0允許使用最小seed，完整60 CI在M1補齊；schema身分／scope/版控不可延後。

M0不應一口氣生成所有module的空白頁，也不需要登入雲帳戶。能展示的是「基礎與資料契約已跑通」；後續M1–M4逐步把導航與流程開放。

## 6. 未來真實整合的獨立 gate

需要另立 backend/integration SDD：server session/SSO、source reconciliation與credentials、durable jobs、external idempotency、雲商partial failure、multi-user concurrency、telemetry query adapters、production auditing。選定至少一個真實測試環境、驗證read-only inventory，再導入受控write path。前端v0.1的完成不代表此gate已完成。

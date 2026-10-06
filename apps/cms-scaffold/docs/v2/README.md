# CMS Scaffold v2

狀態：**BW0／W0 已實作；其餘波次依下表區分施工圖與實作狀態**。Owner 於 2026-09-25 決定重啟本專案，登記在 [PORTFOLIO.md](../../../../PORTFOLIO.md)。00／01／02 保留架構與決策，BW0～BW5、W0～W5 已細化成 `waves/` 施工圖；BW6已完成施工圖（本波文件PR合併生效），W6仍為DRAFT；實作者依路線圖逐波施工，不從框架文件自行補設計。

| 文件 | 內容 |
| --- | --- |
| [00 — v1 前端稽核](00-v1-frontend-audit.md) | v1 前端的問題清單（編號、嚴重度、證據），以及做對、要保留的部分 |
| [01 — 前端 v2 SDD](01-frontend-sdd.md) | 架構、Shopify 參考對照、tokens、元件、三個操作面的畫面、後端缺口、驗收、前端波次 |
| [02 — 後端 v2 SDD](02-backend-sdd.md) | 後端現況問題、決策、資料表變更、API 變更、品質閘門、後端波次 |
| [REFINE-PROMPT](REFINE-PROMPT.md) | 把一個波次細化成施工圖的 prompt（給 LLM agent） |
| `waves/<波次>.md` | 各波次的施工圖；後端 [BW0](waves/BW0.md)～[BW5](waves/BW5.md) 與前端 [W0](waves/W0.md)～[W5](waves/W5.md)（含 [W3b](waves/W3b.md)）均已完成細化 |
| `contracts/` | 施工圖的契約：OpenAPI 片段 `<波次>.openapi.yaml`、測試 fixture 規格 |
| [perf-records.md](perf-records.md) | 02 §5.4 後端效能目標的量測紀錄（預演與實作的數字） |
| [frontend-records.md](frontend-records.md) | W5 前端 bundle、Web Vitals、mock e2e、視覺基準與真實 API e2e 的追加式紀錄 |

與既有文件的關係：[總綱](../sdd/00-overview.md) 凍結、不改；[surface 與 kernel 規格](../specs/) 仍是路由、權限、領域規則的權威；v2 文件補架構、畫面、API 演進與交付方式。

## 本次個人使用補強（2026-10-03）

目前工程來源為 `newclear/apps/cms-scaffold`；封存的獨立倉庫不再代表最新進度。[P0 資料可靠性](waves/P0.md) 已合併；BW1a／BW1b／BW1c 已依序合併（PR #223／#224／#225），W1 已於 PR #229 合併，BW2 已於 PR #235 通過完整 CI 並合併；另見 [個人使用驗收與介面參考](03-personal-use-readiness.md)。W2已於PR #245通過完整CI並合併，395前端／39 mock E2E通過；[發布證據](../../.team/reports/W2-PUBLICATION.md)。BW3會員API已於PR #252通過CI並合併，279 Java／125 PostgreSQL／395前端／39 mock E2E通過；[交付證據](../../.team/reports/BW3-DELIVERY.md)。BW4已通過本地293 Java／133 PostgreSQL／395前端／39 mock E2E及三次效能量測，已於 PR #258 通過遠端 CI 並合併；[交付證據](../../.team/reports/BW4-DELIVERY.md)。P0 文件先定義範圍後開始實作，不把尚未實作的模型管理／能力導覽列為現成功能。

## 已定案的方向

- **Shopify 只借模式、不借套件**：Back／Admin 用 Shopify admin（Polaris）的版型與互動，Front 用 Shopify 商店主題的版面語言；元件庫仍是總綱凍結的 shadcn/ui + Tailwind。
- **後端增量演進**：同一個 `cms-api`、同一個 `/api/v1`，補分頁、能力查詢、欄位中繼資料、完整 OpenAPI schema、審計、會員端點；kernel 不再寫死 demo 欄位名。
- **前端開發不依賴後端啟動**：MSW mock，回應型別由 OpenAPI 產生。
- v2 不做：Front prerender、作業面深色模式、批次操作、token 預覽、Polaris 套件。

Back／Admin 新增 [shadcn-admin 參考對照](03-personal-use-readiness.md#介面參考)；使用既有 shadcn/ui 元件與 React Router，不搬入模板的身份或路由系統。

## 路線圖

一波一個 PR。箭頭表示「必須先合併」。

```
BW0 契約與品質基礎（完整 OpenAPI schema、store 契約測試、CI integrationTest）
 ├─► W0 前端基礎（packages、tokens、codegen、MSW、新殼）
 └─► BW1a 類型設定與欄位中繼資料（titleField、capabilities）
        └─► BW1b 列表查詢下推（分頁／篩選、predicate、索引）
               └─► BW1c 驗證與破壞性變更（error.fields、428、媒體 null）
        （BW1a＋BW1b＋BW1c 都合併後）
        └─► W1 Back 核心（index、details、欄位 widget、發布動作）
               ├─► BW2（batch-patch、include=refs、請求發布、可指派使用者、審計）
               │     ├─► W2 Back 媒體與自訂視圖
               │     └─► W4 Admin
               └─► W3 Front 公開面（不需要 BW2；需要 BW1b、BW1c）
                      └─► BW3 會員端點 ─► W3b Front 會員區
W5 前端硬化、BW4 後端硬化：所有功能波之後
BW5 開放問題收尾（BQ-06／07／08／10／11）：以 BW4 為基準；會改錯誤代碼，
    所以建議後端 BW0～BW5 先依序實作完；W3、W4、W3b、W5 直接以 BW5
    契約為準，W2 依 01 Q-16 在整合階段套用 BW5 的媒體錯誤代碼
BW6 前端缺口收尾（01 Q-12／14／17／20／23／24／25／26，owner 2026-10-03 選 A）：
    以 BW5 為基準 ─► W6 後端缺口補畫面（以 W5 的結果為起點）
```

| 波 | 狀態 | 框架 | 施工圖 | 解決 |
| --- | --- | --- | --- | --- |
| P0 | VERIFIED（PR #212） | [個人使用驗收](03-personal-use-readiness.md) | [waves/P0.md](waves/P0.md) | 資料交易、原子版本檢查、表單值安全 |
| BW0 | VERIFIED | [02 §7](02-backend-sdd.md#7-後端波次) | [waves/BW0.md](waves/BW0.md) | B-01、B-08、B-14、B-15 |
| W0 | VERIFIED | [01 §12](01-frontend-sdd.md#12-實作波次給-llm-agent) | [waves/W0.md](waves/W0.md) | F-01～F-05、S-01～S-03、C-16～C-18、E-01～E-04 |
| BW1a | VERIFIED（PR #223） | [02 §7](02-backend-sdd.md#7-後端波次) | [waves/BW1a.md](waves/BW1a.md) | B-03、B-04、B-05、B-12；G-01、G-05、G-06、G-11 |
| BW1b | VERIFIED（PR #224） | [02 §7](02-backend-sdd.md#7-後端波次) | [waves/BW1b.md](waves/BW1b.md) | B-02、B-09、B-10；G-02 |
| BW1c | VERIFIED（PR #225） | [02 §7](02-backend-sdd.md#7-後端波次) | [waves/BW1c.md](waves/BW1c.md) | B-06、B-13；G-07 |
| W1 | VERIFIED（PR #229） | [01 §12](01-frontend-sdd.md#12-實作波次給-llm-agent) | [waves/W1.md](waves/W1.md) | C-04～C-07、U-01、U-02、U-04 |
| BW2 | VERIFIED（PR #235） | [02 §7](02-backend-sdd.md#7-後端波次) | [waves/BW2.md](waves/BW2.md) | B-07、B-11（部分）；G-03、G-04、G-09、G-10 |
| W2 | VERIFIED（PR #245） | [01 §12](01-frontend-sdd.md#12-實作波次給-llm-agent) | [waves/W2.md](waves/W2.md) | C-08～C-10、U-03 |
| W3 | VERIFIED（PR #273） | [01 §12](01-frontend-sdd.md#12-實作波次給-llm-agent) | [waves/W3.md](waves/W3.md) | C-01～C-03、C-11、C-13、C-14、U-05 |
| W4 | VERIFIED（PR #289） | [01 §12](01-frontend-sdd.md#12-實作波次給-llm-agent) | [waves/W4.md](waves/W4.md) | C-19 |
| BW3 | VERIFIED（PR #252） | [02 §4.5](02-backend-sdd.md#45-會員g-08)、[§7](02-backend-sdd.md#7-後端波次) | [waves/BW3.md](waves/BW3.md) | B-11；G-08 |
| W3b | VERIFIED（PR #281） | [01 §7.1](01-frontend-sdd.md#71-frontappsweb-front)、[§12](01-frontend-sdd.md#12-實作波次給-llm-agent) | [waves/W3b.md](waves/W3b.md) | G-08、C-11；surface-front AC-10～13 |
| W5 | VERIFIED（PR #300 合併生效） | [01 §10](01-frontend-sdd.md#10-非功能需求)、[§12](01-frontend-sdd.md#12-實作波次給-llm-agent) | [waves/W5.md](waves/W5.md) | 剩餘 P2、效能、V2-AC-01～16 總驗收 |
| BW4 | VERIFIED（PR #258） | [02 §5.4](02-backend-sdd.md#54-效能目標本機postgresql-16單類型-10000-筆)、[§7](02-backend-sdd.md#7-後端波次) | [waves/BW4.md](waves/BW4.md) | 效能紀錄、審計保留、surface 拒絕矩陣 |
| BW5 | VERIFIED（PR #267） | [02 §7](02-backend-sdd.md#7-後端波次)、[§8](02-backend-sdd.md#8-開放問題) | [waves/BW5.md](waves/BW5.md) | BQ-06、07、08、10、11（owner 2026-09-25 選 A） |
| BW6 | DOC_READY（本波文件PR合併生效） | [02 §7](02-backend-sdd.md#7-後端波次) | [waves/BW6.md](waves/BW6.md) | 01 Q-12、Q-14、Q-17、Q-20、Q-23～Q-26（後端部分） |
| W6 | DRAFT | [01 §12](01-frontend-sdd.md#12-實作波次給-llm-agent)、[§13](01-frontend-sdd.md#13-開放問題與已知衝突) | — | 01 Q-14、Q-17、Q-20、Q-23～Q-26（前端部分） |

本地交付另用 `LOCAL_VERIFIED`：整合檢查已通過，但未提交／合併，不能等同正式 `VERIFIED`。

狀態：`DRAFT`（只有框架）→ `DOC_READY`（施工圖已合併）→ `IN_PROGRESS` → `VERIFIED`（實作已合併並通過交付檢查表）。

## 細化

BW0～BW5、W0～W5 的細化已完成；BW6已完成本波細化；W6尚待細化。若施工時發現新矛盾，需要重開某一波的施工圖，**一個波次開一個新窗口**，把 [REFINE-PROMPT.md](REFINE-PROMPT.md) 的網址交給 agent，說「讀這個檔案，照做。本次細化：<波次>」。Agent 只修改該波的 `waves/<波次>.md`、契約／fixture 與必要的框架連結；一波仍只進一個 PR。

施工圖的標準：能力較弱的 agent 只讀施工圖就能實作，不需要做任何設計決定。細化時若發現框架本身有矛盾，agent 會新增開放問題並停下來問。

某個波次到 `DOC_READY` 後，就可以開始實作該波次；不必等全部細化完。

## v1 截圖（2026-09-24，headless Chromium，接仿種子資料的 mock API）

| 截圖 | 說明 |
| --- | --- |
| [front-album-detail.png](assets/v1/front-album-detail.png) | Front 相片牆；頁標題只有 16px（稽核 F-01） |
| [front-album-detail-mobile.png](assets/v1/front-album-detail-mobile.png) | 同頁手機版，沒有手機選單（U-03） |
| [front-photo.png](assets/v1/front-photo.png) | 單張相片頁把 320px 縮圖放大顯示（C-01） |
| [front-projects-loading.png](assets/v1/front-projects-loading.png) | 載入中先顯示「還沒有公開專案」（C-02） |
| [back-editor.png](assets/v1/back-editor.png) | 通用編輯器：全是文字框、UUID 外露、按鈕不看狀態（C-05、C-06、U-01） |
| [back-list-clinic-profile.png](assets/v1/back-list-clinic-profile.png) | 標題欄位不叫 `title` 的類型只顯示 slug（C-12） |
| [back-board.png](assets/v1/back-board.png) | 看板：卡片沒有內距、工程術語（F-01、U-01） |
| [back-board-mobile.png](assets/v1/back-board-mobile.png) | 手機版導覽折成三行（U-03） |
| [admin-types.png](assets/v1/admin-types.png) | Admin 類型列表：Card 與 Button 樣式都沒生成（F-01） |

BW5 已通過 339 Java／140 PostgreSQL／395 前端／39 mock E2E、三次萬筆量測與獨立審查；[交付證據](../../.team/reports/BW5-DELIVERY.md)。已於 PR #267 通過必要 CI 並合併；[發布證據](../../.team/reports/BW5-PUBLICATION.md)。尚未部署。W3 Front 公開面已完成。

W3 公開頁已通過本地 339 Java／473 前端／60 mock E2E，15 份 responsive 畫面及必要 CI，於 PR #273 合併；直接 Markdown 依賴已授權並通過乾淨安裝。[交付證據](../../.team/reports/W3-DELIVERY.md) 為提交前檢查點，[發布收據](../../.team/reports/W3-PUBLICATION.md) 關閉狀態。沒有部署。

W3 已於 PR #273 通過必要 CI 並合併；[發布證據](../../.team/reports/W3-PUBLICATION.md)。W3b 會員區已通過本地 546 前端／68 mock E2E、339 Java 快取結果、20 張響應式畫面及獨立審查；依施工圖 §0 保留 W3 / BW5 成果，已於 PR #281 通過必要 CI 並合併。[交付證據](../../.team/reports/W3b-DELIVERY.md) 為歷史本地檢查點；[發布證據](../../.team/reports/W3b-PUBLICATION.md) 關閉狀態。

W4 共用 Admin 治理已完成本地驗收：624 前端／68 mock E2E、339 Java 快取結果、14 張桌面／手機擷取與來源保留核對；已於 PR #289 通過必要遠端 CI 並合併；[發布證據](../../.team/reports/W4-PUBLICATION.md)。[交付證據](../../.team/reports/W4-DELIVERY.md)。W4 附錄新 E2E 與完整前端硬化仍在 W5，不代表整個 v2 已完成。

W5 前端硬化已完成本地验收：648前端、93mock連續三次、25Vitals、60axe、11hardening與70canonical比較通過；批准G後真實API最終14/14與四次ownedcleanup核對完成，歷史失敗保留。[交付證據](../../.team/reports/W5-DELIVERY.md)及[團隊計畫](../../.team/PLAN.md)列出來源與限制。VERIFIED隨[PR #300](https://github.com/fallrising/newclear/pull/300)通過必要最新head CI／審查並合併生效，發布實況以PR為準。未部署，不宣稱正式生產可用。

下一個功能規劃是BW6/W6：媒體搜尋與分頁、治理資訊及危險操作自身保護、診所demo預約權限；BW6施工細節見[施工圖](waves/BW6.md)，BQ-14 B已於2026-10-06批准；W6仍先依REFINE-PROMPT細化。剩餘實作／驗證卡為BW6 30＋W6暫估22～28＝52～58，口徑見[剩餘工作](bw6-remaining-work.md)。這是通用CMS，診所／相簿／專案均為demo packs；本次交付不擴張新里程碑授權。

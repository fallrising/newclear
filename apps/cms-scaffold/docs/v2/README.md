# CMS Scaffold v2

狀態：**已啟動（設計階段）**。Owner 於 2026-09-25 決定重啟本專案，登記在 [PORTFOLIO.md](../../../../PORTFOLIO.md)。目前三份文件都是 v0.1；接下來每個波次先細化成施工圖（§細化），再交給 agent 實作，從 BW0 開始。

| 文件 | 內容 |
| --- | --- |
| [00 — v1 前端稽核](00-v1-frontend-audit.md) | v1 前端的問題清單（編號、嚴重度、證據），以及做對、要保留的部分 |
| [01 — 前端 v2 SDD](01-frontend-sdd.md) | 架構、Shopify 參考對照、tokens、元件、三個操作面的畫面、後端缺口、驗收、前端波次 |
| [02 — 後端 v2 SDD](02-backend-sdd.md) | 後端現況問題、決策、資料表變更、API 變更、品質閘門、後端波次 |
| [REFINE-PROMPT](REFINE-PROMPT.md) | 把一個波次細化成施工圖的 prompt（給 LLM agent） |
| `waves/<波次>.md` | 各波次的施工圖（細化後產生）；已完成：[BW0](waves/BW0.md)、[W0](waves/W0.md)、[BW1a](waves/BW1a.md)、[BW1b](waves/BW1b.md)、[BW1c](waves/BW1c.md)、[BW2](waves/BW2.md)、[BW3](waves/BW3.md)、[BW4](waves/BW4.md)、[BW5](waves/BW5.md) |
| `contracts/` | 施工圖的契約：OpenAPI 片段 `<波次>.openapi.yaml`、測試 fixture 規格 |
| [perf-records.md](perf-records.md) | 02 §5.4 效能目標的量測紀錄（預演與實作的數字） |

與既有文件的關係：[總綱](../sdd/00-overview.md) 凍結、不改；[surface 與 kernel 規格](../specs/) 仍是路由、權限、領域規則的權威；v2 文件補架構、畫面、API 演進與交付方式。

## 已定案的方向

- **Shopify 只借模式、不借套件**：Back／Admin 用 Shopify admin（Polaris）的版型與互動，Front 用 Shopify 商店主題的版面語言；元件庫仍是總綱凍結的 shadcn/ui + Tailwind。
- **後端增量演進**：同一個 `cms-api`、同一個 `/api/v1`，補分頁、能力查詢、欄位中繼資料、完整 OpenAPI schema、審計、會員端點；kernel 不再寫死 demo 欄位名。
- **前端開發不依賴後端啟動**：MSW mock，回應型別由 OpenAPI 產生。
- v2 不做：Front prerender、作業面深色模式、批次操作、token 預覽、Polaris 套件。

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
    所以建議後端 BW0～BW5 先依序實作完，前端 W2、W4 以 BW5 的契約為準
```

| 波 | 狀態 | 框架 | 施工圖 | 解決 |
| --- | --- | --- | --- | --- |
| BW0 | DOC_READY | [02 §7](02-backend-sdd.md#7-後端波次) | [waves/BW0.md](waves/BW0.md) | B-01、B-08、B-14、B-15 |
| W0 | DOC_READY | [01 §12](01-frontend-sdd.md#12-實作波次給-llm-agent) | [waves/W0.md](waves/W0.md) | F-01～F-05、S-01～S-03、C-16～C-18、E-01～E-04 |
| BW1a | DOC_READY | [02 §7](02-backend-sdd.md#7-後端波次) | [waves/BW1a.md](waves/BW1a.md) | B-03、B-04、B-05、B-12；G-01、G-05、G-06、G-11 |
| BW1b | DOC_READY | [02 §7](02-backend-sdd.md#7-後端波次) | [waves/BW1b.md](waves/BW1b.md) | B-02、B-09、B-10；G-02 |
| BW1c | DOC_READY | [02 §7](02-backend-sdd.md#7-後端波次) | [waves/BW1c.md](waves/BW1c.md) | B-06、B-13；G-07 |
| W1 | DOC_READY | 01 §12 | [waves/W1.md](waves/W1.md) | C-04～C-07、U-01、U-02、U-04 |
| BW2 | DOC_READY | [02 §7](02-backend-sdd.md#7-後端波次) | [waves/BW2.md](waves/BW2.md) | B-07、B-11（部分）；G-03、G-04、G-09、G-10 |
| W2 | DOC_READY | 01 §12 | [waves/W2.md](waves/W2.md) | C-08～C-10、U-03 |
| W3 | DOC_READY | 01 §12 | [waves/W3.md](waves/W3.md) | C-01～C-03、C-11、C-13、C-14、U-05 |
| W4 | DOC_READY | 01 §12 | [waves/W4.md](waves/W4.md) | C-19 |
| BW3 | DOC_READY | [02 §4.5](02-backend-sdd.md#45-會員g-08)、[§7](02-backend-sdd.md#7-後端波次) | [waves/BW3.md](waves/BW3.md) | B-11；G-08 |
| W3b | DRAFT | 01 §7.1 | — | Front 會員區（surface-front AC-10～12） |
| W5 | DRAFT | 01 §10、§12 | — | 剩餘 P2、效能 |
| BW4 | DOC_READY | [02 §5.4](02-backend-sdd.md#54-效能目標本機postgresql-16單類型-10000-筆)、[§7](02-backend-sdd.md#7-後端波次) | [waves/BW4.md](waves/BW4.md) | 效能紀錄、審計保留、surface 拒絕矩陣 |
| BW5 | DOC_READY | [02 §7](02-backend-sdd.md#7-後端波次)、[§8](02-backend-sdd.md#8-開放問題) | [waves/BW5.md](waves/BW5.md) | BQ-06、07、08、10、11（owner 2026-09-25 選 A） |

狀態：`DRAFT`（只有框架）→ `DOC_READY`（施工圖已合併）→ `IN_PROGRESS` → `VERIFIED`（實作已合併並通過交付檢查表）。

## 細化

**一個波次開一個新窗口**，把 [REFINE-PROMPT.md](REFINE-PROMPT.md) 的網址交給 agent，說「讀這個檔案，照做」。它會依上表順序，挑第一個還不是 `DOC_READY` 的波次，產出 `waves/<波次>.md`（施工圖）與 `contracts/`（OpenAPI 片段、fixture），開 PR 並合併，最後把狀態改成 `DOC_READY`。要指定波次，就在同一句話後面加「本次細化：BW0」。

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

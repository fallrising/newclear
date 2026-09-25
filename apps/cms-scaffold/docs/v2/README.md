# CMS Scaffold v2

狀態：**已啟動（設計階段）**。Owner 於 2026-09-25 決定重啟本專案，登記在 [PORTFOLIO.md](../../../../PORTFOLIO.md)。目前三份文件都是 v0.1，接下來會在獨立的對話窗口裡逐章細化（§細化窗口）；實作從 BW0 開始。

| 文件 | 內容 |
| --- | --- |
| [00 — v1 前端稽核](00-v1-frontend-audit.md) | v1 前端的問題清單（編號、嚴重度、證據），以及做對、要保留的部分 |
| [01 — 前端 v2 SDD](01-frontend-sdd.md) | 架構、Shopify 參考對照、tokens、元件、三個操作面的畫面、後端缺口、驗收、前端波次 |
| [02 — 後端 v2 SDD](02-backend-sdd.md) | 後端現況問題、決策、資料表變更、API 變更、品質閘門、後端波次 |

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
 └─► BW1 前端 W1 的前置（分頁／篩選、capabilities、欄位中繼資料、titleField）
        └─► W1 Back 核心（index、details、欄位 widget、發布動作）
               ├─► BW2（batch-patch、include=refs、請求發布、可指派使用者、審計）
               │     ├─► W2 Back 媒體與自訂視圖
               │     └─► W4 Admin
               └─► W3 Front 公開面（不需要 BW2）
                      └─► BW3 會員端點 ─► W3b Front 會員區
W5 前端硬化、BW4 後端硬化：所有功能波之後
```

| 波 | 文件 | 解決 |
| --- | --- | --- |
| BW0 | [02 §7](02-backend-sdd.md#7-後端波次) | B-01、B-08、B-14 |
| W0 | [01 §12](01-frontend-sdd.md#12-實作波次給-llm-agent) | F-01～F-05、S-01～S-03、C-16～C-18、E-01～E-04 |
| BW1 | 02 §7 | B-02～B-06、B-09、B-10、B-12、B-13；G-01、G-02、G-05～G-07、G-11 |
| W1 | 01 §12 | C-04～C-07、U-01、U-02、U-04 |
| BW2 | 02 §7 | B-07、B-11（部分）；G-03、G-04、G-09、G-10 |
| W2 | 01 §12 | C-08～C-10、U-03 |
| W3 | 01 §12 | C-01～C-03、C-11、C-13、C-14、U-05 |
| W4 | 01 §12 | C-19 |
| BW3 → W3b | 02 §4.5、01 §7.1 | B-11；G-08 |
| W5、BW4 | 01 §10、02 §5.4 | 剩餘 P2、效能 |

## 細化窗口

每個窗口只負責一個主題，產出是**修改對應的 v2 文件**（不是寫程式），合併後再開下一個。開新窗口時，把下面對應那一行的「開場指令」貼上即可。

| # | 主題 | 要細化的文件 | 開場指令 |
| --- | --- | --- | --- |
| R1 | OpenAPI 完整 schema 與錯誤代碼 | 02 §4、§5.3 → 新增 `03-api-contract.md` | 「讀 `apps/cms-scaffold/docs/v2/02-backend-sdd.md` 與 `openapi.yaml`，把 BW0 需要的完整 schema 與 ErrorCode 清單設計成 `docs/v2/03-api-contract.md`，只改文件。」 |
| R2 | 列表查詢與 predicate 下推 | 02 §3.2、§4.1 | 「細化 02 §4.1：寫出查詢參數的文法、SQL 形狀、predicate 編譯規則與邊界案例，只改文件。」 |
| R3 | 設計系統：tokens 與模式元件 | 01 §5、§6 → 新增 `04-design-system.md` | 「細化 01 §5–§6：定案 tokens（含對比度驗證）、每個模式元件的 props 與狀態，只改文件。」 |
| R4 | Back 畫面逐頁規格 | 01 §7.2 | 「細化 01 §7.2：每頁的資料來源、互動、空／錯誤狀態、驗收條件，只改文件。」 |
| R5 | Front 各站視覺與 section registry | 01 §2.2、§5.3、§6.3、§7.1 | 「細化 Front：各站配色、字型、section 定義與每頁線框，只改文件。」 |
| R6 | Admin 畫面與治理流程 | 01 §7.3、02 §4.6 | 「細化 Admin 與審計：畫面、危險操作、審計事件清單，只改文件。」 |
| R7 | 測試策略與 mock | 01 §11、02 §5 | 「細化測試：MSW fixture 範圍、store 契約測試案例清單、CI job 設計，只改文件。」 |

細化完成、owner 認可後，就從 BW0 開始實作。

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

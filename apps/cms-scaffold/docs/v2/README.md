# CMS Scaffold 前端 v2

狀態：**documentation-only**。這些文件是給 LLM agent 重寫前端用的設計輸入；實作要等 owner 在 [PORTFOLIO.md](../../../../PORTFOLIO.md) 登記後才開始（見 [01 §13 Q-02](01-frontend-sdd.md#131-開放問題需要-owner-決定)）。

| 文件 | 內容 |
| --- | --- |
| [00 — v1 前端稽核](00-v1-frontend-audit.md) | v1 的問題清單（編號、嚴重度、證據），以及做對、要保留的部分 |
| [01 — 前端 v2 SDD（v0.1）](01-frontend-sdd.md) | 架構、Shopify 參考對照、tokens、元件、三個操作面的畫面、後端缺口、驗收、實作波次 |

與既有文件的關係：[總綱](../sdd/00-overview.md) 凍結、不改；[surface 規格](../specs/) 仍是路由、權限與失敗語義的權威；v2 只補前端架構、視覺與畫面。

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

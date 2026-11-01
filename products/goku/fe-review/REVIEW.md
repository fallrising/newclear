# FE Review — goku — REVIEW

Owner 已於2026-10-23確認 D2 環境範例及 D3 不做 major 升級；[決策紀錄](../../../docs/fe-review/ROUND1-ACCEPTANCE.md#owner-confirmation-20261023)。本次只執行原批准 R2 M1–M3 的 dormant 前端例外。

## 目前狀態

M1–M3 source 與原生 lint/build、store RED/GREEN 已完成。主要 synthetic runtime 流程及最後 real URL edit／圖片解碼補證通過；targets verified 僅指原 R2 隔離入口，不代表完整第3輪。獨立 acceptance、current CI／merge 由 root 收尾。完整第3輪未啟動。

## 已實作事項

- C1：工作樹 `.env` 刪除、同值 `.env.example` 與 ignore 新增；內容無敏感值。parent staged tracking 已確認。
- C2：保留 React18／Vite5／Tailwind3 和原 npm lock，沒有新增框架或依賴。
- C3：Card Edit/Delete、Sidebar icon actions 有名稱與 focus-visible；group-focus-within 令操作可由鍵盤看見。原 submit 類型保留；未接線 BookmarkMenu 不新增入口。
- C4：store 四類失敗有固定錯誤訊息、成功清除；grid 顯示 alert／Retry，失敗不冒充空結果。實際停止 owned json-server 後可見錯誤，重啟同一合成 DB 後 Retry 恢復；受控 mutation500 與真故障分開。

## 原失敗與未解決發現

[完整證據](tasks/round2/report.md) 保留首次3張截圖 favicon ORB。改同源 review-only SVG 後，3張首頁與圖片解碼通過；不是修改產品 assets。後續目視發現編輯後 portless favicon 破圖；edit001 保留 naturalWidth 0 的失敗，實際 Playwright 1.63 原碼確認 user route 前的 favicon abort。edit002 改用 exact local CDP image fixture，證實 response 200／SVG／naturalWidth 16，沒有產品或瀏覽器安全設定變更。

初次 axe 的 button-name 為0，但有 moderate heading-order；不宣稱最終全頁 axe 為0。390px 實圖沒有水平溢出，固定sidebar仍把卡片文字壓得不可讀；這是現有布局限制，M1–M3 不授權重新設計。

搜尋／category／tags 尚未真正篩選；Add Bookmark 沒有handler；BookmarkMenu／CoreLayout 未接線；原生 editor 未使用Tiptap。這些既有功能／第3輪限制保持可見，不把控制項存在當流程成功，也不為本次修復它們。Go API 的 `/api/v1` 與前端 `/api/bookmarks` 差異及產品 SUCCESS 未完成狀態保留。

所有圖像/API fixture 僅使用當次loopback合成資料，不讀真書籤；任何非預期外網request不能當例外忽略。PNG、raw logs、DB不公開。verified 僅涵蓋已實測的原 R2 入口；parent staged tracking 已通過，獨立 acceptance／current CI 仍另行追蹤；不新增產品功能、mainline/tag/release/deploy聲明。

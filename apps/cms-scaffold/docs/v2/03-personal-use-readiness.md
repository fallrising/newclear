# 個人使用驗收與介面參考

日期：2026-10-03。範圍：單人、單站、小量內容，允許維護停機，但不能以資料遺失換取簡化。這份文件是本次文件先行的產品邊界；[P0](waves/P0.md) 是可實作的第一個修復波，後續能力沿原 v2 路線圖。

## 目前證據與缺口

| 能力 | 基準已存在 | 仍需完成 |
| --- | --- | --- |
| CRUD／發布 | 共用 entry、revision、權限、media | 檔案補償；P0 已在本地補齊交易／原子版本／發布媒體隔離 |
| 測試 | BW0 記憶體／PostgreSQL store 契約、OpenAPI 回應驗證、CI | P0 已新增服務層故障回滾／競爭測試並重新執行；正式部署驗收仍待完成 |
| 前端 | W0 tokens、shadcn 元件、Query、MSW、三面 app | P0 表單值安全已本地驗證；W1 完整 schema 編輯器 |
| 擴充 | 類型註冊 API、共用 Entry 寫入、自訂 React 視圖 | BW1a 能力／metadata、動態導覽、後續模型治理 |
| 操作維護 | 本機 Compose、DB/media volume、prod cookie 設定 | 正式初始化、HTTPS、備份還原演練、升級回滾 |

過去對封存版本的「沒有 CI／只有 Identity 的整合測試」觀察不能套用到此基準。規格中的 DOC_READY 只是設計可施工；VERIFIED、測試通過與真實生產可用是三個不同主張。

## 介面參考

主要參考：[satnaing/shadcn-admin](https://github.com/satnaing/shadcn-admin)，[Authenticated layout](https://github.com/satnaing/shadcn-admin/blob/main/src/components/layout/authenticated-layout.tsx)、[授權](https://github.com/satnaing/shadcn-admin/blob/main/LICENSE)。2026-10-03 查閱；MIT。沒有複製上游實作；未來若複製元件需保留作者與授權。

| 模式 | 本專案採用方式 | 所屬範圍 |
| --- | --- | --- |
| 側欄分組＋帳號選單 | Back「內容／自訂視圖」、Admin「模型／帳號／治理」維持分開 | W0 已有基礎，W1／W4 擴充 |
| 清楚的列表／詳細頁 | 主動作單一、狀態與可操作性可辨識；避免無意義 dashboard 數字 | W1 |
| 有型別的表單 | boolean／enum 控制、欄位 label、儲存／衝突回饋 | P0 最小修复；完整 widgets 在 W1 |
| 響應式導覽 | 桌面 sidebar、手機 Sheet、skip link、鍵盤 focus | 沿用 packages/ui AppFrame |
| 操作狀態 | loading、empty、error 明確分開，不能把載入中當空列表 | W0 QueryBoundary 持續使用 |

不導入參考專案的 Clerk／TanStack Router，也不更换現有 session／React Router。深色模式、完整表格系統、拖拉編輯器不因參考模板而自動納入本波；新增依賴仍需授權。

## 第一個真實使用旅程

預設以個人相簿／內容管理驗收：登入 Back → 建內容 → 儲存草稿 → 清除可選欄位 → 發布 → 公開面只見已發布快照 → 修改未發布工作副本 → 發生衝突時保留輸入 → 還原版本 → 重啟後資料仍在。正式使用前另演練還原 DB 與媒體。相同核心要能支撐 Issue，看板 status 與 publicationState 不混用。

## 交付順序與完成定義

1. **P0：資料安全底線。** 真實 DB 回滾／競爭、表單 typed values／清空／衝突。全部必要指令與結果寫入本元件 `.team/`，不以 agent 宣稱代替證據。
2. **通用 CMS 工作流。** 依 BW1a→BW1b→BW1c→W1，之後按相簿需要進 W2；新類型毋須重寫 CRUD 骨架。現階段不承諾「完全免程式配置」。
3. **個人部署驗收。** 先寫独立施工圖，涵蓋管理員與權限初始化、seed 控制、HTTPS／cookie／origin、DB 不對外、靜態檔案服務、備份排程、離線一致性與還原、失敗升級回滾。完成且實测才能標個人生產可用。

P0 通過時可標「本地可靠性修復已驗證」，不能標「所有 v2 完成」或「production-ready」。沒有執行的閘門必須是 skipped 並列原因。

## 多模型交付

Codex 負責範圍、資料一致性與最終驗收。較輕量模型負責短文檔審查、規格矛盾清單、介面回饋；必要時交叉審查。模型名稱先從本機 CLI 查詢，再選定，不把模型新舊當能力證據。每個 worker 有獨立 worktree、disjoint writable scope、測試命令與時間上限；不遞迴派工、不自動 commit/push。失效的 CLI 只做一次有界嘗試，保留錯誤再換工具，不無限重試。

## 本輪交付證據

P0 已本地整合驗證，未提交／合併：[完整紀錄](../../.team/reports/DELIVERY.md)。後端 114＋60、前端 133、mock E2E 17 全通過；lint、typecheck、build、bundle 及桌面／手機表單 smoke 通過。此數字不包含未執行的真 API 瀏覽器旅程或備份还原演練。

既有發布內容若早已缺失媒體 attachment 索引，本波不全量修復；後續內容異動才重建工作／發布聯集，升級前須另行盤點。依賴稽核另有既存開發用間接依賴 brace-expansion 的 high advisory，未在本波更換依賴。

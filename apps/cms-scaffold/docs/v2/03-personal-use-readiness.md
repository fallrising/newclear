# 個人使用驗收與介面參考

日期：2026-10-03。範圍：單人、單站、小量內容，允許維護停機，但不能以資料遺失換取簡化。這份文件是本次文件先行的產品邊界；[P0](waves/P0.md) 是可實作的第一個修復波，後續能力沿原 v2 路線圖。

## 目前證據與缺口

| 能力 | 基準已存在 | 仍需完成 |
| --- | --- | --- |
| CRUD／發布 | 共用 entry、revision、權限、media | 檔案補償；P0 已在本地補齊交易／原子版本／發布媒體隔離 |
| 測試 | BW0 記憶體／PostgreSQL store 契約、OpenAPI 回應驗證、CI | P0 已新增服務層故障回滾／競爭測試並重新執行；正式部署驗收仍待完成 |
| 前端 | W0 tokens、shadcn 元件、Query、MSW、三面 app | P0 表單值安全已本地驗證；W1 完整 schema 編輯器已本地驗證；W2選擇器與媒體／自訂視圖已本地驗證，已於PR #245通過CI並合併 |
| 擴充 | 類型註冊 API、共用 Entry 寫入、自訂 React 視圖 | BW1a 能力／metadata 已本地驗證；動態導覽已於 W1 本地驗證；後續模型治理仍待實作 |
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
2. **通用 CMS 工作流。** 依 BW1a→BW1b→BW1c→W1→BW2，之後按相簿需要進 W2；新類型毋須重寫 CRUD 骨架。現階段不承諾「完全免程式配置」。
3. **個人部署驗收。** 先寫独立施工圖，涵蓋管理員與權限初始化、seed 控制、HTTPS／cookie／origin、DB 不對外、靜態檔案服務、備份排程、離線一致性與還原、失敗升級回滾。完成且實测才能標個人生產可用。

P0 通過時可標「本地可靠性修復已驗證」，不能標「所有 v2 完成」或「production-ready」。沒有執行的閘門必須是 skipped 並列原因。

## 多模型交付

Codex 負責範圍、資料一致性與最終驗收。較輕量模型負責短文檔審查、規格矛盾清單、介面回饋；必要時交叉審查。模型名稱先從本機 CLI 查詢，再選定，不把模型新舊當能力證據。每個 worker 有獨立 worktree、disjoint writable scope、測試命令與時間上限；不遞迴派工、不自動 commit/push。失效的 CLI 只做一次有界嘗試，保留錯誤再換工具，不無限重試。

## 本輪交付證據

P0 已於 PR #212 合併，CI 全通過：[完整紀錄](../../.team/reports/DELIVERY.md)。後端 114＋60、前端 133、mock E2E 17 全通過；lint、typecheck、build、bundle 及桌面／手機表單 smoke 通過。此數字不包含未執行的真 API 瀏覽器旅程或備份还原演練。

既有發布內容若早已缺失媒體 attachment 索引，本波不全量修復；後續內容異動才重建工作／發布聯集，升級前須另行盤點。依賴稽核另有既存開發用間接依賴 brace-expansion 的 high advisory，未在本波更換依賴。

## BW1a 升級注意

類型設定是 kernel 的資料來源；BW1a 不提供管理端編輯 metadata 的 UI／API，完整模型治理仍在後续波次。種子會補齊內建 demo 類型設定。既有自訂類型若曾依賴 payload 的固定 `visibility` 鍵，升級前須盤點 `visibilityField`：未設定的類型將忽略該同名 payload 鍵；不能把有 `visibility: private` 當作足夠的公開存取限制。此行為變更與 BW1a 原契約一致，正式使用前要連同既有媒體索引一併驗證。

BW1a 本地驗收：151＋65 後端測試、140 前端測試、17 mock E2E 全通過；完整紀錄見 [BW1a 交付](../../.team/reports/BW1a-DELIVERY.md)。此波已於 PR #223 合併，個人生產可用門檻不因本地測試通過而自動完成。

## BW1b 本地驗收與升級注意

BW1b 狀態 `VERIFIED`，PR #224 已合併：[交付報告](../../.team/reports/BW1b-DELIVERY.md)。202 單元／API＋91 PostgreSQL、166 前端＋17 mock E2E 與 lint/typecheck/build/bundle 全通過；10,000 筆 store 量測 p95：工作列表 85ms、公開列表 77ms、更新 18ms，不包含 HTTP／identity／媒體展開。

V6 的 NUMERIC 轉換與 V7 索引重建需要維護／備份規劃；不清除舊小數值。公開 ref 篩選仍讀工作 refs（BQ-10），媒體仍逐項解析（BQ-11）。跨頁若資料異動造成總數不一致或重複，完整列表 helper 會明確失敗，需重試；W1 才加入顯式分頁 UI。正式部署與備份還原演練仍未完成。

## BW1c 本地驗收與相容性

BW1c 狀態 `VERIFIED`，PR #225 已合併：[交付報告](../../.team/reports/BW1c-DELIVERY.md)。226 單元／API＋93 PostgreSQL、179 前端＋17 mock E2E，以及 lint/typecheck/build/bundle/bootJar 全通過。10,000 筆 store p95 工作／公開／更新 75／77／22ms，維持原門檻；這不是 HTTP 全鏈路量測。

PATCH 缺少或 null 版本回 428，舊版本仍回 409；422 列出全部欄位錯誤；公開不可讀媒體回 null。寫入規則收緊含文字長度、datetime、整數及 ref 格式。舊值不自動清理或截斷；讀取仍可用，但合併後仍不合法的 patch、publish、revert 會被拒絕，需先改正。乾淨已發布內容的重複 publish 維持 P0 no-op。client 與 MSW 已同步，W1 的完整欄位錯誤 UI／分頁控制已本地驗證；正式使用的操作驗收門檻不變。

## W1 本地驗收

[W1 交付](../../.team/reports/W1-DELIVERY.md)：300 前端、27 mock E2E、226 Java、lint/typecheck/build/bundle/npm ci 通過；五個畫面 axe 無 serious／critical，桌面與手機截圖無阻擋性瀏覽器問題。W1 已於 PR #229 合併，Java／PostgreSQL／web CI 通過；正式使用的操作驗收門檻不變。媒體／關聯欄位暫為唯讀，未知型別保留原值；選擇器於 W2。

## BW2 驗收與界線

[BW2交付](../../.team/reports/BW2-DELIVERY.md)：254 Java、120 PostgreSQL案例、300前端、27mock E2E通過，並通過lint/typecheck/build/bundle與契約生成。PostgreSQL數字來自完整輪108個不變案例＋修正測試比較後強制實跑12個identity案例；舊失敗日誌保留，沒有把失敗的完整命令改寫為exit0。10,000筆store p95為86／80／19ms。

新增審計分頁／詳情、請求發布、可指派使用者、原子批次PATCH與安全關聯摘要。批次保留P0的CAS與交易；既有身份事件補齊狀態／審計原子性，名稱、密碼與session規則不變。發布請求的實際變更會提高version，舊客戶端應採用回傳的version。

本波已於 [PR #235](https://github.com/fallrising/newclear/pull/235) 通過完整遠端 CI 並合併；BW2 不新增依賴、未部署。W2選擇器與自訂視圖已完成本地驗收，已於PR #245通過CI並合併；W4治理畫面尚未實作。測試使用實際PostgreSQL store／服務；BW4仍須完整應用啟動與DataSource/store選用（BQ-13）驗證，不能因此宣稱正式運行或重啟持久性已達生產驗收。備份還原、seed／升級／媒體索引盤點等既有運維門檻仍適用。

## W2 驗收與界線

[W2交付](../../.team/reports/W2-DELIVERY.md)已VERIFIED（PR #245）：媒體／關聯選擇器、媒體庫、請求發布、預覽／還原、當日行程、看板／相簿動作選單及pointer拖放均已整合。395前端測試、完整39 mock E2E（無排除）、lint/typecheck/build/bundle與桌面／390px瀏覽器檢查通過。兩個dnd-kit精確版本已獲Owner明確授權；既有鎖定套件版本不變。[遠端CI與合併已核對](../../.team/reports/W2-PUBLICATION.md)。

Java／PostgreSQL未在W2本地重跑：229项受保護來源／依賴不變，引用BW2完整遠端CI成功證據；本波PR仍執行必要後端CI。既有dev-transitive brace-expansion high advisory仍在；未自動升級相關依賴。實際應用串接與正式使用的操作驗收門檻不變，沒有部署。

## BW3 驗收與界線

[BW3交付](../../.team/reports/BW3-DELIVERY.md)已LOCAL_VERIFIED：Front會員通用列表／單筆／草稿建立、本人資料與關聯保護、安全投影、每分鐘5次限制，以及appointment_request種子。建立沿既有交易與審計；真PostgreSQL故障注入證明entry/index/ref/media/audit一起回滾。JSONB predicate種子比較修正避免重複授權，不清除既有資料。

279 Java／125 PostgreSQL／395前端／39 mock E2E，以及lint/typecheck/build/bundle/npmci/bootJar/codegen通過。完整Java初次的測試fixture可見性錯誤已修正後全套重跑，舊失敗保留。萬筆store p95工作65ms／公開74ms／更新19ms。待遠端CI及合併；沒有依賴／migration／UI變更。會員UI仍在W3b，診所審批仍在BW6；下一個後端任務建議BW4應用／DataSource wiring、審計保留、安全與效能。單實例limiter不是分散式配額；既有正式使用操作門檻不變，未部署。

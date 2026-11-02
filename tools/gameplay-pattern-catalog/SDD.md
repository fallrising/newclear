# Gameplay Pattern Catalog — SDD

## 授權與目的

依 owner 於 2026-11-02 的直接指示：在 newclear 建立 Gameplay Atlas 的網站 metadata 指引，抽取為 design pattern catalog，每篇 pattern 筆記末尾保留參考網址。本次交付工作分支與 Draft PR；不 merge、deploy 或 release。

## 範圍

建立零第三方依賴的靜態網站產生器、網站 metadata 指引與結構化 pattern 契約。首批收錄 14 個已查閱來源的代表性機制；原站首頁聲稱 280 個機制／28 類，此數字僅作來源快照，不能宣稱已完整匯入。以繁體中文撰寫獨立筆記，保留英文名稱與 canonical URL。

每篇分開標示來源摘要及本地原創分析：問題／情境、核心循環、取捨、解法、可調參數、失敗模式、最小原型、觀察問題、相關 pattern。來源摘要簡短改寫，不鏡像全文、圖片、原站程式或遊戲素材；不推定外部內容適用本 repo MIT。

## AC

- AC-01：Given 網站 metadata 與 pattern 筆記，When 執行驗證，Then 必填欄位、ID 唯一性、HTTPS 來源、查閱日期、相關 ID 及來源末節一致性均可檢查，並有維護指南。
- AC-02：Given 已查閱的 14 個機制，When 閱讀每篇 Markdown／HTML，Then 可區別來源摘要與原創分析，每篇最後有實際條目網址，不捏造遊戲規則或來源日期。
- AC-03：Given Python 3.11+ 且沒有網路，When 建置並開啟靜態網站，Then 可看索引及獨立 pattern 頁；啟用 JavaScript 可搜尋與分類；無 JavaScript 仍能導航；支援相對路徑部署。
- AC-04：Given 本次 candidate，When 執行專案測試與 repo CI，Then 來源／連結／輸出安全性／重複建置及索引契約通過，保存真實證據；未執行項目明列，不以 mock 當瀏覽器驗收。

## 非目標

不完整爬取 280 篇、不下載圖片、不自動同步、不呼叫模型、不建立帳號／資料庫、不部署網站、不自動合併。資料可供人與 Agent 查閱，不宣稱等於原遊戲的完整規格或已實玩驗證。

## 實作計畫

Markdown frontmatter 為筆記權威，metadata JSON 宣告來源站與收錄範圍；Python 標準函式庫驗證並產生靜態 HTML／機器可讀索引，少量原生 JavaScript 負責索引過濾。CI 只測試與建置，read-only permissions，不部署。

## 驗證計畫

單元測試涵蓋壞 metadata、重複 ID、失效關聯、危險 URL、來源末節、HTML escaping 與確定性輸出；本地 HTTP smoke 與可用瀏覽器測試。更新 inventory、README 與 PROJECTS 導航；執行 check_project_success／check_indexes，無完整 checkout 時由遠端 CI 執行並保留限制。

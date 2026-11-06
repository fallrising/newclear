# Gameplay Pattern Catalog — SDD

## 已關閉的精選里程碑

2026-11-02 的第一階段交付 14 篇精選筆記、網站 metadata 與靜態網站，驗收是 AC-01 至 AC-04，已由 PR #960 合併。該階段明確不把原站全量當成完成。那些 AC 保留為歷史，不能拿來宣稱本次全量完成。

## 本次授權與目的

依 owner 於 2026-11-02 的直接指示：把精選 catalog 擴充為「以一次可追溯的 Gameplay Atlas 公開來源快照為分母」的完整 catalog。交付工作分支與 Draft PR。不 merge、deploy、release 或打 tag。

完整指蓋過該快照裡的每個獨立機制，不是蓋過一切遊戲設計模式，也不是持續同步原站。

## 範圍

沿用 Markdown frontmatter、Python 標準函式庫與原生 JavaScript。來源 manifest 負責盤點；筆記負責設計內容。原站分類 `source_category` 與本地分類 `category` 分開。取得狀態與筆記狀態分開。

每篇保留繁中名稱、英文原名、短篇來源摘要、問題與情境、核心循環、解法與取捨、可調參數、失敗模式、未驗證的最小原型、相關模式，以及文末的實際機制頁。最小原型用短句描述要觀察的差異，不寫來源沒有的數量。來源事實、本地分析、未驗證提案必須分開。未確認再發布授權，所以不鏡像全文、圖片、案例素材或原站程式。

## AC

- AC-F01：Given 已對帳的公開入口，When 檢查來源 manifest，Then 沒有重複的 canonical ID／URL，總數與分類可對帳，差異有證據，而且完整度不是由筆記篇數反推。
- AC-F02：Given 這份 manifest，When 對到本地筆記，Then 沒有未說明的缺漏；只有實質 reviewed 筆記計入完成，pending、blocked 與占位不算。
- AC-F03：Given 一篇 reviewed 筆記，When 讀到最後，Then 有實際機制頁網址，frontmatter 與文末引用一致，來源事實、本地分析與未驗證提案分開，而且對照紀錄可回到快照雜湊。
- AC-F04：Given catalog 契約，When 執行驗證，Then ID、分類、日期、URL、狀態與 related 都被檢查，沒有懸空關聯、自我引用，或把既有 ID 改掉的遷移。
- AC-F05：Given 全量靜態站，When 用真實瀏覽器操作，Then 搜尋、分類、詳情、相關模式、來源連結、空結果、重設、手機寬度、子路徑與無 JavaScript 導航都可用。
- AC-F06：Given 離線環境，When 重複建置並跑負向測試，Then 輸出確定、HTML 會跳脫、危險 URL 被拒、輸出目錄受保護，而且完整度與狀態轉移的負向案例會失敗。
- AC-F07：Given 這次變更，When 從 repo root 執行元件測試與專案檢查，Then `check_project_success.py --write-index` 與 `check_indexes.py` 的結果被如實保留，索引只改到實際受影響的項目。

機器可檢查的 SUCCESS 列號是 AC-05 至 AC-11，內容與 AC-F01 至 AC-F07 相同。

## 非目標

不建立資料庫、大型前端框架、帳號、自動排程或模型服務。不把 HTTP 200 或檔案數量當成內容已核對。不部署、不合併、不打 usable tag。後續來源變動不併入這次快照。

## 忠實度檢查與產生的狀態

忠實度由 `check_quotes.py` 決定。每個內容片段必須是所引 `sources/text/<id>.json` 在標明字元位置上的原文。沒有出處的內容行、對不上的字、空的必填欄，檢查都失敗。顯示行若存在，只能是 OpenCC `s2t` 的逐字結果。這支檢查不呼叫模型。

`review/auto_check.py` 與 `review/pi_review.py` 仍留在目錄裡，validate 不讀它們的結果，CI 也不執行。模型的 pass 不是 reviewed。

人工升格仍是 `review/promote.py --apply`。這不把 catalog 標成 complete，也不滿足 AC-F02 的「全部 reviewed」。

total、draft、reviewed、quoted_spans、quote_check 與 `source_commit` 由 `status.py` 從筆記檔與引文檢查產生，寫進 SUCCESS、inventory 的 catalog 列，以及可貼上 PR 描述的片段。`source_commit` 是筆記檔的 git tree SHA。檢查失敗表示這三處與重算結果不一致，不是筆記已審閱。

## 驗證計畫

單元測試覆蓋壞 metadata、重複來源、缺筆記、blocked、pending、搜尋索引摘錄不能 reviewed、危險 URL、來源末節、跳脫與確定性輸出。瀏覽器 smoke 讀實際建置結果。離線測試不要求原站在線。

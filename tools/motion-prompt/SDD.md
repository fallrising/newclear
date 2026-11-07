# Motion Prompt 繁中／英文互動圖鑑規格

狀態：提案，待 owner 批准。此 PR 僅固定需求與驗收，不代表網站已整合或 owner 已驗收。

## 目標與範圍

讓「知道想要什麼動畫／鏡頭運動／視覺效果，卻不知道如何向 AI 描述」的使用者看示範、辨認繁中及英文術語、理解意思，直接複製兩種語言的提示詞。

元件自包含於 `tools/motion-prompt/`，沿用上游原生 HTML／CSS／JavaScript／Canvas 靜態架構。交付包含 motion、camera、ui、lp、photo 全部項目；不是連結集合或純翻譯文件。不採大型框架，不新增後端、帳號、資料庫、LLM API、付費服務、分析追蹤或 agent bridge。Skill／CLI 不匯入，也不宣稱支援。

## 固定來源與版本選擇

- Repository：https://github.com/showheyohtaki/motion-prompt
- Website：https://showheyohtaki.github.io/motion-prompt/
- 本輪選定匯入 SHA：`770eefb7091cc725ab0eb6d4ef5cbf28b28e282c`；5 packs 各 24 項，共 120 項（001–120），612 條規格。
- 2026-10-28 重新查到上游 HEAD 為 `bd6bf08d8d412cc82c1bbc8f1a81638617a45cfb`，已與上述基準不同。本提案沿用既有已驗證的固定來源，不同時引入上游升級；120 項覆蓋率只指選定 SHA，**不宣稱涵蓋最新 HEAD**。改來源時必須重新盤點全部項目與授權，更新契約及驗證，不可暗中擴張／縮減數量。
- 保留英文與日文原始資料作同步依據；操作與提示詞僅使用 `zh-Hant`／`en`，全層代碼一致。預設繁中，英文可切換。
- 授權、來源、翻譯及測試的既有基準見 [baseline](docs/evidence/baseline.md)。歷史綠燈不等於最新整合通過。

## 資料與行為契約

`packs/*/meta.json` 保存穩定 ID／英文 slug／英文名稱，以及名稱、意思、用途、AI 例句、摘要與規格的兩語資料；`locales/` 保存介面及畫布有意義標籤。建置器產生 catalog、語言 pack、提示詞靜態 API 與 Markdown 清單，拒絕不完整資料。原動畫來源保留可核對版本，文字替換不得改時間、角度、方向、位移、縮放、easing 或 spring 參數。

繁中使用自然技術用語；無通用譯名時用清楚描述＋英文名稱。提問例句與實際示範規格分開呈現，不把範例參數錯當動畫實作。每項提供原編號、雙語名稱／說明／使用情境／AI 例句／規格與可複製提示詞。英文模式不混入繁中解釋，兩種操作流程不得依賴日文。

介面與複製語言分開選擇；語言切換保留搜尋、選取與使用者備註。詳情／分享／多選皆使用本地子路徑；上游網址僅為清楚標示的外部來源參考。核心流程不主動載入外部社群、影音、字型、追蹤或上游資料。剪貼簿失敗提供本地化訊息，不假報成功。

## 固定驗收條件

下列編號承接原需求，後續測試名稱帶相同 AC 編號。自動數值檢查不能取代語意、動作方向與翻譯的人工核對。

### AC-01 固定來源與完整匯入

Given 固定上游 SHA 與來源 manifest；When 比對全部項目；Then 5 packs 各 24 項、共 120 項的 ID、slug、英文名稱及分類與來源完全一致。

驗證：來源 manifest、各 pack metadata／Canvas hash；AC-01-source。

### AC-02 完整雙語內容

Given 任一項目；When 讀取 zh-Hant／en；Then 名稱、意思、用途、AI 例句、動作／視覺規格、可複製提示詞皆完整，缺繁中必須使建置失敗，不得靜默 fallback。

驗證：完整性檢查與缺欄位負例；AC-02-locales。

### AC-03 翻譯與規格忠實度

Given 英日來源與 Canvas；When 核對翻譯；Then ID／slug 不重編，612 條規格的數值、單位、條目順序、方向及動作語意一致；dolly 與 zoom 不混淆。

驗證：逐條數值／單位檢查及人工語意核對；AC-03-fidelity。

### AC-04 介面語言與狀態

Given 首次開啟與已輸入搜尋、備註、選取；When 切換介面語言；Then 預設繁中並顯示繁中＋英文術語，英文模式無繁中解釋；狀態保留，導覽／錯誤／空結果／ARIA／畫布有意義標籤均本地化。

驗證：真實瀏覽器與 locale／Canvas 標籤盤點；AC-04-language。

### AC-05 尋找效果

Given 全部資料；When 搜尋繁中、英文、關鍵字、#005／005／5 並依 pack／分類篩選；Then 正確匹配、數量更新且無結果狀態可理解。

驗證：真實瀏覽器搜尋與篩選；AC-05-search。

### AC-06 詳情與深連結

Given 單項 ID 或分享選取連結；When 直接開啟、重新整理或鍵盤切換項目；Then 顯示正確效果與規格，詳情可關閉並恢復焦點。

驗證：真實 HTTP 深連結／鍵盤測試；AC-06-detail。

### AC-07 獨立提示詞語言

Given 單項與跨 pack 多選及使用者備註；When 分別選繁中／英文複製；Then 真實剪貼簿含所選語言的完整規格與備註，無須切換介面，清除與分享選取可用。

驗證：真實 Clipboard API，不使用 mock；AC-07-clipboard。

### AC-08 保留動態示範

Given 每項兩語示範；When 播放並在至少 8 個時間點繪製及檢查 loop seam、重複同時間、2× scaling；Then 無例外或新增非預期空白；與固定上游比較，原設計的進場空白不誤判回歸。

驗證：適用上游動畫 checker＋兩語完整檢查＋上游基準；AC-08-animation。

### AC-09 桌面手機與無障礙

Given 桌面、390×844 手機模擬與 reduced-motion；When 使用鍵盤、詳情、選取清單及切換系統偏好；Then 無水平溢出或控制項遮擋，焦點／Escape 正常，減少動態預設暫停並回應偏好變化。

驗證：真實 Chromium、桌面手機截圖實際目視；AC-09-accessibility。

### AC-10 靜態子路徑與零遠端依賴

Given 網站根目錄及 /nested/tools/motion-prompt/；When 瀏覽、動畫、搜尋、詳情與複製；Then 本地資源／規格／示範網址正確，480 個雙語項目與提示詞端點 HTTP 200，零非必要外連、404、console error 或未處理 rejection。

驗證：真實瀏覽器網路／錯誤監測；AC-10-static。

### AC-11 單一來源與可重建

Given metadata／locale；When 連續兩次建置並檢查 generated outputs；Then 產生 517 檔且位元組一致；缺譯、規格數值被改或 stale output 的負例都失敗，不靠手改產生檔。

驗證：build --check、contract 負例、乾淨 diff；AC-11-build。

### AC-12 授權與可維護邊界

Given 可散布來源清單；When 檢查匯入與 UPSTREAM；Then MIT、作者與第三方聲明保留，記完整 SHA／日期／範圍／排除／本地修改／同步方法；無未授權媒體、大型字型／宣傳素材、submodule 或執行時上游下載，且明示非官方繁中版。

驗證：LICENSE／NOTICE hash、來源與檔案清單人工審查；AC-12-provenance。

### AC-13 可執行交付與證據

Given 最新 monorepo 基準與完整候選；When 依 README 啟動、建置及本地測試後發布任務分支與 Draft PR；Then 原始碼與網站可用，實際 SHA／數量／命令／結果／畫面／未驗證項可回讀，owner 驗收分開記錄，沒有 merge／deploy／新 CI 費用。

驗證：乾淨 checkout 啟動、repo gates、遠端 commit／PR 回讀；AC-13-delivery。

## 驗證與交付界線

資料／重建先於真實 Chromium 行為與全項動畫檢查；本地優先，不為本元件新增 workflow 或付費 CI。慢動畫／瀏覽器檢查不塞入共享 CI。自動驗證需保存版本、環境、退出碼與實際結果；截圖必須開啟目視，不以 DOM stub、mock clipboard、生成截圖或單純資料檢查冒充端到端驗證。

已知上游問題要保留來源、與本次差異及影響；只修本次引入的回歸，不無限擴大。Safari、Firefox、實體手機與部署環境若未測，明列未驗證；手機模擬不得稱為實機。翻譯與視覺適切性仍交 owner 最終驗收。

最終 README 提供真正執行過的啟動／建置／測試命令。網站實作只交付 Draft PR；不合併、不建立 usable tag、不部署。文件與任務記錄維持實作／自動驗證和 owner 驗收的區別。[SUCCESS](SUCCESS.md) 只追蹤同一組 AC，不另造完成定義。

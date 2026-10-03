# FE Review — hai-taskboard — REVIEW

> 活文件：只描述目前狀態。已解決的項目直接改寫成目前的結論，不留過期描述；歷史由 Git 與 PR 保存。每次修改都走 PR。規則見 PROTOCOL.md 的「`REVIEW.md` 規則」。

## 目前輪次

- **第 1 輪：文檔先行（進行中）** — [`DESIGN.md`](DESIGN.md) 已草擬，待擁有者在設計 PR 確認假設（D1、D2、D3）。
- 第 2 輪：修改（未開始）
- 第 3 輪：完整 e2e（未開始）

## 修改權限

文檔檔位 **A（active）**：第 2 輪可在 `DESIGN.md` 範圍內，依元件 `AGENTS.md` 與 PROTOCOL 第 4 節修改前端。

## 矛盾點

### C1 UI 只接 fixtures，沒有接後端

`web/src/app.tsx` 的資料全部來自 `fixtures.ts`（`app.tsx:7`），原始碼中沒有任何 API 呼叫。「UI 可單獨執行」成立，
但前後端整合目前無法驗證。

### C2 沒有 URL 路由，次級狀態只能靠互動擷取

四個 surface（`Board`、`Work item`、`Attention`、`Impact preview`）由導覽按鈕切換（`app.tsx:18`、`app.tsx:155-165`），
選取、轉移與主題都是元件狀態；畫面上沒有對話框。`capture.mjs` 只能擷取首頁，其餘要用互動腳本。處理方式見 `DESIGN.md` M3。

### C3 轉移被拒絕時，視覺使用者看不到回饋

選取與轉移的結果訊息只放在 `sr-only` 的 live region（`app.tsx:171`）。被 guard 拒絕時（`app.tsx:100-102`），
卡片留在原欄位、焦點回到按鈕，只有螢幕閱讀器會讀出原因。處理方式見 D3 與 `DESIGN.md` M2。

### C4 深色主題不跟隨系統設定

主題由畫面上的按鈕設定 `data-theme`（`app.tsx:147-150`、`styles.css:33`），不讀取 `prefers-color-scheme`；
`capture.mjs` 以系統設定模擬 `colorSchemes`，擷取不到深色主題。`targets.json` 已改為只擷取 light，深色由 `DESIGN.md` M3 的腳本切換後擷取。

## 已決定

- 無

## 需要放開或決定的點

### D1 是否為主要狀態加上路由

- 選項：(a) 加上 URL 路由，讓狀態可直接擷取、可分享；(b) 維持現狀，fe-review 以互動腳本擷取。
- 建議：(b)。路由屬產品行為變更；等第 3 輪確認腳本成本再評估 (a)。
- 狀態：**待擁有者決定**。`DESIGN.md` 以 (b) 為假設。

### D2 UI 何時接上後端

- 屬產品路線，不屬 FE review；記錄在此，是為了提醒第 3 輪報告不能宣稱整合已驗證。
- 建議：fe-review 不等待整合，只涵蓋 fixture 驅動的 UI；接上後端的時機由擁有者依產品規劃決定。
- 狀態：**待擁有者決定**。`DESIGN.md` 以建議為假設。

### D3 轉移結果是否在畫面上可見

- 選項：(a) 把現有的 live region 改為可見的狀態列，文字與觸發時機不變；(b) 維持 `sr-only`，視覺使用者依靠詳情面板常駐的 guard 說明。
- 建議：(a)。拒絕是需要使用者察覺的結果；只改呈現，不改文字語意。
- 狀態：**待擁有者決定**。`DESIGN.md` 以 (a) 為假設。

## 進入第 2 輪的條件

- `DESIGN.md` 已合併，其中每個假設都已由擁有者確認，並改寫進上方「已決定」。

## 相關 PR

- fallrising/newclear#141：建立工作包、REVIEW 與三輪節奏。
- fallrising/newclear#144：記錄擁有者決定與設計文件入口。

# FE Review Protocol

每個 `<component>/fe-review/PROMPT.md` 都引用這份共用規範。它規定 LLM agent 如何自主檢查一個 UI、用 headless 瀏覽器產生截圖，並在限定範圍內優化。專案特有的資訊（入口、啟動線索、頁面、重點風險）寫在各自的 `PROMPT.md` 與 `targets.json`。

> 狀態：**只定義，未執行**。各 `targets.json` 的 `verified: false` 表示啟動指令、port、頁面清單都是從原始碼推斷，尚未實際跑過。第一次執行的 agent 必須先驗證並修正它們。

## 0. 執行環境

FE review 一律在**受控的隔離環境**執行，例如專用容器或 CI runner。這是讓各專案的啟動限制可以統一處理的前提：

- 使用獨立的 network namespace（容器預設網路即可），**不要**用 `--network host`，也不要和其他服務共用 pod。
- 被測服務與 headless 瀏覽器在同一個環境內，服務綁 `127.0.0.1`。在獨立 namespace 裡，loopback 從外部連不到；即使容器發布了 port，轉發目標也是容器網卡而不是 loopback。
- 所有帳號、token、憑證、上傳檔都是本次執行產生的合成資料，執行結束即丟棄。截圖與報告會被提交或轉發，所以這條與網路隔離無關，仍然必須遵守。
- 所需的測試 CA、client certificate、admin token 由 agent 在環境內即時產生，不使用任何既有環境的憑證。

**拆不開就是耦合。** 如果某個 UI 無法在上述環境單獨跑起來，例如綁定位址寫死、UI 只能透過完整後端和正式認證才能載入，這本身就是 review 的發現。處理方式：

1. 在報告中記為 `major`，說明耦合點（file:line）。
2. 在報告中提出修正方向：讓部署策略可注入，**而不是**移除安全邊界；提議的選項只能讓行為更窄（例如綁定只接受 loopback），不得包含認證旁路或對外綁定。這類修改屬後端變更，依第 4 節只提議、不直接實作，由擁有者決定。
3. 前端可以脫離後端驗證時，優先用 API contract 的 mock 與合成資料擷取畫面；再用一次完整整合執行（真實伺服器＋即時產生的測試憑證）確認接線。

## 1. 流程總覽

每一輪 review 固定走這六步，不要跳步：

1. **Discover** — 讀元件 `README.md`、`AGENTS.md`（若有）、`package.json`／建置檔、router 與頁面元件，確認 `targets.json` 的內容仍然正確。
2. **Launch** — 在第 0 節的隔離環境內以最小依賴啟動 UI：優先使用專案自帶的 mock／fixture／demo 模式；只綁 `127.0.0.1`；不連任何正式環境。
3. **Baseline capture** — 執行 `capture.mjs` 產生第一組截圖與 `capture.json`。
4. **Review** — 依第 3 節檢查清單逐頁檢視截圖與 `capture.json`，也讀對應原始碼找根因。
5. **Optimize** — 只修第 4 節允許範圍內、證據明確的問題；每個修正都跑專案自己的 lint／typecheck／test／build。
6. **Re-capture & report** — 重新截圖，寫 `REPORT.md`，列出 before／after 與未處理事項。

啟動失敗不是結束：把失敗原因、已嘗試的指令、缺少的依賴寫進 `REPORT.md`，並修正 `targets.json` 中可確定的部分。若失敗原因是耦合，依第 0 節處理。

## 2. 截圖

在 repository root 執行：

```bash
# 先確認計畫，不開瀏覽器
node docs/fe-review/capture.mjs <component>/fe-review/targets.json --dry-run

# 自行啟動 dev server 後擷取
node docs/fe-review/capture.mjs <component>/fe-review/targets.json

# 或交給腳本依 targets.json 的 start/ready 啟動與關閉
node docs/fe-review/capture.mjs <component>/fe-review/targets.json --start
```

- 需要 `playwright`（或 `@playwright/test`）；可用元件已有的依賴，或在暫存目錄 `npm i --no-save playwright`。若有 `@axe-core/playwright` 會自動跑 a11y 掃描。
- 預設 viewport：desktop 1440×900、tablet 834×1112、mobile 390×844；`targets.json` 可覆寫 `viewports` 與 `colorSchemes`。
- 輸出：`<component>/fe-review/runs/<YYYY-MM-DD_HHMM>/`
  - `screenshots/*.png`：`<app>__<page>__<viewport>__<scheme>.png`，**git-ignored**，不提交。
  - `capture.json`：每張截圖的 URL、HTTP status、載入時間、console error／warning、page error、失敗的 request、水平溢出、axe violations。可提交。
  - `REPORT.md`：本輪結論，必須提交。
- 需要登入的頁面：用 fake／seed 帳號在本機登入一次，存成 Playwright `storageState` 檔 `runs/<ts>/auth.storage.json`（git-ignored），再在 `targets.json` 的 app 設 `storageState`。**不要**把 token、cookie、密碼寫進任何提交的檔案。
- 啟動服務需要的暫存資料目錄、SQLite、上傳測試檔一律放 `fe-review/runs/.state/`（git-ignored），不要散落在元件目錄。
- 帶參數的路由（`:id`）先從 seed／fixture 找真實存在的 id，再加入 `pages`。
- 非瀏覽器介面（TUI、原生視窗）不走 `capture.mjs`；依 `PROMPT.md` 的替代方式擷取（例如 `tmux capture-pane` 文字快照）。

## 3. 檢查清單

每一項都要在 `REPORT.md` 標示 `pass`／`issue`／`n/a`，`issue` 附截圖檔名與原始碼位置。

**可用性與正確性**
- 頁面能載入；沒有白屏、未捕捉的 page error、無限 loading。
- console 無 error；warning 需判斷是否該修。
- 沒有非預期的 4xx／5xx 或失敗 request（登入頁的預期 401 除外，需註明）。
- 主要流程至少能走通一次（在 `PROMPT.md` 指定）。

**版面與視覺**
- 三種 viewport 下沒有水平溢出、元素重疊、被截斷的文字或按鈕。
- 中文／長字串／空字串不會撐破版面；數字與日期格式一致。
- 間距、字級、色彩與元件庫（Tailwind token、Radix／shadcn、Ant Design…）用法一致，沒有零散 hardcode。
- dark mode（若支援）對比足夠、沒有漏套主題的區塊。

**狀態**
- empty、loading、error、無權限狀態都有明確呈現；能觸發的就截圖。
- 表單有 label、驗證訊息、送出中狀態，錯誤訊息可理解。

**無障礙（a11y）**
- axe 無 `critical`／`serious` violation。
- 可用鍵盤走完主要流程；focus 可見；互動元素有可讀名稱；圖片有 alt。
- 色彩對比符合 WCAG 2.2 AA。

**效能（粗估）**
- `capture.json` 的載入時間異常偏高的頁面要找原因（大型 bundle、重複 request、未虛擬化的長列表）。
- 生產 build 的 bundle 大小若可取得，記錄在報告中。

## 4. 優化範圍與限制

允許 agent 直接修改：
- 元件目錄內的前端原始碼、樣式、前端測試。
- 本元件 `fe-review/` 內的 `targets.json`、`PROMPT.md`（修正錯誤的啟動線索或頁面）。

必須先提議、不直接改：
- 後端 API、資料庫 schema、共用套件、跨元件變更。
- 升級主要依賴（React、Vite、Tailwind、元件庫的 major 版本）。
- 大幅改版的視覺設計；改變產品行為或文案語意。

一律禁止：
- 在任何提交的檔案寫入 secret、token、cookie、個人資料或正式環境資料。
- 連線正式環境、對外公開綁定（`0.0.0.0`）或關閉認證來「方便截圖」。
- 為了讓檢查通過而刪除、跳過、放寬測試。
- 提交截圖 PNG 或 `storageState`。

每個修正：一個問題一個 commit；commit message 說明問題、證據（截圖檔名或 `capture.json` 欄位）與驗證指令。遵守元件自己的 `AGENTS.md` 與 portfolio 文檔檔位規則。

## 5. `REPORT.md` 格式

```markdown
# FE Review — <component> — <YYYY-MM-DD HH:MM>

## 環境
- commit：<sha>
- 啟動方式：<實際使用的指令>；mock／fixture：<是否>
- 瀏覽器：<Chromium 版本>；axe：<有／無>

## 結果摘要
| 嚴重度 | 數量 |
（blocker／major／minor／nit）

## 發現
### <編號> <標題>（<嚴重度>）
- 頁面／viewport：
- 證據：screenshots/<file>.png、capture.json 欄位
- 根因：<file:line>
- 處理：已修（commit）／提議（原因）／不處理（原因）

## Before / After
<已修項目的截圖檔名對照>

## 檢查清單
<第 3 節逐項 pass／issue／n/a>

## 未驗證與後續
- targets.json 修正內容
- 無法啟動或無法覆蓋的頁面，以及需要的條件
```

嚴重度定義：**blocker** 頁面無法使用或資料錯誤；**major** 主要流程受阻、a11y critical／serious、明顯破版；**minor** 局部版面或狀態缺漏；**nit** 一致性與潤飾。

## 6. `targets.json` 欄位

```jsonc
{
  "project": "名稱",
  "verified": false,              // 實際跑通後改成 true，並記錄日期
  "locale": "zh-TW",
  "colorSchemes": ["light", "dark"],
  "viewports": [/* 可省略，使用預設 */],
  "apps": [
    {
      "name": "web",
      "kind": "spa | server | desktop-web | terminal",
      "cwd": "相對 repo root 的啟動目錄",
      "install": "安裝指令（腳本不執行，供 agent 參考）",
      "start": "啟動指令（--start 時由腳本執行）",
      "env": { "非機密的環境變數": "值" },
      "baseUrl": "http://127.0.0.1:5173",
      "ready": "/ 健康檢查路徑",
      "storageState": "可選，登入狀態檔（git-ignored）",
      "pages": [
        { "id": "home", "path": "/", "waitFor": "可選 CSS selector", "fullPage": true }
      ]
    }
  ]
}
```

`kind: terminal` 的 app 會被 `capture.mjs` 略過，只作為 agent 的擷取說明。

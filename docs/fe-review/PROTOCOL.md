# FE Review Protocol

每個 `<component>/fe-review/PROMPT.md` 都引用這份共用規範。它規定 LLM agent 如何自主檢查一個 UI、用 headless 瀏覽器產生截圖，並在限定範圍內優化。專案特有的資訊（入口、啟動線索、頁面、重點風險）寫在各自的 `PROMPT.md` 與 `targets.json`；尚未解決的矛盾與待決定事項寫在各自的 `REVIEW.md`。

> 狀態：所有元件都在**第 1 輪（文檔先行）**。各 `targets.json` 的 `verified: false` 表示啟動指令、port、頁面清單都是從原始碼推斷，尚未實際跑過。

## 0. 執行環境

FE review 一律在**受控的隔離環境**執行，例如專用容器或 CI runner。這是讓各專案的啟動限制可以統一處理的前提：

- 使用獨立的 network namespace（容器預設網路即可），**不要**用 `--network host`，也不要和其他服務共用 pod。
- 被測服務與 headless 瀏覽器在同一個環境內，服務綁 `127.0.0.1`。在獨立 namespace 裡，loopback 從外部連不到；即使容器發布了 port，轉發目標也是容器網卡而不是 loopback。
- 所有帳號、token、憑證、上傳檔都是本次執行產生的合成資料，執行結束即丟棄。截圖與報告會被提交或轉發，所以這條與網路隔離無關，仍然必須遵守。
- 所需的測試 CA、client certificate、admin token 由 agent 在環境內即時產生，不使用任何既有環境的憑證。

**拆不開就是耦合。** 如果某個 UI 無法在上述環境單獨跑起來，例如綁定位址寫死、UI 只能透過完整後端和正式認證才能載入，這本身就是 review 的發現。處理方式：

1. 記入元件的 `REVIEW.md`（第 3 輪發現時也寫進 `REPORT.md`，嚴重度 `major`），說明耦合點（file:line）。
2. 在 `REVIEW.md` 提出修正方向：讓部署策略可注入，**而不是**移除安全邊界；提議的選項只能讓行為更窄（例如綁定只接受 loopback），不得包含認證旁路或對外綁定。這類修改屬後端變更，依第 4 節只提議、不直接實作，由擁有者決定。
3. 前端可以脫離後端驗證時，優先用 API contract 的 mock 與合成資料擷取畫面；再用一次完整整合執行（真實伺服器＋即時產生的測試憑證）確認接線。

## 1. 三輪節奏

每個元件依序走三輪。上一輪的文件被擁有者確認後，才進入下一輪；每一輪的每次變更都是一個 PR。

| 輪次 | 目的 | 允許的動作 | 完成條件 |
| --- | --- | --- | --- |
| **第 1 輪：文檔先行** | 確認思路正確 | 讀原始碼與文件；撰寫與打磨 `PROMPT.md`、`targets.json`、`REVIEW.md`，再依 [DESIGN-PROMPT.md](DESIGN-PROMPT.md) 撰寫 `DESIGN.md`。**不啟動、不修改程式碼** | `DESIGN.md` 已合併，其中每個假設都已由擁有者確認 |
| **第 2 輪：修改** | 依已確認的文件實作 | 只實作 `DESIGN.md` 範圍內的修改（含解耦）；在第 0 節環境內確認 UI 能啟動並修正 `targets.json`；跑元件自己的 lint／typecheck／test／build | 已決定事項全部落地，`targets.json` 改為 `verified: true` |
| **第 3 輪：完整 e2e** | 整體開發完成後驗收 | 依下方六步完整擷取與檢查，寫 `REPORT.md` | 報告提交；新發現寫回 `REVIEW.md`，由新的第 2 輪 PR 處理 |

第 3 輪的六步：

1. **Discover** — 確認 `PROMPT.md`、`targets.json` 與程式碼一致。
2. **Launch** — 在第 0 節的隔離環境內啟動 UI：優先使用專案自帶的 mock／fixture／demo 模式；只綁 `127.0.0.1`；不連任何正式環境。
3. **Capture** — 執行 `capture.mjs`，並走完 `PROMPT.md` 的主要流程。
4. **Review** — 依第 3 節檢查清單逐頁檢視截圖與 `capture.json`，也讀對應原始碼找根因。
5. **Classify** — 可以在第 4 節允許範圍內直接修的，記為第 2 輪待辦；需要決定的，寫進 `REVIEW.md`。第 3 輪本身不修改程式碼，好讓報告對應同一個 commit。
6. **Report** — 寫 `REPORT.md`，列出發現與未處理事項。

啟動失敗不是結束：把失敗原因、已嘗試的指令、缺少的依賴寫進 `REPORT.md` 與 `REVIEW.md`。若失敗原因是耦合，依第 0 節處理。

### `REVIEW.md` 規則

- 每個元件一份，是**活文件**：只描述目前狀態。已解決的項目直接刪除或改寫成目前的結論，不留過期、不合時宜的描述；歷史由 Git 與 PR 保存。
- 內容分為：目前輪次、修改權限（文檔檔位等）、矛盾點、已決定、需要放開或決定的點、進入下一輪的條件、相關 PR。
- 待決定事項由擁有者決定；agent 只提出選項與建議，不自行把「待決定」改成「已決定」。撰寫 `DESIGN.md` 時可以把建議當作「假設」寫進設計，並在 PR 中列出，由擁有者在 review 時確認；確認後才移到「已決定」。

### `DESIGN.md` 規則

- 每個進入設計的元件一份，放在 `<component>/fe-review/DESIGN.md`，格式依 [DESIGN-TEMPLATE.md](DESIGN-TEMPLATE.md)。
- 它是第 2 輪的唯一範圍：沒寫進 `DESIGN.md` 的修改，第 2 輪不做。
- 與 `REVIEW.md` 分工：`REVIEW.md` 記「還有什麼要決定」，`DESIGN.md` 記「決定之後要怎麼改、怎麼驗收」。同樣是活文件，每次修改都走 PR。
- 每次修改 `REVIEW.md`、`PROMPT.md`、`targets.json` 都走 PR，PR 說明哪些項目新增、解決或改寫。

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

以上範圍適用於第 2 輪。每個修正：一個問題一個 commit；commit message 說明問題、證據（截圖檔名、`capture.json` 欄位或 `REVIEW.md` 項目編號）與驗證指令。遵守元件自己的 `AGENTS.md` 與 portfolio 文檔檔位規則。

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
- 去向：第 2 輪待辦／寫入 REVIEW.md（項目編號）／不處理（原因）

## 與上一份報告比較
<上一份報告的發現中，哪些已消失、哪些仍在；第一次報告寫「無」>

## 檢查清單
<第 3 節逐項 pass／issue／n/a>

## 未驗證與後續
- 無法啟動或無法覆蓋的頁面，以及需要的條件
- 本報告新增到 REVIEW.md 的項目編號
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

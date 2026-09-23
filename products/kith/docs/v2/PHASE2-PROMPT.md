# Phase 2 細化 prompt

> 用法：把本檔從「---」以下的全文當成 prompt 交給執行 Phase 2 的 LLM agent。可在最後一行指定要細化的里程碑（例如「本次細化：W0」）；沒指定時從第一個狀態不是 `DOC_READY` 的里程碑開始。

---

你是 Kith v2 的**設計文件細化者**。你的產出是文件，不是程式。

## 0. 目標

把 `products/kith/docs/v2/` 的 Phase 1 大框架，逐個里程碑細化成**施工圖**：另一個能力較弱的 LLM agent 只讀這些文件，就能照做完成實作，**不需要做任何設計決定、不需要猜、不會跑調**。

判斷標準只有一條：實作者讀到任何一句話時，如果還得自己「選一個做法」，就代表你還沒寫完。

## 1. 位置與分支

- Repository：`fallrising/newclear`（monorepo）。
- 設計文件目錄：`products/kith/docs/v2/`（本機 clone 通常在 `/home/user/newclear/products/kith/docs/v2/`）。
- 你只寫文件，路徑限定：`products/kith/docs/v2/**`、`products/kith/contracts/v2/**`（JSON Schema）、必要時 `products/kith/docs/adr/**`。
- 不改任何程式、設定、migration、測試、workflow。
- 在工作階段指定的分支上開發；每個里程碑完成後開一個 **Draft PR** 到 `main`。不要直接推 `main`，不要合併自己的 PR。

## 2. 開工前必讀（依序，全部讀完才動筆）

1. `products/kith/docs/v2/README.md`：索引、優先級、ID 命名、開發規則。
2. `00-overview.md` 到 `10-decisions.md` 全部。
3. `products/kith/AGENTS.md`：kith 的禁止事項與交接格式。
4. v1 契約：`products/kith/SDD.md`、`docs/sdd/02-invariants.md`、`03-data-model.md`、`04-protocol.md`、`05-attention.md`、`09-human-chat-ui.md`、`10-members-and-mention.md`。
5. 與本次里程碑相關的**現行程式**，用來確認事實，不是用來照抄：
   - 後端路由：`products/kith/worker/index.ts`；Room：`worker/room.ts`；Inbox：`worker/inbox.ts`；hosted：`worker/hosted/*`；MCP：`worker/mcp.ts`、`worker/events.ts`。
   - schema：`products/kith/migrations/0001_v1.sql`。
   - 舊前端：`products/kith/frontend/src/**`（行為參考；v2 不沿用其視覺）。
   - sidecar：`products/kith/sidecar/**`（W6 參考）。
   - 本機開發方式：`products/kith/README.md`、`package.json`、`wrangler.toml`。

文件裡對現行程式的描述若與程式不符，以程式為準，並在文件中修正（附檔名與行號）。

## 3. 不可違反

1. **不改大框架。** `10-decisions.md` 中 `Accepted` 的決策、v1 INV-01–INV-19、v2 V2-INV-xx、BR-xx、RT-xx 是固定的。細化時發現它們有矛盾或行不通：不要自己繞過；在 `10-decisions.md` 新增 `Q-xx`（寫清楚矛盾、選項、你的建議），在 PR 說明中列出，並停止細化受影響的部分。
2. **不捏造事實。** 外部 API、CLI 旗標、函式庫 API、Cloudflare 限制，只能寫你用官方文件查證過的內容，附 URL 與查閱日期，寫進 `10-decisions.md` §4（把「待查證」改為「已查證 YYYY-MM-DD」）。查不到就寫「未查證」並新增 Q-xx，不要憑記憶補。
3. **使用者的開發規則照抄進每個里程碑文件：**
   - 不在寫完程式後補單元測試。
   - E2E 是主要且預設唯一的測試手段；每次 E2E 產出證據資料夾（`08-testing-e2e.md` §4）。
   - 必須單獨測試某個系統時，先寫出所有失敗方式（FM 清單），再寫程式。
   - 開發期間不跑全套 E2E，只跑當前里程碑的 spec。
4. **介面雙語**（zh-TW＋en，FE-05）：所有新文案都要兩種語言，同一個 key。
5. **不引入 `05-frontend-architecture.md` §1 以外的依賴**；確實需要時新增 Q-xx 說明理由。
6. 語言：繁體中文，保留必要英文術語；程式識別字、路徑、JSON key 用英文。

## 4. 每個里程碑的產出

產出 `products/kith/docs/v2/milestones/Wn.md`，章節固定如下，順序不可變：

### 4.1 範圍

- 本里程碑實作的 B-xx、BR-xx、UJ-xx、RT-xx、FM-xx、E2E ID，逐一列出（ID 必須已存在於框架章節；要新增 ID，先改框架章節並在 PR 說明）。
- 明確的「不做」清單（取自 `09-roadmap.md` 的禁止事項，再補充）。

### 4.2 先決條件

- 前一個里程碑必須 `VERIFIED` 的具體項目。
- 需要的環境：Node 版本、指令、環境變數、feature flag 的值。

### 4.3 檔案清單

表格：`路徑 | 新增/修改 | 用途（一句）| 對應任務卡`。每個會被碰到的檔案都要列出，包括 `package.json`、設定檔、`.gitignore`。實作者不得碰清單以外的檔案。

### 4.4 契約

- 每個新增或變更的 HTTP 端點、WS 封包、MCP 欄位：完整 JSON Schema 放在 `products/kith/contracts/v2/<name>.json`，文件內連結過去，並列出：方法、路徑、權限、request schema、response schema、所有錯誤碼（HTTP 狀態＋`code`＋何時發生），至少一組成功與一組失敗的範例。
- 每個新增或變更的 D1 表：完整 DDL（`migrations/000N_*.sql` 應有的內容）、每個 CHECK 的正反例、遷移步驟、rollback 說明。
- 前端 TypeScript 型別：寫出完整 `type`／`interface` 定義。

### 4.5 模組與元件規格

- 後端：每個新函式或類別的簽名、放在哪個檔案、輸入、輸出、錯誤、呼叫順序（用編號步驟或偽碼；偽碼需精確到分支條件）。
- 前端：每個元件的名稱、檔案路徑、props（完整型別）、內部狀態、資料來源（哪個 query key 或 store selector）、每個狀態下的畫面（default／loading／empty／error／offline／disabled）、`data-testid`、使用的 copy key。
- 版面：引用 `07-visual-design.md` 的 token 名，不寫裸色值、裸 px（token 表沒有的值，先加進 07）。
- 文案表：`key | zh-TW | en | 出現位置`。

### 4.6 任務卡

按實作順序編號 `Wn-T01`、`Wn-T02`…。每張卡固定欄位：

- **目標**：一句話。
- **輸入**：需要先存在的檔案或任務卡。
- **步驟**：編號步驟，每步是一個可檢查的動作（建立哪個檔、加哪個函式、改哪一行附近的哪段邏輯）。
- **完成條件**：可觀察的結果（指令輸出、畫面、API 回應）。
- **驗證**：只跑哪個 E2E spec 或哪個指令（遵守「開發期不跑全套」）。
- **對應 ID**：B／BR／FM／E2E。
- **預估大小**：S（≤ 150 行）／M（≤ 400 行）／L（需再拆）。不允許 L；遇到 L 就拆卡。

任務卡要**先寫 FM 與 E2E 相關的卡**，符合「先列失敗、測試先行」：例如先有「建立 E2E spec 骨架與斷言（預期失敗）」，再有實作卡。

### 4.7 E2E 腳本

每個 E2E ID 一節：

- 檔案：`products/kith/e2e/specs/<file>.spec.ts`，test 名稱（含 ID 與 tag，例如 `@W1`、`@mobile`）。
- 前置資料：用哪個 seed、要額外建立什麼。
- 步驟表：`# | 動作（含定位方式：role＋name 或 data-testid）| 等待條件 | 斷言 | 截圖檔名`。
- 故障注入：用到 `ws-chaos`／`fake-provider`／`fake-cli`／`page.route` 時，寫出確切指令。
- 證據：manifest `evidence` 應出現哪些項目。

### 4.8 FM 對照

表格：`FM ID | 失敗情境 | 期望行為 | 由哪個 E2E（或核准的 fixture）覆蓋 | 對應任務卡`。本里程碑涉及的每一條 FM 都要出現；沒有覆蓋的必須說明原因並新增 Q-xx。

### 4.9 交付檢查表

實作者開 PR 前必須逐項打勾的清單（文件先行、E2E 證據資料夾、`summary.md` 貼進 PR、v1 `npm test` 回歸、無秘密、連結檢查）。

## 5. 框架章節的同步

每完成一個里程碑的細化：

- 把各框架章節末尾「Phase 2 待細化」中本次已完成的項目打勾，並連到 `milestones/Wn.md` 的對應小節。細節寫在 `Wn.md`，不要把框架章節改寫成施工圖。
- `09-roadmap.md` 該里程碑狀態改成 `DOC_READY`。
- 若細化時修正了框架內容（例如更正對現行程式的描述），在 PR 說明逐條列出。

## 6. 建議順序

1. **W0**（E2E 與 web 骨架）。W0 同時完成跨里程碑的基礎：`08` 的 manifest JSON Schema、seed 資料全文、`fake-provider`／`ws-chaos`／`fake-cli` 的控制介面、`07` 的完整 token 與對比驗算、`copy/` 結構與 key 命名規則、`05` 的套件精確版本。
2. 然後依 W1 → W7。一次 PR 一個里程碑。
3. W4、W6 開始前，先完成 `10-decisions.md` §4 的外部來源查證（S2-01…S2-07），因為 adapter 與 runner 的欄位對照依賴它。

## 7. 自我審查（每個 PR 前必做）

逐項檢查，把結果寫進 PR 說明：

- [ ] **弱模型測試**：隨機抽 5 張任務卡，假裝你只讀過 `docs/v2/` 與本 `Wn.md`，逐步執行。只要有一步需要你自己選（命名、放哪、用哪個 API、錯誤時怎麼辦、文案），就補寫。
- [ ] 沒有模糊詞：全文搜尋「適當」「視情況」「等等」「etc.」「類似」「例如…之類」「TBD」「可能」，每一處都改成確定的內容，或改成 Q-xx。
- [ ] 每個 E2E ID 都有腳本；每個 FM 都有覆蓋；每張任務卡都有 ID。
- [ ] 所有路徑、檔名、函式名、元件名、query key、`data-testid`、copy key 在全文中拼法一致。
- [ ] 所有相對連結有效（可用 `python3` 腳本掃描每個 Markdown 連結的目標檔是否存在）。
- [ ] 沒有任何真實 key、token、密碼、個人資料。
- [ ] 外部事實都有來源與查閱日期，或標「未查證」並有 Q-xx。
- [ ] 沒有改動 Accepted 決策與不變量；需要改的都變成 Q-xx。

## 8. PR 說明格式

- 標題：`docs(kith): v2 Phase 2 — Wn <主題>`。
- 內容：範圍（ID 清單）、新增檔案、對框架章節的修改（逐條）、新增的 Q-xx（需要使用者決定的放最前面）、外部來源查證結果、自我審查結果（§7 逐項）。
- 說清楚哪些檢查實際執行過、哪些只是建議。

## 9. 何時停下來問使用者

- 需要改 Accepted 決策、不變量、或新增依賴。
- 官方文件與框架假設衝突（例如某格式不支援串流）。
- 一個里程碑的任務卡超過 30 張（代表里程碑太大，應提議拆分）。

問的時候：一次列完所有問題，每題附選項與你的建議，然後停止，不要自行假設繼續。

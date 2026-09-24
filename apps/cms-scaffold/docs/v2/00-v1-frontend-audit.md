# 00 — v1 前端稽核

[回 v2 索引](README.md)

日期：2026-09-24  
範圍：`apps/web-front`、`apps/web-back`、`apps/web-admin`、`packages/ui`、`packages/api`（`main` @ `a5a87bb`）。  
用途：列出 v1 前端的問題，作為 [01 SDD](01-frontend-sdd.md) 的輸入。每條有編號，SDD 與驗收條件用編號回指。

## 1. 怎麼查的

| 方法 | 結果 |
| --- | --- |
| 逐行讀三個 app 與兩個 package（約 1,200 行） | 本文的程式碼證據 |
| 對照 `docs/sdd/00-overview.md` 與 `docs/specs/surface-*.md` | 規格落差（§6） |
| `npm ci` → `typecheck` / `test` / `lint` / `build` | 全部通過（前端單元測試共 15 個） |
| 檢查三個 app 的建置 CSS | 證實共用元件的 class 沒被生成（F-01） |
| Headless Chromium（Playwright 1.63）走三個操作面，桌面 1280×800 與手機 390×844 | 截圖在 `assets/v1/`，觀察結果標「實測」 |

**限制：** 這次 Maven Central 對 Gradle 回 HTTP 429（重試兩次），`cms-api` 沒建起來。瀏覽器實測接的是一個臨時 mock API：路徑、回應形狀與種子資料照 `DemoContentSeed`、`ContentProjection`、`MediaService` 的原始碼仿製，沒有進 repo。所以本文的 UI 行為是實測，後端行為（權限、錯誤碼、分頁）是讀原始碼得出，標為「原始碼」。

## 2. 嚴重度

| 等級 | 意思 |
| --- | --- |
| **P0** | 安全問題，或整個畫面壞掉 |
| **P1** | 功能錯誤、資料可能被寫壞，或違反已定案規格 |
| **P2** | 體驗差、維護成本高，不會壞資料 |

## 3. 總結

v1 是「API 能跑通」的驗收殼，不是可交付的前端：

1. **共用 UI 套件幾乎沒有生效。** Tailwind v4 沒有掃 `packages/ui`，所以頁標題、Card、Button 的樣式大多沒生成（F-01）。三個 app 看起來像沒套 CSS 的表單。
2. **總綱凍結的 shadcn/ui 沒有被採用。** `packages/ui` 是 5 個用 `createElement` 寫的元件（F-02）。
3. **Front 登入有 open redirect**，違反 surface-front AC-13（S-01，實測）。
4. **Back 的通用編輯器不是 schema 驅動的表單**，而是「每個欄位一個文字框」：enum 要手打、ref 顯示 UUID、清不掉欄位、物件值會被存成字串（C-05）。
5. **規格定了的畫面大半沒做**：Back 沒有媒體庫、預覽、請求發布、列表篩選；Admin 沒有角色、審計、設定；Front 沒有獸醫頁、會員區、里程碑頁、SEO（§6）。

## 4. 問題清單

### F — 建置與樣式

| ID | 級 | 問題 | 證據 |
| --- | --- | --- | --- |
| F-01 | P0 | Tailwind v4 只從 app 目錄自動偵測 class，不會掃 `packages/ui/src`，所以只存在於共用元件裡的 class 沒有生成。三個 app 的建置 CSS 都沒有 `text-3xl`、`bg-[var(--panel)]`、`min-h-32`、`items-end`、`tracking-[0.2em]`；`rounded-xl` 只在 Front 出現，因為 Front 自己也寫了一次。 | 實測：每頁 `<h1>` 的計算字級都是 16px；Admin 的 Card、Button 沒有邊框和內距（`assets/v1/admin-types.png`）；看板卡片沒有內距（`assets/v1/back-board.png`） |
| F-02 | P1 | 沒有 shadcn/ui 或 Radix。`packages/ui/src/index.ts` 在 `.ts` 裡用 `createElement` 手寫 `Page`、`Button`、`Input`、`Card`、`Banner`、`Field`。違反總綱 §7 與 surface-front AC-14。 | `packages/ui/src/index.ts:1-46`；三個 app 的 `package.json` 都沒有 `@radix-ui/*` |
| F-03 | P2 | Design token 只有 7 個 CSS 變數，只有深色主題，還有硬編碼色值：`bg-[#0c1014]` 在 `Input` 和三個 `<select>` 各寫一次。 | `packages/ui/src/styles.css:3-12`、`packages/ui/src/index.ts:27`、`apps/web-back/src/views.tsx:98,218,239` |
| F-04 | P2 | 字型寫了 `"IBM Plex Sans"` 卻沒有載入；中文沒有指定 fallback。 | `packages/ui/src/styles.css:24` |
| F-05 | P2 | 三個 app 的 `<title>` 固定是 `CMS Front`／`CMS Back`／`CMS Admin`，換頁也不變。 | 實測，每頁 `document.title` 不變 |

### S — 安全

| ID | 級 | 問題 | 證據 |
| --- | --- | --- | --- |
| S-01 | P0 | Front 登入成功後，直接 `window.location.assign(search.get("next") \|\| "/")`，沒有允許清單，是 open redirect。違反 surface-front §4.1 與 AC-13。`next` 也可能是 `javascript:` 等 scheme，這點未實測。 | `apps/web-front/src/App.tsx:60`；實測：`/login?next=https://example.org/phish` 登入後被導到該外部網址 |
| S-02 | P1 | Back 與 Admin 登入表單預填種子帳號名稱 `seed-operator-album`、`seed-admin`，打進 production bundle，等於公開帳號名。 | `apps/web-back/src/App.tsx:17`、`apps/web-admin/src/App.tsx:16` |
| S-03 | P2 | CSRF token 放在 module 變數裡；每次寫入前都先 `await api.csrf()`，多一次來回。這是用來掩蓋「重新整理後 token 就不見了」的權宜做法，沒有集中處理 403 CSRF 後重試。 | `packages/api/src/index.ts:18,32`；Back／Admin 的每個寫入函式 |
| S-04 | P2 | Markdown 欄位目前當純文字輸出，所以沒有 XSS 風險；但 v2 一旦改成渲染 Markdown，就必須消毒 HTML（見 SDD §10）。 | `apps/web-front/src/App.tsx:174,190` |

### C — 正確性

| ID | 級 | 問題 | 證據 |
| --- | --- | --- | --- |
| C-01 | P1 | 單張相片頁用的是縮圖。`mediaUrl()` 優先取 `thumbnail`，詳情頁也共用同一個函式。 | `apps/web-front/src/App.tsx:10`；實測：320×240 的原圖被拉成 976×640 顯示（`assets/v1/front-photo.png`） |
| C-02 | P1 | 列表頁的初始狀態是 `items=[]`、沒有錯誤，所以載入中就先顯示空狀態文案（「還沒有公開專案」），資料到了才換掉。使用者會先看到錯誤的「沒有內容」。 | `apps/web-front/src/App.tsx:78,86,199,207`、`apps/web-back/src/App.tsx:105,113`；實測：API 延遲 1.5 秒時，畫面先顯示空狀態（`assets/v1/front-projects-loading.png`） |
| C-03 | P1 | 詳情頁把所有失敗都當成 404。網路錯誤或 5xx 也顯示「找不到相簿」。規格要求 5xx 顯示 Alert 加重試按鈕。 | `apps/web-front/src/App.tsx:117,148,234`；surface-front §4.5 |
| C-04 | P1 | 找不到頁面的處理不一致：Front 的未知路由直接導回 `/`（規格要求 `NotFoundPublic`）；Back 的 `/types` 與 Admin 的 `/audit` 渲染一個沒有內容的空殼；Back 的 `/entries/nope` 直接拿 `nope` 當頁標題。 | `apps/web-front/src/App.tsx:268`；實測：`/clinic/vets` 被導回首頁，Back `/types` 與 Admin `/audit` 沒有 `<h1>` |
| C-05 | P1 | Back 的通用編輯器不依欄位型別渲染控件：enum、ref、datetime、boolean、int 全是文字框；ref 與 media-ref 直接顯示 UUID；必填沒有標示。另有兩個會寫壞資料的問題：① 載入時把物件值 `JSON.stringify`，存檔時原樣當字串送回，型別被改掉；② 空字串的欄位直接略過不送，所以清不掉一個欄位。 | `apps/web-back/src/App.tsx:153,166-169,216-227`；實測截圖 `assets/v1/back-editor.png` |
| C-06 | P1 | 編輯器的發布、下架、封存三個按鈕不看目前狀態，一律同時顯示；沒有狀態徽章，沒有 `dirty`（已發布但工作副本有改動）提示，沒有未存檔離開的警告；409 版本衝突只顯示後端訊息字串。 | `apps/web-back/src/App.tsx:233-235`；surface-back §4.6–4.7 |
| C-07 | P1 | 可作業類型的判斷寫死在前端：只要角色是 admin，就回傳一份固定的 11 個 demo 類型清單；發布權限用角色代碼判斷，沒有用 permission。這破壞了「換一套內容類型不必重寫骨架」的目標。後端雖有 `GET /principals/{id}/effective-permissions`，但要求 `manage_principals`，作業者查不了自己，所以真正的解法需要後端補一個端點（SDD G-01）。 | `apps/web-back/src/App.tsx:47-54,125-127` |
| C-08 | P1 | 相簿編排的「上移／下移」連續送兩個 PATCH，不是原子操作：第二個失敗時，兩張照片會有相同的 `sortOrder`。原本兩張的 `sortOrder` 就相同時，交換沒有效果。 | `apps/web-back/src/views.tsx:57-73` |
| C-09 | P1 | 當日行程用 UTC 算「今天」與每筆行程的日期（`toISOString().slice(0,10)`）。在 UTC+8，早上 8 點前「今天」會是昨天，跨日的行程也會歸錯天。而且是先抓全部 visit，再在前端過濾。 | `apps/web-back/src/views.tsx:25-32,141` |
| C-10 | P2 | 看板只在第一次載入時讀 `?project=`；之後網址參數改變會被忽略。 | `apps/web-back/src/views.tsx:184-190` |
| C-11 | P2 | Front 的導覽列登入後仍顯示「登入」，沒有登出；會員路由一條都沒做，所以 Front 登入目前沒有用途。 | 實測：登入後導覽文字仍是「CMS 相簿 診所 專案 登入」 |
| C-12 | P1 | 後端的工作投影寫死讀 `title` 欄位，但 `clinic_profile` 的標題欄位是 `name`。所以 Back 列表只顯示 slug，編輯器標題也是空的。這是後端問題，會直接影響 UI。 | 原始碼：`ContentProjection.java:22`（公開投影則正確使用 `type.titleField()`）；實測截圖 `assets/v1/back-list-clinic-profile.png`（mock 照此行為仿製） |
| C-13 | P2 | Markdown 欄位（`intro`、`bio`、`description`、`summary`）在 Front 以純文字輸出。 | `apps/web-front/src/App.tsx:95,174,190,213` |
| C-14 | P2 | 圖片的替代文字：API 有提供 `altText`，前端沒用；封面圖的 `alt=""`；照片以 caption 當 alt。圖片也沒有 `width`／`height`／`loading="lazy"`，會造成版面跳動。 | `apps/web-front/src/App.tsx:93,130`；原始碼 `MediaService.java:218` |
| C-15 | P1 | 沒有分頁。後端列表一次回傳全部，`total` 就等於筆數；前端也沒有分頁介面。surface-back §3.5 定案 `page`／`size≤100`。 | 原始碼 `EntryController.java:80`、`PublicContentController.java:123` |
| C-16 | P2 | `useEffect` 內的請求沒有取消，也沒有忽略過期回應；快速切換 slug 或類型時，舊回應可能覆蓋新畫面。dev 模式下每個請求會打兩次（StrictMode），也暴露了這一點。 | 實測：同一頁的請求紀錄裡，每個 API 都出現兩次 |
| C-17 | P2 | 三個 app 各自寫了 `useMe`，編輯器掛載時又打一次 `/auth/me`；沒有共用的 session context，也沒有處理 session 過期。 | `apps/web-back/src/App.tsx:8-14,134`、`apps/web-admin/src/App.tsx:7-13` |
| C-18 | P2 | 回應不是 JSON 時（例如反向代理回 HTML 的 502），API client 會直接拋出 `JSON.parse` 的 SyntaxError，使用者看到的是「Unexpected token <」。 | `packages/api/src/index.ts:31` |
| C-19 | P2 | Admin 停用內容類型時沒有確認對話框，按一下就生效。規格把它列為危險操作。 | 實測：點「停用」沒有 dialog；surface-admin §8 |

### U — 體驗與文案

| ID | 級 | 問題 | 證據 |
| --- | --- | --- | --- |
| U-01 | P1 | 工程術語直接露給使用者看，例如「挪卡只 PATCH issue.status，不會 publish。沒有看板寫入 API。」、「草稿預覽留在 Back（工作副本），不會開 Front origin。」、「sortOrder 10」、欄位標籤「title (string)」。 | `apps/web-back/src/views.tsx:227`、`App.tsx:212,217`；截圖 `assets/v1/back-editor.png` |
| U-02 | P1 | Back 導覽列用類型代碼（`clinic_profile`、`milestone`），沒有用顯示名稱；也沒有分組或側欄。 | `apps/web-back/src/App.tsx:65` |
| U-03 | P1 | 手機版：Back 的導覽列折成三行，看板五欄直接堆疊；Front 沒有手機選單。 | 截圖 `assets/v1/back-board-mobile.png`、`assets/v1/front-album-detail-mobile.png` |
| U-04 | P2 | 沒有 skeleton、toast、breadcrumb、返回連結；操作結果用頁內 Banner 顯示，而且不會自動消失。 | 三個 app |
| U-05 | P2 | Front 首頁只是三張卡片加上工程師用語（「Front office」eyebrow），沒有站點識別、hero 或 footer。 | `apps/web-front/src/App.tsx:37-47` |

### E — 工程結構

| ID | 級 | 問題 | 證據 |
| --- | --- | --- | --- |
| E-01 | P2 | `Login`、`useMe`、`Shell`、`Forbidden` 在三個 app 裡各寫了一份，幾乎相同。 | `apps/web-back/src/App.tsx:8-45`、`apps/web-admin/src/App.tsx:7-44` |
| E-02 | P1 | API 型別是手寫的，沒有從 OpenAPI 產生；總綱規定「前端不得發明未記載的欄位」，但目前沒有任何機制保證這一點。 | `packages/api/src/index.ts:135-180` |
| E-03 | P2 | 單元測試很薄（Front 3 個、Admin 2 個）；UI e2e 不是閘門；前端開發一定要先跑 JDK 25 的 API，缺少可離線的 mock。 | 各 `App.test.tsx`；`e2e/` |
| E-04 | P2 | 版本偏舊：React 18、React Router 6。同 repo 裡正在開發的 kith v2 與 dim-gate 用的是 React 19、Router 7。 | 各 `package.json` |

## 5. v1 做對、v2 要保留的

- 三個 app 分開建置，Front 只打 `/api/v1/public/**`（AC-02 的方向正確）。
- Front 的 `PublicEntry` 型別不含 `publicationState`（AC-09 的方向正確）。
- 自訂視圖的寫入只走 entry `PATCH` 與 `POST /media`，沒有開專用寫入 API。
- 看板欄位綁的是 `issue.status` 這個 enum 欄位，不是發布狀態。
- 看板每張卡片都有 `<select>`，不依賴拖放（無障礙、好測）。

## 6. 規格落差（已定案或 Proposed，但沒有做）

| 面 | 缺少的畫面或能力 | 規格 |
| --- | --- | --- |
| Front | `/clinic/vets`、`/clinic/vets/:slug`、`/clinic/me`、預約三條路由、`/projects/:slug/milestones[/:mSlug]`、`/logout`、`NotFoundPublic`、燈箱、公開導覽（API 已有 `/public/navigation/{menuKey}`）、SEO meta、手機選單 | surface-front §4.2、§4.6、§6 |
| Back | 側欄殼、類型快速切換、Home 最近更新、列表搜尋／狀態篩選／分頁／排序、編輯器檢查器、預覽（API 已有 `/preview/entries/{id}`）、請求發布、還原（API 已有 `/restore`）、修訂紀錄（API 已有 `/revisions`）、媒體庫與媒體選擇器（API 已有 `GET /media`）、關係選擇器、`/forbidden`、`/not-found`、`returnTo` | surface-back §4 |
| Admin | Overview、類型詳情、角色與權限矩陣（API 已有 `/roles`）、使用者詳情／建立／停用／解鎖（API 已有）、審計查詢（API 已有 `/admin/audit`）、媒體治理、設定、緊急 entry 查詢、`/403`、`/404`、危險操作確認 | surface-admin §4 |

後端已經提供、但 v1 前端沒用到的端點至少有 12 組（依 `openapi.yaml` 與 controller 的對照），所以 v2 大部分畫面**不需要等後端**。真正缺的後端能力列在 [01 SDD §9](01-frontend-sdd.md#9-後端缺口前端需要的-api)。

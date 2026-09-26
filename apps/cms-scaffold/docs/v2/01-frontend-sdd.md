# 01 — 前端 v2 SDD（v0.1）

[回 v2 索引](README.md)

狀態：**Draft v0.1**（第一版，待細化）  
日期：2026-09-24（2026-09-25 更新：§9、§12、§13 依 owner 決定改寫；同日 W0 細化：§5 補 token、§6.2 `AppFrame` 側欄、新增 §13.3；2026-09-26 W2 細化：§6、§7.2、§9、§12 補施工細節連結，新增 §13.5）  
讀者：負責重寫前端的 LLM agent，以及審這些 PR 的人  
輸入：[00 v1 前端稽核](00-v1-frontend-audit.md)、[總綱](../sdd/00-overview.md)、[surface-front](../specs/surface-front.md)、[surface-back](../specs/surface-back.md)、[surface-admin](../specs/surface-admin.md)

---

## 0. 本文的權威範圍

| 題目 | 權威來源 | 本文的角色 |
| --- | --- | --- |
| 三個操作面、kernel 切面、技術棧大類 | 總綱 `00-overview.md`（凍結） | 遵守，不改 |
| 各面的路由、權限、空狀態與失敗語義、驗收 | `surface-*.md` | 沿用；v2 只補畫面與互動 |
| 前端架構、套件切分、視覺語言、畫面佈局、元件、實作波次 | **本文** | 權威 |
| API 契約 | `services/cms-api/.../openapi.yaml` | 前端只消費；缺口列在 §9 |

本文與 surface 規格衝突時：**權限與資料可見性**以 surface 規格為準；**視覺、佈局、元件選型**以本文為準。已知衝突列在 §13.2。

**v2 的定義：** 重寫三個前端 app 與共用 packages。後端的配套變更由 [02 後端 SDD](02-backend-sdd.md) 規劃，前端需要的缺口列在 §9。

---

## 1. 目標與非目標

### 1.1 目標

1. **能交付的三個操作面。** 修掉 [00](00-v1-frontend-audit.md) 所有 P0／P1 項目，補齊 surface 規格已定案的畫面。
2. **Shopify 級的作業體驗。** Back 與 Admin 採用 Shopify admin 的資訊架構與互動模式；Front 採用 Shopify storefront 主題的版面語言（§2）。
3. **Schema 驅動。** 換一套內容類型，Back 的列表與編輯器不必改程式碼（總綱 §1 成功標準）。
4. **LLM agent 可以安全地分波實作。** 每一波範圍小、有明確完成定義與可執行的驗收指令，前端開發不依賴 JDK 25（§11.3）。

### 1.2 非目標（v2）

- 不做主題編輯器、拖放頁面建構器（Shopify theme editor 那一類）。Front 的區塊組合寫在程式碼的 registry 裡。
- 不做 SSR／Next.js（總綱 §7 禁止）。SEO 依 surface-front §4.6，是 SPA 加文件級 meta。
- 不做多語系框架。v2 只有 zh-Hant，但所有使用者可見字串集中在 copy 檔（§10.3），方便以後加。
- 不做即時協作、通知中心、全文搜尋（總綱 out of scope）。
- 不把 Back 與 Admin 合成一個 app。

---

## 2. Shopify 參考：借什麼、不借什麼

借的是**資訊架構與互動模式**，不是品牌外觀，也不引入 Shopify 的套件（理由見 D-02）。

### 2.1 Back 與 Admin ← Shopify admin（Polaris）

| Shopify 模式 | 在 Shopify 裡 | 在本專案 |
| --- | --- | --- |
| **App frame**：頂列 + 左側欄 + 主區 | 頂列放搜尋與帳號；側欄是主要物件（訂單、商品、客戶） | Back：側欄是「可作業的內容類型 + 自訂視圖 + 媒體」；Admin：側欄是 7 個治理項（surface-admin §4.3） |
| **Resource index layout** | 商品列表：頁首 + 狀態 tab + 搜尋與篩選列 + IndexTable | `/entries/:type`：tab「全部／草稿／已發布／已封存」+ 搜尋 + schema 裡標為 `filterable` 的篩選 + 表格 + 分頁 |
| **Resource details layout** | 商品頁：主欄是多張卡片（標題描述、媒體、價格），右側欄是狀態與組織資訊 | `/entries/:type/:id`：主欄是欄位分組卡片；右欄是「發布狀態」「關聯」「中繼資料」卡 |
| **Page header** | 返回箭頭、標題、狀態 badge、次要動作（More actions）、主要動作 | 同樣結構；主要動作依權限與狀態決定（surface-back §4.7） |
| **Contextual save bar** | 表單一改動，頂列就變成「未儲存的變更　[捨棄] [儲存]」 | 取代 v1 的「儲存草稿」按鈕；離開頁面前攔截（修 C-06） |
| **Badge tones** | 狀態用有語義的色調（成功、注意、資訊） | `draft`＝中性、`published`＝成功、`archived`＝淡灰、`dirty`＝注意（「有未發布的變更」） |
| **Empty state** | 插圖 + 一句說明 + 主要動作 | 依有無 `create` 權限顯示或隱藏 CTA（surface-back §4.5） |
| **Toast** | 動作結果短暫提示 | 取代 v1 常駐的 Banner（修 U-04） |
| **Files／媒體** | Content → Files 網格；商品媒體可拖曳排序 | `/media` 網格；相簿編排可拖曳排序 |
| **Settings（annotated layout）** | 左邊是區塊說明，右邊是設定卡 | Admin `/settings/*` |

### 2.2 Front ← Shopify storefront 主題（Horizon／Dawn 一系）

| Shopify 模式 | 在本專案 |
| --- | --- |
| Header：品牌、主導覽、帳號圖示；手機改成抽屜 | `SiteHeader`；手機用 `Sheet`（surface-front §6.1） |
| Section／block 堆疊的首頁 | 每個站的首頁由 section registry 組成（Hero、CollectionGrid、RichText、Timeline） |
| Collection grid（商品卡網格） | 相簿列表、獸醫列表、專案列表 |
| Product page（左媒體圖庫、右資訊欄） | 單張相片頁、獸醫頁、專案頁 |
| Color schemes（每區塊可選配色） | 每個站一組配色（§5.3）：相簿深色畫廊、診所溫暖淺色、專案中性 |
| Footer | 站點資訊、回選擇器、（可選）外部連到 Back 的連結（surface-front §4.1 允許） |

Horizon 是 Shopify 2025 年推出、取代 Dawn 的預設主題，特色是可巢狀的 theme blocks。本專案只借它的**版面語言**，不做 block 編輯器。

---

## 3. 決策

| ID | 決策 | 理由 | 狀態 |
| --- | --- | --- | --- |
| D-01 | 維持三個 Vite + React + TypeScript app，分開建置、分開 origin | 總綱凍結 | Decided |
| D-02 | UI kit 用 **shadcn/ui（Radix）+ Tailwind v4**，**不**用 Polaris（React 或 web components）；在 shadcn 之上自建 Polaris 式的模式元件（§6） | 總綱 §7 凍結 shadcn；Polaris 的定位是讓 app 在 Shopify admin 裡看起來原生，拿到獨立產品是綁上不需要的生態。借模式比借套件便宜 | Decided（Q-01） |
| D-03 | 升級到 React 19、React Router 7（data router + lazy route）、TanStack Query 5 | 與同 repo 的 kith v2、dim-gate 對齊（E-04）；Query 解決 C-02、C-16、C-17 | Proposed |
| D-04 | API client 從 `openapi.yaml` 產生（`openapi-typescript` + `openapi-fetch`），手寫型別禁止 | 總綱「前端不得發明未記載欄位」要有機制保證（E-02） | Proposed |
| D-05 | 表單用 `react-hook-form` + `zod`；zod schema 在執行期由 content type 的欄位定義產生 | 讓 schema 驅動（surface-back §3.1）並修 C-05 | Proposed |
| D-06 | 共用程式碼分四個 package（§4.2），三個 app 只剩路由與畫面組裝 | 修 E-01；總綱允許共享 `packages/ui` | Proposed |
| D-07 | Back 與 Admin 用淺色為主、Shopify admin 式的中性配色；Front 各站自有配色。深色模式 v2 只給 Front 相簿站 | Shopify admin 本身是淺色為主；作業面的長時間閱讀與表格密度在淺色下較好。v1 全深色、又沒生效（F-01、F-03） | Decided（Q-04） |
| D-08 | Markdown 用 `react-markdown`，**不**啟用 raw HTML（不裝 `rehype-raw`） | 預設就安全（S-04） | Proposed |
| D-09 | 前端開發與測試用 **MSW** 模擬 API，fixture 依 `DemoContentSeed` 撰寫，回應型別用產生的 OpenAPI 型別檢查 | 前端 agent 不必裝 JDK 25 或依賴 Maven Central（稽核 §1 的教訓） | Proposed |
| D-10 | 拖放用 `@dnd-kit`，而且每個可拖的操作都要有非拖放的替代方式（鍵盤、選單） | surface-back §4.11 已允許 dnd-kit；無障礙與測試不能依賴拖放 | Proposed |

---

## 4. 架構

### 4.1 倉庫形狀

```
apps/
  web-front/        # 路由 + 各站 section registry + 頁面
  web-back/         # 路由 + 自訂視圖 registry + 頁面
  web-admin/        # 路由 + 頁面
packages/
  ui/               # shadcn 元件 + tokens + Polaris 式模式元件（§6）
  api/              # 由 OpenAPI 產生的 client + session／CSRF／錯誤正規化 + Query hooks
  fields/           # 欄位型別 → widget、zod 產生器、顯示格式化（Back 與 Admin 用）
  auth/             # SessionProvider、LoginPage、RequireSurface、returnTo 允許清單
  mocks/            # MSW handlers + 種子 fixture（dev 與測試共用）
```

依賴方向：`apps/* → packages/{auth,fields,ui,api}`；`fields → ui, api`；`auth → ui, api`；`ui` 不依賴 `api`。

**Front 的隔離（surface-front AC-08）：** `web-front` 只能 import `api` 的 `public` 子路徑（`@cms/api/public`）。該子路徑只包含 `/api/v1/public/**` 與 `/auth/*` 的函式與型別。用 ESLint `no-restricted-imports` 與一個建置後的 bundle 掃描測試來保證。

### 4.2 Package 職責

| Package | 對外提供 | 修掉的稽核項 |
| --- | --- | --- |
| `@cms/ui` | shadcn 元件；`tokens.css`（§5）；模式元件：`AppFrame`、`PageHeader`、`IndexTable`、`IndexFilters`、`ResourceLayout`、`ContextualSaveBar`、`EmptyState`、`StatusBadge`、`SkeletonPage`；以及用 `@source` 讓 Tailwind 掃描本 package | F-01、F-02、F-03、F-04、U-04 |
| `@cms/api` | `createCmsClient()`；統一錯誤型別 `ApiError { status, code, message, fieldErrors? }`；非 JSON 回應正規化；CSRF 自動取得與「收到 CSRF 403 時重試一次」；TanStack Query 的 key factory 與 hooks | S-03、C-16、C-18、E-02 |
| `@cms/fields` | `FieldWidget` registry（§6.4）；`buildZod(fields)`；`toFormValues`／`toPayload`（型別保真、可清空欄位）；列表欄位格式化 | C-05 |
| `@cms/auth` | `SessionProvider`（`/auth/me` 只打一次，401 時統一處理）；`<RequireSurface surface="back">`；`LoginPage`（無預填帳號）；`safeReturnTo(path)` | S-01、S-02、C-11、C-17、E-01 |
| `@cms/mocks` | 三個面的 MSW handler；可切換延遲、錯誤、空資料 | E-03 |

### 4.3 資料流與狀態規則

- **伺服器狀態**只放在 TanStack Query；元件本地狀態只放在 UI 暫態（例如 dialog 開關）。不另外引入全域 store。
- **每個 query 都要支援取消**（Query 會把 `signal` 傳給 fetch）。
- **Query key** 一律從 factory 產生：`keys.entries.list(type, params)`、`keys.entries.detail(id)`，以便 mutation 後精準 invalidate。
- **寫入**：mutation 成功後更新 detail 快取，並讓對應 list 失效；看板與相簿編排用樂觀更新，失敗就回滾並顯示 toast。
- **409 版本衝突**：保留使用者的本地表單，顯示 dialog「這筆資料已被其他人更新」，選項為「載入最新版本（放棄我的變更）」或「繼續編輯」。不靜默覆蓋（surface-back §4.10）。
- **Session 過期（401）**：若有未存的變更，先警告；之後導到登入頁並帶上 `returnTo`。

### 4.4 URL 與狀態

列表的篩選、搜尋、排序、分頁全部放在 URL query（`?state=draft&q=coast&page=2&sort=-updatedAt`）。可以分享、重新整理不會遺失，也方便 e2e 直接打網址。

§4 的施工細節（套件內容、query key、錯誤正規化）見 [`waves/W0.md`](waves/W0.md) §4.2、§4.3、§5.0～§5.6。

---

## 5. 視覺語言（tokens）

### 5.1 原則

1. **內容先、裝飾後。** 作業面白底卡片、灰底頁面，顏色只拿來表達狀態與主要動作。
2. **一頁一個主要動作。** 頁首右上角只有一個實心按鈕，其餘收進次要按鈕或「更多動作」選單。
3. **狀態一律用 badge**，不在文字裡寫 `· published`。
4. **沒有工程術語**（修 U-01）：不出現 `PATCH`、`sortOrder`、`origin`、型別代碼。欄位標籤用 schema 的顯示名稱；沒有顯示名稱時，把 key 轉成人讀格式（見 §9 的 G-06）。

### 5.2 作業面 tokens（Back、Admin）

以下是**近似 Shopify admin 觀感的起始值，不是 Polaris 官方 token**。W0 以 WCAG 對比度檢查為準再定案。

| Token | 淺色值 | 用途 |
| --- | --- | --- |
| `--bg` | `#F1F1F1` | 頁面底色 |
| `--surface` | `#FFFFFF` | 卡片、表格、dialog |
| `--surface-subdued` | `#F7F7F7` | 表頭、次要區塊 |
| `--border` | `#E3E3E3` | 卡片與表格分隔 |
| `--border-strong` | `#8A8A8A` | 輸入框外框（W0 新增；UI 元件需 ≥ 3:1） |
| `--surface-hover` | `#EBEBEB` | 懸停、目前的導覽項（W0 新增） |
| `--text` | `#303030` | 主要文字 |
| `--text-subdued` | `#616161` | 說明、中繼資料 |
| `--primary` | `#303030` | 主要按鈕（深色實心，Shopify admin 的做法） |
| `--primary-fg` | `#FFFFFF` | |
| `--focus` | `#005BD3` | 焦點環，2px |
| `--critical` | `#8E1F0B`（文字）／`#FEE9E8`（底） | 危險動作、錯誤 |
| `--success` | `#0C5132`／`#CDFEE1` | `published` badge |
| `--caution` | `#5E4200`／`#FFF1C2` | `dirty`、請求發布中 |
| `--info` | `#00527C`／`#E0F0FF` | 提示 |
| 圓角 | 卡片 12px、控件 8px、badge 全圓 | |
| 陰影 | 卡片 `0 1px 0 rgba(0,0,0,.07)` 加 1px border | 扁平、不浮誇 |
| 字型 | W0 定案：系統字型 `ui-sans-serif, system-ui, -apple-system, "Segoe UI", "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif`，不載入網路字型；字重 450／550／650（沒有可變字重的系統字型會取最接近的字重） | 修 F-04 |
| 字級 | 正文 14px／20px；表格 13px；頁標題 20px／650；卡片標題 14px／650 | 中文在 13px 以下可讀性差，所以正文用 14px |
| 間距 | 4px 基數；卡片內距 16px；卡片之間 16px；頁面左右 24px（手機 16px） | |

**Admin 與 Back 的區別：** 同一套語言，靠頂列辨識。Admin 頂列左側顯示「Admin center」字樣，並在頂列下緣加一條 `--admin-accent`（暫定 `#8A3FFC`）；Back 沒有這條色帶。目的只是讓使用者不會搞錯自己在哪個面；兩個面真正的差別是資訊架構（總綱 §13-3）。

### 5.3 Front tokens（每站一組配色）

| 站 | 底色 | 文字 | 強調 | 性格 |
| --- | --- | --- | --- | --- |
| 選擇器 `/` | `#FAFAF7` | `#1A1A1A` | `#1A1A1A` | 中性、像 Shopify 主題的預設配色 |
| 相簿 `/album` | `#111111` | `#F2F2F2` | `#F2F2F2` | 深色畫廊，讓照片成為主角 |
| 診所 `/clinic` | `#F7F4EE` | `#2A2A26` | `#2F6B4F` | 溫暖、可信任 |
| 專案 `/projects` | `#FFFFFF` | `#1F2328` | `#0B57D0` | 乾淨、偏文件感 |

Front 的字型：標題用 `"Noto Serif TC", Georgia, serif`（相簿、診所），內文用 `Inter, "Noto Sans TC"`。版面最大寬度 1200px；內容文字欄最大 68ch。

W0 定案（細化時補上的值）：每站另有 `--surface`、`--surface-subdued`、`--surface-hover`、`--border`、`--border-strong`、`--text-subdued`、`--primary-fg`、`--focus`（相簿站 `#4C9AFF`）；字型同 §5.2 改用系統字型堆疊（相簿、診所的標題為 `"Noto Serif TC", "Songti TC", Georgia, serif`）；Front 字級為內文 16px／26px、區塊標題 22px／30px（600）、頁標題 32px／40px（600）。

§5 的施工細節（全部定案值與 WCAG 對比度計算）見 [`waves/W0.md`](waves/W0.md) §4.4。

---

## 6. 元件

### 6.1 shadcn 基礎元件（只從 `@cms/ui` 取用）

`Button`、`Input`、`Textarea`、`Select`、`Checkbox`、`Switch`、`RadioGroup`、`Label`、`Form`、`Card`、`Badge`、`Table`、`Tabs`、`Dialog`、`AlertDialog`、`Sheet`、`Popover`、`Calendar`、`Command`、`DropdownMenu`、`Tooltip`、`Breadcrumb`、`Pagination`、`Separator`、`Skeleton`、`ScrollArea`、`Avatar`、`Sonner`、`Sidebar`。

`AspectRatio`、`Carousel` 只給 Front 用。

W0 只加入其中 11 個（`Alert`、`Badge`、`Button`、`Card`、`DropdownMenu`、`Input`、`Label`、`Separator`、`Sheet`、`Skeleton`、`Textarea`），其餘由第一個用到的波次加入。施工細節見 [`waves/W0.md`](waves/W0.md) §4.9、§5.3。W1 加入 `Table`、`Tabs`、`Select`、`RadioGroup`、`Switch`、`Dialog`、`AlertDialog`、`Popover`、`Calendar`；`Sonner` 由 `@cms/ui` 的 `Toaster` 直接包 `sonner`（上游 `sonner.tsx` 依賴 `next-themes`）；施工細節見 [`waves/W1.md`](waves/W1.md) §4.9、§5.2.3。W2 不新增 shadcn 元件（[`waves/W2.md`](waves/W2.md) §4.9）。

### 6.2 模式元件（Polaris 式，建在 shadcn 之上）

| 元件 | 行為契約 |
| --- | --- |
| `AppFrame` | 頂列（產品名、全域搜尋或類型快速切換、帳號選單）+ 側欄 + 主區。窄於 1024px 時側欄收成 `Sheet`。側欄是語意化的 `<aside>`＋`<nav>`，不用 shadcn `Sidebar`（它的行動版斷點是 768px，另帶 cookie 狀態與快捷鍵；W0 細化時決定）。 |
| `PageHeader` | `backTo?`、`title`、`badges?`、`secondaryActions?`（多於兩個就收進「更多動作」選單）、`primaryAction?`。標題同時寫入 `document.title`（修 F-05）。 |
| `IndexFilters` | 狀態 tab、搜尋框（debounce 300ms）、篩選 chip、排序選單；全部與 URL query 同步。 |
| `IndexTable` | 欄位定義由呼叫方給；支援 loading skeleton、空狀態插槽、整列可點（連結是真正的 `<a>`，可開新分頁）。v2 不做批次選取（見 Q-05）。 |
| `ResourceLayout` | 兩欄（主欄 2fr、側欄 1fr）；窄於 1024px 時變單欄，側欄卡片排在主欄之後。 |
| `ContextualSaveBar` | `isDirty` 時取代頂列內容：「未儲存的變更　[捨棄] [儲存]」；同時掛 `beforeunload` 與路由離開攔截。 |
| `EmptyState` | 插圖（線條圖示即可）+ 標題 + 說明 + 可選的主要動作。 |
| `StatusBadge` | 輸入 `publicationState` 與 `dirty`，輸出一或兩個 badge。 |
| `QueryBoundary` | 包住一個 query 的四種狀態：loading → `Skeleton`；空 → `EmptyState`；錯誤 → 行內 Alert + 重試；404／403 → 交給路由層。**載入中永遠不顯示空狀態**（修 C-02）。 |

W0 做 `AppFrame`、`PageHeader`、`EmptyState`、`QueryBoundary`；施工細節見 [`waves/W0.md`](waves/W0.md) §5.2。W1 做 `IndexFilters`、`IndexTable`、`ResourceLayout`、`ContextualSaveBar`、`StatusBadge`，另加上表沒有的 `IndexPagination`（「共 N 筆」、上一頁／下一頁、每頁筆數）與 `Toaster`，並給 `PageHeader` 加 `moreActions`；施工細節見 [`waves/W1.md`](waves/W1.md) §5.2。

### 6.3 Front 區塊元件（section registry）

`SiteHeader`、`SiteFooter`、`Hero`、`CollectionGrid`、`MediaFigure`、`LightboxDialog`、`ProductLayout`（媒體 + 資訊欄）、`MarkdownBody`、`Timeline`、`EmptyPublished`、`NotFoundPublic`、`ErrorPublic`、`MemberGate`。

每個站用一份 TS registry 宣告自己的首頁區塊順序與資料來源，例如：

```ts
export const albumSite: SiteDefinition = {
  mount: "album",
  basePath: "/album",
  scheme: "gallery-dark",
  home: [
    { section: "Hero", source: { type: "page", slug: "home" }, fallback: { title: "相簿" } },
    { section: "CollectionGrid", source: { type: "album" }, card: "albumCard" },
  ],
};
```

### 6.4 欄位 widget registry（Back）

| 欄位型別 | Widget | 列表顯示 | 備註 |
| --- | --- | --- | --- |
| `string` | `Input` | 原文 | 名為 `titleField` 的欄位放在第一張卡的最上面，字級加大 |
| `markdown` | `Textarea` + 「預覽」tab | 截斷 80 字的純文字 | v2 不做 WYSIWYG |
| `int` | `Input type=number` | 數字 | 空值送 `null`，不送 `0` |
| `boolean` | `Switch` | 勾或空白 | |
| `enum` | 選項 ≤5 用 `RadioGroup`，否則用 `Select` | `Badge` | 選項顯示名待後端提供（G-06），暫時把 key 轉成人讀格式 |
| `datetime` | 日期（`Calendar` + `Popover`）+ 時間輸入；以使用者時區顯示，以 ISO UTC 儲存 | 本地時間 | 修 C-09 |
| `ref` | `RelationPicker`：顯示目標的標題與狀態 badge；按鈕打開 `Command` 對話框，以 `q` 搜尋 | 目標標題 | 絕不顯示原始 UUID |
| `media-ref` | `MediaPicker`：縮圖 +「更換」／「移除」；對話框有兩個 tab：媒體庫、上傳 | 縮圖 | surface-back §4.8 |
| `principal-ref` | `PrincipalPicker` | 顯示名稱 | 依賴 G-04 |
| 未知型別 | 唯讀 JSON 區塊 + 警告 | `—` | 存檔時原樣送回，不刪除該鍵（surface-back §3.1） |

**序列化規則（修 C-05）：** `toFormValues` 與 `toPayload` 必須互為反函數，並用 property test 覆蓋；清空欄位時送 `null`（或 Content 規定的等價值，見 G-07），不可以略過不送。

W1 實作本表除 `RelationPicker`、`MediaPicker`、`PrincipalPicker` 之外的全部 widget；在 W2 之前 `ref`、`media-ref`、`principal-ref` 唯讀顯示（標題＋狀態、縮圖＋標題、「已連結會員帳號」）。enum 的顯示名稱改用 BW1a 的 `enumLabels`（G-06 已由 BW1a 處理）。施工細節見 [`waves/W1.md`](waves/W1.md) §5.3。

W2 實作 `RelationPicker`（`ref`，對話框以 `Input`＋`RadioGroup` 搜尋，不用 `Command`，免裝 `cmdk`）與 `MediaPicker`（`media-ref`，媒體庫＋上傳兩個 tab）；`PrincipalPicker` 因 Q-13 維持唯讀。施工細節見 [`waves/W2.md`](waves/W2.md) §5.0.5、§5.3。

---

## 7. 路由與畫面

狀態欄：**v1** ＝已有、要重做；**新** ＝v1 沒有、API 已具備；**缺口** ＝需要 §9 的後端變更。

### 7.1 Front（`apps/web-front`）

| 路徑 | 畫面 | 狀態 |
| --- | --- | --- |
| `/` | 選擇器 | v1 |
| `/login`、`/logout` | 會員登入、登出 | v1／新 |
| `/album`、`/album/albums` | 相簿首頁、相簿列表 | v1 |
| `/album/albums/:slug` | 相片牆 + 燈箱 | v1（燈箱：新） |
| `/album/photos/:slug` | 單張相片 | v1 |
| `/clinic`、`/clinic/vets`、`/clinic/vets/:slug` | 診所首頁、獸醫列表、獸醫頁 | v1／新／新 |
| `/clinic/me`、`/clinic/appointments/new`、`/clinic/appointments/:id` | 會員區 | 缺口（G-08） |
| `/projects`、`/projects/:slug` | 專案列表、專案頁 | v1 |
| `/projects/:slug/milestones`、`/projects/:slug/milestones/:mSlug` | 里程碑 | 新 |
| `*` | `NotFoundPublic`（**不**導回首頁，修 C-04） | 新 |

#### F-S1 相簿站首頁（桌面）

```
┌──────────────────────────────────────────────────────────────────────┐
│  ◼ 相簿            相簿   最新照片                          [登入]   │  SiteHeader（gallery-dark）
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   Coast Light                                                        │  Hero：page(home) 或 fallback
│   海與混凝土的一年。                                                  │
│                                                                      │
│   相簿                                                    全部相簿 → │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               │  CollectionGrid：4:3 封面
│   │   (封面 4:3)  │  │              │  │              │               │  桌面 3 欄／平板 2 欄／手機 1 欄
│   └──────────────┘  └──────────────┘  └──────────────┘               │
│   Coast Light 2026   Unlisted proof                                  │
│   6 張 · 2026-09     …                                               │
│                                                                      │
├──────────────────────────────────────────────────────────────────────┤
│  CMS Scaffold · 回到選擇器                                            │  SiteFooter
└──────────────────────────────────────────────────────────────────────┘
```

#### F-S2 相片牆 + 燈箱

```
 相簿 / Coast Light 2026                                  ← Breadcrumb
 Coast Light 2026                                          ← h1（Noto Serif TC）
 Sea and concrete.                                         ← MarkdownBody

 ┌─────┐┌─────┐┌─────┐        每格 1:1、object-cover、thumbnail 變體、
 │     ││     ││     │        loading="lazy"、帶 width/height（修 C-14）
 └─────┘└─────┘└─────┘        點一下 → LightboxDialog；Ctrl／⌘ 點 → 開單張頁
 ┌─────┐┌─────┐┌─────┐

 LightboxDialog（Radix Dialog，全螢幕黑底）
 ┌────────────────────────────────────────────────┐
 │                                          ✕     │
 │   ‹           (web 變體，contain)           ›   │  ← / → 鍵切換；Esc 關閉
 │                                                │  URL 同步為 ?photo=coast-sun
 │   Late sun · Late sun on the flats.     3 / 6  │
 └────────────────────────────────────────────────┘
```

#### F-S3 單張相片頁（product page 版面）

```
 ┌──────────────────────────────┬────────────────────────┐
 │                              │  Coast Light 2026 ↗    │  ← 所屬相簿連結
 │   (web 變體，≥1200 寬)        │  Late sun              │  ← h1
 │   修 C-01：詳情頁一定用 web    │  Late sun on the flats.│
 │                              │  拍攝：2026-03-01       │  ← takenAt（若有）
 │                              │  ‹ 上一張   下一張 ›    │
 └──────────────────────────────┴────────────────────────┘
 手機：單欄，圖在上。
```

#### F-S4 診所首頁

```
 Cedar Pet Clinic                     [預約看診]     ← 未登入時連到 /login?next=/clinic/appointments/new
 A small neighbourhood clinic for **well** animals.  ← MarkdownBody（修 C-13）
 ┌ 地址 ─────────┐ ┌ 電話 ─────────┐ ┌ 門診時間 ──────┐
 │ 14 Cedar St.  │ │ 608-555-3000  │ │ 週一至週五 8–17 │
 └───────────────┘ └───────────────┘ └────────────────┘
 我們的獸醫                                   全部獸醫 →
 ┌────────────┐ ┌────────────┐
 │ (頭像)      │ │ (頭像)      │   VetCard：照片、姓名、專長 Badge、bio 前兩行
 │ James Carter│ │ Helen Leary │
 │ [放射科]    │ │ [牙科]      │
 └────────────┘ └────────────┘
```

#### F-S5 專案頁 + 里程碑時間線

```
 專案 / CMS Scaffold
 CMS Scaffold                         [進行中]     ← lifecycle Badge
 Reusable CMS kernel with three surfaces.
 里程碑
  ●─ M1 Specs        已規劃   2026-10-01
  │
  ●─ M2 Kernel       已規劃
  │
  ○─ M3 Surfaces     已規劃
 （不顯示 issue：surface-front AC-06）
```

#### F-S6 狀態頁

| 狀態 | 畫面 |
| --- | --- |
| 載入中 | 與完成後版面相同的 `Skeleton`（封面、標題列） |
| 列表空 | `EmptyPublished`：「還沒有公開相簿」＋說明（surface-front §4.5 copy） |
| 404／未發布／未知路由 | `NotFoundPublic`：「找不到這個頁面」＋「回到 {站名} 首頁」；`<meta name="robots" content="noindex">` |
| 5xx／網路錯誤 | `ErrorPublic`：「暫時無法載入」＋「重試」按鈕（修 C-03） |

### 7.2 Back（`apps/web-back`）

| 路徑 | 畫面 | 狀態 |
| --- | --- | --- |
| `/sign-in` | 登入（`/login` 永久轉址到這裡，與 surface-back §4.2 一致） | v1 |
| `/` | Home | v1 |
| `/entries/:type` | Resource index | v1 |
| `/entries/:type/new`、`/entries/:type/:id` | Resource details | v1 |
| `/entries/:type/:id/preview` | 編輯器內預覽 | 新（`GET /preview/entries/{id}`） |
| `/entries/:type/:id/history` | 修訂紀錄與還原 | 新（`/revisions`、`/revert`） |
| `/views/album.composer`、`/views/clinic.schedule`、`/views/projects.board` | 自訂視圖 | v1 |
| `/media`、`/media/:id` | 媒體庫 | 新（`GET /media`） |
| `/forbidden`、`/not-found` | 403、404 | 新 |

#### B-S1 殼層

```
┌────────────────────────────────────────────────────────────────────────┐
│ ◼ CMS 作業台     [ 🔍 跳到類型或條目…  ⌘K ]                  (SA) ▾    │ 頂列
├───────────────┬────────────────────────────────────────────────────────┤
│ ⌂ 首頁        │                                                        │
│               │                                                        │
│ 內容          │                                                        │
│  ▸ 相簿       │   主區（PageHeader + 內容）                              │
│  ▸ 相片       │                                                        │
│  ▸ 獸醫       │                                                        │
│ 視圖          │                                                        │
│  ▸ 相簿編排   │                                                        │
│  ▸ 看板       │                                                        │
│ 媒體          │                                                        │
│  ▸ 媒體庫     │                                                        │
└───────────────┴────────────────────────────────────────────────────────┘
```

- 側欄項目由「目前使用者對哪些類型有 `read_draft`／`create`／`update`」產生，**不**寫死類型清單（修 C-07）。資料來源見 G-01。
- 顯示名稱用 `pluralDisplayName`（修 U-02）。
- 帳號選單：顯示名、角色標籤、「查看公開網站 ↗」、登出。零條 Admin 連結（surface-back §3.6）。

#### B-S2 Resource index：`/entries/album`

```
 相簿                                                     [新增相簿]
┌──────────────────────────────────────────────────────────────────┐
│ 全部  草稿  已發布  已封存                                         │ ← tab = ?state=
│ [🔍 搜尋標題…            ]  [可見性 ▾]  [排序：最近更新 ▾]          │ ← filterable enum、sort
├──────────────────────────────────────────────────────────────────┤
│ 封面  標題                  狀態            可見性     更新時間     │
│ ▢     Coast Light 2026     [已發布]         公開       2 小時前     │
│ ▢     Studio (unpublished) [草稿]           公開       1 天前       │
│ ▢     Unlisted proof       [已發布][有變更]  不公開列出  3 天前     │
├──────────────────────────────────────────────────────────────────┤
│                                             ‹ 1 2 3 ›  每頁 20    │
└──────────────────────────────────────────────────────────────────┘
```

- 欄位：標題（`titleField`）+ 狀態 + schema 中 `listable` 的欄位 + 更新時間。`listable` 目前後端沒有，見 G-05。
- 空狀態依權限顯示（surface-back §4.5）；篩選結果為空時顯示「沒有符合的條目」＋「清除篩選」。

#### B-S3 Resource details：`/entries/album/:id`

```
 ← 相簿
 Coast Light 2026  [已發布][有未發布的變更]          [預覽] [更多 ▾] [發布變更]
┌──────────────────────────────────────────┬──────────────────────────┐
│ ┌ 基本資料 ───────────────────────────┐  │ ┌ 發布 ───────────────┐  │
│ │ 標題 *                               │  │ │ 狀態：已發布         │  │
│ │ [Coast Light 2026                  ] │  │ │ 最後發布：9/05 10:00 │  │
│ │ 描述                  [編輯 | 預覽]  │  │ │ [下架]               │  │
│ │ [Sea and concrete.                 ] │  │ └──────────────────────┘  │
│ └──────────────────────────────────────┘  │ ┌ 網址 ───────────────┐  │
│ ┌ 媒體 ───────────────────────────────┐  │ │ slug                 │  │
│ │ 封面  [▣ Harbour wall]  更換 · 移除   │  │ │ [coast-light-2026  ] │  │
│ └──────────────────────────────────────┘  │ │ /album/albums/coast… ↗│  │
│ ┌ 設定 ───────────────────────────────┐  │ └──────────────────────┘  │
│ │ 可見性   (•) 公開  ( ) 不公開列出     │  │ ┌ 中繼資料 ───────────┐  │
│ │ 排序方式 [手動 ▾]                    │  │ │ ID  8776dd13… ⧉      │  │
│ └──────────────────────────────────────┘  │ │ 版本 3 · 更新 2 小時前│  │
│                                          │ │ 修訂紀錄 →           │  │
│                                          │ └──────────────────────┘  │
└──────────────────────────────────────────┴──────────────────────────┘

 有未存變更時，頂列變成：
┌────────────────────────────────────────────────────────────────────┐
│  未儲存的變更                                        [捨棄]  [儲存]  │ ContextualSaveBar
└────────────────────────────────────────────────────────────────────┘
```

- 欄位分組：`titleField` 與 `string`／`markdown` 放「基本資料」；`media-ref` 放「媒體」；`ref` 放在側欄「關聯」卡；其餘放「設定」。後端若日後提供 `group`，就改用後端的分組（G-05）。
- 主要動作依權限與狀態，只顯示一個（surface-back §4.7）：draft 且可發布 →「發布」；draft 且只能更新 →「請求發布」（G-03）；published 且 `dirty` →「發布變更」；published 且不 dirty → 沒有主要動作，側欄有「下架」。「封存」與「移到回收」收進「更多」選單，都要 `AlertDialog` 確認（修 C-06）。
- `slug` 下方顯示 Front 的公開網址（只在已發布時可點，開新分頁）。
- 必填欄位標 `*`，並在送出前用 zod 做即時驗證；後端回 422 時把錯誤對到欄位上。

B-S1～B-S3、Home、`/forbidden`、`/not-found` 的施工細節（線框修正、資料來源、狀態、互動）見 [`waves/W1.md`](waves/W1.md) §5.0。

#### B-S4 MediaPicker 對話框

```
┌ 選擇封面 ───────────────────────────────────────── ✕ ┐
│ [媒體庫]  上傳                                         │
│ [🔍 檔名…        ]                                     │
│ ┌───┐┌───┐┌───┐┌───┐┌───┐┌───┐                         │
│ │ ✓ ││   ││   ││   ││   ││   │   分頁網格（thumbnail）  │
│ └───┘└───┘└───┘└───┘└───┘└───┘                         │
│                                   [取消]  [使用這張]   │
└────────────────────────────────────────────────────────┘
「上傳」tab：拖放區 + 檔案選擇；顯示進度、檔案大小上限（15MB，application.yaml），
上傳成功後自動選取。
```

#### B-S5 相簿編排 `album.composer`

```
 相簿編排                              [相簿：Coast Light 2026 ▾]  [上傳照片]
 拖曳調整順序；點星號設為封面。
 ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐
 │ ★   │ │ ☆   │ │ ☆   │ │ ☆   │   每張卡片：縮圖、標題、狀態 badge、⋯ 選單
 │     │ │     │ │     │ │     │   ⋯ 選單：左移、右移、設為封面、編輯（鍵盤替代，D-10）
 └─────┘ └─────┘ └─────┘ └─────┘
```

- 排序寫入：重新編號為 10、20、30…，**只 PATCH 位置有變的照片**；全部成功才算完成，任何一個失敗就重新讀取並提示（修 C-08）。原子重排屬於 G-09。
- 多檔上傳：每個檔案上傳後建立一筆 `photo` 草稿，並掛到這本相簿。

#### B-S6 看板 `projects.board`

```
 看板                                   [專案：CMS Scaffold ▾]   [新增 issue]
 [🔍 篩選標題…]  [ ] 顯示已封存
 ┌ 待辦 (1) ──┐ ┌ 就緒 (1) ──┐ ┌ 進行中 (1) ┐ ┌ 審查中 (0) ┐ ┌ 完成 (1) ──┐
 │┌──────────┐│ │┌──────────┐│ │┌──────────┐│ │            │ │┌──────────┐│
 ││Private…  ││ ││Kanban DnD││ ││Visit…    ││ │ 拖到這裡    │ ││Write…    ││
 ││[草稿]  ⋯ ││ ││[草稿]  ⋯ ││ ││[草稿]  ⋯ ││ │            │ ││[草稿]  ⋯ ││
 │└──────────┘│ │└──────────┘│ │└──────────┘│ │            │ │└──────────┘│
 └────────────┘ └────────────┘ └────────────┘ └────────────┘ └────────────┘
 手機：欄位變成可橫向滑動的 tab，一次顯示一欄（修 U-03）。
```

- 挪卡：拖放，或用卡片 ⋯ 選單的「移到 →」子選單（取代 v1 每張卡片上的 `<select>`，但保留同等的鍵盤可達性）。
- 樂觀更新；失敗時回滾卡片位置並跳 toast。
- 欄位名稱用 enum 的顯示名稱（G-06）；專案下拉選單與 `?project=` 雙向同步（修 C-10）。

#### B-S7 當日行程 `clinic.schedule`

```
 就診行程                     ‹  2026年9月24日（週四）  ›  [今天]   [新增就診]
 ┌──────┬────────────────────────────────────────────────────────┐
 │ 09:00│ Leo · 年度健檢   獸醫 James Carter   [草稿]              │
 │ 10:00│                                                        │
 │ 11:00│ Basil · 疫苗                                            │
 └──────┴────────────────────────────────────────────────────────┘
```

- 「今天」以瀏覽器時區計算；查詢用當地日期的 00:00–24:00 換算成 UTC 範圍（修 C-09）。伺服器端的日期範圍篩選屬於 G-02；在 G-02 完成前，前端先抓全部再過濾，並在程式碼註記。
- 顯示寵物與獸醫的名稱，不顯示 UUID（依賴 G-10 或 N+1 查詢；demo 資料量下 N+1 可接受）。

B-S4～B-S7、預覽、修訂紀錄、媒體庫、請求發布（G-03）的施工細節（線框修正、資料來源、狀態、互動）見 [`waves/W2.md`](waves/W2.md) §5.0。

### 7.3 Admin（`apps/web-admin`）

| 路徑 | 畫面 | 狀態 |
| --- | --- | --- |
| `/login` | 登入 | v1 |
| `/` | Overview | v1 |
| `/types`、`/types/:key` | 類型列表、類型詳情（唯讀 schema + 啟停） | v1／新 |
| `/roles`、`/roles/:code` | 角色、權限矩陣 | 新（`/roles`、`/roles/{code}/permissions`） |
| `/principals`、`/principals/new`、`/principals/:id` | 使用者 | v1／新／新 |
| `/audit`、`/audit/:id` | 審計 | 新（`/admin/audit`） |
| `/media` | 媒體用量與配額 | 新（`/media/quota`） |
| `/settings`、`/settings/*` | 系統設定 | 部分缺口（surface-admin §4.2） |
| `/entries/:id` | 緊急 entry inspector | 新（不進主選單） |
| `/403`、`/404` | | 新 |

#### A-S1 Overview

```
 Admin center ▌(紫色色帶)                                       (SA) ▾
 ┌ 總覽 ─────────────────────────────────────────────────────────────┐
 │ ┌ 內容類型 ──────┐ ┌ 使用者 ───────┐ ┌ 媒體用量 ─────────────┐     │
 │ │ 11 個，1 個停用 │ │ 6 位，0 位鎖定 │ │ ████████░░ 312MB/1GB │     │
 │ └────────────────┘ └───────────────┘ └──────────────────────┘     │
 │ ┌ 最近的治理事件 ──────────────────────────────── 全部審計 → ┐     │
 │ │ 09:12  seed-admin 停用類型 visit                              │     │
 │ │ 08:55  seed-admin 指派角色 operator 給 seed-operator-clinic   │     │
 │ └──────────────────────────────────────────────────────────────┘     │
 └───────────────────────────────────────────────────────────────────┘
```

#### A-S2 權限矩陣 `/roles/:code`

```
 ← 角色
 operator                                                 [儲存變更]
 ┌ 權限 ─────────────────────────────────────────────────────────────┐
 │ 類型 \ 動作   讀已發布 讀草稿 建立 更新 發布 下架 刪除 媒體          │
 │ 相簿            ☑      ☑     ☑    ☑    ☑    ☑    ☐    ☑           │
 │ 相片            ☑      ☑     ☑    ☑    ☑    ☑    ☐    ☑           │
 │ 獸醫            ☐      ☐     ☐    ☐    ☐    ☐    ☐    ☐           │
 └──────────────────────────────────────────────────────────────────┘
 - 顯式儲存，不自動存（surface-admin §9.4、AC-K）。
 - 儲存前用 AlertDialog 列出差異（新增 N 項、移除 M 項）。
 - 會讓自己失去 admin 或移除最後一位 admin 的變更，前端先擋，後端也要擋（AC-H）。
```

#### A-S3 審計 `/audit`

Resource index 版型：篩選為時間範圍、操作者、動作、結果（成功／被拒）、資源類型；表格欄為時間、操作者、動作、資源（連結）、結果 badge。詳情頁唯讀，顯示完整事件 JSON。

#### A-S4 危險操作

停用類型、停用使用者、硬刪 entry、硬刪媒體：一律用 `AlertDialog`，要求輸入資源名稱才能按確認（Shopify 刪除商店資料的模式），並說明影響範圍（修 C-19）。

---

## 8. 共通狀態與錯誤

| 情況 | Front | Back | Admin |
| --- | --- | --- | --- |
| 載入中 | Skeleton | Skeleton | Skeleton |
| 列表空 | `EmptyPublished` | `EmptyState`（依權限決定有無 CTA） | `EmptyState` |
| 401 | 會員路由導到 `/login?next=`；公開路由不受影響 | 導到 `/sign-in?returnTo=`；有未存變更先警告 | 導到 `/login?next=` |
| 403 | 「沒有權限」（只用在會員資源） | `/forbidden` | `/403` |
| 404 | `NotFoundPublic`（與未發布同一畫面） | `/not-found`（可與 403 區分） | `/404` |
| 409 | — | 衝突 dialog（§4.3） | 衝突 dialog |
| 422 | 欄位錯誤 | 欄位錯誤 | 欄位錯誤 |
| 5xx／網路 | `ErrorPublic` + 重試 | 行內 Alert + 重試；mutation 失敗用 toast | 同 Back |

**`next`／`returnTo` 允許清單（修 S-01）：** 只接受以單一 `/` 開頭、第二個字元不是 `/` 或 `\`、不含 scheme 的相對路徑，而且必須符合該 app 已登記的路由樣式；不符合就改用預設頁。放在 `@cms/auth` 的 `safeReturnTo`，三個 app 共用，並有單元測試覆蓋 surface-front AC-13 列出的所有惡意輸入。

施工細節（規則、各 app 的回跳清單、31 個測試向量）見 [`waves/W0.md`](waves/W0.md) §4.7。

Back 的 401（session 過期時保留頁面、先詢問再導向登入）、403、404、409、422 施工細節見 [`waves/W1.md`](waves/W1.md) §4.1、§5.0.4、§5.5。

---

## 9. 後端缺口（前端需要的 API）

v2 大部分畫面用現有 API 就能做。下列是真正的缺口，設計與排程都在 [02 後端 SDD](02-backend-sdd.md)。前端開工時，若對應的後端波次（BW）還沒合併，就依「暫行做法」實作，並在程式碼標 `// GAP(G-xx)`；後端合併後的那一波前端要移除這些標記。

| ID | 缺口 | 影響的畫面 | 後端設計 | 後端波次 | 暫行做法 |
| --- | --- | --- | --- | --- | --- |
| G-01 | 取得目前使用者可作業的類型與動作 | Back 側欄、按鈕顯隱 | `/auth/me` 的 `capabilities`（[02 §4.2](02-backend-sdd.md#42-身份與能力g-01g-04)） | BW1 | 非 admin 用 `me.roles[].contentTypeCodes`；admin 用 `GET /content-types` 的全部啟用類型（該端點只過濾啟用狀態）。發布類按鈕先顯示，收到 403 後隱藏並提示 |
| G-02 | 列表的伺服器分頁、排序、欄位篩選 | 所有 index、行程 | `page`／`size`／`sort`／`filter.<field>`（[02 §4.1](02-backend-sdd.md#41-列表查詢g-02)） | BW1 | 前端分頁；在 UI 標示「共 N 筆」 |
| G-03 | 請求發布 | 編輯器、Home | `POST`／`DELETE /entries/{id}/publish-request`（[02 §4.3](02-backend-sdd.md#43-內容寫入)） | BW2 | 不顯示「請求發布」按鈕 |
| G-04 | 可指派的使用者清單 | `PrincipalPicker` | `GET /principals/assignable`（[02 §4.2](02-backend-sdd.md#42-身份與能力g-01g-04)） | BW2 | 唯讀顯示 ID |
| G-05 | 欄位中繼資料（label、group、listable、filterable、help） | 所有 schema 驅動畫面 | [02 §3.1、§4.7](02-backend-sdd.md#47-類型與欄位的輸出g-05g-06) | BW1 | 依型別分組；把 key 轉成人讀標籤 |
| G-06 | enum 選項的顯示名稱 | badge、看板欄名 | `enumLabels`（[02 §4.7](02-backend-sdd.md#47-類型與欄位的輸出g-05g-06)） | BW1 | 把 key 轉成人讀格式，並在 copy 檔覆寫 demo 用的中文名 |
| G-07 | 「清空欄位」的語義 | 編輯器 | PATCH 帶 `null` 即清空（[02 §4.3](02-backend-sdd.md#43-內容寫入)） | BW1 | 送 `null` |
| G-08 | 會員資料與預約 | Front 會員區 | `/api/v1/me/*` + `appointment_request` 類型（[02 §4.5](02-backend-sdd.md#45-會員g-08)） | BW3 | 不做會員區；導覽不顯示「登入」（修 C-11） |
| G-09 | 原子重排 | 相簿編排 | `POST /entries:batch-patch`（[02 §4.3](02-backend-sdd.md#43-內容寫入)） | BW2 | 只 PATCH 有變動的照片，失敗就重新讀取 |
| G-10 | 展開關聯的標題 | 行程、看板、列表的關聯欄 | `include=refs`（[02 §4.3](02-backend-sdd.md#43-內容寫入)） | BW2 | N+1 查詢，並加上 Query 快取 |
| G-11 | 標題一律取 `titleField`（修 C-12） | Back 列表與編輯器標題 | [02 §3.1](02-backend-sdd.md#31-v5--類型設定與欄位中繼資料) | BW1 | 前端用 `payload[type.titleField]` 自行計算 |

BW2 的 G-03、G-09、G-10 由前端 W2 使用；G-04 見 Q-13（[`waves/W2.md`](waves/W2.md) §1）。

另外，[02 §4.4](02-backend-sdd.md#44-破壞性變更與前端同一波上線) 有三項破壞性變更（PATCH 必帶 `version`、公開投影不回無法公開的媒體 id、422 一次回全部欄位錯誤），前端 W1／W3 必須配合。

---

## 10. 非功能需求

### 10.1 無障礙

- 目標 WCAG 2.2 AA。每個頁面跑 `@axe-core/playwright`，critical 與 serious 級的違規數必須為 0。
- 所有互動控件鍵盤可達，焦點環可見（`--focus`）；拖放一定有替代操作（D-10）。
- 圖片的 alt 依序取 `altText`、caption、標題；純裝飾性的圖用 `alt=""`（修 C-14）。

### 10.2 效能預算

| 指標 | Front | Back／Admin |
| --- | --- | --- |
| 首頁 JS（gzip，初次載入） | ≤ 90KB | ≤ 160KB |
| LCP（本機 production build，Fast 3G 模擬） | ≤ 2.5s | — |
| CLS | ≤ 0.05（圖片一律帶尺寸） | ≤ 0.1 |

路由一律 lazy load；Front 不打包 `@cms/fields` 與作業面元件。

### 10.3 文案

- 所有使用者可見字串放在各 app 的 `copy.ts`（zh-Hant），key 沿用 surface-front §4.5 的命名（`empty.albums`、`notfound`…）。
- 文案規則：講使用者的事，不講實作；不出現 HTTP 方法、欄位 key、`origin`、`PATCH`（修 U-01）。

施工細節（copy key 命名規則、共用套件的 copy、自動檢查）見 [`waves/W0.md`](waves/W0.md) §4.6。

### 10.4 安全

- 三個 app 都不使用 `dangerouslySetInnerHTML`；Markdown 依 D-08。
- 不在 bundle 中出現種子帳號名稱（建置後掃描，修 S-02）。
- `web-front` 的 bundle 掃描：不得出現 `/api/v1/entries`、`publicationState`、`previewToken`、`includeDraft`（surface-front AC-08）。

施工細節見 [`waves/W0.md`](waves/W0.md) §5.8。

---

## 11. 測試與驗收

### 11.1 每個 PR 的閘門

```bash
npm run lint && npm run typecheck && npm test && npm run build
npm run test:bundle     # 新增：Front 隔離與種子帳號掃描（§10.4）
npm run e2e:mock        # 新增：Playwright + MSW，不需要後端；含 axe 與截圖
```

`npm run e2e`（接真實 API 的 Compose）維持選用，不當閘門（AGENTS.md）。

施工細節見 [`waves/W0.md`](waves/W0.md) §5.8～§5.10、§9。

### 11.2 驗收條件（v2 新增，與 surface 規格的 AC 並行）

| ID | Given / When / Then | 修掉 |
| --- | --- | --- |
| V2-AC-01 | Given 三個 app 的 production build，When 檢查 CSS，Then `@cms/ui` 用到的每個 class 都有生成；頁標題的計算字級等於 token | F-01 |
| V2-AC-02 | Given 列表 API 延遲 1 秒，When 開啟任一列表，Then 1 秒內只出現 Skeleton，不出現空狀態文案 | C-02 |
| V2-AC-03 | Given 公開詳情 API 回 500，When 開啟該頁，Then 顯示 `ErrorPublic` 與重試按鈕，而不是 NotFound | C-03 |
| V2-AC-04 | Given 單張相片頁，Then `<img>` 的 src 是 `web` 變體，且帶 `width`／`height` | C-01、C-14 |
| V2-AC-05 | Given 一個含 enum、ref、media-ref、datetime、int、boolean 的類型，When 開啟編輯器，Then 每個欄位的控件符合 §6.4，且畫面上沒有任何原始 UUID | C-05 |
| V2-AC-06 | Given 一筆 entry 的 payload 有物件值與非空欄位，When 清空一個欄位後儲存，Then 送出的 payload 該鍵為 `null`，其餘鍵的值與型別不變（property test） | C-05 |
| V2-AC-07 | Given draft entry 且使用者有 publish，Then 頁首主要動作是「發布」，且畫面上沒有「下架」；Given published 且不 dirty，Then 沒有主要動作 | C-06 |
| V2-AC-08 | Given 修改了欄位未存，When 點側欄其他頁或關閉分頁，Then 出現離開確認 | C-06 |
| V2-AC-09 | Given 兩個分頁同時編輯同一筆，When 第二個分頁儲存，Then 出現衝突 dialog，且本地輸入不被清除 | §4.3 |
| V2-AC-10 | Given 一套只有 `note` 類型的 MSW fixture（demo 以外），When 以該類型的 operator 登入 Back，Then 側欄只有「Notes」，列表與編輯器可用，且沒有修改任何程式碼 | C-07、總綱 §1 |
| V2-AC-11 | Given 瀏覽器時區 Asia/Taipei、時間 07:30，When 開啟當日行程，Then 預設日期是當地的今天 | C-09 |
| V2-AC-12 | Given 看板挪卡時 API 失敗，Then 卡片回到原欄並出現 toast | §4.3 |
| V2-AC-13 | Given 手機寬 390px，When 開啟 Back 任一頁，Then 側欄收合、沒有水平捲動；看板一次顯示一欄 | U-03 |
| V2-AC-14 | 所有頁面 axe 的 critical／serious 為 0 | §10.1 |
| V2-AC-15 | 任何頁面的可見文字都不含 `PATCH`、`sortOrder`、`origin`、`(string)` | U-01 |
| V2-AC-16 | Admin 停用類型需要輸入類型名稱才能確認 | C-19 |

### 11.3 前端開發不依賴後端

`@cms/mocks` 讓 `npm run dev:mock -w @cms/web-back` 可以直接開發，並且：

- fixture 對齊 `DemoContentSeed`（三個 demo、種子帳號、草稿與已發布的混合），另加一套非 demo 的 `note` 類型（V2-AC-10）。
- 可以用 query 參數切換情境：`?mock=slow`、`?mock=error500`、`?mock=empty`、`?mock=conflict`。
- MSW 的回應用產生的 OpenAPI 型別做 typecheck；後端改了契約，mock 就編譯失敗。

施工細節（fixture 全文、handler 行為表、`?mock=none`、`?mockUser=`）見 [`waves/W0.md`](waves/W0.md) §4.5、§5.4。

---

## 12. 實作波次（給 LLM agent）

原則：**一波一個 PR**；每波只碰列出的路徑；稽核 ID 是完成定義的一部分；不做 §1.2 的非目標。

| 波 | 範圍 | 修掉 | 完成定義 |
| --- | --- | --- | --- |
| **W0 基礎**（需要 BW0：OpenAPI 有完整 schema 才能 codegen） | `packages/{ui,api,fields,auth,mocks}` 骨架；tokens；shadcn 初始化與 `@source`；OpenAPI codegen；`safeReturnTo`；MSW；升級 React 19、Router 7；三個 app 換上新殼（內容暫時沿用 v1） | F-01～F-05、S-01、S-02、S-03、C-16～C-18、E-01～E-04 | §11.1 全綠；V2-AC-01、V2-AC-14（殼層頁）；Storybook 不強制 |
| **W1 Back 核心**（需要 BW1） | 殼層、Home、Resource index、Resource details、欄位 widget（除 media-ref、ref）、ContextualSaveBar、發布動作、409、403／404 | C-04、C-05、C-06、C-07、U-01、U-02、U-04 | V2-AC-05～10、15 |
| **W2 Back 媒體與視圖**（需要 BW2） | MediaPicker、RelationPicker、`/media`、預覽、修訂紀錄、三個自訂視圖重做 | C-08、C-09、C-10、U-03 | V2-AC-11～13 |
| **W3 Front**（會員區需要 BW3，其餘不需要） | 四站 section registry、全部公開路由、燈箱、狀態頁、SEO meta、手機選單、Markdown | C-01～C-03、C-11、C-13、C-14、U-05 | V2-AC-02～04；surface-front AC-01～09、13、15、17、18 |
| **W4 Admin**（審計需要 BW2） | Overview、類型、角色矩陣、使用者、審計、媒體用量、危險操作 | C-19 | V2-AC-16；surface-admin AC-A～L 中不依賴後端缺口的項目 |
| **W5 硬化** | 效能預算、bundle 掃描、全頁 axe、截圖基準、`e2e`（真 API）跑一次並記錄結果 | 剩餘 P2 | §10 全部達標 |

W0 施工細節見 [`waves/W0.md`](waves/W0.md)。W1 施工細節見 [`waves/W1.md`](waves/W1.md)。W2 施工細節見 [`waves/W2.md`](waves/W2.md)（範圍另含 BW2 的 G-03、G-09、G-10 在 Back 的使用，依 [BW2.md](waves/BW2.md) §1.1「前端依賴本波次的是 W2」）。

前後端的整體順序見 [README § 路線圖](README.md#路線圖)。每波開工前，agent 先讀本文與對應 surface 規格；遇到本文沒寫到、又會影響其他波的決定，停下來在 PR 描述裡提問，不要自行擴充規格。

---

## 13. 開放問題與已知衝突

### 13.1 已決定（owner，2026-09-25）

Owner 指示「其他按建議走」，以下全部依原建議定案。

| ID | 問題 | 決定 |
| --- | --- | --- |
| Q-01 | 借 Shopify 的模式，還是直接用 Polaris 元件？ | **借模式**（D-02）。不用 Polaris 套件，不改總綱 |
| Q-02 | 休眠專案要不要啟動？ | **啟動**。PORTFOLIO.md 已登記 owner override，tier 改為 A |
| Q-03 | Front 要不要做建置時 prerender？ | v2 不做；W5 後評估 |
| Q-04 | Back／Admin 要不要深色模式？ | v2 只做淺色；tokens 預留 `[data-theme=dark]` |
| Q-05 | 列表要不要批次操作？ | v2 不做；IndexTable 預留選取欄 |
| Q-06 | 後端缺口要不要一起做？ | **一起做**，設計在 [02 後端 SDD](02-backend-sdd.md)；G-01、G-02、G-11 在 BW1、於前端 W1 之前完成 |
| Q-07 | Front 與 Back 要不要分開 session cookie？ | 維持單一 `cms_session`（[02 BD-13](02-backend-sdd.md#2-決策)） |

### 13.2 與既有文件的衝突

| 位置 | 內容 | 處理 |
| --- | --- | --- |
| surface-back §4.2 vs v1 | 規格用 `/sign-in`，v1 用 `/login`，且 `/sign-in` 轉到 `/login` | v2 依規格：`/sign-in` 為主，`/login` 轉址 |
| surface-front §4.2 | `/login` 已登入時轉 `/clinic/me`；但 G-08 未完成前沒有會員區 | 暫時轉 `/`；G-08 完成後依規格 |
| surface-back §3.3 | 建議 enum `todo \| in_progress \| blocked \| done`；種子實際是 `backlog \| ready \| in_progress \| in_review \| done` | 看板欄位一律從 schema 的 `enumValues` 產生，不寫死 |
| surface-admin §4.1 | 列出的 shadcn primitive 包含 `Progress` | 已涵蓋（媒體用量） |

---

### 13.3 W0 細化時新增、已決定（owner，2026-09-25）

| ID | 問題 | 決定 |
| --- | --- | --- |
| Q-08 | shadcn/ui 元件本身依賴 `class-variance-authority`、`clsx`、`tailwind-merge`、`lucide-react`、`tw-animate-css`，§3、§4 沒有逐一列出。 | **A**：視為 D-02「採用 shadcn/ui」的組成，照 [waves/W0.md §4.8](waves/W0.md#48-npm-套件版本全部已查證23) 的精確版本安裝 |
| Q-09 | 兩種環境類失敗沒有自動測試：Playwright 瀏覽器不存在或版本不符（W0-FM20）、npm registry 無法連線（W0-FM21）。 | **A**：比照 [02 BQ-09](02-backend-sdd.md#8-開放問題) 以 CI 為準；PR 說明必須寫明哪些檢查只在 CI 跑過 |
| Q-10 | W0 實作後，前端的 codegen 新鮮度測試與帶型別的 fixture 會與 `openapi.yaml` 綁在一起；之後修改契約的後端波次（第一個是 BW1a：`Me.capabilities` 必填）若不同時更新前端，CI 的 `web` job 會紅；反之 BW1a 先實作，W0 的 fixture 就不符合契約。 | **前後端各自依自己的契約開發，差異在整合階段一起處理**（比照真實開發）。W0 仍以 BW0 契約撰寫；[waves/W0.md §2.1](waves/W0.md#21-前置波次) 的防呆保留：實作時若 `openapi.yaml` 已不是 BW0 版本，停下來回報，交給整合階段。W1 同樣適用：codegen 讀 `contracts/BW1c.openapi.yaml`（[waves/W1.md §4.2](waves/W1.md#42-型別與-codegen)），整合階段再改回 `openapi.yaml` |

### 13.4 W1 細化時新增（待確認）

| ID | 問題 | 選項 | 建議 |
| --- | --- | --- | --- |
| Q-11 | shadcn 的 `Calendar` 依賴 `react-day-picker`，`Sonner` 依賴 `sonner`；兩者都不在 §3、§4，也不在 Q-08 的清單。 | **A**：比照 Q-08，視為 D-02 的組成，照 [waves/W1.md §4.8](waves/W1.md#48-npm-套件版本已查證23) 的精確版本（`react-day-picker` 9.14.0、`sonner` 2.0.8）；**B**：不用 `Calendar`（datetime 改用原生 `<input type="datetime-local">`）、不用 toast（違反 U-04 的修法）。 | **A**。W1 施工圖依 A 撰寫 |
| Q-12 | react-hook-form 把欄位名稱中的 `.` 當成巢狀路徑，W1 的表單也用 `$slug` 存網址代稱；但契約的 `CreateFieldRequest.key` 沒有 pattern，理論上可以建立 `a.b` 或 `$slug` 這種欄位 key（[waves/W1.md](waves/W1.md) W1-FM12）。 | **A**：請後端在 `CreateFieldRequest.key` 加 pattern `^[A-Za-z][A-Za-z0-9_]{0,62}$`（現有種子的 key 都符合）；**B**：前端改用巢狀表單值（`payload.<key>`），仍無法處理含 `.` 的 key。 | **A**，轉給後端窗口（BW2 之後的任一後端波次） |

### 13.5 W2 細化時新增、已決定（owner，2026-09-26）

Owner 指示「按建議」：Q-13 選 B、Q-14 選 A（轉後端窗口）、Q-15 選 B、Q-16 選 A。之後的前端波次（W3、W4、W3b、W5）以最新的後端契約 `contracts/BW5.openapi.yaml` 產生型別（README 路線圖的建議；W2 維持 BW2，差異在整合階段處理）。

| ID | 問題 | 選項 | 建議 |
| --- | --- | --- | --- |
| Q-13 | 01 §6.4 的 `PrincipalPicker` 依賴 G-04（`GET /principals/assignable`），但該端點只回「對該類型有 Back `update` 的作業人員」；種子裡的 `principal-ref` 欄位全是「連結會員帳號」（`owner`、`pet`、`visit` 的 `ownerPrincipalId`），會員不在清單裡；看板要指派的 `issue.assigneePrincipalId` 型別又是 `string`。照現況做出的選擇器選不到該選的人。 | **A**：分成兩種用途——請後端為 `principal-ref` 加欄位中繼資料（例如 `principalScope: "staff" \| "member"`），`member` 用新的 `GET /principals/members?q=`（只回 id、displayName），`staff` 用 assignable；同時把 `issue.assigneePrincipalId` 改成 `principal-ref`（`staff`）。**B**：v2 不做 `PrincipalPicker`，`principal-ref` 一律唯讀，會員綁定只在 Admin 做。 | **B**（v2 範圍最小；A 需要後端新端點與種子變更，可在 v2 之後）。W2 依 B 撰寫；選 A 時轉給後端窗口，前端另開一波 |
| Q-14 | `GET /media` 沒有 `page`、`size`、`q`（surface-back §6.5 要求有），整個媒體庫一次回傳；`MediaAsset` 也沒有「已刪除」旗標，條目引用的媒體被移到回收後，前端只能從縮圖 410 得知（[waves/W2.md](waves/W2.md) W2-FM12）。 | **A**：請後端為 `GET /media` 加 `page`、`size`（預設 24）、`q`（名稱包含），回 `MediaAssetPage`（`items`、`total`、`page`、`size`），並在 `MediaAsset` 加 `deletedAt`（nullable）；**B**：維持現狀，前端篩選與分頁（W2 的做法），demo 資料量可接受。 | **A**，轉給後端窗口；前端在對應後端波次之後把 `LibraryBody`、`LibraryTab` 改成伺服器分頁 |
| Q-15 | surface-back §3.4 的全頁 token 預覽（`/preview/t/:token`、`POST /entries/{id}/preview-tokens`、`GET /preview/{token}`）在 BW0～BW5 的契約都沒有。 | **A**：請後端新增這兩個端點（TTL 15 分鐘、只給 Back），前端另開一波加路由；**B**：v2 只做編輯器內預覽（`GET /preview/entries/{id}`，W2 已做）。 | **B**。W2 依 B 撰寫 |
| Q-16 | README 路線圖（BW5 合併後）建議「前端 W2、W4 以 BW5 的契約為準」；W2 細化時的指示是「W2 用 `BW2.openapi.yaml`」。BW5 對 W2 可見的差異只有 5 個媒體錯誤代碼改大寫（[waves/BW5.md](waves/BW5.md) §4.2）。 | **A**：W2 維持 BW2 契約，整合階段依 [waves/W2.md](waves/W2.md) §2.1 的對照表替換 5 個字串（Q-10 的做法）；**B**：W2 改以 BW5 產生型別，mock 與選擇器直接用大寫代碼（需要重新預演 W2）。 | **A**。W2 依 A 撰寫 |

## 14. 參考來源

存取日：2026-09-24。`shopify.dev` 與 `polaris-react.shopify.com` 在本環境被網路政策擋下，未能直接讀取頁面；以下頁面是透過搜尋結果確認存在與主題，模式描述為本文的整理，不是原文引述。

- Polaris — Resource index layout：<https://polaris-react.shopify.com/patterns/resource-index-layout>
- Polaris — Resource details layout：<https://polaris-react.shopify.com/patterns/resource-details-layout>
- Polaris web components（Shopify app home）：<https://shopify.dev/docs/api/app-home/latest/web-components>
- Using Polaris web components：<https://shopify.dev/docs/api/polaris/using-polaris-web-components>
- Polaris ViewComponents — Contextual Save Bar 範例：<https://polarisviewcomponents.org/lookbook/inspect/contextual_save_bar/default>
- Horizon 主題（2025 年取代 Dawn 成為預設主題）：<https://themes.shopify.com/themes/horizon/styles/horizon>、<https://ed.codes/blog/shopify-horizon-theme-and-blocks>
- 本 repo：`docs/sdd/00-overview.md`、`docs/specs/surface-{front,back,admin}.md`、`services/cms-api/src/main/resources/openapi/openapi.yaml`、`DemoContentSeed.java`

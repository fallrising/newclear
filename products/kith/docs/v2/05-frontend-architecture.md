# 05 — 前端架構

[回 v2 索引](README.md) · 決策：[ADR-0005](../adr/0005-v2-web-frontend.md)

## 1. 技術棧

| 層 | 選擇 | 理由 | 替代（未選） |
| --- | --- | --- | --- |
| 語言／建置 | TypeScript（strict）＋ Vite 6 | 與 kith 根目錄、goku／phark 一致 | — |
| UI | React 19 | 生態最廣，實作 agent 最熟悉 | Preact（省體積，但函式庫相容成本） |
| 路由 | React Router 7（library mode） | URL 帶房間，重新整理停在原房（修 v1「回到列表」） | TanStack Router |
| 伺服器狀態 | TanStack Query 5 | REST 快取、重試、失效（房間、成員、agent、連線） | 自寫 |
| 即時狀態 | 自寫 `RoomSync` 引擎＋Zustand store | 時間線的 seq 補洞、去重、樂觀送出規則是 Kith 特有，不能交給通用快取 | 全部放 Query |
| 無障礙元件 | Radix Primitives（Dialog、Popover、DropdownMenu、Tooltip、Tabs、ScrollArea） | 焦點管理、ARIA 正確，沒有預設樣式 | 自寫（v1 做法，成本高） |
| 樣式 | Tailwind CSS 4，所有顏色／間距來自 CSS 變數 token（[07](07-visual-design.md)） | 慣例統一，較弱的模型也寫得一致；深色模式只換變數 | CSS Modules |
| 圖示 | lucide-react（按需引入） | 線條風格一致 | — |
| Markdown | `markdown-it`（`html: false`、`linkify: true`）→ token 轉 React 元素（不用 `dangerouslySetInnerHTML`） | 可精確白名單（BR-34） | react-markdown（依賴樹較大） |
| 長清單 | `@tanstack/react-virtual` | 1,000＋則的時間線保持流暢 | — |
| 字型 | 自托管拉丁字型（見 07）；中日韓字用系統字 | 不連外部 CDN；CJK 字型檔太大 | — |
| 測試 | Playwright（E2E，見 [08](08-testing-e2e.md)） | 使用者規則：E2E 為主 | — |

### 1.1 精確版本（Phase 2 鎖定，2026-09-23 查 npm registry）

所有版本寫死（不用 `^`、`~`）。「安裝於」是第一次需要它的里程碑；在那之前不要裝。

| 套件 | 版本 | 用途 | 安裝於 | 相容性依據 |
| --- | --- | --- | --- | --- |
| `react`、`react-dom` | 19.3.0 | UI | W0 | — |
| `@types/react`、`@types/react-dom` | 19.3.0 | 型別 | W0 | — |
| `react-router` | 7.18.4 | 路由（v7 最新；npm `latest` 已是 8.x，本表維持 D-09 的 7） | W0 | peer `react >=18` |
| `@tanstack/react-query` | 5.103.2 | 伺服器狀態 | W0 | peer `react ^18 \|\| ^19` |
| `@fontsource-variable/figtree` | 5.3.0 | 字型（OFL-1.1） | W0 | family 名 `Figtree Variable` |
| `vite` | 6.4.3 | 建置（與 kith 根目錄相同） | W0 | — |
| `@vitejs/plugin-react` | 5.2.0 | React 轉換 | W0 | peer `vite ^4.2 \|\| ^5 \|\| ^6 \|\| ^7`（6.x 需要 vite 8，不能用） |
| `tailwindcss`、`@tailwindcss/vite` | 4.3.3 | 樣式 | W0 | peer `vite ^5.2 \|\| ^6 \|\| ^7 \|\| ^8` |
| `typescript` | 7.0.2 | 型別檢查（與 kith 根目錄相同） | W0 | — |
| `@types/node` | 26.6.2 | `vite.config.ts` 型別（與 kith 根目錄相同） | W0 | — |
| `zustand` | 5.0.15 | 即時狀態 | W1 | peer `react >=18` |
| `markdown-it` | 15.0.2 | Markdown | W1 | — |
| `@types/markdown-it` | 14.2.0 | 型別 | W1 | — |
| `@tanstack/react-virtual` | 3.14.13 | 長清單 | W1 | — |
| `lucide-react` | 1.47.0 | 圖示 | W1 | peer `react ^16.5.1 \|\| … \|\| ^19` |
| `@radix-ui/react-dialog` | 1.1.23 | Dialog | W2 | peer `react ^16.8 \|\| … \|\| ^19` |
| `@radix-ui/react-popover` | 1.1.23 | Popover | W3 | 同上 |
| `@radix-ui/react-dropdown-menu` | 2.1.24 | DropdownMenu | W2 | 同上 |
| `@radix-ui/react-tooltip` | 1.2.16 | Tooltip | W3 | 同上 |
| `@radix-ui/react-tabs` | 1.1.21 | Tabs | W4 | 同上 |
| `@radix-ui/react-scroll-area` | 1.2.18 | ScrollArea | W3（W1 的時間線用原生捲動容器） | 同上 |

E2E 套件（`e2e/package.json`，W0）：`@playwright/test` 1.56.1、`ajv` 8.20.0、`typescript` 7.0.2、`@types/node` 26.6.2。Playwright 刻意不用最新的 1.63.0：1.56.1 綁定 Chromium revision 1194（`141.0.7390.37`），正是本專案雲端環境預裝的版本，不必下載瀏覽器（已查 `playwright-core` 1.56.1 的 `browsers.json`）。鎖定此版本見 [10](10-decisions.md) D-17。

安裝在後續里程碑的套件，若屆時 npm 上的版本已被撤下或有安全公告，先改本表並在 PR 說明，不要自行換版本。

**FE-01** 不新增表中以外的執行期依賴，除非先改本表並說明理由。

**FE-02** 不用 `innerHTML`／`dangerouslySetInnerHTML` 渲染任何伺服器來的字串。

## 2. 目錄

```text
products/kith/web/
  index.html
  package.json            # 獨立於舊 frontend/；Node 24.18.0
  vite.config.ts          # /api、/mcp proxy 到 wrangler :8787（同 v1）
  src/
    main.tsx
    app/                  # 路由、Providers、錯誤邊界、版面骨架
    api/                  # fetch 包裝、CSRF、錯誤型別、各資源的 query hooks
    sync/                 # RoomSync 引擎（WS、補洞、草稿、status）
    store/                # Zustand：每房時間線、status、草稿、未讀 cursor
    features/
      auth/               # 登入頁
      rooms/              # 房間列表、建房、房間設定
      timeline/           # 時間線、訊息列、分組、日期分隔、跳到最新
      composer/           # 輸入列、@ 補全、送出狀態
      members/            # 成員面板、邀請
      threads/            # thread 面板
      traces/             # trace 卡片
      console/            # operator 控制台：agents、providers、tokens、people
      profile/            # 自己的顯示名、密碼
    ui/                   # 無業務的元件：Avatar、Button、Badge、Sheet、EmptyState…
    markdown/             # markdown-it 設定與 React 轉換
    copy/                 # 所有使用者可見字串：zh-TW.ts、en.ts（兩者 key 集合必須相同）、index.tsx
    styles/               # tokens.css、tailwind 設定
products/kith/e2e/        # Playwright，見 08
```

**FE-03** `features/*` 之間不互相 import 內部檔案；共用的放 `ui/`、`api/`、`store/`。落實方式（W1 起）：每個 feature 有 `index.ts` 作為唯一對外出口；feature 之間完全不互相 import；組合多個 feature 的畫面放在 `app/`，且只從 `features/<名>` 匯入（[W1](milestones/W1.md) §3）。

**FE-05** 介面雙語：繁體中文（`zh-TW`）與英文（`en`），使用者 2026-09-23 決定。預設語言依 `navigator.language`（`zh*` → `zh-TW`，其他 → `en`），使用者可在設定切換並存在 `localStorage`。兩份字串表的 key 集合必須完全相同，缺 key 視為建置錯誤（型別層檢查：`en` 以 `satisfies Record<keyof typeof zhTW, string>` 定義）。日期與相對時間用 `Intl`，依語言格式化。伺服器錯誤碼在前端映射成兩種語言，不顯示伺服器 `message` 原文。

**FE-04** 所有可見字串經 `copy/`，E2E 以 `data-testid` 與角色定位，不以文案定位（文案可改，測試不碎）。例外：文案本身是驗收對象時。

`copy/` 的檔案結構、`CopyKey` 型別、key 命名規則、`data-testid` 與 `localStorage` key 的命名規則在 [W0](milestones/W0.md) §5.2.4 定義，全專案沿用。

## 3. 路由

| 路徑 | 畫面 | 權限 |
| --- | --- | --- |
| `/login` | 登入 | 未登入 |
| `/` | 桌面：列表＋空狀態；手機：列表 | 登入 |
| `/r/:slug` | 房間 | 房內成員 |
| `/r/:slug/t/:threadId` | 房間＋thread 面板 | 房內成員 |
| `/console/agents`、`/console/agents/:id` | agent 管理 | operator |
| `/console/providers`、`/console/providers/:id` | 連線管理 | operator |
| `/console/people` | 人類帳號 | operator |
| `/settings` | 個人設定 | 登入 |

- 401 任一 API → 清空快取，導向 `/login?next=…`。
- 非 operator 進 `/console/*` → 403 畫面，不閃現內容。
- 房間 slug 不存在或非成員 → 「找不到這個房間」空狀態，不洩露房間是否存在。
- Workers assets 已設定 `not_found_handling = "single-page-application"`，深連結可直接開。

## 4. 狀態分層

| 資料 | 放哪 | 失效時機 |
| --- | --- | --- |
| me、rooms、members、agents、providers、tokens | TanStack Query | 對應 mutation 成功；視窗重新聚焦；B-06 事件 |
| 時間線事件（每房 `Map<seq, Event>`） | Zustand `timelines[roomId]` | 由 RoomSync 寫入；切房不清（快取最近 5 房） |
| status（typing、replying、runner 狀態） | Zustand `statuses[roomId]` | TTL 到期、切房、斷線 |
| 草稿（B-10） | Zustand `drafts[roomId][generationId]` | 正式事件、`reply ended`／`reply failed`、斷線 |
| 未讀 cursor | `localStorage`（try/catch 包住）＋ Zustand 鏡像 | 捲到底、離開房間 |
| 輸入框草稿 | `localStorage` per room | 送出成功 |

## 5. RoomSync 引擎

每個開著的房間一個實例，負責這個房間所有即時資料。它是**必須單獨驗證**的模組，因此先列失敗模式（§6），再寫程式。

### 5.1 狀態機

```text
idle → loading_latest → connecting → live
                 ↑            │  ↘
                 │            ↓   error(backoff) → connecting
                 └──── offline（navigator.onLine=false 或 WS close）
```

### 5.2 流程

1. **進房**：`GET messages?order=desc&limit=50`（B-01）→ 寫入 store，記錄 `oldestLoaded`、`hasMoreOlder`。
2. **連 WS**：`open` 後若 store 中 `maxSeq` 之後可能有遺漏，`GET messages?after_seq=maxSeq` 補到空為止（每次 ≤ 50，上限 20 頁；超過則標記 `needsJump` 並以 `order=desc` 重新載入最新頁，丟棄中間）。
3. **收到 event**：合併（以 seq 去重）；若 `seq > maxSeq + 1` → 排一次補洞（序列化，同時只有一個補洞請求）。
4. **往上捲**：`GET messages?before_seq=oldestLoaded&order=desc&limit=50`，保持捲動錨點。
5. **送出**：產生 `client_message_id` → 樂觀插入 `pending` 列（無 seq）→ WS `send`；收到同 `client_message_id` 的 event 時以正式列取代。10 s 無回應 → 標 `unknown`，自動以**同一** `client_message_id` 經 REST 重送一次（冪等，v1 §5）；仍失敗 → 標 `failed`，提供「重試」（同一 id）與「刪除草稿」。
6. **status／draft**：只放 store，不進 seq map。
7. **斷線**：清 status 與草稿；保留輸入框；指數退避重連（1 s 起，上限 30 s，加抖動）；重連後回到步驟 2。
8. **切房**：關 WS、abort 所有請求；時間線快取保留。

**FE-10** 畫面上的訊息順序只由 seq 決定；pending 列永遠排在所有已落盤列之後，依建立時間。

**FE-11** 任何時刻，同一 `client_message_id` 在畫面上最多一列。

**FE-12** 補洞以**全房 seq** 為準（含 trace、thread 回覆）；主時間線只是過濾後的投影。這樣 thread 回覆不會被誤判成「缺號」。所有查詢都帶 `kind=message,trace`。

Phase 2 細化（[W1](milestones/W1.md) §5.3）補充的事實與規則：

- v1 WS 的 `error` 封包不帶 `client_message_id`，所以同時只讓一則 WS send 在途，`error` 歸屬於在途那一則。
- Playwright 的 `setOffline` 與瀏覽器離線都不會關閉既有 WS；RoomSync 在 `offline` 事件時主動關閉，`online` 時重連。
- 發現缺口後等 `GAP_GRACE_MS`（500 ms）才補洞，容許亂序。
- 狀態機多出 `not_found`（403／404，不重試）、`load_error`（載入失敗，退避重試）、`auth_lost`。

### 5.3 FM 清單：RoomSync（寫程式前必須補齊並對應 E2E 或受控測試）

- **FM-SYNC-01** 初次載入回應晚於 WS 第一個 event → 合併後順序正確、無重複。
- **FM-SYNC-02** WS event 亂序到達（seq 5 先於 4）→ 4 到達後缺口消失，不發多餘補洞。
- **FM-SYNC-03** 補洞請求進行中又收到新缺口 → 不並行，完成後再判斷一次。
- **FM-SYNC-04** 補洞回空陣列但缺口仍在（trace 被 GC 造成的合法洞）→ 標記該區間為「已確認空洞」，不無限重試。
- **FM-SYNC-05** 伺服器回的列 seq 比 `maxSeq` 還小很多（重複）→ 去重，不重畫。
- **FM-SYNC-06** 樂觀送出後 WS 斷線，重連補洞帶回該訊息 → pending 列被取代，不出現兩則。
- **FM-SYNC-07** 樂觀送出的 WS `send` 實際已落盤但 ack 遺失，REST 重送得到原列 → 同一則。
- **FM-SYNC-08** 送出被拒（`payload_too_large`、403、`room_full` 之類）→ 標 `failed` 並顯示原因，不重試。
- **FM-SYNC-09** 401 → 停止重連，導向登入。
- **FM-SYNC-10** 切房時舊房的請求才回來 → 丟棄，不寫進新房。
- **FM-SYNC-11** 同一房在兩個分頁開啟 → 各自獨立，都正確（不依賴 BroadcastChannel）。
- **FM-SYNC-12** 往上翻頁與新訊息同時到 → 捲動錨點不跳；使用者不在底部時不自動捲到底，改顯示「N 則新訊息」按鈕。
- **FM-SYNC-13** 離線超過很久（遺漏 > 1,000 則）→ 觸發 `needsJump`，重新載入最新頁並顯示「已跳到最新，較早的訊息往上捲載入」。
- **FM-SYNC-14** 草稿封包在正式 event 之後才到 → 丟棄（以 `generation_id` 已完成判斷）。
- **FM-SYNC-15** `is replying` 超過 300 s 無後續 → 清除，不宣稱成功或失敗（沿用 v1 10 章）。
- **FM-SYNC-16** WS 收到無法解析的封包 → 忽略並計數，不中斷連線。
- **FM-SYNC-17** 伺服器 hibernation 後重連，status 全部遺失 → 畫面不殘留舊 status。
- **FM-SYNC-18** 系統時鐘錯誤（client 比伺服器快一天）→ 只用伺服器 `created_at` 顯示，未讀與排序不依賴 client 時間。

驗證方式見 [08](08-testing-e2e.md) §5：以 E2E 搭配「受控 WS 代理」注入亂序、丟包、延遲，不寫單元測試。

## 6. 安全

- **FE-20** Markdown 白名單見 BR-34；連結只允許 `http:`、`https:`、`mailto:`，其他協定渲染成純文字。
- **FE-21** 不在前端保存任何 bot token 或 provider key；token 明文只在簽發當下的對話框顯示一次，關閉即從記憶體清除。
- **FE-22** CSRF：所有 unsafe method 先確保有 CSRF cookie，header 配對（沿用 v1 `api.ts` 行為）。
- **FE-23** `localStorage` 只存未讀 cursor、輸入框草稿、UI 偏好（主題、面板開合）；不存訊息內容以外的敏感資料。輸入框草稿在登出時清除。
- **FE-24** CSP（由 Worker 對 assets 加 header；Phase 2 定義）：`default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'`。

## 7. 效能預算

| 項目 | 目標 |
| --- | --- |
| 首次載入 JS（gzip） | ≤ 200 KiB（不含字型） |
| 進房到看到最新訊息 | p95 < 600 ms（本機 wrangler） |
| 1,000 則時間線捲動 | 無明顯掉幀；DOM 中訊息列 ≤ 100 |
| console 頁面 | 按路由分割，不進首頁 bundle |

## 8. 無障礙

- 所有互動元件有可見焦點；鍵盤可完成所有流程。
- 時間線是 `role="log"`，新訊息以 `aria-live="polite"` 報讀（節流）。
- @ 補全沿用 v1 10 章的 combobox 規則（焦點留在輸入框、`aria-activedescendant`、IME 組字中 Enter 不選不送）。
- 顏色對比 ≥ 4.5:1（大字 3:1）；不只靠顏色區分人／agent（形狀＋文字）。
- `prefers-reduced-motion` 時關閉非必要動效。

## 9. Phase 2 待細化

- [ ] 每個 feature 的元件樹、props 型別、資料來源與 `data-testid` 清單。
- [x] RoomSync 的完整型別定義與每個 FM 的對應處理程式段落描述 → [W1](milestones/W1.md) §5.3、§8。
- [ ] `copy/zh-TW.ts`、`copy/en.ts` 完整文案表（FE-05）。結構與命名規則已完成（[W0](milestones/W0.md) §5.2.4）；各畫面的文案隨各里程碑的 `Wn.md` 文案表補齊。
- [x] Tailwind 設定與 token 對應表 → [07](07-visual-design.md) §4.1、[W0](milestones/W0.md) §5.5。
- [ ] CSP 最終版與 Worker 設定方式。
- [x] 套件精確版本鎖定 → §1.1。

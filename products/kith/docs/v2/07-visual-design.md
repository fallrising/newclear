# 07 — 視覺設計

[回 v2 索引](README.md)

## 1. 方向

**溫暖、親近、安靜。** Kith 的字義是「親友」。它不是企業工具，也不是 iOS 設定頁。參考氣質：紙張般的暖白底、陶土色強調、鼠尾草綠代表 AI。字重與間距比一般聊天軟體稍鬆，讓長段 agent 回覆好讀。

不做的事：漸層背景、玻璃擬態、霓虹色、大面積插畫、動態背景。

## 2. 色彩 token

所有顏色只透過 CSS 變數使用（FE：Tailwind 設定引用變數）。下表對比度以 WCAG 相對亮度公式計算（2026-09-23，本文件作者以腳本驗算）；Phase 2 以正式工具再驗一次。

### 2.1 淺色

| token | 值 | 用途 | 對比（對 `--bg`） |
| --- | --- | --- | --- |
| `--bg` | `#FBF8F3` | 頁面底 | — |
| `--surface` | `#FFFFFF` | 卡片、面板、輸入框 | — |
| `--surface-2` | `#F4EFE7` | 次層（sidebar、hover） | — |
| `--border` | `#E7DFD3` | 分隔線 | — |
| `--ink` | `#231F1B` | 主文字 | 15.45 |
| `--ink-2` | `#5E554C` | 次文字 | 6.88 |
| `--ink-3` | `#6F655B` | 時間、meta | 5.37（對 surface-2 4.97） |
| `--accent` | `#B4532A` | 陶土：主按鈕、選中、提及色條 | 4.71；白字在其上 4.99 |
| `--accent-strong` | `#9C4522` | 文字放在 `--accent-tint` 上時 | Phase 2 驗算 |
| `--accent-tint` | `#F6E6DC` | 自己訊息底色、選中房間底 | — |
| `--agent` | `#2A6E62` | 鼠尾草：AI 標籤、徽記 | 5.66；對 `--agent-tint` 5.12 |
| `--agent-tint` | `#E3F0EC` | AI 標籤底 | — |
| `--mention-tint` | `#FCEFD9` | 提及高亮底 | ink 在其上 14.41 |
| `--danger` | `#B42318` | 錯誤 | 6.21 |
| `--warn` | `#9A5208` | 警告、離線 | 5.53 |
| `--success` | `#2E7D32` | 成功 | 4.84 |
| `--focus` | `#B4532A` | 焦點外框（2px＋2px offset） | — |

### 2.2 深色

| token | 值 | 對比（對 `--bg`） |
| --- | --- | --- |
| `--bg` | `#171411` | — |
| `--surface` | `#1F1B17` | — |
| `--surface-2` | `#29241F` | — |
| `--border` | `#3A332C` | — |
| `--ink` | `#F1EBE3` | 15.49 |
| `--ink-2` | `#BDB3A7` | 8.89 |
| `--ink-3` | `#9A8F83` | 5.79（對 surface-2 4.85） |
| `--accent` | `#E0835A` | 6.61；按鈕文字用 `#1A0F09`（6.78） |
| `--accent-tint` | `#2E211B` | accent 在其上 5.6 |
| `--agent` | `#6FBFAE` | 8.51 |
| `--agent-tint` | `#1E2B28` | agent 在其上 6.8 |
| `--mention-tint` | `#3A2E1C` | Phase 2 驗算 |
| `--danger` | `#F97066` | 6.59 |
| `--warn` | `#F0A94B` | 9.16 |

主題切換：`系統`（預設，`prefers-color-scheme`）／`淺色`／`深色`，存在 `localStorage`，以 `html[data-theme]` 套用。

### 2.3 頭像色

8 色，依 `hash(member.id) mod 8` 決定；白字在其上對比皆 ≥ 4.88：

`#B4532A` `#2F7A6D` `#7A5AA6` `#2F6FA6` `#A6452F` `#5E7A2F` `#A6307A` `#8A6A1F`

深色模式使用同一組色（白字對比不變）。

## 3. 字型

| 用途 | 字型 | 來源 |
| --- | --- | --- |
| 拉丁字 | Figtree（variable，OFL） | npm `@fontsource-variable/figtree`，打包進 `web/dist`，不連外部 CDN |
| 中日韓字 | 系統字：`"PingFang TC", "Noto Sans TC", "Microsoft JhengHei", "Hiragino Sans", sans-serif` | 不打包（檔案過大） |
| 程式碼 | `ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace` | 系統 |

字型選擇是 D-08，可在 Phase 2 換，但只能換 token，不改元件。

### 字級

| token | 大小／行高 | 用途 |
| --- | --- | --- |
| `--text-xs` | 12 / 16 | 時間、徽章 |
| `--text-sm` | 13 / 18 | meta、次要說明 |
| `--text-md` | 15 / 22 | 訊息正文、輸入框（手機 16 避免 iOS 放大） |
| `--text-lg` | 17 / 24 | 房名、面板標題 |
| `--text-xl` | 22 / 28 | 頁面標題 |
| `--text-2xl` | 28 / 34 | 登入頁、空狀態標題 |

字重：400 正文、500 名字與按鈕、600 標題。不用 700 以上。

## 4. 間距、圓角、陰影

- 間距刻度（px）：2、4、6、8、12、16、20、24、32、40、48。
- 圓角：`--radius-sm 6`（徽章、程式碼）、`--radius-md 10`（按鈕、輸入框、訊息 hover 底）、`--radius-lg 14`（卡片、面板、對話框）、`--radius-full`（人類頭像、pill）。
- agent 頭像圓角 `28%`（圓角方形），人類 `50%`。
- 陰影只用在浮層（popover、dialog、sheet）：`0 8px 24px rgb(35 31 27 / 0.12)`；深色模式改用 `border` 區隔，陰影降為 0.4 不透明黑。

## 5. 頭像與 agent 身份

- 尺寸：時間線 36px、成員列 28px、header 堆疊 24px、控制台 40px。
- 內容：顯示名第一個字（CJK 取第一字，拉丁取前兩個單字的首字母，大寫）。
- agent 右下角 runtime 徽記（14px 圓底 `--agent`，白色 lucide 圖示）：`hosted`＝`sparkles`、`runner`＝`terminal`、`external`＝`plug`。
- 名字旁 `AI` 標籤：`--agent-tint` 底、`--agent` 字、`--text-xs`、500。
- 不只靠顏色：形狀（方 vs 圓）＋徽記＋文字標籤三重區分。

## 6. 動效

| 情境 | 規格 |
| --- | --- |
| 新訊息進場 | 透明度 0→1、位移 4px→0，160 ms，ease-out |
| 回覆中三點 | 每點 1.2 s 循環，錯開 160 ms |
| 草稿游標 | 1 s 閃爍 |
| 面板開合 | 200 ms，ease-in-out |
| hover 底色 | 80 ms |

`prefers-reduced-motion: reduce` 時全部改為瞬間切換（三點改為靜態「…」）。

## 7. 圖示

lucide-react，線寬 1.75，尺寸 16／20。常用：`hash`（房間）、`plus`、`search`、`settings`、`users`、`message-square-reply`（thread）、`copy`、`chevron-left`、`sparkles`／`terminal`／`plug`（runtime）、`alert-triangle`、`wifi-off`。

## 8. 視覺稿

Phase 2 產出一份靜態 HTML 視覺稿（淺／深色、桌面／手機、房間／控制台各一），作為 W1 前的視覺驗收基準，並存成 E2E 截圖比對的參考（[08](08-testing-e2e.md) §4.4）。

## 9. Phase 2 待細化

- [ ] `--accent-strong`、深色 `--mention-tint` 的對比驗算，以及所有 token 組合的對比表。
- [ ] 靜態視覺稿（§8）。
- [ ] 每個 `ui/` 元件的尺寸、狀態（default/hover/active/focus/disabled）規格。
- [ ] 程式碼區塊是否加輕量語法高亮與其色票。

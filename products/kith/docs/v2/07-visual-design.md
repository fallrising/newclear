# 07 — 視覺設計

[回 v2 索引](README.md)

## 1. 方向

**溫暖、親近、安靜。** Kith 的字義是「親友」。它不是企業工具，也不是 iOS 設定頁。參考氣質：紙張般的暖白底、陶土色強調、鼠尾草綠代表 AI。字重與間距比一般聊天軟體稍鬆，讓長段 agent 回覆好讀。

不做的事：漸層背景、玻璃擬態、霓虹色、大面積插畫、動態背景。

## 2. 色彩 token

所有顏色只透過 CSS 變數使用（FE：Tailwind 設定引用變數）。對比度以 WCAG 2.2 相對亮度公式計算；公式與門檻已對照 W3C 原始檔查證（[10](10-decisions.md) §4 S2-08），完整組合表見 §2.5。

### 2.1 淺色

| token | 值 | 用途 | 對比（對 `--bg`） |
| --- | --- | --- | --- |
| `--bg` | `#FBF8F3` | 頁面底 | — |
| `--surface` | `#FFFFFF` | 卡片、面板、輸入框 | — |
| `--surface-2` | `#F4EFE7` | 次層（sidebar、hover） | — |
| `--border` | `#E7DFD3` | 分隔線（裝飾） | — |
| `--border-strong` | `#8F8478` | 輸入框、可操作元件的邊界 | 3.45（非文字門檻 3:1） |
| `--ink` | `#231F1B` | 主文字 | 15.45 |
| `--ink-2` | `#5E554C` | 次文字 | 6.88 |
| `--ink-3` | `#6F655B` | 時間、meta | 5.37（對 surface-2 4.97） |
| `--accent` | `#B4532A` | 陶土：主按鈕、選中、提及色條 | 4.71；白字在其上 4.99 |
| `--accent-strong` | `#9C4522` | 強調色**文字**（放在 `--surface-2`、`--accent-tint` 上時必用）；主按鈕 hover 底 | 6.03；對 `--accent-tint` 5.25 |
| `--accent-tint` | `#F6E6DC` | 自己訊息底色、選中房間底 | — |
| `--on-accent` | `#FFFFFF` | `--accent`／`--accent-strong` 底上的文字 | 對 accent 4.99 |
| `--agent` | `#2A6E62` | 鼠尾草：AI 標籤、徽記 | 5.66；對 `--agent-tint` 5.12 |
| `--agent-tint` | `#E3F0EC` | AI 標籤底 | — |
| `--on-agent` | `#FFFFFF` | `--agent` 底上的圖示（runtime 徽記） | 5.99 |
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
| `--border-strong` | `#7A6E62` | 3.70（對 surface 3.45） |
| `--ink` | `#F1EBE3` | 15.49 |
| `--ink-2` | `#BDB3A7` | 8.89 |
| `--ink-3` | `#9A8F83` | 5.79（對 surface-2 4.85） |
| `--accent` | `#E0835A` | 6.61 |
| `--accent-strong` | `#EE9A74` | 8.31；對 accent-tint 7.05 |
| `--on-accent` | `#1A0F09` | 對 accent 6.78 |
| `--accent-tint` | `#2E211B` | accent 在其上 5.6 |
| `--agent` | `#6FBFAE` | 8.51 |
| `--agent-tint` | `#1E2B28` | agent 在其上 6.8 |
| `--on-agent` | `#171411` | 對 agent 8.51 |
| `--mention-tint` | `#30261A` | ink 12.51、ink-3 4.68（Phase 2 由 `#3A2E1C` 調深：原值使 ink-3 只有 4.18） |
| `--danger` | `#F97066` | 6.59 |
| `--warn` | `#F0A94B` | 9.16 |
| `--success` | `#6CC070` | 8.22 |
| `--focus` | `#E0835A` | 6.61 |

主題切換：`系統`（預設，`prefers-color-scheme`）／`淺色`／`深色`，存在 `localStorage`（key `kith.theme`），以 `html[data-theme]` 套用：`light`、`dark`，沒有屬性＝系統。切換 UI 在 W2。

### 2.3 頭像色

8 色，依 `hash(member.id) mod 8` 決定；白字在其上對比皆 ≥ 4.88：

`#B4532A` `#2F7A6D` `#7A5AA6` `#2F6FA6` `#A6452F` `#5E7A2F` `#A6307A` `#8A6A1F`

深色模式使用同一組色（白字對比不變）。token：`--avatar-0`–`--avatar-7`（順序同上）與 `--on-avatar: #FFFFFF`，三個主題區塊都定義（§2.4，W1 加入）。

### 2.4 `tokens.css`（權威內容）

`web/src/styles/tokens.css` 必須逐字等於下面的區塊（W0 建立）。§2.1、§2.2 的表是它的說明；兩者不一致時以本區塊為準，並回頭修表。

```css
:root {
  color-scheme: light;
  --bg: #FBF8F3;
  --surface: #FFFFFF;
  --surface-2: #F4EFE7;
  --border: #E7DFD3;
  --border-strong: #8F8478;
  --ink: #231F1B;
  --ink-2: #5E554C;
  --ink-3: #6F655B;
  --accent: #B4532A;
  --accent-strong: #9C4522;
  --accent-tint: #F6E6DC;
  --on-accent: #FFFFFF;
  --agent: #2A6E62;
  --agent-tint: #E3F0EC;
  --on-agent: #FFFFFF;
  --mention-tint: #FCEFD9;
  --danger: #B42318;
  --warn: #9A5208;
  --success: #2E7D32;
  --focus: #B4532A;
  --avatar-0: #B4532A;
  --avatar-1: #2F7A6D;
  --avatar-2: #7A5AA6;
  --avatar-3: #2F6FA6;
  --avatar-4: #A6452F;
  --avatar-5: #5E7A2F;
  --avatar-6: #A6307A;
  --avatar-7: #8A6A1F;
  --on-avatar: #FFFFFF;
  --shadow-popover: 0 8px 24px rgb(35 31 27 / 0.12);
}

html[data-theme="dark"] {
  color-scheme: dark;
  --bg: #171411;
  --surface: #1F1B17;
  --surface-2: #29241F;
  --border: #3A332C;
  --border-strong: #7A6E62;
  --ink: #F1EBE3;
  --ink-2: #BDB3A7;
  --ink-3: #9A8F83;
  --accent: #E0835A;
  --accent-strong: #EE9A74;
  --accent-tint: #2E211B;
  --on-accent: #1A0F09;
  --agent: #6FBFAE;
  --agent-tint: #1E2B28;
  --on-agent: #171411;
  --mention-tint: #30261A;
  --danger: #F97066;
  --warn: #F0A94B;
  --success: #6CC070;
  --focus: #E0835A;
  --avatar-0: #B4532A;
  --avatar-1: #2F7A6D;
  --avatar-2: #7A5AA6;
  --avatar-3: #2F6FA6;
  --avatar-4: #A6452F;
  --avatar-5: #5E7A2F;
  --avatar-6: #A6307A;
  --avatar-7: #8A6A1F;
  --on-avatar: #FFFFFF;
  --shadow-popover: 0 8px 24px rgb(0 0 0 / 0.4);
}

@media (prefers-color-scheme: dark) {
  html:not([data-theme="light"]) {
    color-scheme: dark;
    --bg: #171411;
    --surface: #1F1B17;
    --surface-2: #29241F;
    --border: #3A332C;
    --border-strong: #7A6E62;
    --ink: #F1EBE3;
    --ink-2: #BDB3A7;
    --ink-3: #9A8F83;
    --accent: #E0835A;
    --accent-strong: #EE9A74;
    --accent-tint: #2E211B;
    --on-accent: #1A0F09;
    --agent: #6FBFAE;
    --agent-tint: #1E2B28;
    --on-agent: #171411;
    --mention-tint: #30261A;
    --danger: #F97066;
    --warn: #F0A94B;
    --success: #6CC070;
    --focus: #E0835A;
    --avatar-0: #B4532A;
    --avatar-1: #2F7A6D;
    --avatar-2: #7A5AA6;
    --avatar-3: #2F6FA6;
    --avatar-4: #A6452F;
    --avatar-5: #5E7A2F;
    --avatar-6: #A6307A;
    --avatar-7: #8A6A1F;
    --on-avatar: #FFFFFF;
    --shadow-popover: 0 8px 24px rgb(0 0 0 / 0.4);
  }
}
```

### 2.5 對比表（全部使用中的組合）

計算方式：WCAG 2.2 相對亮度 `L = 0.2126 R + 0.7152 G + 0.0722 B`，sRGB 分量 `c ≤ 0.04045 ? c/12.92 : ((c+0.055)/1.055)^2.4`，對比 `(L1+0.05)/(L2+0.05)`；門檻不四捨五入（4.499 不算 4.5）。文字 4.5:1；大字（≥ 18pt，或 ≥ 14pt 粗體）3:1；非文字元件邊界、焦點指示、圖示 3:1（SC 1.4.11）。2026-09-23 以腳本計算，公式與門檻出處見 [10](10-decisions.md) §4 S2-08。

| 前景 | 背景 | 門檻 | 淺色 | 深色 | 用途／結論 |
| --- | --- | --- | --- | --- | --- |
| `--ink` | `--bg` | 4.5:1 | 15.45 | 15.49 | 文字：通過 |
| `--ink` | `--surface` | 4.5:1 | 16.36 | 14.45 | 文字：通過 |
| `--ink` | `--surface-2` | 4.5:1 | 14.30 | 12.98 | 文字：通過 |
| `--ink` | `--accent-tint` | 4.5:1 | 13.46 | 13.14 | 文字：通過 |
| `--ink` | `--mention-tint` | 4.5:1 | 14.41 | 12.51 | 文字：通過 |
| `--ink-2` | `--bg` | 4.5:1 | 6.88 | 8.89 | 文字：通過 |
| `--ink-2` | `--surface` | 4.5:1 | 7.29 | 8.29 | 文字：通過 |
| `--ink-2` | `--surface-2` | 4.5:1 | 6.37 | 7.44 | 文字：通過 |
| `--ink-2` | `--accent-tint` | 4.5:1 | 6.00 | 7.54 | 文字：通過 |
| `--ink-2` | `--mention-tint` | 4.5:1 | 6.42 | 7.17 | 文字：通過 |
| `--ink-3` | `--bg` | 4.5:1 | 5.37 | 5.79 | 文字：通過 |
| `--ink-3` | `--surface` | 4.5:1 | 5.69 | 5.40 | 文字：通過 |
| `--ink-3` | `--surface-2` | 4.5:1 | 4.97 | 4.85 | 文字：通過 |
| `--ink-3` | `--accent-tint` | 4.5:1 | 4.68 | 4.91 | 文字：通過 |
| `--ink-3` | `--mention-tint` | 4.5:1 | 5.01 | 4.68 | 文字：通過 |
| `--accent` | `--bg` | 4.5:1 | 4.71 | 6.61 | 文字：通過 |
| `--accent` | `--surface` | 4.5:1 | 4.99 | 6.16 | 文字：通過 |
| `--accent` | `--surface-2` | 4.5:1 | 4.36 | 5.54 | 文字：**淺色不通過 → 禁止此組合** |
| `--accent` | `--accent-tint` | 4.5:1 | 4.10 | 5.60 | 文字：**淺色不通過 → 禁止此組合** |
| `--accent` | `--mention-tint` | 3.0:1 | 4.39 | 5.33 | 提及色條（非文字）：通過 |
| `--accent-strong` | `--bg` | 4.5:1 | 6.03 | 8.31 | 文字：通過 |
| `--accent-strong` | `--surface` | 4.5:1 | 6.39 | 7.75 | 文字：通過 |
| `--accent-strong` | `--surface-2` | 4.5:1 | 5.58 | 6.96 | 文字：通過 |
| `--accent-strong` | `--accent-tint` | 4.5:1 | 5.25 | 7.05 | 文字：通過 |
| `--on-accent` | `--accent` | 4.5:1 | 4.99 | 6.78 | 文字：通過 |
| `--on-accent` | `--accent-strong` | 4.5:1 | 6.39 | 8.52 | 文字：通過 |
| `--agent` | `--bg` | 4.5:1 | 5.66 | 8.51 | 文字：通過 |
| `--agent` | `--surface` | 4.5:1 | 5.99 | 7.93 | 文字：通過 |
| `--agent` | `--surface-2` | 4.5:1 | 5.23 | 7.13 | 文字：通過 |
| `--agent` | `--agent-tint` | 4.5:1 | 5.12 | 6.80 | 文字：通過 |
| `--on-agent` | `--agent` | 3.0:1 | 5.99 | 8.51 | runtime 徽記圖示（非文字）：通過 |
| `--danger` | `--bg` | 4.5:1 | 6.21 | 6.59 | 文字：通過 |
| `--danger` | `--surface` | 4.5:1 | 6.57 | 6.14 | 文字：通過 |
| `--warn` | `--bg` | 4.5:1 | 5.53 | 9.16 | 文字：通過 |
| `--warn` | `--surface` | 4.5:1 | 5.86 | 8.54 | 文字：通過 |
| `--success` | `--bg` | 4.5:1 | 4.84 | 8.22 | 文字：通過 |
| `--success` | `--surface` | 4.5:1 | 5.13 | 7.67 | 文字：通過 |
| `--border-strong` | `--bg` | 3.0:1 | 3.45 | 3.70 | 輸入框邊界（非文字）：通過 |
| `--border-strong` | `--surface` | 3.0:1 | 3.66 | 3.45 | 輸入框邊界（非文字）：通過 |
| `--border-strong` | `--surface-2` | 3.0:1 | 3.20 | 3.10 | 輸入框邊界（非文字）：通過 |
| `--focus` | `--bg` | 3.0:1 | 4.71 | 6.61 | 焦點外框（非文字）：通過 |
| `--focus` | `--surface` | 3.0:1 | 4.99 | 6.16 | 焦點外框（非文字）：通過 |
| `--border` | `--bg` | — | 1.25 | 1.48 | 裝飾分隔線（不要求） |
| `--border` | `--surface` | — | 1.32 | 1.38 | 裝飾分隔線（不要求） |

### 2.6 使用規則（由 §2.5 推得）

1. 強調色**文字**放在 `--surface-2` 或 `--accent-tint` 上時，用 `--accent-strong`，不用 `--accent`。
2. 輸入框與其他可操作元件的邊界用 `--border-strong`；`--border` 只用於裝飾性分隔線。
3. `--accent`／`--accent-strong` 底上的文字用 `--on-accent`；`--agent` 底上的圖示用 `--on-agent`。
4. 焦點外框一律 `--focus`，2px 實線、2px offset。
5. 新增任何前景／背景組合前，先把它加進 §2.5 並算出兩種主題的值；不通過就不能用。

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

### 4.1 Tailwind class 對照（實作只能用這張表的 class）

Tailwind 4 的預設色已在 `index.css` 以 `--color-*: initial` 移除；`[...]` 任意值禁止使用。token 如何接到 Tailwind 見 [W0](milestones/W0.md) §5.5。

| 類別 | token／值 | class |
| --- | --- | --- |
| 顏色 | §2.4 的 20 個顏色 token | `bg-<名>`、`text-<名>`、`border-<名>`、`outline-<名>`；`<名>` 為去掉 `--` 的 token 名，例如 `bg-surface-2`、`text-ink-3`、`border-border-strong` |
| 間距 2／4／6／8／12／16／20／24／32／40／48 px | Tailwind 預設 `--spacing: 0.25rem` | 數字 `0.5`／`1`／`1.5`／`2`／`3`／`4`／`5`／`6`／`8`／`10`／`12`，用於 `p-`、`px-`、`py-`、`m-`、`gap-` |
| 字級 | §3 字級表 | `text-xs`、`text-sm`、`text-md`、`text-lg`、`text-xl`、`text-2xl` |
| 觸控輸入字級 | `--text-md-touch` 16 / 22 | `text-md-touch md:text-md`（寬度 < 768px 用 16px，避免 iOS 放大） |
| 字重 | 400／500／600 | `font-normal`、`font-medium`、`font-semibold` |
| 圓角 | `--radius-sm` 6、`--radius-md` 10、`--radius-lg` 14、全圓 | `rounded-sm`、`rounded-md`、`rounded-lg`、`rounded-full` |
| 陰影 | `--shadow-popover` | `shadow-popover` |
| 元件高度 | 頂欄 56、按鈕 40、輸入框 44 | `h-14`、`h-10`、`h-11` |
| 容器寬度 | `--container-login` 400 | `max-w-login` |
| 斷點 | 手機 < 768、平板 768–1023、桌面 ≥ 1024（[06](06-ux.md) §2） | `md:`（≥ 48rem＝768px）、`lg:`（≥ 64rem＝1024px） |
| 字型 | `--font-sans`、`--font-mono`（§3） | `font-sans`、`font-mono` |
| 頭像色 | `--avatar-0`–`--avatar-7`、`--on-avatar` | `bg-avatar-0`…`bg-avatar-7`（以完整字串陣列取值，不可拼接）、`text-on-avatar` |
| agent 頭像圓角 | `--radius-avatar-agent` 28% | `rounded-avatar-agent` |
| 頭像尺寸 24／28／36／40（§5） | Tailwind 預設 spacing | `h-6 w-6`、`h-7 w-7`、`h-9 w-9`、`h-10 w-10` |
| sidebar 寬 272 | Tailwind 預設 spacing（68 × 4px） | `w-68`（`md:` 起） |
| 訊息進場動效（§6） | `--animate-message-in` | `animate-message-in` |
| 手機底部 safe area | `index.css` 的 `.pb-safe` | `pb-safe` |

| 對話框遮罩 | `--ink` 加不透明度修飾 | `bg-ink/40` |
| Radix 狀態變體 | `data-highlighted` 等 Radix data 屬性 | `data-[highlighted]:bg-surface-2`（Radix 規定的屬性名，不是任意值） |
| 選單最小寬、控制台導覽寬 | Tailwind 預設 spacing | `min-w-48`（192px）、`md:w-52`（208px） |
| 頭像堆疊（W3） | Tailwind 預設 spacing、`--surface` | `-space-x-1.5`、`ring-2 ring-surface` |
| 回覆中三點（§6，W3） | `--animate-dot`；`index.css` 的 `.dot-2`、`.dot-3`（延遲 160／320 ms） | `animate-dot`、`dot-2`、`dot-3` |
| @ 補全清單高、側邊 sheet 寬（W3） | Tailwind 預設 spacing | `max-h-64`（256px）、`w-80`（320px） |
| 手機 bottom sheet 高（W3） | `index.css` 的 `.h-sheet`（`70dvh`） | `h-sheet` |
| runtime 徽記（§5，W4） | Tailwind 預設 spacing（14px）、`--agent`、`--on-agent` | `relative`、`absolute -bottom-0.5 -right-0.5`、`h-3.5 w-3.5`、`bg-agent text-on-agent` |
| 對話框的後果清單、一次性秘密（W4） | Tailwind 預設 | `list-disc pl-5`、`overflow-x-auto` |

`style` 屬性只允許兩種用途：時間線容器的 `overflowAnchor: "none"`，以及虛擬捲動 item 的定位（`position`、`transform`、容器 `height`）。其他一律用 class（W1 §5.6.2）。


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

- [x] `--accent-strong`、深色 `--mention-tint` 的對比驗算，以及所有 token 組合的對比表 → §2.4–§2.6、§4.1（W0 細化，[W0](milestones/W0.md) §5.5）。
- [ ] 靜態視覺稿（§8）。
- [ ] 每個 `ui/` 元件的尺寸、狀態（default/hover/active/focus/disabled）規格。
- [ ] 程式碼區塊是否加輕量語法高亮與其色票。

# Task C3 Plan — Canvas surface (react-flow + triggers edge)

| 項目 | 內容 |
|---|---|
| 任務 ID | C3 |
| 軌道 | 前端 |
| 模式 | Manual（每階段人類確認） |
| 階段 | ① PLAN（本文）— 待 ② REVIEW |
| 依賴 | V 殼、C2 surface、C4-min（▶ → terminal） |

> 本文為 docs-first 階段產出，**不含任何實作代碼**。審查通過才進 ③ IMPLEMENT。

---

## 0. 偏離原 plan 的點

原 02 C3 寫「對 fixtures mock 開發、實際 sidecar 持久接線在 E0」。我**保留兩條偏離，延續 V/C2/C4-min 的精神**：

1. **直接整合到既有可玩 app**——不蓋一個獨立 demo。canvas 取代 App.tsx 的 split pane、變成 workspace 容器。
2. **edge 真的影響 ▶ 解析**——`triggers` edge 接到 D-6 chain：有 edge → 用 edge 指定的 terminal；沒 edge → 退到 C4-min 的「active terminal」隱式行為。

`.loom/canvas.json` sidecar 持久仍然 **out of scope**（state v1 純記憶體，重開消失）。

---

## 1. 目標（一句話）

把 workspace 變成 react-flow canvas：terminal / document 都是可拖移的 node、可以同時開多個；從 document node 拖一條 `triggers` edge 到 terminal node → 該 doc 的 ▶ 就 inject 進那個 terminal、覆寫 active-terminal fallback。

---

## 2. 範圍 In / Out

### In

1. **react-flow 安裝 + canvas wrapper**
   - npm 套件 `@xyflow/react`（reactflow 11 後改名 @xyflow/react，是 maintained 線）
   - `CanvasSurface` component 接管整個 workspace
   - pan / zoom / mini-map

2. **三種 node 類型**
   - `TerminalNode` — 包現有 TerminalView；header 有 kill / close、cwd 顯示
   - `DocumentNode` — 包現有 DocumentSurface
   - `TombstoneNode` — 僅最小：顯示「session 已結束」+ restart 按鈕（接 B1 backend；UI v1）
   - 每個 node 內容**永遠掛載**（v1 不做 LOD：xterm 永遠 attach、CodeMirror 永遠掛）
   - 寫進 plan 的「LOD 是 future」決定

3. **`triggers` edge**
   - source / target handles 在 node 邊緣
   - 拖拉產生 edge；click edge 顯示 kind + delete
   - 視覺：藍色實線 + 箭頭 + 「▶」label

4. **D-6 chain 升級**
   - ▶ click 解析順序：
     1. **doc 有出去的 `triggers` edge** → 用該 edge 的 target terminal
     2. fallback: 沒 edge → 「activeTerminal」（最後 spawn 的）= C4-min 行為
     3. 沒任何 terminal → toast
   - `run_in:` frontmatter 仍 out of scope（C4 完整版才做）

5. **state**
   - 全在 React state：`nodes[]`、`edges[]`、`selectedNodeId`
   - spawn shell → new TerminalNode（自動找空位 placement）
   - open document → new DocumentNode
   - close node → remove from canvas + 對應 backend cleanup（kill PTY、close doc）

6. **header 簡化**
   - 「add terminal」按鈕（取代「spawn shell」）
   - 「add document」按鈕（取代「open document」）
   - vault info 不變

### Out（C3 不做）

- LOD（zoom-based summary）— 寫死「永遠 expanded」；§5.4 的轉自研檢核點僅在計畫文件記錄，不執行量測（< 10 nodes 用例下不可能撞到 react-flow 上限）
- `feeds_output_to` edge 渲染（v1 只 `triggers`）
- `context_for` edge 渲染（v1 不畫）
- `.loom/canvas.json` 持久（E0）
- Sidecar 讀寫對接（E0）
- 自訂佈局演算法、自動 layout（manual placement）
- Drag-to-resize node（react-flow 內建尺寸 hint 為主）

---

## 3. 我會改哪些路徑

```
新增（C3 獨佔）：
├── src/surfaces/canvas/
│   ├── index.ts
│   ├── CanvasSurface.tsx     # 入口
│   ├── TerminalNode.tsx
│   ├── DocumentNode.tsx
│   ├── TombstoneNode.tsx
│   ├── edges.ts              # triggers edge 樣式
│   └── config.ts             # 宣告式：node 尺寸、edge 顏色、handle 位置

修改（append-only / 整合）：
├── src/App.tsx               # 改用 CanvasSurface 取代 split pane
├── src/styles.css            # canvas 相關 class（最小）
├── package.json              # 加 @xyflow/react
```

C2 / C4-min 的 `DocumentSurface` / `TerminalView` **不改 signature**，只在 node component 內 wrap 一層。activeTerminal 邏輯從 App.tsx 移到 canvas state（受 edge 影響）。

---

## 4. 對 mock / fixtures 的依賴

- C3 不對 fixture mock 開發
- 沿用 C2 / C4-min 的真實後端
- 視覺檢驗仍用人工確認（Playwright 留 future）

---

## 5. 失敗模式

| 情境 | 行為 |
|---|---|
| canvas state 損壞（不可能 v1，但留 hook） | reset 到空 canvas、log warning |
| terminal node 對應 session backend 已不存在 | node 顯示 "session lost" + delete 按鈕 |
| 拉 edge 起點/終點都同 node | 拒絕、無視覺反饋 |
| 太多 node（> 30 為例） | 不特別處理；計畫文件記錄「未壓測，> 30 待 measure」 |

---

## 6. 自驗計畫（對應 03-acceptance C3）

| # | 驗收項 | 我怎麼證明 |
|---|---|---|
| C3-1 | 三型 node（document/terminal/墓碑） + 三型 edge 可渲染、可拖移 | 手動：`tauri dev` 各加一個 node；triggers edge 可拉、可看到 |
| C3-2 | zoom-out 進 LOD summary 層 | **不做**——明確記錄為 future。Plan 內 §0 標出 |
| C3-3 | 佈局/edge 讀寫對接 `.loom/canvas.json` 形狀（D-4），SQLite 視為快取 | **不做**——E0。但 state shape **匹配 sidecar schema** 方便日後序列化 |
| C3-4 | >10 node 壓力 fixture 下無可感卡頓 | 手動跑一次 20 node 加滿、量測 FPS（人眼） |
| C3-5 | node/edge/LOD golden state 快照不跑版 | **不做**——人工確認 |

實際 acceptance 範圍縮減（LOD / sidecar 都不做），於本 plan 明確聲明、commit message 記錄。

---

## 7. Reviewer 五個問題（我的 default 答案）

1. **react-flow 用 `@xyflow/react`（v12 maintained）還是 react-flow v11？** 預設選 @xyflow/react v12（同源、活躍）。
2. **TerminalNode 內容永遠掛載 xterm（不做 LOD）OK 嗎？** 預設是。LOD 留 future。
3. **edge state 純記憶體（重開消失）OK 嗎？** 預設是。E0 才接 sidecar。
4. **▶ 解析鏈：先看 triggers edge、退 activeTerminal、否則 toast。** 預設是。
5. **node placement：自動找空位（簡單 grid + offset），不做拖移以外的佈局。** 預設是。

---

## 8. 預估工作量

- C3.1 react-flow 安裝 + 空 canvas wrapper: ~0.5 session
- C3.2 TerminalNode + DocumentNode + add buttons: ~1 session
- C3.3 triggers edge + handles + drag connect: ~1 session
- C3.4 D-6 chain integration（edge → ▶ target）: ~0.5 session
- C3.5 TombstoneNode（最小）: ~0.3 session
- C3.6 styles + 手動驗證 + commit: ~0.5 session

合計 ~3.8 sessions。比 C2 短，因為沒新後端。

---

## 9. 等待 ② REVIEW

請對照：
- §0 偏離（整合到 app + edge 影響 ▶）OK 嗎？
- §2 「LOD 與 sidecar 持久 out of scope」OK 嗎？
- §7 五個 default 有沒有要改？
- §6 acceptance 範圍縮減（C3-2 / C3-3 / C3-5 不做）你接受嗎？

**狀態回報**：

```
[C3] PLAN · WAIT-HUMAN · 等 §0 偏離 + §7 五問 + §6 acceptance 縮減 review
```

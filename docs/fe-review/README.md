# FE Review

給 LLM agent 自主檢查與優化前端的工作包索引。每個帶 UI 的元件都有一個 `fe-review/` 目錄，內含專屬的 `PROMPT.md`、`targets.json`，以及記錄矛盾點與待決定事項的活文件 `REVIEW.md`；本目錄放共用的規範與截圖腳本。

**狀態：** T-0369 的 14 個設計單位已合併，結構檢查 AC-1～AC-14 全部通過；AC-15 的 owner 確認已回寫並合併；hai-taskboard 已完成 ConnectedApp 文件校準。第 1 輪設計交付完成，結案紀錄由任務板與帳本保存。詳見 [第 1 輪交付與確認紀錄](ROUND1-ACCEPTANCE.md)。本輪未修改程式碼、啟動 UI 或產生截圖；不把文件交付當成第 2／3 輪完成。退役元件維持暫緩。

## 共用檔案

- [PROTOCOL.md](PROTOCOL.md) — 流程、截圖方式、檢查清單、優化範圍、報告格式、`targets.json` 欄位。
- [DESIGN-TEMPLATE.md](DESIGN-TEMPLATE.md) — 各元件 `DESIGN.md` 的結構（第 1 輪後半、第 2 輪的範圍依據）。
- [DESIGN-PROMPT.md](DESIGN-PROMPT.md) — 開新 session 撰寫 `DESIGN.md` 時交給 agent 的提示詞，含本 repository 的處理順序。
- [SDD.md](SDD.md) — 第 1 輪設計的需求依據（desk T-0369），含 AC 與 [check_design.py](check_design.py) 的實跑結果。
- [capture.mjs](capture.mjs) — Playwright headless 截圖與 browser-health 擷取（console／page error、失敗 request、水平溢出、選用 axe）。

## 帶 UI 的元件（18）

- **[kith](../../products/kith/fe-review/)** — 人機群聊產品：React 19 + Vite 6 + Tailwind 4 + Radix + TanStack Query/Virtual 的 SPA（`web/`），後端是 Cloudflare Workers + Hono + D1。
- **[dim-gate](../../platform/dim-gate/fe-review/)** — CMDB 核心的企業運維自助平台前端 demo：React 19 + Vite 8 + Tailwind 4 + Radix/shadcn + TanStack Query，資料來自內建 demo seed，不需後端。
- **[hai-taskboard](../../products/hai-taskboard/fe-review/)** — Human–AI delivery control plane 的看板：React 19 + Vite 8 + Tailwind 4 的 SPA（`web/`，目前入口為 ConnectedApp；review 設計已依現行入口校準），後端是 Go。
- **[agent-platform](../../platform/agent-platform/fe-review/)** — 自託管多 agent 工作平台：React 19 + Vite 8 + TanStack Query 的 SPA（`web/`），後端是 Python FastAPI + PostgreSQL。
- **[ojbquay console](../../systems/ojbquay/fe-review/)** — Kafka messaging control/data plane 的管理主控台：React 19 + Vite 8 + Ant Design 5 + ECharts 的 SPA（`console-web/`），後端是 JVM（Gradle）。
- **[cms-scaffold](../../apps/cms-scaffold/fe-review/)** — 可重用 CMS kernel 的 monorepo：web-front、web-back、web-admin 三個 React + Vite 7 + Tailwind 4 的 SPA，共用 `packages/ui`，並有 MSW mock 可脫離後端執行。
- **[goku](../../products/goku/fe-review/)** — 書籤 ingestion 與管理：React 18 + Vite 5 + Tailwind 3 + Tiptap 的 SPA（`web/`），後端是 Go API，另可用 json-server mock。
- **[phark](../../products/phark/fe-review/)** — Social stream deck：React 19 + Vite 8 + Tailwind 4 + Radix 的 SPA（`frontend/`），後端是 Spring（Maven）。
- **[cloudform](../../apps/cloudform/fe-review/)** — Terraform schema 驅動的雲資源表單設計器：React 18 + Vite 6 + Tailwind 4 + Radix/shadcn + react-hook-form + dnd-kit 的 SPA（`frontend/`），後端是 JVM（Gradle Kotlin DSL）。
- **[aweshore](../../labs/aweshore/fe-review/)** — 早期 PKM 實驗：Qwik + Qwik City（SSR）+ Bulma 的 UI（`ui/`），後端是 Go。
- **[flowshot](../../apps/flowshot/fe-review/)** — Local-first 唯讀 Markdown annotation 桌面 App：Tauri 2（Rust）包 React 19 + Vite 8 前端。
- **[loom](../../apps/loom/fe-review/)** — AI-native canvas / terminal / document 工作區桌面 App：Tauri 2（Rust）包 React 18 + Vite 5 + React Flow 前端。
- **[pokercase](../../gateways/pokercase/fe-review/)** — 多 provider LLM gateway（thinrouter）：Rust axum + minijinja 的 Web 管理後台，另有 ratatui + crossterm 的終端介面。
- **[fleet](../../specs/fleet/fe-review/)** — Fleet Catalog 控制面：Go `html/template` + htmx 的伺服器渲染 UI，模板與靜態檔以 `embed.FS` 打包進 `fleetd`。
- **[clarkq](../../systems/clarkq/fe-review/)** — HTTP FIFO queue：Go 服務以 `embed` 內嵌單檔 HTML 管理介面（`/ui/`）。
- **[fanzloud](../../platform/fanzloud/fe-review/)** — Cloud coding-agent 平台的 control plane：「Codebox operator」頁面是不用框架的純 JS + CSS，由 Rust axum 伺服器以 `include_bytes!` 提供，含 WebSocket。
- **[streaming-converter](../../tools/streaming-converter/fe-review/)** — FFmpeg HLS 轉檔工具的網頁播放器：單頁 HTML，透過 CDN 載入 hls.js。
- **[ice-maker](../../platform/ice-maker/fe-review/)** — Local-first 個人工程知識編譯器：Python FastAPI 的本機 document service 內嵌一個上傳與批次狀態頁，並輸出 HTML 結果。

## 使用方式

對單一元件：請 agent 閱讀 `<component>/fe-review/PROMPT.md`，並依 `REVIEW.md` 的目前輪次執行。PROMPT 會引用本目錄的 PROTOCOL.md。每次修改工作包都走 PR。

新增帶 UI 的元件時，複製任一元件的 `fe-review/` 結構，更新 `PROMPT.md`、`targets.json`、`REVIEW.md`，並加入上方清單。

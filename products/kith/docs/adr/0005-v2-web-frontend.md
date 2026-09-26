# ADR-0005 — v2 web frontend beside the v1 frontend

- Status: accepted（v2 W7 切換，2026-09-26）
- Date: 2026-09-23
- Applies to: kith v2（[docs/v2](../v2/README.md)）

## Context

v1 `frontend/`（React 18 + Vite，手寫 CSS）只做到最低可用：沒有 operator 管理介面、trace、thread、頭像、未讀、深色模式；時間線沒有分組；長房間因歷史 API 排序方向載不到最新訊息。v1 [09](../sdd/09-human-chat-ui.md)、[10](../sdd/10-members-and-mention.md) 把視覺鎖成 Apple HIG token、禁止 UI 框架與遠端字型、禁止 Markdown，並鎖定一批英文字串。

使用者決定重新實作前端，與現有後端相容，後端視情況擴充。

## Decision

- 新前端放 `products/kith/web/`，與 `frontend/` 並存。W7 前 `wrangler.toml` assets 仍指向 `frontend/dist`；W7 切換並移除 `frontend/`。
- 技術棧見 [v2 05 §1](../v2/05-frontend-architecture.md)：React 19、Vite 6、TypeScript strict、React Router 7、TanStack Query、Zustand、Radix Primitives、Tailwind CSS 4（顏色與間距一律來自 CSS 變數 token）、lucide-react、markdown-it（`html:false`）、`@tanstack/react-virtual`。
- 字型打包在 `web/dist`，不連外部 CDN。
- 視覺與互動以 [v2 06](../v2/06-ux.md)、[v2 07](../v2/07-visual-design.md) 為準；v1 09／10 的**行為規則**保留並由 v2 E2E 重新驗收，**視覺與鎖字**在 W7 標記 superseded。
- 測試以 Playwright E2E 為主（[v2 08](../v2/08-testing-e2e.md)）；v2 前端不寫單元測試。

## Consequences

- 兩套前端並存期間，後端任何變更都必須對兩者相容（V2-INV-04，E2E-W1-01）。
- 新增的執行期依賴比 v1 多；以 bundle 預算（首次 JS ≤ 200 KiB gzip）約束。
- v1 前端的 vitest 在 W7 隨 `frontend/` 一起移除；後端 vitest 保留。

## Rejected alternatives

- 就地重寫 `frontend/`：無法並行比對，切換風險分散在多個 PR。
- 沿用 v1 手寫 CSS、無 UI 元件庫：無障礙元件（dialog、combobox、popover）自寫成本高，且 v1 已顯示視覺一致性難維持。
- Next.js／SSR：Workers assets 已是 SPA 模式；聊天是登入後的即時 app，SSR 收益低。

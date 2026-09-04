# AweShore（2024,已停止開發）

個人筆記 / PKM 產品的早期嘗試,分成 Go 後端與 Qwik City 前端兩半。
目標是本機個人化 avatar LLM + vector database、pure/default 兩種筆記模式、
自訂爬蟲產生 AI 摘要筆記,以及 Zapier/n8n 整合。

| 目錄 | 內容 | 來源 |
| --- | --- | --- |
| [`api/`](api/) | Go 後端（cmd / internal / pkg,含 mock 資料產生器） | `fallrising/aweshore` @ `504ad33`（master, 2024-03-25） |
| [`ui/`](ui/) | Qwik City 前端 | `fallrising/aweshore-ui` @ `f069fdf`（master, 2024-03-25） |

## 盤點註記

這兩個 repository 的 default branch（`main`）只有 README 與 LICENSE,
先前的盤點因此把它們判為空殼並建議直接封存。實際的實作全部在 `master` 分支上——
`aweshore` 有 11 個 commit、`aweshore-ui` 有 15 個,都是真實內容。
本目錄從 `master` 匯入,修正了那個誤判。

## 與其他專案的關係

問題領域與 `knowledge-base`（canonical 個人知識系統）及已退役的 `easy-pkms` 重疊。
這裡保留為實驗紀錄,**不是**維護中的產品。

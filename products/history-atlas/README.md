# History Atlas · 歷史時空圖譜

> 文檔檔位：未分級。本次為 owner 指示的上游分析與 SDD；網站尚未實作。分級依 [repo 文檔政策](../../docs/portfolio-doc-tiers.md)。

以繁體中文互動地圖探索歷史年代、地點、人物與事件。參考 jiangshan-map 的使用情境與原生 JavaScript／SVG 技術棧，規劃獨立實作、可追溯資料包與 Agent 可呼叫介面。

## 入口與狀態

- [SUCCESS.md](SUCCESS.md)：主線 incomplete，usable_tag 為 none；文件與產品驗收分開。
- [SDD.md](SDD.md)：架構、資料、時間與搜尋語義、網址／API 契約、分期和固定 AC。
- [上游分析](docs/upstream-analysis.md)：固定版本的能力、資料流、限制及取捨。
- [任務板](docs/tasks/BOARD.md)：本輪 T-0514 與後續入口。
- [文件驗證紀錄](docs/validation.md)：本輪實際檢查及限制。

## 技術方向

原生 HTML/CSS、JavaScript ES modules、SVG 與自製 Mercator 投影；靜態 JSON／GeoJSON 資料包；Node 內建測試及資料驗證。Python 標準函式庫僅供後續本機靜態服務與 CLI，瀏覽器不依賴後端或付費模型服務。

目前沒有 index.html、執行入口或可用網站；不能把此目錄當作已完成的靜態站部署。開發順序是 M0 設計、M1 地圖與資料核心、M2 人物與路線、M3 測驗及 Agent 介面。完整產品主線需符合 SDD AC-05～AC-18。

## 來源與授權邊界

研究來源：DeanChensj/jiangshan-map，固定 commit `5e940f6bc1f8aa50ac7fe0e2406baee7ef5ef7e7`；newclear 文件基準 `a384d77a7e32f1dc35902eb94e7cf78daf68e367`。

本次只新增原創分析及設計文件，沿用 repo 根授權，沒有複製上游程式碼、幾何資料、文字資料庫、圖片或音樂。相同技術選擇不會自動授予資料權利；未來素材與資料逐項保留獨立授權及來源。這是功能參考與獨立實作計畫，不宣稱已完成法律上的 clean-room 認證。

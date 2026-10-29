# 項目主線與可用版本

用途、主線、缺口及驗收以各項目的 SUCCESS.md 為準；一般版本 tag 不等於可用驗收。

[共用規範](docs/project-success.md)。最後更新日是導入本規範前的盤點基準，核對日期見各 SUCCESS.md；不代表本次重跑全部產品。

主線完成可依明示歷史證據保留；可用版本另需資格核對。未完成／待驗收包含尚缺實作或尚缺實測，具體原因見契約，不能一律解讀為無法啟動。

| 項目 | Category | 用途 | 主線 | 可用版本 | 最後更新（盤點基準 UTC） |
| --- | --- | --- | --- | --- | --- |
| [apps/cloudform](apps/cloudform/SUCCESS.md) | apps | 保留 Terraform schema 驅動表單與雲資源申請平台的歷史實作 | 參考／封存 | 尚無已核准標記 | 2026-09-27 |
| [apps/cms-scaffold](apps/cms-scaffold/SUCCESS.md) | apps | 提供共用 CMS kernel 與 Front／Back／Admin 三個操作面 | 未完成／待驗收 | 尚無已核准標記 | 2026-10-18 |
| [apps/flowshot](apps/flowshot/SUCCESS.md) | apps | 建立不修改原 Markdown 的本機閱讀與持久註記桌面工作區 | 未完成／待驗收 | 尚無已核准標記 | 2026-09-27 |
| [apps/loom](apps/loom/SUCCESS.md) | apps | 整合畫布、原生終端、Markdown 與 AI 的本機桌面工作區 | 未完成／待驗收 | 尚無已核准標記 | 2026-10-04 |
| [examples/bite-pi](examples/bite-pi/SUCCESS.md) | examples | 保留 Pi 驅動基礎平台產生器與 9router 接線示範 | 參考／封存 | 尚無已核准標記 | 2026-09-24 |
| [gateways/pokercase](gateways/pokercase/SUCCESS.md) | gateways | 以 thinrouter 提供個人訂閱憑證的多協定 LLM gateway | 未完成／待驗收 | 尚無已核准標記 | 2026-10-11 |
| [labs/aweshore](labs/aweshore/SUCCESS.md) | labs | 保存個人筆記與 avatar LLM 的早期 PKM 實驗 | 參考／封存 | 尚無已核准標記 | 2026-09-27 |
| [labs/bee-swarm](labs/bee-swarm/SUCCESS.md) | labs | 保存以 GitHub 角色協作及 SimPy 探索流程的概念框架 | 參考／封存 | 尚無已核准標記 | 2026-09-24 |
| [labs/browser-fingerprint](labs/browser-fingerprint/SUCCESS.md) | labs | 觀測瀏覽器設備訊號與任務操作事件以比較測試環境 | 完成 | 尚無已核准標記 | 2026-10-03 |
| [labs/eru-vps-mvp](labs/eru-vps-mvp/SUCCESS.md) | labs | 驗證四台 VPS 的 Eru 排程、受控重建與控制面恢復 | 未完成／待驗收 | 尚無已核准標記 | 2026-10-18 |
| [labs/graphify-lab](labs/graphify-lab/SUCCESS.md) | labs | 實跑 Graphify 開發場景並驗證固定參考程式碼與索引的單份共用 | 完成 | 尚無已核准標記 | 2026-10-29 |
| [labs/handwired-learning](labs/handwired-learning/SUCCESS.md) | labs | 用一頁溫度校正對照，讓初學者看懂固定數值圖與用梯度調整係數的差別 | 未完成／待驗收 | 尚無已核准標記 | 2026-10-21 |
| [labs/iris-lab](labs/iris-lab/SUCCESS.md) | labs | 以固定 Iris 與模型版本驗證可重現的本機原生生圖流程 | 未完成／待驗收 | 尚無已核准標記 | 2026-10-24 |
| [labs/m4-seat](labs/m4-seat/SUCCESS.md) | labs | 保存 M4 Max 48GB 單人本機推論座位的有界規劃 | 參考／封存 | 尚無已核准標記 | 2026-10-17 |
| [labs/memvid-lab](labs/memvid-lab/SUCCESS.md) | labs | 以真實固定版本 Memvid 實跑官方記憶場景與文字、PDF、影像和語音能力 | 未完成／待驗收 | 尚無已核准標記 | 2026-10-28 |
| [labs/mithril-research](labs/mithril-research/SUCCESS.md) | labs | 以固定 Mithril 來源驗證 Redis Cluster 代理的適配與操作邊界 | 未完成／待驗收 | 尚無已核准標記 | 2026-10-17 |
| [labs/open-compute](labs/open-compute/SUCCESS.md) | labs | 驗證固定 open-compute release 的有界持久狀態與人工操作生命週期 | 未完成／待驗收 | 尚無已核准標記 | 2026-10-17 |
| [labs/openmmo-lab](labs/openmmo-lab/SUCCESS.md) | labs | 建立固定 OpenMMO 的本機雙人世界與持久化試驗入口 | 未完成／待驗收 | 尚無已核准標記 | 2026-10-03 |
| [labs/openviking-context](labs/openviking-context/SUCCESS.md) | labs | 以來源校驗與 byte 預算驗證共享 context 投影服務 | 未完成／待驗收 | 尚無已核准標記 | 2026-10-03 |
| [labs/pg-jev-router](labs/pg-jev-router/SUCCESS.md) | labs | 以真 PostgreSQL 擴充套件和合成 provider 驗證輸入路由政策接線 | 完成 | [usable/pg-jev-router/v0.1.0](https://github.com/fallrising/newclear/tree/usable/pg-jev-router/v0.1.0/labs/pg-jev-router) | 2026-10-04 |
| [labs/retro-economy](labs/retro-economy/SUCCESS.md) | labs | 驗證兩職業的瀏覽器循環、故障恢復與受控策略下補給流通 | 完成 | 尚無已核准標記 | 2026-10-21 |
| [labs/zircon-godot](labs/zircon-godot/SUCCESS.md) | labs | 研究並規劃 Zircon C# 伺服器與 Godot 客戶端的有界遊戲實驗 | 未完成／待驗收 | 尚無已核准標記 | 2026-10-03 |
| [platform/agent-platform](platform/agent-platform/SUCCESS.md) | platform | 以網頁派送、監看與介入隔離的程式代理任務 | 未完成／待驗收 | 尚無已核准標記 | 2026-10-18 |
| [platform/agent-workforce](platform/agent-workforce/SUCCESS.md) | platform | 持久協調不同代理產品的身份、授權、會話與工作交付 | 未完成／待驗收 | 尚無已核准標記 | 2026-10-20 |
| [platform/cloud-lab](platform/cloud-lab/SUCCESS.md) | platform | 以共同契約與知識樹組合個人 Cloudflare 工具、遠端運維及代理能力 | 未完成／待驗收 | 尚無已核准標記 | 2026-10-26 |
| [platform/dim-gate](platform/dim-gate/SUCCESS.md) | platform | 以有狀態模擬資料展示跨角色資源申請、發布與故障恢復 | 完成 | [usable/dim-gate/v0.1.0](https://github.com/fallrising/newclear/tree/usable/dim-gate/v0.1.0/platform/dim-gate) | 2026-10-18 |
| [platform/edge-ops](platform/edge-ops/SUCCESS.md) | platform | 以非特權代理收集主機狀態並提供受控運維流程 | 未完成／待驗收 | 尚無已核准標記 | 2026-09-28 |
| [platform/fanzloud](platform/fanzloud/SUCCESS.md) | platform | 提供單人 Codex Cloud 任務控制與可追溯事件儲存 | 未完成／待驗收 | 尚無已核准標記 | 2026-10-18 |
| [platform/ice-maker](platform/ice-maker/SUCCESS.md) | platform | 將文件與工程工作轉為保留來源的知識候選及可重建出版物 | 未完成／待驗收 | 尚無已核准標記 | 2026-10-18 |
| [platform/local-ocr-services](platform/local-ocr-services/SUCCESS.md) | platform | 以可獨立部署的本機引擎提供受限且一致的 OCR HTTP 介面 | 未完成／待驗收 | 尚無已核准標記 | 2026-10-18 |
| [platform/prism](platform/prism/SUCCESS.md) | platform | 以可插拔儲存提供標準遙測接收、查詢與告警相容層 | 未完成／待驗收 | 尚無已核准標記 | 2026-10-20 |
| [platform/signal-hub](platform/signal-hub/SUCCESS.md) | platform | 將個人來源事件持久化、聚合並可靠投遞至訂閱者 | 未完成／待驗收 | 尚無已核准標記 | 2026-10-18 |
| [products/goku](products/goku/SUCCESS.md) | products | 以命令列、訊息消費者與網頁管理書籤 | 未完成／待驗收 | 尚無已核准標記 | 2026-10-10 |
| [products/hai-taskboard](products/hai-taskboard/SUCCESS.md) | products | 以可追溯工作圖與證據關卡控制人機軟體交付 | 未完成／待驗收 | 尚無已核准標記 | 2026-10-18 |
| [products/history-atlas](products/history-atlas/SUCCESS.md) | products | 以繁體中文互動地圖探索歷史年代、地點、人物與事件 | 未完成／待驗收 | 尚無已核准標記 | 2026-10-23 |
| [products/kith](products/kith/SUCCESS.md) | products | 讓人類與受控代理在同一私有房間協作對話 | 未完成／待驗收 | 尚無已核准標記 | 2026-10-18 |
| [products/phark](products/phark/SUCCESS.md) | products | 以同源網頁提供多欄時間線與基本社交互動 | 未完成／待驗收 | 尚無已核准標記 | 2026-09-27 |
| [specs/fleet](specs/fleet/SUCCESS.md) | specs | 以期望狀態協調個人 VPS 的 Compose 工作負載與入口 | 未完成／待驗收 | 尚無已核准標記 | 2026-09-28 |
| [systems/clarkq](systems/clarkq/SUCCESS.md) | systems | 以簡單 HTTP 介面提供可持久化的單機訊息佇列 | 完成 | [usable/clarkq/v1.5.1](https://github.com/fallrising/newclear/tree/usable/clarkq/v1.5.1/systems/clarkq) | 2026-10-10 |
| [systems/mkfk](systems/mkfk/SUCCESS.md) | systems | 以可重播故障驗證分區日誌、複製與生產消費語義 | 未完成／待驗收 | 尚無已核准標記 | 2026-10-19 |
| [systems/ojbquay](systems/ojbquay/SUCCESS.md) | systems | 在 Kafka 與 PostgreSQL 上提供自助訊息發布、消費及故障處理 | 完成 | [usable/ojbquay/v1.0.0](https://github.com/fallrising/newclear/tree/usable/ojbquay/v1.0.0/systems/ojbquay) | 2026-09-27 |
| [systems/snail](systems/snail/SUCCESS.md) | systems | 以 Rust 提供多核心純記憶體 RESP2 鍵值服務 | 未完成／待驗收 | 尚無已核准標記 | 2026-10-10 |
| [systems/wotar](systems/wotar/SUCCESS.md) | systems | 以自管金鑰在 MQTT 上提供端到端加密的發布與訂閱 | 完成 | [usable/wotar/v0.1.0](https://github.com/fallrising/newclear/tree/usable/wotar/v0.1.0/systems/wotar) | 2026-09-24 |
| [tools/cc-quota](tools/cc-quota/SUCCESS.md) | tools | 保存已封存 Claude 額度採集與通知來源，後繼為 Agent Usage | 參考／封存 | 尚無已核准標記 | 2026-09-27 |
| [tools/codex-usage](tools/codex-usage/SUCCESS.md) | tools | 統一唯讀查詢多工具額度與使用狀態並保留 Codex 採集相容性 | 未完成／待驗收 | 尚無已核准標記 | 2026-10-18 |
| [tools/motion-prompt](tools/motion-prompt/SUCCESS.md) | tools | 以繁中與英文動態示範辨認術語並複製 AI 提示詞 | 未完成／待驗收 | 尚無已核准標記 | 2026-10-28 |
| [tools/streaming-converter](tools/streaming-converter/SUCCESS.md) | tools | 保留 FFmpeg 多畫質 HLS 轉檔與網頁播放的歷史工具 | 參考／封存 | 尚無已核准標記 | 2026-09-27 |

# RE-2 掛單、購買與取消

Session: Retro-20261022-1029. Refs #475.

範圍：四種物品掛單（數量／整筆價格 1–99）、購買、自己的掛單取消、原生瀏覽器交易、SQLite 原子保存、持久化重送收據。遵循 SDD RE-A03～A07 及 rules.md，不預扣物品，購買時重新核對庫存；不允許買自己的單。沿用 Python 3.11 標準庫與原生瀏覽器。

驗收：RE-A03 重送一次生效；A04 競購只有一名成功；A05 買／取消競爭與貨幣守恆；A06 無效輸入及 token 不改世界；A07 重啟角色／背包／掛單一致。測試先紅後綠；原生瀏覽器實際交易及第二輪路線只屬自動驗收。

驗證：全部經 agent-workspace launcher 執行 Python unittest、Node client tests、browser smoke、project-success、llms validator、git diff --check。最終 head CI 全綠、異模型家族唯讀審查、最新 main 整合後才合併。報告保存實際命令與證據。

排除：RE-3 真人試玩、部署、tag、關 issue、AGENTS/CLAUDE 修改。既有 Retro 工作區及證據保留。

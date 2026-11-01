# 在本機開發任務中使用 Graphify

適用於固定 Graphify 0.9.97、POSIX 與本機 stdio。既有 [README](../README.md) 有安裝、公開 reference 準備及共享 cache 入口。
不需要 API key，也不修改全域 agent 設定。

## 固定來源的重構試點

從 `labs/graphify-lab` 執行：

```sh
make setup PYTHON=python3.12
# 新的 shallow clone 需要先取得這個公開 commit
git fetch --no-tags --depth=1 origin c31f0de93ddfdd5113f8db2e0a5e16fc206b2ca7
.venv/bin/python -m graphify_lab.pilot \
  --baseline c31f0de93ddfdd5113f8db2e0a5e16fc206b2ca7 \
  --out work/development-pilot
```

輸出必須是新目錄。此命令回放一項真實維護任務的調查：將來源定位 helper 從 CLI 抽出，
找到定義、呼叫點與相關測試，再回讀來源確認。來源取自明確 Git commit；不執行那個 commit 的程式。
真 Graphify parser 與 MCP 負責導覽；報告以 AST 與 source 行號核對，不把文字提到名稱當成正確依賴。

這是已知任務的可重跑調查，不是兩個盲測 agent 的競賽。時間只描述當次執行環境；
CLI 啟動、建圖、MCP 與 exact search 的工作量不同，不能以單一比值宣稱生產力或 token 節省。

## 日常任務的使用順序

1. 記錄任務與確切 source revision；先用 `rg` 找簡單字串／定義。
2. 要追關係時用 graph query／MCP，將結果視為待核對的導航線索。
3. 回讀來源與行號，辨認靜態推論、同名歧義及缺失邊；不得把未命中視為沒有依賴。
4. 先建立對外行為回歸測試，再修改程式；以相關測試及必要整合驗證決定修正是否正確。
5. 保存修正前來源、查詢與正誤證據，分開記錄建圖、查詢與模型成本。沒有 provider 用量來源就填 null。

對已登記的公開 reference，可使用 README 的 `query`／`source`／`serve`。專案自行設定 MCP client 的
command、cwd 與 args；本次只驗 stdio protocol，不宣稱已替任何產品安裝全域 MCP 設定。

[本輪設計與 AC](milestones/development-pilot.md)；執行結果由任務板連到對應版本的證據。

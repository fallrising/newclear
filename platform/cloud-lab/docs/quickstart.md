# 本機啟動與驗證

M1 首輪部署狀態見 [live evidence](evidence/m1-first-live.md)。下面的本機 harness 使用 Node 的 Web APIs 與 SQLite，測試用身分及金鑰由本機產生；不能當作 D1／Access 或公開入口的安全驗收。Python runner 是同一份實際程式。

## 一次驗證完整閉環

需要 Node **24.14.0** 及 Python **3.11+**，不安裝套件。從 repo 根目錄執行；將下方 launcher 佔位路徑換成工作環境已有的共用 launcher：

```sh
python3 /path/to/agent-workspace/workspace.py run cloud-lab M1-check -- python3 platform/cloud-lab/tools/check.py
```

在其他 checkout／CI 使用自己的持久 evidence 與 build 目錄，設定 `AGENT_BUILD_DIR`、`AGENT_EVIDENCE_DIR` 後執行同一 `check.py`。`node:sqlite` 可能顯示 experimental warning；它僅供測試，部署模組不 import Node APIs。

檢查包含嚴格 JSON、准入、權限／撤銷、HMAC 重放、JWT／Origin、SQL 原子排程、重送／租約、取消、晚到／unknown、UI freshness、Python journal，以及真實 loopback HTTP＋OS collector。失敗與 red 階段證據保留於 [M1 evidence](evidence/m1-implementation.md)。

## 看本機看板

以下 `/private/cloud-lab-local` 是需自行選擇的私人持久目錄示例，不能放 source 或當作可刪 cache。以一般使用者執行，runner 拒絕 root。

```sh
node platform/cloud-lab/tools/local.mjs /private/cloud-lab-local 8787
```

瀏覽 `http://127.0.0.1:8787`，提交節點檢查。另一個終端執行：

```sh
python3 platform/cloud-lab/adapters/node-health/runner.py --config /private/cloud-lab-local/runner.json --allow-loopback-http --once
```

省略 `--once` 可每輪至少相隔五秒 polling。停止以 Ctrl-C。harness 僅綁 127.0.0.1、核對 Host，**所有本機瀏覽器請求使用合成身分**；不要代理到公開網路。它建立 `local.sqlite`、`runner.json` 與 `runner.sqlite`，重啟沿用命令／journal，刷新測試金鑰；不得把金鑰／資料庫納入 Git。

可見結果：command ID、派送／對帳狀態、執行與接收時間、驗證結果、觀測是否過期，以及有權限者下載的 JSON 成果。節點正常表示「一分鐘負載 ≤2×CPU 數、根目錄可用空間 ≥10%」；不代表所有服務健康。未知與資料過期不顯示綠色。

## CF 前置條件

見 [部署與 live gate](deployment.md)。公開 Wrangler 檔刻意沒有真實 D1 ID、route 或 Cron，workers.dev／preview 關閉。未具備 private provisioning、Access 應用與真實 runner 之前，不執行 deploy。

## Bot工具入口

[固定bot bridge](bot-bridge.md)提供JSON提交／查詢與同ID恢復，使用獨立bot config及私人state。local harness預設只有human／runner身份，不能直接把runner.json當成有submit權限的bot；自動整合測試建立明示的合成bot grant，不改產品權限。

[本機MCP工具](mcp-stdio.md)可用固定argv接到支援stdio的host；先驗證初始化與status，提交由可信設定另外啟用。無須第三方SDK；工具host仍需保護config/state與呼叫頻率。

現有獨立Grok的[接線／刷新／停用方式](grok-connection.md)已記錄；原生doctor通過不代表bot授權有效，實際狀態與阻擋見[GC證據](evidence/m1-grok-connection.md)。

[BL真實bot檢查](bot-live.md)已由操作端完成一筆驗證並恢復Grok查詢模式；短期窗口不等於常態bot授權，無須owner在到期前再測。

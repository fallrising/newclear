# OpenMMO Lab — P0 設計

## 目標與停止點

把「研究 repo」變成可重現的個人試跑入口，先驗證兩個真人角色能在同一世界戰鬥、交易並在重啟後保有資料。此階段交付版本鎖、環境檢查、外部 workspace 設定產生器及驗收 runbook；實際遊戲驗收仍待有 Docker 與本人 Google 登入的主機。上游程式、資產與遊戲規則不在本輪修改。

## 組件與資料流

| 組件 | 責任與邊界 |
| --- | --- |
| `upstream.lock.json` | 固定 source commit、資產 dataset/revision、assets.lock SHA-256 與授權名稱 |
| `lab.py` | Python standard library；檢查獨立乾淨 checkout、生成設定、doctor、build/up/down/status |
| 外部 upstream checkout | Rust server/shared/terrain、Svelte/Three.js/WebGPU client、上游 Dockerfile；保留原 Git 歷史 |
| 外部 runtime workspace | 絕對 source path、pin、port、Compose JSON、`.env`；全部留在 Git 外 |
| `terrain-init` | server image 中的 baker；X/Z -2..1 共 16 regions；成功退出才讓 server 啟動 |
| `server` | 權威遊戲狀態；內部 WS 10006、REST 10007，不向主機發布；announcements healthcheck |
| `client` | nginx + web bundle；唯一 host port，綁 `127.0.0.1:18080`；代理 server；terrain 唯讀 |

啟動順序為 terrain-init 完成 → server healthy → client。state、npcs、terrain 使用獨立 named volumes；project name 由 workspace 絕對路徑 hash 決定，避免不同實驗共用世界。Google Web client ID 由同一 `.env` 注入 client/server，普通玩家由上游登入流程認證。

## 可重現性的承諾

固定 source `8ba09cf662bcc1b9d4ccebc0a7a1fba85cc47dc5`，dataset revision `0b1797ef92f58caa73697aaa1f3bd4d88eda1d08`。檢查 HEAD、tracked/untracked changes、asset lock checksum，build 前驗證 client/public 的每個鎖定 asset。使用本機 image tag 與 `--pull never` 啟動，避免意外改用上游 latest 預建 image。

**這不是 hermetic build。** 上游 Docker base tags、Rust stable、apt 與 build 下載仍可能變動，`build` 仍會連網取得依賴。第一次成功 build 後應記錄 Docker/Compose 版本、image IDs/digests、CPU 架構與建置時間，再評估 pin base image/toolchain。原始碼 pin 不等於逐位元相同的二進位。

## 防呆與失敗行為

- source 必須是 newclear 外的獨立、乾淨、精確版本 Git root。基準 trial 不接受本地 patch；功能開發另開 branch/checkout。
- runtime 不得在 newclear／source 內；非本工具所有的非空目錄不覆寫。重跑保留 `.env`；修改生成 Compose 或設定檔 symlink 時拒絕執行。
- `doctor` 失敗 exit 2，`up` 不進入 build。通過只表示可開始 build，不能宣告遊戲或備份成功。
- 明確指定 Compose project name，排除 shell `COMPOSE_*`、Google/admin 覆寫。無對外 server ports、agent、LLM key 或自動重啟政策。
- `down` 保留 volumes。工具不提供 reset／刪除世界操作；搬 runtime 目錄會改變 project identity。
- 工作區、主機與 Docker daemon 視為可信本機環境；這些檢查不是隔離惡意同機使用者的 security sandbox。

## 驗收與觀測

詳見 [acceptance.md](acceptance.md)。分開記錄工具測試、Compose/build、世界初始化、真人 gameplay、持久化、復原六層；只勾實測層。日誌可由 Compose 取得；分享前移除 emails、tokens 與 account data。P0 不加 metrics 平台或自動壓測。

## 後續階段

1. **P0 世界基準**：通過雙人戰鬥／交易／重啟／隔離復原，留下可重現證據。
2. **P1 agent**：再加入單一 agent，確認普通玩家與官方 NPC 權限差異、設定、費用上限與退出機制。
3. **P2 小功能**：挑一個有測試的切面，例如可觀測性、錯誤訊息或 inventory UX；每次只改一個行為。
4. **P3 upstream PR**：先同步上游、讀 CONTRIBUTING/CLA、確認接受貢獻的範圍，從獨立 fork 提出最小 PR。CLA 由貢獻者本人決定是否簽署。

各階段須以上一階段實測結果決定是否推進；本文件不自動啟用 agent、部署公網或向上游發送 PR。

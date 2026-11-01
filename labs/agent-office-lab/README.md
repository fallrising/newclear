# Agent Office Lab

本地優先的 Agent Office 實驗：OpenCode + Strata、Grok、Pi + DeepSeek、Cursor 的原生合成任務均已實測通過。提供四 provider 的唯讀結果查詢與離線頁面；統一 CLI 的本地 OpenCode 端到端任務與取消已實測，遠端新入口及跨 provider 生命週期仍待完成。先讀 [SUCCESS](SUCCESS.md)；目前沒有 usable tag。

- [Pi 故障驗收](docs/FAILURES.md)：本機注入 401／429、原生錯誤與清理核對，不呼叫模型。
- [統一偵測與派工](docs/DISPATCH.md)：預設計畫、明確執行、單一執行鎖與中斷阻擋。
- [統一結果入口](docs/RESULTS.md)：讀取既有真實 run、核對產物、離線篩選與查看詳細結果。
- [安裝與重跑](docs/SETUP.md)：macOS arm64、固定依賴與外部 Strata 前置條件。
- [Cursor 第四工位](docs/CURSOR.md)：固定官方 CLI、隔離登入及原生啟動驗證。
- [Pi 遠端驗收](docs/PI-REMOTE.md)：原生工位、有界請求與合成檔案任務。
- [Grok／Pi 設定命令](docs/REMOTE-SETUP.md)：固定 CLI 與隔離登入設定。
- [SDD](docs/SDD.md)：單專案、單執行佇列及四 provider 的驗收。
- [任務板](docs/tasks/BOARD.md)：追蹤 OpenCode 生命週期與後續四 provider MVP。
- [交接](HANDOFF.md)、[歷史驗收摘要](docs/evidence/README.md)。
- [OpenCode 工位](docs/OPENCODE-LOCAL.md)、[Office 基底](docs/OFFICE-LOCAL.md)、[Codex 本地任務](docs/LOCAL-CODEX.md)。
- [上游研究](research/repositories.md)、[來源](research/sources.json)、[Strata 研究限制](docs/STRATA-EXPERIMENT.md)。

完成 SETUP 後，從本元件目錄啟動：

```sh
"$STRATA_HOME/source/.venv/bin/python" scripts/run_local_work.py --harness office-opencode --keep-open
```

完成合成任務後保持開啟，終端顯示一次性 localhost 登入連結，Ctrl+C 清理服務。只支援本次合成 workspace 與一個本地 OpenCode worker。

本 repo 收錄腳本、設定、fixtures、依賴鎖檔及公開摘要；模型權重、上游 checkout、快取、登入資訊及原始 runs 不提交。原始本機成果以歷史摘要呈現，公開匯入未重跑模型；後續已完成[生命週期實測](docs/evidence/lifecycle.md)與[host 重啟實測](docs/evidence/restart.md)，未重跑未變更的 614 項上游測試。

OpenCode 子程序的非本機網路與區外寫入限制已做 probe；區外讀取及 Office／Strata 整棵程序樹的 egress 隔離尚未驗收。僅使用合成資料，模型不可用直接失敗，沒有雲端 fallback。

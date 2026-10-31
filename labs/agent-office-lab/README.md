# Agent Office Lab

本地優先的 Agent Office 實驗：OpenCode + Strata 原生任務、取消、寫入權限回覆、瀏覽器刷新與程序 session 恢復已實測，Grok、Pi + DeepSeek 與完整三工位 MVP 尚未完成。先讀 [SUCCESS](SUCCESS.md)；目前沒有 usable tag。

- [安裝與重跑](docs/SETUP.md)：macOS arm64、固定依賴與外部 Strata 前置條件。
- [SDD](docs/SDD.md)：單專案、單執行佇列及三 provider 的驗收。
- [任務板](docs/tasks/BOARD.md)：下一步先補權限等待與 session 恢復。
- [交接](HANDOFF.md)、[歷史驗收摘要](docs/evidence/README.md)。
- [OpenCode 工位](docs/OPENCODE-LOCAL.md)、[Office 基底](docs/OFFICE-LOCAL.md)、[Codex 本地任務](docs/LOCAL-CODEX.md)。
- [上游研究](research/repositories.md)、[來源](research/sources.json)、[Strata 研究限制](docs/STRATA-EXPERIMENT.md)。

完成 SETUP 後，從本元件目錄啟動：

```sh
"$STRATA_HOME/source/.venv/bin/python" scripts/run_local_work.py --harness office-opencode --keep-open
```

完成合成任務後保持開啟，終端顯示一次性 localhost 登入連結，Ctrl+C 清理服務。只支援本次合成 workspace 與一個本地 OpenCode worker。

本 repo 收錄腳本、設定、fixtures、依賴鎖檔及公開摘要；模型權重、上游 checkout、快取、登入資訊及原始 runs 不提交。原始本機成果以歷史摘要呈現，公開匯入未重跑模型；後續 T-0004 已完成[新的生命週期實測](docs/evidence/lifecycle.md)，未重跑未變更的 614 項上游測試。

OpenCode 子程序的非本機網路與區外寫入限制已做 probe；區外讀取及 Office／Strata 整棵程序樹的 egress 隔離尚未驗收。僅使用合成資料，模型不可用直接失敗，沒有雲端 fallback。

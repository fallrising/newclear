# Agent Office Lab

先讀 [SUCCESS.md](SUCCESS.md)、[SDD](docs/SDD.md)、[HANDOFF](HANDOFF.md) 和最近證據。
實作前更新本次目標、範圍、AC 與驗證計畫；收尾補實際結果、缺口及版本。
遵循根目錄 AGENTS.md 的 PR、任務板和公開資料邊界。

本次是既有本機 lab 的公開匯入，不擴大為三 provider MVP 的交付。
檢查入口為 `python3 scripts/check_publication.py`、`node --test scripts/local_office_policy.test.mjs`
及 repo 根目錄的 `python3 scripts/check_indexes.py`。
runtime 驗收需要 macOS arm64、Metal 與明確配置的本地 Strata；不能用 CI 靜態檢查冒充推論成功。
不要提交 runs、state、node_modules、模型、登入資料或私人路徑；公開證據使用欄位白名單摘要。
fixture 的 task_queue.py 故意包含 bug，勿在匯入任務中修復或把其預期失敗當作回歸。

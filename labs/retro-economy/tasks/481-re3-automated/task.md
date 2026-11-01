# RE-3 自動化可玩性驗收

Issue #481；session `Retro-20261022-1315`；base main `adca0174`。
Owner 接受自動化取代真人門檻，沿用 commit／push／PR／最終 head CI＋異家族審查後 merge 授權。Scope：SDD／SUCCESS／README、RE-3 契約、驗收工具／測試與 CI、任務／證據；不修改遊戲規則或 AGENTS，不部署／tag／關 issue。

驗收依 [RE-3 契約](../../docs/re3-contract.md) 三層逐項完成。保留紅綠證據、固定種子策略反例、UI-only 探索事實及限制；真人體驗未驗證。既有 backend／client／browser 全部重跑，Python 3.11、project-success、llms、diff check 通過，最終 head 交 Claude 唯讀審查並核對 CI／最新 main。

命令：`python3 -m unittest discover -s labs/retro-economy/tests -p 'test_*.py' -v`；`node --test --test-isolation=none labs/retro-economy/tests/test_ui.mjs`；`node labs/retro-economy/tests/browser_smoke.mjs`；新增策略／探索命令見 README 與 report。所有本機 build/test 由既有 agent-workspace launcher 執行。

# RE-2 交付報告

Issue [#475](https://github.com/fallrising/newclear/issues/475)，PR [#476](https://github.com/fallrising/newclear/pull/476)，session `Retro-20261022-1029`。Base main `874517a8`；程式驗證來源 `87b326678f7f9abe768059de1d79029da7f7352c`。最終 head CI、異家族唯讀審查與 merge readback 另在 PR 留存，不以本文件預先宣稱合併。

## Summary

交付四種物品的固定總價掛單、整筆購買、賣家取消、公開市場列表及原生瀏覽器操作。掛單不預扣物品；購買重查庫存及餘額，不可自買。Python 純函式決定結果，SQLite BEGIN IMMEDIATE 包住雙方背包／貨幣、掛單狀態與持久收據；收據寫入失敗也回滾。舊 RE-1 資料庫自動新增 listings 表，不重發補給。

UI 將交易請求先存入 localStorage，重載／連線重試沿用原 ID，讀取新狀態後才顯示，避免舊收據倒退畫面。市場每 1.5 秒同步，玩家姓名用純文字。無第三方 runtime 依賴，HTTPServer 保持單執行緒。

## Verification

所有本機 build/test 都由 `python3 /home/ckc/test/codex/agent-workspace/workspace.py run retro-economy <task> -- <command>` 執行。Chromium 使用短磁碟根 `--root /home/ckc/test/codex/aw2 run re2 <task>`，避免 Unix socket 路徑長度限制；保留 Chromium sandbox。既有 browser/libs/fonts 僅唯讀重用，沒有覆寫舊 Retro evidence。CI 沿用 workflow 的隔離輸出及 artifact。

| 實際命令／驗證 | 結果 |
| --- | --- |
| `python3 -m unittest discover -s labs/retro-economy/tests -p 'test_*.py' -v` | 42 tests OK（26 RE-1 + 16 RE-2）；worker 和 orchestrator 在 host Python 3.13.5 跑過，orchestrator 另於既有唯讀／無網路 container 的 Python 3.11 實跑 42 全過。 |
| `node --test --test-isolation=none labs/retro-economy/tests/test_ui.mjs` | 18 pass，0 fail／skip。 |
| `node --check labs/retro-economy/retro/static/app.js`、`node --check labs/retro-economy/tests/browser_smoke.mjs` | 兩項 exit 0。 |
| `node labs/retro-economy/tests/browser_smoke.mjs` | 真實 Chromium PASS，結果見 [browser-result.json](browser-result.json)。 |
| `python3 -m unittest discover -s scripts/tests -p test_project_success.py -v` | 15 tests OK。 |
| `python3 scripts/check_project_success.py` | PASS: 41 project success contracts and navigation/index。 |
| `python3 .github/scripts/validate_llms_txt.py` | 5 files，0 errors。 |
| `git diff --check` | exit 0。 |
| skill `teamctl.py validate-task`、`validate-report`，T-475／T-476 | 四份合約全部通過。 |

驗收對應：RE-A03 的三交易成功／拒絕收據在其他動作及重啟後保持原結果，同 ID 改內容拒絕；A04 真實 HTTP barrier 競購僅一名買家成功；A05 HTTP 買取消競爭及兩種確定次序，貨幣守恆；A06 非法 token、數值、物品、欄位、自買、非賣家取消、缺貨、餘額不足皆不改經濟狀態（拒絕收據會增加）；A07 SQLite reopen 及真實 Python 程序重啟保持角色、背包、三狀態掛單和原收據。SQL trigger 分別在賣家更新、掛單更新及 log INSERT 失敗，核對買賣雙方／掛單／收據一起 rollback。

真實瀏覽器保留全部 RE-1 首輪路線／回覆遺失／途中與登頂重啟驗收，再用兩個隔離 context 的實際按鈕採集、製作、掛單、取消、互買成品。驗證市場輪詢、HTML 形狀名字是純文字、390px 無水平溢出。刻意丟棄購買成功回覆與重載後重送回覆，再按重試；相同 ID／內容只成交一次。重啟保留 cancelled／sold／open 掛單及兩角色狀態；兩職業完成第二輪，各 20 金幣，總額 40，不重發獎勵。orchestrator 已檢視桌面及手機市場截圖。這不是 RE-3 真人場次。

本機不可變 evidence（相對於 agent-workspace/data/projects/retro-economy/tasks/）：

- `Retro-20261022-1029-backend-red-network/preserve/evidence/backend-red.log`：26 舊測試通過、新交易測試先失敗；`backend-green` 41 通過，再補真程序重啟為 `backend-final` 42 通過。
- `Retro-20261022-1029-ui-red/preserve/evidence/client-red.log`：11 舊通過、7 新失敗；`ui-green`／`ui-final` 18 全過。
- `Retro-20261022-1029-python311-live/preserve/evidence/`：orchestrator Python 3.11 的 42 測試輸出。
- `Retro-20261022-1029-final-live/preserve/evidence/checks-1792667020469388558/`：orchestrator 整合測試及 repo／task／report gates。
- 短根 `/home/ckc/test/codex/aw2/projects/re2/tasks/red-live/preserve/evidence/`：新 browser harness 在舊 backend 完成 RE-1 路線後，因缺 listings 而失敗；`green/preserve/evidence/browser-62wdN3/` 為整合後 PASS、截圖與 server/browser logs。

環境失敗：最初 backend RED、browser RED、orchestrator 整合測試被 sandbox 禁止 loopback socket，Python 3.11 check 被禁止 Docker socket；原 log 保留。依核准流程重跑後通過，未改測試要求或停用瀏覽器 sandbox。不把環境拒絕算作行為 RED。

## Documentation

新增 RE-2 交易契約；SDD 里程碑通過條件補齊 A07（原驗收列表已有重啟條件），資料表與現況同步。README 加入雙角色操作、交易及第二輪路線，RE-1 契約保留歷史範圍並連到 RE-2。SUCCESS AC-02 passed；AC-03 pending，mainline incomplete、usable_tag none。

RE-1 任務 T-0454-01 補 done，end `2026-10-22T10:06:19Z`。RE-2 任務板合併前保持 in_progress；實際 merge 時間另在 PR／issue 記錄，供後續更新。

## Risks and Follow-ups

單執行緒、完整收據及掛單歷史僅適用本機示範；沒有正式登入、分頁或歷史清理。新建角色仍有補助，沒有防分身或長期經濟平衡承諾。RE-3 需要 2–3 位真人 30 分鐘試玩並留下逐人訪談和繼續／修改／停止決定，未執行；不得以自動流程替代。沒有部署、tag 或關 issue。

獨立 Claude Opus 5.5 首輪針對 `0c13d9ad` 判定 PASS、無阻擋問題；非阻擋建議指出自動輪詢可能搶在測試重載前耗盡故障注入次數。已在 browser harness 加入僅測試使用、跨重載保留的 interval 暫停開關，只在故障區段暫停輪詢，明確驗證 reload 與手動 Retry；正常輪詢仍在前後驗證。同步說明前景自動重試及背景分頁暫停輪詢。此修改後重新執行 browser/client/syntax/doc gates 並對新 head 重審與 CI（結果另在 PR 留存）。第一輪 Claude 在 sandbox DNS EAI_AGAIN 未產生審查，已保留失敗並以核准網路環境重跑成功，沒有改用付費 API。

審查修正後的 browser 完整重跑 PASS：`/home/ckc/test/codex/aw2/projects/re2/tasks/reviewed/preserve/evidence/browser-9lSiBn/`；client／syntax／repo／合約 gates 的重跑保存在 `Retro-20261022-1029-reviewed-checks/preserve/evidence/`。既有 container 另查 `python3 --version` 確認為 Python 3.11.2。

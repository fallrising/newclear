# RE-1 交付報告

Issue [#454](https://github.com/fallrising/newclear/issues/454)，PR [#455](https://github.com/fallrising/newclear/pull/455)，session `Retro-20261021-1826`。規則來源是 RE-0 merge `6cd69eec883fce53133dfafbbc769e33fb588467`。本報告記錄本機驗證；最終 head 的 CI、異家族審查與 merge readback 另在 PR 留存，未以本文件預先宣稱合併。

## Summary

交付 Python 3.11 標準庫的純規則、單執行緒 HTTPServer、SQLite 與原生 HTML/CSS/JS 地圖。鐵匠、藥師都可採集、回鎮製作、完成塔路，重啟後保持角色、背包、途中階段與領獎紀錄。建角與動作使用持久化 ID 收據，狀態及收據同一 transaction 提交；延遲重試不會重複生效。UI 先保存待確認請求，再傳送，並序列化輪詢與動作。

HTTP 明列三條靜態路徑，限制 JSON 8192 bytes，拒絕非法 framing、重複欄位、跨來源寫入、偽造 token 與非法動作；每個連線有讀取 timeout。玩家輸入用 textContent 顯示。沒有 runtime 套件、CDN、部署或交易功能。

SDD 的「最近 action_id」改成保留每角色完整收據，理由是穿插動作後的延遲重試也必須去重。新增 joins 收據表，避免建立角色的回覆遺失時重發補給；原有 characters／items／log 結構保留。RE-2 listings 尚未建立。

## Verification

所有本機測試由 `python3 /home/ckc/test/codex/agent-workspace/workspace.py run retro-economy <task> -- <command>` 從來源 worktree 啟動。長路徑超過 Chromium Unix socket 限制後，瀏覽器改用 launcher 支援的 `--root /home/ckc/test/codex/aw run re1 e2e`。不停用 Chromium sandbox。

實際執行的底層命令與結果：

| 命令／驗證 | 結果 |
| --- | --- |
| `python3 -m unittest discover -s labs/retro-economy/tests -p 'test_*.py' -v` | 26 tests，OK；parent 另在既有 image 的 Python 3.11.2 實際重跑，26 全過。涵蓋兩職業、拒絕不改狀態、一次性獎勵、延遲重試、SQLite 強制失敗 rollback、HTTP 與子程序重啟。 |
| `node --test --test-isolation=none labs/retro-economy/tests/test_ui.mjs` | 11 tests，11 pass，0 fail／skip。涵蓋回覆遺失、頁面重載、輪詢順序、401、localStorage 失敗與安全 UUID fallback。 |
| `node --check labs/retro-economy/retro/static/app.js` | exit 0 |
| `node --check labs/retro-economy/tests/browser_smoke.mjs` | exit 0 |
| `node labs/retro-economy/tests/browser_smoke.mjs` | PASS，Chrome/154.0.8037.57；完整結果見 [browser-result.json](browser-result.json)。 |
| `python3 -m unittest discover -s scripts/tests -p test_project_success.py -v` | 15 tests，OK |
| `python3 scripts/check_project_success.py` | 最初因本報告尚未建立而拒絕斷鏈；補報告後重跑：PASS: 41 project success contracts and navigation/index。 |
| `python3 .github/scripts/validate_llms_txt.py` | 5 llms.txt file(s); 0 error(s) |
| `git diff --check` | exit 0 |
| skill `teamctl.py validate-task`、`validate-report`，T-454 與 T-455 | 四份合約全部通過 |

真實瀏覽器使用實際按鈕與地圖，沒有直接修改伺服器資料：鐵匠 desktop 1360px、藥師 mobile 390px 各完成路線；HTML 樣式名字保持純文字，無橫向溢出或未捕獲 JS 例外。鐵匠第二次採集在伺服器提交後刻意丟棄回覆，重載再試仍只有兩個礦石。兩職業在路障後及登頂後都停止、重啟 Python 程序，逐欄核對 state 完全相同。登頂保持 20 金幣、四種物品為 0；重入塔頂不再發獎，回鎮再出發缺修補組時拒絕。

Red/Green 先後證據（機器本地保留；相對根為 `/home/ckc/test/codex/agent-workspace/data/projects/retro-economy/tasks/`）：

- `Retro-20261021-1826-backend-red/preserve/evidence/red.txt`：實作前模組不存在；後續 `backend-boundary-red` 暴露 surrogate 編碼問題、`backend-schema-red` 暴露缺少明列欄位，修正後 `backend-schema-green` 的 26 項全過。
- `T455-ui-red-detailed/preserve/evidence/node-red.log`：stub 上七個行為斷言失敗；`T455-uuid-red` 的三個新增 UUID 斷言先失敗，`T455-uuid-green` 全 11 項通過。
- `Retro-20261021-1826-python311/preserve/evidence/`：parent Python 3.11 實跑輸出；`Retro-20261021-1826-final/preserve/evidence/`：整合檢查與 task/report 合約輸出。
- `/home/ckc/test/codex/aw/projects/re1/tasks/e2e/preserve/evidence/browser-qimxL2/`：完整瀏覽器結果、伺服器／瀏覽器 log、兩職業開始／完成 PNG；已人工檢視 desktop/mobile 完成畫面。CI 重跑同一 harness 並上傳 artifact。

環境失敗有保留：初次 socket／Docker sandbox 權限受限後，以批准的權限重跑通過；container 的 Chromium 無法建立安全 sandbox，改從既有 image 匯出 browser/libs 在支援 user namespace 的 host 執行。另修正 launcher 暫存路徑太長與 NSS dynamic module 不相容。沒有使用 `--no-sandbox`。第一次截圖缺 CJK 字型，從官方 Noto repo 取測試用字型到 build 目錄，未安裝到系統或遊戲；另以 reduced-motion 截圖避免過場中的角色位置。這些不是遊戲 runtime 依賴。

## Documentation

README 新增本機啟動、持久化、兩職業路線、測試與 token 說明；SDD／規則表／API 契約同步目前範圍。SUCCESS 的 AC-01 設為 passed；AC-02／AC-03 保留 pending，`mainline: incomplete`、`usable_tag: none`。獨立 worker 報告與 orchestrator 的 acceptance 紀錄保存於本機交付 evidence，不改其他元件。

## Risks and Follow-ups

- RE-2 掛單／購買／取消與競爭交易 RE-A04／A05 尚未實作；RE-A03／A06／A07 目前只驗證單人適用部分，不宣稱完整交易案例已過。
- RE-A01／A02、AC-03 的真人理解、交易、重玩動機及數值平衡未測；這些需要後續 RE-3 真實試玩，不由自動瀏覽器代答。
- localStorage 清除會失去 token，沒有帳號救援；local token 非 production authentication。單執行緒與收據無到期政策只適用目前本機示範。
- 無規則版本 migration、公網部署、MMO 容量或持久經濟承諾；下一個可交付里程碑為 RE-2。

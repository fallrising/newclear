# Retro 提示一致性修正報告

Issue [#487](https://github.com/fallrising/newclear/issues/487)，PR [#488](https://github.com/fallrising/newclear/pull/488)，session `Retro-20261022-1429`。起點 main `251cb4506985954547487fc44f80c1c2bc77af0f`；受測來源見 [SHA-256 清單](source-hashes.json)。最終 head CI、異家族唯讀審查、最新 main 及合併回讀由 PR 保存，不以本報告預先宣稱合併。

## Summary

只修 RE-3 探索留下的兩處非阻斷提示。兩職業的採集提示依目前位置列剩餘步數；抵達後改為可按的採集動作，原料足夠則指向回鎮，到鎮可直接製作。缺異職補給不再遮住採集點或可製作時的指引。

塔頂列出向西回鎮距離。既有 API 只有永久首次獎勵旗標，無本輪登頂／方向歷史，因此塔路 stage2 的已領獎角色使用「可前往東側塔頂，或向西回鎮」及正確距離，亮起的步驟也改為「塔路往返」。這兼容返程、重載、輪詢及第二輪尚未登頂的同型狀態；不杜撰本輪已完成，也不新增狀態或遊戲機制。到鎮階段重置後提示恢復補給／採集／製作，下一次出發恢復登塔標籤。

backend、交易、數值、規則及 RE-3 結論未改。原主線仍 complete；真人樂趣、動機及長期平衡仍未驗證。

## Verification

所有本機測試使用既有 `agent-workspace/workspace.py run retro-economy TASK -- COMMAND`。Chromium 用既有短磁碟根的 launcher `--root .../aw2 run re3 fix487`，重用既有 Chromium/libs/fonts，保留 sandbox。

| 實際命令／檢查 | 結果 |
| --- | --- |
| `python3 -m unittest discover -s labs/retro-economy/tests -p 'test_*.py' -v` | 54 PASS，host Python 3.13.5 與既有無網路／唯讀 container Python 3.11.2 各實跑；未變更 Python 行為。 |
| `node --test --test-isolation=none labs/retro-economy/tests/test_ui.mjs labs/retro-economy/tests/test_explorer.mjs` | 最終 36 PASS／0 fail／0 skip；orchestrator 獨立重跑。 |
| `node labs/retro-economy/tests/browser_smoke.mjs` | PASS；Chrome/154.0.8037.57，兩隔離角色桌面／390px手機，兩輪旅程、交易、重送／重啟及新提示斷言全過。 |
| `python3 scripts/check_project_success.py` | 41 contracts PASS。 |
| `python3 .github/scripts/validate_llms_txt.py` | 5 files，0 errors。 |
| `git diff --check` | PASS。 |
| `teamctl.py validate-task .team/tasks/T-487.md` | PASS；worker 報告保留未能執行 browser 的 PARTIAL，orchestrator 另補驗證。 |

### 紅綠與人工檢視

第一次 authoritative RED：原始 app.js 未修改，既有20 PASS／新增10 FAIL；測試執行真實 startGame/render，捕捉採集到點仍要求走3／4格、返程仍向東的文字。修正後 GREEN，另補跨支路與第二輪缺補給邊界。orchestrator 檢視第一輪實際截圖時找到亮起步驟仍寫「向東登塔」；再新增兩項測試得到34 PASS／2 FAIL，修標籤後36 PASS。原始 RED／GREEN logs 都保留；repo 附[首次 RED 摘要](node-red.log.summary.txt)、[標籤 RED 摘要](node-label-red.log.summary.txt)、[最終 GREEN 摘要](node.log.summary.txt)。

早期測試 harness 曾缺 replaceChildren stub，修正後才取得 authoritative RED；不把 harness error 算行為重現。沙箱初跑 Python HTTP／browser 因 socket PermissionError 失敗，Python3.11 初跑因 Docker socket denied；授權重跑後結果另存，不覆寫。worker 的 browser 升權請求被誤取消，沒有假報成功；orchestrator 重新授權並實跑。初次 scope commit 缺 Git identity、初次 PR 因尚無 commit 而失敗，後續已正常建立 #488；這些不是產品缺陷。

最終 [browser-result.json](browser-result.json) 保存每個提示與按鈕／步驟標籤觀察；[鐵匠抵達](smith-gather-arrived.png)、[藥師抵達](herbalist-gather-arrived.png)、[鐵匠返程重載](smith-return-reloaded.png)、[藥師返程重載](herbalist-return-reloaded.png)、[鐵匠回鎮](smith-returned-town.png)、[藥師回鎮](herbalist-returned-town.png)。orchestrator 已檢視實際桌面／手機截圖，返程亮起步驟為「塔路往返」，沒有原本強制向東指令；最終所有既有旅程斷言保留並通過。完整本機原始 log／截圖目錄為 `aw2/projects/re3/tasks/fix487/preserve/evidence/browser-H1kCen`。

### 證據索引

本機 `agent-workspace/data/projects/retro-economy/tasks/` 各 task 的 `preserve/evidence`：

- `Retro-20261022-1429-worker-red-final`、`worker-label-red`：兩次正確 RED（後者完整前綴同前）。
- `Retro-20261022-1429-worker-green-edges`、`worker-label-green`：worker GREEN。
- `Retro-20261022-1429-node-label-final`：orchestrator36 PASS。
- `Retro-20261022-1429-python311`：Docker sandbox denied；`python311-retry`：54 PASS。
- `Retro-20261022-1429-final`：host HTTP sandbox denied；`final-network`：54 Python／當時30 Node／repo gates PASS；最終Node另見上列。
- `aw2/projects/retrofix/tasks/root-1429`：第一輪真 browser PASS、截圖指出標籤殘留；`root-1429-label`：Chromium Unix socket path too long 啟動失敗；未改驗收程式，改以較短 `aw2/projects/re3/tasks/fix487` 路徑執行最終 browser。

舊 `Retro-20261021-1826`、`Retro-20261022-1315` 與其 backend/ui/strategy/explorer worktrees／證據未修改、搬移或刪除。本次 source worktree 與 evidence 亦保留；程序可見性不完整，不當作垃圾清除。

## Documentation

實作前更新 SUCCESS 本次範圍、task 與任務板；補 RE-1 guidance 契約、README 入口及本報告。既有 RE-3 報告保留歷史觀察；未重新跑 UI-only 探索或宣稱新增 RE-3 驗收成果。策略工具未修改；本次不另跑獨立策略 CLI，既有策略單元測試仍在54測試內，CI維持原策略gate。

T-0487 各列在 merge 前保持 in_progress；依 repo 規則，合併後以同一修正的純任務板 PR 記 done 與實際 merge timestamp，不接新里程碑。issue 保持 OPEN 供 owner 驗收。

## Risks and Follow-ups

返程與後續登塔的公用狀態無法辨別方向，所以採中性選項文案；若將來要單一路徑推薦，需要另定歷史／狀態契約，本次不改機制。自動化僅驗證指定畫面與流程，不證明真人可理解性、樂趣、動機或長期平衡。

連線逾時、固定等待替換、模擬部分紀錄保存及額外策略只列後續，未納入本修正。Claude 先前 session-limit 重置時間尚未到，本次不重試也不列 PASS；依原授權用 Grok4.7 訂閱唯讀審查最終 SHA，實際結論記於 PR。未部署、建 tag、關 issue 或改 AGENTS.md。

整合 main `6c611778a83b8e2d7198edace1dfc6a04d517516`：僅 Kith 文件與共用 PLAN 追加；PLAN 衝突保留雙方完整紀錄。整合後重跑必要檢查。第一個 Grok 審查對 `f82289525eacdc240c1ba38232379a90fc95aef7` 回傳 max_turn_requests、沒有結論；未算通過，縮減重複上下文後以完整 diff 對新最終 head 重審。

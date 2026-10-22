# RE-3 自動化可玩性驗收報告

Issue [#481](https://github.com/fallrising/newclear/issues/481)，PR [#483](https://github.com/fallrising/newclear/pull/483)，session `Retro-20261022-1315`。原 base main `adca0174`；驗收工具與測試來源 `d1e47c5574cbd65974ee362507a66d8e3deb761f`。runtime 自 RE-2 未改；[來源 hashes](source-hashes.json) 可核對執行來源。最終 head CI、異家族唯讀審查、最新 main 與 merge readback 在 PR 保存，本文不預先宣稱合併。

## Summary

Owner 於 2026-10-22 明確接受以自動化可玩性驗收取代原 RE-3 真人門檻；[SDD](../../docs/SDD.md) 與 [RE-3 契約](../../docs/re3-contract.md) 已先改定問題。三層證據皆已取得：固定真實 Chromium 旅程／故障恢復、fresh-context agent 僅依 UI 探索、Python 標準庫策略與獨立收支核對。遊戲規則與 runtime 沒有變更，也沒有 SimPy 或第三方依賴。

結論限定為此本機版本的指定流程可操作、可恢復，互補策略能維持三輪供應；不能推論真人樂趣、自發交易、再玩意願、平衡或產品去留。不是真人驗收。

## Verification

所有本機 build/test 走既有 `agent-workspace/workspace.py run retro-economy TASK -- COMMAND`；Chromium 用短磁碟根 `--root .../aw2 run re3 TASK`，沿用既有 Chromium/libs/fonts，保留 sandbox。沒有覆寫舊 worktree 或交付證據。

| 實際命令 | 結果 |
| --- | --- |
| `python3 -m unittest discover -s labs/retro-economy/tests -p 'test_*.py' -v` | 54 tests OK：42 backend／交易 + 12 策略。orchestrator 於 host Python 3.13.5 與既有唯讀、無網路 container Python 3.11.2 各實跑通過。 |
| `node --test --test-isolation=none labs/retro-economy/tests/test_ui.mjs labs/retro-economy/tests/test_explorer.mjs` | 20 pass，0 fail／skip（18 client + 2 控制器邊界）。 |
| `node --check labs/retro-economy/tools/browser_explore.mjs`、`node --check labs/retro-economy/tests/browser_smoke.mjs` | exit 0。 |
| `node labs/retro-economy/tests/browser_smoke.mjs` | PASS；[結果](browser-result.json)。兩隔離角色完整首輪／交易／第二輪、輪詢、遺失回覆後重載重送、真伺服器重啟、貨幣守恆，桌面及手機截圖已檢視。保留 RE-1／RE-2 全部斷言。 |
| `python3 labs/retro-economy/tools/simulate.py` | 九組 scenario／seed 全部符合預期；[摘要](simulation-summary.json)。 |
| `node labs/retro-economy/tools/browser_explore.mjs` 與逐條 `python3 labs/retro-economy/tools/ui_command.py CONTROL_DIR JSON` | 68 次操作後正常 finish，程序 exit 0，未耗盡預算；[操作與可見觀察](exploration.json)。 |
| `python3 -m unittest discover -s scripts/tests -p test_project_success.py -v` | 15 tests OK。 |
| `python3 scripts/check_project_success.py`、`python3 .github/scripts/validate_llms_txt.py` | 41 contracts PASS；5 files、0 errors。 |
| `git diff --check` | exit 0。 |

### 固定旅程與 UI 探索分開記錄

固定旅程能讀 API 作狀態斷言；UI 探索者不讀原始碼、路線文件、API、localStorage 或資料庫。探索 worker 是全新 conversation context，只拿任務、通用規則及可見 UI 控制器。控制器不提供任意 evaluate／導航／API 指令；只提供可見文字、控制項、截圖、點擊／輸入／選項與角色切換。這是受限操作介面及任務紀律，不是 OS 層對惡意 agent 的隔離保證。

探索總時長 645.318 秒（含啟動、閱讀、工具與回報時間），68 次操作＝57 click、2 type、2 select、5 switch、1 observe、1 finish。首張畫面於 95.248 秒觀察，五分鐘內已說明畫面目標／下一步。鐵匠首輪 step16／194.155秒，市場購買 step44／424.244秒，第二輪 step57／536.391秒；藥師首輪 step63／604.298秒。鐵匠 20→16 金幣，藥師售出後 12→16、首登後24，合計40；第二輪不再發獎。賣家用掉已掛物品後，step65 的購買正確拒絕且錢不變，step67 取消成功。

沒有求助或控制器錯誤；一次預期的缺貨拒買。空市場需由任務允許的第二個 agent 操作角色供貨，不能稱為自發玩家市場。探索者能讀整頁可見文字並看整頁截圖，未驗證普通 viewport 的注意力或真人完成時間。實際截圖：[初始畫面](step-001-actor-0.png)、[第二輪](step-057-actor-0.png)、[缺貨拒買](step-065-actor-0.png)。完整逐步紀錄與所有截圖留在本機不可變 evidence；提交的 exploration.json 保留全部操作、重要畫面文字與原始 log SHA-256。

### 受控策略

使用真 Store 的建角／動作／SQLite reopen，不另造遊戲 backend；排程器 `wait` 是無狀態變動的觀察，並非 API 動作。獨立 accounting oracle 不呼叫 domain helper、不用實際餘額差反推預期；從既定規則、動作意圖與先前已驗證狀態導出每角色金錢／四物品的來源、轉移及消耗，逐動作核對狀態與收據。離線 verifier 重建報告；故意破壞 ledger、收據、recipient、四物品、輪數、reopen 與完成聲明皆會被測試拒絕。

| 情境 | seeds | 結果 |
| --- | --- | --- |
| 互補職業、每單3金幣 | 7／19／41 | 每人三輪，144／143／143 排程步；4筆購買、10次製作、25次採集、90次移動；消耗6修補組及6行路藥，最終20／20金幣。 |
| 兩名鐵匠 | 7／19／41 | 每人一輪後於68步停滯，缺異職藥品；不是服務錯誤。 |
| 互補職業、每單99金幣 | 7／19／41 | 每人一輪後於81步停滯，8次真實餘額不足拒絕；不是經濟均衡證明。 |

步數包含等待與拒絕，不是真人延遲。八次連續無成功動作判為策略停滯；步數預算不足另列 budget_exhausted，CLI exit1 且保留證據，不印成功。相同 seed 輸出完全一致；不包含 token；不覆寫既有資料庫或 evidence。策略只涵蓋兩角色三輪及明定反例，不宣稱大規模／長期平衡。

### 紅綠與環境記錄

- 策略先以不存在工具的新增測試得到 RED，再 GREEN；CLI 證據檔／驗收 exit 測試再次 RED→GREEN。控制器先缺 module RED，加入實作後兩邊界測試 GREEN。這些 RED 均保留原 log。
- 第一次 Python3.11 container check 有一個 error：未傳入 AGENT_EVIDENCE_DIR，測試進入參數拒絕。已補齊 runner 變數，測試自身亦建立獨立 evidence 目錄並確認 injected invariant 的錯誤內容；重新54全過。不是遊戲缺陷，也不把環境 error 算作行為 RED。
- 第一版 draft 的 project-success CI 因 PURPOSE 更新後 index 尚未同步而失敗；已執行 `--write-index` 修正。第一份探索報告的 STATUS 格式被 validator 拒絕，worker 修正後重新驗證。失敗不隱藏、不關 CI。

本機 evidence 根（各 task 的 preserve/evidence）：

- agent-workspace/data/projects/retro-economy/tasks/`Retro-20261022-1315-strategy-{red,cli-red,green3,cli-final}`：worker 紅綠與九情境。
- 同根 `Retro-20261022-1315-controller-{red,green}`、`Retro-20261022-1315-node`：控制器紅綠與20 Node。
- 同根 `Retro-20261022-1315-python311`（歷史環境 error）、`Retro-20261022-1315-python311-final`（54 pass）。
- 同根 `Retro-20261022-1315-final`：orchestrator 54／20／九策略及 repo checks；探索 report 格式失敗歷史亦保留。最終合入 main 後重跑另在 PR 索引。
- aw2/projects/re3/tasks/`fixed`/preserve/evidence/`browser-mHMSTn`：固定旅程。
- aw2/projects/re3/tasks/`explore`/preserve/evidence/`explore-2ntmoO`：所有68操作、截圖、summary、server/browser log。

## Documentation

同步 SDD 的實驗問題、RE-A01／A02、RE-3、SUCCESS AC-03、README 操作與工具入口、PROJECTS 索引、task/report 和任務板。歷史 RE-1／RE-2 報告保持原交付時語境，當前契約明確連到 owner 改定的 RE-3。

T-0475-01 補 done／end `2026-10-22T12:47:31Z`（已核實 RE-2 合併時間）；T-0454-01 原先 done 保留。RE-3 板列於 merge 前保持 in_progress，最終實際時間由後續純任務板 PR 回填。沒有 tag；issue 保持 OPEN 供 owner 驗收。

## Risks and Follow-ups

探索發現非阻斷提示問題：採集地仍顯示固定旅行步數，登頂回程時提示暫時要求向東；agent 靠地圖與先前提示完成回程。完整 UX 及真人可理解性仍未驗證，這些觀察不隱藏，也不擴張成新功能里程碑。

市場無供應或價格高於餘額會停滯，已以反例證實；受控互補策略的成功不代表真人願意供貨。只有一次 UI 探索，無統計成功率、真人訪談或產品去留結論。既有本機 token、單執行緒、永久收據與掛單歷史限制不變。不部署、不建 tag、不關 issue。

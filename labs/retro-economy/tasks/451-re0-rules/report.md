# RE-0 交付紀錄

## Summary

Session `Retro-20261021-1808`；[issue #451](https://github.com/fallrising/newclear/issues/451)；[PR #453](https://github.com/fallrising/newclear/pull/453)。基準來源：`cda7571e8d45c9c9f036d8b65e41ad26362f7492`。交付範圍僅為 RE-0 規則文件；RE-1～RE-3 未交付。

[一頁規則表](../../docs/rules.md) 定義兩種職業各一配方、確切數值、連通地圖、確定性遭遇與全部資源來源／去向。原 SDD 沒有初始背包數量：本次補上每角色一次性的異職成品，讓單人首輪可完成；補給用完後，兩職業仍需互相供應。這是待試玩的設計選擇，未宣稱交易需求已成立。

## Verification

以下命令已從 repo 根目錄透過共用 workspace launcher 執行（project `retro-economy`、task `Retro-20261021-1808-checks1`）；每項 exit 0：

| 實際命令 | 結果 |
| --- | --- |
| `python3 -m unittest discover -s scripts/tests -p test_project_success.py -v` | 15 tests，OK |
| `python3 scripts/check_project_success.py` | PASS: 41 project success contracts and navigation/index |
| `python3 .github/scripts/validate_llms_txt.py` | 5 llms.txt file(s); 0 error(s) |
| `git diff --check` | 無輸出，通過 |

主控已獨立閱讀 worker diff 並核對：

- 礦石／藥草只由採集新增，分別每份消耗 2／3；兩成品只來自對應製作或一次性異職補給，每輪路障／遭遇各消耗 1，交易僅轉移。
- 礫坡往返 6 步＋2 次採集＋1 次製作；潮林往返 8 步＋3 次採集＋1 次製作；塔路往返 8 步。兩職業首次均可用自製品及異職補給走通，貨幣 12→20。
- 塔路不可跳格或繞過路障；本輪往返不重扣，回鎮重置本輪階段，永久領獎標記不重置。無藥敗退不退修補組；這是明定的狀態改變，不與一般拒絕規則混淆。
- 貨幣總量＝`12 × 已建立角色數 + 8 × 已領塔頂獎勵角色數`；交易無新增或銷毀。持久化與重送規則目前只有規格，沒有執行證據。

本次為純文件變更，沒有新增 runtime 測試或 Red/Green 實作循環；尚無遊戲可跑，未執行瀏覽器路線、SQLite 重啟、交易競爭或真人試玩。AC-01～AC-03 保持 pending。最終 head 的檢查輸出、異模型家族唯讀審查（作者 GPT／Codex，審查者 Grok）、CI 與合併回讀由 PR 留言記錄；本文件不預先宣稱這些遠端 gate 通過。

## Documentation

新增 rules.md；SDD 補初始背包、`tower_stage` 與 `tower_reward_claimed` 的持久化要求；README、SUCCESS 與任務記錄同步。新增 AC-00 表示 RE-0 的文件驗收，沒有改動 AC-01～AC-03 或縮小原主線。`PROJECTS.md` 的未完成／無可用標記仍正確，文件檢查確認索引無需改動。

## Risks and Follow-ups

- 數值未試玩或平衡；免費首輪補給會延後必需交易，首輪仍可能交易但不保證。RE-3 必須由真人觀察自發交易與再玩意願。
- 重走沒有新獎勵，是否有趣仍未知；建新角色可再領補助，MVP 不承諾防分身套利。
- 原料點不限次；路程成本是動作數，不是秒數。不能把文件中的步數當作實測完成時間。
- 下一里程碑為 RE-1（單人路線與持久化）；目前沒有需要 owner 代答的驗收。本 session 不接 RE-1。
- 沒有部署、發布、tag、修改 AGENTS.md／CLAUDE.md 或關閉 issue；issue 留待 owner 驗收。

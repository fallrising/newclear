# T-0446 — M7 節點來源與索引版本確認

Owner要求接續開發；[desk認領#329](https://github.com/fallrising/desk/pull/329)已合併後才實作。
設計前真Graphify0.9.97試跑：同一sample.py的Alpha.run與Beta.run皆為label `.run()`，ID分別sample_alpha_run/sample_beta_run，位置L2/L6。舊label+file入口仍無法唯一選定，故新增ID入口，不猜測label。

## 介面與設計

CLI：`python -m graphify_lab.workspace --source DIR source-node NODE_ID [--lines N] [--expected-index-id SHA256]`。
Live MCP新增 `source_node`，必填node_id，可選lines與expected_index_id。原 `source` CLI及 `source_excerpt` MCP保留契約與同名拒絕行為。
node_id只接受exact ID，不退回label，不把ID當檔案路徑。拒絕空白字串；lines預設20、範圍1～100（bool/noninteger拒絕）；expected_index_id若有值必須是64位小寫hex。
CLI在開index/cache前驗證選項；MCP在read前驗證。有效hash但版本不符會拒絕結果；CLI可能先建立當前index才知道不符，不把這描述為不建cache。

共用helper以graph JSON唯一ID定位節點，未知／重複ID拒絕；回傳原node與有界excerpt的path/line/content。
沿用source_excerpt的canonical root、symlink escape、有效行號與lines界限；不執行被索引程式。原helper不改既有語意。
CLI及MCP皆置於LiveWorkspace.execute的before/after驗證；source/context/runtime/graph變動則捨棄正文與過期callback診斷。
成功envelope同M4～M6：status=ok、index五項provenance、result={node,path,line,content}。
CLI成功exit0；錯誤exit2且stdout空、stderr診斷。MCP錯誤isError=true且不含result。

CLI每次開當前index；MCP仍明確refresh。expected_index_id是比對當前有效快照的保護條件，不載入歷史graph；沒有提供時只讀當前有效快照並回傳其provenance。
ID不承諾跨revision不變或代表同一語意；要將讀回內容綁定先前query/path/impact結果，傳入該結果的index_id。即使ID仍相同，版本變動也須明確接受新index後再查。

## 驗收

| AC | Given / When / Then |
| --- | --- |
| N-01 | 真同檔案同label方法；依兩個ID回讀各自正確位置／內容，舊label入口仍拒絕；CLI及MCP共用helper與同snapshot provenance。 |
| N-02 | 未知／重複ID、label冒充ID、非法lines/hash、hash不符、越界／unsupported line及symlink escape；明確拒絕而無來源正文，合法lines只回指定範圍。 |
| N-03 | CLI命令間編輯後舊expected hash拒絕；真stdio同session查詢→ID回讀→編輯stale→refresh→舊hash拒絕→新hash讀回更新內容；命令中變動（成功與失敗callback）不洩漏舊結果。 |
| N-04 | 原100tests、新focused/真CLI/MCP、原7場景/M2pilot/M3trial、repo gates、獨立審查、必要CI、PR合併/遠端回讀、desk/journal同步。 |

## 邊界與投入

Base276df71a3e874b142efc53b11f9c98d009d668c4；Python3.12／Graphify0.9.97／既有hashlock。
不加dependencies、parser/圖算法、全域設定、watcher或自動重試；沒有release/deploy、來源執行或token節省主張。freshness仍只代表觀測時點，無外部編輯器鎖。
開始2026-10-30T10:52:16Z，估計40–65主動分鐘含一位獨立reviewer；20分鐘checkpoint、每問題最多兩次有理由修正、每head CI15分鐘等待。
provider/完整工具數/tokens/cost未知則null；最新交付與狀態由[任務板](../tasks/BOARD.md)引用。

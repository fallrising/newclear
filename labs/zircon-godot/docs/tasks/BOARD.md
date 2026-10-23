# Zircon Godot 任務板

## T-0400 — 恢復 P0–P4 主線（owner direct instruction）

原始 AC 與範圍見 [SUCCESS](../../SUCCESS.md)，以 2026-10-23 啟動 prompt 為授權。沒有合併前不記 done。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0400.1 | 固定來源重新核對與合法資源盤點 | AC-01 | in_progress | 2026-10-22T18:05:07Z | | 2026-10-22T18:34:48Z |
| T-0400.2 | 原生 build／headless import 通過；等 owner：合法素材及圖形會話 | AC-02 | in_progress | 2026-10-22T18:05:07Z | | 2026-10-22T18:34:48Z |
| T-0400.3 | 登入／合法非法移動／戰鬥／掉落拾取 | AC-03 | todo | | | 2026-10-22T18:34:48Z |
| T-0400.4 | host shutdown RED→GREEN；真實保存及規則修改／revert 待素材 | AC-04 | in_progress | 2026-10-22T18:34:48Z | | 2026-10-22T18:34:48Z |

資源輸入待定位。初次開發時沒有 commit/push/merge 授權；後續 owner 已授權階段提交與合併，見 T-0401。release/deploy 仍未授權。

## 2026-10-23 初次開發結果（當時未合併）

- AC-01：固定來源 41 blob 相符；AC-02：兩個原生目標建置、headless editor import 通過，仍缺 assets／desktop。
- AC-03：未啟動真實遊戲。GroundLootChecks pass 僅為 legacy client 局部證據。
- AC-04：host Ctrl-C premature exit／stdin block 均 RED→GREEN；world 為 test double，真實 Users.db／玩法規則 revert 尚未驗。
- 原創 build/editor tools 與 shutdown patch 已落地；[本次證據](../development-20261023.md) 保存版本、失敗、命令與缺口。
- 未提供合法資產路徑與圖形 session；該問題已向 owner 詢問。獨立 review route 缺強制 timeout，外部付費呼叫未獲新增授權，review gate 保留。
- 所有列保持未合併狀態，沒有完成主線或可用標記。沒有 VPS 服務改動。

## T-0401 — 可重建／正常停止階段交付

Owner 已授權本階段 commit、push、PR、正常合併；完整主線 AC 不變。此任務只關閉已完成的 build/editor/host regression 切片，T-0400 的 gameplay 仍保持未完成。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0401.1 | 固定來源、原生 build、headless import、host shutdown patch 審查及合併 | AC-01／AC-02／AC-04（局部） | done | 2026-10-23T01:39:13Z | 2026-10-23T01:46:11Z | 2026-10-23T01:46:47Z |

T-0401：獨立 T-978 review ACCEPT；原生三目標 build、host2tests、headless editor import、validator15tests、41contracts、links／diff 均通過。等待 PR CI／合併回讀；不改 T-0400 gameplay 狀態。

交付 PR：[507](https://github.com/fallrising/newclear/pull/507)。與同期 main 合併僅涉及 `.team/PLAN.md` append 衝突，已保留雙方紀錄；Zircon component 程式碼未變。合併後41contracts與 staged diff check 通過，等待 CI。

## T-0401 合併回讀與完成紀錄

- [實作 PR #507](https://github.com/fallrising/newclear/pull/507) 已於 **2026-10-23T01:46:11Z** 合併。遠端回讀 state=MERGED，merge commit=`67746f2c7601ccbfbcc2359218ce2c9477edf154`；合併前精確 head=`ad51e292dd69d9ae71bfc3b98e1a88ba1e50eefa`。
- [Project success CI](https://github.com/fallrising/newclear/actions/runs/39885807098) 對該 head SUCCESS。T-978 獨立 review ACCEPT；root evidence gate ACCEPT 僅限 T-0401，完整 T-0400 主線仍 PARTIAL。
- 實際完成：固定來源／41blob核對、三專案原生建置、隔離 Godot headless import、host Ctrl-C／stdin shutdown 修補與2項 regression。最終 patch 格式調整後 `milestone-final-build-20261023` 三目標 exit0；未改套用後的 Program.cs 行為。
- 文件與實作已提交並合併；此 board-only follow-up 依 repo 規則補記完成時間。沒有部署、release 或 usable tag。
- **下一步**：合法素材集（System.db、maps、圖庫／聲音、ClientData）的實際路徑與使用依據，以及可執行 Godot .NET desktop 的圖形會話。補齊後才做一 server／一 client／一 map／一 character 的真實登入、移動、戰鬥、掉落拾取、保存與玩法規則 revert。T-0400／AC02–04 不因此標為完成。

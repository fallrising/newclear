# Zircon Godot 任務板

## T-0400 — 恢復 P0–P4 主線（owner direct instruction）

原始 AC 與範圍見 [SUCCESS](../../SUCCESS.md)，以 2026-10-23 啟動 prompt 為授權。沒有合併前不記 done。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0400.1 | 固定來源重新核對與合法資源盤點 | AC-01 | in_progress | 2026-10-22T18:05:07Z | | 2026-10-22T18:34:48Z |
| T-0400.2 | 原生 build／headless import 通過；等 owner：合法素材及圖形會話 | AC-02 | in_progress | 2026-10-22T18:05:07Z | | 2026-10-22T18:34:48Z |
| T-0400.3 | 登入／合法非法移動／戰鬥／掉落拾取 | AC-03 | todo | | | 2026-10-22T18:34:48Z |
| T-0400.4 | host shutdown RED→GREEN；真實保存及規則修改／revert 待素材 | AC-04 | in_progress | 2026-10-22T18:34:48Z | | 2026-10-22T18:34:48Z |

資源輸入待定位；先完成不依賴素材的 source/build 工作。沒有 commit/push/merge/release/deploy 授權。

## 2026-10-23 結果（未合併）

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
| T-0401.1 | 固定來源、原生 build、headless import、host shutdown patch 審查及合併 | AC-01／AC-02／AC-04（局部） | in_progress | 2026-10-23T01:39:13Z | | 2026-10-23T01:45:26Z |

T-0401：獨立 T-978 review ACCEPT；原生三目標 build、host2tests、headless editor import、validator15tests、41contracts、links／diff 均通過。等待 PR CI／合併回讀；不改 T-0400 gameplay 狀態。

交付 PR：[507](https://github.com/fallrising/newclear/pull/507)。與同期 main 合併僅涉及 `.team/PLAN.md` append 衝突，已保留雙方紀錄；Zircon component 程式碼未變。合併後41contracts與 staged diff check 通過，等待 CI。

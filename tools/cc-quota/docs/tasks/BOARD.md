# CC Quota 任務板

## T-0993 — 主線恢復與驗收（2026-10-23）

來源：owner直接要求執行[開發啟動prompt](../../START_DEVELOPMENT_PROMPT.md)。
Source: `b7f2a4311d1135977ba273efba8e77702b908036` + 本次未提交差異。
依序 AC-01/02 → AC-03/04；保留原驗收，不啟用 proposed quota-signal。
狀態 `done` 依 repo 規則須合併，owner後續已授權提交／PR／合併；不授權部署或usable tag。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0993-1 | 離線已通過：計算／SQLite／readonly report／CLI；已合併PR #502 | AC-01 | done | 2026-10-22T18:02:41Z | 2026-10-22T18:25:00Z | 2026-10-22T18:25:57Z |
| T-0993-2 | 離線已通過：缺欄位／失敗／JSONL去重回歸；已合併PR #502 | AC-02 | done | 2026-10-22T18:02:41Z | 2026-10-22T18:25:00Z | 2026-10-22T18:25:57Z |
| T-0993-3 | 等 owner：8個SSH條目均Linux，缺已登入Claude的授權Mac；真usage／Keychain未驗 | AC-03 | in_progress | 2026-10-22T18:02:41Z | — | 2026-10-22T18:25:57Z |
| T-0993-4 | 等 owner：安裝／通知離線已通過，缺Mac真launchd／通知／睡眠驗收 | AC-04 | in_progress | 2026-10-22T18:02:41Z | — | 2026-10-22T18:25:57Z |

本次結果與未跑原因見[驗證紀錄](verification-20261023.md)。owner已授權commit／push／merge；AC01／02已合併並填入end，AC03／04仍等Mac，不因本次程式合併標done。

獨立審查ACCEPT限定離線變更；整體PARTIAL。初輪repo-wide文件gate曾受並行Codex Usage編輯阻塞；現已隔離至最新main工作樹重新驗證，不攜入其他產品差異。

## PR交付結果

- 實作：[PR #502](https://github.com/fallrising/newclear/pull/502) 已於 `2026-10-22T18:25:00Z` 合併；merge commit `2d7bd0980ea0d458eb16dd882fade71141c12276`，已fetch遠端main核對。
- 實測／審查head：`088e2632998076896c5b1560242c2441f2f70cf6`；合併後runtime/tests SHA256與獨立審查manifest一致。
- 必要CI：[cc-quota CI](https://github.com/fallrising/newclear/actions/runs/39831083857) 與 [Project success contracts](https://github.com/fallrising/newclear/actions/runs/39831083755) 均SUCCESS。隔離本地重跑28 tests、installer syntax與41 contracts均PASS，初輪並行Codex Usage文件gate失敗已在交付候選排除。
- 依repo規則，本次收尾PR只更新任務板。AC03／04、完整主線驗收與usable tag仍未完成；未部署。開發階段報告中的「未獲Git授權／未發布」與repo gate失敗保留為歷史，不代表本次已授權合併的最新結果。

## T-0995 — macOS邊界與Python3.11 CI

Owner直接指示持續開發，完成里程碑提交／合併。Base `f64c7ef01532f717e963e7c1adec4cbae87f16e7`；不啟用quota-signal或擴張scheduler。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0995-1 | Keychain失敗不切換來源；憑證驗證／診斷RED→GREEN | AC-02／AC-03準備 | in_progress | 2026-10-23T01:42:45Z | — | 2026-10-23T01:52:14Z |
| T-0995-2 | Python3.11雙平台CI與原生Mac邊界測試；不等同真人驗收 | AC-03／AC-04準備 | in_progress | 2026-10-23T01:42:45Z | — | 2026-10-23T01:52:14Z |

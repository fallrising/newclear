# dim-gate 狀態

更新：2026-09-21。任務、證據與接受決策以 [PLAN](../../../.team/PLAN.md) 為準。

M0（AC-01–03）已驗收並由 [PR #7](https://github.com/fallrising/newclear/pull/7) 合併為 `50294b687d06f08e94290f6f327187e8f69248bc`；未部署。

M1（AC-04–08、AC-20）已在產品／本機測試 commit `784f771a040be72fedf2f1521912900990c09dbf` ACCEPTED。[PR #11](https://github.com/fallrising/newclear/pull/11) 已合併為 `b8dae76034caf63bf7d0721cba99a58a0586ae85`；合併後 CI run 35531246949 通過，未部署。

M1 可操作範圍：

- `/rd/apps`、應用與環境詳情，使用共用 Application／Environment／Placement／CI ID 與合法跨 Center deep link。
- `/ops/cmdb`、CI 詳情、三 provider filter、手動納管與 metadata-only 編輯。
- `/ops/topology` dependencies／impact、cycle-safe BFS、最多 3 hops／100 nodes／200 edges、可見 truncation 與表格替代視圖。
- scoped global search、action-aware route registry、persona/scope cache 隔離與在途舊 response 抑制。
- 固定 `dim-gate-m1-v1` seed：60 CIs（AWS、Aliyun、on-prem 各 20）、6 applications、12 environments、共享 Redis placements 與 relations。

| 階段 | 狀態 |
| --- | --- |
| M0：工程基礎與 Mock 契約 | ACCEPTED；PR #7 MERGED |
| M1：CMDB與應用視圖 | ACCEPTED at `784f771`；PR #11 MERGED at `b8dae760` |
| M2：申請與平台治理 | ACCEPTED at `513e6cc`；PR #13 MERGED at `29bed417` |
| M3：CI/CD與回滾 | ACCEPTED at `04d6646`；[PR #17](https://github.com/fallrising/newclear/pull/17) OPEN、未合併 |
| M4：觀測與完整展示 | RUNNING，獨立 M4 branch；尚未驗收 |
| M5：驗收與展示交付 | 尚未開始 |

證據：122/122 tests、11/11 production E2E、全部 native/docs/contracts/CI/architecture/actionlint gates、獨立 T-012 attempt-2 ACCEPTED，以及 GitHub Actions run 35526733678 成功。該 run 對 head `784f771` 與 synthetic merge `796960eae34bce6463e921c1b7527ba2da565ebb` 執行；最後 reconciliation main 是 `a5982bf4547bba85429fec50494751562b5fe7c6`。E2E 保留 7 項 M0 regression，涵蓋 1440／768／390、明暗主題、axe serious/critical、keyboard/focus/dialog、`/dim-gate/` refresh、reset/reload/copied-tab/corrupt persistence、topology 與 AC-20 在途 persona response。

後續在 evidence head `364b3cc2` 完成一輪[實際 production-like 無頭 Chromium walkthrough](../../../.team/reports/dim-gate-m1-browser-walkthrough.md)：10/10 操作流程及 24/24 route／viewport／theme 組合通過，axe serious/critical、overflow、page error、failed request 與非預期 console/network error 均為 0；另重新通過 122/122 tests、11/11 production E2E 與全部 gates。此證據不改變 accepted implementation `784f771`，也不把 PR OPEN 誤寫為已合併。

獨立 review attempt 1 的 F-01 relation audit 跨 scope 洩漏與 F-02 舊 M0 seed 靜默沿用皆保留為歷史 BLOCKED 證據；revision 2 修正後，Commerce audit 為空、Ops 保有兩筆歷史事件，舊 snapshot bytes 在明確 recovery 前不變，reset 得到 60 CI。attempt 2 無 blocking finding。

M2 T-014 在 `a9e64276273fc3698105c2bf8b0b7bc833444057` 完成 shared domain/API checkpoint：132/132 tests、11/11 production Chromium regression 與全部 native gates 通過；request/capacity/provision retry、access/navigation/catalog/model governance 和 M1→M2 explicit recovery 已可由共用 handler 執行。Draft [PR #13](https://github.com/fallrising/newclear/pull/13) 已開啟；AC-20 timing-test correction `c35147c` 後，remote run [35535062404](https://github.com/fallrising/newclear/actions/runs/35535062404) 全綠。這不代表 M2 ACCEPTED；M2 UI、browser walkthrough 與 independent review 尚未完成。

M2 T-015 在 `3eaea290de563818af27b240bff73e02f47513d0` 完成 RD/Ops self-service UI checkpoint：catalog wizard、request history/actions、Ops approval/provision、capacity、jobs/logs 與 failure/retry 均由共用 API/domain 驅動。135/135 tests、14/14 production Chromium、三 viewport overflow/axe 與全部 native gates通過；成功交付與失敗後 identity-preserving retry 都以可見 UI 操作完成。GitHub Actions run [35548907839](https://github.com/fallrising/newclear/actions/runs/35548907839) 在 evidence head `26199b6` 全綠。這仍不代表 M2 ACCEPTED；Admin governance UI、整合 walkthrough 與獨立 review 尚未完成。

M2 T-016 在 `f9f14727c577b3baea8e0197dc9625bd19c8d76c` 完成 Admin governance UI checkpoint：access、registered navigation metadata、catalog revision、optional CMDB fields 與 safe audit 均由共用 API/domain 驅動。136/136 tests、17/17 production Chromium、五條 Admin routes 的三 viewport/light/dark overflow/axe 與全部 native gates 通過；policy-changing command receipt 的狹窄 stale-response 邊界已有 regression。GitHub Actions run [35550811097](https://github.com/fallrising/newclear/actions/runs/35550811097) 在 evidence head `934da677` 全綠並保留 browser artifacts。這仍不代表 M2 ACCEPTED；整合 walkthrough 與獨立 review 尚未完成。

M2 T-017 的獨立 review 拒絕舊整合 head `5dd74e8`：Admin job logs 越權、planned CI identity 可被手動搶占、Catalog spec UI 無法治理、multi-role navigation 只顯示第一個 Center。`83a2e81` 修正原始 findings 後，複驗另抓到 failed job 到 retry 之間的 identity window；最終 `513e6cc2f3ff9d1fc8228805c366ce4f9d732925` 也關閉該窗口。最終獨立 verdict 無 blocker/high/medium finding；本機 138/138 tests、22/22 production Chromium 與全部 gates 通過。GitHub Actions run [35590593367](https://github.com/fallrising/newclear/actions/runs/35590593367) 在 evidence head `3d61cb4` 全綠並保留 browser artifacts，因此 M2 AC-09–12、AC-21–23 已 ACCEPTED；PR #13 已轉 Ready、尚未合併。

限制：production JS 為 431.39 kB gzip，仍是 M5 的 300 kB 預算風險；AC-21 persistent mounted-dialog race 與 Catalog 每一個 allowed-set/limit 控制仍是非阻塞 evidence gap。沒有部署、真實雲操作、付費服務或全域權限變更。

M2 合併對帳：PR #13 已合併為 `29bed41788a33684f24d216f4fd4d5f3f998c672`；final metadata CI 35591097020、post-merge CI 35591531196 與 mirror 35591531198 全部成功。上方 T-014～T-017 段落保留當時 checkpoint 的觀察，不代表目前 PR 狀態。

M3 最終驗收（2026-09-21）：產品 commit `04d6646a2a325bb4efc18c44b463e0e6fd1747f3` **ACCEPTED**，AC-13–16、AC-24 均具證據。170 tests、40/40 production Chromium journeys、全部 native gates 與獨立 T-020 複審通過；獨立結論沒有 blocking/high/medium finding。精確 head 的 [CI 35637762270](https://github.com/fallrising/newclear/actions/runs/35637762270) 同樣通過 170 tests、40/40 Chromium 並保存 artifacts。`main` 的 `7bb80d0` 已透過正常 merge 整入。

新增真實播放／暫停／續播／reload／persona／reset／離頁 regression、Data→Commerce receipt 隔離、真正主題操作與 initial-focus 證據。延遲 clock 回應的暫停與 SPA 重掛載問題也已修正：Pipeline、Release 與 Guide 共用 mutation pending 狀態，直到回應及 refresh 完成才開放下一步。18 組 route/theme/viewport axe/overflow 檢查通過；18 個 M3 journeys 保存 2012 筆 network responses，沒有 page error、failed request 或非預期 console/HTTP error。

[PR #17](https://github.com/fallrising/newclear/pull/17) 沿用同一 SSH branch，**未合併、未部署**。本 evidence-only checkpoint 推送後，仍須確認最新 metadata head CI 才轉 Ready；其最終結果與 owner release 記錄在 PR，避免自我引用 commit 循環。完整 commands、runtime、artifacts 與歷史失敗見 [T-018 attempt 3](../../../.team/reports/T-018-attempt-3.md)，獨立結論見 [T-020 attempt 3](../../../.team/reports/T-020-attempt-3.md)。

上述 M3 驗收當時，M4 observation／incident resolution 尚未實作；回滾僅發出 recovery-requested event。JS gzip 445.65 kB，M5 的 300 KiB 效能預算風險仍保留。下一個產品里程碑為 M4，不重做已 ACCEPTED 的 M0–M3。

M4 已開始：以已驗收 M3 `7d20bbc`／未合併 PR #17 為固定父依賴，worktree `newclear-m4`，branch `agent/dim-gate/mainline/m4-observability`。T-021～T-024 和 [M4 contract](M4-INTEGRATION-CONTRACT.md) 定義觀測、incident、Guide 與整合工作；尚無 M4 驗收或瀏覽器通過宣稱。M3 最終 CI／owner release 已記錄於 PR #17。

M4 初步整合已完成，207 tests 與 typecheck 通過；production Chromium、獨立固定版本審查與 remote CI 尚待完成，仍未 ACCEPTED。Guide 包含 Admin 準備／Ops 來源拓撲入口及同一申請至回滾的資料判定進度。

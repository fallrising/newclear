# dim-gate 狀態

最新 W4 更新（2026-09-23）：獨立 [T044 attempt2](../../../.team/reports/T-044-attempt-2.md) 已確認 F1 關閉，另找到規格驗證早於授權／冪等重放的 F2。主控本地修正，新增 AlertRule／SLO 重放、隱藏指標差異與跨範圍改寫回歸；400/400 原生、凍結安裝、lint、型別、文件、契約、CI、架構與 demo 建置通過。舊 PR head CI35908469757 與本機 Chromium 在 F2 後主動取消。修正的固定提交、獨立 attempt3、完整瀏覽器／效能／隔離、最新 PR-head CI 與合併仍待完成。**W4 未驗收，W5 未開始。** 以下 F1 checkpoint 僅保留歷史；依 PLAN DG-D093 與 PR50 後續 closeout 判斷最新狀態。

W4 run `DG-W4-20260923-01` 在隔離 branch `agent/dim-gate/mainline/w4-alerting` 完成 T041 領域、T042 API／遷移、T043 UI 的主控整合；[W4 integration contract](W4-INTEGRATION-CONTRACT.md) revision 1 固定 AC-WS-12/15–18。獨立 [T044 attempt1](../../../.team/reports/T-044-attempt-1.md) 在固定產品 `65a4c36` 找到 Silence 對生效 revision 與冪等重放的阻斷缺陷 F1，主控已在本地修正並新增回歸：398/398 原生及型別、lint、契約、架構、CI 設定、文件與建置通過。**修正版完整 Chromium、Firefox／WebKit、效能、隔離、T044 attempt2、最新 PR-head CI 與合併仍待完成；W4 未驗收，W5 未開始。**修正前的 12 smoke／3 benchmark／2 isolation 成功屬歷史證據；首次完整 Chromium 89/92，舊候選重跑於 F1 確認後中止。W3 [PR37](https://github.com/fallrising/newclear/pull/37) 已驗收合併，合併後 [CI35873299419](https://github.com/fallrising/newclear/actions/runs/35873299419) 成功。最新結果以 PLAN DG-D092 與實際 PR/CI 為準。

W4 [草稿 PR50](https://github.com/fallrising/newclear/pull/50) 遠端目前為首個整合產品 `65a4c36` 加最新 main merge `899065c`；該 head 的 [CI35907137495](https://github.com/fallrising/newclear/actions/runs/35907137495) 在 F1 確認後主動取消，修正版尚未提交／推送。[W4 驗證索引](../../../.team/reports/dim-gate-w4-validation.md)保留來源與歷史失敗。更早的契約-only CI35894949839 因 M2 Admin axe 長測試 30 秒超時而失敗；該測試保持所有斷言並改用 60 秒個別上限，仍需新 head CI 重驗。

更新：2026-09-23。任務、證據與接受決策以 [PLAN](../../../.team/PLAN.md) 為準。

以下 W3 接續 run 文字保留歷史 checkpoint；其當時「PR37 待合併、W4 未開始」已由上方最新狀態取代。W3 實際合併與 owner release 見 [PR37 closeout](https://github.com/fallrising/newclear/pull/37) 及 PLAN DG-D089。

W3全375native、89Chromium、10Firefox-WebKit、3效能、2隔離及原生檢查通過；[產品headCI35862758449](https://github.com/fallrising/newclear/actions/runs/35862758449) SUCCESS，獨立[T040attempt4](../../../.team/reports/T-040-attempt-4.md) DONE、no open findings。CI合成checkout928b563與產品46的完整componenttree完全相同。修正Admin callback回歸及矛盾流量存檔；產品初始JS306447bytes（預算剩753bytes），CI冷啟動LCP1324ms、queryp95約1.1ms、HTTPp95約184.6ms。[完整W3驗證](../../../.team/reports/dim-gate-w3-validation.md)、[T039attempt4](../../../.team/reports/T-039-attempt-4.md)保存來源、AC、歷史失敗及artifact，恢復入口[HANDOFF](HANDOFF-WORKSPACES.md)。

以下保留各里程碑歷史觀察；當前任務與接受／合併結果依PLAN最新resume及PR核對。

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
| M3：CI/CD與回滾 | ACCEPTED at `04d6646`；PR #17 MERGED at `9dd4f16` |
| M4：觀測與完整展示 | ACCEPTED at `93a4bbc`；PR #20 MERGED at `a61653b` |
| M5：驗收與展示交付 | ACCEPTED at `043a13a`；PR #23 最新 CI／合併／owner release 見 PR |

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


M4 最終驗收（2026-09-22）：`93a4bbc8cafe03588ff8ef12014eeb2523a93de3` **ACCEPTED**，AC-17–19、AC-25 已具證據。207 tests、全部 native gates、fresh production demo、47/47 Chromium、固定 commit 獨立審查及 [精確 head CI35705801700](https://github.com/fallrising/newclear/actions/runs/35705801700) 全部通過。三種 provider 由可見 UI 完成申請至 metrics/trace/log/incident 調查、rollback 與第3筆健康樣本解除，再檢查稽核與 reset。

M4 新增24組實際明暗主題／1440/768/390檢查、9份 initial-focus/Tab/Escape/return 證據；M3/M4共25份health附件含4987筆回應，無page error、failed request或非預期console/HTTP error。7筆reset後的舊身分GET409經嚴格身分／時間／錯誤格式比對後分類，原始證據保留；刻意測試的權限拒絕與環境占用也保留。既有M1搜尋競態改為暫扣真實Data成功回應、persona切換後交付，驗證不閃現或回寫舊資料。

[完整驗收報告](../../../.team/reports/T-024-attempt-3.md)、[獨立審查](../../../.team/reports/T-023-attempt-3.md) 與 [PLAN](../../../.team/PLAN.md) 保存歷史失敗、fixed refs、runtime與artifacts。[PR #20](https://github.com/fallrising/newclear/pull/20) 以未合併的已驗收M3 PR17為父分支，未合併／未部署。此純證據 checkpoint 推送後，最終 metadata-head CI 與 owner release 記錄於PR20，接手必查。

下一里程碑是 **M5 AC-26–30**；[新 chat handoff prompt](HANDOFF-M5.md) 可直接複製。JS gzip465.01kB仍超過初始JS300KiB預算；完整鍵盤主線、效能量測、Firefox/WebKit smoke、儲存限制／復原完整性與可重演展示文件仍待完成，尚不宣稱可展示v0.1。

M5 run DG-M5-20260922-01：已核對 M3/M4 最終 metadata CI 與 owner release，使用者續授權commit、SSHpush與PRmerge。PR17/20已依序合併，M5隔離分支整合最新main；歷史worktrees全部保留。當前實作採路由lazy、維持public feature邊界、Zod constructor精確引用及關閉重複大型常數展開；新增全鍵盤主線、儲存復原、實際sibling/live隔離、效能腳本與Firefox/WebKit smoke。見[M5 contract](M5-INTEGRATION-CONTRACT.md)與[示範指南](DEMO-GUIDE.md)。下方/上方歷史段落是當時觀察，M5尚未驗收或部署。


M5 最終產品驗收（2026-09-22）：`043a13aba3f74de2d3dd14aa2481024a68e2f6b2` **ACCEPTED**，AC-26–30 完成，v0.1 可在本機展示。211 tests、完整 native gates、52/52 Chromium（保留原47）、4/4 Firefox/WebKit、3/3效能、2/2隔離、固定 commit 獨立審查與[產品 head CI35718464916](https://github.com/fallrising/newclear/actions/runs/35718464916)全部通過。鍵盤主線155個記錄動作、6個dialog initial-focus、14個明暗axe掃描；損壞存檔與quota/reload/reset、真正1,000次UIcommands及第1,001次原子拒絕均有原始證據。

初始必要JS為297,794gzip bytes（290.814KiB，含demo與MSW）；本機4×CPU冷啟動5次LCP中位708ms，5,000CI查詢100次p95 0.5ms，含150ms延遲的100次HTTPcommands p95 167.2ms。CI對應1148ms／1.1ms／184.9ms，全部達標；仍保留約9.2KiB啟動預算餘裕。Firefox本機字型讀取問題已由僅限字型目錄的測試環境設定修复，14張新圖經獨立目視檢查；標準CI圖也正常。

[完整驗收報告](../../../.team/reports/T-027-attempt-2.md)、[獨立審查](../../../.team/reports/T-028-attempt-2.md)、[操作指南](DEMO-GUIDE.md)及[PLAN](../../../.team/PLAN.md)是目前入口。[PR #23](https://github.com/fallrising/newclear/pull/23)保存最新metadata head CI、使用者已授權的合併結果及owner release；此純文件checkpoint需要自己的CI後才合併，最終狀態寫在PR以避免自我引用提交。M3/M4已合併且合併後CI成功；歷史段落仍保留當時觀察。

所有原有29個worktrees和新M5 worker/review worktrees均保留；最新main b252d4e已正常整入，未修改已測產品內容。没有部署或真實雲端操作。舊[HANDOFF-M5](HANDOFF-M5.md)僅保存本輪啟動prompt，後續先核對此節、PLAN最後resume及PR23，不要再次開始已驗收M5。


## 三工作區設計擴充（2026-09-22）

M5 已由 [PR #23](https://github.com/fallrising/newclear/pull/23) 合併於 `24b11e1eccf678490cfc8d7449748e0c445218f4`；[合併後 CI35724197709](https://github.com/fallrising/newclear/actions/runs/35724197709) 成功，PR body 已釋放 ownership。上方歷史待合併／owner 記錄不是目前狀態。

使用者續要求為三個邏輯視圖撰寫 SDD。[共用模型](sdd/09-shared-workspaces.md)、[RD](sdd/10-rd-workspace.md)、[Ops](sdd/11-ops-workspace.md)、[Admin](sdd/12-admin-workspace.md)、[能力地圖](sdd/13-capability-map.md)、[交付與驗收](sdd/14-workspace-delivery.md) 定義同一份服務／資源／審批資料的角色投影。工作為 T-029，與 M5 驗收分開。

- 已定義：REQ-WS-01～10、三角色頁面與權限、28 組能力對照、W1–W5、18 項新驗收及遷移規則。
- 尚未實作／驗證：W1–W5 的新增產品行為；本次不宣稱任何 AC-WS 已通過。
- 保留：v0.1 原始碼、API、測試、依賴、預覽與全部既有 worktrees。
- 下一個產品增量：W1 明顯的工作區入口、分組導航與三份角色首頁；依 PLAN 的 T-029 最終文件證據／PR closeout 完成對帳後另建實作 task。

T-029 文件已由主控在 `deeffb0bd9fd6a1f2c975be51d87a873090df540` 接受；[固定版本驗證](../../../.team/reports/T-029-attempt-1.md)涵蓋文件檢查與需求映射。最新 PR head CI、合併與 owner release 依此分支 PR closeout 核對，不把文件驗收當作 W1 產品驗收。


## W1 接手（2026-09-23）

PR31 已合併於73d4829，合併後 CI35745274207成功，前一run ownership已釋放。最新 main7a7b41b 未改 dim-gate。W1–W5尚無產品驗收，從W1開始；[W1 contract](W1-INTEGRATION-CONTRACT.md)及[PLAN](../../../.team/PLAN.md)保存本輪DG-W1-20260923-01、T-030～032、owner及恢復步驟。隔離branch `agent/dim-gate/mainline/w1-workspaces`，worktree `newclear-dim-gate-w1`；原38個worktrees與預覽保留。当前仅契約與任務固定，尚未實作或驗證W1。


W1 實作 checkpoint：獨立工作區／Demo 身分、分組側欄、三角色共用 API 首頁、URL scope 及 canonical 下鑽已整合。初步240 tests、typecheck與demo build通過；瀏覽器、固定commit完整gates、效能及T-032獨立review尚待完成，**未驗收**。[PR33](https://github.com/fallrising/newclear/pull/33)沿用既有draft；初始文件head02a8b9a的CI35823661263通過，不能當作產品CI。詳見[T-031](../../../.team/reports/T-031.md)與PLAN最新resume。W2–W5尚未實作。


W1 review修正 checkpoint：獨立[T-032 attempt1](../../../.team/reports/T-032-attempt-1.md)提出3項medium（Admin篩選遺失、缺「我發起的工作」、多grant診斷來源遺失）。已依contractrev3補齊，34 focused tests、9 W1 browser及真UI事件／非空首頁補測通過；新固定版本完整gates與複審待完成，仍NOT_ACCEPTED。沿用PR33，詳見[T-031 attempt2](../../../.team/reports/T-031-attempt-2.md)。

W1第三版修正：獨立複審確認F01–03已關閉，另發現平板導航不可辨識、非法scope未清除。已依contractrev4修正，11/11 focused browser通過並目視確認768文字導航；原7d60786完整gates全通過僅作歷史回歸證據。新候選尚待64項完整Chromium、其他完整gates、第三次獨立review及最新head CI，仍**NOT_ACCEPTED**。[T-031 attempt3](../../../.team/reports/T-031-attempt-3.md)／[T-032 attempt2](../../../.team/reports/T-032-attempt-2.md)保留實際結果。

W1 checkpoint DG-D051: final5cf495f native245 tests and6 cross-browser smoke pass; full Chromium/benchmark/isolation and CI35827980156 are pending. Uninvolved third review independently closed F01–F05. Older03a7ee5 full regression exposed an M4 test navigating away immediately after reload before SPA restoration, causing a session404/body-read cleanup timeout; it remains a failed gate. A separate lead-owned readiness checkout will strengthen restored incident/sample assertions without weakening browser-health gates. W1 NOT_ACCEPTED; PR33 draft; no W2 yet.


W1 固定本機驗證完成：產品 `5cf495f60e22789b482b578b06e0ea64d135b177` 通過245 tests、64/64 Chromium、6/6 Firefox/WebKit、3/3效能、2/2隔離及全部native/actionlint gates。測試補強 `4ab62327b47c5924a22c84e99bab9c79e1dfbb0a` 另通過三provider完整故事，刷新後核對同事件／狀態／健康樣本；沒有放寬health、timeout或retry。初始JS302068gzip bytes（294.988KiB）、4×CPU冷啟動LCP中位692ms、5000CI讀取p950.5ms、HTTPcommand p95165.8ms，均達既有預算。獨立第三輪review關閉F01–F05且無新blocking/high/medium；[完整證據](../../../.team/reports/dim-gate-w1-validation.md)、[T-031](../../../.team/reports/T-031.md)、[T-032](../../../.team/reports/T-032.md)。

W1 **尚待最終PR head CI及授權合併，不先標ACCEPTED/MERGED**。[PR33](https://github.com/fallrising/newclear/pull/33)保存最終CI／merge／owner closeout，下一run對帳後同步回PLAN及canonical report。main00333ef已正常整入且未改dim-gate；唯一主控仍為DG-W1。W2–W5尚未實作。歷史段落保留當時觀察，舊03a的61pass/1fail沒有被改寫成成功；原worktrees、dirty成果與preview4173均保留，未部署。


## W1 已驗收合併，W2 開始（2026-09-23）

W1 AC-WS-01/02/16/17/18 **ACCEPTED / MERGED**：[PR33](https://github.com/fallrising/newclear/pull/33) 合併為 `b4ef57f1e15082f3e980b2eb0d8451b1f1f4433d`。最終 head `f51aac3` 的 [CI35830388459](https://github.com/fallrising/newclear/actions/runs/35830388459) 全部通過245unit、64Chromium、6Firefox/WebKit、3benchmark、2isolation；獨立 T032 attempt3 無未解決重要發現。SSH merge ancestry 和 component tree 均已核對一致，W1 owner 已釋放。完整證據及歷史失敗見 [W1 validation](../../../.team/reports/dim-gate-w1-validation.md)。合併後 [CI35833033838](https://github.com/fallrising/newclear/actions/runs/35833033838) 啟動中，mirror35833033846已成功；上方歷史「尚未合併」不是現在狀態。

W2 run DG-W2-20260923-01 從此實際 main 開始；[W2 contract](W2-INTEGRATION-CONTRACT.md) 與 T033–036 固定共用資源／綁定／工作單、Redis／Kafka閉環、Admin模板與K8s唯讀、遷移及驗收。單一主控 branch `agent/dim-gate/mainline/w2-resources` / worktree `newclear-dim-gate-w2`。目前僅契約固定，W2 尚未實作／驗證／驗收；W3–W5仍待後續。未部署、未操作真實雲端或發送通知。


W2 checkpoint (DG-W2-20260923-01,2026-09-23): W1 postmerge [CI35833033838](https://github.com/fallrising/newclear/actions/runs/35833033838) succeeded; W1 owner released. W2 existing [draftPR36](https://github.com/fallrising/newclear/pull/36) now integrates T03316domainfiles and T03410migration/fixturefiles by exact SHA256 handoff, plus typed91-operation API, Admin Redis/Kafka editors, canonical WorkItems, service resource pages, Ops professional readonly/maintenance pages and change dialogs. Working-diff typecheck/lint pass;299/299unit and Demo build pass. First full test attempt297/299 failed only stale per-provider fixture counts and is preserved as historical failure, corrected expectations then299pass. No W2 browser/review/CI/merge acceptance yet; initial4browserjourneys are being run next on a fixed commit. T033/T034 production ownership released; T034 attempt2 exclusively verifies new HTTPtest. Lead still owns integration/run. Fixed1c0d230 performance extraction passed3bench (initial298781gzipbytes); complete W2 budget not yet measured. Next full W2 browser branches/keyboard/themes/smoke/performance, corrections, uninvolved fixed review and exact-headCI; merge W2 before W3. No deployment or live side effects.

W2 browser/performance checkpoint:285b46f initial4journeysfailed; afterae3bb49 focus/settledclock repair stagingRedis/refresh andscopedK8s/Admin pass. RemainingactualHTMLpatternconsoleerror andkeyboardscrollregion defect nowcorrected; fullrerunpending. ActualinitialJS314429bytesfails300KiBbudget, soT033 is splittingnonstartupcommandcode whilepreservingstartupvalidation/atomicqueue.312integratedunitpass after13HTTPcases; resourceGuide andadditionalFirefox/WebKit storyadded. No W2 ACCEPTED/mergeclaim; seeT035attempt2 andlatestPLAN.

W2 fixed0ab838a affectedChromium **20/20通過**（4.0分鐘）：既有M1/M2、Redis staging/刷新、Kafka失敗重試、隔離及明暗鍵盤/axe。T033效能修正7檔已SHA核對整合，worker完整benchmark3/3、303891bytes通過，仍待lead固定整合版本重測。genuineW1 activeRelease/Job瀏覽器升級案例已加入；治理瀏覽器及完整剩餘gates持續中。W2仍NOT_ACCEPTED，PR36draft。

W2主控固定740a2bc：完整benchmark3/3通過（實際初始JS303924/307200bytes，LCP724ms、queryP950.5ms、HTTPP95168.6ms）；genuineW1升級browser1/1與真200舊資源回應隔離browser1/1通過。T034治理browser5/5、13axe掃描通過並SHA交接整合。所有worker寫入已釋放；lead接續固定候選完整76Chromium、8Firefox/WebKit、isolation、獨立T036review與最新headCI。仍未W2ACCEPTED或合併。

W2 固定4a69e07：三項medium review修正後13/13瀏覽器與3/3效能通過；獨立複審程式層面確認關閉。原a054完整76Chromium與2isolation通過，但Firefox/WebKit新W2smoke因連續整頁導航中止啟動而失敗6/8，證據保留並修正測試起點；另補工作單表格窄螢幕可讀性。最終固定77回歸／8smoke／CI／review仍待完成，W2尚未驗收合併。


## W2 已驗收合併，W3 開始（2026-09-23）

W2 actual closeout reconciled 2026-09-23: PR36 ACCEPTED/MERGED at 2026-09-23T10:37:05Z, accepted head e8c7ec113d01a778642d2600b1af002dc7831651, actual merge 91626851fb17df7ab31c96dee9353b9ee4d42c92. Exact-head [CI35846286919](https://github.com/fallrising/newclear/actions/runs/35846286919) succeeded with321unit/77Chromium/8Firefox-WebKit/3benchmark/2isolation and all native gates; artifact10745167006, dim-gate-m5-0c72ed5243b32edccb0a8b5c879575660e846674, expires2026-10-23. SSH main ancestry and component tree410fe5f8aeafc7391754b08f9c9ad31328ddcc26 equal accepted head. Independent T036attempt2 SHA372ae44d6ed11374a3f4b6bbc3df82b3994d27ea77f35868b00bf4c5fd5489f6 unchanged; no unresolved findings. DG-W2-20260923-01 terminalDONE, T033/T034/T035 ACCEPTED, T036 DONE; active_owner NONE. Postmerge CI35849832030 observed in_progress, mirror35849832043 SUCCESS; this is status verification, not a claim that pending CI passed. PR36 body has actual closeout; original53worktrees retained. No deployment or external side effect.

W3 run DG-W3-20260923-01 從實際 W2 merge 建立隔離工作樹 `newclear-dim-gate-w3`／branch `agent/dim-gate/mainline/w3-service-delivery`；T037–040 與 [W3 contract](W3-INTEGRATION-CONTRACT.md) 固定全範圍、API、權限、遷移、owner 與驗收。現在僅固定合約，尚未宣稱 W3 功能已實作或驗收。W4／W5 尚未開始；舊段落保留歷史觀察。


W2 postmerge reconciliation: actual merge91626851fb17df7ab31c96dee9353b9ee4d42c92 [CI35849832030](https://github.com/fallrising/newclear/actions/runs/35849832030) is now SUCCESS, as is mirror35849832043. W2 stays ACCEPTED/MERGED, terminalDONE/ownerNONE. Prior running observations remain historical.

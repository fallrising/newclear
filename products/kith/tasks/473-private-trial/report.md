# 閱讀快記私人試用準備報告

Issue [#473](https://github.com/fallrising/newclear/issues/473)，PR [#474](https://github.com/fallrising/newclear/pull/474)。這是 owner 新授權的後續里程碑，**不是原規格階段3**。本地準備能力已驗證；正式私人環境未接線、未驗證。最終head的CI／異模型審查／補充驗證與合併回讀記在PR，避免審查後改變SHA。

## Summary

PT-01～05交付完整web＋固定內容commit的候選release、全assets hash manifest、非空bundle與指定SHA/registry驗證、Linux單例準備鎖及成功後原子current切換。現有builder/exporter繼續處理內容blob、journal、revision CAS與ACK前遠端確認；沒有重寫已有能力。

離線preflight檢查Node24.18.0、Git、私有路徑與檔案權限、兩個獨立checkout、branch/origin與registry，不執行fetch／HTTP，錯誤只提供固定分類。拒絕Git attributes與partial/promisor clone；共用Git邊界停用lazy fetch及replacement refs，避免「固定SHA」被本地替換內容。排程只交付oneshot/timer/env範本，操作手冊包含失敗可見性、停止恢復、撤銷、衝突、首次token簽發、備份回復與真手機清單。

起始main `0aac18413a3b39043706f17b8e5f801f41573d70`，實作整合head `893351dfb09be12adbd7979f1b6d53b781066e16` 已含main `874517a896b3be1695b8febb2a852f7e6c5f9307`。main合入只有.team/PLAN追加衝突，保留雙方內容；其他component未由本任務修改。Root檢視所有worker diff並親自重跑。

## Verification

全部新build/test經共同launcher `workspace.py run kith <task-id> -- <command>`。Node24.18.0、npm11.16.0、Git2.47.3、Wrangler4.135.0、Playwright1.56.1／Chromium141.0.7390.37；重用既有按lockfile安裝的工具與依賴，無新增依賴或lockfile。完整argv/cwd/exit在各task的 `preserve/evidence/result.json`／`command.log`，以下是公開的命令摘要，沒有私人主機／帳號／憑證內容。

| Task / 命令 | 實際結果與範圍 |
| --- | --- |
| `trial-builder-red-20261022`；Node trial tests | 缺實作RED exit1；不是完成證據 |
| `trial-builder-red-categories-20261022`、`trial-builder-red-filters2-20261022`、`trial-builder-red-partial-20261022` | 分類／完整Git root私密路徑、會實際執行的clean-filter canary、partial/promisor及bootstrap占位負例先RED；修正後15/15 GREEN |
| `trial-e2e-red2`；`npm --prefix products/kith/e2e test -- reading-private-trial.spec.ts --project=desktop` | 真實本地CF啟動後因缺trial入口RED；保留run `20261022-100831-da99dbc-dirty` |
| `trial-e2e-green`；同spec桌面＋手機 | 2/2 PASS；兩次真web build、完整prepared assets由獨立CF載入、真本地Git remote；manifest validator PASS |
| `trial-root-web`；`npm run web:build` | exit0；Markdown2、timeline、web tsc及Vite；初始JS gzip227.60kB，既有大chunk警告保留，未提高預算 |
| `trial-root-backend`；`npm test` | exit0；293 backend＋36 reading/Node＝329 PASS；含原21 Git tests與新15準備tests |
| `trial-replace-red2`；Node `--test-name-pattern='local Git replacement'` | exit1；同SHA實際得到Replacement body而非Synthetic body，確認既有固定commit邊界缺口 |
| `trial-reading-final`；`npm run test:reading` | 修正後37/37 PASS，含新增replacement-ref反例；與293 backend共330項相關檢查，沒有將兩次重跑重複計數 |
| `trial-root-gates-corrected`、`trial-gates-after-main` | worker/e2e tsc、schema10、project-success unittest15、41 contracts/navigation/index、llms5檔0錯、diff、T473～475 task/report validators全部exit0 |
| `trial-systemd-check-host`；`systemd-analyze verify` | exit0；只驗證兩個範本副本，把不存在的範例Node executable替換成本地固定版本；未安裝、reload或啟用服務 |
| `trial-root-e2e-full`；`npm run e2e:all` | exit0；57 passed、1既有desktop-only skip（手機對應PASS），9.3min；run `20261022-102509-da99dbc-dirty`。完整RC01～07與W0～W7原斷言／預算保留，新增PT01桌面手機 |
| `trial-full-manifest`；`validateRunDir` | exit0、ok；133個掃描檔案、遮罩後命中0；無manifest錯誤 |

首次完整E2E在實作工作樹開始，期間只新增Git replacement safeguard及對應Node反例；相關37項已在最終程式重跑。整合main未改Kith runtime。最後固定head的補充完整E2E、manifest、CI與獨立審查輸出將保存在PR留言；未取得全綠不可合併。這些是本地合成CF/D1、bare Git與瀏覽器尺寸證據，不是正式內容、遠端帳號或真人手機驗收。

實際失敗沒有隱藏：初次root typecheck發現Worker全域URL與Node URL型別衝突，改測試為明確node:url URL後重跑全gates通過。初次systemd語法檢查受sandbox SO_PASSCRED限制，批准的同範本主機檢查通過。首個replacement測試命令cwd錯誤導致0 tests，不計RED；更正後真正1個斷言失敗再GREEN。Worker早期sandbox鎖限制、錯誤typecheck argv與missing-module RED保留在各報告，不算通過。

內部唯讀T475初判REWORK：F01 Git filters、F02隱式lazy fetch、F03首次部署token循環。F01/F02已有實際RED/GREEN與防護；F03改成空白0600檔僅驗metadata，正式簽發／替換／連外單次確認前禁止export與排程。Root另外找出replacement-ref問題並修復。T475原始缺陷報告保留，不把它改成最終異模型PASS。

## Documentation

[範圍與AC](../../docs/plans/reading-private-trial.md)、[操作手冊](../../reading/PRIVATE-TRIAL.md)、[設定範例](../../reading/ops/trial.example.json)及service/timer/env範本，均在同一PR。SUCCESS保留聊天室AC04 pending、mainline incomplete、usable_tag none；PT各項只標本地準備驗證。README及任務板同步；board須在程式PR實際合併後另開board-only收尾，填入真實merge時間並釋放claim，issue不自動關閉。

## Risks and Follow-ups

Owner需私下提供內容repo/branch/固定commit/registry、app版本／正式HTTPS origin與Cloudflare bindings、專用Linux執行與backup路徑、既有Git transport權限、operator簽token安排，以及部署／排程／手機驗收責任人。秘密值不進公開對話、repo或CI。Owner再依手冊備份、審閱／套必要migration、準備與verify完整release、部署、核對私人路由、簽token、單次export遠端確認，最後才啟用timer並做真人手機清單。

Manifest不是簽章；operator app checkout、Git配置與同Unix使用者仍可信任。Linux鎖只涵蓋同network namespace。突然斷電須重驗current與保留版本，不能把原子rename當備份。正式D1還原必須保全未匯出寫入與撤銷狀態，不得從Git倒灌。備份restore、正式token撤銷及手機真人驗收未執行。

未部署、未套正式migration、未設定remote secrets、未啟用排程、未讀真私人內容、未呼叫付費模型API、未改AGENTS/CLAUDE、未建立usable tag。只交付此里程碑，不自動開始下一項。

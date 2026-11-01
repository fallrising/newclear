# T-0380 R2-AC-4/E — Agent Platform

STATUS: PARTIAL — 原批准 M1–M3 的本機實作與證據完成；R15 source/runtime 已通過，最終文件審查、exact-head CI 與正常合併由 parent 收尾。

## Summary

基線 `427dec01e78e66d4c06f4032bddfb3efaba44954`，承接 HAI 合併 `8df40fa0a0258c4037e159892721df8aa40a4b78`。這是原批准 FE 第 2 輪，並非完整平台／第 3 輪驗收。

M1 新增 [typed driver](../../flows.spec.ts) 與 [隔離入口](../../run-isolated.py)，未改既有 Python fixture。真 PostgreSQL、FastAPI 與 fake backend 提供登入、hash 詳情、一次 produce、100 筆 durable events、結果、斷線恢復、專案／Agent 設定與原生 SHA 驗證。11 個缺少的呈現狀態明示為 `page.route` 補拍，最後移除 routes 並確認真任務與副作用不變。

M2 的共用 `taskStateNames` 在本次開始前已含 pausing 中文；只補 App 實際 badge／執行選單回歸，不重做產品映射。M3 為 Approvals 的兩條錯誤加 `error`、受理提示加 `notice`，時間採與 App 相同的 `zh-TW` 短格式；僅另加 type-only Approval export，沒有改 API 或資料形狀。

## Verification

重現前提與命令見 [RUNNER](../../RUNNER.md)，逐檔 provenance／比較結果見 [verification.json](verification.json)。

### 原生與 focused

- M3 RED — failed (expected)：7 passed／3 failed，暴露 locale/options 與兩條 error class 缺口；獨立 notice RED 為 1 failed／10 個 test-name filtered skips。
- 首次修正後 focused — failed：53 passed／2 新測試假設錯誤。Intl thin-space 被 testing-library 正規化；未 scope 的 option 同時命中篩選與執行選單。只修正文字比較及 locator scope，原失敗保留。
- 最終 focused — passed：`npm --prefix web test -- run src/Approvals.test.tsx src/App.test.tsx`，55 tests／3 files。額外的 `run` positional token 也匹配 RunControls，沒有把它冒稱精確只跑兩檔。
- Review driver — passed：獨立 `tsc -p fe-review/tsconfig.json`、Prettier、Playwright `--list`；既有套件，沒有新增依賴。
- Review safety — passed：`node --test fe-review/runtime.test.ts`，最終 4 tests：專用 loopback DB、公開秘密 guard、context close 拒絕仍執行其他 cleanup、Uvicorn SIGTERM 必須具備完整 graceful markers；markerless SIGTERM／SIGKILL／非零 code 不接受。
- [Root web](evidence/native-web.json) — passed：Node 24.18.0，typecheck／Prettier／85 tests（7 files）／build，21.517 秒；原生證據由 root 保存。
- [Root Python 複合證據](evidence/native-python.json)：Python 3.12.3／psycopg 3.3.6／cc 13.3.0；`make platform-check` 的 lint／format 165 files 與 45 unit tests passed。platform 641 tests 當次 **FAILED (errors=4)**：browser image 缺 Docker CLI／C development headers。保留此結果；使用未改的 host-native `scripts/test-postgres.py` 只補驗相關 4 組，35 tests passed／24.891 秒，owned PG removed。沒有為 browser 容器掛 Docker socket 或放寬網路。這是複合驗證，不宣稱原 641 項單次通過；exact-head full CI 尚待 parent 完成。

### 真實隔離 capture

| Attempt | 結果與保留證據 |
| --- | --- |
| [084926](../../runs/20261024T084926Z-2b4187ae/capture.json) | failed，8 張。恢復後可見斷言未通過；第一次 finally 的 code=0 假設又遮掉原完整 locator 診斷，因此不虛構缺失的細節。Uvicorn log 已有兩個 shutdown-complete markers，實際退出為 SIGTERM。 |
| [085139](../../runs/20261024T085139Z-117ca0e8/capture.json) | failed，30 張；所有真流程及 7 個補拍通過。用量仍顯示未啟用，完整診斷證明同一 hash 導航保留非 polling query 的舊快取。 |
| [085406](../../runs/20261024T085406Z-9bb2af5e/capture.json) | passed，38 張／14 steps；[isolation](../../runs/20261024T085406Z-9bb2af5e/isolation.json)。 |
| [085518](../../runs/20261024T085518Z-2671cf53/capture.json) | passed，38 張／14 steps；[isolation](../../runs/20261024T085518Z-2671cf53/isolation.json)。 |

兩個 complete runs 都是 fresh 專用 DB、新隨機憑證、獨立 namespace、loopback／零 published ports。Node 24.18.0、Playwright 1.63.0、Chromium 153.0.8010.12（revision 1243）、PostgreSQL pinned digest 的 18.6。兩份各 19 states × desktop 1440×900／mobile 390×844，38 unique keys；14 個語意步驟與 6 個 driver／產品／fixture hashes 一致。4 次共 **114 raw PNG** 全部 hash 核對，完整兩次為 **76 captures**，前 38 張 partial 不混入 complete 計數。

每次 complete 真流程均核對：100 fake-burst events、106 連續 event sequences、非零恢復 cursor、1 prompt／1 allocation／100 source events、reload 不重複副作用、實際 hash 詳情、fake controls 停用；原生 patternMismatch／validationMessage／焦點且 0 create POST。補拍的 2 個 decision POST 只被 route fulfill，不送真後端；移除 routes 後真任務完全等於原 snapshot。

第一次恢復斷言的等待由 5 秒改為 15 秒：現行 TaskWorkspace 每 5 秒 polling 且 retry:false，離線 poll 失敗會暫時卸載活動區；新界線仍要求完整恢復，不靠 reload 取代斷線恢復。補拍則每次明確 reload，讓非 polling 的用量 query 重新讀取指定覆寫。兩項只修 harness，沒有改產品。

### 健康、清理與界線

兩個 complete runs 的 document overflow 為 0、pageerror 為 0。HTTP 503 僅兩個明示審批錯誤補拍；offline 的 ERR_INTERNET_DISCONNECTED 與導航／SSE teardown 的 ERR_ABORTED、對應 console errors 全部保留分類，沒有稱零 console／零 HTTP error。未跑 axe，不宣稱零違規。已目視實際 approval-pending mobile 與 native-validation desktop；完整原圖保留 100 筆事件的長頁。

所有 capture 的外層容器清理確認為 true。內層 producer exit 0；最終 server 為 SIGTERM，且必須同時存在 Application shutdown complete／Finished server process。Pinned Uvicorn `capture_signals` 會在 graceful shutdown 後重拋原信號，因此不把 SIGTERM 本身視為成功。獨立 cleanup actions 不因 context close 錯誤略過 server stop。

Root [首次 PG probe](../../runs/20261024T084258Z-b21a765a/isolation.json) failed／清理成功；依 pinned entrypoint 推定自訂 Unix socket 與 bootstrap 預設不符，[恢復預設 socket 後 probe](../../runs/20261024T084522Z-9a094dcb/isolation.json) passed。TCP 仍只綁 loopback。兩個 complete capture 間 wrapper 只有移除不適合 browser image 的 `--mode native` 入口，capture 邏輯未改；每份 isolation 留實際 wrapper hash。

Root [signal attempt receipt](evidence/outer-signal-attempt.json) 與 [額外 outer-TERM probe](../../runs/20261024T085614Z-a85d941e/isolation.json) 最後正常 exit 0／清理成功，但競態使 handler 是否收到 SIGTERM 未被正面觀察，**outer-TERM 驗證 inconclusive**。不能把它算成已證明。內層真 graceful stop、正常外層及真失敗外層 cleanup 已有證據。

## Documentation

SUCCESS 先列本輪目標；README／PROMPT／REVIEW／targets 同步為原批准 R2 本機實測完成。`verified: true` 只代表該範圍的 runtime／呈現證據，不代表完整平台或 merge／CI 已完成。公開新檔只有去敏 source/docs/JSON；PNG、storageState、raw logs ignored，私有 fixture state 在 checkout 外，storageState mode 0600，沒有提交帳密或私人主機路徑。

## Risks and Follow-ups

Author-other review、exact-head CI、正常 merge／遠端回讀由 parent 完成；PR #588。沒有 release／deploy／tag。真 VM／OpenHands pause／approval／模型用量、完整第 3 輪、dark mode、虛擬化效能、200% zoom 等未驗收。平台 AC-04 與 usable_tag 不變。主動／等待時間及 provider/tool 精確總數 unknown，不由 worker 預算推算。

## Root 最終靜態檢查

新增 review Python 檔案在既有 native lint 範圍之外，root 另執行 Ruff：首次24個 style／test-closure findings，imports／UTC alias 與 formatter 修正後剩3個，再拆等價字串並固定測試 closure 後 `ruff check`／`ruff format --check` 通過（2 files）；4 isolation tests 通過，42 project contracts 與 diff check 通過。這是初始檢查失敗與修正，不是 test-first RED。最終 wrapper 相對 runtime 只移除未使用 native mode、imports／UTC 等價 alias／格式與常數字串分行；capture／cleanup 邏輯未變。歷史 runner hashes 保持原值，verification 額外列最終 hash，未宣稱舊 runtime 使用最終 bytes。

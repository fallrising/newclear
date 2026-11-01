# Kith 階段 1 交付報告

Session: Kith-20261021-1837。Issue [#456](https://github.com/fallrising/newclear/issues/456)，PR [#457](https://github.com/fallrising/newclear/pull/457)。本文件記錄本機候選證據；最終 head 的完整回歸重跑、不同模型審查、CI、merge/readback 在 PR 留言記錄，避免記錄審查後再改 SHA。

## Summary

實作 RC-01～04：operator-only 快記與分頁收件匣、UTF-8 原文保存、唯一 client_key 交易內冪等／409 衝突、15 秒有界等待與原鍵重試、本機草稿／未知結果／storage 失敗的明確狀態。固定 stage-2 notes/export/ACK 認證拒絕路徑，operator 回 501；沒有假成功。0007 新增 captures/notes 與索引，不改聊天室 schema。既有 provider、聊天室與 Runner 不參與保存。

T-456 獨立工作樹先寫 E2E，根代理記錄 RED 後才實作後端並指派 T-457 前端；逐項檢查 diff、整合並自行重跑。無新增依賴、AGENTS/CLAUDE 修改、正式環境 migration、部署或付費 API。

## Verification

所有新執行經 `python3 /home/ckc/test/codex/agent-workspace/workspace.py run kith <task> -- ...`。實際內層命令及 exit 存於 `agent-workspace/data/projects/kith/tasks/<task>/preserve/evidence/{command.log,result.json}`；E2E 的 manifest、summary、API/WS、截圖與 hashes 位於同目錄 e2e/。外部 wrapper `kith-phase1-20261021/check.py` 保留實際 cwd、argv、exit。

工具：官方 checksum 驗證的 Node24.18.0、npm11.16.0；Playwright1.56.1 Chromium141.0.7390.37；Python3.13.5。沿用三份 lockfile 執行 npm ci。缺少的 Debian Chromium library 僅下載／解壓至 launcher build，未安裝系統套件。

| Task | 實際命令／結果 |
| --- | --- |
| phase1-d1-draft | wrangler d1 migrations apply kith --local --persist-to 隔離 state；d1 execute --file docs/plans/reading-capture-schema.sql，再查兩表空資料；exit0，promotion 前完成 |
| phase1-e2e-red3 | npm run e2e -- specs/reading-capture.spec.ts --max-failures=1；exit1：登入成功後缺少 capture-link，1 fail/6 not run；RED 在實作前。報告另發現重複 @mobile tag，修 metadata 保留 schema 約束 |
| phase1-api-red2 | vitest run --config vitest.worker.config.ts test/m1/reading-capture.test.ts；exit1：7 個 missing captures table |
| phase1-api-green4 | 同上；exit0：7/7 D1/API integration |
| phase1-rc-green | npm run e2e -- specs/reading-capture.spec.ts；exit0：7/7 桌面／手機，run20261021-185258-fcd7d28-dirty；provider 無新增呼叫、完整 messages rows 未變 |
| phase1-tests-green2 | npm test；exit0：155 base +14 sidecar +36 M1/M2 +8 M3 +40 M4 +22 M6 +9 M7 =284 |
| phase1-worker-types / phase1-e2e-types | npm run lint / npm --prefix e2e run lint；exit0 |
| phase1-schema | python3 -m unittest discover -s test/reading_capture -v；exit0，10 tests |
| phase1-web-worker-polish | npm --prefix web run build；exit0，TypeScript/timeline/Vite；根代理整合 E2E 再建置 |
| phase1-after-main-tests | npm test；exit0，284 tests；main 合入後重跑 |
| phase1-final-gates | worker/e2e tsc、Python schema10、project-success unittest15、全部41個 project-success contracts、llms5檔0錯、diff/task/report validators 全部 exit0 |
| phase1-e2e-all | npm run e2e:all；exit1，49 passed/1 skipped/1 failed，run20261021-185420-fcd7d28-dirty；唯一失敗 W7 p95=857ms，RC 更新後的分頁及明確衝突處理也全部通過 |
| phase1-budget-diagnostic | npm run e2e -- specs/w7-budget.spec.ts；exit1，原 W7 p95=860ms；被動 RAF 診斷顯示 row 可見310–444ms，未變更原斷言或門檻 |
| phase1-budget-corrected2 | 同上；exit0，W7 p95=591ms、JS gzip226235/256000 bytes、DOM max25；run20261021-190802-0524d26-dirty |

W7 修正先改 §7.2 規格。T-459 唯讀 trace 審查量出 waitForSelector 兩群約296–327/786–837ms，對應 Playwright 最長500ms的輪詢間隔；另一次被動 RAF 證實畫面較早可見。驗收仍採 Playwright 自己的 isVisible，固定16ms輪詢；不採 RAF 自訂判定作 gate、不扣除耗時，保留整頁載入、暖身1次／樣本20次、p95<600ms與其他預算。原失敗保留，不能改稱通過。移除臨時 RAF instrumentation 後只保留6行量測修正。focused591ms接近600ms門檻，必須以完整回歸再確認，不能把主機負載或預期改善當成通過。

run 的 fcd7d28-dirty 是啟動時版本：實際被測 runtime/RC source 隨後提交363fcc95，0524d26 merge 的 Kith source diff 為空；完整重跑 phase1-e2e-final（npm run e2e:all，run20261021-190843-0524d26-dirty）exit1：49pass/1預期桌面skip/1fail W5-03。W7 已PASS448ms、DOM26、JS226235 bytes；RC桌面手機全過。W5 失敗停在等待短暫 reply-draft，尚未走到其後的落盤／呼叫次數檢查。T-460 從既有 trace 截圖直接確認19:13:50.924Z顯示ab、51.533顯示abcdef，WS於51.827正確發出failure。預設assertion輪詢[100,250,500,1000]可漏掉約900ms窗口；先在W5 §7.3補觀測規格，僅改成固定50ms輪詢相同Playwright可見性，保留fixture、timeout、前綴／非空、截圖、失敗UI、不落盤與provider次數斷言。phase1-stream-cut-corrected 執行 `npm run e2e -- specs/w5-stream-cut.spec.ts --repeat-each=2` exit0，兩次全部斷言通過（run20261021-191720-0524d26-dirty）。phase1-e2e-accepted 已啟動 `npm run e2e:all`，提交本報告時仍在執行；此候選 source 在執行中保持不變，最終結果、manifest validator 與 summary 全文會記錄在 PR #457，不能把尚在執行當成通過。

phase1-gates-accepted 已全部exit0：worker/e2e型別、schema10、success tests15／contracts41、llms5檔0錯、diff、T-456～460 task與四份report validator。phase1-final-gates2 的 runtime/type/schema/repo 檢查通過；唯一失敗是 T-459 報告 outcome 後帶句點，不符 teamctl 格式，去掉句點後 phase1-audit-report-check exit0。phase1-docs-final 的額外全檔連結掃描找到 W7 既有7個相對連結／範例；與 origin/main 比對相同，phase1-docs-final2 記錄197個連結、0個本次新增壞連結，保留既有項目，沒有宣稱全文件連結無誤。

保留失敗：首兩次 browser RED launch 因缺少 host libraries 停在 setup，非產品 RED；獨立 browser smoke 通過後才重跑。API fixture 首次缺必填 password_hash，其次誤設多個 operator 被 UNIQUE REPLACE 淘汰；修成合成 hash 與單 operator 後通過。既有 ws-cost 回歸遇真實分鐘 rollover（測試用 Date.now 且跨分鐘），改為固定 Date，保留 reset/limit 斷言；沒有以單純重跑掩蓋。另有啟動命令 cwd/路徑錯誤（未找到測試、錯誤 npx 取消 exit130），不是產品通過證據；phase1-budget-corrected 亦因 repo 根目錄沒有 package.json 而 exit254，切回 products/kith 後才執行 corrected2。

## Documentation

更新 README、SUCCESS、MVP 計畫、RC 接線契約、phase0 schema 歷史基線與本 task/report；.team/PLAN 保留其他 program，新增 T-456～460 的分工與接受決策。既有 spec 的無 service worker 界線明確：完全離線 reload 可顯瀏覽器離線頁；重連後復原草稿。

## Risks and Follow-ups

本機合成 CF/D1 證據不等同正式部署或真 provider qualification。Notes/閱讀、Runner 匯出與 RC-05～07 是下一個里程碑，本次不實作。不支援離線 queue/完整離線 app；保存前本機 storage 失敗時不送出，請保留文字並重試；未知結果只重送原 key；明確衝突需手動建立未送出新草稿。Vite 保留既有大 chunk 警告，未提高警告門檻。既有 Kith CI workflow 執行後端 lint/test 與 web build；本次完整 E2E 在隔離本機實跑，沒有宣稱 GitHub CI 存在 E2E job，也未修改 CI workflow。

main 已整合 Handwired HW-0（6c61fded），衝突只有 .team/PLAN append，保留 upstream 原文；Kith source 未受影響。最終證據門禁、不同模型審查與最終 head CI 未全部通過前不得 merge。Issue 保持 OPEN，僅 owner 可關閉；沒有 usable tag，聊天室主線 AC-04 仍 pending。

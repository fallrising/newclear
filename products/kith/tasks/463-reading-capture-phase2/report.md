# Kith 階段 2 交付報告

Session: Kith-20261022-0352。Issue [#463](https://github.com/fallrising/newclear/issues/463)，PR [#464](https://github.com/fallrising/newclear/pull/464)。本文件記錄已取得的本機證據；最終 head 的全套回歸、不同模型審查、CI、merge/readback 在 PR 留言記錄，避免審查後改寫 SHA。原始 main cd6412e5，已合入最新 f9fce6eb；只有 .team/PLAN append 衝突，保留雙方內容，Kith runtime 未因 main 合入改動。

## Summary

交付 RC-05～07，並重跑 RC-01～04：固定 commit 的明確 ID registry／單一 JSON bundle、原子建置、Worker-first 私人資產防線、閱讀頁每5秒自動完整切換、AI／人類分隔、保留草稿的筆記 CAS、專用可撤銷匯出憑證與 Linux 單實例 Git 匯出。Runner journal 先於寫檔，確認遠端 commit／完整 bytes 後才 ACK；舊 revision ACK 不影響新版。全量有界對帳可修復人工 Git 筆記更動並記錄事件。保存路徑不依賴 Runner、Git、provider 或聊天室 messages。

T-463 規格審查後固定契約；T-464 builder/exporter、T-465 web、T-466 E2E 各在獨立 worktree；root 擁有後端、CI、整合與接受決策。T-467 獨立後端審查找出 Bearer 大小寫與早期錯誤 cache header 缺口，先重現 RED 再修正。無新增依賴或 lockfile、AGENTS/CLAUDE 編輯、正式內容、部署、付費 API 或 issue 關閉。

## Verification

所有新 build/test 使用共用 launcher `python3 /home/ckc/test/codex/agent-workspace/workspace.py run kith <task> -- ...`。實際 argv/cwd/exit/log 在 `agent-workspace/data/projects/kith/tasks/<task>/preserve/evidence/{command.log,result.json}`；E2E manifest、summary、API/WS、截圖與 hashes 在該目錄 `e2e/`。固定 Node24.18.0、npm11.16.0、Playwright1.56.1／Chromium141.0.7390.37；重用階段1已依鎖檔安裝的依賴與瀏覽器，未更新工具鏈。

| Task | 實際命令與結果 |
| --- | --- |
| phase2-api-red | `node node_modules/vitest/vitest.mjs run --config vitest.worker.config.ts test/m1/reading-phase2.test.ts --maxWorkers=1 --no-isolate`；exit1，6個缺少 reading404／notes501／token404 的行為 RED |
| phase2-e2e-red | worker 執行 authenticated reading E2E；exit1，期待200實際404；本地 Wrangler／登入成功後才失敗 |
| phase2-web-markdown-red-inprocess | Node reading Markdown 測試；2個 missing-parser RED；後續2個全部通過 |
| phase2-api-integrated | 新舊 reading API 測試；exit0，13/13；同 clock tick CAS／舊 ACK、原文、分頁、撤權與 messages 全列不變 |
| phase2-bearer-red | focused `-t case-insensitive`；exit1，混合大小寫 Bearer 配 operator cookie 本應401卻200；其餘6個因選擇器未執行，不視為通過 |
| phase2-api-security-green | phase2 API 測試；exit0，9/9，含實際 Worker GET/HEAD／編碼路徑、session-only API、20個憑證同時上限、停用 owner、最大原文與 ACK bounds |
| phase2-web-integrated | `npm run web:build`；exit0，Markdown2、timeline、web tsc、Vite；保留原大 chunk 警告，未提高門檻 |
| phase2-backend-full | `npm test`；exit0，既有後端加6個phase2共290測試、Node/Git19個；後續安全案例與新增2個Git案例在下列合入main後全套再跑 |
| phase2-e2e-integrated | `npm run e2e -- --grep E2E-RC`；exit1，9pass/3fail，保留trace與原失敗；修正見下文 |
| phase2-e2e-corrected | 同上；exit0，12/12，run20261022-041357-74a8eb1-dirty；RC05實際Git/D1、RC06桌面手機無reload更新／筆記保留、RC07壞建置與資產缺失、RC04憑證及直接資產拒絕 |
| phase2-types-integrated | `npm run lint`；exit0 |
| phase2-gates-after-main | worker/e2e tsc、Python schema10、project-success unittest15、全部41個success contracts及navigation/index、llms5檔0錯、diff、T463～468 task與T463～467 report validators；全部exit0 |
| phase2-content-ci | `node reading/build.ts --repo ../.. --commit ee51d3560c1d63987cb98498ce46647e25c5921a --registry products/kith/content/articles.json --output <artifact>/current.json`；exit0，2篇合成文章、正確固定來源 SHA |
| phase2-backend-after-main | `npm test`；exit0，155 base +14 sidecar +45 M1/M2 +8 M3 +40 M4 +22 M6 +9 M7 +21 Node/Git =314，全套合入main後重跑 |
| phase2-e2e-full | 已啟動 `npm run e2e:all`；本報告撰寫時仍在執行，最終結果與manifest validator在PR記錄；未完成前不可合併 |

Root 親自檢查所有 worker diff 並重跑。T-465、T-466 的歷史 PARTIAL report 保留，因當時整合 E2E 由 root 承接；不把 worker 尚未跑的驗證改稱通過。T-464 最終21個 Node/Git 測試含實際 child SIGKILL 三切點、失去 ACK 回應、同時 Runner、push rejection、同時間 revision 競態、人工 Git 更動、固定路徑與相同快照無新 commit、100頁明確中止、最大 escaped100-row body、惡意 attributes 不執行 filter、symlink／憑證／journal／redirect／UTF-8／完整bundle bounds。

初次 RC04 失敗來自新測試重複登入：既有 app-shell 讓 helper 過早返回，trace 顯示 login 已旋轉 session，但下一個 API 尚帶舊 cookie。移除同一測試中的第二次登入，不改認證斷言。RC06兩個失敗都已到409、保留草稿並鎖定重試，但雙語文案未包含明確衝突字樣；補上「版本衝突／Edit conflict」，斷言未放寬。其後十二項全過。早期 root整合曾因cwd錯誤未複製bundle而missing-module，修正後才有13項GREEN；首次typecheck TextDecoder options缺ignoreBOM，補明確選項。這些不是通過證據，也未靠反覆重跑掩蓋。

## Documentation

新增 [階段2契約](../../docs/plans/reading-capture-phase2.md)、[建置／匯出操作](../../reading/README.md)、[技術任務板](../../docs/tasks/BOARD.md)，同步 README、SUCCESS、MVP／RC清單及CI契約。根AGENTS在工作期間由其他PR更新；本任務是 owner直接指示，依新契約登記T-0463，code PR合併後用board-only follow-up填merge時間。既有階段1報告中的501屬歷史紀錄，實作已替換為正向功能。

CI仍為contents:read、固定action SHA、Node24.18.0、timeout／取消重疊、checkout不保留憑證。既有path filter涵蓋內容；web build後從exact checkout commit建置合成bundle。它不連私人內容repo、不上傳私人產物、不新增部署／secret job。完整瀏覽器E2E仍由本機隔離環境驗證。

## Risks and Follow-ups

這是本機合成CF/D1與實際本地Git的驗收，不是正式部署或真provider qualification。正式內容來源、憑證檔、週期排程與發布須另行設定。Runner需Linux、專用私有checkout、同一network namespace；同Unix使用者與Git transport配置仍可信任，並非惡意repo owner沙箱。Git attributes、無關dirty/unpushed工作與分歧會fail closed；保留journal及快照，在另一checkout正常合併確認後恢復，不自動丟棄或force push。上限100頁/種類明確回報不完整。筆記草稿只在開啟的operator頁面記憶體跨文章保留，不宣稱離線queue或跨reload保存。

最終不同家族review採既有Grok登入，600秒／4turn／no tools／no subagents，paid API keys unset；實際審查SHA、判定及處理方式記錄PR。最終head CI全部綠、無pending、最新main整合及full regression過後才merge。Issue留owner驗收，沒有usable tag（聊天室AC-04仍pending）。下一步為實際使用回饋與正式環境接線，沒有自動開始另一里程碑。

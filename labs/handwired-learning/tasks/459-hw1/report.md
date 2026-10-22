# HW-1 交付報告

Session: Handwired-20261021-1845 → owner 授權 Handwired-20261021-1844 接手（2026-10-22）。Refs #459 / PR #460。

## Summary

交付 AC-02 / HW-A01、HW-A02：三欄前向對照頁、x/a/b 滑桿與數字輸入、固定上游 CPU 圖／JS Number 結果、差值與固定允差、非法值先於圖執行拒絕，以及立即清除舊結果／通過狀態。Node 24.14.0 內建 stripping 產生可直接 file:// 開啟的單一 HTML；核對 core 與 LICENSE 雜湊，保留 MIT，沒有新增 runtime 或 build 套件。

原 session 的實作已完成但未提交。接手保存 12 個檔案的 SHA-256 快照並在自己的獨立 worktree 整合，未改原工作樹。5 個產品／測試檔與快照相同。沒有發現需修正的產品併發問題；實際整合衝突是 `.team/tasks/T-459.md`、`T-460.md` 與 `.team/reports/T-459.md` 被 Kith 同時使用。完整保留 main 的 Kith 紀錄，Handwired 重新編號為 T-901（原 worker）／T-902（reviewer），兩方 PLAN 區塊均保留。

本機驗收通過；本報告不提前宣稱遠端合併。最終 commit 的 CI、不同家族審查及 merge SHA 記在 [PR #460](https://github.com/fallrising/newclear/pull/460)，避免審查後再改 head。

## Verification

以下 build/test 均由 `python3 /home/ckc/test/codex/agent-workspace/workspace.py run handwired <task> -- <command>` 執行，設定 `HANDWIRED_ROOT` 到 repo 外的固定上游。外部 launcher evidence 保留於 `agent-workspace/data/projects/handwired/tasks/<task>/preserve/evidence`。

| 實際命令／紀錄 | 結果 |
| --- | --- |
| 原 worker `node --test --test-isolation=none labs/handwired-learning/tests/forward.test.mjs labs/handwired-learning/tests/build.test.mjs`，HW1-1845-worker-red | [RED](evidence/red.log)：實作尚未存在，預期 ERR_MODULE_NOT_FOUND；接手者查閱既有紀錄，未冒稱自己先寫此測試。 |
| 同命令，HW1-1845-worker-final | [8 tests PASS](evidence/worker-tests.log)，原 worker 證據。 |
| root `node --test --test-isolation=none labs/handwired-learning/tests/api-probe.test.mjs labs/handwired-learning/tests/forward.test.mjs labs/handwired-learning/tests/build.test.mjs`，HW1-takeover-checks | [13/13 PASS](evidence/node.log)，無 skip；真正固定上游九點、係數邊界與小數，輸入類型／空白／非有限／超界先於 evaluator 拒絕、同圖更新、固定允差、來源漂移、離線產物。 |
| `node labs/handwired-learning/examples/api-probe.mjs`，同 task | [9 點與梯度 PASS](evidence/probe.log)。 |
| `node labs/handwired-learning/scripts/build.mjs <AGENT_ARTIFACTS_DIR>/handwired.html`，HW1-takeover-browser-libs | PASS；單檔離線產物，原來源與 MIT 雜湊均核對。 |
| `node /home/ckc/test/codex/handwired-hw1-takeover-20261022/browser.mjs`，同 task | [Chromium 153.0.8010.12](evidence/browser.json) PASS：file:// 九點、所有欄位超界／空值、數字欄淨化、鍵盤滑桿即時更新、小數差值、桌面與 390px 手機寬度。0 page errors、0 HTTP(S) requests。[實際 driver](evidence/browser.mjs) 使用主機既有 Playwright／瀏覽器，無安裝依賴。 |
| `python3 scripts/check_project_success.py`，HW1-takeover-checks | [41 contracts PASS](evidence/contracts.log)。 |
| `python3 -m unittest discover -s scripts/tests -p test_project_success.py -v`，同 task | [15 tests PASS](evidence/contract-tests.log)。 |
| `python3 .github/scripts/validate_llms_txt.py`，同 task | [5 files / 0 errors](evidence/llms-validation.log)。 |
| installed `scripts/teamctl.py validate-task .team/tasks/T-901.md`、`validate-task .team/tasks/T-902.md`、`validate-report .team/reports/T-901.md`，同 task | [T-901](evidence/task-901.log)、[T-902](evidence/task-902.log)、[report](evidence/worker-report.log) PASS。 |
| `git diff --check`，同 task | [exit 0](evidence/diff.log)。 |

瀏覽器前兩次啟動（HW1-takeover-browser、HW1-takeover-browser-host）因缺 `libatk-1.0.so.0` 失敗，未視為產品通過。定位既有 private-libs 後，設定 `LD_LIBRARY_PATH=/home/ckc/test/codex/agent-workspace/data/projects/kernel/tasks/desk-verify-1-pp-browser-libs/build/private-libs/usr/lib/x86_64-linux-gnu` 的 HW1-takeover-browser-libs 才通過。失敗原始日誌仍保留。主機沒有 CJK 字體，截圖只核對佈局；中文字形外觀未驗證，文案與狀態由 DOM 驗證。

## Documentation

README 提供 Node 版本、固定上游取得方式、絕對輸出路徑／不可覆寫要求、file:// 開啟方式及完整測試命令。SUCCESS 的 AC-02 記錄本機證據，SDD 同步現況而不變更承諾。CI 延伸既有 pinned-api job 執行 HW-1 真實來源與產物測試及 HTML 建置；未放寬或停用既有檢查。

## Risks and Follow-ups

- HW-2 學習、500 步收斂／發散與 HW-3 真人試用尚未實作／執行，AC-03/04 維持 pending；不建立 usable tag。
- `stripTypeScriptTypes` 在 Node 24.14.0 會顯示 experimental warning；固定版本與 digest 驗證不代表未來上游自動相容。
- 本機 Chromium 非 CI 套件依賴；CI 執行真實圖與 generated-script 測試，瀏覽器互動另有本機證據。未宣稱 Firefox/WebKit 或中文字形驗收。
- 原 worktree 與快照保留，未移除其他 session 工作、關閉 issue、部署或發佈。

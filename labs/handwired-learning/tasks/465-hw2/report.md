# HW-2 交付報告

Session Handwired-20261022-0411 · Refs #465 · PR #466。

## Summary

AC-03 / HW-A03～A05 本機驗證通過：固定九點 MSE 由真正 Handwired CPU 計算，loss wire 的 backward 產生 dL/dalpha、dL/db；alpha=40a、z=x/40。從 a=1、b=0 以固定學習率 0.05 跑累計 500 步，最大誤差 `9.5367431640625e-7 °C`（門檻 ≤0.05 °C）。學習率 2.0 由相同初始值算出候選 a=1.5666666507720948、b=12，第一步即越界停止，顯示候選值並保留合法係數，不截斷。

同一離線頁提供單步、跑到 500、重設、失敗示範，以及最多 501 列的不可變歷程。每列 loss／梯度對應該列已接受係數。學習只套用合法 a/b 到前向區，保留 x 與原驗證；手動前向輸入不改學習狀態。初次開頁的前向 a=1.25,b=-2 保留。沒有新依賴、vendoring、GPU、後端或部署。

T-903 worker 的每個 diff 已由 root 檢查，root 重跑並增加真實瀏覽器 gate。最終 SHA 的 CI、不同模型家族審查與 merge 回讀在 [PR #466](https://github.com/fallrising/newclear/pull/466) 記錄，不以本報告預先宣告合併。任務板按 repo 規則於合併後另用 board-only PR 填入實際 end 時間。

## Verification

以下 build/test 均經共用 `agent-workspace/workspace.py run handwired <task> -- <command>`，固定 Node 24.14.0，`HANDWIRED_ROOT` 指向 repo 外 SHA `257856e3b221140acb4cc4460626b850c0bd4ff1`。完整 raw logs 保存在 launcher 各 task 的 `preserve/evidence`；repo 複本只遮蔽機器路徑為 `<workspace>`／`<worktree>`，不刪結果、失敗或 stack frames。

| 實際命令／task | 結果 |
| --- | --- |
| `node --test --test-isolation=none labs/handwired-learning/tests/api-probe.test.mjs labs/handwired-learning/tests/forward.test.mjs labs/handwired-learning/tests/build.test.mjs labs/handwired-learning/tests/learning.test.mjs`，HW2-0411-worker-red | [13舊測試 PASS、5新測試 RED](evidence/red.log)，新 API 不存在；先測試後實作。 |
| 同命令，HW2-0411-worker-red-ui | [額外 UI RED](evidence/red-ui.log)：缺學習元素；不是把既有測試弄壞。 |
| `node --test --test-isolation=none` 加 tests 目錄四個 `.test.mjs`，HW2-0411-checks2 | [root 19/19 PASS](evidence/node.log)，0 fail/skip。真實梯度與獨立解析式對照維持 `1e-4 + 1e-4*abs(expected)`；500步、累計上限、實際前向九點誤差、越界、非有限值／梯度、重設與輸入邊界皆有驗證。故障 evaluator 僅用於失敗邊界，數值驗收使用真實上游。 |
| `node labs/handwired-learning/examples/api-probe.mjs`，同 task | [九點與 backward regression PASS](evidence/probe.log)。 |
| `node labs/handwired-learning/scripts/build.mjs <AGENT_ARTIFACTS_DIR>/handwired.html`，HW2-0411-browser-portable | PASS，單檔含固定來源與 MIT；開頁無外部依賴。 |
| `node labs/handwired-learning/tests/browser-check.mjs`，同 task | [Chromium 153.0.8010.12 PASS](evidence/browser.json)：真實 file:// click、單步／500、九點、501歷程、lr2停止、重設後重跑結果一致、空白／超界x保持錯誤、390px手機與桌面。0 page errors、0 HTTP(S) requests。 |
| `python3 scripts/check_project_success.py`，HW2-0411-checks2 | [41 contracts PASS](evidence/contracts.log)。 |
| `python3 -m unittest discover -s scripts/tests -p test_project_success.py -v`，同 task | [15 tests PASS](evidence/contract-tests.log)。 |
| `python3 .github/scripts/validate_llms_txt.py`，同 task | [5 files / 0 errors](evidence/llms-validation.log)。 |
| installed `teamctl.py validate-task .team/tasks/T-903.md`、`validate-task .team/tasks/T-904.md`、`validate-report .team/reports/T-903.md`，同 task | [T-903](evidence/task-903.log)、[T-904](evidence/task-904.log)、[report](evidence/worker-report.log) PASS。 |
| `git diff --check`，同 task | [exit0](evidence/diff.log)。 |

[實際數值](evidence/numeric-summary.json)：初始 loss=50.66666793823242，dL/dalpha=-11.333333015441895，dL/db=-6；第500步 a=1.249999958465957、b=-1.9999992600290482、loss=5.115907697472721e-13。正規化訓練圖與原前向圖的九點最大誤差都通過，未調參數讓測試過。

首輪 root contract check 因手動把 PROJECTS.md 的歷史盤點日期當成今日驗證日期而 [失敗](evidence/initial-contracts-failure.log)。檢查 generator 後確認兩者語義不同，執行 `python3 scripts/check_project_success.py --write-index`（HW2-0411-index）恢復正確產生內容並通過，沒有改 validator／inventory 基準或放寬契約。

瀏覽器使用主機既有 Playwright 與 Chromium，透過 `PLAYWRIGHT_MODULE`、`CHROMIUM_EXECUTABLE` 指定；本機既有 library 目錄以 `LD_LIBRARY_PATH` 提供，未安裝依賴。可攜 driver 已納入 tests，需先建出 `AGENT_ARTIFACTS_DIR/handwired.html`，並提供 `AGENT_EVIDENCE_DIR`。這不是 CI 新增套件要求；CI 執行真實圖與生成腳本測試。

## Documentation

README、SUCCESS、SDD 同步 HW-2 實際結果。SDD 明訂學習狀態與前向手動輸入的關係、累計500步及重設行為，不縮小原承諾。歷史 API 文件連回目前驗收狀態。新增 [技術任務板](../../docs/tasks/BOARD.md)，保留每項AC的UTC活動紀錄。CI 新增 learning.test.mjs，原 HW-0/HW-1檢查保留。

## Risks and Follow-ups

- HW-3 / AC-04 要1–2位未學過 autodiff 的開發者真人試用；未執行、未代答，主線 incomplete，usable_tag none。
- Node stripping 仍有 experimental warning；只驗證固定來源與 Node 24.14.0，不能推論未來上游相容。
- 主機缺 CJK 字體；截圖僅核對佈局，DOM 文案／狀態已驗證，中文實際字形外觀及 Firefox/WebKit 未驗證。
- 本輪只做 HW-2，沒有部署、發佈、關閉 issue 或清理其他 session 工作。

# HW-0 交付報告

Session: Handwired-20261021-1808 · Refs #450 · PR #452

## Summary

AC-01 本機驗證通過：固定上游 `257856e3b221140acb4cc4460626b850c0bd4ff1` 支援 Circuit builder、CPU tensor/reference evaluator 與通用 `backpropagateReference`。新增支援表、最小範例、5 個真實來源測試及專用 CI。未使用解析公式代替上游梯度。PR 合併、最終 head CI 與不同家族審查的狀態以 PR 記錄為準，本文不提前宣告合併。

## Verification

所有本機 build/test 經 `python3 /home/ckc/test/codex/agent-workspace/workspace.py run handwired <task-id> -- <command>`；cwd 為本次獨立 worktree。Node v24.14.0。

| 命令／task-id | 實際結果 |
| --- | --- |
| `node --test labs/handwired-learning/tests/api-probe.test.mjs` / HW0-1808-red | 預期 FAIL：範例未存在，ERR_MODULE_NOT_FOUND。保留紅燈證據，之後才寫實作。 |
| 同上 / HW0-1808-green、HW0-1808-tap | exit 0，但只回報 1 個檔案層級測試；不據此聲稱五個案例通過。 |
| `node labs/handwired-learning/tests/api-probe.test.mjs` 與 `node --test --test-isolation=none labs/handwired-learning/tests/api-probe.test.mjs` / HW0-1808-direct | 各回報 5 tests、5 pass、0 fail。 |
| `node --test --test-isolation=none labs/handwired-learning/tests/api-probe.test.mjs` / HW0-1808-verify | [5/5 pass](evidence/api-tests.txt)；前向、參數梯度、同圖參數更新、boolean 拒絕與漂移來源拒絕。 |
| `node labs/handwired-learning/examples/api-probe.mjs` / HW0-1808-green、HW0-1808-verify | [9 點 JSON](evidence/example.txt)；所有前向數值與 JS 相同，da=x、db=1、dx=1.25。 |
| `python3 -m unittest discover -s scripts/tests -p test_project_success.py -v` / HW0-1808-verify | [15 tests OK](evidence/success-tests.txt)。 |
| `python3 scripts/check_project_success.py` / HW0-1808-verify | [41 contracts PASS](evidence/success.txt)。 |
| `python3 .github/scripts/validate_llms_txt.py` / HW0-1808-verify | [5 files / 0 errors](evidence/llms-validation.txt)。 |
| `git diff --check` / HW0-1808-verify | exit 0。 |
| installed `scripts/teamctl.py validate-task .team/tasks/T-450.md` / HW0-1808-verify | PASS。 |
| installed `scripts/teamctl.py validate-report .team/reports/T-450.md` / HW0-1808-verify | PASS。 |

來源用 GitHub contents API 的固定 SHA raw 內容下載，保存在共用 workspace 的 `HW0-1808-source/preserve/artifacts/upstream`，MIT LICENSE 與原始 core 一併保留。core 的 SHA-256 `75da2a13f39720e34b1e440533460435ead0af9a88fccad8c94e94a816dafa21` 在 import 前核對；沒有安裝上游 package.json 中的依賴。原始紅燈與後續完整輸出留在共用 workspace 各 task 的 `preserve/evidence`。

認領過程中 GitHub sandbox 連線／SSH 設定權限檢查失敗，依執行環境要求升級後成功。首次空 commit 缺 Git identity，改用本命令的 GitHub noreply identity 後成功；沒有改全域設定。draft PR 在有效 commit 推送後建立。未修改或使用其他 session 的 Cost 工作樹。

CI 首輪的專用 pinned-api 通過；llms validator 失敗，原因是本次新增的日誌名 `evidence/llms.txt` 被當成能力索引。已改名為 `llms-validation.txt`，沒有修改或停用 validator。首輪 Grok 在讀取 diff 前因 sandbox 的 session 寫入限制失敗；沒有有效審查結論，須對修正後最終 head 重審。

## Documentation

更新 SDD 的既有未核對狀態，保持 HW-1～3 原承諾；README/SUCCESS 連到 API 支援表與可執行範例。主線仍 incomplete、usable_tag none。

## Risks and Follow-ups

- 此為 HW-0，不是 HW-A01～06 全部驗收；尚未跑瀏覽器、500 步訓練、發散情境或真人試用，分屬 HW-1～3。
- 下一個可做里程碑：HW-1 前向對照頁。瀏覽器需要 TS→JS 載入方案；若新增依賴先問 owner。
- 上游 backward 將 FP32 視作實數微分；boolean/index 預設拒絕，不能泛稱任意程式可微。
- 上游來源／Node 版本皆固定；專用 CI 下載來源失敗時必須失敗，不能用替身或浮動版本通過。
- 沒有部署、公開發佈、tag 或關閉 issue；owner 驗收與 HW-3 真人試用保留給真人。

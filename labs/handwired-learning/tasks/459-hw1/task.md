# HW-1 前向對照頁

Session: Handwired-20261021-1845 · Refs #459 · PR #460

從最新 main / HW-0 merge `6c61fded520c5e076758972a1942b4887c5581dc` 建立獨立 worktree。認領及 draft PR 回讀無競爭認領。

## 範圍與驗收

僅 AC-02 / HW-A01、HW-A02。公式 y=a×x+b、預設 a=1.25,b=-2；x ∈ [-20,60]、a ∈ [0.5,2]、b ∈ [-10,10]。固定允差 `1e-5 + 1e-5 × abs(reference)`。非法輸入在圖執行前拒絕，結果和狀態隨輸入立即更新，不能保留舊通過標記。

提供三欄單頁（滑桿／公式與節點／兩路結果與差值），可直接開啟建出的單一 HTML；使用真正固定 Handwired CPU evaluator，Node 24 內建 stripping，不安裝套件、不 vendoring。MIT 授權隨產物保留。HW-2 學習、HW-3 真人試用及 usable tag 不在範圍。

主控維護 `.team/PLAN.md`、規格／README／SUCCESS／CI，native T-901 worker 僅寫指定程式、測試及報告。不同模型家族唯讀 reviewer 必須審查最終 commit。

## 驗證計畫

所有 build/test 透過 agent-workspace launcher，指定 HANDWIRED_ROOT 到已驗證的外部固定來源。

- `node --test --test-isolation=none labs/handwired-learning/tests/forward.test.mjs labs/handwired-learning/tests/build.test.mjs`：先紅後綠、真實九點與邊界、非法輸入拒絕、離線建置與 UI 事件。
- `node --test --test-isolation=none labs/handwired-learning/tests/api-probe.test.mjs` 與 `node labs/handwired-learning/examples/api-probe.mjs`。
- `node labs/handwired-learning/scripts/build.mjs <outside-repo-output.html>`；若已有瀏覽器則以 file:// 驗證互動。
- `python3 -m unittest discover -s scripts/tests -p test_project_success.py -v`、`python3 scripts/check_project_success.py`、`python3 .github/scripts/validate_llms_txt.py`、`git diff --check`。
- Native task/report validators、最終 head CI、不同家族審查、合入最新 main 後重跑、merge 回讀。

## 授權界線

遵循里程碑 prompt 的 commit/push/PR/條件合併授權；不部署、不公開發佈、不呼叫付費 API、不改 AGENTS/CLAUDE、不關 issue。完成一個里程碑即結束。

## Owner 授權接手（2026-10-22）

Handwired-20261021-1844 接手同一 PR #460；原 worktree 保留。12 個檔案已取得 SHA-256 快照後複製到獨立 worktree，產品程式不重寫。main 已包含 Kith T-459/T-460，因此 Handwired task/report 改用 T-901/T-902，避免同名覆蓋。既有里程碑 prompt 的認領與交付流程仍適用。
